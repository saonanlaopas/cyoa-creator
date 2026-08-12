import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  materializeAndValidateRepairProposal,
  materializeRepairProposalState,
  repairProposalFingerprint,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassageStructure,
  type RepairExpectedBase,
  type RepairPlanDefinition,
  type RepairProposalBaseState,
  type RepairProposalOperation as PipelineRepairProposalOperation,
} from "@story-to-cyoa/pipeline";
import {
  REPAIR_APPLICATION_POLICY_V1,
  type RepairApplicationRecord,
  type RepairFindingDisposition,
  type RepairProposalOperation,
  type RepairProposalRecord,
} from "@story-to-cyoa/domain";
import {
  type ArtifactRepository,
  type PassageDraftRepository,
  type PassagePlanRepository,
  type ProjectRepository,
  type RepairApplicationRepository,
  type RepairApplicationSelection,
  type RepairDraftProvenance,
  type RepairProposalRepository,
  type StoryDatabase,
  type WorkflowRepository,
  selectGroups,
} from "@story-to-cyoa/persistence";
import {
  compileRuntime,
  runDeterministicPath,
  stableFingerprint,
  type RuntimeCompileSource,
} from "@story-to-cyoa/runtime";
import type { RepairPlanningService } from "./repair-planning-service.js";
import type { SimulationRunRecord } from "./simulation-service.js";

export interface RepairApplicationPreview {
  projectId: string;
  proposalId: string;
  proposalArtifactVersionId: string;
  proposalFingerprint: string;
  proposalDefinitionFingerprint: string;
  proposalState: { status: "current" | "historical"; reasons: string[] };
  explicitlySelectedGroupIds: string[];
  requiredDependencyGroupIds: string[];
  effectiveGroupIds: string[];
  groups: RepairProposalRecord["groups"];
  operations: RepairProposalOperation[];
  expectedBases: RepairExpectedBase[];
  currentBases: Record<string, string | null>;
  generatedEntityIds: Array<{ entityKind: "choice" | "thread"; entityId: string }>;
  impactNodeIds: string[];
  wouldStale: string[];
  validation: ReturnType<typeof materializeAndValidateRepairProposal> | null;
  errors: string[];
  warnings: string[];
  verificationPlan: Array<{
    kind: "static" | "exact-simulation-replay" | "historical-only";
    sourceFingerprint: string;
    bounded: boolean;
    description: string;
  }>;
  definitionFingerprint: string;
  previewFingerprint: string;
  applyAllowed: boolean;
  providerCalls: 0;
  canonicalMutations: 0;
}

export class RepairApplicationServiceError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); }
}

const artifactDependencies: Record<string, string[]> = {
  bible: ["brief", "source"], routes: ["brief", "bible"], endings: ["routes"], mechanics: ["bible", "routes", "endings"],
};

export class RepairApplicationService {
  public constructor(
    private readonly database: StoryDatabase,
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
    private readonly planning: RepairPlanningService,
    private readonly proposals: RepairProposalRepository,
    private readonly applications: RepairApplicationRepository,
  ) {}

  preview(projectId: string, proposalId: string, selectedGroupIds: string[]): RepairApplicationPreview {
    this.requireProject(projectId);
    const version = this.proposals.get<RepairProposalRecord>(projectId, proposalId);
    if (!version) throw failure("repair_proposal_not_found", "Repair proposal not found");
    const selection = selectGroups(version.content, selectedGroupIds);
    return this.buildPreview(version.content, version.id, selection);
  }

