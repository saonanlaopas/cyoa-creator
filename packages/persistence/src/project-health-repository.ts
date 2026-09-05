import type { StoryDatabase } from "./database.js";

/**
 * Structural, rather than time-based, limits for the compact Foundation 8B
 * operational views. Heavy immutable records remain detail-only APIs.
 */
export const PROJECT_HEALTH_BUDGETS = Object.freeze({
  maximumHistoryMetadataItems: 100,
  maximumHealthResponseBytes: 96_000,
  maximumUsageGroups: 100,
  maximumHealthQueryStatements: 8,
});

export interface ProjectHealthCounts {
  passages: number;
  choices: number;
  threads: number;
  passageEntityVersions: number;
  artifactVersions: number;
  draftVersions: number;
  currentDrafts: number;
  acceptedDrafts: number;
  staleCurrentDrafts: number;
  staleAcceptedDrafts: number;
  acceptedWords: number;
  simulationInputs: number;
  simulationRuns: number;
  playtestCampaigns: number;
  narrativeReviewVersions: number;
  repairPlans: number;
  repairProposalGenerations: number;
  repairProposals: number;
  repairApplications: number;
  nativeCompilationInputs: number;
  nativeBuilds: number;
  playerConfigVersions: number;
  verifiedBackups: number;
  restoreRecords: number;
  generationJobs: number;
  draftingJobs: number;
}

export interface ProjectHealthLatestRecord {
  kind: string;
  versionId: string;
  createdAt: string;
  status: string | null;
  fingerprint: string | null;
}

export interface ProjectUsageAggregateRow {
  workflow: string;
  providerId: string | null;
  modelId: string | null;
  status: string | null;
  attemptCount: number;
  knownProviderRequestCount: number;
  unknownProviderRequestAttemptCount: number;
  tokenKnownRequestCount: number;
  legacyUnknownRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  recordedCostRequestCount: number;
  unknownCostRequestCount: number;
  recordedCost: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

export const RESUME_ATTENTION_JOB_STATUSES = ["planned", "authorized", "running", "partially_failed", "failed"] as const;
export type ResumeAttentionJobStatus = typeof RESUME_ATTENTION_JOB_STATUSES[number];
export interface ResumeJobStateFact {
  count: number;
  latestJobId: string | null;
  latestPassageId: string | null;
}
export type ResumeJobFacts = Record<ResumeAttentionJobStatus, ResumeJobStateFact>;

export interface ProjectResumeFacts {
  generationJobs: ResumeJobFacts;
  draftingJobs: ResumeJobFacts;
  proposedChangeSets: number;
  pendingDraftCandidates: number;
  acceptedAwaitingReview: number;
  staleCurrentDrafts: number;
  stalePassagePlan: number;
  latestPendingPassageId: string | null;
}

/**
 * Read-only aggregate queries for the project health surface. It deliberately
 * does not deserialize prose, contexts, traces, candidates, or artifact
 * bodies into application memory.
 */
export class ProjectHealthRepository {
  public constructor(private readonly database: StoryDatabase) {}

