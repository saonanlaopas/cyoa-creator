import { statSync } from "node:fs";
import {
  CURRENT_SCHEMA_VERSION,
  PROJECT_HEALTH_BUDGETS,
  ProjectHealthRepository,
  RecoveryRepository,
  type ProjectRepository,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";

export const PROJECT_HEALTH_SCHEMA_ID = "cyoa.project-health" as const;
export const PROJECT_HEALTH_SCHEMA_VERSION = 1 as const;

type CostStatus = "recorded" | "partial" | "unknown";
type ProviderRequestCountStatus = "known" | "partial" | "unknown";

export interface ProjectUsageGroup {
  workflow: string;
  providerId: string | null;
  modelId: string | null;
  attemptStatuses: Record<string, number>;
  attemptCount: number;
  providerRequestCount: number | null;
  providerRequestCountStatus: ProviderRequestCountStatus;
  unknownProviderRequestAttemptCount: number;
  tokenKnownRequestCount: number;
  legacyUnknownRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: { status: CostStatus; recorded: number | null; recordedRequestCount: number; unknownRequestCount: number };
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

export interface ProjectUsageReport {
  schemaId: "cyoa.project-usage";
  schemaVersion: 1;
  projectId: string;
  authority: {
    relationalAttempts: ["generation_unit_attempts", "drafting_unit_attempts"];
    immutableAggregateAttempts: ["narrative-review", "repair-proposal-generation"];
    legacyRecords: "usage_records";
    excludes: ["job-unit rollups", "drafting unit rollups", "candidate mirrors"];
  };
  totals: Omit<ProjectUsageGroup, "workflow" | "providerId" | "modelId">;
  groups: ProjectUsageGroup[];
  groupsTruncated: boolean;
  filters: ProjectUsageFilters;
  available: { workflows: string[]; providers: string[]; models: string[] };
}

export interface ProjectUsageFilters {
  workflow?: string;
  providerId?: string;
  modelId?: string;
  from?: string;
  to?: string;
}

export interface ProjectResumeReport {
  schemaId: "cyoa.project-resume";
  schemaVersion: 1;
  projectId: string;
  authority: "persisted-facts-only";
  generatedAt: string;
  facts: ReturnType<ProjectHealthRepository["resume"]>;
  backup: { latestVerifiedAt: string | null; latestVerifiedBackupId: string | null; freshness: "not-evaluated" };
  actions: Array<{ id: string; stage: "passage-plan" | "repair" | "publication" | "recovery" | "health"; label: string; count: number; stableId: string | null }>;
  truncated: false;
}

export interface ProjectHealth {
  schemaId: typeof PROJECT_HEALTH_SCHEMA_ID;
  schemaVersion: typeof PROJECT_HEALTH_SCHEMA_VERSION;
  project: { id: string; mode: "quick" | "long-form"; schemaVersion: number };
  scale: ReturnType<ProjectHealthRepository["counts"]>;
  validation: {
    passagePlanStatus: string | null;
    approvedSnapshotId: string | null;
    freshness: "current" | "historical-approved" | "not-evaluated" | "invalid";
    blockers: number | null;
    warnings: number | null;
  };
  evidence: { latest: ReturnType<ProjectHealthRepository["latest"]>; freshness: "historical-evidence" };
  repair: { latest: ReturnType<ProjectHealthRepository["latestRepair"]> };
  publication: { currentReadiness: "not-evaluated"; nativeBuildCount: number; latestBuildAt: string | null };
  recovery: { latestVerifiedBackupAt: string | null; latestVerifiedBackupId: string | null; currentFreshness: "not-evaluated"; restoreCount: number };
  storage: ProjectStorageDiagnostics;
  usage: ProjectUsageReport["totals"];
  budgets: typeof PROJECT_HEALTH_BUDGETS;
}

export interface ProjectStorageDiagnostics {
  database: { status: "in-memory" | "available" | "unavailable"; sqliteBytes: number | null; walBytes: number | null; measurement: "filesystem-file-and-wal" | "not-available" };
  immutableHistory: {
    artifactVersions: number; passageEntityVersions: number; draftVersions: number;
    simulationEvidence: number; playtestEvidence: number; narrativeReviewVersions: number;
    repairHistory: number; publicationHistory: number; recoveryMetadata: number;
  };
  policy: "diagnostic-only-no-automatic-cleanup";
}

export class ProjectHealthService {
  private readonly facts: ProjectHealthRepository;
  private readonly recovery: RecoveryRepository;

  public constructor(
    database: StoryDatabase,
    private readonly projects: ProjectRepository,
    private readonly databasePath: string = ":memory:",
  ) {
    this.facts = new ProjectHealthRepository(database);
    this.recovery = new RecoveryRepository(database);
  }

  get(projectId: string): ProjectHealth {
    const project = this.requireProject(projectId);
    const scale = this.facts.counts(projectId);
    const planning = this.facts.planning(projectId);
    const latest = this.facts.latest(projectId);
    const latestRepair = this.facts.latestRepair(projectId);
    const backup = this.recovery.latestVerifiedBackup(projectId);
    const latestBuildAt = latest.find((item) => item.kind === "native-build")?.createdAt ?? null;
    const usage = this.usage(projectId);
    return {
      schemaId: PROJECT_HEALTH_SCHEMA_ID,
      schemaVersion: PROJECT_HEALTH_SCHEMA_VERSION,
      project: { id: project.id, mode: project.mode, schemaVersion: CURRENT_SCHEMA_VERSION },
      scale,
      validation: {
        passagePlanStatus: planning.status,
        approvedSnapshotId: planning.approvedSnapshotId,
        freshness: planning.validationFreshness,
        blockers: planning.blockers,
        warnings: planning.warnings,
      },
      evidence: { latest, freshness: "historical-evidence" },
      repair: { latest: latestRepair },
      // Readiness recompiles exact prose and validation. Health remains bounded
      // and links authors to Publication for that explicit, heavier check.
      publication: { currentReadiness: "not-evaluated", nativeBuildCount: scale.nativeBuilds, latestBuildAt },
      // Computing current recovery freshness exports the whole portable corpus.
      // The persisted verified record is authoritative; current freshness stays explicit.
      recovery: {
        latestVerifiedBackupAt: backup?.verifiedAt ?? null,
        latestVerifiedBackupId: backup?.backupId ?? null,
        currentFreshness: "not-evaluated",
        restoreCount: scale.restoreRecords,
      },
      storage: this.storage(scale),
      usage: usage.totals,
      budgets: PROJECT_HEALTH_BUDGETS,
    };
  }

  usage(projectId: string, filters: ProjectUsageFilters = {}): ProjectUsageReport {
    this.requireProject(projectId);
    const normalized = normalizeUsageFilters(filters);
    const allRows = this.facts.usage(projectId);
    const available = {
      workflows: unique(allRows.map((row) => row.workflow)),
      providers: unique(allRows.flatMap((row) => row.providerId ? [row.providerId] : [])),
      models: unique(allRows.flatMap((row) => row.modelId ? [row.modelId] : [])),
    };
    const grouped = new Map<string, ProjectUsageGroup>();
    for (const row of allRows.filter((row) => usageRowMatches(row, normalized))) {
      const key = [row.workflow, row.providerId ?? "unknown", row.modelId ?? "unknown"].join("\u0000");
      const group = grouped.get(key) ?? {
        workflow: row.workflow,
        providerId: row.providerId,
        modelId: row.modelId,
        attemptStatuses: {}, attemptCount: 0, providerRequestCount: 0,
        providerRequestCountStatus: "known" as const, unknownProviderRequestAttemptCount: 0,
        tokenKnownRequestCount: 0, legacyUnknownRequestCount: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cost: { status: "recorded", recorded: 0, recordedRequestCount: 0, unknownRequestCount: 0 },
        firstRecordedAt: null, lastRecordedAt: null,
      };
      group.attemptStatuses[row.status ?? "unknown"] = (group.attemptStatuses[row.status ?? "unknown"] ?? 0) + row.attemptCount;
      group.attemptCount += row.attemptCount;
      group.providerRequestCount = (group.providerRequestCount ?? 0) + row.knownProviderRequestCount;
      group.unknownProviderRequestAttemptCount += row.unknownProviderRequestAttemptCount;
      group.tokenKnownRequestCount += row.tokenKnownRequestCount;
      group.legacyUnknownRequestCount += row.legacyUnknownRequestCount;
      group.inputTokens += row.inputTokens;
      group.outputTokens += row.outputTokens;
      group.totalTokens += row.inputTokens + row.outputTokens;
      group.cost.recorded = (group.cost.recorded ?? 0) + row.recordedCost;
      group.cost.recordedRequestCount += row.recordedCostRequestCount;
      group.cost.unknownRequestCount += row.unknownCostRequestCount + row.legacyUnknownRequestCount;
      group.firstRecordedAt = earliest(group.firstRecordedAt, row.firstRecordedAt);
      group.lastRecordedAt = latest(group.lastRecordedAt, row.lastRecordedAt);
      grouped.set(key, group);
    }
    const rawGroups = [...grouped.values()];
    const totals = finalizeUsage(rawGroups.reduce<ProjectUsageGroup>((total, group) => ({
      workflow: "all", providerId: null, modelId: null,
      attemptStatuses: mergeStatuses(total.attemptStatuses, group.attemptStatuses),
      attemptCount: total.attemptCount + group.attemptCount,
      providerRequestCount: (total.providerRequestCount ?? 0) + (group.providerRequestCount ?? 0),
      providerRequestCountStatus: "known",
      unknownProviderRequestAttemptCount: total.unknownProviderRequestAttemptCount + group.unknownProviderRequestAttemptCount,
      tokenKnownRequestCount: total.tokenKnownRequestCount + group.tokenKnownRequestCount,
      legacyUnknownRequestCount: total.legacyUnknownRequestCount + group.legacyUnknownRequestCount,
      inputTokens: total.inputTokens + group.inputTokens,
      outputTokens: total.outputTokens + group.outputTokens,
      totalTokens: total.totalTokens + group.totalTokens,
      cost: {
        status: "recorded",
        recorded: (total.cost.recorded ?? 0) + (group.cost.recorded ?? 0),
        recordedRequestCount: total.cost.recordedRequestCount + group.cost.recordedRequestCount,
        unknownRequestCount: total.cost.unknownRequestCount + group.cost.unknownRequestCount,
      },
      firstRecordedAt: earliest(total.firstRecordedAt, group.firstRecordedAt),
      lastRecordedAt: latest(total.lastRecordedAt, group.lastRecordedAt),
    }), {
      workflow: "all", providerId: null, modelId: null, attemptStatuses: {}, attemptCount: 0,
      providerRequestCount: 0, providerRequestCountStatus: "known", unknownProviderRequestAttemptCount: 0,
      tokenKnownRequestCount: 0, legacyUnknownRequestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
      cost: { status: "recorded", recorded: 0, recordedRequestCount: 0, unknownRequestCount: 0 },
      firstRecordedAt: null, lastRecordedAt: null,
    }));
    const all = rawGroups.map(finalizeUsage).sort((left, right) =>
      (right.lastRecordedAt ?? "").localeCompare(left.lastRecordedAt ?? ""),
    );
    return {
      schemaId: "cyoa.project-usage", schemaVersion: 1, projectId,
      authority: {
        relationalAttempts: ["generation_unit_attempts", "drafting_unit_attempts"],
        immutableAggregateAttempts: ["narrative-review", "repair-proposal-generation"],
        legacyRecords: "usage_records",
        excludes: ["job-unit rollups", "drafting unit rollups", "candidate mirrors"],
      },
      totals,
      groups: all.slice(0, PROJECT_HEALTH_BUDGETS.maximumUsageGroups),
      groupsTruncated: all.length > PROJECT_HEALTH_BUDGETS.maximumUsageGroups,
      filters: normalized,
      available,
    };
  }

  resume(projectId: string): ProjectResumeReport {
    this.requireProject(projectId);
    const facts = this.facts.resume(projectId);
    const backup = this.recovery.latestVerifiedBackup(projectId);
    const actions: ProjectResumeReport["actions"] = [];
    const add = (id: string, stage: ProjectResumeReport["actions"][number]["stage"], label: string, count: number, stableId: string | null = null) => {
      if (count > 0) actions.push({ id, stage, label, count, stableId });
    };
    add("passage-plan-stale", "passage-plan", "Review stale passage plan", facts.stalePassagePlan);
    add("drafts-stale", "passage-plan", "Review stale draft heads", facts.staleCurrentDrafts, facts.latestPendingPassageId);
    add("draft-candidates", "passage-plan", "Review pending prose candidates", facts.pendingDraftCandidates, facts.latestPendingPassageId);
    add("accepted-review", "passage-plan", "Review accepted prose", facts.acceptedAwaitingReview, facts.latestPendingPassageId);
    add("planning-jobs", "passage-plan", "Resume or inspect passage-planning jobs", facts.runningGenerationJobs + facts.failedGenerationJobs);
    add("drafting-jobs", "passage-plan", "Resume or inspect drafting jobs", facts.runningDraftingJobs + facts.failedDraftingJobs);
    add("proposals", "repair", "Review unapplied proposals", facts.proposedChangeSets);
    if (!backup) actions.push({ id: "backup", stage: "recovery", label: "Create and verify a project backup", count: 1, stableId: null });
    return { schemaId: "cyoa.project-resume", schemaVersion: 1, projectId, authority: "persisted-facts-only",
      generatedAt: new Date().toISOString(), facts, backup: { latestVerifiedAt: backup?.verifiedAt ?? null,
        latestVerifiedBackupId: backup?.backupId ?? null, freshness: "not-evaluated" }, actions: actions.slice(0, 20), truncated: false };
  }

  storageDiagnostics(projectId: string): ProjectStorageDiagnostics {
    this.requireProject(projectId);
    return this.storage(this.facts.counts(projectId));
  }

  queryPlans(projectId: string) {
    this.requireProject(projectId);
    return this.facts.queryPlans(projectId);
  }

  private storage(scale: ReturnType<ProjectHealthRepository["counts"]>): ProjectStorageDiagnostics {
    const database = this.fileSize();
    return {
      database,
      immutableHistory: {
        artifactVersions: scale.artifactVersions,
        passageEntityVersions: scale.passageEntityVersions,
        draftVersions: scale.draftVersions,
        simulationEvidence: scale.simulationInputs + scale.simulationRuns,
        playtestEvidence: scale.playtestCampaigns,
        narrativeReviewVersions: scale.narrativeReviewVersions,
        repairHistory: scale.repairPlans + scale.repairProposalGenerations + scale.repairProposals + scale.repairApplications,
        publicationHistory: scale.nativeCompilationInputs + scale.nativeBuilds + scale.playerConfigVersions,
        recoveryMetadata: scale.verifiedBackups + scale.restoreRecords,
      },
      policy: "diagnostic-only-no-automatic-cleanup",
    };
  }

  private fileSize(): ProjectStorageDiagnostics["database"] {
    if (this.databasePath === ":memory:") {
      return { status: "in-memory", sqliteBytes: null, walBytes: null, measurement: "not-available" };
    }
    try {
      const sqliteBytes = statSync(this.databasePath).size;
      let walBytes: number | null = null;
      try { walBytes = statSync(`${this.databasePath}-wal`).size; } catch { /* WAL is optional. */ }
      return { status: "available", sqliteBytes, walBytes, measurement: "filesystem-file-and-wal" };
    } catch {
      return { status: "unavailable", sqliteBytes: null, walBytes: null, measurement: "not-available" };
    }
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }
}

function finalizeUsage(group: ProjectUsageGroup): ProjectUsageGroup {
  const knownProviderRequests = group.providerRequestCount ?? 0;
  group.providerRequestCountStatus = group.unknownProviderRequestAttemptCount === 0
    ? "known" : knownProviderRequests > 0 ? "partial" : "unknown";
  if (group.providerRequestCountStatus === "unknown") group.providerRequestCount = null;
  const unknown = group.cost.unknownRequestCount;
  group.cost.status = unknown === 0 ? "recorded" : group.cost.recordedRequestCount > 0 ? "partial" : "unknown";
  if (group.cost.status === "unknown") group.cost.recorded = null;
  return group;
}

function earliest(left: string | null, right: string | null): string | null {
  if (!left) return right; if (!right) return left; return left < right ? left : right;
}
function latest(left: string | null, right: string | null): string | null {
  if (!left) return right; if (!right) return left; return left > right ? left : right;
}
function mergeStatuses(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged = { ...left }; for (const [key, value] of Object.entries(right)) merged[key] = (merged[key] ?? 0) + value; return merged;
}

function normalizeUsageFilters(filters: ProjectUsageFilters): ProjectUsageFilters {
  const normalized: ProjectUsageFilters = {};
  for (const key of ["workflow", "providerId", "modelId"] as const) {
    const value = filters[key]?.trim(); if (value) normalized[key] = value.slice(0, 240);
  }
  for (const key of ["from", "to"] as const) {
    const value = filters[key]?.trim();
    if (value) {
      const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error(`Invalid usage ${key} date`);
      normalized[key] = date.toISOString();
    }
  }
  if (normalized.from && normalized.to && normalized.from > normalized.to) throw new Error("Usage start date must not be after end date");
  return normalized;
}
function usageRowMatches(row: ReturnType<ProjectHealthRepository["usage"]>[number], filters: ProjectUsageFilters): boolean {
  if (filters.workflow && row.workflow !== filters.workflow) return false;
  if (filters.providerId && row.providerId !== filters.providerId) return false;
  if (filters.modelId && row.modelId !== filters.modelId) return false;
  if (filters.from && (!row.lastRecordedAt || row.lastRecordedAt < filters.from)) return false;
  if (filters.to && (!row.firstRecordedAt || row.firstRecordedAt > filters.to)) return false;
  return true;
}
function unique(values: string[]): string[] { return [...new Set(values)].sort().slice(0, 100); }
