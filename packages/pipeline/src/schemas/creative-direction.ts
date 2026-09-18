import { createHash } from "node:crypto";
import { z } from "zod";

export const CREATIVE_DIRECTION_ARTIFACT_ID = "creative-direction" as const;
export const CREATIVE_DIRECTION_SCHEMA_ID = "cyoa.creative-direction" as const;

export const CREATIVE_DIRECTION_LIMITS = Object.freeze({
  descriptorCount: 32,
  descriptorBytes: 160,
  customGuidanceBytes: 8_000,
  avoidCount: 64,
  scopedProfileCount: 200,
  relatedStableIdCount: 32,
  totalSerializedBytes: 256_000,
  provenanceRecords: 500,
  fieldPathBytes: 512,
  explanationExcerptBytes: 1_000,
});

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;
const boundedString = (maximumBytes: number) => z.string().trim().refine(
  (value) => utf8Length(value) <= maximumBytes,
  `Must be at most ${maximumBytes} UTF-8 bytes`,
);
const descriptor = z.string().trim().min(1).refine(
  (value) => utf8Length(value) <= CREATIVE_DIRECTION_LIMITS.descriptorBytes,
  `Must be at most ${CREATIVE_DIRECTION_LIMITS.descriptorBytes} UTF-8 bytes`,
);
const stableId = z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

const ToneSchema = z.object({
  descriptors: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.descriptorCount).default([]),
  tonalRange: z.enum(["focused", "moderate", "wide"]).default("moderate"),
  exclusions: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.descriptorCount).default([]),
  customGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
}).strict();

const PacingSchema = z.object({
  developmentPace: z.enum(["very-slow", "slow-burn", "measured", "brisk", "rapid"]).default("measured"),
  sceneTreatment: z.enum(["scene-focused", "balanced", "summary-forward"]).default("balanced"),
  actionIntensity: z.enum(["low", "moderate", "high", "variable"]).default("moderate"),
  narrativeDensity: z.enum(["spacious", "balanced", "dense"]).default("balanced"),
  transitionDensity: z.enum(["sparse", "balanced", "frequent"]).default("balanced"),
  quietScenesAllowed: z.boolean().default(true),
  escalationShape: z.enum(["steady", "stepped", "wave", "late-surge", "custom"]).default("steady"),
  customGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
}).strict();

const ProseSchema = z.object({
  descriptiveness: z.enum(["restrained", "balanced", "descriptive", "lush"]).default("balanced"),
  treatment: z.enum(["compact", "balanced", "long-form"]).default("long-form"),
  pointOfView: z.enum(["first-person", "second-person", "third-person-close", "third-person-omniscient", "mixed"]).default("second-person"),
  tense: z.enum(["past", "present", "mixed"]).default("past"),
  interiority: z.enum(["low", "moderate", "high"]).default("moderate"),
  dialogueIntegration: z.enum(["sparse", "balanced", "integrated", "dialogue-forward"]).default("integrated"),
  sceneTransitionDensity: z.enum(["sparse", "balanced", "frequent"]).default("balanced"),
  passageLengthPreference: z.enum(["compact", "moderate", "expansive", "variable"]).default("moderate"),
  voiceDescriptors: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.descriptorCount).default([]),
  avoid: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.avoidCount).default([]),
  customGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
}).strict();

const RelationshipProfileSchema = z.object({
  id: stableId,
  relationshipKind: z.enum(["romance", "friendship", "family", "rivalry", "partnership", "ensemble", "custom"]),
  customKind: descriptor.optional(),
  relationshipId: stableId.optional(),
  participantIds: z.array(stableId).max(CREATIVE_DIRECTION_LIMITS.relatedStableIdCount).default([]),
  developmentStyle: z.enum(["gradual", "steady", "volatile", "episodic", "background", "custom"]).default("steady"),
  emotionalTension: z.enum(["low", "moderate", "high", "variable"]).default("moderate"),
  melodrama: z.enum(["low", "moderate", "high"]).default("moderate"),
  sensuality: z.enum(["none", "subtle", "moderate", "explicit-within-boundaries"]).optional(),
  physicalIntimacy: z.enum(["none", "fade-to-black", "implied", "on-page-within-boundaries"]).optional(),
  mechanicsVisibility: z.enum(["hidden", "subtle", "visible"]).default("subtle"),
  customGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
  contentBoundaries: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.avoidCount).default([]),
}).strict().superRefine((profile, context) => {
  if (profile.relationshipKind === "custom" && !profile.customKind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["customKind"], message: "Custom relationship kind is required" });
  }
  if (profile.relationshipKind !== "custom" && profile.customKind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["customKind"], message: "customKind is only valid for custom relationships" });
  }
  if (profile.relationshipKind !== "romance" && (profile.sensuality || profile.physicalIntimacy)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Romance-specific presentation fields are only valid for romance profiles" });
  }
});