  counts(projectId: string): ProjectHealthCounts {
    return this.database.prepare(`SELECT
      (SELECT COUNT(*) FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'passage' AND tombstoned = 0) AS passages,
      (SELECT COUNT(*) FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'choice' AND tombstoned = 0) AS choices,
      (SELECT COUNT(*) FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'thread' AND tombstoned = 0) AS threads,
      (SELECT COUNT(*) FROM passage_entity_versions WHERE project_id = ?) AS passageEntityVersions,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ?) AS artifactVersions,
      (SELECT COUNT(*) FROM passage_draft_versions WHERE project_id = ?) AS draftVersions,
      (SELECT COUNT(*) FROM passage_draft_heads WHERE project_id = ?) AS currentDrafts,
      (SELECT COUNT(*) FROM passage_draft_heads WHERE project_id = ? AND accepted_version_id IS NOT NULL) AS acceptedDrafts,
      (SELECT COUNT(DISTINCT heads.current_version_id) FROM passage_draft_heads heads JOIN passage_draft_staleness_events stale
        ON stale.project_id = heads.project_id AND stale.draft_version_id = heads.current_version_id WHERE heads.project_id = ?) AS staleCurrentDrafts,
      (SELECT COUNT(DISTINCT heads.accepted_version_id) FROM passage_draft_heads heads JOIN passage_draft_staleness_events stale
        ON stale.project_id = heads.project_id AND stale.draft_version_id = heads.accepted_version_id WHERE heads.project_id = ?) AS staleAcceptedDrafts,
      (SELECT COALESCE(SUM(versions.word_count), 0) FROM passage_draft_heads heads JOIN passage_draft_versions versions
        ON versions.project_id = heads.project_id AND versions.id = heads.accepted_version_id WHERE heads.project_id = ?) AS acceptedWords,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'simulation-inputs') AS simulationInputs,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'simulation-runs') AS simulationRuns,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'playtest-campaigns') AS playtestCampaigns,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_type = 'narrative-review') AS narrativeReviewVersions,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_type = 'repair-plan') AS repairPlans,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_type = 'repair-proposal-generation') AS repairProposalGenerations,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_type = 'repair-proposal') AS repairProposals,
      (SELECT COUNT(*) FROM repair_applications WHERE project_id = ?) AS repairApplications,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'native-compilation-inputs') AS nativeCompilationInputs,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'native-builds') AS nativeBuilds,
      (SELECT COUNT(*) FROM artifact_versions WHERE project_id = ? AND artifact_id = 'native-player-config') AS playerConfigVersions,
      (SELECT COUNT(*) FROM project_backup_records WHERE project_id = ?) AS verifiedBackups,
      (SELECT COUNT(*) FROM project_restore_records WHERE project_id = ?) AS restoreRecords,
      (SELECT COUNT(*) FROM generation_jobs WHERE project_id = ?) AS generationJobs,
      (SELECT COUNT(*) FROM drafting_jobs WHERE project_id = ?) AS draftingJobs`)
      .get(...Array.from({ length: 26 }, () => projectId)) as unknown as ProjectHealthCounts;
  }

  planning(projectId: string): {
    status: string | null;
    approvedSnapshotId: string | null;
    validationFreshness: "current" | "historical-approved" | "not-evaluated" | "invalid";
    blockers: number | null;
    warnings: number | null;
  } {
    const state = this.database.prepare(`SELECT state.status, state.approved_snapshot_id,
        snapshots.status AS snapshot_status, snapshots.validation_json
      FROM passage_plan_state state
      LEFT JOIN passage_plan_snapshots snapshots
        ON snapshots.project_id = state.project_id AND snapshots.id = state.approved_snapshot_id
      WHERE state.project_id = ?`).get(projectId) as {
        status: string; approved_snapshot_id: string | null; snapshot_status: string | null; validation_json: string | null;
      } | undefined;
    if (!state) return {
      status: null, approvedSnapshotId: null, validationFreshness: "not-evaluated", blockers: null, warnings: null,
    };
    if (!state.approved_snapshot_id) return {
      status: state.status, approvedSnapshotId: null,
      validationFreshness: state.status === "approved" ? "invalid" : "not-evaluated",
      blockers: null, warnings: null,
    };
    if (state.snapshot_status !== "approved" || state.validation_json === null) return {
      status: state.status, approvedSnapshotId: state.approved_snapshot_id,
      validationFreshness: "invalid", blockers: null, warnings: null,
    };
    try {
      const findings = JSON.parse(state.validation_json).findings;
      if (!Array.isArray(findings)) throw new Error("invalid findings");
      return {
        status: state.status,
        approvedSnapshotId: state.approved_snapshot_id,
        validationFreshness: state.status === "approved" ? "current" : "historical-approved",
        blockers: findings.filter((item) => item?.severity === "error").length,
        warnings: findings.filter((item) => item?.severity === "warning").length,
      };
    } catch {
      return {
        status: state.status, approvedSnapshotId: state.approved_snapshot_id,
        validationFreshness: "invalid", blockers: null, warnings: null,
      };
    }
  }

