#!/usr/bin/env python3
"""Copy the latest verified SQLite snapshot into the mini-program offline bundle.

This intentionally updates only observed realtime/history fields. Forecast and
profile fields remain model outputs and keep their own provenance labels.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import chinese_calendar as cc


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "shanghai_disneyland.db"
OUT = ROOT / "miniprogram" / "src" / "data" / "park_data.json"


def main() -> None:
    payload = json.loads(OUT.read_text(encoding="utf-8"))
    old_forecast = payload.get("forecast", [])
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        latest = conn.execute(
            "SELECT * FROM daily_total ORDER BY date DESC, hour DESC, minute DESC, scraped_at DESC LIMIT 1"
        ).fetchone()
        if latest is None:
            raise SystemExit("数据库没有可导出的实采快照")
        rides = conn.execute(
            """
            SELECT ride_id, ride_name, wait_time_min, status, last_updated
            FROM ride_queue
            WHERE date = ? AND hour = ? AND minute = ? AND entity_type = 'ATTRACTION'
            ORDER BY CASE WHEN wait_time_min IS NULL THEN 1 ELSE 0 END,
                     wait_time_min DESC, ride_name
            """,
            (latest["date"], latest["hour"], latest["minute"]),
        ).fetchall()
        history = conn.execute(
            """
            SELECT date, ROUND(AVG(crowd_index), 1) AS crowd_index,
                   ROUND(AVG(avg_wait_min), 1) AS avg_wait_min,
                   MAX(is_holiday) AS is_holiday, MAX(is_weekend) AS is_weekend
            FROM daily_total GROUP BY date ORDER BY date DESC LIMIT 60
            """
        ).fetchall()

    payload["realtime"] = {
        "date": latest["date"],
        "hour": latest["hour"],
        "minute": latest["minute"],
        "crowd_index": round(latest["crowd_index"], 1),
        "operating_rides": latest["operating_rides"],
        "avg_wait_min": round(latest["avg_wait_min"], 1),
        "max_wait_min": latest["max_wait_min"],
        "park_status": latest["park_status"],
        "weather": {
            "temperature_c": latest["temperature_c"],
            "precipitation_mm": latest["precipitation_mm"],
        },
        "calendar": {
            "is_holiday": bool(latest["is_holiday"]),
            "is_weekend": bool(latest["is_weekend"]),
            "is_school_vacation": bool(latest["is_school_vacation"]),
        },
        "rides": [
            {
                "ride_id": row["ride_id"],
                "ride_name": row["ride_name"],
                "wait_time_min": row["wait_time_min"],
                "status": row["status"],
            }
            for row in rides
        ],
        "updated_at": latest["scraped_at"],
        "data_source": "bundled_snapshot",
        "source_url": "https://api.themeparks.wiki/",
    }
    payload["history"] = [
        {
            "date": row["date"],
            "crowd_index": row["crowd_index"],
            "avg_wait_min": row["avg_wait_min"],
            "is_holiday": bool(row["is_holiday"]),
            "is_weekend": bool(row["is_weekend"]),
        }
        for row in reversed(history)
    ]
    # Re-anchor the 30-day estimate to today. Values remain explicitly labelled
    # as model estimates; observed realtime data is never copied into the future.
    weekday_profiles: dict[int, list[dict]] = {i: [] for i in range(7)}
    for row in old_forecast:
        try:
            weekday_profiles[date.fromisoformat(row["date"]).weekday()].append(row)
        except (KeyError, ValueError):
            continue

    forecasts = []
    for offset in range(1, 31):
        target = date.today() + timedelta(days=offset)
        profile = weekday_profiles[target.weekday()] or old_forecast
        crowd = sum(float(x["predicted_crowd_index"]) for x in profile) / max(1, len(profile))
        wait = sum(float(x["hot_ride_avg_wait_min"]) for x in profile) / max(1, len(profile))
        holiday = bool(cc.is_holiday(target))
        if holiday:
            crowd = max(crowd * 1.22, 65.0)
            wait = max(wait * 1.15, 45.0)
        crowd = min(98.0, max(8.0, crowd))
        wait = min(150.0, max(3.0, wait))
        forecasts.append(
            {
                "date": target.isoformat(),
                "predicted_crowd_index": round(crowd, 1),
                "crowd_rank": 0,
                "hot_ride_avg_wait_min": round(wait, 1),
                "wait_rank": 0,
                "is_holiday": int(holiday),
                "is_weekend": int(target.weekday() >= 5),
                "conflict": crowd < 42 and wait > 22,
                "conflict_note": "园区整体预测较舒适，但热门项目仍可能集中排队。" if crowd < 42 and wait > 22 else None,
                "confidence": 64 if offset <= 7 else 58,
                "data_source": "historical_profile_estimate",
            }
        )
    for rank, row in enumerate(sorted(forecasts, key=lambda x: x["predicted_crowd_index"]), 1):
        row["crowd_rank"] = rank
    for rank, row in enumerate(sorted(forecasts, key=lambda x: x["hot_ride_avg_wait_min"]), 1):
        row["wait_rank"] = rank
    payload["forecast"] = forecasts
    payload["provenance"] = {
        "realtime": "ThemeParks.wiki live API + Open-Meteo, stored without synthetic jitter",
        "forecast": "model estimate based on historical profiles; not observed future data",
        "latest_observed_at": latest["scraped_at"],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"exported {len(rides)} attractions from {latest['scraped_at']} -> {OUT}")


if __name__ == "__main__":
    main()