  apply(
    projectId: string,
    proposalId: string,
    selectedGroupIds: string[],
    previewFingerprint: string,
    options: { simulateFailure?: boolean; beforeTransactionalPrecondition?: () => void } = {},
  ): RepairApplicationRecord {
    this.requireProject(projectId);
    const proposalVersion = this.proposals.get<RepairProposalRecord>(projectId, proposalId);
    if (!proposalVersion) throw failure("repair_proposal_not_found", "Repair proposal not found");
    const preflight = this.buildPreview(proposalVersion.content, proposalVersion.id, selectGroups(proposalVersion.content, selectedGroupIds));
    if (!preflight.applyAllowed || preflight.previewFingerprint !== previewFingerprint) {
      throw failure("stale_repair_proposal", "Repair proposal preview is stale or no longer valid", preflight);
    }
    options.beforeTransactionalPrecondition?.();
    try {
      return this.applications.apply({
        projectId,
        proposalId,
        proposalArtifactVersionId: proposalVersion.id,
        proposalDefinitionFingerprint: proposalVersion.content.definitionFingerprint,
        explicitlySelectedGroupIds: selectedGroupIds,
        previewFingerprint,
        simulateFailure: options.simulateFailure,
        mutateInTransaction: (proposal, selection) => {
          const checked = this.buildPreview(proposal, proposalVersion.id, selection);
          if (!checked.applyAllowed || checked.previewFingerprint !== previewFingerprint) {
            throw failure("stale_repair_proposal", "Repair proposal changed before its atomic application", checked);
          }
          return this.mutate(proposal, checked);
        },
      });
    } catch (error) {
      if (error instanceof RepairApplicationServiceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/already has|lineage|base|collision|locked|preview|current|stale/i.test(message)) {
        throw failure("stale_repair_proposal", message);
      }
      throw error;
    }
  }

  list(projectId: string): RepairApplicationRecord[] {
    this.requireProject(projectId);
    return this.applications.list(projectId);
  }

  get(projectId: string, applicationId: string): RepairApplicationRecord {
    this.requireProject(projectId);
    const application = this.applications.get(projectId, applicationId);
    if (!application) throw failure("repair_application_not_found", "Repair application not found");
    return application;
  }

  private buildPreview(
    proposal: RepairProposalRecord,
    proposalArtifactVersionId: string,
    selection: RepairApplicationSelection,
  ): RepairApplicationPreview {
    const operations = selection.operationIds.map((id) => proposal.operations.find((item) => item.id === id)!);
    const groups = selection.effectiveGroupIds.map((id) => proposal.groups.find((item) => item.id === id)!);
    const authorizedTargetKeys = new Set(groups.flatMap((group) => group.authorizedTargetKeys));
    const expectedBases = proposal.expectedBases.filter((base) => authorizedTargetKeys.has(base.targetKey));
    const currentBase = this.buildCurrentBase(proposal.projectId);
    const currentBases: Record<string, string | null> = {};
    const errors: string[] = [];
    for (const base of expectedBases) {
      const comparison = this.compareBase(proposal.projectId, base);
      currentBases[base.targetKey] = comparison.current;
      if (!comparison.matches) errors.push(comparison.message);
    }
    for (const operation of operations.filter((item) => item.kind === "add-entity")) {
      if (this.passagePlans.currentEntity(proposal.projectId, operation.entityKind, operation.entityId)) {
        errors.push(`Generated ${operation.entityKind} ${operation.entityId} now collides with canonical content`);
      }
    }
    let validation: RepairApplicationPreview["validation"] = null;
    if (!errors.length) {
      try { validation = materializeAndValidateRepairProposal(currentBase, operations as PipelineRepairProposalOperation[]); }
      catch (error) {
        const detail = error as { issues?: string[] };
        errors.push(...(Array.isArray(detail.issues) ? detail.issues : [error instanceof Error ? error.message : String(error)]));
      }
    }
    const planState = this.planState(proposal);
    errors.push(...planState.reasons);
    const verificationPlan = this.verificationPlan(proposal, operations);
    const generatedEntityIds = operations.flatMap((operation) => operation.kind === "add-entity"
      ? [{ entityKind: operation.entityKind, entityId: operation.entityId }] : []);
    const impactNodeIds = [...new Set(groups.flatMap((group) => group.expectedImpactNodeIds))].sort();
    const wouldStale = this.previewStaleness(proposal.projectId, operations);
    const definition = {
      policy: { id: REPAIR_APPLICATION_POLICY_V1.id },
      proposalId: proposal.id,
      proposalArtifactVersionId,
      proposalDefinitionFingerprint: proposal.definitionFingerprint,
      explicitlySelectedGroupIds: selection.explicitlySelectedGroupIds,
      requiredDependencyGroupIds: selection.requiredDependencyGroupIds,
      effectiveGroupIds: selection.effectiveGroupIds,
      operationIds: selection.operationIds,
      expectedBases,
    };
    const definitionFingerprint = repairProposalFingerprint(definition);
    const previewState = {
      definitionFingerprint,
      currentBases,
      effectiveStateFingerprint: validation?.effectiveStateFingerprint ?? null,
      validationFingerprint: validation?.evidenceFingerprint ?? null,
      errors: [...new Set(errors)].sort(),
      wouldStale,
      verificationPlan,
    };
    const previewFingerprint = repairProposalFingerprint(previewState);
    return {
      projectId: proposal.projectId,
      proposalId: proposal.id,
      proposalArtifactVersionId,
      proposalFingerprint: repairProposalFingerprint(proposal),
      proposalDefinitionFingerprint: proposal.definitionFingerprint,
      proposalState: planState,
      ...selection,
      groups,
      operations,
      expectedBases,
      currentBases,
      generatedEntityIds,
      impactNodeIds,
      wouldStale,
      validation,
      errors: previewState.errors,
      warnings: validation?.warnings ?? [],
      verificationPlan,
      definitionFingerprint,
      previewFingerprint,
      applyAllowed: previewState.errors.length === 0 && Boolean(validation),
      providerCalls: 0,
      canonicalMutations: 0,
    };
  }

