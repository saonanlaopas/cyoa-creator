import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  ProjectBriefSchema,
  defaultLongFormEndingPlan,
  defaultLongFormMechanicsPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
  applyPlanningOperations,
  planningArtifactIds,
  validateLongFormProject,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormProjectSnapshot,
  type LongFormRoutePlan,
  type LongFormStoryBible,
  type PlanningArtifact,
  type PlanningArtifactId,
  type PlanningFinding,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  ArtifactVersion,
  ChangeSetRepository,
  PassagePlanRepository,
  PassageDraftRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";

const prerequisites: Record<PlanningArtifactId, PlanningArtifactId[]> = {
  brief: [],
  bible: ["brief"],
  routes: ["brief", "bible"],
  endings: ["routes"],
  mechanics: ["bible", "routes", "endings"],
};

const dependencies: Record<PlanningArtifactId, string[]> = {
  brief: ["source"],
  bible: ["brief", "source"],
  routes: ["brief", "bible"],
  endings: ["routes"],
  mechanics: ["bible", "routes", "endings"],
};

const schemas = {
  brief: ProjectBriefSchema,
  bible: LongFormStoryBibleSchema,
  routes: LongFormRoutePlanSchema,
  endings: LongFormEndingPlanSchema,
  mechanics: LongFormMechanicsPlanSchema,
};

