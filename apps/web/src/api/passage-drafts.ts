export type PassageDraftLifecycle = "candidate" | "accepted" | "reviewed" | "locked";
export type PassageDraftStatus = PassageDraftLifecycle | "stale";

export interface PassageDraftVersion {
  id: string;
  projectId: string;
  passageId: string;
  version: number;
  basedOnPassagePlanVersionId: string;
  proseMarkdown: string;
  wordCount: number;
  lifecycleStatus: PassageDraftLifecycle;
  status: PassageDraftStatus;
  sourceKind: "manual" | "generated" | "restore" | "lifecycle";
  generationPlanId: string | null;
  generationJobId: string | null;
  generationUnitId: string | null;
  generationProvenance: {
    outputId: string; attemptId: string; inputFingerprint: string; contextFingerprint: string;
    providerId: string; modelId: string; executionPolicyId: string;
    outputSchemaId: string; outputSchemaVersion: number; usage: unknown | null; repair: unknown;
  } | null;
  authorNote: string;
  upstreamVersions: Record<string, string>;
  neighboringDraftVersions: Record<string, string>;
  restoredFromVersionId: string | null;
  stale: boolean;
  staleReasons: Array<{
    id: string; reasonCode: string; sourceEntityKind: string; sourceEntityId: string;
    fromVersionId: string | null; toVersionId: string | null; changedFields: string[]; createdAt: string;
  }>;
  createdAt: string;
}

export interface PassageDraftState {
  passagePlanVersionId: string;
  passagePlan: { id: string; title: string; wordTarget: number };
  head: {
    current: PassageDraftVersion;
    accepted: PassageDraftVersion | null;
    acceptedLocked: boolean;
    updatedAt: string;
  } | null;
  history: PassageDraftVersion[];
  summary: DraftCorpusSummary;
}

export interface DraftCorpusSummary {
  passageCount: number;
  currentDraftCount: number;
  acceptedDraftCount: number;
  currentCandidateWords: number;
  acceptedWords: number;
  plannedWords: number;
  remainingWords: number;
}

export interface DraftingUnit {
  id: string;
  position: number;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  contextDiagnostics: {
    status: "built" | "not-built";
    contextSchema?: { id: string; version: number };
    includedRecords?: Record<string, { ids: string[]; versionIds?: string[] }>;
    omittedOptionalContext?: Record<string, string[]>;
    staleNeighborDraftsExcluded?: Array<{ passageId: string; draftVersionId: string }>;
    requestedMaximumOutputTokens?: number;
    serializedBytes?: number;
    contextFingerprint?: string;
    note?: string;
  };
}

export interface DraftingPlanPreview {
  fingerprint: string;
  snapshotId: string;
  upstreamVersions: Record<string, string>;
  scope: { kind: "passages"; passageIds: string[] };
  providerId: string;
  modelId: string;
  units: DraftingUnit[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  policy: {
    id: string; maxPassagesPerUnit: number; maxUnitsPerPlan: number;
    maxEstimatedInputTokensPerUnit: number; maxOutputTokensPerPassage: number;
    maxOutputTokensPerUnit: number; maxAttemptsPerUnit: number; maxSerializedCandidateBytes: number;
  };
}

export interface DraftingPlan extends Omit<DraftingPlanPreview, "policy"> {
  id: string;
  executionPolicyId: string;
  executionPolicy: DraftingPlanPreview["policy"];
  authorizationState: "planned" | "authorized";
  authorizationFingerprint: string | null;
  createdAt: string;
  jobId: string;
  jobStatus: "planned" | "authorized" | "running" | "completed" | "partially_failed" | "failed" | "cancelled";
}

export interface DraftingJobUnit extends DraftingUnit {
  projectId: string;
  planId: string;
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  attemptNumber: number;
  normalizedError: { code?: string; message?: string; validationIssues?: string[] } | null;
  usage: { inputTokens?: number; outputTokens?: number; cost?: number | null } | null;
  generatedCandidates: Array<{ draftVersionId: string; passageId: string; wordCount: number }>;
}

export interface DraftingJob {
  id: string;
  projectId: string;
  planId: string;
  status: DraftingPlan["jobStatus"];
  units: DraftingJobUnit[];
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const draftRoot = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/drafts`;
const draftingRoot = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/drafting`;
const passageUrl = (projectId: string, passageId: string) =>
  `${draftRoot(projectId)}/passages/${encodeURIComponent(passageId)}`;

export const loadPassageDraft = async (projectId: string, passageId: string): Promise<PassageDraftState> =>
  json(await fetch(passageUrl(projectId, passageId)));
export const saveManualPassageDraft = async (
  projectId: string, passageId: string, proseMarkdown: string, authorNote: string,
) => json<{ draft: PassageDraftVersion; state: PassageDraftState }>(await fetch(passageUrl(projectId, passageId), {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ proseMarkdown, authorNote }),
}));
export const restorePassageDraft = async (projectId: string, passageId: string, versionId: string) =>
  json<{ draft: PassageDraftVersion; state: PassageDraftState }>(await fetch(`${passageUrl(projectId, passageId)}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));

const draftingRequest = (passageIds: string[]) => ({
  scope: { kind: "passages" as const, passageIds },
  providerId: "offline-drafting",
  modelId: "deterministic-prose-v1",
});
export const previewDraftingPlan = async (projectId: string, passageIds: string[]) =>
  json<DraftingPlanPreview>(await fetch(`${draftingRoot(projectId)}/plans/preview`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftingRequest(passageIds)),
  }));
export const createDraftingPlan = async (projectId: string, passageIds: string[]) =>
  json<DraftingPlan>(await fetch(`${draftingRoot(projectId)}/plans`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftingRequest(passageIds)),
  }));
export const listDraftingPlans = async (projectId: string) =>
  json<DraftingPlan[]>(await fetch(`${draftingRoot(projectId)}/plans`));
export const authorizeDraftingPlan = async (projectId: string, planId: string, fingerprint: string) =>
  json<DraftingPlan>(await fetch(`${draftingRoot(projectId)}/plans/${encodeURIComponent(planId)}/authorize`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprint }),
  }));
export const loadDraftingJob = async (projectId: string, jobId: string) =>
  json<DraftingJob>(await fetch(`${draftingRoot(projectId)}/jobs/${encodeURIComponent(jobId)}`));
export const startDraftingJob = async (projectId: string, jobId: string) =>
  json<DraftingJob>(await fetch(`${draftingRoot(projectId)}/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST" }));
export const cancelDraftingJob = async (projectId: string, jobId: string) =>
  json<DraftingJob>(await fetch(`${draftingRoot(projectId)}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }));
export const retryDraftingUnit = async (projectId: string, jobId: string, unitId: string) =>
  json<DraftingJob>(await fetch(`${draftingRoot(projectId)}/jobs/${encodeURIComponent(jobId)}/units/${encodeURIComponent(unitId)}/retry`, { method: "POST" }));
