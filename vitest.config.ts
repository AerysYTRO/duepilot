import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Root Vitest config: discovers tests across all workspace packages via
// tsconfig path aliases (@duepilot/core, @duepilot/i18n, …) so pure-logic
// tests run without building the packages first. UI-component tests live in
// their own packages/apps with dedicated configs when introduced (Phase 2+).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/desktop/e2e/**"],
    globals: false,
  },
});
