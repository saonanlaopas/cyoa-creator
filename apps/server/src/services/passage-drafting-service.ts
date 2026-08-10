import { createHash } from "node:crypto";
import {
  buildPassageDraftingContext,
  buildPassageDraftingPlan,
  fingerprintPassageDraftingContext,
  normalizePassageDraftingError,
  passageDraftingOutputLimits,
  passageDraftingPolicyV1,
  passageDraftingUnitOutputSchema,
  stableJson,
  validatePassageDraftingOutput,
  type AcceptedNeighborDraftInput,
  type ChoicePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormRoutePlan,
  type LongFormStoryBible,
  type NarrativeThread,
  type PassageDraftingContextPack,
  type PassageDraftingProvider,
  type PassageDraftingProviderUsage,
  type PassageDraftingScope,
  type PassagePlan,
  type PassageStructure,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
import { redactSecret } from "@story-to-cyoa/openrouter";
import type {
  ArtifactRepository,
  DraftingJobRecord,
  DraftingPlanRecord,
  DraftingRepository,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";

const upstreamArtifactIds = ["brief", "bible", "routes", "endings", "mechanics"] as const;

export interface PassageDraftingPlanRequest {
  scope: unknown;
  providerId?: string;
  modelId?: string;
}

export class PassageDraftingService {
  private readonly providers: Map<string, PassageDraftingProvider>;
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
    private readonly drafting: DraftingRepository,
    provider: PassageDraftingProvider | PassageDraftingProvider[],
  ) {
    this.providers = new Map((Array.isArray(provider) ? provider : [provider]).map((item) => [item.id, item]));
    this.drafting.recoverInterrupted();
  }

  preview(projectId: string, request: PassageDraftingPlanRequest) { return this.build(projectId, request); }

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

  start(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    const job = this.getJob(projectId, jobId);
    const plan = this.getPlan(projectId, job.planId);
    this.requireProvider(plan.providerId);
    this.assertPlanFresh(plan);
    const running = this.drafting.startJob(projectId, jobId);
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const task = this.run(projectId, jobId, controller).finally(() => {
      this.controllers.delete(jobId);
      this.tasks.delete(jobId);
    });
    this.tasks.set(jobId, task);
    return running;
  }

  retryUnit(projectId: string, jobId: string, unitId: string): DraftingJobRecord {
    this.requireProject(projectId);
    return this.drafting.retryUnit(projectId, jobId, unitId);
  }

  cancel(projectId: string, jobId: string): DraftingJobRecord {
    this.requireProject(projectId);
    this.controllers.get(jobId)?.abort();
    return this.drafting.cancelJob(projectId, jobId);
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.tasks.values());
  }

  private build(projectId: string, request: PassageDraftingPlanRequest) {
    this.requireProject(projectId);
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || !state.approvedSnapshotId) {
      throw new Error("Approve the passage-plan snapshot before creating a drafting plan");
    }
    const snapshot = this.passagePlans.getSnapshot(state.approvedSnapshotId);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "approved") {
      throw new Error("Approved passage-plan snapshot not found");
    }
    const structure = this.passagePlans.getStructureVersion<PassageStructure>(snapshot.structureVersionId);
    if (!structure || structure.projectId !== projectId) throw new Error("Passage-plan snapshot structure not found");
    const passages = this.passagePlans.snapshotEntities<PassagePlan>(snapshot.id, "passage")
      .map((item) => ({ versionId: item.id, content: item.content }));
    const choices = this.passagePlans.snapshotEntities<ChoicePlan>(snapshot.id, "choice")
      .map((item) => ({ versionId: item.id, content: item.content }));
    const threads = this.passagePlans.snapshotEntities<NarrativeThread>(snapshot.id, "thread")
      .map((item) => ({ versionId: item.id, content: item.content }));
    const exact = this.exactUpstream(projectId, snapshot.upstreamVersions);
    const acceptedDrafts = this.acceptedDrafts(projectId, passages.map((item) => item.content.id));
    const scope = request.scope as PassageDraftingScope;
    return buildPassageDraftingPlan({
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: structure.id,
      upstreamVersions: snapshot.upstreamVersions,
      structure: structure.content,
      passages,
      choices,
      scope,
      providerId: request.providerId?.trim() || "offline-drafting",
      modelId: request.modelId?.trim() || "deterministic-prose-v1",
      policy: passageDraftingPolicyV1,
      buildUnitContext: ({ unitId, passageIds, requestedMaximumOutputTokens, maximumEstimatedInputTokens }) =>
        buildPassageDraftingContext({
          projectId,
          unitId,
          snapshotId: snapshot.id,
          structureVersionId: structure.id,
          upstreamVersions: snapshot.upstreamVersions,
          structure: structure.content,
          passages,
          choices,
          threads,
          targetPassageIds: passageIds,
          ...exact,
          acceptedDrafts,
          maximumEstimatedInputTokens,
          requestedMaximumOutputTokens,
        }),
    });
  }

  private async run(projectId: string, jobId: string, controller: AbortController): Promise<void> {
    let job = this.getJob(projectId, jobId);
    const plan = this.getPlan(projectId, job.planId);
    const provider = this.requireProvider(plan.providerId);
    for (const unit of job.units) {
      if (controller.signal.aborted || unit.status !== "pending") continue;
      const { attemptId } = this.drafting.startUnit(projectId, jobId, unit.id);
      const repairAudit: {
        maximumRepairs: number;
        repairsPerformed: number;
        history: Array<{ kind: string; issues: string[]; malformedBytes: number; malformedSha256: string }>;
      } = { maximumRepairs: 1, repairsPerformed: 0, history: [] };
      try {
        this.assertPlanFresh(plan, unit.id);
        const context = this.exactStoredContext(unit.context, unit.contextFingerprint);
        const maximumOutputTokens = Math.min(
          unit.estimatedOutputTokens,
          passageDraftingPolicyV1.maxOutputTokensPerUnit,
          passageDraftingPolicyV1.maxOutputTokensPerPassage * unit.passageIds.length,
        );
        const baseRequest = {
          jobId,
          unitId: unit.id,
          providerId: plan.providerId,
          modelId: plan.modelId,
          inputFingerprint: unit.inputFingerprint,
          contextFingerprint: unit.contextFingerprint!,
          boundedContext: context,
          outputSchema: passageDraftingUnitOutputSchema,
          capabilityRequirements: { structuredOutput: true, localValidation: true },
          maximumOutputTokens,
          signal: controller.signal,
        } as const;
        this.assertPlanFresh(plan, unit.id);
        const first = await provider.generate({ ...baseRequest, mode: "generate" });
        const usage: PassageDraftingProviderUsage[] = first.usage ? [first.usage] : [];
        const providerMetadata: Record<string, unknown>[] = first.providerMetadata ? [first.providerMetadata] : [];
        let output = first.output;
        let repairs = first.providerRepairCount ?? 0;
        repairAudit.repairsPerformed = repairs;
        let validated;
        try {
          validated = this.validateOutput(output, context, maximumOutputTokens);
        } catch (validationError) {
          if (validationError && typeof validationError === "object"
            && (validationError as { structurallyRepairable?: unknown }).structurallyRepairable === false) {
            throw validationError;
          }
          if (repairs >= passageDraftingOutputLimits.maximumRepairsPerExecutionAttempt) throw validationError;
          const issues = outputIssues(validationError);
          const malformedBytes = Buffer.byteLength(output, "utf8");
          if (malformedBytes > passageDraftingOutputLimits.maximumRepairInputBytes) {
            throw Object.assign(new Error("Malformed drafting output exceeds the repair-input limit"), {
              code: "drafting_repair_payload_too_large", retryable: true,
            });
          }
          repairAudit.history.push({
            kind: "structured-output-repair",
            issues,
            malformedBytes,
            malformedSha256: createHash("sha256").update(output).digest("hex"),
          });
          const expected = context.targets.map((item) => ({
            passageId: item.content.id,
            basedOnPassagePlanVersionId: item.versionId,
          }));
          this.assertPlanFresh(plan, unit.id);
          const repaired = await provider.generate({
            ...baseRequest,
            mode: "repair",
            boundedContext: {
              schemaId: passageDraftingUnitOutputSchema.id,
              schemaVersion: passageDraftingUnitOutputSchema.version,
              expectedPassages: expected,
            },
            repair: { malformedOutput: output, validationIssues: issues.slice(0, 50) },
          });
          repairs += 1 + (repaired.providerRepairCount ?? 0);
          repairAudit.repairsPerformed = repairs;
          if (repairs > passageDraftingOutputLimits.maximumRepairsPerExecutionAttempt) {
            throw Object.assign(new Error("Provider exceeded the drafting structural-repair limit"), {
              code: "drafting_repair_limit_exceeded", retryable: false,
            });
          }
          if (repaired.usage) usage.push(repaired.usage);
          if (repaired.providerMetadata) providerMetadata.push(repaired.providerMetadata);
          output = repaired.output;
          validated = this.validateOutput(output, context, maximumOutputTokens);
        }
        if (controller.signal.aborted) break;
        const neighboringDraftVersions = Object.fromEntries(
          context.acceptedNeighborProse.map((item) => [item.passageId, item.draftVersionId]),
        );
        const completed = this.drafting.completeUnitWithCandidates(
          projectId,
          jobId,
          unit.id,
          attemptId,
          this.drafts,
          {
            contextFingerprint: unit.contextFingerprint!,
            providerId: plan.providerId,
            modelId: plan.modelId,
            outputSchemaId: passageDraftingUnitOutputSchema.id,
            outputSchemaVersion: passageDraftingUnitOutputSchema.version,
            content: validated.output,
            validation: validated.diagnostics,
            usage: { ...totalUsage(usage), providerMetadata },
            repair: repairAudit,
            upstreamVersions: plan.upstreamVersions,
            neighboringDraftVersions,
            passages: validated.output.passages.map((item) => ({
              passageId: item.passageId,
              passagePlanVersionId: item.basedOnPassagePlanVersionId,
              proseMarkdown: item.proseMarkdown,
            })),
          },
        );
        job = completed.job;
      } catch (error) {
        if (controller.signal.aborted) break;
        const providerRepairs = error && typeof error === "object"
          ? Number((error as { structuredRepairAttempts?: unknown }).structuredRepairAttempts ?? 0) : 0;
        repairAudit.repairsPerformed = Math.max(repairAudit.repairsPerformed, Math.min(1, providerRepairs));
        const normalized = normalizePassageDraftingError(error);
        job = this.drafting.failUnit(projectId, jobId, unit.id, attemptId, {
          ...normalized,
          message: redactSecret(normalized.message),
          validationIssues: outputIssues(error).map((issue) => redactSecret(issue)),
          repair: repairAudit,
        });
      }
    }
    if (!controller.signal.aborted && job.status === "running") this.drafting.finalizeJob(projectId, jobId);
  }

  private validateOutput(raw: string, context: PassageDraftingContextPack, maximumOutputTokens: number) {
    return validatePassageDraftingOutput({
      raw,
      expectedPassages: context.targets.map((item) => ({
        passageId: item.content.id,
        passagePlanVersionId: item.versionId,
        wordTarget: item.content.wordTarget,
      })),
      maximumOutputTokensPerPassage: passageDraftingPolicyV1.maxOutputTokensPerPassage,
      maximumOutputTokens,
      maximumSerializedBytes: passageDraftingPolicyV1.maxSerializedCandidateBytes,
    });
  }

  private assertPlanFresh(plan: DraftingPlanRecord, unitId?: string): void {
    const passagePlanState = this.passagePlans.state(plan.projectId);
    if (passagePlanState.status !== "approved"
      || passagePlanState.approvedSnapshotId !== plan.snapshotId) {
      throw stalePlanError("Current approved passage-plan snapshot no longer matches the authorized drafting plan");
    }
    const approvedSnapshot = this.passagePlans.getSnapshot(plan.snapshotId);
    if (!approvedSnapshot || approvedSnapshot.projectId !== plan.projectId
      || approvedSnapshot.status !== "approved") {
      throw stalePlanError("Authorized drafting-plan snapshot is no longer approved");
    }
    const units = unitId ? plan.units.filter((unit) => unit.id === unitId) : plan.units;
    for (const unit of units) {
      const context = this.exactStoredContext(unit.context, unit.contextFingerprint);
      for (const target of context.targets) {
        const current = this.passagePlans.currentEntity<PassagePlan>(plan.projectId, "passage", target.content.id);
        if (!current || current.id !== target.versionId) {
          throw stalePlanError(`Target passage-plan head changed for ${target.content.id}`);
        }
      }
      for (const neighbor of context.acceptedNeighborProse) {
        const head = this.drafts.getHead(plan.projectId, neighbor.passageId);
        const exact = this.drafts.getVersion(plan.projectId, neighbor.draftVersionId);
        if (!head?.accepted || head.accepted.id !== neighbor.draftVersionId || !exact || exact.stale) {
          throw stalePlanError(`Accepted neighboring prose changed or became stale for ${neighbor.passageId}`);
        }
      }
      const currentVersions = this.approvedUpstreamVersions(plan.projectId);
      if (stableJson(currentVersions) !== stableJson(plan.upstreamVersions)) {
        const exact = this.exactUpstream(plan.projectId, currentVersions);
        const currentContext = buildPassageDraftingContext({
          projectId: plan.projectId,
          unitId: unit.id,
          snapshotId: plan.snapshotId,
          structureVersionId: plan.structureVersionId,
          upstreamVersions: currentVersions,
          structure: this.requireStructure(plan),
          passages: this.snapshotPassages(plan),
          choices: this.snapshotChoices(plan),
          threads: this.snapshotThreads(plan),
          targetPassageIds: unit.passageIds,
          ...exact,
          acceptedDrafts: this.acceptedDrafts(plan.projectId, this.snapshotPassages(plan).map((item) => item.content.id)),
          maximumEstimatedInputTokens: passageDraftingPolicyV1.maxEstimatedInputTokensPerUnit,
          requestedMaximumOutputTokens: unit.estimatedOutputTokens,
        }).context;
        if (stableJson(currentContext.upstream) !== stableJson(context.upstream)) {
          throw stalePlanError("Required approved upstream drafting context changed materially");
        }
      }
    }
  }

  private exactStoredContext(value: unknown, fingerprint: string | undefined): PassageDraftingContextPack {
    if (!value || typeof value !== "object" || !fingerprint) {
      throw Object.assign(new Error("Authorized drafting unit has no persisted 4B-2 bounded context; create a new plan"), {
        code: "bounded_drafting_context_missing", retryable: false,
      });
    }
    const context = value as PassageDraftingContextPack;
    if (fingerprintPassageDraftingContext(context) !== fingerprint) {
      throw Object.assign(new Error("Persisted drafting context fingerprint is inconsistent"), {
        code: "bounded_drafting_context_inconsistent", retryable: false,
      });
    }
    return context;
  }

  private exactUpstream(projectId: string, versions: Record<string, string>) {
    return {
      brief: this.exactArtifact<ProjectBrief>(projectId, "brief", versions.brief),
      bible: this.exactArtifact<LongFormStoryBible>(projectId, "bible", versions.bible),
      routes: this.exactArtifact<LongFormRoutePlan>(projectId, "routes", versions.routes),
      endings: this.exactArtifact<LongFormEndingPlan>(projectId, "endings", versions.endings),
      mechanics: this.exactArtifact<LongFormMechanicsPlan>(projectId, "mechanics", versions.mechanics),
    };
  }

  private exactArtifact<T>(projectId: string, artifactId: string, versionId: string | undefined): T {
    if (!versionId) throw new Error(`Approved snapshot is missing exact ${artifactId} dependency`);
    const version = this.artifacts.getVersion<T>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== artifactId) {
      throw new Error(`Exact approved ${artifactId} dependency is missing or inconsistent`);
    }
    return version.content;
  }

  private approvedUpstreamVersions(projectId: string): Record<string, string> {
    return Object.fromEntries(upstreamArtifactIds.map((artifactId) => {
      const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
      if (!versionId) throw stalePlanError(`Approved ${artifactId} dependency is missing`);
      return [artifactId, versionId];
    }));
  }

  private acceptedDrafts(projectId: string, passageIds: string[]): AcceptedNeighborDraftInput[] {
    return passageIds.flatMap((passageId) => {
      const accepted = this.drafts.getHead(projectId, passageId)?.accepted;
      if (!accepted) return [];
      return [{
        passageId,
        draftVersionId: accepted.id,
        basedOnPassagePlanVersionId: accepted.basedOnPassagePlanVersionId,
        proseMarkdown: accepted.proseMarkdown,
        wordCount: accepted.wordCount,
        lifecycleStatus: accepted.lifecycleStatus as "accepted" | "reviewed" | "locked",
        stale: accepted.stale,
      }];
    });
  }

  private requireStructure(plan: DraftingPlanRecord): PassageStructure {
    const structure = this.passagePlans.getStructureVersion<PassageStructure>(plan.structureVersionId);
    if (!structure || structure.projectId !== plan.projectId) throw stalePlanError("Planned passage structure is missing");
    return structure.content;
  }
  private snapshotPassages(plan: DraftingPlanRecord) {
    return this.passagePlans.snapshotEntities<PassagePlan>(plan.snapshotId, "passage")
      .map((item) => ({ versionId: item.id, content: item.content }));
  }
  private snapshotChoices(plan: DraftingPlanRecord) {
    return this.passagePlans.snapshotEntities<ChoicePlan>(plan.snapshotId, "choice")
      .map((item) => ({ versionId: item.id, content: item.content }));
  }
  private snapshotThreads(plan: DraftingPlanRecord) {
    return this.passagePlans.snapshotEntities<NarrativeThread>(plan.snapshotId, "thread")
      .map((item) => ({ versionId: item.id, content: item.content }));
  }

  private requireProvider(providerId: string): PassageDraftingProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Passage-drafting provider ${providerId} is not available`);
    return provider;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }
}

function stalePlanError(message: string): Error {
  return Object.assign(new Error(message), { code: "stale_drafting_plan", retryable: false });
}

function outputIssues(error: unknown): string[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    return (error as { issues: unknown[] }).issues.slice(0, 50).map(String);
  }
  return [error instanceof Error ? error.message : String(error)];
}

function totalUsage(items: PassageDraftingProviderUsage[]) {
  return items.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
    cost: total.cost === null || item.cost === null ? null : total.cost + item.cost,
  }), { inputTokens: 0, outputTokens: 0, cost: 0 as number | null });
}
