import {
  AdaptationPlanSchema,
  ChangeProposalSchema,
  ChoicePlanSchema,
  DraftedPassagesArtifactSchema,
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  NarrativeReviewSchema,
  NarrativeThreadSchema,
  PassagePlanSchema,
  PassageStructureSchema,
  ProjectBriefSchema,
  CreativeDirectionSchema,
  assertCreativeDirectionReferences,
  type CreativeDirection,
  StoryBibleSchema,
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
import {
  ProjectSchema,
  RepairApplicationRecordSchema,
  RepairDraftProvenanceSchema,
  SimulationReportSchema,
} from "@story-to-cyoa/domain";
import { assertNativePlayerConfig, stableFingerprint } from "@story-to-cyoa/runtime";
import {
  NATIVE_BUILD_ARTIFACT_ID,
  NATIVE_COMPILATION_INPUT_ARTIFACT_ID,
  NATIVE_PLAYER_CONFIG_ARTIFACT_ID,
  NativeCompilationService,
} from "./native-compilation-service.js";
import { PLAYTEST_CAMPAIGN_ARTIFACT_ID, PlaytestService } from "./playtest-service.js";
import { SimulationService } from "./simulation-service.js";

type JsonRow = { id: string; artifact_id: string; artifact_type: string; schema_version: number; content_json: string };
type EntityRow = { id: string; entity_kind: "passage" | "choice" | "thread"; entity_id: string; content_json: string };

/** Closed portable-project/v1 policy: every exported artifact row must be listed here. */
export const PORTABLE_PROJECT_V1_ARTIFACT_POLICY = {
  excluded: ["source", "source-scope"],
  supported: [
    "adaptation", "bible", "brief", "creative-direction", "change-proposal", "drafts", "endings", "export", "mechanics",
    "narrative-review", "native-build", "native-compilation-input", "native-player-config",
    "playtest-campaign", "repair-plan", "repair-proposal", "repair-proposal-generation", "review", "routes",
    "simulation", "simulation-input", "simulation-run",
  ],
} as const;

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
}

function validateArtifacts(database: StoryDatabase, projectId: string): void {
  // Aggregate repositories validate complete immutable histories, not only the latest row.
  new NarrativeReviewRepository(database).validateProjectHistory(projectId);
  new RepairPlanRepository(database).list(projectId);
  new RepairProposalGenerationRepository(database).list(projectId);
  new RepairProposalRepository(database).list(projectId);

  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const workflow = new WorkflowRepository(database);
  const plans = new PassagePlanRepository(database);
  const drafts = new PassageDraftRepository(database);
  const simulation = new SimulationService(projects, artifacts, workflow, plans, drafts);
  const playtest = new PlaytestService(projects, artifacts, simulation);
  const native = new NativeCompilationService(projects, artifacts, workflow, plans, drafts);
  // Use the same repository read boundary as normal reopen so portable import cannot
  // accept Creative Direction data that the application itself would reject.
  parse(() => artifacts.listVersions(projectId, "creative-direction"), "creative direction history");
  const directionVersionId = workflow.get(projectId, "creative-direction").approvedVersionId;
  if (directionVersionId) {
    const direction = artifacts.getVersion<CreativeDirection>(directionVersionId);
    if (!direction || direction.projectId !== projectId || direction.artifactId !== "creative-direction") {
      fail("approved creative direction identity");
    }
    const bibleVersionId = workflow.get(projectId, "bible").approvedVersionId;
    const routeVersionId = workflow.get(projectId, "routes").approvedVersionId;
    const bible = bibleVersionId ? artifacts.getVersion(bibleVersionId) : undefined;
    const routes = routeVersionId ? artifacts.getVersion(routeVersionId) : undefined;
    const bibleContent = bible ? LongFormStoryBibleSchema.parse(bible.content) : undefined;
    const routeContent = routes ? LongFormRoutePlanSchema.parse(routes.content) : undefined;
    parse(() => assertCreativeDirectionReferences(direction.content, {
      characterIds: bibleContent?.characters.map((item) => item.id) ?? [],
      relationships: bibleContent?.relationships.map((item) => ({ id: item.id, characterIds: item.characterIds })) ?? [],
      routeIds: routeContent?.routes.map((item) => item.id) ?? [],
      acts: routeContent?.acts.map((item) => ({ id: item.id, routeId: item.routeId })) ?? [],
    }), "approved creative direction scopes");
  }
  const rows = database.prepare("SELECT id, artifact_id, artifact_type, schema_version, content_json FROM artifact_versions WHERE project_id = ?")
    .all(projectId) as JsonRow[];
  for (const row of rows) {
    try {
      validateArtifactRow({ row, projectId, database, content: parse(() => JSON.parse(row.content_json), `artifact JSON ${row.id}`), simulation, playtest, native });
    } catch (error) {
      if ((error as Error).message.startsWith("portable_project_")) throw error;
      throw new Error(`portable_project_domain_invalid: artifact ${row.id}: ${(error as Error).message}`);
    }
  }
}

