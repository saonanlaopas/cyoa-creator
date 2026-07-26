import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileSugarCube, renderTwee } from "../src/index.js";
import { exportFixture } from "./render-twee.test.js";

describe("compileSugarCube", () => {
  it("writes a self-contained playable HTML fallback atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "story-export-"));
    const outputPath = join(directory, "story.html");
    const result = await compileSugarCube(renderTwee(exportFixture()), outputPath, {
      tweegoPath: join(directory, "not-installed"),
    });
    const html = await readFile(outputPath, "utf8");
    expect(result).toMatchObject({ compiler: "fallback", outputPath });
    expect(result.bytes).toBeGreaterThan(1_000);
    expect(html).toContain("<title>The &lt;Last&gt; Choice</title>");
    expect(html).not.toContain("must-not-export");
  });
});
