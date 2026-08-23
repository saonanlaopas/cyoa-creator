import {
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  NATIVE_COMPILATION_INPUT_SCHEMA_ID,
  NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
  NativeCompilationInputSchema,
  PassagePlanBundleSchema,
  PassageStructureSchema,
  ProjectBriefSchema,
  assertNativeCompilationInput,
  compileNativeGame,
  nativePublicationFinding,
  sourceInputFingerprint,
  validatePassagePlan,
  type ChoicePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormRoutePlan,
  type LongFormStoryBible,
  type NativeAcceptedDraftSelection,
  type NativeCompilationArtifactReference,
  type NativeCompilationEntityReference,
  type NativeCompilationInput,
  type NativePublicationFinding,
  type NarrativeThread,
  type PassagePlan,
  type PassagePlanFinding,
  type PassageStructure,
  type PassageValidationReport,
  type ProjectBrief,
  type ResolvedNativeCompilationInput,
} from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  ArtifactVersion,
  PassageDraftRepository,
  PassageDraftVersionRecord,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";
import {
  NATIVE_BUNDLE_LIMITS,
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  currentNativePassage,
  initializeNativeGame,
  listNativeGameChoices,
  loadNativeGame,
  serializedBytes,
  stableFingerprint,
  type NativeGameBundle,
} from "@story-to-cyoa/runtime";

export const NATIVE_COMPILATION_INPUT_ARTIFACT_ID = "native-compilation-inputs";
export const NATIVE_BUILD_ARTIFACT_ID = "native-builds";

const requiredUpstreamIds = ["brief", "bible", "routes", "endings", "mechanics"] as const;
type RequiredUpstreamId = typeof requiredUpstreamIds[number];

export interface PublicationDiagnostic {
  code: string;
  severity: "blocker" | "warning" | "info";
  message: string;
  sourceKind: string;
  sourceId: string;
  fingerprint: string;
  acknowledged: boolean;
  rationale?: string;
}

export interface PublicationReadiness {
  schemaVersion: 1;
  projectId: string;
  ready: boolean;
  sourceInputFingerprint: string | null;
  snapshotId: string | null;
  structureVersionId: string | null;
  passageCount: number;
  choiceCount: number;
  acceptedDraftCount: number;
  acceptedWordCount: number;
  blockers: PublicationDiagnostic[];
  warnings: PublicationDiagnostic[];
  acknowledgedWarnings: PublicationDiagnostic[];
  diagnostics: PublicationDiagnostic[];
  compiler: { policyId: string; policyVersion: number; version: string };
  runtimeContract: { schemaVersion: number; version: string };
  bundleContract: { schemaId: string; schemaVersion: number; maximumSerializedBytes: number };
  inputPreview: NativeCompilationInput | null;
}

export interface NativeBuildRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  compilationInputArtifactVersionId: string;
  sourceInputFingerprint: string;
  bundleFingerprint: string;
  runtimeFingerprint: string;
  snapshotId: string;
  structureVersionId: string;
  compilerPolicyId: string;
  compilerPolicyVersion: number;
  compilerVersion: string;
  runtimeContractVersion: string;
  bundleSchemaId: string;
  bundleSchemaVersion: number;
  passageCount: number;
  choiceCount: number;
  acceptedWordCount: number;
  serializedBytes: number;
  validation: { valid: true; loaded: true; smokePassageId: string; availableChoiceCount: number };
}

export class NativeCompilationServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

interface Inspection {
  readiness: PublicationReadiness;
  resolved: ResolvedNativeCompilationInput | null;
}

