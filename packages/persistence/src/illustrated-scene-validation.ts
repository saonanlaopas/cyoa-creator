import { IllustratedSceneSchema, ImageAssetSchema, sceneAssetReferences } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";

export function validateIllustratedScene(database: StoryDatabase, projectId: string, value: unknown) {
  const scene = IllustratedSceneSchema.parse(value);
  const passage = database.prepare("SELECT 1 FROM passage_entity_versions WHERE project_id=? AND id=? AND entity_kind='passage' AND entity_id=?")
    .get(projectId, scene.passageVersionId, scene.passageId);
  if (!passage) throw new Error("scene_passage_lineage_invalid");
  for (const ref of sceneAssetReferences(scene)) {
    const row = database.prepare("SELECT artifact_id,artifact_type,schema_version,content_json FROM artifact_versions WHERE project_id=? AND id=?")
      .get(projectId, ref.versionId) as { artifact_id: string; artifact_type: string; schema_version: number; content_json: string } | undefined;
    const asset = row && ImageAssetSchema.parse(JSON.parse(row.content_json));
    if (!row || row.artifact_id !== `image-asset:${ref.assetId}` || row.artifact_type !== "image-asset" || row.schema_version !== 1
      || !asset || asset.assetId !== ref.assetId || asset.status !== "approved") throw new Error("scene_approved_asset_required");
  }
  return scene;
}

export function validateIllustratedScenes(database: StoryDatabase, projectId: string) {
  const rows = database.prepare("SELECT artifact_id,artifact_type,schema_version,content_json FROM artifact_versions WHERE project_id=? AND (artifact_type='illustrated-scene' OR artifact_id LIKE 'illustrated-scene:%')")
    .all(projectId) as { artifact_id: string; artifact_type: string; schema_version: number; content_json: string }[];
  for (const row of rows) {
    const scene = validateIllustratedScene(database, projectId, JSON.parse(row.content_json));
    if (row.artifact_id !== `illustrated-scene:${scene.passageId}` || row.artifact_type !== "illustrated-scene" || row.schema_version !== 1) throw new Error("scene_identity_invalid");
  }
}
