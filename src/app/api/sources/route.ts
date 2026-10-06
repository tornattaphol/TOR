import { getStore } from "@/lib/db";
import { apiHandler, envelope } from "@/lib/http/api";
import { getSourcesConfig } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/sources — configured data sources and the status of their latest ingestion run (no secrets). */
export const GET = apiHandler({}, async () => {
  const cfg = getSourcesConfig();
  const runs = await getStore().listRuns(100);
  const sources = cfg.sources.map((s) => {
    const location = s.type === "html-thelotterytoday" ? s.baseUrl + s.listPath : s.type === "json" ? s.url : (s.url ?? "local file");
    let host: string | null = null;
    try {
      host = new URL(location).host;
    } catch {
      host = null;
    }
    const last = runs.find((r) => r.sourceId === s.id) ?? null;
    return {
      id: s.id,
      type: s.type,
      enabled: s.enabled,
      priority: s.priority,
      description: s.description ?? null,
      host,
      expectedWeekdays: s.expectedWeekdays,
      requiresApiKey: s.type === "json" && Boolean(s.apiKey),
      lastRun: last && {
        status: last.status,
        startedAt: last.startedAt,
        finishedAt: last.finishedAt,
        errorCode: last.errorCode,
        errorMessage: last.errorMessage,
        recordsValid: last.recordsValid,
        inserted: last.inserted,
        updated: last.updated,
        invalid: last.invalid,
      },
    };
  });
  return envelope({ lotteryCode: cfg.lotteryCode, sources });
});