export class NativeCompilationService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly passageDrafts: PassageDraftRepository,
  ) {}

  readiness(projectId: string): PublicationReadiness {
    this.requireProject(projectId);
    return this.inspectCurrent(projectId).readiness;
  }

  captureInput(projectId: string): ArtifactVersion<NativeCompilationInput> {
    this.requireProject(projectId);
    const inspected = this.inspectCurrent(projectId);
    if (!inspected.resolved || !inspected.readiness.ready) {
      throw new NativeCompilationServiceError(
        "publication_not_ready",
        "Current project is not ready for native compilation",
        inspected.readiness,
      );
    }
    return this.artifacts.saveArtifact({
      projectId,
      artifactId: NATIVE_COMPILATION_INPUT_ARTIFACT_ID,
      artifactType: "native-compilation-input",
      schemaVersion: NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
      content: inspected.resolved.input,
      schema: NativeCompilationInputSchema,
    });
  }

  listInputs(projectId: string): ArtifactVersion<NativeCompilationInput>[] {
    this.requireProject(projectId);
    return this.artifacts.listVersions<NativeCompilationInput>(projectId, NATIVE_COMPILATION_INPUT_ARTIFACT_ID);
  }

  compile(projectId: string, inputArtifactVersionId?: string): {
    input: ArtifactVersion<NativeCompilationInput>;
    build: ArtifactVersion<NativeBuildRecord>;
    bundle: NativeGameBundle;
  } {
    this.requireProject(projectId);
    const inputVersion = inputArtifactVersionId
      ? this.requireInputVersion(projectId, inputArtifactVersionId)
      : this.captureInput(projectId);
    const resolved = this.resolveStoredInput(projectId, inputVersion.content);
    const bundle = compileNativeGame(resolved);
    const loaded = loadNativeGame(bundle);
    const initialState = initializeNativeGame(loaded);
    const passage = currentNativePassage(loaded, initialState);
    const availableChoices = listNativeGameChoices(loaded, initialState);
    const acceptedWordCount = resolved.acceptedDrafts.reduce((total, item) => total + item.selection.wordCount, 0);
    const buildContent: NativeBuildRecord = {
      schemaVersion: 1,
      id: `nativebuild_${stableFingerprint({
        inputArtifactVersionId: inputVersion.id,
        sourceInputFingerprint: resolved.input.sourceInputFingerprint,
        bundleFingerprint: bundle.bundleFingerprint,
      })}`,
      projectId,
      compilationInputArtifactVersionId: inputVersion.id,
      sourceInputFingerprint: resolved.input.sourceInputFingerprint,
      bundleFingerprint: bundle.bundleFingerprint,
      runtimeFingerprint: bundle.runtimeFingerprint,
      snapshotId: resolved.input.snapshot.id,
      structureVersionId: resolved.input.snapshot.structureVersionId,
      compilerPolicyId: resolved.input.compilerPolicy.id,
      compilerPolicyVersion: resolved.input.compilerPolicy.version,
      compilerVersion: resolved.input.compilerPolicy.compilerVersion,
      runtimeContractVersion: resolved.input.runtimeContract.version,
      bundleSchemaId: resolved.input.bundleContract.schemaId,
      bundleSchemaVersion: resolved.input.bundleContract.schemaVersion,
      passageCount: bundle.passages.length,
      choiceCount: bundle.choices.length,
      acceptedWordCount,
      serializedBytes: serializedBytes(bundle),
      validation: {
        valid: true,
        loaded: true,
        smokePassageId: passage.id,
        availableChoiceCount: availableChoices.length,
      },
    };
    const build = this.artifacts.saveArtifact({
      projectId,
      artifactId: NATIVE_BUILD_ARTIFACT_ID,
      artifactType: "native-build",
      schemaVersion: 1,
      content: buildContent,
    });
    return { input: inputVersion, build, bundle };
  }

  listBuilds(projectId: string): Array<ArtifactVersion<NativeBuildRecord> & { current: boolean }> {
    this.requireProject(projectId);
    const readiness = this.inspectCurrent(projectId).readiness;
    return this.artifacts.listVersions<NativeBuildRecord>(projectId, NATIVE_BUILD_ARTIFACT_ID).map((version) => ({
      ...version,
      current: Boolean(readiness.sourceInputFingerprint
        && version.content.sourceInputFingerprint === readiness.sourceInputFingerprint),
    }));
  }

  private inspectCurrent(projectId: string): Inspection {
    const blockers: PublicationDiagnostic[] = [];
    const warningDiagnostics: PublicationDiagnostic[] = [];
    const acknowledgedWarnings: PublicationDiagnostic[] = [];
    const info: PublicationDiagnostic[] = [];
    const blocker = (code: string, message: string, sourceKind: string, sourceId: string): void => {
      blockers.push(diagnostic(code, "blocker", message, sourceKind, sourceId));
    };
    const state = this.passagePlans.state(projectId);
    if (state.status !== "approved" || !state.approvedSnapshotId) {
      blocker("publication.passage-plan-not-approved", "Approve a current passage-plan snapshot before compilation", "passage-plan", projectId);
      return { readiness: readiness(projectId, blockers, warningDiagnostics, acknowledgedWarnings, info), resolved: null };
    }
    const snapshot = this.passagePlans.getSnapshot(state.approvedSnapshotId);
    if (!snapshot) {
      blocker("publication.snapshot-missing", "The approved passage-plan snapshot is missing", "snapshot", state.approvedSnapshotId);
      return { readiness: readiness(projectId, blockers, warningDiagnostics, acknowledgedWarnings, info), resolved: null };
    }
    if (snapshot.projectId !== projectId || snapshot.status !== "approved") {
      blocker("publication.snapshot-lineage-invalid", "The approved snapshot does not belong to this project or is not approved", "snapshot", snapshot.id);
    }
    const structureVersion = this.passagePlans.getStructureVersion<PassageStructure>(snapshot.structureVersionId);
    if (!structureVersion || structureVersion.projectId !== projectId) {
      blocker("publication.structure-version-missing", "The exact passage structure version is missing", "structure", snapshot.structureVersionId);
    }
    const exactStructure = structureVersion
      ? parseExact(PassageStructureSchema, structureVersion.content, "structure", structureVersion.id, blocker)
      : null;
    const passageVersions = this.loadCurrentSnapshotEntities<PassagePlan>(snapshot.id, projectId, "passage", blocker);
    const choiceVersions = this.loadCurrentSnapshotEntities<ChoicePlan>(snapshot.id, projectId, "choice", blocker);
    const threadVersions = this.loadCurrentSnapshotEntities<NarrativeThread>(snapshot.id, projectId, "thread", blocker);
    const passages = passageVersions.map((item) => parseExactPassage(item, blocker)).filter(nonNull);
    const choices = choiceVersions.map((item) => parseExactChoice(item, blocker)).filter(nonNull);
    const threads = threadVersions.map((item) => parseExactThread(item, blocker)).filter(nonNull);

    const upstream = {} as Record<RequiredUpstreamId, ArtifactVersion>;
    const upstreamReferences: NativeCompilationArtifactReference[] = [];
    for (const artifactId of requiredUpstreamIds) {
      const expectedVersionId = snapshot.upstreamVersions[artifactId];
      const workflow = this.workflow.get(projectId, artifactId);
      if (!expectedVersionId) {
        blocker("publication.upstream-version-missing", `Snapshot does not identify an exact ${artifactId} version`, "artifact", artifactId);
        continue;
      }
      if (workflow.status !== "approved" || workflow.approvedVersionId !== expectedVersionId) {
        blocker("publication.upstream-not-current", `Approved ${artifactId} does not match the exact snapshot dependency`, "artifact", artifactId);
      }
      const version = this.artifacts.getVersion(expectedVersionId);
      if (!version || version.projectId !== projectId || version.artifactId !== artifactId) {
        blocker("publication.upstream-lineage-invalid", `Exact ${artifactId} artifact version is missing or belongs elsewhere`, "artifact", artifactId);
        continue;
      }
      upstream[artifactId] = version;
      upstreamReferences.push({
        artifactId,
        versionId: version.id,
        schemaVersion: version.schemaVersion,
        contentFingerprint: stableFingerprint(version.content),
      });
    }
    const extraUpstream = Object.keys(snapshot.upstreamVersions).filter((id) => !requiredUpstreamIds.includes(id as RequiredUpstreamId));
    if (extraUpstream.length) blocker(
      "publication.upstream-unsupported",
      `Native compilation v1 does not support additional upstream artifacts: ${extraUpstream.sort().join(", ")}`,
      "snapshot",
      snapshot.id,
    );

    const brief = upstream.brief ? parseExact(ProjectBriefSchema, upstream.brief.content, "artifact", upstream.brief.id, blocker) : null;
    const bible = upstream.bible ? parseExact(LongFormStoryBibleSchema, upstream.bible.content, "artifact", upstream.bible.id, blocker) : null;
    const routes = upstream.routes ? parseExact(LongFormRoutePlanSchema, upstream.routes.content, "artifact", upstream.routes.id, blocker) : null;
    const endings = upstream.endings ? parseExact(LongFormEndingPlanSchema, upstream.endings.content, "artifact", upstream.endings.id, blocker) : null;
    const mechanics = upstream.mechanics ? parseExact(LongFormMechanicsPlanSchema, upstream.mechanics.content, "artifact", upstream.mechanics.id, blocker) : null;

    let validationFingerprint = stableFingerprint(snapshot.validation);
    let validationWarnings: NativePublicationFinding[] = [];
    if (exactStructure && bible && routes && endings && mechanics
      && passages.length === passageVersions.length
      && choices.length === choiceVersions.length
      && threads.length === threadVersions.length) {
      try {
        const bundle = PassagePlanBundleSchema.parse({ structure: exactStructure, passages, choices, threads });
        const snapshotReport = requireValidationReport(snapshot.validation);
        const preservedOverrides = snapshotReport.findings.flatMap((finding) => finding.severity === "warning"
          && finding.acknowledged && finding.overrideRationale
          ? [{ code: finding.code, entityId: finding.entityId, rationale: finding.overrideRationale }]
          : []);
        const recomputed = validatePassagePlan({ bundle, bible, routes, endings, mechanics, overrides: preservedOverrides });
        if (stableFingerprint(recomputed) !== validationFingerprint) {
          blocker("publication.snapshot-validation-mismatch", "Stored snapshot validation does not match its exact immutable dependencies", "snapshot", snapshot.id);
        }
        for (const finding of recomputed.findings) {
          if (finding.severity === "error") {
            blocker(`publication.validation.${finding.code}`, finding.message, finding.entityType, finding.entityId);
            continue;
          }
          const normalized = publicationFinding(finding);
          validationWarnings.push(normalized);
          const item = diagnostic(
            `publication.validation.${finding.code}`,
            finding.severity === "warning" ? "warning" : "info",
            finding.message,
            finding.entityType,
            finding.entityId,
            finding.acknowledged,
            finding.overrideRationale,
          );
          if (finding.severity === "warning") {
            (finding.acknowledged ? acknowledgedWarnings : warningDiagnostics).push(item);
          } else info.push(item);
        }
        validationFingerprint = stableFingerprint(recomputed);
      } catch (error) {
        blocker("publication.static-validation-invalid", (error as Error).message, "snapshot", snapshot.id);
      }
    }

    const acceptedDrafts: Array<{ selection: NativeAcceptedDraftSelection; proseMarkdown: string }> = [];
    const passageReferenceById = new Map(passageVersions.map((item) => [item.entityId, item]));
    for (const passage of passages) {
      const passageVersion = passageReferenceById.get(passage.id)!;
      const head = this.passageDrafts.getHead(projectId, passage.id);
      const draft = head?.accepted;
      if (!draft) {
        blocker("publication.accepted-prose-missing", `Passage ${passage.id} has no accepted prose`, "passage", passage.id);
        continue;
      }
      if (draft.stale) blocker("publication.accepted-prose-stale", `Accepted prose for ${passage.id} is stale`, "draft", draft.id);
      if (draft.passageId !== passage.id || draft.projectId !== projectId) {
        blocker("publication.accepted-prose-lineage-invalid", `Accepted prose for ${passage.id} belongs to another passage or project`, "draft", draft.id);
      }
      if (draft.basedOnPassagePlanVersionId !== passageVersion.id) blocker(
        "publication.accepted-prose-base-invalid",
        `Accepted prose for ${passage.id} is based on the wrong passage-plan version`,
        "draft",
        draft.id,
      );
      if (!(["accepted", "reviewed", "locked"] as const).includes(draft.lifecycleStatus as "accepted" | "reviewed" | "locked")) {
        blocker("publication.accepted-prose-lifecycle-invalid", `Accepted prose for ${passage.id} has an invalid lifecycle`, "draft", draft.id);
      }
      if (stableFingerprint(sortedRecord(draft.upstreamVersions)) !== stableFingerprint(sortedRecord(snapshot.upstreamVersions))) blocker(
        "publication.accepted-prose-upstream-invalid",
        `Accepted prose for ${passage.id} does not have the exact approved upstream provenance`,
        "draft",
        draft.id,
      );
      this.validateNeighborProvenance(projectId, draft, blocker);
      if (draft.sourceKind === "generated" && !draft.generationProvenance) blocker(
        "publication.accepted-prose-generation-provenance-invalid",
        `Generated accepted prose for ${passage.id} has missing generation provenance`,
        "draft",
        draft.id,
      );
      const proseBytes = new TextEncoder().encode(draft.proseMarkdown).byteLength;
      if (!proseBytes) blocker("publication.accepted-prose-empty", `Accepted prose for ${passage.id} is empty`, "draft", draft.id);
      if (proseBytes > NATIVE_BUNDLE_LIMITS.maximumProseBytesPerPassage) blocker(
        "publication.accepted-prose-too-large",
        `Accepted prose for ${passage.id} exceeds the native per-passage byte ceiling`,
        "draft",
        draft.id,
      );
      acceptedDrafts.push({
        proseMarkdown: draft.proseMarkdown,
        selection: {
          passageId: passage.id,
          versionId: draft.id,
          basedOnPassagePlanVersionId: draft.basedOnPassagePlanVersionId,
          lifecycleStatus: draft.lifecycleStatus as "accepted" | "reviewed" | "locked",
          acceptedLocked: head?.acceptedLocked ?? false,
          stale: false,
          sourceKind: draft.sourceKind,
          wordCount: draft.wordCount,
          proseBytes,
          proseFingerprint: stableFingerprint(draft.proseMarkdown),
          generationProvenanceFingerprint: draft.generationProvenance
            ? stableFingerprint(draft.generationProvenance) : null,
          upstreamVersions: sortedRecord(draft.upstreamVersions),
          neighboringDraftVersions: sortedRecord(draft.neighboringDraftVersions),
        },
      });
    }
    const totalProseBytes = acceptedDrafts.reduce((total, item) => total + item.selection.proseBytes, 0);
    if (totalProseBytes > NATIVE_BUNDLE_LIMITS.maximumTotalProseBytes) blocker(
      "publication.accepted-prose-total-too-large",
      "Accepted prose exceeds the native bundle total prose ceiling",
      "project",
      projectId,
    );

    let resolved: ResolvedNativeCompilationInput | null = null;
    if (!blockers.length && exactStructure && brief && bible && routes && endings && mechanics
      && acceptedDrafts.length === passages.length) {
      const identity = {
        schemaId: NATIVE_COMPILATION_INPUT_SCHEMA_ID,
        schemaVersion: NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
        projectId,
        gameId: projectId,
        snapshot: {
          id: snapshot.id,
          version: snapshot.version,
          structureVersionId: snapshot.structureVersionId,
          upstreamVersions: sortedRecord(snapshot.upstreamVersions),
          validationFingerprint,
        },
        structure: {
          versionId: structureVersion!.id,
          contentFingerprint: stableFingerprint(exactStructure),
        },
        passages: entityReferences(passageVersions),
        choices: entityReferences(choiceVersions),
        threads: entityReferences(threadVersions),
        upstreamArtifacts: [...upstreamReferences].sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
        acceptedDrafts: acceptedDrafts.map((item) => item.selection).sort((left, right) => left.passageId.localeCompare(right.passageId)),
        warnings: validationWarnings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
        compilerPolicy: {
          id: NATIVE_COMPILER_POLICY_ID,
          version: NATIVE_COMPILER_POLICY_VERSION,
          compilerVersion: NATIVE_COMPILER_VERSION,
          includeDebugProvenance: true,
        },
        runtimeContract: { schemaVersion: 1 as const, version: NATIVE_RUNTIME_CONTRACT_VERSION },
        bundleContract: {
          schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID,
          schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
        },
      };
      const input = NativeCompilationInputSchema.parse({
        ...identity,
        sourceInputFingerprint: sourceInputFingerprint(identity),
      });
      resolved = {
        input,
        structure: exactStructure,
        passages: passageVersions.map((item) => ({ versionId: item.id, content: item.content as PassagePlan })),
        choices: choiceVersions.map((item) => ({ versionId: item.id, content: item.content as ChoicePlan })),
        threads: threadVersions.map((item) => ({ versionId: item.id, content: item.content as NarrativeThread })),
        brief,
        bible,
        routes,
        endings,
        mechanics,
        acceptedDrafts,
      };
      try {
        const bundle = compileNativeGame(resolved);
        const loaded = loadNativeGame(bundle);
        currentNativePassage(loaded, initializeNativeGame(loaded));
        info.push(diagnostic(
          "publication.runtime-smoke-valid",
          "info",
          "Exact input compiles, validates, and loads through the Foundation 5A runtime",
          "snapshot",
          snapshot.id,
        ));
      } catch (error) {
        blocker("publication.native-runtime-invalid", (error as Error).message, "snapshot", snapshot.id);
        resolved = null;
      }
    }
    const finalReadiness = readiness(projectId, blockers, warningDiagnostics, acknowledgedWarnings, info, resolved?.input ?? null, {
      snapshotId: snapshot.id,
      structureVersionId: snapshot.structureVersionId,
      passageCount: passages.length,
      choiceCount: choices.length,
      acceptedDraftCount: acceptedDrafts.length,
      acceptedWordCount: acceptedDrafts.reduce((total, item) => total + item.selection.wordCount, 0),
    });
    return { readiness: finalReadiness, resolved: finalReadiness.ready ? resolved : null };
  }

  private resolveStoredInput(projectId: string, value: unknown): ResolvedNativeCompilationInput {
    let input: NativeCompilationInput;
    try {
      input = assertNativeCompilationInput(value);
    } catch (error) {
      throw new NativeCompilationServiceError("native_input_invalid", (error as Error).message);
    }
    if (input.projectId !== projectId || input.gameId !== projectId) {
      throw new NativeCompilationServiceError("native_input_project_mismatch", "Native compilation input belongs to another project");
    }
    const snapshot = this.passagePlans.getSnapshot(input.snapshot.id);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "approved"
      || snapshot.version !== input.snapshot.version
      || snapshot.structureVersionId !== input.snapshot.structureVersionId
      || stableFingerprint(sortedRecord(snapshot.upstreamVersions)) !== stableFingerprint(input.snapshot.upstreamVersions)
      || stableFingerprint(snapshot.validation) !== input.snapshot.validationFingerprint) {
      throw new NativeCompilationServiceError("native_input_snapshot_lineage_invalid", "Native compilation snapshot lineage is invalid");
    }
    const structureVersion = this.passagePlans.getStructureVersion<PassageStructure>(input.structure.versionId);
    if (!structureVersion || structureVersion.projectId !== projectId
      || stableFingerprint(structureVersion.content) !== input.structure.contentFingerprint) {
      throw new NativeCompilationServiceError("native_input_structure_lineage_invalid", "Native compilation structure lineage is invalid");
    }
    const structure = PassageStructureSchema.parse(structureVersion.content);
    const passages = this.resolveEntities<PassagePlan>(projectId, input.snapshot.id, "passage", input.passages);
    const choices = this.resolveEntities<ChoicePlan>(projectId, input.snapshot.id, "choice", input.choices);
    const threads = this.resolveEntities<NarrativeThread>(projectId, input.snapshot.id, "thread", input.threads);
    const upstream = Object.fromEntries(input.upstreamArtifacts.map((reference) => {
      const version = this.artifacts.getVersion(reference.versionId);
      if (!version || version.projectId !== projectId || version.artifactId !== reference.artifactId
        || version.schemaVersion !== reference.schemaVersion
        || stableFingerprint(version.content) !== reference.contentFingerprint
        || input.snapshot.upstreamVersions[reference.artifactId] !== version.id) {
        throw new NativeCompilationServiceError("native_input_upstream_lineage_invalid", `Native compilation ${reference.artifactId} lineage is invalid`);
      }
      return [reference.artifactId, version.content];
    })) as Record<RequiredUpstreamId, unknown>;
    const acceptedDrafts = input.acceptedDrafts.map((selection) => {
      const draft = this.passageDrafts.getVersion(projectId, selection.versionId);
      if (!draft || draft.projectId !== projectId || draft.passageId !== selection.passageId
        || draft.basedOnPassagePlanVersionId !== selection.basedOnPassagePlanVersionId
        || draft.lifecycleStatus !== selection.lifecycleStatus
        || draft.sourceKind !== selection.sourceKind
        || draft.wordCount !== selection.wordCount
        || new TextEncoder().encode(draft.proseMarkdown).byteLength !== selection.proseBytes
        || stableFingerprint(draft.proseMarkdown) !== selection.proseFingerprint
        || stableFingerprint(sortedRecord(draft.upstreamVersions)) !== stableFingerprint(selection.upstreamVersions)
        || stableFingerprint(sortedRecord(draft.neighboringDraftVersions)) !== stableFingerprint(selection.neighboringDraftVersions)
        || (draft.generationProvenance ? stableFingerprint(draft.generationProvenance) : null) !== selection.generationProvenanceFingerprint) {
        throw new NativeCompilationServiceError("native_input_draft_lineage_invalid", `Native compilation draft lineage is invalid for ${selection.passageId}`);
      }
      return { selection, proseMarkdown: draft.proseMarkdown };
    });
    const resolved: ResolvedNativeCompilationInput = {
      input,
      structure,
      passages,
      choices,
      threads,
      brief: ProjectBriefSchema.parse(upstream.brief),
      bible: LongFormStoryBibleSchema.parse(upstream.bible),
      routes: LongFormRoutePlanSchema.parse(upstream.routes),
      endings: LongFormEndingPlanSchema.parse(upstream.endings),
      mechanics: LongFormMechanicsPlanSchema.parse(upstream.mechanics),
      acceptedDrafts,
    };
    return resolved;
  }

  private resolveEntities<T extends { id: string }>(
    projectId: string,
    snapshotId: string,
    kind: "passage" | "choice" | "thread",
    expected: NativeCompilationEntityReference[],
  ): Array<{ versionId: string; content: T }> {
    const snapshotReferences = entityReferences(this.passagePlans.snapshotEntities(snapshotId, kind));
    if (stableFingerprint(snapshotReferences) !== stableFingerprint(expected)) {
      throw new NativeCompilationServiceError("native_input_entity_snapshot_mismatch", `Native compilation ${kind} references do not match the snapshot`);
    }
    return expected.map((reference) => {
      const version = this.passagePlans.getEntityVersion<T>(reference.versionId);
      if (!version || version.projectId !== projectId || version.entityKind !== kind
        || version.entityId !== reference.entityId || version.content.id !== reference.entityId
        || stableFingerprint(version.content) !== reference.contentFingerprint) {
        throw new NativeCompilationServiceError("native_input_entity_lineage_invalid", `Native compilation ${kind} lineage is invalid`);
      }
      return { versionId: version.id, content: version.content };
    });
  }

  private loadCurrentSnapshotEntities<T>(
    snapshotId: string,
    projectId: string,
    kind: "passage" | "choice" | "thread",
    blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
  ) {
    const versions = this.passagePlans.snapshotEntities<T>(snapshotId, kind);
    for (const version of versions) {
      if (version.projectId !== projectId || version.entityKind !== kind) blocker(
        "publication.entity-lineage-invalid",
        `Snapshot ${kind} ${version.entityId} has invalid project or kind lineage`,
        kind,
        version.entityId,
      );
    }
    return versions;
  }

  private validateNeighborProvenance(
    projectId: string,
    draft: PassageDraftVersionRecord,
    blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
  ): void {
    for (const [neighborPassageId, neighborVersionId] of Object.entries(draft.neighboringDraftVersions)) {
      const referenced = this.passageDrafts.getVersion(projectId, neighborVersionId);
      const accepted = this.passageDrafts.getHead(projectId, neighborPassageId)?.accepted;
      if (!referenced || referenced.passageId !== neighborPassageId || !accepted || accepted.stale
        || !this.passageDrafts.acceptedVersionsAreEquivalent(projectId, referenced.id, accepted.id)) {
        blocker(
          "publication.accepted-prose-neighbor-provenance-invalid",
          `Accepted prose ${draft.id} has invalid neighboring accepted-draft provenance for ${neighborPassageId}`,
          "draft",
          draft.id,
        );
      }
    }
  }

  private requireInputVersion(projectId: string, versionId: string): ArtifactVersion<NativeCompilationInput> {
    const version = this.artifacts.getVersion<NativeCompilationInput>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== NATIVE_COMPILATION_INPUT_ARTIFACT_ID) {
      throw new NativeCompilationServiceError("native_input_not_found", "Native compilation input was not found");
    }
    return version;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") {
      throw new NativeCompilationServiceError("project_not_found", "Long-form project not found");
    }
    return project;
  }
}

