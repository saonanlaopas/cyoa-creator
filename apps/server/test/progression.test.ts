import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { WorldDefinitionSchema, emptyWorld, type WorldDefinition } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ImageAssetRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, type StoryDatabase } from "@story-to-cyoa/persistence";
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
import { withAuthoredProgression } from "../../../e2e/helpers/progression.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { unzipSync } from "fflate";
import { buildApp } from "../src/app.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { createNativePlayerConfig, previewChapterTransition, stableFingerprint } from "@story-to-cyoa/runtime";
import { WorldService } from "../src/services/world-service.js";
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
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, new ConnectedGameService(db, edits, plans, prose, new SimulationService(projects, artifacts, workflow, passages, drafts), compilation), assets);
  const call = async (tool: string, input: Record<string, unknown>) => await service.call(tool as any, input) as any;
  cleanups.push(() => { edits.shutdown(); db.close(); });
  const publication = new PublicationExportService(new PortableProjectRepository(db), compilation);
  return { db, projectId, projects, artifacts, passages, compilation, assets, call, service, publication, generate };
}
async function completed() {
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "W2 harbor chapters", approved: true });
  const proof = await completeConnectedTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, townMap(), "district.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  const world = await authoredWorld(f.call, f.projectId, { assetId: approved.assetId, versionId: approved.versionId });
  return { ...f, proof, candidate, approved, world: await withAuthoredProgression(f.call, f.projectId, world) };
}
async function apply(f: Awaited<ReturnType<typeof completed>>, world = f.world) {
  const review = await f.call("review_world", { projectId: f.projectId, world });
  const input = { projectId: f.projectId, operationId: randomUUID(), world, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_world", input) };
}
describe("W2 durable chapters/events across shared authoring and publication", () => {
  it("reviews without mutation, returns bounded non-exhaustive diagnostics, compiles public rules and previews through the shared MCP operation", async () => {
    const f = await completed(), old = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId);
    const review = await f.call("review_world", { projectId: f.projectId, world: f.world });
    expect(review.diagnostics).toMatchObject({ exhaustive: false, omitted: 0 });
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")).toBeUndefined();
    await apply(f); const current = f.compilation.compile(f.projectId);
    expect(current.bundle.world!.progression!.chapters.map((c) => c.name)).toEqual(["Before dawn", "After the crossing"]);
    expect(JSON.stringify(current.bundle.world)).not.toMatch(/versionId|Author request|operationId|provenance/);
    expect(current.bundle.world!.progression!.transitions[0]!.passageId).toBe("passage-route-1-act");
    expect(f.compilation.compile(f.projectId, old.input.id).bundle).toEqual(old.bundle);
    const start = createNativePlayerSession(current.bundle, current.playerConfig), next = actNativePlayerWorld(current.bundle, current.playerConfig, start, { kind: "event", id: "notice" }).session;
    const before = f.db.prepare("SELECT count(*) n FROM artifact_versions").get();
    const preview = await f.call("preview_chapter_transition", { projectId: f.projectId, transitionId: "next", state: next.state });
    expect(preview.preview).toEqual(previewChapterTransition(current.bundle.world!, next.state, "next"));
    expect(preview.preview.lostOpportunities.some((e: any) => e.id === "conversation")).toBe(true);
    expect(f.db.prepare("SELECT count(*) n FROM artifact_versions").get()).toEqual(before);
    expect(f.compilation.readiness(f.projectId).warnings.some((w) => w.code.startsWith("progression."))).toBe(false);
    expect(() => f.publication.exportMarkdown(f.projectId, current.input.id)).toThrow("world_unsupported");
    expect(f.publication.inspectTwee(f.projectId, current.input.id)).toMatchObject({ compatible: false });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("rejects contradictory prerequisites, bad references and direct persistence bypasses without changing durable history", async () => {
    const f = await completed(); const prior = await apply(f);
    const contradictory = structuredClone(f.world); contradictory.progression!.events[0]!.prerequisites.push({ kind: "chapter", chapterId: "first", current: false });
    await expect(f.call("review_world", { projectId: f.projectId, world: contradictory })).rejects.toThrow("contradictory");
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "world-definition", content: contradictory })).toThrow("contradictory");
    const missing = structuredClone(f.world); missing.progression!.transitions[0]!.carryMilestoneIds.push("invented");
    await expect(f.call("review_world", { projectId: f.projectId, world: missing })).rejects.toThrow("transition_policy_invalid");
    const foreign = structuredClone(f.world); foreign.progression!.transitions[0]!.passage!.versionId = randomUUID();
    await expect(f.call("review_world", { projectId: f.projectId, world: foreign })).rejects.toThrow("lineage");
    expect(f.artifacts.getCurrent(f.projectId, "world-definition")!.id).toBe(prior.result.versionId);
  });
  it("guards concurrent/changed reviews, safely retries receipts after a lost response, and rolls back a failed receipt", async () => {
    const f = await completed(); await apply(f);
    const changed = structuredClone(f.world); changed.progression!.events[0]!.result = "The revised signal clue is recorded.";
    const review = await f.call("review_world", { projectId: f.projectId, world: changed });
    const input = { projectId: f.projectId, operationId: randomUUID(), world: changed, fingerprint: review.fingerprint, approved: true };
    f.db.exec("CREATE TEMP TRIGGER fail_progression BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'progression receipt failed'); END");
    await expect(f.call("apply_world", input)).rejects.toThrow("receipt failed");
    expect(f.artifacts.getCurrent<WorldDefinition>(f.projectId, "world-definition")!.content.progression!.events[0]!.result).not.toBe(changed.progression!.events[0]!.result);
    f.db.exec("DROP TRIGGER fail_progression");
    const result = await f.call("apply_world", input); expect(await f.call("apply_world", input)).toEqual(result);
    await expect(f.call("apply_world", { ...input, world: f.world })).rejects.toThrow("conflict");
    await expect(f.call("apply_world", { ...input, operationId: randomUUID() })).rejects.toThrow("stale");
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("retains exact W2 history in %s archives, receipts, duplication and historical compilation", async (mode) => {
    const f = await completed(), receipt = await apply(f), build = f.compilation.compile(f.projectId);
    const restored = fixture(openDatabase(), f.projectId); restored.publication.importPortable(f.publication.exportStudioPortable(f.projectId, mode).bytes);
    validatePortableAuthoringProject(restored.db, f.projectId);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle.world).toEqual(build.bundle.world);
    if (mode === "full-fidelity") expect(await restored.call("apply_world", receipt.input)).toEqual(receipt.result);
    const copy = restored.projects.duplicate(f.projectId, "Copied chapters", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    const compiled = restored.compilation.compile(copy.id);
    expect(compiled.bundle.world!.progression).toEqual(build.bundle.world!.progression);
    expect(compiled.bundle.bundleFingerprint).not.toBe(build.bundle.bundleFingerprint);
    const world = restored.artifacts.getCurrent<WorldDefinition>(f.projectId, "world-definition")!.content;
    const { progression: _progression, ...chapterFreeWorld } = world;
    const worldReview = await restored.call("review_world", { projectId: f.projectId, world: chapterFreeWorld });
    await restored.call("apply_world", { projectId: f.projectId, world: chapterFreeWorld, operationId: randomUUID(), approved: true, fingerprint: worldReview.fingerprint });
    expect(restored.compilation.compile(f.projectId).bundle.world!.progression).toBeUndefined();
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle.world!.progression).toEqual(build.bundle.world!.progression);
  });
  it("binds progression-only destination versions and rejects forged portable histories", async () => {
    const f = await completed();
    const extra = (await f.call("read_game_record", { projectId: f.projectId, kind: "passage", entityId: "passage-ending-1" })).record;
    f.world.progression!.events[0]!.passage = { passageId: extra.entityId, versionId: extra.id };
    const receipt = await apply(f), build = f.compilation.compile(f.projectId);
    f.passages.saveEntity(f.projectId, "passage", extra.entityId, { ...extra.content, title: "Revised event destination" });
    await expect(apply(f)).rejects.toThrow("stale");
    expect(f.compilation.compile(f.projectId, build.input.id).bundle.world!.progression!.events[0]!.passageId).toBe(extra.entityId);
    const broken = structuredClone(f.world); broken.progression!.initialChapterId = "forged";
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify(broken), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
    expect(() => f.publication.exportStudioPortable(f.projectId)).toThrow();
  });
});

