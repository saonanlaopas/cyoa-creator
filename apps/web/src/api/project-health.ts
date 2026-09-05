export interface ProjectUsageGroup {
  workflow: string;
  providerId: string | null;
  modelId: string | null;
  attemptStatuses: Record<string, number>;
  attemptCount: number;
  providerRequestCount: number | null;
  providerRequestCountStatus: "known" | "partial" | "unknown";
  unknownProviderRequestAttemptCount: number;
  tokenKnownRequestCount: number;
  legacyUnknownRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: { status: "recorded" | "partial" | "unknown"; recorded: number | null; recordedRequestCount: number; unknownRequestCount: number };
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

export interface ProjectHealth {
  schemaId: "cyoa.project-health";
  schemaVersion: 1;
  project: { id: string; mode: "quick" | "long-form"; schemaVersion: number };
  scale: Record<string, number>;
  validation: {
    passagePlanStatus: string | null;
    approvedSnapshotId: string | null;
    freshness: "current" | "historical-approved" | "not-evaluated" | "invalid";
    blockers: number | null;
    warnings: number | null;
  };
  evidence: { latest: Array<{ kind: string; versionId: string; createdAt: string; status: string | null; fingerprint: string | null }>; freshness: "historical-evidence" };
  repair: { latest: Array<{ kind: string; versionId: string; createdAt: string; status: string | null; fingerprint: string | null }> };
  publication: { currentReadiness: "not-evaluated"; nativeBuildCount: number; latestBuildAt: string | null };
  recovery: { latestVerifiedBackupAt: string | null; latestVerifiedBackupId: string | null; currentFreshness: "not-evaluated"; restoreCount: number };
  storage: {
    database: { status: "in-memory" | "available" | "unavailable"; sqliteBytes: number | null; walBytes: number | null; measurement: string };
    immutableHistory: Record<string, number>;
    policy: "diagnostic-only-no-automatic-cleanup";
  };
  usage: Omit<ProjectUsageGroup, "workflow" | "providerId" | "modelId">;
  budgets: Record<string, number>;
}

export interface ProjectUsageReport {
  schemaId: "cyoa.project-usage";
  schemaVersion: 1;
  projectId: string;
  authority: { excludes: string[] };
  totals: ProjectHealth["usage"];
  groups: ProjectUsageGroup[];
  groupsTruncated: boolean;
  filters: ProjectUsageFilters;
  available: { workflows: string[]; providers: string[]; models: string[] };
}

export interface ProjectUsageFilters { workflow?: string; providerId?: string; modelId?: string; from?: string; to?: string }
export type ResumeAttentionJobStatus = "planned" | "authorized" | "running" | "partially_failed" | "failed";
export type ResumeJobFacts = Record<ResumeAttentionJobStatus, {
  count: number; latestJobId: string | null; latestPassageId: string | null;
}>;
export interface ProjectResumeReport {
  schemaId: "cyoa.project-resume"; schemaVersion: 1; projectId: string;
  authority: "persisted-facts-only"; generatedAt: string;
  facts: {
    proposedChangeSets: number; pendingDraftCandidates: number; acceptedAwaitingReview: number;
    staleCurrentDrafts: number; stalePassagePlan: number; latestPendingPassageId: string | null;
    generationJobs: ResumeJobFacts; draftingJobs: ResumeJobFacts;
  };
  backup: { latestVerifiedAt: string | null; latestVerifiedBackupId: string | null; freshness: "not-evaluated" };
  actions: Array<{ id: string; stage: "passage-plan" | "repair" | "publication" | "recovery" | "health";
    label: string; count: number; stableId: string | null; jobKind: "generation" | "drafting" | null;
    jobId: string | null; jobStatus: string | null }>;
  truncated: false;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Project health request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/health`;

export const loadProjectHealth = async (projectId: string) => json<ProjectHealth>(await fetch(root(projectId)));
export const loadProjectUsage = async (projectId: string, filters: ProjectUsageFilters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return json<ProjectUsageReport>(await fetch(`${root(projectId)}/usage?${query}`));
};
export const loadProjectResume = async (projectId: string) => json<ProjectResumeReport>(await fetch(`${root(projectId)}/resume`));
