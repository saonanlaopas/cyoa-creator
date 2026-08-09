import { createHash } from "node:crypto";
import {
  PassagePlanningUnitCandidateSchema,
  consolidatePassagePlanningCandidates,
  materializePassageProposalOperations,
  passagePlanningCandidateSchema,
  passagePlanningProposalSchema,
  stableJson,
  type PassagePlanBundle,
  type PassagePlanFinding,
  type PassagePlanningContextPack,
  type PassageProposalGroup,
  type PassageProposalOperation,
} from "@story-to-cyoa/pipeline";
import {
  transaction,
  type GenerationRepository,
  type PassagePlanRepository,
  type PassageProposalGroupRecord,
  type PassageProposalOperationRecord,
  type PassageProposalPreviewRecord,
  type PassageProposalRepository,
  type PassageProposalSetRecord,
  type ProjectRepository,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";
import type { PassagePlanService } from "./passage-plan-service.js";

export class PassageProposalServiceError extends Error {
  public constructor(
    message: string,
    public readonly code: "ineligible" | "invalid_selection" | "stale_preview" | "hard_validation" | "not_found",
    public readonly details?: unknown,
  ) { super(message); }
}

export interface PassageProposalReview extends PassageProposalSetRecord {
  applications: ReturnType<PassageProposalRepository["listApplications"]>;
}

export interface PassageProposalValidationPreview extends PassageProposalPreviewRecord {
  hardErrors: PassagePlanFinding[];
  warnings: PassagePlanFinding[];
  stalePreconditions: Array<{
    operationId: string;
    entityKind: string;
    entityId: string;
    expectedVersionId: string | null;
    currentVersionId: string | null;
  }>;
}

const hash = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex");
const findingId = (finding: PassagePlanFinding): string =>
  `${finding.code}:${finding.entityType}:${finding.entityId}`;
const entityKey = (kind: string, id: string) => `${kind}:${id}`;

export class PassageProposalService {
  public constructor(
    private readonly database: StoryDatabase,
    private readonly projects: ProjectRepository,
    private readonly passages: PassagePlanRepository,
    private readonly generations: GenerationRepository,
    private readonly proposals: PassageProposalRepository,
    private readonly passagePlanService: PassagePlanService,
  ) {}

  create(projectId: string, jobId: string): PassageProposalReview {
    this.requireProject(projectId);
    const existing = this.proposals.getByJob(projectId, jobId);
    if (existing) return this.review(existing);
    const job = this.generations.getJob(projectId, jobId);
    if (!job) throw new PassageProposalServiceError("Generation job not found", "not_found");
    if (job.status !== "completed") {
      throw new PassageProposalServiceError(
        `Only a completed generation job can create a full proposal set; current status is ${job.status}`,
        "ineligible",
      );
    }
    const plan = this.generations.getPlan(projectId, job.planId);
    if (!plan || plan.jobId !== job.id || plan.projectId !== projectId) {
      throw new PassageProposalServiceError("Generation plan/job lineage is invalid", "ineligible");
    }
    if (plan.authorizationState !== "authorized"
      || plan.authorizationFingerprint !== plan.fingerprint
      || job.planFingerprint !== plan.fingerprint) {
      throw new PassageProposalServiceError("Generation plan authorization fingerprint is not exact", "ineligible");
    }
    const snapshot = this.passages.getSnapshot(plan.snapshotId);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "approved") {
      throw new PassageProposalServiceError("The generation snapshot is not an approved project snapshot", "ineligible");
    }
    const inputs = job.units.map((unit) => {
      const candidate = unit.candidate;
      if (unit.status !== "completed" || !candidate || unit.candidateReference !== candidate.id) {
        throw new PassageProposalServiceError(`Completed unit ${unit.id} lacks its attached candidate`, "ineligible");
      }
      if (candidate.projectId !== projectId || candidate.planId !== plan.id || candidate.jobId !== job.id
        || candidate.unitId !== unit.id || candidate.inputFingerprint !== unit.inputFingerprint
        || candidate.contextFingerprint !== unit.contextFingerprint) {
        throw new PassageProposalServiceError(`Candidate ${candidate.id} provenance does not match unit ${unit.id}`, "ineligible");
      }
      if (candidate.outputSchemaId !== passagePlanningCandidateSchema.id
        || candidate.outputSchemaVersion !== passagePlanningCandidateSchema.version
        || (candidate.validation as { valid?: unknown })?.valid !== true) {
        throw new PassageProposalServiceError(`Candidate ${candidate.id} did not pass the accepted local schema validation`, "ineligible");
      }
      const content = PassagePlanningUnitCandidateSchema.parse(candidate.content);
      if (content.jobId !== job.id || content.unitId !== unit.id
        || content.inputFingerprint !== unit.inputFingerprint) {
        throw new PassageProposalServiceError(`Candidate ${candidate.id} content identity is not exact`, "ineligible");
      }
      const context = unit.context as PassagePlanningContextPack | undefined;
      if (!context || context.identity.projectId !== projectId || context.identity.snapshotId !== plan.snapshotId
        || context.identity.structureVersionId !== plan.structureVersionId
        || unit.contextDiagnostics === undefined
        || (unit.contextDiagnostics as { contextFingerprint?: string }).contextFingerprint !== unit.contextFingerprint) {
        throw new PassageProposalServiceError(`Unit ${unit.id} does not retain its exact bounded context`, "ineligible");
      }
      return {
        candidateId: candidate.id,
        attemptId: candidate.attemptId,
        unitId: unit.id,
        unitPosition: unit.position,
        inputFingerprint: unit.inputFingerprint,
        contextFingerprint: unit.contextFingerprint!,
        candidate: content,
        context,
      };
    });
    const consolidated = consolidatePassagePlanningCandidates(inputs);
    const current = this.passagePlanService.bundle(projectId);
    const currentHeads = this.currentHeadVersions(projectId);
    const groups = consolidated.groups.map((group) => this.enrichInitialGroup(
      projectId, current, currentHeads, group, consolidated.operations,
    ));
    const proposalId = `pps_${hash({ projectId, jobId, fingerprint: consolidated.consolidationFingerprint }).slice(0, 32)}`;
    const created = this.proposals.create({
      id: proposalId,
      projectId,
      generationPlanId: plan.id,
      generationJobId: job.id,
      generationPlanFingerprint: plan.fingerprint,
      snapshotId: plan.snapshotId,
      proposalSchemaId: passagePlanningProposalSchema.id,
      proposalSchemaVersion: passagePlanningProposalSchema.version,
      candidates: consolidated.candidates,
      consolidationFingerprint: consolidated.consolidationFingerprint,
      groups,
      operations: consolidated.operations,
    });
    return this.review(created);
  }

  list(projectId: string): PassageProposalReview[] {
    this.requireProject(projectId);
    return this.proposals.list(projectId).map((proposal) => this.review(proposal));
  }

  get(projectId: string, proposalId: string): PassageProposalReview {
    this.requireProject(projectId);
    const proposal = this.proposals.get(projectId, proposalId);
    if (!proposal) throw new PassageProposalServiceError("Passage proposal not found", "not_found");
    return this.review(proposal);
  }

  preview(projectId: string, proposalId: string, groupIds: string[]): PassageProposalValidationPreview {
    const proposal = this.get(projectId, proposalId);
    const built = this.buildPreview(projectId, proposal, groupIds);
    const saved = this.proposals.savePreview(built.record);
    return { ...saved, ...built.transient };
  }

  apply(
    projectId: string,
    proposalId: string,
    groupIds: string[],
    previewFingerprint: string,
  ): PassageProposalReview {
    const proposal = this.get(projectId, proposalId);
    const reviewed = this.proposals.getPreview(projectId, proposalId, previewFingerprint);
    if (!reviewed || !reviewed.valid) {
      throw new PassageProposalServiceError("A current successful validation preview is required", "stale_preview");
    }
    const beforeWrite = this.buildPreview(projectId, proposal, groupIds);
    if (!beforeWrite.record.valid || beforeWrite.record.previewFingerprint !== previewFingerprint) {
      throw new PassageProposalServiceError(
        "Proposal impact changed after review; refresh the validation preview before applying",
        "stale_preview",
        beforeWrite.transient,
      );
    }
    transaction(this.database, () => {
      const transactionalProposal = this.proposals.get(projectId, proposalId);
      if (!transactionalProposal) throw new PassageProposalServiceError("Passage proposal not found", "not_found");
      const rechecked = this.buildPreview(projectId, transactionalProposal, groupIds);
      if (!rechecked.record.valid || rechecked.record.previewFingerprint !== previewFingerprint) {
        throw new PassageProposalServiceError(
          "Proposal impact changed before the transaction could apply it",
          "stale_preview",
          rechecked.transient,
        );
      }
      const selected = this.selectGroups(transactionalProposal, groupIds);
      const operations = selected.flatMap((group) => group.operations);
      const previousVersionIds: Record<string, string | null> = {};
      const resultingVersionIds: Record<string, string> = {};
      for (const operation of operations) {
        const key = entityKey(operation.entityKind, operation.entityId);
        const current = this.passages.currentEntity(projectId, operation.entityKind, operation.entityId);
        previousVersionIds[key] = current?.id ?? null;
        if (operation.kind === "update-entity" && current?.id !== operation.baseVersionId) {
          throw new PassageProposalServiceError(`Operation ${operation.id} has a stale base`, "stale_preview");
        }
        if (operation.kind === "add-entity" && current) {
          throw new PassageProposalServiceError(`New entity ${key} now exists`, "stale_preview");
        }
        const version = this.passages.insertEntityVersionInTransaction(
          projectId, operation.entityKind, operation.entityId, operation.after,
        );
        resultingVersionIds[key] = version.id;
      }
      if (operations.length) this.passages.markDraftInTransaction(projectId);
      const now = new Date().toISOString();
      const affectedEntityIds = [...new Set(selected.flatMap((group) => group.affectedEntityIds))].sort();
      const downstreamInvalidations = [...new Set(selected.flatMap((group) => group.downstreamInvalidations))].sort();
      this.proposals.insertApplication({
        projectId,
        proposalId,
        selectedGroupIds: selected.map((group) => group.id),
        appliedOperationIds: operations.map((operation) => operation.id),
        candidateProvenance: transactionalProposal.candidates,
        previousVersionIds,
        resultingVersionIds,
        affectedEntityIds,
        validationPreviewFingerprint: previewFingerprint,
        validation: rechecked.record.validation,
        downstreamInvalidations,
      }, now);
      this.proposals.markGroupsApplied(projectId, proposalId, selected.map((group) => group.id), now);
    });
    return this.get(projectId, proposalId);
  }

  reject(projectId: string, proposalId: string, groupIds: string[]): PassageProposalReview {
    this.get(projectId, proposalId);
    return this.review(this.proposals.rejectGroups(projectId, proposalId, groupIds));
  }

  private buildPreview(
    projectId: string,
    proposal: PassageProposalSetRecord,
    groupIds: string[],
  ): {
    record: Omit<PassageProposalPreviewRecord, "id" | "createdAt">;
    transient: Pick<PassageProposalValidationPreview, "hardErrors" | "warnings" | "stalePreconditions">;
  } {
    const selected = this.selectGroups(proposal, groupIds);
    const operations = selected.flatMap((group) => group.operations);
    const headVersions: Record<string, string | null> = {};
    const stalePreconditions: PassageProposalValidationPreview["stalePreconditions"] = [];
    for (const operation of operations) {
      const key = entityKey(operation.entityKind, operation.entityId);
      const current = this.passages.currentEntity(projectId, operation.entityKind, operation.entityId);
      headVersions[key] = current?.id ?? null;
      const stale = operation.kind === "update-entity"
        ? current?.id !== operation.baseVersionId
        : Boolean(current);
      if (stale) stalePreconditions.push({
        operationId: operation.id, entityKind: operation.entityKind, entityId: operation.entityId,
        expectedVersionId: operation.baseVersionId, currentVersionId: current?.id ?? null,
      });
    }
    let validation: unknown;
    let findings: PassagePlanFinding[] = [];
    if (stalePreconditions.length) {
      validation = { findings: stalePreconditions.map((item) => ({
        code: "proposal.entity-base.stale", severity: "error", entityType: item.entityKind,
        entityId: item.entityId, message: "Proposal operation is based on an older entity version.",
        evidence: [item.expectedVersionId ?? "new", item.currentVersionId ?? "missing"],
        suggestion: "Refresh or recreate the proposal; automatic rebasing is not performed.", acknowledged: false,
      })) };
      findings = (validation as { findings: PassagePlanFinding[] }).findings;
    } else {
      try {
        const materialized = materializePassageProposalOperations(
          this.passagePlanService.bundle(projectId),
          operations.map(toPipelineOperation),
        );
        validation = this.passagePlanService.validate(projectId, materialized);
        findings = (validation as { findings: PassagePlanFinding[] }).findings;
      } catch (error) {
        findings = [{
          code: "proposal.materialization.failed", severity: "error", entityType: "project",
          entityId: "passage-plan", message: (error as Error).message, evidence: [],
          suggestion: "Inspect conflicting proposal operations.", acknowledged: false,
        }];
        validation = { findings };
      }
    }
    const hardErrors = findings.filter((finding) => finding.severity === "error");
    const warnings = findings.filter((finding) => finding.severity === "warning");
    const selectedGroupIds = selected.map((group) => group.id);
    const selectedOperationIds = operations.map((operation) => operation.id);
    const affectedEntityIds = [...new Set(selected.flatMap((group) => group.affectedEntityIds))].sort();
    const downstreamInvalidations = [...new Set(selected.flatMap((group) => group.downstreamInvalidations))].sort();
    const beforeAfter = operations.map((operation) => ({
      operationId: operation.id,
      entityKind: operation.entityKind,
      entityId: operation.entityId,
      fieldDiffs: operation.fieldDiffs,
    }));
    const previewBase = {
      proposalId: proposal.id,
      selectedGroupIds,
      selectedOperationIds,
      headVersions,
      validation,
      affectedEntityIds,
      downstreamInvalidations,
      beforeAfter,
    };
    return {
      record: {
        projectId,
        ...previewBase,
        previewFingerprint: hash(previewBase),
        valid: hardErrors.length === 0 && stalePreconditions.length === 0,
      },
      transient: { hardErrors, warnings, stalePreconditions },
    };
  }

  private selectGroups(proposal: PassageProposalSetRecord, groupIds: string[]): PassageProposalGroupRecord[] {
    const selectedIds = new Set(groupIds);
    if (!selectedIds.size) throw new PassageProposalServiceError("Select at least one proposal group", "invalid_selection");
    const known = new Map(proposal.groups.map((group) => [group.id, group]));
    if ([...selectedIds].some((id) => !known.has(id))) {
      throw new PassageProposalServiceError("Unknown proposal group selected", "invalid_selection");
    }
    const selected = proposal.groups.filter((group) => selectedIds.has(group.id));
    selected.forEach((group) => {
      if (group.status !== "proposed") {
        throw new PassageProposalServiceError(`Proposal group ${group.id} is ${group.status}`, "invalid_selection");
      }
      group.dependsOnGroupIds.forEach((dependencyId) => {
        const dependency = known.get(dependencyId);
        if (!dependency || (!selectedIds.has(dependencyId) && dependency.status !== "applied")) {
          throw new PassageProposalServiceError(
            `Proposal group ${group.id} requires dependency ${dependencyId}`,
            "invalid_selection",
          );
        }
      });
    });
    return selected;
  }

  private enrichInitialGroup(
    projectId: string,
    bundle: PassagePlanBundle,
    headVersions: Record<string, string | null>,
    group: PassageProposalGroup,
    operations: PassageProposalOperation[],
  ): Omit<PassageProposalGroupRecord, "status" | "operations" | "createdAt" | "updatedAt"> {
    const selected = operations.filter((operation) => group.operationIds.includes(operation.id));
    const basesCurrent = selected.every((operation) =>
      (headVersions[entityKey(operation.entityKind, operation.entityId)] ?? null) === operation.baseVersionId);
    let findings: PassagePlanFinding[] = [];
    if (basesCurrent && group.dependsOnGroupIds.length === 0) {
      try {
        const materialized = materializePassageProposalOperations(bundle, selected);
        findings = this.passagePlanService.validate(projectId, materialized).findings;
      } catch {
        findings = [];
      }
    }
    const affectedIds = new Set(group.affectedEntityIds.map((item) => item.slice(item.indexOf(":") + 1)));
    const relevantFindingIds = findings.filter((finding) =>
      affectedIds.has(finding.entityId) || finding.evidence.some((item) => affectedIds.has(item)))
      .map(findingId).sort();
    return {
      id: group.id,
      unitId: group.unitId,
      position: group.position,
      label: group.label,
      summary: group.summary,
      operationIds: group.operationIds,
      dependsOnGroupIds: group.dependsOnGroupIds,
      affectedEntityIds: group.affectedEntityIds,
      downstreamInvalidations: group.downstreamInvalidations,
      validationFindingIds: relevantFindingIds,
      safeToApplyIndependently: basesCurrent && group.dependsOnGroupIds.length === 0
        && findings.every((finding) => finding.severity !== "error"),
    };
  }

  private currentHeadVersions(projectId: string): Record<string, string | null> {
    return Object.fromEntries((["passage", "choice", "thread"] as const).flatMap((kind) =>
      this.passages.currentEntities(projectId, kind).map((item) => [entityKey(kind, item.entityId), item.id])));
  }

  private review(proposal: PassageProposalSetRecord): PassageProposalReview {
    return { ...proposal, applications: this.proposals.listApplications(proposal.projectId, proposal.id) };
  }

  private requireProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") {
      throw new PassageProposalServiceError("Long-form project not found", "not_found");
    }
  }
}

function toPipelineOperation(operation: PassageProposalOperationRecord): PassageProposalOperation {
  return {
    id: operation.id,
    kind: operation.kind,
    entityKind: operation.entityKind,
    entityId: operation.entityId,
    baseVersionId: operation.baseVersionId,
    before: operation.before as PassageProposalOperation["before"],
    after: operation.after as PassageProposalOperation["after"],
    fieldDiffs: operation.fieldDiffs as PassageProposalOperation["fieldDiffs"],
    sourceCandidateIds: operation.sourceCandidateIds,
  };
}
