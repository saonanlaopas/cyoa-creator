import { z } from "zod";

const id = z.string().min(1).max(200);
export const SceneAssetReferenceSchema = z.object({ assetId: z.string().uuid(), versionId: id }).strict();
export const IllustratedSceneSchema = z.object({
  schemaId: z.literal("cyoa.illustrated-scene"), schemaVersion: z.literal(1),
  passageId: id, passageVersionId: id,
  layout: z.enum(["text", "illustrated"]),
  background: SceneAssetReferenceSchema.nullable(),
  portraits: z.array(z.object({
    character: z.string().trim().min(1).max(100), expression: z.string().trim().min(1).max(100),
    position: z.enum(["left", "center", "right"]), image: SceneAssetReferenceSchema,
  }).strict()).max(3),
  dialogue: z.array(z.object({ speaker: z.string().trim().min(1).max(100), text: z.string().trim().min(1).max(2000) }).strict()).max(12),
}).strict().superRefine((scene, ctx) => {
  if (new Set(scene.portraits.map((p) => p.position)).size !== scene.portraits.length
    || new Set(scene.portraits.map((p) => p.character)).size !== scene.portraits.length) {
    ctx.addIssue({ code: "custom", message: "Portrait characters and positions must be unique" });
  }
  if (scene.layout === "text" && (scene.background || scene.portraits.length || scene.dialogue.length)) {
    ctx.addIssue({ code: "custom", message: "Text layout must clear illustration assignments" });
  }
});
export type IllustratedScene = z.infer<typeof IllustratedSceneSchema>;
export function sceneAssetReferences(scene: IllustratedScene) {
  return [...(scene.background ? [scene.background] : []), ...scene.portraits.map((p) => p.image)];
}
