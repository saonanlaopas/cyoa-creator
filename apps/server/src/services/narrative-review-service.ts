import { createHash, randomUUID } from "node:crypto";
import {
  NarrativeReviewCategorySchema,
  buildNarrativeReviewPlan,
  narrativeReviewDigest,
  narrativeReviewFindingSchema,
  narrativeReviewOutputSchema,
  narrativeReviewPolicyV1,
  validateNarrativeReviewOutput,
  type NarrativeReviewCategory,
  type NarrativeReviewContext,
  type NarrativeReviewFindingCandidate,
  type NarrativeReviewPlanInput,
  type NarrativeReviewPolicy,
  type NarrativeReviewProvider,
  type PlannedNarrativeReview,
  type ReviewCampaignEvidence,
  type ReviewSimulationEvidence,
} from "@story-to-cyoa/pipeline";
import { redactSecret } from "@story-to-cyoa/openrouter";
import {
  narrativeReviewFindingFingerprint,
  type ArtifactRepository,
  type NarrativeReviewAggregateShape,
  type NarrativeReviewRepository,
  type PassageDraftRepository,
  type PassagePlanRepository,
  type ProjectRepository,
  type WorkflowRepository,
} from "@story-to-cyoa/persistence";
import { SimulationService } from "./simulation-service.js";
import { PlaytestService } from "./playtest-service.js";

export type ReviewLifecycle = "planned" | "authorized" | "running" | "completed" | "partially-failed" | "failed" | "cancelled";
export type ReviewUnitLifecycle = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface NarrativeReviewInputRecord {
  schemaVersion: 1; projectId: string; simulationInputVersionId: string;
  simulationInputFingerprint: string; snapshotId: string; structureVersionId: string;
  scopePassageIds: string[];
  passageVersions: Array<{ entityId: string; versionId: string }>;
  choiceVersions: Array<{ entityId: string; versionId: string }>;
  threadVersions: Array<{ entityId: string; versionId: string }>;
  acceptedDraftVersions: Array<{ entityId: string; versionId: string; stale: boolean }>;
  upstreamVersions: Record<string, string>;
  simulationRunVersionIds: string[]; campaignVersionIds: string[];
  reviewPolicyId: string; fingerprint: string;
}
export interface NarrativeReviewFindingRecord extends NarrativeReviewFindingCandidate {
  schemaId: typeof narrativeReviewFindingSchema.id; schemaVersion: typeof narrativeReviewFindingSchema.version;
  id: string; fingerprint: string; reviewPlanId: string; jobId: string; unitId: string; attemptId: string;
  reviewInputFingerprint: string; contextFingerprint: string;
}
export interface NarrativeReviewAttemptRecord {
  id: string; number: number; status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string; finishedAt: string | null;
  error: { code: string; message: string; retryable: boolean; validationIssues: string[] } | null;
  repair: { maximum: 1; performed: number; malformedBytes: number | null; malformedSha256: string | null };
  usage: { inputTokens: number; outputTokens: number; cost: number | null } | null;
  providerMetadata: Record<string, unknown>[];
}
export interface NarrativeReviewUnitRecord {
  id: string; position: number; passageIds: string[]; inputFingerprint: string; contextFingerprint: string;
  estimatedInputTokens: number; maximumOutputTokens: number; context: NarrativeReviewContext;
  diagnostics: PlannedNarrativeReview["units"][number]["diagnostics"];
  status: ReviewUnitLifecycle; attempts: NarrativeReviewAttemptRecord[]; findings: NarrativeReviewFindingRecord[];
}
export interface NarrativeReviewAggregate extends NarrativeReviewAggregateShape {
  schemaVersion: 1; projectId: string;
  reviewInput: NarrativeReviewInputRecord;
  plan: {
    id: string; fingerprint: string; definitionFingerprint: string; status: "planned" | "authorized";
    authorizedFingerprint: string | null; providerId: string; modelId: string; categories: NarrativeReviewCategory[];
    scopePassageIds: string[]; policy: NarrativeReviewPolicy; estimatedInputTokens: number;
  };
  job: { id: string; status: ReviewLifecycle; createdAt: string; startedAt: string | null; finishedAt: string | null; units: NarrativeReviewUnitRecord[] };
  currentState?: { status: "current" | "historical"; reason: string | null };
}

