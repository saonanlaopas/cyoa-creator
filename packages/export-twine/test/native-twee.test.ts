import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import { describe, expect, it } from "vitest";
import { createNativePlayerConfig, nativeBundleFingerprint } from "@story-to-cyoa/runtime";
import { playerConfigInput, playerFixture } from "../../runtime/test/native-player-fixture.js";
import { compileSugarCube, nativeTweeIfid, renderNativeTwee } from "../src/index.js";

describe("native Twee 3 / SugarCube export", () => {
  it("maps the accepted native bundle deterministically with collision-safe names", () => {
    const bundle = playerFixture(); const config = createNativePlayerConfig(playerConfigInput(bundle), bundle);
    const first = renderNativeTwee(bundle, config); const second = renderNativeTwee(bundle, config);
    expect(first).toEqual(second); expect(first.compatible).toBe(true);
    expect(first.twee).toContain('"format":"SugarCube"');
    expect(first.twee).toContain("visitCounts"); expect(first.twee).toContain("sourceDecisionIds");
    expect(new Set(Object.values(first.passageNames)).size).toBe(bundle.passages.length);
    expect(first.ifid).toBe(nativeTweeIfid(bundle.gameId));
  });

  it("blocks invalid native semantics instead of emitting misleading Twee", () => {
    const bundle = structuredClone(playerFixture()); bundle.choices[0]!.destinationPassageId = "missing";
    const result = renderNativeTwee(bundle, createNativePlayerConfig(playerConfigInput(playerFixture()), playerFixture()));
    expect(result.compatible).toBe(false); expect(result.twee).toBeNull(); expect(result.diagnostics[0]?.code).toBe("twee.native-bundle-invalid");
  });

  it("keeps colliding Unicode titles and adversarial prose inside deterministic Twee data", () => {
    const bundle = playerFixture(); bundle.passages[0]!.presentation.title = "Same [title]"; bundle.passages[1]!.presentation.title = "Same [title]";
    bundle.passages[0]!.proseMarkdown = ":: forged\n[[link]] <<script>> `tick` \u2028 \u2029"; bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
    const result = renderNativeTwee(bundle, createNativePlayerConfig(playerConfigInput(bundle), bundle));
    expect(result.compatible).toBe(true); expect(new Set(Object.values(result.passageNames)).size).toBe(bundle.passages.length);
    expect(result.twee).toContain("&#91;&#91;link]]"); expect(result.twee).toContain("&lt;&lt;script&gt;&gt;");
    expect(result.twee?.match(/^:: /gm)).toHaveLength(bundle.passages.length + 5);
  });

  it("compiles with the pinned real Tweego and never the fallback", async () => {
    const bundle = playerFixture(); const result = renderNativeTwee(bundle, createNativePlayerConfig(playerConfigInput(bundle), bundle));
    const directory = await mkdtemp(join(tmpdir(), "cyoa-tweego-test-")); const output = join(directory, "story.html");
    try {
      const compiled = await compileSugarCube(result.twee!, output, { tweegoPath: resolve("tools/tweego", platform() === "win32" ? "tweego.exe" : "tweego"), allowFallback: false });
      expect(compiled.compiler).toBe("tweego"); expect((await readFile(output, "utf8"))).toContain("SugarCube");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
