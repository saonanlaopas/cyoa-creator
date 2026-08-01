import {
  ChoicePlanSchema,
  NarrativeThreadSchema,
  PassagePlanBundleSchema,
  PassagePlanSchema,
  PassageStructureSchema,
  defaultPassagePlanBundle,
  validatePassagePlan,
  type ChoicePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormRoutePlan,
  type LongFormStoryBible,
  type PassagePlan,
  type PassagePlanBundle,
  type PassageStructure,
  type NarrativeThread,
  type PassageValidationReport,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  PassageEntityKind,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";

const schemas = {
  passage: PassagePlanSchema,
  choice: ChoicePlanSchema,
  thread: NarrativeThreadSchema,
};
type EntityByKind = { passage: PassagePlan; choice: ChoicePlan; thread: NarrativeThread };

export class PassagePlanService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly repository: PassagePlanRepository,
  ) {}

  create(projectId: string) {
    this.requireProject(projectId);
    if (this.repository.currentStructure(projectId)) throw new Error("Passage plan already exists");
    const brief = this.approved<ProjectBrief>(projectId, "brief");
    const routes = this.approved<LongFormRoutePlan>(projectId, "routes");
    const endings = this.approved<LongFormEndingPlan>(projectId, "endings");
    const mechanics = this.approved<LongFormMechanicsPlan>(projectId, "mechanics");
    if (!brief || !routes || !endings || !mechanics) {
      throw new Error("Approve brief, routes, endings, and mechanics first");
    }
    const bundle = defaultPassagePlanBundle(brief.content, routes.content, endings.content);
    this.repository.initialize(projectId, bundle.structure, [
      ...bundle.passages.map((content) => ({ kind: "passage" as const, id: content.id, content })),
      ...bundle.choices.map((content) => ({ kind: "choice" as const, id: content.id, content })),
      ...bundle.threads.map((content) => ({ kind: "thread" as const, id: content.id, content })),
    ]);
    return this.getState(projectId);
  }

  getState(projectId: string) {
    this.requireProject(projectId);
    const structure = this.repository.currentStructure<PassageStructure>(projectId);
    if (!structure) return {
      structure: null, passages: [], choices: [], threads: [], state: this.repository.state(projectId),
      snapshots: [], report: null, versions: { passages: {}, choices: {}, threads: {} },
    };
    const passages = this.repository.currentEntities<PassagePlan>(projectId, "passage");
    const choices = this.repository.currentEntities<ChoicePlan>(projectId, "choice");
    const threads = this.repository.currentEntities<NarrativeThread>(projectId, "thread");
    const bundle = PassagePlanBundleSchema.parse({
      structure: structure.content,
      passages: passages.map((item) => item.content),
      choices: choices.map((item) => item.content),
      threads: threads.map((item) => item.content),
    });
    return {
      structure,
      passages,
      choices,
      threads,
      state: this.repository.state(projectId),
      snapshots: this.repository.listSnapshots(projectId),
      report: this.validate(projectId, bundle),
    };
  }

  bundle(projectId: string): PassagePlanBundle {
    this.requireProject(projectId);
    const structure = this.repository.currentStructure<PassageStructure>(projectId);
    if (!structure) throw new Error("Passage plan not found");
    return PassagePlanBundleSchema.parse({
      structure: structure.content,
      passages: this.repository.currentEntities<PassagePlan>(projectId, "passage").map((item) => item.content),
      choices: this.repository.currentEntities<ChoicePlan>(projectId, "choice").map((item) => item.content),
      threads: this.repository.currentEntities<NarrativeThread>(projectId, "thread").map((item) => item.content),
    });
  }

  portableBundle(projectId: string) {
    const project = this.requireProject(projectId);
    const artifactIds = ["brief", "bible", "routes", "endings", "mechanics"];
    const planningArtifacts = Object.fromEntries(artifactIds.map((artifactId) => {
      const current = this.artifacts.getCurrent(projectId, artifactId);
      const approvedVersionId = this.workflow.get(projectId, artifactId).approvedVersionId;
      return [artifactId, {
        current,
        approved: approvedVersionId ? this.artifacts.getVersion(approvedVersionId) : null,
      }];
    }));
    return {
      manifest: {
        format: "story-to-cyoa-portable-project",
        schemaVersion: 1,
        sourceBodiesIncluded: false,
        conversationsIncluded: false,
      },
      project,
      planningArtifacts,
      passagePlan: {
        state: this.repository.state(projectId),
        current: this.bundle(projectId),
        structureVersions: this.repository.listStructureVersions(projectId),
        entityVersions: this.repository.listAllEntityVersions(projectId),
        snapshots: this.repository.listSnapshots(projectId),
        validation: this.validate(projectId),
      },
    };
  }

  saveStructure(projectId: string, content: unknown) {
    this.requireProject(projectId);
    const structure = PassageStructureSchema.parse(content);
    const saved = this.repository.saveStructure(projectId, structure);
    return { structure: saved, report: this.validate(projectId) };
  }

  saveBundle(projectId: string, content: unknown) {
    this.requireProject(projectId);
    const bundle = PassagePlanBundleSchema.parse(content);
    this.repository.saveBundle(projectId, bundle.structure, [
      ...bundle.passages.map((item) => ({ kind: "passage" as const, id: item.id, content: item })),
      ...bundle.choices.map((item) => ({ kind: "choice" as const, id: item.id, content: item })),
      ...bundle.threads.map((item) => ({ kind: "thread" as const, id: item.id, content: item })),
    ], {
      passage: new Set(bundle.passages.map((item) => item.id)),
      choice: new Set(bundle.choices.map((item) => item.id)),
      thread: new Set(bundle.threads.map((item) => item.id)),
    });
    return this.getState(projectId);
  }

  saveEntity<K extends PassageEntityKind>(projectId: string, kind: K, entityId: string, content: unknown) {
    this.requireProject(projectId);
    const parsed = schemas[kind].parse(content) as EntityByKind[K];
    if (parsed.id !== entityId) throw new Error("Stable entity ID cannot be changed");
    const saved = this.repository.saveEntity(projectId, kind, entityId, parsed);
    return { entity: saved, report: this.validate(projectId) };
  }

  saveEntities(projectId: string, inputs: Array<{ kind: PassageEntityKind; id: string; content: unknown }>) {
    this.requireProject(projectId);
    const seen = new Set<string>();
    const parsed = inputs.map((input) => {
      const key = `${input.kind}:${input.id}`;
      if (seen.has(key)) throw new Error(`Duplicate bulk target ${key}`);
      seen.add(key);
      const content = schemas[input.kind].parse(input.content);
      if (content.id !== input.id) throw new Error("Stable entity ID cannot be changed");
      return { ...input, content };
    });
    const entities = this.repository.saveEntities(projectId, parsed);
    return { entities, report: this.validate(projectId) };
  }

  deleteEntity(projectId: string, kind: PassageEntityKind, entityId: string) {
    this.requireProject(projectId);
    this.repository.tombstone(projectId, kind, entityId);
    return { state: this.repository.state(projectId), report: this.validate(projectId) };
  }

  listEntityVersions(projectId: string, kind: PassageEntityKind, entityId: string) {
    this.requireProject(projectId);
    return this.repository.listEntityVersions(projectId, kind, entityId);
  }

  restoreEntity(projectId: string, kind: PassageEntityKind, entityId: string, versionId: string) {
    this.requireProject(projectId);
    const entity = this.repository.restoreEntity(projectId, kind, entityId, versionId);
    return { entity, report: this.validate(projectId) };
  }

  createSnapshot(projectId: string) {
    const dependencies = this.approvedDependencies(projectId);
    const report = this.validate(projectId, this.bundle(projectId), dependencies);
    return this.repository.createSnapshot(projectId, dependencies.versions, report);
  }

  approve(projectId: string, snapshotId?: string) {
    const snapshot = snapshotId ? this.repository.getSnapshot(snapshotId) : this.createSnapshot(projectId);
    if (!snapshot || snapshot.projectId !== projectId) throw new Error("Passage-plan snapshot not found");
    const currentUpstream = Object.fromEntries(Object.keys(snapshot.upstreamVersions).map((artifactId) => [
      artifactId, this.workflow.get(projectId, artifactId).approvedVersionId,
    ]));
    if (Object.entries(snapshot.upstreamVersions).some(([artifactId, versionId]) =>
      currentUpstream[artifactId] !== versionId)) {
      throw new Error("Passage-plan snapshot is stale because an upstream approval changed");
    }
    const report = snapshot.validation as PassageValidationReport;
    const errors = report.findings.filter((finding) => finding.severity === "error");
    if (errors.length) {
      const error = new Error(errors.map((finding) => finding.message).join(" "));
      Object.assign(error, { findings: errors });
      throw error;
    }
    return { snapshot: { ...snapshot, status: "approved" as const }, state: this.repository.approveSnapshot(projectId, snapshot.id) };
  }

  restoreSnapshot(projectId: string, snapshotId: string) {
    const state = this.repository.restoreSnapshot(projectId, snapshotId);
    return { state, report: this.validate(projectId) };
  }

  setOverride(projectId: string, code: string, entityId: string, rationale: string) {
    if (!rationale.trim()) throw new Error("Override rationale is required");
    const finding = this.validate(projectId).findings.find((item) =>
      item.code === code && item.entityId === entityId);
    if (!finding || finding.severity !== "warning") {
      throw new Error("Only a current warning can be acknowledged");
    }
    const override = this.repository.setOverride(projectId, code, entityId, rationale);
    return { override, report: this.validate(projectId) };
  }

  deleteOverride(projectId: string, code: string, entityId: string) {
    this.repository.deleteOverride(projectId, code, entityId);
    return { report: this.validate(projectId) };
  }

  validate(
    projectId: string,
    bundle = this.bundle(projectId),
    dependencies = this.approvedDependencies(projectId),
  ): PassageValidationReport {
    return validatePassagePlan({
      bundle,
      bible: dependencies.bible.content,
      routes: dependencies.routes.content,
      endings: dependencies.endings.content,
      mechanics: dependencies.mechanics.content,
      overrides: this.repository.listOverrides(projectId),
    });
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }

  private approved<T>(projectId: string, artifactId: string) {
    const id = this.workflow.get(projectId, artifactId).approvedVersionId;
    return id ? this.artifacts.getVersion<T>(id) : undefined;
  }

  private approvedDependencies(projectId: string) {
    const brief = this.approved<ProjectBrief>(projectId, "brief");
    const bible = this.approved<LongFormStoryBible>(projectId, "bible");
    const routes = this.approved<LongFormRoutePlan>(projectId, "routes");
    const endings = this.approved<LongFormEndingPlan>(projectId, "endings");
    const mechanics = this.approved<LongFormMechanicsPlan>(projectId, "mechanics");
    if (!brief || !bible || !routes || !endings || !mechanics) {
      throw new Error("Approve brief, bible, routes, endings, and mechanics first");
    }
    return {
      versions: {
        brief: brief.id,
        bible: bible.id,
        routes: routes.id,
        endings: endings.id,
        mechanics: mechanics.id,
      },
      bible,
      routes,
      endings,
      mechanics,
    };
  }
}
