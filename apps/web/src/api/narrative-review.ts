export interface NarrativeReviewFinding {
  id: string; fingerprint: string; category: string; severity: "info" | "warning" | "error";
  confidence: string; message: string; reviewNote: string;
  passageIds: string[]; choiceIds: string[]; routeIds: string[]; endingIds: string[];
  mechanicKeys: string[]; threadIds: string[]; acceptedDraftVersionIds: string[];
  evidenceReferences: Array<Record<string, string>>;
  reviewPlanId: string; jobId: string; unitId: string; attemptId: string;
  reviewInputFingerprint: string; contextFingerprint: string;
}
export interface NarrativeReviewUnit {
  id: string; position: number; passageIds: string[]; status: string;
  inputFingerprint: string; contextFingerprint: string; estimatedInputTokens: number; maximumOutputTokens: number;
  diagnostics: {
    included: Record<string, string[]>; omitted: Record<string, string[]>;
    retention: Array<{ campaignVersionId: string; status: "known" | "legacy-unknown"; truncated: boolean | null; omitted: number | null }>;
  };
  attempts: Array<{ id: string; number: number; status: string; error: { code: string; message: string; retryable: boolean } | null; repair: { performed: number } }>;
  findings: NarrativeReviewFinding[];
}
export interface NarrativeReviewAggregate {
  schemaVersion: 1; projectId: string;
  reviewInput: { fingerprint: string; simulationInputVersionId: string; campaignVersionIds: string[]; simulationRunVersionIds: string[] };
  plan: {
    id: string; fingerprint: string; status: "planned" | "authorized"; authorizedFingerprint: string | null;
    providerId: string; modelId: string; categories: string[]; scopePassageIds: string[];
    estimatedInputTokens: number; policy: { id: string; maxPassagesPerUnit: number; maxInputTokensPerUnit: number; maxOutputTokensPerUnit: number };
  };
  job: { id: string; status: string; units: NarrativeReviewUnit[]; createdAt: string; startedAt: string | null; finishedAt: string | null };
  currentState?: { status: "current" | "historical"; reason: string | null };
}
export interface NarrativeReviewPreview {
  reviewInput: NarrativeReviewAggregate["reviewInput"];
  plan: Omit<NarrativeReviewAggregate["plan"], "id" | "status" | "authorizedFingerprint"> & { units: NarrativeReviewUnit[] };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}
const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/narrative-review`;
export const previewNarrativeReview = async (projectId: string, body: unknown) => json<NarrativeReviewPreview>(await fetch(`${root(projectId)}/plans/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
export const createNarrativeReview = async (projectId: string, body: unknown) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
export const listNarrativeReviews = async (projectId: string) => json<{ items: NarrativeReviewAggregate[] }>(await fetch(`${root(projectId)}/plans`));
export const loadNarrativeReview = async (projectId: string, planId: string) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}`));
export const authorizeNarrativeReview = async (projectId: string, planId: string, fingerprint: string) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}/authorize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprint }) }));
export const startNarrativeReview = async (projectId: string, planId: string) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}/start`, { method: "POST" }));
export const cancelNarrativeReview = async (projectId: string, planId: string) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}/cancel`, { method: "POST" }));
export const retryNarrativeReviewUnit = async (projectId: string, planId: string, unitId: string) => json<NarrativeReviewAggregate>(await fetch(`${root(projectId)}/plans/${encodeURIComponent(planId)}/units/${encodeURIComponent(unitId)}/retry`, { method: "POST" }));
