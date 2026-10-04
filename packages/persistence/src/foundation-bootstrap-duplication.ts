import { randomUUID } from "node:crypto";
import { FOUNDATION_ARTIFACT_IDS, sourceCanonicalJson, sourceDigest, type FoundationBootstrapContext, type FoundationArtifactId, type SourceDossier } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { FOUNDATION_BOOTSTRAP_TABLES } from "./foundation-bootstrap-schema.js";
import { FoundationBootstrapJobSchema, FoundationBootstrapPlanSchema, FoundationBootstrapApplicationSchema } from "./foundation-bootstrap-repository.js";

export function copyFoundationBootstrapRows(database: StoryDatabase, projectId: string, ids: Map<string, string>) {
  const copyId = ids.get(projectId)!;
  type Row = Record<string, string | number | null>;
  const tables = Object.fromEntries(FOUNDATION_BOOTSTRAP_TABLES.map((table) => [table, database.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`).all(projectId) as Row[]]));
  for (const rows of Object.values(tables)) for (const row of rows) ids.set(String(row.id), randomUUID());
  for (const row of tables.foundation_bootstrap_jobs!) for (const attempt of FoundationBootstrapJobSchema.parse(JSON.parse(String(row.content_json))).units[0].attempts) ids.set(attempt.id, randomUUID());
  const remapKeys = new Set(["id", "projectId", "planId", "jobId", "candidateId", "attemptId", "conversationId", "messageIds", "decisionIds", "dossierVersionId", "intentVersionId", "sourceRecordIds", "correctionIds", "overrideIds", "inventionIds", "obligationId", "versionId", "targetId"]);
  const remap = (value: unknown, key = ""): unknown => typeof value === "string" ? remapKeys.has(key) ? ids.get(value) ?? value : value
    : Array.isArray(value) ? value.map((item) => remap(item, key)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remap(item, name)])) : value;
  const artifact = (versionId: string) => {
    const row = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id=? AND id=?").get(copyId, versionId) as { content_json: string } | undefined;
    if (!row) throw new Error("bootstrap_duplicate_artifact_missing"); return JSON.parse(row.content_json);
  };
  for (const row of tables.foundation_bootstrap_plans!) {
    const previous = FoundationBootstrapPlanSchema.parse(JSON.parse(String(row.content_json))), plan = remap(previous) as typeof previous;
    plan.context.dossier = artifact(plan.context.dossierVersionId) as SourceDossier;
    previous.context.dossier.corrections.forEach((correction, index) => ids.set(correction.id, plan.context.dossier.corrections[index]!.id));
    plan.context.intent = artifact(plan.context.intentVersionId);
    for (const key of Object.keys(plan.context.baseVersionIds) as FoundationArtifactId[]) {
      const oldId = previous.context.baseVersionIds[key], versionId = oldId ? ids.get(oldId)! : null;
      plan.context.baseVersionIds[key] = versionId; plan.context.baseArtifacts[key] = versionId ? artifact(versionId) : null;
    }
    plan.contextFingerprint = sourceDigest(plan.context);
    plan.fingerprint = sourceDigest({ contextFingerprint: plan.contextFingerprint, units: plan.units, providerId: plan.providerId, modelId: plan.modelId });
    plan.contextBytes = Buffer.byteLength(sourceCanonicalJson(plan.context)); plan.estimatedInputTokens = Math.ceil(plan.contextBytes / 4);
    ids.set(previous.contextFingerprint, plan.contextFingerprint); ids.set(previous.fingerprint, plan.fingerprint);
    database.prepare("INSERT INTO foundation_bootstrap_plans VALUES(?,?,?)").run(plan.id, copyId, JSON.stringify(plan));
  }
  for (const row of tables.foundation_bootstrap_jobs!) {
    const job = remap(JSON.parse(String(row.content_json))) as ReturnType<typeof FoundationBootstrapJobSchema.parse>;
    job.authorizedFingerprint = ids.get(job.authorizedFingerprint)!;
    job.units[0].attempts.forEach((attempt) => { attempt.contextFingerprint = ids.get(attempt.contextFingerprint)!; });
    database.prepare("INSERT INTO foundation_bootstrap_jobs VALUES(?,?,?,?)").run(job.id, copyId, job.planId, JSON.stringify(job));
  }
  for (const row of tables.foundation_bootstrap_candidates!) {
    const candidate = remap(JSON.parse(String(row.content_json))) as { artifacts: FoundationBootstrapContext["baseArtifacts"] };
    const applicationRows = tables.foundation_bootstrap_applications!.filter((application) => application.job_id === row.job_id);
    for (const applicationRow of applicationRows) {
      const application = FoundationBootstrapApplicationSchema.parse(JSON.parse(String(applicationRow.content_json)));
      for (const [key, value] of Object.entries(application.artifactVersionIds)) candidate.artifacts[key as FoundationArtifactId] = artifact(ids.get(value)!);
    }
    database.prepare("INSERT INTO foundation_bootstrap_candidates VALUES(?,?,?,?,?)").run(ids.get(String(row.id))!, copyId, ids.get(String(row.job_id))!, ids.get(String(row.attempt_id))!, JSON.stringify(candidate));
  }
  const priorApplied = new Map<string, Partial<Record<FoundationArtifactId, string>>>();
  for (const row of tables.foundation_bootstrap_applications!) {
    const application = remap(JSON.parse(String(row.content_json))) as ReturnType<typeof FoundationBootstrapApplicationSchema.parse>;
    for (const key of Object.keys(application.artifactVersionIds) as FoundationArtifactId[]) application.artifactVersionIds[key] = ids.get(application.artifactVersionIds[key]!)!;
    for (const key of Object.keys(application.previousVersionIds) as FoundationArtifactId[]) if (application.previousVersionIds[key]) application.previousVersionIds[key] = ids.get(application.previousVersionIds[key]!)!;
    const jobRow = database.prepare("SELECT content_json FROM foundation_bootstrap_jobs WHERE id=?").get(application.jobId) as { content_json: string };
    const job = FoundationBootstrapJobSchema.parse(JSON.parse(jobRow.content_json));
    const selected = FOUNDATION_ARTIFACT_IDS.filter((artifactId) => application.artifactVersionIds[artifactId]);
    const applied = priorApplied.get(job.id) ?? {};
    application.fingerprint = sourceDigest({ plan: job.authorizedFingerprint, candidateId: application.candidateId, applied, effectiveArtifactIds: selected });
    priorApplied.set(job.id, { ...applied, ...application.artifactVersionIds });
    database.prepare("INSERT INTO foundation_bootstrap_applications VALUES(?,?,?,?)").run(application.id, copyId, application.jobId, JSON.stringify(application));
  }
}
