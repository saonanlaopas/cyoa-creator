import { z } from "zod";
import { ImageBindingIdSchema, ImageVariantKeySchema } from "./image-asset.js";
import { SceneAssetReferenceSchema } from "./illustrated-scene.js";

export const SCENE_BATCH_LIMIT = 6;
export const SCENE_DEFAULT_LIMIT = 100;
const location = { locationId: ImageBindingIdSchema };
const character = { characterId: ImageBindingIdSchema, expressionKey: ImageVariantKeySchema };
export const SceneDefaultSlotSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("background"), ...location }).strict(),
  z.object({ kind: z.literal("portrait"), ...character }).strict(),
]);
export const SceneDefaultEntrySchema = z.object({ slot: SceneDefaultSlotSchema, image: SceneAssetReferenceSchema }).strict();
export const SceneDefaultsSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(SceneDefaultEntrySchema).max(SCENE_DEFAULT_LIMIT) }).strict();
export const SceneBatchSelectionSchema = z.array(z.object({
  passageId: ImageBindingIdSchema,
  background: z.object({ ...location, replace: z.boolean().optional() }).strict().optional(),
  portraits: z.array(z.object({ ...character, position: z.enum(["left", "center", "right"]), replace: z.boolean().optional() }).strict()).max(3),
}).strict()).min(1).max(SCENE_BATCH_LIMIT);
export type SceneDefaultSlot = z.infer<typeof SceneDefaultSlotSchema>;
export type SceneDefaults = z.infer<typeof SceneDefaultsSchema>;
export type SceneBatchSelection = z.infer<typeof SceneBatchSelectionSchema>;
export const sceneDefaultKey = (slot: SceneDefaultSlot) => slot.kind === "background"
  ? JSON.stringify([slot.kind, slot.locationId]) : JSON.stringify([slot.kind, slot.characterId, slot.expressionKey]);