function validateArtifactRow(input: {
  row: JsonRow;
  projectId: string;
  database: StoryDatabase;
  content: unknown;
  simulation: SimulationService;
  playtest: PlaytestService;
  native: NativeCompilationService;
}): void {
  const { row, projectId, database, content, simulation, playtest, native } = input;
  if ((PORTABLE_PROJECT_V1_ARTIFACT_POLICY.excluded as readonly string[]).includes(row.artifact_type)
    || (PORTABLE_PROJECT_V1_ARTIFACT_POLICY.excluded as readonly string[]).includes(row.artifact_id)) {
    throw new Error(`portable_project_artifact_type_excluded: ${row.artifact_type}`);
  }
  if (!(PORTABLE_PROJECT_V1_ARTIFACT_POLICY.supported as readonly string[]).includes(row.artifact_type)) {
    throw new Error(`portable_project_artifact_type_unsupported: ${row.artifact_type}`);
  }
  switch (row.artifact_type) {
    case "brief":
      exactIdentity(row, "brief", [1]); canonical(ProjectBriefSchema.parse(content), content, row); return;
    case "creative-direction": {
      exactIdentity(row, "creative-direction", [1]);
      canonical(CreativeDirectionSchema.parse(content), content, row);
      return;
    }
    case "bible":
      exactIdentity(row, "bible", [1]); canonicalOne(content, row, [LongFormStoryBibleSchema, StoryBibleSchema]); return;
    case "routes":
      exactIdentity(row, "routes", [1]); canonicalOne(content, row, [LongFormRoutePlanSchema, ProjectSchema]); return;
    case "endings":
      exactIdentity(row, "endings", [1]); canonical(LongFormEndingPlanSchema.parse(content), content, row); return;
    case "mechanics":
      exactIdentity(row, "mechanics", [1]); canonical(LongFormMechanicsPlanSchema.parse(content), content, row); return;
    case "adaptation":
      exactIdentity(row, "adaptation", [1]); canonical(AdaptationPlanSchema.parse(content), content, row); return;
    case "drafts":
      exactIdentity(row, "drafts", [1]); canonical(DraftedPassagesArtifactSchema.parse(content), content, row); return;
    case "review":
      exactIdentity(row, "review", [1]); canonical(NarrativeReviewSchema.parse(content), content, row); return;
    case "simulation":
      exactIdentity(row, "simulation", [1]); canonical(SimulationReportSchema.parse(content), content, row); return;
    case "change-proposal": {
      exactSchema(row, [1]); const proposal = canonical(ChangeProposalSchema.parse(content), content, row);
      if (row.artifact_id !== `proposal:${proposal.id}`) fail(`artifact identity ${row.id}`); return;
    }
    case "export":
      exactIdentity(row, "export", [1]); validateLegacyExport(content, row); return;
    case "native-player-config":
      exactIdentity(row, NATIVE_PLAYER_CONFIG_ARTIFACT_ID, [1]); canonical(assertNativePlayerConfig(content), content, row); return;
    case "native-compilation-input":
      exactIdentity(row, NATIVE_COMPILATION_INPUT_ARTIFACT_ID, [1]); parse(() => native.validateStoredInput(projectId, row.id), `native input ${row.id}`); return;
    case "native-build":
      exactIdentity(row, NATIVE_BUILD_ARTIFACT_ID, [1]); parse(() => native.validateBuild(projectId, row.id), `native build ${row.id}`); return;
    case "simulation-input":
      exactIdentity(row, "simulation-inputs", [1]); parse(() => simulation.resolveInput(projectId, row.id), `simulation input ${row.id}`); return;
    case "simulation-run":
      exactIdentity(row, "simulation-runs", [1]); parse(() => simulation.validateRun(projectId, row.id), `simulation run ${row.id}`); return;
    case "playtest-campaign": {
      exactIdentity(row, PLAYTEST_CAMPAIGN_ARTIFACT_ID, [1, 2]);
      const campaign = parse(() => playtest.getCampaign(projectId, row.id).content, `playtest campaign ${row.id}`);
      const resolved = parse(() => simulation.resolveInput(projectId, campaign.simulationInputArtifactVersionId), `playtest input ${row.id}`);
      if (campaign.projectId !== projectId || campaign.simulationInputFingerprint !== resolved.input.fingerprint
        || campaign.compiledRuntimeFingerprint !== resolved.runtime.fingerprint || campaign.snapshotId !== resolved.input.snapshotId) {
        fail(`playtest campaign lineage ${row.id}`);
      }
      for (const sample of campaign.samples) parse(() => playtest.replay(projectId, row.id, sample.id), `playtest sample ${sample.id}`);
      return;
    }
    case "narrative-review":
      exactPrefix(row, "narrative-review:", [1]); return;
    case "repair-plan":
      exactPrefix(row, "repair-plan:", [1]); return;
    case "repair-proposal-generation":
      exactPrefix(row, "repair-proposal-generation:", [1]); return;
    case "repair-proposal":
      exactPrefix(row, "repair-proposal:", [1]); return;
    default:
      throw new Error(`portable_project_artifact_type_unsupported: ${row.artifact_type}`);
  }
}

