import { createHash } from "node:crypto";
import { z } from "zod";
import {
  REPAIR_PLANNING_POLICY_V1,
  RepairFindingReferenceSchema,
  RepairImpactGraphSchema,
  RepairImpactNodeSchema,
  RepairPlanDefinitionSchema,
  repairImpactSchema,
  repairPlanSchema,
  repairTargetKey,
  validateRepairPlanDefinition,
  type RepairFindingReference,
  type RepairImpactGraph,
  type RepairPlanDefinition,
  type RepairTarget,
} from "@story-to-cyoa/domain";
import { stableJson } from "./passage-generation-plan.js";

export {
  Foundation3RepairFindingReferenceSchema,
  Foundation5ARuntimeRepairFindingReferenceSchema,
  Foundation5BPlaytestRepairFindingReferenceSchema,
  Foundation5CNarrativeRepairFindingReferenceSchema,
  REPAIR_PLANNING_POLICY_V1,
  RepairExpectedBaseSchema,
  RepairFindingReferenceSchema,
  RepairImpactEdgeSchema,
  RepairImpactGraphSchema,
  RepairImpactNodeSchema,
  RepairIntentSchema,
  RepairPlanDefinitionSchema,
  RepairPlanRecordSchema,
  RepairTargetSchema,
  ResolvedRepairFindingSchema,
  repairFindingReferenceSchema,
  repairImpactSchema,
  repairPlanSchema,
  repairTargetKey,
  validateRepairPlanDefinition,
  type RepairExpectedBase,
  type RepairFindingReference,
  type RepairFindingSourceKind,
  type RepairImpactGraph,
  type RepairIntent,
  type RepairPlanDefinition,
  type RepairPlanRecord,
  type RepairTarget,
  type ResolvedRepairFinding,
} from "@story-to-cyoa/domain";

export interface RepairImpactRouteSection {
  kind: "act" | "decision" | "reconvergence" | "ending-hook";
  id: string;
  routeIds: string[];
  owningActId: string | null;
  destinationActIds: string[];
  fromActIds: string[];
  toActId: string | null;
  ownedDecisionIds: string[];
  incomingDecisionIds: string[];
  reconvergenceIds: string[];
  endingIds: string[];
}

export interface RepairImpactIndex {
  passages: Array<{ id: string; choiceIds: string[]; routeIds: string[]; relationshipIds: string[]; requiredFactIds: string[]; revealedFactIds: string[]; setupThreadIds: string[]; payoffThreadIds: string[]; endingId: string | null }>;
  choices: Array<{ id: string; sourcePassageId: string; destinationPassageId: string; mechanicKeys: string[]; sourceDecisionIds: string[] }>;
  threads: Array<{ id: string; setupPassageIds: string[]; payoffPassageIds: string[]; routeIds: string[] }>;
  drafts: Array<{
    id: string; passageId: string; basedOnPassagePlanVersionId: string;
    neighboringDraftVersions: Record<string, string>; neighboringAcceptedRoots: Record<string, string>;
    accepted: boolean; acceptedRoot: string | null;
  }>;
  mechanicGates: Array<{ id: string; mechanicKeys: string[]; targetType: "route" | "ending"; targetId: string }>;
  routeSections: RepairImpactRouteSection[];
  endings: Array<{ id: string; routeId: string; relationshipIds: string[] }>;
  historicalEvidence: Array<{ kind: string; id: string; targetKeys: string[] }>;
}

