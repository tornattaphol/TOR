import { getEnv } from "@/lib/config/env";
import { getStore } from "@/lib/db";
import { ApiError, apiHandler, envelope, requireBearer } from "@/lib/http/api";
import { createHttpClientFromEnv, ingestAll } from "@/lib/ingestion/pipeline";
import { ingestBodySchema } from "@/lib/schemas";
import { clearForecastCache, getSourcesConfig } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let running = false;

async function readJsonBody(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 10_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป");
  const text = await req.text();
  if (text.length > 10_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "เนื้อหาต้องเป็น JSON");
  }
}

/**
 * POST /api/ingest — trigger a data refresh. Requires `Authorization: Bearer <INGEST_TOKEN>`.
 * Body (optional): { "source": "thelotterytoday", "full": false, "maxPages": 2 }
 */
export const POST = apiHandler({ rate: "ingest" }, async ({ req }) => {
  requireBearer(req, getEnv().INGEST_TOKEN);
  const body = ingestBodySchema.parse(await readJsonBody(req));
  const config = getSourcesConfig();
  if (body.source && !config.sources.some((s) => s.id === body.source)) {
    throw new ApiError(400, "UNKNOWN_SOURCE", `ไม่พบแหล่งข้อมูล "${body.source}" ในการตั้งค่า`);
  }
  if (running) throw new ApiError(409, "ALREADY_RUNNING", "กำลังดึงข้อมูลอยู่แล้ว");
  running = true;
  try {
    const outcomes = await ingestAll({
      store: getStore(),
      config,
      http: createHttpClientFromEnv(),
      trigger: "api",
      maxPages: body.maxPages ?? (body.full ? undefined : 2),
      only: body.source ? [body.source] : undefined,
    });
    clearForecastCache();
    return envelope({ outcomes });
  } finally {
    running = false;
  }
});