  resume(projectId: string): ProjectResumeFacts {
    const facts = this.database.prepare(`SELECT
      (SELECT COUNT(*) FROM change_sets WHERE project_id = ? AND status = 'proposed') AS proposedChangeSets,
      (SELECT COUNT(*) FROM passage_draft_heads heads JOIN passage_draft_versions versions
        ON versions.project_id = heads.project_id AND versions.id = heads.current_version_id
        WHERE heads.project_id = ? AND versions.lifecycle_status = 'candidate') AS pendingDraftCandidates,
      (SELECT COUNT(*) FROM passage_draft_heads heads JOIN passage_draft_versions versions
        ON versions.project_id = heads.project_id AND versions.id = heads.accepted_version_id
        WHERE heads.project_id = ? AND versions.lifecycle_status = 'accepted') AS acceptedAwaitingReview,
      (SELECT COUNT(DISTINCT heads.current_version_id) FROM passage_draft_heads heads JOIN passage_draft_staleness_events stale
        ON stale.project_id = heads.project_id AND stale.draft_version_id = heads.current_version_id WHERE heads.project_id = ?) AS staleCurrentDrafts,
      (SELECT COUNT(*) FROM passage_plan_state WHERE project_id = ? AND status = 'stale') AS stalePassagePlan,
      (SELECT heads.passage_id FROM passage_draft_heads heads JOIN passage_draft_versions versions
        ON versions.project_id = heads.project_id AND versions.id = heads.current_version_id
        WHERE heads.project_id = ? AND versions.lifecycle_status = 'candidate'
        ORDER BY versions.created_at DESC, heads.passage_id LIMIT 1) AS latestPendingPassageId`)
      .get(...Array.from({ length: 6 }, () => projectId)) as unknown as Omit<ProjectResumeFacts, "generationJobs" | "draftingJobs">;
    return { ...facts, generationJobs: this.resumeGenerationJobs(projectId), draftingJobs: this.resumeDraftingJobs(projectId) };
  }

  private resumeGenerationJobs(projectId: string): ResumeJobFacts {
    const rows = this.database.prepare(`WITH ranked AS (
      SELECT id, plan_id, status, COUNT(*) OVER (PARTITION BY status) AS status_count,
        ROW_NUMBER() OVER (PARTITION BY status ORDER BY updated_at DESC, id DESC) AS recency
      FROM generation_jobs WHERE project_id = ?
        AND status IN ('planned', 'authorized', 'running', 'partially_failed', 'failed')
    ) SELECT ranked.status, ranked.status_count, ranked.id,
      (SELECT json_extract(units.passage_ids_json, '$[0]') FROM generation_plan_units units
        WHERE units.plan_id = ranked.plan_id ORDER BY units.position LIMIT 1) AS passage_id
      FROM ranked WHERE ranked.recency = 1`).all(projectId) as Array<{
        status: ResumeAttentionJobStatus; status_count: number; id: string; passage_id: string | null;
      }>;
    return mapResumeJobFacts(rows);
  }

  private resumeDraftingJobs(projectId: string): ResumeJobFacts {
    const rows = this.database.prepare(`WITH ranked AS (
      SELECT id, plan_id, status, COUNT(*) OVER (PARTITION BY status) AS status_count,
        ROW_NUMBER() OVER (PARTITION BY status ORDER BY updated_at DESC, id DESC) AS recency
      FROM drafting_jobs WHERE project_id = ?
        AND status IN ('planned', 'authorized', 'running', 'partially_failed', 'failed')
    ) SELECT ranked.status, ranked.status_count, ranked.id,
      (SELECT passages.passage_id FROM drafting_plan_unit_passages passages
        JOIN drafting_plan_units units ON units.plan_id = passages.plan_id AND units.unit_id = passages.unit_id
        WHERE passages.plan_id = ranked.plan_id ORDER BY units.position, passages.position LIMIT 1) AS passage_id
      FROM ranked WHERE ranked.recency = 1`).all(projectId) as Array<{
        status: ResumeAttentionJobStatus; status_count: number; id: string; passage_id: string | null;
      }>;
    return mapResumeJobFacts(rows);
  }

