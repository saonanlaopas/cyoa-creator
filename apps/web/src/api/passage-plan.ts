export type PlanningStatus = "outline" | "planned" | "reviewed" | "locked";
export type ConditionExpression =
  | { kind: "all"; items: ConditionExpression[] }
  | { kind: "any"; items: ConditionExpression[] }
  | { kind: "not"; item: ConditionExpression }
  | { kind: "compare"; mechanicKey: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number | boolean | string }
  | { kind: "visit-count"; passageId: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number };
export interface StateEffect {
  id: string; mechanicKey: string; operation: "set" | "add" | "subtract" | "clear";
  value: number | boolean | string | null; feedback: string; visibility: "visible" | "hidden";
}
export interface ActPlan {
  id: string; label: string; purpose: string; summary: string; wordTarget: number;
  routeIds: string[]; sequenceIds: string[]; position: number;
}
export interface SequencePlan {
  id: string; actId: string; label: string; purpose: string; summary: string; wordTarget: number;
  routeIds: string[]; passageIds: string[]; entryGoals: string[]; exitGoals: string[];
  requiredDecisionIds: string[]; endingHookIds: string[]; position: number; planningStatus: PlanningStatus;
}
export interface PassagePlan {
  id: string; sequenceId: string; title: string; kind: "scene" | "transition" | "hub" | "climax" | "epilogue";
  purpose: string; summary: string; wordTarget: number; routeIds: string[]; tags: string[];
  characterIds: string[]; relationshipIds: string[]; locationIds: string[];
  requiredFactIds: string[]; revealedFactIds: string[]; setupThreadIds: string[];
  payoffThreadIds: string[]; preservedDifferenceIds: string[]; choiceIds: string[];
  terminal: boolean; endingId: string | null; draftingNotes: string[]; unresolvedQuestions: string[];
  planningStatus: PlanningStatus; position: number;
}
export interface ChoicePlan {
  id: string; sourcePassageId: string; label: string; destinationPassageId: string;
  narrativeIntent: string; consequencePreview: string; condition: ConditionExpression | null;
  unavailableBehavior: "hidden" | "disabled"; unavailableExplanation: string;
  effects: StateEffect[]; sourceDecisionIds: string[]; position: number;
}
export interface NarrativeThread {
  id: string; label: string; description: string; setupPassageIds: string[]; payoffPassageIds: string[];
  routeIds: string[]; required: boolean; status: "planned" | "partially-covered" | "covered" | "waived";
  waiverRationale: string;
}
export interface PassageStructure {
  schemaVersion: 1; title: string; projectWordTarget: number; typicalPathWordTarget: number;
  startPassageId: string | null; acts: ActPlan[]; sequences: SequencePlan[];
  characterAvailability: Array<{ characterId: string; actIds: string[]; routeIds: string[] }>;
}
export interface EntityVersion<T> {
  id: string; projectId: string; entityKind: "passage" | "choice" | "thread";
  entityId: string; version: number; content: T; restoredFromVersionId?: string; createdAt: string;
}
export interface StructureVersion {
  id: string; projectId: string; version: number; content: PassageStructure;
  restoredFromVersionId?: string; createdAt: string;
}
export interface PassageFinding {
  code: string; severity: "error" | "warning" | "info";
  entityType: "project" | "act" | "sequence" | "passage" | "choice" | "thread" | "mechanic" | "ending";
  entityId: string; message: string; evidence: string[]; suggestion: string;
  acknowledged: boolean; overrideRationale?: string;
}
export interface PassageValidationReport {
  findings: PassageFinding[];
  budgets: {
    project: BudgetLine; acts: BudgetLine[]; sequences: BudgetLine[]; routes: BudgetLine[];
  };
  coverage: {
    reachablePassageIds: string[]; unreachablePassageIds: string[];
    endingCoverage: Array<{ endingId: string; incomingPassageIds: string[]; plausible: boolean }>;
    routeCoverage: Array<{ routeId: string; passageCount: number; endingCount: number }>;
    pathWords: { minimum: number | null; maximum: number | null; representative: number | null; truncated: boolean };
    mechanicCoverage: Array<{ key: string; reads: string[]; writes: string[] }>;
  };
}
interface BudgetLine { id?: string; target: number; planned: number; difference: number }
export interface PassageSnapshot {
  id: string; projectId: string; version: number; structureVersionId: string;
  upstreamVersions: Record<string, string>; validation: PassageValidationReport;
  status: "draft" | "approved"; createdAt: string;
}
export interface PassagePlanState {
  structure: StructureVersion | null;
  passages: Array<EntityVersion<PassagePlan>>;
  choices: Array<EntityVersion<ChoicePlan>>;
  threads: Array<EntityVersion<NarrativeThread>>;
  state: { projectId: string; status: "empty" | "draft" | "approved" | "stale"; approvedSnapshotId: string | null; updatedAt: string };
  snapshots: PassageSnapshot[];
  report: PassageValidationReport | null;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}
