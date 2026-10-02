"""加载已保存模型，分别输出人流推荐日与单项目分时排队。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml_pipeline.train import predict_only


def main() -> None:
    parser = argparse.ArgumentParser(description="分别输出模型 A 人流预测 与 模型 B 排队预测")
    parser.add_argument("--ride", type=str, default=None)
    args = parser.parse_args()
    predict_only(args.ride)


if __name__ == "__main__":
    main()
