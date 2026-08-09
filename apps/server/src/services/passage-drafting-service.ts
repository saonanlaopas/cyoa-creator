import {
  buildPassageDraftingPlan,
  passageDraftingPolicyV1,
  type ChoicePlan,
  type PassageDraftingScope,
  type PassagePlan,
  type PassageStructure,
} from "@story-to-cyoa/pipeline";
import type {
  DraftingJobRecord,
  DraftingPlanRecord,
  DraftingRepository,
  PassagePlanRepository,
  ProjectRepository,
} from "@story-to-cyoa/persistence";

export interface PassageDraftingPlanRequest {
  scope: unknown;
  providerId?: string;
  modelId?: string;
}

export class PassageDraftingService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafting: DraftingRepository,
  ) {
    this.drafting.recoverInterrupted();
  }

  preview(projectId: string, request: PassageDraftingPlanRequest) {
    return this.build(projectId, request);
  }

  create(projectId: string, request: PassageDraftingPlanRequest): DraftingPlanRecord {
    const planned = this.build(projectId, request);
    return this.drafting.createPlan({
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
      executionPolicyId: planned.policy.id,
      executionPolicy: planned.policy,
      units: planned.units,
    });
  }

  list(projectId: string): DraftingPlanRecord[] {
    this.requireProject(projectId);
    return this.drafting.listPlans(projectId);
  }

  getPlan(projectId: string, planId: string): DraftingPlanRecord {
    this.requireProject(projectId);
    const plan = this.drafting.getPlan(projectId, planId);
    if (!plan) throw new Error("Drafting plan not found");
    return plan;
  }

  authorize(projectId: string, planId: string, fingerprint: string): DraftingPlanRecord {
    this.requireProject(projectId);
    return this.drafting.authorize(projectId, planId, fingerprint);
  }

  getJob(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    const job = this.drafting.getJob(projectId, jobId);
    if (!job) throw new Error("Drafting job not found");
    return job;
  }

  startJob(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.startJob(projectId, jobId);
  }

  startUnit(projectId: string, jobId: string, unitId: string) {
    this.requireProject(projectId);
    return this.drafting.startUnit(projectId, jobId, unitId);
  }

  completeUnit(projectId: string, jobId: string, unitId: string, attemptId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.completeUnit(projectId, jobId, unitId, attemptId, {
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      syntheticLifecycleOnly: true,
    });
  }

  failUnit(projectId: string, jobId: string, unitId: string, attemptId: string, error: unknown): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.failUnit(projectId, jobId, unitId, attemptId, error);
  }

  finalizeJob(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.finalizeJob(projectId, jobId);
  }

  retryUnit(projectId: string, jobId: string, unitId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.retryUnit(projectId, jobId, unitId);
  }

  cancel(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.cancelJob(projectId, jobId);
  }

  private build(projectId: string, request: PassageDraftingPlanRequest) {
    this.requireProject(projectId);
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || !state.approvedSnapshotId) {
      throw new Error("Approve the passage-plan snapshot before creating a drafting plan");
    }
    const snapshot = this.passagePlans.getSnapshot(state.approvedSnapshotId);
    if (!snapshot || snapshot.status !== "approved") throw new Error("Approved passage-plan snapshot not found");
    const structure = this.passagePlans.getStructureVersion<PassageStructure>(snapshot.structureVersionId);
    if (!structure || structure.projectId !== projectId) throw new Error("Passage-plan snapshot structure not found");
    const passages = this.passagePlans.snapshotEntities<PassagePlan>(snapshot.id, "passage")
      .map((item) => ({ versionId: item.id, content: item.content }));
    const choices = this.passagePlans.snapshotEntities<ChoicePlan>(snapshot.id, "choice")
      .map((item) => ({ versionId: item.id, content: item.content }));
    return buildPassageDraftingPlan({
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: structure.id,
      upstreamVersions: snapshot.upstreamVersions,
      structure: structure.content,
      passages,
      choices,
      scope: request.scope as PassageDraftingScope,
      providerId: request.providerId?.trim() || "offline-drafting-lifecycle",
      modelId: request.modelId?.trim() || "no-prose-v1",
      policy: passageDraftingPolicyV1,
    });
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }
}
