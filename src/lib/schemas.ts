import { z } from "zod";
import { isValidIsoDate } from "./dates";

const isoDate = z.string().refine(isValidIsoDate, "วันที่ต้องเป็นรูปแบบ YYYY-MM-DD ที่มีอยู่จริง");

/** "all" or a positive integer; "all" → undefined (no limit). */
const lastDraws = z
  .union([z.literal("all"), z.coerce.number().int().min(1).max(5000)])
  .transform((v) => (v === "all" ? undefined : v));

export const filterSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    last: lastDraws.optional(),
    prize: z.enum(["2", "3", "4"]).default("2"),
    movingWindow: z.coerce.number().int().min(2).max(60).default(10),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from ต้องไม่เกิน to", path: ["from"] });

export type FilterQuery = z.infer<typeof filterSchema>;

export const drawsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(20),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from ต้องไม่เกิน to", path: ["from"] });

export const forecastQuerySchema = z.object({
  target: z.enum(["all", "last2", "tens", "units"]).default("all"),
  minTrain: z.coerce.number().int().min(30).max(200).default(50),
  window: z
    .union([z.literal("expanding"), z.coerce.number().int().min(20).max(500)])
    .default("expanding"),
  last: lastDraws.optional(),
});

/** Same experiment parameters as the backtest, plus how many ranked values to return per model. */
export const nextDrawQuerySchema = forecastQuerySchema.extend({
  top: z.coerce.number().int().min(1).max(100).default(10),
});

export const ingestBodySchema = z
  .object({
    source: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/).optional(),
    full: z.boolean().default(false),
    maxPages: z.number().int().min(1).max(100).optional(),
  })
  .strict();
