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
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Project health request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/health`;

export const loadProjectHealth = async (projectId: string) => json<ProjectHealth>(await fetch(root(projectId)));
export const loadProjectUsage = async (projectId: string) => json<ProjectUsageReport>(await fetch(`${root(projectId)}/usage`));
