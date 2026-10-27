import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", testTimeout: 60000, hookTimeout: 120000, fileParallelism: false, env: { DATABASE_URL: "pglite:memory", SUNAT_MODO: "simulado" } },
});
