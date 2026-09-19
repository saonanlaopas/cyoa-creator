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

/** Canonical Creative Direction ordering is exact UTF-16 code-unit lexical order. */
export function compareCreativeDirectionStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

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
  if (!profile.relationshipId && profile.participantIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A scoped relationship profile requires a relationshipId or participantIds; use projectDefault for project-wide guidance",
    });
  }
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
  direction.fieldProvenance.forEach((record, index) => {
    const issue = creativeDirectionFieldPathIssue(direction, record);
    if (issue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fieldProvenance", index, "fieldPath"], message: issue });
  });
});

export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>;
export type CreativeDirectionInput = z.input<typeof CreativeDirectionInputSchema>;
export type CreativeDirectionFieldProvenance = z.infer<typeof CreativeDirectionFieldProvenanceSchema>;

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort(compareCreativeDirectionStrings);
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
      })).sort((left, right) => compareCreativeDirectionStrings(left.id, right.id)),
    } } : {}),
    scopedVariations: [...input.scopedVariations].map((variation) => ({
      ...variation, toneDescriptors: canonicalStrings(variation.toneDescriptors),
    })).sort((left, right) => compareCreativeDirectionStrings(left.id, right.id)),
  };
}

function canonicalProvenance(values: CreativeDirectionFieldProvenance[]) {
  return [...values].sort((left, right) => compareCreativeDirectionStrings(JSON.stringify(left), JSON.stringify(right)));
}

function pointerSegments(path: string): string[] {
  return path.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function objectHasPath(value: unknown, segments: string[]): boolean {
  let current = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function creativeDirectionFieldPathIssue(
  direction: z.infer<typeof CreativeDirectionInputSchema>,
  record: CreativeDirectionFieldProvenance,
): string | null {
  const segments = pointerSegments(record.fieldPath);
  const root = segments[0];
  if (!root || !["tone", "pacing", "prose", "relationshipPresentation", "scopedVariations"].includes(root)) {
    return "Provenance fieldPath must identify a Creative Direction material field";
  }
  let scopedId: string | undefined;
  let valid = false;
  if (root === "relationshipPresentation" && segments[1] === "profiles") {
    if (segments.length === 2) valid = true;
    else {
      scopedId = segments[2];
      const profile = direction.relationshipPresentation?.profiles.find((item) => item.id === scopedId);
      valid = Boolean(profile) && (segments.length === 3 || objectHasPath(profile, segments.slice(3)));
    }
  } else if (root === "scopedVariations") {
    if (segments.length === 1) valid = true;
    else {
      scopedId = segments[1];
      const variation = direction.scopedVariations.find((item) => item.id === scopedId);
      valid = Boolean(variation) && (segments.length === 2 || objectHasPath(variation, segments.slice(2)));
    }
  } else {
    valid = segments.length === 1 || objectHasPath(direction, segments);
  }
  if (!valid) return "Provenance fieldPath does not resolve to an existing Creative Direction material field";
  if (record.stableEntityId && record.stableEntityId !== scopedId) {
    return "stableEntityId must match the scoped profile or variation selected by fieldPath";
  }
  if (scopedId && !record.stableEntityId) {
    return "Scoped profile and variation provenance requires stableEntityId";
  }
  if (!scopedId && record.stableEntityId) {
    return "stableEntityId is only valid for a scoped profile or variation fieldPath";
  }
  return null;
}

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Browser-safe SHA-256 over exact UTF-8 bytes; authored strings are not Unicode-normalized. */
function sha256(value: string): string {
  const source = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + bigSigma1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const bigSigma0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (bigSigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function hash(value: unknown): string {
  return sha256(JSON.stringify(value));
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

export interface CreativeDirectionReferenceCatalog {
  characterIds?: readonly string[];
  relationships?: ReadonlyArray<{ id: string; characterIds: readonly string[] }>;
  routeIds?: readonly string[];
  acts?: ReadonlyArray<{ id: string; routeId?: string | null }>;
}

export function creativeDirectionReferenceIssues(
  direction: CreativeDirection,
  catalog: CreativeDirectionReferenceCatalog,
): string[] {
  const issues: string[] = [];
  const characters = catalog.characterIds === undefined ? undefined : new Set(catalog.characterIds);
  const relationships = catalog.relationships === undefined
    ? undefined : new Map(catalog.relationships.map((item) => [item.id, item]));
  const routes = catalog.routeIds === undefined ? undefined : new Set(catalog.routeIds);
  const acts = catalog.acts === undefined ? undefined : new Set(catalog.acts.map((item) => item.id));
  for (const profile of direction.relationshipPresentation?.profiles ?? []) {
    if (profile.relationshipId) {
      if (!relationships) issues.push(`Relationship profile ${profile.id} requires an approved Story Bible`);
      else {
        const relationship = relationships.get(profile.relationshipId);
        if (!relationship) issues.push(`Relationship profile ${profile.id} references missing relationship ${profile.relationshipId}`);
        else if (profile.participantIds.length) {
          const expected = [...new Set(relationship.characterIds)].sort(compareCreativeDirectionStrings);
          const actual = [...new Set(profile.participantIds)].sort(compareCreativeDirectionStrings);
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            issues.push(`Relationship profile ${profile.id} participants do not match relationship ${profile.relationshipId}`);
          }
        }
      }
    }
    if (profile.participantIds.length) {
      if (!characters) issues.push(`Relationship profile ${profile.id} requires an approved Story Bible`);
      else for (const characterId of profile.participantIds) {
        if (!characters.has(characterId)) issues.push(`Relationship profile ${profile.id} references missing character ${characterId}`);
      }
    }
  }
  for (const variation of direction.scopedVariations) {
    const known = variation.scopeKind === "route" ? routes
      : variation.scopeKind === "act" ? acts
        : variation.scopeKind === "relationship" ? relationships && new Set(relationships.keys())
          : characters;
    const required = variation.scopeKind === "route" || variation.scopeKind === "act"
      ? "approved Route Architecture" : "approved Story Bible";
    if (!known) issues.push(`Scoped variation ${variation.id} requires ${required}`);
    else if (!known.has(variation.scopeId)) {
      issues.push(`Scoped variation ${variation.id} references missing ${variation.scopeKind} ${variation.scopeId}`);
    }
  }
  return [...new Set(issues)].sort(compareCreativeDirectionStrings);
}

export function assertCreativeDirectionReferences(
  direction: CreativeDirection,
  catalog: CreativeDirectionReferenceCatalog,
): void {
  const issues = creativeDirectionReferenceIssues(direction, catalog);
  if (issues.length) throw new Error(issues.join("; "));
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
