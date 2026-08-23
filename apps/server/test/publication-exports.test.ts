import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createNativePlayerConfig, nativeBundleFingerprint } from "@story-to-cyoa/runtime";
import { ArtifactRepository, openDatabase, PortableProjectRepository, ProjectRepository } from "@story-to-cyoa/persistence";
import { playerConfigInput, playerFixture } from "../../../packages/runtime/test/native-player-fixture.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import type { NativeCompilationService } from "../src/services/native-compilation-service.js";

function service(database = openDatabase(), passageCount = 4, hostile = false) {
  const bundle = playerFixture(passageCount); if (hostile) {
    bundle.passages[0]!.proseMarkdown = "</script><script>globalThis.PWNED=true</script>";
    bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  }
  const config = createNativePlayerConfig(playerConfigInput(bundle), bundle);
  const compiler = { compile: () => ({ bundle, playerConfig: config }) } as unknown as NativeCompilationService;
  return { database, bundle, service: new PublicationExportService(new PortableProjectRepository(database), compiler) };
}

describe("Foundation 7C publication exports", () => {
  it("exports deterministic, hashed portable archives and previews without writes", () => {
    const source = service(); const target = service();
    try {
      new ProjectRepository(source.database).create("Archive", "archive", "long-form");
      const first = source.service.exportPortable("archive"); const second = source.service.exportPortable("archive");
      expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
      expect(source.service.previewPortable(first.bytes)).toMatchObject({ projectName: "Archive", conflict: true });
      expect(target.service.previewPortable(first.bytes)).toMatchObject({ projectName: "Archive", conflict: false });
      expect(new ProjectRepository(target.database).get("archive")).toBeUndefined();
      target.service.importPortable(first.bytes); expect(new ProjectRepository(target.database).get("archive")?.name).toBe("Archive");
    } finally { source.database.close(); target.database.close(); }
  });

  it("rejects traversal, unknown versions, hash tampering, and collisions atomically", () => {
    const context = service(); try {
      new ProjectRepository(context.database).create("Archive", "archive", "long-form");
      expect(() => context.service.previewPortable(zipSync({ "../evil": strToU8("x") }))).toThrow(/path_invalid/);
      const bomb = zipSync({ "manifest.json": strToU8("{}"), "project.json": strToU8("{}") }); const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
      for (let offset = 0; offset + 46 <= bomb.byteLength; offset++) if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 300_000_000, true);
      expect(() => context.service.previewPortable(bomb)).toThrow(/uncompressed_limit/);
      const exported = context.service.exportPortable("archive"); const files = unzipSync(exported.bytes);
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!)); manifest.schemaVersion = 99;
      expect(() => context.service.previewPortable(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "project.json": files["project.json"]! }))).toThrow(/version_unsupported/);
      const strictFiles = unzipSync(exported.bytes); const strictManifest = JSON.parse(new TextDecoder().decode(strictFiles["manifest.json"]!));
      const strictPayload = JSON.parse(new TextDecoder().decode(strictFiles["project.json"]!)); strictPayload.unknownFutureField = true;
      strictFiles["project.json"] = strToU8(JSON.stringify(strictPayload)); strictManifest.files[0].bytes = strictFiles["project.json"].byteLength;
      strictManifest.files[0].sha256 = createHash("sha256").update(strictFiles["project.json"]).digest("hex"); strictFiles["manifest.json"] = strToU8(JSON.stringify(strictManifest));
      expect(() => context.service.previewPortable(zipSync(strictFiles))).toThrow(/schema_invalid/);
      files["project.json"]![10] ^= 1; expect(() => context.service.previewPortable(zipSync(files))).toThrow(/hash_invalid|JSON/);
      expect(() => context.service.importPortable(exported.bytes)).toThrow(/conflict/);
    } finally { context.database.close(); }
  });

  it("excludes source/provider secret material while preserving an explicitly authored literal", () => {
    const context = service(); try {
      new ProjectRepository(context.database).create("Archive", "archive", "long-form"); const artifacts = new ArtifactRepository(context.database);
      artifacts.saveArtifact({ projectId: "archive", artifactId: "source", artifactType: "source", schemaVersion: 1, content: { body: "provider-secret-marker" } });
      artifacts.saveArtifact({ projectId: "archive", artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: { premise: "repair-secret-marker" } });
      const files = unzipSync(context.service.exportPortable("archive").bytes); const payload = new TextDecoder().decode(files["project.json"]!);
      expect(payload).not.toContain("provider-secret-marker"); expect(payload).toContain("repair-secret-marker");
      expect(payload).not.toMatch(/[A-Za-z]:\\|\/Users\/|OPENROUTER_API_KEY/);
    } finally { context.database.close(); }
  });

  it("renders deterministic readable Markdown from accepted native prose", () => {
    const context = service(); try {
      const first = context.service.exportMarkdown("ignored"); const second = context.service.exportMarkdown("ignored");
      expect(first).toEqual(second); expect(first.text).toContain("Exact prose 0.");
      expect(first.text).toContain("not a lossless import format"); expect(first.text).not.toContain("runtimeFingerprint\":");
    } finally { context.database.close(); }
  });

  it("builds bounded 300-passage static and standalone publications with inert payloads", async () => {
    const context = service(openDatabase(), 300, true); try {
      const markdown = context.service.exportMarkdown("ignored");
      expect(markdown.text.match(/^## \d+\./gm)).toHaveLength(300);
      const staticResult = await context.service.exportStatic("ignored"); const files = unzipSync(staticResult.bytes);
      expect(Object.keys(files).sort()).toEqual(["assets/player.css", "assets/player.js", "game.json", "index.html", "manifest.json", "player-config.json"]);
      expect(new TextDecoder().decode(files["index.html"]!)).not.toContain("localhost");
      const standalone = await context.service.exportStandalone("ignored");
      expect(standalone.html).not.toContain("globalThis.PWNED=true"); expect(standalone.html).toContain("__CYOA_PUBLICATION_B64__");
      expect(standalone.html).not.toContain("/api/");
    } finally { context.database.close(); }
  }, 30_000);

  it("renders and real-compiles a 300-passage SugarCube publication", async () => {
    const context = service(openDatabase(), 300); try {
      const result = await context.service.exportTwee("ignored");
      expect(result.twee.match(/^:: /gm)).toHaveLength(305);
      expect(new TextDecoder().decode(result.html)).toContain("SugarCube");
    } finally { context.database.close(); }
  }, 30_000);
});
