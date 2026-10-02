#!/usr/bin/env python3
"""
上海迪士尼乐园 ThemeParks.wiki 异步爬虫

数据源:
  - 排队/状态: https://api.themeparks.wiki/v1/entity/{park_id}/live
  - 开闭园:   https://api.themeparks.wiki/v1/entity/{park_id}/schedule
  - 气温/降水: Open-Meteo（免费，无需 API Key）

用法:
  pip install -r requirements.txt
  python shanghai_disneyland_scraper.py              # 单次抓取
  python shanghai_disneyland_scraper.py --loop       # 每 5 分钟循环抓取
  python shanghai_disneyland_scraper.py --interval 600
  python shanghai_disneyland_scraper.py --backfill-days 7

可选环境变量:
  THEMEPARKS_API_KEY  免费密钥可把历史窗口扩展到约 30 天
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import logging
import os
import sqlite3
import ssl
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp
import aiosqlite
import certifi

try:
    import chinese_calendar as cc
except ImportError:
    cc = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

PARK_ALIASES = {
    "shanghai_disneyland": "ddc4357c-c148-4b36-9888-07894fe75e83",
    "shanghaidisneyresort": "6e1464ca-1e9b-49c3-8937-c5c6f6675057",
}

PARK_ID = PARK_ALIASES["shanghai_disneyland"]
PARK_NAME = "Shanghai Disneyland"
TIMEZONE = ZoneInfo("Asia/Shanghai")

API_BASE = "https://api.themeparks.wiki/v1"
WEATHER_LAT = 31.1433
WEATHER_LON = 121.6580

DEFAULT_DB = Path(__file__).resolve().parent / "shanghai_disneyland.db"
DEFAULT_INTERVAL_SEC = 300  # API 建议 live 数据最多 5 分钟刷新一次
MAX_RETRIES = 4
RETRY_BASE_DELAY = 2.0
USER_AGENT = "shanghai-disneyland-scraper/1.0 (+https://themeparks.wiki)"

# 客流指数：平均排队 90 分钟视为 100 分
CROWD_INDEX_MAX_WAIT = 90.0

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS daily_total (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,
    hour            INTEGER NOT NULL,
    crowd_index     REAL,
    operating_rides INTEGER,
    avg_wait_min    REAL,
    max_wait_min    REAL,
    park_open_time  TEXT,
    park_close_time TEXT,
    park_status     TEXT,
    temperature_c   REAL,
    precipitation_mm REAL,
    is_holiday      INTEGER NOT NULL DEFAULT 0,
    is_weekend      INTEGER NOT NULL DEFAULT 0,
    is_school_vacation INTEGER NOT NULL DEFAULT 0,
    school_vacation_type TEXT,
    scraped_at      TEXT    NOT NULL,
    UNIQUE(date, hour)
);

CREATE INDEX IF NOT EXISTS idx_daily_total_date ON daily_total(date);

CREATE TABLE IF NOT EXISTS ride_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,
    hour            INTEGER NOT NULL,
    ride_id         TEXT    NOT NULL,
    ride_name       TEXT    NOT NULL,
    entity_type     TEXT    NOT NULL,
    wait_time_min   INTEGER,
    single_rider_min INTEGER,
    status          TEXT    NOT NULL,
    last_updated    TEXT,
    scraped_at      TEXT    NOT NULL,
    UNIQUE(date, hour, ride_id)
);

CREATE INDEX IF NOT EXISTS idx_ride_queue_date_hour ON ride_queue(date, hour);
CREATE INDEX IF NOT EXISTS idx_ride_queue_ride ON ride_queue(ride_id);
"""

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("shanghai_disneyland")


# ---------------------------------------------------------------------------
# 外部关联字段
# ---------------------------------------------------------------------------


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def is_public_holiday(d: date) -> bool:
    if cc is None:
        log.warning("未安装 chinese-calendar，法定节假日标记将恒为 0")
        return False
    return bool(cc.is_holiday(d))


