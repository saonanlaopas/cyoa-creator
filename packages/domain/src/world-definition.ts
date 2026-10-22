import { z } from "zod";
import { SceneAssetReferenceSchema } from "./illustrated-scene.js";

const id = z.string().min(1).max(200);
const label = z.string().trim().min(1).max(200);
export const WorldDefinitionSchema = z.object({
  schemaId: z.literal("cyoa.world-definition"), schemaVersion: z.literal(1),
  enabled: z.boolean(), startLocationId: id.nullable(),
  initialMinutes: z.number().int().min(0).max(52_560_000),
  waitMinutes: z.array(z.number().int().min(1).max(1440)).min(1).max(6),
  locations: z.array(z.object({
    id, name: label, parentId: id.nullable(),
    passage: z.object({ passageId: id, versionId: id }).strict().nullable(),
    mapImage: SceneAssetReferenceSchema.nullable(),
    marker: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict().nullable(),
    hours: z.object({ opens: z.number().int().min(0).max(1439), closes: z.number().int().min(0).max(1439) }).strict().nullable(),
  }).strict()).max(60),
  connections: z.array(z.object({ id, from: id, to: id, minutes: z.number().int().min(0).max(1440) }).strict()).max(100),
  actions: z.array(z.object({ id, locationId: id, label, minutes: z.number().int().min(0).max(1440), result: z.string().trim().min(1).max(1000) }).strict()).max(100),
}).strict().superRefine((world, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new TextEncoder().encode(JSON.stringify(world)).byteLength > 48_000) fail("world_definition_byte_limit");
  if (!world.enabled) {
    if (world.startLocationId || world.locations.length || world.connections.length || world.actions.length) fail("disabled_world_must_clear_definitions");
    return;
  }
  const locations = new Map(world.locations.map((l) => [l.id, l]));
  if (!world.startLocationId || !locations.get(world.startLocationId)?.passage) fail("world_start_location_required");
  for (const list of [world.locations, world.connections, world.actions]) if (new Set(list.map((x) => x.id)).size !== list.length) fail("world_ids_must_be_unique");
  const passages = world.locations.flatMap((l) => l.passage ? [l.passage.passageId] : []);
  if (new Set(passages).size !== passages.length) fail("world_passage_location_ambiguous");
  if (new Set(world.waitMinutes).size !== world.waitMinutes.length) fail("world_wait_durations_must_be_unique");
  for (const location of world.locations) {
    if (location.parentId && !locations.has(location.parentId)) fail("world_parent_missing");
    if (location.marker && !location.parentId) fail("world_marker_requires_parent");
    if (location.hours && location.hours.opens === location.hours.closes) fail("world_hours_empty_use_null_for_always_open");
    const seen = new Set([location.id]);
    let parent = location.parentId;
    while (parent && locations.has(parent)) {
      if (seen.has(parent)) { fail("world_hierarchy_cycle"); break; }
      seen.add(parent); parent = locations.get(parent)!.parentId;
    }
  }
  for (const connection of world.connections) {
    if (connection.from === connection.to || !locations.get(connection.from)?.passage || !locations.get(connection.to)?.passage) fail("world_connection_playable_endpoints_required");
  }
  for (const action of world.actions) if (!locations.get(action.locationId)?.passage) fail("world_action_location_missing");
});
export type WorldDefinition = z.infer<typeof WorldDefinitionSchema>;
export const emptyWorld = (): WorldDefinition => ({ schemaId: "cyoa.world-definition", schemaVersion: 1, enabled: false,
  startLocationId: null, initialMinutes: 480, waitMinutes: [15, 60], locations: [], connections: [], actions: [] });
