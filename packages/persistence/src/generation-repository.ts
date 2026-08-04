import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export type GenerationJobStatus = "planned" | "authorized" | "running" | "completed"
  | "partially_failed" | "failed" | "cancelled";
export type GenerationUnitStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface GenerationPlanUnitInput {
  id: string;
  position: number;
  sequenceId: string;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface GenerationPlanInput {
  projectId: string;
  fingerprint: string;
  snapshotId: string;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  scope: unknown;
  providerId: string;
  modelId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  costEstimate: unknown;
  validationStages: string[];
  executionPolicyId: string;
  executionPolicy: unknown;
  units: GenerationPlanUnitInput[];
}

export interface GenerationPlanRecord extends GenerationPlanInput {
  id: string;
  authorizationState: "planned" | "authorized";
  authorizationFingerprint: string | null;
  authorizedAt: string | null;
  createdAt: string;
  jobId: string;
  jobStatus: GenerationJobStatus;
}

export interface GenerationJobUnitRecord extends GenerationPlanUnitInput {
  jobId: string;
  projectId: string;
  planId: string;
  status: GenerationUnitStatus;
  attemptNumber: number;
  retryOfAttemptId: string | null;
  normalizedError: unknown | null;
  usage: unknown | null;
  executionPolicyId: string;
  candidateReference: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface GenerationJobRecord {
  id: string;
  projectId: string;
  planId: string;
  planFingerprint: string;
  status: GenerationJobStatus;
  executionPolicyId: string;
  createdAt: string;
  authorizedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  units: GenerationJobUnitRecord[];
}

type PlanRow = {
  id: string; project_id: string; fingerprint: string; passage_snapshot_id: string;
  structure_version_id: string; upstream_versions_json: string; scope_json: string;
  provider_id: string; model_id: string; estimated_input_tokens: number; estimated_output_tokens: number;
  cost_estimate_json: string; validation_stages_json: string; execution_policy_id: string;
  execution_policy_json: string; authorization_state: "planned" | "authorized";
  authorization_fingerprint: string | null; authorized_at: string | null; created_at: string;
  job_id: string; job_status: GenerationJobStatus;
};
type UnitRow = {
  unit_id: string; position: number; sequence_id: string; passage_ids_json: string;
  passage_version_ids_json: string; input_fingerprint: string; estimated_input_tokens: number;
  estimated_output_tokens: number; job_id: string; project_id: string; plan_id: string;
  status: GenerationUnitStatus; attempt_number: number; retry_of_attempt_id: string | null;
  normalized_error_json: string | null; usage_json: string | null; execution_policy_id: string;
  candidate_reference: string | null; created_at: string; started_at: string | null;
  finished_at: string | null; updated_at: string;
};
type JobRow = {
  id: string; project_id: string; plan_id: string; plan_fingerprint: string;
  status: GenerationJobStatus; execution_policy_id: string; created_at: string;
  authorized_at: string | null; started_at: string | null; finished_at: string | null; updated_at: string;
};
type SnapshotDependencyRow = {
  structure_version_id: string;
  upstream_versions_json: string;
  status: "draft" | "approved";
};

const jobTransitions: Record<GenerationJobStatus, GenerationJobStatus[]> = {
  planned: ["authorized", "cancelled"],
  authorized: ["running", "cancelled"],
  running: ["completed", "partially_failed", "failed", "cancelled"],
  completed: [],
  partially_failed: ["authorized", "cancelled"],
  failed: ["authorized", "cancelled"],
  cancelled: [],
};
const unitTransitions: Record<GenerationUnitStatus, GenerationUnitStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending", "cancelled"],
  cancelled: [],
};

export function assertGenerationJobTransition(from: GenerationJobStatus, to: GenerationJobStatus): void {
  if (!jobTransitions[from].includes(to)) throw new Error(`Invalid generation job transition: ${from} -> ${to}`);
}

export function assertGenerationUnitTransition(from: GenerationUnitStatus, to: GenerationUnitStatus): void {
  if (!unitTransitions[from].includes(to)) throw new Error(`Invalid generation unit transition: ${from} -> ${to}`);
}

export class GenerationRepository {
  public constructor(private readonly database: StoryDatabase) {}

  createPlan(input: GenerationPlanInput): GenerationPlanRecord {
    return transaction(this.database, () => {
      const snapshot = this.database.prepare(`
        SELECT structure_version_id, upstream_versions_json, status
        FROM passage_plan_snapshots
        WHERE project_id = ? AND id = ?
      `).get(input.projectId, input.snapshotId) as SnapshotDependencyRow | undefined;
      if (!snapshot) throw new Error("Approved passage-plan snapshot not found");
      if (snapshot.status !== "approved") throw new Error("Passage-plan snapshot is not approved");
      if (snapshot.structure_version_id !== input.structureVersionId) {
        throw new Error("Generation plan structure version does not match its passage-plan snapshot");
      }
      const snapshotUpstreamVersions = JSON.parse(snapshot.upstream_versions_json) as Record<string, string>;
      if (canonicalRecordJson(snapshotUpstreamVersions) !== canonicalRecordJson(input.upstreamVersions)) {
        throw new Error("Generation plan upstream versions do not match its passage-plan snapshot");
      }
      const id = randomUUID();
      const jobId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO generation_plans (
          id, project_id, fingerprint, passage_snapshot_id, structure_version_id,
          upstream_versions_json, scope_json, provider_id, model_id,
          estimated_input_tokens, estimated_output_tokens, cost_estimate_json,
          validation_stages_json, execution_policy_id, execution_policy_json,
          authorization_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)
      `).run(
        id, input.projectId, input.fingerprint, input.snapshotId, input.structureVersionId,
        JSON.stringify(input.upstreamVersions), JSON.stringify(input.scope), input.providerId, input.modelId,
        input.estimatedInputTokens, input.estimatedOutputTokens, JSON.stringify(input.costEstimate),
        JSON.stringify(input.validationStages), input.executionPolicyId, JSON.stringify(input.executionPolicy), now,
      );
      this.database.prepare(`
        INSERT INTO generation_jobs (
          id, project_id, plan_id, plan_fingerprint, status, execution_policy_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)
      `).run(jobId, input.projectId, id, input.fingerprint, input.executionPolicyId, now, now);
      const insertPlanUnit = this.database.prepare(`
        INSERT INTO generation_plan_units (
          plan_id, project_id, unit_id, position, sequence_id, passage_ids_json,
          passage_version_ids_json, input_fingerprint, estimated_input_tokens,
          estimated_output_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertJobUnit = this.database.prepare(`
        INSERT INTO generation_job_units (
          job_id, project_id, plan_id, unit_id, status, input_fingerprint,
          execution_policy_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `);
      for (const unit of input.units) {
        insertPlanUnit.run(
          id, input.projectId, unit.id, unit.position, unit.sequenceId,
          JSON.stringify(unit.passageIds), JSON.stringify(unit.passageVersionIds), unit.inputFingerprint,
          unit.estimatedInputTokens, unit.estimatedOutputTokens, now,
        );
        insertJobUnit.run(jobId, input.projectId, id, unit.id, unit.inputFingerprint, input.executionPolicyId, now, now);
      }
      return this.getPlan(input.projectId, id)!;
    });
  }

  getPlan(projectId: string, planId: string): GenerationPlanRecord | undefined {
    const row = this.database.prepare(`
      SELECT plans.*, jobs.id AS job_id, jobs.status AS job_status
      FROM generation_plans plans
      JOIN generation_jobs jobs ON jobs.plan_id = plans.id AND jobs.project_id = plans.project_id
      WHERE plans.project_id = ? AND plans.id = ?
    `).get(projectId, planId) as PlanRow | undefined;
    if (!row) return undefined;
    const job = this.getJob(projectId, row.job_id)!;
    return {
      id: row.id,
      projectId: row.project_id,
      fingerprint: row.fingerprint,
      snapshotId: row.passage_snapshot_id,
      structureVersionId: row.structure_version_id,
      upstreamVersions: JSON.parse(row.upstream_versions_json),
      scope: JSON.parse(row.scope_json),
      providerId: row.provider_id,
      modelId: row.model_id,
      estimatedInputTokens: row.estimated_input_tokens,
      estimatedOutputTokens: row.estimated_output_tokens,
      costEstimate: JSON.parse(row.cost_estimate_json),
      validationStages: JSON.parse(row.validation_stages_json),
      executionPolicyId: row.execution_policy_id,
      executionPolicy: JSON.parse(row.execution_policy_json),
      units: job.units.map((unit) => ({
        id: unit.id,
        position: unit.position,
        sequenceId: unit.sequenceId,
        passageIds: unit.passageIds,
        passageVersionIds: unit.passageVersionIds,
        inputFingerprint: unit.inputFingerprint,
        estimatedInputTokens: unit.estimatedInputTokens,
        estimatedOutputTokens: unit.estimatedOutputTokens,
      })),
      authorizationState: row.authorization_state,
      authorizationFingerprint: row.authorization_fingerprint,
      authorizedAt: row.authorized_at,
      createdAt: row.created_at,
      jobId: row.job_id,
      jobStatus: row.job_status,
    };
  }

  listPlans(projectId: string): GenerationPlanRecord[] {
    const rows = this.database.prepare(`SELECT id FROM generation_plans
      WHERE project_id = ? ORDER BY created_at DESC, id DESC`).all(projectId) as Array<{ id: string }>;
    return rows.map((row) => this.getPlan(projectId, row.id)!);
  }

  authorize(projectId: string, planId: string, fingerprint: string): GenerationPlanRecord {
    return transaction(this.database, () => {
      const plan = this.getPlan(projectId, planId);
      if (!plan) throw new Error("Generation plan not found");
      if (plan.fingerprint !== fingerprint) throw new Error("Generation plan fingerprint does not match");
      if (plan.authorizationState === "authorized") {
        if (plan.authorizationFingerprint !== fingerprint) throw new Error("Generation authorization is stale");
        return plan;
      }
      assertGenerationJobTransition(plan.jobStatus, "authorized");
      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE generation_plans SET authorization_state = 'authorized',
          authorization_fingerprint = ?, authorized_at = ?
        WHERE project_id = ? AND id = ?
      `).run(fingerprint, now, projectId, planId);
      this.database.prepare(`
        UPDATE generation_jobs SET status = 'authorized', authorized_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?
      `).run(now, now, projectId, plan.jobId);
      return this.getPlan(projectId, planId)!;
    });
  }

  getJob(projectId: string, jobId: string): GenerationJobRecord | undefined {
    const row = this.database.prepare(
      "SELECT * FROM generation_jobs WHERE project_id = ? AND id = ?",
    ).get(projectId, jobId) as JobRow | undefined;
    if (!row) return undefined;
    const unitRows = this.database.prepare(`
      SELECT current.*, planned.position, planned.sequence_id, planned.passage_ids_json,
        planned.passage_version_ids_json, planned.estimated_input_tokens, planned.estimated_output_tokens
      FROM generation_job_units current
      JOIN generation_plan_units planned
        ON planned.project_id = current.project_id AND planned.plan_id = current.plan_id
        AND planned.unit_id = current.unit_id
      WHERE current.project_id = ? AND current.job_id = ?
      ORDER BY planned.position
    `).all(projectId, jobId) as UnitRow[];
    return {
      id: row.id, projectId: row.project_id, planId: row.plan_id,
      planFingerprint: row.plan_fingerprint, status: row.status,
      executionPolicyId: row.execution_policy_id, createdAt: row.created_at,
      authorizedAt: row.authorized_at, startedAt: row.started_at,
      finishedAt: row.finished_at, updatedAt: row.updated_at,
      units: unitRows.map(mapUnit),
    };
  }

  startJob(projectId: string, jobId: string): GenerationJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      assertGenerationJobTransition(job.status, "running");
      const plan = this.getPlan(projectId, job.planId)!;
      if (plan.authorizationState !== "authorized" || plan.authorizationFingerprint !== plan.fingerprint) {
        throw new Error("Exact generation plan is not authorized");
      }
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE generation_jobs SET status = 'running',
        started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  startUnit(projectId: string, jobId: string, unitId: string): { job: GenerationJobRecord; attemptId: string } {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "running") throw new Error("Generation job is not running");
      const unit = this.requireUnit(job, unitId);
      assertGenerationUnitTransition(unit.status, "running");
      const plan = this.getPlan(projectId, job.planId)!;
      const policy = plan.executionPolicy as { maxAttemptsPerUnit?: number };
      const nextAttempt = unit.attemptNumber + 1;
      if (nextAttempt > (policy.maxAttemptsPerUnit ?? 1)) throw new Error("Generation unit attempt limit reached");
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE generation_job_units SET status = 'running', attempt_number = ?,
          normalized_error_json = NULL, usage_json = NULL, candidate_reference = NULL,
          started_at = ?, finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?
      `).run(nextAttempt, now, now, projectId, jobId, unitId);
      this.database.prepare(`
        INSERT INTO generation_unit_attempts (
          id, project_id, job_id, unit_id, attempt_number, retry_of_attempt_id,
          status, input_fingerprint, execution_policy_id, created_at, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
      `).run(
        attemptId, projectId, jobId, unitId, nextAttempt, unit.retryOfAttemptId,
        unit.inputFingerprint, unit.executionPolicyId, now, now, now,
      );
      return { job: this.requireJob(projectId, jobId), attemptId };
    });
  }

  completeUnit(
    projectId: string,
    jobId: string,
    unitId: string,
    attemptId: string,
    result: { usage?: unknown; candidateReference?: string },
  ): GenerationJobRecord {
    return this.finishUnit(projectId, jobId, unitId, attemptId, "completed", result);
  }

  failUnit(
    projectId: string,
    jobId: string,
    unitId: string,
    attemptId: string,
    normalizedError: unknown,
  ): GenerationJobRecord {
    return this.finishUnit(projectId, jobId, unitId, attemptId, "failed", { normalizedError });
  }

  cancelJob(projectId: string, jobId: string): GenerationJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      assertGenerationJobTransition(job.status, "cancelled");
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE generation_jobs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, now, projectId, jobId);
      for (const unit of job.units.filter((item) => item.status === "pending" || item.status === "running")) {
        assertGenerationUnitTransition(unit.status, "cancelled");
        this.database.prepare(`UPDATE generation_job_units SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE project_id = ? AND job_id = ? AND unit_id = ?`).run(now, now, projectId, jobId, unit.id);
        if (unit.status === "running") {
          this.database.prepare(`UPDATE generation_unit_attempts SET status = 'cancelled', finished_at = ?, updated_at = ?
            WHERE project_id = ? AND job_id = ? AND unit_id = ? AND attempt_number = ?`)
            .run(now, now, projectId, jobId, unit.id, unit.attemptNumber);
        }
      }
      return this.requireJob(projectId, jobId);
    });
  }

  retryUnit(projectId: string, jobId: string, unitId: string): GenerationJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "failed" && job.status !== "partially_failed") {
        throw new Error("Only a failed generation job can retry a unit");
      }
      const unit = this.requireUnit(job, unitId);
      assertGenerationUnitTransition(unit.status, "pending");
      const plan = this.getPlan(projectId, job.planId)!;
      const policy = plan.executionPolicy as { maxAttemptsPerUnit?: number };
      if (unit.attemptNumber >= (policy.maxAttemptsPerUnit ?? 1)) {
        throw new Error("Generation unit attempt limit reached");
      }
      const latest = this.database.prepare(`SELECT id FROM generation_unit_attempts
        WHERE project_id = ? AND job_id = ? AND unit_id = ? ORDER BY attempt_number DESC LIMIT 1`)
        .get(projectId, jobId, unitId) as { id: string } | undefined;
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE generation_job_units SET status = 'pending', retry_of_attempt_id = ?,
        normalized_error_json = NULL, finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(latest?.id ?? null, now, projectId, jobId, unitId);
      assertGenerationJobTransition(job.status, "authorized");
      this.database.prepare(`UPDATE generation_jobs SET status = 'authorized', finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  finalizeJob(projectId: string, jobId: string): GenerationJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "running") return job;
      const completed = job.units.filter((unit) => unit.status === "completed").length;
      const failed = job.units.filter((unit) => unit.status === "failed").length;
      const next: GenerationJobStatus = failed === 0
        ? "completed"
        : completed === 0 ? "failed" : "partially_failed";
      assertGenerationJobTransition(job.status, next);
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE generation_jobs SET status = ?, finished_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(next, now, now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  recoverInterrupted(): number {
    return transaction(this.database, () => {
      const rows = this.database.prepare("SELECT project_id, id FROM generation_jobs WHERE status = 'running'")
        .all() as Array<{ project_id: string; id: string }>;
      const now = new Date().toISOString();
      const error = JSON.stringify({
        code: "process_interrupted",
        message: "The process stopped while this unit was running.",
        retryable: true,
      });
      for (const row of rows) {
        this.database.prepare(`UPDATE generation_job_units SET status = 'failed', normalized_error_json = ?,
          finished_at = ?, updated_at = ? WHERE project_id = ? AND job_id = ? AND status = 'running'`)
          .run(error, now, now, row.project_id, row.id);
        this.database.prepare(`UPDATE generation_unit_attempts SET status = 'failed', normalized_error_json = ?,
          finished_at = ?, updated_at = ? WHERE project_id = ? AND job_id = ? AND status = 'running'`)
          .run(error, now, now, row.project_id, row.id);
        const job = this.requireJob(row.project_id, row.id);
        const next = job.units.some((unit) => unit.status === "completed") ? "partially_failed" : "failed";
        this.database.prepare(`UPDATE generation_jobs SET status = ?, finished_at = ?, updated_at = ?
          WHERE project_id = ? AND id = ?`).run(next, now, now, row.project_id, row.id);
      }
      return rows.length;
    });
  }

  attemptCount(projectId: string, jobId: string, unitId: string): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM generation_unit_attempts
      WHERE project_id = ? AND job_id = ? AND unit_id = ?`).get(projectId, jobId, unitId) as { count: number };
    return row.count;
  }

  private finishUnit(
    projectId: string,
    jobId: string,
    unitId: string,
    attemptId: string,
    status: "completed" | "failed",
    result: { usage?: unknown; candidateReference?: string; normalizedError?: unknown },
  ): GenerationJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      const unit = this.requireUnit(job, unitId);
      assertGenerationUnitTransition(unit.status, status);
      const attempt = this.database.prepare(`SELECT id FROM generation_unit_attempts
        WHERE id = ? AND project_id = ? AND job_id = ? AND unit_id = ? AND status = 'running'`)
        .get(attemptId, projectId, jobId, unitId);
      if (!attempt) throw new Error("Running generation attempt not found");
      const now = new Date().toISOString();
      const errorJson = result.normalizedError === undefined ? null : JSON.stringify(result.normalizedError);
      const usageJson = result.usage === undefined ? null : JSON.stringify(result.usage);
      this.database.prepare(`UPDATE generation_job_units SET status = ?, normalized_error_json = ?,
        usage_json = ?, candidate_reference = ?, finished_at = ?, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(status, errorJson, usageJson, result.candidateReference ?? null, now, now, projectId, jobId, unitId);
      this.database.prepare(`UPDATE generation_unit_attempts SET status = ?, normalized_error_json = ?,
        usage_json = ?, candidate_reference = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, errorJson, usageJson, result.candidateReference ?? null, now, now, attemptId);
      return this.requireJob(projectId, jobId);
    });
  }

  private requireJob(projectId: string, jobId: string): GenerationJobRecord {
    const job = this.getJob(projectId, jobId);
    if (!job) throw new Error("Generation job not found");
    return job;
  }

  private requireUnit(job: GenerationJobRecord, unitId: string): GenerationJobUnitRecord {
    const unit = job.units.find((item) => item.id === unitId);
    if (!unit) throw new Error("Generation unit not found");
    return unit;
  }
}

function canonicalRecordJson(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function mapUnit(row: UnitRow): GenerationJobUnitRecord {
  return {
    id: row.unit_id, position: row.position, sequenceId: row.sequence_id,
    passageIds: JSON.parse(row.passage_ids_json), passageVersionIds: JSON.parse(row.passage_version_ids_json),
    inputFingerprint: row.input_fingerprint, estimatedInputTokens: row.estimated_input_tokens,
    estimatedOutputTokens: row.estimated_output_tokens, jobId: row.job_id,
    projectId: row.project_id, planId: row.plan_id, status: row.status,
    attemptNumber: row.attempt_number, retryOfAttemptId: row.retry_of_attempt_id,
    normalizedError: row.normalized_error_json ? JSON.parse(row.normalized_error_json) : null,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    executionPolicyId: row.execution_policy_id, candidateReference: row.candidate_reference,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}