def school_vacation_info(d: date) -> tuple[bool, str | None]:
    """寒暑假近似规则（各地略有差异，可按需调整）。"""
    if d.month in (7, 8):
        return True, "summer"
    if (d.month == 1 and d.day >= 15) or (d.month == 2 and d.day <= 20):
        return True, "winter"
    return False, None


# ---------------------------------------------------------------------------
# HTTP 客户端（重试 + 429）
# ---------------------------------------------------------------------------


class RetryableHTTPError(Exception):
    def __init__(self, status: int, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    *,
    params: dict[str, Any] | None = None,
) -> Any:
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 429:
                    retry_after = float(resp.headers.get("Retry-After", RETRY_BASE_DELAY * (2**attempt)))
                    if attempt + 1 >= MAX_RETRIES:
                        raise RetryableHTTPError(429, f"Rate limited: {url}", retry_after)
                    log.warning("429 限流，%ss 后重试 (%s/%s): %s", retry_after, attempt + 1, MAX_RETRIES, url)
                    await asyncio.sleep(retry_after)
                    continue

                if resp.status >= 500:
                    delay = RETRY_BASE_DELAY * (2**attempt)
                    body = await resp.text()
                    if attempt + 1 >= MAX_RETRIES:
                        raise RetryableHTTPError(resp.status, f"HTTP {resp.status}: {body[:200]}")
                    log.warning("HTTP %s，%ss 后重试 (%s/%s): %s", resp.status, delay, attempt + 1, MAX_RETRIES, url)
                    await asyncio.sleep(delay)
                    continue

                resp.raise_for_status()
                return await resp.json(content_type=None)

        except aiohttp.ClientResponseError as exc:
            # 4xx（除上方单独处理的 429）通常是权限窗口或参数问题，重试不会改变结果。
            if 400 <= exc.status < 500:
                raise
            last_error = exc
            delay = RETRY_BASE_DELAY * (2**attempt)
            if attempt + 1 >= MAX_RETRIES:
                raise
            log.warning("网络异常 %s，%ss 后重试 (%s/%s): %s", exc, delay, attempt + 1, MAX_RETRIES, url)
            await asyncio.sleep(delay)
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            last_error = exc
            delay = RETRY_BASE_DELAY * (2**attempt)
            if attempt + 1 >= MAX_RETRIES:
                raise
            log.warning("网络异常 %s，%ss 后重试 (%s/%s): %s", exc, delay, attempt + 1, MAX_RETRIES, url)
            await asyncio.sleep(delay)

    raise last_error or RuntimeError(f"请求失败: {url}")


# ---------------------------------------------------------------------------
# API 解析
# ---------------------------------------------------------------------------


def parse_wait_time(queue: dict[str, Any] | None, queue_type: str = "STANDBY") -> int | None:
    if not queue:
        return None
    entry = queue.get(queue_type) or {}
    wait = entry.get("waitTime")
    return int(wait) if wait is not None else None


def compute_crowd_index(live_data: list[dict[str, Any]]) -> dict[str, Any]:
    """由运营中 ATTRACTION 的 STANDBY 排队推算园区客流指数。"""
    waits: list[int] = []
    operating = 0

    for item in live_data:
        if item.get("entityType") != "ATTRACTION":
            continue
        if item.get("status") != "OPERATING":
            continue
        operating += 1
        wait = parse_wait_time(item.get("queue"))
        if wait is not None:
            waits.append(wait)

    if not waits:
        return {
            "crowd_index": 0.0,
            "operating_rides": operating,
            "avg_wait_min": None,
            "max_wait_min": None,
        }

    avg_wait = sum(waits) / len(waits)
    max_wait = max(waits)
    crowd_index = round(min(100.0, avg_wait / CROWD_INDEX_MAX_WAIT * 100.0), 2)

    return {
        "crowd_index": crowd_index,
        "operating_rides": operating,
        "avg_wait_min": round(avg_wait, 2),
        "max_wait_min": max_wait,
    }


