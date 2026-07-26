import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      include: [
        "apps/*/test/**/*.test.ts",
        "apps/*/test/**/*.test.tsx",
        "packages/*/test/**/*.test.ts",
        "packages/*/test/**/*.test.tsx",
      ],
    },
  },
]);
