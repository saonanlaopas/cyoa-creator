import type { FoundationArtifactId, FoundationBootstrapCandidate, FoundationBootstrapContext, FoundationFieldProvenance } from "@story-to-cyoa/domain";
export type { FoundationArtifactId } from "@story-to-cyoa/domain";
export interface BootstrapPlan {
  id: string; fingerprint: string; contextFingerprint: string; contextBytes: number; estimatedInputTokens: number;
  cost: number | null; providerId: string; modelId: string;
  context: Pick<FoundationBootstrapContext, "dossierVersionId" | "intentVersionId" | "baseVersionIds" | "request">;
  units: Array<{ id: string; artifactIds: FoundationArtifactId[] }>;
}
export interface BootstrapJob {
  id: string; projectId: string; planId: string; status: string; authorizedFingerprint: string;
  createdAt: string; updatedAt: string;
  units: Array<{ id: string; artifactIds: FoundationArtifactId[]; status: string;
    attempts: Array<{ id: string; number: number; status: string; diagnostic: string | null; startedAt: string; finishedAt: string | null; contextFingerprint: string }> }>;
}
export interface BootstrapState {
  providers: Array<{ id: string; label: string; models: string[] }>;
  availability: { allowed: boolean; reason: string | null }; plans: BootstrapPlan[]; jobs: BootstrapJob[];
}
export interface BootstrapReview {
  jobId: string; currentState: { status: "fresh" | "stale"; reasons: string[] };
  candidates: Array<{ artifactId: FoundationArtifactId; content: unknown; baseVersionId: string | null;
    provenance: FoundationFieldProvenance[]; fieldDiffs: Array<{ path: string; before: unknown; after: unknown }> }>;
  groups: Array<{ id: string; label: string; artifactIds: FoundationArtifactId[]; dependsOnGroupIds: string[] }>;
  validation: { errors: string[]; warnings: string[] }; canonAssessment: FoundationBootstrapCandidate["canonAssessment"];
  applications: Array<{ id: string; artifactVersionIds: Record<string, string>; createdAt: string }>;
}
export interface BootstrapApplyPreview {
  effectiveArtifactIds: FoundationArtifactId[]; requiredDependencies: FoundationArtifactId[];
  previewFingerprint: string; wouldStale: string[];
}
export class FoundationBootstrapApi {
  readonly root: string;
  constructor(projectId: string) { this.root = `/api/long-form/projects/${encodeURIComponent(projectId)}/foundation-bootstrap`; }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.root + path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) { const value = await response.json() as { error: string; code: string }; throw Object.assign(new Error(value.error), { code: value.code }); }
    return response.json() as Promise<T>;
  }
  state() { return this.request<BootstrapState>(""); }
  preview(input: { message: string; providerId: string; modelId: string }) { return this.request<BootstrapPlan>("/preview", input); }
  start(plan: BootstrapPlan) { return this.request<BootstrapJob>("/start", { planId: plan.id, fingerprint: plan.fingerprint }); }
  job(id: string) { return this.request<BootstrapJob>(`/jobs/${encodeURIComponent(id)}`); }
  cancel(id: string) { return this.request<BootstrapJob>(`/jobs/${encodeURIComponent(id)}/cancel`, {}); }
  retry(id: string) { return this.request<BootstrapJob>(`/jobs/${encodeURIComponent(id)}/retry`, {}); }
  review(id: string) { return this.request<BootstrapReview>(`/jobs/${encodeURIComponent(id)}/review`); }
  previewApply(id: string, artifactIds: FoundationArtifactId[]) { return this.request<BootstrapApplyPreview>(`/jobs/${encodeURIComponent(id)}/preview-apply`, { artifactIds }); }
  apply(id: string, artifactIds: FoundationArtifactId[], fingerprint: string) { return this.request<BootstrapReview["applications"][number]>(`/jobs/${encodeURIComponent(id)}/apply`, { artifactIds, fingerprint }); }
}