def find_today_schedule(schedule_entries: list[dict[str, Any]], target: date) -> dict[str, Any] | None:
    target_str = target.isoformat()
    for entry in schedule_entries:
        if entry.get("date") == target_str:
            return entry
    return None


# ---------------------------------------------------------------------------
# 天气
# ---------------------------------------------------------------------------


async def fetch_weather(
    session: aiohttp.ClientSession,
    target: date,
    hour: int,
) -> tuple[float | None, float | None]:
    """
    返回 (当小时气温 °C, 当日累计降水 mm)。
    当日用 forecast API，历史日用 archive API。
    """
    today = datetime.now(TIMEZONE).date()
    date_str = target.isoformat()

    if target <= today:
        if target == today:
            url = "https://api.open-meteo.com/v1/forecast"
        else:
            url = "https://archive-api.open-meteo.com/v1/archive"

        params = {
            "latitude": WEATHER_LAT,
            "longitude": WEATHER_LON,
            "start_date": date_str,
            "end_date": date_str,
            "hourly": "temperature_2m,precipitation",
            "timezone": "Asia/Shanghai",
        }
        data = await fetch_json(session, url, params=params)
        hourly = data.get("hourly", {})
        times: list[str] = hourly.get("time", [])
        temps: list[float | None] = hourly.get("temperature_2m", [])
        precips: list[float | None] = hourly.get("precipitation", [])

        hour_key = f"{date_str}T{hour:02d}:00"
        temperature: float | None = None
        for idx, t in enumerate(times):
            if t == hour_key:
                temperature = temps[idx] if idx < len(temps) else None
                break

        total_precip = sum(p or 0.0 for p in precips)
        return temperature, round(total_precip, 2)

    return None, None


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------


async def init_db(db_path: Path) -> None:
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA_SQL)
        await db.commit()


async def upsert_daily_total(db: aiosqlite.Connection, row: dict[str, Any]) -> bool:
    """同一小时保留最新一次真实观测；返回 True 表示完成写入。"""
    cursor = await db.execute(
        """
        INSERT INTO daily_total (
            date, hour, crowd_index, operating_rides, avg_wait_min, max_wait_min,
            park_open_time, park_close_time, park_status,
            temperature_c, precipitation_mm,
            is_holiday, is_weekend, is_school_vacation, school_vacation_type,
            scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, hour) DO UPDATE SET
            crowd_index = excluded.crowd_index,
            operating_rides = excluded.operating_rides,
            avg_wait_min = excluded.avg_wait_min,
            max_wait_min = excluded.max_wait_min,
            park_open_time = excluded.park_open_time,
            park_close_time = excluded.park_close_time,
            park_status = excluded.park_status,
            temperature_c = COALESCE(excluded.temperature_c, daily_total.temperature_c),
            precipitation_mm = COALESCE(excluded.precipitation_mm, daily_total.precipitation_mm),
            is_holiday = excluded.is_holiday,
            is_weekend = excluded.is_weekend,
            is_school_vacation = excluded.is_school_vacation,
            school_vacation_type = excluded.school_vacation_type,
            scraped_at = excluded.scraped_at
        """,
        (
            row["date"],
            row["hour"],
            row["crowd_index"],
            row["operating_rides"],
            row["avg_wait_min"],
            row["max_wait_min"],
            row["park_open_time"],
            row["park_close_time"],
            row["park_status"],
            row["temperature_c"],
            row["precipitation_mm"],
            row["is_holiday"],
            row["is_weekend"],
            row["is_school_vacation"],
            row["school_vacation_type"],
            row["scraped_at"],
        ),
    )
    return cursor.rowcount > 0


