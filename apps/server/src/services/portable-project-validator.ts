import {
  ChoicePlanSchema,
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  NarrativeThreadSchema,
  PassagePlanSchema,
  PassageStructureSchema,
  ProjectBriefSchema,
  assertNativeCompilationInput,
  assertResolvedNativeCompilationInput,
  type NativeCompilationInput,
} from "@story-to-cyoa/pipeline";
import {
  ArtifactRepository,
  NarrativeReviewRepository,
  PassageDraftRepository,
  countDraftWords,
  PassagePlanRepository,
  ProjectRepository,
  RepairApplicationRepository,
  RepairPlanRepository,
  RepairProposalGenerationRepository,
  RepairProposalRepository,
  WorkflowRepository,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";
import { RepairApplicationRecordSchema, RepairDraftProvenanceSchema } from "@story-to-cyoa/domain";
import { assertNativePlayerConfig, assertPlaytestCampaignIdentity, stableFingerprint } from "@story-to-cyoa/runtime";
import { SimulationService } from "./simulation-service.js";

type JsonRow = { id: string; artifact_id: string; artifact_type: string; content_json: string };
type EntityRow = { id: string; entity_kind: "passage" | "choice" | "thread"; entity_id: string; content_json: string };

/** Runs inside PortableProjectRepository's import transaction. */
export function validatePortableAuthoringProject(database: StoryDatabase, projectId: string): void {
  const project = database.prepare("SELECT id, name, mode FROM projects WHERE id = ?").get(projectId) as
    { id: string; name: string; mode: string } | undefined;
  if (!project || project.id !== projectId || !project.name.trim() || !["quick", "long-form"].includes(project.mode)) {
    fail("project identity or mode");
  }

  for (const row of database.prepare("SELECT id, content_json FROM passage_structure_versions WHERE project_id = ?").all(projectId) as Array<{ id: string; content_json: string }>) {
    parse(() => PassageStructureSchema.strict().parse(JSON.parse(row.content_json)), `passage structure ${row.id}`);
  }
  const entitySchemas = { passage: PassagePlanSchema, choice: ChoicePlanSchema, thread: NarrativeThreadSchema } as const;
  for (const row of database.prepare("SELECT id, entity_kind, entity_id, content_json FROM passage_entity_versions WHERE project_id = ?").all(projectId) as EntityRow[]) {
    const content = parse(() => entitySchemas[row.entity_kind].strict().parse(JSON.parse(row.content_json)), `${row.entity_kind} ${row.id}`);
    if (content.id !== row.entity_id) fail(`${row.entity_kind} stable identity`);
  }

  validateSnapshotMetadata(database, projectId);
  validateArtifacts(database, projectId);
  validateDraftHistories(database, projectId);
  validateAcceptanceHistory(database, projectId);
  validateRepairHistory(database, projectId);
  validateStrictArtifactStreams(database, projectId);
}

function validateArtifacts(database: StoryDatabase, projectId: string): void {
  const schemas = {
    brief: ProjectBriefSchema,
    bible: LongFormStoryBibleSchema,
    routes: LongFormRoutePlanSchema,
    endings: LongFormEndingPlanSchema,
    mechanics: LongFormMechanicsPlanSchema,
  } as const;
  const rows = database.prepare("SELECT id, artifact_id, artifact_type, content_json FROM artifact_versions WHERE project_id = ?")
    .all(projectId) as JsonRow[];
  for (const row of rows) {
    const content = JSON.parse(row.content_json) as unknown;
    if (row.artifact_id in schemas) {
      if (row.artifact_type !== row.artifact_id) fail(`planning artifact type ${row.artifact_id}`);
      parse(() => schemas[row.artifact_id as keyof typeof schemas].parse(content), `artifact ${row.artifact_id}`);
    }
    if (row.artifact_id === "native-player-config" || row.artifact_type === "native-player-config") {
      if (row.artifact_id !== "native-player-config" || row.artifact_type !== "native-player-config") fail("native player config identity");
      parse(() => assertNativePlayerConfig(content), `native player config ${row.id}`);
    }
    if (row.artifact_type === "native-compilation-input") {
      if (row.artifact_id !== "native-compilation-inputs") fail("native compilation input identity");
      const input = parse(() => assertNativeCompilationInput(content), `native compilation input ${row.id}`);
      validateNativeCompilationInput(database, projectId, input, row.id);
    }
  }
}

function validateNativeCompilationInput(database: StoryDatabase, projectId: string, input: NativeCompilationInput, versionId: string): void {
  if (input.projectId !== projectId) fail(`native compilation input project ${versionId}`);
  const snapshot = database.prepare("SELECT version, structure_version_id, upstream_versions_json, validation_json FROM passage_plan_snapshots WHERE id = ? AND project_id = ?")
    .get(input.snapshot.id, projectId) as { version: number; structure_version_id: string; upstream_versions_json: string; validation_json: string } | undefined;
  if (!snapshot || snapshot.version !== input.snapshot.version || snapshot.structure_version_id !== input.snapshot.structureVersionId) {
    fail(`native compilation snapshot ${versionId}`);
  }
  if (stableFingerprint(JSON.parse(snapshot.upstream_versions_json)) !== stableFingerprint(input.snapshot.upstreamVersions)
    || stableFingerprint(JSON.parse(snapshot.validation_json)) !== input.snapshot.validationFingerprint) {
    fail(`native compilation snapshot metadata ${versionId}`);
  }
  const structure = database.prepare("SELECT content_json FROM passage_structure_versions WHERE id = ? AND project_id = ?")
    .get(input.structure.versionId, projectId) as { content_json: string } | undefined;
  if (!structure) fail(`native compilation structure ${versionId}`);
  const entities = (kind: "passage" | "choice" | "thread", references: NativeCompilationInput["passages"]) => references.map((reference) => {
    const row = database.prepare(`SELECT content_json FROM passage_entity_versions
      WHERE id = ? AND project_id = ? AND entity_kind = ? AND entity_id = ?`).get(reference.versionId, projectId, kind, reference.entityId) as { content_json: string } | undefined;
    if (!row) fail(`native compilation ${kind} ${reference.entityId}`);
    return { versionId: reference.versionId, content: JSON.parse(row.content_json) };
  });
  const upstreamArtifacts = input.upstreamArtifacts.map((reference) => {
    const row = database.prepare(`SELECT schema_version, content_json FROM artifact_versions
      WHERE id = ? AND project_id = ? AND artifact_id = ?`).get(reference.versionId, projectId, reference.artifactId) as { schema_version: number; content_json: string } | undefined;
    if (!row || row.schema_version !== reference.schemaVersion) fail(`native compilation upstream ${reference.artifactId}`);
    return { artifactId: reference.artifactId, versionId: reference.versionId, schemaVersion: row.schema_version, content: JSON.parse(row.content_json) };
  });
  const draftRepository = new PassageDraftRepository(database);
  const acceptedDrafts = input.acceptedDrafts.map((selection) => {
    const draft = draftRepository.getVersion(projectId, selection.versionId);
    if (!draft || draft.passageId !== selection.passageId) fail(`native compilation accepted draft ${selection.passageId}`);
    return { selection, proseMarkdown: draft.proseMarkdown };
  });
  parse(() => assertResolvedNativeCompilationInput({
    input,
    structure: { versionId: input.structure.versionId, content: JSON.parse(structure.content_json) },
    passages: entities("passage", input.passages),
    choices: entities("choice", input.choices),
    threads: entities("thread", input.threads),
    upstreamArtifacts,
    acceptedDrafts,
  }), `native compilation resolved input ${versionId}`);
}

function validateSnapshotMetadata(database: StoryDatabase, projectId: string): void {
  const snapshots = database.prepare("SELECT id, upstream_versions_json, validation_json FROM passage_plan_snapshots WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; upstream_versions_json: string; validation_json: string }>;
  for (const snapshot of snapshots) {
    const upstream = JSON.parse(snapshot.upstream_versions_json) as unknown;
    const validation = JSON.parse(snapshot.validation_json) as unknown;
    if (!recordOfStrings(upstream) || !Array.isArray(validation)) fail(`snapshot metadata ${snapshot.id}`);
    for (const [artifactId, versionId] of Object.entries(upstream)) {
      const exact = database.prepare("SELECT 1 FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = ?")
        .get(versionId, projectId, artifactId);
      if (!exact) fail(`snapshot upstream ${snapshot.id}:${artifactId}`);
    }
  }
}

function validateDraftHistories(database: StoryDatabase, projectId: string): void {
  const drafts = new PassageDraftRepository(database);
  const rows = database.prepare("SELECT id, passage_id, source_kind FROM passage_draft_versions WHERE project_id = ? ORDER BY passage_id, version")
    .all(projectId) as Array<{ id: string; passage_id: string; source_kind: string }>;
  for (const row of rows) {
    const draft = drafts.getVersion(projectId, row.id);
    if (!draft || draft.passageId !== row.passage_id) fail(`draft identity ${row.id}`);
    if (draft.wordCount !== countDraftWords(draft.proseMarkdown)) fail(`draft word count ${row.id}`);
    if (draft.staleReasons.some((reason) => !Array.isArray(reason.changedFields) || reason.changedFields.some((field) => typeof field !== "string"))) {
      fail(`draft staleness ${row.id}`);
    }
    if (row.source_kind === "generated" && !draft.generationProvenance) fail(`generated draft provenance ${row.id}`);
  }
}

function validateAcceptanceHistory(database: StoryDatabase, projectId: string): void {
  const applications = database.prepare(`SELECT id, selected_candidates_json, previous_accepted_versions_json,
    resulting_accepted_versions_json, downstream_staleness_json FROM passage_draft_acceptance_applications WHERE project_id = ?`)
    .all(projectId) as Array<Record<string, string>>;
  for (const application of applications) {
    const selectedValue = JSON.parse(application.selected_candidates_json!) as unknown;
    const previous = JSON.parse(application.previous_accepted_versions_json!) as unknown;
    const resulting = JSON.parse(application.resulting_accepted_versions_json!) as unknown;
    const stale = JSON.parse(application.downstream_staleness_json!) as unknown;
    const selectedLength = Array.isArray(selectedValue) ? selectedValue.length : -1;
    const selected = Array.isArray(selectedValue) ? Object.fromEntries(selectedValue.map((item) => {
      const value = item as Record<string, unknown>;
      if (typeof value.passageId !== "string" || typeof value.candidateDraftVersionId !== "string") fail(`draft acceptance ${application.id}`);
      return [value.passageId, value.candidateDraftVersionId];
    })) : null;
    if (!selected || Object.keys(selected).length !== selectedLength || !recordOfNullableStrings(previous) || !recordOfStrings(resulting) || !Array.isArray(stale)) {
      fail(`draft acceptance ${application.id}`);
    }
    const items = database.prepare(`SELECT passage_id, candidate_version_id, previous_accepted_version_id,
      resulting_accepted_version_id FROM passage_draft_acceptance_items WHERE project_id = ? AND application_id = ?`)
      .all(projectId, application.id) as Array<{ passage_id: string; candidate_version_id: string; previous_accepted_version_id: string | null; resulting_accepted_version_id: string }>;
    if (items.length !== Object.keys(selected).length || items.some((item) => selected[item.passage_id] !== item.candidate_version_id
      || previous[item.passage_id] !== item.previous_accepted_version_id || resulting[item.passage_id] !== item.resulting_accepted_version_id)) {
      fail(`draft acceptance item lineage ${application.id}`);
    }
  }
}

function validateRepairHistory(database: StoryDatabase, projectId: string): void {
  // These accepted repositories perform their strict immutable aggregate/read-boundary checks.
  new RepairPlanRepository(database).list(projectId);
  new RepairProposalGenerationRepository(database).list(projectId);
  new RepairProposalRepository(database).list(projectId);
  const records = new RepairApplicationRepository(database).list(projectId);
  for (const record of records) {
    RepairApplicationRecordSchema.parse(record);
    const row = database.prepare("SELECT * FROM repair_applications WHERE project_id = ? AND id = ?").get(projectId, record.id) as Record<string, unknown> | undefined;
    if (!row || row.proposal_id !== record.proposalId || row.proposal_artifact_version_id !== record.proposalArtifactVersionId
      || row.repair_plan_artifact_version_id !== record.repairPlanArtifactVersionId || row.definition_fingerprint !== record.definitionFingerprint
      || row.preview_fingerprint !== record.previewFingerprint) fail(`repair application identity ${record.id}`);
    const results = database.prepare(`SELECT operation_id, entity_kind, entity_id, version_id FROM repair_application_result_versions
      WHERE project_id = ? AND application_id = ? ORDER BY operation_id`).all(projectId, record.id) as Array<Record<string, string>>;
    const expected = [...record.resultingVersions].sort((a, b) => a.operationId.localeCompare(b.operationId));
    if (JSON.stringify(results.map((item) => ({ operationId: item.operation_id, entityKind: item.entity_kind, entityId: item.entity_id, versionId: item.version_id }))) !== JSON.stringify(expected)) {
      fail(`repair application results ${record.id}`);
    }
    const links = database.prepare(`SELECT operation_id, passage_id, draft_version_id, provenance_json FROM repair_application_draft_links
      WHERE project_id = ? AND application_id = ?`).all(projectId, record.id) as Array<Record<string, string>>;
    for (const link of links) {
      const provenance = RepairDraftProvenanceSchema.parse(JSON.parse(link.provenance_json));
      if (provenance.applicationId !== record.id || provenance.applicationDefinitionFingerprint !== record.definitionFingerprint
        || provenance.proposalId !== record.proposalId
        || provenance.proposalArtifactVersionId !== record.proposalArtifactVersionId
        || provenance.proposalDefinitionFingerprint !== record.proposalDefinitionFingerprint
        || provenance.repairPlanId !== record.repairPlanId
        || provenance.repairPlanArtifactVersionId !== record.repairPlanArtifactVersionId
        || provenance.repairPlanDefinitionFingerprint !== record.repairPlanDefinitionFingerprint
        || provenance.operationId !== link.operation_id || provenance.passageId !== link.passage_id
        || provenance.draftVersionId !== link.draft_version_id
        || !record.resultingVersions.some((item) => item.operationId === link.operation_id
          && item.entityKind === "passage-prose" && item.entityId === link.passage_id && item.versionId === link.draft_version_id)) {
        fail(`repair application draft provenance ${record.id}`);
      }
    }
  }
}

function validateStrictArtifactStreams(database: StoryDatabase, projectId: string): void {
  new NarrativeReviewRepository(database).validateProjectHistory(projectId);
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const workflow = new WorkflowRepository(database);
  const plans = new PassagePlanRepository(database);
  const drafts = new PassageDraftRepository(database);
  const simulation = new SimulationService(projects, artifacts, workflow, plans, drafts);
  const rows = database.prepare("SELECT id, artifact_type, content_json FROM artifact_versions WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; artifact_type: string; content_json: string }>;
  for (const row of rows) {
    if (row.artifact_type === "simulation-input") parse(() => simulation.resolveInput(projectId, row.id), `simulation input ${row.id}`);
    if (row.artifact_type === "playtest-campaign") parse(() => assertPlaytestCampaignIdentity(JSON.parse(row.content_json)), `playtest campaign ${row.id}`);
  }
}

function recordOfStrings(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === "string" && item.length > 0));
}
function recordOfNullableStrings(value: unknown): value is Record<string, string | null> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => item === null || (typeof item === "string" && item.length > 0)));
}
function parse<T>(operation: () => T, label: string): T {
  try { return operation(); } catch (error) { throw new Error(`portable_project_domain_invalid: ${label}: ${(error as Error).message}`); }
}
function fail(label: string): never { throw new Error(`portable_project_domain_invalid: ${label}`); }
