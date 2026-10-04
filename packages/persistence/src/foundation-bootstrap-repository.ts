import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FOUNDATION_ARTIFACT_IDS, FOUNDATION_BOOTSTRAP_LIMITS, FoundationBootstrapContextSchema, FoundationArtifactVersionsSchema,
  parseFoundationBootstrapCandidate, sourceCanonicalJson, sourceDigest, type FoundationArtifactId, type FoundationBootstrapContext,
  type FoundationBootstrapCandidate } from "@story-to-cyoa/domain";
import { ArtifactRepository } from "./artifact-repository.js";
import { WorkflowRepository } from "./workflow-repository.js";
import { assertAdaptationFresh, validateAdaptationIntent } from "./adaptation-intent-validation.js";
import { validateDossierPersistence } from "./source-analysis-validation.js";
import { transaction, type StoryDatabase } from "./database.js";

const id = z.string().min(1).max(240), digest = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
export const FoundationBootstrapPlanSchema = z.object({ id, projectId: id, context: FoundationBootstrapContextSchema,
  contextFingerprint: digest, fingerprint: digest, createdAt: z.string(), contextBytes: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(), cost: z.number().nonnegative().nullable(), providerId: id, modelId: id,
  units: z.tuple([z.object({ id: z.literal("foundations"), artifactIds: z.array(z.enum(FOUNDATION_ARTIFACT_IDS)).length(6) }).strict()]),
}).strict();
export type FoundationBootstrapPlan = z.infer<typeof FoundationBootstrapPlanSchema>;
const AttemptSchema = z.object({ id, number: z.number().int().min(1).max(4), status: z.enum(["running", "completed", "failed", "cancelled"]),
  contextFingerprint: digest, diagnostic: z.enum(["", "provider_failed", "invalid_output", "stale", "cancelled", "interrupted"]),
  startedAt: z.string(), finishedAt: z.string().nullable() }).strict();
export const FoundationBootstrapJobSchema = z.object({ id, projectId: id, planId: id, status, authorizedFingerprint: digest,
  createdAt: z.string(), updatedAt: z.string(), units: z.tuple([z.object({ id: z.literal("foundations"),
    artifactIds: z.array(z.enum(FOUNDATION_ARTIFACT_IDS)).length(6), status, attempts: z.array(AttemptSchema).max(4) }).strict()]) }).strict();
export type FoundationBootstrapJob = z.infer<typeof FoundationBootstrapJobSchema>;
export const FoundationBootstrapApplicationSchema = z.object({ id, projectId: id, jobId: id, candidateId: id,
  artifactVersionIds: z.record(z.enum(FOUNDATION_ARTIFACT_IDS), id), previousVersionIds: FoundationArtifactVersionsSchema,
  fingerprint: digest, createdAt: z.string() }).strict();
export type FoundationBootstrapApplication = z.infer<typeof FoundationBootstrapApplicationSchema>;
export const FOUNDATION_DEPENDENCIES: Record<FoundationArtifactId, FoundationArtifactId[]> = {
  brief: [], "creative-direction": ["brief"], bible: ["brief", "creative-direction"],
  routes: ["brief", "creative-direction", "bible", "mechanics", "endings"],
  endings: ["brief", "creative-direction", "bible", "mechanics", "routes"], mechanics: ["brief", "creative-direction", "bible"],
};
type JsonRow = { id: string; project_id: string; content_json: string };
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => sourceCanonicalJson(a) === sourceCanonicalJson(b);

