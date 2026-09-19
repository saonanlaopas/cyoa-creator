import { createHash } from "node:crypto";
import type { LongFormEndingPlan } from "./schemas/long-form-ending-plan.js";
import type { LongFormMechanicsPlan } from "./schemas/long-form-mechanics-plan.js";
import type { LongFormRoutePlan } from "./schemas/long-form-route-plan.js";
import type { LongFormStoryBible } from "./schemas/long-form-story-bible.js";
import type { ChoicePlan, NarrativeThread, PassagePlan, PassageStructure } from "./schemas/passage-plan.js";
import type { ProjectBrief } from "./schemas/project-brief.js";
import { assertCreativeDirectionReferences, selectCreativeDirectionContext, type CreativeDirection } from "./schemas/creative-direction.js";
import { stableJson } from "./passage-generation-plan.js";

export const passageDraftingContextSchema = Object.freeze({
  id: "cyoa.passage-drafting-context",
  version: 1,
});

export interface ImmutableDraftingRecord<T> { versionId: string; content: T }

export interface AcceptedNeighborDraftInput {
  passageId: string;
  draftVersionId: string;
  basedOnPassagePlanVersionId: string;
  proseMarkdown: string;
  wordCount: number;
  lifecycleStatus: "accepted" | "reviewed" | "locked";
  stale: boolean;
}

export interface PassageDraftingContextPack {
  schemaId: typeof passageDraftingContextSchema.id;
  schemaVersion: typeof passageDraftingContextSchema.version;
  identity: {
    projectId: string;
    snapshotId: string;
    structureVersionId: string;
    upstreamVersions: Record<string, string>;
  };
  targets: Array<ImmutableDraftingRecord<PassagePlan>>;
  structure: {
    acts: PassageStructure["acts"];
    sequences: PassageStructure["sequences"];
  };
  choices: Array<ImmutableDraftingRecord<ChoicePlan>>;
  threads: Array<ImmutableDraftingRecord<NarrativeThread>>;
  upstream: {
    brief: Partial<Pick<ProjectBrief,
      "workingTitle" | "premise" | "protagonist" | "pointOfView" | "adaptationFidelity"
      | "tone" | "contentBoundaries" | "priorityCharacters" | "priorityRelationships" | "projectConstraints">>;
    creativeDirection?: ReturnType<typeof selectCreativeDirectionContext>["context"];
    bible: Partial<LongFormStoryBible>;
    routes: Partial<LongFormRoutePlan>;
    endings: Partial<LongFormEndingPlan>;
    mechanics: Partial<LongFormMechanicsPlan>;
  };
  acceptedNeighborProse: Array<Omit<AcceptedNeighborDraftInput, "stale">>;
}

export interface PassageDraftingContextDiagnostics {
  status: "built";
  contextSchema: { id: string; version: number };
  unitId: string;
  targetPassageIds: string[];
  passagePlanVersionIds: string[];
  includedRecords: Record<string, { ids: string[]; versionIds?: string[] }>;
  omittedOptionalContext: Record<string, string[]>;
  staleNeighborDraftsExcluded: Array<{ passageId: string; draftVersionId: string }>;
  estimatedInputTokens: number;
  requestedMaximumOutputTokens: number;
  serializedBytes: number;
  contextFingerprint: string;
}

export interface PassageDraftingContextInput {
  projectId: string;
  unitId: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  structure: PassageStructure;
  passages: Array<ImmutableDraftingRecord<PassagePlan>>;
  choices: Array<ImmutableDraftingRecord<ChoicePlan>>;
  threads: Array<ImmutableDraftingRecord<NarrativeThread>>;
  targetPassageIds: string[];
  brief: ProjectBrief;
  bible: LongFormStoryBible;
  routes: LongFormRoutePlan;
  endings: LongFormEndingPlan;
  mechanics: LongFormMechanicsPlan;
  creativeDirection?: CreativeDirection;
  acceptedDrafts: AcceptedNeighborDraftInput[];
  requiredNeighborPassageIds?: string[];
  maximumEstimatedInputTokens: number;
  requestedMaximumOutputTokens: number;
}

export class BoundedPassageDraftingContextError extends Error {
  public readonly code = "bounded_drafting_context_invalid";
  public readonly retryable = false;
}