  private mutate(proposal: RepairProposalRecord, preview: RepairApplicationPreview) {
    const operations = preview.operations;
    const effective = materializeRepairProposalState(
      this.buildCurrentBase(proposal.projectId), operations as PipelineRepairProposalOperation[],
    );
    const beforeStaleness = new Set((this.rawStaleness(proposal.projectId)).map((item) => item.id));
    const resultingVersions: RepairApplicationRecord["resultingVersions"] = [];
    const preApplyVersions = { ...preview.currentBases };
    const passageResults = new Map<string, string>();

    for (const operation of operations.filter((item) => item.kind !== "create-passage-draft-candidate"
      && ["passage", "choice", "thread"].includes(item.entityKind))) {
      const version = this.passagePlans.insertEntityVersionInTransaction(
        proposal.projectId,
        operation.entityKind as "passage" | "choice" | "thread",
        operation.entityId,
        operation.after,
      );
      passageResults.set(`${operation.entityKind}:${operation.entityId}`, version.id);
      resultingVersions.push({ operationId: operation.id, entityKind: operation.entityKind, entityId: operation.entityId, versionId: version.id });
    }
    if (passageResults.size) this.passagePlans.markDraftInTransaction(proposal.projectId);

    const artifactByKind: Record<string, { artifactId: "bible" | "routes" | "endings" | "mechanics"; content: unknown; schema: { parse(value: unknown): unknown } }> = {
      relationship: { artifactId: "bible", content: effective.bible, schema: LongFormStoryBibleSchema },
      "canon-fact": { artifactId: "bible", content: effective.bible, schema: LongFormStoryBibleSchema },
      route: { artifactId: "routes", content: effective.routes, schema: LongFormRoutePlanSchema },
      "route-act": { artifactId: "routes", content: effective.routes, schema: LongFormRoutePlanSchema },
      "route-decision": { artifactId: "routes", content: effective.routes, schema: LongFormRoutePlanSchema },
      "route-reconvergence": { artifactId: "routes", content: effective.routes, schema: LongFormRoutePlanSchema },
      "route-ending-hook": { artifactId: "routes", content: effective.routes, schema: LongFormRoutePlanSchema },
      ending: { artifactId: "endings", content: effective.endings, schema: LongFormEndingPlanSchema },
      mechanic: { artifactId: "mechanics", content: effective.mechanics, schema: LongFormMechanicsPlanSchema },
    };
    const artifactOperations = operations.filter((item) => artifactByKind[item.entityKind]);
    const affectedArtifacts = [...new Set(artifactOperations.map((item) => artifactByKind[item.entityKind]!.artifactId))].sort();
    const artifactResults = new Map<string, string>();
    for (const artifactId of affectedArtifacts) {
      const item = Object.values(artifactByKind).find((candidate) => candidate.artifactId === artifactId)!;
      const version = this.artifacts.saveArtifactInTransaction({
        projectId: proposal.projectId,
        artifactId,
        artifactType: artifactId,
        content: item.content,
        schema: item.schema as never,
        dependencies: artifactDependencies[artifactId],
      });
      artifactResults.set(artifactId, version.id);
      this.workflow.markDraft(proposal.projectId, artifactId);
      this.artifacts.markDependentsStale(proposal.projectId, artifactId)
        .forEach((dependent) => this.workflow.markStale(proposal.projectId, dependent));
      this.passagePlans.markStale(proposal.projectId);
    }
    for (const operation of artifactOperations) {
      const artifactId = artifactByKind[operation.entityKind]!.artifactId;
      resultingVersions.push({ operationId: operation.id, entityKind: operation.entityKind, entityId: operation.entityId, versionId: artifactResults.get(artifactId)! });
    }

    const applicationId = `rap_${preview.definitionFingerprint.slice(0, 32)}`;
    const draftLinks: Array<{ operationId: string; passageId: string; draftVersionId: string; provenance: RepairDraftProvenance }> = [];
    for (const operation of operations.filter((item) => item.kind === "create-passage-draft-candidate")) {
      const expected = operation.expectedBase;
      if (expected?.kind !== "passage-prose-head") throw new Error("Repair prose base is invalid");
      const passageVersionId = passageResults.get(`passage:${operation.entityId}`)
        ?? this.passagePlans.currentEntity(proposal.projectId, "passage", operation.entityId)?.id;
      if (!passageVersionId) throw new Error("Repair prose passage base is missing");
      const draft = this.drafts.createVersionInTransaction({
        projectId: proposal.projectId,
        passageId: operation.entityId,
        basedOnPassagePlanVersionId: passageVersionId,
        proseMarkdown: String((operation.after as { proposedProse: string }).proposedProse),
        lifecycleStatus: "candidate",
        sourceKind: "manual",
        authorNote: "Repair proposal candidate",
        upstreamVersions: expected.upstreamVersions,
        neighboringDraftVersions: expected.neighboringDraftVersions,
      });
      resultingVersions.push({ operationId: operation.id, entityKind: operation.entityKind, entityId: operation.entityId, versionId: draft.id });
      draftLinks.push({
        operationId: operation.id,
        passageId: operation.entityId,
        draftVersionId: draft.id,
        provenance: {
          applicationId,
          applicationDefinitionFingerprint: preview.definitionFingerprint,
          proposalId: proposal.id,
          proposalArtifactVersionId: preview.proposalArtifactVersionId,
          proposalDefinitionFingerprint: proposal.definitionFingerprint,
          repairPlanId: proposal.repairPlanId,
          repairPlanArtifactVersionId: proposal.repairPlanArtifactVersionId,
          repairPlanDefinitionFingerprint: proposal.repairPlanDefinitionFingerprint,
          operationId: operation.id,
          sourceFindingFingerprints: operation.sourceFindingFingerprints,
          passagePlanBaseVersionId: passageVersionId,
          expectedCurrentDraftVersionId: expected.currentDraftVersionId,
          expectedAcceptedDraftVersionId: expected.acceptedDraftVersionId,
          upstreamVersions: expected.upstreamVersions,
          neighboringDraftVersions: expected.neighboringDraftVersions,
          draftVersionId: draft.id,
        },
      });
    }

    const newStaleness = this.rawStaleness(proposal.projectId).filter((item) => !beforeStaleness.has(item.id));
    const verification = this.verification(proposal, preview, effective, resultingVersions);
    const application: RepairApplicationRecord = {
      schemaId: "cyoa.repair-application",
      schemaVersion: 1,
      id: applicationId,
      projectId: proposal.projectId,
      proposalId: proposal.id,
      proposalArtifactVersionId: preview.proposalArtifactVersionId,
      proposalDefinitionFingerprint: proposal.definitionFingerprint,
      repairPlanId: proposal.repairPlanId,
      repairPlanArtifactVersionId: proposal.repairPlanArtifactVersionId,
      repairPlanDefinitionFingerprint: proposal.repairPlanDefinitionFingerprint,
      explicitlySelectedGroupIds: preview.explicitlySelectedGroupIds,
      requiredDependencyGroupIds: preview.requiredDependencyGroupIds,
      effectiveGroupIds: preview.effectiveGroupIds,
      operationIds: preview.operations.map((item) => item.id),
      expectedBases: preview.expectedBases,
      generatedEntityIds: preview.generatedEntityIds,
      previewFingerprint: preview.previewFingerprint,
      definitionFingerprint: preview.definitionFingerprint,
      validationFingerprint: preview.validation!.evidenceFingerprint,
      policy: { id: REPAIR_APPLICATION_POLICY_V1.id },
      preApplyVersions,
      resultingVersions: resultingVersions.sort((left, right) => preview.operations.findIndex((item) => item.id === left.operationId)
        - preview.operations.findIndex((item) => item.id === right.operationId)),
      stalenessEvents: newStaleness.map((item) => ({
        id: item.id, reasonCode: item.reason_code, sourceEntityKind: item.source_entity_kind,
        sourceEntityId: item.source_entity_id, draftVersionId: item.draft_version_id, passageId: item.passage_id,
      })),
      verification,
      result: "applied",
      appliedAt: new Date().toISOString(),
    };
    return { application, draftLinks };
  }