async def upsert_ride_queue(db: aiosqlite.Connection, rows: list[dict[str, Any]]) -> int:
    """批量写入；同一项目同一小时保留最新一次真实观测。"""
    if not rows:
        return 0

    inserted = 0
    for row in rows:
        cursor = await db.execute(
            """
            INSERT INTO ride_queue (
                date, hour, ride_id, ride_name, entity_type,
                wait_time_min, single_rider_min, status, last_updated, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, hour, ride_id) DO UPDATE SET
                ride_name = excluded.ride_name,
                entity_type = excluded.entity_type,
                wait_time_min = excluded.wait_time_min,
                single_rider_min = excluded.single_rider_min,
                status = excluded.status,
                last_updated = excluded.last_updated,
                scraped_at = excluded.scraped_at
            """,
            (
                row["date"],
                row["hour"],
                row["ride_id"],
                row["ride_name"],
                row["entity_type"],
                row["wait_time_min"],
                row["single_rider_min"],
                row["status"],
                row["last_updated"],
                row["scraped_at"],
            ),
        )
        inserted += cursor.rowcount
    return inserted


# ---------------------------------------------------------------------------
# 抓取主流程
# ---------------------------------------------------------------------------


@dataclass
class ScrapeResult:
    daily_inserted: bool
    rides_inserted: int
    crowd_index: float
    ride_count: int


@dataclass
class BackfillResult:
    requested_days: int
    completed_days: int
    hourly_snapshots: int
    ride_rows: int


def parse_api_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def schedule_for_date(entries: list[dict[str, Any]], target: date) -> dict[str, Any] | None:
    return next((entry for entry in entries if entry.get("date") == target.isoformat()), None)


def sample_history_entity(
    entity: dict[str, Any], target: date, sample_hour: int
) -> dict[str, Any]:
    """按官方 history 的 opening + changes 语义还原指定整点末的状态。"""
    state = copy.deepcopy(entity.get("opening") or {})
    sample_at = datetime(
        target.year,
        target.month,
        target.day,
        sample_hour,
        59,
        59,
        tzinfo=TIMEZONE,
    ).astimezone(timezone.utc)
    last_updated = state.get("observedAt") or state.get("time")

    for change in entity.get("history") or []:
        changed_at = parse_api_time(change.get("time"))
        if changed_at is None or changed_at > sample_at:
            break
        if "status" in change:
            state["status"] = change.get("status")
        if "queue" in change:
            state["queue"] = copy.deepcopy(change.get("queue") or {})
        last_updated = change.get("time") or last_updated

    return {
        "id": entity.get("id", ""),
        "name": entity.get("name", ""),
        "entityType": entity.get("entityType", "UNKNOWN"),
        "status": state.get("status", "UNKNOWN"),
        "queue": state.get("queue") or {},
        "lastUpdated": last_updated,
    }


