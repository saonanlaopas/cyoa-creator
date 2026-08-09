export type GenerationScope =
  | { kind: "act"; actId: string }
  | { kind: "sequence"; sequenceId: string }
  | { kind: "route-segment"; routeId: string; passageIds: string[] };

export interface GenerationUnit {
  id: string;
  position: number;
  sequenceId: string;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  attemptNumber?: number;
  normalizedError?: { message?: string; retryable?: boolean } | null;
  contextFingerprint?: string;
  contextDiagnostics?: {
    includedRecords: Record<string, { ids: string[]; versionIds?: string[] }>;
    excludedRecordCounts: Record<string, number>;
    estimatedInputTokens: number;
    outputSchema: { id: string; version: number };
    requestedMaximumOutputTokens: number;
    capabilityRequirements: { structuredOutput: boolean; localValidation: boolean };
    contextFingerprint: string;
  };
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number | null } | null;
  candidateReference?: string | null;
  candidate?: {
    id: string;
    outputSchemaId: string;
    outputSchemaVersion: number;
    validation: { valid?: boolean; checks?: string[] };
    repair: { repairsPerformed?: number; maximumRepairs?: number };
    createdAt: string;
  } | null;
}

export interface GenerationPlanPreview {
  fingerprint: string;
  snapshotId: string;
  upstreamVersions: Record<string, string>;
  scope: GenerationScope;
  providerId: string;
  modelId: string;
  units: GenerationUnit[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  costEstimate: { status: "unavailable"; reason: string };
  validationStages: string[];
  policy: { id: string; maxPassagesPerUnit: number; maxUnitsPerPlan: number; maxAttemptsPerUnit: number };
}

export interface GenerationPlan extends Omit<GenerationPlanPreview, "policy"> {
  id: string;
  executionPolicyId: string;
  executionPolicy: GenerationPlanPreview["policy"];
  authorizationState: "planned" | "authorized";
  authorizationFingerprint: string | null;
  authorizedAt: string | null;
  createdAt: string;
  jobId: string;
  jobStatus: GenerationJob["status"];
}

export interface GenerationJob {
  id: string;
  projectId: string;
  planId: string;
  planFingerprint: string;
  status: "planned" | "authorized" | "running" | "completed" | "partially_failed" | "failed" | "cancelled";
  units: GenerationUnit[];
  updatedAt: string;
}

export type ProposalGroupStatus = "proposed" | "applied" | "rejected" | "stale";
export interface PassageProposalOperation {
  id: string;
  kind: "add-entity" | "update-entity";
  entityKind: "passage" | "choice" | "thread";
  entityId: string;
  baseVersionId: string | null;
  fieldDiffs: Array<{ field: string; before: unknown; after: unknown }>;
  sourceCandidateIds: string[];
}
export interface PassageProposalGroup {
  id: string;
  unitId: string;
  position: number;
  label: string;
  summary: string;
  operationIds: string[];
  dependsOnGroupIds: string[];
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  validationFindingIds: string[];
  safeToApplyIndependently: boolean;
  status: ProposalGroupStatus;
  operations: PassageProposalOperation[];
}
export interface PassageProposalSet {
  id: string;
  projectId: string;
  generationPlanId: string;
  generationJobId: string;
  generationPlanFingerprint: string;
  snapshotId: string;
  proposalSchemaId: string;
  proposalSchemaVersion: number;
  candidateIds: string[];
  consolidationFingerprint: string;
  status: ProposalGroupStatus;
  groups: PassageProposalGroup[];
  applications: Array<{
    id: string; selectedGroupIds: string[]; appliedOperationIds: string[];
    previousVersionIds: Record<string, string | null>; resultingVersionIds: Record<string, string>;
    validationPreviewFingerprint: string; createdAt: string;
  }>;
  createdAt: string;
}
export interface PassageProposalPreview {
  id: string;
  proposalId: string;
  selectedGroupIds: string[];
  selectedOperationIds: string[];
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  beforeAfter: Array<{
    operationId: string; entityKind: string; entityId: string;
    fieldDiffs: Array<{ field: string; before: unknown; after: unknown }>;
  }>;
  previewFingerprint: string;
  valid: boolean;
  hardErrors: Array<{ code: string; entityId: string; message: string }>;
  warnings: Array<{ code: string; entityId: string; message: string; acknowledged: boolean }>;
  stalePreconditions: Array<{ operationId: string; entityId: string; expectedVersionId: string | null; currentVersionId: string | null }>;
  createdAt: string;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/passage-generation`;
const requestBody = (scope: GenerationScope) => ({
  scope,
  providerId: "offline-kernel",
  modelId: "deterministic-fixture-v1",
});

export const previewGenerationPlan = async (projectId: string, scope: GenerationScope) =>
  json<GenerationPlanPreview>(await fetch(`${root(projectId)}/plans/preview`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(scope)),
  }));
export const createGenerationPlan = async (projectId: string, scope: GenerationScope) =>
  json<GenerationPlan>(await fetch(`${root(projectId)}/plans`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(scope)),
  }));
export const listGenerationPlans = async (projectId: string) =>
  json<GenerationPlan[]>(await fetch(`${root(projectId)}/plans`));
export const authorizeGenerationPlan = async (projectId: string, planId: string, fingerprint: string) =>
  json<GenerationPlan>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}/authorize`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprint }),
  }));
export const loadGenerationJob = async (projectId: string, jobId: string) =>
  json<GenerationJob>(await fetch(`${root(projectId)}/jobs/${encodeURIComponent(jobId)}`));
export const startGenerationJob = async (projectId: string, jobId: string) =>
  json<GenerationJob>(await fetch(`${root(projectId)}/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST" }));
export const cancelGenerationJob = async (projectId: string, jobId: string) =>
  json<GenerationJob>(await fetch(`${root(projectId)}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }));
export const retryGenerationUnit = async (projectId: string, jobId: string, unitId: string) =>
  json<GenerationJob>(await fetch(
    `${root(projectId)}/jobs/${encodeURIComponent(jobId)}/units/${encodeURIComponent(unitId)}/retry`,
    { method: "POST" },
  ));
export const createPassageProposal = async (projectId: string, jobId: string) =>
  json<PassageProposalSet>(await fetch(`${root(projectId)}/jobs/${encodeURIComponent(jobId)}/proposals`, { method: "POST" }));
export const listPassageProposals = async (projectId: string) =>
  json<PassageProposalSet[]>(await fetch(`${root(projectId)}/proposals`));
export const previewPassageProposal = async (projectId: string, proposalId: string, groupIds: string[]) =>
  json<PassageProposalPreview>(await fetch(`${root(projectId)}/proposals/${encodeURIComponent(proposalId)}/preview`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupIds }),
  }));
export const applyPassageProposal = async (
  projectId: string, proposalId: string, groupIds: string[], previewFingerprint: string,
) => json<PassageProposalSet>(await fetch(`${root(projectId)}/proposals/${encodeURIComponent(proposalId)}/apply`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ groupIds, previewFingerprint }),
}));
export const rejectPassageProposalGroups = async (projectId: string, proposalId: string, groupIds: string[]) =>
  json<PassageProposalSet>(await fetch(`${root(projectId)}/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupIds }),
  }));
