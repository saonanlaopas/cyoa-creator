import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  ProjectBriefSchema,
  CreativeDirectionSchema,
  CREATIVE_DIRECTION_LIMITS,
  defaultCreativeDirection,
  normalizeCreativeDirection,
  selectCreativeDirectionContext,
  creativeDirectionReferenceIssues,
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
  type CreativeDirection,
  type CreativeDirectionInput,
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
  "creative-direction": [],
  bible: ["brief"],
  routes: ["brief", "bible"],
  endings: ["routes"],
  mechanics: ["bible", "routes", "endings"],
};

const dependencies: Record<PlanningArtifactId, string[]> = {
  brief: ["source"],
  "creative-direction": ["brief"],
  bible: ["brief", "source"],
  routes: ["brief", "bible"],
  endings: ["routes"],
  mechanics: ["bible", "routes", "endings"],
};

const schemas = {
  brief: ProjectBriefSchema,
  "creative-direction": CreativeDirectionSchema,
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
    const creativeDirection = this.artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "creative-direction",
      artifactType: "creative-direction",
      schema: CreativeDirectionSchema,
      content: defaultCreativeDirection(brief.content.pointOfView),
      dependencies: dependencies["creative-direction"],
      markDependentsStale: false,
    });
    return {
      project, brief, creativeDirection,
      workflow: this.workflow.markDraft(project.id, "brief"),
      creativeDirectionWorkflow: this.workflow.markDraft(project.id, "creative-direction"),
    };
  }

  getState(projectId: string) {
    const project = this.project(projectId);
    const brief = this.artifacts.getCurrent<ProjectBrief>(projectId, "brief");
    if (!brief) throw new Error("Project brief not found");
    const bible = this.artifacts.getCurrent<LongFormStoryBible>(projectId, "bible") ?? null;
    const creativeDirection = this.artifacts.getCurrent<CreativeDirection>(projectId, "creative-direction") ?? null;
    const routes = this.artifacts.getCurrent<LongFormRoutePlan>(projectId, "routes") ?? null;
    const endings = this.artifacts.getCurrent<LongFormEndingPlan>(projectId, "endings") ?? null;
    const mechanics = this.artifacts.getCurrent<LongFormMechanicsPlan>(projectId, "mechanics") ?? null;
    const snapshot = {
      brief: brief.content,
      "creative-direction": creativeDirection?.content ?? null,
      bible: bible?.content ?? null,
      routes: routes?.content ?? null,
      endings: endings?.content ?? null,
      mechanics: mechanics?.content ?? null,
    };
    return {
      project, brief, creativeDirection, bible, routes, endings, mechanics,
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
      "creative-direction": content<CreativeDirection>("creative-direction"),
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
    const content = artifactId === "creative-direction"
      ? defaultCreativeDirection(brief!.content.pointOfView)
      : artifactId === "bible"
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
    if (artifactId === "creative-direction") return this.saveCreativeDirection(projectId, content);
    const parsed = schemas[artifactId].parse(content) as PlanningArtifact;
    this.assertPresentationAuthorityWrite(projectId, artifactId, parsed);
    const version = this.artifacts.saveArtifact({
      projectId,
      artifactId,
      artifactType: artifactId,
      schema: schemas[artifactId] as never,
      content: parsed as never,
      dependencies: this.dependenciesFor(projectId, artifactId),
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
    if (artifactId === "creative-direction") {
      this.validateCreativeDirectionScopes(projectId, version.content as CreativeDirection, true);
    } else if (artifactId === "bible" || artifactId === "routes") {
      this.validateApprovedDirectionAgainstUpstreamCandidate(projectId, artifactId, version.content);
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
    const priorApprovedId = this.workflow.get(projectId, artifactId).approvedVersionId;
    const priorApproved = priorApprovedId ? this.artifacts.getVersion<PlanningArtifact>(priorApprovedId) : undefined;
    const approved = this.workflow.approve(projectId, artifactId, versionId);
    const materialChanged = artifactId !== "creative-direction"
      || !priorApproved
      || (priorApproved.content as CreativeDirection).materialFingerprint !== (version.content as CreativeDirection).materialFingerprint;
    if (materialChanged) {
      this.passageDrafts?.markStaleForUpstreamVersion(projectId, artifactId, versionId);
      if (artifactId === "creative-direction") {
        if (this.artifacts.getCurrent(projectId, "bible")) {
          this.artifacts.markCurrentStale(projectId, "bible");
          this.workflow.markStale(projectId, "bible");
        }
        this.markPassagePlanStale(projectId);
      }
    }
    return approved;
  }

  restoreArtifact(projectId: string, artifactId: string, versionId: string) {
    this.project(projectId);
    if (!planningArtifactIds.includes(artifactId as PlanningArtifactId)) {
      throw new Error("Planning artifact not found");
    }
    const id = artifactId as PlanningArtifactId;
    const source = this.artifacts.getVersion<PlanningArtifact>(versionId);
    if (!source || source.projectId !== projectId || source.artifactId !== id) {
      throw new Error("Artifact version not found");
    }
    this.assertPresentationAuthorityWrite(projectId, id, source.content);
    const version = this.artifacts.restore(projectId, id, versionId, {
      markDependentsStale: id !== "creative-direction",
    });
    if (id === "creative-direction") this.workflow.markDraft(projectId, id);
    else {
      this.markDraftAndDependents(projectId, id);
      this.markPassagePlanStale(projectId);
    }
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
    this.assertPresentationAuthorityWrite(projectId, artifactId, parsed);
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

  assertPresentationAuthorityWrite(
    projectId: string,
    artifactId: PlanningArtifactId,
    candidate: PlanningArtifact,
  ): void {
    if (!this.artifacts.getCurrent(projectId, "creative-direction")) return;
    if (artifactId === "brief") {
      const current = this.artifacts.getCurrent<ProjectBrief>(projectId, "brief");
      const next = candidate as ProjectBrief;
      if (current && (next.tone !== current.content.tone || next.pointOfView !== current.content.pointOfView)) {
        throw new Error("Creative Direction owns current tone and point of view; legacy Brief presentation fields are historical and cannot be changed");
      }
    }
    if (artifactId === "bible") {
      const current = this.artifacts.getCurrent<LongFormStoryBible>(projectId, "bible");
      const next = candidate as LongFormStoryBible;
      if (current && JSON.stringify(next.proseGuidance) !== JSON.stringify(current.content.proseGuidance)) {
        throw new Error("Creative Direction owns current prose presentation; legacy Story Bible prose guidance is historical and cannot be changed");
      }
    }
  }

  private saveNew(projectId: string, artifactId: Exclude<PlanningArtifactId, "brief">, content: PlanningArtifact) {
    const version = this.artifacts.saveArtifact({
      projectId, artifactId, artifactType: artifactId,
      schema: schemas[artifactId] as never, content: content as never,
      dependencies: this.dependenciesFor(projectId, artifactId),
      markDependentsStale: artifactId !== "creative-direction",
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
    const required = [...prerequisites[artifactId]];
    const missing = required.filter((dependency) => {
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

  private dependenciesFor(projectId: string, artifactId: PlanningArtifactId): string[] {
    return artifactId === "bible" && this.artifacts.getCurrent(projectId, "creative-direction")
      ? [...dependencies.bible, "creative-direction"]
      : dependencies[artifactId];
  }

  private saveCreativeDirection(projectId: string, content: unknown) {
    const current = this.artifacts.getCurrent<CreativeDirection>(projectId, "creative-direction");
    if (!current) throw new Error("Create creative-direction first");
    const raw = content && typeof content === "object" && !Array.isArray(content)
      ? content as Record<string, unknown> : {};
    const { materialFingerprint: _material, provenanceFingerprint: _provenance, ...withoutFingerprints } = raw;
    const parsed = normalizeCreativeDirection(withoutFingerprints as CreativeDirectionInput);
    this.validateCreativeDirectionIdentityTransition(current.content, parsed);
    this.validateCreativeDirectionScopes(projectId, parsed, false);
    const version = this.artifacts.saveArtifact({
      projectId, artifactId: "creative-direction", artifactType: "creative-direction",
      schema: CreativeDirectionSchema, content: parsed,
      dependencies: dependencies["creative-direction"], markDependentsStale: false,
    });
    this.workflow.markDraft(projectId, "creative-direction");
    return {
      artifact: version,
      workflow: this.workflow.get(projectId, "creative-direction"),
      validation: validateLongFormProject(this.snapshot(projectId)),
    };
  }

  adoptLegacyCreativeDirection(projectId: string) {
    this.project(projectId);
    if (this.artifacts.getCurrent(projectId, "creative-direction")) throw new Error("Creative Direction already exists");
    const brief = this.artifacts.getCurrent<ProjectBrief>(projectId, "brief");
    if (!brief) throw new Error("Project brief not found");
    const bible = this.artifacts.getCurrent<LongFormStoryBible>(projectId, "bible");
    const briefTone = brief.content.tone.trim();
    const bibleTones = bible?.content.proseGuidance.tone ?? [];
    const briefPov = brief.content.pointOfView;
    const biblePov = bible?.content.proseGuidance.pointOfView.trim() ?? "";
    const normalizedBiblePov = biblePov.includes("first") ? "first-person"
      : biblePov.includes("second") ? "second-person"
        : biblePov.includes("third") ? "third-person" : null;
    const conflicts: string[] = [];
    if (briefTone && bibleTones.length && !bibleTones.some((tone) => tone.toLowerCase() === briefTone.toLowerCase())) {
      conflicts.push("Brief tone and Bible prose tone differ; both were retained for review.");
    }
    if (normalizedBiblePov && normalizedBiblePov !== briefPov) {
      conflicts.push("Brief and Bible point of view differ; mixed POV was selected for explicit review.");
    }
    const sources = [brief, ...(bible ? [bible] : [])];
    const fieldProvenance = sources.flatMap((source) => [{
      fieldPath: source.artifactId === "brief" ? "/tone" : "/prose",
      reference: {
        kind: "migration-derived" as const,
        targetId: source.artifactId,
        versionId: source.id,
        excerpt: source.artifactId === "brief" ? "Legacy Project Brief presentation fields" : "Legacy Story Bible prose guidance",
      },
    }]);
    const direction = normalizeCreativeDirection({
      schemaId: "cyoa.creative-direction", schemaVersion: 1,
      tone: { descriptors: [briefTone, ...bibleTones].filter(Boolean) },
      pacing: {},
      prose: {
        pointOfView: normalizedBiblePov && normalizedBiblePov !== briefPov ? "mixed"
          : briefPov === "third-person" ? "third-person-close" : briefPov,
        voiceDescriptors: bible?.content.proseGuidance.style ?? [],
        avoid: bible?.content.proseGuidance.avoid ?? [],
      },
      scopedVariations: [], fieldProvenance,
    });
    const artifact = this.artifacts.saveArtifact({
      projectId, artifactId: "creative-direction", artifactType: "creative-direction",
      schema: CreativeDirectionSchema, content: direction,
      dependencies: dependencies["creative-direction"], markDependentsStale: false,
    });
    return { artifact, workflow: this.workflow.markDraft(projectId, "creative-direction"), conflicts };
  }

  creativeDirectionContext(projectId: string) {
    const approvedId = this.workflow.get(projectId, "creative-direction").approvedVersionId;
    if (!approvedId) throw new Error("Approve Creative Direction first");
    const artifact = this.artifacts.getVersion<CreativeDirection>(approvedId);
    if (!artifact || artifact.projectId !== projectId || artifact.artifactId !== "creative-direction") {
      throw new Error("Approved Creative Direction not found");
    }
    this.validateCreativeDirectionScopes(projectId, artifact.content, true);
    const selected = selectCreativeDirectionContext(artifact.content);
    return { artifact, context: selected.context, diagnostics: {
      artifactVersionId: artifact.id,
      materialFingerprint: artifact.content.materialFingerprint,
      provenanceFingerprint: artifact.content.provenanceFingerprint,
      ...selected.diagnostics,
      hardLimits: CREATIVE_DIRECTION_LIMITS,
    } };
  }

  private validateCreativeDirectionIdentityTransition(current: CreativeDirection, next: CreativeDirection): void {
    const rejectRename = (label: string, before: string[], after: string[]) => {
      const prior = new Set(before); const following = new Set(after);
      const removed = before.filter((id) => !following.has(id));
      const added = after.filter((id) => !prior.has(id));
      if (removed.length && added.length) {
        throw new Error(`${label} stable IDs cannot be renamed in place; save the removal before adding the replacement`);
      }
    };
    rejectRename("Relationship profile",
      current.relationshipPresentation?.profiles.map((item) => item.id) ?? [],
      next.relationshipPresentation?.profiles.map((item) => item.id) ?? []);
    rejectRename("Scoped variation", current.scopedVariations.map((item) => item.id), next.scopedVariations.map((item) => item.id));
  }

  private approvedContent<T>(projectId: string, artifactId: PlanningArtifactId): T | undefined {
    const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
    const version = versionId ? this.artifacts.getVersion<T>(versionId) : undefined;
    return version?.projectId === projectId && version.artifactId === artifactId ? version.content : undefined;
  }

  private validateCreativeDirectionScopes(projectId: string, direction: CreativeDirection, requireResolved: boolean): void {
    const bible = this.approvedContent<LongFormStoryBible>(projectId, "bible");
    const routes = this.approvedContent<LongFormRoutePlan>(projectId, "routes");
    const issues = creativeDirectionReferenceIssues(direction, {
      ...(bible || requireResolved ? {
        characterIds: bible?.characters.map((item) => item.id) ?? [],
        relationships: bible?.relationships.map((item) => ({ id: item.id, characterIds: item.characterIds })) ?? [],
      } : {}),
      ...(routes || requireResolved ? {
        routeIds: routes?.routes.map((item) => item.id) ?? [],
        acts: routes?.acts.map((item) => ({ id: item.id, routeId: item.routeId })) ?? [],
      } : {}),
    });
    if (issues.length) throw new Error(issues.join("; "));
  }

  private validateApprovedDirectionAgainstUpstreamCandidate(
    projectId: string,
    artifactId: "bible" | "routes",
    content: PlanningArtifact,
  ): void {
    const approvedDirectionId = this.workflow.get(projectId, "creative-direction").approvedVersionId;
    const direction = approvedDirectionId
      ? this.artifacts.getVersion<CreativeDirection>(approvedDirectionId)?.content : undefined;
    if (!direction) return;
    const bible = artifactId === "bible"
      ? content as LongFormStoryBible : this.approvedContent<LongFormStoryBible>(projectId, "bible");
    const routes = artifactId === "routes"
      ? content as LongFormRoutePlan : this.approvedContent<LongFormRoutePlan>(projectId, "routes");
    const issues = creativeDirectionReferenceIssues(direction, {
      characterIds: bible?.characters.map((item) => item.id) ?? [],
      relationships: bible?.relationships.map((item) => ({ id: item.id, characterIds: item.characterIds })) ?? [],
      routeIds: routes?.routes.map((item) => item.id) ?? [],
      acts: routes?.acts.map((item) => ({ id: item.id, routeId: item.routeId })) ?? [],
    });
    if (issues.length) {
      throw new Error(`This approval would invalidate approved Creative Direction scopes. ${issues.join("; ")}`);
    }
  }
}

export function findingsFromError(error: unknown): PlanningFinding[] | undefined {
  return (error as { findings?: PlanningFinding[] }).findings;
}
