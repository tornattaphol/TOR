import { apiHandler, envelope } from "@/lib/http/api";
import { getHealth, getSourcesConfig } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/health — Data Health report (record counts, anomalies, duplicates, missing draws, freshness). */
export const GET = apiHandler({}, async () => {
  let cfg = null;
  try {
    cfg = getSourcesConfig();
  } catch {
    // reported by /api/sources
  }
  return envelope(await getHealth(undefined, cfg));
});
