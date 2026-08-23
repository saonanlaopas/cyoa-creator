import { z } from "zod";
import {
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  compileRuntime,
  initializeRuntimeState,
  nativeBundleFingerprint,
  stableFingerprint,
  validateNativeGameBundle,
  type NativeGameBundle,
  type RuntimeMechanicDefinition,
  type RuntimeCompileSource,
} from "@story-to-cyoa/runtime";
import type { LongFormEndingPlan } from "./schemas/long-form-ending-plan.js";
import type { LongFormMechanicsPlan } from "./schemas/long-form-mechanics-plan.js";
import type { LongFormRoutePlan } from "./schemas/long-form-route-plan.js";
import type { LongFormStoryBible } from "./schemas/long-form-story-bible.js";
import type { ProjectBrief } from "./schemas/project-brief.js";
import type {
  ChoicePlan,
  NarrativeThread,
  PassagePlan,
  PassageStructure,
} from "./schemas/passage-plan.js";

export const NATIVE_COMPILATION_INPUT_SCHEMA_ID = "cyoa.native-compilation-input" as const;
export const NATIVE_COMPILATION_INPUT_SCHEMA_VERSION = 1 as const;

const StableId = z.string().min(1).max(200);
const Fingerprint = z.string().regex(/^[0-9a-f]{32}$/);
const ExactEntityReferenceSchema = z.object({
  entityId: StableId,
  versionId: StableId,
  contentFingerprint: Fingerprint,
}).strict();
const ExactArtifactReferenceSchema = z.object({
  artifactId: z.enum(["brief", "bible", "routes", "endings", "mechanics"]),
  versionId: StableId,
  schemaVersion: z.number().int().positive(),
  contentFingerprint: Fingerprint,
}).strict();
const PublicationFindingSchema = z.object({
  code: z.string().min(1).max(300),
  severity: z.enum(["warning", "info"]),
  entityType: z.enum(["project", "act", "sequence", "passage", "choice", "thread", "mechanic", "route", "ending"]),
  entityId: StableId,
  message: z.string().max(20_000),
  evidence: z.array(z.string().max(5_000)).max(100),
  suggestion: z.string().max(20_000),
  acknowledged: z.boolean(),
  overrideRationale: z.string().max(20_000).optional(),
  fingerprint: Fingerprint,
}).strict();
const AcceptedDraftSelectionSchema = z.object({
  passageId: StableId,
  versionId: StableId,
  basedOnPassagePlanVersionId: StableId,
  lifecycleStatus: z.enum(["accepted", "reviewed", "locked"]),
  acceptedLocked: z.boolean(),
  stale: z.literal(false),
  sourceKind: z.enum(["manual", "generated", "restore", "lifecycle"]),
  wordCount: z.number().int().min(0),
  proseBytes: z.number().int().min(1),
  proseFingerprint: Fingerprint,
  generationProvenanceFingerprint: Fingerprint.nullable(),
  upstreamVersions: z.record(StableId),
  neighboringDraftVersions: z.record(StableId),
}).strict();

export const NativeCompilationInputSchema = z.object({
  schemaId: z.literal(NATIVE_COMPILATION_INPUT_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_COMPILATION_INPUT_SCHEMA_VERSION),
  projectId: StableId,
  gameId: StableId,
  snapshot: z.object({
    id: StableId,
    version: z.number().int().positive(),
    structureVersionId: StableId,
    upstreamVersions: z.record(StableId),
    validationFingerprint: Fingerprint,
  }).strict(),
  structure: ExactEntityReferenceSchema.omit({ entityId: true }).extend({ versionId: StableId }).strict(),
  passages: z.array(ExactEntityReferenceSchema).max(10_000),
  choices: z.array(ExactEntityReferenceSchema).max(30_000),
  threads: z.array(ExactEntityReferenceSchema).max(5_000),
  upstreamArtifacts: z.array(ExactArtifactReferenceSchema).length(5),
  acceptedDrafts: z.array(AcceptedDraftSelectionSchema).max(10_000),
  warnings: z.array(PublicationFindingSchema).max(100_000),
  compilerPolicy: z.object({
    id: z.literal(NATIVE_COMPILER_POLICY_ID),
    version: z.literal(NATIVE_COMPILER_POLICY_VERSION),
    compilerVersion: z.literal(NATIVE_COMPILER_VERSION),
    includeDebugProvenance: z.boolean(),
  }).strict(),
  runtimeContract: z.object({
    schemaVersion: z.literal(1),
    version: z.literal(NATIVE_RUNTIME_CONTRACT_VERSION),
  }).strict(),
  bundleContract: z.object({
    schemaId: z.literal(NATIVE_GAME_BUNDLE_SCHEMA_ID),
    schemaVersion: z.literal(NATIVE_GAME_BUNDLE_SCHEMA_VERSION),
  }).strict(),
  sourceInputFingerprint: Fingerprint,
}).strict();

export type NativeCompilationInput = z.infer<typeof NativeCompilationInputSchema>;
export type NativeCompilationEntityReference = z.infer<typeof ExactEntityReferenceSchema>;
export type NativeCompilationArtifactReference = z.infer<typeof ExactArtifactReferenceSchema>;
export type NativeAcceptedDraftSelection = z.infer<typeof AcceptedDraftSelectionSchema>;
export type NativePublicationFinding = z.infer<typeof PublicationFindingSchema>;