export class LongFormProjectService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly changeSets?: ChangeSetRepository,
    private readonly passagePlans?: PassagePlanRepository,
    private readonly passageDrafts?: PassageDraftRepository,
  ) {}

  project(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }

  createProject(name: string) {
    const project = this.projects.create(name, undefined, "long-form");
    const brief = this.artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "brief",
      artifactType: "brief",
      schema: ProjectBriefSchema,
      content: defaultProjectBrief(project.name),
      dependencies: dependencies.brief,
    });
    return { project, brief, workflow: this.workflow.markDraft(project.id, "brief") };
  }

  getState(projectId: string) {
    const project = this.project(projectId);
    const brief = this.artifacts.getCurrent<ProjectBrief>(projectId, "brief");
    if (!brief) throw new Error("Project brief not found");
    const bible = this.artifacts.getCurrent<LongFormStoryBible>(projectId, "bible") ?? null;
    const routes = this.artifacts.getCurrent<LongFormRoutePlan>(projectId, "routes") ?? null;
    const endings = this.artifacts.getCurrent<LongFormEndingPlan>(projectId, "endings") ?? null;
    const mechanics = this.artifacts.getCurrent<LongFormMechanicsPlan>(projectId, "mechanics") ?? null;
    const snapshot = {
      brief: brief.content,
      bible: bible?.content ?? null,
      routes: routes?.content ?? null,
      endings: endings?.content ?? null,
      mechanics: mechanics?.content ?? null,
    };
    return {
      project, brief, bible, routes, endings, mechanics,
      workflow: Object.fromEntries(planningArtifactIds.map((id) => [id, this.workflow.get(projectId, id)])),
      validation: validateLongFormProject(snapshot),
    };
  }

  snapshot(projectId: string, override?: {
    artifactId: PlanningArtifactId;
    content: PlanningArtifact;
  }): LongFormProjectSnapshot {
    this.project(projectId);
    const content = <T extends PlanningArtifact>(artifactId: PlanningArtifactId): T | null => {
      if (override?.artifactId === artifactId) return override.content as T;
      return this.artifacts.getCurrent<T>(projectId, artifactId)?.content ?? null;
    };
    return {
      brief: content<ProjectBrief>("brief"),
      bible: content<LongFormStoryBible>("bible"),
      routes: content<LongFormRoutePlan>("routes"),
      endings: content<LongFormEndingPlan>("endings"),
      mechanics: content<LongFormMechanicsPlan>("mechanics"),
    };
  }

  createArtifact(projectId: string, artifactId: Exclude<PlanningArtifactId, "brief">) {
    this.project(projectId);
    if (this.artifacts.getCurrent(projectId, artifactId)) throw new Error(`${artifactId} already exists`);
    this.requireApprovedPrerequisites(projectId, artifactId);
    const brief = this.approved<ProjectBrief>(projectId, "brief");
    const bible = this.approved<LongFormStoryBible>(projectId, "bible");
    const routes = this.approved<LongFormRoutePlan>(projectId, "routes");
    const endings = this.approved<LongFormEndingPlan>(projectId, "endings");
    const content = artifactId === "bible"
      ? defaultLongFormStoryBible({
          title: brief!.content.workingTitle,
          overview: brief!.content.premise,
          protagonist: brief!.content.protagonist,
          pointOfView: brief!.content.pointOfView,
          tone: brief!.content.tone,
        })
      : artifactId === "routes"
        ? defaultLongFormRoutePlan(brief!.content)
        : artifactId === "endings"
          ? defaultLongFormEndingPlan(routes!.content)
          : defaultLongFormMechanicsPlan(bible!.content, endings!.content);
    return this.saveNew(projectId, artifactId, content);
  }

  saveArtifact(projectId: string, artifactId: PlanningArtifactId, content: unknown) {
    this.project(projectId);
    if (!this.artifacts.getCurrent(projectId, artifactId)) throw new Error(`Create ${artifactId} first`);
    const parsed = schemas[artifactId].parse(content) as PlanningArtifact;
    const version = this.artifacts.saveArtifact({
      projectId,
      artifactId,
      artifactType: artifactId,
      schema: schemas[artifactId] as never,
      content: parsed as never,
      dependencies: dependencies[artifactId],
    }) as ArtifactVersion<PlanningArtifact>;
    this.markDraftAndDependents(projectId, artifactId);
    this.markPassagePlanStale(projectId);
    return {
      artifact: version,
      workflow: this.workflow.get(projectId, artifactId),
      validation: validateLongFormProject(this.snapshot(projectId)),
    };
  }

  approveArtifact(projectId: string, artifactId: PlanningArtifactId, versionId: string) {
    this.project(projectId);
    this.requireApprovedPrerequisites(projectId, artifactId);
    const version = this.artifacts.getVersion<PlanningArtifact>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== artifactId) {
      throw new Error("Artifact version not found");
    }
    const snapshot = this.snapshot(projectId, { artifactId, content: version.content });
    const findings = validateLongFormProject(snapshot);
    const errors = findings.filter((finding) =>
      finding.severity === "error" && finding.artifactId === artifactId);
    if (errors.length) {
      const error = new Error(errors.map((finding) => finding.message).join(" "));
      Object.assign(error, { findings });
      throw error;
    }
    const approved = this.workflow.approve(projectId, artifactId, versionId);
    this.passageDrafts?.markStaleForUpstreamVersion(projectId, artifactId, versionId);
    return approved;
  }

  restoreArtifact(projectId: string, artifactId: string, versionId: string) {
    this.project(projectId);
    if (!planningArtifactIds.includes(artifactId as PlanningArtifactId)) {
      throw new Error("Planning artifact not found");
    }
    const id = artifactId as PlanningArtifactId;
    const version = this.artifacts.restore(projectId, id, versionId);
    this.markDraftAndDependents(projectId, id);
    this.markPassagePlanStale(projectId);
    return {
      version,
      workflow: this.workflow.get(projectId, id),
      validation: validateLongFormProject(this.snapshot(projectId)),
    };
  }

  applyProposal(projectId: string, proposalId: string, groupIds?: string[]) {
    if (!this.changeSets) throw new Error("Change-set service unavailable");
    this.project(projectId);
    const changeSet = this.changeSets.get(proposalId);
    if (!changeSet || changeSet.projectId !== projectId || !changeSet.proposal) {
      throw new Error("Proposal not found");
    }
    const artifactId = changeSet.artifactId as PlanningArtifactId;
    const proposal = changeSet.proposal as { groups: Array<{
      id: string; dependsOnGroupIds: string[]; safeToApplyIndependently: boolean;
    }> };
    const selectedIds = new Set(groupIds?.length ? groupIds : proposal.groups.map((group) => group.id));
    const knownIds = new Set(proposal.groups.map((group) => group.id));
    if ([...selectedIds].some((id) => !knownIds.has(id))) throw new Error("Unknown proposal group selected");
    const groups = proposal.groups.filter((group) => selectedIds.has(group.id));
    if (!groups.length) throw new Error("Select at least one proposal group");
    if (groups.length !== proposal.groups.length && groups.some((group) => !group.safeToApplyIndependently)) {
      throw new Error("The selected proposal group is not safe to apply independently");
    }
    for (const group of groups) {
      if (group.dependsOnGroupIds.some((id) => !selectedIds.has(id))) {
        throw new Error(`Proposal group ${group.id} requires its dependency groups`);
      }
    }
    const base = this.artifacts.getVersion<PlanningArtifact>(changeSet.baseVersionId);
    const current = this.artifacts.getCurrent<PlanningArtifact>(projectId, artifactId);
    if (!base || !current || current.id !== base.id) {
      this.changeSets.markSuperseded(proposalId);
      throw new Error("PROPOSAL_BASE_STALE");
    }
    const candidate = applyPlanningOperations(current.content, groups as never);
    const parsed = schemas[artifactId].parse(candidate) as PlanningArtifact;
    const findings = validateLongFormProject(this.snapshot(projectId, { artifactId, content: parsed }));
    const errors = findings.filter((finding) =>
      finding.severity === "error" && finding.artifactId === artifactId);
    if (errors.length) {
      const error = new Error(errors.map((finding) => finding.message).join(" "));
      Object.assign(error, { findings });
      throw error;
    }
    const applied = this.changeSets.applyPrepared(
      proposalId,
      parsed as never,
      schemas[artifactId] as never,
      dependencies[artifactId],
    );
    this.markDependentWorkflowStale(projectId, artifactId);
    this.markPassagePlanStale(projectId);
    return { ...applied, validation: findings, appliedGroupIds: [...selectedIds] };
  }

  private saveNew(projectId: string, artifactId: Exclude<PlanningArtifactId, "brief">, content: PlanningArtifact) {
    const version = this.artifacts.saveArtifact({
      projectId, artifactId, artifactType: artifactId,
      schema: schemas[artifactId] as never, content: content as never,
      dependencies: dependencies[artifactId],
    }) as ArtifactVersion<PlanningArtifact>;
    return {
      artifact: version,
      workflow: this.workflow.markDraft(projectId, artifactId),
      validation: validateLongFormProject(this.snapshot(projectId)),
    };
  }

  private approved<T extends PlanningArtifact>(
    projectId: string,
    artifactId: PlanningArtifactId,
  ): ArtifactVersion<T> | undefined {
    const state = this.workflow.get(projectId, artifactId);
    return state.approvedVersionId ? this.artifacts.getVersion<T>(state.approvedVersionId) : undefined;
  }

  private requireApprovedPrerequisites(projectId: string, artifactId: PlanningArtifactId): void {
    const missing = prerequisites[artifactId].filter((dependency) => {
      const state = this.workflow.get(projectId, dependency);
      return state.status !== "approved" || !state.approvedVersionId;
    });
    if (missing.length) throw new Error(`Approve ${missing.join(", ")} first`);
  }

  private markDraftAndDependents(projectId: string, artifactId: PlanningArtifactId): void {
    this.workflow.markDraft(projectId, artifactId);
    this.markDependentWorkflowStale(projectId, artifactId);
  }

  private markDependentWorkflowStale(projectId: string, artifactId: PlanningArtifactId): void {
    this.artifacts.markDependentsStale(projectId, artifactId)
      .forEach((dependent) => this.workflow.markStale(projectId, dependent));
  }

  private markPassagePlanStale(projectId: string): void {
    if (this.passagePlans?.currentStructure(projectId)) this.passagePlans.markStale(projectId);
  }
}

export function findingsFromError(error: unknown): PlanningFinding[] | undefined {
  return (error as { findings?: PlanningFinding[] }).findings;
}
