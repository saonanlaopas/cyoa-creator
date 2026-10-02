import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SOURCE_ANALYSIS_POLICY, SourceAnalysisPlanSchema, SourceUnitOutputSchema, consolidateSourceDossier, correctSourceDossier,
  sourceDigest, validateSourceOutput, type AnalysisSource, type SourceAnalysisPlan, type SourceUnitOutput } from "@story-to-cyoa/domain";
import { ArtifactRepository } from "./artifact-repository.js";
import { WorkflowRepository } from "./workflow-repository.js";
import { transaction, type StoryDatabase } from "./database.js";
import { analysisBindingSource, analysisProvenance, assertAnalysisFresh, validateAnalysisPlan, validateSourceAnalysisDatabase } from "./source-analysis-validation.js";

export type SourceAnalysisStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export interface SourceAnalysisAttempt {
  id: string; number: number; status: Exclude<SourceAnalysisStatus, "pending">;
  contextFingerprint: string; repairCount: number; usage: SourceAnalysisUsage; diagnostic: string;
  startedAt: string; finishedAt: string | null;
}
export interface SourceAnalysisJob {
  id: string; projectId: string; planId: string; status: SourceAnalysisStatus; authorizedFingerprint: string;
  dossierVersionId: string | null; createdAt: string; updatedAt: string;
  units: Array<{ id: string; status: SourceAnalysisStatus; attempts: SourceAnalysisAttempt[] }>;
}
export const SourceAnalysisUsageSchema = z.object({ inputTokens: z.number().int().nonnegative().max(10_000_000),
  outputTokens: z.number().int().nonnegative().max(10_000_000), cost: z.number().finite().nonnegative().nullable() }).strict();
export type SourceAnalysisUsage = z.infer<typeof SourceAnalysisUsageSchema>;
const noUsage: SourceAnalysisUsage = { inputTokens: 0, outputTokens: 0, cost: null };

