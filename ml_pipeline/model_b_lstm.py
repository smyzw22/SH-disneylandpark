"""模型 B：LSTM 预测单项目分时段排队时长（与园区人流模型独立）。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import chinese_calendar as cc
import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from .features import metrics_mae_mse, school_vacation_info

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "models" / "artifacts"

DEVICE = torch.device("cpu")


class WaitLSTM(nn.Module):
    def __init__(self, n_features: int, hidden: int = 64, layers: int = 2, dropout: float = 0.15):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=n_features,
            hidden_size=hidden,
            num_layers=layers,
            batch_first=True,
            dropout=dropout if layers > 1 else 0.0,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        last = out[:, -1, :]
        return self.head(last).squeeze(-1)


def build_sequences(
    frame: pd.DataFrame,
    feature_cols: list[str],
    target_col: str,
    seq_len: int = 24,
) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    """按项目分组构造时序窗口。"""
    xs: list[np.ndarray] = []
    ys: list[float] = []
    metas: list[dict] = []

    for ride_name, g in frame.groupby("ride_name"):
        g = g.sort_values(["date", "hour"]).reset_index(drop=True)
        values = g[feature_cols].to_numpy(dtype=np.float32)
        targets = g[target_col].to_numpy(dtype=np.float32)
        if len(g) <= seq_len:
            continue
        for i in range(seq_len, len(g)):
            xs.append(values[i - seq_len : i])
            ys.append(float(targets[i]))
            metas.append(
                {
                    "date": g.loc[i, "date"],
                    "hour": int(g.loc[i, "hour"]) if "hour" in g.columns else None,
                    "ride_name": ride_name,
                }
            )
    if not xs:
        raise ValueError("序列样本不足，请增加历史排队数据或减小 seq_len")
    return np.stack(xs), np.asarray(ys, dtype=np.float32), pd.DataFrame(metas)


class RideWaitLSTMModel:
    """独立目标 y2：单个游乐项目分时排队时长。"""

    def __init__(
        self,
        feature_cols: list[str],
        ride_map: dict[str, int],
        seq_len: int = 24,
        epochs: int = 12,
        batch_size: int = 256,
        lr: float = 1e-3,
    ):
        self.feature_cols = feature_cols
        self.ride_map = ride_map
        self.seq_len = seq_len
        self.epochs = epochs
        self.batch_size = batch_size
        self.lr = lr
        self.scaler = StandardScaler()
        self.model: WaitLSTM | None = None
        self.metrics_: dict[str, float] = {}
        self.last_frame_: pd.DataFrame | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series, test_ratio: float = 0.2) -> dict[str, float]:
        frame = X.copy()
        frame["wait_time_min"] = y.values
        frame = frame.sort_values(["date", "hour", "ride_name"]).reset_index(drop=True)

        scaled = self.scaler.fit_transform(frame[self.feature_cols].to_numpy(dtype=np.float32))
        frame_scaled = frame.copy()
        frame_scaled[self.feature_cols] = scaled

        seq_x, seq_y, meta = build_sequences(
            frame_scaled, self.feature_cols, "wait_time_min", seq_len=self.seq_len
        )
        # 时间切分
        split = int(len(seq_x) * (1 - test_ratio))
        split = max(1, min(split, len(seq_x) - 1))
        x_train, x_test = seq_x[:split], seq_x[split:]
        y_train, y_test = seq_y[:split], seq_y[split:]

        self.model = WaitLSTM(n_features=len(self.feature_cols)).to(DEVICE)
        opt = torch.optim.Adam(self.model.parameters(), lr=self.lr)
        loss_fn = nn.MSELoss()

        train_loader = DataLoader(
            TensorDataset(
                torch.from_numpy(x_train),
                torch.from_numpy(y_train),
            ),
            batch_size=self.batch_size,
            shuffle=True,
        )

        self.model.train()
        for epoch in range(self.epochs):
            total = 0.0
            n = 0
            for xb, yb in train_loader:
                xb, yb = xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                pred = self.model(xb)
                loss = loss_fn(pred, yb)
                loss.backward()
                opt.step()
                total += float(loss.item()) * len(xb)
                n += len(xb)
            if (epoch + 1) % max(1, self.epochs // 4) == 0 or epoch == 0:
                print(f"  [LSTM] epoch {epoch + 1}/{self.epochs} train_mse={total / max(n, 1):.4f}")

        self.model.eval()
        with torch.no_grad():
            pred_test = self.model(torch.from_numpy(x_test).to(DEVICE)).cpu().numpy()
        self.metrics_ = metrics_mae_mse(y_test, pred_test)
        self.last_frame_ = frame.copy()
        self._meta_test_size = len(meta) - split
        return self.metrics_

    def build_hour_features(
        self,
        target_date: date,
        hour: int,
        ride_name: str,
        weather: dict[str, float],
    ) -> dict[str, float | int]:
        """构造指定日/时/项目的 LSTM 输入特征。"""
        ts = pd.Timestamp(target_date)
        weekday = ts.weekday()
        is_vac, vac_type = school_vacation_info(ts)
        precip = float(weather.get("precipitation_mm", 0.0))
        return {
            "month": ts.month,
            "week": int(ts.isocalendar().week),
            "weekday": weekday,
            "is_holiday": int(cc.is_holiday(target_date)),
            "is_weekend": int(weekday >= 5),
            "is_school_vacation": is_vac,
            "vacation_summer": int(vac_type == "summer"),
            "vacation_winter": int(vac_type == "winter"),
            "day_of_year": int(ts.dayofyear),
            "hour": hour,
            "slot_morning": int(9 <= hour < 12),
            "slot_afternoon": int(12 <= hour < 17),
            "slot_evening": int(17 <= hour <= 22),
            "temperature_c": float(weather.get("temperature_c", 22.0)),
            "precipitation_mm": precip,
            "wind_speed_kmh": float(weather.get("wind_speed_kmh", 10.0)),
            "is_rainy": int(precip >= 1.0),
            "ride_code": self.ride_map[ride_name],
        }

    def predict_ride_day(
        self,
        ride_name: str,
        target_date: date,
        weather: dict[str, float],
        hours: range | None = None,
    ) -> pd.DataFrame:
        """预测指定项目在某日各开园时段的排队时长。"""
        if hours is None:
            hours = range(9, 22)
        rows = []
        for hour in hours:
            feat = self.build_hour_features(target_date, hour, ride_name, weather)
            feat["date"] = pd.Timestamp(target_date)
            rows.append(feat)
        future_features = pd.DataFrame(rows)
        return self.predict_ride_horizon(
            ride_name, horizon_steps=len(rows), future_features=future_features
        )

    def predict_ride_horizon(
        self,
        ride_name: str,
        horizon_steps: int = 13,
        future_features: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        对指定项目预测未来若干时段排队（默认约一天开园时段）。
        future_features 需含与训练一致的 feature_cols + date/hour；
        若未提供，则基于历史最后一天同小时特征做简易外推。
        """
        if self.model is None or self.last_frame_ is None:
            raise RuntimeError("模型尚未训练")
        if ride_name not in self.ride_map:
            raise ValueError(f"未知项目: {ride_name}，可选: {list(self.ride_map)}")

        hist = self.last_frame_[self.last_frame_["ride_name"] == ride_name].sort_values(
            ["date", "hour"]
        )
        if len(hist) < self.seq_len:
            raise ValueError(f"项目 {ride_name} 历史不足以构成长度 {self.seq_len} 的序列")

        work = hist.copy()
        preds: list[dict] = []

        if future_features is None:
            # 用最近一周同星期同小时的特征均值构造未来窗口
            last_day = pd.to_datetime(work["date"]).max()
            template = work.tail(self.seq_len).copy()
            future_rows = []
            for step in range(horizon_steps):
                src = template.iloc[step % len(template)].copy()
                # 日期向前推进：按开园小时循环
                hours = list(range(9, 22))
                hour = hours[step % len(hours)]
                day_offset = step // len(hours) + 1
                src["date"] = last_day + pd.Timedelta(days=day_offset)
                src["hour"] = hour
                src["weekday"] = src["date"].weekday()
                src["is_weekend"] = int(src["weekday"] >= 5)
                src["month"] = src["date"].month
                src["day_of_year"] = int(src["date"].dayofyear)
                src["week"] = int(src["date"].isocalendar().week)
                future_rows.append(src)
            future_features = pd.DataFrame(future_rows)

        self.model.eval()
        seq_values = work[self.feature_cols].to_numpy(dtype=np.float32)
        seq_values = self.scaler.transform(seq_values)

        for _, row in future_features.iterrows():
            feat = row[self.feature_cols].to_numpy(dtype=np.float32).reshape(1, -1)
            feat_s = self.scaler.transform(feat)
            window = np.vstack([seq_values[-self.seq_len :], feat_s])[-self.seq_len :]
            with torch.no_grad():
                pred = float(
                    self.model(torch.from_numpy(window[None, ...]).to(DEVICE)).cpu().numpy()[0]
                )
            pred = float(np.clip(pred, 0, 300))
            seq_values = np.vstack([seq_values, feat_s])
            preds.append(
                {
                    "date": pd.to_datetime(row["date"]).date().isoformat(),
                    "hour": int(row["hour"]),
                    "ride_name": ride_name,
                    "predicted_wait_min": round(pred, 1),
                }
            )
        return pd.DataFrame(preds)

    def save(self, directory: Path | None = None) -> Path:
        directory = directory or ARTIFACT_DIR
        directory.mkdir(parents=True, exist_ok=True)
        assert self.model is not None
        weights = directory / "model_b_lstm_wait.pt"
        torch.save(self.model.state_dict(), weights)
        joblib.dump(
            {
                "feature_cols": self.feature_cols,
                "ride_map": self.ride_map,
                "seq_len": self.seq_len,
                "scaler": self.scaler,
                "metrics": self.metrics_,
                "last_frame": self.last_frame_,
                "model_config": {"hidden": 64, "layers": 2},
            },
            directory / "model_b_meta.joblib",
        )
        (directory / "model_b_metrics.json").write_text(
            json.dumps(self.metrics_, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return weights

    @classmethod
    def load(cls, directory: Path | None = None) -> "RideWaitLSTMModel":
        directory = directory or ARTIFACT_DIR
        meta = joblib.load(directory / "model_b_meta.joblib")
        obj = cls(
            feature_cols=meta["feature_cols"],
            ride_map=meta["ride_map"],
            seq_len=meta["seq_len"],
        )
        obj.scaler = meta["scaler"]
        obj.metrics_ = meta.get("metrics", {})
        obj.last_frame_ = meta.get("last_frame")
        cfg = meta.get("model_config", {"hidden": 64, "layers": 2})
        obj.model = WaitLSTM(
            n_features=len(obj.feature_cols),
            hidden=cfg.get("hidden", 64),
            layers=cfg.get("layers", 2),
        ).to(DEVICE)
        obj.model.load_state_dict(torch.load(directory / "model_b_lstm_wait.pt", map_location=DEVICE))
        obj.model.eval()
        return obj
