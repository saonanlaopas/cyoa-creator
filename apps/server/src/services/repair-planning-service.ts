import { randomUUID } from "node:crypto";
import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  REPAIR_PLANNING_POLICY_V1,
  RepairFindingReferenceSchema,
  RepairIntentSchema,
  RepairPlanRecordSchema,
  RepairTargetSchema,
  buildRepairImpactGraph,
  buildRepairPlanDefinition,
  repairFingerprint,
  repairTargetKey,
  simulationInputTargetKeys,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormRoutePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassagePlanFinding,
  type PassageValidationReport,
  type RepairExpectedBase,
  type RepairFindingReference,
  type RepairFindingSourceKind,
  type RepairImpactIndex,
  type RepairIntent,
  type RepairPlanDefinition,
  type RepairPlanRecord,
  type RepairTarget,
  type ResolvedRepairFinding,
  type ChoicePlan,
} from "@story-to-cyoa/pipeline";
import {
  narrativeReviewFindingFingerprint,
  type ArtifactRepository,
  type ArtifactVersion,
  type NarrativeReviewRepository,
  type PassageDraftRepository,
  type PassagePlanRepository,
  type ProjectRepository,
  type RepairPlanRepository,
  type WorkflowRepository,
} from "@story-to-cyoa/persistence";
import type { PlaytestCampaignRecord, PlaytestFinding, RuntimeFinding } from "@story-to-cyoa/runtime";
import { PLAYTEST_CAMPAIGN_ARTIFACT_ID, type PlaytestService } from "./playtest-service.js";
import {
  SIMULATION_INPUT_ARTIFACT_ID,
  SIMULATION_RUN_ARTIFACT_ID,
  type SimulationInputRecord,
  type SimulationRunRecord,
  type SimulationService,
} from "./simulation-service.js";
import type { NarrativeReviewAggregate, NarrativeReviewFindingRecord } from "./narrative-review-service.js";

export interface RepairFindingLocator {
  sourceKind: RepairFindingSourceKind;
  sourceVersionId: string;
  findingId: string;
  planId?: string;
  unitId?: string;
}

export interface RepairFindingSummary {
  sourceKind: RepairFindingSourceKind;
  locator: RepairFindingLocator;
  sourceFingerprint: string;
  code: string;
  category: string;
  severity: string;
  message: string;
  sourceState: "current" | "historical";
  entityIds: string[];
  createdAt: string;
}

export interface RepairPlanRequest {
  findings?: unknown;
  intent?: unknown;
  targets?: unknown;
}

export class RepairPlanningServiceError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); }
}

