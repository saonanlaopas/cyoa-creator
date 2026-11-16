import { z } from "zod";
import { IllustratedSceneSchema, SceneAssetReferenceSchema, SceneBatchSelectionSchema, SceneDefaultSlotSchema, SceneDefaultsSchema,
  sceneDefaultKey, sourceDigest, type IllustratedScene, type SceneBatchSelection, type SceneDefaultSlot, type SceneDefaults } from "@story-to-cyoa/domain";
import { ArtifactRepository, imageBindingMaps, sceneDefaultAsset, sceneDefaultTarget, sceneDefaultsId, validateIllustratedScene, type StoryDatabase } from "@story-to-cyoa/persistence";
import { IllustratedSceneService } from "./illustrated-scene-service.js";

const projectId = z.string().min(1).max(200);
const change = z.object({ slot: SceneDefaultSlotSchema, image: SceneAssetReferenceSchema.nullable() }).strict();
const commit = { fingerprint: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().uuid(), approved: z.literal(true) };
export const SceneBatchInputs = {
  read_scene_defaults: z.object({ projectId }).strict(),
  review_scene_default: z.object({ projectId, change }).strict(),
  apply_scene_default: z.object({ projectId, change, ...commit }).strict(),
  review_scene_batch: z.object({ projectId, selection: SceneBatchSelectionSchema }).strict(),
  apply_scene_batch: z.object({ projectId, selection: SceneBatchSelectionSchema, ...commit }).strict(),
};
type Change = z.infer<typeof change>;
type SceneImage = NonNullable<IllustratedScene["background"]>;
const view = ({ dialogue, ...art }: IllustratedScene) => ({ ...art, dialogueLineCount: dialogue.length });

