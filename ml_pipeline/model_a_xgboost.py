"""模型 A：XGBoost 预测未来 30 天每日园区整体人流量指数（推荐低人流日期）。"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import chinese_calendar as cc
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

from .features import (
    WEATHER_FEATURES,
    TIME_FEATURES_DAILY,
    metrics_mae_mse,
    school_vacation_info,
    temporal_train_test_split,
)

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "models" / "artifacts"


class CrowdXGBoostModel:
    """独立目标 y1：当日园区整体人流量指数。"""

    def __init__(self, feature_cols: list[str]):
        self.feature_cols = feature_cols
        self.model = xgb.XGBRegressor(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=1.0,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
        )
        self.metrics_: dict[str, float] = {}
        self.history_tail_: pd.DataFrame | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series, test_ratio: float = 0.2) -> dict[str, float]:
        X_train, X_test, y_train, y_test = temporal_train_test_split(X, y, test_ratio=test_ratio)
        self.model.fit(X_train[self.feature_cols], y_train)
        pred = self.model.predict(X_test[self.feature_cols])
        self.metrics_ = metrics_mae_mse(y_test, pred)
        # sklearn 接口再记一份，便于对照
        self.metrics_["sklearn_MAE"] = float(mean_absolute_error(y_test, pred))
        self.metrics_["sklearn_MSE"] = float(mean_squared_error(y_test, pred))
        self.history_tail_ = X.copy()
        self.history_tail_["crowd_index"] = y.values
        return self.metrics_

    def predict_frame(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(X[self.feature_cols])

    def forecast_date_range(
        self,
        start_date: date,
        end_date: date,
        weather_forecast: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        滚动预测 [start_date, end_date] 内每日 crowd_index。
        weather_forecast 需含 date/temperature_c/precipitation_mm/wind_speed_kmh；
        若缺失则用历史同期气候均值近似。
        """
        if self.history_tail_ is None or self.history_tail_.empty:
            raise RuntimeError("模型尚未训练或缺少历史尾部数据")
        if end_date < start_date:
            raise ValueError("end_date 不能早于 start_date")

        hist = self.history_tail_.sort_values("date").reset_index(drop=True)
        n_days = (end_date - start_date).days + 1

        weather_map: dict[date, dict] = {}
        if weather_forecast is not None and not weather_forecast.empty:
            wf = weather_forecast.copy()
            wf["date"] = pd.to_datetime(wf["date"]).dt.date
            for _, row in wf.iterrows():
                weather_map[row["date"]] = {
                    "temperature_c": float(row.get("temperature_c", 22.0)),
                    "precipitation_mm": float(row.get("precipitation_mm", 0.0)),
                    "wind_speed_kmh": float(row.get("wind_speed_kmh", 10.0)),
                }

        hist_month = hist.copy()
        hist_month["month"] = pd.to_datetime(hist_month["date"]).dt.month
        clim = hist_month.groupby("month")[WEATHER_FEATURES[:3]].mean()

        crowd_series = list(hist["crowd_index"].astype(float).values)
        rows: list[dict] = []

        for i in range(n_days):
            d = start_date + timedelta(days=i)
            weekday = d.weekday()
            is_weekend = int(weekday >= 5)
            is_holiday = int(cc.is_holiday(d))
            is_vac, vac_type = school_vacation_info(pd.Timestamp(d))
            month = d.month
            week = int(pd.Timestamp(d).isocalendar().week)

            if d in weather_map:
                temp = weather_map[d]["temperature_c"]
                precip = weather_map[d]["precipitation_mm"]
                wind = weather_map[d]["wind_speed_kmh"]
            else:
                temp = float(clim.loc[month, "temperature_c"]) if month in clim.index else 22.0
                precip = float(clim.loc[month, "precipitation_mm"]) if month in clim.index else 0.0
                wind = float(clim.loc[month, "wind_speed_kmh"]) if month in clim.index else 10.0

            lag1 = crowd_series[-1]
            lag7 = crowd_series[-7] if len(crowd_series) >= 7 else lag1
            roll7 = float(np.mean(crowd_series[-7:]))

            feat = {
                "month": month,
                "week": week,
                "weekday": weekday,
                "is_holiday": is_holiday,
                "is_weekend": is_weekend,
                "is_school_vacation": is_vac,
                "vacation_summer": int(vac_type == "summer"),
                "vacation_winter": int(vac_type == "winter"),
                "day_of_year": int(pd.Timestamp(d).dayofyear),
                "temperature_c": temp,
                "precipitation_mm": precip,
                "wind_speed_kmh": wind,
                "is_rainy": int(precip >= 1.0),
                "crowd_lag_1": lag1,
                "crowd_lag_7": lag7,
                "crowd_roll_7": roll7,
            }
            x = pd.DataFrame([feat])[self.feature_cols]
            pred = float(self.model.predict(x)[0])
            pred = float(np.clip(pred, 0, 100))
            crowd_series.append(pred)
            rows.append(
                {
                    "date": d.isoformat(),
                    "predicted_crowd_index": round(pred, 2),
                    "is_holiday": is_holiday,
                    "is_weekend": is_weekend,
                    "is_school_vacation": is_vac,
                    "temperature_c": round(temp, 2),
                    "precipitation_mm": round(precip, 2),
                    "wind_speed_kmh": round(wind, 2),
                    "recommend_low_crowd": None,  # 稍后统一标记
                }
            )

        out = pd.DataFrame(rows)
        ranked = out.sort_values("predicted_crowd_index")
        top_k = min(8, max(1, len(out) // 3))
        top_dates = set(ranked.head(top_k)["date"])
        out["recommend_low_crowd"] = out["date"].isin(top_dates)
        out["crowd_rank_asc"] = out["predicted_crowd_index"].rank(method="min").astype(int)
        return out

    def forecast_next_30_days(
        self,
        weather_forecast: pd.DataFrame | None = None,
        start_date: date | None = None,
    ) -> pd.DataFrame:
        """滚动预测未来 30 天每日 crowd_index。"""
        hist = self.history_tail_.sort_values("date").reset_index(drop=True)
        start = start_date or (pd.to_datetime(hist["date"].iloc[-1]).date() + timedelta(days=1))
        end = start + timedelta(days=29)
        return self.forecast_date_range(start, end, weather_forecast)

    def save(self, directory: Path | None = None) -> Path:
        directory = directory or ARTIFACT_DIR
        directory.mkdir(parents=True, exist_ok=True)
        model_path = directory / "model_a_xgboost_crowd.json"
        meta_path = directory / "model_a_meta.joblib"
        self.model.save_model(model_path)
        joblib.dump(
            {
                "feature_cols": self.feature_cols,
                "metrics": self.metrics_,
                "history_tail": self.history_tail_,
            },
            meta_path,
        )
        (directory / "model_a_metrics.json").write_text(
            json.dumps(self.metrics_, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return model_path

    @classmethod
    def load(cls, directory: Path | None = None) -> "CrowdXGBoostModel":
        directory = directory or ARTIFACT_DIR
        meta = joblib.load(directory / "model_a_meta.joblib")
        obj = cls(meta["feature_cols"])
        obj.model.load_model(directory / "model_a_xgboost_crowd.json")
        obj.metrics_ = meta.get("metrics", {})
        obj.history_tail_ = meta.get("history_tail")
        return obj


def recommend_low_crowd_dates(forecast_df: pd.DataFrame, top_n: int = 5) -> pd.DataFrame:
    cols = [
        "date",
        "predicted_crowd_index",
        "crowd_rank_asc",
        "is_holiday",
        "is_weekend",
        "temperature_c",
        "precipitation_mm",
    ]
    return (
        forecast_df.sort_values("predicted_crowd_index")
        .head(top_n)[cols]
        .reset_index(drop=True)
    )