export class RepairPlanningService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
    private readonly reviews: NarrativeReviewRepository,
    private readonly repairPlans: RepairPlanRepository,
    private readonly simulations: SimulationService,
    private readonly playtests: PlaytestService,
  ) {}

  listFindings(projectId: string, sourceKind: RepairFindingSourceKind): { items: RepairFindingSummary[]; truncated: boolean; limit: number } {
    this.requireProject(projectId);
    const summaries = this.enumerate(projectId, sourceKind);
    return {
      items: summaries.slice(0, REPAIR_PLANNING_POLICY_V1.maxFindingListItems),
      truncated: summaries.length > REPAIR_PLANNING_POLICY_V1.maxFindingListItems,
      limit: REPAIR_PLANNING_POLICY_V1.maxFindingListItems,
    };
  }

  resolveLocator(projectId: string, input: unknown): ResolvedRepairFinding {
    const locator = parseLocator(input);
    if (locator.sourceKind === "foundation-3-static-validation") {
      const snapshot = this.passagePlans.getSnapshot(locator.sourceVersionId);
      if (!snapshot || snapshot.projectId !== projectId) throw failure("repair_source_not_found", "Static validation snapshot not found");
      const finding = validationFindings(snapshot.validation).find((item) => staticFindingId(item) === locator.findingId);
      if (!finding) throw failure("repair_finding_not_found", "Static validation finding not found");
      return this.resolveFinding(projectId, this.staticReference(projectId, snapshot, finding));
    }
    if (locator.sourceKind === "foundation-5a-runtime") {
      const run = this.simulations.getRun(projectId, locator.sourceVersionId);
      const finding = run.content.trace.findings.find((item) => item.id === locator.findingId);
      if (!finding) throw failure("repair_finding_not_found", "Runtime finding not found");
      return this.resolveFinding(projectId, this.runtimeReference(projectId, run, finding));
    }
    if (locator.sourceKind === "foundation-5b-playtest") {
      const campaign = this.playtests.getCampaign(projectId, locator.sourceVersionId);
      const finding = campaign.content.findings.find((item) => item.id === locator.findingId);
      if (!finding) throw failure("repair_finding_not_found", "Playtest finding not found");
      return this.resolveFinding(projectId, this.playtestReference(projectId, campaign, finding));
    }
    const review = this.reviews.getVersion<NarrativeReviewAggregate>(projectId, locator.sourceVersionId);
    if (!review || (locator.planId && review.content.plan.id !== locator.planId)) throw failure("repair_source_not_found", "Narrative-review evidence not found");
    const matches = review.content.job.units.flatMap((unit) => unit.findings.map((finding) => ({ unit, finding })))
      .filter((item) => item.finding.id === locator.findingId && (!locator.unitId || item.unit.id === locator.unitId));
    if (matches.length !== 1) throw failure("repair_finding_not_found", "Narrative-review finding not found");
    return this.resolveFinding(projectId, this.narrativeReference(projectId, review, matches[0]!.finding, matches[0]!.unit.contextFingerprint));
  }

  resolveFinding(projectId: string, input: unknown): ResolvedRepairFinding {
    this.requireProject(projectId);
    const reference = RepairFindingReferenceSchema.parse(input);
    if (reference.projectId !== projectId) throw failure("repair_cross_project_source", "Repair finding belongs to another project");
    switch (reference.kind) {
      case "foundation-3-static-validation": return this.resolveStatic(reference);
      case "foundation-5a-runtime": return this.resolveRuntime(reference);
      case "foundation-5b-playtest": return this.resolvePlaytest(reference);
      case "foundation-5c-narrative-review": return this.resolveNarrative(reference);
    }
  }

  eligibleTargets(projectId: string, findingsInput: unknown, intentInput: unknown): {
    findings: ResolvedRepairFinding[];
    targets: Array<{ target: RepairTarget; targetKey: string; reason: string; protected: boolean }>;
  } {
    const findings = this.resolveSelected(projectId, findingsInput);
    const intent = RepairIntentSchema.parse(intentInput);
    const candidates = new Map<string, { target: RepairTarget; targetKey: string; reason: string; protected: boolean }>();
    const add = (target: RepairTarget, reason: string) => {
      if (!intentAllows(intent, target)) return;
      try {
        const base = this.resolveBase(projectId, target);
        const key = repairTargetKey(target);
        candidates.set(key, { target, targetKey: key, reason, protected: base.kind === "passage-prose-head" && base.acceptedLocked });
      } catch (error) {
        if (!(error instanceof RepairPlanningServiceError) || error.code !== "repair_target_not_found") throw error;
      }
    };
    for (const finding of findings) {
      for (const key of finding.entityKeys) {
        const target = targetFromEntityKey(key);
        if (target) add(target, `Exact ${finding.reference.kind} evidence`);
      }
      for (const key of finding.entityKeys) {
        const [kind, id] = splitKey(key);
        if (kind === "passage") {
          add({ kind: "passage-prose", passageId: id }, "Prose for an evidence passage");
          const passage = this.passagePlans.currentEntity<PassagePlan>(projectId, "passage", id)?.content;
          passage?.relationshipIds.forEach((relationshipId) => add({ kind: "relationship", relationshipId }, "Passage has an exact relationship reference"));
          [...(passage?.requiredFactIds ?? []), ...(passage?.revealedFactIds ?? [])].forEach((factId) => add({ kind: "canon-fact", factId }, "Passage has an exact fact reference"));
          passage?.routeIds.forEach((routeId) => add({ kind: "route", routeId }, "Passage has an exact route reference"));
          [...(passage?.setupThreadIds ?? []), ...(passage?.payoffThreadIds ?? [])].forEach((threadId) => add({ kind: "narrative-thread", threadId }, "Passage has an exact thread reference"));
        }
        if (kind === "choice") {
          const choice = this.passagePlans.currentEntity<ChoicePlan>(projectId, "choice", id)?.content;
          if (choice) {
            add({ kind: "passage-plan-passage", passageId: choice.sourcePassageId }, "Choice source passage");
            add({ kind: "passage-plan-passage", passageId: choice.destinationPassageId }, "Choice destination passage");
            collectMechanicKeys(choice).forEach((mechanicKey) => add({ kind: "mechanic", mechanicKey }, "Choice reads or writes the mechanic"));
          }
        }
        if (kind === "route") this.routeSections(projectId).filter((item) => item.routeIds.includes(id)).forEach((section) => add({ kind: "route-section", sectionKind: section.kind, sectionId: section.id }, "Typed section belongs to the evidence route"));
      }
    }
    return { findings, targets: [...candidates.values()].sort((left, right) => left.targetKey.localeCompare(right.targetKey)) };
  }

  preview(projectId: string, request: RepairPlanRequest): ReturnType<typeof buildRepairPlanDefinition> & {
    currentState: { status: "current"; reasons: string[] };
    eligibleForGeneration: true;
  } {
    const findings = this.resolveSelected(projectId, request.findings);
    if (findings.some((item) => item.sourceState !== "current")) throw failure("repair_source_stale", "Historical finding evidence cannot be used as a current repair base", findings.flatMap((item) => item.stateReasons));
    const intent = RepairIntentSchema.parse(request.intent);
    const targets = parseTargets(request.targets);
    const eligible = this.eligibleTargets(projectId, findings.map((item) => item.reference), intent);
    const allowed = new Set(eligible.targets.map((item) => item.targetKey));
    for (const target of targets) if (!allowed.has(repairTargetKey(target))) throw failure("repair_target_not_authorized", `Target ${repairTargetKey(target)} is outside the deterministic finding scope`);
    const bases = targets.map((target) => this.resolveBase(projectId, target));
    const impactGraph = buildRepairImpactGraph(targets, this.impactIndex(projectId));
    const built = buildRepairPlanDefinition({
      projectId,
      selectedFindings: findings.map((item) => item.reference),
      resolvedFindings: findings,
      intent,
      authorizedTargets: targets,
      expectedBases: bases,
      impactGraph,
      providerNeeded: providerNeed(intent),
      contextAvailability: findings.flatMap((finding) => finding.entityKeys.map((id) => ({ kind: "structured-evidence", id, available: true }))),
    });
    return { ...built, currentState: { status: "current", reasons: [] }, eligibleForGeneration: true };
  }

  save(projectId: string, request: RepairPlanRequest): RepairPlanView {
    const preview = this.preview(projectId, request);
    const record = RepairPlanRecordSchema.parse({
      id: randomUUID(), definitionFingerprint: preview.fingerprint,
      definition: preview.definition, createdAt: new Date().toISOString(),
    });
    const saved = this.repairPlans.create(projectId, record);
    return this.decorate(saved.content, saved.id);
  }

  list(projectId: string): RepairPlanSummary[] {
    this.requireProject(projectId);
    return this.repairPlans.list<RepairPlanRecord>(projectId).map((version) => {
      const view = this.decorate(version.content, version.id);
      return {
        id: view.id, artifactVersionId: version.id, createdAt: view.createdAt,
        definitionFingerprint: view.definitionFingerprint, intent: view.definition.intent,
        findingCount: view.definition.selectedFindings.length, targetCount: view.definition.authorizedTargets.length,
        impactCount: view.definition.impactGraph.nodes.length, currentState: view.currentState,
      };
    });
  }

  get(projectId: string, planId: string): RepairPlanView {
    this.requireProject(projectId);
    const version = this.repairPlans.get<RepairPlanRecord>(projectId, planId);
    if (!version) throw failure("repair_plan_not_found", "Repair plan not found");
    return this.decorate(version.content, version.id);
  }

  private decorate(record: RepairPlanRecord, artifactVersionId: string): RepairPlanView {
    const reasons: string[] = [];
    for (const expected of record.definition.resolvedFindings) {
      try {
        const current = this.resolveFinding(record.definition.projectId, expected.reference);
        if (current.sourceFingerprint !== expected.sourceFingerprint) reasons.push(`Finding source changed: ${expected.sourceFingerprint}`);
        if (current.sourceState !== "current") reasons.push(...current.stateReasons);
      } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
    }
    for (let index = 0; index < record.definition.authorizedTargets.length; index += 1) {
      const target = record.definition.authorizedTargets[index]!;
      const expected = record.definition.expectedBases[index]!;
      try {
        const current = this.resolveBase(record.definition.projectId, target);
        if (repairFingerprint(current) !== repairFingerprint(expected)) reasons.push(`Expected base changed: ${repairTargetKey(target)}`);
      } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
    }
    const currentState = reasons.length ? { status: "historical" as const, reasons: [...new Set(reasons)] }
      : { status: "current" as const, reasons: [] };
    return { ...record, artifactVersionId, currentState, eligibleForGeneration: currentState.status === "current" };
  }

  private resolveSelected(projectId: string, input: unknown): ResolvedRepairFinding[] {
    if (!Array.isArray(input) || input.length < 1) throw failure("repair_request_invalid", "Select at least one finding");
    if (input.length > REPAIR_PLANNING_POLICY_V1.maxSelectedFindings) throw failure("repair_findings_too_large", `Select at most ${REPAIR_PLANNING_POLICY_V1.maxSelectedFindings} findings`);
    const resolved = input.map((item) => {
      if (isResolvedFinding(item)) return this.resolveFinding(projectId, item.reference);
      return this.resolveFinding(projectId, item);
    });
    const unique = new Map(resolved.map((item) => [item.sourceFingerprint, item]));
    if (unique.size !== resolved.length) throw failure("repair_request_invalid", "Duplicate selected findings are not allowed");
    return [...unique.values()];
  }

  private resolveStatic(reference: Extract<RepairFindingReference, { kind: "foundation-3-static-validation" }>): ResolvedRepairFinding {
    const snapshot = this.passagePlans.getSnapshot(reference.snapshotId);
    if (!snapshot || snapshot.projectId !== reference.projectId) throw failure("repair_source_not_found", "Static validation snapshot not found");
    if (snapshot.version !== reference.snapshotVersion || snapshot.structureVersionId !== reference.structureVersionId
      || repairFingerprint(sortedRecord(snapshot.upstreamVersions)) !== repairFingerprint(sortedRecord(reference.upstreamVersions))) {
      throw failure("repair_source_lineage_invalid", "Static validation snapshot lineage does not match");
    }
    const finding = validationFindings(snapshot.validation).find((item) => item.code === reference.finding.code
      && item.entityType === reference.finding.entityType && item.entityId === reference.finding.entityId);
    if (!finding || repairFingerprint(finding) !== reference.findingFingerprint || repairFingerprint(finding) !== repairFingerprint(reference.finding)) {
      throw failure("repair_finding_integrity_failure", "Static validation finding identity or evidence does not match its snapshot");
    }
    const state = this.snapshotCurrentness(reference.projectId, snapshot);
    return resolved(reference, reference.findingFingerprint, state, finding.code, finding.message, staticEntityKeys(finding));
  }

  private resolveRuntime(reference: Extract<RepairFindingReference, { kind: "foundation-5a-runtime" }>): ResolvedRepairFinding {
    const run = this.simulations.getRun(reference.projectId, reference.runArtifactVersionId);
    const finding = run.content.trace.findings.find((item) => item.id === reference.finding.id);
    if (!finding || run.content.id !== reference.runId || run.content.inputArtifactVersionId !== reference.simulationInputArtifactVersionId
      || run.content.inputFingerprint !== reference.simulationInputFingerprint || run.content.runtimeFingerprint !== reference.runtimeFingerprint
      || run.content.trace.fingerprint !== reference.traceFingerprint || repairFingerprint(finding) !== reference.findingFingerprint
      || repairFingerprint(finding) !== repairFingerprint(reference.finding)) {
      throw failure("repair_finding_integrity_failure", "Runtime finding lineage or fingerprint does not match immutable run evidence");
    }
    const input = this.simulations.resolveInput(reference.projectId, reference.simulationInputArtifactVersionId);
    const state = this.simulationInputCurrentness(input.inputVersion.id, input.input);
    return resolved(reference, reference.findingFingerprint, state, finding.code, finding.message, runtimeEntityKeys(finding));
  }

  private resolvePlaytest(reference: Extract<RepairFindingReference, { kind: "foundation-5b-playtest" }>): ResolvedRepairFinding {
    const version = this.playtests.getCampaign(reference.projectId, reference.campaignArtifactVersionId);
    const campaign = version.content;
    const finding = campaign.findings.find((item) => item.id === reference.finding.id);
    const retention = campaign.schemaVersion === 2 ? {
      status: "known" as const, total: campaign.findingRetention.totalFindingCount,
      retained: campaign.findingRetention.retainedFindingCount, omitted: campaign.findingRetention.omittedFindingCount,
      truncated: campaign.findingRetention.truncated,
    } : { status: "legacy-unknown" as const, retained: campaign.findings.length, total: null, omitted: null, truncated: null };
    if (!finding || campaign.id !== reference.campaignId || campaign.schemaVersion !== reference.campaignSchemaVersion
      || campaign.fingerprint !== reference.campaignFingerprint || campaign.simulationInputArtifactVersionId !== reference.simulationInputArtifactVersionId
      || campaign.simulationInputFingerprint !== reference.simulationInputFingerprint || campaign.compiledRuntimeFingerprint !== reference.runtimeFingerprint
      || campaign.seed !== reference.seed || campaign.policy.version !== reference.policyVersion
      || repairFingerprint(retention) !== repairFingerprint(reference.findingRetention)
      || finding.fingerprint !== reference.finding.fingerprint || repairFingerprint(finding) !== repairFingerprint(reference.finding)) {
      throw failure("repair_finding_integrity_failure", "Playtest finding lineage or fingerprint does not match immutable campaign evidence");
    }
    if (finding.sampleId) {
      const sample = campaign.samples.find((item) => item.id === finding.sampleId);
      if (!sample || sample.index !== finding.sampleIndex || sample.traceFingerprint !== finding.traceFingerprint) {
        throw failure("repair_source_lineage_invalid", "Playtest finding sample and trace lineage does not match");
      }
    } else if (finding.sampleIndex !== null || finding.traceFingerprint !== null) {
      throw failure("repair_source_lineage_invalid", "Aggregate playtest finding has invalid sample lineage");
    }
    const input = this.simulations.resolveInput(reference.projectId, reference.simulationInputArtifactVersionId);
    const state = this.simulationInputCurrentness(input.inputVersion.id, input.input);
    return resolved(reference, reference.finding.fingerprint, state, finding.code, finding.message, playtestEntityKeys(finding));
  }

  private resolveNarrative(reference: Extract<RepairFindingReference, { kind: "foundation-5c-narrative-review" }>): ResolvedRepairFinding {
    const version = this.reviews.getVersion<NarrativeReviewAggregate>(reference.projectId, reference.reviewArtifactVersionId);
    if (!version) throw failure("repair_source_not_found", "Narrative-review artifact version not found");
    const review = version.content;
    const unit = review.job.units.find((item) => item.id === reference.unitId);
    const attempt = unit?.attempts.find((item) => item.id === reference.attemptId);
    const finding = unit?.findings.find((item) => item.id === reference.finding.id);
    if (!unit || !attempt || !finding || review.plan.id !== reference.reviewPlanId || review.job.id !== reference.jobId
      || review.reviewInput.fingerprint !== reference.reviewInputFingerprint || unit.contextFingerprint !== reference.contextFingerprint
      || attempt.status !== "completed" || unit.status !== "completed" || finding.attemptId !== attempt.id
      || finding.reviewPlanId !== review.plan.id || finding.jobId !== review.job.id || finding.unitId !== unit.id
      || finding.contextFingerprint !== unit.contextFingerprint || narrativeReviewFindingFingerprint(finding as unknown as Record<string, unknown>) !== finding.fingerprint
      || repairFingerprint(finding) !== repairFingerprint(reference.finding)) {
      throw failure("repair_finding_integrity_failure", "Narrative-review finding or attempt lineage does not match immutable review evidence");
    }
    this.assertNarrativeEvidence(review, finding);
    const state = this.reviewInputCurrentness(review);
    return resolved(reference, finding.fingerprint, state, finding.category, finding.message, narrativeEntityKeys(finding));
  }

  private staticReference(projectId: string, snapshot: ReturnType<PassagePlanRepository["getSnapshot"]> & {}, finding: PassagePlanFinding): RepairFindingReference {
    return RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-3-static-validation",
      projectId, snapshotId: snapshot.id, snapshotVersion: snapshot.version,
      structureVersionId: snapshot.structureVersionId, upstreamVersions: sortedRecord(snapshot.upstreamVersions),
      findingFingerprint: repairFingerprint(finding), finding,
    });
  }

  private runtimeReference(projectId: string, run: ArtifactVersion<SimulationRunRecord>, finding: RuntimeFinding): RepairFindingReference {
    return RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-5a-runtime",
      projectId, runArtifactVersionId: run.id, runId: run.content.id,
      simulationInputArtifactVersionId: run.content.inputArtifactVersionId,
      simulationInputFingerprint: run.content.inputFingerprint, runtimeFingerprint: run.content.runtimeFingerprint,
      traceFingerprint: run.content.trace.fingerprint, findingFingerprint: repairFingerprint(finding), finding,
    });
  }

  private playtestReference(projectId: string, version: ArtifactVersion<PlaytestCampaignRecord>, finding: PlaytestFinding): RepairFindingReference {
    const campaign = version.content;
    return RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-5b-playtest",
      projectId, campaignArtifactVersionId: version.id, campaignId: campaign.id,
      campaignSchemaVersion: campaign.schemaVersion, campaignFingerprint: campaign.fingerprint,
      simulationInputArtifactVersionId: campaign.simulationInputArtifactVersionId,
      simulationInputFingerprint: campaign.simulationInputFingerprint,
      runtimeFingerprint: campaign.compiledRuntimeFingerprint, seed: campaign.seed, policyVersion: campaign.policy.version,
      findingRetention: campaign.schemaVersion === 2 ? {
        status: "known", total: campaign.findingRetention.totalFindingCount,
        retained: campaign.findingRetention.retainedFindingCount, omitted: campaign.findingRetention.omittedFindingCount,
        truncated: campaign.findingRetention.truncated,
      } : { status: "legacy-unknown", retained: campaign.findings.length, total: null, omitted: null, truncated: null },
      finding,
    });
  }

  private narrativeReference(projectId: string, version: ArtifactVersion<NarrativeReviewAggregate>, finding: NarrativeReviewFindingRecord, contextFingerprint: string): RepairFindingReference {
    return RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-5c-narrative-review",
      projectId, reviewArtifactVersionId: version.id, reviewInputFingerprint: version.content.reviewInput.fingerprint,
      reviewPlanId: version.content.plan.id, jobId: version.content.job.id, unitId: finding.unitId,
      attemptId: finding.attemptId, contextFingerprint, finding,
    });
  }

  private enumerate(projectId: string, sourceKind: RepairFindingSourceKind): RepairFindingSummary[] {
    if (sourceKind === "foundation-3-static-validation") {
      const state = this.passagePlans.state(projectId);
      const snapshot = (state.approvedSnapshotId ? this.passagePlans.getSnapshot(state.approvedSnapshotId) : undefined)
        ?? this.passagePlans.listSnapshots(projectId)[0];
      if (!snapshot) return [];
      return validationFindings(snapshot.validation).map((finding) => summary(
        this.resolveFinding(projectId, this.staticReference(projectId, snapshot, finding)),
        { sourceKind, sourceVersionId: snapshot.id, findingId: staticFindingId(finding) },
        finding.code, finding.severity, snapshot.createdAt,
      ));
    }
    if (sourceKind === "foundation-5a-runtime") return this.simulations.listRuns(projectId).flatMap((run) =>
      run.content.trace.findings.map((finding) => summary(
        this.resolveFinding(projectId, this.runtimeReference(projectId, run, finding)),
        { sourceKind, sourceVersionId: run.id, findingId: finding.id }, finding.code, "runtime", run.createdAt,
      )));
    if (sourceKind === "foundation-5b-playtest") return this.playtests.listCampaigns(projectId).flatMap((campaign) =>
      campaign.content.findings.map((finding) => summary(
        this.resolveFinding(projectId, this.playtestReference(projectId, campaign, finding)),
        { sourceKind, sourceVersionId: campaign.id, findingId: finding.id }, finding.category, finding.evidenceLevel, campaign.createdAt,
      )));
    return this.reviews.list<NarrativeReviewAggregate>(projectId).flatMap((review) => review.content.job.units.flatMap((unit) =>
      unit.findings.map((finding) => summary(
        this.resolveFinding(projectId, this.narrativeReference(projectId, review, finding, unit.contextFingerprint)),
        { sourceKind, sourceVersionId: review.id, findingId: finding.id, planId: review.content.plan.id, unitId: unit.id },
        finding.category, finding.severity, review.createdAt,
      ))));
  }

  private snapshotCurrentness(projectId: string, snapshot: NonNullable<ReturnType<PassagePlanRepository["getSnapshot"]>>): EvidenceState {
    const reasons: string[] = [];
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || state.approvedSnapshotId !== snapshot.id || snapshot.status !== "approved") reasons.push("Current approved passage-plan snapshot differs");
    if (this.passagePlans.currentStructure(projectId)?.id !== snapshot.structureVersionId) reasons.push("Current passage structure differs");
    for (const kind of ["passage", "choice", "thread"] as const) {
      const expected = new Map(this.passagePlans.snapshotEntities(snapshot.id, kind).map((item) => [item.entityId, item.id]));
      const current = new Map(this.passagePlans.currentEntities(projectId, kind).map((item) => [item.entityId, item.id]));
      if (repairFingerprint(Object.fromEntries(expected)) !== repairFingerprint(Object.fromEntries(current))) reasons.push(`Current ${kind} heads differ`);
    }
    for (const [artifactId, versionId] of Object.entries(snapshot.upstreamVersions)) if (this.workflow.get(projectId, artifactId).approvedVersionId !== versionId) reasons.push(`Approved ${artifactId} version differs`);
    return evidenceState(reasons);
  }

  private simulationInputCurrentness(versionId: string, input: SimulationInputRecord): EvidenceState {
    const reasons = [...this.snapshotCurrentness(input.projectId, this.requireSnapshot(input.projectId, input.snapshotId)).reasons];
    for (const reference of input.passageVersions) if (this.passagePlans.currentEntity(input.projectId, "passage", reference.entityId)?.id !== reference.versionId) reasons.push(`Passage ${reference.entityId} changed`);
    for (const reference of input.choiceVersions) if (this.passagePlans.currentEntity(input.projectId, "choice", reference.entityId)?.id !== reference.versionId) reasons.push(`Choice ${reference.entityId} changed`);
    for (const reference of input.threadVersions) if (this.passagePlans.currentEntity(input.projectId, "thread", reference.entityId)?.id !== reference.versionId) reasons.push(`Thread ${reference.entityId} changed`);
    const accepted = new Map(input.acceptedDraftVersions.map((item) => [item.entityId, item.versionId]));
    for (const passage of input.passageVersions) {
      const head = this.drafts.getHead(input.projectId, passage.entityId)?.accepted ?? null;
      if ((head?.id ?? null) !== (accepted.get(passage.entityId) ?? null) || Boolean(head?.stale)) reasons.push(`Accepted prose ${passage.entityId} changed or became stale`);
    }
    const artifact = this.artifacts.getVersion<SimulationInputRecord>(versionId);
    if (!artifact || artifact.content.fingerprint !== input.fingerprint) reasons.push("Simulation input artifact identity differs");
    return evidenceState(reasons);
  }

  private reviewInputCurrentness(review: NarrativeReviewAggregate): EvidenceState {
    const input = review.reviewInput;
    const simulationInput = this.simulations.resolveInput(review.projectId, input.simulationInputVersionId);
    const reasons = [...this.simulationInputCurrentness(simulationInput.inputVersion.id, simulationInput.input).reasons];
    if (simulationInput.input.fingerprint !== input.simulationInputFingerprint) reasons.push("Review simulation-input fingerprint differs");
    for (const item of input.acceptedDraftVersions) {
      const head = this.drafts.getHead(review.projectId, item.entityId)?.accepted ?? null;
      if ((head?.id ?? null) !== item.versionId || Boolean(head?.stale) !== item.stale) reasons.push(`Review accepted prose ${item.entityId} changed`);
    }
    return evidenceState(reasons);
  }

  private resolveBase(projectId: string, target: RepairTarget): RepairExpectedBase {
    const targetKey = repairTargetKey(target);
    if (target.kind === "passage-plan-passage" || target.kind === "passage-plan-choice" || target.kind === "narrative-thread") {
      const entityKind = target.kind === "passage-plan-passage" ? "passage" as const : target.kind === "passage-plan-choice" ? "choice" as const : "thread" as const;
      const entityId = target.kind === "passage-plan-passage" ? target.passageId : target.kind === "passage-plan-choice" ? target.choiceId : target.threadId;
      const version = this.passagePlans.currentEntity(projectId, entityKind, entityId);
      if (!version) throw failure("repair_target_not_found", `Repair target ${targetKey} not found`);
      return { kind: "passage-entity-version", targetKey, entityKind, entityId, versionId: version.id };
    }
    if (target.kind === "passage-prose") {
      const passage = this.passagePlans.currentEntity(projectId, "passage", target.passageId);
      if (!passage) throw failure("repair_target_not_found", `Repair target ${targetKey} not found`);
      const head = this.drafts.getHead(projectId, target.passageId);
      return {
        kind: "passage-prose-head", targetKey, passageId: target.passageId,
        currentDraftVersionId: head?.current.id ?? null, acceptedDraftVersionId: head?.accepted?.id ?? null,
        acceptedLifecycleStatus: acceptedLifecycle(head?.accepted?.lifecycleStatus), acceptedLocked: head?.acceptedLocked ?? false,
        acceptedStale: head?.accepted?.stale ?? false, passagePlanVersionId: passage.id,
        upstreamVersions: sortedRecord(head?.accepted?.upstreamVersions ?? {}),
        neighboringDraftVersions: sortedRecord(head?.accepted?.neighboringDraftVersions ?? {}),
      };
    }
    const artifactId = target.kind === "mechanic" ? "mechanics" as const
      : target.kind === "relationship" || target.kind === "canon-fact" ? "bible" as const
        : target.kind === "ending" ? "endings" as const : "routes" as const;
    const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
    const version = versionId ? this.artifacts.getVersion(versionId) : undefined;
    if (!version || version.projectId !== projectId || version.artifactId !== artifactId) throw failure("repair_target_not_found", `Approved ${artifactId} repair base not found`);
    const entity = this.artifactEntity(target, version.content);
    if (!entity) throw failure("repair_target_not_found", `Repair target ${targetKey} not found`);
    return { kind: "artifact-entity-version", targetKey, artifactId, artifactVersionId: version.id, entityType: entity.type, entityId: entity.id, entityFingerprint: repairFingerprint(entity.content) };
  }

  private artifactEntity(target: RepairTarget, content: unknown): { type: string; id: string; content: unknown } | null {
    if (target.kind === "mechanic") {
      const mechanics = LongFormMechanicsPlanSchema.parse(content);
      const item = [...mechanics.visibleStats, ...mechanics.relationships, ...mechanics.flags, ...mechanics.resources].find((candidate) => candidate.key === target.mechanicKey);
      return item ? { type: "mechanic", id: item.key, content: item } : null;
    }
    if (target.kind === "relationship") {
      const item = LongFormStoryBibleSchema.parse(content).relationships.find((candidate) => candidate.id === target.relationshipId);
      return item ? { type: "relationship", id: item.id, content: item } : null;
    }
    if (target.kind === "canon-fact") {
      const item = LongFormStoryBibleSchema.parse(content).canonFacts.find((candidate) => candidate.id === target.factId);
      return item ? { type: "canon-fact", id: item.id, content: item } : null;
    }
    if (target.kind === "route") {
      const item = LongFormRoutePlanSchema.parse(content).routes.find((candidate) => candidate.id === target.routeId);
      return item ? { type: "route", id: item.id, content: item } : null;
    }
    if (target.kind === "route-section") {
      const routes = LongFormRoutePlanSchema.parse(content);
      const collection = target.sectionKind === "act" ? routes.acts : target.sectionKind === "decision" ? routes.decisionPoints
        : target.sectionKind === "reconvergence" ? routes.reconvergences : routes.endingHooks;
      const item = collection.find((candidate) => candidate.id === target.sectionId);
      return item ? { type: `route-${target.sectionKind}`, id: item.id, content: item } : null;
    }
    if (target.kind === "ending") {
      const item = LongFormEndingPlanSchema.parse(content).endings.find((candidate) => candidate.id === target.endingId);
      return item ? { type: "ending", id: item.id, content: item } : null;
    }
    return null;
  }

  private impactIndex(projectId: string): RepairImpactIndex {
    const passages = this.passagePlans.currentEntities<PassagePlan>(projectId, "passage").map((item) => item.content);
    const choices = this.passagePlans.currentEntities<ChoicePlan>(projectId, "choice").map((item) => ({
      ...item.content, mechanicKeys: collectMechanicKeys(item.content),
    }));
    const threads = this.passagePlans.currentEntities<NarrativeThread>(projectId, "thread").map((item) => item.content);
    const heads = this.drafts.listHeads(projectId);
    const acceptedIds = new Set(heads.flatMap((head) => head.accepted ? [head.accepted.id] : []));
    const acceptedRoots = this.drafts.acceptedVersionRoots(projectId);
    const drafts = this.drafts.listAllVersions(projectId).map((draft) => ({
      id: draft.id, passageId: draft.passageId, basedOnPassagePlanVersionId: draft.basedOnPassagePlanVersionId,
      neighboringDraftVersions: draft.neighboringDraftVersions,
      neighboringAcceptedRoots: Object.fromEntries(Object.entries(draft.neighboringDraftVersions)
        .flatMap(([passageId, versionId]) => acceptedRoots[versionId] ? [[passageId, acceptedRoots[versionId]]] : [])),
      accepted: acceptedIds.has(draft.id), acceptedRoot: acceptedRoots[draft.id] ?? null,
    }));
    const mechanics = this.approvedArtifact<LongFormMechanicsPlan>(projectId, "mechanics", LongFormMechanicsPlanSchema);
    const endings = this.approvedArtifact<LongFormEndingPlan>(projectId, "endings", LongFormEndingPlanSchema);
    return {
      passages, choices, threads, drafts,
      mechanicGates: mechanics.content.gates.map((gate) => ({ id: gate.id, mechanicKeys: gate.conditions.map((condition) => condition.mechanicKey), targetType: gate.targetType, targetId: gate.targetId })),
      routeSections: this.routeSectionsFrom(
        this.approvedArtifact<LongFormRoutePlan>(projectId, "routes", LongFormRoutePlanSchema).content,
        endings.content.endings,
      ),
      endings: endings.content.endings.map((ending) => ({ id: ending.id, routeId: ending.routeId, relationshipIds: ending.relationshipOutcomes.map((item) => item.relationshipId) })),
      historicalEvidence: this.historicalEvidence(projectId),
    };
  }

  private historicalEvidence(projectId: string): RepairImpactIndex["historicalEvidence"] {
    const result: RepairImpactIndex["historicalEvidence"] = [];
    const inputs = this.artifacts.listVersions<SimulationInputRecord>(projectId, SIMULATION_INPUT_ARTIFACT_ID);
    const targetKeysByInput = new Map(inputs.map((version) => [version.id, this.expandInputTargetKeys(version.content)]));
    for (const input of inputs) result.push({ kind: "simulation-input", id: input.id, targetKeys: targetKeysByInput.get(input.id)! });
    for (const run of this.artifacts.listVersions<SimulationRunRecord>(projectId, SIMULATION_RUN_ARTIFACT_ID)) result.push({ kind: "simulation-run", id: run.id, targetKeys: targetKeysByInput.get(run.content.inputArtifactVersionId) ?? [] });
    for (const campaign of this.artifacts.listVersions<PlaytestCampaignRecord>(projectId, PLAYTEST_CAMPAIGN_ARTIFACT_ID)) result.push({ kind: "playtest-campaign", id: campaign.id, targetKeys: targetKeysByInput.get(campaign.content.simulationInputArtifactVersionId) ?? [] });
    for (const review of this.reviews.list<NarrativeReviewAggregate>(projectId)) result.push({ kind: "narrative-review", id: review.id, targetKeys: targetKeysByInput.get(review.content.reviewInput.simulationInputVersionId) ?? reviewTargetKeys(review.content) });
    for (const plan of this.repairPlans.list<RepairPlanRecord>(projectId)) result.push({ kind: "repair-plan", id: plan.id, targetKeys: plan.content.definition.authorizedTargets.map(repairTargetKey) });
    return result;
  }

  private expandInputTargetKeys(input: SimulationInputRecord): string[] {
    const keys = new Set(simulationInputTargetKeys(input));
    const addArtifact = (artifactId: keyof SimulationInputRecord["upstreamVersions"]) => {
      const versionId = input.upstreamVersions[artifactId];
      const version = versionId ? this.artifacts.getVersion(versionId) : undefined;
      if (!version) return;
      if (artifactId === "bible") {
        const bible = LongFormStoryBibleSchema.parse(version.content);
        bible.relationships.forEach((item) => keys.add(`relationship:${item.id}`));
        bible.canonFacts.forEach((item) => keys.add(`fact:${item.id}`));
      } else if (artifactId === "routes") {
        const routes = LongFormRoutePlanSchema.parse(version.content);
        routes.routes.forEach((item) => keys.add(`route:${item.id}`));
        this.routeSectionsFrom(routes).forEach((item) => keys.add(`route-${item.kind}:${item.id}`));
      } else if (artifactId === "endings") LongFormEndingPlanSchema.parse(version.content).endings.forEach((item) => keys.add(`ending:${item.id}`));
      else if (artifactId === "mechanics") {
        const mechanics = LongFormMechanicsPlanSchema.parse(version.content);
        [...mechanics.visibleStats, ...mechanics.relationships, ...mechanics.flags, ...mechanics.resources].forEach((item) => keys.add(`mechanic:${item.key}`));
      }
    };
    (["bible", "routes", "endings", "mechanics"] as const).forEach(addArtifact);
    return [...keys].sort();
  }

  private routeSections(projectId: string): RepairImpactIndex["routeSections"] {
    return this.routeSectionsFrom(
      this.approvedArtifact<LongFormRoutePlan>(projectId, "routes", LongFormRoutePlanSchema).content,
      this.approvedArtifact<LongFormEndingPlan>(projectId, "endings", LongFormEndingPlanSchema).content.endings,
    );
  }

  private routeSectionsFrom(routes: LongFormRoutePlan, endings: LongFormEndingPlan["endings"] = []): RepairImpactIndex["routeSections"] {
    return repairImpactRouteSections(routes, endings);
  }

  private approvedArtifact<T>(projectId: string, artifactId: string, schema: { parse(value: unknown): T }): ArtifactVersion<T> {
    const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
    const version = versionId ? this.artifacts.getVersion<T>(versionId) : undefined;
    if (!version || version.projectId !== projectId || version.artifactId !== artifactId) throw failure("repair_target_not_found", `Approved ${artifactId} artifact not found`);
    return { ...version, content: schema.parse(version.content) };
  }

  private assertNarrativeEvidence(review: NarrativeReviewAggregate, finding: NarrativeReviewFindingRecord): void {
    for (const reference of finding.evidenceReferences) {
      if (reference.kind === "passage") {
        const passage = review.reviewInput.passageVersions.find((item) => item.entityId === reference.passageId);
        const draft = review.reviewInput.acceptedDraftVersions.find((item) => item.entityId === reference.passageId);
        if (!passage || draft?.versionId !== reference.draftVersionId) throw failure("repair_source_lineage_invalid", "Narrative passage evidence is not in the exact review input");
      } else if (reference.kind === "choice") {
        if (!review.reviewInput.choiceVersions.some((item) => item.entityId === reference.choiceId)) throw failure("repair_source_lineage_invalid", "Narrative choice evidence is not in the exact review input");
      } else if (reference.kind === "simulation-run") {
        const run = this.simulations.getRun(review.projectId, reference.runVersionId);
        if (!review.reviewInput.simulationRunVersionIds.includes(run.id) || run.content.trace.fingerprint !== reference.traceFingerprint) throw failure("repair_source_lineage_invalid", "Narrative simulation evidence is invalid");
      } else {
        const campaign = this.playtests.getCampaign(review.projectId, reference.campaignVersionId);
        if (!review.reviewInput.campaignVersionIds.includes(campaign.id)) throw failure("repair_source_lineage_invalid", "Narrative campaign evidence is invalid");
        if (reference.kind === "playtest-finding" && !campaign.content.findings.some((item) => item.id === reference.findingId)) throw failure("repair_source_lineage_invalid", "Narrative playtest-finding evidence is invalid");
        if (reference.kind === "playtest-sample" && !campaign.content.samples.some((item) => item.id === reference.sampleId && item.traceFingerprint === reference.traceFingerprint)) throw failure("repair_source_lineage_invalid", "Narrative playtest-sample evidence is invalid");
      }
    }
  }

  private requireSnapshot(projectId: string, snapshotId: string) {
    const snapshot = this.passagePlans.getSnapshot(snapshotId);
    if (!snapshot || snapshot.projectId !== projectId) throw failure("repair_source_lineage_invalid", "Simulation snapshot lineage is invalid");
    return snapshot;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw failure("project_not_found", "Long-form project not found");
    return project;
  }
}

