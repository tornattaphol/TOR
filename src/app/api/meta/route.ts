import { apiHandler, envelope } from "@/lib/http/api";
import { expectedWeekdays, getDatasetMeta, getSourcesConfig } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/meta — dataset summary: latest draw, total draws, last updated, data sources. */
export const GET = apiHandler({}, async () => {
  const meta = await getDatasetMeta();
  let weekdays = [1, 3, 5];
  try {
    weekdays = expectedWeekdays(getSourcesConfig());
  } catch {
    // config problems are surfaced by /api/sources; the summary still works
  }
  return envelope({ ...meta, expectedWeekdays: weekdays });
});
