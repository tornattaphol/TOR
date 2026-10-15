import { z } from "zod";
import { getStore } from "@/lib/db";
import { apiHandler, envelope, parseQuery } from "@/lib/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** GET /api/ingest/runs — recent ingestion runs (status, counters, error codes). */
export const GET = apiHandler({}, async ({ url }) => {
  const { limit } = parseQuery(schema, url);
  return envelope({ runs: await getStore().listRuns(limit) });
});