  private buildCurrentBase(projectId: string): RepairProposalBaseState {
    const structure = this.passagePlans.currentStructure<PassageStructure>(projectId);
    if (!structure) throw failure("stale_repair_proposal", "Current passage-plan structure is missing");
    const artifact = <T>(artifactId: "bible" | "routes" | "endings" | "mechanics", parse: (value: unknown) => T) => {
      const current = this.artifacts.getCurrent(projectId, artifactId);
      if (!current) throw failure("stale_repair_proposal", `Current ${artifactId} artifact is missing`);
      return { versionId: current.id, content: parse(current.content) };
    };
    return {
      structure: structure.content,
      passages: this.passagePlans.currentEntities<PassagePlan>(projectId, "passage").map((item) => ({ versionId: item.id, content: item.content })),
      choices: this.passagePlans.currentEntities<ChoicePlan>(projectId, "choice").map((item) => ({ versionId: item.id, content: item.content })),
      threads: this.passagePlans.currentEntities<NarrativeThread>(projectId, "thread").map((item) => ({ versionId: item.id, content: item.content })),
      bible: artifact("bible", (value) => LongFormStoryBibleSchema.parse(value)),
      routes: artifact("routes", (value) => LongFormRoutePlanSchema.parse(value)),
      endings: artifact("endings", (value) => LongFormEndingPlanSchema.parse(value)),
      mechanics: artifact("mechanics", (value) => LongFormMechanicsPlanSchema.parse(value)),
    };
  }

