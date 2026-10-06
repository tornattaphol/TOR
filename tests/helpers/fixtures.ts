import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { formatThaiDate, addDays, weekdayOf } from "../../src/lib/dates";
import type { DrawRecord } from "../../src/lib/domain";
import { HttpClient } from "../../src/lib/http/client";
import type { SourceConfig } from "../../src/lib/config/sources";

/* ───────────── draw records ───────────── */

export function mkDraw(date: string, result4: string, extra: Partial<DrawRecord> = {}): DrawRecord {
  return {
    drawDate: date,
    drawId: `lao_dev_${date.replaceAll("-", "")}`,
    result4,
    result3: result4.slice(1),
    result2: result4.slice(2),
    source: "test",
    sourceUrl: `https://example.test/${date}`,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    hasConflict: false,
    sourceCount: 1,
    ...extra,
  };
}

/** n consecutive Mon/Wed/Fri draws starting from `start` (must itself be Mon/Wed/Fri), 4-digit values from `values`. */
export function scheduleDraws(start: string, values: string[]): DrawRecord[] {
  const out: DrawRecord[] = [];
  let d = start;
  for (const v of values) {
    while (![1, 3, 5].includes(weekdayOf(d))) d = addDays(d, 1);
    out.push(mkDraw(d, v));
    d = addDays(d, 1);
  }
  return out;
}

/** Deterministic pseudo-random 4-digit strings (for tests that need "some data", never shown as real data). */
export function pseudoValues(n: number, seed = 1): string[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => String(Math.floor(next() * 10000)).padStart(4, "0"));
}

/* ───────────── HTML fixture matching thelotterytoday's list markup ───────────── */

export interface FixtureRow {
  date: string; // ISO
  r4?: string;
  r3?: string;
  r2?: string;
  /** override the visible date text (to test mismatches) */
  dateText?: string;
}

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function englishDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

export function listPageHtml(rows: FixtureRow[], opts: { page?: number; total?: number; withNext?: boolean } = {}): string {
  const page = opts.page ?? 1;
  const total = opts.total ?? 1;
  const items = rows
    .map((r) => {
      const spans = [r.r4, r.r2, r.r3]
        .filter((x): x is string => x !== undefined)
        .map((n) => `<span class="rounded px-2 py-0.5 text-sm font-semibold tabular-nums">${n}</span>`)
        .join("");
      return `<a href="/en/lottery/lao-lottery/${r.date}" class="flex"><div class="font-medium">${r.dateText ?? englishDate(r.date)}</div> <div class="flex">${spans} <span class="ml-2">→</span></div></a>`;
    })
    .join("\n");
  const next = opts.withNext ?? page < total ? `<a href="/en/lottery/lao-lottery?page=${page + 1}" class="btn">Next →</a>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lao Lottery</title></head><body>
<h1>Lao Lottery</h1>
<a href="/en/lottery/lao-lottery/2099-01-01" class="upcoming"><div>Next draw</div></a>
<section><h2>Recent draw history</h2><div>Page ${page} of ${total}</div><div class="divide-y">${items}</div>${next}</section>
</body></html>`;
}

/* ───────────── local HTTP server ───────────── */

export type Route = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface TestServer {
  url: string;
  hits: string[];
  close(): Promise<void>;
  /** replace routes at runtime */
  routes: Map<string, Route>;
}

export async function startServer(routes: Record<string, Route | string>): Promise<TestServer> {
  const table = new Map<string, Route>();
  for (const [path, r] of Object.entries(routes)) table.set(path, typeof r === "string" ? (_q, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(r); } : r);
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const full = req.url ?? "/";
    hits.push(full);
    const route = table.get(full) ?? table.get(full.split("?")[0]);
    if (!route) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    Promise.resolve(route(req, res)).catch(() => {
      res.statusCode = 500;
      res.end("boom");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    routes: table,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const robotsAllowAll: Route = (_q, res) => {
  res.setHeader("content-type", "text/plain");
  res.end("User-agent: *\nAllow: /\n");
};

export function testHttp(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}): HttpClient {
  return new HttpClient({
    userAgent: "TestBot/1.0",
    timeoutMs: 1500,
    maxRetries: 1,
    delayMs: 0,
    maxBodyBytes: 1_000_000,
    respectRobots: true,
    sleep: async () => {},
    ...overrides,
  });
}

export function htmlSource(baseUrl: string, over: Record<string, unknown> = {}): SourceConfig {
  return {
    id: "fixture-html",
    type: "html-thelotterytoday",
    enabled: true,
    priority: 1,
    expectedWeekdays: [1, 3, 5],
    baseUrl,
    listPath: "/en/lottery/lao-lottery",
    maxPages: 20,
    ...over,
  } as SourceConfig;
}

/** Thai date helper re-export so tests can assert display formatting. */
export { formatThaiDate };
