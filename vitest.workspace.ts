import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      // Match the root configuration so large recovery/compilation fixtures do not contend unboundedly.
      maxWorkers: 2,
      testTimeout: 15_000,
      include: [
        "apps/*/test/**/*.test.ts",
        "apps/*/test/**/*.test.tsx",
        "packages/*/test/**/*.test.ts",
        "packages/*/test/**/*.test.tsx",
      ],
    },
  },
]);
