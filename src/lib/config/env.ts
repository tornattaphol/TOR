import { z } from "zod";

const intFromEnv = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  /** Bearer token required by POST /api/ingest. Must be set (>=16 chars) for the endpoint to be enabled. */
  INGEST_TOKEN: z.string().min(16, "INGEST_TOKEN must be at least 16 characters").optional(),
  SOURCES_CONFIG_PATH: z.string().default("config/sources.json"),
  /** Comma-separated source ids to enable (overrides `enabled` in the config file). */
  SOURCES_ENABLED: z.string().optional(),
  INGEST_USER_AGENT: z
    .string()
    .default("LaoLotteryStatsBot/0.1 (+educational statistics project; respects robots.txt)"),
  INGEST_REQUEST_DELAY_MS: intFromEnv(1500, 0, 60_000),
  INGEST_TIMEOUT_MS: intFromEnv(15_000, 1_000, 120_000),
  INGEST_MAX_RETRIES: intFromEnv(2, 0, 6),
  INGEST_MAX_BODY_BYTES: intFromEnv(5_000_000, 10_000, 50_000_000),
  RATE_LIMIT_PER_MINUTE: intFromEnv(120, 1, 100_000),
  RATE_LIMIT_HEAVY_PER_MINUTE: intFromEnv(12, 1, 10_000),
  RATE_LIMIT_INGEST_PER_HOUR: intFromEnv(6, 1, 1_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Throws a readable error (never prints secret values). */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && cached) return cached;
  // `FOO=` in a .env file means "unset", not "empty string".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${msg}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache() {
  cached = null;
}

export function requireDatabaseUrl(): string {
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  return url;
}
