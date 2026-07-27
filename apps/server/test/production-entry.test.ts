import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("loads the compiled server entry with Node package exports", () => {
  const entry = pathToFileURL(resolve("apps/server/dist/app.js")).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(entry)})`],
    { encoding: "utf8" },
  );

  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
});
