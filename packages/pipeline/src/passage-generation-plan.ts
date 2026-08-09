import { createHash } from "node:crypto";
import { z } from "zod";
import type { PassagePlan, PassageStructure } from "./schemas/passage-plan.js";
import type { PassagePlanningContextDiagnostics, PassagePlanningContextPack } from "./passage-planning-context.js";

export const PassageGenerationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("act"), actId: z.string().min(1) }),
  z.object({ kind: z.literal("sequence"), sequenceId: z.string().min(1) }),
  z.object({
    kind: z.literal("route-segment"),
    routeId: z.string().min(1),
    passageIds: z.array(z.string().min(1)).min(1),
  }),
]);

export type PassageGenerationScope = z.infer<typeof PassageGenerationScopeSchema>;

export interface PassageGenerationPolicy {
  id: string;
  maxPassagesPerUnit: number;
  maxUnitsPerPlan: number;
  maxEstimatedInputTokensPerUnit: number;
  maxOutputTokensPerUnit: number;
  maxAttemptsPerUnit: number;
}

export const passageGenerationPolicyV1: PassageGenerationPolicy = Object.freeze({
  id: "passage-plan-generation-v1",
  maxPassagesPerUnit: 25,
  maxUnitsPerPlan: 100,
  maxEstimatedInputTokensPerUnit: 32_000,
  maxOutputTokensPerUnit: 8_000,
  maxAttemptsPerUnit: 3,
});

export interface PassageGenerationPlanInput {
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  structure: PassageStructure;
  passages: Array<{ versionId: string; content: PassagePlan }>;
  scope: PassageGenerationScope;
  providerId: string;
  modelId: string;
  policy?: PassageGenerationPolicy;
  buildUnitContext?: (input: {
    sequenceId: string;
    passageIds: string[];
    requestedMaximumOutputTokens: number;
    maximumEstimatedInputTokens: number;
  }) => { context: PassagePlanningContextPack; diagnostics: PassagePlanningContextDiagnostics };
}

export interface PlannedPassageGenerationUnit {
  id: string;
  position: number;
  sequenceId: string;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  contextFingerprint?: string;
  context?: PassagePlanningContextPack;
  contextDiagnostics?: PassagePlanningContextDiagnostics;
}

