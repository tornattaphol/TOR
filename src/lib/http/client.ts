import { createLogger } from "../logger";
import { RobotsPolicy } from "./robots";

const log = createLogger("http");

export interface HttpResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
}

export class SourceUnavailableError extends Error {
  readonly code = "SOURCE_UNAVAILABLE" as const;
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class RobotsDisallowedError extends Error {
  readonly code = "ROBOTS_DISALLOWED" as const;
}

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  /** Minimum gap between two requests to the same origin. */
  delayMs: number;
  maxBodyBytes: number;
  respectRobots?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_PARAM = /^(.*[-_])?(api[-_]?key|key|token|secret|password|passwd|auth|authorization|signature|sig|session)([-_].*)?$/i;

const bareHost = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");

/** Same host (ignoring a leading "www.") and no downgrade from https to http. */
export function sameSite(a: URL, b: URL): boolean {
  if (b.protocol !== "http:" && b.protocol !== "https:") return false;
  if (bareHost(a) !== bareHost(b)) return false;
  return !(a.protocol === "https:" && b.protocol === "http:");
}

/** Drops credential-looking query parameters and fragments so they never reach the database or logs. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE_PARAM.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Polite HTTP client for ingestion: identifying User-Agent, robots.txt, per-origin delay,
 * timeout, bounded retries with exponential backoff, response-size cap.
 */
export class HttpClient {
  private robots = new Map<string, RobotsPolicy>();
  private lastRequestAt = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? (() => new Date());
  }

  async get(url: string, extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new SourceUnavailableError(`Unsupported protocol: ${u.protocol}`);
    }
    if (this.opts.respectRobots !== false) await this.assertAllowed(u);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(500 * 2 ** (attempt - 1), 8_000) + Math.floor(Math.random() * 250);
        log.warn("retry", { url, attempt, backoffMs: backoff });
        await this.sleep(backoff);
      }
      await this.throttle(u.origin);
      try {
        const res = await this.request(url, extraHeaders);
        if (res.status >= 200 && res.status < 300) return res;
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        lastError = new SourceUnavailableError(`HTTP ${res.status} from ${u.host}`, res.status);
        if (!retryable) throw lastError;
      } catch (e) {
        if (e instanceof SourceUnavailableError && e.status && !(e.status === 408 || e.status === 429 || e.status >= 500)) throw e;
        lastError = e;
      }
    }
    if (lastError instanceof SourceUnavailableError) throw lastError;
    throw new SourceUnavailableError(`Request to ${u.host} failed: ${(lastError as Error)?.message ?? "unknown error"}`);
  }

  private async throttle(origin: string) {
    const last = this.lastRequestAt.get(origin);
    if (last !== undefined && this.opts.delayMs > 0) {
      const wait = last + this.opts.delayMs - Date.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt.set(origin, Date.now());
  }

  /**
   * One logical GET. Redirects are followed by hand (max 3 hops) and only within the same site, so a source can
   * never bounce the crawler to an internal address (SSRF) or receive the API-key header on another host.
   */
  private async request(startUrl: string, extraHeaders: Record<string, string>): Promise<HttpResponse> {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "User-Agent": this.opts.userAgent,
            Accept: "text/html,application/json,text/csv;q=0.9,*/*;q=0.5",
            ...extraHeaders,
          },
        });
        if (REDIRECT_STATUS.has(res.status)) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (!location) throw new SourceUnavailableError(`Redirect (HTTP ${res.status}) without a Location header`);
          const from = new URL(url);
          const next = new URL(location, from);
          if (!sameSite(from, next)) {
            throw new SourceUnavailableError(`Refused redirect from ${from.host} to ${next.host} (cross-site redirects are not followed)`);
          }
          url = next.toString();
          continue;
        }
        const body = res.ok ? await this.readCapped(res) : "";
        log.debug("fetched", { url: sanitizeUrl(url), status: res.status, bytes: body.length });
        return {
          url: sanitizeUrl(url),
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          body,
          fetchedAt: this.now().toISOString(),
        };
      } catch (e) {
        if (e instanceof SourceUnavailableError) throw e;
        if ((e as Error).name === "AbortError") {
          throw new SourceUnavailableError(`Timeout after ${this.opts.timeoutMs}ms`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new SourceUnavailableError(`Too many redirects (more than ${MAX_REDIRECTS})`);
  }

  private async readCapped(res: Response): Promise<string> {
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > this.opts.maxBodyBytes) {
      throw new SourceUnavailableError(`Response too large (${declared} bytes)`);
    }
    if (!res.body) return await res.text();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.opts.maxBodyBytes) {
        await reader.cancel();
        throw new SourceUnavailableError(`Response exceeded ${this.opts.maxBodyBytes} bytes`);
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  }

  private async assertAllowed(u: URL) {
    let policy = this.robots.get(u.origin);
    if (!policy) {
      policy = await this.loadRobots(u.origin);
      this.robots.set(u.origin, policy);
    }
    if (!policy.isAllowed(this.opts.userAgent, u.pathname + u.search)) {
      throw new RobotsDisallowedError(
        policy.isDenyAll
          ? `robots.txt of ${u.host} could not be retrieved (server error); crawling is paused until it can be read`
          : `robots.txt of ${u.host} disallows ${u.pathname}`,
      );
    }
  }

  /** 2xx → parse; 4xx → no restrictions; 5xx → crawling paused (RFC 9309); network failure → source unavailable. */
  private async loadRobots(origin: string): Promise<RobotsPolicy> {
    let res: HttpResponse;
    try {
      await this.throttle(origin);
      res = await this.request(`${origin}/robots.txt`, {});
    } catch (e) {
      log.warn("robots_unreachable", { origin, error: (e as Error).message });
      if (e instanceof SourceUnavailableError) throw e;
      throw new SourceUnavailableError(`Cannot reach ${new URL(origin).host}: ${(e as Error).message}`);
    }
    if (res.status >= 200 && res.status < 300) return new RobotsPolicy(res.body);
    if (res.status >= 400 && res.status < 500) return RobotsPolicy.allowAll();
    return RobotsPolicy.denyAll();
  }
}