function readiness(
  projectId: string,
  blockers: PublicationDiagnostic[],
  warnings: PublicationDiagnostic[],
  acknowledgedWarnings: PublicationDiagnostic[],
  diagnostics: PublicationDiagnostic[],
  inputPreview: NativeCompilationInput | null = null,
  counts: Partial<Pick<PublicationReadiness, "snapshotId" | "structureVersionId" | "passageCount" | "choiceCount" | "acceptedDraftCount" | "acceptedWordCount">> = {},
): PublicationReadiness {
  const sort = (items: PublicationDiagnostic[]) => [...items].sort((left, right) => left.code.localeCompare(right.code)
    || left.sourceKind.localeCompare(right.sourceKind) || left.sourceId.localeCompare(right.sourceId));
  return {
    schemaVersion: 1,
    projectId,
    ready: blockers.length === 0 && Boolean(inputPreview),
    sourceInputFingerprint: inputPreview?.sourceInputFingerprint ?? null,
    snapshotId: counts.snapshotId ?? null,
    structureVersionId: counts.structureVersionId ?? null,
    passageCount: counts.passageCount ?? 0,
    choiceCount: counts.choiceCount ?? 0,
    acceptedDraftCount: counts.acceptedDraftCount ?? 0,
    acceptedWordCount: counts.acceptedWordCount ?? 0,
    blockers: sort(blockers),
    warnings: sort(warnings),
    acknowledgedWarnings: sort(acknowledgedWarnings),
    diagnostics: sort(diagnostics),
    compiler: {
      policyId: NATIVE_COMPILER_POLICY_ID,
      policyVersion: NATIVE_COMPILER_POLICY_VERSION,
      version: NATIVE_COMPILER_VERSION,
    },
    runtimeContract: { schemaVersion: 1, version: NATIVE_RUNTIME_CONTRACT_VERSION },
    bundleContract: {
      schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID,
      schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
      maximumSerializedBytes: NATIVE_BUNDLE_LIMITS.maximumSerializedBytes,
    },
    inputPreview,
  };
}

