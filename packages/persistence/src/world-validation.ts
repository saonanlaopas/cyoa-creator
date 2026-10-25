import { WorldDefinitionSchema, ImageAssetSchema } from "@story-to-cyoa/domain";
import { NativeProgressionSchema, projectWorldProgression } from "@story-to-cyoa/runtime";
import type { StoryDatabase } from "./database.js";

export function validateWorld(database: StoryDatabase, projectId: string, value: unknown) {
  const world = WorldDefinitionSchema.parse(value);
  if (world.progression) NativeProgressionSchema.parse(projectWorldProgression(world.progression));
  for (const item of [...(world.progression?.events ?? []), ...(world.progression?.transitions ?? [])]) {
    if (item.passage && !database.prepare("SELECT 1 FROM passage_entity_versions WHERE project_id=? AND id=? AND entity_kind='passage' AND entity_id=?").get(projectId, item.passage.versionId, item.passage.passageId)) throw new Error("progression_passage_lineage_invalid");
    for (const c of item.prerequisites) if (c.kind === "location" && !world.locations.some((l) => l.id === c.locationId && l.passage)) throw new Error("progression_location_reference_invalid");
    if (world.locations.filter((l) => l.passage).every((l) => item.prerequisites.some((c) => c.kind === "location" && !c.present && c.locationId === l.id))) throw new Error("progression_contradictory_location");
  }
  for (const location of world.locations) {
    if (location.passage && !database.prepare("SELECT 1 FROM passage_entity_versions WHERE project_id=? AND id=? AND entity_kind='passage' AND entity_id=?")
      .get(projectId, location.passage.versionId, location.passage.passageId)) throw new Error("world_passage_lineage_invalid");
    if (location.mapImage) {
      const ref = location.mapImage;
      const row = database.prepare("SELECT artifact_id,artifact_type,schema_version,content_json FROM artifact_versions WHERE project_id=? AND id=?")
        .get(projectId, ref.versionId) as { artifact_id: string; artifact_type: string; schema_version: number; content_json: string } | undefined;
      const asset = row && ImageAssetSchema.parse(JSON.parse(row.content_json));
      if (!row || row.artifact_id !== `image-asset:${ref.assetId}` || row.artifact_type !== "image-asset" || row.schema_version !== 1
        || asset?.assetId !== ref.assetId || asset.status !== "approved") throw new Error("world_approved_map_required");
    }
  }
  return world;
}
export function validateWorldHistory(database: StoryDatabase, projectId: string) {
  const rows = database.prepare("SELECT artifact_id,artifact_type,schema_version,content_json FROM artifact_versions WHERE project_id=? AND (artifact_id='world-definition' OR artifact_type='world-definition')")
    .all(projectId) as { artifact_id: string; artifact_type: string; schema_version: number; content_json: string }[];
  for (const row of rows) {
    if (row.artifact_id !== "world-definition" || row.artifact_type !== "world-definition" || row.schema_version !== 1) throw new Error("world_identity_invalid");
    validateWorld(database, projectId, JSON.parse(row.content_json));
  }
}