export function repairImpactRouteSections(
  routes: LongFormRoutePlan,
  endings: LongFormEndingPlan["endings"] = [],
): RepairImpactIndex["routeSections"] {
  const acts = new Map(routes.acts.map((act) => [act.id, act]));
  const routesForActs = (actIds: string[]) => sortedIds(actIds.flatMap((actId) => {
    const routeId = acts.get(actId)?.routeId;
    return routeId ? [routeId] : [];
  }));
  return [
    ...routes.acts.map((item) => ({
      kind: "act" as const, id: item.id, routeIds: item.routeId ? [item.routeId] : [], owningActId: null,
      destinationActIds: [], fromActIds: [], toActId: null,
      ownedDecisionIds: sortedIds(routes.decisionPoints.filter((decision) => decision.actId === item.id).map((decision) => decision.id)),
      incomingDecisionIds: sortedIds(routes.decisionPoints.filter((decision) => decision.choices.some((choice) => choice.destinationActId === item.id)).map((decision) => decision.id)),
      reconvergenceIds: sortedIds(routes.reconvergences.filter((reconvergence) => reconvergence.fromActIds.includes(item.id) || reconvergence.toActId === item.id).map((reconvergence) => reconvergence.id)),
      endingIds: [],
    })),
    ...routes.decisionPoints.map((item) => {
      const destinationActIds = sortedIds(item.choices.map((choice) => choice.destinationActId));
      const owningRouteId = acts.get(item.actId)?.routeId;
      return {
        kind: "decision" as const, id: item.id,
        routeIds: sortedIds([
          ...(owningRouteId ? [owningRouteId] : []),
          ...item.choices.flatMap((choice) => choice.routeId ? [choice.routeId] : []),
          ...routesForActs(destinationActIds),
        ]),
        owningActId: item.actId, destinationActIds, fromActIds: [], toActId: null,
        ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [],
      };
    }),
    ...routes.reconvergences.map((item) => ({
      kind: "reconvergence" as const, id: item.id,
      routeIds: routesForActs([...item.fromActIds, item.toActId]), owningActId: null,
      destinationActIds: [], fromActIds: sortedIds(item.fromActIds), toActId: item.toActId,
      ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [],
    })),
    ...routes.endingHooks.map((item) => ({
      kind: "ending-hook" as const, id: item.id, routeIds: [item.routeId], owningActId: null,
      destinationActIds: [], fromActIds: [], toActId: null, ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [],
      endingIds: sortedIds(endings.filter((ending) => ending.hookId === item.id).map((ending) => ending.id)),
    })),
  ];
}

