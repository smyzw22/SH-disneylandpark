"""特征工程：时间特征 + 气象特征；独立构建 y1 / y2。"""

from __future__ import annotations

from typing import Iterable

import chinese_calendar as cc
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 列名归一
# ---------------------------------------------------------------------------

DAILY_ALIASES = {
    "date": ["date", "日期", "day", "dt"],
    "hour": ["hour", "小时", "时段", "time_hour"],
    "crowd_index": ["crowd_index", "人流量指数", "人流指数", "crowd", "y1"],
    "temperature_c": ["temperature_c", "temperature", "温度", "temp", "气温"],
    "precipitation_mm": ["precipitation_mm", "precipitation", "降雨", "rain", "降水", "precip"],
    "wind_speed_kmh": ["wind_speed_kmh", "wind", "风力", "风速", "windspeed", "wind_speed"],
    "is_holiday": ["is_holiday", "节假日", "holiday"],
    "is_weekend": ["is_weekend", "周末", "weekend"],
    "is_school_vacation": ["is_school_vacation", "寒暑假", "school_vacation"],
    "school_vacation_type": ["school_vacation_type", "假期类型"],
    "avg_wait_min": ["avg_wait_min", "平均排队"],
    "max_wait_min": ["max_wait_min", "最大排队"],
    "operating_rides": ["operating_rides", "运营项目数"],
}

RIDE_ALIASES = {
    "date": ["date", "日期", "day", "dt"],
    "hour": ["hour", "小时", "时段", "time_hour"],
    "ride_id": ["ride_id", "项目id", "attraction_id", "id"],
    "ride_name": ["ride_name", "项目名称", "attraction", "name", "游乐项目"],
    "wait_time_min": ["wait_time_min", "排队时长", "wait", "wait_time", "y2", "排队"],
    "status": ["status", "状态"],
    "entity_type": ["entity_type", "类型"],
    "temperature_c": ["temperature_c", "temperature", "温度", "temp"],
    "precipitation_mm": ["precipitation_mm", "precipitation", "降雨", "rain"],
    "wind_speed_kmh": ["wind_speed_kmh", "wind", "风力", "风速", "windspeed"],
}


def _normalize_columns(df: pd.DataFrame, aliases: dict[str, list[str]]) -> pd.DataFrame:
    lower_map = {c.lower().strip(): c for c in df.columns}
    rename: dict[str, str] = {}
    for canon, names in aliases.items():
        for name in names:
            key = name.lower()
            if key in lower_map:
                rename[lower_map[key]] = canon
                break
    out = df.rename(columns=rename).copy()
    return out


def school_vacation_info(d: pd.Timestamp) -> tuple[int, str | None]:
    if d.month in (7, 8):
        return 1, "summer"
    if (d.month == 1 and d.day >= 15) or (d.month == 2 and d.day <= 20):
        return 1, "winter"
    return 0, None


def enrich_calendar_flags(df: pd.DataFrame) -> pd.DataFrame:
    """补全月/周/节假日/寒暑假/星期等时间特征。"""
    out = df.copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out = out.dropna(subset=["date"])

    out["month"] = out["date"].dt.month
    out["week"] = out["date"].dt.isocalendar().week.astype(int)
    out["weekday"] = out["date"].dt.weekday  # 0=周一
    out["day_of_year"] = out["date"].dt.dayofyear
    out["year"] = out["date"].dt.year

    if "is_weekend" not in out.columns:
        out["is_weekend"] = (out["weekday"] >= 5).astype(int)
    else:
        out["is_weekend"] = pd.to_numeric(out["is_weekend"], errors="coerce").fillna(
            (out["weekday"] >= 5).astype(int)
        ).astype(int)

    if "is_holiday" not in out.columns:
        out["is_holiday"] = out["date"].dt.date.map(lambda d: int(cc.is_holiday(d)))
    else:
        out["is_holiday"] = pd.to_numeric(out["is_holiday"], errors="coerce")
        miss = out["is_holiday"].isna()
        if miss.any():
            out.loc[miss, "is_holiday"] = out.loc[miss, "date"].dt.date.map(
                lambda d: int(cc.is_holiday(d))
            )
        out["is_holiday"] = out["is_holiday"].astype(int)

    if "is_school_vacation" not in out.columns or "school_vacation_type" not in out.columns:
        vac = out["date"].map(school_vacation_info)
        out["is_school_vacation"] = vac.map(lambda x: x[0]).astype(int)
        out["school_vacation_type"] = vac.map(lambda x: x[1])
    else:
        out["is_school_vacation"] = pd.to_numeric(out["is_school_vacation"], errors="coerce").fillna(0).astype(int)
        out["school_vacation_type"] = out["school_vacation_type"].fillna("none")

    out["school_vacation_type"] = out["school_vacation_type"].fillna("none").replace({"": "none", None: "none"})
    out["vacation_summer"] = (out["school_vacation_type"] == "summer").astype(int)
    out["vacation_winter"] = (out["school_vacation_type"] == "winter").astype(int)
    return out


