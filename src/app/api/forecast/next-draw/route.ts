import { apiHandler, envelope, parseQuery } from "@/lib/http/api";
import { FORECAST_PURPOSE } from "@/lib/disclaimer";
import { trimNextDraw } from "@/lib/forecasting";
import { nextDrawQuerySchema } from "@/lib/schemas";
import { getForecast } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/forecast/next-draw?target=all|last2|tens|units&top=10&minTrain=50&window=expanding|N
 * EXPERIMENTAL model output: every model's ranking of the values for the next draw, with its probability,
 * bootstrap uncertainty and — always — the model's backtest verdict. Not betting advice.
 */
export const GET = apiHandler({ rate: "heavy", cacheControl: "private, max-age=60" }, async ({ url }) => {
  const { top, ...params } = parseQuery(nextDrawQuerySchema, url);
  const report = await getForecast(params);
  return envelope(
    {
      status: report.status,
      message: report.message,
      dataRange: report.dataRange,
      conclusion: report.conclusion,
      nextDraw: report.nextDraw ? trimNextDraw(report.nextDraw, top) : null,
    },
    { experimental: true, purpose: FORECAST_PURPOSE },
  );
});