export interface RepairPlanView extends RepairPlanRecord {
  artifactVersionId: string;
  currentState: { status: "current" | "historical"; reasons: string[] };
  eligibleForGeneration: boolean;
}
export interface RepairPlanSummary {
  id: string; artifactVersionId: string; createdAt: string; definitionFingerprint: string;
  intent: RepairIntent; findingCount: number; targetCount: number; impactCount: number;
  currentState: RepairPlanView["currentState"];
}
type EvidenceState = { status: "current" | "historical"; reasons: string[] };

function evidenceState(reasons: string[]): EvidenceState {
  const unique = [...new Set(reasons)];
  return { status: unique.length ? "historical" : "current", reasons: unique };
}

function resolved(reference: RepairFindingReference, sourceFingerprint: string, state: EvidenceState, categoryCode: string, message: string, entityKeys: string[]): ResolvedRepairFinding {
  return {
    reference, sourceFingerprint, sourceState: state.status, stateReasons: state.reasons,
    categoryCode, message, entityKeys: [...new Set(entityKeys)].sort(),
  };
}

function validationFindings(value: unknown): PassagePlanFinding[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as PassageValidationReport).findings)) throw failure("repair_source_lineage_invalid", "Static validation snapshot does not contain durable findings");
  return (value as PassageValidationReport).findings;
}