export interface NarrativeReviewRequest {
  simulationInputVersionId?: unknown; scopePassageIds?: unknown; simulationRunVersionIds?: unknown;
  campaignVersionIds?: unknown; providerId?: unknown; modelId?: unknown; categories?: unknown; policy?: unknown;
}

export class NarrativeReviewServiceError extends Error {
  public constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly details?: unknown) { super(message); }
}

export class NarrativeReviewService {
  private readonly providers: Map<string, NarrativeReviewProvider>;
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
    private readonly reviews: NarrativeReviewRepository,
    private readonly simulations: SimulationService,
    private readonly playtests: PlaytestService,
    providers: NarrativeReviewProvider[],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.recoverInterrupted();
  }

  preview(projectId: string, request: NarrativeReviewRequest) { return this.build(projectId, request); }

  create(projectId: string, request: NarrativeReviewRequest): NarrativeReviewAggregate {
    const built = this.build(projectId, request);
    const now = new Date().toISOString(); const planId = randomUUID();
    const aggregate: NarrativeReviewAggregate = {
      schemaVersion: 1, projectId, reviewInput: built.reviewInput,
      plan: {
        id: planId, fingerprint: built.plan.fingerprint, definitionFingerprint: built.plan.fingerprint,
        status: "planned", authorizedFingerprint: null, providerId: built.plan.providerId, modelId: built.plan.modelId,
        categories: built.plan.categories, scopePassageIds: built.plan.scopePassageIds,
        policy: built.plan.policy, estimatedInputTokens: built.plan.estimatedInputTokens,
      },
      job: {
        id: randomUUID(), status: "planned", createdAt: now, startedAt: null, finishedAt: null,
        units: built.plan.units.map((unit) => ({ ...unit, status: "pending", attempts: [], findings: [] })),
      },
    };
    return this.reviews.create(aggregate).content;
  }

  list(projectId: string): NarrativeReviewAggregate[] { this.requireProject(projectId); this.recoverProject(projectId); return this.reviews.list<NarrativeReviewAggregate>(projectId).map((item) => this.decorate(item.content)); }
  get(projectId: string, planId: string): NarrativeReviewAggregate {
    return this.decorate(this.current(projectId, planId));
  }
  private decorate(current: NarrativeReviewAggregate): NarrativeReviewAggregate {
    const result = clone(current);
    try { this.assertFresh(result); result.currentState = { status: "current", reason: null }; }
    catch (error) { result.currentState = { status: "historical", reason: error instanceof Error ? error.message : String(error) }; }
    return result;
  }
  private current(projectId: string, planId: string): NarrativeReviewAggregate {
    this.requireProject(projectId); this.recoverProject(projectId); const record = this.reviews.get<NarrativeReviewAggregate>(projectId, planId);
    if (!record) throw new NarrativeReviewServiceError("narrative_review_not_found", "Narrative review not found");
    return record.content;
  }
  history(projectId: string, planId: string) { this.get(projectId, planId); return this.reviews.history<NarrativeReviewAggregate>(projectId, planId); }

  authorize(projectId: string, planId: string, fingerprint: string): NarrativeReviewAggregate {
    const current = this.current(projectId, planId);
    if (current.plan.fingerprint !== fingerprint) throw new NarrativeReviewServiceError("review_authorization_mismatch", "Authorization must match the exact review-plan fingerprint");
    if (current.plan.status !== "planned" || current.job.status !== "planned") throw new NarrativeReviewServiceError("review_transition_invalid", "Only a planned review can be authorized");
    this.assertFresh(current);
    const next = clone(current); next.plan.status = "authorized"; next.plan.authorizedFingerprint = fingerprint; next.job.status = "authorized";
    return this.reviews.update(next, { assertFreshInTransaction: () => this.assertFresh(next) }).content;
  }

  start(projectId: string, planId: string): NarrativeReviewAggregate {
    const current = this.current(projectId, planId);
    if (current.plan.status !== "authorized" || current.plan.authorizedFingerprint !== current.plan.fingerprint
      || !["authorized", "partially-failed", "failed"].includes(current.job.status)) {
      throw new NarrativeReviewServiceError("review_not_authorized", "Explicit authorization of the exact fingerprint is required");
    }
    if (!current.job.units.some((unit) => unit.status === "pending")) throw new NarrativeReviewServiceError("review_no_pending_units", "No review units are pending");
    this.requireProvider(current.plan.providerId); this.assertFresh(current);
    const next = clone(current); next.job.status = "running"; next.job.startedAt ??= new Date().toISOString(); next.job.finishedAt = null;
    const running = this.reviews.update(next, { assertFreshInTransaction: () => this.assertFresh(next) }).content;
    const controller = new AbortController(); this.controllers.set(next.job.id, controller);
    const task = this.run(projectId, planId, controller).finally(() => { this.controllers.delete(next.job.id); this.tasks.delete(next.job.id); });
    this.tasks.set(next.job.id, task); return running;
  }

  retryUnit(projectId: string, planId: string, unitId: string): NarrativeReviewAggregate {
    const current = this.current(projectId, planId); const next = clone(current); const unit = requireUnit(next, unitId);
    if (unit.status !== "failed") throw new NarrativeReviewServiceError("review_transition_invalid", "Only a failed unit can be retried");
    if (unit.attempts.length >= next.plan.policy.maxAttemptsPerUnit) throw new NarrativeReviewServiceError("review_attempt_limit", "Unit attempt limit reached");
    unit.status = "pending"; next.job.status = "authorized"; next.job.finishedAt = null;
    return this.reviews.update(next).content;
  }

  cancel(projectId: string, planId: string): NarrativeReviewAggregate {
    const current = this.current(projectId, planId); if (current.job.status !== "running") throw new NarrativeReviewServiceError("review_transition_invalid", "Review job is not running");
    this.controllers.get(current.job.id)?.abort(); const next = clone(current); const now = new Date().toISOString();
    next.job.status = "cancelled"; next.job.finishedAt = now;
    next.job.units.forEach((unit) => {
      if (unit.status === "pending" || unit.status === "running") unit.status = "cancelled";
      const attempt = unit.attempts.at(-1); if (attempt?.status === "running") { attempt.status = "cancelled"; attempt.finishedAt = now; }
    });
    return this.reviews.update(next).content;
  }

  async shutdown(): Promise<void> { for (const controller of this.controllers.values()) controller.abort(); await Promise.allSettled(this.tasks.values()); }

  private build(projectId: string, request: NarrativeReviewRequest): { reviewInput: NarrativeReviewInputRecord; plan: PlannedNarrativeReview } {
    this.requireProject(projectId);
    const simulationInputVersionId = stringValue(request.simulationInputVersionId, "An exact simulation input version is required");
    const scopePassageIds = stringArray(request.scopePassageIds, "A stable-ID passage scope is required");
    const runVersionIds = optionalStringArray(request.simulationRunVersionIds);
    const campaignVersionIds = optionalStringArray(request.campaignVersionIds);
    const resolved = this.simulations.resolveInput(projectId, simulationInputVersionId);
    const targetPassageRefs = resolved.input.passageVersions.filter((item) => scopePassageIds.includes(item.entityId));
    if (targetPassageRefs.length !== new Set(scopePassageIds).size) throw new NarrativeReviewServiceError("review_scope_invalid", "Review scope contains a passage outside the exact simulation input");
    const relevantPassageIds = new Set(scopePassageIds);
    const choiceRefs = resolved.input.choiceVersions.filter((item) => {
      const choice = resolved.choices.find((candidate) => candidate.id === item.entityId)!;
      return relevantPassageIds.has(choice.sourcePassageId) || relevantPassageIds.has(choice.destinationPassageId);
    });
    const evidencePassageIds = new Set([...relevantPassageIds, ...choiceRefs.flatMap((item) => {
      const choice = resolved.choices.find((candidate) => candidate.id === item.entityId)!;
      return [choice.sourcePassageId, choice.destinationPassageId];
    })]);
    const passageRefs = resolved.input.passageVersions.filter((item) => evidencePassageIds.has(item.entityId));
    const threadRefs = resolved.input.threadVersions.filter((item) => {
      const thread = resolved.threads.find((candidate) => candidate.id === item.entityId)!;
      return thread.setupPassageIds.some((id) => relevantPassageIds.has(id)) || thread.payoffPassageIds.some((id) => relevantPassageIds.has(id));
    });
    const acceptedRefs = resolved.input.acceptedDraftVersions.filter((item) => evidencePassageIds.has(item.entityId));
    const acceptedDraftVersions = acceptedRefs.map((reference) => ({
      ...reference,
      stale: Boolean(resolved.acceptedDrafts.find((item) => item.id === reference.versionId)?.stale),
    }));
    const identity = {
      schemaVersion: 1 as const, projectId, simulationInputVersionId: resolved.inputVersion.id,
      simulationInputFingerprint: resolved.input.fingerprint, snapshotId: resolved.input.snapshotId,
      structureVersionId: resolved.input.structureVersionId, scopePassageIds: [...scopePassageIds].sort(), passageVersions: passageRefs,
      choiceVersions: choiceRefs, threadVersions: threadRefs, acceptedDraftVersions,
      upstreamVersions: sortRecord(resolved.input.upstreamVersions), simulationRunVersionIds: [...runVersionIds].sort(),
      campaignVersionIds: [...campaignVersionIds].sort(), reviewPolicyId: narrativeReviewPolicyV1.id,
    };
    const reviewInput: NarrativeReviewInputRecord = { ...identity, fingerprint: narrativeReviewDigest(identity) };
    const simulationRuns = runVersionIds.map((versionId) => this.simulationEvidence(projectId, versionId, resolved.inputVersion.id));
    const campaigns = campaignVersionIds.map((versionId) => this.campaignEvidence(projectId, versionId, resolved.inputVersion.id));
    const upstream = Object.fromEntries(Object.entries(resolved.input.upstreamVersions).map(([artifactId, versionId]) => {
      const version = this.artifacts.getVersion(versionId);
      if (!version || version.projectId !== projectId || version.artifactId !== artifactId) throw new NarrativeReviewServiceError("review_input_invalid", `Exact ${artifactId} evidence is missing`);
      return [artifactId, version.content];
    }));
    const policy = requestedPolicy(request.policy);
    const categories = request.categories === undefined ? undefined : NarrativeReviewCategorySchema.array().parse(request.categories);
    const planInput: NarrativeReviewPlanInput = {
      projectId, reviewInputFingerprint: reviewInput.fingerprint,
      passages: passageRefs.map((reference) => ({ versionId: reference.versionId, content: resolved.passages.find((item) => item.id === reference.entityId)! })),
      choices: choiceRefs.map((reference) => ({ versionId: reference.versionId, content: resolved.choices.find((item) => item.id === reference.entityId)! })),
      threads: threadRefs.map((reference) => ({ versionId: reference.versionId, content: resolved.threads.find((item) => item.id === reference.entityId)! })),
      acceptedDrafts: acceptedRefs.map((reference) => {
        const draft = resolved.acceptedDrafts.find((item) => item.id === reference.versionId)!;
        return { passageId: reference.entityId, draftVersionId: draft.id, passagePlanVersionId: draft.basedOnPassagePlanVersionId, proseMarkdown: draft.proseMarkdown, stale: draft.stale, lifecycleStatus: draft.lifecycleStatus as "accepted" | "reviewed" | "locked" };
      }),
      scopePassageIds, upstream, simulationRuns, campaigns,
      providerId: typeof request.providerId === "string" && request.providerId.trim() ? request.providerId.trim() : "offline-narrative-review",
      modelId: typeof request.modelId === "string" && request.modelId.trim() ? request.modelId.trim() : "deterministic-review-v1",
      categories, policy,
    };
    const plan = buildNarrativeReviewPlan(planInput);
    return { reviewInput, plan };
  }

  private async run(projectId: string, planId: string, controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      let current = this.current(projectId, planId); const pending = current.job.units.find((unit) => unit.status === "pending");
      if (!pending) break;
      const provider = this.requireProvider(current.plan.providerId); this.assertFresh(current);
      const next = clone(current); const unit = requireUnit(next, pending.id); const now = new Date().toISOString();
      const attempt: NarrativeReviewAttemptRecord = {
        id: randomUUID(), number: unit.attempts.length + 1, status: "running", startedAt: now, finishedAt: null,
        error: null, repair: { maximum: 1, performed: 0, malformedBytes: null, malformedSha256: null }, usage: null, providerMetadata: [],
      };
      unit.status = "running"; unit.attempts.push(attempt);
      this.reviews.update(next, { assertFreshInTransaction: () => this.assertFresh(next) });
      try {
        this.assertFresh(next);
        const base = {
          jobId: next.job.id, unitId: unit.id, attemptId: attempt.id,
          providerId: next.plan.providerId, modelId: next.plan.modelId,
          inputFingerprint: unit.inputFingerprint, contextFingerprint: unit.contextFingerprint,
          context: unit.context, categories: next.plan.categories,
          maximumOutputTokens: Math.min(unit.maximumOutputTokens, next.plan.policy.maxOutputTokensPerUnit), signal: controller.signal,
        };
        const generated = await provider.generate({ ...base, mode: "generate" });
        const usages = generated.usage ? [generated.usage] : []; const metadata = generated.metadata ? [generated.metadata] : [];
        let raw = generated.output; let validated;
        try { validated = validateNarrativeReviewOutput({ raw, context: unit.context, maximumOutputTokens: base.maximumOutputTokens, policy: next.plan.policy }); }
        catch (error) {
          if (!repairable(error)) throw error;
          const malformedBytes = Buffer.byteLength(raw, "utf8");
          if (malformedBytes > next.plan.policy.maxRepairInputBytes) throw Object.assign(new Error("Narrative-review repair input exceeds its bound"), { code: "review_repair_too_large", retryable: false });
          attempt.repair = { maximum: 1, performed: 1, malformedBytes, malformedSha256: createHash("sha256").update(raw).digest("hex") };
          this.assertFresh(next);
          const repaired = await provider.generate({ ...base, mode: "repair", repair: { malformedOutput: raw, validationIssues: issues(error) } });
          if (repaired.usage) usages.push(repaired.usage); if (repaired.metadata) metadata.push(repaired.metadata);
          raw = repaired.output;
          validated = validateNarrativeReviewOutput({ raw, context: unit.context, maximumOutputTokens: base.maximumOutputTokens, policy: next.plan.policy });
        }
        if (controller.signal.aborted) return;
        this.assertFresh(next);
        current = this.current(projectId, planId); const completed = clone(current); const completedUnit = requireUnit(completed, unit.id);
        const completedAttempt = completedUnit.attempts.find((item) => item.id === attempt.id);
        if (!completedAttempt || completedAttempt.status !== "running" || completed.job.status !== "running") return;
        completedUnit.findings = validated.output.findings.map((finding) => persistedFinding(completed, completedUnit, completedAttempt, finding));
        completedUnit.status = "completed"; completedAttempt.status = "completed"; completedAttempt.finishedAt = new Date().toISOString();
        completedAttempt.repair = attempt.repair; completedAttempt.usage = totalUsage(usages); completedAttempt.providerMetadata = metadata;
        this.reviews.update(completed, { assertFreshInTransaction: () => this.assertFresh(completed) });
      } catch (error) {
        if (controller.signal.aborted) return;
        current = this.current(projectId, planId); const failed = clone(current); const failedUnit = requireUnit(failed, unit.id);
        const failedAttempt = failedUnit.attempts.find((item) => item.id === attempt.id);
        if (!failedAttempt || failedAttempt.status !== "running") continue;
        const normalized = normalize(error); failedUnit.status = "failed"; failedAttempt.status = "failed";
        failedAttempt.finishedAt = new Date().toISOString(); failedAttempt.repair = attempt.repair;
        failedAttempt.error = { ...normalized, validationIssues: issues(error).map(redactSecret) };
        this.reviews.update(failed);
      }
    }
    if (controller.signal.aborted) return;
    const current = this.current(projectId, planId); if (current.job.status !== "running") return; const final = clone(current);
    const failed = final.job.units.filter((unit) => unit.status === "failed").length;
    final.job.status = failed ? (failed === final.job.units.length ? "failed" : "partially-failed") : "completed";
    final.job.finishedAt = new Date().toISOString(); this.reviews.update(final);
  }

  private assertFresh(review: NarrativeReviewAggregate): void {
    const input = review.reviewInput; const state = this.passagePlans.state(review.projectId);
    if (state.status !== "approved" || state.approvedSnapshotId !== input.snapshotId) throw stale("Current approved snapshot no longer matches the review input");
    const snapshot = this.passagePlans.getSnapshot(input.snapshotId);
    if (!snapshot || snapshot.projectId !== review.projectId || snapshot.status !== "approved" || snapshot.structureVersionId !== input.structureVersionId) throw stale("Review snapshot lineage is no longer approved");
    for (const [artifactId, versionId] of Object.entries(input.upstreamVersions)) {
      const currentVersionId = this.workflow.get(review.projectId, artifactId).approvedVersionId;
      const materialEquivalentDirection = artifactId === "creative-direction" && currentVersionId
        && this.artifacts.getVersion<{ materialFingerprint: string }>(versionId)?.content.materialFingerprint
          === this.artifacts.getVersion<{ materialFingerprint: string }>(currentVersionId)?.content.materialFingerprint;
      if (currentVersionId !== versionId && !materialEquivalentDirection) throw stale(`Approved ${artifactId} changed`);
    }
    for (const reference of input.passageVersions) {
      if (this.passagePlans.currentEntity(review.projectId, "passage", reference.entityId)?.id !== reference.versionId) throw stale(`Passage ${reference.entityId} changed`);
      const expectedDraft = input.acceptedDraftVersions.find((item) => item.entityId === reference.entityId) ?? null;
      const head = this.drafts.getHead(review.projectId, reference.entityId)?.accepted ?? null;
      if ((head?.id ?? null) !== (expectedDraft?.versionId ?? null)
        || Boolean(head?.stale) !== Boolean(expectedDraft?.stale)) throw stale(`Accepted prose ${reference.entityId} changed or changed staleness`);
    }
    for (const reference of input.choiceVersions) {
      if (this.passagePlans.currentEntity(review.projectId, "choice", reference.entityId)?.id !== reference.versionId) throw stale(`Choice ${reference.entityId} changed`);
    }
    for (const reference of input.threadVersions) {
      if (this.passagePlans.currentEntity(review.projectId, "thread", reference.entityId)?.id !== reference.versionId) throw stale(`Thread ${reference.entityId} changed`);
    }
    const exactInput = this.simulations.resolveInput(review.projectId, input.simulationInputVersionId);
    if (exactInput.input.fingerprint !== input.simulationInputFingerprint) throw stale("Simulation input fingerprint changed");
    input.simulationRunVersionIds.forEach((id) => {
      const run = this.simulations.getRun(review.projectId, id);
      if (run.content.inputArtifactVersionId !== input.simulationInputVersionId) throw stale("Selected simulation run belongs to another input");
    });
    input.campaignVersionIds.forEach((id) => {
      const campaign = this.playtests.getCampaign(review.projectId, id);
      if (campaign.content.simulationInputArtifactVersionId !== input.simulationInputVersionId) throw stale("Selected campaign belongs to another input");
    });
  }

  private simulationEvidence(projectId: string, versionId: string, inputVersionId: string): ReviewSimulationEvidence {
    const version = this.simulations.getRun(projectId, versionId);
    if (version.content.inputArtifactVersionId !== inputVersionId) throw new NarrativeReviewServiceError("review_evidence_invalid", "Simulation run does not belong to the selected input");
    return {
      versionId: version.id, traceFingerprint: version.content.trace.fingerprint,
      passageIds: version.content.trace.visitedPassageIds, choiceIds: version.content.trace.selectedChoiceIds,
      raw: { result: version.content.trace.result, findings: version.content.trace.findings, steps: version.content.trace.steps },
    };
  }

  private campaignEvidence(projectId: string, versionId: string, inputVersionId: string): ReviewCampaignEvidence {
    const version = this.playtests.getCampaign(projectId, versionId); const campaign = version.content;
    if (campaign.simulationInputArtifactVersionId !== inputVersionId) throw new NarrativeReviewServiceError("review_evidence_invalid", "Campaign does not belong to the selected input");
    return {
      versionId: version.id, campaignId: campaign.id, schemaVersion: campaign.schemaVersion,
      findingRetention: campaign.schemaVersion === 2 ? {
        status: "known", total: campaign.findingRetention.totalFindingCount,
        retained: campaign.findingRetention.retainedFindingCount, omitted: campaign.findingRetention.omittedFindingCount,
        truncated: campaign.findingRetention.truncated,
      } : { status: "legacy-unknown", retained: campaign.findings.length, total: null, omitted: null, truncated: null },
      findings: campaign.findings.map((finding) => ({
        id: finding.id, evidenceLevel: finding.evidenceLevel, passageIds: finding.passageIds,
        choiceIds: finding.choiceIds, routeIds: finding.routeIds, endingIds: finding.endingIds,
        mechanicKeys: finding.mechanicKeys, ...(finding.sampleId ? { sampleId: finding.sampleId } : {}),
        ...(finding.traceFingerprint ? { traceFingerprint: finding.traceFingerprint } : {}), raw: finding,
      })),
      samples: campaign.samples.map((sample) => ({
        id: sample.id, passageIds: sample.visitedPassageIds, choiceIds: sample.choiceIds,
        routeIds: sample.routeIds, endingId: sample.endingId, traceFingerprint: sample.traceFingerprint,
        hardFailure: sample.hardFailure, raw: sample,
      })),
      report: {
        fingerprint: campaign.report.fingerprint, hardFailureSampleCount: campaign.report.hardFailureSampleCount,
        passageCoveragePercentage: campaign.report.passageCoverage.percentage,
        completedSampleCount: campaign.report.completedSampleCount, sampleCount: campaign.report.sampleCount,
      },
    };
  }

  private recoverInterrupted(): void {
    // Project enumeration is intentionally avoided; recovery occurs lazily when a project is opened/listed.
  }
  private recoverProject(projectId: string): void {
    for (const version of this.reviews.list<NarrativeReviewAggregate>(projectId)) {
      const current = version.content;
      if (current.job.status !== "running" || this.controllers.has(current.job.id)) continue;
      const next = clone(current); const now = new Date().toISOString();
      for (const unit of next.job.units) {
        if (unit.status !== "running") continue;
        unit.status = "failed";
        const attempt = unit.attempts.at(-1);
        if (attempt?.status === "running") {
          attempt.status = "failed"; attempt.finishedAt = now;
          attempt.error = { code: "review_interrupted", message: "Interrupted review unit is ready for explicit retry", retryable: true, validationIssues: [] };
        }
      }
      const failed = next.job.units.filter((unit) => unit.status === "failed").length;
      next.job.status = failed === next.job.units.length ? "failed" : "partially-failed";
      next.job.finishedAt = now; this.reviews.update(next);
    }
  }
  private requireProvider(id: string): NarrativeReviewProvider {
    const provider = this.providers.get(id); if (!provider) throw new NarrativeReviewServiceError("review_provider_unavailable", `Narrative-review provider ${id} is unavailable`); return provider;
  }
  private requireProject(projectId: string) {
    const project = this.projects.get(projectId); if (!project || project.mode !== "long-form") throw new NarrativeReviewServiceError("project_not_found", "Long-form project not found"); return project;
  }
}

