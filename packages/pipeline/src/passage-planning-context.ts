import { createHash } from "node:crypto";
import type { LongFormEndingPlan } from "./schemas/long-form-ending-plan.js";
import type { LongFormMechanicsPlan } from "./schemas/long-form-mechanics-plan.js";
import type { LongFormRoutePlan } from "./schemas/long-form-route-plan.js";
import type { LongFormStoryBible } from "./schemas/long-form-story-bible.js";
import type { ChoicePlan, NarrativeThread, PassagePlan, PassageStructure } from "./schemas/passage-plan.js";
import type { ProjectBrief } from "./schemas/project-brief.js";
import { stableJson, type PassageGenerationScope } from "./passage-generation-plan.js";

export const passagePlanningContextSchema = Object.freeze({
  id: "cyoa.passage-planning-context",
  version: 1,
});

export interface ImmutableVersioned<T> { versionId: string; content: T }

export interface PassagePlanningContextDiagnostics {
  includedRecords: Record<string, { ids: string[]; versionIds?: string[] }>;
  excludedRecordCounts: Record<string, number>;
  estimatedInputTokens: number;
  outputSchema: { id: string; version: number };
  requestedMaximumOutputTokens: number;
  capabilityRequirements: { structuredOutput: boolean; localValidation: boolean };
  contextFingerprint: string;
}

export interface PassagePlanningContextPack {
  schemaId: typeof passagePlanningContextSchema.id;
  schemaVersion: typeof passagePlanningContextSchema.version;
  identity: {
    projectId: string;
    snapshotId: string;
    structureVersionId: string;
    upstreamVersions: Record<string, string>;
  };
  scope: PassageGenerationScope;
  structure: { act: PassageStructure["acts"][number]; sequence: PassageStructure["sequences"][number] };
  selectedPassages: Array<ImmutableVersioned<PassagePlan>>;
  neighboringPassages: Array<ImmutableVersioned<PassagePlan>>;
  choices: Array<ImmutableVersioned<ChoicePlan>>;
  threads: Array<ImmutableVersioned<NarrativeThread>>;
  upstream: {
    brief: Pick<ProjectBrief, "workingTitle" | "premise" | "sourceMode" | "tone" | "pointOfView" | "adaptationFidelity">;
    routes: Partial<LongFormRoutePlan>;
    endings: Partial<LongFormEndingPlan>;
    mechanics: Partial<LongFormMechanicsPlan>;
    bible: Partial<LongFormStoryBible>;
  };
}

export interface PassagePlanningContextInput {
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  scope: PassageGenerationScope;
  structure: PassageStructure;
  passages: Array<ImmutableVersioned<PassagePlan>>;
  choices: Array<ImmutableVersioned<ChoicePlan>>;
  threads: Array<ImmutableVersioned<NarrativeThread>>;
  selectedPassageIds: string[];
  brief: ProjectBrief;
  bible: LongFormStoryBible;
  routes: LongFormRoutePlan;
  endings: LongFormEndingPlan;
  mechanics: LongFormMechanicsPlan;
  outputSchema: { id: string; version: number };
  requestedMaximumOutputTokens: number;
  maximumEstimatedInputTokens: number;
}

export class BoundedPassagePlanningContextError extends Error {
  public readonly code = "bounded_context_invalid";
  public readonly retryable = false;
}