function staticFindingId(finding: PassagePlanFinding): string { return `${finding.code}:${finding.entityType}:${finding.entityId}`; }
function staticEntityKeys(finding: PassagePlanFinding): string[] {
  if (["passage", "choice", "thread", "mechanic", "route", "ending"].includes(finding.entityType)) return [`${finding.entityType}:${finding.entityId}`];
  return [];
}
function runtimeEntityKeys(finding: RuntimeFinding): string[] {
  return [finding.passageId && `passage:${finding.passageId}`, finding.choiceId && `choice:${finding.choiceId}`, finding.mechanicKey && `mechanic:${finding.mechanicKey}`, finding.endingId && `ending:${finding.endingId}`].filter((item): item is string => Boolean(item));
}
function playtestEntityKeys(finding: PlaytestFinding): string[] {
  return [...finding.passageIds.map((id) => `passage:${id}`), ...finding.choiceIds.map((id) => `choice:${id}`), ...finding.mechanicKeys.map((id) => `mechanic:${id}`), ...finding.routeIds.map((id) => `route:${id}`), ...finding.endingIds.map((id) => `ending:${id}`)];
}
function narrativeEntityKeys(finding: NarrativeReviewFindingRecord): string[] {
  return [...finding.passageIds.map((id) => `passage:${id}`), ...finding.choiceIds.map((id) => `choice:${id}`), ...finding.mechanicKeys.map((id) => `mechanic:${id}`), ...finding.routeIds.map((id) => `route:${id}`), ...finding.endingIds.map((id) => `ending:${id}`), ...finding.factIds.map((id) => `fact:${id}`), ...finding.threadIds.map((id) => `thread:${id}`)];
}