  private compareBase(projectId: string, base: RepairExpectedBase): { matches: boolean; current: string | null; message: string } {
    if (base.kind === "passage-entity-version") {
      const current = this.passagePlans.currentEntity(projectId, base.entityKind, base.entityId)?.id ?? null;
      return { matches: current === base.versionId, current, message: `Exact base changed for ${base.targetKey}` };
    }
    if (base.kind === "artifact-entity-version") {
      const current = this.artifacts.getCurrent(projectId, base.artifactId)?.id ?? null;
      return { matches: current === base.artifactVersionId, current, message: `Whole-artifact base changed for ${base.targetKey}` };
    }
    const head = this.drafts.getHead(projectId, base.passageId);
    const current = head?.current.id ?? null;
    const exact = current === base.currentDraftVersionId
      && (head?.accepted?.id ?? null) === base.acceptedDraftVersionId
      && (head?.accepted?.lifecycleStatus ?? null) === base.acceptedLifecycleStatus
      && (head?.acceptedLocked ?? false) === base.acceptedLocked
      && (head?.accepted?.stale ?? false) === base.acceptedStale;
    return { matches: exact, current, message: `Draft head or lock state changed for ${base.targetKey}` };
  }

  private planState(proposal: RepairProposalRecord): { status: "current" | "historical"; reasons: string[] } {
    try {
      const plan = this.planning.get(proposal.projectId, proposal.repairPlanId);
      const current = plan.currentState.status === "current" && plan.artifactVersionId === proposal.repairPlanArtifactVersionId
        && plan.definitionFingerprint === proposal.repairPlanDefinitionFingerprint;
      return current ? { status: "current", reasons: [] }
        : { status: "historical", reasons: ["Exact Foundation 6A repair plan is historical"] };
    } catch (error) {
      return { status: "historical", reasons: [error instanceof Error ? error.message : String(error)] };
    }
  }

