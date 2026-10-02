"""完整流水线入口：清洗 → 特征 → 训练 A/B → 评估 → 预测 → 保存。

人流量低 ≠ 排队短：两套模型独立训练、独立输出。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml_pipeline.data_loader import discover_csv_inventory, load_all_datasets
from ml_pipeline.features import build_y1_dataset, build_y2_dataset
from ml_pipeline.generate_history_csv import export_csvs
from ml_pipeline.model_a_xgboost import CrowdXGBoostModel, recommend_low_crowd_dates
from ml_pipeline.model_b_lstm import RideWaitLSTMModel

DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
ARTIFACT_DIR = ROOT / "models" / "artifacts"


def ensure_datasets(force_generate: bool = False) -> dict:
    inventory = discover_csv_inventory(DATA_RAW)
    has_daily = bool(inventory["daily"])
    has_ride = bool(inventory["ride"])
    if force_generate or not (has_daily and has_ride):
        print("本地无完整历史 CSV（或 --force-generate），正在生成训练数据…")
        export_csvs(out_dir=DATA_RAW)
        inventory = discover_csv_inventory(DATA_RAW)
    print("发现 CSV:", json.dumps(inventory, ensure_ascii=False, indent=2))
    return inventory


def run_pipeline(
    ride_name: str | None = None,
    force_generate: bool = False,
    lstm_epochs: int = 10,
) -> dict:
    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    ensure_datasets(force_generate=force_generate)
    daily_raw, ride_raw = load_all_datasets(DATA_RAW)

    if daily_raw.empty or ride_raw.empty:
        raise RuntimeError("未能加载日常人流或项目排队数据")

    print(f"原始 daily 行数={len(daily_raw)}, ride 行数={len(ride_raw)}")

    # ------------------------------------------------------------------
    # y1：园区整体人流量指数
    # ------------------------------------------------------------------
    print("\n=== 模型 A：XGBoost / y1=当日园区整体人流量指数 ===")
    X1, y1, feat1 = build_y1_dataset(daily_raw)
    print(f"y1 样本数={len(y1)}, 特征={feat1}")
    model_a = CrowdXGBoostModel(feat1)
    metrics_a = model_a.fit(X1, y1)
    print("模型 A 评估:", metrics_a)
    path_a = model_a.save(ARTIFACT_DIR)
    print(f"模型 A 已保存: {path_a}")

    forecast_a = model_a.forecast_next_30_days()
    low_crowd = recommend_low_crowd_dates(forecast_a, top_n=5)
    forecast_a.to_csv(DATA_PROCESSED / "pred_a_crowd_next_30d.csv", index=False)
    low_crowd.to_csv(DATA_PROCESSED / "pred_a_low_crowd_recommend.csv", index=False)

    # ------------------------------------------------------------------
    # y2：单项目分时排队（独立于人流）
    # ------------------------------------------------------------------
    print("\n=== 模型 B：LSTM / y2=单个游乐项目分时排队时长 ===")
    # 日级气象供 ride 表合并
    weather_daily = (
        X1[["date", "temperature_c", "precipitation_mm", "wind_speed_kmh"]]
        .drop_duplicates("date")
        .copy()
    )
    X2, y2, feat2, ride_map = build_y2_dataset(
        ride_raw, weather_daily=weather_daily, ride_name=ride_name
    )
    print(f"y2 样本数={len(y2)}, 项目数={len(ride_map)}, 特征={feat2}")
    if ride_name is None:
        # 默认挑一个热门项目做示范预测；训练仍用全量多项目
        default_ride = next(iter(ride_map))
        # 若有创极速光轮优先
        for name in ride_map:
            if "创极速" in name or "光轮" in name:
                default_ride = name
                break
    else:
        default_ride = ride_name

    model_b = RideWaitLSTMModel(feat2, ride_map, seq_len=24, epochs=lstm_epochs)
    metrics_b = model_b.fit(X2, y2)
    print("模型 B 评估:", metrics_b)
    path_b = model_b.save(ARTIFACT_DIR)
    print(f"模型 B 已保存: {path_b}")

    forecast_b = model_b.predict_ride_horizon(default_ride, horizon_steps=13)
    forecast_b.to_csv(
        DATA_PROCESSED / f"pred_b_wait_{default_ride.replace('/', '_')}.csv",
        index=False,
    )

    # ------------------------------------------------------------------
    # 区分逻辑说明输出
    # ------------------------------------------------------------------
    summary = {
        "logic": {
            "y1": "当日园区整体人流量指数（XGBoost，未来30天，用于推荐低人流日期）",
            "y2": "单个游乐项目分时排队时长（LSTM，与 y1 独立）",
            "note": (
                "人流量低≠排队短：节假日人流上升时，热门项目可能因分流/预约导致排队增幅弱于人流；"
                "两套预测结果分开落盘，禁止用 y1 直接替代 y2。"
            ),
        },
        "features": {
            "time": ["month", "week", "weekday", "is_holiday", "is_school_vacation", "hour/slot"],
            "weather": ["temperature_c", "precipitation_mm", "wind_speed_kmh"],
        },
        "model_a_metrics": metrics_a,
        "model_b_metrics": metrics_b,
        "model_a_artifact": str(path_a),
        "model_b_artifact": str(path_b),
        "pred_a_30d": str(DATA_PROCESSED / "pred_a_crowd_next_30d.csv"),
        "pred_a_low_crowd": str(DATA_PROCESSED / "pred_a_low_crowd_recommend.csv"),
        "pred_b_ride": default_ride,
        "pred_b_file": str(
            DATA_PROCESSED / f"pred_b_wait_{default_ride.replace('/', '_')}.csv"
        ),
        "low_crowd_top5": low_crowd.to_dict(orient="records"),
        "wait_sample": forecast_b.head(5).to_dict(orient="records"),
    }
    summary_path = DATA_PROCESSED / "pipeline_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== 低人流日期推荐（模型 A，≠短排队承诺）===")
    print(low_crowd.to_string(index=False))
    print(f"\n=== 项目分时排队预测样例（模型 B / {default_ride}）===")
    print(forecast_b.head(8).to_string(index=False))
    print(f"\n摘要已写入: {summary_path}")
    return summary


def predict_only(ride_name: str | None = None) -> None:
    model_a = CrowdXGBoostModel.load(ARTIFACT_DIR)
    model_b = RideWaitLSTMModel.load(ARTIFACT_DIR)
    forecast_a = model_a.forecast_next_30_days()
    low = recommend_low_crowd_dates(forecast_a)
    ride = ride_name or next(iter(model_b.ride_map))
    if ride_name is None:
        for name in model_b.ride_map:
            if "创极速" in name or "光轮" in name:
                ride = name
                break
    forecast_b = model_b.predict_ride_horizon(ride)
    print("【人流预测 A】低人流推荐日:")
    print(low.to_string(index=False))
    print(f"\n【排队预测 B】{ride}:")
    print(forecast_b.to_string(index=False))
    print("\n提醒: 上述两套结果独立，低人流日不保证该项目排队短。")


def main() -> None:
    parser = argparse.ArgumentParser(description="上海迪士尼双模型预测流水线")
    parser.add_argument("--ride", type=str, default=None, help="仅训练/预测指定项目（默认全项目训练）")
    parser.add_argument("--force-generate", action="store_true", help="强制重新生成历史 CSV")
    parser.add_argument("--epochs", type=int, default=10, help="LSTM 训练轮数")
    parser.add_argument("--predict-only", action="store_true", help="仅加载已保存模型做预测")
    args = parser.parse_args()

    if args.predict_only:
        predict_only(args.ride)
    else:
        run_pipeline(ride_name=args.ride, force_generate=args.force_generate, lstm_epochs=args.epochs)


if __name__ == "__main__":
    main()
