import {
  buildPassagePlanningContext,
  buildPassageGenerationPlan,
  fingerprintPassagePlanningContext,
  normalizePassagePlanningError,
  passagePlanningCandidateLimits,
  passagePlanningCandidateSchema,
  PassageGenerationScopeSchema,
  passageGenerationPolicyV1,
  validatePassagePlanningCandidate,
  type ChoicePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormRoutePlan,
  type LongFormStoryBible,
  type NarrativeThread,
  type PassagePlan,
  type PassagePlanningContextPack,
  type PassagePlanningProvider,
  type PassagePlanningProviderUsage,
  type PassageStructure,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
import { redactSecret } from "@story-to-cyoa/openrouter";
import { createHash } from "node:crypto";
import type {
  ArtifactRepository,
  GenerationJobRecord,
  GenerationPlanRecord,
  GenerationRepository,
  PassagePlanRepository,
  ProjectRepository,
} from "@story-to-cyoa/persistence";

export interface PassageGenerationPlanRequest {
  scope: unknown;
  providerId?: string;
  modelId?: string;
}

export class PassageGenerationService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly generations: GenerationRepository,
    provider: PassagePlanningProvider | PassagePlanningProvider[],
  ) {
    this.providers = new Map((Array.isArray(provider) ? provider : [provider]).map((item) => [item.id, item]));
    this.generations.recoverInterrupted();
  }

  private readonly providers: Map<string, PassagePlanningProvider>;

  preview(projectId: string, request: PassageGenerationPlanRequest) {
    return this.build(projectId, request);
  }

  create(projectId: string, request: PassageGenerationPlanRequest): GenerationPlanRecord {
    const planned = this.build(projectId, request);
    return this.generations.createPlan({
      projectId: planned.projectId,
      fingerprint: planned.fingerprint,
      snapshotId: planned.snapshotId,
      structureVersionId: planned.structureVersionId,
      upstreamVersions: planned.upstreamVersions,
      scope: planned.scope,
      providerId: planned.providerId,
      modelId: planned.modelId,
      estimatedInputTokens: planned.estimatedInputTokens,
      estimatedOutputTokens: planned.estimatedOutputTokens,
      costEstimate: planned.costEstimate,
      validationStages: planned.validationStages,
      executionPolicyId: planned.policy.id,
      executionPolicy: planned.policy,
      units: planned.units,
    });
  }

  list(projectId: string): GenerationPlanRecord[] {
    this.requireProject(projectId);
    return this.generations.listPlans(projectId);
  }

  getPlan(projectId: string, planId: string): GenerationPlanRecord {
    this.requireProject(projectId);
    const plan = this.generations.getPlan(projectId, planId);
    if (!plan) throw new Error("Generation plan not found");
    return plan;
  }

  authorize(projectId: string, planId: string, fingerprint: string): GenerationPlanRecord {
    this.requireProject(projectId);
    return this.generations.authorize(projectId, planId, fingerprint);
  }

  getJob(projectId: string, jobId: string): GenerationJobRecord {
    this.requireProject(projectId);
    const job = this.generations.getJob(projectId, jobId);
    if (!job) throw new Error("Generation job not found");
    return job;
  }

  start(projectId: string, jobId: string): GenerationJobRecord {
    this.requireProject(projectId);
    const job = this.getJob(projectId, jobId);
    const plan = this.getPlan(projectId, job.planId);
    this.requireProvider(plan.providerId);
    const running = this.generations.startJob(projectId, jobId);
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const task = this.run(projectId, running.id, controller)
      .finally(() => {
        this.controllers.delete(jobId);
        this.tasks.delete(jobId);
      });
    this.tasks.set(jobId, task);
    return running;
  }

  cancel(projectId: string, jobId: string): GenerationJobRecord {
    this.requireProject(projectId);
    this.controllers.get(jobId)?.abort();
    return this.generations.cancelJob(projectId, jobId);
  }

  retry(projectId: string, jobId: string, unitId: string): GenerationJobRecord {
    this.requireProject(projectId);
    return this.generations.retryUnit(projectId, jobId, unitId);
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.tasks.values());
  }

  private build(projectId: string, request: PassageGenerationPlanRequest) {
    this.requireProject(projectId);
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || !state.approvedSnapshotId) {
      throw new Error("Approve a passage-plan snapshot before creating a generation plan");
    }
    const snapshot = this.passagePlans.getSnapshot(state.approvedSnapshotId);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "approved") {
      throw new Error("Approved passage-plan snapshot not found");
    }
    const structure = this.passagePlans.getStructureVersion<PassageStructure>(snapshot.structureVersionId);
    if (!structure || structure.projectId !== projectId) throw new Error("Approved passage-plan structure not found");
    const passages = this.passagePlans.snapshotEntities<PassagePlan>(snapshot.id, "passage");
    const choices = this.passagePlans.snapshotEntities<ChoicePlan>(snapshot.id, "choice");
    const threads = this.passagePlans.snapshotEntities<NarrativeThread>(snapshot.id, "thread");
    const exact = {
      brief: this.exactArtifact<ProjectBrief>(projectId, "brief", snapshot.upstreamVersions.brief),
      bible: this.exactArtifact<LongFormStoryBible>(projectId, "bible", snapshot.upstreamVersions.bible),
      routes: this.exactArtifact<LongFormRoutePlan>(projectId, "routes", snapshot.upstreamVersions.routes),
      endings: this.exactArtifact<LongFormEndingPlan>(projectId, "endings", snapshot.upstreamVersions.endings),
      mechanics: this.exactArtifact<LongFormMechanicsPlan>(projectId, "mechanics", snapshot.upstreamVersions.mechanics),
    };
    const scope = PassageGenerationScopeSchema.parse(request.scope);
    return buildPassageGenerationPlan({
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: snapshot.structureVersionId,
      upstreamVersions: snapshot.upstreamVersions,
      structure: structure.content,
      passages: passages.map((item) => ({ versionId: item.id, content: item.content })),
      scope,
      providerId: request.providerId ?? "offline-kernel",
      modelId: request.modelId ?? "deterministic-fixture-v1",
      policy: passageGenerationPolicyV1,
      buildUnitContext: ({ passageIds, requestedMaximumOutputTokens, maximumEstimatedInputTokens }) =>
        buildPassagePlanningContext({
          projectId,
          snapshotId: snapshot.id,
          structureVersionId: snapshot.structureVersionId,
          upstreamVersions: snapshot.upstreamVersions,
          scope,
          structure: structure.content,
          passages: passages.map((item) => ({ versionId: item.id, content: item.content })),
          choices: choices.map((item) => ({ versionId: item.id, content: item.content })),
          threads: threads.map((item) => ({ versionId: item.id, content: item.content })),
          selectedPassageIds: passageIds,
          brief: exact.brief,
          bible: exact.bible,
          routes: exact.routes,
          endings: exact.endings,
          mechanics: exact.mechanics,
          outputSchema: passagePlanningCandidateSchema,
          requestedMaximumOutputTokens,
          maximumEstimatedInputTokens,
        }),
    });
  }

  private async run(projectId: string, jobId: string, controller: AbortController): Promise<void> {
    let job = this.getJob(projectId, jobId);
    const plan = this.getPlan(projectId, job.planId);
    const provider = this.requireProvider(plan.providerId);
    for (const unit of job.units) {
      if (controller.signal.aborted || unit.status !== "pending") continue;
      const { attemptId } = this.generations.startUnit(projectId, jobId, unit.id);
      const repairAudit: { maximumRepairs: number; repairsPerformed: number; history: Array<{ kind: string; issues: string[]; malformedBytes: number; malformedSha256: string }> } = {
        maximumRepairs: passagePlanningCandidateLimits.maximumRepairsPerExecutionAttempt,
        repairsPerformed: 0,
        history: [],
      };
      try {
        const context = this.exactStoredContext(unit.context, unit.contextFingerprint);
        const baseRequest = {
          jobId, unitId: unit.id, providerId: plan.providerId, modelId: plan.modelId,
          inputFingerprint: unit.inputFingerprint, boundedContext: context,
          outputSchema: passagePlanningCandidateSchema,
          capabilityRequirements: { structuredOutput: true, localValidation: true },
          maximumOutputTokens: Math.min(unit.estimatedOutputTokens, passageGenerationPolicyV1.maxOutputTokensPerUnit),
          signal: controller.signal,
        } as const;
        const first = await provider.generate({ ...baseRequest, mode: "generate" });
        const usage: PassagePlanningProviderUsage[] = first.usage ? [first.usage] : [];
        const providerMetadata: Record<string, unknown>[] = first.providerMetadata ? [first.providerMetadata] : [];
        let output = first.output;
        let repairs = first.providerRepairCount ?? 0;
        repairAudit.repairsPerformed = repairs;
        let validated;
        try {
          validated = validatePassagePlanningCandidate({
            raw: output, jobId, unitId: unit.id, inputFingerprint: unit.inputFingerprint, context,
            maximumOutputTokens: baseRequest.maximumOutputTokens,
          });
        } catch (validationError) {
          if (repairs >= passagePlanningCandidateLimits.maximumRepairsPerExecutionAttempt) throw validationError;
          const issues = candidateIssues(validationError);
          if (Buffer.byteLength(output, "utf8") > passagePlanningCandidateLimits.maximumRepairInputBytes) {
            throw Object.assign(new Error("Malformed candidate exceeds the repair-payload limit"), {
              code: "repair_payload_too_large", retryable: true,
            });
          }
          repairAudit.history.push({
            kind: "structured-output-repair",
            issues,
            malformedBytes: Buffer.byteLength(output, "utf8"),
            malformedSha256: createHash("sha256").update(output).digest("hex"),
          });
          const repaired = await provider.generate({
            ...baseRequest,
            mode: "repair",
            boundedContext: {
              schemaId: passagePlanningCandidateSchema.id,
              schemaVersion: passagePlanningCandidateSchema.version,
              jobId,
              unitId: unit.id,
              inputFingerprint: unit.inputFingerprint,
            },
            maximumOutputTokens: Math.min(baseRequest.maximumOutputTokens, passagePlanningCandidateLimits.maximumRepairOutputTokens),
            repair: { malformedOutput: output, validationIssues: issues.slice(0, 50) },
          });
          repairs += 1 + (repaired.providerRepairCount ?? 0);
          repairAudit.repairsPerformed = repairs;
          if (repairs > passagePlanningCandidateLimits.maximumRepairsPerExecutionAttempt) {
            throw Object.assign(new Error("Provider exceeded the structured-output repair limit"), {
              code: "repair_limit_exceeded", retryable: false,
            });
          }
          if (repaired.usage) usage.push(repaired.usage);
          if (repaired.providerMetadata) providerMetadata.push(repaired.providerMetadata);
          output = repaired.output;
          validated = validatePassagePlanningCandidate({
            raw: output, jobId, unitId: unit.id, inputFingerprint: unit.inputFingerprint, context,
            maximumOutputTokens: passagePlanningCandidateLimits.maximumRepairOutputTokens,
          });
        }
        if (controller.signal.aborted) break;
        job = this.generations.completeUnitWithCandidate(projectId, jobId, unit.id, attemptId, {
          contextFingerprint: unit.contextFingerprint!, providerId: plan.providerId, modelId: plan.modelId,
          outputSchemaId: passagePlanningCandidateSchema.id,
          outputSchemaVersion: passagePlanningCandidateSchema.version,
          content: validated.candidate,
          validation: validated.diagnostics,
          usage: { ...totalUsage(usage), providerMetadata },
          repair: repairAudit,
        });
      } catch (error) {
        if (controller.signal.aborted) break;
        const providerRepairs = error && typeof error === "object"
          ? Number((error as { structuredRepairAttempts?: unknown }).structuredRepairAttempts ?? 0) : 0;
        repairAudit.repairsPerformed = Math.max(repairAudit.repairsPerformed, Math.min(1, providerRepairs));
        const normalized = normalizePassagePlanningError(error);
        job = this.generations.failUnit(
          projectId, jobId, unit.id, attemptId, {
            ...normalized,
            message: redactSecret(normalized.message),
            validationIssues: candidateIssues(error),
            repair: repairAudit,
          },
        );
      }
    }
    if (!controller.signal.aborted && job.status === "running") this.generations.finalizeJob(projectId, jobId);
  }

  private exactArtifact<T>(projectId: string, artifactId: string, versionId: string | undefined): T {
    if (!versionId) throw new Error(`Approved snapshot is missing exact ${artifactId} dependency`);
    const version = this.artifacts.getVersion<T>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== artifactId) {
      throw new Error(`Exact approved ${artifactId} dependency is missing or inconsistent`);
    }
    return version.content;
  }

  private exactStoredContext(value: unknown, fingerprint: string | undefined): PassagePlanningContextPack {
    if (!value || typeof value !== "object" || !fingerprint) {
      throw Object.assign(new Error("Authorized unit has no persisted bounded context"), {
        code: "bounded_context_missing", retryable: false,
      });
    }
    const context = value as PassagePlanningContextPack;
    if (fingerprintPassagePlanningContext(context) !== fingerprint) {
      throw Object.assign(new Error("Persisted bounded context fingerprint is inconsistent"), {
        code: "bounded_context_inconsistent", retryable: false,
      });
    }
    return context;
  }

  private requireProvider(providerId: string): PassagePlanningProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Passage-planning provider ${providerId} is not available`);
    return provider;
  }

  private requireProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
  }
}

function candidateIssues(error: unknown): string[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    return (error as { issues: unknown[] }).issues.slice(0, 50).map(String);
  }
  return [error instanceof Error ? error.message : String(error)];
}

function totalUsage(items: PassagePlanningProviderUsage[]) {
  return items.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
    cost: total.cost === null || item.cost === null ? null : total.cost + item.cost,
  }), { inputTokens: 0, outputTokens: 0, cost: 0 as number | null });
}
