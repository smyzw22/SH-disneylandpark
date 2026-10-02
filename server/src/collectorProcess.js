const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function enabled(value) {
  return !["0", "false", "off", "no"].includes(String(value || "true").toLowerCase());
}

function resolvePython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venvPython = path.join(PROJECT_ROOT, ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

/**
 * Run the existing verified Python collector as a managed child of the API.
 * The API remains available if the collector cannot start; clients will see
 * the last snapshot marked stale instead of receiving fabricated freshness.
 */
function startManagedCollector(dbPath) {
  if (!enabled(process.env.AUTO_COLLECT)) {
    return { enabled: false, child: null };
  }

  const interval = Math.max(60, Number(process.env.COLLECT_INTERVAL_SEC || 300));
  const defaultBackfill = process.env.THEMEPARKS_API_KEY ? 30 : 7;
  const backfillDays = Math.max(
    0,
    Number(process.env.HISTORY_BACKFILL_DAYS || defaultBackfill)
  );
  const args = [
    path.join(PROJECT_ROOT, "shanghai_disneyland_scraper.py"),
    "--db",
    dbPath,
    "--loop",
    "--interval",
    String(interval),
    "--backfill-days",
    String(backfillDays),
  ];
  const child = spawn(resolvePython(), args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error("[collector] 无法启动，API 将继续提供最后一份真实快照:", error.message);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
      console.error(`[collector] 已退出 code=${code} signal=${signal || "-"}`);
    }
  });

  return { enabled: true, child, interval, backfillDays };
}

module.exports = { startManagedCollector };
