import { NextRequest } from "next/server";
import { resetEnvCache } from "../../src/lib/config/env";
import { setStore } from "../../src/lib/db";
import { MemoryDrawStore } from "../../src/lib/db/memory-store";
import type { DrawRecord } from "../../src/lib/domain";
import { resetRateLimiters } from "../../src/lib/http/api";
import { clearForecastCache, setSourcesConfigForTests } from "../../src/lib/services";
import type { SourcesConfig } from "../../src/lib/config/sources";
import { pseudoValues, scheduleDraws } from "./fixtures";

type Handler = (req: NextRequest) => Promise<Response>;

export async function call(handler: Handler, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const res = await handler(new NextRequest(`http://localhost:3000${path}`, init));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  return { status: res.status, headers: res.headers, json, text };
}

export async function seed(store: MemoryDrawStore, draws: DrawRecord[], opts: { successfulRun?: boolean } = {}) {
  await store.ingestBatch({
    sourceId: "test",
    lotteryCode: "LAO_DEV",
    priorities: { test: 1 },
    records: draws.map((d) => ({
      drawDate: d.drawDate,
      drawId: d.drawId,
      result4: d.result4,
      result3: d.result3,
      result2: d.result2,
      sourceId: "test",
      sourceUrl: d.sourceUrl,
      fetchedAt: d.fetchedAt,
      extra: null,
      rawPayload: null,
    })),
  });
  if (opts.successfulRun !== false) {
    const run = await store.startRun("test", "test");
    await store.finishRun(run.id, { status: "SUCCESS", inserted: draws.length, recordsParsed: draws.length, recordsValid: draws.length });
  }
}

/** Fresh in-memory store injected as the process-wide store; env and caches reset. */
export function freshApiEnv(env: Record<string, string | undefined> = {}, cfg: SourcesConfig | null = null) {
  const saved: Record<string, string | undefined> = {};
  const defaults: Record<string, string | undefined> = { NODE_ENV: "test", LOG_LEVEL: "silent", RATE_LIMIT_PER_MINUTE: "100000", RATE_LIMIT_HEAVY_PER_MINUTE: "10000", RATE_LIMIT_INGEST_PER_HOUR: "1000", INGEST_TOKEN: undefined };
  for (const [k, v] of Object.entries({ ...defaults, ...env })) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
  resetRateLimiters();
  clearForecastCache();
  const store = new MemoryDrawStore();
  setStore(store);
  setSourcesConfigForTests(cfg);
  return {
    store,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetEnvCache();
      resetRateLimiters();
      setStore(null);
      setSourcesConfigForTests(null);
    },
  };
}

export const standardDraws = (n = 60) => scheduleDraws("2025-10-13", pseudoValues(n, 5));
