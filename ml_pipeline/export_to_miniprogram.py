"""把 data/raw 爬虫 CSV 导出为小程序可用的 park_data.json，并基于历史画像生成 30 天预测。"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import chinese_calendar as cc
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "miniprogram" / "src" / "data" / "park_data.json"

HOT = [
    "创极速光轮",
    "疯狂动物城：热力追踪",
    "抱抱龙冲天赛车",
    "漫威英雄总部：钢铁侠飞行器",
    "加勒比海盗——沉落宝藏之战",
    "翱翔·飞越地平线",
    "七个小矮人矿山车",
]
COLD = ["巴斯光年星际营救", "小飞象", "小熊维尼历险记"]


def tier(name: str) -> str:
    if name in HOT:
        return "hot"
    if name in COLD:
        return "cold"
    return "medium"


def export() -> Path:
    daily_files = sorted(RAW.glob("daily_total_*.csv"))
    ride_files = sorted(RAW.glob("ride_queue_*.csv"))
    if not daily_files or not ride_files:
        raise FileNotFoundError("data/raw 下缺少 daily_total_*.csv / ride_queue_*.csv")

    daily = pd.concat([pd.read_csv(f) for f in daily_files], ignore_index=True)
    rides = pd.concat([pd.read_csv(f) for f in ride_files], ignore_index=True)
    daily["date"] = pd.to_datetime(daily["date"])
    rides["date"] = pd.to_datetime(rides["date"])

    hist = (
        daily.groupby(daily["date"].dt.date)
        .agg(
            crowd_index=("crowd_index", "mean"),
            avg_wait_min=("avg_wait_min", "mean"),
            is_holiday=("is_holiday", "max"),
            is_weekend=("is_weekend", "max"),
        )
        .reset_index()
    )
    hist["date"] = hist["date"].astype(str)
    hist["crowd_index"] = hist["crowd_index"].round(1)
    hist["avg_wait_min"] = hist["avg_wait_min"].round(1)
    hist["is_holiday"] = hist["is_holiday"].astype(bool)
    hist["is_weekend"] = hist["is_weekend"].astype(bool)

    last_day = daily["date"].max()
    day_df = daily[daily["date"] == last_day].sort_values("hour")
    last = day_df.iloc[-1]
    day_str = last_day.date().isoformat()
    hour = int(last["hour"])
    ride_last = rides[(rides["date"] == last_day) & (rides["hour"] == hour)]
    if ride_last.empty:
        ride_last = rides[rides["date"] == last_day].sort_values("hour").groupby("ride_name", as_index=False).tail(1)

    rides_payload = []
    for _, r in ride_last.iterrows():
        rides_payload.append(
            {
                "ride_id": str(r.get("ride_id", "")),
                "ride_name": str(r["ride_name"]),
                "wait_time_min": None if pd.isna(r.get("wait_time_min")) else int(r["wait_time_min"]),
                "status": str(r.get("status", "OPERATING")),
                "tier": tier(str(r["ride_name"])),
            }
        )
    rides_payload.sort(key=lambda x: -(x["wait_time_min"] or 0))

    realtime = {
        "date": day_str,
        "hour": hour,
        "crowd_index": round(float(last["crowd_index"]), 1),
        "operating_rides": int(last["operating_rides"]) if not pd.isna(last["operating_rides"]) else len(rides_payload),
        "avg_wait_min": round(float(last["avg_wait_min"]), 1) if not pd.isna(last["avg_wait_min"]) else 0,
        "max_wait_min": round(float(last["max_wait_min"]), 1) if not pd.isna(last["max_wait_min"]) else 0,
        "park_status": str(last.get("park_status") or "OPERATING"),
        "weather": {
            "temperature_c": round(float(last["temperature_c"]), 1) if not pd.isna(last["temperature_c"]) else 26,
            "precipitation_mm": round(float(last["precipitation_mm"]), 1) if not pd.isna(last["precipitation_mm"]) else 0,
            "wind_speed_kmh": 12,
        },
        "calendar": {
            "is_holiday": bool(last["is_holiday"]),
            "is_weekend": bool(last["is_weekend"]),
            "is_school_vacation": bool(last.get("is_school_vacation") or 0),
        },
        "rides": rides_payload,
        "updated_at": str(last.get("scraped_at") or ""),
        "data_source": "scraper_csv",
    }

    crowd_prof = daily.copy()
    crowd_prof["weekday"] = crowd_prof["date"].dt.weekday
    crowd_prof["month"] = crowd_prof["date"].dt.month
    cp = (
        crowd_prof.groupby(["weekday", "month", "is_holiday", "is_weekend"])
        .agg(crowd=("crowd_index", "mean"), temp=("temperature_c", "mean"), precip=("precipitation_mm", "mean"))
        .reset_index()
    )

    rides2 = rides.dropna(subset=["wait_time_min"]).copy()
    rides2["weekday"] = rides2["date"].dt.weekday
    profile = rides2.groupby(["ride_name", "hour", "weekday"])["wait_time_min"].mean().reset_index()
    hot_profile = (
        rides2[rides2["ride_name"].isin(HOT)].groupby(["hour", "weekday"])["wait_time_min"].mean().reset_index()
    )

    hist_mean = float(hist["crowd_index"].mean())
    recent = float(hist.tail(7)["crowd_index"].mean())
    recent_bias = float((recent - hist_mean) / max(hist_mean, 1) * 0.15)

    start = date.today() + timedelta(days=1)
    rows = []
    for i in range(30):
        d = start + timedelta(days=i)
        wd = d.weekday()
        month = d.month
        is_weekend = 1 if wd >= 5 else 0
        is_holiday = 1 if cc.is_holiday(d) else 0
        sub = cp[(cp["weekday"] == wd) & (cp["month"] == month)]
        if sub.empty:
            sub = cp[cp["weekday"] == wd]
        if sub.empty:
            base, temp, precip = hist_mean, 26.0, 0.0
        else:
            m2 = sub[(sub["is_holiday"] == is_holiday) & (sub["is_weekend"] == is_weekend)]
            use = m2 if not m2.empty else sub
            base = float(use["crowd"].mean())
            temp = float(use["temp"].mean()) if not pd.isna(use["temp"].mean()) else 26.0
            precip = float(use["precip"].mean()) if not pd.isna(use["precip"].mean()) else 0.0
        crowd = base * (1 + recent_bias)
        if precip >= 5:
            crowd *= 0.9
        if temp >= 34 or temp <= 3:
            crowd *= 0.92
        crowd = float(np.clip(crowd, 8, 98))
        hp = hot_profile[(hot_profile["hour"] == 14) & (hot_profile["weekday"] == wd)]
        if hp.empty:
            hot_wait = crowd * 0.34
        else:
            hot_wait = float(hp["wait_time_min"].mean())
            hot_wait = hot_wait * (0.92 if is_holiday else 0.75) + crowd * (0.08 if is_holiday else 0.12)
        hot_wait = float(np.clip(hot_wait, 3, 120))
        conflict = crowd < 42 and hot_wait > 22
        conf = 78 + (5 if len(sub) else -8) + (-4 if precip >= 5 else 2)
        rows.append(
            {
                "date": d.isoformat(),
                "predicted_crowd_index": round(crowd, 1),
                "crowd_rank": 0,
                "hot_ride_avg_wait_min": round(hot_wait, 1),
                "wait_rank": 0,
                "is_holiday": is_holiday,
                "is_weekend": is_weekend,
                "conflict": conflict,
                "conflict_note": "⚠ 园区人流偏低，但热门排队仍偏长。建议早场冲热门、午峰改玩冷门。" if conflict else None,
                "temperature_c": round(temp, 1),
                "precipitation_mm": round(precip, 1),
                "confidence": int(np.clip(conf, 55, 95)),
                "data_source": "scraper_profile",
            }
        )

    for i, r in enumerate(sorted(rows, key=lambda x: x["predicted_crowd_index"])):
        r["crowd_rank"] = i + 1
    for i, r in enumerate(sorted(rows, key=lambda x: x["hot_ride_avg_wait_min"])):
        r["wait_rank"] = i + 1

    wait_table = {
        f"{r['ride_name']}|{int(r['hour'])}|{int(r['weekday'])}": round(float(r["wait_time_min"]), 1)
        for _, r in profile.iterrows()
    }

    payload = {
        "realtime": realtime,
        "forecast": rows,
        "history": hist[["date", "crowd_index", "avg_wait_min", "is_holiday", "is_weekend"]].tail(60).to_dict("records"),
        "wait_table": wait_table,
        "exported_at": pd.Timestamp.now().isoformat(),
        "source_files": [f.name for f in daily_files + ride_files],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return OUT


if __name__ == "__main__":
    path = export()
    print(f"exported -> {path}")
