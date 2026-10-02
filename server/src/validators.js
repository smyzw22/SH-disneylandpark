const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} value
 * @param {string} name
 */
function parseDate(value, name) {
  if (!value || typeof value !== "string") {
    throw new ValidationError(`${name} 必填，格式 YYYY-MM-DD`);
  }
  const trimmed = value.trim().slice(0, 10);
  if (!DATE_RE.test(trimmed)) {
    throw new ValidationError(`${name} 格式无效，应为 YYYY-MM-DD`);
  }
  const d = new Date(`${trimmed}T12:00:00+08:00`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${name} 不是合法日期`);
  }
  return trimmed;
}

/**
 * @param {string} start
 * @param {string} end
 * @param {{ maxRangeDays?: number }} [opts]
 */
function parseDateRange(start, end, opts = {}) {
  const maxRangeDays = opts.maxRangeDays ?? 90;
  const s = parseDate(start, "start");
  const e = parseDate(end, "end");
  if (e < s) {
    throw new ValidationError("end 不能早于 start");
  }
  const days =
    Math.floor(
      (new Date(`${e}T12:00:00+08:00`) - new Date(`${s}T12:00:00+08:00`)) /
        86400000
    ) + 1;
  if (days > maxRangeDays) {
    throw new ValidationError(`日期区间不能超过 ${maxRangeDays} 天`);
  }
  return { start: s, end: e, days };
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
  }
}

module.exports = { parseDate, parseDateRange, ValidationError, DATE_RE };
