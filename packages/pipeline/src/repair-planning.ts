import { createHash } from "node:crypto";
import { z } from "zod";
import { NarrativeReviewEvidenceReferenceSchema } from "./narrative-review.js";
import { stableJson } from "./passage-generation-plan.js";

export const repairFindingReferenceSchema = Object.freeze({
  id: "cyoa.repair-finding-reference",
  version: 1,
});
export const repairPlanSchema = Object.freeze({ id: "cyoa.repair-plan", version: 1 });
export const repairImpactSchema = Object.freeze({ id: "cyoa.repair-impact-graph", version: 1 });

const Id = z.string().trim().min(1).max(256);
const Fingerprint = z.string().regex(/^[0-9a-f]{32,64}$/);
const Ids = z.array(Id).max(100);

const StaticFindingSchema = z.object({
  code: Id,
  severity: z.enum(["error", "warning", "info"]),
  entityType: z.enum(["project", "act", "sequence", "passage", "choice", "thread", "mechanic", "route", "ending"]),
  entityId: Id,
  message: z.string().min(1).max(20_000),
  evidence: z.array(z.string().max(20_000)).max(100),
  suggestion: z.string().max(20_000),
  acknowledged: z.boolean(),
  overrideRationale: z.string().max(20_000).optional(),
}).strict();

const RuntimeFindingSchema = z.object({
  id: Id,
  code: Id,
  message: z.string().min(1).max(20_000),
  simulationInputFingerprint: Fingerprint,
  compiledRuntimeFingerprint: Fingerprint,
  stepIndex: z.number().int().min(0),
  passageId: Id.optional(),
  choiceId: Id.optional(),
  mechanicKey: Id.optional(),
  endingId: Id.optional(),
}).strict();

const PlaytestFindingSchema = z.object({
  id: Id,
  fingerprint: Fingerprint,
  schemaVersion: z.literal(1),
  campaignId: Id,
  projectId: Id,
  simulationInputArtifactVersionId: Id,
  simulationInputFingerprint: Fingerprint,
  policyVersion: Id,
  campaignSeed: z.string().max(256),
  sampleId: Id.nullable(),
  sampleIndex: z.number().int().min(0).nullable(),
  traceFingerprint: Fingerprint.nullable(),
  category: Id,
  code: Id,
  evidenceLevel: z.enum(["hard-error", "warning", "coverage-gap", "observation"]),
  message: z.string().min(1).max(20_000),
  passageIds: Ids,
  choiceIds: Ids,
  mechanicKeys: Ids,
  routeIds: Ids,
  endingIds: Ids,
  evidence: z.record(z.string(), z.unknown()),
}).strict();

const NarrativeFindingSchema = z.object({
  schemaId: z.literal("cyoa.narrative-review-finding"),
  schemaVersion: z.literal(2),
  id: Id,
  fingerprint: Fingerprint,
  reviewPlanId: Id,
  jobId: Id,
  unitId: Id,
  attemptId: Id,
  reviewInputFingerprint: Fingerprint,
  contextFingerprint: Fingerprint,
  logicalKey: Id,
  category: Id,
  severity: z.enum(["info", "warning", "error"]),
  confidence: z.enum(["low", "medium", "high"]),
  message: z.string().min(1).max(2_000),
  reviewNote: z.string().max(2_000),
  passageIds: Ids,
  choiceIds: Ids,
  routeIds: Ids,
  endingIds: Ids,
  mechanicKeys: Ids,
  factIds: Ids,
  threadIds: Ids,
  acceptedDraftVersionIds: Ids,
  evidenceReferences: z.array(NarrativeReviewEvidenceReferenceSchema).min(1).max(32),
}).strict();

export const Foundation3RepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id),
  schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-3-static-validation"),
  projectId: Id,
  snapshotId: Id,
  snapshotVersion: z.number().int().positive(),
  structureVersionId: Id,
  upstreamVersions: z.record(z.string(), Id),
  findingFingerprint: Fingerprint,
  finding: StaticFindingSchema,
}).strict();

export const Foundation5ARuntimeRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id),
  schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5a-runtime"),
  projectId: Id,
  runArtifactVersionId: Id,
  runId: Id,
  simulationInputArtifactVersionId: Id,
  simulationInputFingerprint: Fingerprint,
  runtimeFingerprint: Fingerprint,
  traceFingerprint: Fingerprint,
  findingFingerprint: Fingerprint,
  finding: RuntimeFindingSchema,
}).strict();