  latest(projectId: string): ProjectHealthLatestRecord[] {
    const rows = this.database.prepare(`WITH candidates AS (
      SELECT versions.artifact_id, versions.artifact_type, versions.id, versions.version, versions.created_at,
        CASE
          WHEN versions.artifact_id = 'simulation-runs' THEN 'simulation'
          WHEN versions.artifact_id = 'playtest-campaigns' THEN 'playtest'
          WHEN versions.artifact_id = 'native-builds' THEN 'native-build'
          WHEN versions.artifact_type = 'narrative-review' THEN 'narrative-review'
        END AS kind,
        CASE
          WHEN versions.artifact_id = 'simulation-runs' THEN COALESCE(
            json_extract(versions.content_json, '$.status'), json_extract(versions.content_json, '$.trace.result.kind'))
          WHEN versions.artifact_id = 'playtest-campaigns' THEN json_extract(versions.content_json, '$.status')
          WHEN versions.artifact_id = 'native-builds' THEN CASE
            WHEN json_extract(versions.content_json, '$.validation.valid') = 1 THEN 'valid'
            WHEN json_extract(versions.content_json, '$.validation.valid') = 0 THEN 'invalid'
          END
          WHEN versions.artifact_type = 'narrative-review' THEN json_extract(versions.content_json, '$.job.status')
        END AS status,
        CASE
          WHEN versions.artifact_id = 'simulation-runs' THEN COALESCE(
            json_extract(versions.content_json, '$.fingerprint'), json_extract(versions.content_json, '$.trace.fingerprint'))
          WHEN versions.artifact_id = 'playtest-campaigns' THEN json_extract(versions.content_json, '$.fingerprint')
          WHEN versions.artifact_id = 'native-builds' THEN json_extract(versions.content_json, '$.bundleFingerprint')
          WHEN versions.artifact_type = 'narrative-review' THEN COALESCE(
            json_extract(versions.content_json, '$.fingerprint'), json_extract(versions.content_json, '$.plan.fingerprint'))
        END AS fingerprint
      FROM artifact_versions versions
      WHERE versions.project_id = ? AND (
        versions.artifact_id IN ('simulation-runs', 'playtest-campaigns', 'native-builds')
        OR versions.artifact_type = 'narrative-review'
      )
    ), ranked AS (
      SELECT candidates.*, ROW_NUMBER() OVER (
        PARTITION BY kind ORDER BY created_at DESC, version DESC, id DESC
      ) AS rank
      FROM candidates WHERE kind IS NOT NULL
    ) SELECT kind, id, created_at, status, fingerprint
      FROM ranked WHERE rank = 1 ORDER BY created_at DESC, kind
      LIMIT ?`).all(projectId, PROJECT_HEALTH_BUDGETS.maximumHistoryMetadataItems) as Array<{
        kind: string; id: string; created_at: string; status: string | null; fingerprint: string | null;
      }>;
    return rows.map((row) => ({
      kind: row.kind, versionId: row.id, createdAt: row.created_at,
      status: row.status, fingerprint: row.fingerprint,
    }));
  }

  latestRepair(projectId: string): ProjectHealthLatestRecord[] {
    const rows = this.database.prepare(`WITH latest AS (
      SELECT artifact_id, MAX(version) AS version FROM artifact_versions
      WHERE project_id = ? AND artifact_type IN ('repair-plan', 'repair-proposal-generation', 'repair-proposal')
      GROUP BY artifact_id
    ) SELECT versions.artifact_type, versions.id, versions.created_at,
        json_extract(versions.content_json, '$.job.status') AS job_status,
        json_extract(versions.content_json, '$.generation.fingerprint') AS generation_fingerprint,
        json_extract(versions.content_json, '$.definitionFingerprint') AS definition_fingerprint
      FROM artifact_versions versions JOIN latest
        ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
      WHERE versions.project_id = ? ORDER BY versions.created_at DESC LIMIT ?`)
      .all(projectId, projectId, PROJECT_HEALTH_BUDGETS.maximumHistoryMetadataItems) as Array<{
        artifact_type: string; id: string; created_at: string; job_status: string | null;
        generation_fingerprint: string | null; definition_fingerprint: string | null;
      }>;
    return rows.map((row) => ({
      kind: row.artifact_type, versionId: row.id, createdAt: row.created_at,
      status: row.job_status, fingerprint: row.generation_fingerprint ?? row.definition_fingerprint,
    }));
  }