function validateSnapshotMetadata(database: StoryDatabase, projectId: string): void {
  const snapshots = database.prepare("SELECT id, upstream_versions_json, validation_json FROM passage_plan_snapshots WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; upstream_versions_json: string; validation_json: string }>;
  for (const snapshot of snapshots) {
    const upstream = JSON.parse(snapshot.upstream_versions_json) as unknown;
    const validation = JSON.parse(snapshot.validation_json) as unknown;
    if (!recordOfStrings(upstream) || !passageValidationReport(validation)) fail(`snapshot metadata ${snapshot.id}`);
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

function exactIdentity(row: JsonRow, artifactId: string, schemaVersions: number[]): void {
  exactSchema(row, schemaVersions);
  if (row.artifact_id !== artifactId) fail(`artifact identity ${row.id}`);
}

function exactPrefix(row: JsonRow, prefix: string, schemaVersions: number[]): void {
  exactSchema(row, schemaVersions);
  if (!row.artifact_id.startsWith(prefix) || row.artifact_id.length === prefix.length) fail(`artifact identity ${row.id}`);
}

function exactSchema(row: JsonRow, schemaVersions: number[]): void {
  if (!schemaVersions.includes(row.schema_version)) fail(`artifact schema ${row.id}`);
}

function canonical<T>(parsed: T, original: unknown, row: JsonRow): T {
  if (stableFingerprint(parsed) !== stableFingerprint(original)) fail(`artifact canonical content ${row.id}`);
  return parsed;
}

function canonicalOne(
  content: unknown,
  row: JsonRow,
  schemas: Array<{ parse(value: unknown): unknown }>,
): void {
  for (const schema of schemas) {
    try {
      canonical(schema.parse(content), content, row);
      return;
    } catch {
      // Try the next accepted historical contract for this shared artifact type.
    }
  }
  fail(`artifact canonical content ${row.id}`);
}

function validateLegacyExport(content: unknown, row: JsonRow): void {
  if (!content || typeof content !== "object" || Array.isArray(content)) fail(`export artifact ${row.id}`);
  const value = content as Record<string, unknown>;
  const expected = value.format === "html" ? ["compiler", "format", "generatedAt"] : ["format", "generatedAt"];
  if (!exactKeys(value, expected) || !["html", "twee"].includes(value.format as string)
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || (value.format === "html" && !["tweego", "fallback"].includes(value.compiler as string))) {
    fail(`export artifact ${row.id}`);
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function passageValidationReport(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return exactKeys(report, ["findings", "budgets", "coverage"])
    && Array.isArray(report.findings)
    && Boolean(report.budgets && typeof report.budgets === "object" && !Array.isArray(report.budgets))
    && Boolean(report.coverage && typeof report.coverage === "object" && !Array.isArray(report.coverage));
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