export const Foundation5BPlaytestRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id),
  schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5b-playtest"),
  projectId: Id,
  campaignArtifactVersionId: Id,
  campaignId: Id,
  campaignSchemaVersion: z.union([z.literal(1), z.literal(2)]),
  campaignFingerprint: Fingerprint,
  simulationInputArtifactVersionId: Id,
  simulationInputFingerprint: Fingerprint,
  runtimeFingerprint: Fingerprint,
  seed: z.string().max(256),
  policyVersion: Id,
  findingRetention: z.discriminatedUnion("status", [
    z.object({ status: z.literal("known"), total: z.number().int().min(0), retained: z.number().int().min(0), omitted: z.number().int().min(0), truncated: z.boolean() }).strict(),
    z.object({ status: z.literal("legacy-unknown"), retained: z.number().int().min(0), total: z.null(), omitted: z.null(), truncated: z.null() }).strict(),
  ]),
  finding: PlaytestFindingSchema,
}).strict();

export const Foundation5CNarrativeRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id),
  schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5c-narrative-review"),
  projectId: Id,
  reviewArtifactVersionId: Id,
  reviewInputFingerprint: Fingerprint,
  reviewPlanId: Id,
  jobId: Id,
  unitId: Id,
  attemptId: Id,
  contextFingerprint: Fingerprint,
  finding: NarrativeFindingSchema,
}).strict();

export const RepairFindingReferenceSchema = z.discriminatedUnion("kind", [
  Foundation3RepairFindingReferenceSchema,
  Foundation5ARuntimeRepairFindingReferenceSchema,
  Foundation5BPlaytestRepairFindingReferenceSchema,
  Foundation5CNarrativeRepairFindingReferenceSchema,
]);
export type RepairFindingReference = z.infer<typeof RepairFindingReferenceSchema>;
export type RepairFindingSourceKind = RepairFindingReference["kind"];

export const RepairIntentSchema = z.object({
  schemaVersion: z.literal(1),
  category: z.enum([
    "structural", "passage-plan", "choice", "continuity", "narrative-thread", "prose",
    "mechanic", "relationship", "fact-reference", "route", "ending", "runtime-state-consequence",
  ]),
  note: z.string().trim().max(2_000).default(""),
}).strict();
export type RepairIntent = z.infer<typeof RepairIntentSchema>;

export const RepairTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passage-plan-passage"), passageId: Id }).strict(),
  z.object({ kind: z.literal("passage-plan-choice"), choiceId: Id }).strict(),
  z.object({ kind: z.literal("narrative-thread"), threadId: Id }).strict(),
  z.object({ kind: z.literal("passage-prose"), passageId: Id }).strict(),
  z.object({ kind: z.literal("mechanic"), mechanicKey: Id }).strict(),
  z.object({ kind: z.literal("relationship"), relationshipId: Id }).strict(),
  z.object({ kind: z.literal("canon-fact"), factId: Id }).strict(),
  z.object({ kind: z.literal("route"), routeId: Id }).strict(),
  z.object({ kind: z.literal("route-section"), sectionKind: z.enum(["act", "decision", "reconvergence", "ending-hook"]), sectionId: Id }).strict(),
  z.object({ kind: z.literal("ending"), endingId: Id }).strict(),
]);
export type RepairTarget = z.infer<typeof RepairTargetSchema>;

