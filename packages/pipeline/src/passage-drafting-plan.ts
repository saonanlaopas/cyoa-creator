import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChoicePlan, PassagePlan, PassageStructure } from "./schemas/passage-plan.js";
import { stableJson } from "./passage-generation-plan.js";

export const PassageDraftingScopeSchema = z.object({
  kind: z.literal("passages"),
  passageIds: z.array(z.string().min(1)).min(1).max(800),
});

export type PassageDraftingScope = z.infer<typeof PassageDraftingScopeSchema>;

export interface PassageDraftingPolicy {
  id: string;
  maxPassagesPerUnit: number;
  maxUnitsPerPlan: number;
  maxEstimatedInputTokensPerUnit: number;
  maxOutputTokensPerPassage: number;
  maxOutputTokensPerUnit: number;
  maxAttemptsPerUnit: number;
  maxSerializedCandidateBytes: number;
}

export const passageDraftingPolicyV1: PassageDraftingPolicy = Object.freeze({
  id: "passage-drafting-v1",
  maxPassagesPerUnit: 8,
  maxUnitsPerPlan: 100,
  maxEstimatedInputTokensPerUnit: 48_000,
  maxOutputTokensPerPassage: 2_500,
  maxOutputTokensPerUnit: 12_000,
  maxAttemptsPerUnit: 3,
  maxSerializedCandidateBytes: 96_000,
});

export interface PassageDraftingPlanInput {
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  structure: PassageStructure;
  passages: Array<{ versionId: string; content: PassagePlan }>;
  choices: Array<{ versionId: string; content: ChoicePlan }>;
  scope: PassageDraftingScope;
  providerId: string;
  modelId: string;
  policy?: PassageDraftingPolicy;
}

export interface PassageDraftingContextDiagnosticsContract {
  status: "not-built";
  passageIds: string[];
  passageVersionIds: string[];
  directNeighborPassageIds: string[];
  approvedUpstreamVersions: Record<string, string>;
  estimatedInputTokens: number;
  maximumEstimatedInputTokens: number;
  maximumOutputTokens: number;
  note: string;
}

export interface PlannedPassageDraftingUnit {
  id: string;
  position: number;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  contextDiagnostics: PassageDraftingContextDiagnosticsContract;
}