function summary(item: ResolvedRepairFinding, locator: RepairFindingLocator, category: string, severity: string, createdAt: string): RepairFindingSummary {
  return { sourceKind: item.reference.kind, locator, sourceFingerprint: item.sourceFingerprint, code: item.categoryCode, category, severity, message: item.message, sourceState: item.sourceState, entityIds: item.entityKeys, createdAt };
}

function parseLocator(value: unknown): RepairFindingLocator {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("repair_request_invalid", "Finding locator is required");
  const item = value as Partial<RepairFindingLocator>;
  if (!["foundation-3-static-validation", "foundation-5a-runtime", "foundation-5b-playtest", "foundation-5c-narrative-review"].includes(item.sourceKind ?? "")
    || typeof item.sourceVersionId !== "string" || !item.sourceVersionId || typeof item.findingId !== "string" || !item.findingId) throw failure("repair_request_invalid", "Finding locator is invalid");
  return item as RepairFindingLocator;
}

function parseTargets(input: unknown): RepairTarget[] {
  if (!Array.isArray(input) || !input.length) throw failure("repair_request_invalid", "Select at least one authorized mutation target");
  if (input.length > REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets) throw failure("repair_targets_too_large", `Select at most ${REPAIR_PLANNING_POLICY_V1.maxAuthorizedTargets} targets`);
  const targets = input.map((item) => RepairTargetSchema.parse(item));
  if (new Set(targets.map(repairTargetKey)).size !== targets.length) throw failure("repair_request_invalid", "Duplicate repair targets are not allowed");
  return targets;
}

