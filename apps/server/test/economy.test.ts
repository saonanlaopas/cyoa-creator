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
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "W4 harbor trade", approved: true });
  const proof = await completeEconomyTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, townMap(), "district.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  const world = await authoredWorld(f.call, f.projectId, { assetId: approved.assetId, versionId: approved.versionId });
  return { ...f, proof, candidate, approved, world: await withAuthoredEconomy(f.call, f.projectId, world) };
}
async function apply(f: Awaited<ReturnType<typeof completed>>, world = f.world) {
  const review = await f.call("review_world", { projectId: f.projectId, world });
  const input = { projectId: f.projectId, operationId: randomUUID(), world, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_world", input) };
}

describe("W4 shared trade authoring, exact history and offline exports", () => {
  it("binds canonical relationships, inspects without mutation, compiles deterministic inventory and retains the older bundle", async () => {
    const f = await completed(), older = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId); await apply(f);
    const build = f.compilation.compile(f.projectId), initial = createNativePlayerSession(build.bundle, build.playerConfig);
    expect(build.bundle.world!.economy!.relationships).toHaveLength(1);
    const before = f.db.prepare("SELECT count(*) n FROM artifact_versions").get();
    const view = await f.call("inspect_world_economy", { projectId: f.projectId, state: initial.state });
    expect(view).toMatchObject({ currency: { name: "Coins", amount: 20 }, items: [{ id: "tea", quantity: 1 }], providerCalls: 0 });
    expect(JSON.stringify(view)).not.toMatch(/schedules|overrides|apiKey|relationship_1/);
    expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(before);
    const waited = actNativePlayerWorld(build.bundle, build.playerConfig, initial, { kind: "wait", minutes: 5 }).session;
    const next = actNativePlayerWorld(build.bundle, build.playerConfig, waited, { kind: "purchase", id: "buy-tea" }).session;
    expect(await f.call("inspect_world_economy", { projectId: f.projectId, state: next.state })).toMatchObject({ currency: { amount: 16 }, shops: [expect.objectContaining({ offers: expect.arrayContaining([expect.objectContaining({ id: "buy-tea", stock: 2 })]) })] });
    expect(f.compilation.compile(f.projectId, older.input.id).bundle).toEqual(older.bundle); expect(f.generate).not.toHaveBeenCalled();
    const mechanics = f.artifacts.getCurrent<any>(f.projectId, "mechanics")!.content, oldKey = mechanics.relationships[0].key;
    mechanics.relationships[0].key = "constructor"; mechanics.choiceEffectPlans = mechanics.choiceEffectPlans.map((p: any) => ({ ...p, mechanicKeys: p.mechanicKeys.map((key: string) => key === oldKey ? "constructor" : key) }));
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "mechanics", content: mechanics });
    const renamed = structuredClone(f.world); renamed.economy!.gifts[0]!.effects.relationships[0]!.key = "constructor";
    renamed.progression!.events[0]!.prerequisites = renamed.progression!.events[0]!.prerequisites.map((c) => c.kind === "relationship" ? { ...c, key: "constructor" } : c);
    await apply(f, renamed);
    expect((await f.call("read_world", { projectId: f.projectId })).relationshipOptions[0].key).toBe("constructor");
    expect(f.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
  });
  it("rejects invalid trade references and direct persistence bypasses without changing current history", async () => {
    const f = await completed(), saved = await apply(f);
    for (const kind of ["item", "shop", "person", "consumable", "relationship", "condition", "balance", "duplicate"]) {
      const w = structuredClone(f.world), e = w.economy!;
      if (kind === "item") e.shops[0]!.offers[0]!.itemId = "unknown";
      if (kind === "shop") e.shops[0]!.locationId = "unknown";
      if (kind === "person") e.gifts[0]!.characterId = "unknown";
      if (kind === "consumable") e.uses[0]!.itemId = "ticket";
      if (kind === "relationship") e.gifts[0]!.effects.relationships[0]!.key = "unknown";
      if (kind === "condition") e.gifts[0]!.prerequisites = [{ kind: "relationship", key: "unknown", minimum: 0, maximum: null }];
      if (kind === "balance") e.currency.initial = 101;
      if (kind === "duplicate") e.uses[0]!.id = "buy-tea";
      await expect(f.call("review_world", { projectId: f.projectId, world: w })).rejects.toThrow(/economy_/);
      expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "world-definition", content: w })).toThrow(/economy_/);
    }
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(saved.result.versionId);
  });
  it("binds review to canonical mechanics versions and preserves exact older relationship bounds", async () => {
    const f = await completed(); await apply(f); const build = f.compilation.compile(f.projectId);
    const changed = structuredClone(f.world); changed.economy!.currency.initial = 21;
    const review = await f.call("review_world", { projectId: f.projectId, world: changed });
    const mechanics = f.artifacts.getCurrent<any>(f.projectId, "mechanics")!.content; mechanics.relationships[0].maximum = 20;
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "mechanics", content: mechanics });
    await expect(f.call("apply_world", { projectId: f.projectId, world: changed, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true })).rejects.toThrow("stale");
    expect(f.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
  });
  it("rolls back failed Apply receipts and retries lost responses with the same UUID exactly once", async () => {
    const f = await completed(); await apply(f); const w = structuredClone(f.world); w.economy!.shops[0]!.offers[0]!.price = 3;
    const review = await f.call("review_world", { projectId: f.projectId, world: w });
    const input = { projectId: f.projectId, world: w, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true };
    f.db.exec("CREATE TEMP TRIGGER fail_trade BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'trade receipt failed'); END");
    await expect(f.call("apply_world", input)).rejects.toThrow("receipt failed");
    expect(f.artifacts.getCurrent<WorldDefinition>(f.projectId, "world-definition")!.content.economy!.shops[0]!.offers[0]!.price).toBe(4);
    f.db.exec("DROP TRIGGER fail_trade"); const result = await f.call("apply_world", input);
    const count = f.db.prepare("SELECT count(*) n FROM artifact_versions").get(); expect(await f.call("apply_world", input)).toEqual(result); expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(count);
    await expect(f.call("apply_world", { ...input, world: f.world })).rejects.toThrow("conflict");
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("retains %s stock, rules and historical builds through archive and duplication", async (mode) => {
    const f = await completed(); await apply(f); const build = f.compilation.compile(f.projectId);
    const restored = fixture(openDatabase(), f.projectId); restored.publication.importPortable(f.publication.exportStudioPortable(f.projectId, mode).bytes); validatePortableAuthoringProject(restored.db, f.projectId);
    const imported = restored.compilation.compile(f.projectId, build.input.id).bundle;
    expect(imported.world).toEqual(build.bundle.world); expect(imported.initialState).toEqual(build.bundle.initialState); expect(imported.mechanics).toEqual(build.bundle.mechanics);
    if (mode === "full-fidelity") expect(imported).toEqual(build.bundle);
    const copy = restored.projects.duplicate(f.projectId, "W4 copy", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    expect(restored.compilation.compile(copy.id).bundle.world!.economy).toEqual(build.bundle.world!.economy);
    const { economy: _e, ...disabled } = f.world; disabled.progression!.events[0]!.prerequisites = [];
    await apply(f, disabled);
    const mechanics = f.artifacts.getCurrent<any>(f.projectId, "mechanics")!.content; mechanics.relationships = []; mechanics.choiceEffectPlans = mechanics.choiceEffectPlans.map((p: any) => ({ ...p, mechanicKeys: p.mechanicKeys.filter((key: string) => !key.startsWith("relationship_")) }));
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "mechanics", content: mechanics });
    validatePortableAuthoringProject(f.db, f.projectId);
    expect(f.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
  });
  it("backs up and restores inventory history and retry receipts and rejects tampered trade history", async () => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const backup = await new RecoveryService(f.db, new PortableProjectRepository(f.db), f.publication, { applicationVersion: "W4-test" }).createVerifiedBackup(f.projectId);
    const restored = fixture(openDatabase(), f.projectId);
    await new RecoveryService(restored.db, new PortableProjectRepository(restored.db), restored.publication, { applicationVersion: "W4-test" }).restoreBackup(backup.bytes);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle); expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const bad = structuredClone(f.world); bad.economy!.uses[0]!.itemId = "unknown";
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify(bad), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
  });
  it("authors inventory and inspects gameplay through the installed MCP SDK with project/loopback guards and no provider", async () => {
    const projectId = randomUUID(), token = randomUUID().repeat(2), generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
    const app = buildApp({ databasePath: ":memory:", connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true }, conversationalEditProvider: { id: "offline-edit", generate } });
    const address = await app.listen({ host: "127.0.0.1", port: 0 }), client = new Client({ name: "w4-offline-sdk", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      expect((await client.listTools()).tools.find((t) => t.name === "inspect_world_economy")?.annotations?.readOnlyHint).toBe(true);
      const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(JSON.stringify(r.content)); return r.structuredContent as any; };
      await call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "W4 SDK harbor" }); await completeEconomyTextGame(call, projectId);
      const w = await withAuthoredEconomy(call, projectId, await authoredWorld(call, projectId)), review = await call("review_world", { projectId, world: w }); await call("apply_world", { projectId, world: w, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      const ready = await call("publication_readiness", { projectId }), build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" }); const files = unzipSync(new Uint8Array(await (await fetch(`${address}${exported.downloadPath}`)).arrayBuffer()));
      const bundle = JSON.parse(new TextDecoder().decode(Object.entries(files).find(([p]) => p.endsWith("game.json"))![1])), config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle);
      const initial = createNativePlayerSession(bundle, config), waited = actNativePlayerWorld(bundle, config, initial, { kind: "wait", minutes: 5 }).session;
      const next = actNativePlayerWorld(bundle, config, waited, { kind: "purchase", id: "buy-tea" }).session;
      expect(await call("inspect_world_economy", { projectId, state: next.state })).toMatchObject({ currency: { amount: 16 }, items: [{ id: "tea", quantity: 2 }] });
      await expect(call("inspect_world_economy", { projectId: randomUUID(), state: next.state })).rejects.toThrow("access_denied");
      expect(generate).not.toHaveBeenCalled();
    } finally { await client.close(); await app.close(); }
  });
});
