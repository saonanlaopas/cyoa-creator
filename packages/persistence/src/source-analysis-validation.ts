import { AnalysisSourceSchema, SourceAnalysisPlanSchema, SourceDossierSchema, SourceUnitOutputSchema,
  SOURCE_ANALYSIS_POLICY, assertSourceDossier, consolidateSourceDossier, correctSourceDossier,
  planSourceAnalysis, sourceBinding, sourceCanonicalJson, validateSourceOutput,
  type SourceAnalysisPlan, type SourceBinding, type SourceDossier, type SourceProvenance,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";

export function analysisBindingSource(database: StoryDatabase, binding: SourceBinding) {
  const row = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_id = 'source' AND artifact_type = 'source'")
    .get(binding.projectId, binding.sourceVersionId) as { content_json: string } | undefined;
  const scope = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_id = 'source-scope' AND artifact_type = 'source-scope'")
    .get(binding.projectId, binding.scopeVersionId) as { content_json: string } | undefined;
  if (!row || !scope) throw new Error("source_analysis_binding_missing");
  const source = AnalysisSourceSchema.parse(JSON.parse(row.content_json));
  const selected = JSON.parse(scope.content_json) as { chapterIds: string[]; sourceVersionId?: string };
  if (selected.sourceVersionId && selected.sourceVersionId !== binding.sourceVersionId) throw new Error("source_analysis_scope_source_mismatch");
  if (sourceCanonicalJson(sourceBinding(binding.projectId, binding.sourceVersionId, binding.scopeVersionId, source, selected.chapterIds)) !== sourceCanonicalJson(binding)) throw new Error("source_analysis_binding_invalid");
  return source;
}
export function assertAnalysisFresh(database: StoryDatabase, plan: SourceAnalysisPlan): void {
  for (const [artifactId, versionId] of [["source", plan.binding.sourceVersionId], ["source-scope", plan.binding.scopeVersionId]]) {
    const row = database.prepare("SELECT id,stale FROM artifact_versions WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1")
      .get(plan.binding.projectId, artifactId) as { id: string; stale: number } | undefined;
    if (!row || row.id !== versionId || row.stale) throw new Error("source_analysis_stale: import/select scope and preview a new analysis");
  }
}
export function validateAnalysisPlan(database: StoryDatabase, value: unknown): SourceAnalysisPlan {
  const plan = SourceAnalysisPlanSchema.parse(value);
  const source = analysisBindingSource(database, plan.binding);
  if (sourceCanonicalJson(planSourceAnalysis(plan.binding, source, plan.providerId, plan.modelId)) !== sourceCanonicalJson(plan)) throw new Error("source_analysis_plan_invalid");
  return plan;
}
export function analysisProvenance(database: StoryDatabase, plan: SourceAnalysisPlan, jobId: string): SourceProvenance[] {
  const source = analysisBindingSource(database, plan.binding);
  const rows = database.prepare(`SELECT outputs.*,attempts.context_fingerprint,attempts.status
    FROM source_analysis_outputs outputs JOIN source_analysis_attempts attempts ON attempts.id = outputs.attempt_id
    WHERE outputs.project_id = ? AND outputs.job_id = ? ORDER BY outputs.unit_id`).all(plan.binding.projectId, jobId) as
    Array<{ unit_id: string; attempt_id: string; content_json: string; context_fingerprint: string; status: string }>;
  return rows.flatMap((row) => {
    const unit = plan.units.find((u) => u.id === row.unit_id);
    if (!unit || row.status !== "completed" || row.context_fingerprint !== unit.contextFingerprint) throw new Error("source_output_lineage_invalid");
    const output = validateSourceOutput(source, plan, unit, SourceUnitOutputSchema.parse(JSON.parse(row.content_json)));
    return output.observations.map((original) => ({ observationId: original.id, jobId, unitId: unit.id,
      attemptId: row.attempt_id, providerId: plan.providerId, modelId: plan.modelId, contextFingerprint: unit.contextFingerprint, original }));
  });
}
export function validateDossierPersistence(database: StoryDatabase, projectId: string, value: unknown): SourceDossier {
  const dossier = SourceDossierSchema.parse(value);
  if (projectId !== dossier.projectId) throw new Error("source_dossier_project_invalid");
  const row = database.prepare("SELECT content_json FROM source_analysis_plans WHERE project_id = ? AND id = ?").get(projectId, dossier.planId) as { content_json: string } | undefined;
  const job = database.prepare("SELECT plan_id,status FROM source_analysis_jobs WHERE project_id = ? AND id = ?").get(projectId, dossier.jobId) as { plan_id: string; status: string } | undefined;
  if (!row || !job || job.plan_id !== dossier.planId || job.status !== "completed") throw new Error("source_dossier_job_invalid");
  const plan = validateAnalysisPlan(database, JSON.parse(row.content_json));
  const source = analysisBindingSource(database, plan.binding);
  assertSourceDossier(dossier, source, plan.binding);
  let expected = consolidateSourceDossier(plan, dossier.jobId, analysisProvenance(database, plan, dossier.jobId));
  for (const correction of dossier.corrections) {
    const previous = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'source-dossier' AND id = ?")
      .get(projectId, correction.previousVersionId) as { content_json: string } | undefined;
    if (!previous || sourceCanonicalJson(JSON.parse(previous.content_json)) !== sourceCanonicalJson(expected)) throw new Error("source_correction_previous_version_invalid");
    expected = correctSourceDossier(expected, correction.operation, source);
  }
  if (sourceCanonicalJson(expected) !== sourceCanonicalJson(dossier)) throw new Error("source_dossier_not_derived_from_immutable_observations");
  return dossier;
}
export function validateSourceAnalysisDatabase(database: StoryDatabase, projectId?: string): void {
  const plans = database.prepare(`SELECT project_id,id,content_json FROM source_analysis_plans ${projectId ? "WHERE project_id = ?" : ""}`)
    .all(...(projectId ? [projectId] : [])) as Array<{ project_id: string; id: string; content_json: string }>;
  for (const row of plans) {
    const plan = validateAnalysisPlan(database, JSON.parse(row.content_json));
    if (row.id !== plan.id || row.project_id !== plan.binding.projectId) throw new Error("source_analysis_plan_lineage_invalid");
    const jobs = database.prepare("SELECT * FROM source_analysis_jobs WHERE project_id = ? AND plan_id = ?").all(row.project_id, row.id) as Array<{ id: string; status: string; authorized_fingerprint: string; dossier_version_id: string | null }>;
    for (const job of jobs) {
      if (job.authorized_fingerprint !== plan.fingerprint) throw new Error("source_analysis_authorization_invalid");
      const units = database.prepare("SELECT unit_id,status FROM source_analysis_units WHERE project_id = ? AND job_id = ?").all(row.project_id, job.id) as Array<{ unit_id: string; status: string }>;
      if (units.length !== plan.units.length || units.some((u) => !plan.units.some((p) => p.id === u.unit_id))) throw new Error("source_analysis_units_invalid");
      for (const unit of units) {
        const definition = plan.units.find((u) => u.id === unit.unit_id)!;
        const attempts = database.prepare("SELECT * FROM source_analysis_attempts WHERE project_id = ? AND job_id = ? AND unit_id = ? ORDER BY number")
          .all(row.project_id, job.id, unit.unit_id) as Array<{ id: string; number: number; status: string; context_fingerprint: string; finished_at: string | null }>;
        const latest = attempts.at(-1);
        if (attempts.length > SOURCE_ANALYSIS_POLICY.maxAttempts || attempts.some((a, i) => a.number !== i + 1 || a.context_fingerprint !== definition.contextFingerprint
          || (a.status === "running") !== (a.finished_at === null) || (i < attempts.length - 1 && a.status !== "failed"))
          || (unit.status === "pending" ? latest && latest.status !== "failed" : unit.status === "cancelled" ? latest && !["failed", "cancelled"].includes(latest.status) : latest?.status !== unit.status)) throw new Error("source_analysis_unit_lifecycle_invalid");
        const output = database.prepare("SELECT attempt_id FROM source_analysis_outputs WHERE project_id = ? AND job_id = ? AND unit_id = ?")
          .get(row.project_id, job.id, unit.unit_id) as { attempt_id: string } | undefined;
        if ((unit.status === "completed") !== Boolean(output) || (output && output.attempt_id !== latest?.id)) throw new Error("source_analysis_output_lifecycle_invalid");
      }
      if (job.status === "completed" && units.some((u) => u.status !== "completed")) throw new Error("source_analysis_job_lifecycle_invalid");
      analysisProvenance(database, plan, job.id);
      if (job.dossier_version_id) {
        const dossier = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'source-dossier' AND id = ?")
          .get(row.project_id, job.dossier_version_id) as { content_json: string } | undefined;
        if (!dossier || JSON.parse(dossier.content_json).jobId !== job.id) throw new Error("source_analysis_dossier_lineage_invalid");
      }
    }
  }
  const dossiers = database.prepare(`SELECT project_id,content_json FROM artifact_versions WHERE artifact_id = 'source-dossier' ${projectId ? "AND project_id = ?" : ""}`)
    .all(...(projectId ? [projectId] : [])) as Array<{ project_id: string; content_json: string }>;
  for (const row of dossiers) validateDossierPersistence(database, row.project_id, JSON.parse(row.content_json));
}