  usage(projectId: string): ProjectUsageAggregateRow[] {
    const relational = this.database.prepare(`SELECT workflow, provider_id, model_id, status,
        COUNT(*) AS attempt_count,
        COALESCE(SUM(CASE WHEN json_type(repair_json, '$.repairsPerformed') = 'integer'
          THEN 1 + CAST(json_extract(repair_json, '$.repairsPerformed') AS INTEGER) ELSE 0 END), 0) AS known_provider_request_count,
        SUM(CASE WHEN json_type(repair_json, '$.repairsPerformed') = 'integer' THEN 0 ELSE 1 END)
          AS unknown_provider_request_attempt_count,
        SUM(CASE WHEN usage_json IS NOT NULL THEN 1 ELSE 0 END) AS token_known_request_count,
        SUM(CASE WHEN usage_json IS NULL AND status IN ('completed', 'failed', 'cancelled') THEN 1 ELSE 0 END) AS legacy_unknown_request_count,
        COALESCE(SUM(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER)), 0) AS input_tokens,
        COALESCE(SUM(CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER)), 0) AS output_tokens,
        SUM(CASE WHEN json_type(usage_json, '$.cost') IN ('integer', 'real') THEN 1 ELSE 0 END) AS recorded_cost_request_count,
        SUM(CASE WHEN usage_json IS NOT NULL AND json_type(usage_json, '$.cost') IS NULL THEN 1 ELSE 0 END) AS unknown_cost_request_count,
        COALESCE(SUM(CASE WHEN json_type(usage_json, '$.cost') IN ('integer', 'real') THEN CAST(json_extract(usage_json, '$.cost') AS REAL) ELSE 0 END), 0) AS recorded_cost,
        MIN(created_at) AS first_recorded_at, MAX(COALESCE(finished_at, updated_at, created_at)) AS last_recorded_at
      FROM (
        SELECT 'passage-planning' AS workflow, plans.provider_id, plans.model_id, attempts.status, attempts.usage_json,
          candidates.repair_json,
          attempts.created_at, attempts.finished_at, attempts.updated_at
        FROM generation_unit_attempts attempts
        JOIN generation_jobs jobs ON jobs.project_id = attempts.project_id AND jobs.id = attempts.job_id
        JOIN generation_plans plans ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
        LEFT JOIN generation_unit_candidates candidates
          ON candidates.project_id = attempts.project_id AND candidates.attempt_id = attempts.id
        WHERE attempts.project_id = ?
        UNION ALL
        SELECT 'passage-drafting' AS workflow, plans.provider_id, plans.model_id, attempts.status, attempts.usage_json,
          outputs.repair_json,
          attempts.created_at, attempts.finished_at, attempts.updated_at
        FROM drafting_unit_attempts attempts
        JOIN drafting_jobs jobs ON jobs.project_id = attempts.project_id AND jobs.id = attempts.job_id
        JOIN drafting_plans plans ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
        LEFT JOIN drafting_unit_outputs outputs
          ON outputs.project_id = attempts.project_id AND outputs.attempt_id = attempts.id
        WHERE attempts.project_id = ?
      ) GROUP BY workflow, provider_id, model_id, status`).all(projectId, projectId) as unknown as RawUsageRow[];
    const generic = this.database.prepare(`SELECT jobs.kind AS workflow, NULL AS provider_id, NULL AS model_id,
        jobs.status, 0 AS attempt_count, COUNT(*) AS known_provider_request_count,
        0 AS unknown_provider_request_attempt_count,
        COUNT(*) AS token_known_request_count, 0 AS legacy_unknown_request_count,
        COALESCE(SUM(records.prompt_tokens), 0) AS input_tokens, COALESCE(SUM(records.completion_tokens), 0) AS output_tokens,
        COUNT(*) AS recorded_cost_request_count, 0 AS unknown_cost_request_count, COALESCE(SUM(records.cost), 0) AS recorded_cost,
        MIN(records.created_at) AS first_recorded_at, MAX(records.created_at) AS last_recorded_at
      FROM usage_records records JOIN jobs ON jobs.id = records.job_id
      WHERE jobs.project_id = ? GROUP BY jobs.kind, jobs.status`).all(projectId) as unknown as RawUsageRow[];
    const embedded = this.database.prepare(`WITH latest AS (
      SELECT artifact_id, MAX(version) AS version FROM artifact_versions
      WHERE project_id = ? AND artifact_type IN ('narrative-review', 'repair-proposal-generation') GROUP BY artifact_id
    ), attempts AS (
      SELECT CASE versions.artifact_type WHEN 'narrative-review' THEN 'narrative-review' ELSE 'repair-proposal' END AS workflow,
        CASE versions.artifact_type WHEN 'narrative-review' THEN json_extract(versions.content_json, '$.plan.providerId')
          ELSE json_extract(versions.content_json, '$.generation.providerId') END AS provider_id,
        CASE versions.artifact_type WHEN 'narrative-review' THEN json_extract(versions.content_json, '$.plan.modelId')
          ELSE json_extract(versions.content_json, '$.generation.modelId') END AS model_id,
        json_extract(attempt.value, '$.status') AS status, json_extract(attempt.value, '$.usage') AS usage_json,
        json_extract(attempt.value, '$.repair.performed') AS repair_performed,
        json_extract(attempt.value, '$.startedAt') AS created_at, json_extract(attempt.value, '$.finishedAt') AS finished_at
      FROM artifact_versions versions JOIN latest ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
      JOIN json_each(versions.content_json, '$.job.units') unit
      JOIN json_each(unit.value, '$.attempts') attempt
      WHERE versions.project_id = ?
    ) SELECT workflow, provider_id, model_id, status, COUNT(*) AS attempt_count,
      COALESCE(SUM(CASE WHEN status IN ('completed', 'failed') AND repair_performed IS NOT NULL
        THEN 1 + CAST(repair_performed AS INTEGER) ELSE 0 END), 0) AS known_provider_request_count,
      SUM(CASE WHEN status NOT IN ('completed', 'failed') OR repair_performed IS NULL THEN 1 ELSE 0 END)
        AS unknown_provider_request_attempt_count,
      SUM(CASE WHEN usage_json IS NOT NULL THEN 1 ELSE 0 END) AS token_known_request_count,
      SUM(CASE WHEN usage_json IS NULL AND status IN ('completed', 'failed', 'cancelled') THEN 1 ELSE 0 END) AS legacy_unknown_request_count,
      COALESCE(SUM(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER)), 0) AS input_tokens,
      COALESCE(SUM(CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER)), 0) AS output_tokens,
      SUM(CASE WHEN json_type(usage_json, '$.cost') IN ('integer', 'real') THEN 1 ELSE 0 END) AS recorded_cost_request_count,
      SUM(CASE WHEN usage_json IS NOT NULL AND json_type(usage_json, '$.cost') IS NULL THEN 1 ELSE 0 END) AS unknown_cost_request_count,
      COALESCE(SUM(CASE WHEN json_type(usage_json, '$.cost') IN ('integer', 'real') THEN CAST(json_extract(usage_json, '$.cost') AS REAL) ELSE 0 END), 0) AS recorded_cost,
      MIN(created_at) AS first_recorded_at, MAX(COALESCE(finished_at, created_at)) AS last_recorded_at
      FROM attempts GROUP BY workflow, provider_id, model_id, status`).all(projectId, projectId) as unknown as RawUsageRow[];
    return [...relational, ...generic, ...embedded].map(mapUsageRow);
  }

