import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { compileSugarCube, renderNativeTwee } from "@story-to-cyoa/export-twine";
import { PortableProjectRepository, PORTABLE_PROJECT_TABLES, type PortableProjectRows } from "@story-to-cyoa/persistence";
import { assertNativePlayerConfig, loadNativeGame, stableFingerprint, type NativeGameBundle, type NativePlayerConfig } from "@story-to-cyoa/runtime";
import type { NativeCompilationService } from "./native-compilation-service.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { validatePortableAuthoringProject } from "./portable-project-validator.js";

export const PORTABLE_PROJECT_LIMITS = Object.freeze({ archiveBytes: 128_000_000, uncompressedBytes: 256_000_000, entries: 16, pathLength: 160, rows: 1_000_000, artifacts: 100_000, passageVersions: 100_000, choiceVersions: 300_000, threadVersions: 100_000, draftVersions: 100_000, snapshots: 20_000, textBytes: 50_000_000 });
export const PUBLICATION_EXPORT_LIMITS = Object.freeze({ staticArchiveBytes: 128_000_000, standaloneHtmlBytes: 96_000_000, tweeArchiveBytes: 128_000_000 });
const SCHEMA_ID = "cyoa.portable-project" as const;
const HISTORY_MODE = "immutable-authoring-history-v1" as const;
const PORTABLE_EXCLUSIONS = ["credentials", "environment", "machine paths", "browser saves", "chat and source bodies", "passage-planning jobs/candidates", "provider raw responses"] as const;
// ZIP stores local DOS calendar fields without a timezone. Construct the epoch in
// local time so those encoded fields are identical on every host.
const fixedDate = new Date(1980, 0, 1, 0, 0, 0, 0);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export interface PortableManifest {
  schemaId: typeof SCHEMA_ID; schemaVersion: 1; exportContractVersion: 1; projectId: string;
  projectFingerprint: string; historyMode: typeof HISTORY_MODE; includedSections: string[];
  exclusions: string[]; counts: Record<string, number>; files: Array<{ path: string; sha256: string; bytes: number }>;
}

const LEGACY_PORTABLE_PROJECT_TABLES = PORTABLE_PROJECT_TABLES.filter((table) => table !== "artifact_version_approvals");

export class PublicationExportService {
  public constructor(
    private readonly portable: PortableProjectRepository,
    private readonly nativeCompilation: NativeCompilationService | undefined,
    private readonly tweeCompiler: typeof compileSugarCube = compileSugarCube,
    private readonly temporaryDirectoryRoot: string = tmpdir(),
  ) {}

  exportPortable(projectId: string): { bytes: Uint8Array; manifest: PortableManifest } {
    const rows = this.portable.exportRows(projectId);
    enforcePortableRows(rows);
    const sections = rows.tables.artifact_version_approvals.length
      ? [...PORTABLE_PROJECT_TABLES] : [...LEGACY_PORTABLE_PROJECT_TABLES];
    const serializedRows = { projectId: rows.projectId, tables: Object.fromEntries(
      sections.map((table) => [table, rows.tables[table]]),
    ) };
    const projectFingerprint = stableFingerprint({ schemaId: SCHEMA_ID, schemaVersion: 1, historyMode: HISTORY_MODE, rows: serializedRows });
    const payload = strToU8(canonical({ schemaId: SCHEMA_ID, schemaVersion: 1, projectFingerprint, ...serializedRows }));
    if (payload.byteLength > PORTABLE_PROJECT_LIMITS.uncompressedBytes) throw new Error("portable_project_too_large");
    const counts = Object.fromEntries(sections.map((table) => [table, rows.tables[table].length]));
    const manifest: PortableManifest = {
      schemaId: SCHEMA_ID, schemaVersion: 1, exportContractVersion: 1, projectId, projectFingerprint,
      historyMode: HISTORY_MODE, includedSections: sections,
      exclusions: [...PORTABLE_EXCLUSIONS],
      counts, files: [{ path: "project.json", sha256: sha256(payload), bytes: payload.byteLength }],
    };
    const manifestBytes = strToU8(canonical(manifest));
    const bytes = zipSync({
      "manifest.json": [manifestBytes, { mtime: fixedDate }],
      "project.json": [payload, { mtime: fixedDate }],
    }, { level: 9 });
    if (bytes.byteLength > PORTABLE_PROJECT_LIMITS.archiveBytes) throw new Error("portable_project_too_large");
    return { bytes, manifest };
  }