function targetFromEntityKey(key: string): RepairTarget | null {
  const [kind, id] = splitKey(key);
  if (kind === "passage") return { kind: "passage-plan-passage", passageId: id };
  if (kind === "choice") return { kind: "passage-plan-choice", choiceId: id };
  if (kind === "thread") return { kind: "narrative-thread", threadId: id };
  if (kind === "mechanic") return { kind: "mechanic", mechanicKey: id };
  if (kind === "relationship") return { kind: "relationship", relationshipId: id };
  if (kind === "fact") return { kind: "canon-fact", factId: id };
  if (kind === "route") return { kind: "route", routeId: id };
  if (kind === "ending") return { kind: "ending", endingId: id };
  return null;
}

function intentAllows(intent: RepairIntent, target: RepairTarget): boolean {
  const allowed: Record<RepairIntent["category"], RepairTarget["kind"][]> = {
    structural: ["passage-plan-passage", "passage-plan-choice", "narrative-thread", "mechanic", "route", "route-section", "ending"],
    "passage-plan": ["passage-plan-passage", "passage-plan-choice", "narrative-thread"],
    choice: ["passage-plan-choice", "passage-plan-passage"],
    continuity: ["passage-plan-passage", "passage-plan-choice", "narrative-thread", "passage-prose", "canon-fact"],
    "narrative-thread": ["narrative-thread", "passage-plan-passage", "passage-prose"],
    prose: ["passage-prose"],
    mechanic: ["mechanic", "passage-plan-choice"],
    relationship: ["relationship", "passage-plan-passage", "passage-prose", "mechanic"],
    "fact-reference": ["canon-fact", "passage-plan-passage", "passage-prose"],
    route: ["route", "route-section", "passage-plan-passage", "passage-plan-choice", "ending"],
    ending: ["ending", "route", "passage-plan-passage", "passage-plan-choice"],
    "runtime-state-consequence": ["mechanic", "passage-plan-choice", "ending", "route"],
  };
  return allowed[intent.category].includes(target.kind);
}