async def backfill_history(
    db_path: Path,
    park_id: str,
    days: int,
    api_key: str | None = None,
) -> BackfillResult:
    """回填 API 授权窗口内的真实变更历史，不生成或插值不存在的日期。"""
    requested_days = max(0, min(days, 3660))
    if requested_days == 0:
        return BackfillResult(0, 0, 0, 0)

    now_local = datetime.now(TIMEZONE)
    scraped_at = datetime.now(timezone.utc).isoformat()
    headers = {"User-Agent": USER_AGENT}
    if api_key:
        headers["x-api-key"] = api_key
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_context)
    timeout = aiohttp.ClientTimeout(total=60)

    completed_days = 0
    hourly_snapshots = 0
    written_rides = 0

    async with aiohttp.ClientSession(
        timeout=timeout,
        headers=headers,
        connector=connector,
    ) as session:
        schedule_url = f"{API_BASE}/entity/{park_id}/schedule"
        try:
            schedule_resp = await fetch_json(session, schedule_url)
            schedule_entries = schedule_resp.get("schedule", [])
        except Exception as exc:
            log.warning("历史回填获取 schedule 失败，开闭园字段留空: %s", exc)
            schedule_entries = []

        for offset in range(requested_days, 0, -1):
            target = now_local.date() - timedelta(days=offset)
            history_url = f"{API_BASE}/entity/{park_id}/history"
            try:
                history_resp = await fetch_json(
                    session,
                    history_url,
                    params={"date": target.isoformat()},
                )
            except Exception as exc:
                log.warning("历史回填跳过 %s: %s", target, exc)
                continue

            entities = [
                entity
                for entity in history_resp.get("entities", [])
                if entity.get("entityType") in {"ATTRACTION", "SHOW"}
            ]
            if not entities:
                log.warning("历史回填 %s 没有实体记录，跳过", target)
                continue

            schedule_entry = schedule_for_date(schedule_entries, target)
            open_time = schedule_entry.get("openingTime") if schedule_entry else None
            close_time = schedule_entry.get("closingTime") if schedule_entry else None
            park_status = schedule_entry.get("type") if schedule_entry else None
            start_hour, end_hour = 8, 22
            parsed_open = parse_api_time(open_time)
            parsed_close = parse_api_time(close_time)
            if parsed_open:
                start_hour = max(0, parsed_open.astimezone(TIMEZONE).hour)
            if parsed_close:
                end_hour = min(23, parsed_close.astimezone(TIMEZONE).hour)

            try:
                weather = await fetch_weather(session, target, min(max(start_hour + 4, 0), 23))
                temperature_c, precipitation_mm = weather
            except Exception as exc:
                log.warning("历史回填 %s 天气暂不可用，保留空值: %s", target, exc)
                temperature_c, precipitation_mm = None, None
            on_vacation, vacation_type = school_vacation_info(target)
            day_daily_rows: list[dict[str, Any]] = []
            day_ride_rows: list[dict[str, Any]] = []

            for hour in range(start_hour, end_hour + 1):
                sampled = [sample_history_entity(entity, target, hour) for entity in entities]
                crowd = compute_crowd_index(sampled)
                day_daily_rows.append(
                    {
                        "date": target.isoformat(),
                        "hour": hour,
                        "crowd_index": crowd["crowd_index"],
                        "operating_rides": crowd["operating_rides"],
                        "avg_wait_min": crowd["avg_wait_min"],
                        "max_wait_min": crowd["max_wait_min"],
                        "park_open_time": open_time,
                        "park_close_time": close_time,
                        "park_status": park_status,
                        "temperature_c": temperature_c,
                        "precipitation_mm": precipitation_mm,
                        "is_holiday": int(is_public_holiday(target)),
                        "is_weekend": int(is_weekend(target)),
                        "is_school_vacation": int(on_vacation),
                        "school_vacation_type": vacation_type,
                        "scraped_at": scraped_at,
                    }
                )
                for item in sampled:
                    day_ride_rows.append(
                        {
                            "date": target.isoformat(),
                            "hour": hour,
                            "ride_id": item["id"],
                            "ride_name": item["name"],
                            "entity_type": item["entityType"],
                            "wait_time_min": parse_wait_time(item.get("queue"), "STANDBY"),
                            "single_rider_min": parse_wait_time(item.get("queue"), "SINGLE_RIDER"),
                            "status": item.get("status", "UNKNOWN"),
                            "last_updated": item.get("lastUpdated"),
                            "scraped_at": scraped_at,
                        }
                    )

            async with aiosqlite.connect(db_path) as db:
                for row in day_daily_rows:
                    await upsert_daily_total(db, row)
                written_rides += await upsert_ride_queue(db, day_ride_rows)
                await db.commit()

            completed_days += 1
            hourly_snapshots += len(day_daily_rows)
            log.info(
                "历史回填完成 %s | 小时=%d | 实体=%d",
                target,
                len(day_daily_rows),
                len(entities),
            )

    return BackfillResult(requested_days, completed_days, hourly_snapshots, written_rides)


