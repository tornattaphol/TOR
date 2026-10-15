/** Minimal structured (JSON-lines) logger. Level via LOG_LEVEL=debug|info|warn|error|silent. */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level | "silent";
  return ORDER[raw] ?? ORDER.info;
}

// Keys whose values must never be written to logs.
const SENSITIVE = /token|secret|password|authorization|api[-_]?key|database_url/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}

function emit(level: Level, scope: string, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, event, ...redact(fields) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (e, f) => emit("debug", scope, e, f),
    info: (e, f) => emit("info", scope, e, f),
    warn: (e, f) => emit("warn", scope, e, f),
    error: (e, f) => emit("error", scope, e, f),
  };
}
