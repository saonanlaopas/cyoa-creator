import { z } from "zod";

export const repairFindingReferenceSchema = Object.freeze({ id: "cyoa.repair-finding-reference", version: 1 });
export const repairPlanSchema = Object.freeze({ id: "cyoa.repair-plan", version: 1 });
export const repairImpactSchema = Object.freeze({ id: "cyoa.repair-impact-graph", version: 1 });

const Id = z.string().trim().min(1).max(256);
const Fingerprint = z.string().regex(/^[0-9a-f]{32,64}$/);
const Ids = z.array(Id).max(100);

export const NarrativeReviewEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passage"), passageId: Id, draftVersionId: Id }).strict(),
  z.object({ kind: z.literal("choice"), choiceId: Id, sourcePassageId: Id }).strict(),
  z.object({ kind: z.literal("simulation-run"), runVersionId: Id, traceFingerprint: Id }).strict(),
  z.object({ kind: z.literal("playtest-finding"), campaignVersionId: Id, findingId: Id }).strict(),
  z.object({ kind: z.literal("playtest-sample"), campaignVersionId: Id, sampleId: Id, traceFingerprint: Id }).strict(),
]);
export type NarrativeReviewEvidenceReference = z.infer<typeof NarrativeReviewEvidenceReferenceSchema>;

const StaticFindingSchema = z.object({
  code: Id, severity: z.enum(["error", "warning", "info"]),
  entityType: z.enum(["project", "act", "sequence", "passage", "choice", "thread", "mechanic", "route", "ending"]),
  entityId: Id, message: z.string().min(1).max(20_000), evidence: z.array(z.string().max(20_000)).max(100),
  suggestion: z.string().max(20_000), acknowledged: z.boolean(), overrideRationale: z.string().max(20_000).optional(),
}).strict();
const RuntimeFindingSchema = z.object({
  id: Id, code: Id, message: z.string().min(1).max(20_000), simulationInputFingerprint: Fingerprint,
  compiledRuntimeFingerprint: Fingerprint, stepIndex: z.number().int().min(0), passageId: Id.optional(),
  choiceId: Id.optional(), mechanicKey: Id.optional(), endingId: Id.optional(),
}).strict();
const PlaytestFindingSchema = z.object({
  id: Id, fingerprint: Fingerprint, schemaVersion: z.literal(1), campaignId: Id, projectId: Id,
  simulationInputArtifactVersionId: Id, simulationInputFingerprint: Fingerprint, policyVersion: Id,
  campaignSeed: z.string().max(256), sampleId: Id.nullable(), sampleIndex: z.number().int().min(0).nullable(),
  traceFingerprint: Fingerprint.nullable(), category: Id, code: Id,
  evidenceLevel: z.enum(["hard-error", "warning", "coverage-gap", "observation"]),
  message: z.string().min(1).max(20_000), passageIds: Ids, choiceIds: Ids, mechanicKeys: Ids,
  routeIds: Ids, endingIds: Ids, evidence: z.record(z.string(), z.unknown()),
}).strict();
const NarrativeFindingSchema = z.object({
  schemaId: z.literal("cyoa.narrative-review-finding"), schemaVersion: z.literal(2), id: Id,
  fingerprint: Fingerprint, reviewPlanId: Id, jobId: Id, unitId: Id, attemptId: Id,
  reviewInputFingerprint: Fingerprint, contextFingerprint: Fingerprint, logicalKey: Id, category: Id,
  severity: z.enum(["info", "warning", "error"]), confidence: z.enum(["low", "medium", "high"]),
  message: z.string().min(1).max(2_000), reviewNote: z.string().max(2_000), passageIds: Ids,
  choiceIds: Ids, routeIds: Ids, endingIds: Ids, mechanicKeys: Ids, factIds: Ids, threadIds: Ids,
  acceptedDraftVersionIds: Ids, evidenceReferences: z.array(NarrativeReviewEvidenceReferenceSchema).min(1).max(32),
}).strict();