async def scrape_once(db_path: Path, park_id: str = PARK_ID) -> ScrapeResult:
    now_local = datetime.now(TIMEZONE)
    today = now_local.date()
    hour = now_local.hour
    scraped_at = datetime.now(timezone.utc).isoformat()

    timeout = aiohttp.ClientTimeout(total=30)
    headers = {"User-Agent": USER_AGENT}

    # Python.org builds on macOS do not always inherit the system keychain.
    # Pin the maintained CA bundle so a scheduled crawler cannot silently go
    # stale because TLS verification fails on the host machine.
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_context)
    async with aiohttp.ClientSession(
        timeout=timeout,
        headers=headers,
        connector=connector,
    ) as session:
        live_url = f"{API_BASE}/entity/{park_id}/live"
        schedule_url = f"{API_BASE}/entity/{park_id}/schedule"

        live_resp, schedule_resp, weather = await asyncio.gather(
            fetch_json(session, live_url),
            fetch_json(session, schedule_url),
            fetch_weather(session, today, hour),
            return_exceptions=True,
        )

        if isinstance(live_resp, Exception):
            raise live_resp
        if isinstance(schedule_resp, Exception):
            log.warning("获取 schedule 失败，开闭园时间留空: %s", schedule_resp)
            schedule_resp = {"schedule": []}
        if isinstance(weather, Exception):
            log.warning("获取天气失败，气温/降水留空: %s", weather)
            weather = (None, None)

        live_data: list[dict[str, Any]] = live_resp.get("liveData", [])
        crowd = compute_crowd_index(live_data)

        schedule_entry = find_today_schedule(schedule_resp.get("schedule", []), today)
        park_open = schedule_entry.get("openingTime") if schedule_entry else None
        park_close = schedule_entry.get("closingTime") if schedule_entry else None
        park_status = schedule_entry.get("type") if schedule_entry else None

        temperature_c, precipitation_mm = weather
        is_holiday = int(is_public_holiday(today))
        is_wknd = int(is_weekend(today))
        on_vacation, vacation_type = school_vacation_info(today)

        daily_row = {
            "date": today.isoformat(),
            "hour": hour,
            "crowd_index": crowd["crowd_index"],
            "operating_rides": crowd["operating_rides"],
            "avg_wait_min": crowd["avg_wait_min"],
            "max_wait_min": crowd["max_wait_min"],
            "park_open_time": park_open,
            "park_close_time": park_close,
            "park_status": park_status,
            "temperature_c": temperature_c,
            "precipitation_mm": precipitation_mm,
            "is_holiday": is_holiday,
            "is_weekend": is_wknd,
            "is_school_vacation": int(on_vacation),
            "school_vacation_type": vacation_type,
            "scraped_at": scraped_at,
        }

        ride_rows: list[dict[str, Any]] = []
        for item in live_data:
            entity_type = item.get("entityType", "UNKNOWN")
            # 仅持久化有排队或状态信息的实体（游乐项目 + 演出）
            if entity_type not in {"ATTRACTION", "SHOW"}:
                continue

            queue = item.get("queue")
            ride_rows.append(
                {
                    "date": today.isoformat(),
                    "hour": hour,
                    "ride_id": item.get("id", ""),
                    "ride_name": item.get("name", ""),
                    "entity_type": entity_type,
                    "wait_time_min": parse_wait_time(queue, "STANDBY"),
                    "single_rider_min": parse_wait_time(queue, "SINGLE_RIDER"),
                    "status": item.get("status", "UNKNOWN"),
                    "last_updated": item.get("lastUpdated"),
                    "scraped_at": scraped_at,
                }
            )

    async with aiosqlite.connect(db_path) as db:
        daily_inserted = await upsert_daily_total(db, daily_row)
        rides_inserted = await upsert_ride_queue(db, ride_rows)
        await db.commit()

    log.info(
        "抓取完成 %s %02d:00 | 客流指数=%.1f | 项目=%d | daily新增=%s | ride新增=%d",
        today,
        hour,
        crowd["crowd_index"],
        len(ride_rows),
        daily_inserted,
        rides_inserted,
    )

    return ScrapeResult(
        daily_inserted=daily_inserted,
        rides_inserted=rides_inserted,
        crowd_index=crowd["crowd_index"],
        ride_count=len(ride_rows),
    )