function providerNeed(intent: RepairIntent): "manual-deterministic" | "ai-assisted" {
  return ["prose", "continuity", "narrative-thread", "relationship", "fact-reference"].includes(intent.category) ? "ai-assisted" : "manual-deterministic";
}

function collectMechanicKeys(choice: ChoicePlan): string[] {
  const keys: string[] = choice.effects.map((effect) => effect.mechanicKey);
  const visit = (condition: ChoicePlan["condition"]): void => {
    if (!condition) return;
    if (condition.kind === "compare") keys.push(condition.mechanicKey);
    else if (condition.kind === "not") visit(condition.item);
    else if (condition.kind === "all" || condition.kind === "any") condition.items.forEach(visit);
  };
  visit(choice.condition);
  return [...new Set(keys)].sort();
}

function reviewTargetKeys(review: NarrativeReviewAggregate): string[] {
  return [...new Set([
    ...review.reviewInput.passageVersions.map((item) => `passage:${item.entityId}`),
    ...review.reviewInput.choiceVersions.map((item) => `choice:${item.entityId}`),
    ...review.reviewInput.threadVersions.map((item) => `thread:${item.entityId}`),
    ...review.reviewInput.acceptedDraftVersions.map((item) => `prose:${item.entityId}`),
  ])].sort();
}

function sortedRecord(value: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))); }
function sortedIds(values: string[]): string[] { return [...new Set(values)].sort(); }
function splitKey(value: string): [string, string] { const separator = value.indexOf(":"); return [value.slice(0, separator), value.slice(separator + 1)]; }
function failure(code: string, message: string, details?: unknown): RepairPlanningServiceError { return new RepairPlanningServiceError(code, message, details); }
function isResolvedFinding(value: unknown): value is ResolvedRepairFinding { return Boolean(value && typeof value === "object" && "reference" in value && "sourceFingerprint" in value); }
function acceptedLifecycle(value: string | undefined): "accepted" | "reviewed" | "locked" | null {
  return value === "accepted" || value === "reviewed" || value === "locked" ? value : null;
}
