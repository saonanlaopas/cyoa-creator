import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { type IllustratedScene } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ImageAssetRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, type StoryDatabase } from "@story-to-cyoa/persistence";
import { createNativePlayerSave, createNativePlayerSession, loadNativePlayerSave, nativeBundleFingerprint, validateNativeGameBundle } from "@story-to-cyoa/runtime";
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
import { acceptGameDrafts, approveGamePlan, completeConnectedTextGame, submitGameDraft } from "../../../e2e/helpers/connected-text-game.js";
import { fixtureImage, imageMetadata } from "../../../e2e/helpers/image-assets.js";

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
  const f = fixture(); await f.call("create_project", { projectId: f.projectId, operationId: randomUUID(), name: "V2 illustrated harbor", approved: true });
  const proof = await completeConnectedTextGame(f.call, f.projectId);
  const candidate = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, fixtureImage(), "harbor.png", "image/png");
  const review = f.assets.review(f.projectId, candidate.assetId, candidate.versionId);
  const approved = await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
  return { ...f, proof, candidate, approved };
}
function scene(f: { projectId: string; passages: PassagePlanRepository; approved: { assetId: string; versionId: string } }): IllustratedScene {
  return { schemaId: "cyoa.illustrated-scene", schemaVersion: 1, passageId: "passage-shared-opening", passageVersionId: f.passages.currentEntity(f.projectId, "passage", "passage-shared-opening")!.id,
    layout: "illustrated", background: { assetId: f.approved.assetId, versionId: f.approved.versionId },
    portraits: [{ character: "Mira", expression: "Concerned", position: "left", image: { assetId: f.approved.assetId, versionId: f.approved.versionId } }],
    dialogue: [{ speaker: "Mira", text: "Who lit that signal?" }] };
}
async function applied(f: Awaited<ReturnType<typeof completed>>, value = scene(f)) {
  const review = await f.call("review_scene", { projectId: f.projectId, scene: value });
  const input = { projectId: f.projectId, operationId: randomUUID(), scene: value, fingerprint: review.fingerprint, approved: true };
  return { input, result: await f.call("apply_scene", input) };
}

