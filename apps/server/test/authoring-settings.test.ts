import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTHORING_SETTINGS_ID, builtinFictionCraft } from "@story-to-cyoa/domain";
import { ArtifactRepository, AuthoringInstructionsRepository, CommandRepository, PortableProjectRepository, ProjectRepository, openDatabase } from "@story-to-cyoa/persistence";
import { AuthoringSettingsService } from "../src/services/authoring-settings-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
const cleanup: Array<() => void> = []; afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
function fixture() { const db = openDatabase(), projects = new ProjectRepository(db); cleanup.push(() => db.close()); const p = projects.create("Neutral fiction", randomUUID(), "long-form"); return { db, projects, p, repo: new AuthoringInstructionsRepository(db), service: new AuthoringSettingsService(db), artifacts: new ArtifactRepository(db) }; }
function change(f: ReturnType<typeof fixture>, enabled: boolean) { const input = { projectId: f.p.id, expectedVersionId: f.repo.settings(f.p.id).versionId, enabled }; const review = f.service.call("review_authoring_settings", input) as { fingerprint: string }; const args = { ...input, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true }; return { args, result: f.service.call("apply_authoring_settings", args) }; }
describe("shared Fiction Craft settings and migration", () => {
  it("pins new project defaults and preserves exact custom instructions through off/on/retry", () => {
    const f = fixture(); const commands = new CommandRepository(f.db); commands.create({ scope: "project", projectId: f.p.id, name: "Voice", instruction: "Use present tense.\nKeep quiet scenes." });
    const original = f.repo.context(f.p.id); expect(original.enabled).toBe(true); expect(original.appliedGuide).toEqual(builtinFictionCraft());
    const off = change(f, false); expect(f.repo.context(f.p.id)).toMatchObject({ enabled: false, appliedGuide: null, customInstructions: original.customInstructions });
    const count = f.artifacts.listVersions(f.p.id, AUTHORING_SETTINGS_ID).length;
    expect(f.service.call("apply_authoring_settings", off.args)).toEqual(off.result); expect(f.artifacts.listVersions(f.p.id, AUTHORING_SETTINGS_ID)).toHaveLength(count);
    expect(() => f.service.call("apply_authoring_settings", { ...off.args, enabled: true })).toThrow(/conflict/);
    change(f, true); expect(f.repo.context(f.p.id).customInstructions).toEqual(original.customInstructions);
    expect(() => f.repo.assertFresh(f.p.id, original)).toThrow(/stale/);
  });
  it("rolls back settings and its shared operation receipt together, then retries exactly", () => {
    const f = fixture(), input = { projectId: f.p.id, expectedVersionId: f.repo.settings(f.p.id).versionId, enabled: false };
    const review = f.service.call("review_authoring_settings", input) as { fingerprint: string }, args = { ...input, fingerprint: review.fingerprint, approved: true, operationId: randomUUID() };
    f.db.exec("CREATE TEMP TRIGGER fail_craft_receipt BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='apply_authoring_settings' BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
    expect(() => f.service.call("apply_authoring_settings", args)).toThrow("receipt failure");
    expect(f.repo.settings(f.p.id).versionId).toBe(input.expectedVersionId); expect(f.repo.context(f.p.id).enabled).toBe(true);
    f.db.exec("DROP TRIGGER fail_craft_receipt");
    expect(f.service.call("apply_authoring_settings", args)).toMatchObject({ settings: { enabled: false } });
    expect(f.artifacts.listVersions(f.p.id, AUTHORING_SETTINGS_ID)).toHaveLength(2);
  });
  it("resolves a pre-setting project OFF without write-on-read, and duplicates it OFF", () => {
    const f = fixture(), legacy = f.projects.create("Legacy fiction", randomUUID(), "long-form", false);
    const count = f.db.prepare("SELECT count(*) n FROM artifact_versions").get();
    expect(f.repo.settings(legacy.id)).toMatchObject({ versionId: null, settings: { enabled: false, origin: "legacy-preserved", guide: null } });
    expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(count);
    const copy = f.projects.duplicate(legacy.id); expect(f.repo.settings(copy.id).settings.enabled).toBe(false); expect(f.repo.settings(copy.id).versionId).toBe(null);
  });
  it("rejects stale review/command changes, missing consent and tampered snapshots without a version or receipt", () => {
    const f = fixture(), input = { projectId: f.p.id, expectedVersionId: f.repo.settings(f.p.id).versionId, enabled: false }, review = f.service.call("review_authoring_settings", input) as { fingerprint: string };
    new CommandRepository(f.db).create({ scope: "project", projectId: f.p.id, name: "Voice", instruction: "A changed preference" });
    const args = { ...input, fingerprint: review.fingerprint, approved: true, operationId: randomUUID() }, before = f.artifacts.listVersions(f.p.id, AUTHORING_SETTINGS_ID).length;
    expect(() => f.service.call("apply_authoring_settings", args)).toThrow(/stale/);
    expect(() => f.service.call("apply_authoring_settings", { ...args, approved: false })).toThrow();
    expect(f.artifacts.listVersions(f.p.id, AUTHORING_SETTINGS_ID)).toHaveLength(before);
    expect(() => f.artifacts.saveArtifact({ projectId: f.p.id, artifactId: AUTHORING_SETTINGS_ID, content: { ...f.repo.settings(f.p.id).settings, guide: { ...builtinFictionCraft(), text: "changed" } } })).toThrow();
  });
  it("preserves exact setting/edition across duplication, portable restore and process restart", () => {
    const f = fixture(); change(f, false); const copy = f.projects.duplicate(f.p.id, "Copy", validatePortableAuthoringProject);
    expect(f.repo.settings(copy.id).settings).toEqual(f.repo.settings(f.p.id).settings);
    const rows = new PortableProjectRepository(f.db).exportRows(f.p.id), directory = mkdtempSync(join(tmpdir(),"craft-restart-")), path = join(directory,"story.sqlite"); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    let target = openDatabase(path); new PortableProjectRepository(target).importRows(rows, validatePortableAuthoringProject); target.close();
    target = openDatabase(path); cleanup.push(() => target.close()); const service = new AuthoringSettingsService(target);
    expect(new AuthoringInstructionsRepository(target).settings(f.p.id).settings).toEqual(f.repo.settings(f.p.id).settings);
    expect(service.call("read_authoring_settings", { projectId: f.p.id })).toMatchObject({ context: { enabled: false, appliedGuide: null } });
  });
});

describe("installed MCP SDK settings lifecycle (native desktop remains separate)", () => {
  it("discovers scoped guide operations, revises a neutral project, and reconnects/replays after restart", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { buildApp } = await import("../src/app.js");
    const root = mkdtempSync(join(tmpdir(), "craft-mcp-")), databasePath = join(root,"story.sqlite"), projectId = randomUUID(), token = "offline-craft-token-"+randomUUID();
    const start = async () => {
      const app = buildApp({ databasePath, connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const client = new Client({ name: "craft-sdk-smoke", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(address+"/mcp"), { requestInit: { headers: { authorization: "Bearer "+token } } }));
      const call = async (name: string, args: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: args }); if (result.isError) throw new Error(JSON.stringify(result.content)); return result.structuredContent as any; };
      return { app, client, call };
    };
    let current = await start();
    try {
      const tools = (await current.client.listTools()).tools.map(t => t.name); expect(tools).toHaveLength(54);
      expect(tools).toEqual(expect.arrayContaining(["read_authoring_context", "read_authoring_settings", "review_authoring_settings", "apply_authoring_settings"]));
      await current.call("create_project", { projectId, name: "Neutral room fiction", operationId: randomUUID(), approved: true });
      const before = await current.call("read_authoring_settings", { projectId }); expect(before.context.enabled).toBe(true);
      const context = await current.call("read_authoring_context", { projectId, scope: "planning", artifactId: "brief" }); expect(context.authoringInstructions.appliedGuide.sha256).toBe(builtinFictionCraft().sha256);
      const input = { projectId, expectedVersionId: before.versionId, enabled: false }, review = await current.call("review_authoring_settings", input);
      const args = { ...input, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true }, applied = await current.call("apply_authoring_settings", args);
      await expect(current.call("read_authoring_settings", { projectId: randomUUID() })).rejects.toThrow(/access_denied/);
      await current.client.close(); await current.app.close(); current = await start();
      expect(await current.call("apply_authoring_settings", args)).toEqual(applied);
      const after = await current.call("read_authoring_context", { projectId, scope: "planning", artifactId: "brief" });
      expect(after.authoringInstructions.enabled).toBe(false); expect(after.authoringInstructions.appliedGuide).toBeNull();
      expect(JSON.stringify(after)).not.toContain(builtinFictionCraft().text);
    } finally { await current.client.close(); await current.app.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
