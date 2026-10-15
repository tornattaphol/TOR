import { ConfigError, enabledSources, loadSourcesConfig, type SourceConfig, type SourcesConfig } from "../config/sources";
import { getEnv } from "../config/env";
import { todayIn } from "../dates";
import type { DrawStore, RunPatch } from "../db/store";
import type { IngestionErrorCode, IssueInput, RunStatusName } from "../domain";
import { HttpClient, RobotsDisallowedError, SourceUnavailableError } from "../http/client";
import { createLogger } from "../logger";
import { createAdapter } from "./adapters";
import { IngestionError } from "./types";
import { validateRecords } from "./validator";

const log = createLogger("ingestion");

export interface PipelineDeps {
  store: DrawStore;
  config: SourcesConfig;
  http: HttpClient;
  trigger?: string;
  /** Cap pages for paginated sources (incremental refresh). Undefined = source's own maxPages (full backfill). */
  maxPages?: number;
  /** Injectable "today" for deterministic tests. */
  today?: string;
  env?: Record<string, string | undefined>;
}

export interface IngestionOutcome {
  sourceId: string;
  runId: number;
  status: RunStatusName;
  errorCode: IngestionErrorCode | null;
  errorMessage: string | null;
  pagesFetched: number;
  recordsParsed: number;
  recordsValid: number;
  inserted: number;
  updated: number;
  unchanged: number;
  quarantined: number;
  invalid: number;
  duplicates: number;
  conflicts: number;
}

export function createHttpClientFromEnv(): HttpClient {
  const env = getEnv();
  return new HttpClient({
    userAgent: env.INGEST_USER_AGENT,
    timeoutMs: env.INGEST_TIMEOUT_MS,
    maxRetries: env.INGEST_MAX_RETRIES,
    delayMs: env.INGEST_REQUEST_DELAY_MS,
    maxBodyBytes: env.INGEST_MAX_BODY_BYTES,
    respectRobots: true,
  });
}

function classify(e: unknown): { code: IngestionErrorCode; message: string } {
  if (e instanceof IngestionError) return { code: e.code, message: e.message };
  if (e instanceof SourceUnavailableError) return { code: "SOURCE_UNAVAILABLE", message: e.message };
  if (e instanceof RobotsDisallowedError) return { code: "ROBOTS_DISALLOWED", message: e.message };
  if (e instanceof ConfigError) return { code: "CONFIG_ERROR", message: e.message };
  // Never leak connection strings or stack traces into stored run records.
  const raw = e instanceof Error ? e.message : String(e);
  return { code: "UNEXPECTED", message: raw.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 500) };
}

/**
 * Source → Parser → Validator → Database for one source.
 * Guarantee: if the source is unreachable, empty, or yields no valid record, NOTHING is written to the
 * draw tables; the run is recorded as FAILED with an explicit error code.
 */