export interface ResolvedNativeCompilationInput {
  input: NativeCompilationInput;
  structure: PassageStructure;
  passages: Array<{ versionId: string; content: PassagePlan }>;
  choices: Array<{ versionId: string; content: ChoicePlan }>;
  threads: Array<{ versionId: string; content: NarrativeThread }>;
  brief: ProjectBrief;
  bible: LongFormStoryBible;
  routes: LongFormRoutePlan;
  endings: LongFormEndingPlan;
  mechanics: LongFormMechanicsPlan;
  acceptedDrafts: Array<{ selection: NativeAcceptedDraftSelection; proseMarkdown: string }>;
}

export function sourceInputFingerprint(input: Omit<NativeCompilationInput, "sourceInputFingerprint">): string {
  return stableFingerprint(input);
}

export function assertNativeCompilationInput(value: unknown): NativeCompilationInput {
  const input = NativeCompilationInputSchema.parse(value);
  const { sourceInputFingerprint: _fingerprint, ...identity } = input;
  if (sourceInputFingerprint(identity) !== input.sourceInputFingerprint) {
    throw new Error("Native compilation input fingerprint does not match its exact references");
  }
  return input;
}

export function nativePublicationFinding(input: Omit<NativePublicationFinding, "fingerprint">): NativePublicationFinding {
  return { ...input, fingerprint: stableFingerprint(input) };
}

export function compileNativeGame(input: ResolvedNativeCompilationInput): NativeGameBundle {
  const exact = assertNativeCompilationInput(input.input);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  const choiceById = new Map(input.choices.map((item) => [item.content.id, item]));
  const draftByPassage = new Map(input.acceptedDrafts.map((item) => [item.selection.passageId, item]));
  const source: RuntimeCompileSource = {
    snapshotId: exact.snapshot.id,
    structureVersionId: exact.snapshot.structureVersionId,
    startPassageId: input.structure.startPassageId,
    passageVersions: exact.passages.map((reference) => ({
      versionId: reference.versionId,
      ...passageById.get(reference.entityId)!.content,
    })),
    choiceVersions: exact.choices.map((reference) => ({
      versionId: reference.versionId,
      ...choiceById.get(reference.entityId)!.content,
    })),
    threadVersionIds: exact.threads.map((reference) => reference.versionId),
    routeIds: input.routes.routes.map((route) => route.id),
    routeDecisionIds: input.routes.decisionPoints.map((decision) => decision.id),
    endings: input.endings.endings.map((ending) => ({ id: ending.id, routeId: ending.routeId })),
    mechanics: input.mechanics,
  };
  const runtime = compileRuntime(source);
  const upstreamVersions = Object.fromEntries(exact.upstreamArtifacts.map((item) => [item.artifactId, item.versionId]));
  const provisional: NativeGameBundle = {
    schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID,
    schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
    gameId: exact.gameId,
    projectId: exact.projectId,
    source: {
      inputFingerprint: exact.sourceInputFingerprint,
      snapshotId: exact.snapshot.id,
      structureVersionId: exact.snapshot.structureVersionId,
    },
    bundleFingerprint: "0".repeat(32),
    runtimeFingerprint: runtime.fingerprint,
    compiler: {
      policyId: exact.compilerPolicy.id,
      policyVersion: exact.compilerPolicy.version,
      version: exact.compilerPolicy.compilerVersion,
    },
    runtimeContract: exact.runtimeContract,
    startPassageId: runtime.startPassageId,
    initialState: initializeRuntimeState(runtime),
    mechanics: Object.values(runtime.mechanics).sort((left, right) => left.key.localeCompare(right.key)).map(nativeMechanic),
    passages: Object.values(runtime.passages).sort((left, right) => left.id.localeCompare(right.id)).map((passage) => {
      const authoring = passageById.get(passage.id)!;
      const draft = draftByPassage.get(passage.id)!;
      return {
        ...passage,
        proseMarkdown: draft.proseMarkdown,
        presentation: { title: authoring.content.title },
        source: {
          passageVersionId: authoring.versionId,
          acceptedDraftVersionId: draft.selection.versionId,
        },
      };
    }),
    choices: Object.values(runtime.choices).sort((left, right) => left.id.localeCompare(right.id)).map((choice) => ({
      ...choice,
      text: choiceById.get(choice.id)!.content.label,
      source: { choiceVersionId: choiceById.get(choice.id)!.versionId },
    })),
    endings: Object.values(runtime.endings).sort((left, right) => left.id.localeCompare(right.id)),
    routeIds: [...runtime.routeIds],
    decisionIds: [...runtime.decisionIds],
    factIds: [...new Set(input.bible.canonFacts.map((fact) => fact.id))].sort(),
    ...(exact.compilerPolicy.includeDebugProvenance ? {
      debug: {
        upstreamVersions,
        threadVersionIds: exact.threads.map((item) => item.versionId),
      },
    } : {}),
  };
  provisional.bundleFingerprint = nativeBundleFingerprint(provisional);
  return validateNativeGameBundle(provisional);
}

function nativeMechanic(definition: RuntimeMechanicDefinition): NativeGameBundle["mechanics"][number] {
  if (definition.category === "stat") return {
    key: definition.key,
    category: "stat",
    valueType: "number",
    initial: definition.initial as number,
    ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
    ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
  };
  if (definition.category === "relationship") return {
    key: definition.key,
    category: "relationship",
    valueType: "number",
    initial: definition.initial as number,
    ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
    ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
    bands: definition.bands ?? [],
  };
  if (definition.category === "flag") return {
    key: definition.key,
    category: "flag",
    valueType: "boolean",
    initial: definition.initial as boolean,
  };
  return {
    key: definition.key,
    category: "resource",
    valueType: "number",
    initial: definition.initial as number,
    ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
    ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
  };
}
