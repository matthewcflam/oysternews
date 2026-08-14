import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * HANDOFF.md §7: Vitest for units, Playwright for E2E. Only the units exist so
 * far — the six pure modules in worker/ hold nearly all the logic and nearly all
 * the risk, and need no network to test.
 *
 * The alias mirrors tsconfig's `@/*`, so worker modules import `@/lib/types` the
 * same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    // `scripts/` is here for one file: the tippecanoe version guard. It is the
    // only shell script in the repo whose failure mode is silent corruption of a
    // published archive (§2.4), so it is the only one worth executing in a test.
    include: ["worker/**/*.test.ts", "lib/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
