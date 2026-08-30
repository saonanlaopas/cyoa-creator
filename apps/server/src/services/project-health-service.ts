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

export interface ProjectUsageGroup {
  workflow: string;
  providerId: string | null;
  modelId: string | null;
  statuses: Record<string, number>;
  requestCount: number;
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
}

export interface ProjectHealth {
  schemaId: typeof PROJECT_HEALTH_SCHEMA_ID;
  schemaVersion: typeof PROJECT_HEALTH_SCHEMA_VERSION;
  project: { id: string; mode: "quick" | "long-form"; schemaVersion: number };
  scale: ReturnType<ProjectHealthRepository["counts"]>;
  validation: { passagePlanStatus: string | null; approvedSnapshotId: string | null; blockers: number; warnings: number };
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

  usage(projectId: string): ProjectUsageReport {
    this.requireProject(projectId);
    const grouped = new Map<string, ProjectUsageGroup>();
    for (const row of this.facts.usage(projectId)) {
      const key = [row.workflow, row.providerId ?? "unknown", row.modelId ?? "unknown"].join("\u0000");
      const group = grouped.get(key) ?? {
        workflow: row.workflow,
        providerId: row.providerId,
        modelId: row.modelId,
        statuses: {}, requestCount: 0, tokenKnownRequestCount: 0, legacyUnknownRequestCount: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cost: { status: "recorded", recorded: 0, recordedRequestCount: 0, unknownRequestCount: 0 },
        firstRecordedAt: null, lastRecordedAt: null,
      };
      group.statuses[row.status ?? "unknown"] = (group.statuses[row.status ?? "unknown"] ?? 0) + row.requestCount;
      group.requestCount += row.requestCount;
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
    const all = [...grouped.values()].map(finalizeUsage).sort((left, right) =>
      (right.lastRecordedAt ?? "").localeCompare(left.lastRecordedAt ?? ""),
    );
    const totals = finalizeUsage(all.reduce<ProjectUsageGroup>((total, group) => ({
      workflow: "all", providerId: null, modelId: null,
      statuses: mergeStatuses(total.statuses, group.statuses),
      requestCount: total.requestCount + group.requestCount,
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
      workflow: "all", providerId: null, modelId: null, statuses: {}, requestCount: 0, tokenKnownRequestCount: 0,
      legacyUnknownRequestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
      cost: { status: "recorded", recorded: 0, recordedRequestCount: 0, unknownRequestCount: 0 }, firstRecordedAt: null, lastRecordedAt: null,
    }));
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
    };
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