def fill_weather(df: pd.DataFrame) -> pd.DataFrame:
    """气象缺失：按日期中位数填充，再全局中位数。"""
    out = df.copy()
    for col in ("temperature_c", "precipitation_mm", "wind_speed_kmh"):
        if col not in out.columns:
            out[col] = np.nan
        out[col] = pd.to_numeric(out[col], errors="coerce")
        if "date" in out.columns:
            out[col] = out.groupby(out["date"].dt.date)[col].transform(
                lambda s: s.fillna(s.median())
            )
        out[col] = out[col].fillna(out[col].median())
        if out[col].isna().all():
            defaults = {"temperature_c": 22.0, "precipitation_mm": 0.0, "wind_speed_kmh": 10.0}
            out[col] = defaults[col]
    out["is_rainy"] = (out["precipitation_mm"] >= 1.0).astype(int)
    return out


def time_slot(hour: Iterable[float] | pd.Series) -> pd.Series:
    """时段编码：早/午/晚/闭园外。"""
    h = pd.to_numeric(pd.Series(hour), errors="coerce")
    slot = pd.Series("closed", index=h.index)
    slot[(h >= 8) & (h < 12)] = "morning"
    slot[(h >= 12) & (h < 17)] = "afternoon"
    slot[(h >= 17) & (h <= 22)] = "evening"
    return slot


# ---------------------------------------------------------------------------
# y1：当日园区整体人流量指数
# ---------------------------------------------------------------------------

TIME_FEATURES_DAILY = [
    "month",
    "week",
    "weekday",
    "is_holiday",
    "is_weekend",
    "is_school_vacation",
    "vacation_summer",
    "vacation_winter",
    "day_of_year",
]
WEATHER_FEATURES = ["temperature_c", "precipitation_mm", "wind_speed_kmh", "is_rainy"]


