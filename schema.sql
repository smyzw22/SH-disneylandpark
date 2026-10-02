-- 上海迪士尼 ThemeParks.wiki 爬虫 SQLite 表结构
-- 运行 shanghai_disneyland_scraper.py 时会自动建表

-- 每日/每小时园区整体人流快照
CREATE TABLE IF NOT EXISTS daily_total (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,           -- YYYY-MM-DD（Asia/Shanghai）
    hour            INTEGER NOT NULL,           -- 0-23
    crowd_index     REAL,                       -- 园区总客流指数 0-100（由排队时长推算）
    operating_rides INTEGER,                    -- 正在运营的游乐项目数
    avg_wait_min    REAL,                       -- 运营项目平均排队（分钟）
    max_wait_min    REAL,                       -- 运营项目最大排队（分钟）
    park_open_time  TEXT,                       -- 当日开园 ISO8601
    park_close_time TEXT,                       -- 当日闭园 ISO8601
    park_status     TEXT,                       -- OPERATING / CLOSED 等
    temperature_c   REAL,                       -- 当天气温（°C，抓取时刻所在小时）
    precipitation_mm REAL,                      -- 当日累计降水（mm）
    is_holiday      INTEGER NOT NULL DEFAULT 0, -- 1=法定节假日
    is_weekend      INTEGER NOT NULL DEFAULT 0, -- 1=周六/周日
    is_school_vacation INTEGER NOT NULL DEFAULT 0, -- 1=寒暑假
    school_vacation_type TEXT,                  -- summer / winter / NULL
    scraped_at      TEXT    NOT NULL,           -- 抓取 UTC ISO8601
    UNIQUE(date, hour)
);

CREATE INDEX IF NOT EXISTS idx_daily_total_date ON daily_total(date);

-- 分项目、分时段排队明细
CREATE TABLE IF NOT EXISTS ride_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,
    hour            INTEGER NOT NULL,
    ride_id         TEXT    NOT NULL,           -- ThemeParks entity UUID
    ride_name       TEXT    NOT NULL,
    entity_type     TEXT    NOT NULL,           -- ATTRACTION / SHOW 等
    wait_time_min   INTEGER,                    -- STANDBY 排队分钟，NULL=无数据
    single_rider_min INTEGER,                   -- SINGLE_RIDER 排队（如有）
    status          TEXT    NOT NULL,           -- OPERATING / CLOSED / DOWN 等
    last_updated    TEXT,                       -- API 侧最后更新时间
    scraped_at      TEXT    NOT NULL,
    UNIQUE(date, hour, ride_id)
);

CREATE INDEX IF NOT EXISTS idx_ride_queue_date_hour ON ride_queue(date, hour);
CREATE INDEX IF NOT EXISTS idx_ride_queue_ride ON ride_queue(ride_id);
