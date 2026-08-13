import { createHash } from "node:crypto";
import {
  REPAIR_APPLICATION_POLICY_V1,
  RepairApplicationRecordSchema,
  RepairDraftProvenanceSchema,
  repairApplicationDefinitionFromRecord,
  type RepairApplicationRecord,
  type RepairDraftProvenance,
  type RepairExpectedBase,
  type RepairProposalOperation,
  type RepairProposalRecord,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { RepairProposalRepository } from "./repair-proposal-repository.js";

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
      const preconditions = assertOperationPreconditions(this.database, input.projectId, operations);
      const result = input.mutateInTransaction(proposalVersion.content, selection);
      const record = RepairApplicationRecordSchema.parse(result.application);
      if (Buffer.byteLength(JSON.stringify(record), "utf8") > REPAIR_APPLICATION_POLICY_V1.maxAuditBytes) {
        throw new Error("Repair application audit exceeds its saved byte limit");
      }
      assertApplicationIdentity(record, input, proposalVersion.content, selection);
      assertOperationResults(this.database, record, proposalVersion.content, operations, preconditions, result.draftLinks);
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
