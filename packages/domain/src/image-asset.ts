import { z } from "zod";

export const IMAGE_ASSET_LIMITS = Object.freeze({ inputBytes: 8_000_000, fileBytes: 8_000_000, side: 4096, pixels: 8_000_000,
  thumbnailSide: 256, thumbnailBytes: 512_000, projectFileBytes: 48_000_000, assets: 200, versions: 2000 });
export const ImageDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ImageAssetRoleSchema = z.enum(["background", "portrait", "full-scene-illustration", "map", "reference-sheet"]);
export const ImageBindingIdSchema = z.string().min(1).max(200);
export const ImageVariantKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/);
export const ImageDesignationSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("background"), locationId: ImageBindingIdSchema.optional(), stateKey: ImageVariantKeySchema.optional() }).strict(),
  z.object({ role: z.literal("portrait"), characterId: ImageBindingIdSchema.optional(), expressionKey: ImageVariantKeySchema.optional() }).strict(),
  z.object({ role: z.literal("full-scene-illustration"), locationId: ImageBindingIdSchema.optional(), stateKey: ImageVariantKeySchema.optional() }).strict(),
  z.object({ role: z.literal("map"), locationId: ImageBindingIdSchema.optional(), stateKey: ImageVariantKeySchema.optional() }).strict(),
  z.object({ role: z.literal("reference-sheet"), characterId: ImageBindingIdSchema.optional(), locationId: ImageBindingIdSchema.optional() }).strict(),
]);
export const ImageCatalogueFiltersSchema = z.object({
  approvedOnly: z.boolean().optional(), role: ImageAssetRoleSchema.optional(),
  characterId: ImageBindingIdSchema.optional(), locationId: ImageBindingIdSchema.optional(),
  expressionKey: ImageVariantKeySchema.optional(), stateKey: ImageVariantKeySchema.optional(),
}).strict();
export const ImageAssetMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(2000),
  altText: z.string().trim().min(1).max(1000), tags: z.array(z.string().trim().min(1).max(60)).max(20),
  credit: z.string().trim().max(300), license: z.string().trim().max(300), designation: ImageDesignationSchema.optional(),
}).strict();
export const ImageFileSchema = z.object({ schemaId: z.literal("cyoa.image-file"), schemaVersion: z.literal(1),
  sha256: ImageDigestSchema, mimeType: z.literal("image/png"), width: z.number().int().min(1).max(IMAGE_ASSET_LIMITS.side),
  height: z.number().int().min(1).max(IMAGE_ASSET_LIMITS.side), bytes: z.number().int().min(1).max(IMAGE_ASSET_LIMITS.fileBytes),
  base64: z.string().min(1).max(Math.ceil(IMAGE_ASSET_LIMITS.fileBytes / 3) * 4),
}).strict();
export const ImageAssetSchema = z.object({ schemaId: z.literal("cyoa.image-asset"), schemaVersion: z.literal(1),
  assetId: z.string().uuid(), status: z.enum(["candidate", "approved", "rejected"]),
  baseVersionId: z.string().min(1).max(240).nullable(), reviewedCandidateVersionId: z.string().min(1).max(240).nullable(),
  fileSha256: ImageDigestSchema, thumbnailSha256: ImageDigestSchema, metadata: ImageAssetMetadataSchema,
  provenance: z.object({ kind: z.enum(["user-upload", "assistant-import"]), sourceName: z.string().min(1).max(120).regex(/^[^/\\\u0000-\u001f]+$/),
    sourceSha256: ImageDigestSchema, sourceMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    normalization: z.literal("oriented-srgb-rgba-png-v1"), providerCalls: z.literal(0),
  }).strict(),
}).strict();
export type ImageAssetMetadata = z.infer<typeof ImageAssetMetadataSchema>;
export type ImageDesignation = z.infer<typeof ImageDesignationSchema>;
export type ImageAssetRole = z.infer<typeof ImageAssetRoleSchema>;
export type ImageCatalogueFilters = z.infer<typeof ImageCatalogueFiltersSchema>;
export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type ImageFile = z.infer<typeof ImageFileSchema>;
