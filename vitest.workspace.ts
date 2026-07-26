import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      include: ["apps/*/test/**/*.test.ts"],
    },
  },
]);