const base = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/passage-plan`;

export const loadPassagePlan = async (projectId: string): Promise<PassagePlanState> => json(await fetch(base(projectId)));
export const createPassagePlan = async (projectId: string): Promise<PassagePlanState> =>
  json(await fetch(base(projectId), { method: "POST" }));
export const savePassagePlan = async (projectId: string, bundle: {
  schemaVersion: 1; structure: PassageStructure; passages: PassagePlan[]; choices: ChoicePlan[]; threads: NarrativeThread[];
}): Promise<PassagePlanState> => json(await fetch(base(projectId), {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle),
}));
export const savePassageStructure = async (projectId: string, content: PassageStructure) =>
  json<{ structure: StructureVersion; report: PassageValidationReport }>(await fetch(`${base(projectId)}/structure`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(content),
  }));
export const savePassageEntity = async <T>(projectId: string, kind: "passage" | "choice" | "thread", id: string, content: T) =>
  json<{ entity: EntityVersion<T>; report: PassageValidationReport }>(await fetch(`${base(projectId)}/entities/${kind}/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(content),
  }));
export const savePassageEntities = async (projectId: string, entities: Array<{ kind: "passage" | "choice" | "thread"; id: string; content: unknown }>) =>
  json<{ entities: Array<EntityVersion<unknown>>; report: PassageValidationReport }>(await fetch(`${base(projectId)}/entities/bulk`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entities }),
  }));
export const deletePassageEntity = async (projectId: string, kind: string, id: string) =>
  json(await fetch(`${base(projectId)}/entities/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }));
export const listPassageEntityVersions = async <T>(projectId: string, kind: string, id: string): Promise<Array<EntityVersion<T>>> =>
  json(await fetch(`${base(projectId)}/entities/${kind}/${encodeURIComponent(id)}/versions`));
export const restorePassageEntity = async (projectId: string, kind: string, id: string, versionId: string) =>
  json(await fetch(`${base(projectId)}/entities/${kind}/${encodeURIComponent(id)}/restore`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }),
  }));
export const createPassageSnapshot = async (projectId: string): Promise<PassageSnapshot> =>
  json(await fetch(`${base(projectId)}/snapshots`, { method: "POST" }));
export const approvePassagePlan = async (projectId: string, snapshotId?: string) =>
  json(await fetch(`${base(projectId)}/approve`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshotId }),
  }));
export const restorePassageSnapshot = async (projectId: string, snapshotId: string) =>
  json(await fetch(`${base(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, { method: "POST" }));
export const acknowledgePassageFinding = async (projectId: string, finding: PassageFinding, rationale: string) =>
  json<{ report: PassageValidationReport }>(await fetch(`${base(projectId)}/overrides`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: finding.code, entityId: finding.entityId, rationale }),
  }));
export async function downloadPassagePlan(projectId: string, format: "markdown" | "json" | "bundle"): Promise<void> {
  const response = await fetch(`${base(projectId)}/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export passage plan");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `passage-plan.${format === "markdown" ? "md" : "json"}`; anchor.click();
  URL.revokeObjectURL(url);
}