export class FoundationBootstrapRepository {
  constructor(readonly database: StoryDatabase) {}
  private atomic<T>(run: () => T): T { return this.database.isTransaction ? run() : transaction(this.database, run); }
  private rows(table: string, projectId: string) { return this.database.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid DESC`).all(projectId) as JsonRow[]; }
  private budget(projectId: string, additional = 0) {
    const rows = this.rows("foundation_bootstrap_plans", projectId);
    if (rows.length >= 64 || rows.reduce((sum, row) => sum + Buffer.byteLength(row.content_json), additional) > 8_000_000) throw new Error("bootstrap_history_budget_exceeded");
  }
  savePlan(value: unknown): FoundationBootstrapPlan {
    return this.atomic(() => {
      const plan = this.validatePlan(value); this.assertFresh(plan); this.budget(plan.projectId, Buffer.byteLength(JSON.stringify(plan)));
      this.database.prepare("INSERT INTO foundation_bootstrap_plans(id,project_id,content_json) VALUES(?,?,?)").run(plan.id, plan.projectId, JSON.stringify(plan)); return plan;
    });
  }
  validatePlan(value: unknown): FoundationBootstrapPlan {
    const plan = FoundationBootstrapPlanSchema.parse(value), context = plan.context;
    if (context.projectId !== plan.projectId || plan.providerId !== context.providerId || plan.modelId !== context.modelId
      || !same(plan.units[0].artifactIds, FOUNDATION_ARTIFACT_IDS) || sourceDigest(context) !== plan.contextFingerprint
      || sourceDigest({ contextFingerprint: plan.contextFingerprint, units: plan.units, providerId: plan.providerId, modelId: plan.modelId }) !== plan.fingerprint
      || plan.contextBytes !== Buffer.byteLength(sourceCanonicalJson(context)) || plan.contextBytes > FOUNDATION_BOOTSTRAP_LIMITS.contextBytes) throw new Error("bootstrap_plan_fingerprint_invalid");
    const artifacts = new ArtifactRepository(this.database);
    const dossier = artifacts.getVersion(context.dossierVersionId), intent = artifacts.getVersion(context.intentVersionId);
    if (!dossier || !intent || dossier.projectId !== plan.projectId || intent.projectId !== plan.projectId
      || dossier.artifactId !== "source-dossier" || intent.artifactId !== "adaptation-intent"
      || !same(dossier.content, context.dossier) || !same(intent.content, context.intent)
      || context.intent.binding.dossierVersionId !== context.dossierVersionId) throw new Error("bootstrap_input_lineage_invalid");
    validateDossierPersistence(this.database, plan.projectId, context.dossier);
    validateAdaptationIntent(this.database, plan.projectId, context.intent);
    for (const [artifactId, version] of [["source-dossier", dossier], ["adaptation-intent", intent]] as const) {
      if (!this.database.prepare("SELECT 1 FROM artifact_version_approvals WHERE project_id=? AND artifact_id=? AND version_id=?").get(plan.projectId, artifactId, version.id)) throw new Error("bootstrap_approved_inputs_required");
    }
    for (const artifactId of FOUNDATION_ARTIFACT_IDS) {
      const baseId = context.baseVersionIds[artifactId], base = baseId ? artifacts.getVersion(baseId) : undefined;
      if (baseId ? !base || base.projectId !== plan.projectId || base.artifactId !== artifactId || !same(base.content, context.baseArtifacts[artifactId]) : context.baseArtifacts[artifactId] !== null) throw new Error("bootstrap_base_lineage_invalid");
    }
    return plan;
  }
  getPlan(projectId: string, planId: string): FoundationBootstrapPlan {
    const row = this.database.prepare("SELECT content_json FROM foundation_bootstrap_plans WHERE project_id=? AND id=?").get(projectId, planId) as { content_json: string } | undefined;
    if (!row) throw new Error("bootstrap_plan_missing");
    const plan = this.validatePlan(JSON.parse(row.content_json));
    if (plan.id !== planId || plan.projectId !== projectId) throw new Error("bootstrap_plan_identity_invalid");
    return plan;
  }
  listPlans(projectId: string) { return this.rows("foundation_bootstrap_plans", projectId).map((row) => this.getPlan(projectId, row.id)); }
  assertFresh(plan: FoundationBootstrapPlan, applied: Partial<Record<FoundationArtifactId, string>> = {}): void {
    const artifacts = new ArtifactRepository(this.database), workflow = new WorkflowRepository(this.database);
    for (const [artifactId, versionId] of [["source-dossier", plan.context.dossierVersionId], ["adaptation-intent", plan.context.intentVersionId]]) {
      const current = artifacts.getCurrent(plan.projectId, artifactId), state = workflow.get(plan.projectId, artifactId);
      if (!current || current.id !== versionId || current.stale || state.status !== "approved" || state.approvedVersionId !== versionId) throw new Error("bootstrap_inputs_stale");
    }
    assertAdaptationFresh(this.database, plan.context.intent);
    for (const artifactId of FOUNDATION_ARTIFACT_IDS) if ((artifacts.getCurrent(plan.projectId, artifactId)?.id ?? null) !== (applied[artifactId] ?? plan.context.baseVersionIds[artifactId])) throw new Error("bootstrap_base_stale");
  }
  createJob(projectId: string, planId: string, fingerprint: string): FoundationBootstrapJob {
    return this.atomic(() => {
      const plan = this.getPlan(projectId, planId); this.assertFresh(plan);
      if (fingerprint !== plan.fingerprint) throw new Error("bootstrap_authorization_invalid");
      if (this.listJobs(projectId).some((job) => ["pending", "running"].includes(job.status))) throw new Error("bootstrap_job_already_active");
      if (this.listJobs(projectId).filter((job) => job.planId === planId).length >= 4) throw new Error("bootstrap_jobs_exhausted_repreview_required");
      const job: FoundationBootstrapJob = { id: randomUUID(), projectId, planId, authorizedFingerprint: fingerprint, status: "pending", createdAt: now(), updatedAt: now(),
        units: [{ id: "foundations", artifactIds: [...FOUNDATION_ARTIFACT_IDS], status: "pending", attempts: [] }] };
      this.database.prepare("INSERT INTO foundation_bootstrap_jobs VALUES(?,?,?,?)").run(job.id, projectId, planId, JSON.stringify(job)); return job;
    });
  }
  validateJob(value: unknown): FoundationBootstrapJob {
    const job = FoundationBootstrapJobSchema.parse(value), plan = this.getPlan(job.projectId, job.planId), unit = job.units[0], latest = unit.attempts.at(-1);
    if (job.authorizedFingerprint !== plan.fingerprint || job.status !== unit.status || !same(unit.artifactIds, FOUNDATION_ARTIFACT_IDS)) throw new Error("bootstrap_job_lineage_invalid");
    if (unit.attempts.some((attempt, index) => attempt.number !== index + 1 || attempt.contextFingerprint !== plan.contextFingerprint
      || (index < unit.attempts.length - 1 && attempt.status !== "failed") || (attempt.status === "running") !== (attempt.finishedAt === null))
      || new Set(unit.attempts.map((attempt) => attempt.id)).size !== unit.attempts.length) throw new Error("bootstrap_attempt_history_invalid");
    if ((unit.status === "running" || unit.status === "completed" || unit.status === "failed") && latest?.status !== unit.status) throw new Error("bootstrap_attempt_outcome_invalid");
    if (unit.status === "pending" && latest && latest.status !== "failed") throw new Error("bootstrap_retry_preparation_invalid");
    if (unit.status === "cancelled" && latest && !["failed", "cancelled"].includes(latest.status)) throw new Error("bootstrap_cancellation_invalid");
    return job;
  }
  getJob(projectId: string, jobId: string) {
    const row = this.database.prepare("SELECT content_json FROM foundation_bootstrap_jobs WHERE project_id=? AND id=?").get(projectId, jobId) as { content_json: string } | undefined;
    if (!row) throw new Error("bootstrap_job_missing");
    const job = this.validateJob(JSON.parse(row.content_json));
    if (job.id !== jobId || job.projectId !== projectId) throw new Error("bootstrap_job_identity_invalid"); return job;
  }
  listJobs(projectId: string) { return this.rows("foundation_bootstrap_jobs", projectId).map((row) => this.getJob(projectId, row.id)); }
  private writeJob(previous: FoundationBootstrapJob, next: FoundationBootstrapJob) {
    this.validateJob(next);
    if (["completed", "cancelled"].includes(previous.status)) throw new Error("bootstrap_job_terminal");
    const prior = previous.units[0].attempts, following = next.units[0].attempts;
    for (let i = 0; i < prior.length; i++) {
      if (prior[i].status !== "running" && !same(prior[i], following[i])) throw new Error("bootstrap_attempt_immutable");
      if (prior[i].status === "running" && (!following[i] || following[i].id !== prior[i].id || following[i].number !== prior[i].number
        || following[i].contextFingerprint !== prior[i].contextFingerprint || following[i].startedAt !== prior[i].startedAt)) throw new Error("bootstrap_attempt_identity_invalid");
    }
    if (following.length < prior.length || following.length > prior.length + 1) throw new Error("bootstrap_attempt_append_invalid");
    next.updatedAt = now();
    const row = this.database.prepare("SELECT content_json FROM foundation_bootstrap_jobs WHERE id=? AND project_id=?").get(previous.id, previous.projectId) as { content_json: string } | undefined;
    if (!row || !same(JSON.parse(row.content_json), previous)) throw new Error("bootstrap_job_concurrent_change");
    const changed = this.database.prepare("UPDATE foundation_bootstrap_jobs SET content_json=? WHERE id=? AND content_json=?").run(JSON.stringify(next), previous.id, row.content_json);
    if (changed.changes !== 1) throw new Error("bootstrap_job_concurrent_change");
    return next;
  }
  begin(projectId: string, jobId: string) {
    return this.atomic(() => {
      const old = this.getJob(projectId, jobId), plan = this.getPlan(projectId, old.planId); this.assertFresh(plan);
      if (old.status !== "pending" || old.units[0].attempts.length >= FOUNDATION_BOOTSTRAP_LIMITS.attempts) throw new Error("bootstrap_attempt_not_allowed");
      const next = structuredClone(old); next.status = next.units[0].status = "running";
      next.units[0].attempts.push({ id: randomUUID(), number: next.units[0].attempts.length + 1, status: "running", contextFingerprint: plan.contextFingerprint, diagnostic: "", startedAt: now(), finishedAt: null });
      return this.writeJob(old, next);
    });
  }
  finish(projectId: string, jobId: string, attemptId: string, outcome: "completed" | "failed", value?: unknown, diagnostic: z.infer<typeof AttemptSchema>["diagnostic"] = "") {
    return this.atomic(() => {
      const old = this.getJob(projectId, jobId), plan = this.getPlan(projectId, old.planId);
      if (old.status !== "running" || old.units[0].attempts.at(-1)?.id !== attemptId) throw new Error("bootstrap_attempt_not_running");
      if (outcome === "completed") {
        this.assertFresh(plan);
        const candidate = parseFoundationBootstrapCandidate(value, plan.context);
        this.database.prepare("INSERT INTO foundation_bootstrap_candidates VALUES(?,?,?,?,?)").run(randomUUID(), projectId, jobId, attemptId, JSON.stringify(candidate));
      } else if (value !== undefined) throw new Error("bootstrap_failed_output_forbidden");
      const next = structuredClone(old); next.status = next.units[0].status = outcome;
      Object.assign(next.units[0].attempts.at(-1)!, { status: outcome, diagnostic, finishedAt: now() });
      return this.writeJob(old, next);
    });
  }
  retry(projectId: string, jobId: string) {
    return this.atomic(() => {
      const old = this.getJob(projectId, jobId); this.assertFresh(this.getPlan(projectId, old.planId));
      if (old.status !== "failed" || old.units[0].attempts.length >= FOUNDATION_BOOTSTRAP_LIMITS.attempts) throw new Error("bootstrap_retry_exhausted_repreview_required");
      const next = structuredClone(old); next.status = next.units[0].status = "pending"; return this.writeJob(old, next);
    });
  }
  cancel(projectId: string, jobId: string) {
    return this.atomic(() => {
      const old = this.getJob(projectId, jobId), next = structuredClone(old);
      const latest = next.units[0].attempts.at(-1);
      if (latest?.status === "running") Object.assign(latest, { status: "cancelled", diagnostic: "cancelled", finishedAt: now() });
      next.status = next.units[0].status = "cancelled"; return this.writeJob(old, next);
    });
  }
  recoverInterrupted(projectId?: string) {
    const rows = this.database.prepare(`SELECT project_id,id FROM foundation_bootstrap_jobs ${projectId ? "WHERE project_id=?" : ""}`).all(...(projectId ? [projectId] : [])) as Array<{ project_id: string; id: string }>;
    for (const row of rows) { const job = this.getJob(row.project_id, row.id); if (job.status === "running") this.finish(job.projectId, job.id, job.units[0].attempts.at(-1)!.id, "failed", undefined, "interrupted"); }
  }
  candidate(projectId: string, jobId: string) {
    const job = this.getJob(projectId, jobId), plan = this.getPlan(projectId, job.planId);
    const row = this.database.prepare("SELECT * FROM foundation_bootstrap_candidates WHERE project_id=? AND job_id=?").get(projectId, jobId) as (JsonRow & { attempt_id: string }) | undefined;
    if (!row || job.status !== "completed" || job.units[0].attempts.at(-1)?.id !== row.attempt_id) throw new Error("bootstrap_candidate_missing");
    return { id: row.id, candidate: parseFoundationBootstrapCandidate(JSON.parse(row.content_json), plan.context) };
  }
  applications(projectId: string, jobId: string) {
    return this.rows("foundation_bootstrap_applications", projectId).map((row) => {
      const application = FoundationBootstrapApplicationSchema.parse(JSON.parse(row.content_json));
      if (application.id !== row.id || application.projectId !== projectId) throw new Error("bootstrap_application_identity_invalid");
      return application;
    }).filter((application) => application.jobId === jobId);
  }
  appliedVersions(projectId: string, jobId: string) { return Object.assign({}, ...this.applications(projectId, jobId).reverse().map((application) => application.artifactVersionIds)) as Partial<Record<FoundationArtifactId, string>>; }
  previewApply(projectId: string, jobId: string, selected: FoundationArtifactId[]) {
    const job = this.getJob(projectId, jobId), plan = this.getPlan(projectId, job.planId), { id: candidateId } = this.candidate(projectId, jobId), applied = this.appliedVersions(projectId, jobId);
    this.assertFresh(plan, applied);
    if (!selected.length || selected.some((artifactId) => !FOUNDATION_ARTIFACT_IDS.includes(artifactId) || applied[artifactId]) || new Set(selected).size !== selected.length) throw new Error("bootstrap_selection_invalid");
    const closure = new Set(selected);
    const add = (artifactId: FoundationArtifactId) => { for (const upstream of FOUNDATION_DEPENDENCIES[artifactId]) if (!closure.has(upstream) && !applied[upstream]) { closure.add(upstream); add(upstream); } };
    selected.forEach(add);
    const effectiveArtifactIds = FOUNDATION_ARTIFACT_IDS.filter((artifactId) => closure.has(artifactId));
    return { effectiveArtifactIds, requiredDependencies: effectiveArtifactIds.filter((artifactId) => !selected.includes(artifactId)),
      previewFingerprint: sourceDigest({ plan: plan.fingerprint, candidateId, applied, effectiveArtifactIds }), wouldStale: ["passage-plan", "passage-drafts"] };
  }
  apply(projectId: string, jobId: string, selected: FoundationArtifactId[], fingerprint: string, afterWrite?: (artifactId: FoundationArtifactId) => void) {
    return this.atomic(() => {
      const preview = this.previewApply(projectId, jobId, selected);
      if (preview.previewFingerprint !== fingerprint || preview.requiredDependencies.length) throw new Error("bootstrap_apply_selection_or_preview_invalid");
      const job = this.getJob(projectId, jobId), plan = this.getPlan(projectId, job.planId), result = this.candidate(projectId, jobId);
      const artifacts = new ArtifactRepository(this.database), workflow = new WorkflowRepository(this.database);
      const artifactVersionIds: Partial<Record<FoundationArtifactId, string>> = {};
      for (const artifactId of FOUNDATION_ARTIFACT_IDS.filter((artifactId) => selected.includes(artifactId))) {
        const version = artifacts.saveArtifactInTransaction({ projectId, artifactId, artifactType: artifactId, content: result.candidate.artifacts[artifactId],
          dependencies: ["source-dossier", "adaptation-intent", ...FOUNDATION_DEPENDENCIES[artifactId].filter((dependency) => dependency !== "routes" && dependency !== "endings")] });
        artifactVersionIds[artifactId] = version.id; workflow.markDraft(projectId, artifactId); afterWrite?.(artifactId);
      }
      // All drafts were validated against one candidate state; later writes in the same bundle must not stale earlier siblings.
      for (const artifactId of selected) this.database.prepare("UPDATE artifact_versions SET stale=0 WHERE id=?").run(artifactVersionIds[artifactId]!);
      const application = FoundationBootstrapApplicationSchema.parse({ id: randomUUID(), projectId, jobId, candidateId: result.id, artifactVersionIds,
        previousVersionIds: plan.context.baseVersionIds, fingerprint, createdAt: now() });
      this.database.prepare("INSERT INTO foundation_bootstrap_applications VALUES(?,?,?,?)").run(application.id, projectId, jobId, JSON.stringify(application));
      return application;
    });
  }
}

export function validateFoundationBootstrapDatabase(database: StoryDatabase, projectId?: string) {
  const repository = new FoundationBootstrapRepository(database);
  const rows = database.prepare(`SELECT * FROM foundation_bootstrap_plans ${projectId ? "WHERE project_id=?" : ""}`).all(...(projectId ? [projectId] : [])) as JsonRow[];
  for (const row of rows) {
    const plan = repository.validatePlan(JSON.parse(row.content_json));
    if (plan.id !== row.id || plan.projectId !== row.project_id) throw new Error("bootstrap_plan_identity_invalid");
    for (const job of repository.listJobs(row.project_id).filter((job) => job.planId === plan.id)) {
      const output = database.prepare("SELECT id FROM foundation_bootstrap_candidates WHERE job_id=?").get(job.id);
      if ((job.status === "completed") !== Boolean(output)) throw new Error("bootstrap_job_output_invalid");
      if (output) repository.candidate(job.projectId, job.id);
      const priorApplied: Partial<Record<FoundationArtifactId, string>> = {};
      for (const application of repository.applications(job.projectId, job.id).reverse()) {
        const result = repository.candidate(job.projectId, job.id);
        if (application.candidateId !== result.id || !Object.keys(application.artifactVersionIds).length) throw new Error("bootstrap_application_lineage_invalid");
        const selected = FOUNDATION_ARTIFACT_IDS.filter((artifactId) => application.artifactVersionIds[artifactId]);
        if (!same(application.previousVersionIds, plan.context.baseVersionIds)
          || application.fingerprint !== sourceDigest({ plan: plan.fingerprint, candidateId: result.id, applied: priorApplied, effectiveArtifactIds: selected })
          || selected.some((artifactId) => priorApplied[artifactId] || FOUNDATION_DEPENDENCIES[artifactId].some((dependency) => !priorApplied[dependency] && !selected.includes(dependency)))) throw new Error("bootstrap_application_selection_invalid");
        for (const [artifactId, versionId] of Object.entries(application.artifactVersionIds)) {
          const version = new ArtifactRepository(database).getVersion(versionId);
          if (!version || version.projectId !== job.projectId || version.artifactId !== artifactId || !same(version.content, result.candidate.artifacts[artifactId as FoundationArtifactId])) throw new Error("bootstrap_application_content_invalid");
        }
        Object.assign(priorApplied, application.artifactVersionIds);
      }
    }
  }
}

export function foundationBootstrapAuthority(database: StoryDatabase, projectId: string, requireApprovals = true) {
  const artifacts = new ArtifactRepository(database), intent = artifacts.getCurrent(projectId, "adaptation-intent");
  if (!intent) return undefined;
  const repository = new FoundationBootstrapRepository(database), workflow = new WorkflowRepository(database);
  for (const job of repository.listJobs(projectId).filter((job) => job.status === "completed")) {
    const plan = repository.getPlan(projectId, job.planId), applied = repository.appliedVersions(projectId, job.id);
    if (plan.context.intentVersionId !== intent.id || FOUNDATION_ARTIFACT_IDS.some((artifactId) => !applied[artifactId])) continue;
    try {
      const expected = { ...applied };
      for (const artifactId of FOUNDATION_ARTIFACT_IDS) {
        const current = artifacts.getCurrent(projectId, artifactId), source = artifacts.getVersion(applied[artifactId]!);
        const equivalent = artifactId === "creative-direction" && current && source
          && (current.content as { materialFingerprint: string }).materialFingerprint === (source.content as { materialFingerprint: string }).materialFingerprint;
        if (!current || current.id !== applied[artifactId] && !equivalent || requireApprovals && (current.stale || workflow.get(projectId, artifactId).status !== "approved" || workflow.get(projectId, artifactId).approvedVersionId !== current.id)) throw new Error("bootstrap_foundations_require_approval_or_rebootstrap");
        expected[artifactId] = current.id;
      }
      repository.assertFresh(plan, expected);
      const candidate = repository.candidate(projectId, job.id);
      return { fingerprint: sourceDigest({ plan: plan.fingerprint, applied, candidateId: candidate.id }), dossierVersionId: plan.context.dossierVersionId,
        intentVersionId: plan.context.intentVersionId, dimensions: plan.context.intent.dimensions, preserveCanonRoute: plan.context.intent.preserveCanonRoute,
        endingIntent: plan.context.intent.endingIntent, canonAssessment: candidate.candidate.canonAssessment };
    } catch { /* An older application is not authority for changed foundations. */ }
  }
  throw new Error("bootstrap_approved_compatible_foundations_required");
}
