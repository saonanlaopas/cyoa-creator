import { ImageAssetSchema, SceneDefaultsSchema, sceneDefaultKey, sourceCanonicalJson, type SceneDefaultSlot, type IllustratedScene } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { imageBindingMaps } from "./image-asset-validation.js";

export const sceneDefaultsId = "scene-defaults";
type Image = NonNullable<IllustratedScene["background"]>;
export function sceneDefaultAsset(database: StoryDatabase, projectId: string, slot: SceneDefaultSlot, ref: Image) {
  const row = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id=? AND id=? AND artifact_id=? AND artifact_type='image-asset' AND schema_version=1")
    .get(projectId, ref.versionId, `image-asset:${ref.assetId}`) as { content_json: string } | undefined;
  const asset = row && ImageAssetSchema.parse(JSON.parse(row.content_json));
  if (!asset || asset.assetId !== ref.assetId || asset.status !== "approved") throw new Error("scene_default_approved_asset_required");
  const d = asset.metadata.designation;
  if (slot.kind === "background" ? d?.role !== "background" || d.locationId !== slot.locationId
    : d?.role !== "portrait" || d.characterId !== slot.characterId || d.expressionKey !== slot.expressionKey) {
    throw new Error("scene_default_asset_binding_mismatch");
  }
  return { title: asset.metadata.title, designation: d };
}
export function sceneDefaultTarget(slot: SceneDefaultSlot, maps: ReturnType<typeof imageBindingMaps>) {
  return slot.kind === "background" ? maps.location.get(slot.locationId) : maps.character.get(slot.characterId);
}
export function validateSceneDefaults(database: StoryDatabase, projectId: string, value: unknown) {
  const defaults = SceneDefaultsSchema.parse(value);
  const keys = defaults.entries.map(({ slot }) => sceneDefaultKey(slot));
  if (new Set(keys).size !== keys.length) throw new Error("scene_default_duplicate_slot");
  for (const { slot, image } of defaults.entries) sceneDefaultAsset(database, projectId, slot, image);
  return defaults;
}

export function validateSceneDefaultsWrite(database: StoryDatabase, projectId: string, value: unknown) {
  const defaults = validateSceneDefaults(database, projectId, value);
  const prior = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id=? AND artifact_id=? ORDER BY version DESC LIMIT 1")
    .get(projectId, sceneDefaultsId) as { content_json: string } | undefined;
  const previous = new Map((prior ? SceneDefaultsSchema.parse(JSON.parse(prior.content_json)).entries : []).map(entry => [sceneDefaultKey(entry.slot), entry.image]));
  const maps = imageBindingMaps(database, projectId);
  for (const entry of defaults.entries) {
    const old = previous.get(sceneDefaultKey(entry.slot)) ?? null;
    if (!sceneDefaultTarget(entry.slot, maps) && sourceCanonicalJson(old) !== sourceCanonicalJson(entry.image)) throw new Error("scene_default_target_stale");
  }
  return defaults;
}