export function buildPassageDraftingContext(input: PassageDraftingContextInput): {
  context: PassageDraftingContextPack;
  diagnostics: PassageDraftingContextDiagnostics;
} {
  const targets = new Set(input.targetPassageIds);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  const targetRecords = input.targetPassageIds.map((id) => required(
    passageById.get(id), `Missing exact target passage ${id}`,
  ));
  const sequenceIds = new Set(targetRecords.map((item) => item.content.sequenceId));
  const sequences = input.structure.sequences
    .filter((item) => sequenceIds.has(item.id))
    .sort(positionThenId);
  if (sequences.length !== sequenceIds.size) throw new BoundedPassageDraftingContextError("A target sequence is missing");
  const actIds = new Set(sequences.map((item) => item.actId));
  const acts = input.structure.acts.filter((item) => actIds.has(item.id)).sort(positionThenId);
  if (acts.length !== actIds.size) throw new BoundedPassageDraftingContextError("A target act is missing");

  const connectedChoices = input.choices
    .filter((item) => targets.has(item.content.sourcePassageId) || targets.has(item.content.destinationPassageId))
    .sort((left, right) => left.content.sourcePassageId.localeCompare(right.content.sourcePassageId)
      || left.content.position - right.content.position || left.content.id.localeCompare(right.content.id));
  const graphNeighborIds = new Set(connectedChoices.flatMap((item) => [
    item.content.sourcePassageId, item.content.destinationPassageId,
  ]).filter((id) => !targets.has(id)));
  const sequenceNeighborIds = new Set<string>();
  for (const sequence of sequences) {
    for (const passageId of input.targetPassageIds) {
      const index = sequence.passageIds.indexOf(passageId);
      if (index < 0) continue;
      for (const neighbor of [sequence.passageIds[index - 1], sequence.passageIds[index + 1]]) {
        if (neighbor && !targets.has(neighbor)) sequenceNeighborIds.add(neighbor);
      }
    }
  }
  const neighborIds = [...new Set([...graphNeighborIds, ...sequenceNeighborIds])].sort();
  for (const id of graphNeighborIds) required(passageById.get(id), `Missing directly connected passage ${id}`);

  const targetThreadIds = new Set(targetRecords.flatMap((item) => [
    ...item.content.setupThreadIds, ...item.content.payoffThreadIds,
  ]));
  const threads = input.threads.filter((item) => targetThreadIds.has(item.content.id)
    || item.content.setupPassageIds.some((id) => targets.has(id))
    || item.content.payoffPassageIds.some((id) => targets.has(id)))
    .sort((left, right) => left.content.id.localeCompare(right.content.id));
  const routeIds = new Set([
    ...targetRecords.flatMap((item) => item.content.routeIds),
    ...sequences.flatMap((item) => item.routeIds),
    ...threads.flatMap((item) => item.content.routeIds),
  ]);
  const endingIds = new Set(targetRecords.flatMap((item) => item.content.endingId ? [item.content.endingId] : []));
  const characterIds = new Set(targetRecords.flatMap((item) => item.content.characterIds));
  const relationshipIds = new Set(targetRecords.flatMap((item) => item.content.relationshipIds));
  const locationIds = new Set(targetRecords.flatMap((item) => item.content.locationIds));
  const factIds = new Set(targetRecords.flatMap((item) => [
    ...item.content.requiredFactIds, ...item.content.revealedFactIds,
  ]));
  const preservedDifferenceIds = new Set(targetRecords.flatMap((item) => item.content.preservedDifferenceIds));
  const decisionIds = new Set([
    ...sequences.flatMap((item) => item.requiredDecisionIds),
    ...connectedChoices.flatMap((item) => item.content.sourceDecisionIds),
  ]);
  const mechanicKeys = new Set<string>();
  connectedChoices.forEach((item) => {
    item.content.effects.forEach((effect) => mechanicKeys.add(effect.mechanicKey));
    conditionMechanicKeys(item.content.condition).forEach((key) => mechanicKeys.add(key));
  });
  const effectPlans = input.mechanics.choiceEffectPlans.filter((item) =>
    item.sourceDecisionIds.some((id) => decisionIds.has(id)) || item.mechanicKeys.some((key) => mechanicKeys.has(key)));
  effectPlans.forEach((item) => item.mechanicKeys.forEach((key) => mechanicKeys.add(key)));

  const routes = input.routes.routes.filter((item) => routeIds.has(item.id));
  routes.flatMap((item) => item.relationshipArcs).forEach((item) => relationshipIds.add(item.relationshipId));
  const decisions = input.routes.decisionPoints.filter((item) => decisionIds.has(item.id)
    || item.choices.some((choice) => choice.routeId !== null && routeIds.has(choice.routeId)));
  const endings = input.endings.endings.filter((item) => endingIds.has(item.id) || routeIds.has(item.routeId));
  endings.flatMap((item) => item.characterOutcomes).forEach((item) => characterIds.add(item.characterId));
  endings.flatMap((item) => item.relationshipOutcomes).forEach((item) => relationshipIds.add(item.relationshipId));
  input.bible.relationships.filter((item) => relationshipIds.has(item.id))
    .flatMap((item) => item.characterIds).forEach((id) => characterIds.add(id));
  const gates = input.mechanics.gates.filter((item) => routeIds.has(item.targetId) || endingIds.has(item.targetId)
    || item.conditions.some((condition) => mechanicKeys.has(condition.mechanicKey)));
  gates.flatMap((item) => item.conditions).forEach((condition) => mechanicKeys.add(condition.mechanicKey));

  if (input.creativeDirection) assertCreativeDirectionReferences(input.creativeDirection, {
    characterIds: input.bible.characters.map((item) => item.id),
    relationships: input.bible.relationships.map((item) => ({ id: item.id, characterIds: item.characterIds })),
    routeIds: input.routes.routes.map((item) => item.id),
    acts: input.routes.acts.map((item) => ({ id: item.id, routeId: item.routeId })),
  });
  const creativeDirection = input.creativeDirection ? selectCreativeDirectionContext(input.creativeDirection, {
    routeIds: [...routeIds], actIds: [...actIds], relationshipIds: [...relationshipIds], characterIds: [...characterIds],
  }) : undefined;

  const base: PassageDraftingContextPack = {
    schemaId: passageDraftingContextSchema.id,
    schemaVersion: passageDraftingContextSchema.version,
    identity: {
      projectId: input.projectId,
      snapshotId: input.snapshotId,
      structureVersionId: input.structureVersionId,
      upstreamVersions: sortRecord(input.upstreamVersions),
    },
    targets: targetRecords,
    structure: { acts, sequences },
    choices: connectedChoices,
    threads,
    upstream: {
      brief: input.creativeDirection ? pick(input.brief, [
        "workingTitle", "premise", "protagonist", "adaptationFidelity",
        "contentBoundaries", "priorityCharacters", "priorityRelationships", "projectConstraints",
      ]) : pick(input.brief, ["workingTitle", "premise", "protagonist", "pointOfView", "adaptationFidelity", "tone",
        "contentBoundaries", "priorityCharacters", "priorityRelationships", "projectConstraints"]),
      ...(creativeDirection ? { creativeDirection: creativeDirection.context } : {}),
      bible: {
        schemaVersion: input.bible.schemaVersion,
        title: input.bible.title,
        ...(input.creativeDirection ? {} : { proseGuidance: input.bible.proseGuidance }),
        characters: input.bible.characters.filter((item) => characterIds.has(item.id)),
        relationships: input.bible.relationships.filter((item) => relationshipIds.has(item.id)),
        settings: input.bible.settings.filter((item) => locationIds.has(item.id)),
        canonFacts: input.bible.canonFacts.filter((item) => factIds.has(item.id)),
      },
      routes: {
        schemaVersion: input.routes.schemaVersion,
        title: input.routes.title,
        routes,
        decisionPoints: decisions,
        reconvergences: input.routes.reconvergences.filter((item) => preservedDifferenceIds.has(item.id)),
        endingHooks: input.routes.endingHooks.filter((item) => routeIds.has(item.routeId)
          || sequences.some((sequence) => sequence.endingHookIds.includes(item.id))),
      },
      endings: { schemaVersion: input.endings.schemaVersion, title: input.endings.title, endings },
      mechanics: {
        schemaVersion: input.mechanics.schemaVersion,
        title: input.mechanics.title,
        visibleStats: input.mechanics.visibleStats.filter((item) => mechanicKeys.has(item.key)),
        relationships: input.mechanics.relationships.filter((item) =>
          mechanicKeys.has(item.key) || relationshipIds.has(item.relationshipId)),
        flags: input.mechanics.flags.filter((item) => mechanicKeys.has(item.key)),
        resources: input.mechanics.resources.filter((item) => mechanicKeys.has(item.key)),
        gates,
        choiceEffectPlans: effectPlans,
        balancingRules: input.mechanics.balancingRules,
      },
    },
    acceptedNeighborProse: [],
  };

  const requiredNeighborIds = new Set(input.requiredNeighborPassageIds ?? []);
  const authoritativeAcceptedDrafts = input.acceptedDrafts.filter((item) =>
    item.lifecycleStatus === "accepted" || item.lifecycleStatus === "reviewed" || item.lifecycleStatus === "locked");
  const acceptedByPassage = new Map(authoritativeAcceptedDrafts.map((item) => [item.passageId, item]));
  const staleNeighborDraftsExcluded = authoritativeAcceptedDrafts
    .filter((item) => neighborIds.includes(item.passageId) && item.stale)
    .map((item) => ({ passageId: item.passageId, draftVersionId: item.draftVersionId }))
    .sort((left, right) => left.passageId.localeCompare(right.passageId));
  for (const passageId of requiredNeighborIds) {
    const neighbor = acceptedByPassage.get(passageId);
    if (!neighbor || neighbor.stale) {
      throw new BoundedPassageDraftingContextError(`Required accepted neighboring prose ${passageId} is missing or stale`);
    }
  }
  const requiredTokens = estimateTokens(base);
  if (requiredTokens > input.maximumEstimatedInputTokens) {
    throw new BoundedPassageDraftingContextError(
      `Required drafting context requires ${requiredTokens} estimated tokens; limit is ${input.maximumEstimatedInputTokens}`,
    );
  }
  const orderedNeighbors = neighborIds
    .map((id) => acceptedByPassage.get(id))
    .filter((item): item is AcceptedNeighborDraftInput => Boolean(item) && !item!.stale)
    .sort((left, right) => Number(graphNeighborIds.has(right.passageId)) - Number(graphNeighborIds.has(left.passageId))
      || left.passageId.localeCompare(right.passageId));
  const omittedNeighborIds: string[] = [];
  for (const neighbor of orderedNeighbors) {
    const candidate = { ...base, acceptedNeighborProse: [...base.acceptedNeighborProse, withoutStale(neighbor)] };
    if (estimateTokens(candidate) <= input.maximumEstimatedInputTokens || requiredNeighborIds.has(neighbor.passageId)) {
      base.acceptedNeighborProse.push(withoutStale(neighbor));
    } else {
      omittedNeighborIds.push(neighbor.passageId);
    }
  }
  const estimatedInputTokens = estimateTokens(base);
  if (estimatedInputTokens > input.maximumEstimatedInputTokens) {
    throw new BoundedPassageDraftingContextError("Required accepted neighboring prose exceeds the drafting context limit");
  }
  const contextFingerprint = fingerprintPassageDraftingContext(base);
  const serializedBytes = Buffer.byteLength(stableJson(base), "utf8");
  const diagnostics: PassageDraftingContextDiagnostics = {
    status: "built",
    contextSchema: passageDraftingContextSchema,
    unitId: input.unitId,
    targetPassageIds: targetRecords.map((item) => item.content.id),
    passagePlanVersionIds: targetRecords.map((item) => item.versionId),
    includedRecords: {
      passages: { ids: targetRecords.map(idOf), versionIds: targetRecords.map((item) => item.versionId) },
      choices: { ids: connectedChoices.map(idOf), versionIds: connectedChoices.map((item) => item.versionId) },
      threads: { ids: threads.map(idOf), versionIds: threads.map((item) => item.versionId) },
      routes: { ids: routes.map((item) => item.id) },
      decisions: { ids: decisions.map((item) => item.id) },
      endings: { ids: endings.map((item) => item.id) },
      characters: { ids: [...characterIds].sort() },
      relationships: { ids: [...relationshipIds].sort() },
      locations: { ids: [...locationIds].sort() },
      facts: { ids: [...factIds].sort() },
      mechanicKeys: { ids: [...mechanicKeys].sort() },
      acceptedNeighborDrafts: {
        ids: base.acceptedNeighborProse.map((item) => item.passageId),
        versionIds: base.acceptedNeighborProse.map((item) => item.draftVersionId),
      },
      ...(creativeDirection ? {
        creativeDirectionProfiles: { ids: creativeDirection.diagnostics.relevantProfileIds },
        creativeDirectionVariations: { ids: creativeDirection.diagnostics.relevantVariationIds },
      } : {}),
    },
    omittedOptionalContext: {
      acceptedNeighborPassageIds: omittedNeighborIds,
      ...(creativeDirection ? {
        creativeDirectionProfileIds: creativeDirection.diagnostics.omittedRelationshipProfileIds,
        creativeDirectionVariationIds: creativeDirection.diagnostics.omittedScopedVariationIds,
      } : {}),
    },
    staleNeighborDraftsExcluded,
    estimatedInputTokens,
    requestedMaximumOutputTokens: input.requestedMaximumOutputTokens,
    serializedBytes,
    contextFingerprint,
  };
  return { context: base, diagnostics };
}

export const fingerprintPassageDraftingContext = (value: PassageDraftingContextPack): string =>
  createHash("sha256").update(stableJson(value)).digest("hex");

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(stableJson(value), "utf8") / 4));
}

function withoutStale(value: AcceptedNeighborDraftInput): Omit<AcceptedNeighborDraftInput, "stale"> {
  const { stale: _stale, ...result } = value;
  return result;
}

function idOf<T extends { id: string }>(item: ImmutableDraftingRecord<T>): string { return item.content.id; }
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new BoundedPassageDraftingContextError(message);
  return value;
}
function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}
function positionThenId<T extends { position: number; id: string }>(left: T, right: T): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}
function conditionMechanicKeys(condition: ChoicePlan["condition"]): string[] {
  if (!condition) return [];
  if (condition.kind === "compare") return [condition.mechanicKey];
  if (condition.kind === "visit-count") return [];
  if (condition.kind === "not") return conditionMechanicKeys(condition.item);
  return condition.items.flatMap(conditionMechanicKeys);
}
