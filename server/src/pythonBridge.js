const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_PYTHON = path.join(PROJECT_ROOT, ".venv/bin/python");
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, "ml_pipeline/api_bridge.py");

/**
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
function runPythonBridge(args, timeoutMs = 120_000) {
  const pythonBin =
    process.env.PYTHON_BIN ||
    process.env.PYTHON_PATH ||
    (fs.existsSync(DEFAULT_PYTHON) ? DEFAULT_PYTHON : "python3");
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [BRIDGE_SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: PROJECT_ROOT,
        // XGBoost OpenMP（macOS 本地 venv 修复路径）
        DYLD_LIBRARY_PATH: [
          path.join(PROJECT_ROOT, ".venv/lib/python3.13/site-packages/xgboost/lib"),
          process.env.DYLD_LIBRARY_PATH,
        ]
          .filter(Boolean)
          .join(":"),
      },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Python 桥接超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `无法启动 Python (${pythonBin}): ${err.message}。请运行 pip install -r requirements.txt -r requirements-ml.txt，或配置 PYTHON_BIN。`
        )
      );
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Python 桥接失败 (code=${code}): ${stderr.trim() || stdout.trim()}`
          )
        );
        return;
      }
      try {
        const trimmed = stdout.trim();
        const jsonStart = trimmed.indexOf("{");
        const jsonStr = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;
        resolve(JSON.parse(jsonStr));
      } catch (err) {
        reject(new Error(`Python 返回非 JSON: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

/**
 * @param {string} start
 * @param {string} end
 */
async function fetchPredict(start, end) {
  return runPythonBridge(["predict", "--start", start, "--end", end]);
}

/**
 * @param {string} date
 */
async function fetchSuggest(date) {
  return runPythonBridge(["suggest", "--date", date]);
}

module.exports = { fetchPredict, fetchSuggest, runPythonBridge };
