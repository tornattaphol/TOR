import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getEnv } from "../config/env";
import { REQUIRED_WARNING } from "../disclaimer";
import { createLogger } from "../logger";
import { RateLimiter } from "./rate-limit";

const log = createLogger("api");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type RateClass = "default" | "heavy" | "ingest";

interface Limiters {
  default: RateLimiter;
  heavy: RateLimiter;
  ingest: RateLimiter;
}

let limiters: Limiters | null = null;

function getLimiters(): Limiters {
  if (!limiters) {
    const env = getEnv();
    limiters = {
      default: new RateLimiter(env.RATE_LIMIT_PER_MINUTE, 60_000),
      heavy: new RateLimiter(env.RATE_LIMIT_HEAVY_PER_MINUTE, 60_000),
      ingest: new RateLimiter(env.RATE_LIMIT_INGEST_PER_HOUR, 3_600_000),
    };
  }
  return limiters;
}

/** For tests: forget limiter state (and re-read env limits). */
export function resetRateLimiters() {
  limiters = null;
}

/**
 * Client identifier for rate limiting. X-Forwarded-For is only trustworthy behind a reverse proxy that
 * overwrites it; otherwise a client can spoof it — documented in ARCHITECTURE.md.
 */
export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return (first || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

export interface ApiContext {
  req: NextRequest;
  url: URL;
}

interface HandlerOptions {
  rate?: RateClass;
  /** Cache-Control for successful responses (default: no-store). */
  cacheControl?: string;
}

/** Wraps a route handler with rate limiting, uniform error format, and safe logging. */
export function apiHandler(opts: HandlerOptions, handler: (ctx: ApiContext) => Promise<unknown | Response>) {
  return async (req: NextRequest): Promise<Response> => {
    const started = Date.now();
    try {
      const rl = getLimiters()[opts.rate ?? "default"].check(clientKey(req));
      if (!rl.allowed) {
        return NextResponse.json(
          { error: { code: "RATE_LIMITED", message: "คำขอถี่เกินไป กรุณาลองใหม่ภายหลัง" } },
          { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds), "Cache-Control": "no-store" } },
        );
      }
      const out = await handler({ req, url: new URL(req.url) });
      if (out instanceof Response) return out;
      return NextResponse.json(out, { headers: { "Cache-Control": opts.cacheControl ?? "no-store" } });
    } catch (e) {
      return errorResponse(e, req, started);
    }
  };
}

function errorResponse(e: unknown, req: NextRequest, started: number): Response {
  const path = new URL(req.url).pathname;
  if (e instanceof ApiError) {
    log.warn("api_error", { path, status: e.status, code: e.code });
    return NextResponse.json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "พารามิเตอร์ไม่ถูกต้อง", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (isDatabaseUnavailable(e)) {
    log.error("database_unavailable", { path, error: errText(e) });
    return NextResponse.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบการตั้งค่า DATABASE_URL และสถานะฐานข้อมูล" } },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
  // Never leak internals (stack, SQL, connection strings) to the client.
  log.error("api_unhandled", { path, ms: Date.now() - started, error: errText(e) });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาดภายในระบบ" } }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 300);
}

const DB_ERROR_CODES = /^(P1000|P1001|P1002|P1008|P1017|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|57P0\d|08\w+)$/;
const DB_ERROR_TEXT = /DATABASE_URL is not set|ECONNREFUSED|reach database server/i;

/** Connection-level failures (DB down / not configured) are reported as 503, not as a bug (500). */
function isDatabaseUnavailable(e: unknown): boolean {
  const seen = new Set<unknown>();
  for (let cur: unknown = e; cur && !seen.has(cur) && seen.size < 6; cur = (cur as { cause?: unknown }).cause) {
    seen.add(cur);
    const code = String((cur as { code?: unknown }).code ?? "");
    if (DB_ERROR_CODES.test(code)) return true;
    if (cur instanceof Error && DB_ERROR_TEXT.test(cur.message)) return true;
  }
  return false;
}

/** Parses query-string parameters with a zod schema. */
export function parseQuery<T>(schema: ZodType<T>, url: URL): T {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!(k in raw)) raw[k] = v;
  return schema.parse(raw);
}

/** Standard response envelope for statistics endpoints. */
export function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return { data, meta: { generatedAt: new Date().toISOString(), disclaimer: REQUIRED_WARNING, ...meta } };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time bearer-token check. If INGEST_TOKEN is not configured the endpoint is disabled (503). */
export function requireBearer(req: NextRequest, expected: string | undefined): void {
  if (!expected) throw new ApiError(503, "DISABLED", "ปิดการใช้งาน endpoint นี้ (ยังไม่ได้ตั้งค่า INGEST_TOKEN)");
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const ok = m ? timingSafeEqual(digest(m[1]), digest(expected)) : false;
  if (!ok) throw new ApiError(401, "UNAUTHORIZED", "ไม่ได้รับอนุญาต");
}
