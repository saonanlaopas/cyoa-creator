import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { type WorldDefinition } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, type StoryDatabase } from "@story-to-cyoa/persistence";
import { actNativePlayerWorld, createNativePlayerSession } from "@story-to-cyoa/runtime";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService } from "../src/services/connected-edit-service.js";
import { ConnectedGameService } from "../src/services/connected-game-service.js";
import { AssetLibraryService } from "../src/services/asset-library-service.js";
import { PassagePlanService } from "../src/services/passage-plan-service.js";
import { PassageDraftService } from "../src/services/passage-draft-service.js";
import { NativeCompilationService } from "../src/services/native-compilation-service.js";
import { SimulationService } from "../src/services/simulation-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { prepareStudioHistoryDuplicate } from "../src/services/studio-history-duplication.js";
import { withAuthoredPeople } from "../../../e2e/helpers/people.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { unzipSync } from "fflate";
import { buildApp } from "../src/app.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { createNativePlayerConfig } from "@story-to-cyoa/runtime";
import { completeConnectedTextGame } from "../../../e2e/helpers/connected-text-game.js";
import { authoredWorld, townMap } from "../../../e2e/helpers/world.js";
import { imageMetadata } from "../../../e2e/helpers/image-assets.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function fixture(db: StoryDatabase = openDatabase(), projectId = randomUUID()) {
  const projects = new ProjectRepository(db), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db), drafts = new PassageDraftRepository(db);
  const passages = new PassagePlanRepository(db, (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation)), acceptance = new PassageDraftAcceptanceRepository(db, drafts);
  const longForm = new LongFormProjectService(projects, artifacts, workflow, new ChangeSetRepository(db), passages, drafts);
  const plans = new PassagePlanService(projects, artifacts, workflow, passages), prose = new PassageDraftService(db, projects, workflow, passages, drafts, acceptance);
  const compilation = new NativeCompilationService(projects, artifacts, workflow, passages, drafts), assets = new AssetLibraryService(db);
  const generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }]);
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, new ConnectedGameService(db, edits, plans, prose, new SimulationService(projects, artifacts, workflow, passages, drafts), compilation), assets);
  const call = async (tool: string, input: Record<string, unknown>) => await service.call(tool as any, input) as any;
  cleanups.push(() => { edits.shutdown(); db.close(); });
  const publication = new PublicationExportService(new PortableProjectRepository(db), compilation);
  return { db, projectId, projects, artifacts, passages, compilation, assets, call, service, publication, generate };
}
async function completed() {
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "W3 harbor encounters", approved: true });
  const proof = await completeConnectedTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, townMap(), "district.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  const world = await authoredWorld(f.call, f.projectId, { assetId: approved.assetId, versionId: approved.versionId });
  return { ...f, proof, candidate, approved, world: await withAuthoredPeople(f.call, f.projectId, world) };
}
async function apply(f: Awaited<ReturnType<typeof completed>>, world = f.world) {
  const review = await f.call("review_world", { projectId: f.projectId, world });
  const input = { projectId: f.projectId, operationId: randomUUID(), world, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_world", input) };
}

describe("W3 shared people authoring, history and offline publication", () => {
  it("stores versioned schedules/rules and inspects a player-safe presence view without mutation or provider calls", async () => {
    const f = await completed(), old = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId); await apply(f);
    const build = f.compilation.compile(f.projectId), initial = createNativePlayerSession(build.bundle, build.playerConfig);
    const before = f.db.prepare("SELECT count(*) n FROM artifact_versions").get();
    expect(await f.call("inspect_world_presence", { projectId: f.projectId, state: initial.state })).toMatchObject({ present: [], encounters: [], mandatory: { eventId: null, conflict: false }, providerCalls: 0 });
    const waited = actNativePlayerWorld(build.bundle, build.playerConfig, initial, { kind: "wait", minutes: 60 }).session;
    const view = await f.call("inspect_world_presence", { projectId: f.projectId, state: waited.state });
    expect(view.present).toEqual([{ id: "mara", name: "Mara" }]); expect(view.mandatory.eventId).toBe("urgent");
    expect(JSON.stringify(view)).not.toMatch(/schedules|until|days|overrides|1530|station/);
    expect(view.encounters.some((e: any) => e.id === "fleeting" && e.visible && !e.enabled)).toBe(true);
    expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(before);
    expect(build.bundle.world!.people!.schemaId).toBe("cyoa.native-people");
    expect(f.compilation.compile(f.projectId, old.input.id).bundle).toEqual(old.bundle);
    expect(f.generate).not.toHaveBeenCalled();
    const repeat = structuredClone(f.world); repeat.progression!.events[1]!.repeat = { kind: "repeatable", cooldownMinutes: 5 }; repeat.progression!.events[1]!.minutes = 10;
    const reviewed = await f.call("review_world", { projectId: f.projectId, world: repeat });
    expect(reviewed.diagnostics.findings.map((d: any) => d.code)).toContain("people.mandatory-may-repeat-immediately");
    await apply(f, repeat);
    expect(f.compilation.readiness(f.projectId).warnings.map((d) => d.code)).toContain("people.mandatory-may-repeat-immediately");
  });
  it("rejects schedule/override/mandatory conflicts and persistence bypasses, without changing current history", async () => {
    const f = await completed(), saved = await apply(f);
    for (const kind of ["schedule", "override", "mandatory", "reference"] as const) {
      const bad = structuredClone(f.world);
      if (kind === "schedule") bad.people!.schedules.push({ ...bad.people!.schedules[0]!, id: "overlap" });
      if (kind === "override") bad.people!.overrides.push({ ...bad.people!.overrides[0]!, id: "tie" });
      if (kind === "mandatory") bad.people!.events[2]!.priority = 20;
      if (kind === "reference") bad.people!.events[0]!.characterIds = ["missing"];
      await expect(f.call("review_world", { projectId: f.projectId, world: bad })).rejects.toThrow(/people_/);
      expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "world-definition", content: bad })).toThrow(/people_/);
    }
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(saved.result.versionId);
  });
  it("uses exact reviewed versions, retries lost responses and rolls back failed receipts for schedule edits", async () => {
    const f = await completed(); await apply(f); const changed = structuredClone(f.world); changed.people!.characters[0]!.name = "Mara Vale";
    const review = await f.call("review_world", { projectId: f.projectId, world: changed });
    const input = { projectId: f.projectId, world: changed, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true };
    f.db.exec("CREATE TEMP TRIGGER fail_people BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'people receipt failed'); END");
    await expect(f.call("apply_world", input)).rejects.toThrow("receipt failed");
    expect(f.artifacts.getCurrent<WorldDefinition>(f.projectId, "world-definition")!.content.people!.characters[0]!.name).toBe("Mara");
    f.db.exec("DROP TRIGGER fail_people"); const result = await f.call("apply_world", input); expect(await f.call("apply_world", input)).toEqual(result);
    await expect(f.call("apply_world", { ...input, operationId: randomUUID() })).rejects.toThrow("stale");
    await expect(f.call("apply_world", { ...input, world: f.world })).rejects.toThrow("conflict");
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("preserves %s schedules, exact historical builds, duplication and reviewed disabling", async (mode) => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const restored = fixture(openDatabase(), f.projectId); restored.publication.importPortable(f.publication.exportStudioPortable(f.projectId, mode).bytes);
    validatePortableAuthoringProject(restored.db, f.projectId);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle.world!.people).toEqual(build.bundle.world!.people);
    const copy = restored.projects.duplicate(f.projectId, "W3 copy", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    expect(restored.compilation.compile(copy.id).bundle.world!.people).toEqual(build.bundle.world!.people);
    if (mode === "full-fidelity") expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const { people: _people, ...without } = f.world; const review = await f.call("review_world", { projectId: f.projectId, world: without });
    await f.call("apply_world", { projectId: f.projectId, world: without, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
    expect(f.compilation.compile(f.projectId).bundle.world!.people).toBeUndefined(); expect(f.compilation.compile(f.projectId, build.input.id).bundle.world!.people).toEqual(build.bundle.world!.people);
  });
  it("backs up/restores W3 history and retry receipts and rejects resealed invalid history", async () => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const recovery = new RecoveryService(f.db, new PortableProjectRepository(f.db), f.publication, { applicationVersion: "W3-test" }), backup = await recovery.createVerifiedBackup(f.projectId);
    const restored = fixture(openDatabase(), f.projectId);
    await new RecoveryService(restored.db, new PortableProjectRepository(restored.db), restored.publication, { applicationVersion: "W3-test" }).restoreBackup(backup.bytes);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle); expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const bad = structuredClone(f.world); bad.people!.schedules[0]!.characterId = "unknown";
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify(bad), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
  });
  it("authors and inspects presence with the installed MCP SDK, loopback guards and no provider", async () => {
    const projectId = randomUUID(), token = randomUUID().repeat(2), generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
    const app = buildApp({ databasePath: ":memory:", connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true }, conversationalEditProvider: { id: "offline-edit", generate } });
    const address = await app.listen({ host: "127.0.0.1", port: 0 }), client = new Client({ name: "w3-offline-sdk", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      expect((await client.listTools()).tools.find((t) => t.name === "inspect_world_presence")?.annotations?.readOnlyHint).toBe(true);
      const call = async (name: string, input: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: input }); if (r.isError) throw new Error(JSON.stringify(r.content)); return r.structuredContent as any; };
      await call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "W3 SDK harbor" }); await completeConnectedTextGame(call, projectId);
      const world = await withAuthoredPeople(call, projectId, await authoredWorld(call, projectId)), review = await call("review_world", { projectId, world });
      await call("apply_world", { projectId, world, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      const ready = await call("publication_readiness", { projectId }), build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" });
      const files = unzipSync(new Uint8Array(await (await fetch(`${address}${exported.downloadPath}`)).arrayBuffer()));
      const bundle = JSON.parse(new TextDecoder().decode(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1])), config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle), state = actNativePlayerWorld(bundle, config, createNativePlayerSession(bundle, config), { kind: "wait", minutes: 60 }).session.state;
      expect(await call("inspect_world_presence", { projectId, state })).toMatchObject({ present: [{ id: "mara", name: "Mara" }], mandatory: { eventId: "urgent" }, providerCalls: 0 });
      await expect(call("inspect_world_presence", { projectId: randomUUID(), state })).rejects.toThrow("access_denied");
      expect(generate).not.toHaveBeenCalled();
    } finally { await client.close(); await app.close(); }
  });
});