def build_y1_dataset(daily_raw: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    """
    目标 y1 = 当日园区整体人流量指数。
    若原始为分时快照，则按日聚合（取日均 crowd_index）。
    """
    df = _normalize_columns(daily_raw, DAILY_ALIASES)
    if "crowd_index" not in df.columns:
        raise ValueError("日常数据缺少 crowd_index / 人流量指数 列")

    df = enrich_calendar_flags(df)
    df = fill_weather(df)
    df["crowd_index"] = pd.to_numeric(df["crowd_index"], errors="coerce")
    df = df.dropna(subset=["crowd_index"])

    # 清洗异常值
    df = df[(df["crowd_index"] >= 0) & (df["crowd_index"] <= 100)]

    agg_map = {
        "crowd_index": "mean",
        "temperature_c": "mean",
        "precipitation_mm": "max",
        "wind_speed_kmh": "mean",
        "is_holiday": "max",
        "is_weekend": "max",
        "is_school_vacation": "max",
        "vacation_summer": "max",
        "vacation_winter": "max",
        "month": "first",
        "week": "first",
        "weekday": "first",
        "day_of_year": "first",
        "year": "first",
    }
    daily = (
        df.groupby(df["date"].dt.date, as_index=False)
        .agg(agg_map)
        .rename(columns={"date": "date"})
    )
    daily["date"] = pd.to_datetime(daily["date"])
    daily["is_rainy"] = (daily["precipitation_mm"] >= 1.0).astype(int)
    daily = daily.sort_values("date").drop_duplicates(subset=["date"], keep="last")

    # 滞后特征（仅用于训练，不泄漏未来）
    daily["crowd_lag_1"] = daily["crowd_index"].shift(1)
    daily["crowd_lag_7"] = daily["crowd_index"].shift(7)
    daily["crowd_roll_7"] = daily["crowd_index"].shift(1).rolling(7, min_periods=3).mean()
    daily = daily.dropna(subset=["crowd_lag_1", "crowd_roll_7"]).reset_index(drop=True)

    feature_cols = TIME_FEATURES_DAILY + WEATHER_FEATURES + ["crowd_lag_1", "crowd_lag_7", "crowd_roll_7"]
    # lag_7 可能仍有缺失
    daily["crowd_lag_7"] = daily["crowd_lag_7"].fillna(daily["crowd_lag_1"])

    X = daily[feature_cols].copy()
    y = daily["crowd_index"].astype(float)
    meta = daily[["date"]].copy()
    X = pd.concat([meta, X], axis=1)
    return X, y, feature_cols


# ---------------------------------------------------------------------------
# y2：单个游乐项目分时排队时长
# ---------------------------------------------------------------------------

TIME_FEATURES_HOURLY = TIME_FEATURES_DAILY + ["hour", "slot_morning", "slot_afternoon", "slot_evening"]


def build_y2_dataset(
    ride_raw: pd.DataFrame,
    weather_daily: pd.DataFrame | None = None,
    ride_name: str | None = None,
) -> tuple[pd.DataFrame, pd.Series, list[str], dict[str, int]]:
    """
    目标 y2 = 单个游乐项目分时排队时长（分钟）。
    若指定 ride_name，则只保留该项目；否则对全部项目做 label encoding。
    """
    df = _normalize_columns(ride_raw, RIDE_ALIASES)
    required = {"date", "hour", "wait_time_min"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"排队数据缺少列: {missing}")

    if "ride_name" not in df.columns:
        if "ride_id" in df.columns:
            df["ride_name"] = df["ride_id"].astype(str)
        else:
            raise ValueError("排队数据缺少 ride_name / ride_id")

    df = enrich_calendar_flags(df)
    df["hour"] = pd.to_numeric(df["hour"], errors="coerce")
    df = df.dropna(subset=["hour"])
    df["hour"] = df["hour"].astype(int)
    df = df[(df["hour"] >= 8) & (df["hour"] <= 22)]

    # 合并日级气象（若 ride CSV 本身无气象列）
    if weather_daily is not None and not weather_daily.empty:
        w = weather_daily.copy()
        w["date"] = pd.to_datetime(w["date"]).dt.normalize()
        df["date_key"] = df["date"].dt.normalize()
        merge_cols = [c for c in ("temperature_c", "precipitation_mm", "wind_speed_kmh") if c in w.columns]
        if merge_cols:
            w2 = w[["date"] + merge_cols].drop_duplicates("date")
            w2 = w2.rename(columns={"date": "date_key"})
            for c in merge_cols:
                if c in df.columns:
                    df = df.drop(columns=[c])
            df = df.merge(w2, on="date_key", how="left")
        df = df.drop(columns=["date_key"], errors="ignore")

    df = fill_weather(df)
    df["wait_time_min"] = pd.to_numeric(df["wait_time_min"], errors="coerce")
    df = df.dropna(subset=["wait_time_min"])
    df = df[(df["wait_time_min"] >= 0) & (df["wait_time_min"] <= 300)]

    if "status" in df.columns:
        df = df[df["status"].astype(str).str.upper().isin(["OPERATING", "OPEN", "nan", "NONE", ""]) | df["status"].isna()]

    if ride_name:
        df = df[df["ride_name"] == ride_name].copy()
        if df.empty:
            raise ValueError(f"未找到项目: {ride_name}")

    df["slot"] = time_slot(df["hour"])
    df["slot_morning"] = (df["slot"] == "morning").astype(int)
    df["slot_afternoon"] = (df["slot"] == "afternoon").astype(int)
    df["slot_evening"] = (df["slot"] == "evening").astype(int)

    ride_names = sorted(df["ride_name"].astype(str).unique())
    ride_map = {n: i for i, n in enumerate(ride_names)}
    df["ride_code"] = df["ride_name"].astype(str).map(ride_map)

    df = df.sort_values(["ride_name", "date", "hour"]).drop_duplicates(
        subset=["ride_name", "date", "hour"], keep="last"
    )

    feature_cols = TIME_FEATURES_HOURLY + WEATHER_FEATURES + ["ride_code"]
    X = df[["date", "ride_name"] + feature_cols].copy()
    y = df["wait_time_min"].astype(float)
    return X.reset_index(drop=True), y.reset_index(drop=True), feature_cols, ride_map


def temporal_train_test_split(
    X: pd.DataFrame,
    y: pd.Series,
    date_col: str = "date",
    test_ratio: float = 0.2,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    """按时间顺序切分，避免未来泄漏。"""
    order = np.argsort(pd.to_datetime(X[date_col]).values)
    X_sorted = X.iloc[order].reset_index(drop=True)
    y_sorted = y.iloc[order].reset_index(drop=True)
    split = int(len(X_sorted) * (1 - test_ratio))
    split = max(1, min(split, len(X_sorted) - 1))
    return (
        X_sorted.iloc[:split].reset_index(drop=True),
        X_sorted.iloc[split:].reset_index(drop=True),
        y_sorted.iloc[:split].reset_index(drop=True),
        y_sorted.iloc[split:].reset_index(drop=True),
    )


def metrics_mae_mse(y_true, y_pred) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mae = float(np.mean(np.abs(y_true - y_pred)))
    mse = float(np.mean((y_true - y_pred) ** 2))
    return {"MAE": mae, "MSE": mse, "RMSE": float(np.sqrt(mse))}
