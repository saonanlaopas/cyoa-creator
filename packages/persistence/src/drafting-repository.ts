import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import type { PassageDraftRepository, PassageDraftVersionRecord } from "./passage-draft-repository.js";

export type DraftingJobStatus = "planned" | "authorized" | "running" | "completed"
  | "partially_failed" | "failed" | "cancelled";
export type DraftingUnitStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface DraftingPlanUnitInput {
  id: string;
  position: number;
  passageIds: string[];
  passageVersionIds: string[];
  inputFingerprint: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  contextFingerprint?: string;
  context?: unknown;
  contextDiagnostics: unknown;
}

export interface DraftingPlanInput {
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
  executionPolicyId: string;
  executionPolicy: unknown;
  units: DraftingPlanUnitInput[];
}

export interface DraftingPlanRecord extends DraftingPlanInput {
  id: string;
  authorizationState: "planned" | "authorized";
  authorizationFingerprint: string | null;
  authorizedAt: string | null;
  createdAt: string;
  jobId: string;
  jobStatus: DraftingJobStatus;
}

export interface DraftingJobUnitRecord extends DraftingPlanUnitInput {
  projectId: string;
  planId: string;
  jobId: string;
  status: DraftingUnitStatus;
  attemptNumber: number;
  retryOfAttemptId: string | null;
  normalizedError: unknown | null;
  usage: unknown | null;
  generatedCandidates: Array<{ draftVersionId: string; passageId: string; wordCount: number }>;
  executionPolicyId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface DraftingJobRecord {
  id: string;
  projectId: string;
  planId: string;
  planFingerprint: string;
  status: DraftingJobStatus;
  executionPolicyId: string;
  createdAt: string;
  authorizedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  units: DraftingJobUnitRecord[];
}

type PlanRow = {
  id: string; project_id: string; fingerprint: string; passage_snapshot_id: string;
  structure_version_id: string; upstream_versions_json: string; scope_json: string;
  provider_id: string; model_id: string; estimated_input_tokens: number; estimated_output_tokens: number;
  cost_estimate_json: string; execution_policy_id: string; execution_policy_json: string;
  authorization_state: "planned" | "authorized"; authorization_fingerprint: string | null;
  authorized_at: string | null; created_at: string; job_id: string; job_status: DraftingJobStatus;
};
type JobRow = {
  id: string; project_id: string; plan_id: string; plan_fingerprint: string; status: DraftingJobStatus;
  execution_policy_id: string; created_at: string; authorized_at: string | null;
  started_at: string | null; finished_at: string | null; updated_at: string;
};
type UnitRow = {
  unit_id: string; position: number; input_fingerprint: string; estimated_input_tokens: number;
  estimated_output_tokens: number; context_json: string; context_fingerprint: string;
  context_diagnostics_json: string; project_id: string;
  plan_id: string; job_id: string; status: DraftingUnitStatus; attempt_number: number;
  retry_of_attempt_id: string | null; normalized_error_json: string | null; usage_json: string | null;
  execution_policy_id: string; created_at: string; started_at: string | null;
  finished_at: string | null; updated_at: string;
};

export interface CompleteDraftingUnitCandidatesInput {
  contextFingerprint: string;
  providerId: string;
  modelId: string;
  outputSchemaId: string;
  outputSchemaVersion: number;
  content: unknown;
  validation: unknown;
  usage?: unknown;
  repair: unknown;
  upstreamVersions: Record<string, string>;
  neighboringDraftVersions: Record<string, string>;
  passages: Array<{ passageId: string; passagePlanVersionId: string; proseMarkdown: string }>;
}

export interface DraftingUnitOutputRecord {
  id: string;
  projectId: string;
  planId: string;
  jobId: string;
  unitId: string;
  attemptId: string;
  inputFingerprint: string;
  contextFingerprint: string;
  providerId: string;
  modelId: string;
  executionPolicyId: string;
  outputSchemaId: string;
  outputSchemaVersion: number;
  content: unknown;
  validation: unknown;
  usage: unknown | null;
  repair: unknown;
  createdAt: string;
}

const jobTransitions: Record<DraftingJobStatus, DraftingJobStatus[]> = {
  planned: ["authorized", "cancelled"],
  authorized: ["running", "cancelled"],
  running: ["completed", "partially_failed", "failed", "cancelled"],
  completed: [],
  partially_failed: ["authorized", "cancelled"],
  failed: ["authorized", "cancelled"],
  cancelled: [],
};
const unitTransitions: Record<DraftingUnitStatus, DraftingUnitStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending", "cancelled"],
  cancelled: [],
};

