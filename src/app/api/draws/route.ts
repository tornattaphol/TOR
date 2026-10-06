import { getStore } from "@/lib/db";
import { apiHandler, envelope, parseQuery } from "@/lib/http/api";
import { drawsQuerySchema } from "@/lib/schemas";
import { getDatasetMeta } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/draws — paginated historical results (each row carries its source, source URL and fetch time). */
export const GET = apiHandler({}, async ({ url }) => {
  const q = parseQuery(drawsQuerySchema, url);
  const store = getStore();
  const [rows, total, meta] = await Promise.all([
    store.findDraws({ from: q.from, to: q.to, order: q.order, limit: q.limit, offset: q.offset }),
    store.countDraws({ from: q.from, to: q.to }),
    getDatasetMeta(store),
  ]);
  return envelope({ rows, total, limit: q.limit, offset: q.offset, order: q.order }, { lastUpdated: meta.lastUpdated, sources: meta.sources });
});