export class SourceAnalysisRepository {
  private cachedSource: { versionId: string; source: AnalysisSource } | undefined;
  constructor(private readonly database: StoryDatabase) {}
  private atomic<T>(run: () => T): T { return this.database.isTransaction ? run() : transaction(this.database, run); }
  savePlan(value: unknown): SourceAnalysisPlan {
    return this.atomic(() => {
      const plan = validateAnalysisPlan(this.database, value);
      assertAnalysisFresh(this.database, plan);
      this.database.prepare(`INSERT OR IGNORE INTO source_analysis_plans
        (id,project_id,source_version_id,scope_version_id,content_json,created_at) VALUES (?,?,?,?,?,?)`)
        .run(plan.id, plan.binding.projectId, plan.binding.sourceVersionId, plan.binding.scopeVersionId, JSON.stringify(plan), new Date().toISOString());
      return this.getPlan(plan.binding.projectId, plan.id);
    });
  }
  getPlan(projectId: string, planId: string): SourceAnalysisPlan {
    const row = this.database.prepare("SELECT content_json FROM source_analysis_plans WHERE project_id = ? AND id = ?").get(projectId, planId) as { content_json: string } | undefined;
    if (!row) throw new Error("source_analysis_plan_missing");
    return SourceAnalysisPlanSchema.parse(JSON.parse(row.content_json));
  }
  source(plan: SourceAnalysisPlan): AnalysisSource {
    if (this.cachedSource?.versionId !== plan.binding.sourceVersionId) this.cachedSource = { versionId: plan.binding.sourceVersionId, source: analysisBindingSource(this.database, plan.binding) };
    return this.cachedSource.source;
  }
  fresh(projectId: string, planId: string): void { assertAnalysisFresh(this.database, this.getPlan(projectId, planId)); }
  createJob(projectId: string, planId: string, authorizedFingerprint: string): SourceAnalysisJob {
    return this.atomic(() => {
      const plan = this.getPlan(projectId, planId);
      this.fresh(projectId, planId);
      if (authorizedFingerprint !== plan.fingerprint) throw new Error("source_analysis_authorization_invalid");
      if (this.database.prepare("SELECT 1 FROM source_analysis_jobs WHERE project_id = ? AND plan_id = ? AND status IN ('pending','running')").get(projectId, planId)) throw new Error("source_analysis_already_active");
      const id = randomUUID(), now = new Date().toISOString();
      this.database.prepare(`INSERT INTO source_analysis_jobs (id,project_id,plan_id,status,authorized_fingerprint,dossier_version_id,created_at,updated_at)
        VALUES (?,?,?,'pending',?,NULL,?,?)`).run(id, projectId, planId, authorizedFingerprint, now, now);
      for (const unit of plan.units) this.database.prepare("INSERT INTO source_analysis_units VALUES (?,?,?,'pending')").run(projectId, id, unit.id);
      return this.getJob(projectId, id);
    });
  }
  getJob(projectId: string, jobId: string): SourceAnalysisJob {
    const row = this.database.prepare("SELECT * FROM source_analysis_jobs WHERE project_id = ? AND id = ?").get(projectId, jobId) as
      { id: string; project_id: string; plan_id: string; status: SourceAnalysisStatus; authorized_fingerprint: string; dossier_version_id: string | null; created_at: string; updated_at: string } | undefined;
    if (!row) throw new Error("source_analysis_job_missing");
    const units = this.database.prepare("SELECT unit_id,status FROM source_analysis_units WHERE project_id = ? AND job_id = ? ORDER BY unit_id").all(projectId, jobId) as Array<{ unit_id: string; status: SourceAnalysisStatus }>;
    const attempts = this.database.prepare("SELECT * FROM source_analysis_attempts WHERE project_id = ? AND job_id = ? ORDER BY number").all(projectId, jobId) as Array<{
      id: string; unit_id: string; number: number; status: SourceAnalysisAttempt["status"]; context_fingerprint: string; repair_count: number; usage_json: string; diagnostic: string; started_at: string; finished_at: string | null;
    }>;
    return { id: row.id, projectId, planId: row.plan_id, status: row.status, authorizedFingerprint: row.authorized_fingerprint,
      dossierVersionId: row.dossier_version_id, createdAt: row.created_at, updatedAt: row.updated_at,
      units: units.map((u) => ({ id: u.unit_id, status: u.status, attempts: attempts.filter((a) => a.unit_id === u.unit_id).map((a) => ({
        id: a.id, number: a.number, status: a.status, contextFingerprint: a.context_fingerprint, repairCount: a.repair_count,
        usage: SourceAnalysisUsageSchema.parse(JSON.parse(a.usage_json)), diagnostic: a.diagnostic, startedAt: a.started_at, finishedAt: a.finished_at,
      })) })) };
  }
  listJobs(projectId: string): SourceAnalysisJob[] {
    const rows = this.database.prepare("SELECT id FROM source_analysis_jobs WHERE project_id = ? ORDER BY created_at DESC,id DESC").all(projectId) as Array<{ id: string }>;
    return rows.map((r) => this.getJob(projectId, r.id));
  }
  beginAttempt(projectId: string, jobId: string, unitId: string): SourceAnalysisAttempt {
    return this.atomic(() => {
      const job = this.getJob(projectId, jobId), plan = this.getPlan(projectId, job.planId);
      this.fresh(projectId, plan.id);
      if (!["pending", "running"].includes(job.status)) throw new Error("source_analysis_job_not_runnable");
      const unit = job.units.find((u) => u.id === unitId), definition = plan.units.find((u) => u.id === unitId);
      if (!unit || !definition || unit.status !== "pending" || unit.attempts.length >= SOURCE_ANALYSIS_POLICY.maxAttempts
        || (unit.attempts.length && unit.attempts.at(-1)?.status !== "failed")) throw new Error("source_analysis_attempt_not_allowed");
      const attemptId = randomUUID();
      this.database.prepare(`INSERT INTO source_analysis_attempts (id,project_id,job_id,unit_id,number,status,context_fingerprint,repair_count,usage_json,diagnostic,started_at,finished_at)
        VALUES (?,?,?,?,?,'running',?,0,?,'',?,NULL)`).run(attemptId, projectId, jobId, unitId, unit.attempts.length + 1,
          definition.contextFingerprint, JSON.stringify(noUsage), new Date().toISOString());
      this.database.prepare("UPDATE source_analysis_units SET status = 'running' WHERE project_id = ? AND job_id = ? AND unit_id = ?").run(projectId, jobId, unitId);
      this.setJob(projectId, jobId, "running");
      return this.getJob(projectId, jobId).units.find((u) => u.id === unitId)!.attempts.at(-1)!;
    });
  }
  finishAttempt(projectId: string, jobId: string, unitId: string, attemptId: string, outcome: {
    status: "completed" | "failed" | "cancelled"; output?: SourceUnitOutput; repairCount?: number; usage?: SourceAnalysisUsage; diagnostic?: "provider_failed" | "invalid_output" | "cancelled" | "interrupted" | "stale";
  }): void {
    this.atomic(() => {
      const job = this.getJob(projectId, jobId), plan = this.getPlan(projectId, job.planId);
      const unit = job.units.find((u) => u.id === unitId), attempt = unit?.attempts.at(-1), definition = plan.units.find((u) => u.id === unitId);
      if (!unit || unit.status !== "running" || attempt?.id !== attemptId || attempt.status !== "running" || !definition || job.status !== "running") throw new Error("source_analysis_attempt_lifecycle_invalid");
      let output: SourceUnitOutput | undefined;
      if (outcome.status === "completed") {
        this.fresh(projectId, plan.id);
        output = validateSourceOutput(this.source(plan), plan, definition, outcome.output);
        const ids = new Map(output.observations.map((o) => [o.id, `so_${sourceDigest({ unitId, id: o.id }).slice(0, 32)}`]));
        output = SourceUnitOutputSchema.parse({ ...output, observations: output.observations.map((o) => ({ ...o, id: ids.get(o.id)!, references: o.references.map((r) => ids.get(r)!) })) });
      } else if (outcome.output) throw new Error("source_analysis_terminal_output_invalid");
      const repairs = z.number().int().min(0).max(1).parse(outcome.repairCount ?? 0);
      const diagnostic = z.enum(["", "provider_failed", "invalid_output", "cancelled", "interrupted", "stale"]).parse(outcome.diagnostic ?? "");
      this.database.prepare("UPDATE source_analysis_attempts SET status = ?,repair_count = ?,usage_json = ?,diagnostic = ?,finished_at = ? WHERE id = ?")
        .run(outcome.status, repairs, JSON.stringify(SourceAnalysisUsageSchema.parse(outcome.usage ?? noUsage)), diagnostic, new Date().toISOString(), attemptId);
      if (output) this.database.prepare("INSERT INTO source_analysis_outputs VALUES (?,?,?,?,?,?)").run(randomUUID(), projectId, jobId, unitId, attemptId, JSON.stringify(output));
      this.database.prepare("UPDATE source_analysis_units SET status = ? WHERE project_id = ? AND job_id = ? AND unit_id = ?").run(outcome.status, projectId, jobId, unitId);
    });
  }
  retry(projectId: string, jobId: string): SourceAnalysisJob {
    return this.atomic(() => {
      const job = this.getJob(projectId, jobId); this.fresh(projectId, job.planId);
      if (!["failed", "pending"].includes(job.status)) throw new Error("source_analysis_retry_not_allowed");
      const retryable = job.units.filter((u) => u.status === "failed" && u.attempts.length < SOURCE_ANALYSIS_POLICY.maxAttempts);
      if (job.units.some((u) => u.status === "failed" && !retryable.includes(u))) throw new Error("source_analysis_attempts_exhausted: preview a new run");
      for (const unit of retryable) this.database.prepare("UPDATE source_analysis_units SET status = 'pending' WHERE project_id = ? AND job_id = ? AND unit_id = ?").run(projectId, jobId, unit.id);
      this.setJob(projectId, jobId, "pending"); return this.getJob(projectId, jobId);
    });
  }
  settle(projectId: string, jobId: string): SourceAnalysisJob {
    return this.atomic(() => {
      const job = this.getJob(projectId, jobId);
      if (job.status === "cancelled" || job.status === "completed") return job;
      if (job.units.some((u) => u.status === "running")) throw new Error("source_analysis_still_running");
      if (job.units.every((u) => u.status === "completed")) {
        const plan = this.getPlan(projectId, job.planId); this.fresh(projectId, plan.id);
        this.setJob(projectId, jobId, "completed");
        const dossier = consolidateSourceDossier(plan, jobId, analysisProvenance(this.database, plan, jobId));
        const version = new ArtifactRepository(this.database).saveArtifactInTransaction({ projectId, artifactId: "source-dossier", artifactType: "source-dossier", content: dossier, dependencies: ["source", "source-scope"] });
        new WorkflowRepository(this.database).markDraft(projectId, "source-dossier");
        this.database.prepare("UPDATE source_analysis_jobs SET dossier_version_id = ? WHERE project_id = ? AND id = ?").run(version.id, projectId, jobId);
      } else this.setJob(projectId, jobId, job.units.some((u) => u.status === "failed") ? "failed" : "pending");
      return this.getJob(projectId, jobId);
    });
  }
  cancel(projectId: string, jobId: string): SourceAnalysisJob {
    return this.atomic(() => {
      const job = this.getJob(projectId, jobId);
      if (["completed", "cancelled"].includes(job.status)) throw new Error("source_analysis_cancel_not_allowed");
      for (const unit of job.units) {
        if (unit.status === "running") this.finishAttempt(projectId, jobId, unit.id, unit.attempts.at(-1)!.id, { status: "cancelled", diagnostic: "cancelled" });
        else if (["pending", "failed"].includes(unit.status)) this.database.prepare("UPDATE source_analysis_units SET status = 'cancelled' WHERE project_id = ? AND job_id = ? AND unit_id = ?").run(projectId, jobId, unit.id);
      }
      this.setJob(projectId, jobId, "cancelled"); return this.getJob(projectId, jobId);
    });
  }
  recoverInterrupted(projectId?: string, jobId?: string): void {
    const rows = this.database.prepare(`SELECT project_id,id FROM source_analysis_jobs WHERE status = 'running'${projectId ? " AND project_id = ?" : ""}${jobId ? " AND id = ?" : ""}`)
      .all(...(projectId ? [projectId] : []), ...(jobId ? [jobId] : [])) as Array<{ project_id: string; id: string }>;
    for (const row of rows) this.atomic(() => {
      const job = this.getJob(row.project_id, row.id);
      for (const unit of job.units.filter((u) => u.status === "running")) this.finishAttempt(row.project_id, row.id, unit.id, unit.attempts.at(-1)!.id, { status: "failed", diagnostic: "interrupted" });
      // Reopen never calls a provider or auto-publishes; explicit Resume completes consolidation too.
      this.setJob(row.project_id, row.id, "failed");
    });
  }
  correct(projectId: string, previousVersionId: string, value: unknown) {
    return this.atomic(() => {
      const artifacts = new ArtifactRepository(this.database);
      const previous = artifacts.getCurrent(projectId, "source-dossier");
      if (!previous || previous.id !== previousVersionId) throw new Error("source_correction_stale_version");
      const dossier = validateDossierPersistenceImport(this.database, projectId, previous.content);
      this.fresh(projectId, dossier.planId);
      const corrected = correctSourceDossier(dossier, value, analysisBindingSource(this.database, dossier.binding));
      if (corrected.corrections.at(-1)?.previousVersionId !== previousVersionId) throw new Error("source_correction_previous_version_invalid");
      const version = artifacts.saveArtifactInTransaction({ projectId, artifactId: "source-dossier", artifactType: "source-dossier", content: corrected, dependencies: ["source", "source-scope"] });
      new WorkflowRepository(this.database).markDraft(projectId, "source-dossier"); return version;
    });
  }
  validateProject(projectId: string): void { validateSourceAnalysisDatabase(this.database, projectId); }
  failJob(projectId: string, jobId: string): void {
    this.atomic(() => {
      const job = this.getJob(projectId, jobId);
      if (["completed", "cancelled"].includes(job.status) || job.units.some((u) => u.status === "running")) throw new Error("source_analysis_failure_transition_invalid");
      this.setJob(projectId, jobId, "failed");
    });
  }
  private setJob(projectId: string, jobId: string, status: SourceAnalysisStatus): void {
    this.database.prepare("UPDATE source_analysis_jobs SET status = ?,updated_at = ? WHERE project_id = ? AND id = ?").run(status, new Date().toISOString(), projectId, jobId);
  }
}

import { validateDossierPersistence as validateDossierPersistenceImport } from "./source-analysis-validation.js";