export function assertDraftingJobTransition(from: DraftingJobStatus, to: DraftingJobStatus): void {
  if (!jobTransitions[from].includes(to)) throw new Error(`Invalid drafting job transition: ${from} -> ${to}`);
}

export function assertDraftingUnitTransition(from: DraftingUnitStatus, to: DraftingUnitStatus): void {
  if (!unitTransitions[from].includes(to)) throw new Error(`Invalid drafting unit transition: ${from} -> ${to}`);
}

export class DraftingRepository {
  public constructor(private readonly database: StoryDatabase) {}

  createPlan(input: DraftingPlanInput): DraftingPlanRecord {
    return transaction(this.database, () => {
      const snapshot = this.database.prepare(`SELECT structure_version_id, upstream_versions_json, status
        FROM passage_plan_snapshots WHERE project_id = ? AND id = ?`)
        .get(input.projectId, input.snapshotId) as {
          structure_version_id: string; upstream_versions_json: string; status: "draft" | "approved";
        } | undefined;
      if (!snapshot) throw new Error("Approved passage-plan snapshot not found");
      if (snapshot.status !== "approved") throw new Error("Passage-plan snapshot is not approved");
      if (snapshot.structure_version_id !== input.structureVersionId) {
        throw new Error("Drafting plan structure version does not match its passage-plan snapshot");
      }
      if (canonicalRecordJson(JSON.parse(snapshot.upstream_versions_json)) !== canonicalRecordJson(input.upstreamVersions)) {
        throw new Error("Drafting plan upstream versions do not match its passage-plan snapshot");
      }
      if (!input.units.length) throw new Error("Drafting plan requires at least one unit");
      const id = randomUUID();
      const jobId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO drafting_plans (
        id, project_id, fingerprint, passage_snapshot_id, structure_version_id,
        upstream_versions_json, scope_json, provider_id, model_id,
        estimated_input_tokens, estimated_output_tokens, cost_estimate_json,
        execution_policy_id, execution_policy_json, authorization_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`)
        .run(
          id, input.projectId, input.fingerprint, input.snapshotId, input.structureVersionId,
          canonicalRecordJson(input.upstreamVersions), JSON.stringify(input.scope), input.providerId, input.modelId,
          input.estimatedInputTokens, input.estimatedOutputTokens, JSON.stringify(input.costEstimate),
          input.executionPolicyId, JSON.stringify(input.executionPolicy), now,
        );
      this.database.prepare(`INSERT INTO drafting_jobs (
        id, project_id, plan_id, plan_fingerprint, status, execution_policy_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)`)
        .run(jobId, input.projectId, id, input.fingerprint, input.executionPolicyId, now, now);
      const insertUnit = this.database.prepare(`INSERT INTO drafting_plan_units (
        plan_id, project_id, unit_id, position, input_fingerprint, estimated_input_tokens,
        estimated_output_tokens, context_json, context_fingerprint, context_diagnostics_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertPassage = this.database.prepare(`INSERT INTO drafting_plan_unit_passages (
        plan_id, project_id, unit_id, position, passage_id, passage_plan_version_id
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      const insertJobUnit = this.database.prepare(`INSERT INTO drafting_job_units (
        job_id, project_id, plan_id, unit_id, status, input_fingerprint,
        execution_policy_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`);
      for (const unit of [...input.units].sort((left, right) => left.position - right.position)) {
        if (unit.passageIds.length !== unit.passageVersionIds.length || !unit.passageIds.length) {
          throw new Error("Drafting unit passage/version inputs are incomplete");
        }
        insertUnit.run(
          id, input.projectId, unit.id, unit.position, unit.inputFingerprint,
          unit.estimatedInputTokens, unit.estimatedOutputTokens,
          JSON.stringify(unit.context ?? {}), unit.contextFingerprint ?? "",
          JSON.stringify(unit.contextDiagnostics), now,
        );
        unit.passageIds.forEach((passageId, position) => insertPassage.run(
          id, input.projectId, unit.id, position, passageId, unit.passageVersionIds[position],
        ));
        insertJobUnit.run(jobId, input.projectId, id, unit.id, unit.inputFingerprint, input.executionPolicyId, now, now);
      }
      return this.getPlan(input.projectId, id)!;
    });
  }

  getPlan(projectId: string, planId: string): DraftingPlanRecord | undefined {
    const row = this.database.prepare(`SELECT plans.*, jobs.id AS job_id, jobs.status AS job_status
      FROM drafting_plans plans JOIN drafting_jobs jobs
        ON jobs.project_id = plans.project_id AND jobs.plan_id = plans.id
      WHERE plans.project_id = ? AND plans.id = ?`)
      .get(projectId, planId) as PlanRow | undefined;
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
      executionPolicyId: row.execution_policy_id,
      executionPolicy: JSON.parse(row.execution_policy_json),
      units: job.units.map((unit) => ({
        id: unit.id,
        position: unit.position,
        passageIds: unit.passageIds,
        passageVersionIds: unit.passageVersionIds,
        inputFingerprint: unit.inputFingerprint,
        estimatedInputTokens: unit.estimatedInputTokens,
        estimatedOutputTokens: unit.estimatedOutputTokens,
        contextFingerprint: unit.contextFingerprint,
        context: unit.context,
        contextDiagnostics: unit.contextDiagnostics,
      })),
      authorizationState: row.authorization_state,
      authorizationFingerprint: row.authorization_fingerprint,
      authorizedAt: row.authorized_at,
      createdAt: row.created_at,
      jobId: row.job_id,
      jobStatus: row.job_status,
    };
  }

  listPlans(projectId: string): DraftingPlanRecord[] {
    const rows = this.database.prepare(`SELECT id FROM drafting_plans
      WHERE project_id = ? ORDER BY created_at DESC, id DESC`).all(projectId) as Array<{ id: string }>;
    return rows.map((row) => this.getPlan(projectId, row.id)!);
  }

  authorize(projectId: string, planId: string, fingerprint: string): DraftingPlanRecord {
    return transaction(this.database, () => {
      const plan = this.getPlan(projectId, planId);
      if (!plan) throw new Error("Drafting plan not found");
      if (plan.fingerprint !== fingerprint) throw new Error("Drafting plan fingerprint does not match");
      if (plan.authorizationState === "authorized") {
        if (plan.authorizationFingerprint !== fingerprint) throw new Error("Drafting authorization is stale");
        return plan;
      }
      assertDraftingJobTransition(plan.jobStatus, "authorized");
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_plans SET authorization_state = 'authorized',
        authorization_fingerprint = ?, authorized_at = ? WHERE project_id = ? AND id = ?`)
        .run(fingerprint, now, projectId, planId);
      this.database.prepare(`UPDATE drafting_jobs SET status = 'authorized', authorized_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, now, projectId, plan.jobId);
      return this.getPlan(projectId, planId)!;
    });
  }

  getJob(projectId: string, jobId: string): DraftingJobRecord | undefined {
    const row = this.database.prepare("SELECT * FROM drafting_jobs WHERE project_id = ? AND id = ?")
      .get(projectId, jobId) as JobRow | undefined;
    if (!row) return undefined;
    const unitRows = this.database.prepare(`SELECT current.*, planned.position, planned.input_fingerprint,
      planned.estimated_input_tokens, planned.estimated_output_tokens, planned.context_json,
      planned.context_fingerprint, planned.context_diagnostics_json
      FROM drafting_job_units current JOIN drafting_plan_units planned
        ON planned.project_id = current.project_id AND planned.plan_id = current.plan_id
        AND planned.unit_id = current.unit_id
      WHERE current.project_id = ? AND current.job_id = ? ORDER BY planned.position`)
      .all(projectId, jobId) as UnitRow[];
    return {
      id: row.id,
      projectId: row.project_id,
      planId: row.plan_id,
      planFingerprint: row.plan_fingerprint,
      status: row.status,
      executionPolicyId: row.execution_policy_id,
      createdAt: row.created_at,
      authorizedAt: row.authorized_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
      units: unitRows.map((unit) => this.mapUnit(unit)),
    };
  }

  startJob(projectId: string, jobId: string): DraftingJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      assertDraftingJobTransition(job.status, "running");
      const plan = this.getPlan(projectId, job.planId)!;
      if (plan.authorizationState !== "authorized" || plan.authorizationFingerprint !== plan.fingerprint) {
        throw new Error("Exact drafting plan is not authorized");
      }
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_jobs SET status = 'running',
        started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  startUnit(projectId: string, jobId: string, unitId: string): { job: DraftingJobRecord; attemptId: string } {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "running") throw new Error("Drafting job is not running");
      const unit = this.requireUnit(job, unitId);
      assertDraftingUnitTransition(unit.status, "running");
      const policy = this.getPlan(projectId, job.planId)!.executionPolicy as { maxAttemptsPerUnit?: number };
      const nextAttempt = unit.attemptNumber + 1;
      if (nextAttempt > (policy.maxAttemptsPerUnit ?? 1)) throw new Error("Drafting unit attempt limit reached");
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_job_units SET status = 'running', attempt_number = ?,
        normalized_error_json = NULL, usage_json = NULL, started_at = ?, finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(nextAttempt, now, now, projectId, jobId, unitId);
      this.database.prepare(`INSERT INTO drafting_unit_attempts (
        id, project_id, job_id, unit_id, attempt_number, retry_of_attempt_id, status,
        input_fingerprint, execution_policy_id, created_at, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`)
        .run(
          attemptId, projectId, jobId, unitId, nextAttempt, unit.retryOfAttemptId,
          unit.inputFingerprint, unit.executionPolicyId, now, now, now,
        );
      return { job: this.requireJob(projectId, jobId), attemptId };
    });
  }

  completeUnit(
    projectId: string, jobId: string, unitId: string, attemptId: string, usage?: unknown,
  ): DraftingJobRecord {
    return this.finishUnit(projectId, jobId, unitId, attemptId, "completed", { usage });
  }

  completeUnitWithCandidates(
    projectId: string,
    jobId: string,
    unitId: string,
    attemptId: string,
    drafts: PassageDraftRepository,
    candidate: CompleteDraftingUnitCandidatesInput,
  ): { job: DraftingJobRecord; drafts: PassageDraftVersionRecord[]; output: DraftingUnitOutputRecord } {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "running") throw new Error("Drafting job is not running");
      const unit = this.requireUnit(job, unitId);
      assertDraftingUnitTransition(unit.status, "completed");
      const attempt = this.database.prepare(`SELECT id FROM drafting_unit_attempts
        WHERE id = ? AND project_id = ? AND job_id = ? AND unit_id = ? AND status = 'running'`)
        .get(attemptId, projectId, jobId, unitId);
      if (!attempt) throw new Error("Running drafting attempt not found");
      if (!unit.contextFingerprint || unit.contextFingerprint !== candidate.contextFingerprint) {
        throw new Error("Candidate context fingerprint does not match the authorized drafting unit");
      }
      const plan = this.getPlan(projectId, job.planId)!;
      if (plan.providerId !== candidate.providerId || plan.modelId !== candidate.modelId) {
        throw new Error("Candidate provider or model does not match the authorized drafting plan");
      }
      if (canonicalRecordJson(plan.upstreamVersions) !== canonicalRecordJson(candidate.upstreamVersions)) {
        throw new Error("Candidate upstream versions do not match the authorized drafting plan");
      }
      const expectedNeighboringDraftVersions = neighboringDraftVersionsFromContext(unit.context);
      if (canonicalRecordJson(expectedNeighboringDraftVersions)
        !== canonicalRecordJson(candidate.neighboringDraftVersions)) {
        throw new Error("Candidate neighboring draft versions do not exactly match the persisted drafting context");
      }
      const expected = new Map(unit.passageIds.map((passageId, index) => [passageId, unit.passageVersionIds[index]!]));
      if (candidate.passages.length !== expected.size
        || candidate.passages.some((item) => expected.get(item.passageId) !== item.passagePlanVersionId)) {
        throw new Error("Generated passage candidates do not exactly match the drafting unit inputs");
      }
      const outputId = randomUUID();
      const now = new Date().toISOString();
      const usageJson = candidate.usage === undefined ? null : JSON.stringify(candidate.usage);
      this.database.prepare(`INSERT INTO drafting_unit_outputs (
        id, project_id, plan_id, job_id, unit_id, attempt_id, input_fingerprint,
        context_fingerprint, provider_id, model_id, execution_policy_id,
        output_schema_id, output_schema_version, content_json, validation_json,
        usage_json, repair_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          outputId, projectId, job.planId, jobId, unitId, attemptId, unit.inputFingerprint,
          candidate.contextFingerprint, candidate.providerId, candidate.modelId,
          unit.executionPolicyId, candidate.outputSchemaId, candidate.outputSchemaVersion,
          JSON.stringify(candidate.content), JSON.stringify(candidate.validation), usageJson,
          JSON.stringify(candidate.repair), now,
        );
      const created = candidate.passages.map((item) => {
        const draft = drafts.createVersionInTransaction({
          projectId,
          passageId: item.passageId,
          basedOnPassagePlanVersionId: item.passagePlanVersionId,
          proseMarkdown: item.proseMarkdown,
          sourceKind: "generated",
          generationPlanId: job.planId,
          generationJobId: jobId,
          generationUnitId: unitId,
          upstreamVersions: candidate.upstreamVersions,
          neighboringDraftVersions: candidate.neighboringDraftVersions,
        });
        this.database.prepare(`INSERT INTO passage_draft_generation_provenance (
          draft_version_id, project_id, output_id, plan_id, job_id, unit_id, attempt_id,
          passage_id, passage_plan_version_id, context_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            draft.id, projectId, outputId, job.planId, jobId, unitId, attemptId,
            item.passageId, item.passagePlanVersionId, candidate.contextFingerprint, now,
          );
        return drafts.getVersion(projectId, draft.id)!;
      });
      this.database.prepare(`UPDATE drafting_job_units SET status = 'completed', normalized_error_json = NULL,
        usage_json = ?, finished_at = ?, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(usageJson, now, now, projectId, jobId, unitId);
      this.database.prepare(`UPDATE drafting_unit_attempts SET status = 'completed', normalized_error_json = NULL,
        usage_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
        .run(usageJson, now, now, attemptId);
      return {
        job: this.requireJob(projectId, jobId),
        drafts: created,
        output: this.getOutput(projectId, outputId)!,
      };
    });
  }

  getOutput(projectId: string, outputId: string): DraftingUnitOutputRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM drafting_unit_outputs WHERE project_id = ? AND id = ?`)
      .get(projectId, outputId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id), projectId: String(row.project_id), planId: String(row.plan_id),
      jobId: String(row.job_id), unitId: String(row.unit_id), attemptId: String(row.attempt_id),
      inputFingerprint: String(row.input_fingerprint), contextFingerprint: String(row.context_fingerprint),
      providerId: String(row.provider_id), modelId: String(row.model_id),
      executionPolicyId: String(row.execution_policy_id), outputSchemaId: String(row.output_schema_id),
      outputSchemaVersion: Number(row.output_schema_version), content: JSON.parse(String(row.content_json)),
      validation: JSON.parse(String(row.validation_json)),
      usage: row.usage_json === null ? null : JSON.parse(String(row.usage_json)),
      repair: JSON.parse(String(row.repair_json)), createdAt: String(row.created_at),
    };
  }

  failUnit(
    projectId: string, jobId: string, unitId: string, attemptId: string, normalizedError: unknown,
  ): DraftingJobRecord {
    return this.finishUnit(projectId, jobId, unitId, attemptId, "failed", { normalizedError });
  }

  cancelJob(projectId: string, jobId: string): DraftingJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      assertDraftingJobTransition(job.status, "cancelled");
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_jobs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, now, projectId, jobId);
      for (const unit of job.units.filter((item) => item.status === "pending" || item.status === "running")) {
        assertDraftingUnitTransition(unit.status, "cancelled");
        this.database.prepare(`UPDATE drafting_job_units SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE project_id = ? AND job_id = ? AND unit_id = ?`).run(now, now, projectId, jobId, unit.id);
        if (unit.status === "running") {
          this.database.prepare(`UPDATE drafting_unit_attempts SET status = 'cancelled', finished_at = ?, updated_at = ?
            WHERE project_id = ? AND job_id = ? AND unit_id = ? AND attempt_number = ?`)
            .run(now, now, projectId, jobId, unit.id, unit.attemptNumber);
        }
      }
      return this.requireJob(projectId, jobId);
    });
  }

  retryUnit(projectId: string, jobId: string, unitId: string): DraftingJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "failed" && job.status !== "partially_failed") {
        throw new Error("Only a failed drafting job can retry a unit");
      }
      const unit = this.requireUnit(job, unitId);
      assertDraftingUnitTransition(unit.status, "pending");
      const policy = this.getPlan(projectId, job.planId)!.executionPolicy as { maxAttemptsPerUnit?: number };
      if (unit.attemptNumber >= (policy.maxAttemptsPerUnit ?? 1)) throw new Error("Drafting unit attempt limit reached");
      const latest = this.database.prepare(`SELECT id FROM drafting_unit_attempts
        WHERE project_id = ? AND job_id = ? AND unit_id = ? ORDER BY attempt_number DESC LIMIT 1`)
        .get(projectId, jobId, unitId) as { id: string } | undefined;
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_job_units SET status = 'pending', retry_of_attempt_id = ?,
        normalized_error_json = NULL, finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(latest?.id ?? null, now, projectId, jobId, unitId);
      assertDraftingJobTransition(job.status, "authorized");
      this.database.prepare(`UPDATE drafting_jobs SET status = 'authorized', finished_at = NULL, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  finalizeJob(projectId: string, jobId: string): DraftingJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      if (job.status !== "running") return job;
      const completed = job.units.filter((unit) => unit.status === "completed").length;
      const failed = job.units.filter((unit) => unit.status === "failed").length;
      if (completed + failed !== job.units.length) throw new Error("Drafting job still has unfinished units");
      const next: DraftingJobStatus = failed === 0 ? "completed" : completed === 0 ? "failed" : "partially_failed";
      assertDraftingJobTransition(job.status, next);
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE drafting_jobs SET status = ?, finished_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`).run(next, now, now, projectId, jobId);
      return this.requireJob(projectId, jobId);
    });
  }

  recoverInterrupted(): number {
    return transaction(this.database, () => {
      const rows = this.database.prepare("SELECT project_id, id FROM drafting_jobs WHERE status = 'running'")
        .all() as Array<{ project_id: string; id: string }>;
      const now = new Date().toISOString();
      const error = JSON.stringify({
        code: "process_interrupted",
        message: "The process stopped while this drafting unit was running.",
        retryable: true,
      });
      for (const row of rows) {
        this.database.prepare(`UPDATE drafting_job_units SET status = 'failed', normalized_error_json = ?,
          finished_at = ?, updated_at = ? WHERE project_id = ? AND job_id = ? AND status = 'running'`)
          .run(error, now, now, row.project_id, row.id);
        this.database.prepare(`UPDATE drafting_unit_attempts SET status = 'failed', normalized_error_json = ?,
          finished_at = ?, updated_at = ? WHERE project_id = ? AND job_id = ? AND status = 'running'`)
          .run(error, now, now, row.project_id, row.id);
        const job = this.requireJob(row.project_id, row.id);
        const next = job.units.some((unit) => unit.status === "completed") ? "partially_failed" : "failed";
        this.database.prepare(`UPDATE drafting_jobs SET status = ?, finished_at = ?, updated_at = ?
          WHERE project_id = ? AND id = ?`).run(next, now, now, row.project_id, row.id);
      }
      return rows.length;
    });
  }

  attemptCount(projectId: string, jobId: string, unitId: string): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM drafting_unit_attempts
      WHERE project_id = ? AND job_id = ? AND unit_id = ?`).get(projectId, jobId, unitId) as { count: number };
    return row.count;
  }

  private finishUnit(
    projectId: string,
    jobId: string,
    unitId: string,
    attemptId: string,
    status: "completed" | "failed",
    result: { usage?: unknown; normalizedError?: unknown },
  ): DraftingJobRecord {
    return transaction(this.database, () => {
      const job = this.requireJob(projectId, jobId);
      const unit = this.requireUnit(job, unitId);
      assertDraftingUnitTransition(unit.status, status);
      const attempt = this.database.prepare(`SELECT id FROM drafting_unit_attempts
        WHERE id = ? AND project_id = ? AND job_id = ? AND unit_id = ? AND status = 'running'`)
        .get(attemptId, projectId, jobId, unitId);
      if (!attempt) throw new Error("Running drafting attempt not found");
      const now = new Date().toISOString();
      const errorJson = result.normalizedError === undefined ? null : JSON.stringify(result.normalizedError);
      const usageJson = result.usage === undefined ? null : JSON.stringify(result.usage);
      this.database.prepare(`UPDATE drafting_job_units SET status = ?, normalized_error_json = ?, usage_json = ?,
        finished_at = ?, updated_at = ? WHERE project_id = ? AND job_id = ? AND unit_id = ?`)
        .run(status, errorJson, usageJson, now, now, projectId, jobId, unitId);
      this.database.prepare(`UPDATE drafting_unit_attempts SET status = ?, normalized_error_json = ?, usage_json = ?,
        finished_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, errorJson, usageJson, now, now, attemptId);
      return this.requireJob(projectId, jobId);
    });
  }

  private mapUnit(row: UnitRow): DraftingJobUnitRecord {
    const passages = this.database.prepare(`SELECT passage_id, passage_plan_version_id
      FROM drafting_plan_unit_passages WHERE project_id = ? AND plan_id = ? AND unit_id = ? ORDER BY position`)
      .all(row.project_id, row.plan_id, row.unit_id) as Array<{
        passage_id: string; passage_plan_version_id: string;
      }>;
    return {
      id: row.unit_id,
      position: row.position,
      passageIds: passages.map((item) => item.passage_id),
      passageVersionIds: passages.map((item) => item.passage_plan_version_id),
      inputFingerprint: row.input_fingerprint,
      estimatedInputTokens: row.estimated_input_tokens,
      estimatedOutputTokens: row.estimated_output_tokens,
      contextFingerprint: row.context_fingerprint || undefined,
      context: row.context_json && row.context_json !== "{}" ? JSON.parse(row.context_json) : undefined,
      contextDiagnostics: JSON.parse(row.context_diagnostics_json),
      projectId: row.project_id,
      planId: row.plan_id,
      jobId: row.job_id,
      status: row.status,
      attemptNumber: row.attempt_number,
      retryOfAttemptId: row.retry_of_attempt_id,
      normalizedError: row.normalized_error_json ? JSON.parse(row.normalized_error_json) : null,
      usage: row.usage_json ? JSON.parse(row.usage_json) : null,
      generatedCandidates: (this.database.prepare(`SELECT provenance.draft_version_id, provenance.passage_id,
          drafts.word_count FROM passage_draft_generation_provenance provenance
        JOIN passage_draft_versions drafts ON drafts.id = provenance.draft_version_id
        WHERE provenance.project_id = ? AND provenance.job_id = ? AND provenance.unit_id = ?
        ORDER BY provenance.passage_id`)
        .all(row.project_id, row.job_id, row.unit_id) as Array<{
          draft_version_id: string; passage_id: string; word_count: number;
        }>).map((item) => ({
          draftVersionId: item.draft_version_id, passageId: item.passage_id, wordCount: item.word_count,
        })),
      executionPolicyId: row.execution_policy_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
    };
  }

  private requireJob(projectId: string, jobId: string): DraftingJobRecord {
    const job = this.getJob(projectId, jobId);
    if (!job) throw new Error("Drafting job not found");
    return job;
  }

  private requireUnit(job: DraftingJobRecord, unitId: string): DraftingJobUnitRecord {
    const unit = job.units.find((item) => item.id === unitId);
    if (!unit) throw new Error("Drafting unit not found");
    return unit;
  }
}

function canonicalRecordJson(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function neighboringDraftVersionsFromContext(context: unknown): Record<string, string> {
  if (!context || typeof context !== "object") return {};
  const acceptedNeighborProse = (context as { acceptedNeighborProse?: unknown }).acceptedNeighborProse;
  if (acceptedNeighborProse === undefined) return {};
  if (!Array.isArray(acceptedNeighborProse)) {
    throw new Error("Persisted drafting context has invalid accepted neighboring prose provenance");
  }
  const versions: Record<string, string> = {};
  for (const neighbor of acceptedNeighborProse) {
    if (!neighbor || typeof neighbor !== "object") {
      throw new Error("Persisted drafting context has invalid accepted neighboring prose provenance");
    }
    const { passageId, draftVersionId } = neighbor as { passageId?: unknown; draftVersionId?: unknown };
    if (typeof passageId !== "string" || !passageId || typeof draftVersionId !== "string" || !draftVersionId
      || passageId in versions) {
      throw new Error("Persisted drafting context has invalid accepted neighboring prose provenance");
    }
    versions[passageId] = draftVersionId;
  }
  return versions;
}
