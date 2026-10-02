const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DEFAULT_DB = path.resolve(__dirname, "../../shanghai_disneyland.db");

/**
 * @param {string} [dbPath]
 */
function openDb(dbPath = process.env.DB_PATH || DEFAULT_DB) {
  const db = new DatabaseSync(dbPath, { readOnly: false });
  return db;
}

/**
 * 上海时区今日 YYYY-MM-DD
 */
function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dateStr
 */
function getLatestDailySnapshot(db, dateStr) {
  let row = db
    .prepare(
      `SELECT date, hour, minute, crowd_index, operating_rides, avg_wait_min, max_wait_min,
              park_open_time, park_close_time, park_status,
              temperature_c, precipitation_mm, is_holiday, is_weekend,
              is_school_vacation, school_vacation_type, scraped_at
       FROM daily_total
       WHERE date = ?
       ORDER BY hour DESC, minute DESC, scraped_at DESC
       LIMIT 1`
    )
    .get(dateStr);

  if (!row) {
    row = db
      .prepare(
        `SELECT date, hour, minute, crowd_index, operating_rides, avg_wait_min, max_wait_min,
                park_open_time, park_close_time, park_status,
                temperature_c, precipitation_mm, is_holiday, is_weekend,
                is_school_vacation, school_vacation_type, scraped_at
         FROM daily_total
         ORDER BY date DESC, hour DESC, minute DESC, scraped_at DESC
         LIMIT 1`
      )
      .get();
  }
  return row || null;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dateStr
 * @param {number} hour
 */
function getRideQueues(db, dateStr, hour, minute) {
  return db
    .prepare(
      `SELECT ride_id, ride_name, entity_type, wait_time_min, single_rider_min,
              status, last_updated, scraped_at
       FROM ride_queue
       WHERE date = ? AND hour = ? AND minute = ?
       ORDER BY
         CASE WHEN wait_time_min IS NULL THEN 1 ELSE 0 END,
         wait_time_min DESC,
         ride_name ASC`
    )
    .all(dateStr, hour, minute);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function getRealtimePayload(db) {
  const today = todayShanghai();
  const snapshot = getLatestDailySnapshot(db, today);

  if (!snapshot) {
    return {
      date: today,
      hour: null,
      minute: null,
      crowd_index: null,
      operating_rides: null,
      avg_wait_min: null,
      max_wait_min: null,
      park_status: null,
      weather: null,
      updated_at: null,
      rides: [],
      message: "数据库暂无数据，请先运行 python shanghai_disneyland_scraper.py",
      data_source: "sqlite_snapshot",
      stale: true,
      freshness_minutes: null,
      source_url: "https://api.themeparks.wiki/",
    };
  }

  const rides = getRideQueues(db, snapshot.date, snapshot.hour, snapshot.minute);
  const attractions = rides.filter((r) => r.entity_type === "ATTRACTION");
  const shows = rides.filter((r) => r.entity_type === "SHOW");
  const updatedAt = snapshot.scraped_at;
  const freshnessMinutes = updatedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 60000))
    : null;
  const isToday = snapshot.date === today;

  return {
    date: snapshot.date,
    hour: snapshot.hour,
    minute: snapshot.minute,
    crowd_index: snapshot.crowd_index,
    operating_rides: snapshot.operating_rides,
    avg_wait_min: snapshot.avg_wait_min,
    max_wait_min: snapshot.max_wait_min,
    park_open_time: snapshot.park_open_time,
    park_close_time: snapshot.park_close_time,
    park_status: snapshot.park_status,
    weather: {
      temperature_c: snapshot.temperature_c,
      precipitation_mm: snapshot.precipitation_mm,
    },
    calendar: {
      is_holiday: Boolean(snapshot.is_holiday),
      is_weekend: Boolean(snapshot.is_weekend),
      is_school_vacation: Boolean(snapshot.is_school_vacation),
      school_vacation_type: snapshot.school_vacation_type,
    },
    updated_at: updatedAt,
    rides: attractions.map((r) => ({
      ride_id: r.ride_id,
      ride_name: r.ride_name,
      wait_time_min: r.wait_time_min,
      single_rider_min: r.single_rider_min,
      status: r.status,
      last_updated: r.last_updated,
    })),
    shows: shows.map((r) => ({
      ride_id: r.ride_id,
      ride_name: r.ride_name,
      status: r.status,
    })),
    ride_count: attractions.length,
    data_source: "sqlite_snapshot",
    source_url: "https://api.themeparks.wiki/",
    is_today: isToday,
    freshness_minutes: freshnessMinutes,
    stale: !isToday || freshnessMinutes === null || freshnessMinutes > 15,
    snapshot_label: `${isToday ? "今日实采" : "历史快照"} · ${snapshot.date} ${String(snapshot.hour).padStart(2, "0")}:${String(snapshot.minute).padStart(2, "0")}`,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function getDataCoverage(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT date) AS observed_days,
              COUNT(*) AS observation_snapshots,
              MIN(date) AS first_date,
              MAX(date) AS last_date,
              MAX(scraped_at) AS last_database_write_at
       FROM daily_total`
    )
    .get();
  if (row) return { ...row, hourly_snapshots: row.observation_snapshots };
  return {
    observed_days: 0,
    hourly_snapshots: 0,
    observation_snapshots: 0,
    first_date: null,
    last_date: null,
    last_database_write_at: null,
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} limit
 */
function getObservedHistory(db, limit = 60) {
  const safeLimit = Math.max(1, Math.min(366, Math.trunc(limit) || 60));
  return db
    .prepare(
      `SELECT date,
              ROUND(AVG(crowd_index), 1) AS crowd_index,
              ROUND(AVG(avg_wait_min), 1) AS avg_wait_min,
              MAX(is_holiday) AS is_holiday,
              MAX(is_weekend) AS is_weekend,
              COUNT(*) AS observation_samples
       FROM daily_total
       GROUP BY date
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(safeLimit)
    .reverse()
    .map((row) => ({
      ...row,
      hourly_samples: row.observation_samples,
      is_holiday: Boolean(row.is_holiday),
      is_weekend: Boolean(row.is_weekend),
      data_source: "themeparks_history_observed",
    }));
}

module.exports = {
  openDb,
  todayShanghai,
  getRealtimePayload,
  getDataCoverage,
  getObservedHistory,
  DEFAULT_DB,
};
