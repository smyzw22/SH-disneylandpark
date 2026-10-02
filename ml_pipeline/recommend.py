"""游玩推荐算法：综合模型 A（人流）与模型 B（排队），输出最优日期 + 分时路线。

优先级：
  1. 园区预测人流量最低
  2. 热门项目平均预测排队时长最短
冲突：人流量低但热门排队久 → 标注说明（分流/预约/聚集）
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml_pipeline.model_a_xgboost import CrowdXGBoostModel
from ml_pipeline.model_b_lstm import RideWaitLSTMModel

ARTIFACT_DIR = ROOT / "models" / "artifacts"
DATA_PROCESSED = ROOT / "data" / "processed"

# 热门 / 冷门分类（与训练数据 popularity 对齐）
HOT_RIDES = [
    "创极速光轮",
    "漫威英雄总部：钢铁侠飞行器",
    "加勒比海盗——沉落宝藏之战",
    "翱翔·飞越地平线",
    "七个小矮人矿山车",
]
COLD_RIDES = [
    "巴斯光年星际营救",
    "小飞象",
]
MEDIUM_RIDES = [
    "雷鸣山漂流",
]

PARK_HOURS = list(range(9, 22))

TIME_SLOTS = [
    {"id": "morning", "label": "早场 09:00-11:59", "hours": (9, 12)},
    {"id": "midday", "label": "午峰 12:00-14:59", "hours": (12, 15)},
    {"id": "afternoon", "label": "下午 15:00-16:59", "hours": (15, 17)},
    {"id": "evening", "label": "傍晚 17:00-21:00", "hours": (17, 22)},
]

CONFLICT_CROWD_TOP_PCT = 0.35   # 人流处于区间内较低分位
CONFLICT_WAIT_BOTTOM_PCT = 0.65  # 热门排队处于区间内较高分位


@dataclass
class DailyPlan:
    date: str
    rank: int
    predicted_crowd_index: float
    crowd_rank: int
    hot_ride_avg_wait_min: float
    wait_rank: int
    composite_score: float
    conflict: bool
    conflict_note: str | None
    time_slot_advice: list[dict[str, Any]] = field(default_factory=list)
    play_route: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class VisitRecommendation:
    start_date: str
    end_date: str
    best_date: str
    date_rankings: list[dict[str, Any]]
    daily_plans: dict[str, dict[str, Any]]
    summary: str


def _ride_tier(ride_name: str) -> str:
    if ride_name in HOT_RIDES:
        return "hot"
    if ride_name in COLD_RIDES:
        return "cold"
    return "medium"


def _weather_from_row(row: pd.Series) -> dict[str, float]:
    return {
        "temperature_c": float(row.get("temperature_c", 22.0)),
        "precipitation_mm": float(row.get("precipitation_mm", 0.0)),
        "wind_speed_kmh": float(row.get("wind_speed_kmh", 10.0)),
    }


def _predict_waits_for_day(
    model_b: RideWaitLSTMModel,
    target_date: date,
    weather: dict[str, float],
    ride_names: list[str],
) -> pd.DataFrame:
    """返回 columns: date, hour, ride_name, predicted_wait_min, tier"""
    frames: list[pd.DataFrame] = []
    available = [r for r in ride_names if r in model_b.ride_map]
    for ride in available:
        pred = model_b.predict_ride_day(ride, target_date, weather)
        pred["tier"] = _ride_tier(ride)
        frames.append(pred)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _hot_avg_wait(wait_df: pd.DataFrame) -> float:
    hot = wait_df[wait_df["tier"] == "hot"]
    if hot.empty:
        return float(wait_df["predicted_wait_min"].mean())
    return float(hot["predicted_wait_min"].mean())


def _detect_conflict(
    crowd_index: float,
    hot_avg_wait: float,
    crowd_values: np.ndarray,
    wait_values: np.ndarray,
) -> tuple[bool, str | None]:
    if len(crowd_values) < 2:
        return False, None
    crowd_pct = float(np.mean(crowd_values <= crowd_index))
    wait_pct = float(np.mean(wait_values <= hot_avg_wait))
    if crowd_pct <= CONFLICT_CROWD_TOP_PCT and wait_pct >= CONFLICT_WAIT_BOTTOM_PCT:
        return True, (
            "⚠ 冲突提示：该日园区预测人流量偏低，但热门项目平均排队仍偏长。"
            "可能原因：客流分散至演出/购物、预约制分流、或个别爆款项目独立聚集。"
            "建议按下方分时路线早场冲热门、午峰改玩冷门，勿仅凭低人流判断全园短排队。"
        )
    return False, None


def _build_time_slot_advice(wait_df: pd.DataFrame) -> list[dict[str, Any]]:
    """每日分时段避峰建议。"""
    advice: list[dict[str, Any]] = []
    if wait_df.empty:
        return advice

    slot_stats: list[dict[str, Any]] = []
    for slot in TIME_SLOTS:
        lo, hi = slot["hours"]
        sub = wait_df[(wait_df["hour"] >= lo) & (wait_df["hour"] < hi)]
        if sub.empty:
            continue
        hot_sub = sub[sub["tier"] == "hot"]
        hot_avg = float(hot_sub["predicted_wait_min"].mean()) if not hot_sub.empty else float(sub["predicted_wait_min"].mean())
        cold_sub = sub[sub["tier"] == "cold"]
        cold_avg = float(cold_sub["predicted_wait_min"].mean()) if not cold_sub.empty else None
        slot_stats.append(
            {
                "slot_id": slot["id"],
                "slot_label": slot["label"],
                "hot_avg_wait": round(hot_avg, 1),
                "cold_avg_wait": round(cold_avg, 1) if cold_avg is not None else None,
            }
        )

    if not slot_stats:
        return advice

    hot_waits = [s["hot_avg_wait"] for s in slot_stats]
    min_hot = min(hot_waits)
    max_hot = max(hot_waits)

    for s in slot_stats:
        hot = s["hot_avg_wait"]
        if hot <= min_hot + 1.5:
            peak_level = "低峰"
            suggestion = "冲热门项目最佳窗口，优先游玩创极速光轮、翱翔·飞越地平线等。"
        elif hot >= max_hot - 1.5:
            peak_level = "高峰"
            suggestion = "避峰时段：热门排队较长，建议改玩巴斯光年、小飞象等冷门，或看演出休息。"
        else:
            peak_level = "平峰"
            suggestion = "可穿插中等热度项目；若热门已刷完，可补刷遗漏项目。"

        advice.append(
            {
                "slot": s["slot_label"],
                "peak_level": peak_level,
                "hot_avg_wait_min": hot,
                "cold_avg_wait_min": s["cold_avg_wait"],
                "suggestion": suggestion,
            }
        )
    return advice


def _build_play_route(wait_df: pd.DataFrame, target_date: str) -> list[dict[str, Any]]:
    """
    冷热分流游玩顺序：早场热门 → 午峰冷门 → 下午补热门 → 傍晚冷门/中等。
    按小时顺序输出，每小时最多 1 个项目。
    """
    route: list[dict[str, Any]] = []
    if wait_df.empty:
        return route

    used_rides: set[str] = set()

    def best_ride(tier: str, hour: int, exclude: set[str] | None = None) -> str | None:
        exclude = exclude or set()
        sub = wait_df[(wait_df["tier"] == tier) & (wait_df["hour"] == hour)]
        sub = sub[~sub["ride_name"].isin(exclude | used_rides)].sort_values("predicted_wait_min")
        if sub.empty:
            return None
        return str(sub.iloc[0]["ride_name"])

    def append_step(hour: int, ride: str, reason: str) -> None:
        row = wait_df[(wait_df["ride_name"] == ride) & (wait_df["hour"] == hour)]
        wait = float(row["predicted_wait_min"].iloc[0]) if not row.empty else None
        used_rides.add(ride)
        route.append(
            {
                "time": f"{target_date} {hour:02d}:00",
                "hour": hour,
                "ride_name": ride,
                "tier": _ride_tier(ride),
                "predicted_wait_min": round(wait, 1) if wait is not None else None,
                "reason": reason,
            }
        )

    schedule: list[tuple[int, str, str, tuple[str, ...]]] = [
        (9, "hot", "早场开园，优先冲排队最短热门", ("hot",)),
        (10, "hot", "早场续刷热门", ("hot",)),
        (11, "hot", "早场收尾热门", ("hot", "medium")),
        (12, "cold", "午峰避热门，冷门分流", ("cold", "medium")),
        (13, "cold", "午峰继续冷门/中等", ("cold", "medium")),
        (14, "cold", "午峰末尾，避开热门峰值", ("cold", "medium", "hot")),
        (15, "hot", "下午窗口补刷热门", ("hot", "medium")),
        (16, "hot", "下午补刷次热门", ("hot", "medium")),
        (17, "cold", "傍晚优先短排队冷门", ("cold", "medium")),
        (18, "medium", "傍晚中等热度", ("medium", "cold", "hot")),
        (19, "cold", "闭园前收尾", ("cold", "medium")),
    ]

    for hour, _, reason, tier_order in schedule:
        ride = None
        for tier in tier_order:
            ride = best_ride(tier, hour)
            if ride:
                break
        if ride:
            append_step(hour, ride, reason)

    return route


def _rank_dates(crowd_df: pd.DataFrame, wait_summary: pd.DataFrame) -> pd.DataFrame:
    """
    双优先级排序：先 crowd_rank，再 wait_rank（字典序）。
    composite_score 仅供展示（越小越好）。
    """
    merged = crowd_df.merge(wait_summary, on="date", how="left")
    merged["hot_ride_avg_wait_min"] = merged["hot_ride_avg_wait_min"].fillna(
        merged["hot_ride_avg_wait_min"].median()
    )
    merged["crowd_rank"] = merged["predicted_crowd_index"].rank(method="min").astype(int)
    merged["wait_rank"] = merged["hot_ride_avg_wait_min"].rank(method="min").astype(int)
    # 归一化综合分（展示用）
    c_norm = (merged["predicted_crowd_index"] - merged["predicted_crowd_index"].min()) / (
        merged["predicted_crowd_index"].max() - merged["predicted_crowd_index"].min() + 1e-6
    )
    w_norm = (merged["hot_ride_avg_wait_min"] - merged["hot_ride_avg_wait_min"].min()) / (
        merged["hot_ride_avg_wait_min"].max() - merged["hot_ride_avg_wait_min"].min() + 1e-6
    )
    merged["composite_score"] = round(0.65 * c_norm + 0.35 * w_norm, 4)
    merged = merged.sort_values(["crowd_rank", "wait_rank", "composite_score"]).reset_index(drop=True)
    merged["rank"] = np.arange(1, len(merged) + 1)
    return merged


def recommend_visit_plan(
    start_date: date | str,
    end_date: date | str,
    *,
    model_a: CrowdXGBoostModel | None = None,
    model_b: RideWaitLSTMModel | None = None,
    top_n_routes: int = 3,
    save_json: Path | None = None,
) -> VisitRecommendation:
    """
    输入起止日期，输出最优游玩日期 + 当日分时路线。

    Parameters
    ----------
    start_date, end_date : 推荐候选区间（含首尾）
    top_n_routes : 输出排名前 N 天的详细分时路线
    """
    start = date.fromisoformat(str(start_date)[:10])
    end = date.fromisoformat(str(end_date)[:10])
    if end < start:
        raise ValueError("end_date 不能早于 start_date")

    model_a = model_a or CrowdXGBoostModel.load(ARTIFACT_DIR)
    model_b = model_b or RideWaitLSTMModel.load(ARTIFACT_DIR)

    all_rides = list(model_b.ride_map.keys())
    hot_available = [r for r in HOT_RIDES if r in model_b.ride_map]

    # 模型 A：区间人流
    crowd_df = model_a.forecast_date_range(start, end)
    crowd_df["date"] = crowd_df["date"].astype(str)

    # 模型 B：逐日热门平均排队
    wait_rows: list[dict] = []
    wait_by_date: dict[str, pd.DataFrame] = {}
    for _, crow in crowd_df.iterrows():
        d = date.fromisoformat(crow["date"])
        weather = _weather_from_row(crow)
        wdf = _predict_waits_for_day(model_b, d, weather, all_rides)
        wait_by_date[crow["date"]] = wdf
        wait_rows.append(
            {
                "date": crow["date"],
                "hot_ride_avg_wait_min": round(_hot_avg_wait(wdf), 2) if not wdf.empty else np.nan,
            }
        )
    wait_summary = pd.DataFrame(wait_rows)

    ranked = _rank_dates(crowd_df, wait_summary)
    crowd_arr = ranked["predicted_crowd_index"].to_numpy(dtype=float)
    wait_arr = ranked["hot_ride_avg_wait_min"].to_numpy(dtype=float)

    date_rankings: list[dict[str, Any]] = []
    daily_plans: dict[str, dict[str, Any]] = {}

    for _, row in ranked.iterrows():
        d_str = row["date"]
        conflict, note = _detect_conflict(
            float(row["predicted_crowd_index"]),
            float(row["hot_ride_avg_wait_min"]),
            crowd_arr,
            wait_arr,
        )
        entry = {
            "rank": int(row["rank"]),
            "date": d_str,
            "predicted_crowd_index": float(row["predicted_crowd_index"]),
            "crowd_rank": int(row["crowd_rank"]),
            "hot_ride_avg_wait_min": float(row["hot_ride_avg_wait_min"]),
            "wait_rank": int(row["wait_rank"]),
            "composite_score": float(row["composite_score"]),
            "is_holiday": int(row.get("is_holiday", 0)),
            "is_weekend": int(row.get("is_weekend", 0)),
            "conflict": conflict,
            "conflict_note": note,
        }
        date_rankings.append(entry)

        if int(row["rank"]) <= top_n_routes:
            wdf = wait_by_date.get(d_str, pd.DataFrame())
            plan = DailyPlan(
                date=d_str,
                rank=int(row["rank"]),
                predicted_crowd_index=float(row["predicted_crowd_index"]),
                crowd_rank=int(row["crowd_rank"]),
                hot_ride_avg_wait_min=float(row["hot_ride_avg_wait_min"]),
                wait_rank=int(row["wait_rank"]),
                composite_score=float(row["composite_score"]),
                conflict=conflict,
                conflict_note=note,
                time_slot_advice=_build_time_slot_advice(wdf),
                play_route=_build_play_route(wdf, d_str),
            )
            daily_plans[d_str] = asdict(plan)

    best = date_rankings[0]["date"]
    summary = (
        f"区间 {start.isoformat()} ~ {end.isoformat()} 共 {len(date_rankings)} 天；"
        f"最优日期 {best}（人流排名 #{date_rankings[0]['crowd_rank']}，"
        f"热门均排 {date_rankings[0]['hot_ride_avg_wait_min']:.1f} 分钟）。"
    )
    if date_rankings[0].get("conflict"):
        summary += " 注意：存在「低人流但热门仍堵」冲突，请结合分时路线。"

    result = VisitRecommendation(
        start_date=start.isoformat(),
        end_date=end.isoformat(),
        best_date=best,
        date_rankings=date_rankings,
        daily_plans=daily_plans,
        summary=summary,
    )

    if save_json:
        save_json.parent.mkdir(parents=True, exist_ok=True)
        save_json.write_text(
            json.dumps(asdict(result), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return result


def format_recommendation(rec: VisitRecommendation) -> str:
    """人类可读文本摘要。"""
    lines = [
        "=" * 60,
        "上海迪士尼 · 游玩推荐",
        rec.summary,
        "=" * 60,
        "",
        "【日期排名】优先级1=人流低 → 优先级2=热门排队短",
        "-" * 60,
    ]
    for d in rec.date_rankings[:10]:
        flag = " ⚠" if d.get("conflict") else ""
        lines.append(
            f"#{d['rank']:>2} {d['date']}  人流={d['predicted_crowd_index']:.1f}(#{d['crowd_rank']})  "
            f"热门均排={d['hot_ride_avg_wait_min']:.1f}min(#{d['wait_rank']}){flag}"
        )
        if d.get("conflict_note"):
            lines.append(f"    {d['conflict_note']}")

    for d_str, plan in rec.daily_plans.items():
        lines.extend(["", f"【TOP 日期详情】{d_str} (总排名 #{plan['rank']})", "-" * 40])
        if plan.get("conflict_note"):
            lines.append(plan["conflict_note"])
        lines.append("分时段避峰：")
        for slot in plan.get("time_slot_advice", []):
            lines.append(
                f"  · {slot['slot']} [{slot['peak_level']}] "
                f"热门均排{slot['hot_avg_wait_min']}min → {slot['suggestion']}"
            )
        lines.append("冷热分流路线：")
        for step in plan.get("play_route", []):
            lines.append(
                f"  · {step['time']} [{step['tier']}] {step['ride_name']} "
                f"~{step['predicted_wait_min']}min | {step['reason']}"
            )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="上海迪士尼游玩推荐（人流+排队双模型）")
    parser.add_argument("--start", required=True, help="起始日期 YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="结束日期 YYYY-MM-DD")
    parser.add_argument("--top", type=int, default=3, help="输出详细路线的 TOP N 天")
    parser.add_argument(
        "--out",
        type=Path,
        default=DATA_PROCESSED / "visit_recommendation.json",
        help="JSON 输出路径",
    )
    args = parser.parse_args()

    rec = recommend_visit_plan(
        args.start,
        args.end,
        top_n_routes=args.top,
        save_json=args.out,
    )
    print(format_recommendation(rec))
    print(f"\nJSON 已保存: {args.out}")


if __name__ == "__main__":
    main()