export const Foundation3RepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id), schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-3-static-validation"), projectId: Id, snapshotId: Id,
  snapshotVersion: z.number().int().positive(), structureVersionId: Id, upstreamVersions: z.record(z.string(), Id),
  findingFingerprint: Fingerprint, finding: StaticFindingSchema,
}).strict();
export const Foundation5ARuntimeRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id), schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5a-runtime"), projectId: Id, runArtifactVersionId: Id, runId: Id,
  simulationInputArtifactVersionId: Id, simulationInputFingerprint: Fingerprint, runtimeFingerprint: Fingerprint,
  traceFingerprint: Fingerprint, findingFingerprint: Fingerprint, finding: RuntimeFindingSchema,
}).strict();
export const Foundation5BPlaytestRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id), schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5b-playtest"), projectId: Id, campaignArtifactVersionId: Id, campaignId: Id,
  campaignSchemaVersion: z.union([z.literal(1), z.literal(2)]), campaignFingerprint: Fingerprint,
  simulationInputArtifactVersionId: Id, simulationInputFingerprint: Fingerprint, runtimeFingerprint: Fingerprint,
  seed: z.string().max(256), policyVersion: Id,
  findingRetention: z.discriminatedUnion("status", [
    z.object({ status: z.literal("known"), total: z.number().int().min(0), retained: z.number().int().min(0), omitted: z.number().int().min(0), truncated: z.boolean() }).strict(),
    z.object({ status: z.literal("legacy-unknown"), retained: z.number().int().min(0), total: z.null(), omitted: z.null(), truncated: z.null() }).strict(),
  ]), finding: PlaytestFindingSchema,
}).strict();
export const Foundation5CNarrativeRepairFindingReferenceSchema = z.object({
  schemaId: z.literal(repairFindingReferenceSchema.id), schemaVersion: z.literal(repairFindingReferenceSchema.version),
  kind: z.literal("foundation-5c-narrative-review"), projectId: Id, reviewArtifactVersionId: Id,
  reviewInputFingerprint: Fingerprint, reviewPlanId: Id, jobId: Id, unitId: Id, attemptId: Id,
  contextFingerprint: Fingerprint, finding: NarrativeFindingSchema,
}).strict();
export const RepairFindingReferenceSchema = z.discriminatedUnion("kind", [
  Foundation3RepairFindingReferenceSchema, Foundation5ARuntimeRepairFindingReferenceSchema,
  Foundation5BPlaytestRepairFindingReferenceSchema, Foundation5CNarrativeRepairFindingReferenceSchema,
]);
export type RepairFindingReference = z.infer<typeof RepairFindingReferenceSchema>;
export type RepairFindingSourceKind = RepairFindingReference["kind"];

export const RepairIntentSchema = z.object({
  schemaVersion: z.literal(1),
  category: z.enum(["structural", "passage-plan", "choice", "continuity", "narrative-thread", "prose", "mechanic", "relationship", "fact-reference", "route", "ending", "runtime-state-consequence"]),
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
  kind: z.literal("passage-entity-version"), targetKey: Id, entityKind: z.enum(["passage", "choice", "thread"]), entityId: Id, versionId: Id,
}).strict();
const ProseBaseSchema = z.object({
  kind: z.literal("passage-prose-head"), targetKey: Id, passageId: Id, currentDraftVersionId: Id.nullable(),
  acceptedDraftVersionId: Id.nullable(), acceptedLifecycleStatus: z.enum(["accepted", "reviewed", "locked"]).nullable(),
  acceptedLocked: z.boolean(), acceptedStale: z.boolean(), passagePlanVersionId: Id,
  upstreamVersions: z.record(z.string(), Id), neighboringDraftVersions: z.record(z.string(), Id),
}).strict();
const ArtifactEntityBaseSchema = z.object({
  kind: z.literal("artifact-entity-version"), targetKey: Id,
  artifactId: z.enum(["bible", "routes", "endings", "mechanics"]), artifactVersionId: Id,
  entityType: Id, entityId: Id, entityFingerprint: Fingerprint,
}).strict();
export const RepairExpectedBaseSchema = z.discriminatedUnion("kind", [PassageEntityBaseSchema, ProseBaseSchema, ArtifactEntityBaseSchema]);
export type RepairExpectedBase = z.infer<typeof RepairExpectedBaseSchema>;