export function repairFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function buildRepairImpactGraph(targets: RepairTarget[], index: RepairImpactIndex): RepairImpactGraph {
  const nodes = new Map<string, z.infer<typeof RepairImpactNodeSchema>>();
  const edges = new Map<string, { from: string; to: string; reason: string }>();
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
    } else if (kind.startsWith("route-")) {
      addRouteSectionImpacts(source, kind.slice("route-".length), id, index, addImpact);
    } else if (kind === "ending") {
      for (const passage of index.passages.filter((item) => item.endingId === id)) addImpact(source, "passage", passage.id, "Terminal passage references the ending");
      const ending = index.endings.find((item) => item.id === id);
      if (ending) addImpact(source, "route", ending.routeId, "Ending belongs to the route");
    } else if (kind === "prose") {
      const queue = index.drafts.filter((item) => item.passageId === id && item.accepted && item.acceptedRoot)
        .map((item) => item.acceptedRoot!);
      const visitedRoots = new Set<string>();
      while (queue.length) {
        const acceptedRoot = queue.shift()!;
        if (visitedRoots.has(acceptedRoot)) continue;
        visitedRoots.add(acceptedRoot);
        for (const dependent of index.drafts.filter((item) => Object.values(item.neighboringAcceptedRoots).includes(acceptedRoot))) {
          addImpact(source, "passage-draft", dependent.id, "Draft captured lifecycle-equivalent accepted prose as neighboring context");
          if (dependent.accepted && dependent.acceptedRoot && !visitedRoots.has(dependent.acceptedRoot)) queue.push(dependent.acceptedRoot);
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

function addRouteSectionImpacts(
  source: string,
  kind: string,
  id: string,
  index: RepairImpactIndex,
  addImpact: (source: string, entityKind: string, entityId: string, reason: string) => void,
): void {
  const section = index.routeSections.find((item) => item.kind === kind && item.id === id);
  if (!section) return;
  for (const routeId of section.routeIds) addImpact(source, "route", routeId, "Typed route-section relationship");
  if (section.owningActId) addImpact(source, "route-act", section.owningActId, "Decision belongs to this act");
  for (const actId of section.destinationActIds) addImpact(source, "route-act", actId, "Decision choice enters this act");
  for (const actId of section.fromActIds) addImpact(source, "route-act", actId, "Reconvergence starts from this act");
  if (section.toActId) addImpact(source, "route-act", section.toActId, "Reconvergence enters this act");
  for (const decisionId of section.ownedDecisionIds) addImpact(source, "route-decision", decisionId, "Decision is owned by this act");
  for (const decisionId of section.incomingDecisionIds) addImpact(source, "route-decision", decisionId, "Decision has a destination choice entering this act");
  for (const reconvergenceId of section.reconvergenceIds) addImpact(source, "route-reconvergence", reconvergenceId, "Reconvergence references this act");
  for (const endingId of section.endingIds) addImpact(source, "ending", endingId, "Detailed ending references this ending hook");
  if (kind === "decision") for (const choice of index.choices.filter((item) => item.sourceDecisionIds.includes(id))) {
    addImpact(source, "choice", choice.id, "Passage-plan choice references the route decision");
  }
}

export function buildRepairPlanDefinition(input: Omit<RepairPlanDefinition, "schemaId" | "schemaVersion" | "policy" | "sourceState">): { definition: RepairPlanDefinition; fingerprint: string } {
  if (input.selectedFindings.length > REPAIR_PLANNING_POLICY_V1.maxSelectedFindings) throw new Error(`Repair plans support at most ${REPAIR_PLANNING_POLICY_V1.maxSelectedFindings} findings`);
  if (input.authorizedTargets.length > REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets) throw new Error(`Repair plans support at most ${REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets} targets`);
  const sourceState = input.resolvedFindings.every((item) => item.sourceState === "current") ? "current" as const : "historical" as const;
  const definition = RepairPlanDefinitionSchema.parse({
    schemaId: repairPlanSchema.id, schemaVersion: repairPlanSchema.version, ...input,
    selectedFindings: sortByFingerprint(input.selectedFindings),
    resolvedFindings: [...input.resolvedFindings].sort((left, right) => left.sourceFingerprint.localeCompare(right.sourceFingerprint)),
    authorizedTargets: [...input.authorizedTargets].sort((left, right) => repairTargetKey(left).localeCompare(repairTargetKey(right))),
    expectedBases: [...input.expectedBases].sort((left, right) => left.targetKey.localeCompare(right.targetKey)),
    contextAvailability: [...input.contextAvailability].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    sourceState, policy: { ...REPAIR_PLANNING_POLICY_V1 },
  });
  validateRepairPlanDefinition(definition, repairFingerprint);
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