async def run_loop(
    db_path: Path,
    interval_sec: int,
    park_id: str,
    backfill_days: int,
    api_key: str | None,
) -> None:
    await init_db(db_path)
    try:
        await scrape_once(db_path, park_id)
    except Exception:
        log.exception("启动即时抓取失败，继续尝试历史回填")
    if backfill_days > 0:
        result = await backfill_history(db_path, park_id, backfill_days, api_key)
        log.info(
            "启动回填结束 | 请求=%d天 完成=%d天 小时快照=%d",
            result.requested_days,
            result.completed_days,
            result.hourly_snapshots,
        )
    log.info("开始循环抓取，间隔 %ds，数据库 %s", interval_sec, db_path)

    while True:
        await asyncio.sleep(interval_sec)
        try:
            await scrape_once(db_path, park_id)
        except Exception:
            log.exception("本轮抓取失败，将在下一周期重试")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def resolve_park_id(raw: str) -> str:
    return PARK_ALIASES.get(raw, raw)


def print_schema() -> None:
    print(SCHEMA_SQL.strip())


def print_stats(db_path: Path) -> None:
    if not db_path.exists():
        print("数据库尚未创建")
        return
    conn = sqlite3.connect(db_path)
    daily = conn.execute("SELECT COUNT(*) FROM daily_total").fetchone()[0]
    rides = conn.execute("SELECT COUNT(*) FROM ride_queue").fetchone()[0]
    latest = conn.execute(
        "SELECT date, hour, crowd_index, avg_wait_min FROM daily_total ORDER BY date DESC, hour DESC LIMIT 1"
    ).fetchone()
    conn.close()
    print(f"daily_total 行数: {daily}")
    print(f"ride_queue 行数: {rides}")
    if latest:
        print(f"最新快照: {latest[0]} {latest[1]:02d}:00 客流指数={latest[2]} 均排队={latest[3]}min")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="上海迪士尼 ThemeParks.wiki 异步爬虫")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite 数据库路径")
    parser.add_argument(
        "--park-id",
        default="shanghai_disneyland",
        help="园区 ID 或别名（默认 shanghai_disneyland）",
    )
    parser.add_argument("--loop", action="store_true", help="定时循环抓取")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SEC, help="循环间隔秒数")
    parser.add_argument(
        "--backfill-days",
        type=int,
        default=0,
        help="启动时回填最近 N 个完整自然日（无 key 建议 7，免费 key 可 30）",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("THEMEPARKS_API_KEY"),
        help="ThemeParks.wiki API key（默认读取 THEMEPARKS_API_KEY）",
    )
    parser.add_argument("--schema", action="store_true", help="打印建表 SQL 后退出")
    parser.add_argument("--stats", action="store_true", help="打印数据库统计后退出")
    return parser


async def async_main(args: argparse.Namespace) -> None:
    if args.schema:
        print_schema()
        return
    if args.stats:
        print_stats(args.db)
        return

    park_id = resolve_park_id(args.park_id)
    await init_db(args.db)

    if args.loop:
        await run_loop(args.db, args.interval, park_id, args.backfill_days, args.api_key)
    elif args.backfill_days > 0:
        result = await backfill_history(args.db, park_id, args.backfill_days, args.api_key)
        print(
            f"历史回填: 请求 {result.requested_days} 天，完成 {result.completed_days} 天，"
            f"小时快照 {result.hourly_snapshots} 条"
        )
        print_stats(args.db)
    else:
        await scrape_once(args.db, park_id)
        print_stats(args.db)


def main() -> None:
    args = build_parser().parse_args()
    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        log.info("已停止")


if __name__ == "__main__":
    main()