export class SceneBatchService {
  private readonly artifacts: ArtifactRepository;
  private readonly scenes: IllustratedSceneService;
  constructor(private readonly database: StoryDatabase) {
    this.artifacts = new ArtifactRepository(database);
    this.scenes = new IllustratedSceneService(database);
  }
  private current(projectId: string) {
    const saved = this.artifacts.getCurrent<SceneDefaults>(projectId, sceneDefaultsId);
    return { versionId: saved?.id ?? null, entries: saved?.content.entries ?? [] };
  }
  readDefaults(projectId: string) {
    const { versionId, entries } = this.current(projectId), maps = imageBindingMaps(this.database, projectId);
    return { versionId, entries: entries.map(({ slot, image }) => {
      const name = sceneDefaultTarget(slot, maps);
      return { slot, image, targetName: name ?? null, stale: !name };
    }), providerCalls: 0 };
  }
  private inspectDefault(projectId: string, requested: Change) {
    const current = this.current(projectId);
    const key = sceneDefaultKey(requested.slot), previous = current.entries.find(item => sceneDefaultKey(item.slot) === key) ?? null;
    const entries = current.entries.filter(item => sceneDefaultKey(item.slot) !== key);
    const targetName = sceneDefaultTarget(requested.slot, imageBindingMaps(this.database, projectId)) ?? null;
    const asset = requested.image ? sceneDefaultAsset(this.database, projectId, requested.slot, requested.image) : null;
    if (requested.image && !targetName) throw new Error("scene_default_target_stale");
    if (sourceDigest(previous?.image ?? null) === sourceDigest(requested.image)) throw new Error("scene_default_unchanged");
    if (requested.image) entries.push({ slot: requested.slot, image: requested.image });
    const next = SceneDefaultsSchema.parse({ schemaVersion: 1, entries });
    const result = { versionId: current.versionId, previous, change: requested, targetName, asset, providerCalls: 0 };
    return { next, review: { ...result, fingerprint: sourceDigest({ projectId, ...result }) } };
  }
  reviewDefault(projectId: string, requested: Change) { return this.inspectDefault(projectId, requested).review; }
  applyDefault(projectId: string, requested: Change, fingerprint: string) {
    const { next, review } = this.inspectDefault(projectId, requested);
    if (review.fingerprint !== fingerprint) throw new Error("scene_default_review_stale");
    const saved = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: sceneDefaultsId, content: next, markDependentsStale: false });
    return { versionId: saved.id, status: "applied", providerCalls: 0 };
  }
  private inspectBatch(projectId: string, selection: SceneBatchSelection) {
    if (new Set(selection.map(p => p.passageId)).size !== selection.length) throw new Error("scene_batch_duplicate_passage");
    const defaults = this.current(projectId), maps = imageBindingMaps(this.database, projectId);
    const byKey = new Map(defaults.entries.map(item => [sceneDefaultKey(item.slot), item.image]));
    const rows = selection.map(item => {
      const base = this.scenes.read(projectId, item.passageId);
      const before = base.currentVersionId ? view(base.scene) : null, scene = structuredClone(base.scene);
      const reasons: string[] = [], unresolved: string[] = [];
      let changed = false;
      if (base.stale) unresolved.push("Existing scene is stale. Rebind it through individual scene review before batching.");
      const lookup = (slot: SceneDefaultSlot): { image: SceneImage; title: string; name: string } | undefined => {
        const key = sceneDefaultKey(slot), name = sceneDefaultTarget(slot, maps), image = byKey.get(key);
        if (!name) { unresolved.push(`Missing canonical target for ${key}.`); return; }
        if (!image) { unresolved.push(`No default configured for ${key}.`); return; }
        try { return { image, title: sceneDefaultAsset(this.database, projectId, slot, image).title, name }; }
        catch (e) { unresolved.push(`Default ${key}: ${(e as Error).message}.`); return; }
      };
      const bg = item.background;
      if (bg) {
        if (scene.background && !bg.replace) reasons.push("Existing background preserved.");
        else {
          const found = lookup({ kind: "background", locationId: bg.locationId });
          if (found) {
            changed ||= sourceDigest(scene.background) !== sourceDigest(found.image);
            scene.background = found.image;
            reasons.push(`Background: default for ${found.name} (${bg.locationId}); ${found.title}.`);
          }
        }
      }
      const positions = new Set<string>(), characters = new Set<string>();
      for (const { position, characterId, expressionKey, replace } of item.portraits) {
        if (positions.has(position) || characters.has(characterId)) {
          unresolved.push("Ambiguous portrait selection: choose each position and canonical character at most once."); continue;
        }
        positions.add(position); characters.add(characterId);
        const previous = scene.portraits.find(p => p.position === position);
        if (previous && !replace) { reasons.push(`Existing ${position} portrait preserved.`); continue; }
        const found = lookup({ kind: "portrait", characterId, expressionKey });
        if (!found) continue;
        const portrait = { position, character: found.name, expression: expressionKey, image: found.image };
        if (sourceDigest(previous ?? null) !== sourceDigest(portrait)) {
          changed = true;
          if (previous) scene.portraits[scene.portraits.indexOf(previous)] = portrait;
          else scene.portraits.push(portrait);
        }
        reasons.push(`${position}: default for ${found.name} (${characterId}), expression ${expressionKey}; ${found.title}.`);
      }
      if (changed) scene.layout = "illustrated";
      if (!base.stale && changed && !unresolved.length) {
        const parsed = IllustratedSceneSchema.safeParse(scene);
        if (!parsed.success) unresolved.push("Proposed portraits conflict with existing display names or positions, or a character name exceeds the scene limit. Correct the selection or edit this scene individually.");
        else validateIllustratedScene(this.database, projectId, scene);
      }
      return { scene, changed, review: { passageId: item.passageId, passageVersionId: base.passageVersionId, sceneVersionId: base.currentVersionId,
        before, after: changed ? view(scene) : before, reasons, unresolved, changed } };
    });
    const ready = rows.some(row => row.changed) && rows.every(row => !row.review.unresolved.length);
    const review = { defaultsVersionId: defaults.versionId, passages: rows.map(row => row.review), ready, providerCalls: 0 };
    return { rows, review: { ...review, fingerprint: sourceDigest({ projectId, selection, review, scenes: rows.map(row => row.scene) }) } };
  }
  reviewBatch(projectId: string, selection: SceneBatchSelection) { return this.inspectBatch(projectId, selection).review; }
  applyBatch(projectId: string, selection: SceneBatchSelection, fingerprint: string) {
    const { rows, review } = this.inspectBatch(projectId, selection);
    if (review.fingerprint !== fingerprint) throw new Error("scene_batch_review_stale");
    if (!review.ready) throw new Error("scene_batch_unresolved_or_empty");
    const scenes = rows.filter(row => row.changed).map(({ scene }) => {
      const saved = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: `illustrated-scene:${scene.passageId}`, artifactType: "illustrated-scene",
        content: scene, markDependentsStale: false });
      return { passageId: scene.passageId, versionId: saved.id, sceneFingerprint: sourceDigest(scene) };
    });
    return { status: "applied", fingerprint, scenes, providerCalls: 0 };
  }
}
