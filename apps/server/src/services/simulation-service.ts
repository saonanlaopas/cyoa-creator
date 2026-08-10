import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  PassagePlanBundleSchema,
  PassageStructureSchema,
  ProjectBriefSchema,
  validatePassagePlan,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
} from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  ArtifactVersion,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";
import {
  DEFAULT_DETERMINISTIC_PATH_POLICY,
  compileRuntime,
  runDeterministicPath,
  stableFingerprint,
  type CompiledRuntime,
  type DeterministicPathDefinition,
  type DeterministicPathPolicy,
  type RuntimeCompileSource,
  type RuntimeState,
  type RuntimeTrace,
} from "@story-to-cyoa/runtime";

export const SIMULATION_INPUT_ARTIFACT_ID = "simulation-inputs";
export const SIMULATION_RUN_ARTIFACT_ID = "simulation-runs";

interface VersionReference { entityId: string; versionId: string }

export interface SimulationInputRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  snapshotId: string;
  structureVersionId: string;
  passageVersions: VersionReference[];
  choiceVersions: VersionReference[];
  threadVersions: VersionReference[];
  upstreamVersions: Record<string, string>;
  acceptedDraftVersions: VersionReference[];
  policy: DeterministicPathPolicy;
  runtimeFingerprint: string;
  fingerprint: string;
}

export interface SimulationRunRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  inputArtifactVersionId: string;
  inputFingerprint: string;
  runtimeFingerprint: string;
  path: DeterministicPathDefinition;
  trace: RuntimeTrace;
}

