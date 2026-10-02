"""从本地全部迪士尼 CSV / SQLite 加载原始数据。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = ROOT / "data" / "raw"
DEFAULT_DB = ROOT / "shanghai_disneyland.db"

DAILY_PATTERNS = ("daily_total*.csv", "*daily*.csv", "*crowd*.csv", "*人流*.csv")
RIDE_PATTERNS = ("ride_queue*.csv", "*ride*.csv", "*queue*.csv", "*wait*.csv", "*排队*.csv")


def _glob_csvs(patterns: tuple[str, ...], directory: Path) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    if not directory.exists():
        return files
    for pattern in patterns:
        for path in sorted(directory.glob(pattern)):
            if path.is_file() and path not in seen:
                files.append(path)
                seen.add(path)
    return files


def _read_csv_safe(path: Path) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "gbk"):
        try:
            return pd.read_csv(path, encoding=enc)
        except UnicodeDecodeError:
            continue
    return pd.read_csv(path)


def load_all_daily_csvs(data_dir: Path | None = None) -> pd.DataFrame:
    """读取本地全部园区人流相关 CSV 并纵向合并。"""
    directory = data_dir or DATA_RAW
    frames: list[pd.DataFrame] = []
    for path in _glob_csvs(DAILY_PATTERNS, directory):
        df = _read_csv_safe(path)
        df["source_file"] = path.name
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def load_all_ride_csvs(data_dir: Path | None = None) -> pd.DataFrame:
    """读取本地全部项目排队相关 CSV 并纵向合并。"""
    directory = data_dir or DATA_RAW
    frames: list[pd.DataFrame] = []
    for path in _glob_csvs(RIDE_PATTERNS, directory):
        # 避免把 daily 文件误读入 ride
        name = path.name.lower()
        if "daily" in name or "crowd" in name or "人流" in name:
            continue
        df = _read_csv_safe(path)
        df["source_file"] = path.name
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def load_from_sqlite(db_path: Path | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    path = db_path or DEFAULT_DB
    if not path.exists():
        return pd.DataFrame(), pd.DataFrame()
    conn = sqlite3.connect(path)
    try:
        daily = pd.read_sql_query("SELECT * FROM daily_total", conn)
        rides = pd.read_sql_query("SELECT * FROM ride_queue", conn)
    except Exception:
        daily, rides = pd.DataFrame(), pd.DataFrame()
    finally:
        conn.close()
    if not daily.empty:
        daily["source_file"] = path.name
    if not rides.empty:
        rides["source_file"] = path.name
    return daily, rides


def load_all_datasets(
    data_dir: Path | None = None,
    db_path: Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """合并 CSV + SQLite；CSV 优先，库作为补充。"""
    daily = load_all_daily_csvs(data_dir)
    rides = load_all_ride_csvs(data_dir)
    db_daily, db_rides = load_from_sqlite(db_path)

    if not db_daily.empty:
        daily = pd.concat([daily, db_daily], ignore_index=True) if not daily.empty else db_daily
    if not db_rides.empty:
        rides = pd.concat([rides, db_rides], ignore_index=True) if not rides.empty else db_rides

    return daily, rides


def discover_csv_inventory(data_dir: Path | None = None) -> dict[str, list[str]]:
    directory = data_dir or DATA_RAW
    return {
        "daily": [p.name for p in _glob_csvs(DAILY_PATTERNS, directory)],
        "ride": [
            p.name
            for p in _glob_csvs(RIDE_PATTERNS, directory)
            if "daily" not in p.name.lower() and "crowd" not in p.name.lower()
        ],
        "all_csv": [p.name for p in sorted(directory.glob("*.csv"))] if directory.exists() else [],
    }
