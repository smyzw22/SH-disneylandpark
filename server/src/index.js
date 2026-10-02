const { createApp } = require("./app");
const { DEFAULT_DB } = require("./db");
const { startManagedCollector } = require("./collectorProcess");

const PORT = Number(process.env.PORT || 3000);
const dbPath = process.env.DB_PATH || DEFAULT_DB;
const collector = startManagedCollector(dbPath);
const app = createApp(dbPath);

const server = app.listen(PORT, () => {
  console.log(`上海迪士尼 API 运行于 http://localhost:${PORT}`);
  console.log(
    collector.enabled
      ? `  自动采集: 每 ${collector.interval}s · 启动回填 ${collector.backfillDays} 天`
      : "  自动采集: 已关闭（AUTO_COLLECT=false）"
  );
  console.log("  GET /health");
  console.log("  GET /api/realtime");
  console.log("  GET /api/history?limit=60");
  console.log("  GET /api/predict?start=YYYY-MM-DD&end=YYYY-MM-DD");
  console.log("  GET /api/suggest?date=YYYY-MM-DD");
});

function shutdown(signal) {
  if (collector.child && !collector.child.killed) collector.child.kill(signal);
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
