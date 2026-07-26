import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.tsx",
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
    ],
    maxWorkers: 4,
  },
});