  private verificationPlan(proposal: RepairProposalRecord, operations: RepairProposalOperation[]) {
    const fingerprints = new Set(operations.flatMap((item) => item.sourceFindingFingerprints));
    const plan = this.loadPlanDefinition(proposal);
    return plan.resolvedFindings.filter((item) => fingerprints.has(item.sourceFingerprint)).map((item) => {
      if (item.reference.kind === "foundation-3-static-validation") return {
        kind: "static" as const, sourceFingerprint: item.sourceFingerprint, bounded: true,
        description: "Rerun deterministic Foundation 3 passage and planning validation.",
      };
      if (item.reference.kind === "foundation-5a-runtime") return {
        kind: "exact-simulation-replay" as const, sourceFingerprint: item.sourceFingerprint, bounded: true,
        description: "Replay the exact bounded Foundation 5A path against the repaired effective state.",
      };
      return {
        kind: "historical-only" as const, sourceFingerprint: item.sourceFingerprint, bounded: true,
        description: item.reference.kind === "foundation-5b-playtest"
          ? "Keep the campaign immutable and recommend a new bounded playtest."
          : "Record repair application and require an explicit narrative re-review.",
      };
    }).sort((left, right) => left.sourceFingerprint.localeCompare(right.sourceFingerprint));
  }

