import { createHash } from "node:crypto";
import { loadSourcesConfig, type SourcesConfig } from "./config/sources";
import { getStore } from "./db";
import type { DrawStore } from "./db/store";
import { todayIn } from "./dates";
import type { DrawRecord } from "./domain";
import { runForecastExperiment, type ForecastReport } from "./forecasting";
import { buildHealthReport } from "./quality";
import { selectDraws } from "./analytics";
import type { forecastQuerySchema } from "./schemas";
import type { z } from "zod";

let cachedConfig: SourcesConfig | null = null;

/** Sources config is static for the life of the process. */
export function getSourcesConfig(): SourcesConfig {
  if (!cachedConfig) cachedConfig = loadSourcesConfig();
  return cachedConfig;
}

export function setSourcesConfigForTests(cfg: SourcesConfig | null) {
  cachedConfig = cfg;
}

/** Expected draw weekdays: taken from the highest-priority enabled source (fallback Mon/Wed/Fri). */
export function expectedWeekdays(cfg: SourcesConfig | null): number[] {
  const primary = cfg?.sources.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority)[0];
  return primary?.expectedWeekdays ?? [1, 3, 5];
}

export interface DatasetMeta {
  totalDraws: number;
  firstDate: string | null;
  latestDraw: DrawRecord | null;
  /** When the most recent successful ingestion run finished. */
  lastUpdated: string | null;
  sources: { id: string; draws: number }[];
}

export async function getDatasetMeta(store: DrawStore = getStore()): Promise<DatasetMeta> {
  const [all, latest, lastUpdated] = await Promise.all([store.findDraws(), store.getLatestDraw(), store.lastSuccessfulRunAt()]);
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.source, (counts.get(d.source) ?? 0) + 1);
  return {
    totalDraws: all.length,
    firstDate: all[0]?.drawDate ?? null,
    latestDraw: latest,
    lastUpdated,
    sources: [...counts.entries()].map(([id, draws]) => ({ id, draws })),
  };
}

export async function getHealth(store: DrawStore = getStore(), cfg: SourcesConfig | null = null) {
  const [draws, issues, issueCounts, runs, lastOk] = await Promise.all([
    store.findDraws(),
    store.listIssues({ limit: 200 }),
    store.issueCounts(),
    store.listRuns(15),
    store.lastSuccessfulRunAt(),
  ]);
  return buildHealthReport({ draws, issues, issueCounts, runs, lastSuccessfulRunAt: lastOk, expectedWeekdays: expectedWeekdays(cfg), today: todayIn("Asia/Vientiane") });
}

// ---- forecast with a tiny LRU cache (data-versioned) ------------------------------------------------

const forecastCache = new Map<string, ForecastReport>();
const CACHE_MAX = 20;

function dataVersion(draws: DrawRecord[]): string {
  const h = createHash("sha1");
  for (const d of draws) h.update(`${d.drawDate}:${d.result4 ?? ""}:${d.result3 ?? ""}:${d.result2};`);
  return `${draws.length}:${h.digest("hex").slice(0, 16)}`;
}

export function clearForecastCache() {
  forecastCache.clear();
}

export async function getForecast(params: z.infer<typeof forecastQuerySchema>, store: DrawStore = getStore()): Promise<ForecastReport> {
  const all = await store.findDraws();
  const draws = selectDraws(all, { last: params.last });
  const key = `${dataVersion(draws)}|${JSON.stringify(params)}`;
  let report = forecastCache.get(key);
  if (!report) {
    report = runForecastExperiment(draws, {
      config: { minTrain: params.minTrain, trainWindow: params.window === "expanding" ? null : params.window },
      targets: params.target === "all" ? undefined : [params.target],
      nextDraw: { expectedWeekdays: expectedWeekdays(getSourcesConfig()) },
    });
    forecastCache.set(key, report);
    if (forecastCache.size > CACHE_MAX) forecastCache.delete(forecastCache.keys().next().value as string);
  }
  // "today" changes while the cached report does not: evaluate staleness per request.
  const nd = report.nextDraw;
  if (nd?.nextScheduledDate) {
    const passed = nd.nextScheduledDate < todayIn("Asia/Vientiane");
    if (passed !== nd.scheduledDatePassed) return { ...report, nextDraw: { ...nd, scheduledDatePassed: passed } };
  }
  return report;
}

/** Backtest view: scores and uncertainty only — the next-draw ranking is deliberately left out. */
export function withoutNextDraw(report: ForecastReport): Omit<ForecastReport, "nextDraw"> {
  const { nextDraw: _omit, ...scores } = report;
  void _omit;
  return scores;
}