function persistedFinding(review: NarrativeReviewAggregate, unit: NarrativeReviewUnitRecord, attempt: NarrativeReviewAttemptRecord, finding: NarrativeReviewFindingCandidate): NarrativeReviewFindingRecord {
  const durable = {
    reviewPlanId: review.plan.id, jobId: review.job.id, unitId: unit.id, attemptId: attempt.id,
    reviewInputFingerprint: review.reviewInput.fingerprint, contextFingerprint: unit.contextFingerprint,
    ...finding,
  };
  const fingerprint = narrativeReviewFindingFingerprint(durable);
  return { schemaId: narrativeReviewFindingSchema.id, schemaVersion: narrativeReviewFindingSchema.version, id: `nrf_${fingerprint.slice(0, 24)}`, fingerprint, ...durable };
}
function requireUnit(review: NarrativeReviewAggregate, unitId: string): NarrativeReviewUnitRecord {
  const unit = review.job.units.find((item) => item.id === unitId); if (!unit) throw new NarrativeReviewServiceError("review_unit_not_found", "Narrative-review unit not found"); return unit;
}
function stale(message: string) { return new NarrativeReviewServiceError("stale_review_plan", message, false); }
function clone<T>(value: T): T { return structuredClone(value); }
function stringValue(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim()) throw new NarrativeReviewServiceError("review_request_invalid", message); return value.trim(); }
function stringArray(value: unknown, message: string): string[] { const result = optionalStringArray(value); if (!result.length) throw new NarrativeReviewServiceError("review_request_invalid", message); return result; }
function optionalStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new NarrativeReviewServiceError("review_request_invalid", "Stable-ID lists must contain non-empty strings");
  return [...new Set(value as string[])];
}
function requestedPolicy(value: unknown): NarrativeReviewPolicy {
  if (value === undefined) return narrativeReviewPolicyV1;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NarrativeReviewServiceError("review_request_invalid", "Review policy must be an object");
  const allowed = new Set(Object.keys(narrativeReviewPolicyV1));
  for (const key of Object.keys(value as object)) if (!allowed.has(key)) throw new NarrativeReviewServiceError("review_request_invalid", `Unknown review policy field: ${key}`);
  return { ...narrativeReviewPolicyV1, ...(value as Partial<NarrativeReviewPolicy>), id: narrativeReviewPolicyV1.id, maxRepairsPerAttempt: 1 };
}
function sortRecord(value: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }
function repairable(error: unknown): boolean { return Boolean(error && typeof error === "object" && (error as { structurallyRepairable?: unknown }).structurallyRepairable !== false); }
function issues(error: unknown): string[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) return (error as { issues: unknown[] }).issues.slice(0, 50).map(String);
  return [error instanceof Error ? error.message : String(error)];
}
function normalize(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof DOMException && error.name === "AbortError") return { code: "cancelled", message: "Narrative review was cancelled", retryable: true };
  const item = error as { code?: unknown; message?: unknown; retryable?: unknown };
  return { code: typeof item?.code === "string" ? item.code : "narrative_review_failed", message: redactSecret(typeof item?.message === "string" ? item.message : String(error)), retryable: typeof item?.retryable === "boolean" ? item.retryable : true };
}
function totalUsage(items: Array<{ inputTokens: number; outputTokens: number; cost: number | null }>) {
  if (!items.length) return null;
  return items.reduce((total, item) => ({ inputTokens: total.inputTokens + item.inputTokens, outputTokens: total.outputTokens + item.outputTokens, cost: total.cost === null || item.cost === null ? null : total.cost + item.cost }), { inputTokens: 0, outputTokens: 0, cost: 0 as number | null });
}
