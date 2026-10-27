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
import { withAuthoredJournal } from "../../../e2e/helpers/journal.js";
import { withAuthoredEconomy } from "../../../e2e/helpers/economy.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { unzipSync } from "fflate";
import { buildApp } from "../src/app.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { createNativePlayerConfig } from "@story-to-cyoa/runtime";
import { completeEconomyTextGame } from "../../../e2e/helpers/economy.js";
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
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "W5 harbor journal", approved: true });
  const proof = await completeEconomyTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, townMap(), "district.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  const world = await authoredWorld(f.call, f.projectId, { assetId: approved.assetId, versionId: approved.versionId });
  return { ...f, proof, candidate, approved, world: await withAuthoredJournal(f.call, f.projectId, await withAuthoredEconomy(f.call, f.projectId, world)) };
}
async function apply(f: Awaited<ReturnType<typeof completed>>, world = f.world) {
  const review = await f.call("review_world", { projectId: f.projectId, world });
  const input = { projectId: f.projectId, operationId: randomUUID(), world, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_world", input) };
}

describe("W5 shared journal controls, history and safe MCP projection", () => {
  it("authors and inspects only disclosed data, preserves earlier builds and never calls a provider", async () => {
    const f = await completed(), older = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId); await apply(f);
    const build = f.compilation.compile(f.projectId), s = createNativePlayerSession(build.bundle, build.playerConfig), before = f.db.prepare("SELECT count(*) n FROM artifact_versions").get();
    const v = await f.call("inspect_world_journal", { projectId: f.projectId, state: s.state });
    expect(v).toMatchObject({ providerCalls: 0, character: [{ category: "stat", value: 0 }], objectives: [{ id: "share" }], entries: [], events: [] });
    expect(JSON.stringify(v)).not.toMatch(/Undisclosed|station|Trust with Mara|minimum|when|schedules/);
    expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(before);
    expect(f.compilation.compile(f.projectId, older.input.id).bundle).toEqual(older.bundle); expect(f.generate).not.toHaveBeenCalled();
  });
  it("rejects invalid references through shared review and direct persistence with no partial history", async () => {
    const f = await completed(), saved = await apply(f);
    for (const kind of ["stat", "location", "event", "item", "duplicate", "contradiction"]) {
      const w = structuredClone(f.world), j = w.journal!;
      if (kind === "stat") j.character[0]!.key = "missing";
      if (kind === "location") j.locations[0]!.locationId = "missing";
      if (kind === "event") j.entries[0]!.when = [{ kind: "event", eventId: "missing", minimum: 1 }];
      if (kind === "item") j.entries[0]!.when = [{ kind: "item", itemId: "missing", minimum: 1, maximum: null }];
      if (kind === "duplicate") j.entries.push(j.entries[0]!);
      if (kind === "contradiction") j.entries[0]!.when = [{ kind: "time", from: 1500, until: 1400 }];
      await expect(f.call("review_world", { projectId: f.projectId, world: w })).rejects.toThrow(/journal_/);
      expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "world-definition", content: w })).toThrow(/journal_/);
    }
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(saved.result.versionId);
  });
  it("binds visibility reviews to exact canonical mechanics and recompiles historical labels and bounds", async () => {
    const f = await completed(); await apply(f); const build = f.compilation.compile(f.projectId), draft = structuredClone(f.world); draft.journal!.entries[0]!.title = "Revised signal note";
    const review = await f.call("review_world", { projectId: f.projectId, world: draft });
    const mechanics = f.artifacts.getCurrent<any>(f.projectId, "mechanics")!.content; mechanics.visibleStats[0].label = "Renamed insight"; mechanics.visibleStats[0].maximum += 1;
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "mechanics", content: mechanics });
    await expect(f.call("apply_world", { projectId: f.projectId, world: draft, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true })).rejects.toThrow(/stale/);
    expect(f.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
  });
  it("rejects stale world edits, rolls back failed writes and safely retries a lost Apply response", async () => {
    const f = await completed(); await apply(f); const w = structuredClone(f.world); w.journal!.entries[0]!.title = "Revised log";
    const r = await f.call("review_world", { projectId: f.projectId, world: w }), input = { projectId: f.projectId, world: w, fingerprint: r.fingerprint, operationId: randomUUID(), approved: true };
    f.db.exec("CREATE TRIGGER fail_w5 BEFORE INSERT ON artifact_versions WHEN NEW.artifact_id='world-definition' BEGIN SELECT RAISE(ABORT, 'fail_w5'); END;");
    await expect(f.call("apply_world", input)).rejects.toThrow(/fail_w5/); f.db.exec("DROP TRIGGER fail_w5");
    const first = await f.call("apply_world", input), count = f.db.prepare("SELECT count(*) n FROM artifact_versions WHERE artifact_id='world-definition'").get();
    expect(await f.call("apply_world", input)).toEqual(first); expect(f.db.prepare("SELECT count(*) n FROM artifact_versions WHERE artifact_id='world-definition'").get()).toEqual(count);
    await expect(f.call("apply_world", { ...input, world: f.world })).rejects.toThrow();
    await expect(f.call("inspect_world_journal", { projectId: randomUUID(), state: {} })).rejects.toThrow();
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("retains %s journal definitions and historical builds through archive and duplication", async (mode) => {
    const f = await completed(); await apply(f); const build = f.compilation.compile(f.projectId);
    const restored = fixture(openDatabase(), f.projectId); restored.publication.importPortable(f.publication.exportStudioPortable(f.projectId, mode).bytes); validatePortableAuthoringProject(restored.db, f.projectId);
    const imported = restored.compilation.compile(f.projectId, build.input.id).bundle;
    expect(imported.world).toEqual(build.bundle.world); expect(imported.initialState).toEqual(build.bundle.initialState); expect(imported.mechanics).toEqual(build.bundle.mechanics);
    if (mode === "full-fidelity") expect(imported).toEqual(build.bundle);
    const copy = restored.projects.duplicate(f.projectId, "W5 copy", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    expect(restored.compilation.compile(copy.id).bundle.world!.journal).toEqual(build.bundle.world!.journal);
  });
  it("backs up and restores journal history and retry receipts and rejects tampered definitions", async () => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const backup = await new RecoveryService(f.db, new PortableProjectRepository(f.db), f.publication, { applicationVersion: "W5-test" }).createVerifiedBackup(f.projectId);
    const restored = fixture(openDatabase(), f.projectId);
    await new RecoveryService(restored.db, new PortableProjectRepository(restored.db), restored.publication, { applicationVersion: "W5-test" }).restoreBackup(backup.bytes);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle); expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const bad = structuredClone(f.world); bad.journal!.character[0]!.key = "unknown";
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify(bad), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
  });
  it("authors journal visibility and inspects disclosed gameplay through the installed MCP SDK with project/loopback guards and no provider", async () => {
    const projectId = randomUUID(), token = randomUUID().repeat(2), generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
    const app = buildApp({ databasePath: ":memory:", connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true }, conversationalEditProvider: { id: "offline-edit", generate } });
    const address = await app.listen({ host: "127.0.0.1", port: 0 }), client = new Client({ name: "w5-offline-sdk", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      expect((await client.listTools()).tools.find((t) => t.name === "inspect_world_journal")?.annotations?.readOnlyHint).toBe(true);
      const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(JSON.stringify(r.content)); return r.structuredContent as any; };
      await call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "W5 SDK harbor" }); await completeEconomyTextGame(call, projectId);
      const w = await withAuthoredJournal(call, projectId, await withAuthoredEconomy(call, projectId, await authoredWorld(call, projectId))), review = await call("review_world", { projectId, world: w }); await call("apply_world", { projectId, world: w, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      const ready = await call("publication_readiness", { projectId }), build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" }); const files = unzipSync(new Uint8Array(await (await fetch(`${address}${exported.downloadPath}`)).arrayBuffer()));
      const bundle = JSON.parse(new TextDecoder().decode(Object.entries(files).find(([p]) => p.endsWith("game.json"))![1])), config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle);
      const initial = createNativePlayerSession(bundle, config), waited = actNativePlayerWorld(bundle, config, initial, { kind: "wait", minutes: 5 }).session;
      const next = actNativePlayerWorld(bundle, config, waited, { kind: "purchase", id: "buy-tea" }).session;
      expect(await call("inspect_world_journal", { projectId, state: next.state })).toMatchObject({ character: [{ category: "stat", value: 0 }], entries: [{ id: "signal-note" }], providerCalls: 0 });
      await expect(call("inspect_world_journal", { projectId: randomUUID(), state: next.state })).rejects.toThrow("access_denied");
      expect(generate).not.toHaveBeenCalled();
    } finally { await client.close(); await app.close(); }
  });
});
