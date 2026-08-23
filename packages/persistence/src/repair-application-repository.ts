import { createHash } from "node:crypto";
import {
  REPAIR_APPLICATION_POLICY_V1,
  REPAIR_APPLICATION_ARTIFACT_DEPENDENCIES,
  RepairApplicationRecordSchema,
  RepairDraftProvenanceSchema,
  collectStableIds,
  repairApplicationDefinitionFromRecord,
  type RepairApplicationRecord,
  type RepairDraftProvenance,
  type RepairExpectedBase,
  type RepairProposalOperation,
  type RepairProposalRecord,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { classifyPassageDraftStaleness } from "./draft-staleness.js";
import { PassageDraftRepository } from "./passage-draft-repository.js";
import { RepairProposalRepository } from "./repair-proposal-repository.js";
import { artifactChain } from "./schema.js";

export interface RepairApplicationSelection {
  explicitlySelectedGroupIds: string[];
  requiredDependencyGroupIds: string[];
  effectiveGroupIds: string[];
  operationIds: string[];
}

export interface RepairApplicationMutationResult {
  application: RepairApplicationRecord;
  draftLinks: Array<{ operationId: string; passageId: string; draftVersionId: string; provenance: RepairDraftProvenance }>;
}

type Row = { content_json: string };

export class RepairApplicationRepository {
  private readonly proposals: RepairProposalRepository;

  public constructor(private readonly database: StoryDatabase) {
    this.proposals = new RepairProposalRepository(database);
  }

  apply(input: {
    projectId: string;
    proposalId: string;
    proposalArtifactVersionId: string;
    proposalDefinitionFingerprint: string;
    explicitlySelectedGroupIds: string[];
    previewFingerprint: string;
    mutateInTransaction: (
      proposal: RepairProposalRecord,
      selection: RepairApplicationSelection,
    ) => RepairApplicationMutationResult;
    simulateFailure?: boolean;
  }): RepairApplicationRecord {
    return transaction(this.database, () => {
      const proposalVersion = this.proposals.get<RepairProposalRecord>(input.projectId, input.proposalId);
      if (!proposalVersion || proposalVersion.id !== input.proposalArtifactVersionId
        || proposalVersion.content.definitionFingerprint !== input.proposalDefinitionFingerprint) {
        throw new Error("Repair application proposal lineage mismatch");
      }
      if (this.database.prepare("SELECT id FROM repair_applications WHERE project_id = ? AND proposal_id = ?")
        .get(input.projectId, input.proposalId)) throw new Error("Repair proposal already has a successful application");
      const selection = selectGroups(proposalVersion.content, input.explicitlySelectedGroupIds);
      const operations = selection.operationIds.map((id) => proposalVersion.content.operations.find((item) => item.id === id)!);
      assertGeneratedIdsAvailable(this.database, input.projectId, operations);
      const preconditions = assertOperationPreconditions(this.database, input.projectId, operations);
      const canonicalBefore = captureCanonicalState(this.database);
      const result = input.mutateInTransaction(proposalVersion.content, selection);
      const record = RepairApplicationRecordSchema.parse(result.application);
      if (Buffer.byteLength(JSON.stringify(record), "utf8") > REPAIR_APPLICATION_POLICY_V1.maxAuditBytes) {
        throw new Error("Repair application audit exceeds its saved byte limit");
      }
      assertApplicationIdentity(record, input, proposalVersion.content, selection);
      assertOperationResults(this.database, record, proposalVersion.content, operations, preconditions, result.draftLinks);
      assertCanonicalMutationFootprint(this.database, canonicalBefore, record, operations);
      this.database.prepare(`INSERT INTO repair_applications (
        id, project_id, proposal_id, proposal_artifact_version_id, repair_plan_artifact_version_id,
        definition_fingerprint, preview_fingerprint, content_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        record.id, record.projectId, record.proposalId, record.proposalArtifactVersionId,
        record.repairPlanArtifactVersionId, record.definitionFingerprint, record.previewFingerprint,
        JSON.stringify(record), record.appliedAt,
      );
      const insertResult = this.database.prepare(`INSERT INTO repair_application_result_versions (
        project_id, application_id, operation_id, entity_kind, entity_id, version_id
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const resultVersion of record.resultingVersions) insertResult.run(
        record.projectId, record.id, resultVersion.operationId, resultVersion.entityKind,
        resultVersion.entityId, resultVersion.versionId,
      );
      const insertLink = this.database.prepare(`INSERT INTO repair_application_draft_links (
        project_id, application_id, operation_id, passage_id, draft_version_id, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const link of result.draftLinks) insertLink.run(
        record.projectId, record.id, link.operationId, link.passageId, link.draftVersionId,
        JSON.stringify(link.provenance),
      );
      if (input.simulateFailure) throw new Error("Simulated repair application failure");
      return this.get(input.projectId, record.id)!;
    });
  }

  get(projectId: string, applicationId: string): RepairApplicationRecord | undefined {
    const row = this.database.prepare("SELECT content_json FROM repair_applications WHERE project_id = ? AND id = ?")
      .get(projectId, applicationId) as Row | undefined;
    return row ? RepairApplicationRecordSchema.parse(JSON.parse(row.content_json)) : undefined;
  }

  getByProposal(projectId: string, proposalId: string): RepairApplicationRecord | undefined {
    const row = this.database.prepare("SELECT content_json FROM repair_applications WHERE project_id = ? AND proposal_id = ?")
      .get(projectId, proposalId) as Row | undefined;
    return row ? RepairApplicationRecordSchema.parse(JSON.parse(row.content_json)) : undefined;
  }

  list(projectId: string): RepairApplicationRecord[] {
    return (this.database.prepare(`SELECT content_json FROM repair_applications
      WHERE project_id = ? ORDER BY applied_at DESC, id DESC`).all(projectId) as Row[])
      .map((row) => RepairApplicationRecordSchema.parse(JSON.parse(row.content_json)));
  }

  getDraftProvenance(projectId: string, draftVersionId: string): RepairDraftProvenance | undefined {
    const row = this.database.prepare(`SELECT passage_id, provenance_json FROM repair_application_draft_links
      WHERE project_id = ? AND draft_version_id = ?`).get(projectId, draftVersionId) as { passage_id: string; provenance_json: string } | undefined;
    if (!row) return undefined;
    const value = JSON.parse(row.provenance_json) as Record<string, unknown>;
    return RepairDraftProvenanceSchema.parse({ ...value, passageId: value.passageId ?? row.passage_id });
  }
}

export function selectGroups(proposal: RepairProposalRecord, explicitIds: string[]): RepairApplicationSelection {
  if (!explicitIds.length) throw new Error("Select at least one repair proposal group");
  if (explicitIds.length > REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups) throw new Error("Too many repair proposal groups selected");
  if (new Set(explicitIds).size !== explicitIds.length) throw new Error("Duplicate repair proposal group selection");
  const groups = new Map(proposal.groups.map((group) => [group.id, group]));
  if (explicitIds.some((id) => !groups.has(id))) throw new Error("Unknown repair proposal group selected");
  const closure = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (closure.has(id)) return;
    if (visiting.has(id)) throw new Error("Repair proposal group dependency cycle");
    const group = groups.get(id);
    if (!group) throw new Error("Repair proposal group dependency is missing");
    visiting.add(id);
    [...group.dependsOnGroupIds].sort().forEach(visit);
    visiting.delete(id);
    closure.add(id);
    ordered.push(id);
  };
  [...explicitIds].sort().forEach(visit);
  const explicit = [...explicitIds].sort();
  const explicitSet = new Set(explicit);
  const operationIds = ordered.flatMap((id) => [...groups.get(id)!.operationIds].sort());
  if (new Set(operationIds).size !== operationIds.length) throw new Error("Repair proposal operation belongs to multiple selected groups");
  return {
    explicitlySelectedGroupIds: explicit,
    requiredDependencyGroupIds: ordered.filter((id) => !explicitSet.has(id)),
    effectiveGroupIds: ordered,
    operationIds,
  };
}

function assertApplicationIdentity(
  record: RepairApplicationRecord,
  input: {
    projectId: string; proposalId: string; proposalArtifactVersionId: string;
    proposalDefinitionFingerprint: string; previewFingerprint: string;
  },
  proposal: RepairProposalRecord,
  selection: RepairApplicationSelection,
): void {
  const exact = record.projectId === input.projectId && record.proposalId === input.proposalId
    && record.proposalArtifactVersionId === input.proposalArtifactVersionId
    && record.proposalDefinitionFingerprint === input.proposalDefinitionFingerprint
    && record.previewFingerprint === input.previewFingerprint
    && record.repairPlanId === proposal.repairPlanId
    && record.repairPlanArtifactVersionId === proposal.repairPlanArtifactVersionId
    && record.repairPlanDefinitionFingerprint === proposal.repairPlanDefinitionFingerprint
    && JSON.stringify(record.explicitlySelectedGroupIds) === JSON.stringify(selection.explicitlySelectedGroupIds)
    && JSON.stringify(record.requiredDependencyGroupIds) === JSON.stringify(selection.requiredDependencyGroupIds)
    && JSON.stringify(record.effectiveGroupIds) === JSON.stringify(selection.effectiveGroupIds)
    && JSON.stringify(record.operationIds) === JSON.stringify(selection.operationIds)
    && record.policy.id === REPAIR_APPLICATION_POLICY_V1.id;
  if (!exact) throw new Error("Repair application definition does not match its immutable proposal selection");
  const selectedGroups = proposal.groups.filter((group) => selection.effectiveGroupIds.includes(group.id));
  const authorizedTargetKeys = new Set(selectedGroups.flatMap((group) => group.authorizedTargetKeys));
  const bases = proposal.expectedBases.filter((base) => authorizedTargetKeys.has(base.targetKey));
  if (JSON.stringify(record.expectedBases) !== JSON.stringify(bases)) throw new Error("Repair application expected bases are not exact");
  const definitionFingerprint = fingerprint(repairApplicationDefinitionFromRecord(record));
  if (record.definitionFingerprint !== definitionFingerprint || record.id !== `rap_${definitionFingerprint.slice(0, 32)}`) {
    throw new Error("Repair application definition fingerprint mismatch");
  }
}

function assertOperationResults(
  database: StoryDatabase,
  record: RepairApplicationRecord,
  proposal: RepairProposalRecord,
  operations: RepairProposalOperation[],
  preconditions: OperationPreconditions,
  draftLinks: RepairApplicationMutationResult["draftLinks"],
): void {
  const resultByOperation = new Map(record.resultingVersions.map((item) => [item.operationId, item]));
  const selectedOperations = new Set(record.operationIds);
  if (resultByOperation.size !== record.resultingVersions.length
    || record.resultingVersions.length !== record.operationIds.length
    || record.operationIds.some((id) => !resultByOperation.has(id))
    || record.resultingVersions.some((result) => !selectedOperations.has(result.operationId))) {
    throw new Error("Repair application resulting version lineage is not the exact selected operation set");
  }
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  for (const result of record.resultingVersions) assertOperationResult(
    database, record.projectId, operationById.get(result.operationId)!, result, preconditions,
  );
  const proseResults = record.resultingVersions.filter((item) => item.entityKind === "passage-prose");
  if (draftLinks.length !== proseResults.length) throw new Error("Repair application draft provenance is incomplete");
  for (const link of draftLinks) {
    const provenance = RepairDraftProvenanceSchema.parse(link.provenance);
    const result = resultByOperation.get(link.operationId);
    const operation = operationById.get(link.operationId);
    const expected = operation?.expectedBase;
    const passageResult = record.resultingVersions.find((item) => item.entityKind === "passage" && item.entityId === link.passageId);
    const effectivePassagePlanBaseVersionId = passageResult?.versionId
      ?? (expected?.kind === "passage-prose-head" ? expected.passagePlanVersionId : null);
    if (!result || result.entityKind !== "passage-prose" || result.entityId !== link.passageId
      || result.versionId !== link.draftVersionId || link.provenance.applicationId !== record.id
      || link.provenance.applicationDefinitionFingerprint !== record.definitionFingerprint
      || link.provenance.proposalId !== record.proposalId
      || link.provenance.proposalArtifactVersionId !== record.proposalArtifactVersionId
      || link.provenance.proposalDefinitionFingerprint !== record.proposalDefinitionFingerprint
      || link.provenance.repairPlanId !== record.repairPlanId
      || link.provenance.repairPlanArtifactVersionId !== record.repairPlanArtifactVersionId
      || link.provenance.repairPlanDefinitionFingerprint !== record.repairPlanDefinitionFingerprint
      || link.provenance.operationId !== link.operationId
      || link.provenance.passageId !== link.passageId
      || link.provenance.draftVersionId !== link.draftVersionId
      || !operation || operation.kind !== "create-passage-draft-candidate"
      || expected?.kind !== "passage-prose-head"
      || canonical(provenance.sourceFindingFingerprints) !== canonical(operation.sourceFindingFingerprints)
      || provenance.passagePlanBaseVersionId !== effectivePassagePlanBaseVersionId
      || provenance.expectedCurrentDraftVersionId !== expected.currentDraftVersionId
      || provenance.expectedAcceptedDraftVersionId !== expected.acceptedDraftVersionId
      || canonical(provenance.upstreamVersions) !== canonical(expected.upstreamVersions)
      || canonical(provenance.neighboringDraftVersions) !== canonical(expected.neighboringDraftVersions)) {
      throw new Error("Repair application draft provenance does not match its result");
    }
    assertDraftResult(database, record.projectId, operation, result.versionId, provenance, preconditions);
  }
  if (proposal.id !== record.proposalId) throw new Error("Repair application proposal result lineage mismatch");
}

interface OperationPrecondition {
  operationId: string;
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  artifactId: string | null;
  expectedArtifactContent: unknown | null;
}
type OperationPreconditions = Map<string, OperationPrecondition>;

interface CanonicalState {
  structureVersions: CanonicalRows;
  structureHeads: CanonicalRows;
  entityVersions: CanonicalRows;
  entityHeads: CanonicalRows;
  artifactVersions: CanonicalRows;
  artifactStaleFlags: CanonicalRows;
  artifactWorkflow: CanonicalRows;
  artifactDependencies: CanonicalRows;
  passagePlanState: CanonicalRows;
  draftVersions: CanonicalRows;
  draftUpstream: CanonicalRows;
  draftNeighbors: CanonicalRows;
  draftHeads: CanonicalRows;
  draftStalenessEvents: CanonicalRows;
}
type CanonicalRow = Record<string, unknown>;
type CanonicalRows = Map<string, CanonicalRow>;

function assertGeneratedIdsAvailable(
  database: StoryDatabase,
  projectId: string,
  operations: RepairProposalOperation[],
): void {
  const generated = operations.filter((operation) => operation.kind === "add-entity");
  if (!generated.length) return;
  const stableIds = collectCurrentStableIds(database, projectId);
  for (const operation of generated) {
    if (stableIds.has(operation.entityId)) {
      throw new Error(`Generated ${operation.entityKind} ${operation.entityId} collides with an existing stable ID`);
    }
  }
}

function collectCurrentStableIds(database: StoryDatabase, projectId: string): Set<string> {
  const values: unknown[] = [];
  const structure = database.prepare(`SELECT versions.content_json
    FROM passage_structure_heads heads JOIN passage_structure_versions versions ON versions.id = heads.version_id
    WHERE heads.project_id = ?`).get(projectId) as { content_json: string } | undefined;
  if (structure) values.push(JSON.parse(structure.content_json));
  const entities = database.prepare(`SELECT versions.content_json
    FROM passage_entity_heads heads JOIN passage_entity_versions versions ON versions.id = heads.version_id
    WHERE heads.project_id = ? AND heads.tombstoned = 0`).all(projectId) as Array<{ content_json: string }>;
  values.push(...entities.map((row) => JSON.parse(row.content_json)));
  const artifacts = database.prepare(`SELECT artifact_id, version, content_json FROM artifact_versions
    WHERE project_id = ? AND artifact_id IN ('bible', 'routes', 'endings', 'mechanics')
    ORDER BY artifact_id, version DESC`).all(projectId) as Array<{ artifact_id: string; version: number; content_json: string }>;
  const seen = new Set<string>();
  for (const row of artifacts) {
    if (seen.has(row.artifact_id)) continue;
    seen.add(row.artifact_id);
    values.push(JSON.parse(row.content_json));
  }
  return collectStableIds(values);
}

function captureCanonicalState(database: StoryDatabase): CanonicalState {
  return {
    structureVersions: rowsBy(database, `SELECT id, project_id, version, content_json, restored_from_version_id, created_at
      FROM passage_structure_versions ORDER BY id`, (row) => String(row.id)),
    structureHeads: rowsBy(database, `SELECT project_id, version_id FROM passage_structure_heads ORDER BY project_id`,
      (row) => String(row.project_id)),
    entityVersions: rowsBy(database, `SELECT id, project_id, entity_kind, entity_id, version, content_json,
        restored_from_version_id, created_at FROM passage_entity_versions ORDER BY id`, (row) => String(row.id)),
    entityHeads: rowsBy(database, `SELECT project_id, entity_kind, entity_id, version_id, tombstoned
      FROM passage_entity_heads ORDER BY project_id, entity_kind, entity_id`, entityHeadKey),
    artifactVersions: rowsBy(database, `SELECT id, project_id, artifact_id, artifact_type, version, schema_version,
        content_json, restored_from_version_id, created_at FROM artifact_versions ORDER BY id`, (row) => String(row.id)),
    artifactStaleFlags: rowsBy(database, `SELECT id, project_id, artifact_id, version, stale
      FROM artifact_versions ORDER BY id`, (row) => String(row.id)),
    artifactWorkflow: rowsBy(database, `SELECT project_id, artifact_id, status, approved_version_id
      FROM artifact_workflow_state ORDER BY project_id, artifact_id`, workflowKey),
    artifactDependencies: rowsBy(database, `SELECT project_id, upstream_artifact_id, dependent_artifact_id
      FROM artifact_dependencies ORDER BY project_id, upstream_artifact_id, dependent_artifact_id`, dependencyKey),
    passagePlanState: rowsBy(database, `SELECT project_id, status, approved_snapshot_id
      FROM passage_plan_state ORDER BY project_id`, (row) => String(row.project_id)),
    draftVersions: rowsBy(database, `SELECT id, project_id, passage_id, version, based_on_passage_plan_version_id,
        prose_markdown, word_count, lifecycle_status, source_kind, generation_plan_id, generation_job_id,
        generation_unit_id, author_note, restored_from_version_id, created_at FROM passage_draft_versions ORDER BY id`,
      (row) => String(row.id)),
    draftUpstream: rowsBy(database, `SELECT draft_version_id, project_id, artifact_id, artifact_version_id
      FROM passage_draft_upstream_artifacts ORDER BY draft_version_id, artifact_id`,
      (row) => `${String(row.draft_version_id)}:${String(row.artifact_id)}`),
    draftNeighbors: rowsBy(database, `SELECT draft_version_id, project_id, neighbor_passage_id, neighbor_draft_version_id
      FROM passage_draft_neighbor_versions ORDER BY draft_version_id, neighbor_passage_id`,
      (row) => `${String(row.draft_version_id)}:${String(row.neighbor_passage_id)}`),
    draftHeads: rowsBy(database, `SELECT project_id, passage_id, current_version_id, accepted_version_id, accepted_locked
      FROM passage_draft_heads ORDER BY project_id, passage_id`, draftHeadKey),
    draftStalenessEvents: rowsBy(database, `SELECT id, project_id, passage_id, draft_version_id, reason_code,
        source_entity_kind, source_entity_id, from_version_id, to_version_id, changed_fields_json, created_at
      FROM passage_draft_staleness_events ORDER BY id`, (row) => String(row.id)),
  };
}

function assertCanonicalMutationFootprint(
  database: StoryDatabase,
  before: CanonicalState,
  record: RepairApplicationRecord,
  operations: RepairProposalOperation[],
): void {
  const after = captureCanonicalState(database);
  assertRowsUnchanged(before.structureVersions, after.structureVersions, "passage structure versions");
  assertRowsUnchanged(before.structureHeads, after.structureHeads, "passage structure heads");

  const resultByOperation = new Map(record.resultingVersions.map((result) => [result.operationId, result]));
  const entityVersionIds = new Set<string>();
  const artifactVersionIds = new Set<string>();
  const draftVersionIds = new Set<string>();
  const draftUpstreamKeys = new Set<string>();
  const draftNeighborKeys = new Set<string>();
  const expectedEntityHeads = cloneRows(before.entityHeads);
  const expectedDraftHeads = cloneRows(before.draftHeads);
  for (const operation of operations) {
    const result = resultByOperation.get(operation.id);
    if (!result) throw new Error("Repair application canonical mutation result is missing");
    if (["passage", "choice", "thread"].includes(operation.entityKind)) {
      entityVersionIds.add(result.versionId);
      const row = {
        project_id: record.projectId, entity_kind: operation.entityKind, entity_id: operation.entityId,
        version_id: result.versionId, tombstoned: 0,
      };
      expectedEntityHeads.set(entityHeadKey(row), row);
    } else if (operation.kind === "create-passage-draft-candidate") {
      draftVersionIds.add(result.versionId);
      if (operation.expectedBase.kind !== "passage-prose-head") throw new Error("Repair application draft footprint base is invalid");
      Object.keys(operation.expectedBase.upstreamVersions).forEach((artifactId) => draftUpstreamKeys.add(`${result.versionId}:${artifactId}`));
      Object.keys(operation.expectedBase.neighboringDraftVersions).forEach((passageId) => draftNeighborKeys.add(`${result.versionId}:${passageId}`));
      const key = draftHeadKey({ project_id: record.projectId, passage_id: operation.entityId });
      const previous = before.draftHeads.get(key);
      expectedDraftHeads.set(key, {
        project_id: record.projectId,
        passage_id: operation.entityId,
        current_version_id: result.versionId,
        accepted_version_id: previous?.accepted_version_id ?? null,
        accepted_locked: previous?.accepted_locked ?? 0,
      });
    } else if (operation.expectedBase?.kind === "artifact-entity-version") {
      artifactVersionIds.add(result.versionId);
    }
  }
  assertAppendOnlyRows(before.entityVersions, after.entityVersions, entityVersionIds, "passage entity versions");
  assertExactRows(expectedEntityHeads, after.entityHeads, "passage entity heads");
  assertAppendOnlyRows(before.artifactVersions, after.artifactVersions, artifactVersionIds, "artifact versions");
  assertAppendOnlyRows(before.draftVersions, after.draftVersions, draftVersionIds, "passage draft versions");
  assertAppendOnlyRows(before.draftUpstream, after.draftUpstream, draftUpstreamKeys, "passage draft upstream provenance");
  assertAppendOnlyRows(before.draftNeighbors, after.draftNeighbors, draftNeighborKeys, "passage draft neighbor provenance");
  assertExactRows(expectedDraftHeads, after.draftHeads, "passage draft heads");
  assertSecondaryMutationFootprint(database, before, after, record, operations, artifactVersionIds);
}

function rowsBy(database: StoryDatabase, sql: string, key: (row: CanonicalRow) => string): CanonicalRows {
  const result = new Map<string, CanonicalRow>();
  for (const row of database.prepare(sql).all() as CanonicalRow[]) result.set(key(row), row);
  return result;
}

function cloneRows(rows: CanonicalRows): CanonicalRows {
  return new Map([...rows].map(([key, row]) => [key, { ...row }]));
}

function entityHeadKey(row: CanonicalRow): string {
  return `${String(row.project_id)}:${String(row.entity_kind)}:${String(row.entity_id)}`;
}

function draftHeadKey(row: CanonicalRow): string {
  return `${String(row.project_id)}:${String(row.passage_id)}`;
}

function workflowKey(row: CanonicalRow): string {
  return `${String(row.project_id)}:${String(row.artifact_id)}`;
}

function dependencyKey(row: CanonicalRow): string {
  return `${String(row.project_id)}:${String(row.upstream_artifact_id)}:${String(row.dependent_artifact_id)}`;
}

function assertSecondaryMutationFootprint(
  database: StoryDatabase,
  before: CanonicalState,
  after: CanonicalState,
  record: RepairApplicationRecord,
  operations: RepairProposalOperation[],
  artifactVersionIds: Set<string>,
): void {
  const expectedWorkflow = cloneRows(before.artifactWorkflow);
  const expectedPassagePlanState = cloneRows(before.passagePlanState);
  const expectedDependencies = cloneRows(before.artifactDependencies);
  const expectedStaleFlags = cloneRows(before.artifactStaleFlags);
  const newArtifactStaleFlags = new Map<string, CanonicalRow>();
  for (const versionId of artifactVersionIds) {
    const row = after.artifactStaleFlags.get(versionId);
    if (!row) throw new Error("Repair application artifact stale-state result is missing");
    newArtifactStaleFlags.set(versionId, { ...row, stale: 0 });
  }

  const passageOperations = operations.filter((operation) => operation.kind !== "create-passage-draft-candidate"
    && ["passage", "choice", "thread"].includes(operation.entityKind));
  if (passageOperations.length) setPassagePlanState(expectedPassagePlanState, record.projectId, "draft");

  const affectedArtifacts = [...new Set(operations.flatMap((operation) =>
    operation.expectedBase?.kind === "artifact-entity-version" ? [operation.expectedBase.artifactId] : []))].sort();
  for (const artifactId of affectedArtifacts) {
    for (const [versionId, row] of newArtifactStaleFlags) {
      if (row.artifact_id === artifactId) expectedStaleFlags.set(versionId, row);
    }
    for (const upstream of expectedArtifactDependencies(artifactId)) {
      const row = { project_id: record.projectId, upstream_artifact_id: upstream, dependent_artifact_id: artifactId };
      expectedDependencies.set(dependencyKey(row), row);
    }
    setWorkflowState(expectedWorkflow, record.projectId, artifactId, "draft");
    for (const dependent of transitiveDependents(expectedDependencies, record.projectId, artifactId)) {
      const latest = latestArtifactVersion(expectedStaleFlags, record.projectId, dependent);
      if (latest) expectedStaleFlags.set(String(latest.id), { ...latest, stale: 1 });
      setWorkflowState(expectedWorkflow, record.projectId, dependent, "stale");
    }
    setPassagePlanState(expectedPassagePlanState, record.projectId, "stale");
  }

  assertExactRows(expectedWorkflow, after.artifactWorkflow, "artifact workflow state");
  assertExactRows(expectedPassagePlanState, after.passagePlanState, "passage-plan state");
  assertExactRows(expectedDependencies, after.artifactDependencies, "artifact dependencies");
  assertExactRows(expectedStaleFlags, after.artifactStaleFlags, "artifact stale flags");
  assertDraftStalenessFootprint(database, before, after, record, passageOperations);
}

function expectedArtifactDependencies(artifactId: string): string[] {
  const configured = REPAIR_APPLICATION_ARTIFACT_DEPENDENCIES[
    artifactId as keyof typeof REPAIR_APPLICATION_ARTIFACT_DEPENDENCIES
  ] ?? [];
  const chainIndex = artifactChain.indexOf(artifactId as typeof artifactChain[number]);
  return [...new Set([...configured, ...(chainIndex > 0 ? [artifactChain[chainIndex - 1]!] : [])])].sort();
}

function setWorkflowState(rows: CanonicalRows, projectId: string, artifactId: string, status: string): void {
  const key = `${projectId}:${artifactId}`;
  const previous = rows.get(key);
  rows.set(key, {
    project_id: projectId,
    artifact_id: artifactId,
    status,
    approved_version_id: previous?.approved_version_id ?? null,
  });
}

function setPassagePlanState(rows: CanonicalRows, projectId: string, status: string): void {
  const previous = rows.get(projectId);
  rows.set(projectId, {
    project_id: projectId,
    status,
    approved_snapshot_id: previous?.approved_snapshot_id ?? null,
  });
}

function transitiveDependents(rows: CanonicalRows, projectId: string, artifactId: string): string[] {
  const stale = new Set<string>();
  const queue = [artifactId];
  while (queue.length) {
    const upstream = queue.shift()!;
    const dependents = [...rows.values()]
      .filter((row) => row.project_id === projectId && row.upstream_artifact_id === upstream)
      .map((row) => String(row.dependent_artifact_id)).sort();
    for (const dependent of dependents) {
      if (stale.has(dependent)) continue;
      stale.add(dependent);
      queue.push(dependent);
    }
  }
  return [...stale].sort();
}

function latestArtifactVersion(rows: CanonicalRows, projectId: string, artifactId: string): CanonicalRow | undefined {
  return [...rows.values()]
    .filter((row) => row.project_id === projectId && row.artifact_id === artifactId)
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
}

interface ExpectedStalenessEvent {
  project_id: string;
  passage_id: string;
  draft_version_id: string;
  reason_code: string;
  source_entity_kind: string;
  source_entity_id: string;
  from_version_id: string | null;
  to_version_id: string | null;
  changed_fields_json: string;
}

function assertDraftStalenessFootprint(
  database: StoryDatabase,
  before: CanonicalState,
  after: CanonicalState,
  record: RepairApplicationRecord,
  operations: RepairProposalOperation[],
): void {
  for (const [id, row] of before.draftStalenessEvents) {
    if (canonical(after.draftStalenessEvents.get(id)) !== canonical(row)) {
      throw new Error("Repair application made an unauthorized canonical mutation to passage draft staleness events");
    }
  }
  const expected = expectedDraftStalenessEvents(database, before, record, operations);
  const actual = [...after.draftStalenessEvents]
    .filter(([id]) => !before.draftStalenessEvents.has(id))
    .map(([, row]) => stalenessSemantics(row));
  if (canonical(actual.map(canonical).sort()) !== canonical(expected.map(canonical).sort())) {
    throw new Error("Repair application made an unauthorized canonical mutation to passage draft staleness events");
  }
  const actualAudit = [...after.draftStalenessEvents]
    .filter(([id]) => !before.draftStalenessEvents.has(id))
    .map(([id, row]) => ({
      id,
      reasonCode: row.reason_code,
      sourceEntityKind: row.source_entity_kind,
      sourceEntityId: row.source_entity_id,
      draftVersionId: row.draft_version_id,
      passageId: row.passage_id,
    }));
  if (canonical(actualAudit.map(canonical).sort()) !== canonical(record.stalenessEvents.map(canonical).sort())) {
    throw new Error("Repair application staleness audit does not match its exact persisted events");
  }
}

function expectedDraftStalenessEvents(
  database: StoryDatabase,
  before: CanonicalState,
  record: RepairApplicationRecord,
  operations: RepairProposalOperation[],
): ExpectedStalenessEvent[] {
  const expected: ExpectedStalenessEvent[] = [];
  const existingKeys = new Set([...before.draftStalenessEvents.values()].map(stalenessUniqueKey));
  const resultByOperation = new Map(record.resultingVersions.map((result) => [result.operationId, result]));
  const drafts = new PassageDraftRepository(database);
  const add = (event: ExpectedStalenessEvent): boolean => {
    const key = stalenessUniqueKey(event);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    expected.push(event);
    return true;
  };
  const isStale = (draftVersionId: string): boolean => [...before.draftStalenessEvents.values()]
    .some((row) => row.draft_version_id === draftVersionId)
    || expected.some((row) => row.draft_version_id === draftVersionId);

  for (const operation of operations) {
    const result = resultByOperation.get(operation.id);
    if (!result) throw new Error("Repair application staleness result is missing");
    const beforeValue = operation.kind === "add-entity" ? null : operation.before;
    const fromVersionId = operation.kind === "add-entity" ? null
      : operation.expectedBase.kind === "passage-entity-version" ? operation.expectedBase.versionId : null;
    const impacts = classifyPassageDraftStaleness({
      projectId: record.projectId,
      kind: operation.entityKind as "passage" | "choice" | "thread",
      entityId: operation.entityId,
      beforeVersionId: fromVersionId,
      afterVersionId: result.versionId,
      before: beforeValue,
      after: operation.after,
    });
    const affectedPassages = new Set<string>();
    for (const impact of impacts) {
      for (const row of before.draftVersions.values()) {
        if (row.project_id !== record.projectId || row.passage_id !== impact.passageId
          || row.based_on_passage_plan_version_id === result.versionId) continue;
        add({
          project_id: record.projectId,
          passage_id: impact.passageId,
          draft_version_id: String(row.id),
          reason_code: impact.reasonCode,
          source_entity_kind: operation.entityKind,
          source_entity_id: operation.entityId,
          from_version_id: fromVersionId,
          to_version_id: result.versionId,
          changed_fields_json: JSON.stringify(impact.changedFields),
        });
      }
      affectedPassages.add(impact.passageId);
    }
    for (const passageId of [...affectedPassages].sort()) {
      const head = before.draftHeads.get(`${record.projectId}:${passageId}`);
      const acceptedVersionId = head?.accepted_version_id ? String(head.accepted_version_id) : null;
      if (!acceptedVersionId || !isStale(acceptedVersionId)) continue;
      const queue = [{ passageId, acceptedVersionId }];
      const visited = new Set<string>();
      while (queue.length) {
        const source = queue.shift()!;
        const key = `${source.passageId}:${source.acceptedVersionId}`;
        if (visited.has(key)) continue;
        visited.add(key);
        for (const neighbor of [...before.draftNeighbors.values()]
          .filter((row) => row.project_id === record.projectId && row.neighbor_passage_id === source.passageId)
          .sort((left, right) => `${left.draft_version_id}`.localeCompare(`${right.draft_version_id}`))) {
          if (!drafts.acceptedVersionsAreEquivalent(
            record.projectId, String(neighbor.neighbor_draft_version_id), source.acceptedVersionId,
          )) continue;
          const dependent = before.draftVersions.get(String(neighbor.draft_version_id));
          if (!dependent) continue;
          add({
            project_id: record.projectId,
            passage_id: String(dependent.passage_id),
            draft_version_id: String(dependent.id),
            reason_code: "accepted-neighbor-draft-stale",
            source_entity_kind: "accepted-passage-draft",
            source_entity_id: source.passageId,
            from_version_id: String(neighbor.neighbor_draft_version_id),
            to_version_id: source.acceptedVersionId,
            changed_fields_json: JSON.stringify(["stale"]),
          });
          const dependentHead = before.draftHeads.get(`${record.projectId}:${String(dependent.passage_id)}`);
          if (dependentHead?.accepted_version_id === dependent.id) queue.push({
            passageId: String(dependent.passage_id), acceptedVersionId: String(dependent.id),
          });
        }
      }
    }
  }
  return expected;
}

function stalenessUniqueKey(row: CanonicalRow | ExpectedStalenessEvent): string {
  return [row.draft_version_id, row.reason_code, row.source_entity_kind, row.source_entity_id, row.to_version_id]
    .map((value) => value === null ? "<null>" : String(value)).join(":");
}

function stalenessSemantics(row: CanonicalRow): ExpectedStalenessEvent {
  return {
    project_id: String(row.project_id),
    passage_id: String(row.passage_id),
    draft_version_id: String(row.draft_version_id),
    reason_code: String(row.reason_code),
    source_entity_kind: String(row.source_entity_kind),
    source_entity_id: String(row.source_entity_id),
    from_version_id: row.from_version_id === null ? null : String(row.from_version_id),
    to_version_id: row.to_version_id === null ? null : String(row.to_version_id),
    changed_fields_json: String(row.changed_fields_json),
  };
}

function assertRowsUnchanged(before: CanonicalRows, after: CanonicalRows, label: string): void {
  assertExactRows(before, after, label);
}

function assertAppendOnlyRows(before: CanonicalRows, after: CanonicalRows, allowedNewIds: Set<string>, label: string): void {
  for (const [key, row] of before) {
    if (canonical(after.get(key)) !== canonical(row)) throw new Error(`Repair application made an unauthorized canonical mutation to ${label}`);
  }
  const actualNewIds = new Set([...after.keys()].filter((key) => !before.has(key)));
  if (canonical([...actualNewIds].sort()) !== canonical([...allowedNewIds].sort())) {
    throw new Error(`Repair application made an unauthorized canonical mutation to ${label}`);
  }
}

function assertExactRows(expected: CanonicalRows, actual: CanonicalRows, label: string): void {
  if (expected.size !== actual.size) throw new Error(`Repair application made an unauthorized canonical mutation to ${label}`);
  for (const [key, row] of expected) {
    if (canonical(actual.get(key)) !== canonical(row)) throw new Error(`Repair application made an unauthorized canonical mutation to ${label}`);
  }
}

function assertOperationPreconditions(
  database: StoryDatabase,
  projectId: string,
  operations: RepairProposalOperation[],
): OperationPreconditions {
  const captured: OperationPreconditions = new Map();
  const artifactStates = new Map<string, { id: string; version: number; content: unknown }>();
  for (const operation of operations) {
    if (operation.kind === "add-entity") {
      const exists = database.prepare(`SELECT id FROM passage_entity_versions
        WHERE project_id = ? AND entity_kind = ? AND entity_id = ? LIMIT 1`)
        .get(projectId, operation.entityKind, operation.entityId);
      if (exists) throw new Error(`Generated ${operation.entityKind} ${operation.entityId} already exists`);
      captured.set(operation.id, { operationId: operation.id, baseVersionId: null, baseVersionNumber: null, artifactId: null, expectedArtifactContent: null });
      continue;
    }
    const expected = operation.expectedBase;
    if (operation.kind === "create-passage-draft-candidate") {
      if (expected.kind !== "passage-prose-head") throw new Error("Repair prose expected base is invalid");
      assertProseBaseCurrent(database, projectId, expected);
      captured.set(operation.id, { operationId: operation.id, baseVersionId: expected.currentDraftVersionId, baseVersionNumber: null, artifactId: null, expectedArtifactContent: null });
      continue;
    }
    if (expected.kind === "passage-entity-version") {
      const row = database.prepare(`SELECT versions.id, versions.version, versions.content_json, heads.version_id, heads.tombstoned
        FROM passage_entity_heads heads JOIN passage_entity_versions versions ON versions.id = heads.version_id
        WHERE heads.project_id = ? AND heads.entity_kind = ? AND heads.entity_id = ?`)
        .get(projectId, expected.entityKind, expected.entityId) as {
          id: string; version: number; content_json: string; version_id: string; tombstoned: number;
        } | undefined;
      if (!row || row.tombstoned || row.version_id !== expected.versionId || row.id !== expected.versionId
        || canonical(JSON.parse(row.content_json)) !== canonical(operation.before)) {
        throw new Error(`Repair application exact passage base changed for ${expected.targetKey}`);
      }
      captured.set(operation.id, { operationId: operation.id, baseVersionId: row.id, baseVersionNumber: row.version, artifactId: null, expectedArtifactContent: null });
      continue;
    }
    if (expected.kind !== "artifact-entity-version") throw new Error("Repair application operation base is invalid");
    const row = currentArtifact(database, projectId, expected.artifactId);
    const entity = row ? locateArtifactEntity(row.content, expected.entityType, expected.entityId) : undefined;
    if (!row || row.id !== expected.artifactVersionId || !entity
      || fingerprint(entity) !== expected.entityFingerprint
      || canonical(entity) !== canonical(operation.before)) {
      throw new Error(`Repair application exact artifact base changed for ${expected.targetKey}`);
    }
    const state = artifactStates.get(expected.artifactId);
    if (state && state.id !== row.id) throw new Error("Selected artifact operations do not share an exact base");
    artifactStates.set(expected.artifactId, state ?? row);
    captured.set(operation.id, {
      operationId: operation.id,
      baseVersionId: row.id,
      baseVersionNumber: row.version,
      artifactId: expected.artifactId,
      expectedArtifactContent: null,
    });
  }
  for (const [artifactId, initial] of artifactStates) {
    let expectedContent = structuredClone(initial.content);
    for (const operation of operations) {
      const precondition = captured.get(operation.id);
      if (precondition?.artifactId !== artifactId || operation.kind !== "update-entity") continue;
      expectedContent = replaceArtifactEntity(expectedContent, operation.entityKind, operation.entityId, operation.after);
    }
    for (const precondition of captured.values()) {
      if (precondition.artifactId === artifactId) precondition.expectedArtifactContent = expectedContent;
    }
  }
  return captured;
}

function assertOperationResult(
  database: StoryDatabase,
  projectId: string,
  operation: RepairProposalOperation,
  result: RepairApplicationRecord["resultingVersions"][number],
  preconditions: OperationPreconditions,
): void {
  if (!operation || result.entityKind !== operation.entityKind || result.entityId !== operation.entityId) {
    throw new Error("Repair application result does not identify its exact proposal operation");
  }
  const precondition = preconditions.get(operation.id);
  if (!precondition) throw new Error("Repair application operation precondition is missing");
  if (operation.kind === "create-passage-draft-candidate") return;
  if (operation.entityKind === "passage" || operation.entityKind === "choice" || operation.entityKind === "thread") {
    const row = database.prepare(`SELECT versions.id, versions.version, versions.content_json, heads.version_id, heads.tombstoned
      FROM passage_entity_versions versions
      JOIN passage_entity_heads heads ON heads.project_id = versions.project_id
        AND heads.entity_kind = versions.entity_kind AND heads.entity_id = versions.entity_id
      WHERE versions.project_id = ? AND versions.id = ? AND versions.entity_kind = ? AND versions.entity_id = ?`)
      .get(projectId, result.versionId, operation.entityKind, operation.entityId) as {
        id: string; version: number; content_json: string; version_id: string; tombstoned: number;
      } | undefined;
    if (!row || row.version_id !== result.versionId || row.tombstoned
      || canonical(JSON.parse(row.content_json)) !== canonical(operation.after)
      || (operation.kind === "update-entity" && (result.versionId === precondition.baseVersionId
        || row.version <= (precondition.baseVersionNumber ?? 0)))) {
      throw new Error(`Repair application result ${operation.id} is not the exact new current entity version`);
    }
    return;
  }
  const expected = operation.expectedBase;
  if (expected?.kind !== "artifact-entity-version" || !precondition.artifactId) {
    throw new Error("Repair application artifact result base is invalid");
  }
  const row = currentArtifact(database, projectId, precondition.artifactId);
  const resultRow = database.prepare(`SELECT id, project_id, artifact_id, version, content_json
    FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_id = ?`)
    .get(projectId, result.versionId, precondition.artifactId) as {
      id: string; project_id: string; artifact_id: string; version: number; content_json: string;
    } | undefined;
  if (!row || !resultRow || row.id !== result.versionId || result.versionId === precondition.baseVersionId
    || resultRow.version <= (precondition.baseVersionNumber ?? 0)
    || canonical(resultRow.content_json ? JSON.parse(resultRow.content_json) : null) !== canonical(precondition.expectedArtifactContent)
    || canonical(row.content) !== canonical(precondition.expectedArtifactContent)
    || canonical(locateArtifactEntity(row.content, expected.entityType, expected.entityId)) !== canonical(operation.after)) {
    throw new Error(`Repair application result ${operation.id} is not the exact new current artifact version`);
  }
}

function assertProseBaseCurrent(database: StoryDatabase, projectId: string, expected: Extract<RepairExpectedBase, { kind: "passage-prose-head" }>): void {
  const passageHead = database.prepare(`SELECT version_id, tombstoned FROM passage_entity_heads
    WHERE project_id = ? AND entity_kind = 'passage' AND entity_id = ?`)
    .get(projectId, expected.passageId) as { version_id: string; tombstoned: number } | undefined;
  const head = database.prepare(`SELECT current_version_id, accepted_version_id, accepted_locked
    FROM passage_draft_heads WHERE project_id = ? AND passage_id = ?`)
    .get(projectId, expected.passageId) as { current_version_id: string; accepted_version_id: string | null; accepted_locked: number } | undefined;
  const accepted = head?.accepted_version_id ? database.prepare(`SELECT lifecycle_status FROM passage_draft_versions
    WHERE project_id = ? AND id = ? AND passage_id = ?`).get(projectId, head.accepted_version_id, expected.passageId) as { lifecycle_status: string } | undefined : undefined;
  const acceptedStale = head?.accepted_version_id ? Boolean(database.prepare(`SELECT 1 FROM passage_draft_staleness_events
    WHERE project_id = ? AND draft_version_id = ? LIMIT 1`).get(projectId, head.accepted_version_id)) : false;
  const acceptedUpstream = head?.accepted_version_id ? draftUpstream(database, projectId, head.accepted_version_id) : {};
  const acceptedNeighbors = head?.accepted_version_id ? draftNeighbors(database, projectId, head.accepted_version_id) : {};
  if (!passageHead || passageHead.tombstoned || passageHead.version_id !== expected.passagePlanVersionId
    || (head?.current_version_id ?? null) !== expected.currentDraftVersionId
    || (head?.accepted_version_id ?? null) !== expected.acceptedDraftVersionId
    || (accepted?.lifecycle_status ?? null) !== expected.acceptedLifecycleStatus
    || Boolean(head?.accepted_locked) !== expected.acceptedLocked
    || acceptedStale !== expected.acceptedStale
    || canonical(acceptedUpstream) !== canonical(expected.upstreamVersions)
    || canonical(acceptedNeighbors) !== canonical(expected.neighboringDraftVersions)) {
    throw new Error(`Repair application exact prose head changed for ${expected.targetKey}`);
  }
}

function assertDraftResult(
  database: StoryDatabase,
  projectId: string,
  operation: Extract<RepairProposalOperation, { kind: "create-passage-draft-candidate" }>,
  versionId: string,
  provenance: RepairDraftProvenance,
  preconditions: OperationPreconditions,
): void {
  const expected = operation.expectedBase;
  if (expected.kind !== "passage-prose-head" || !preconditions.has(operation.id)) throw new Error("Repair draft result base is invalid");
  const row = database.prepare(`SELECT drafts.project_id, drafts.passage_id, drafts.based_on_passage_plan_version_id,
      drafts.prose_markdown, drafts.lifecycle_status, drafts.source_kind, heads.current_version_id,
      heads.accepted_version_id, heads.accepted_locked
    FROM passage_draft_versions drafts JOIN passage_draft_heads heads
      ON heads.project_id = drafts.project_id AND heads.passage_id = drafts.passage_id
    WHERE drafts.project_id = ? AND drafts.id = ? AND drafts.passage_id = ?`)
    .get(projectId, versionId, operation.entityId) as {
      project_id: string; passage_id: string; based_on_passage_plan_version_id: string; prose_markdown: string;
      lifecycle_status: string; source_kind: string; current_version_id: string; accepted_version_id: string | null; accepted_locked: number;
    } | undefined;
  if (!row || row.current_version_id !== versionId || row.lifecycle_status !== "candidate" || row.source_kind !== "manual"
    || row.based_on_passage_plan_version_id !== provenance.passagePlanBaseVersionId
    || row.prose_markdown !== operation.after.proposedProse
    || row.accepted_version_id !== expected.acceptedDraftVersionId
    || Boolean(row.accepted_locked) !== expected.acceptedLocked
    || canonical(draftUpstream(database, projectId, versionId)) !== canonical(provenance.upstreamVersions)
    || canonical(draftNeighbors(database, projectId, versionId)) !== canonical(provenance.neighboringDraftVersions)) {
    throw new Error("Repair application draft candidate does not match its exact proposal operation and provenance");
  }
}

function currentArtifact(database: StoryDatabase, projectId: string, artifactId: string): { id: string; version: number; content: unknown } | undefined {
  const row = database.prepare(`SELECT id, version, content_json FROM artifact_versions
    WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1`)
    .get(projectId, artifactId) as { id: string; version: number; content_json: string } | undefined;
  return row ? { id: row.id, version: row.version, content: JSON.parse(row.content_json) } : undefined;
}

function draftUpstream(database: StoryDatabase, projectId: string, draftVersionId: string): Record<string, string> {
  const rows = database.prepare(`SELECT artifact_id, artifact_version_id FROM passage_draft_upstream_artifacts
    WHERE project_id = ? AND draft_version_id = ? ORDER BY artifact_id`).all(projectId, draftVersionId) as Array<{ artifact_id: string; artifact_version_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.artifact_id, row.artifact_version_id]));
}

function draftNeighbors(database: StoryDatabase, projectId: string, draftVersionId: string): Record<string, string> {
  const rows = database.prepare(`SELECT neighbor_passage_id, neighbor_draft_version_id FROM passage_draft_neighbor_versions
    WHERE project_id = ? AND draft_version_id = ? ORDER BY neighbor_passage_id`).all(projectId, draftVersionId) as Array<{ neighbor_passage_id: string; neighbor_draft_version_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.neighbor_passage_id, row.neighbor_draft_version_id]));
}

function locateArtifactEntity(artifact: unknown, entityType: string, entityId: string): unknown {
  if (!artifact || typeof artifact !== "object") return undefined;
  const value = artifact as Record<string, unknown>;
  if (entityType === "mechanic") {
    const mechanics = [value.visibleStats, value.relationships, value.flags, value.resources]
      .flatMap((items) => Array.isArray(items) ? items : []);
    return mechanics.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).key === entityId);
  }
  const key = artifactCollection(entityType);
  const collection = key ? value[key] : undefined;
  return Array.isArray(collection)
    ? collection.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === entityId)
    : undefined;
}

function replaceArtifactEntity(artifact: unknown, entityType: string, entityId: string, replacement: unknown): unknown {
  const next = structuredClone(artifact) as Record<string, unknown>;
  if (entityType === "mechanic") {
    for (const key of ["visibleStats", "relationships", "flags", "resources"]) {
      const collection = next[key];
      if (!Array.isArray(collection)) continue;
      const index = collection.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).key === entityId);
      if (index >= 0) { collection[index] = structuredClone(replacement); return next; }
    }
    throw new Error(`Repair application mechanic ${entityId} is missing from its exact base`);
  }
  const key = artifactCollection(entityType);
  const collection = key ? next[key] : undefined;
  if (!Array.isArray(collection)) throw new Error(`Repair application artifact entity type ${entityType} is unsupported`);
  const index = collection.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === entityId);
  if (index < 0) throw new Error(`Repair application artifact entity ${entityId} is missing from its exact base`);
  collection[index] = structuredClone(replacement);
  return next;
}

function artifactCollection(entityType: string): string | null {
  if (entityType === "relationship") return "relationships";
  if (entityType === "canon-fact") return "canonFacts";
  if (entityType === "route") return "routes";
  if (entityType === "route-act") return "acts";
  if (entityType === "route-decision") return "decisionPoints";
  if (entityType === "route-reconvergence") return "reconvergences";
  if (entityType === "route-ending-hook") return "endingHooks";
  if (entityType === "ending") return "endings";
  return null;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
