/**
 * Vitest configuration for the marketplace test suite.
 *
 * Unit tests: fast, no infrastructure dependencies.
 * Integration tests: require running PostgreSQL + Redis (docker compose up -d).
 *
 * Run all:         pnpm test
 * Run unit only:   pnpm test:unit
 * Run integration: pnpm test:integration
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Load .env.test for integration tests
    setupFiles: [],
    // Separate pools for unit vs integration to avoid port conflicts
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/.gitkeep",
        "**/vitest.config.*",
      ],
    },
  },
  resolve: {
    alias: {
      "@marketplace/database": path.resolve(
        __dirname,
        "../packages/database/src/index.ts",
      ),
      "@marketplace/env": path.resolve(
        __dirname,
        "../packages/env/src/server.ts",
      ),
      "@marketplace/shared": path.resolve(
        __dirname,
        "../packages/shared/src/index.ts",
      ),
      // Server src alias
      "@": path.resolve(__dirname, "../apps/server/src"),
    },
  },
});
