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