export interface PlannedPassageGeneration {
  fingerprint: string;
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  scope: PassageGenerationScope;
  providerId: string;
  modelId: string;
  policy: PassageGenerationPolicy;
  units: PlannedPassageGenerationUnit[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  costEstimate: { status: "unavailable"; reason: string };
  validationStages: string[];
}

const hash = (value: unknown): string => createHash("sha256")
  .update(stableJson(value))
  .digest("hex");

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildPassageGenerationPlan(input: PassageGenerationPlanInput): PlannedPassageGeneration {
  const scope = PassageGenerationScopeSchema.parse(input.scope);
  const policy = input.policy ?? passageGenerationPolicyV1;
  validatePolicy(policy);

  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  if (passageById.size !== input.passages.length) throw new Error("Snapshot contains duplicate passage IDs");

  const sequences = [...input.structure.sequences]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const sequenceById = new Map(sequences.map((item) => [item.id, item]));
  const selectedIds = selectPassages(scope, input.structure, sequences, passageById);
  if (!selectedIds.length) throw new Error("Selected generation scope contains no passages");

  const selected = new Set(selectedIds);
  const grouped = sequences.flatMap((sequence) => {
    const ids = sequence.passageIds.filter((id) => selected.has(id));
    if (!ids.length) return [];
    return chunk(ids, policy.maxPassagesPerUnit).map((passageIds) => ({ sequenceId: sequence.id, passageIds }));
  });
  if (grouped.length > policy.maxUnitsPerPlan) {
    throw new Error(`Generation scope exceeds the ${policy.maxUnitsPerPlan}-unit execution-policy limit`);
  }

  const immutableBase = {
    projectId: input.projectId,
    snapshotId: input.snapshotId,
    structureVersionId: input.structureVersionId,
    upstreamVersions: sortRecord(input.upstreamVersions),
    scope,
    providerId: input.providerId,
    modelId: input.modelId,
    policy,
  };
  const units = grouped.map((group, position) => {
    const passageItems = group.passageIds.map((id) => {
      const item = passageById.get(id);
      if (!item) throw new Error(`Snapshot passage ${id} is missing its immutable version`);
      return item;
    });
    const estimatedOutputTokens = Math.min(
      policy.maxOutputTokensPerUnit,
      Math.max(600, passageItems.length * 260),
    );
    const builtContext = input.buildUnitContext?.({
      sequenceId: group.sequenceId,
      passageIds: group.passageIds,
      requestedMaximumOutputTokens: estimatedOutputTokens,
      maximumEstimatedInputTokens: policy.maxEstimatedInputTokensPerUnit,
    });
    const unitBase = {
      ...immutableBase,
      sequenceId: group.sequenceId,
      passages: passageItems.map((item) => ({ id: item.content.id, versionId: item.versionId })),
      contextFingerprint: builtContext?.diagnostics.contextFingerprint,
    };
    const inputFingerprint = hash(unitBase);
    const estimatedInputTokens = builtContext?.diagnostics.estimatedInputTokens ?? estimateTokens({
      dependencies: immutableBase.upstreamVersions,
      scope,
      passages: passageItems.map((item) => item.content),
    });
    if (estimatedInputTokens > policy.maxEstimatedInputTokensPerUnit) {
      throw new Error(`Unit ${group.sequenceId} exceeds the execution-policy input limit`);
    }
    return {
      id: `pgu_${inputFingerprint.slice(0, 24)}`,
      position,
      sequenceId: group.sequenceId,
      passageIds: passageItems.map((item) => item.content.id),
      passageVersionIds: passageItems.map((item) => item.versionId),
      inputFingerprint,
      estimatedInputTokens,
      estimatedOutputTokens,
      contextFingerprint: builtContext?.diagnostics.contextFingerprint,
      context: builtContext?.context,
      contextDiagnostics: builtContext?.diagnostics,
    };
  });
  const estimatedInputTokens = units.reduce((total, unit) => total + unit.estimatedInputTokens, 0);
  const estimatedOutputTokens = units.reduce((total, unit) => total + unit.estimatedOutputTokens, 0);
  const costEstimate = {
    status: "unavailable" as const,
    reason: "Model pricing is not fetched during local plan preview.",
  };
  const validationStages = [
    "structured-output-schema",
    "stable-id-and-reference-validation",
    "affected-scope-passage-plan-validation",
  ];
  const fingerprint = hash({
    ...immutableBase,
    units: units.map((unit) => ({
      id: unit.id,
      inputFingerprint: unit.inputFingerprint,
      estimatedInputTokens: unit.estimatedInputTokens,
      estimatedOutputTokens: unit.estimatedOutputTokens,
    })),
    estimatedInputTokens,
    estimatedOutputTokens,
    costEstimate,
    validationStages,
  });

  return {
    ...immutableBase,
    fingerprint,
    units,
    estimatedInputTokens,
    estimatedOutputTokens,
    costEstimate,
    validationStages,
  };
}

function selectPassages(
  scope: PassageGenerationScope,
  structure: PassageStructure,
  sequences: PassageStructure["sequences"],
  passageById: Map<string, { versionId: string; content: PassagePlan }>,
): string[] {
  if (scope.kind === "sequence") {
    const sequence = sequences.find((item) => item.id === scope.sequenceId);
    if (!sequence) throw new Error("Selected sequence is not part of the approved snapshot");
    return sequence.passageIds;
  }
  if (scope.kind === "act") {
    if (!structure.acts.some((item) => item.id === scope.actId)) {
      throw new Error("Selected act is not part of the approved snapshot");
    }
    return sequences.filter((item) => item.actId === scope.actId).flatMap((item) => item.passageIds);
  }
  const requested = new Set(scope.passageIds);
  if (requested.size !== scope.passageIds.length) throw new Error("Route segment contains duplicate passage IDs");
  for (const id of requested) {
    const passage = passageById.get(id)?.content;
    if (!passage) throw new Error(`Route segment passage ${id} is not part of the approved snapshot`);
    if (passage.routeIds.length !== 0 && !passage.routeIds.includes(scope.routeId)) {
      throw new Error(`Passage ${id} does not belong to route ${scope.routeId}`);
    }
  }
  return sequences.flatMap((sequence) => sequence.passageIds.filter((id) => requested.has(id)));
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(stableJson(value).length / 4));
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function validatePolicy(policy: PassageGenerationPolicy): void {
  if (policy.maxPassagesPerUnit < 1 || policy.maxPassagesPerUnit > 25) {
    throw new Error("Execution policy must limit passage-planning units to 25 passages");
  }
  if (policy.maxUnitsPerPlan < 1 || policy.maxEstimatedInputTokensPerUnit < 1
    || policy.maxOutputTokensPerUnit < 1 || policy.maxAttemptsPerUnit < 1) {
    throw new Error("Execution policy limits must be positive");
  }
}