export class SimulationServiceError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export class SimulationService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly passageDrafts: PassageDraftRepository,
  ) {}

  createInput(projectId: string): ArtifactVersion<SimulationInputRecord> {
    this.requireProject(projectId);
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || !state.approvedSnapshotId) {
      throw new SimulationServiceError("simulation_snapshot_not_approved", "An approved passage-plan snapshot is required");
    }
    const snapshot = this.passagePlans.getSnapshot(state.approvedSnapshotId);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "approved") {
      throw new SimulationServiceError("simulation_snapshot_not_approved", "The approved passage-plan snapshot is unavailable");
    }
    for (const artifactId of ["brief", "bible", "routes", "endings", "mechanics"]) {
      const expectedVersionId = snapshot.upstreamVersions[artifactId];
      if (!expectedVersionId || this.workflow.get(projectId, artifactId).approvedVersionId !== expectedVersionId) {
        throw new SimulationServiceError(
          "simulation_upstream_not_current",
          `Approved ${artifactId} does not match the passage-plan snapshot`,
        );
      }
    }
    const passageVersions = references(this.passagePlans.snapshotEntities(snapshot.id, "passage"));
    const choiceVersions = references(this.passagePlans.snapshotEntities(snapshot.id, "choice"));
    const threadVersions = references(this.passagePlans.snapshotEntities(snapshot.id, "thread"));
    const acceptedDraftVersions = passageVersions.flatMap(({ entityId }) => {
      const accepted = this.passageDrafts.getHead(projectId, entityId)?.accepted;
      return accepted ? [{ entityId, versionId: accepted.id }] : [];
    }).sort(compareReference);
    const identity = {
      schemaVersion: 1 as const,
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: snapshot.structureVersionId,
      passageVersions,
      choiceVersions,
      threadVersions,
      upstreamVersions: sortedRecord(snapshot.upstreamVersions),
      acceptedDraftVersions,
      policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY },
    };
    const provisional: SimulationInputRecord = {
      ...identity,
      id: "",
      runtimeFingerprint: "",
      fingerprint: stableFingerprint(identity),
    };
    const runtime = this.compileExactInput(provisional);
    const content: SimulationInputRecord = {
      ...provisional,
      id: `simin_${provisional.fingerprint}`,
      runtimeFingerprint: runtime.fingerprint,
    };
    return this.artifacts.saveArtifact({
      projectId,
      artifactId: SIMULATION_INPUT_ARTIFACT_ID,
      artifactType: "simulation-input",
      schemaVersion: 1,
      content,
    });
  }

  listInputs(projectId: string): ArtifactVersion<SimulationInputRecord>[] {
    this.requireProject(projectId);
    return this.artifacts.listVersions<SimulationInputRecord>(projectId, SIMULATION_INPUT_ARTIFACT_ID);
  }

  run(projectId: string, input: {
    inputArtifactVersionId: string;
    choiceIds: string[];
    expectedEndingId?: string | null;
    expectedState?: DeterministicPathDefinition["expectedState"];
  }): ArtifactVersion<SimulationRunRecord> {
    this.requireProject(projectId);
    if (!Array.isArray(input.choiceIds) || input.choiceIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new SimulationServiceError("simulation_path_invalid", "Deterministic paths require stable choice IDs");
    }
    const inputVersion = this.artifacts.getVersion<SimulationInputRecord>(input.inputArtifactVersionId);
    if (!inputVersion || inputVersion.projectId !== projectId || inputVersion.artifactId !== SIMULATION_INPUT_ARTIFACT_ID) {
      throw new SimulationServiceError("simulation_input_not_found", "Simulation input version not found");
    }
    const evidence = inputVersion.content;
    this.assertInputIdentity(evidence, projectId);
    const runtime = this.compileExactInput(evidence);
    if (runtime.fingerprint !== evidence.runtimeFingerprint) {
      throw new SimulationServiceError("simulation_runtime_fingerprint_mismatch", "Historical runtime input no longer compiles identically");
    }
    if (input.choiceIds.length > evidence.policy.maxSteps) {
      throw new SimulationServiceError("simulation_path_too_large", "Deterministic path exceeds the input step policy");
    }
    const path: DeterministicPathDefinition = {
      choiceIds: [...input.choiceIds],
      policy: { ...evidence.policy },
      ...(input.expectedEndingId !== undefined ? { expectedEndingId: input.expectedEndingId } : {}),
      ...(input.expectedState ? { expectedState: input.expectedState } : {}),
    };
    const trace = runDeterministicPath(runtime, evidence.fingerprint, path);
    const content: SimulationRunRecord = {
      schemaVersion: 1,
      id: `simrun_${stableFingerprint({ inputVersionId: inputVersion.id, traceFingerprint: trace.fingerprint })}`,
      projectId,
      inputArtifactVersionId: inputVersion.id,
      inputFingerprint: evidence.fingerprint,
      runtimeFingerprint: runtime.fingerprint,
      path,
      trace,
    };
    return this.artifacts.saveArtifact({
      projectId,
      artifactId: SIMULATION_RUN_ARTIFACT_ID,
      artifactType: "simulation-run",
      schemaVersion: 1,
      content,
    });
  }

  listRuns(projectId: string): ArtifactVersion<SimulationRunRecord>[] {
    this.requireProject(projectId);
    return this.artifacts.listVersions<SimulationRunRecord>(projectId, SIMULATION_RUN_ARTIFACT_ID);
  }

  getRun(projectId: string, versionId: string): ArtifactVersion<SimulationRunRecord> {
    this.requireProject(projectId);
    const version = this.artifacts.getVersion<SimulationRunRecord>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== SIMULATION_RUN_ARTIFACT_ID) {
      throw new SimulationServiceError("simulation_run_not_found", "Simulation run not found");
    }
    return version;
  }

  private compileExactInput(input: SimulationInputRecord): CompiledRuntime {
    const snapshot = this.passagePlans.getSnapshot(input.snapshotId);
    if (!snapshot || snapshot.projectId !== input.projectId || snapshot.status !== "approved") {
      throw new SimulationServiceError("simulation_snapshot_lineage_invalid", "Simulation input snapshot lineage is invalid");
    }
    if (snapshot.structureVersionId !== input.structureVersionId
      || stableFingerprint(sortedRecord(snapshot.upstreamVersions)) !== stableFingerprint(sortedRecord(input.upstreamVersions))) {
      throw new SimulationServiceError("simulation_snapshot_lineage_invalid", "Simulation input does not match its approved snapshot");
    }
    const structureVersion = this.passagePlans.getStructureVersion(input.structureVersionId);
    if (!structureVersion || structureVersion.projectId !== input.projectId) {
      throw new SimulationServiceError("simulation_structure_lineage_invalid", "Simulation structure version is invalid");
    }
    const structure = PassageStructureSchema.parse(structureVersion.content);
    const passages = this.loadExactEntities<PassagePlan>(input, "passage", input.passageVersions);
    const choices = this.loadExactEntities<ChoicePlan>(input, "choice", input.choiceVersions);
    const threads = this.loadExactEntities<NarrativeThread>(input, "thread", input.threadVersions);
    const bible = LongFormStoryBibleSchema.parse(this.loadUpstream(input, "bible").content);
    const routes = LongFormRoutePlanSchema.parse(this.loadUpstream(input, "routes").content);
    const endings = LongFormEndingPlanSchema.parse(this.loadUpstream(input, "endings").content);
    const mechanics = LongFormMechanicsPlanSchema.parse(this.loadUpstream(input, "mechanics").content);
    ProjectBriefSchema.parse(this.loadUpstream(input, "brief").content);
    for (const reference of input.acceptedDraftVersions) {
      const draft = this.passageDrafts.getVersion(input.projectId, reference.versionId);
      if (!draft || draft.passageId !== reference.entityId) {
        throw new SimulationServiceError("simulation_draft_lineage_invalid", "Accepted-draft simulation lineage is invalid");
      }
    }
    const bundle = PassagePlanBundleSchema.parse({ structure, passages, choices, threads });
    const staticReport = validatePassagePlan({ bundle, bible, routes, endings, mechanics });
    const hardErrors = staticReport.findings.filter((finding) => finding.severity === "error");
    if (hardErrors.length) {
      throw new SimulationServiceError("simulation_static_validation_failed", "Approved snapshot has hard runtime validation errors", hardErrors);
    }
    const source: RuntimeCompileSource = {
      snapshotId: input.snapshotId,
      structureVersionId: input.structureVersionId,
      startPassageId: structure.startPassageId,
      passageVersions: input.passageVersions.map((reference) => {
        const passage = passages.find((item) => item.id === reference.entityId)!;
        return { versionId: reference.versionId, ...passage };
      }),
      choiceVersions: input.choiceVersions.map((reference) => {
        const choice = choices.find((item) => item.id === reference.entityId)!;
        return { versionId: reference.versionId, ...choice };
      }),
      threadVersionIds: input.threadVersions.map((reference) => reference.versionId),
      routeIds: routes.routes.map((route) => route.id),
      routeDecisionIds: routes.decisionPoints.map((decision) => decision.id),
      endings: endings.endings.map((ending) => ({ id: ending.id, routeId: ending.routeId })),
      mechanics,
    };
    return compileRuntime(source);
  }

  private loadExactEntities<T extends { id: string }>(
    input: SimulationInputRecord,
    kind: "passage" | "choice" | "thread",
    expected: VersionReference[],
  ): T[] {
    const snapshotReferences = references(this.passagePlans.snapshotEntities(input.snapshotId, kind));
    if (stableFingerprint(snapshotReferences) !== stableFingerprint([...expected].sort(compareReference))) {
      throw new SimulationServiceError("simulation_entity_lineage_invalid", `Simulation ${kind} versions do not match the snapshot`);
    }
    return expected.map((reference) => {
      const version = this.passagePlans.getEntityVersion<T>(reference.versionId);
      if (!version || version.projectId !== input.projectId || version.entityKind !== kind
        || version.entityId !== reference.entityId || version.content.id !== reference.entityId) {
        throw new SimulationServiceError("simulation_entity_lineage_invalid", `Simulation ${kind} version lineage is invalid`);
      }
      return version.content;
    });
  }

  private loadUpstream(input: SimulationInputRecord, artifactId: string): ArtifactVersion {
    const versionId = input.upstreamVersions[artifactId];
    const version = versionId ? this.artifacts.getVersion(versionId) : undefined;
    if (!version || version.projectId !== input.projectId || version.artifactId !== artifactId) {
      throw new SimulationServiceError("simulation_upstream_lineage_invalid", `Simulation ${artifactId} version lineage is invalid`);
    }
    return version;
  }

  private assertInputIdentity(input: SimulationInputRecord, projectId: string): void {
    if (input.schemaVersion !== 1 || input.projectId !== projectId || input.id !== `simin_${input.fingerprint}`) {
      throw new SimulationServiceError("simulation_input_invalid", "Simulation input identity is invalid");
    }
    const { id: _id, runtimeFingerprint: _runtime, fingerprint: _fingerprint, ...identity } = input;
    if (stableFingerprint(identity) !== input.fingerprint) {
      throw new SimulationServiceError("simulation_input_fingerprint_mismatch", "Simulation input fingerprint is invalid");
    }
  }

  private requireProject(projectId: string): void {
    if (!this.projects.get(projectId)) throw new SimulationServiceError("project_not_found", "Project not found");
  }
}

function references(versions: Array<{ entityId: string; id: string }>): VersionReference[] {
  return versions.map((version) => ({ entityId: version.entityId, versionId: version.id })).sort(compareReference);
}

function compareReference(left: VersionReference, right: VersionReference): number {
  return left.entityId.localeCompare(right.entityId) || left.versionId.localeCompare(right.versionId);
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
