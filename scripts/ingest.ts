/**
 * Data refresh CLI.
 *
 *   npm run ingest                      # incremental: first 2 pages of each enabled source
 *   npm run ingest:full                 # backfill: every page the source offers (up to its maxPages)
 *   npm run ingest -- --source=thelotterytoday --max-pages=5
 *
 * Exit code: 0 = all sources SUCCESS/PARTIAL, 1 = at least one FAILED, 2 = bad usage/config.
 */
import "dotenv/config";
import { getPrisma } from "../src/lib/db/prisma";
import { PrismaDrawStore } from "../src/lib/db/prisma-store";
import { loadSourcesConfig } from "../src/lib/config/sources";
import { createHttpClientFromEnv, ingestAll } from "../src/lib/ingestion/pipeline";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const full = arg("full") === "true";
  const only = arg("source")?.split(",").filter(Boolean);
  const maxPagesArg = arg("max-pages");
  const maxPages = maxPagesArg ? Number(maxPagesArg) : full ? undefined : 2;
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
    console.error("--max-pages must be a positive integer");
    process.exit(2);
  }

  const config = loadSourcesConfig();
  const store = new PrismaDrawStore(getPrisma(), config.lotteryCode);
  try {
    const outcomes = await ingestAll({ store, config, http: createHttpClientFromEnv(), trigger: "cli", maxPages, only });
    console.log("\n=== Ingestion summary ===");
    for (const o of outcomes) {
      console.log(
        `${o.status.padEnd(8)} ${o.sourceId}  pages=${o.pagesFetched} parsed=${o.recordsParsed} valid=${o.recordsValid} ` +
          `inserted=${o.inserted} updated=${o.updated} unchanged=${o.unchanged} invalid=${o.invalid} ` +
          `quarantined=${o.quarantined} conflicts=${o.conflicts}` +
          (o.errorCode ? `\n         ERROR ${o.errorCode}: ${o.errorMessage}` : ""),
      );
    }
    if (outcomes.length === 0) console.log("No enabled sources. Check config/sources.json / SOURCES_ENABLED.");
    process.exitCode = outcomes.some((o) => o.status === "FAILED") ? 1 : 0;
  } finally {
    await store.close();
  }
}

main().catch((e) => {
  console.error("Ingestion aborted:", e instanceof Error ? e.message : e);
  process.exit(2);
});