export const RepairImpactNodeSchema = z.object({
  id: Id, classification: z.enum(["direct", "dependent", "historical-evidence"]), entityKind: Id,
  entityId: Id, label: z.string().max(1_000), reason: z.string().max(2_000),
}).strict();
export const RepairImpactEdgeSchema = z.object({ from: Id, to: Id, reason: z.string().max(2_000) }).strict();
export const RepairImpactGraphSchema = z.object({
  schemaId: z.literal(repairImpactSchema.id), schemaVersion: z.literal(repairImpactSchema.version),
  policyId: z.literal("foundation-6a-impact-v1"), fingerprint: Fingerprint,
  nodes: z.array(RepairImpactNodeSchema), edges: z.array(RepairImpactEdgeSchema),
}).strict();
export type RepairImpactGraph = z.infer<typeof RepairImpactGraphSchema>;

export const REPAIR_PLANNING_POLICY_V1 = Object.freeze({
  id: "foundation-6a-v1" as const, impactPolicyId: "foundation-6a-impact-v1" as const,
  maxSelectedFindings: 8, maxAuthorizedTargets: 24, maxImpactNodes: 1_000, maxImpactEdges: 4_000,
  maxPreviewBytes: 2_000_000, maxSavedPlanBytes: 2_000_000, maxFindingListItems: 500,
});
export const ResolvedRepairFindingSchema = z.object({
  reference: RepairFindingReferenceSchema, sourceFingerprint: Fingerprint,
  sourceState: z.enum(["current", "historical"]), stateReasons: z.array(z.string().max(2_000)).max(50),
  categoryCode: Id, message: z.string().min(1).max(20_000), entityKeys: z.array(Id).max(500),
}).strict();
export type ResolvedRepairFinding = z.infer<typeof ResolvedRepairFindingSchema>;
export const RepairPlanDefinitionSchema = z.object({
  schemaId: z.literal(repairPlanSchema.id), schemaVersion: z.literal(repairPlanSchema.version), projectId: Id,
  selectedFindings: z.array(RepairFindingReferenceSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
  resolvedFindings: z.array(ResolvedRepairFindingSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
  intent: RepairIntentSchema, authorizedTargets: z.array(RepairTargetSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
  expectedBases: z.array(RepairExpectedBaseSchema).min(1).max(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
  impactGraph: RepairImpactGraphSchema, sourceState: z.enum(["current", "historical"]),
  providerNeeded: z.enum(["manual-deterministic", "ai-assisted"]),
  contextAvailability: z.array(z.object({ kind: Id, id: Id, available: z.boolean() }).strict()).max(500),
  policy: z.object({
    id: z.literal(REPAIR_PLANNING_POLICY_V1.id), impactPolicyId: z.literal(REPAIR_PLANNING_POLICY_V1.impactPolicyId),
    maxSelectedFindings: z.literal(REPAIR_PLANNING_POLICY_V1.maxSelectedFindings),
    maxAuthorizedTargets: z.literal(REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets),
    maxImpactNodes: z.literal(REPAIR_PLANNING_POLICY_V1.maxImpactNodes), maxImpactEdges: z.literal(REPAIR_PLANNING_POLICY_V1.maxImpactEdges),
    maxPreviewBytes: z.literal(REPAIR_PLANNING_POLICY_V1.maxPreviewBytes), maxSavedPlanBytes: z.literal(REPAIR_PLANNING_POLICY_V1.maxSavedPlanBytes),
    maxFindingListItems: z.literal(REPAIR_PLANNING_POLICY_V1.maxFindingListItems),
  }).strict(),
}).strict();
export type RepairPlanDefinition = z.infer<typeof RepairPlanDefinitionSchema>;
export const RepairPlanRecordSchema = z.object({
  id: Id, definitionFingerprint: Fingerprint, definition: RepairPlanDefinitionSchema, createdAt: z.string().datetime(),
}).strict();
export type RepairPlanRecord = z.infer<typeof RepairPlanRecordSchema>;

export type RepairFingerprint = (value: unknown) => string;

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

export function validateRepairPlanDefinition(value: unknown, fingerprint: RepairFingerprint): RepairPlanDefinition {
  const definition = RepairPlanDefinitionSchema.parse(value);
  const selectedKeys = definition.selectedFindings.map((reference) => fingerprint(reference));
  const resolvedKeys = definition.resolvedFindings.map((finding) => fingerprint(finding.reference));
  assertUnique(selectedKeys, "Duplicate selected repair finding");
  assertUnique(resolvedKeys, "Duplicate resolved repair finding");
  assertUnique(definition.selectedFindings.map(sourceFingerprint), "Duplicate selected repair source finding");
  assertUnique(definition.resolvedFindings.map((finding) => finding.sourceFingerprint), "Duplicate resolved repair source finding");
  assertSorted(selectedKeys, "Selected repair findings are not in canonical order");
  assertSorted(definition.resolvedFindings.map((finding) => finding.sourceFingerprint), "Resolved repair findings are not in canonical order");
  if (selectedKeys.length !== resolvedKeys.length || selectedKeys.some((key) => !resolvedKeys.includes(key))) {
    throw new Error("Selected and resolved repair findings do not correspond exactly");
  }
  for (const finding of definition.resolvedFindings) {
    if (finding.reference.projectId !== definition.projectId) throw new Error("Repair finding project mismatch");
    if (finding.sourceFingerprint !== sourceFingerprint(finding.reference)) throw new Error("Resolved repair finding fingerprint mismatch");
  }
  if (definition.selectedFindings.some((reference) => reference.projectId !== definition.projectId)) throw new Error("Selected repair finding project mismatch");
  for (const reference of definition.selectedFindings) {
    if ((reference.kind === "foundation-3-static-validation" || reference.kind === "foundation-5a-runtime")
      && reference.findingFingerprint !== fingerprint(reference.finding)) throw new Error("Repair source finding fingerprint mismatch");
  }

  const targetByKey = new Map<string, RepairTarget>();
  for (const target of definition.authorizedTargets) {
    const key = repairTargetKey(target);
    if (targetByKey.has(key)) throw new Error("Duplicate authorized repair target");
    targetByKey.set(key, target);
  }
  assertSorted([...targetByKey.keys()], "Authorized repair targets are not in canonical order");
  const baseByKey = new Map<string, RepairExpectedBase>();
  for (const base of definition.expectedBases) {
    if (baseByKey.has(base.targetKey)) throw new Error("Duplicate repair expected base");
    baseByKey.set(base.targetKey, base);
  }
  assertSorted([...baseByKey.keys()], "Repair expected bases are not in canonical order");
  if (targetByKey.size !== baseByKey.size) throw new Error("Authorized repair targets and expected bases do not correspond exactly");
  for (const [key, target] of targetByKey) {
    const base = baseByKey.get(key);
    if (!base) throw new Error(`Repair target ${key} has no expected base`);
    assertCompatibleBase(target, base);
  }
  if ([...baseByKey].some(([key]) => !targetByKey.has(key))) throw new Error("Repair expected base has no authorized target");

  const graph = definition.impactGraph;
  if (graph.nodes.length > REPAIR_PLANNING_POLICY_V1.maxImpactNodes) throw new Error("Repair impact exceeds the supported node limit");
  if (graph.edges.length > REPAIR_PLANNING_POLICY_V1.maxImpactEdges) throw new Error("Repair impact exceeds the supported edge limit");
  const core = { schemaId: graph.schemaId, schemaVersion: graph.schemaVersion, policyId: graph.policyId, nodes: graph.nodes, edges: graph.edges };
  if (graph.fingerprint !== fingerprint(core)) throw new Error("Repair impact fingerprint mismatch");
  assertUnique(graph.nodes.map((node) => node.id), "Duplicate repair impact node");
  assertSorted(graph.nodes.map((node) => node.id), "Repair impact nodes are not in canonical order");
  const edgeKeys = graph.edges.map((edge) => `${edge.from}:${edge.to}:${edge.reason}`);
  assertUnique(edgeKeys, "Duplicate repair impact edge");
  assertSorted(edgeKeys, "Repair impact edges are not in canonical order");
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("Repair impact edge references a missing node");
  }
  const directNodes = graph.nodes.filter((node) => node.classification === "direct");
  if (directNodes.length !== targetByKey.size) throw new Error("Repair impact direct nodes do not match authorized targets");
  for (const [key, target] of targetByKey) {
    const expectedId = `direct:${target.kind}:${key}`;
    if (!directNodes.some((node) => node.id === expectedId && node.entityKind === target.kind && node.entityId === key)) {
      throw new Error(`Repair target ${key} has no canonical direct impact node`);
    }
  }
  if (directNodes.some((node) => !targetByKey.has(node.entityId))) throw new Error("Forged direct repair impact node");

  const expectedState = definition.resolvedFindings.every((finding) => finding.sourceState === "current") ? "current" : "historical";
  if (definition.sourceState !== expectedState) throw new Error("Repair plan source state mismatch");
  if (fingerprint(definition.policy) !== fingerprint(REPAIR_PLANNING_POLICY_V1)) throw new Error("Repair plan policy mismatch");
  return definition;
}

function sourceFingerprint(reference: RepairFindingReference): string {
  return reference.kind === "foundation-5b-playtest" || reference.kind === "foundation-5c-narrative-review"
    ? reference.finding.fingerprint : reference.findingFingerprint;
}

function assertCompatibleBase(target: RepairTarget, base: RepairExpectedBase): void {
  const key = repairTargetKey(target);
  if (base.targetKey !== key) throw new Error(`Repair expected base target key mismatch for ${key}`);
  if (target.kind === "passage-plan-passage") return assertPassageBase(base, "passage", target.passageId);
  if (target.kind === "passage-plan-choice") return assertPassageBase(base, "choice", target.choiceId);
  if (target.kind === "narrative-thread") return assertPassageBase(base, "thread", target.threadId);
  if (target.kind === "passage-prose") {
    if (base.kind !== "passage-prose-head" || base.passageId !== target.passageId) throw new Error(`Repair prose base mismatch for ${key}`);
    return;
  }
  const expected = target.kind === "mechanic" ? ["mechanics", "mechanic", target.mechanicKey]
    : target.kind === "relationship" ? ["bible", "relationship", target.relationshipId]
      : target.kind === "canon-fact" ? ["bible", "canon-fact", target.factId]
        : target.kind === "route" ? ["routes", "route", target.routeId]
          : target.kind === "route-section" ? ["routes", `route-${target.sectionKind}`, target.sectionId]
            : ["endings", "ending", target.endingId];
  if (base.kind !== "artifact-entity-version" || base.artifactId !== expected[0]
    || base.entityType !== expected[1] || base.entityId !== expected[2]) throw new Error(`Repair artifact base mismatch for ${key}`);
}

function assertPassageBase(base: RepairExpectedBase, kind: "passage" | "choice" | "thread", id: string): void {
  if (base.kind !== "passage-entity-version" || base.entityKind !== kind || base.entityId !== id) {
    throw new Error(`Repair passage entity base mismatch for ${kind}:${id}`);
  }
}

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function assertSorted(values: string[], message: string): void {
  if (values.some((value, index) => index > 0 && values[index - 1]!.localeCompare(value) > 0)) throw new Error(message);
}