  private verification(
    proposal: RepairProposalRecord,
    preview: RepairApplicationPreview,
    effective: ReturnType<typeof materializeRepairProposalState>,
    resultingVersions: RepairApplicationRecord["resultingVersions"],
  ): RepairApplicationRecord["verification"] {
    const plan = this.loadPlanDefinition(proposal);
    const selected = new Set(preview.verificationPlan.map((item) => item.sourceFingerprint));
    const dispositions: RepairFindingDisposition[] = [];
    for (const item of plan.resolvedFindings.filter((finding) => selected.has(finding.sourceFingerprint))) {
      if (item.reference.kind === "foundation-3-static-validation") {
        const source = item.reference.finding;
        const remains = preview.validation!.passageValidation.findings.some((finding) =>
          finding.code === source.code && finding.entityType === source.entityType && finding.entityId === source.entityId);
        dispositions.push({
          sourceKind: item.reference.kind,
          sourceFingerprint: item.sourceFingerprint,
          status: remains ? "still-present" : "deterministically-resolved",
          verificationKind: "static",
          message: remains ? "The exact static finding remains after repair." : "The exact static finding is absent from deterministic validation.",
          evidence: { code: source.code, entityType: source.entityType, entityId: source.entityId, validationFingerprint: preview.validation!.evidenceFingerprint },
        });
      } else if (item.reference.kind === "foundation-5a-runtime") {
        const replay = this.replayRuntimeFinding(proposal, preview, effective, resultingVersions, item.reference);
        dispositions.push({
          sourceKind: item.reference.kind,
          sourceFingerprint: item.sourceFingerprint,
          status: replay.remains ? "still-present" : "deterministically-resolved",
          verificationKind: "exact-simulation-replay",
          message: replay.remains
            ? "The exact bounded path was replayed and the runtime finding remains."
            : "The exact bounded path was replayed and the runtime finding is absent.",
          evidence: replay.evidence,
        });
      } else if (item.reference.kind === "foundation-5b-playtest") {
        dispositions.push({
          sourceKind: item.reference.kind,
          sourceFingerprint: item.sourceFingerprint,
          status: "requires-revalidation",
          verificationKind: "historical-only",
          message: "Repair applied; the immutable campaign is historical and a new bounded playtest is recommended.",
          evidence: { campaignArtifactVersionId: item.reference.campaignArtifactVersionId },
        });
      } else {
        dispositions.push({
          sourceKind: item.reference.kind,
          sourceFingerprint: item.sourceFingerprint,
          status: "requires-narrative-rereview",
          verificationKind: "historical-only",
          message: "Repair applied; explicit narrative re-review is required.",
          evidence: { reviewArtifactVersionId: item.reference.reviewArtifactVersionId },
        });
      }
    }
    return { checks: preview.verificationPlan, dispositions };
  }

  private replayRuntimeFinding(
    proposal: RepairProposalRecord,
    preview: RepairApplicationPreview,
    effective: ReturnType<typeof materializeRepairProposalState>,
    resultingVersions: RepairApplicationRecord["resultingVersions"],
    reference: Extract<RepairPlanDefinition["selectedFindings"][number], { kind: "foundation-5a-runtime" }>,
  ) {
    const runVersion = this.artifacts.getVersion<SimulationRunRecord>(reference.runArtifactVersionId);
    if (!runVersion || runVersion.projectId !== proposal.projectId || runVersion.artifactId !== "simulation-runs"
      || runVersion.content.id !== reference.runId || runVersion.content.trace.fingerprint !== reference.traceFingerprint
      || runVersion.content.inputArtifactVersionId !== reference.simulationInputArtifactVersionId) {
      throw failure("repair_source_lineage_invalid", "Exact Foundation 5A run lineage is unavailable for replay");
    }
    const resultVersions = new Map(resultingVersions.map((item) => [`${item.entityKind}:${item.entityId}`, item.versionId]));
    const base = this.buildCurrentBase(proposal.projectId);
    const versionFor = (kind: "passage" | "choice", entityId: string): string => resultVersions.get(`${kind}:${entityId}`)
      ?? (kind === "passage" ? base.passages : base.choices).find((item) => item.content.id === entityId)?.versionId
      ?? `repair-generated:${kind}:${entityId}`;
    const structureVersionId = this.passagePlans.currentStructure(proposal.projectId)?.id;
    if (!structureVersionId) throw failure("stale_repair_proposal", "Current passage-plan structure is missing during replay");
    const source: RuntimeCompileSource = {
      snapshotId: `repair-application:${preview.definitionFingerprint}`,
      structureVersionId,
      startPassageId: effective.bundle.structure.startPassageId,
      passageVersions: effective.bundle.passages.map((passage) => ({ versionId: versionFor("passage", passage.id), ...passage })),
      choiceVersions: effective.bundle.choices.map((choice) => ({ versionId: versionFor("choice", choice.id), ...choice })),
      threadVersionIds: effective.bundle.threads.map((thread) => resultVersions.get(`thread:${thread.id}`)
        ?? base.threads.find((item) => item.content.id === thread.id)?.versionId
        ?? `repair-generated:thread:${thread.id}`),
      routeIds: effective.routes.routes.map((route) => route.id),
      routeDecisionIds: effective.routes.decisionPoints.map((decision) => decision.id),
      endings: effective.endings.endings.map((ending) => ({ id: ending.id, routeId: ending.routeId })),
      mechanics: effective.mechanics,
    };
    const runtime = compileRuntime(source);
    const replayInputFingerprint = stableFingerprint({
      applicationDefinitionFingerprint: preview.definitionFingerprint,
      sourceSimulationInputFingerprint: reference.simulationInputFingerprint,
      runtimeFingerprint: runtime.fingerprint,
    });
    const trace = runDeterministicPath(runtime, replayInputFingerprint, runVersion.content.path);
    const sourceFinding = reference.finding;
    const matching = trace.findings.find((finding) => finding.code === sourceFinding.code
      && (sourceFinding.passageId === undefined || finding.passageId === sourceFinding.passageId)
      && (sourceFinding.choiceId === undefined || finding.choiceId === sourceFinding.choiceId)
      && (sourceFinding.mechanicKey === undefined || finding.mechanicKey === sourceFinding.mechanicKey)
      && (sourceFinding.endingId === undefined || finding.endingId === sourceFinding.endingId));
    return {
      remains: Boolean(matching),
      evidence: {
        sourceRunArtifactVersionId: reference.runArtifactVersionId,
        sourceTraceFingerprint: reference.traceFingerprint,
        sourceFindingId: sourceFinding.id,
        sourceFindingCode: sourceFinding.code,
        replayInputFingerprint,
        replayRuntimeFingerprint: runtime.fingerprint,
        replayTraceFingerprint: trace.fingerprint,
        replayResult: trace.result,
        replayFindingIds: trace.findings.map((finding) => finding.id),
        matchingReplayFindingId: matching?.id ?? null,
      },
    };
  }

