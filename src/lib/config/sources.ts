import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { getEnv } from "./env";

/** Column/field reference: header name or dot-path (strings) or column index (numbers, CSV only). */
const fieldRef = z.union([z.string().min(1), z.number().int().min(0)]);

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs are allowed");

const common = {
  /** Stable identifier stored in every record (`source`). */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/, "id must be lowercase letters, digits, - or _"),
  enabled: z.boolean().default(true),
  /** Conflict resolution: lower number wins as the canonical source. */
  priority: z.number().int().min(1).default(10),
  /** Draw days (0=Sun … 6=Sat). Records on other weekdays are quarantined as UNEXPECTED_WEEKDAY. */
  expectedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 3, 5]),
  description: z.string().optional(),
};

const dateFormat = z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY"]).default("YYYY-MM-DD");

const columns = z.object({
  date: fieldRef,
  result4: fieldRef.optional(),
  result3: fieldRef.optional(),
  result2: fieldRef.optional(),
});

export const htmlSourceSchema = z.object({
  ...common,
  type: z.literal("html-thelotterytoday"),
  baseUrl: httpUrl,
  listPath: z.string().startsWith("/"),
  maxPages: z.number().int().min(1).max(100).default(20),
});

export const csvSourceSchema = z.object({
  ...common,
  type: z.literal("csv"),
  url: httpUrl.optional(),
  path: z.string().min(1).optional(),
  delimiter: z.string().length(1).default(","),
  hasHeader: z.boolean().default(true),
  columns,
  dateFormat,
  buddhistEra: z.boolean().default(false),
});

export const jsonSourceSchema = z.object({
  ...common,
  type: z.literal("json"),
  url: httpUrl,
  /** Dot path to the array of records inside the response ("" = response is the array). */
  recordsPath: z.string().default(""),
  fields: columns,
  dateFormat,
  buddhistEra: z.boolean().default(false),
  /** API key is read from process.env[apiKey.env]; the key itself never lives in the config file. */
  apiKey: z
    .object({
      env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      header: z.string().default("Authorization"),
      prefix: z.string().default("Bearer "),
    })
    .optional(),
});

export const sourceSchema = z.discriminatedUnion("type", [htmlSourceSchema, csvSourceSchema, jsonSourceSchema]);

export const configFileSchema = z.object({
  lotteryCode: z.string().regex(/^[A-Z0-9_]{2,20}$/).default("LAO_DEV"),
  sources: z.array(sourceSchema).min(1),
});

export type SourceConfig = z.infer<typeof sourceSchema>;
export type HtmlSourceConfig = z.infer<typeof htmlSourceSchema>;
export type CsvSourceConfig = z.infer<typeof csvSourceSchema>;
export type JsonSourceConfig = z.infer<typeof jsonSourceSchema>;
export type SourcesConfig = { lotteryCode: string; sources: SourceConfig[] };

export class ConfigError extends Error {
  readonly code = "CONFIG_ERROR" as const;
}

/** Parse + validate a config object. Exported for tests. */
export function parseSourcesConfig(raw: unknown, enabledOverride?: string): SourcesConfig {
  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid sources config — ${msg}`);
  }
  const cfg = parsed.data;
  const ids = new Set<string>();
  for (const s of cfg.sources) {
    if (ids.has(s.id)) throw new ConfigError(`Duplicate source id "${s.id}"`);
    ids.add(s.id);
    if (s.type === "csv" && Boolean(s.url) === Boolean(s.path)) {
      throw new ConfigError(`Source "${s.id}": provide exactly one of url or path`);
    }
  }
  let sources = cfg.sources as SourceConfig[];
  if (enabledOverride && enabledOverride.trim()) {
    const wanted = new Set(enabledOverride.split(",").map((s) => s.trim()).filter(Boolean));
    for (const w of wanted) if (!ids.has(w)) throw new ConfigError(`SOURCES_ENABLED refers to unknown source "${w}"`);
    sources = sources.map((s) => ({ ...s, enabled: wanted.has(s.id) }));
  }
  return { lotteryCode: cfg.lotteryCode, sources };
}

/** Load config/sources.json (or SOURCES_CONFIG_PATH). */
export function loadSourcesConfig(path?: string): SourcesConfig {
  const env = getEnv();
  // Operator-configured path read at runtime on purpose (not a build-time asset).
  const file = resolve(/*turbopackIgnore: true*/ process.cwd(), path ?? env.SOURCES_CONFIG_PATH);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new ConfigError(`Cannot read sources config at ${file}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`Sources config is not valid JSON: ${(e as Error).message}`);
  }
  return parseSourcesConfig(json, env.SOURCES_ENABLED);
}

export function enabledSources(cfg: SourcesConfig): SourceConfig[] {
  return cfg.sources.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);
}