function diagnostic(
  code: string,
  severity: PublicationDiagnostic["severity"],
  message: string,
  sourceKind: string,
  sourceId: string,
  acknowledged = false,
  rationale?: string,
): PublicationDiagnostic {
  const identity = { code, severity, message, sourceKind, sourceId, acknowledged, ...(rationale ? { rationale } : {}) };
  return { ...identity, fingerprint: stableFingerprint(identity) };
}

function publicationFinding(finding: PassagePlanFinding): NativePublicationFinding {
  return nativePublicationFinding({
    code: finding.code,
    severity: finding.severity === "info" ? "info" : "warning",
    entityType: finding.entityType,
    entityId: finding.entityId,
    message: finding.message,
    evidence: finding.evidence,
    suggestion: finding.suggestion,
    acknowledged: finding.acknowledged,
    ...(finding.overrideRationale ? { overrideRationale: finding.overrideRationale } : {}),
  });
}

function entityReferences(versions: Array<{ entityId: string; id: string; content: unknown }>): NativeCompilationEntityReference[] {
  return versions.map((version) => ({
    entityId: version.entityId,
    versionId: version.id,
    contentFingerprint: stableFingerprint(version.content),
  })).sort((left, right) => left.entityId.localeCompare(right.entityId) || left.versionId.localeCompare(right.versionId));
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function requireValidationReport(value: unknown): PassageValidationReport {
  if (!value || typeof value !== "object" || !Array.isArray((value as { findings?: unknown }).findings)) {
    throw new Error("Snapshot validation report is malformed");
  }
  return value as PassageValidationReport;
}

function parseExact<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  sourceKind: string,
  sourceId: string,
  blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
): T | null {
  try {
    const parsed = schema.parse(value);
    if (stableFingerprint(parsed) !== stableFingerprint(value)) {
      blocker("publication.exact-schema-mismatch", `${sourceKind} ${sourceId} contains unknown, omitted, or defaulted fields`, sourceKind, sourceId);
      return null;
    }
    return parsed;
  } catch (error) {
    blocker("publication.schema-invalid", `${sourceKind} ${sourceId} is invalid: ${(error as Error).message}`, sourceKind, sourceId);
    return null;
  }
}

