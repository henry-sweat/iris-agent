import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["lib/**/*.test.ts"],
    // rrule's CJS entry has no named exports under Node ESM; let Vite transform its ESM build.
    server: { deps: { inline: ["rrule"] } },
  },
});