describe("V2 reviewed illustrated scenes", () => {
  it("keeps review separate, pins approved images, compiles and packages only public presentation, preserving old text builds/saves", async () => {
    const f = await completed(), old = f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId);
    const save = createNativePlayerSave(old.bundle, old.playerConfig, createNativePlayerSession(old.bundle, old.playerConfig));
    const review = await f.call("review_scene", { projectId: f.projectId, scene: scene(f) });
    expect(f.artifacts.getCurrent(f.projectId, "illustrated-scene:passage-shared-opening")).toBeUndefined();
    expect(review.previous).toBeNull();
    await applied(f);
    const current = f.compilation.compile(f.projectId);
    expect(current.bundle.illustratedPresentation).toMatchObject({ schemaVersion: 1, scenes: [{ dialogue: [{ speaker: "Mira", text: "Who lit that signal?" }], background: f.approved.versionId }] });
    expect(current.bundle.illustratedPresentation!.assets).toHaveLength(1);
    expect(current.bundle.illustratedPresentation!.assets[0]!.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(current.bundle.runtimeFingerprint).toBe(old.bundle.runtimeFingerprint);
    expect(current.bundle.bundleFingerprint).not.toBe(old.bundle.bundleFingerprint);
    expect(f.compilation.compile(f.projectId, f.proof.compiled.inputVersionId).bundle).toEqual(old.bundle);
    expect(loadNativePlayerSave(old.bundle, old.playerConfig, save).state).toEqual(save.state);
    const html = await f.publication.exportStandalone(f.projectId, current.input.id);
    expect(html.html).toContain("connect-src 'none'");
    expect(JSON.stringify(current.bundle)).not.toMatch(/sourceName|sourceSha256|assistant-import|Author request|operationId|fingerprint.*64/);
    expect(() => f.publication.exportMarkdown(f.projectId, current.input.id)).toThrow("illustrated_scenes_unsupported");
    await expect(f.call("export_game", { projectId: f.projectId, buildVersionId: current.build.id, format: "markdown" })).rejects.toThrow("illustrated_scenes_unsupported");
    expect(f.publication.inspectTwee(f.projectId, current.input.id)).toMatchObject({ compatible: false });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["candidate", "wrong-asset", "other-project", "duplicate-position", "text-with-art", "stale-passage"])("rejects %s before applying", async (attack) => {
    const f = await completed(), value = scene(f);
    if (attack === "candidate") value.background!.versionId = f.candidate.versionId;
    if (attack === "wrong-asset") value.background!.assetId = randomUUID();
    if (attack === "other-project") value.passageVersionId = randomUUID();
    if (attack === "duplicate-position") value.portraits.push({ ...value.portraits[0]!, character: "Other" });
    if (attack === "text-with-art") value.layout = "text";
    if (attack === "stale-passage") { const p = f.passages.currentEntity(f.projectId, "passage", value.passageId)!; f.passages.saveEntity(f.projectId, "passage", p.entityId, { ...p.content as any, title: "Changed passage" }); }
    await expect(applied(f, value)).rejects.toThrow();
    expect(f.artifacts.getCurrent(f.projectId, `illustrated-scene:${value.passageId}`)).toBeUndefined();
  });

  it("rejects stale review and operation collisions, handles overlapping applies, atomically rolls back receipt failure then replays lost responses", async () => {
    const f = await completed(), first = await applied(f), value = { ...scene(f), dialogue: [{ speaker: "Mira", text: "A new signal." }] };
    const reviewed = await f.call("review_scene", { projectId: f.projectId, scene: value });
    const input = { projectId: f.projectId, scene: value, fingerprint: reviewed.fingerprint, operationId: randomUUID(), approved: true };
    f.db.exec("CREATE TEMP TRIGGER fail_scene BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'scene receipt failed'); END");
    await expect(f.call("apply_scene", input)).rejects.toThrow("receipt failed");
    expect(f.artifacts.getCurrent(f.projectId, `illustrated-scene:${value.passageId}`)!.id).toBe(first.result.versionId);
    f.db.exec("DROP TRIGGER fail_scene");
    const result = await f.call("apply_scene", input);
    expect(await f.call("apply_scene", input)).toEqual(result);
    await expect(f.call("apply_scene", { ...input, operationId: randomUUID() })).rejects.toThrow("stale");
    await expect(f.call("apply_scene", { ...input, scene: scene(f) })).rejects.toThrow("conflict");
    expect(await f.call("apply_scene", first.input)).toEqual(first.result);
  });

  it("requires explicit scene re-review after a legitimate passage revision, while historical illustrated builds remain playable", async () => {
    const f = await completed(); await applied(f);
    const historical = f.compilation.compile(f.projectId), value = scene(f), reviewed = await f.call("review_scene", { projectId: f.projectId, scene: value });
    const p = f.passages.currentEntity(f.projectId, "passage", value.passageId)!;
    f.passages.saveEntity(f.projectId, "passage", p.entityId, { ...p.content as any, title: "The Signal Revisited" });
    await expect(f.call("apply_scene", { projectId: f.projectId, operationId: randomUUID(), approved: true, scene: value, fingerprint: reviewed.fingerprint })).rejects.toThrow("passage_stale");
    await approveGamePlan(f.call, f.projectId);
    const selections = [];
    for (const row of historical.bundle.passages) {
      const result = await submitGameDraft(f.call, f.projectId, row.id, row.proseMarkdown);
      selections.push({ passageId: row.id, candidateDraftVersionId: result.draftVersionId });
    }
    await acceptGameDrafts(f.call, f.projectId, selections);
    expect(f.compilation.readiness(f.projectId).blockers.some((b) => b.code === "publication.illustration-invalid")).toBe(true);
    expect(f.compilation.compile(f.projectId, historical.input.id).bundle).toEqual(historical.bundle);
    const state = await f.call("read_scene", { projectId: f.projectId, passageId: value.passageId }); expect(state.stale).toBe(true);
    await applied(f, { ...state.scene, passageVersionId: state.passageVersionId });
    expect(f.compilation.readiness(f.projectId).ready).toBe(true);
  });

  it("retains pinned approved bytes after replacement; usage tracks assignments, and text fallback/removal remains recoverable", async () => {
    const f = await completed(); await applied(f);
    const build = f.compilation.compile(f.projectId), oldData = build.bundle.illustratedPresentation!.assets[0]!.dataUrl;
    const replacement = await f.assets.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: f.approved.assetId, expectedVersionId: f.approved.versionId, metadata: { ...imageMetadata, title: "Sunset" } }, fixtureImage(512, 320, true), "sunset.png", "image/png");
    const review = f.assets.review(f.projectId, replacement.assetId, replacement.versionId);
    await f.call("approve_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: replacement.assetId, versionId: replacement.versionId, fingerprint: review.fingerprint });
    expect(f.compilation.compile(f.projectId).bundle.illustratedPresentation!.assets[0]!.dataUrl).toBe(oldData);
    expect(f.assets.usage(f.projectId, f.approved.assetId).totalAssignments).toBe(1);
    await applied(f, { ...scene(f), layout: "text", background: null, portraits: [], dialogue: [] });
    expect(f.assets.usage(f.projectId, f.approved.assetId).totalAssignments).toBe(0);
    const text = f.compilation.compile(f.projectId);
    expect(text.bundle.illustratedPresentation?.scenes).toEqual([]);
    expect(text.bundle.illustratedPresentation?.assets).toEqual([]);
    expect(f.compilation.compile(f.projectId, build.input.id).bundle.illustratedPresentation!.assets[0]!.dataUrl).toBe(oldData);
  });

  it.each(["missing-file", "invalid-file"])("blocks %s without publishing broken media and recovers after restoration", async (attack) => {
    const f = await completed(); await applied(f);
    const asset = new ImageAssetRepository(f.db).version(f.projectId, f.approved.versionId);
    const row = f.db.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND artifact_id=?").get(f.projectId, `image-file:${asset.content.fileSha256}`) as any;
    if (attack === "missing-file") f.db.prepare("DELETE FROM artifact_versions WHERE id=?").run(row.id);
    else f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.content_json), base64: "bad" }), row.id);
    expect(f.compilation.readiness(f.projectId).ready).toBe(false);
    expect(() => f.compilation.compile(f.projectId)).toThrow();
    if (attack === "missing-file") { const cols = Object.keys(row); f.db.prepare(`INSERT INTO artifact_versions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c])); }
    else f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(row.content_json, row.id);
    expect(f.compilation.readiness(f.projectId).ready).toBe(true);
  });

  it.each(["full-fidelity", "privacy-redacted"] as const)("restores and duplicates %s exact scene/build history; full archive replays receipts", async (mode) => {
    const f = await completed(), receipt = await applied(f), build = f.compilation.compile(f.projectId);
    const bytes = f.publication.exportStudioPortable(f.projectId, mode).bytes;
    const target = fixture(openDatabase(), f.projectId); target.publication.importPortable(bytes);
    validatePortableAuthoringProject(target.db, f.projectId);
    const restored = target.compilation.compile(f.projectId, build.input.id).bundle;
    expect(restored).toMatchObject({ illustratedPresentation: build.bundle.illustratedPresentation, bundleFingerprint: build.bundle.bundleFingerprint, runtimeFingerprint: build.bundle.runtimeFingerprint });
    if (mode === "full-fidelity") expect(restored).toEqual(build.bundle);
    else expect(restored.source.inputFingerprint).not.toBe(build.bundle.source.inputFingerprint);
    if (mode === "full-fidelity") expect(await target.call("apply_scene", receipt.input)).toEqual(receipt.result);
    const copy = target.projects.duplicate(f.projectId, "Copied illustration", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    validatePortableAuthoringProject(target.db, copy.id);
    const copied = target.compilation.compile(copy.id);
    expect(copied.bundle.illustratedPresentation!.assets[0]!.dataUrl).toBe(build.bundle.illustratedPresentation!.assets[0]!.dataUrl);
  });

  it("rejects direct persistence and archive scene/asset lineage tampering, as well as malformed native references", async () => {
    const f = await completed(), value = scene(f);
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "illustrated-scene:wrong", artifactType: "illustrated-scene", content: value })).toThrow("identity");
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: `illustrated-scene:${value.passageId}`, content: { ...value, background: { ...value.background!, versionId: f.candidate.versionId } } })).toThrow();
    const receipt = await applied(f), build = f.compilation.compile(f.projectId), bad = structuredClone(build.bundle);
    expect(() => f.artifacts.restore(f.projectId, `illustrated-scene:${value.passageId}`, receipt.result.versionId)).toThrow("scene_restore_requires_review");
    bad.illustratedPresentation!.assets = []; bad.bundleFingerprint = nativeBundleFingerprint(bad);
    expect(() => validateNativeGameBundle(bad)).toThrow("Missing packaged illustration");
    f.db.prepare("UPDATE artifact_versions SET content_json=? WHERE id=?").run(JSON.stringify({ ...value, background: { ...value.background!, versionId: f.candidate.versionId } }), receipt.result.versionId);
    expect(() => validatePortableAuthoringProject(f.db, f.projectId)).toThrow();
    expect(() => f.publication.exportStudioPortable(f.projectId)).toThrow();
  });

  it("keeps maximum Unicode scene reviews below the MCP response ceiling and normalizes direct persistence content", async () => {
    const f = await completed(), value = { ...scene(f), dialogue: Array.from({ length: 12 }, () => ({ speaker: "\u754c".repeat(100), text: "\u754c".repeat(2000) })) };
    await applied(f, value);
    const result = await f.call("review_scene", { projectId: f.projectId, scene: { ...value, dialogue: value.dialogue.map((d) => ({ ...d, text: "\u8a9e".repeat(2000) })) } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(256000);
    const saved = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: `illustrated-scene:${value.passageId}`, artifactType: "illustrated-scene", content: { ...value, dialogue: [{ speaker: " Mira ", text: " Signal. " }] } });
    expect(saved.content.dialogue).toEqual([{ speaker: "Mira", text: "Signal." }]);
    expect(f.compilation.readiness(f.projectId).ready).toBe(true);
  });
});
