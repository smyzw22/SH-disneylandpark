"""生成可训练的历史 CSV（真实气象 + 与爬虫 schema 对齐的合成人流/排队）。

说明：
本地无历史 CSV、SQLite 为空时，用 Open-Meteo 拉取上海迪士尼真实气象，
并按节假日/寒暑假/星期/天气规律合成 crowd_index 与 wait_time，
便于跑通双模型流水线。抓虫积累真实数据后，将覆盖 data/raw 即可。
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import chinese_calendar as cc
import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = ROOT / "data" / "raw"

WEATHER_LAT = 31.1433
WEATHER_LON = 121.6580

# 上海迪士尼代表性项目（热度系数越高，排队越长；节假日分流效应不同）
RIDES = [
    {"ride_id": "tron", "ride_name": "创极速光轮", "popularity": 1.35, "dispersal": 0.15},
    {"ride_id": "pirates", "ride_name": "加勒比海盗——沉落宝藏之战", "popularity": 1.20, "dispersal": 0.25},
    {"ride_id": "soaring", "ride_name": "翱翔·飞越地平线", "popularity": 1.15, "dispersal": 0.20},
    {"ride_id": "roaring", "ride_name": "雷鸣山漂流", "popularity": 1.05, "dispersal": 0.30},
    {"ride_id": "seven_dwarfs", "ride_name": "七个小矮人矿山车", "popularity": 1.10, "dispersal": 0.18},
    {"ride_id": "buzz", "ride_name": "巴斯光年星际营救", "popularity": 0.85, "dispersal": 0.35},
    {"ride_id": "dumbo", "ride_name": "小飞象", "popularity": 0.70, "dispersal": 0.40},
    {"ride_id": "rot", "ride_name": "漫威英雄总部：钢铁侠飞行器", "popularity": 1.25, "dispersal": 0.22},
]


def school_vacation_info(d: date) -> tuple[int, str | None]:
    if d.month in (7, 8):
        return 1, "summer"
    if (d.month == 1 and d.day >= 15) or (d.month == 2 and d.day <= 20):
        return 1, "winter"
    return 0, None


def fetch_weather(start: date, end: date) -> pd.DataFrame:
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": WEATHER_LAT,
        "longitude": WEATHER_LON,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "temperature_2m_mean,precipitation_sum,windspeed_10m_max",
        "timezone": "Asia/Shanghai",
    }
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    payload = resp.json()["daily"]
    return pd.DataFrame(
        {
            "date": pd.to_datetime(payload["time"]),
            "temperature_c": payload["temperature_2m_mean"],
            "precipitation_mm": payload["precipitation_sum"],
            "wind_speed_kmh": payload["windspeed_10m_max"],
        }
    )


def synthesize(
    start: date,
    end: date,
    seed: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    weather = fetch_weather(start, end)

    daily_rows: list[dict] = []
    ride_rows: list[dict] = []
    scraped_at = datetime.now(timezone.utc).isoformat()

    for _, w in weather.iterrows():
        d = w["date"].date()
        weekday = d.weekday()
        is_weekend = int(weekday >= 5)
        is_holiday = int(cc.is_holiday(d))
        is_vac, vac_type = school_vacation_info(d)
        temp = float(w["temperature_c"] if pd.notna(w["temperature_c"]) else 22.0)
        precip = float(w["precipitation_mm"] if pd.notna(w["precipitation_mm"]) else 0.0)
        wind = float(w["wind_speed_kmh"] if pd.notna(w["wind_speed_kmh"]) else 10.0)

        # 园区整体人流：节假日/周末/寒暑假推高；降雨/大风略降
        base = 38.0
        base += 22.0 * is_holiday
        base += 14.0 * is_weekend * (1 - is_holiday)
        base += 10.0 * is_vac
        base += 0.35 * max(0.0, 28.0 - abs(temp - 24.0))
        base -= min(18.0, precip * 1.8)
        base -= max(0.0, (wind - 25.0) * 0.35)
        # 月度季节性
        base += 6.0 * np.sin(2 * np.pi * (d.timetuple().tm_yday / 365.0))
        daily_crowd = float(np.clip(base + rng.normal(0, 4.5), 5.0, 98.0))

        # 关键逻辑：节假日人多，但热门项目因分流/预约，排队增幅弱于人流增幅
        holiday_crowd_boost = 1.0 + 0.45 * is_holiday + 0.25 * is_weekend
        holiday_queue_boost = 1.0 + 0.18 * is_holiday + 0.20 * is_weekend  # 人流≠排队

        for hour in range(9, 22):
            # 日内人流曲线
            hour_factor = {
                9: 0.55, 10: 0.75, 11: 0.95, 12: 1.05, 13: 1.10,
                14: 1.15, 15: 1.20, 16: 1.15, 17: 1.05, 18: 0.95,
                19: 0.85, 20: 0.70, 21: 0.50,
            }[hour]
            crowd_h = float(np.clip(daily_crowd * hour_factor + rng.normal(0, 2.0), 0, 100))
            rain_hour_pen = 0.85 if precip >= 5 and hour in (13, 14, 15, 16) else 1.0

            daily_rows.append(
                {
                    "date": d.isoformat(),
                    "hour": hour,
                    "crowd_index": round(crowd_h * rain_hour_pen, 2),
                    "operating_rides": 45 + int(rng.integers(-2, 3)),
                    "avg_wait_min": round(crowd_h * 0.7, 2),
                    "max_wait_min": round(crowd_h * 1.4, 2),
                    "park_open_time": f"{d.isoformat()}T09:00:00+08:00",
                    "park_close_time": f"{d.isoformat()}T21:00:00+08:00",
                    "park_status": "OPERATING",
                    "temperature_c": round(temp + rng.normal(0, 0.8), 2),
                    "precipitation_mm": round(precip, 2),
                    "wind_speed_kmh": round(wind + rng.normal(0, 1.0), 2),
                    "is_holiday": is_holiday,
                    "is_weekend": is_weekend,
                    "is_school_vacation": is_vac,
                    "school_vacation_type": vac_type,
                    "scraped_at": scraped_at,
                }
            )

            for ride in RIDES:
                # 排队：项目热度 × 时段 ×（弱于人流的节假日增幅）+ 分流项
                slot = hour_factor
                wait = (
                    12.0
                    * ride["popularity"]
                    * slot
                    * holiday_queue_boost
                    * (1.0 - ride["dispersal"] * is_holiday)  # 节假日分流压低相对排队
                    * (0.75 if precip >= 8 else 1.0)
                )
                wait += rng.normal(0, 4.0)
                # 人流高但该项目分流强时，可出现「人多但该项不堵」
                if is_holiday and ride["dispersal"] > 0.3:
                    wait *= 0.85
                wait = float(np.clip(wait, 0, 180))
                ride_rows.append(
                    {
                        "date": d.isoformat(),
                        "hour": hour,
                        "ride_id": ride["ride_id"],
                        "ride_name": ride["ride_name"],
                        "entity_type": "ATTRACTION",
                        "wait_time_min": int(round(wait)),
                        "single_rider_min": int(round(wait * 0.45)) if ride["popularity"] > 1.0 else None,
                        "status": "OPERATING",
                        "last_updated": f"{d.isoformat()}T{hour:02d}:00:00+08:00",
                        "scraped_at": scraped_at,
                        "temperature_c": round(temp, 2),
                        "precipitation_mm": round(precip, 2),
                        "wind_speed_kmh": round(wind, 2),
                        "is_holiday": is_holiday,
                        "is_weekend": is_weekend,
                        "is_school_vacation": is_vac,
                        "school_vacation_type": vac_type,
                        # 辅助字段：当日整体人流，便于验证「人流≠排队」
                        "park_crowd_index_day": round(daily_crowd, 2),
                    }
                )

    return pd.DataFrame(daily_rows), pd.DataFrame(ride_rows)


def export_csvs(
    start: date | None = None,
    end: date | None = None,
    out_dir: Path | None = None,
) -> tuple[Path, Path]:
    out = out_dir or DATA_RAW
    out.mkdir(parents=True, exist_ok=True)
    end = end or (date.today() - timedelta(days=1))
    start = start or (end - timedelta(days=540))  # ~18 个月

    daily, rides = synthesize(start, end)
    # 拆成两个文件模拟「全部历史 CSV」
    mid = start + (end - start) / 2
    mid_s = mid.date().isoformat() if hasattr(mid, "date") else str(mid)[:10]

    daily["date_ts"] = pd.to_datetime(daily["date"])
    rides["date_ts"] = pd.to_datetime(rides["date"])
    cut = pd.Timestamp(mid_s)

    p1 = out / f"daily_total_{start.isoformat()}_{mid_s}.csv"
    p2 = out / f"daily_total_{mid_s}_{end.isoformat()}.csv"
    r1 = out / f"ride_queue_{start.isoformat()}_{mid_s}.csv"
    r2 = out / f"ride_queue_{mid_s}_{end.isoformat()}.csv"

    daily.loc[daily["date_ts"] < cut].drop(columns=["date_ts"]).to_csv(p1, index=False)
    daily.loc[daily["date_ts"] >= cut].drop(columns=["date_ts"]).to_csv(p2, index=False)
    rides.loc[rides["date_ts"] < cut].drop(columns=["date_ts"]).to_csv(r1, index=False)
    rides.loc[rides["date_ts"] >= cut].drop(columns=["date_ts"]).to_csv(r2, index=False)

    # 汇总清单
    manifest = out / "dataset_manifest.txt"
    manifest.write_text(
        "\n".join(
            [
                f"generated_at={datetime.now().isoformat()}",
                f"weather_source=Open-Meteo archive ({WEATHER_LAT},{WEATHER_LON})",
                f"crowd_queue_source=synthetic_aligned_to_scraper_schema",
                f"date_range={start.isoformat()} .. {end.isoformat()}",
                f"files={p1.name},{p2.name},{r1.name},{r2.name}",
                "note=Replace with scraped CSVs when available; pipeline auto-loads all *.csv",
            ]
        ),
        encoding="utf-8",
    )
    return out, manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="生成上海迪士尼历史训练 CSV")
    parser.add_argument("--start", type=str, default=None)
    parser.add_argument("--end", type=str, default=None)
    parser.add_argument("--out", type=Path, default=DATA_RAW)
    args = parser.parse_args()
    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None
    out, manifest = export_csvs(start, end, args.out)
    print(f"CSV 已写入: {out}")
    print(f"清单: {manifest}")


if __name__ == "__main__":
    main()