const PassageEntityBaseSchema = z.object({
  kind: z.literal("passage-entity-version"), targetKey: Id, entityKind: z.enum(["passage", "choice", "thread"]),
  entityId: Id, versionId: Id,
}).strict();
const ProseBaseSchema = z.object({
  kind: z.literal("passage-prose-head"), targetKey: Id, passageId: Id,
  currentDraftVersionId: Id.nullable(), acceptedDraftVersionId: Id.nullable(),
  acceptedLifecycleStatus: z.enum(["accepted", "reviewed", "locked"]).nullable(),
  acceptedLocked: z.boolean(), acceptedStale: z.boolean(), passagePlanVersionId: Id,
  upstreamVersions: z.record(z.string(), Id), neighboringDraftVersions: z.record(z.string(), Id),
}).strict();
const ArtifactEntityBaseSchema = z.object({
  kind: z.literal("artifact-entity-version"), targetKey: Id,
  artifactId: z.enum(["bible", "routes", "endings", "mechanics"]), artifactVersionId: Id,
  entityType: Id, entityId: Id, entityFingerprint: Fingerprint,
}).strict();
export const RepairExpectedBaseSchema = z.discriminatedUnion("kind", [
  PassageEntityBaseSchema, ProseBaseSchema, ArtifactEntityBaseSchema,
]);
export type RepairExpectedBase = z.infer<typeof RepairExpectedBaseSchema>;

export const RepairImpactNodeSchema = z.object({
  id: Id,
  classification: z.enum(["direct", "dependent", "historical-evidence"]),
  entityKind: Id,
  entityId: Id,
  label: z.string().max(1_000),
  reason: z.string().max(2_000),
}).strict();
export const RepairImpactEdgeSchema = z.object({ from: Id, to: Id, reason: z.string().max(2_000) }).strict();
export const RepairImpactGraphSchema = z.object({
  schemaId: z.literal(repairImpactSchema.id), schemaVersion: z.literal(repairImpactSchema.version),
  policyId: z.literal("foundation-6a-impact-v1"), fingerprint: Fingerprint,
  nodes: z.array(RepairImpactNodeSchema), edges: z.array(RepairImpactEdgeSchema),
}).strict();
export type RepairImpactGraph = z.infer<typeof RepairImpactGraphSchema>;

export const REPAIR_PLANNING_POLICY_V1 = Object.freeze({
  id: "foundation-6a-v1" as const,
  impactPolicyId: "foundation-6a-impact-v1" as const,
  maxSelectedFindings: 8,
  maxAuthorizedTargets: 24,
  maxImpactNodes: 1_000,
  maxImpactEdges: 4_000,
  maxPreviewBytes: 2_000_000,
  maxSavedPlanBytes: 2_000_000,
  maxFindingListItems: 500,
});

export const ResolvedRepairFindingSchema = z.object({
  reference: RepairFindingReferenceSchema,
  sourceFingerprint: Fingerprint,
  sourceState: z.enum(["current", "historical"]),
  stateReasons: z.array(z.string().max(2_000)).max(50),
  categoryCode: Id,
  message: z.string().min(1).max(20_000),
  entityKeys: z.array(Id).max(500),
}).strict();
export type ResolvedRepairFinding = z.infer<typeof ResolvedRepairFindingSchema>;

