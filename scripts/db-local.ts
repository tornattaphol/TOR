/**
 * Starts a real PostgreSQL server (embedded-postgres) for local development.
 * Use only when no system PostgreSQL / Docker is available. Production must use DATABASE_URL.
 *
 *   npm run db:local            # persistent data in ./.data/pg, port 5433
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const dir = resolve(process.env.LOCAL_PG_DIR ?? ".data/pg");
const database = process.env.LOCAL_PG_DB ?? "lao_lottery";
const user = "postgres";
const password = "postgres";

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user,
    password,
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  if (!existsSync(resolve(dir, "PG_VERSION"))) {
    console.log(`[db-local] initialising cluster at ${dir}`);
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
    console.log(`[db-local] created database "${database}"`);
  } catch {
    // already exists
  }

  console.log(`[db-local] PostgreSQL ready:`);
  console.log(`  DATABASE_URL="postgresql://${user}:${password}@localhost:${port}/${database}?schema=public"`);
  console.log(`[db-local] press Ctrl+C to stop`);

  const stop = async () => {
    console.log("\n[db-local] stopping...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[db-local] failed:", err);
  process.exit(1);
});
