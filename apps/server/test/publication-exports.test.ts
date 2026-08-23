import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
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

  it.each([
    ["passage", "passage", { id: "passage-invalid" }],
    ["choice", "choice", { id: "choice-invalid", sourcePassageId: 7 }],
    ["thread", "thread", { id: "thread-invalid", status: "impossible" }],
  ] as const)("rejects invalid %s domain content atomically", (_label, kind, content) => {
    const source = service(); const target = service();
    try {
      new ProjectRepository(source.database).create("Hostile", "hostile", "long-form");
      new ProjectRepository(target.database).create("Untouched", "untouched", "long-form");
      source.database.prepare(`INSERT INTO passage_entity_versions
        (id, project_id, entity_kind, entity_id, version, content_json, created_at) VALUES (?, 'hostile', ?, ?, 1, ?, ?)`)
        .run(`${kind}-version`, kind, `${kind}-invalid`, JSON.stringify(content), "2026-08-24T00:00:00.000Z");
      expect(() => target.service.importPortable(source.service.exportPortable("hostile").bytes)).toThrow(/domain_invalid/);
      expect(new ProjectRepository(target.database).get("hostile")).toBeUndefined();
      expect(new ProjectRepository(target.database).get("untouched")?.name).toBe("Untouched");
    } finally { source.database.close(); target.database.close(); }
  });

  it.each(["routes", "mechanics", "endings"] as const)("rejects invalid %s artifacts atomically", (artifactId) => {
    const source = service(); const target = service();
    try {
      new ProjectRepository(source.database).create("Hostile", "hostile", "long-form");
      new ArtifactRepository(source.database).saveArtifact({ projectId: "hostile", artifactId, content: { invalid: true } });
      expect(() => target.service.importPortable(source.service.exportPortable("hostile").bytes)).toThrow(/domain_invalid/);
      expect(new ProjectRepository(target.database).get("hostile")).toBeUndefined();
    } finally { source.database.close(); target.database.close(); }
  });

  it("rejects invalid passage structure content atomically", () => {
    const source = service(); const target = service();
    try {
      new ProjectRepository(source.database).create("Hostile", "hostile", "long-form");
      source.database.prepare(`INSERT INTO passage_structure_versions
        (id, project_id, version, content_json, created_at) VALUES ('structure-invalid', 'hostile', 1, '{"acts":"not-an-array"}', '2026-08-24T00:00:00.000Z')`).run();
      expect(() => target.service.importPortable(source.service.exportPortable("hostile").bytes)).toThrow(/domain_invalid/);
      expect(new ProjectRepository(target.database).get("hostile")).toBeUndefined();
    } finally { source.database.close(); target.database.close(); }
  });

  it("rejects malformed JSON-bearing rows before commit", () => {
    const source = service(); const target = service();
    try {
      new ProjectRepository(source.database).create("Hostile", "hostile", "long-form");
      source.database.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES ('bad-json', 'hostile', 'brief', 'brief', 1, 1, '{', 0, '2026-08-24T00:00:00.000Z')`).run();
      expect(() => target.service.importPortable(source.service.exportPortable("hostile").bytes)).toThrow(/json_invalid/);
      expect(new ProjectRepository(target.database).get("hostile")).toBeUndefined();
    } finally { source.database.close(); target.database.close(); }
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
      const exact = "  leading\r\nHard break  \r\n```text\r\ncode trailing   \r\n```\r\n## hostile\r\n---\r\n:: passage\r\nfinal   ";
      context.bundle.passages[0]!.proseMarkdown = exact;
      context.bundle.bundleFingerprint = nativeBundleFingerprint(context.bundle);
      const first = context.service.exportMarkdown("ignored"); const second = context.service.exportMarkdown("ignored");
      expect(first).toEqual(second);
      expect(proseBody(first.text, 1)).toBe(exact);
      expect(first.text).toContain("not a lossless import format"); expect(first.text).not.toContain("runtimeFingerprint\":");
    } finally { context.database.close(); }
  });

  it("builds bounded 300-passage static and standalone publications with inert payloads", async () => {
    const context = service(openDatabase(), 300, true); try {
      const exactBodies = context.bundle.passages.map((passage, index) => {
        const prose = `  passage ${index}\r\nline with hard break  \r\n\`\`\`\r\nblock ${index}   \r\n\`\`\``;
        passage.proseMarkdown = prose; return prose;
      });
      context.bundle.bundleFingerprint = nativeBundleFingerprint(context.bundle);
      const markdown = context.service.exportMarkdown("ignored");
      expect(markdown.text.match(/^## \d+\./gm)).toHaveLength(300);
      exactBodies.forEach((body, index) => expect(proseBody(markdown.text, index + 1)).toBe(body));
      const staticResult = await context.service.exportStatic("ignored"); const files = unzipSync(staticResult.bytes);
      expect(Object.keys(files).sort()).toEqual(["assets/player.css", "assets/player.js", "game.json", "index.html", "manifest.json", "player-config.json"]);
      expect(new TextDecoder().decode(files["index.html"]!)).not.toContain("localhost");
      const standalone = await context.service.exportStandalone("ignored");
      expect(standalone.html).not.toContain("globalThis.PWNED=true"); expect(standalone.html).toContain("__CYOA_PUBLICATION_B64__");
      expect(standalone.html).not.toContain("/api/");
    } finally { context.database.close(); }
  }, 30_000);

  it("uses isolated cleaned workspaces for overlapping Twee compilations", async () => {
    const database = openDatabase(); const root = await mkdtemp(resolve(tmpdir(), "cyoa-twee-concurrency-test-"));
    try {
      new ProjectRepository(database).create("First title", "first", "long-form");
      new ProjectRepository(database).create("Second title", "second", "long-form");
      const bundles = { first: playerFixture(4), second: playerFixture(5) };
      const configs = {
        first: createNativePlayerConfig(playerConfigInput(bundles.first), bundles.first),
        second: createNativePlayerConfig(playerConfigInput(bundles.second), bundles.second),
      };
      let started = 0; let release!: () => void;
      const bothStarted = new Promise<void>((resolvePromise) => { release = resolvePromise; });
      const directories: string[] = [];
      const compiler: typeof import("@story-to-cyoa/export-twine").compileSugarCube = async (twee, outputPath) => {
        directories.push(dirname(outputPath)); started += 1; if (started === 2) release(); await bothStarted;
        const html = `<!doctype html><title>${twee.includes("First title") ? "first" : "second"}</title>`;
        await writeFile(outputPath, html, "utf8");
        return { outputPath, compiler: "tweego", bytes: Buffer.byteLength(html) };
      };
      const native = { compile: (projectId: "first" | "second") => ({ bundle: bundles[projectId], playerConfig: configs[projectId] }) } as unknown as NativeCompilationService;
      const exporter = new PublicationExportService(new PortableProjectRepository(database), native, compiler, root);
      const [first, second] = await Promise.all([exporter.exportTwee("first"), exporter.exportTwee("second")]);
      expect(new TextDecoder().decode(first.html)).toContain("<title>first</title>");
      expect(new TextDecoder().decode(second.html)).toContain("<title>second</title>");
      expect(new Set(directories).size).toBe(2);
      expect(await readdir(root)).toEqual([]);
      expect(JSON.stringify([first.manifest, second.manifest])).not.toContain(root);
    } finally { database.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("renders and real-compiles a 300-passage SugarCube publication", async () => {
    const context = service(openDatabase(), 300); try {
      const result = await context.service.exportTwee("ignored");
      expect(result.twee.match(/^:: /gm)).toHaveLength(305);
      expect(new TextDecoder().decode(result.html)).toContain("SugarCube");
    } finally { context.database.close(); }
  }, 30_000);
});

function proseBody(markdown: string, passageNumber: number): string {
  const marker = String(passageNumber).padStart(6, "0");
  const start = `<!-- CYOA ACCEPTED PROSE START ${marker} -->\n`;
  const end = `\n<!-- CYOA ACCEPTED PROSE END ${marker} -->`;
  const from = markdown.indexOf(start); const to = markdown.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0); expect(to).toBeGreaterThanOrEqual(0);
  return markdown.slice(from + start.length, to);
}
