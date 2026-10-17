import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Vitest 4 config type doesn't expose poolOptions in InlineConfig, but the
// runtime accepts it. Cast the config to bypass the type check.
const config = {
  test: {
    environment: "node",
    // All tests share one PostgreSQL DB; run sequentially to avoid conflicts.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/lib/**", "src/modules/**"],
      exclude: ["**/*.test.ts", "**/__tests__/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
};

export default defineConfig(config as never);