export function buildPassagePlanningContext(input: PassagePlanningContextInput): {
  context: PassagePlanningContextPack;
  diagnostics: PassagePlanningContextDiagnostics;
} {
  const selectedSet = new Set(input.selectedPassageIds);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  const selectedPassages = input.selectedPassageIds.map((id) => required(passageById.get(id), `Missing exact selected passage ${id}`));
  const sequenceIds = new Set(selectedPassages.map((item) => item.content.sequenceId));
  if (sequenceIds.size !== 1) throw new BoundedPassagePlanningContextError("A generation unit must belong to one sequence");
  const sequence = required(input.structure.sequences.find((item) => item.id === [...sequenceIds][0]), "Selected sequence is missing");
  const act = required(input.structure.acts.find((item) => item.id === sequence.actId), "Selected parent act is missing");

  const neighborIds = new Set<string>();
  for (const id of input.selectedPassageIds) {
    const index = sequence.passageIds.indexOf(id);
    if (index < 0) throw new BoundedPassagePlanningContextError(`Passage ${id} is not owned by sequence ${sequence.id}`);
    for (const candidate of [sequence.passageIds[index - 1], sequence.passageIds[index + 1]]) {
      if (candidate && !selectedSet.has(candidate)) neighborIds.add(candidate);
    }
  }
  const connectedChoices = input.choices.filter((item) =>
    selectedSet.has(item.content.sourcePassageId)
    || selectedSet.has(item.content.destinationPassageId));
  for (const choice of connectedChoices) {
    for (const passageId of [choice.content.sourcePassageId, choice.content.destinationPassageId]) {
      if (selectedSet.has(passageId)) continue;
      required(passageById.get(passageId), `Missing exact directly connected passage ${passageId}`);
      neighborIds.add(passageId);
    }
  }
  const neighboringPassages = [...neighborIds].sort().map((id) => required(passageById.get(id), `Missing exact neighboring passage ${id}`));

  const threadIds = new Set(selectedPassages.flatMap((item) => [
    ...item.content.setupThreadIds, ...item.content.payoffThreadIds,
  ]));
  const threads = input.threads.filter((item) => threadIds.has(item.content.id));
  const routeIds = new Set([
    ...(input.scope.kind === "route-segment" ? [input.scope.routeId] : []),
    ...selectedPassages.flatMap((item) => item.content.routeIds),
  ]);
  const endingIds = new Set(selectedPassages.flatMap((item) => item.content.endingId ? [item.content.endingId] : []));
  const characterIds = new Set(selectedPassages.flatMap((item) => item.content.characterIds));
  const relationshipIds = new Set(selectedPassages.flatMap((item) => item.content.relationshipIds));
  const locationIds = new Set(selectedPassages.flatMap((item) => item.content.locationIds));
  const factIds = new Set(selectedPassages.flatMap((item) => [
    ...item.content.requiredFactIds, ...item.content.revealedFactIds,
  ]));
  const preservedDifferenceIds = new Set(selectedPassages.flatMap((item) => item.content.preservedDifferenceIds));
  const decisionIds = new Set([
    ...sequence.requiredDecisionIds,
    ...connectedChoices.flatMap((item) => item.content.sourceDecisionIds),
  ]);
  const mechanicKeys = new Set(connectedChoices.flatMap((item) => [
    ...item.content.effects.map((effect) => effect.mechanicKey),
    ...conditionMechanicKeys(item.content.condition),
  ]));
  input.mechanics.choiceEffectPlans
    .filter((item) => item.sourceDecisionIds.some((id) => decisionIds.has(id)))
    .forEach((item) => item.mechanicKeys.forEach((key) => mechanicKeys.add(key)));

  const routes = input.routes.routes.filter((item) => routeIds.has(item.id));
  routes.flatMap((item) => item.relationshipArcs).forEach((item) => relationshipIds.add(item.relationshipId));
  const relevantEndings = input.endings.endings.filter((item) => endingIds.has(item.id) || routeIds.has(item.routeId));
  relevantEndings.flatMap((item) => item.characterOutcomes).forEach((item) => characterIds.add(item.characterId));
  relevantEndings.flatMap((item) => item.relationshipOutcomes).forEach((item) => relationshipIds.add(item.relationshipId));

  const context: PassagePlanningContextPack = {
    schemaId: passagePlanningContextSchema.id,
    schemaVersion: passagePlanningContextSchema.version,
    identity: {
      projectId: input.projectId,
      snapshotId: input.snapshotId,
      structureVersionId: input.structureVersionId,
      upstreamVersions: sortRecord(input.upstreamVersions),
    },
    scope: input.scope,
    structure: { act, sequence },
    selectedPassages,
    neighboringPassages,
    choices: connectedChoices,
    threads,
    upstream: {
      brief: pick(input.brief, ["workingTitle", "premise", "sourceMode", "tone", "pointOfView", "adaptationFidelity"]),
      routes: {
        schemaVersion: input.routes.schemaVersion,
        title: input.routes.title,
        acts: input.routes.acts.filter((item) => item.id === act.id || item.routeId === null || (item.routeId && routeIds.has(item.routeId))),
        routes,
        decisionPoints: input.routes.decisionPoints.filter((item) => decisionIds.has(item.id)),
        reconvergences: input.routes.reconvergences.filter((item) => preservedDifferenceIds.has(item.id)),
        endingHooks: input.routes.endingHooks.filter((item) => routeIds.has(item.routeId) || sequence.endingHookIds.includes(item.id)),
      },
      endings: { schemaVersion: input.endings.schemaVersion, title: input.endings.title, endings: relevantEndings },
      mechanics: {
        schemaVersion: input.mechanics.schemaVersion,
        title: input.mechanics.title,
        visibleStats: input.mechanics.visibleStats.filter((item) => mechanicKeys.has(item.key)),
        relationships: input.mechanics.relationships.filter((item) => mechanicKeys.has(item.key) || relationshipIds.has(item.relationshipId)),
        flags: input.mechanics.flags.filter((item) => mechanicKeys.has(item.key)),
        resources: input.mechanics.resources.filter((item) => mechanicKeys.has(item.key)),
        gates: input.mechanics.gates.filter((item) => routeIds.has(item.targetId) || endingIds.has(item.targetId)),
        choiceEffectPlans: input.mechanics.choiceEffectPlans.filter((item) => item.sourceDecisionIds.some((id) => decisionIds.has(id))),
        balancingRules: input.mechanics.balancingRules,
      },
      bible: {
        schemaVersion: input.bible.schemaVersion,
        title: input.bible.title,
        proseGuidance: input.bible.proseGuidance,
        characters: input.bible.characters.filter((item) => characterIds.has(item.id)),
        relationships: input.bible.relationships.filter((item) => relationshipIds.has(item.id)),
        settings: input.bible.settings.filter((item) => locationIds.has(item.id)),
        canonFacts: input.bible.canonFacts.filter((item) => factIds.has(item.id)),
      },
    },
  };
  const contextFingerprint = fingerprintPassagePlanningContext(context);
  const estimatedInputTokens = Math.max(1, Math.ceil(stableJson(context).length / 4));
  if (estimatedInputTokens > input.maximumEstimatedInputTokens) {
    throw new BoundedPassagePlanningContextError(
      `Bounded context requires ${estimatedInputTokens} estimated tokens; limit is ${input.maximumEstimatedInputTokens}`,
    );
  }
  const diagnostics: PassagePlanningContextDiagnostics = {
    includedRecords: {
      acts: { ids: [act.id] },
      sequences: { ids: [sequence.id] },
      passages: { ids: selectedPassages.map(idOf), versionIds: selectedPassages.map((item) => item.versionId) },
      neighboringPassages: { ids: neighboringPassages.map(idOf), versionIds: neighboringPassages.map((item) => item.versionId) },
      choices: { ids: connectedChoices.map(idOf), versionIds: connectedChoices.map((item) => item.versionId) },
      threads: { ids: threads.map(idOf), versionIds: threads.map((item) => item.versionId) },
      routes: { ids: routes.map((item) => item.id) },
      endings: { ids: relevantEndings.map((item) => item.id) },
      characters: { ids: [...characterIds].sort() },
      relationships: { ids: [...relationshipIds].sort() },
      locations: { ids: [...locationIds].sort() },
      facts: { ids: [...factIds].sort() },
      mechanicKeys: { ids: [...mechanicKeys].sort() },
    },
    excludedRecordCounts: {
      passages: input.passages.length - selectedPassages.length - neighboringPassages.length,
      choices: input.choices.length - connectedChoices.length,
      threads: input.threads.length - threads.length,
      routes: input.routes.routes.length - routes.length,
      endings: input.endings.endings.length - relevantEndings.length,
      characters: input.bible.characters.length - characterIds.size,
      relationships: input.bible.relationships.length - relationshipIds.size,
      locations: input.bible.settings.length - locationIds.size,
      facts: input.bible.canonFacts.length - factIds.size,
    },
    estimatedInputTokens,
    outputSchema: input.outputSchema,
    requestedMaximumOutputTokens: input.requestedMaximumOutputTokens,
    capabilityRequirements: { structuredOutput: true, localValidation: true },
    contextFingerprint,
  };
  return { context, diagnostics };
}

export const fingerprintPassagePlanningContext = (value: PassagePlanningContextPack): string =>
  createHash("sha256").update(stableJson(value)).digest("hex");
const idOf = <T extends { id: string }>(item: ImmutableVersioned<T>) => item.content.id;
const required = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new BoundedPassagePlanningContextError(message);
  return value;
};
const sortRecord = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const pick = <T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> => Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;

function conditionMechanicKeys(condition: ChoicePlan["condition"]): string[] {
  if (!condition) return [];
  if (condition.kind === "compare") return [condition.mechanicKey];
  if (condition.kind === "visit-count") return [];
  if (condition.kind === "not") return conditionMechanicKeys(condition.item);
  return condition.items.flatMap(conditionMechanicKeys);
}
