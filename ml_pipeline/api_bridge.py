#!/usr/bin/env python3
"""供 Node.js API 调用的 JSON 桥接脚本（stdout 输出纯 JSON）。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml_pipeline.model_a_xgboost import CrowdXGBoostModel
from ml_pipeline.model_b_lstm import RideWaitLSTMModel
from ml_pipeline.recommend import (
    _hot_avg_wait,
    _predict_waits_for_day,
    _weather_from_row,
    recommend_visit_plan,
)
from ml_pipeline.model_b_lstm import ARTIFACT_DIR as B_DIR
from ml_pipeline.model_a_xgboost import ARTIFACT_DIR as A_DIR


def cmd_predict(start: str, end: str) -> dict:
    rec = recommend_visit_plan(start, end, top_n_routes=min(5, (date.fromisoformat(end) - date.fromisoformat(start)).days + 1))
    low_crowd = [
        d for d in rec.date_rankings
        if d["crowd_rank"] <= min(5, len(rec.date_rankings))
    ][:5]
    return {
        "start": rec.start_date,
        "end": rec.end_date,
        "best_date": rec.best_date,
        "summary": rec.summary,
        "crowd_predictions": [
            {
                "date": d["date"],
                "predicted_crowd_index": d["predicted_crowd_index"],
                "crowd_rank": d["crowd_rank"],
                "is_holiday": d.get("is_holiday", 0),
                "is_weekend": d.get("is_weekend", 0),
            }
            for d in rec.date_rankings
        ],
        "wait_predictions": [
            {
                "date": d["date"],
                "hot_ride_avg_wait_min": d["hot_ride_avg_wait_min"],
                "wait_rank": d["wait_rank"],
            }
            for d in rec.date_rankings
        ],
        "date_rankings": rec.date_rankings,
        "low_crowd_recommendations": low_crowd,
        "note": "人流量低≠排队短；请结合 /api/suggest 查看分时路线。",
    }


def cmd_suggest(target: str) -> dict:
    rec = recommend_visit_plan(target, target, top_n_routes=1)
    plan = rec.daily_plans.get(target)
    ranking = next((d for d in rec.date_rankings if d["date"] == target), None)

    if not plan:
        model_a = CrowdXGBoostModel.load(A_DIR)
        model_b = RideWaitLSTMModel.load(B_DIR)
        crowd_df = model_a.forecast_date_range(date.fromisoformat(target), date.fromisoformat(target))
        row = crowd_df.iloc[0]
        weather = _weather_from_row(row)
        wdf = _predict_waits_for_day(model_b, date.fromisoformat(target), weather, list(model_b.ride_map.keys()))
        from ml_pipeline.recommend import _build_play_route, _build_time_slot_advice, _detect_conflict
        import numpy as np

        hot_avg = _hot_avg_wait(wdf)
        conflict, note = _detect_conflict(
            float(row["predicted_crowd_index"]),
            hot_avg,
            np.array([float(row["predicted_crowd_index"])]),
            np.array([hot_avg]),
        )
        plan = {
            "date": target,
            "predicted_crowd_index": float(row["predicted_crowd_index"]),
            "hot_ride_avg_wait_min": round(hot_avg, 2),
            "conflict": conflict,
            "conflict_note": note,
            "time_slot_advice": _build_time_slot_advice(wdf),
            "play_route": _build_play_route(wdf, target),
            "ride_waits_by_hour": wdf.to_dict(orient="records") if not wdf.empty else [],
        }
        ranking = ranking or {"date": target}

    return {
        "date": target,
        "ranking": ranking,
        "plan": plan,
        "note": "低人流日不保证热门项目短排队，请按 play_route 分时游玩。",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("predict")
    p1.add_argument("--start", required=True)
    p1.add_argument("--end", required=True)
    p2 = sub.add_parser("suggest")
    p2.add_argument("--date", required=True)
    args = parser.parse_args()

    if args.cmd == "predict":
        payload = cmd_predict(args.start, args.end)
    else:
        payload = cmd_suggest(args.date)

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
