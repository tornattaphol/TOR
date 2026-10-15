import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts", "tests/ingestion/**/*.test.ts"],
    env: { LOG_LEVEL: "silent" },
    testTimeout: 30_000,
  },
});
