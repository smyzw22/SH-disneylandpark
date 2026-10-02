const express = require("express");
const cors = require("cors");
const { MemoryCache } = require("./cache");
const {
  openDb,
  getRealtimePayload,
  getDataCoverage,
  getObservedHistory,
  DEFAULT_DB,
} = require("./db");
const { parseDate, parseDateRange, ValidationError } = require("./validators");
const { fetchPredict, fetchSuggest } = require("./pythonBridge");

const REALTIME_TTL = Number(process.env.CACHE_REALTIME_MS || 60_000);
const PREDICT_TTL = Number(process.env.CACHE_PREDICT_MS || 300_000);
const SUGGEST_TTL = Number(process.env.CACHE_SUGGEST_MS || 300_000);

const cache = new MemoryCache();

/**
 * @param {string} [dbPath]
 */
function createApp(dbPath) {
  const app = express();
  const db = openDb(dbPath || process.env.DB_PATH || DEFAULT_DB);

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "shanghai-disneyland-api",
      db: dbPath || process.env.DB_PATH || DEFAULT_DB,
      time: new Date().toISOString(),
      collection: {
        automatic: !["0", "false", "off", "no"].includes(
          String(process.env.AUTO_COLLECT || "true").toLowerCase()
        ),
        interval_seconds: Math.max(60, Number(process.env.COLLECT_INTERVAL_SEC || 300)),
        history_window_days: Math.max(
          0,
          Number(
            process.env.HISTORY_BACKFILL_DAYS ||
              (process.env.THEMEPARKS_API_KEY ? 30 : 7)
          )
        ),
        ...getDataCoverage(db),
      },
    });
  });

  /** 1. 今日实时各项目排队 + 当前人流指数 */
  app.get("/api/realtime", async (_req, res, next) => {
    try {
      const { data, cached } = await cache.wrap(
        "realtime",
        () => Promise.resolve(getRealtimePayload(db)),
        REALTIME_TTL
      );
      res.json({ ok: true, cached, ...data });
    } catch (err) {
      next(err);
    }
  });

  /** 真实历史按日聚合，只返回 SQLite 中已采集/回填的观测。 */
  app.get("/api/history", (req, res, next) => {
    try {
      const rows = getObservedHistory(db, Number(req.query.limit || 60));
      res.json({
        ok: true,
        rows,
        coverage: getDataCoverage(db),
        data_source: "themeparks_history_observed",
      });
    } catch (err) {
      next(err);
    }
  });

  /** 2. 区间人流/排队预测 + 低人流推荐 */
  app.get("/api/predict", async (req, res, next) => {
    try {
      const { start, end } = parseDateRange(req.query.start, req.query.end, {
        maxRangeDays: Number(process.env.MAX_PREDICT_DAYS || 90),
      });
      const cacheKey = `predict:${start}:${end}`;
      const { data, cached } = await cache.wrap(
        cacheKey,
        () => fetchPredict(start, end),
        PREDICT_TTL
      );
      res.json({ ok: true, cached, ...data });
    } catch (err) {
      next(err);
    }
  });

  /** 3. 指定日期分时游玩规划 */
  app.get("/api/suggest", async (req, res, next) => {
    try {
      const date = parseDate(req.query.date, "date");
      const cacheKey = `suggest:${date}`;
      const { data, cached } = await cache.wrap(
        cacheKey,
        () => fetchSuggest(date),
        SUGGEST_TTL
      );
      res.json({ ok: true, cached, ...data });
    } catch (err) {
      next(err);
    }
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error("[API Error]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Internal Server Error",
    });
  });

  return app;
}

module.exports = { createApp, cache };
