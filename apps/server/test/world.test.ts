import { testDraftingContext } from "./helpers/authoring-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { WorldDefinitionSchema, emptyWorld, type WorldDefinition } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ImageAssetRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, type StoryDatabase } from "@story-to-cyoa/persistence";
import { actNativePlayerWorld, assertNativeRuntimeState, createNativePlayerSave, createNativePlayerSession, loadNativeGame, loadNativePlayerSave, rewindNativePlayerSession, restartNativePlayerSession } from "@story-to-cyoa/runtime";
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
import { resolveWorld } from "../src/services/world-service.js";
import { acceptGameDrafts, approveGamePlan, completeConnectedTextGame, submitGameDraft } from "../../../e2e/helpers/connected-text-game.js";
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
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, new ConnectedGameService(db, edits, plans, prose, new SimulationService(projects, artifacts, workflow, passages, drafts), compilation, testDraftingContext(db)), assets);
  const call = async (tool: string, input: Record<string, unknown>) => await service.call(tool as any, input) as any;
  cleanups.push(() => { edits.shutdown(); db.close(); });
  const publication = new PublicationExportService(new PortableProjectRepository(db), compilation);
  return { db, projectId, projects, artifacts, passages, compilation, assets, call, service, publication, generate };
}
async function completed() {
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "W1 harbor district", approved: true });
  const proof = await completeConnectedTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, townMap(), "district.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  const world = await authoredWorld(f.call, f.projectId, { assetId: approved.assetId, versionId: approved.versionId });
  return { ...f, proof, candidate, approved, world };
}
async function apply(f: Awaited<ReturnType<typeof completed>>, world = f.world) {
  const review = await f.call("review_world", { projectId: f.projectId, world });
  const input = { projectId: f.projectId, operationId: randomUUID(), world, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_world", input) };
}
describe("W1 durable reviewed locations and time", () => {
  it("pins a separate one-time introduction across reviewed Worlds, previews, saves and portability", async () => {
    const f = await completed(), legacy = await apply(f), old = f.compilation.compile(f.projectId);
    const world = structuredClone(f.world), home = world.locations.find(l => l.id === "home")!;
    world.introduction = home.passage!;
    const hub = f.passages.currentEntity(f.projectId, "passage", "passage-route-2-act")!;
    home.passage = { passageId: hub.entityId, versionId: hub.id };
    const unknown = { ...world, introduction: { ...world.introduction, versionId: hub.id } };
    await expect(f.call("review_world", { projectId: f.projectId, world: unknown })).rejects.toThrow("world_introduction_lineage_invalid");
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "world-definition", artifactType: "world-definition", content: unknown })).toThrow("world_introduction_lineage_invalid");
    await expect(f.call("review_world", { projectId: f.projectId, world: { ...world, introduction: home.passage } })).rejects.toThrow("world_introduction_cannot_be_a_world_destination");
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(legacy.result.versionId);
    const applied = await apply(f, world), build = f.compilation.compile(f.projectId);
    const { bundle, playerConfig } = build;
    const start = createNativePlayerSession(bundle, playerConfig);
    expect(start.state).toMatchObject({ currentPassageId: world.introduction.passageId, world: { locationId: "home", minutes: 1430 } });
    const cafe = actNativePlayerWorld(bundle, playerConfig, start, { kind: "travel", id: "home-cafe" }).session;
    const returned = actNativePlayerWorld(bundle, playerConfig, cafe, { kind: "travel", id: "cafe-home" }).session;
    expect(returned.state).toMatchObject({ currentPassageId: hub.entityId, world: { locationId: "home", minutes: 1460 }, visitCounts: { [world.introduction.passageId]: 1 } });
    expect(loadNativePlayerSave(bundle, playerConfig, createNativePlayerSave(bundle, playerConfig, returned))).toEqual(returned);
    expect(() => assertNativeRuntimeState(loadNativeGame(bundle), { ...cafe.state, currentPassageId: bundle.startPassageId })).toThrow("One-time introduction");
    expect(rewindNativePlayerSession(bundle, playerConfig, returned).state).toEqual(cafe.state);
    expect(restartNativePlayerSession(bundle, playerConfig)).toEqual(start);
    for (const mode of ["faithful-slice", "bounded-playtest"]) {
      const selection = { mode, passageIds: bundle.passages.map(p => p.id), startPassageId: bundle.startPassageId, stopPassageId: hub.entityId };
      const review = await f.call("review_preview", { projectId: f.projectId, selection });
      expect(review, JSON.stringify(review.blockers)).toMatchObject({ ready: true });
      const preview = await f.call("compile_preview", { projectId: f.projectId, selection: review.selection, operationId: randomUUID(),
        fingerprint: review.fingerprint, headFingerprint: review.headFingerprint, approved: true });
      const html = await f.call("export_preview", { projectId: f.projectId, buildVersionId: preview.buildVersionId });
      expect(html.kind).toBe("partial-preview");
      const wrongStart = await f.call("review_preview", { projectId: f.projectId, selection: { ...selection, startPassageId: hub.entityId } });
      expect(wrongStart.blockers).toContainEqual(expect.objectContaining({ message: expect.stringContaining("canonical World opening") }));
    }
    expect(f.compilation.compile(f.projectId, old.input.id).bundle).toEqual(old.bundle);
    const restored = fixture(openDatabase(), f.projectId);
    restored.publication.importPortable(f.publication.exportStudioPortable(f.projectId, "full-fidelity").bytes);
    expect(await restored.call("apply_world", applied.input)).toEqual(applied.result);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle).toEqual(bundle);
    const copy = restored.projects.duplicate(f.projectId, "Split World copy", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    const copiedWorld = restored.artifacts.getCurrent<WorldDefinition>(copy.id, "world-definition")!.content;
    expect(copiedWorld.introduction).toEqual({ passageId: world.introduction.passageId,
      versionId: restored.passages.currentEntity(copy.id, "passage", world.introduction.passageId)!.id });
    expect(restored.compilation.compile(copy.id).bundle.world?.introductionPassageId).toBe(world.introduction.passageId);
  });
  it("separates review/Apply/publication, preserves historical text builds, packages only approved map data and rejects unsupported exports", async () => {
    const f = await completed(), old = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId);
    expect(await f.call("read_world", { projectId: f.projectId })).toMatchObject({ versionId: null, world: { enabled: false } });
    const review = await f.call("review_world", { projectId: f.projectId, world: f.world });
    expect(review.previous).toBeNull(); expect(f.artifacts.getCurrent(f.projectId, "world-definition")).toBeUndefined();
    await apply(f);
    const current = f.compilation.compile(f.projectId), world = current.bundle.world!;
    expect(world.locations).toHaveLength(4); expect(world.assets).toHaveLength(1);
    expect(world.assets[0]!.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(world)).not.toMatch(/sourceName|sourceSha256|operationId|request|versionId|provenance/);
    expect(current.bundle.bundleFingerprint).not.toBe(old.bundle.bundleFingerprint);
    expect(f.compilation.compile(f.projectId, old.input.id).bundle).toEqual(old.bundle);
    const session = createNativePlayerSession(current.bundle, current.playerConfig);
    expect(actNativePlayerWorld(current.bundle, current.playerConfig, session, { kind: "travel", id: "home-cafe" }).session.state.world).toMatchObject({ locationId: "cafe", minutes: 1445 });
    expect(() => f.publication.exportMarkdown(f.projectId, current.input.id)).toThrow("world_unsupported");
    await expect(f.call("export_game", { projectId: f.projectId, buildVersionId: current.build.id, format: "markdown" })).rejects.toThrow("world_unsupported");
    expect(f.publication.inspectTwee(f.projectId, current.input.id)).toMatchObject({ compatible: false });
    expect(f.assets.usage(f.projectId, f.approved.assetId).assignments).toEqual([{ worldVersionId: f.artifacts.getCurrent(f.projectId, "world-definition")!.id, locationId: "town" }]);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("rejects simultaneous stale applies, UUID collisions, rolls back receipt failure and safely retries lost responses", async () => {
    const f = await completed(), first = await apply(f), next = { ...f.world, initialMinutes: 1420 };
    const review = await f.call("review_world", { projectId: f.projectId, world: next });
    const input = { projectId: f.projectId, world: next, operationId: randomUUID(), approved: true, fingerprint: review.fingerprint };
    f.db.exec("CREATE TEMP TRIGGER fail_world BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'world receipt failed'); END");
    await expect(f.call("apply_world", input)).rejects.toThrow("receipt failed");
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(first.result.versionId);
    f.db.exec("DROP TRIGGER fail_world");
    const results = await Promise.allSettled([f.call("apply_world", input), f.call("apply_world", { ...input, operationId: randomUUID() })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await f.call("apply_world", input)).toEqual((results[0] as PromiseFulfilledResult<any>).value);
    await expect(f.call("apply_world", { ...input, world: f.world })).rejects.toThrow("conflict");
    expect(await f.call("apply_world", first.input)).toEqual(first.result);
    await expect(f.call("read_world", { projectId: randomUUID() })).rejects.toThrow();
  });
  it.each(["cycle", "missing-parent", "missing-destination", "duplicate-id", "duplicate-passage", "negative-duration", "fractional-duration", "marker-range", "candidate-map", "wrong-map", "other-project-passage", "empty-hours", "unknown-version", "disabled-with-data", "wrong-start"])("rejects %s before persistence", async (attack) => {
    const f = await completed(), world = structuredClone(f.world);
    if (attack === "cycle") world.locations[0]!.parentId = "home";
    if (attack === "missing-parent") world.locations[1]!.parentId = "missing";
    if (attack === "missing-destination") world.connections[0]!.to = "missing";
    if (attack === "duplicate-id") world.locations[2]!.id = "home";
    if (attack === "duplicate-passage") world.locations[2]!.passage = world.locations[1]!.passage;
    if (attack === "negative-duration") world.connections[0]!.minutes = -1;
    if (attack === "fractional-duration") world.actions[0]!.minutes = 1.5;
    if (attack === "marker-range") world.locations[1]!.marker!.x = 101;
    if (attack === "candidate-map") world.locations[0]!.mapImage!.versionId = f.candidate.versionId;
    if (attack === "wrong-map") world.locations[0]!.mapImage!.assetId = randomUUID();
    if (attack === "other-project-passage") world.locations[1]!.passage!.versionId = randomUUID();
    if (attack === "empty-hours") world.locations[2]!.hours = { opens: 1, closes: 1 };
    if (attack === "unknown-version") (world as any).schemaVersion = 2;
    if (attack === "disabled-with-data") world.enabled = false;
    if (attack === "wrong-start") world.startLocationId = "cafe";
    await expect(apply(f, world)).rejects.toThrow();
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")).toBeUndefined();
  });
  it("requires explicit rebind after passage revision, preserves historical world builds and allows reviewed disabling", async () => {
    const f = await completed(); await apply(f); const build = f.compilation.compile(f.projectId);
    const p = f.passages.currentEntity(f.projectId, "passage", "passage-shared-opening")!;
    f.passages.saveEntity(f.projectId, "passage", p.entityId, { ...p.content as any, title: "New home" });
    await expect(apply(f)).rejects.toThrow("stale");
    await approveGamePlan(f.call, f.projectId);
    const selections = [];
    for (const row of build.bundle.passages) { const draft = await submitGameDraft(f.call, f.projectId, row.id, row.proseMarkdown); selections.push({ passageId: row.id, candidateDraftVersionId: draft.draftVersionId }); }
    await acceptGameDrafts(f.call, f.projectId, selections);
    expect(f.compilation.readiness(f.projectId).blockers.some((b) => b.code === "publication.world-invalid")).toBe(true);
    expect(f.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
    const rebound = await authoredWorld(f.call, f.projectId, f.world.locations[0]!.mapImage);
    await apply(f, rebound); expect(f.compilation.readiness(f.projectId).ready).toBe(true);
    await apply(f, emptyWorld()); expect(f.compilation.compile(f.projectId).bundle.world).toBeUndefined();
    expect(f.assets.usage(f.projectId, f.approved.assetId).totalAssignments).toBe(0);
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("restores and duplicates %s world histories and full-fidelity receipts", async (mode) => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const bytes = f.publication.exportStudioPortable(f.projectId, mode).bytes;
    const restored = fixture(openDatabase(), f.projectId); restored.publication.importPortable(bytes);
    validatePortableAuthoringProject(restored.db, f.projectId);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle.world).toEqual(build.bundle.world);
    if (mode === "full-fidelity") expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const copy = restored.projects.duplicate(f.projectId, "Copied world", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    validatePortableAuthoringProject(restored.db, copy.id);
    const compiled = restored.compilation.compile(copy.id);
    expect(compiled.bundle.world!.assets[0]!.dataUrl).toBe(build.bundle.world!.assets[0]!.dataUrl);
    expect(compiled.bundle.world!.locations.map((l) => l.name)).toEqual(build.bundle.world!.locations.map((l) => l.name));
  });
  it("guards direct persistence identity/history and corrupted dependencies, with non-destructive dependency restoration", async () => {
    const f = await completed();
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "wrong", artifactType: "world-definition", content: f.world })).toThrow("identity");
    const receipt = await apply(f);
    expect(() => f.artifacts.restore(f.projectId, "world-definition", receipt.result.versionId)).toThrow("requires_review");
    const asset = new ImageAssetRepository(f.db).version(f.projectId, f.approved.versionId);
    const row = f.db.prepare("SELECT id,content_json FROM artifact_versions WHERE project_id=? AND artifact_id=?").get(f.projectId, `image-file:${asset.content.fileSha256}`) as { id: string; content_json: string };
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.content_json), base64: "bad" }), row.id);
    expect(f.compilation.readiness(f.projectId).ready).toBe(false);
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(row.content_json, row.id);
    expect(f.compilation.readiness(f.projectId).ready).toBe(true);
    const broken = structuredClone(f.world); broken.connections[0]!.to = "missing";
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify(broken), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
    expect(() => f.publication.exportStudioPortable(f.projectId)).toThrow();
  });
  it("binds native inputs to exact world content and bounds Unicode definitions before MCP read/review overflow", async () => {
    const f = await completed(); await apply(f);
    const value: WorldDefinition = { ...f.world, actions: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, locationId: "home", label: "界".repeat(200), minutes: 1, result: "語".repeat(1000) })) };
    expect(() => WorldDefinitionSchema.parse(value)).toThrow("byte_limit");
    expect(Buffer.byteLength(JSON.stringify(await f.call("review_world", { projectId: f.projectId, world: f.world })))).toBeLessThan(256000);
    const resolved = resolveWorld(f.artifacts, f.projectId, f.world.locations.flatMap((l) => l.passage ? [{ entityId: l.passage.passageId, versionId: l.passage.versionId }] : []))!;
    expect(() => resolveWorld(f.artifacts, f.projectId, [], { versionId: resolved.versionId, contentFingerprint: "0".repeat(32) })).toThrow("lineage");
  });
});
