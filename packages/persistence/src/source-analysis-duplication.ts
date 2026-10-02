import { randomUUID } from "node:crypto";
import { planSourceAnalysis, sourceBinding, sourceDigest, consolidateSourceDossier, correctSourceDossier,
  type AnalysisSource, type SourceAnalysisPlan, type SourceDossier } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { analysisBindingSource, analysisProvenance } from "./source-analysis-validation.js";

export const SOURCE_ANALYSIS_TABLES = ["source_analysis_plans", "source_analysis_jobs", "source_analysis_units",
  "source_analysis_attempts", "source_analysis_outputs"] as const;

/** Prepare every project-owned identity before copying any rows; chapter/excerpt IDs remain content-owned. */
export function prepareSourceAnalysisDuplicate(database: StoryDatabase, projectId: string, copyId: string, ids: Map<string, string>): void {
  const plans = database.prepare("SELECT content_json FROM source_analysis_plans WHERE project_id = ?").all(projectId) as Array<{ content_json: string }>;
  for (const row of plans) {
    const plan = JSON.parse(row.content_json) as SourceAnalysisPlan;
    const source = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(plan.binding.sourceVersionId) as { content_json: string };
    const normalized = JSON.parse(source.content_json) as AnalysisSource;
    const binding = sourceBinding(copyId, ids.get(plan.binding.sourceVersionId)!, ids.get(plan.binding.scopeVersionId)!, normalized, plan.binding.chapterIds);
    ids.set(plan.binding.scopeFingerprint, binding.scopeFingerprint);
    const copied = planSourceAnalysis(binding, normalized, plan.providerId, plan.modelId);
    ids.set(plan.id, copied.id); ids.set(plan.fingerprint, copied.fingerprint);
    plan.units.forEach((u, i) => {
      const next = copied.units[i]!;
      ids.set(u.id, next.id); ids.set(u.inputFingerprint, next.inputFingerprint); ids.set(u.contextFingerprint, next.contextFingerprint);
    });
  }
  for (const table of ["source_analysis_jobs", "source_analysis_attempts", "source_analysis_outputs"]) {
    for (const row of database.prepare(`SELECT id FROM ${table} WHERE project_id = ?`).all(projectId) as Array<{ id: string }>) ids.set(row.id, randomUUID());
  }
  const outputs = database.prepare("SELECT content_json FROM source_analysis_outputs WHERE project_id = ?").all(projectId) as Array<{ content_json: string }>;
  for (const output of outputs) {
    const value = JSON.parse(output.content_json) as { observations: Array<{ id: string }> };
    value.observations.forEach((o) => ids.set(o.id, `so_${randomUUID()}`));
  }
  const dossiers = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'source-dossier'").all(projectId) as Array<{ content_json: string }>;
  for (const row of dossiers) {
    const dossier = JSON.parse(row.content_json) as SourceDossier;
    for (const provenance of dossier.provenance) {
      const o = provenance.original;
      const material = { category: o.category, identityKey: o.identityKey, field: o.field, claim: o.claim, classification: o.classification, uncertainty: o.uncertainty };
      ids.set(`sr_${sourceDigest({ projectId, material }).slice(0, 32)}`, `sr_${sourceDigest({ projectId: copyId, material }).slice(0, 32)}`);
    }
    for (const record of dossier.records) if (!ids.has(record.id)) ids.set(record.id, `sr_${randomUUID()}`);
  }
}

const projectOwnedKeys = new Set(["id", "projectId", "sourceVersionId", "scopeVersionId", "scopeFingerprint", "planId", "jobId", "unitId", "attemptId",
  "inputFingerprint", "contextFingerprint", "fingerprint", "observationId", "recordId", "recordIds", "targetId", "previousVersionId", "references", "observationIds", "replacementIds"]);
export function remapSourceAnalysisValue(value: unknown, ids: Map<string, string>, key = ""): unknown {
  // Claims, aliases, reasons and content-owned chapter/excerpt IDs are not project references.
  if (typeof value === "string") return projectOwnedKeys.has(key) ? ids.get(value) ?? value : value;
  if (Array.isArray(value)) return value.map((v) => remapSourceAnalysisValue(v, ids, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapSourceAnalysisValue(v, ids, k)]));
  return value;
}

export function copySourceAnalysisRows(database: StoryDatabase, projectId: string, ids: Map<string, string>): void {
  database.exec("PRAGMA defer_foreign_keys = ON");
  for (const table of SOURCE_ANALYSIS_TABLES) {
    const rows = database.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY rowid`).all(projectId) as Array<Record<string, string | number | null>>;
    for (const row of rows) {
      const mapped = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k.endsWith("_json") && typeof v === "string"
        ? JSON.stringify(remapSourceAnalysisValue(JSON.parse(v), ids)) : typeof v === "string" ? ids.get(v) ?? v : v]));
      if (table === "source_analysis_plans") {
        const plan = JSON.parse(String(mapped.content_json)) as SourceAnalysisPlan;
        mapped.content_json = JSON.stringify(planSourceAnalysis(plan.binding, analysisBindingSource(database, plan.binding), plan.providerId, plan.modelId));
      }
      const columns = Object.keys(mapped);
      database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((k) => mapped[k]));
    }
  }
}

export function remapSourceDossierContent(database: StoryDatabase, content: SourceDossier, ids: Map<string, string>): SourceDossier {
  const row = database.prepare("SELECT content_json FROM source_analysis_plans WHERE id = ?").get(ids.get(content.planId)!) as { content_json: string };
  const plan = JSON.parse(row.content_json) as SourceAnalysisPlan;
  let dossier = consolidateSourceDossier(plan, ids.get(content.jobId)!, analysisProvenance(database, plan, ids.get(content.jobId)!));
  for (const correction of content.corrections) dossier = correctSourceDossier(dossier,
    remapSourceAnalysisValue(correction.operation, ids), analysisBindingSource(database, plan.binding));
  return dossier;
}