export const RepairPlanDefinitionSchema = z.object({
  schemaId: z.literal(repairPlanSchema.id), schemaVersion: z.literal(repairPlanSchema.version),
  projectId: Id,
  selectedFindings: z.array(RepairFindingReferenceSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
  resolvedFindings: z.array(ResolvedRepairFindingSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
  intent: RepairIntentSchema,
  authorizedTargets: z.array(RepairTargetSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
  expectedBases: z.array(RepairExpectedBaseSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
  impactGraph: RepairImpactGraphSchema,
  sourceState: z.enum(["current", "historical"]),
  providerNeeded: z.enum(["manual-deterministic", "ai-assisted"]),
  contextAvailability: z.array(z.object({ kind: Id, id: Id, available: z.boolean() }).strict()).max(500),
  policy: z.object({
    id: z.literal(REPAIR_PLANNING_POLICY_V1.id),
    impactPolicyId: z.literal(REPAIR_PLANNING_POLICY_V1.impactPolicyId),
    maxSelectedFindings: z.literal(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
    maxAuthorizedTargets: z.literal(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
    maxImpactNodes: z.literal(REPAIR_PLANNING_POLICY_V1.maxImpactNodes),
    maxImpactEdges: z.literal(REPAIR_PLANNING_POLICY_V1.maxImpactEdges),
    maxPreviewBytes: z.literal(REPAIR_PLANNING_POLICY_V1.maxPreviewBytes),
    maxSavedPlanBytes: z.literal(REPAIR_PLANNING_POLICY_V1.maxSavedPlanBytes),
    maxFindingListItems: z.literal(REPAIR_PLANNING_POLICY_V1.maxFindingListItems),
  }).strict(),
}).strict();
export type RepairPlanDefinition = z.infer<typeof RepairPlanDefinitionSchema>;

export const RepairPlanRecordSchema = z.object({
  id: Id,
  definitionFingerprint: Fingerprint,
  definition: RepairPlanDefinitionSchema,
  createdAt: z.string().datetime(),
}).strict();
export type RepairPlanRecord = z.infer<typeof RepairPlanRecordSchema>;

export interface RepairImpactIndex {
  passages: Array<{ id: string; choiceIds: string[]; routeIds: string[]; relationshipIds: string[]; requiredFactIds: string[]; revealedFactIds: string[]; setupThreadIds: string[]; payoffThreadIds: string[]; endingId: string | null }>;
  choices: Array<{ id: string; sourcePassageId: string; destinationPassageId: string; mechanicKeys: string[]; sourceDecisionIds: string[] }>;
  threads: Array<{ id: string; setupPassageIds: string[]; payoffPassageIds: string[]; routeIds: string[] }>;
  drafts: Array<{ id: string; passageId: string; basedOnPassagePlanVersionId: string; neighboringDraftVersions: Record<string, string>; accepted: boolean }>;
  mechanicGates: Array<{ id: string; mechanicKeys: string[]; targetType: "route" | "ending"; targetId: string }>;
  routeSections: Array<{ kind: "act" | "decision" | "reconvergence" | "ending-hook"; id: string; routeIds: string[] }>;
  endings: Array<{ id: string; routeId: string; relationshipIds: string[] }>;
  historicalEvidence: Array<{ kind: string; id: string; targetKeys: string[] }>;
}

export function repairTargetKey(target: RepairTarget): string {
  switch (target.kind) {
    case "passage-plan-passage": return `passage:${target.passageId}`;
    case "passage-plan-choice": return `choice:${target.choiceId}`;
    case "narrative-thread": return `thread:${target.threadId}`;
    case "passage-prose": return `prose:${target.passageId}`;
    case "mechanic": return `mechanic:${target.mechanicKey}`;
    case "relationship": return `relationship:${target.relationshipId}`;
    case "canon-fact": return `fact:${target.factId}`;
    case "route": return `route:${target.routeId}`;
    case "route-section": return `route-${target.sectionKind}:${target.sectionId}`;
    case "ending": return `ending:${target.endingId}`;
  }
}

export function repairFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function buildRepairImpactGraph(targets: RepairTarget[], index: RepairImpactIndex): RepairImpactGraph {
  const nodes = new Map<string, z.infer<typeof RepairImpactNodeSchema>>();
  const edges = new Map<string, z.infer<typeof RepairImpactEdgeSchema>>();
  const addNode = (classification: "direct" | "dependent" | "historical-evidence", entityKind: string, entityId: string, label: string, reason: string) => {
    const id = `${classification}:${entityKind}:${entityId}`;
    if (!nodes.has(id)) nodes.set(id, { id, classification, entityKind, entityId, label, reason });
    return id;
  };
  const addImpact = (source: string, entityKind: string, entityId: string, reason: string) => {
    const target = addNode("dependent", entityKind, entityId, entityId, reason);
    const key = `${source}:${target}:${reason}`;
    if (!edges.has(key)) edges.set(key, { from: source, to: target, reason });
  };
  const directByKey = new Map<string, string>();
  for (const target of [...targets].sort((left, right) => repairTargetKey(left).localeCompare(repairTargetKey(right)))) {
    const key = repairTargetKey(target);
    directByKey.set(key, addNode("direct", target.kind, key, key, "Explicitly authorized mutation target"));
  }
  for (const [key, source] of directByKey) {
    const [kind, id] = splitKey(key);
    if (kind === "passage") {
      for (const choice of index.choices.filter((item) => item.sourcePassageId === id || item.destinationPassageId === id)) {
        addImpact(source, "choice", choice.id, "Choice graph references the passage");
        addImpact(source, "passage", choice.sourcePassageId === id ? choice.destinationPassageId : choice.sourcePassageId, "Direct graph neighbor");
      }
      for (const thread of index.threads.filter((item) => item.setupPassageIds.includes(id) || item.payoffPassageIds.includes(id))) addImpact(source, "thread", thread.id, "Narrative thread references the passage");
      for (const draft of index.drafts.filter((item) => item.passageId === id)) addImpact(source, "passage-draft", draft.id, "Draft is based on the passage");
    } else if (kind === "choice") {
      const choice = index.choices.find((item) => item.id === id);
      if (choice) {
        addImpact(source, "passage", choice.sourcePassageId, "Choice is owned by the source passage");
        addImpact(source, "passage", choice.destinationPassageId, "Choice points to the destination passage");
      }
    } else if (kind === "thread") {
      const thread = index.threads.find((item) => item.id === id);
      for (const passageId of [...(thread?.setupPassageIds ?? []), ...(thread?.payoffPassageIds ?? [])]) addImpact(source, "passage", passageId, "Passage references the narrative thread");
    } else if (kind === "mechanic") {
      for (const choice of index.choices.filter((item) => item.mechanicKeys.includes(id))) addImpact(source, "choice", choice.id, "Choice condition or effect uses the mechanic");
      for (const gate of index.mechanicGates.filter((item) => item.mechanicKeys.includes(id))) {
        addImpact(source, "mechanic-gate", gate.id, "Typed gate reads the mechanic");
        addImpact(source, gate.targetType, gate.targetId, "Typed gate controls this target");
      }
    } else if (kind === "relationship") {
      for (const passage of index.passages.filter((item) => item.relationshipIds.includes(id))) addImpact(source, "passage", passage.id, "Passage has an exact relationship reference");
      for (const ending of index.endings.filter((item) => item.relationshipIds.includes(id))) addImpact(source, "ending", ending.id, "Ending has an exact relationship outcome");
    } else if (kind === "fact") {
      for (const passage of index.passages.filter((item) => item.requiredFactIds.includes(id) || item.revealedFactIds.includes(id))) addImpact(source, "passage", passage.id, "Passage has an exact fact reference");
    } else if (kind === "route") {
      for (const passage of index.passages.filter((item) => item.routeIds.includes(id))) addImpact(source, "passage", passage.id, "Passage carries the route ID");
      for (const thread of index.threads.filter((item) => item.routeIds.includes(id))) addImpact(source, "thread", thread.id, "Thread carries the route ID");
      for (const section of index.routeSections.filter((item) => item.routeIds.includes(id))) addImpact(source, `route-${section.kind}`, section.id, "Typed route section references the route");
      for (const ending of index.endings.filter((item) => item.routeId === id)) addImpact(source, "ending", ending.id, "Ending belongs to the route");
    } else if (kind === "route-decision") {
      for (const choice of index.choices.filter((item) => item.sourceDecisionIds.includes(id))) addImpact(source, "choice", choice.id, "Passage-plan choice references the route decision");
    } else if (kind === "ending") {
      for (const passage of index.passages.filter((item) => item.endingId === id)) addImpact(source, "passage", passage.id, "Terminal passage references the ending");
      const ending = index.endings.find((item) => item.id === id);
      if (ending) addImpact(source, "route", ending.routeId, "Ending belongs to the route");
    } else if (kind === "prose") {
      const sourceDrafts = index.drafts.filter((item) => item.passageId === id && item.accepted);
      const queue = sourceDrafts.map((item) => item.id);
      const visited = new Set<string>();
      while (queue.length) {
        const draftId = queue.shift()!;
        if (visited.has(draftId)) continue;
        visited.add(draftId);
        for (const dependent of index.drafts.filter((item) => Object.values(item.neighboringDraftVersions).includes(draftId))) {
          addImpact(source, "passage-draft", dependent.id, "Draft captured the accepted prose as neighboring context");
          if (dependent.accepted) queue.push(dependent.id);
        }
      }
    }
    for (const evidence of index.historicalEvidence.filter((item) => item.targetKeys.includes(key))) {
      const historical = addNode("historical-evidence", evidence.kind, evidence.id, evidence.id, "A future target change would make this immutable evidence historical");
      const edgeKey = `${source}:${historical}:historical`;
      if (!edges.has(edgeKey)) edges.set(edgeKey, { from: source, to: historical, reason: "Exact evidence captured the authorized target base" });
    }
  }
  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...edges.values()].sort((left, right) => `${left.from}:${left.to}:${left.reason}`.localeCompare(`${right.from}:${right.to}:${right.reason}`));
  if (sortedNodes.length > REPAIR_PLANNING_POLICY_V1.maxImpactNodes) throw new Error(`Repair impact exceeds the ${REPAIR_PLANNING_POLICY_V1.maxImpactNodes}-node limit`);
  if (sortedEdges.length > REPAIR_PLANNING_POLICY_V1.maxImpactEdges) throw new Error(`Repair impact exceeds the ${REPAIR_PLANNING_POLICY_V1.maxImpactEdges}-edge limit`);
  const core = { schemaId: repairImpactSchema.id, schemaVersion: repairImpactSchema.version, policyId: REPAIR_PLANNING_POLICY_V1.impactPolicyId, nodes: sortedNodes, edges: sortedEdges } as const;
  return RepairImpactGraphSchema.parse({ ...core, fingerprint: repairFingerprint(core) });
}

export function buildRepairPlanDefinition(input: Omit<RepairPlanDefinition, "schemaId" | "schemaVersion" | "policy" | "sourceState">): { definition: RepairPlanDefinition; fingerprint: string } {
  if (input.selectedFindings.length > REPAIR_PLANNING_POLICY_V1.maxSelectedFindings) throw new Error(`Repair plans support at most ${REPAIR_PLANNING_POLICY_V1.maxSelectedFindings} findings`);
  if (input.authorizedTargets.length > REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets) throw new Error(`Repair plans support at most ${REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets} targets`);
  const sourceState = input.resolvedFindings.every((item) => item.sourceState === "current") ? "current" as const : "historical" as const;
  const definition = RepairPlanDefinitionSchema.parse({
    schemaId: repairPlanSchema.id,
    schemaVersion: repairPlanSchema.version,
    ...input,
    selectedFindings: sortByFingerprint(input.selectedFindings),
    resolvedFindings: [...input.resolvedFindings].sort((left, right) => left.sourceFingerprint.localeCompare(right.sourceFingerprint)),
    authorizedTargets: [...input.authorizedTargets].sort((left, right) => repairTargetKey(left).localeCompare(repairTargetKey(right))),
    expectedBases: [...input.expectedBases].sort((left, right) => left.targetKey.localeCompare(right.targetKey)),
    contextAvailability: [...input.contextAvailability].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    sourceState,
    policy: { ...REPAIR_PLANNING_POLICY_V1 },
  });
  const fingerprint = repairFingerprint(definition);
  if (serializedRepairBytes({ definition, fingerprint }) > REPAIR_PLANNING_POLICY_V1.maxPreviewBytes) throw new Error("Repair-plan preview exceeds its serialized byte limit");
  return { definition, fingerprint };
}

export function serializedRepairBytes(value: unknown): number {
  return Buffer.byteLength(stableJson(value), "utf8");
}

function sortByFingerprint<T>(values: T[]): T[] {
  return [...values].sort((left, right) => repairFingerprint(left).localeCompare(repairFingerprint(right)));
}

function splitKey(value: string): [string, string] {
  const separator = value.indexOf(":");
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function sourceReferenceFingerprint(reference: RepairFindingReference): string {
  return repairFingerprint(RepairFindingReferenceSchema.parse(reference));
}

export function simulationInputTargetKeys(input: {
  passageVersions: Array<{ entityId: string }>;
  choiceVersions: Array<{ entityId: string }>;
  threadVersions: Array<{ entityId: string }>;
  acceptedDraftVersions: Array<{ entityId: string }>;
  upstreamVersions: Record<string, string>;
}): string[] {
  return [...new Set([
    ...input.passageVersions.map((item) => `passage:${item.entityId}`),
    ...input.choiceVersions.map((item) => `choice:${item.entityId}`),
    ...input.threadVersions.map((item) => `thread:${item.entityId}`),
    ...input.acceptedDraftVersions.map((item) => `prose:${item.entityId}`),
    ...(input.upstreamVersions.bible ? ["artifact:bible"] : []),
    ...(input.upstreamVersions.routes ? ["artifact:routes"] : []),
    ...(input.upstreamVersions.endings ? ["artifact:endings"] : []),
    ...(input.upstreamVersions.mechanics ? ["artifact:mechanics"] : []),
  ])].sort();
}
