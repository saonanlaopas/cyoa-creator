import {
  buildPassageGenerationPlan,
  normalizePassagePlanningError,
  PassageGenerationScopeSchema,
  passageGenerationPolicyV1,
  type PassagePlan,
  type PassagePlanningProvider,
  type PassageStructure,
} from "@story-to-cyoa/pipeline";
import type {
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
    private readonly passagePlans: PassagePlanRepository,
    private readonly generations: GenerationRepository,
    private readonly provider: PassagePlanningProvider,
  ) {
    this.generations.recoverInterrupted();
  }

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
    if (plan.providerId !== this.provider.id) {
      throw new Error(`Provider ${plan.providerId} is not available for this offline checkpoint`);
    }
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
    return buildPassageGenerationPlan({
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: snapshot.structureVersionId,
      upstreamVersions: snapshot.upstreamVersions,
      structure: structure.content,
      passages: passages.map((item) => ({ versionId: item.id, content: item.content })),
      scope: PassageGenerationScopeSchema.parse(request.scope),
      providerId: request.providerId ?? this.provider.id,
      modelId: request.modelId ?? "deterministic-fixture-v1",
      policy: passageGenerationPolicyV1,
    });
  }

  private async run(projectId: string, jobId: string, controller: AbortController): Promise<void> {
    let job = this.getJob(projectId, jobId);
    const plan = this.getPlan(projectId, job.planId);
    for (const unit of job.units) {
      if (controller.signal.aborted || unit.status !== "pending") continue;
      const { attemptId } = this.generations.startUnit(projectId, jobId, unit.id);
      try {
        const result = await this.provider.generate({
          jobId,
          unitId: unit.id,
          providerId: plan.providerId,
          modelId: plan.modelId,
          inputFingerprint: unit.inputFingerprint,
          boundedContext: {
            snapshotId: plan.snapshotId,
            upstreamVersions: plan.upstreamVersions,
            scope: plan.scope,
            sequenceId: unit.sequenceId,
            passageIds: unit.passageIds,
            passageVersionIds: unit.passageVersionIds,
          },
          outputSchema: { checkpoint: "lifecycle-only", proposalOutputEnabled: false },
          maximumOutputTokens: unit.estimatedOutputTokens,
          signal: controller.signal,
        });
        if (controller.signal.aborted) break;
        job = this.generations.completeUnit(projectId, jobId, unit.id, attemptId, result);
      } catch (error) {
        if (controller.signal.aborted) break;
        job = this.generations.failUnit(
          projectId, jobId, unit.id, attemptId, normalizePassagePlanningError(error),
        );
      }
    }
    if (!controller.signal.aborted && job.status === "running") this.generations.finalizeJob(projectId, jobId);
  }

  private requireProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
  }
}