export async function ingestSource(source: SourceConfig, deps: PipelineDeps): Promise<IngestionOutcome> {
  const { store, config, http } = deps;
  const run = await store.startRun(source.id, deps.trigger ?? "cli");
  const counters = { pagesFetched: 0, recordsParsed: 0, recordsValid: 0, inserted: 0, updated: 0, unchanged: 0, quarantined: 0, invalid: 0, duplicates: 0, conflicts: 0 };
  log.info("run_started", { source: source.id, runId: run.id, trigger: run.trigger });

  const finish = async (status: RunStatusName, err?: { code: IngestionErrorCode; message: string }): Promise<IngestionOutcome> => {
    const patch: RunPatch = { status, ...counters, errorCode: err?.code ?? null, errorMessage: err?.message ?? null };
    await store.finishRun(run.id, patch);
    const outcome: IngestionOutcome = { sourceId: source.id, runId: run.id, status, errorCode: err?.code ?? null, errorMessage: err?.message ?? null, ...counters };
    log[status === "FAILED" ? "error" : "info"]("run_finished", { ...outcome });
    return outcome;
  };

  try {
    const adapter = createAdapter(source, { http, maxPages: deps.maxPages, env: deps.env });
    const collected = await adapter.collect();
    counters.pagesFetched = collected.pagesFetched;
    counters.recordsParsed = collected.records.length;
    for (const w of collected.warnings) log.warn("parser_warning", { source: source.id, warning: w });

    if (collected.records.length === 0) {
      throw new IngestionError("EMPTY_RESPONSE", `Source "${source.id}" responded but contained no draw results`);
    }

    const validation = validateRecords(collected.records, {
      sourceId: source.id,
      lotteryCode: config.lotteryCode,
      expectedWeekdays: source.expectedWeekdays,
      today: deps.today ?? todayIn("Asia/Vientiane"),
    });
    counters.recordsValid = validation.valid.length;
    counters.invalid = validation.counts.invalid;
    counters.quarantined = validation.counts.quarantined;
    counters.duplicates = validation.counts.duplicates;
    counters.conflicts = validation.counts.conflicts;

    if (validation.valid.length === 0) {
      await store.saveIssues(validation.issues, run.id); // keep the evidence even though nothing is stored
      throw new IngestionError("NO_VALID_RECORDS", `All ${collected.records.length} parsed records were rejected by validation`);
    }

    const priorities = Object.fromEntries(config.sources.map((s) => [s.id, s.priority]));
    const batch = await store.ingestBatch({ sourceId: source.id, lotteryCode: config.lotteryCode, priorities, records: validation.valid });
    counters.inserted = batch.inserted;
    counters.updated = batch.updated;
    counters.unchanged = batch.unchanged;
    counters.conflicts += batch.conflicts.length;

    const conflictIssues: IssueInput[] = batch.conflicts.map((c) =>
      c.reason === "cross_source"
        ? {
            kind: "SOURCE_CONFLICT",
            severity: "ERROR",
            sourceId: source.id,
            drawDate: c.drawDate,
            message: `Sources disagree for ${c.drawDate}: ${(c.details.values as { sourceId: string; result4: string | null; result3: string | null; result2: string }[])
              .map((v) => `${v.sourceId}=${v.result4 ?? "-"}/${v.result3 ?? "-"}/${v.result2}`)
              .join(" vs ")}`,
            details: { reason: c.reason, ...c.details },
          }
        : {
            kind: "SOURCE_CONFLICT",
            severity: "WARNING",
            sourceId: source.id,
            drawDate: c.drawDate,
            message: `Source "${source.id}" changed the published result for ${c.drawDate}`,
            details: { reason: c.reason, ...c.details },
          },
    );
    await store.saveIssues([...validation.issues, ...conflictIssues], run.id);

    const dirty = counters.invalid + counters.quarantined + counters.conflicts > 0;
    return await finish(dirty ? "PARTIAL" : "SUCCESS");
  } catch (e) {
    const err = classify(e);
    return await finish("FAILED", err);
  }
}

/** Runs every enabled source (optionally a subset). Sources are independent: one failing does not stop the rest. */
export async function ingestAll(deps: Omit<PipelineDeps, "config"> & { config?: SourcesConfig; only?: string[] }): Promise<IngestionOutcome[]> {
  const config = deps.config ?? loadSourcesConfig();
  let sources = enabledSources(config);
  if (deps.only?.length) {
    const unknown = deps.only.filter((id) => !config.sources.some((s) => s.id === id));
    if (unknown.length) throw new ConfigError(`Unknown source id(s): ${unknown.join(", ")}`);
    sources = config.sources.filter((s) => deps.only?.includes(s.id)).sort((a, b) => a.priority - b.priority);
  }
  const outcomes: IngestionOutcome[] = [];
  for (const s of sources) outcomes.push(await ingestSource(s, { ...deps, config }));
  return outcomes;
}