export interface PlannedPassageDrafting {
  fingerprint: string;
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  scope: PassageDraftingScope;
  providerId: string;
  modelId: string;
  policy: PassageDraftingPolicy;
  units: PlannedPassageDraftingUnit[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  costEstimate: { status: "unavailable"; reason: string };
}

const hash = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex");

export function buildPassageDraftingPlan(input: PassageDraftingPlanInput): PlannedPassageDrafting {
  const scope = PassageDraftingScopeSchema.parse(input.scope);
  const policy = input.policy ?? passageDraftingPolicyV1;
  validatePolicy(policy);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  if (passageById.size !== input.passages.length) throw new Error("Snapshot contains duplicate passage IDs");
  const requested = new Set(scope.passageIds);
  if (requested.size !== scope.passageIds.length) throw new Error("Drafting scope contains duplicate passage IDs");
  for (const passageId of requested) {
    if (!passageById.has(passageId)) throw new Error(`Drafting passage ${passageId} is not part of the approved snapshot`);
  }

  const orderedIds = orderedPassageIds(input.structure, input.passages).filter((id) => requested.has(id));
  if (orderedIds.length !== requested.size) throw new Error("Drafting scope contains a passage outside the approved structure");
  const normalizedScope: PassageDraftingScope = { kind: "passages", passageIds: orderedIds };
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  const neighbors = buildNeighbors(input.choices, requested);
  const groups = connectedGroups(orderedIds, neighbors, policy.maxPassagesPerUnit);
  if (groups.length > policy.maxUnitsPerPlan) {
    throw new Error(`Drafting scope exceeds the ${policy.maxUnitsPerPlan}-unit execution-policy limit`);
  }

  const immutableBase = {
    projectId: input.projectId,
    snapshotId: input.snapshotId,
    structureVersionId: input.structureVersionId,
    upstreamVersions: sortRecord(input.upstreamVersions),
    scope: normalizedScope,
    providerId: input.providerId,
    modelId: input.modelId,
    policy,
  };
  const units = groups.map((passageIds, position) => {
    const items = passageIds.map((id) => passageById.get(id)!);
    const directNeighborPassageIds = [...new Set(passageIds.flatMap((id) => [...(neighbors.get(id) ?? [])]))]
      .filter((id) => !passageIds.includes(id))
      .sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
    const estimatedInputTokens = estimateTokens({
      passages: items.map((item) => item.content),
      directNeighborPassageIds,
      upstreamVersions: immutableBase.upstreamVersions,
    });
    if (estimatedInputTokens > policy.maxEstimatedInputTokensPerUnit) {
      throw new Error(`Drafting unit beginning at ${passageIds[0]} exceeds the execution-policy input limit`);
    }
    const estimatedOutputTokens = Math.min(
      policy.maxOutputTokensPerUnit,
      items.reduce((total, item) => total + Math.min(
        policy.maxOutputTokensPerPassage,
        Math.max(600, Math.ceil(item.content.wordTarget * 1.5)),
      ), 0),
    );
    const unitBase = {
      ...immutableBase,
      passages: items.map((item) => ({ id: item.content.id, versionId: item.versionId })),
      directNeighborPassageIds,
      estimatedInputTokens,
      estimatedOutputTokens,
    };
    const inputFingerprint = hash(unitBase);
    return {
      id: `dru_${inputFingerprint.slice(0, 24)}`,
      position,
      passageIds: items.map((item) => item.content.id),
      passageVersionIds: items.map((item) => item.versionId),
      inputFingerprint,
      estimatedInputTokens,
      estimatedOutputTokens,
      contextDiagnostics: {
        status: "not-built" as const,
        passageIds: items.map((item) => item.content.id),
        passageVersionIds: items.map((item) => item.versionId),
        directNeighborPassageIds,
        approvedUpstreamVersions: immutableBase.upstreamVersions,
        estimatedInputTokens,
        maximumEstimatedInputTokens: policy.maxEstimatedInputTokensPerUnit,
        maximumOutputTokens: estimatedOutputTokens,
        note: "Foundation 4B-1 records diagnostics only; full drafting context is built in 4B-2.",
      },
    };
  });
  const estimatedInputTokens = units.reduce((total, unit) => total + unit.estimatedInputTokens, 0);
  const estimatedOutputTokens = units.reduce((total, unit) => total + unit.estimatedOutputTokens, 0);
  const costEstimate = {
    status: "unavailable" as const,
    reason: "Provider pricing and execution are outside Foundation 4B-1 plan preview.",
  };
  const fingerprint = hash({
    ...immutableBase,
    units: units.map((unit) => ({
      id: unit.id,
      passageIds: unit.passageIds,
      passageVersionIds: unit.passageVersionIds,
      inputFingerprint: unit.inputFingerprint,
      estimatedInputTokens: unit.estimatedInputTokens,
      estimatedOutputTokens: unit.estimatedOutputTokens,
      contextDiagnostics: unit.contextDiagnostics,
    })),
    estimatedInputTokens,
    estimatedOutputTokens,
    costEstimate,
  });
  return {
    ...immutableBase,
    fingerprint,
    units,
    estimatedInputTokens,
    estimatedOutputTokens,
    costEstimate,
  };
}

function orderedPassageIds(
  structure: PassageStructure,
  passages: Array<{ versionId: string; content: PassagePlan }>,
): string[] {
  const known = new Set(passages.map((item) => item.content.id));
  const sequences = [...structure.sequences]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  return sequences.flatMap((sequence) => sequence.passageIds.filter((id) => known.has(id)));
}

function buildNeighbors(
  choices: Array<{ versionId: string; content: ChoicePlan }>,
  selected: Set<string>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>([...selected].map((id) => [id, new Set<string>()]));
  for (const { content } of choices) {
    if (!selected.has(content.sourcePassageId) || !selected.has(content.destinationPassageId)) continue;
    result.get(content.sourcePassageId)!.add(content.destinationPassageId);
    result.get(content.destinationPassageId)!.add(content.sourcePassageId);
  }
  return result;
}

function connectedGroups(
  orderedIds: string[],
  neighbors: Map<string, Set<string>>,
  maximum: number,
): string[][] {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  const remaining = new Set(orderedIds);
  const groups: string[][] = [];
  while (remaining.size) {
    const seed = orderedIds.find((id) => remaining.has(id))!;
    const group: string[] = [];
    const queued = new Set([seed]);
    const queue = [seed];
    while (queue.length && group.length < maximum) {
      const current = queue.shift()!;
      if (!remaining.delete(current)) continue;
      group.push(current);
      const adjacent = [...(neighbors.get(current) ?? [])]
        .filter((id) => remaining.has(id) && !queued.has(id))
        .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0) || left.localeCompare(right));
      adjacent.forEach((id) => { queued.add(id); queue.push(id); });
    }
    groups.push(group.sort((left, right) => order.get(left)! - order.get(right)!));
  }
  return groups;
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(stableJson(value).length / 4));
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function validatePolicy(policy: PassageDraftingPolicy): void {
  if (policy.maxPassagesPerUnit < 1 || policy.maxPassagesPerUnit > 8) {
    throw new Error("Drafting policy must limit units to at most 8 passages");
  }
  if (policy.maxUnitsPerPlan < 1 || policy.maxEstimatedInputTokensPerUnit < 1
    || policy.maxOutputTokensPerPassage < 1 || policy.maxOutputTokensPerUnit < 1
    || policy.maxAttemptsPerUnit < 1 || policy.maxSerializedCandidateBytes < 1) {
    throw new Error("Drafting policy limits must be positive");
  }
  if (policy.maxOutputTokensPerPassage > policy.maxOutputTokensPerUnit) {
    throw new Error("Per-passage output limit cannot exceed the unit output limit");
  }
}
