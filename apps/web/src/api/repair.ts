export type RepairFindingSourceKind =
  | "foundation-3-static-validation"
  | "foundation-5a-runtime"
  | "foundation-5b-playtest"
  | "foundation-5c-narrative-review";

export interface RepairFindingLocator {
  sourceKind: RepairFindingSourceKind;
  sourceVersionId: string;
  findingId: string;
  planId?: string;
  unitId?: string;
}

export interface RepairFindingSummary {
  sourceKind: RepairFindingSourceKind;
  locator: RepairFindingLocator;
  sourceFingerprint: string;
  code: string;
  category: string;
  severity: string;
  message: string;
  sourceState: "current" | "historical";
  entityIds: string[];
  createdAt: string;
}

export interface ResolvedRepairFinding {
  reference: Record<string, unknown> & { kind: RepairFindingSourceKind };
  sourceFingerprint: string;
  sourceState: "current" | "historical";
  stateReasons: string[];
  categoryCode: string;
  message: string;
  entityKeys: string[];
}

export interface RepairIntent { schemaVersion: 1; category: string; note: string }
export type RepairTarget = Record<string, unknown> & { kind: string };
export interface RepairTargetOption { target: RepairTarget; targetKey: string; reason: string; protected: boolean }

export interface RepairPlanDefinition {
  projectId: string;
  selectedFindings: Array<Record<string, unknown>>;
  intent: RepairIntent;
  authorizedTargets: RepairTarget[];
  expectedBases: Array<Record<string, unknown> & { targetKey: string }>;
  impactGraph: {
    fingerprint: string;
    nodes: Array<{ id: string; classification: "direct" | "dependent" | "historical-evidence"; entityKind: string; entityId: string; label: string; reason: string }>;
    edges: Array<{ from: string; to: string; reason: string }>;
  };
  sourceState: "current" | "historical";
  providerNeeded: "manual-deterministic" | "ai-assisted";
}

export interface RepairPlanPreview {
  definition: RepairPlanDefinition;
  fingerprint: string;
  currentState: { status: "current" | "historical"; reasons: string[] };
  eligibleForGeneration: boolean;
}

export interface RepairPlanView {
  id: string;
  artifactVersionId: string;
  definitionFingerprint: string;
  definition: RepairPlanDefinition;
  createdAt: string;
  currentState: { status: "current" | "historical"; reasons: string[] };
  eligibleForGeneration: boolean;
}

export interface RepairPlanSummary {
  id: string;
  artifactVersionId: string;
  createdAt: string;
  definitionFingerprint: string;
  intent: RepairIntent;
  findingCount: number;
  targetCount: number;
  impactCount: number;
  currentState: { status: "current" | "historical"; reasons: string[] };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/repair`;

export const listRepairFindings = async (projectId: string, sourceKind: RepairFindingSourceKind) =>
  json<{ items: RepairFindingSummary[]; truncated: boolean; limit: number }>(await fetch(`${root(projectId)}/findings?sourceKind=${encodeURIComponent(sourceKind)}`));

export const resolveRepairFinding = async (projectId: string, locator: RepairFindingLocator) =>
  json<ResolvedRepairFinding>(await fetch(`${root(projectId)}/findings/resolve`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(locator),
  }));

export const listEligibleRepairTargets = async (projectId: string, findings: ResolvedRepairFinding[], intent: RepairIntent) =>
  json<{ findings: ResolvedRepairFinding[]; targets: RepairTargetOption[] }>(await fetch(`${root(projectId)}/targets`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ findings, intent }),
  }));

const request = (findings: ResolvedRepairFinding[], intent: RepairIntent, targets: RepairTarget[]) => ({ findings, intent, targets });

export const previewRepairPlan = async (projectId: string, findings: ResolvedRepairFinding[], intent: RepairIntent, targets: RepairTarget[]) =>
  json<RepairPlanPreview>(await fetch(`${root(projectId)}/plans/preview`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(findings, intent, targets)),
  }));

export const saveRepairPlan = async (projectId: string, findings: ResolvedRepairFinding[], intent: RepairIntent, targets: RepairTarget[]) =>
  json<RepairPlanView>(await fetch(`${root(projectId)}/plans`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(findings, intent, targets)),
  }));

export const listRepairPlans = async (projectId: string) =>
  json<{ items: RepairPlanSummary[] }>(await fetch(`${root(projectId)}/plans`));

export const loadRepairPlan = async (projectId: string, planId: string) =>
  json<RepairPlanView>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}`));
