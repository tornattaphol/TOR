import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests run against a REAL PostgreSQL (embedded-postgres, started by the tests themselves).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    env: { LOG_LEVEL: "silent" },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