function parseExactPassage(
  version: { id: string; entityId: string; content: unknown },
  blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
): PassagePlan | null {
  const parsed = PassagePlanBundleSchema.shape.passages.element.safeParse(version.content);
  if (!parsed.success || parsed.data.id !== version.entityId) {
    blocker("publication.passage-version-invalid", `Passage version ${version.id} is malformed or has mismatched stable identity`, "passage", version.entityId);
    return null;
  }
  if (stableFingerprint(parsed.data) !== stableFingerprint(version.content)) {
    blocker("publication.passage-version-not-exact", `Passage version ${version.id} contains unknown or defaulted fields`, "passage", version.entityId);
    return null;
  }
  return parsed.data;
}

function parseExactChoice(
  version: { id: string; entityId: string; content: unknown },
  blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
): ChoicePlan | null {
  const parsed = PassagePlanBundleSchema.shape.choices.element.safeParse(version.content);
  if (!parsed.success || parsed.data.id !== version.entityId) {
    blocker("publication.choice-version-invalid", `Choice version ${version.id} is malformed or has mismatched stable identity`, "choice", version.entityId);
    return null;
  }
  if (stableFingerprint(parsed.data) !== stableFingerprint(version.content)) {
    blocker("publication.choice-version-not-exact", `Choice version ${version.id} contains unknown or defaulted fields`, "choice", version.entityId);
    return null;
  }
  return parsed.data;
}

function parseExactThread(
  version: { id: string; entityId: string; content: unknown },
  blocker: (code: string, message: string, sourceKind: string, sourceId: string) => void,
): NarrativeThread | null {
  const parsed = PassagePlanBundleSchema.shape.threads.element.safeParse(version.content);
  if (!parsed.success || parsed.data.id !== version.entityId) {
    blocker("publication.thread-version-invalid", `Thread version ${version.id} is malformed or has mismatched stable identity`, "thread", version.entityId);
    return null;
  }
  if (stableFingerprint(parsed.data) !== stableFingerprint(version.content)) {
    blocker("publication.thread-version-not-exact", `Thread version ${version.id} contains unknown or defaulted fields`, "thread", version.entityId);
    return null;
  }
  return parsed.data;
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}
