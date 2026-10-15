import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CsvSourceConfig, HtmlSourceConfig, JsonSourceConfig, SourceConfig } from "../config/sources";
import type { HttpClient } from "../http/client";
import { createLogger } from "../logger";
import { parseCsvRecords } from "./parsers/csv";
import { parseJsonRecords } from "./parsers/json";
import { parseTheLotteryTodayList } from "./parsers/thelotterytoday";
import { IngestionError, type CollectResult, type RawRecord } from "./types";

const log = createLogger("adapter");

export interface AdapterContext {
  http: HttpClient;
  /** Cap on pages for paginated sources (incremental refresh uses a small number). */
  maxPages?: number;
  env?: Record<string, string | undefined>;
  maxFileBytes?: number;
}

export interface SourceAdapter {
  collect(): Promise<CollectResult>;
}

/** Source layer: knows HOW to fetch (HTTP, pagination, file) and delegates interpretation to a parser. */
export function createAdapter(cfg: SourceConfig, ctx: AdapterContext): SourceAdapter {
  switch (cfg.type) {
    case "html-thelotterytoday":
      return new TheLotteryTodayAdapter(cfg, ctx);
    case "csv":
      return new CsvAdapter(cfg, ctx);
    case "json":
      return new JsonAdapter(cfg, ctx);
  }
}

class TheLotteryTodayAdapter implements SourceAdapter {
  constructor(
    private cfg: HtmlSourceConfig,
    private ctx: AdapterContext,
  ) {}

  async collect(): Promise<CollectResult> {
    const limit = Math.min(this.ctx.maxPages ?? this.cfg.maxPages, this.cfg.maxPages);
    const records: RawRecord[] = [];
    const warnings: string[] = [];
    let total: number | null = null;
    let pages = 0;

    for (let page = 1; page <= limit; page++) {
      // The host is always the configured one: we never follow hrefs found in page content.
      const url = new URL(this.cfg.listPath, this.cfg.baseUrl);
      if (page > 1) url.searchParams.set("page", String(page));

      const res = await this.ctx.http.get(url.toString());
      pages++;
      if (!/html/i.test(res.contentType)) {
        throw new IngestionError("PARSE_ERROR", `Expected HTML but got "${res.contentType || "unknown"}" from ${url.host}`);
      }
      const parsed = parseTheLotteryTodayList(res.body, res.url, res.fetchedAt);
      if (!parsed.layoutRecognised) {
        throw new IngestionError(
          "LAYOUT_CHANGED",
          `Page ${page} of ${this.cfg.id} does not contain the expected result list markup — the site layout may have changed`,
        );
      }
      warnings.push(...parsed.warnings);
      records.push(...parsed.records);
      if (page === 1) total = parsed.totalPages;
      log.info("page_parsed", { source: this.cfg.id, page, rows: parsed.records.length, totalPages: total });

      if (parsed.records.length === 0) break;
      if (total !== null ? page >= total : !parsed.nextHref) break;
    }
    return { pagesFetched: pages, records, warnings };
  }
}

class CsvAdapter implements SourceAdapter {
  constructor(
    private cfg: CsvSourceConfig,
    private ctx: AdapterContext,
  ) {}

  async collect(): Promise<CollectResult> {
    let text: string;
    let sourceUrl: string;
    let fetchedAt: string;
    if (this.cfg.url) {
      const res = await this.ctx.http.get(this.cfg.url);
      text = res.body;
      sourceUrl = res.url;
      fetchedAt = res.fetchedAt;
    } else {
      // Operator-configured local CSV path, read at runtime on purpose.
      const file = resolve(/*turbopackIgnore: true*/ process.cwd(), this.cfg.path as string);
      const max = this.ctx.maxFileBytes ?? 20_000_000;
      const info = await stat(file).catch((e: Error) => {
        throw new IngestionError("SOURCE_UNAVAILABLE", `Cannot read CSV file: ${e.message}`);
      });
      if (info.size > max) throw new IngestionError("PARSE_ERROR", `CSV file exceeds ${max} bytes`);
      text = await readFile(file, "utf8");
      sourceUrl = `file:${this.cfg.path}`;
      fetchedAt = new Date().toISOString();
    }
    const parsed = parseCsvRecords(text, this.cfg, sourceUrl, fetchedAt);
    if (!parsed.layoutRecognised) throw new IngestionError("LAYOUT_CHANGED", parsed.warnings.join("; "));
    return { pagesFetched: 1, records: parsed.records, warnings: parsed.warnings };
  }
}

class JsonAdapter implements SourceAdapter {
  constructor(
    private cfg: JsonSourceConfig,
    private ctx: AdapterContext,
  ) {}

  async collect(): Promise<CollectResult> {
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) {
      const key = (this.ctx.env ?? process.env)[this.cfg.apiKey.env];
      if (!key) {
        throw new IngestionError("CONFIG_ERROR", `Environment variable ${this.cfg.apiKey.env} (API key for "${this.cfg.id}") is not set`);
      }
      headers[this.cfg.apiKey.header] = `${this.cfg.apiKey.prefix}${key}`;
    }
    const res = await this.ctx.http.get(this.cfg.url, headers);
    const parsed = parseJsonRecords(res.body, this.cfg, res.url, res.fetchedAt);
    if (!parsed.layoutRecognised) throw new IngestionError("LAYOUT_CHANGED", parsed.warnings.join("; "));
    return { pagesFetched: 1, records: parsed.records, warnings: parsed.warnings };
  }
}
