import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { compileSugarCube, renderNativeTwee } from "@story-to-cyoa/export-twine";
import {
  PortableProjectRepository,
  PORTABLE_PROJECT_TABLES,
  SOURCE_ANALYSIS_TABLES,
  FOUNDATION_BOOTSTRAP_TABLES,
  STUDIO_PORTABLE_TABLES,
  reconstructLegacyArtifactApprovalHistory,
  redactFoundationBootstrapRows,
  type PortableProjectRows,
  type PortableRow,
} from "@story-to-cyoa/persistence";
import { assertNativePlayerConfig, loadNativeGame, stableFingerprint, type NativeGameBundle, type NativePlayerConfig } from "@story-to-cyoa/runtime";
import { sourceDigest, sourceCanonicalJson, unavailableSource, isUnavailableSource, UnavailableSourceSchema, SourceEvidenceMaterialSchema, AnalysisSourceSchema } from "@story-to-cyoa/domain";
import { redactStudioArtifactContent, resealRedactedNativeHistory } from "./studio-archive-redaction.js";
import type { NativeCompilationService } from "./native-compilation-service.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { validatePortableAuthoringProject } from "./portable-project-validator.js";

export const PORTABLE_PROJECT_LIMITS = Object.freeze({ archiveBytes: 128_000_000, uncompressedBytes: 256_000_000, entries: 16, pathLength: 160, rows: 1_000_000, artifacts: 100_000, passageVersions: 100_000, choiceVersions: 300_000, threadVersions: 100_000, draftVersions: 100_000, snapshots: 20_000, textBytes: 50_000_000 });
export const PUBLICATION_EXPORT_LIMITS = Object.freeze({ staticArchiveBytes: 128_000_000, standaloneHtmlBytes: 96_000_000, tweeArchiveBytes: 128_000_000 });
const SCHEMA_ID = "cyoa.portable-project" as const;
const HISTORY_MODE = "immutable-authoring-history-v1" as const;
const PORTABLE_EXCLUSIONS = ["credentials", "environment", "machine paths", "browser saves", "chat and source bodies", "passage-planning jobs/candidates", "provider raw responses"] as const;
const ANALYSIS_PORTABLE_EXCLUSIONS = PORTABLE_EXCLUSIONS.map((value) => value === "chat and source bodies" ? "chat bodies (immutable source evidence included)" : value);
// ZIP stores local DOS calendar fields without a timezone. Construct the epoch in
// local time so those encoded fields are identical on every host.
const fixedDate = new Date(1980, 0, 1, 0, 0, 0, 0);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export interface PortableManifest {
  schemaId: typeof SCHEMA_ID; schemaVersion: 1; exportContractVersion: 1 | 2; projectId: string;
  projectFingerprint: string; historyMode: typeof HISTORY_MODE; includedSections: string[];
  exclusions: string[]; counts: Record<string, number>; files: Array<{ path: string; sha256: string; bytes: number }>;
  exportMode?: "full-fidelity" | "privacy-redacted";
  evidence?: Array<{ sourceVersionId: string; sourceFingerprint: string; availability: "present" | "redacted" | "missing" }>;
}

export type PortableApprovalHistoryMode = "current" | "legacy-reconstructed";