const RelationshipPresentationSchema = z.object({
  projectDefault: z.object({
    mechanicsVisibility: z.enum(["hidden", "subtle", "visible"]).default("subtle"),
    customGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
  }).strict().optional(),
  profiles: z.array(RelationshipProfileSchema).max(CREATIVE_DIRECTION_LIMITS.scopedProfileCount).default([]),
}).strict().optional();

const ScopedVariationSchema = z.object({
  id: stableId,
  scopeKind: z.enum(["route", "act", "relationship", "character"]),
  scopeId: stableId,
  toneDescriptors: z.array(descriptor).max(CREATIVE_DIRECTION_LIMITS.descriptorCount).default([]),
  pacingGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
  proseGuidance: boundedString(CREATIVE_DIRECTION_LIMITS.customGuidanceBytes).default(""),
}).strict();

const ProvenanceReferenceSchema = z.object({
  kind: z.enum([
    "user-message", "source-evidence", "source-observation", "approved-artifact",
    "author-override", "manual-edit", "proposal", "migration-derived",
  ]),
  targetId: z.string().trim().min(1).max(240).optional(),
  versionId: z.string().trim().min(1).max(240).optional(),
  excerpt: boundedString(CREATIVE_DIRECTION_LIMITS.explanationExcerptBytes).optional(),
  unavailable: z.boolean().optional(),
}).strict();

export const CreativeDirectionFieldProvenanceSchema = z.object({
  fieldPath: z.string().trim().min(1)
    .regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/)
    .refine((value) => utf8Length(value) <= CREATIVE_DIRECTION_LIMITS.fieldPathBytes,
      `Must be at most ${CREATIVE_DIRECTION_LIMITS.fieldPathBytes} UTF-8 bytes`),
  stableEntityId: stableId.optional(),
  reference: ProvenanceReferenceSchema,
}).strict();

export const CreativeDirectionMaterialSchema = z.object({
  tone: ToneSchema.default({}),
  pacing: PacingSchema.default({}),
  prose: ProseSchema.default({}),
  relationshipPresentation: RelationshipPresentationSchema,
  scopedVariations: z.array(ScopedVariationSchema).max(CREATIVE_DIRECTION_LIMITS.scopedProfileCount).default([]),
}).strict();

export const CreativeDirectionInputSchema = CreativeDirectionMaterialSchema.extend({
  schemaId: z.literal(CREATIVE_DIRECTION_SCHEMA_ID).default(CREATIVE_DIRECTION_SCHEMA_ID),
  schemaVersion: z.literal(1).default(1),
  fieldProvenance: z.array(CreativeDirectionFieldProvenanceSchema)
    .max(CREATIVE_DIRECTION_LIMITS.provenanceRecords).default([]),
}).strict();