  private loadPlanDefinition(proposal: RepairProposalRecord): RepairPlanDefinition {
    const plan = this.planning.get(proposal.projectId, proposal.repairPlanId);
    if (plan.artifactVersionId !== proposal.repairPlanArtifactVersionId
      || plan.definitionFingerprint !== proposal.repairPlanDefinitionFingerprint) {
      throw failure("stale_repair_proposal", "Exact repair plan lineage changed");
    }
    return plan.definition;
  }

  private previewStaleness(projectId: string, operations: RepairProposalOperation[]): string[] {
    const affected = new Set<string>();
    for (const operation of operations) {
      if (["passage", "choice", "thread"].includes(operation.entityKind)) {
        const targetPassageIds = operation.entityKind === "passage" ? [operation.entityId]
          : operation.entityKind === "choice" ? [String((operation.after as Record<string, unknown>).sourcePassageId)]
            : [...((operation.after as Record<string, unknown>).setupPassageIds as string[] ?? []), ...((operation.after as Record<string, unknown>).payoffPassageIds as string[] ?? [])];
        for (const passageId of targetPassageIds) this.drafts.listVersions(projectId, passageId).forEach((draft) => affected.add(`draft:${draft.id}`));
      }
    }
    return [...affected].sort();
  }

  private rawStaleness(projectId: string): Array<{
    id: string; reason_code: string; source_entity_kind: string; source_entity_id: string;
    draft_version_id: string; passage_id: string;
  }> {
    return this.database.prepare(`SELECT id, reason_code, source_entity_kind, source_entity_id, draft_version_id, passage_id
      FROM passage_draft_staleness_events WHERE project_id = ? ORDER BY created_at, id`).all(projectId) as ReturnType<RepairApplicationService["rawStaleness"]>;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw failure("project_not_found", "Long-form project not found");
    return project;
  }
}

function failure(code: string, message: string, details?: unknown): RepairApplicationServiceError {
  return new RepairApplicationServiceError(code, message, details);
}
