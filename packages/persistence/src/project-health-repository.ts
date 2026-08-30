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
  requestCount: number;
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

  planning(projectId: string): { status: string | null; approvedSnapshotId: string | null; blockers: number; warnings: number } {
    const state = this.database.prepare(`SELECT state.status, state.approved_snapshot_id, snapshots.validation_json
      FROM passage_plan_state state
      LEFT JOIN passage_plan_snapshots snapshots ON snapshots.id = state.approved_snapshot_id
      WHERE state.project_id = ?`).get(projectId) as {
        status: string; approved_snapshot_id: string | null; validation_json: string | null;
      } | undefined;
    if (!state) return { status: null, approvedSnapshotId: null, blockers: 0, warnings: 0 };
    let blockers = 0; let warnings = 0;
    try {
      const findings = JSON.parse(state.validation_json ?? "{}").findings;
      if (Array.isArray(findings)) {
        blockers = findings.filter((item) => item?.severity === "error").length;
        warnings = findings.filter((item) => item?.severity === "warning").length;
      }
    } catch { /* The authoritative validation reader will surface corruption elsewhere. */ }
    return { status: state.status, approvedSnapshotId: state.approved_snapshot_id, blockers, warnings };
  }

  latest(projectId: string): ProjectHealthLatestRecord[] {
    const rows = this.database.prepare(`WITH latest AS (
      SELECT artifact_id, MAX(version) AS version FROM artifact_versions
      WHERE project_id = ? AND artifact_id IN (
        'simulation-runs', 'playtest-campaigns', 'native-builds'
      ) GROUP BY artifact_id
    ) SELECT versions.artifact_id, versions.id, versions.created_at, versions.content_json
      FROM artifact_versions versions JOIN latest
        ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
      WHERE versions.project_id = ? ORDER BY versions.created_at DESC`).all(projectId, projectId) as Array<{
        artifact_id: string; id: string; created_at: string; content_json: string;
      }>;
    const artifactKinds: Record<string, string> = {
      "simulation-runs": "simulation", "playtest-campaigns": "playtest",
      "native-builds": "native-build",
    };
    return rows.map((row) => {
      const value = JSON.parse(row.content_json) as Record<string, unknown>;
      return {
        kind: artifactKinds[row.artifact_id] ?? row.artifact_id,
        versionId: row.id,
        createdAt: row.created_at,
        status: typeof value.status === "string" ? value.status
          : typeof (value.job as Record<string, unknown> | undefined)?.status === "string"
            ? String((value.job as Record<string, unknown>).status) : null,
        fingerprint: typeof value.fingerprint === "string" ? value.fingerprint
          : typeof value.bundleFingerprint === "string" ? value.bundleFingerprint : null,
      };
    });
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
        COUNT(*) AS request_count,
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
          attempts.created_at, attempts.finished_at, attempts.updated_at
        FROM generation_unit_attempts attempts
        JOIN generation_jobs jobs ON jobs.project_id = attempts.project_id AND jobs.id = attempts.job_id
        JOIN generation_plans plans ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
        WHERE attempts.project_id = ?
        UNION ALL
        SELECT 'passage-drafting' AS workflow, plans.provider_id, plans.model_id, attempts.status, attempts.usage_json,
          attempts.created_at, attempts.finished_at, attempts.updated_at
        FROM drafting_unit_attempts attempts
        JOIN drafting_jobs jobs ON jobs.project_id = attempts.project_id AND jobs.id = attempts.job_id
        JOIN drafting_plans plans ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
        WHERE attempts.project_id = ?
      ) GROUP BY workflow, provider_id, model_id, status`).all(projectId, projectId) as unknown as RawUsageRow[];
    const generic = this.database.prepare(`SELECT jobs.kind AS workflow, NULL AS provider_id, NULL AS model_id,
        jobs.status, COUNT(*) AS request_count, COUNT(*) AS token_known_request_count, 0 AS legacy_unknown_request_count,
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
        json_extract(attempt.value, '$.startedAt') AS created_at, json_extract(attempt.value, '$.finishedAt') AS finished_at
      FROM artifact_versions versions JOIN latest ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
      JOIN json_each(versions.content_json, '$.job.units') unit
      JOIN json_each(unit.value, '$.attempts') attempt
      WHERE versions.project_id = ?
    ) SELECT workflow, provider_id, model_id, status, COUNT(*) AS request_count,
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

interface RawUsageRow {
  workflow: string; provider_id: string | null; model_id: string | null; status: string | null;
  request_count: number; token_known_request_count: number; legacy_unknown_request_count: number;
  input_tokens: number; output_tokens: number; recorded_cost_request_count: number;
  unknown_cost_request_count: number; recorded_cost: number; first_recorded_at: string | null; last_recorded_at: string | null;
}

function mapUsageRow(row: RawUsageRow): ProjectUsageAggregateRow {
  return {
    workflow: row.workflow,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    requestCount: Number(row.request_count ?? 0),
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