const PRE_BOOTSTRAP_TABLES = PORTABLE_PROJECT_TABLES.filter((table) => !(FOUNDATION_BOOTSTRAP_TABLES as readonly string[]).includes(table));
const PRE_ANALYSIS_TABLES = PRE_BOOTSTRAP_TABLES.filter((table) => !(SOURCE_ANALYSIS_TABLES as readonly string[]).includes(table));
const LEGACY_PORTABLE_PROJECT_TABLES = PRE_ANALYSIS_TABLES.filter((table) => table !== "artifact_version_approvals");

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
    const analysis = rows.tables.source_analysis_plans.length > 0 || rows.tables.artifact_versions.some((row) => row.artifact_id === "source");
    const bootstrap = rows.tables.foundation_bootstrap_plans.length > 0;
    const sections = bootstrap ? [...PORTABLE_PROJECT_TABLES] : analysis ? [...PRE_BOOTSTRAP_TABLES] : rows.tables.artifact_version_approvals.length
      ? [...PRE_ANALYSIS_TABLES] : [...LEGACY_PORTABLE_PROJECT_TABLES];
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
      exclusions: [...(analysis ? ANALYSIS_PORTABLE_EXCLUSIONS : PORTABLE_EXCLUSIONS)],
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

  /** v1 remains available solely for historical backup verification. New downloads use v2. */
  exportStudioPortable(projectId: string, exportMode: "full-fidelity" | "privacy-redacted" = "full-fidelity"): { bytes: Uint8Array; manifest: PortableManifest } {
    const rows = exportMode === "full-fidelity" ? this.portable.exportStudioRows(projectId) : this.redactedStudioRows(projectId);
    enforcePortableRows(rows);
    const evidence = studioEvidence(rows);
    if (exportMode === "full-fidelity" && evidence.some((entry) => entry.availability !== "present")) throw new Error("full_fidelity_source_unavailable: reattach every exact source before creating a full archive or verified backup");
    const sections = [...PORTABLE_PROJECT_TABLES, ...STUDIO_PORTABLE_TABLES];
    const projectFingerprint = studioFingerprint(rows, exportMode);
    const payload = strToU8(canonical({ schemaId: SCHEMA_ID, schemaVersion: 1, projectFingerprint, rows }));
    if (payload.byteLength > PORTABLE_PROJECT_LIMITS.uncompressedBytes) throw new Error("portable_project_too_large");
    const manifest: PortableManifest = { schemaId: SCHEMA_ID, schemaVersion: 1, exportContractVersion: 2, projectId,
      projectFingerprint, historyMode: HISTORY_MODE, exportMode, evidence,
      includedSections: sections, exclusions: studioExclusions(exportMode),
      counts: Object.fromEntries(sections.map((table) => [table, (rows.tables as Record<string, unknown[]>)[table]?.length ?? (rows.studio as Record<string, unknown[]>)[table].length])),
      files: [{ path: "project.json", sha256: sha256(payload), bytes: payload.byteLength }] };
    const bytes = zipSync({ "manifest.json": [strToU8(canonical(manifest)), { mtime: fixedDate }], "project.json": [payload, { mtime: fixedDate }] }, { level: 9 });
    if (bytes.byteLength > PORTABLE_PROJECT_LIMITS.archiveBytes) throw new Error("portable_project_too_large");
    return { bytes, manifest };
  }

  studioProjectFingerprint(projectId: string): string { return studioFingerprint(this.portable.exportStudioRows(projectId), "full-fidelity"); }

  sourceAvailability(projectId: string) { return studioEvidence(this.portable.sourceEvidenceRows(projectId)); }
  unavailableSourcePage(projectId: string, offset: number) { return this.portable.unavailableSourcePage(projectId, offset); }

  reattachSource(projectId: string, versionId: string, source: unknown) {
    this.portable.reattachSource(projectId, versionId, source, validatePortableAuthoringProject);
    return { projectId, sourceVersionId: versionId, evidence: this.sourceAvailability(projectId) };
  }

  private redactedStudioRows(projectId: string): PortableProjectRows {
    // Canonical excerpts remain authored content, but omitted raw requests and message references must be unavailable.
    const full = this.portable.exportStudioRows(projectId), rows = structuredClone(full);
    rows.studio = Object.fromEntries(STUDIO_PORTABLE_TABLES.map((table) => [table, [] as PortableRow[]])) as NonNullable<PortableProjectRows["studio"]>;
    const omissions: Array<{ kind: string; id: string; digest: string; availability: "redacted"; status?: string }> = [];
    for (const table of STUDIO_PORTABLE_TABLES) for (const row of full.studio![table]) if (typeof row.id === "string") {
      omissions.push({ kind: table, id: row.id, digest: sourceDigest(row), availability: "redacted", ...(typeof row.status === "string" ? { status: row.status } : {}) });
    }
    const excluded = new Set(rows.tables.artifact_versions.filter((row) => ["adaptation-intent-proposal", "conversational-edit-application", "source-evidence-material"].includes(String(row.artifact_type))).map((row) => String(row.id)));
    for (const row of rows.tables.artifact_versions) {
      if (excluded.has(String(row.id))) omissions.push({ kind: String(row.artifact_type), id: String(row.id), digest: sourceDigest(row), availability: "redacted" });
      if (!excluded.has(String(row.id))) row.content_json = JSON.stringify(redactStudioArtifactContent(String(row.artifact_type), JSON.parse(String(row.content_json))));
      if (row.artifact_id === "source") {
        const value: unknown = JSON.parse(String(row.content_json));
        row.content_json = JSON.stringify(isUnavailableSource(value) ? UnavailableSourceSchema.parse(value) : unavailableSource(AnalysisSourceSchema.parse(value)));
      }
    }
    rows.tables.artifact_versions = rows.tables.artifact_versions.filter((row) => !excluded.has(String(row.id)));
    redactFoundationBootstrapRows(rows, true);
    resealRedactedNativeHistory(full, rows);
    rows.tables.artifact_version_approvals = rows.tables.artifact_version_approvals.filter((row) => !excluded.has(String(row.version_id)));
    const excludedNames = new Set(full.tables.artifact_versions.filter((row) => excluded.has(String(row.id))).map((row) => row.artifact_id));
    rows.tables.artifact_workflow_state = rows.tables.artifact_workflow_state.filter((row) => !excludedNames.has(row.artifact_id));
    rows.tables.artifact_dependencies = rows.tables.artifact_dependencies.filter((row) => !excludedNames.has(row.upstream_artifact_id) && !excludedNames.has(row.dependent_artifact_id));
    const existing = rows.tables.artifact_versions.filter((row) => row.artifact_id === "studio-archive-evidence").sort((a, b) => Number(b.version) - Number(a.version))[0];
    const previous = existing ? JSON.parse(String(existing.content_json)).omissions as typeof omissions : [];
    const all = [...new Map([...previous, ...omissions].map((item) => [`${item.kind}:${item.id}`, item])).values()].sort((a, b) => sourceCanonicalJson(a).localeCompare(sourceCanonicalJson(b)));
    const content = { schemaId: "cyoa.studio-archive-evidence", schemaVersion: 1, projectId, omissions: all };
    if (existing) existing.content_json = JSON.stringify(content);
    else if (all.length) rows.tables.artifact_versions.push({ id: `archive_${sourceDigest(content).slice(0, 32)}`, project_id: projectId,
      artifact_id: "studio-archive-evidence", artifact_type: "studio-archive-evidence", version: 1, schema_version: 1,
      content_json: JSON.stringify(content), stale: 0, restored_from_version_id: null, created_at: String(rows.tables.projects[0]!.created_at) });
    for (const table of PORTABLE_PROJECT_TABLES) rows.tables[table].sort((a, b) => stableFingerprint(Object.fromEntries(Object.entries(a).sort())).localeCompare(stableFingerprint(Object.fromEntries(Object.entries(b).sort()))));
    return rows;
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

  parsePortableArchive(bytes: Uint8Array): {
    manifest: PortableManifest;
    rows: PortableProjectRows;
    approvalHistoryMode: PortableApprovalHistoryMode;
  } {
    if (bytes.byteLength > PORTABLE_PROJECT_LIMITS.archiveBytes) throw new Error("portable_project_too_large");
    inspectZip(bytes);
    const files = unzipSync(bytes);
    if (Object.keys(files).sort().join("\0") !== "manifest.json\0project.json") throw new Error("portable_project_entries_invalid");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as PortableManifest;
    if (manifest.exportContractVersion === 2) return this.parseStudioArchive(files, manifest);
    if (Object.keys(manifest).sort().join("\0") !== ["counts", "exclusions", "exportContractVersion", "files", "historyMode", "includedSections", "projectFingerprint", "projectId", "schemaId", "schemaVersion"].sort().join("\0")) throw new Error("portable_project_manifest_schema_invalid");
    if (manifest.schemaId !== SCHEMA_ID || manifest.schemaVersion !== 1 || manifest.exportContractVersion !== 1 || manifest.historyMode !== HISTORY_MODE) throw new Error("portable_project_version_unsupported");
    if (!Array.isArray(manifest.includedSections) || !Array.isArray(manifest.exclusions) || !Array.isArray(manifest.files)
      || !isSupportedPortableSections(Object.keys(manifest.counts ?? {}))
      || manifest.exclusions.join("\0") !== (manifest.includedSections.includes("source_analysis_plans") ? ANALYSIS_PORTABLE_EXCLUSIONS : PORTABLE_EXCLUSIONS).join("\0") || manifest.files.length !== 1
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
    const hasApprovalHistory = sections.includes("artifact_version_approvals");
    const hasAnalysis = sections.includes("source_analysis_plans");
    const expectedSections = sections.includes("foundation_bootstrap_plans") ? [...PORTABLE_PROJECT_TABLES] : hasAnalysis ? [...PRE_BOOTSTRAP_TABLES] : hasApprovalHistory
      ? [...PRE_ANALYSIS_TABLES] : [...LEGACY_PORTABLE_PROJECT_TABLES];
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
      ...Object.fromEntries(SOURCE_ANALYSIS_TABLES.map((table) => [table, parsed.tables[table] ?? []])),
      ...Object.fromEntries(FOUNDATION_BOOTSTRAP_TABLES.map((table) => [table, parsed.tables[table] ?? []])),
    } } as PortableProjectRows;
    enforcePortableRows(rows);
    const expected = stableFingerprint({ schemaId: SCHEMA_ID, schemaVersion: 1, historyMode: HISTORY_MODE, rows: serializedRows });
    if (expected !== parsed.projectFingerprint || expected !== manifest.projectFingerprint) throw new Error("portable_project_fingerprint_invalid");
    if (!hasApprovalHistory) {
      rows.tables.artifact_version_approvals = reconstructLegacyArtifactApprovalHistory(rows);
    }
    return { manifest, rows, approvalHistoryMode: hasApprovalHistory ? "current" : "legacy-reconstructed" };
  }

  private parseStudioArchive(files: Record<string, Uint8Array>, manifest: PortableManifest): { manifest: PortableManifest; rows: PortableProjectRows; approvalHistoryMode: PortableApprovalHistoryMode } {
    const keys = ["counts", "evidence", "exclusions", "exportContractVersion", "exportMode", "files", "historyMode", "includedSections", "projectFingerprint", "projectId", "schemaId", "schemaVersion"];
    if (Object.keys(manifest).sort().join("\0") !== keys.sort().join("\0") || manifest.schemaId !== SCHEMA_ID || manifest.schemaVersion !== 1 || manifest.exportContractVersion !== 2
      || manifest.historyMode !== HISTORY_MODE || !["full-fidelity", "privacy-redacted"].includes(manifest.exportMode ?? "")) throw new Error("portable_project_version_unsupported");
    const payload = files["project.json"]!;
    const declared = manifest.files?.[0];
    if (manifest.files?.length !== 1 || !declared || Object.keys(declared).sort().join("\0") !== "bytes\0path\0sha256"
      || declared.path !== "project.json" || declared.bytes !== payload.length || declared.sha256 !== sha256(payload)) throw new Error("portable_project_hash_invalid");
    const parsed = JSON.parse(strFromU8(payload)) as { schemaId: string; schemaVersion: number; projectFingerprint: string; rows: PortableProjectRows };
    if (Object.keys(parsed).sort().join("\0") !== "projectFingerprint\0rows\0schemaId\0schemaVersion" || parsed.schemaId !== SCHEMA_ID || parsed.schemaVersion !== 1
      || Object.keys(parsed.rows ?? {}).sort().join("\0") !== "projectId\0studio\0tables" || parsed.rows.projectId !== manifest.projectId) throw new Error("portable_project_schema_invalid");
    const sections = [...PORTABLE_PROJECT_TABLES, ...STUDIO_PORTABLE_TABLES];
    if (manifest.includedSections?.join("\0") !== sections.join("\0") || Object.keys(manifest.counts ?? {}).sort().join("\0") !== [...sections].sort().join("\0")
      || Object.keys(parsed.rows.tables ?? {}).sort().join("\0") !== [...PORTABLE_PROJECT_TABLES].sort().join("\0")
      || Object.keys(parsed.rows.studio ?? {}).sort().join("\0") !== [...STUDIO_PORTABLE_TABLES].sort().join("\0")
      || manifest.exclusions?.join("\0") !== studioExclusions(manifest.exportMode!).join("\0")) throw new Error("portable_project_sections_invalid");
    let count = 0;
    for (const table of sections) {
      const rows = (parsed.rows.tables as Record<string, PortableProjectRows["tables"]["projects"]>)[table] ?? (parsed.rows.studio as Record<string, PortableProjectRows["tables"]["projects"]>)[table];
      if (!Array.isArray(rows) || manifest.counts[table] !== rows.length) throw new Error("portable_project_counts_invalid");
      count += rows.length;
      for (const row of rows) if (!row || typeof row !== "object" || Array.isArray(row) || Object.values(row).some((value) => value !== null
        && (typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value)
          || typeof value === "string" && strToU8(value).length > PORTABLE_PROJECT_LIMITS.textBytes))) throw new Error("portable_project_row_invalid");
    }
    if (count > PORTABLE_PROJECT_LIMITS.rows) throw new Error("portable_project_rows_exceeded");
    enforcePortableRows(parsed.rows);
    const evidence = studioEvidence(parsed.rows);
    if (canonical(evidence) !== canonical(manifest.evidence)) throw new Error("portable_project_evidence_invalid");
    if (manifest.exportMode === "full-fidelity" && evidence.some((entry) => entry.availability !== "present")) throw new Error("full_fidelity_source_unavailable");
    if (manifest.exportMode === "privacy-redacted" && (evidence.some((entry) => entry.availability === "present") || STUDIO_PORTABLE_TABLES.some((table) => parsed.rows.studio![table].length))) throw new Error("portable_project_redaction_invalid");
    const fingerprint = studioFingerprint(parsed.rows, manifest.exportMode!);
    if (fingerprint !== manifest.projectFingerprint || fingerprint !== parsed.projectFingerprint) throw new Error("portable_project_fingerprint_invalid");
    return { manifest, rows: parsed.rows, approvalHistoryMode: "current" };
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

