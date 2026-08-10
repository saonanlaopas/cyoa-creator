import type { PassageEntityKind } from "./passage-plan-repository.js";

export interface PassagePlanEntityMutation {
  projectId: string;
  kind: PassageEntityKind;
  entityId: string;
  beforeVersionId: string | null;
  afterVersionId: string | null;
  before: unknown | null;
  after: unknown | null;
}

export interface DraftStalenessImpact {
  passageId: string;
  reasonCode: "passage-plan-material-change" | "choice-plan-change" | "narrative-thread-change";
  changedFields: string[];
}

const materialPassageFields = [
  "sequenceId",
  "kind",
  "purpose",
  "summary",
  "wordTarget",
  "routeIds",
  "characterIds",
  "relationshipIds",
  "locationIds",
  "requiredFactIds",
  "revealedFactIds",
  "setupThreadIds",
  "payoffThreadIds",
  "preservedDifferenceIds",
  "choiceIds",
  "terminal",
  "endingId",
  "draftingNotes",
] as const;

export const cosmeticPassageDraftFields = Object.freeze([
  "title",
  "tags",
  "planningStatus",
  "unresolvedQuestions",
  "position",
]);

export function classifyPassageDraftStaleness(mutation: PassagePlanEntityMutation): DraftStalenessImpact[] {
  if (mutation.kind === "passage") {
    const before = record(mutation.before);
    const after = record(mutation.after);
    const changedFields = mutation.before === null || mutation.after === null
      ? [mutation.before === null ? "created" : "removed"]
      : materialPassageFields.filter((field) => canonical(before[field]) !== canonical(after[field]));
    return changedFields.length ? [{
      passageId: mutation.entityId,
      reasonCode: "passage-plan-material-change",
      changedFields,
    }] : [];
  }
  if (mutation.kind === "choice") {
    if (canonical(mutation.before) === canonical(mutation.after)) return [];
    const before = record(mutation.before);
    const after = record(mutation.after);
    const passageIds = new Set([
      before.sourcePassageId,
      after.sourcePassageId,
      before.destinationPassageId,
      after.destinationPassageId,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0));
    const changedFields = changedKeys(before, after);
    return [...passageIds].sort().map((passageId) => ({
      passageId,
      reasonCode: "choice-plan-change" as const,
      changedFields,
    }));
  }
  if (canonical(mutation.before) === canonical(mutation.after)) return [];
  const before = record(mutation.before);
  const after = record(mutation.after);
  const passageIds = new Set([
    ...stringArray(before.setupPassageIds), ...stringArray(before.payoffPassageIds),
    ...stringArray(after.setupPassageIds), ...stringArray(after.payoffPassageIds),
  ]);
  return [...passageIds].sort().map((passageId) => ({
    passageId,
    reasonCode: "narrative-thread-change" as const,
    changedFields: changedKeys(before, after),
  }));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => canonical(before[key]) !== canonical(after[key]))
    .sort();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