export const CreativeDirectionSchema = CreativeDirectionInputSchema.extend({
  materialFingerprint: fingerprint,
  provenanceFingerprint: fingerprint,
}).strict().superRefine((direction, context) => {
  const expected = creativeDirectionFingerprints(direction);
  if (direction.materialFingerprint !== expected.materialFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["materialFingerprint"], message: "Material fingerprint does not match canonical content" });
  }
  if (direction.provenanceFingerprint !== expected.provenanceFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provenanceFingerprint"], message: "Provenance fingerprint does not match canonical provenance" });
  }
  const bytes = utf8Length(JSON.stringify(direction));
  if (bytes > CREATIVE_DIRECTION_LIMITS.totalSerializedBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Creative Direction exceeds ${CREATIVE_DIRECTION_LIMITS.totalSerializedBytes} UTF-8 bytes` });
  }
});

export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>;
export type CreativeDirectionInput = z.input<typeof CreativeDirectionInputSchema>;
export type CreativeDirectionFieldProvenance = z.infer<typeof CreativeDirectionFieldProvenanceSchema>;

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function canonicalMaterial(input: z.infer<typeof CreativeDirectionMaterialSchema>) {
  return {
    tone: { ...input.tone, descriptors: canonicalStrings(input.tone.descriptors), exclusions: canonicalStrings(input.tone.exclusions) },
    pacing: input.pacing,
    prose: { ...input.prose, voiceDescriptors: canonicalStrings(input.prose.voiceDescriptors), avoid: canonicalStrings(input.prose.avoid) },
    ...(input.relationshipPresentation ? { relationshipPresentation: {
      ...input.relationshipPresentation,
      profiles: [...input.relationshipPresentation.profiles].map((profile) => ({
        ...profile,
        participantIds: canonicalStrings(profile.participantIds),
        contentBoundaries: canonicalStrings(profile.contentBoundaries),
      })).sort((left, right) => left.id.localeCompare(right.id)),
    } } : {}),
    scopedVariations: [...input.scopedVariations].map((variation) => ({
      ...variation, toneDescriptors: canonicalStrings(variation.toneDescriptors),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function canonicalProvenance(values: CreativeDirectionFieldProvenance[]) {
  return [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function creativeDirectionFingerprints(input: Pick<CreativeDirection, keyof z.infer<typeof CreativeDirectionMaterialSchema> | "fieldProvenance">) {
  const material = CreativeDirectionMaterialSchema.parse({
    tone: input.tone, pacing: input.pacing, prose: input.prose,
    relationshipPresentation: input.relationshipPresentation,
    scopedVariations: input.scopedVariations,
  });
  return {
    materialFingerprint: hash(canonicalMaterial(material)),
    provenanceFingerprint: hash(canonicalProvenance(input.fieldProvenance)),
  };
}

export function normalizeCreativeDirection(input: CreativeDirectionInput): CreativeDirection {
  const { materialFingerprint: _materialFingerprint, provenanceFingerprint: _provenanceFingerprint, ...candidate } = input as CreativeDirectionInput & {
    materialFingerprint?: string; provenanceFingerprint?: string;
  };
  const parsed = CreativeDirectionInputSchema.parse(candidate);
  const material = canonicalMaterial(parsed);
  const fieldProvenance = canonicalProvenance(parsed.fieldProvenance);
  const profileIds = material.relationshipPresentation?.profiles.map((profile) => profile.id) ?? [];
  const variationIds = material.scopedVariations.map((variation) => variation.id);
  if (new Set(profileIds).size !== profileIds.length) throw new Error("Creative Direction profile IDs must be unique");
  if (new Set(variationIds).size !== variationIds.length) throw new Error("Creative Direction variation IDs must be unique");
  const entityIds = new Set([...profileIds, ...variationIds]);
  for (const provenance of fieldProvenance) {
    if (provenance.stableEntityId && !entityIds.has(provenance.stableEntityId)) {
      throw new Error(`Creative Direction provenance references unknown scoped entity ${provenance.stableEntityId}`);
    }
  }
  return CreativeDirectionSchema.parse({
    schemaId: CREATIVE_DIRECTION_SCHEMA_ID,
    schemaVersion: 1,
    ...material,
    fieldProvenance,
    ...creativeDirectionFingerprints({ ...material, fieldProvenance }),
  });
}

export function defaultCreativeDirection(pointOfView: "first-person" | "second-person" | "third-person" = "second-person"): CreativeDirection {
  return normalizeCreativeDirection({
    schemaId: CREATIVE_DIRECTION_SCHEMA_ID,
    schemaVersion: 1,
    tone: {}, pacing: {},
    prose: { pointOfView: pointOfView === "third-person" ? "third-person-close" : pointOfView },
    scopedVariations: [], fieldProvenance: [],
  });
}

export interface CreativeDirectionScope {
  routeIds?: string[];
  actIds?: string[];
  relationshipIds?: string[];
  characterIds?: string[];
}

export function selectCreativeDirectionContext(direction: CreativeDirection, scope: CreativeDirectionScope = {}) {
  const scopeIds = {
    route: new Set(scope.routeIds ?? []), act: new Set(scope.actIds ?? []),
    relationship: new Set(scope.relationshipIds ?? []), character: new Set(scope.characterIds ?? []),
  };
  const profiles = direction.relationshipPresentation?.profiles.filter((profile) =>
    (profile.relationshipId && scopeIds.relationship.has(profile.relationshipId))
    || profile.participantIds.some((id) => scopeIds.character.has(id))) ?? [];
  const variations = direction.scopedVariations.filter((variation) => scopeIds[variation.scopeKind].has(variation.scopeId));
  const context = {
    schemaId: direction.schemaId,
    schemaVersion: direction.schemaVersion,
    materialFingerprint: direction.materialFingerprint,
    tone: direction.tone,
    pacing: direction.pacing,
    prose: direction.prose,
    ...(direction.relationshipPresentation ? { relationshipPresentation: {
      projectDefault: direction.relationshipPresentation.projectDefault,
      profiles,
    } } : {}),
    scopedVariations: variations,
  };
  const serializedBytes = utf8Length(JSON.stringify(context));
  return {
    context,
    diagnostics: {
      relevantProfileIds: profiles.map((profile) => profile.id),
      relevantVariationIds: variations.map((variation) => variation.id),
      omittedRelationshipProfiles: (direction.relationshipPresentation?.profiles.length ?? 0) - profiles.length,
      omittedScopedVariations: direction.scopedVariations.length - variations.length,
      omittedRelationshipProfileIds: (direction.relationshipPresentation?.profiles ?? [])
        .filter((profile) => !profiles.some((included) => included.id === profile.id)).map((profile) => profile.id),
      omittedScopedVariationIds: direction.scopedVariations
        .filter((variation) => !variations.some((included) => included.id === variation.id)).map((variation) => variation.id),
      serializedBytes,
      estimatedTokens: Math.max(1, Math.ceil(serializedBytes / 4)),
      tokenEstimateKind: "estimated" as const,
      hardLimitBytes: CREATIVE_DIRECTION_LIMITS.totalSerializedBytes,
    },
  };
}