function studioExclusions(mode: "full-fidelity" | "privacy-redacted"): string[] {
  return ["credentials", "environment", "machine paths", "browser saves", "passage-planning jobs/candidates", "provider raw responses",
    ...(mode === "privacy-redacted" ? ["source bodies", "conversation records, author memory and conversational proposals (metadata commitments retained; canonical provenance excerpts retained)"] : [])];
}
function studioEvidence(rows: { projectId: string; tables: { artifact_versions: PortableRow[] } }): NonNullable<PortableManifest["evidence"]> {
  return rows.tables.artifact_versions.filter((row) => row.artifact_id === "source").map((row) => {
    const source: unknown = JSON.parse(String(row.content_json));
    if (isUnavailableSource(source)) {
      const marker = UnavailableSourceSchema.parse(source);
      const attachments = rows.tables.artifact_versions.filter((item) => item.artifact_type === "source-evidence-material" && JSON.parse(String(item.content_json)).sourceVersionId === row.id);
      for (const attachment of attachments) {
        const material = SourceEvidenceMaterialSchema.parse(JSON.parse(String(attachment.content_json)));
        if (material.projectId !== rows.projectId || material.sourceFingerprint !== marker.sourceFingerprint || sourceDigest(material.source) !== marker.sourceFingerprint
          || sourceCanonicalJson({ ...unavailableSource(material.source), availability: marker.availability }) !== sourceCanonicalJson(marker)) throw new Error("source_reattachment_lineage_invalid");
      }
      return { sourceVersionId: String(row.id), sourceFingerprint: marker.sourceFingerprint, availability: attachments.length ? "present" as const : marker.availability };
    }
    return { sourceVersionId: String(row.id), sourceFingerprint: sourceDigest(source), availability: "present" as const };
  }).sort((a, b) => a.sourceVersionId.localeCompare(b.sourceVersionId));
}
function studioFingerprint(rows: PortableProjectRows, exportMode: "full-fidelity" | "privacy-redacted"): string {
  return stableFingerprint({ schemaId: SCHEMA_ID, schemaVersion: 1, exportContractVersion: 2, historyMode: HISTORY_MODE, exportMode, evidence: studioEvidence(rows), rows });
}

function isSupportedPortableSections(sections: readonly string[]): boolean {
  const exact = [...sections].sort().join("\0");
  return exact === [...PORTABLE_PROJECT_TABLES].sort().join("\0")
    || exact === [...PRE_BOOTSTRAP_TABLES].sort().join("\0")
    || exact === [...PRE_ANALYSIS_TABLES].sort().join("\0")
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
