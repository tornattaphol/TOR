import { buildAnalytics } from "@/lib/analytics";
import { getStore } from "@/lib/db";
import { apiHandler, envelope, parseQuery } from "@/lib/http/api";
import { filterSchema } from "@/lib/schemas";
import { getDatasetMeta } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics?prize=2|3|4&from=&to=&last=10|20|50|100|all&movingWindow=10
 * Historical descriptive statistics only.
 */
export const GET = apiHandler({ cacheControl: "private, max-age=30" }, async ({ url }) => {
  const q = parseQuery(filterSchema, url);
  const store = getStore();
  const [draws, meta] = await Promise.all([store.findDraws(), getDatasetMeta(store)]);
  const bundle = buildAnalytics(draws, { prize: q.prize, from: q.from, to: q.to, last: q.last }, { movingWindow: q.movingWindow });
  return envelope(bundle, {
    empty: bundle.selection.drawCount === 0,
    lastUpdated: meta.lastUpdated,
    totalDraws: meta.totalDraws,
    sources: meta.sources,
  });
});
