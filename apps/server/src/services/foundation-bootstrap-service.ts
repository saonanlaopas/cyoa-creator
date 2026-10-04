import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FOUNDATION_ARTIFACT_IDS, FOUNDATION_BOOTSTRAP_LIMITS, FoundationBootstrapContextSchema,
  sourceCanonicalJson, sourceDigest, foundationFieldPaths, parseFoundationBootstrapCandidate, type FoundationArtifactId } from "@story-to-cyoa/domain";
import { FoundationBootstrapRepository, type StoryDatabase, ArtifactRepository, WorkflowRepository, ProjectRepository } from "@story-to-cyoa/persistence";
import type { FoundationBootstrapProvider } from "./foundation-bootstrap-provider.js";
import type { LongFormProjectService } from "./long-form-project-service.js";

const PreviewSchema = z.object({ message: z.string().trim().min(1).max(6000), providerId: z.string().min(1).max(240), modelId: z.string().min(1).max(240) }).strict();
const atPath = (value: unknown, path: string): unknown => path.slice(1).split("/").reduce((v, key) => v && typeof v === "object" ? (v as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")] : null, value);
export class FoundationBootstrapService {
  readonly repository: FoundationBootstrapRepository;
  private readonly providers: Map<string, FoundationBootstrapProvider>;
  private readonly running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private closing = false;
  constructor(private readonly database: StoryDatabase, providers: FoundationBootstrapProvider[], private readonly longForm: LongFormProjectService) {
    this.repository = new FoundationBootstrapRepository(database);
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.repository.recoverInterrupted();
  }
  private project(projectId: string) {
    const project = new ProjectRepository(this.database).get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("bootstrap_project_not_found"); return project;
  }
  state(projectId: string) {
    this.project(projectId);
    let reason: string | null = null;
    try { this.context(projectId, { message: "Prepare foundations", providerId: "offline-foundation-bootstrap", modelId: "offline-foundation-v1" }); }
    catch (error) { reason = this.code(error); }
    return { providers: [...this.providers.values()].map((provider) => ({ id: provider.id, label: provider.id.startsWith("offline") ? "Offline deterministic" : "OpenRouter", models: provider.id.startsWith("offline") ? ["offline-foundation-v1"] : ["openai/gpt-4.1-mini"] })),
      availability: { allowed: reason === null, reason }, plans: this.repository.listPlans(projectId), jobs: this.repository.listJobs(projectId) };
  }
  private context(projectId: string, input: z.infer<typeof PreviewSchema>) {
    const project = this.project(projectId), artifacts = new ArtifactRepository(this.database), workflow = new WorkflowRepository(this.database);
    const dossier = artifacts.getCurrent(projectId, "source-dossier"), intent = artifacts.getCurrent(projectId, "adaptation-intent");
    if (!dossier || !intent || [dossier, intent].some((version) => version.stale || workflow.get(projectId, version.artifactId).status !== "approved" || workflow.get(projectId, version.artifactId).approvedVersionId !== version.id)) throw new Error("bootstrap_approved_dossier_and_intent_required");
    const bases = Object.fromEntries(FOUNDATION_ARTIFACT_IDS.map((artifactId) => [artifactId, artifacts.getCurrent(projectId, artifactId)]));
    const context = FoundationBootstrapContextSchema.parse({ schemaVersion: 1, policyVersion: "foundation-bootstrap-v1", projectId, title: project.name,
      dossierVersionId: dossier.id, intentVersionId: intent.id, dossier: dossier.content, intent: intent.content,
      baseVersionIds: Object.fromEntries(FOUNDATION_ARTIFACT_IDS.map((artifactId) => [artifactId, bases[artifactId]?.id ?? null])),
      baseArtifacts: Object.fromEntries(FOUNDATION_ARTIFACT_IDS.map((artifactId) => [artifactId, bases[artifactId]?.content ?? null])),
      request: input.message, providerId: input.providerId, modelId: input.modelId });
    if (context.intent.budget.target.kind !== "unknown" && (context.intent.budget.target.words < 50_000 || context.intent.budget.target.words > 1_000_000)) throw new Error("bootstrap_target_unsupported_adjust_intent_required");
    if (Buffer.byteLength(sourceCanonicalJson(context)) > FOUNDATION_BOOTSTRAP_LIMITS.contextBytes) throw new Error("bootstrap_context_overflow_replan_required");
    return context;
  }
  preview(projectId: string, value: unknown) {
    const input = PreviewSchema.parse(value);
    if (!this.providers.has(input.providerId) || input.providerId.startsWith("offline") && input.modelId !== "offline-foundation-v1" || !input.providerId.startsWith("offline") && input.modelId.startsWith("offline")) throw new Error("bootstrap_provider_invalid");
    const context = this.context(projectId, input), contextFingerprint = sourceDigest(context), units = [{ id: "foundations" as const, artifactIds: [...FOUNDATION_ARTIFACT_IDS] }];
    const contextBytes = Buffer.byteLength(sourceCanonicalJson(context));
    return this.repository.savePlan({ id: randomUUID(), projectId, context, contextFingerprint, units,
      fingerprint: sourceDigest({ contextFingerprint, units, providerId: input.providerId, modelId: input.modelId }), createdAt: new Date().toISOString(), contextBytes,
      estimatedInputTokens: Math.ceil(contextBytes / 4), cost: input.providerId.startsWith("offline") ? 0 : null, providerId: input.providerId, modelId: input.modelId });
  }
  start(projectId: string, planId: string, fingerprint: string) {
    if (this.closing) throw new Error("bootstrap_shutting_down");
    const job = this.repository.createJob(projectId, planId, fingerprint); this.run(projectId, job.id); return job;
  }
  job(projectId: string, jobId: string) { this.project(projectId); return this.repository.getJob(projectId, jobId); }
  retry(projectId: string, jobId: string) {
    if (this.running.has(jobId) || this.closing) throw new Error("bootstrap_already_running");
    const job = this.repository.retry(projectId, jobId); this.run(projectId, jobId); return job;
  }
  cancel(projectId: string, jobId: string) { const job = this.repository.cancel(projectId, jobId); this.running.get(jobId)?.controller.abort(); return job; }
  private run(projectId: string, jobId: string) {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.execute(projectId, jobId, controller.signal)).finally(() => this.running.delete(jobId));
    this.running.set(jobId, { controller, promise });
  }
  private async execute(projectId: string, jobId: string, signal: AbortSignal) {
    let attemptId: string | undefined;
    try {
      const job = this.repository.begin(projectId, jobId), plan = this.repository.getPlan(projectId, job.planId); attemptId = job.units[0].attempts.at(-1)!.id;
      const provider = this.providers.get(plan.providerId); if (!provider) throw new Error("bootstrap_provider_missing");
      const raw = await this.call(provider, { context: plan.context, modelId: plan.modelId, signal, mode: "generate" });
      this.repository.assertFresh(plan);
      if (signal.aborted) throw new Error("bootstrap_cancelled");
      if (Buffer.byteLength(raw) > FOUNDATION_BOOTSTRAP_LIMITS.outputBytes) throw new Error("bootstrap_output_oversized");
      const candidate = parseFoundationBootstrapCandidate(JSON.parse(raw), plan.context);
      for (const artifactId of FOUNDATION_ARTIFACT_IDS) this.longForm.assertPresentationAuthorityWrite(projectId, artifactId, candidate.artifacts[artifactId]);
      this.repository.finish(projectId, jobId, attemptId, "completed", candidate);
    } catch (error) {
      const job = this.repository.getJob(projectId, jobId);
      if (attemptId && job.status === "running") this.repository.finish(projectId, jobId, attemptId, "failed", undefined,
        /stale|required/.test(this.code(error)) ? "stale" : /output|candidate|provenance|reference|JSON|schema/.test(String((error as Error).message)) ? "invalid_output" : "provider_failed");
    }
  }
  private async call(provider: FoundationBootstrapProvider, input: Parameters<FoundationBootstrapProvider["generate"]>[0]): Promise<string> {
    input.signal.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      return await Promise.race([provider.generate({ ...input, signal: controller.signal }), new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(new Error("bootstrap_cancelled")); }; input.signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new Error("bootstrap_provider_timeout")); }, 60_000);
        if (input.signal.aborted) abort();
      })]);
    } finally { if (timer) clearTimeout(timer); if (abort) input.signal.removeEventListener("abort", abort); }
  }
  review(projectId: string, jobId: string) {
    const job = this.repository.getJob(projectId, jobId), plan = this.repository.getPlan(projectId, job.planId), result = this.repository.candidate(projectId, jobId);
    const reasons: string[] = [];
    try { this.repository.assertFresh(plan, this.repository.appliedVersions(projectId, jobId)); } catch (error) { reasons.push(this.code(error)); }
    return { jobId, currentState: { status: reasons.length ? "stale" : "fresh", reasons },
      candidates: FOUNDATION_ARTIFACT_IDS.map((artifactId) => ({ artifactId, content: result.candidate.artifacts[artifactId], baseVersionId: plan.context.baseVersionIds[artifactId],
        provenance: result.candidate.provenance.filter((entry) => entry.artifactId === artifactId),
        fieldDiffs: [...new Set([...foundationFieldPaths(plan.context.baseArtifacts[artifactId]), ...foundationFieldPaths(result.candidate.artifacts[artifactId])])]
          .map((path) => ({ path, before: atPath(plan.context.baseArtifacts[artifactId], path) ?? null, after: atPath(result.candidate.artifacts[artifactId], path) ?? null }))
          .filter((entry) => sourceCanonicalJson(entry.before) !== sourceCanonicalJson(entry.after)) })),
      groups: [{ id: "policy", label: "Foundation policy", artifactIds: ["brief", "creative-direction"], dependsOnGroupIds: [] },
        { id: "world", label: "World and mechanics", artifactIds: ["bible", "mechanics"], dependsOnGroupIds: ["policy"] },
        { id: "structure", label: "Routes and endings", artifactIds: ["routes", "endings"], dependsOnGroupIds: ["policy", "world"] }],
      validation: { errors: reasons, warnings: ["All results are drafts. Passage-level preservation remains pending.",
        ...result.candidate.canonAssessment.filter((assessment) => assessment.status === "blocked" && plan.context.intent.obligations.some((obligation) => obligation.id === assessment.obligationId && obligation.strength === "required"))
          .map((assessment) => `Required obligation ${assessment.obligationId} is blocked. AI passage authority remains unavailable.`)] }, canonAssessment: result.candidate.canonAssessment,
      applications: this.repository.applications(projectId, jobId) };
  }
  previewApply(projectId: string, jobId: string, artifactIds: FoundationArtifactId[]) { return this.repository.previewApply(projectId, jobId, artifactIds); }
  apply(projectId: string, jobId: string, artifactIds: FoundationArtifactId[], fingerprint: string) {
    const { candidate } = this.repository.candidate(projectId, jobId);
    for (const artifactId of artifactIds) this.longForm.assertPresentationAuthorityWrite(projectId, artifactId, candidate.artifacts[artifactId]);
    return this.repository.apply(projectId, jobId, artifactIds, fingerprint);
  }
  private code(error: unknown) { return /^bootstrap_[a-z_]+/.exec((error as Error)?.message ?? "")?.[0] ?? "bootstrap_request_invalid"; }
  async shutdown() { this.closing = true; for (const { controller } of this.running.values()) controller.abort(); await Promise.all([...this.running.values()].map(({ promise }) => promise)); }
}
