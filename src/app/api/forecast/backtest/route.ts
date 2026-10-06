import { apiHandler, envelope, parseQuery } from "@/lib/http/api";
import { forecastQuerySchema } from "@/lib/schemas";
import { getForecast, withoutNextDraw } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/forecast/backtest?target=all|last2|tens|units&minTrain=50&window=expanding|N
 * Walk-forward backtest results (model performance vs. a random baseline). Scores and uncertainty only —
 * numbers for the next draw are served separately by /api/forecast/next-draw.
 */
export const GET = apiHandler({ rate: "heavy", cacheControl: "private, max-age=60" }, async ({ url }) => {
  const q = parseQuery(forecastQuerySchema, url);
  const report = await getForecast(q);
  return envelope(withoutNextDraw(report), { experimental: true });
});
