import { z } from "zod";
import { SOURCE_ANALYSIS_POLICY, SOURCE_CATEGORIES, SourceUnitOutputSchema, SourceEvidenceSchema, AnalysisSourceSchema,
  SourceCorrectionOperationSchema, sourceBinding, planSourceAnalysis, sourceCanonicalJson, sourceDigest,
  sourceUnitContext, resolveSourceEvidence, validateSourceOutput,
  type SourceAnalysisPlan, type SourceDossier, type SourceEvidence } from "@story-to-cyoa/domain";
import { SourceAnalysisRepository, SourceAnalysisUsageSchema, type StoryDatabase, type ProjectRepository,
  type ArtifactRepository, type WorkflowRepository, type ArtifactVersion, type SourceAnalysisUsage } from "@story-to-cyoa/persistence";
import type { SourceAnalysisProvider, SourceAnalysisProviderRequest } from "@story-to-cyoa/pipeline";

const PreviewSchema = z.object({ providerId: z.enum(["offline-source-analysis", "openrouter-source-analysis"]).default("offline-source-analysis"), modelId: z.string().trim().min(1).max(240).default("offline-source-v1") }).strict();
const ScopeSchema = z.union([z.object({ entireWork: z.literal(true) }).strict(), z.object({ chapterIds: z.array(z.string()).min(1).max(20_000) }).strict()]);
export class SourceAnalysisService {
  readonly repository: SourceAnalysisRepository;
  private readonly providers: Map<string, SourceAnalysisProvider>;
  private readonly running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private closing = false;
  constructor(private readonly database: StoryDatabase, private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository, private readonly workflow: WorkflowRepository, providers: SourceAnalysisProvider[]) {
    this.repository = new SourceAnalysisRepository(database);
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.repository.recoverInterrupted();
  }
  private project(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("source_analysis_project_not_found");
    return project;
  }
  source(projectId: string, offset = 0, limit = 50) {
    this.project(projectId);
    const source = this.artifacts.getCurrent(projectId, "source"), scope = this.artifacts.getCurrent(projectId, "source-scope");
    if (!source) return { sourceVersionId: null, chapters: [], chapterCount: 0, scope: null };
    const content = AnalysisSourceSchema.parse(source.content);
    return { sourceVersionId: source.id, sourceFingerprint: sourceDigest(content), metadata: content.metadata,
      chapterCount: content.chapters.length, chapters: content.chapters.slice(offset, offset + limit).map((c) => ({ id: c.id, title: c.title, order: c.order,
        blockCount: c.blocks.length, characters: c.blocks.reduce((sum, b) => sum + b.text.length, 0) })),
      scope: scope && !scope.stale ? { versionId: scope.id, ...(scope.content as object) } : null };
  }
  selectScope(projectId: string, value: unknown) {
    this.project(projectId);
    const input = ScopeSchema.parse(value), imported = this.artifacts.getCurrent(projectId, "source");
    if (!imported) throw new Error("source_analysis_source_missing");
    const source = AnalysisSourceSchema.parse(imported.content);
    const chapterIds = "entireWork" in input ? source.chapters.map((c) => c.id) : input.chapterIds;
    sourceBinding(projectId, imported.id, "scope-validation", source, chapterIds);
    const scope = this.artifacts.saveArtifact({ projectId, artifactId: "source-scope", content: { chapterIds, sourceVersionId: imported.id }, dependencies: ["source"] });
    if (this.artifacts.getCurrent(projectId, "source-dossier")) this.workflow.markStale(projectId, "source-dossier");
    return { versionId: scope.id, chapterIds };
  }
  preview(projectId: string, value: unknown) {
    this.project(projectId);
    const input = PreviewSchema.parse(value);
    if (!this.providers.has(input.providerId) || (input.providerId === "openrouter-source-analysis" && input.modelId === "offline-source-v1")) throw new Error("source_analysis_provider_configuration_invalid");
    const source = this.artifacts.getCurrent(projectId, "source"), scope = this.artifacts.getCurrent<{ chapterIds: string[]; sourceVersionId?: string }>(projectId, "source-scope");
    if (!source || !scope || scope.stale || (scope.content.sourceVersionId && scope.content.sourceVersionId !== source.id)) throw new Error("source_analysis_scope_required");
    const normalized = AnalysisSourceSchema.parse(source.content);
    const binding = sourceBinding(projectId, source.id, scope.id, normalized, scope.content.chapterIds);
    const plan = this.repository.savePlan(planSourceAnalysis(binding, normalized, input.providerId, input.modelId));
    return { id: plan.id, fingerprint: plan.fingerprint, binding: plan.binding, sourceCharacters: plan.sourceCharacters, sourceBytes: plan.sourceBytes,
      selectedChapters: binding.chapterIds.length, unitCount: plan.units.length, maxUnitCharacters: Math.max(...plan.units.map((u) => u.characters)),
      estimatedInputTokens: Math.ceil(plan.units.reduce((sum, u) => sum + u.contextBytes, 0) / 4), tokenEstimate: "heuristic, not billing",
      maximumOutputTokensPerUnit: SOURCE_ANALYSIS_POLICY.maxOutputTokens, providerId: plan.providerId, modelId: plan.modelId,
      cost: plan.cost, costStatus: plan.cost === null ? "unknown" : "known offline zero", categories: SOURCE_CATEGORIES };
  }
  authorizeAndStart(projectId: string, planId: string, fingerprint: string) {
    this.project(projectId);
    if (this.closing) throw new Error("source_analysis_shutting_down");
    const job = this.repository.createJob(projectId, planId, fingerprint);
    this.start(projectId, job.id); return this.job(projectId, job.id);
  }
  start(projectId: string, jobId: string) {
    this.project(projectId);
    if (this.closing || this.running.has(jobId)) throw new Error("source_analysis_already_active");
    const job = this.repository.getJob(projectId, jobId);
    this.repository.fresh(projectId, job.planId);
    if (job.status === "failed") this.repository.retry(projectId, jobId);
    else if (job.status !== "pending") throw new Error("source_analysis_resume_not_allowed");
    const controller = new AbortController();
    // Defer execution until the active-run guard is installed, including synchronously resolving providers.
    const promise = Promise.resolve().then(() => this.execute(projectId, jobId, controller.signal)).finally(() => this.running.delete(jobId));
    this.running.set(jobId, { controller, promise });
    return this.job(projectId, jobId);
  }
  cancel(projectId: string, jobId: string) {
    this.project(projectId);
    this.repository.cancel(projectId, jobId);
    this.running.get(jobId)?.controller.abort(); return this.job(projectId, jobId);
  }
  job(projectId: string, jobId: string, offset = 0, limit = 50) {
    this.project(projectId);
    const job = this.repository.getJob(projectId, jobId);
    const counts = Object.fromEntries(["pending", "running", "completed", "failed", "cancelled"].map((status) => [status, job.units.filter((u) => u.status === status).length]));
    return { ...job, executing: this.running.has(jobId), counts, unitCount: job.units.length, units: job.units.slice(offset, offset + limit) };
  }
  listJobs(projectId: string) {
    this.project(projectId);
    return this.repository.listJobs(projectId).slice(0, 50).map((job) => {
      const { units, ...metadata } = job;
      return { ...metadata, unitCount: units.length, completedUnits: units.filter((u) => u.status === "completed").length, executing: this.running.has(job.id) };
    });
  }
  private async execute(projectId: string, jobId: string, signal: AbortSignal) {
    const job = this.repository.getJob(projectId, jobId), plan = this.repository.getPlan(projectId, job.planId);
    const provider = this.providers.get(plan.providerId)!;
    let interrupted = false;
    for (const unit of plan.units) {
      if (signal.aborted) { interrupted = true; break; }
      if (this.repository.getJob(projectId, jobId).units.find((u) => u.id === unit.id)?.status !== "pending") continue;
      let attemptId: string | undefined, repairCount = 0;
      let usage: SourceAnalysisUsage = { inputTokens: 0, outputTokens: 0, cost: null };
      try {
        this.repository.fresh(projectId, plan.id);
        const attempt = this.repository.beginAttempt(projectId, jobId, unit.id); attemptId = attempt.id;
        const context = sourceUnitContext(this.repository.source(plan), plan.binding, unit);
        if (sourceDigest(context) !== unit.contextFingerprint) throw new Error("source_analysis_context_invalid");
        const request: SourceAnalysisProviderRequest = { mode: "analyze", modelId: plan.modelId, context, maximumOutputTokens: SOURCE_ANALYSIS_POLICY.maxOutputTokens, signal };
        const call = async (input: SourceAnalysisProviderRequest) => {
          if (new TextEncoder().encode(sourceCanonicalJson({ context: input.context, malformedOutput: input.malformedOutput, mode: input.mode })).length > SOURCE_ANALYSIS_POLICY.maxContextBytes) throw new Error("source_context_overflow");
          this.repository.fresh(projectId, plan.id); if (signal.aborted) throw new Error("cancelled");
          const result = await provider.generate(input);
          this.repository.fresh(projectId, plan.id); if (signal.aborted) throw new Error("cancelled");
          const measured = SourceAnalysisUsageSchema.parse(result.usage);
          usage = { inputTokens: usage.inputTokens + measured.inputTokens, outputTokens: usage.outputTokens + measured.outputTokens,
            cost: usage.cost === null && repairCount === 0 ? measured.cost : usage.cost === null || measured.cost === null ? null : usage.cost + measured.cost };
          if (new TextEncoder().encode(result.output).length > SOURCE_ANALYSIS_POLICY.maxOutputBytes) throw new Error("source_output_oversized");
          return result.output;
        };
        let raw = await call(request);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); SourceUnitOutputSchema.parse(parsed); }
        catch {
          // Repair receives the exact malformed output, never a truncated replacement or a saved raw response.
          repairCount = 1; raw = await call({ ...request, mode: "repair", malformedOutput: raw });
          parsed = JSON.parse(raw); SourceUnitOutputSchema.parse(parsed);
        }
        const output = validateSourceOutput(this.repository.source(plan), plan, unit, parsed);
        this.repository.fresh(projectId, plan.id);
        this.repository.finishAttempt(projectId, jobId, unit.id, attemptId, { status: "completed", output, repairCount, usage });
      } catch (error) {
        const current = this.repository.getJob(projectId, jobId);
        if (current.status === "cancelled") return;
        const latest = current.units.find((u) => u.id === unit.id)?.attempts.at(-1);
        const stale = String((error as Error)?.message).startsWith("source_analysis_stale");
        if (attemptId && latest?.status === "running") this.repository.finishAttempt(projectId, jobId, unit.id, attemptId, {
          status: "failed", repairCount, usage, diagnostic: this.closing ? "interrupted" : stale ? "stale" : repairCount ? "invalid_output" : "provider_failed",
        });
        if (signal.aborted || stale || !attemptId) { interrupted = true; break; }
      }
    }
    if (this.repository.getJob(projectId, jobId).status !== "cancelled") {
      try { this.repository.settle(projectId, jobId); }
      catch { this.repository.failJob(projectId, jobId); }
      if (interrupted && this.repository.getJob(projectId, jobId).status !== "completed") this.repository.failJob(projectId, jobId);
    }
  }
  async shutdown() {
    this.closing = true;
    const active = [...this.running.values()]; active.forEach((run) => run.controller.abort());
    await Promise.all(active.map((run) => run.promise));
  }
  private dossier(projectId: string, versionId?: string): ArtifactVersion<SourceDossier> {
    this.project(projectId);
    const version = versionId ? this.artifacts.getVersion<SourceDossier>(versionId) : this.artifacts.getCurrent<SourceDossier>(projectId, "source-dossier");
    if (!version || version.projectId !== projectId || version.artifactId !== "source-dossier") throw new Error("source_dossier_not_found");
    return version;
  }
  dossierMetadata(projectId: string, versionId?: string) {
    const version = this.dossier(projectId, versionId), { content, ...metadata } = version;
    return { ...metadata, workflow: this.workflow.get(projectId, "source-dossier"), binding: content.binding,
      materialFingerprint: content.materialFingerprint, provenanceFingerprint: content.provenanceFingerprint,
      recordCount: content.records.length, categories: Object.fromEntries(SOURCE_CATEGORIES.map((c) => [c, content.records.filter((r) => r.category === c).length])),
      conflictCount: content.conflicts.length, correctionCount: content.corrections.length };
  }
  records(projectId: string, query: { versionId?: string; category?: string; search?: string; conflictsOnly?: boolean; offset: number; limit: number }) {
    const dossier = this.dossier(projectId, query.versionId).content;
    const conflicting = new Set(dossier.conflicts.flatMap((c) => c.recordIds));
    const records = dossier.records.filter((r) => (!query.category || r.category === query.category) && (!query.conflictsOnly || conflicting.has(r.id) || r.category === "ambiguity" || r.category === "contradiction")
      && (!query.search || `${r.identityKey} ${r.claim}`.toLowerCase().includes(query.search.toLowerCase())));
    return { total: records.length, items: records.slice(query.offset, query.offset + query.limit).map(({ evidence, observationIds, ...r }) => ({ ...r,
      evidenceCount: evidence.length, observationCount: observationIds.length })) };
  }
  record(projectId: string, recordId: string, versionId?: string, offset = 0, limit = 20) {
    const dossier = this.dossier(projectId, versionId).content, record = dossier.records.find((r) => r.id === recordId);
    if (!record) throw new Error("source_record_not_found");
    return { ...record, evidence: record.evidence.slice(offset, offset + limit), evidenceCount: record.evidence.length,
      observationIds: record.observationIds.slice(offset, offset + limit),
      originals: dossier.provenance.filter((p) => record.observationIds.includes(p.observationId)).slice(offset, offset + limit),
      conflicts: dossier.conflicts.filter((c) => c.recordIds.includes(recordId)).slice(offset, offset + limit),
      corrections: dossier.corrections.slice(offset, offset + limit) };
  }
  evidence(projectId: string, value: unknown) {
    this.project(projectId); const reference = SourceEvidenceSchema.parse(value);
    if (reference.projectId !== projectId) throw new Error("source_evidence_project_invalid");
    const planRow = this.database.prepare("SELECT content_json FROM source_analysis_plans WHERE project_id = ? AND source_version_id = ? AND scope_version_id = ? LIMIT 1")
      .get(projectId, reference.sourceVersionId, reference.scopeVersionId) as { content_json: string } | undefined;
    if (!planRow) throw new Error("source_evidence_scope_not_found");
    const plan = this.repository.getPlan(projectId, (JSON.parse(planRow.content_json) as SourceAnalysisPlan).id);
    if (reference.end - reference.start > SOURCE_ANALYSIS_POLICY.maxSourceCharacters) throw new Error("source_evidence_loading_bound_exceeded");
    return { reference, text: resolveSourceEvidence(this.repository.source(plan), plan.binding, reference) };
  }
  evidenceOptions(projectId: string, offset = 0, limit = 50, search = "") {
    const dossier = this.dossier(projectId).content, plan = this.repository.getPlan(projectId, dossier.planId);
    const source = this.repository.source(plan);
    const options = plan.units.flatMap((unit) => unit.ranges.map((reference) => {
      const chapter = source.chapters.find((c) => c.id === reference.chapterId)!;
      const block = chapter.blocks.findIndex((b) => b.excerptId === reference.excerptId);
      return { reference, label: `${chapter.title}, excerpt ${block + 1}, characters ${reference.start}-${reference.end}` };
    })).filter((item) => !search || item.label.toLowerCase().includes(search.toLowerCase()));
    return { total: options.length, items: options.slice(offset, offset + limit) };
  }
  correct(projectId: string, value: unknown) {
    this.project(projectId); const operation = SourceCorrectionOperationSchema.parse(value);
    this.repository.correct(projectId, operation.previousVersionId, operation); return this.dossierMetadata(projectId);
  }
  approve(projectId: string, versionId: string) { this.project(projectId); return this.workflow.approve(projectId, "source-dossier", versionId); }
  history(projectId: string, offset = 0, limit = 50) {
    this.project(projectId);
    return this.artifacts.listVersions<SourceDossier>(projectId, "source-dossier").slice(offset, offset + limit).map(({ content, ...version }) => ({ ...version,
      materialFingerprint: content.materialFingerprint, provenanceFingerprint: content.provenanceFingerprint, correctionCount: content.corrections.length }));
  }
  compare(projectId: string, from: string, to: string) {
    const a = this.dossier(projectId, from), b = this.dossier(projectId, to);
    return { fromVersion: a.version, toVersion: b.version, materialEqual: a.content.materialFingerprint === b.content.materialFingerprint,
      provenanceEqual: a.content.provenanceFingerprint === b.content.provenanceFingerprint, changedRecordIds: [...new Set([...a.content.records, ...b.content.records].map((r) => r.id))]
        .filter((id) => sourceCanonicalJson(a.content.records.find((r) => r.id === id) ?? null) !== sourceCanonicalJson(b.content.records.find((r) => r.id === id) ?? null)).slice(0, 100) };
  }
  restore(projectId: string, versionId: string) {
    this.dossier(projectId, versionId); this.artifacts.restore(projectId, "source-dossier", versionId);
    this.workflow.markDraft(projectId, "source-dossier"); return this.dossierMetadata(projectId);
  }
  exportDossier(projectId: string, versionId?: string) { return this.dossier(projectId, versionId).content; }
}