  queryPlans(projectId: string): Array<{ operation: string; detail: string }> {
    const plans = this.database.prepare(`EXPLAIN QUERY PLAN SELECT versions.id
      FROM passage_entity_heads heads JOIN passage_entity_versions versions ON versions.id = heads.version_id
      WHERE heads.project_id = ? AND heads.entity_kind = 'passage' AND heads.tombstoned = 0
      ORDER BY json_extract(versions.content_json, '$.position'), heads.entity_id`).all(projectId) as Array<{ detail: string }>;
    return plans.map((row) => ({ operation: "passage-review-queue", detail: row.detail }));
  }
}

function mapResumeJobFacts(rows: Array<{
  status: ResumeAttentionJobStatus; status_count: number; id: string; passage_id: string | null;
}>): ResumeJobFacts {
  const empty = (): ResumeJobStateFact => ({ count: 0, latestJobId: null, latestPassageId: null });
  const result: ResumeJobFacts = {
    planned: empty(), authorized: empty(), running: empty(), partially_failed: empty(), failed: empty(),
  };
  for (const row of rows) result[row.status] = {
    count: Number(row.status_count), latestJobId: row.id, latestPassageId: row.passage_id,
  };
  return result;
}

interface RawUsageRow {
  workflow: string; provider_id: string | null; model_id: string | null; status: string | null;
  attempt_count: number; known_provider_request_count: number; unknown_provider_request_attempt_count: number;
  token_known_request_count: number; legacy_unknown_request_count: number;
  input_tokens: number; output_tokens: number; recorded_cost_request_count: number;
  unknown_cost_request_count: number; recorded_cost: number; first_recorded_at: string | null; last_recorded_at: string | null;
}

function mapUsageRow(row: RawUsageRow): ProjectUsageAggregateRow {
  return {
    workflow: row.workflow,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    attemptCount: Number(row.attempt_count ?? 0),
    knownProviderRequestCount: Number(row.known_provider_request_count ?? 0),
    unknownProviderRequestAttemptCount: Number(row.unknown_provider_request_attempt_count ?? 0),
    tokenKnownRequestCount: Number(row.token_known_request_count ?? 0),
    legacyUnknownRequestCount: Number(row.legacy_unknown_request_count ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    recordedCostRequestCount: Number(row.recorded_cost_request_count ?? 0),
    unknownCostRequestCount: Number(row.unknown_cost_request_count ?? 0),
    recordedCost: Number(row.recorded_cost ?? 0),
    firstRecordedAt: row.first_recorded_at,
    lastRecordedAt: row.last_recorded_at,
  };
}