describe("W2 diagnostics, backups and installed MCP transport", () => {
  it("surfaces potential traps in review and publication without misrepresenting them as exhaustive blockers", async () => {
    const f = await completed(); f.world.progression!.events[0]!.prerequisites.push({ kind: "milestone", milestoneId: "clue", achieved: true });
    const review = await f.call("review_world", { projectId: f.projectId, world: f.world });
    expect(review.diagnostics).toMatchObject({ exhaustive: false, omitted: 0 });
    expect(review.diagnostics.findings.map((item: any) => item.code)).toContain("progression.potential-progression-trap");
    await apply(f); const ready = f.compilation.readiness(f.projectId);
    expect(ready.ready).toBe(true); expect(ready.warnings.some((item) => item.code === "progression.potential-progression-trap")).toBe(true);
  });
  it("backs up/restores exact W2 definitions, historical builds and replay-safe outcomes", async () => {
    const f = await completed(), applied = await apply(f), build = f.compilation.compile(f.projectId);
    const recovery = new RecoveryService(f.db, new PortableProjectRepository(f.db), f.publication, { applicationVersion: "W2-test" });
    const backup = await recovery.createVerifiedBackup(f.projectId);
    expect(backup.record.verificationStatus).toBe("verified");
    const restored = fixture(openDatabase(), f.projectId);
    await new RecoveryService(restored.db, new PortableProjectRepository(restored.db), restored.publication, { applicationVersion: "W2-test" }).restoreBackup(backup.bytes);
    expect(restored.compilation.compile(f.projectId, build.input.id).bundle).toEqual(build.bundle);
    expect(await restored.call("apply_world", applied.input)).toEqual(applied.result);
  });
  it("authors and previews W2 with the installed MCP SDK, refusing unauthorized projects and provider generation", async () => {
    const projectId = randomUUID(), token = randomUUID().repeat(2), generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
    const app = buildApp({ databasePath: ":memory:", connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true }, conversationalEditProvider: { id: "offline-edit", generate } });
    const address = await app.listen({ host: "127.0.0.1", port: 0 }), client = new Client({ name: "w2-offline-native-client", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      const tools = await client.listTools(); expect(tools.tools.find((t) => t.name === "preview_chapter_transition")?.annotations?.readOnlyHint).toBe(true);
      const call = async (name: string, input: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: input }); if (result.isError) throw new Error(JSON.stringify(result.content)); return result.structuredContent as any; };
      await call("create_project", { projectId, operationId: randomUUID(), name: "W2 SDK harbor", approved: true });
      await completeConnectedTextGame(call, projectId);
      const world = await withAuthoredProgression(call, projectId, await authoredWorld(call, projectId));
      const review = await call("review_world", { projectId, world });
      await call("apply_world", { projectId, operationId: randomUUID(), approved: true, world, fingerprint: review.fingerprint });
      const ready = await call("publication_readiness", { projectId });
      const build = await call("compile_game", { projectId, operationId: randomUUID(), approved: true, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint });
      const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" });
      const files = unzipSync(new Uint8Array(await (await fetch(`${address}${exported.downloadPath}`)).arrayBuffer()));
      const bundle = JSON.parse(new TextDecoder().decode(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]));
      const config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle), initial = createNativePlayerSession(bundle, config);
      const noticed = actNativePlayerWorld(bundle, config, initial, { kind: "event", id: "notice" }).session;
      const preview = await call("preview_chapter_transition", { projectId, transitionId: "next", state: noticed.state });
      expect(preview.preview).toEqual(previewChapterTransition(bundle.world, noticed.state, "next"));
      await expect(call("preview_chapter_transition", { projectId: randomUUID(), transitionId: "next", state: noticed.state })).rejects.toThrow("access_denied");
      expect(generate).not.toHaveBeenCalled();
    } finally { await client.close(); await app.close(); }
  });
});