  previewPortable(bytes: Uint8Array): { manifest: PortableManifest; projectName: string; conflict: boolean } {
    const parsed = this.parsePortableArchive(bytes);
    let conflict = false;
    try { this.portable.exportRows(parsed.rows.projectId); conflict = true; } catch { /* absent */ }
    const project = parsed.rows.tables.projects[0];
    return { manifest: parsed.manifest, projectName: String(project?.name ?? "Imported project"), conflict };
  }

  importPortable(bytes: Uint8Array): { projectId: string; projectFingerprint: string } {
    const parsed = this.parsePortableArchive(bytes);
    this.portable.importRows(parsed.rows, validatePortableAuthoringProject);
    return { projectId: parsed.rows.projectId, projectFingerprint: parsed.manifest.projectFingerprint };
  }

  exportMarkdown(projectId: string, inputArtifactVersionId?: string): { text: string; fingerprint: string; bundleFingerprint: string } {
    const source = this.requireNativeCompilation().compile(projectId, inputArtifactVersionId); const { bundle } = source;
    const choices = new Map(bundle.choices.map((choice) => [choice.id, choice]));
    const sections = [[`# ${this.projectTitle(projectId, bundle)}`, "",
      `> Native bundle: \`${bundle.bundleFingerprint}\`  `, `> Source input: \`${bundle.source.inputFingerprint}\`  `,
      `> Compilation input version: \`${source.input?.id ?? "captured-current"}\``, "",
      "This manuscript is a readable publication export, not a lossless import format."].join("\n")];
    bundle.passages.forEach((passage, index) => {
      const marker = String(index + 1).padStart(6, "0");
      const heading = [`## ${index + 1}. ${passage.presentation.title}`, "", `Stable ID: \`${passage.id}\`  `,
        `Routes: ${passage.routeIds.length ? passage.routeIds.map((id) => `\`${id}\``).join(", ") : "shared"}`, "",
        `<!-- CYOA ACCEPTED PROSE START ${marker} -->`].join("\n");
      let section = `${heading}\n${passage.proseMarkdown}\n<!-- CYOA ACCEPTED PROSE END ${marker} -->`;
      if (passage.choiceIds.length) {
        const choiceLines = ["Choices:", ""];
        for (const id of passage.choiceIds) { const choice = choices.get(id); if (choice) choiceLines.push(`- ${choice.text} → \`${choice.destinationPassageId}\``); }
        section += `\n\n${choiceLines.join("\n")}`;
      }
      if (passage.terminal) section += `\n\nEnding: \`${passage.endingId}\``;
      sections.push(section);
    });
    const text = `${sections.join("\n\n")}\n`;
    return { text, fingerprint: stableFingerprint(text), bundleFingerprint: bundle.bundleFingerprint };
  }

  async exportStatic(projectId: string, inputArtifactVersionId?: string): Promise<{ bytes: Uint8Array; fingerprint: string }> {
    const source = this.requireNativeCompilation().compile(projectId, inputArtifactVersionId);
    const assets = await playerAssets();
    const game = strToU8(canonical(source.bundle)); const config = strToU8(canonical(source.playerConfig));
    const title = this.projectTitle(projectId, source.bundle); const meaning = publicationMeaning("native-static", source, title); const fingerprint = stableFingerprint(meaning);
    const html = strToU8(staticHtml(source.bundle, title, "./assets/player.js", "./assets/player.css"));
    const manifest = strToU8(canonical({ schemaId: "cyoa.native-publication", schemaVersion: 1, publicationFingerprint: fingerprint,
      ...meaning, files: {
        "index.html": sha256(html), "game.json": sha256(game), "player-config.json": sha256(config),
        "assets/player.js": sha256(assets.js), "assets/player.css": sha256(assets.css),
      } }));
    const bytes = zipSync({
      "index.html": [html, { mtime: fixedDate }], "game.json": [game, { mtime: fixedDate }],
      "player-config.json": [config, { mtime: fixedDate }], "manifest.json": [manifest, { mtime: fixedDate }],
      "assets/player.js": [assets.js, { mtime: fixedDate }], "assets/player.css": [assets.css, { mtime: fixedDate }],
    }, { level: 9 });
    if (bytes.byteLength > PUBLICATION_EXPORT_LIMITS.staticArchiveBytes) throw new Error("native_static_export_too_large");
    return { fingerprint, bytes };
  }

  async exportStandalone(projectId: string, inputArtifactVersionId?: string): Promise<{ html: string; fingerprint: string }> {
    const source = this.requireNativeCompilation().compile(projectId, inputArtifactVersionId);
    const assets = await playerAssets();
    const title = this.projectTitle(projectId, source.bundle); const meaning = publicationMeaning("standalone-html", source, title); const fingerprint = stableFingerprint(meaning);
    const payload = Buffer.from(canonical({ bundle: source.bundle, config: source.playerConfig, publication: { ...meaning, publicationFingerprint: fingerprint } }), "utf8").toString("base64");
    const inlineCss = new TextDecoder().decode(assets.css).replace(/<\/style/gi, "<\\/style");
    const inlineJs = new TextDecoder().decode(assets.js).replace(/<\/script/gi, "<\\/script");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="cyoa-publication-fingerprint" content="${fingerprint}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"><title>${escapeHtml(title)}</title><style>${inlineCss}</style></head><body><div id="root"></div><script>globalThis.__CYOA_PUBLICATION_B64__=${JSON.stringify(payload)};</script><script>${inlineJs}</script></body></html>`;
    if (strToU8(html).byteLength > PUBLICATION_EXPORT_LIMITS.standaloneHtmlBytes) throw new Error("standalone_html_export_too_large");
    return { html, fingerprint };
  }

  async exportTwee(projectId: string, inputArtifactVersionId?: string): Promise<{ twee: string; html: Uint8Array; ifid: string; bundleFingerprint: string; fingerprint: string; manifest: unknown }> {
    const source = this.requireNativeCompilation().compile(projectId, inputArtifactVersionId);
    const title = this.projectTitle(projectId, source.bundle); const rendered = renderNativeTwee(source.bundle, source.playerConfig, title);
    if (!rendered.compatible || !rendered.twee) throw new Error(`twee_incompatible: ${rendered.diagnostics.map((item) => item.message).join("; ")}`);
    const directory = await mkdtemp(resolve(this.temporaryDirectoryRoot, "cyoa-twee-")); const output = resolve(directory, "story.html");
    try {
      const result = await this.tweeCompiler(rendered.twee, output, { allowFallback: false });
      if (result.compiler !== "tweego") throw new Error("Pinned Tweego was not used");
      const html = new Uint8Array(await readFile(output)); const tweeBytes = strToU8(rendered.twee);
      const meaning = { ...publicationMeaning("twee3-sugarcube", source, title), ifid: rendered.ifid, tweegoVersion: "2.1.1", tweeFingerprint: stableFingerprint(rendered.twee) };
      const fingerprint = stableFingerprint(meaning); const manifest = { schemaId: "cyoa.twee3-sugarcube-publication", schemaVersion: 1, ...meaning, publicationFingerprint: fingerprint,
        files: { "story.twee": sha256(tweeBytes), "story.html": sha256(html) } };
      if (tweeBytes.byteLength + html.byteLength > PUBLICATION_EXPORT_LIMITS.tweeArchiveBytes) throw new Error("twee_export_too_large");
      return { twee: rendered.twee, html, ifid: rendered.ifid, bundleFingerprint: source.bundle.bundleFingerprint, fingerprint, manifest };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  inspectTwee(projectId: string, inputArtifactVersionId?: string) {
    const source = this.requireNativeCompilation().compile(projectId, inputArtifactVersionId);
    const result = renderNativeTwee(source.bundle, source.playerConfig, this.projectTitle(projectId, source.bundle));
    return { compatible: result.compatible, blockers: result.diagnostics, warnings: result.warnings,
      referencedEntityIds: result.referencedEntityIds, compatibilityFingerprint: result.compatibilityFingerprint,
      bundleFingerprint: source.bundle.bundleFingerprint, playerConfigFingerprint: source.playerConfig.configFingerprint };
  }

  parsePortableArchive(bytes: Uint8Array): { manifest: PortableManifest; rows: PortableProjectRows } {
    if (bytes.byteLength > PORTABLE_PROJECT_LIMITS.archiveBytes) throw new Error("portable_project_too_large");
    inspectZip(bytes);
    const files = unzipSync(bytes);
    if (Object.keys(files).sort().join("\0") !== "manifest.json\0project.json") throw new Error("portable_project_entries_invalid");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as PortableManifest;
    if (Object.keys(manifest).sort().join("\0") !== ["counts", "exclusions", "exportContractVersion", "files", "historyMode", "includedSections", "projectFingerprint", "projectId", "schemaId", "schemaVersion"].sort().join("\0")) throw new Error("portable_project_manifest_schema_invalid");
    if (manifest.schemaId !== SCHEMA_ID || manifest.schemaVersion !== 1 || manifest.exportContractVersion !== 1 || manifest.historyMode !== HISTORY_MODE) throw new Error("portable_project_version_unsupported");
    if (!Array.isArray(manifest.includedSections) || !Array.isArray(manifest.exclusions) || !Array.isArray(manifest.files)
      || !isSupportedPortableSections(Object.keys(manifest.counts ?? {}))
      || manifest.exclusions.join("\0") !== PORTABLE_EXCLUSIONS.join("\0") || manifest.files.length !== 1
      || Object.keys(manifest.files[0] ?? {}).sort().join("\0") !== ["bytes", "path", "sha256"].join("\0")) throw new Error("portable_project_manifest_schema_invalid");
    const payload = files["project.json"]!;
    const declared = manifest.files.find((item) => item.path === "project.json");
    if (!declared || declared.bytes !== payload.byteLength || declared.sha256 !== sha256(payload)) throw new Error("portable_project_hash_invalid");
    const parsed = JSON.parse(strFromU8(payload)) as { schemaId: string; schemaVersion: number; projectFingerprint: string } & PortableProjectRows;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).sort().join("\0") !== ["projectFingerprint", "projectId", "schemaId", "schemaVersion", "tables"].join("\0")) throw new Error("portable_project_schema_invalid");
    if (parsed.schemaId !== SCHEMA_ID || parsed.schemaVersion !== 1 || parsed.projectId !== manifest.projectId) throw new Error("portable_project_manifest_mismatch");
    const sections = Object.keys(parsed.tables ?? {});
    if (!parsed.tables || !isSupportedPortableSections(sections)) throw new Error("portable_project_sections_invalid");
    const expectedSections = sections.includes("artifact_version_approvals")
      ? [...PORTABLE_PROJECT_TABLES] : [...LEGACY_PORTABLE_PROJECT_TABLES];
    if (manifest.includedSections.join("\0") !== expectedSections.join("\0")) throw new Error("portable_project_sections_invalid");
    let rowCount = 0;
    for (const table of expectedSections) {
      const rows = parsed.tables[table]; if (!Array.isArray(rows) || manifest.counts[table] !== rows.length) throw new Error("portable_project_counts_invalid");
      rowCount += rows.length;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("portable_project_row_invalid");
        for (const value of Object.values(row)) {
          if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error("portable_project_row_invalid");
          if (typeof value === "string" && strToU8(value).byteLength > PORTABLE_PROJECT_LIMITS.textBytes) throw new Error("portable_project_text_limit");
        }
      }
    }
    if (rowCount > PORTABLE_PROJECT_LIMITS.rows) throw new Error("portable_project_rows_exceeded");
    const serializedRows = { projectId: parsed.projectId, tables: parsed.tables };
    const rows = { projectId: parsed.projectId, tables: {
      ...parsed.tables,
      artifact_version_approvals: parsed.tables.artifact_version_approvals ?? [],
    } } as PortableProjectRows;
    enforcePortableRows(rows);
    const expected = stableFingerprint({ schemaId: SCHEMA_ID, schemaVersion: 1, historyMode: HISTORY_MODE, rows: serializedRows });
    if (expected !== parsed.projectFingerprint || expected !== manifest.projectFingerprint) throw new Error("portable_project_fingerprint_invalid");
    return { manifest, rows };
  }

  private requireNativeCompilation(): NativeCompilationService {
    if (!this.nativeCompilation) throw new Error("native_compilation_unavailable");
    return this.nativeCompilation;
  }

  private projectTitle(projectId: string, bundle: NativeGameBundle): string {
    try { return String(this.portable.exportRows(projectId).tables.projects[0]?.name || "Interactive story"); }
    catch { return bundle.passages.find((item) => item.id === bundle.startPassageId)?.presentation.title ?? "Interactive story"; }
  }
}

function isSupportedPortableSections(sections: readonly string[]): boolean {
  const exact = [...sections].sort().join("\0");
  return exact === [...PORTABLE_PROJECT_TABLES].sort().join("\0")
    || exact === [...LEGACY_PORTABLE_PROJECT_TABLES].sort().join("\0");
}

function enforcePortableRows(rows: PortableProjectRows): void {
  if (rows.tables.projects.length !== 1 || rows.tables.artifact_versions.length > PORTABLE_PROJECT_LIMITS.artifacts
    || rows.tables.passage_draft_versions.length > PORTABLE_PROJECT_LIMITS.draftVersions
    || rows.tables.passage_plan_snapshots.length > PORTABLE_PROJECT_LIMITS.snapshots) throw new Error("portable_project_section_limit");
  const entityCounts = { passage: 0, choice: 0, thread: 0 };
  for (const row of rows.tables.passage_entity_versions) {
    if (row.entity_kind === "passage" || row.entity_kind === "choice" || row.entity_kind === "thread") entityCounts[row.entity_kind]++;
    else throw new Error("portable_project_entity_kind_invalid");
  }
  if (entityCounts.passage > PORTABLE_PROJECT_LIMITS.passageVersions || entityCounts.choice > PORTABLE_PROJECT_LIMITS.choiceVersions
    || entityCounts.thread > PORTABLE_PROJECT_LIMITS.threadVersions) throw new Error("portable_project_entity_limit");
}

function inspectZip(bytes: Uint8Array): void {
  let entries = 0, total = 0; const names = new Set<string>(); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset++) if (view.getUint32(offset, true) === 0x02014b50) {
    entries++; const flags = view.getUint16(offset + 8, true); const compressed = view.getUint32(offset + 20, true); const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true); const extra = view.getUint16(offset + 30, true); const comment = view.getUint16(offset + 32, true);
    const external = view.getUint32(offset + 38, true); const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || name.length > PORTABLE_PROJECT_LIMITS.pathLength || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..") || names.has(name)) throw new Error("portable_project_path_invalid");
    if ((flags & 1) !== 0) throw new Error("portable_project_encrypted_entry_rejected");
    if (((external >>> 16) & 0o170000) === 0o120000) throw new Error("portable_project_symlink_rejected");
    names.add(name); total += size; if (compressed > PORTABLE_PROJECT_LIMITS.archiveBytes || total > PORTABLE_PROJECT_LIMITS.uncompressedBytes) throw new Error("portable_project_uncompressed_limit");
    offset += 45 + nameLength + extra + comment;
  }
  if (!entries || entries > PORTABLE_PROJECT_LIMITS.entries) throw new Error("portable_project_entry_limit");
}

let cachedAssets: Promise<{ js: Uint8Array; css: Uint8Array }> | undefined;
function playerAssets(): Promise<{ js: Uint8Array; css: Uint8Array }> {
  return cachedAssets ??= build({ entryPoints: [resolve(process.cwd(), "apps/web/src/publication-bootstrap.tsx")], bundle: true, write: false, outdir: "publication-assets", minify: true, sourcemap: false, platform: "browser", format: "iife", jsx: "automatic", conditions: ["development", "browser"], loader: { ".tsx": "tsx" } }).then((result) => {
    const js = result.outputFiles.find((item) => item.path.endsWith(".js"))?.contents;
    const css = result.outputFiles.find((item) => item.path.endsWith(".css"))?.contents ?? new Uint8Array();
    if (!js) throw new Error("Static player asset build produced no JavaScript"); return { js, css };
  });
}
const publicationMeaning = (format: string, source: { bundle: NativeGameBundle; playerConfig: NativePlayerConfig; input?: { id?: string }; playerConfigVersionId?: string | null }, title: string) => ({
  format, exportContractVersion: 1, gameId: source.bundle.gameId, title,
  compilationInputArtifactVersionId: source.input?.id ?? "captured-current",
  sourceInputFingerprint: source.bundle.source.inputFingerprint, bundleFingerprint: source.bundle.bundleFingerprint,
  playerConfigArtifactVersionId: source.playerConfigVersionId ?? "explicit-default",
  playerConfigFingerprint: assertNativePlayerConfig(source.playerConfig, source.bundle).configFingerprint,
  playerVersion: "foundation-7b-native-player-v1",
});
const staticHtml = (_bundle: NativeGameBundle, title: string, jsPath: string, cssPath: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${cssPath}"></head><body><div id="root"></div><script src="${jsPath}" defer></script></body></html>`;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
