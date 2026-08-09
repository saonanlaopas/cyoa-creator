import { randomUUID } from "node:crypto";
import { transaction, type StoryDatabase } from "./database.js";
import type { PassageEntityKind } from "./passage-plan-repository.js";

export type PassageProposalStatus = "proposed" | "applied" | "rejected" | "stale";
export type PassageProposalOperationKind = "add-entity" | "update-entity";

export interface PassageProposalCandidateRecord {
  candidateId: string;
  attemptId: string;
  unitId: string;
  unitPosition: number;
  inputFingerprint: string;
  contextFingerprint: string;
  candidateFingerprint: string;
}

export interface PassageProposalOperationRecord {
  id: string;
  groupId: string;
  position: number;
  kind: PassageProposalOperationKind;
  entityKind: PassageEntityKind;
  entityId: string;
  baseVersionId: string | null;
  before: unknown | null;
  after: unknown;
  fieldDiffs: unknown[];
  sourceCandidateIds: string[];
}

export interface PassageProposalGroupRecord {
  id: string;
  unitId: string;
  position: number;
  label: string;
  summary: string;
  operationIds: string[];
  dependsOnGroupIds: string[];
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  validationFindingIds: string[];
  safeToApplyIndependently: boolean;
  status: PassageProposalStatus;
  operations: PassageProposalOperationRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PassageProposalSetRecord {
  id: string;
  projectId: string;
  generationPlanId: string;
  generationJobId: string;
  generationPlanFingerprint: string;
  snapshotId: string;
  proposalSchemaId: string;
  proposalSchemaVersion: number;
  candidateIds: string[];
  candidates: PassageProposalCandidateRecord[];
  consolidationFingerprint: string;
  status: PassageProposalStatus;
  groups: PassageProposalGroupRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PassageProposalPreviewRecord {
  id: string;
  projectId: string;
  proposalId: string;
  selectedGroupIds: string[];
  selectedOperationIds: string[];
  headVersions: Record<string, string | null>;
  validation: unknown;
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  beforeAfter: unknown[];
  previewFingerprint: string;
  valid: boolean;
  createdAt: string;
}

export interface PassageProposalApplicationRecord {
  id: string;
  projectId: string;
  proposalId: string;
  selectedGroupIds: string[];
  appliedOperationIds: string[];
  candidateProvenance: PassageProposalCandidateRecord[];
  previousVersionIds: Record<string, string | null>;
  resultingVersionIds: Record<string, string>;
  affectedEntityIds: string[];
  validationPreviewFingerprint: string;
  validation: unknown;
  downstreamInvalidations: string[];
  createdAt: string;
}

type SetRow = {
  id: string; project_id: string; generation_plan_id: string; generation_job_id: string;
  generation_plan_fingerprint: string; passage_snapshot_id: string; proposal_schema_id: string;
  proposal_schema_version: number; candidate_ids_json: string; candidate_provenance_json: string;
  consolidation_fingerprint: string; status: PassageProposalStatus; created_at: string; updated_at: string;
};
type GroupRow = {
  id: string; proposal_id: string; project_id: string; position: number; generation_unit_id: string;
  label: string; summary: string; operation_ids_json: string; depends_on_group_ids_json: string;
  affected_entity_ids_json: string; downstream_invalidations_json: string;
  validation_finding_ids_json: string; safe_independently: number; status: PassageProposalStatus;
  created_at: string; updated_at: string;
};
type OperationRow = {
  id: string; proposal_id: string; project_id: string; group_id: string; position: number;
  operation_kind: PassageProposalOperationKind; entity_kind: PassageEntityKind; entity_id: string;
  base_version_id: string | null; before_json: string | null; after_json: string;
  field_diffs_json: string; source_candidate_ids_json: string;
};
type PreviewRow = {
  id: string; project_id: string; proposal_id: string; selected_group_ids_json: string;
  selected_operation_ids_json: string; head_versions_json: string; validation_json: string;
  affected_entity_ids_json: string; downstream_invalidations_json: string; before_after_json: string;
  preview_fingerprint: string; valid: number; created_at: string;
};
type ApplicationRow = {
  id: string; project_id: string; proposal_id: string; selected_group_ids_json: string;
  applied_operation_ids_json: string; candidate_provenance_json: string;
  previous_version_ids_json: string; resulting_version_ids_json: string;
  affected_entity_ids_json: string; validation_preview_fingerprint: string;
  validation_json: string; downstream_invalidations_json: string; created_at: string;
};

export class PassageProposalRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create(input: {
    id: string;
    projectId: string;
    generationPlanId: string;
    generationJobId: string;
    generationPlanFingerprint: string;
    snapshotId: string;
    proposalSchemaId: string;
    proposalSchemaVersion: number;
    candidates: PassageProposalCandidateRecord[];
    consolidationFingerprint: string;
    groups: Array<Omit<PassageProposalGroupRecord, "status" | "operations" | "createdAt" | "updatedAt">>;
    operations: Array<Omit<PassageProposalOperationRecord, "groupId" | "position">>;
  }): PassageProposalSetRecord {
    const existing = this.getByJob(input.projectId, input.generationJobId);
    if (existing) {
      if (existing.consolidationFingerprint !== input.consolidationFingerprint) {
        throw new Error("Generation job already has a different immutable proposal consolidation");
      }
      return existing;
    }
    return transaction(this.database, () => {
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO passage_proposal_sets (
        id, project_id, generation_plan_id, generation_job_id, generation_plan_fingerprint,
        passage_snapshot_id, proposal_schema_id, proposal_schema_version, candidate_ids_json,
        candidate_provenance_json, consolidation_fingerprint, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`)
        .run(
          input.id, input.projectId, input.generationPlanId, input.generationJobId,
          input.generationPlanFingerprint, input.snapshotId, input.proposalSchemaId,
          input.proposalSchemaVersion, JSON.stringify(input.candidates.map((item) => item.candidateId)),
          JSON.stringify(input.candidates), input.consolidationFingerprint, now, now,
        );
      const insertCandidate = this.database.prepare(`INSERT INTO passage_proposal_candidates (
        proposal_id, project_id, candidate_id, generation_job_id, generation_unit_id,
        unit_position, attempt_id, input_fingerprint, context_fingerprint, candidate_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      input.candidates.forEach((candidate) => insertCandidate.run(
        input.id, input.projectId, candidate.candidateId, input.generationJobId, candidate.unitId,
        candidate.unitPosition, candidate.attemptId, candidate.inputFingerprint,
        candidate.contextFingerprint, candidate.candidateFingerprint,
      ));
      const insertGroup = this.database.prepare(`INSERT INTO passage_proposal_groups (
        proposal_id, project_id, id, position, generation_unit_id, label, summary,
        operation_ids_json, depends_on_group_ids_json, affected_entity_ids_json,
        downstream_invalidations_json, validation_finding_ids_json, safe_independently,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`);
      input.groups.forEach((group) => insertGroup.run(
        input.id, input.projectId, group.id, group.position, group.unitId, group.label, group.summary,
        JSON.stringify(group.operationIds), JSON.stringify(group.dependsOnGroupIds),
        JSON.stringify(group.affectedEntityIds), JSON.stringify(group.downstreamInvalidations),
        JSON.stringify(group.validationFindingIds), group.safeToApplyIndependently ? 1 : 0, now, now,
      ));
      const groupByOperation = new Map(input.groups.flatMap((group) =>
        group.operationIds.map((operationId) => [operationId, group.id] as const)));
      const groupOperationPosition = new Map(input.groups.flatMap((group) =>
        group.operationIds.map((operationId, position) => [operationId, position] as const)));
      const insertOperation = this.database.prepare(`INSERT INTO passage_proposal_operations (
        proposal_id, project_id, group_id, id, position, operation_kind, entity_kind,
        entity_id, base_version_id, before_json, after_json, field_diffs_json, source_candidate_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      input.operations.forEach((operation) => {
        const groupId = groupByOperation.get(operation.id);
        const position = groupOperationPosition.get(operation.id);
        if (groupId === undefined || position === undefined) {
          throw new Error(`Proposal operation ${operation.id} is not assigned to an immutable group`);
        }
        insertOperation.run(
          input.id, input.projectId, groupId, operation.id, position, operation.kind, operation.entityKind,
          operation.entityId, operation.baseVersionId,
          operation.before === null ? null : JSON.stringify(operation.before), JSON.stringify(operation.after),
          JSON.stringify(operation.fieldDiffs), JSON.stringify(operation.sourceCandidateIds),
        );
      });
      return this.get(input.projectId, input.id)!;
    });
  }

  get(projectId: string, proposalId: string): PassageProposalSetRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM passage_proposal_sets WHERE project_id = ? AND id = ?`)
      .get(projectId, proposalId) as SetRow | undefined;
    return row ? this.mapSet(row) : undefined;
  }

  getByJob(projectId: string, jobId: string): PassageProposalSetRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM passage_proposal_sets WHERE project_id = ? AND generation_job_id = ?`)
      .get(projectId, jobId) as SetRow | undefined;
    return row ? this.mapSet(row) : undefined;
  }

  list(projectId: string): PassageProposalSetRecord[] {
    return (this.database.prepare(`SELECT * FROM passage_proposal_sets
      WHERE project_id = ? ORDER BY created_at DESC, id DESC`).all(projectId) as SetRow[])
      .map((row) => this.mapSet(row));
  }

  savePreview(input: Omit<PassageProposalPreviewRecord, "id" | "createdAt">): PassageProposalPreviewRecord {
    const existing = this.getPreview(input.projectId, input.proposalId, input.previewFingerprint);
    if (existing) return existing;
    const id = `ppv_${input.previewFingerprint.slice(0, 32)}`;
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO passage_proposal_previews (
      id, project_id, proposal_id, selected_group_ids_json, selected_operation_ids_json,
      head_versions_json, validation_json, affected_entity_ids_json,
      downstream_invalidations_json, before_after_json, preview_fingerprint, valid, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, input.projectId, input.proposalId, JSON.stringify(input.selectedGroupIds),
        JSON.stringify(input.selectedOperationIds), JSON.stringify(input.headVersions),
        JSON.stringify(input.validation), JSON.stringify(input.affectedEntityIds),
        JSON.stringify(input.downstreamInvalidations), JSON.stringify(input.beforeAfter),
        input.previewFingerprint, input.valid ? 1 : 0, now,
      );
    return this.getPreview(input.projectId, input.proposalId, input.previewFingerprint)!;
  }

  getPreview(projectId: string, proposalId: string, fingerprint: string): PassageProposalPreviewRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM passage_proposal_previews
      WHERE project_id = ? AND proposal_id = ? AND preview_fingerprint = ?`)
      .get(projectId, proposalId, fingerprint) as PreviewRow | undefined;
    return row ? mapPreview(row) : undefined;
  }

  listApplications(projectId: string, proposalId: string): PassageProposalApplicationRecord[] {
    return (this.database.prepare(`SELECT * FROM passage_proposal_applications
      WHERE project_id = ? AND proposal_id = ? ORDER BY created_at, id`)
      .all(projectId, proposalId) as ApplicationRow[]).map(mapApplication);
  }

  rejectGroups(projectId: string, proposalId: string, groupIds: string[]): PassageProposalSetRecord {
    return transaction(this.database, () => {
      const proposal = this.get(projectId, proposalId);
      if (!proposal) throw new Error("Passage proposal not found");
      const selected = new Set(groupIds);
      if (!selected.size) throw new Error("Select at least one proposal group");
      if ([...selected].some((id) => !proposal.groups.some((group) => group.id === id))) {
        throw new Error("Unknown proposal group selected");
      }
      const now = new Date().toISOString();
      for (const group of proposal.groups.filter((item) => selected.has(item.id))) {
        if (group.status !== "proposed") throw new Error("Only pending proposal groups can be rejected");
        this.database.prepare(`UPDATE passage_proposal_groups SET status = 'rejected', updated_at = ?
          WHERE project_id = ? AND proposal_id = ? AND id = ?`).run(now, projectId, proposalId, group.id);
      }
      this.refreshSetStatus(projectId, proposalId, now);
      return this.get(projectId, proposalId)!;
    });
  }

  markGroupsApplied(projectId: string, proposalId: string, groupIds: string[], now: string): void {
    groupIds.forEach((groupId) => this.database.prepare(`UPDATE passage_proposal_groups
      SET status = 'applied', updated_at = ?
      WHERE project_id = ? AND proposal_id = ? AND id = ? AND status = 'proposed'`)
      .run(now, projectId, proposalId, groupId));
    this.refreshSetStatus(projectId, proposalId, now);
  }

  markGroupsStale(projectId: string, proposalId: string, groupIds: string[]): void {
    const now = new Date().toISOString();
    groupIds.forEach((groupId) => this.database.prepare(`UPDATE passage_proposal_groups
      SET status = 'stale', updated_at = ?
      WHERE project_id = ? AND proposal_id = ? AND id = ? AND status = 'proposed'`)
      .run(now, projectId, proposalId, groupId));
    this.database.prepare(`UPDATE passage_proposal_sets SET status = 'stale', updated_at = ?
      WHERE project_id = ? AND id = ?`).run(now, projectId, proposalId);
  }

  insertApplication(input: Omit<PassageProposalApplicationRecord, "id" | "createdAt">, now: string): string {
    const id = randomUUID();
    this.database.prepare(`INSERT INTO passage_proposal_applications (
      id, project_id, proposal_id, selected_group_ids_json, applied_operation_ids_json,
      candidate_provenance_json, previous_version_ids_json, resulting_version_ids_json,
      affected_entity_ids_json, validation_preview_fingerprint, validation_json,
      downstream_invalidations_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, input.projectId, input.proposalId, JSON.stringify(input.selectedGroupIds),
        JSON.stringify(input.appliedOperationIds), JSON.stringify(input.candidateProvenance),
        JSON.stringify(input.previousVersionIds), JSON.stringify(input.resultingVersionIds),
        JSON.stringify(input.affectedEntityIds), input.validationPreviewFingerprint,
        JSON.stringify(input.validation), JSON.stringify(input.downstreamInvalidations), now,
      );
    return id;
  }

  private mapSet(row: SetRow): PassageProposalSetRecord {
    const groups = (this.database.prepare(`SELECT * FROM passage_proposal_groups
      WHERE project_id = ? AND proposal_id = ? ORDER BY position, id`)
      .all(row.project_id, row.id) as GroupRow[]).map((group) => this.mapGroup(group));
    return {
      id: row.id, projectId: row.project_id, generationPlanId: row.generation_plan_id,
      generationJobId: row.generation_job_id, generationPlanFingerprint: row.generation_plan_fingerprint,
      snapshotId: row.passage_snapshot_id, proposalSchemaId: row.proposal_schema_id,
      proposalSchemaVersion: row.proposal_schema_version,
      candidateIds: JSON.parse(row.candidate_ids_json),
      candidates: JSON.parse(row.candidate_provenance_json),
      consolidationFingerprint: row.consolidation_fingerprint, status: row.status, groups,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private mapGroup(row: GroupRow): PassageProposalGroupRecord {
    const operations = (this.database.prepare(`SELECT * FROM passage_proposal_operations
      WHERE project_id = ? AND proposal_id = ? AND group_id = ? ORDER BY position, id`)
      .all(row.project_id, row.proposal_id, row.id) as OperationRow[]).map(mapOperation);
    return {
      id: row.id, unitId: row.generation_unit_id, position: row.position,
      label: row.label, summary: row.summary, operationIds: JSON.parse(row.operation_ids_json),
      dependsOnGroupIds: JSON.parse(row.depends_on_group_ids_json),
      affectedEntityIds: JSON.parse(row.affected_entity_ids_json),
      downstreamInvalidations: JSON.parse(row.downstream_invalidations_json),
      validationFindingIds: JSON.parse(row.validation_finding_ids_json),
      safeToApplyIndependently: Boolean(row.safe_independently), status: row.status,
      operations, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private refreshSetStatus(projectId: string, proposalId: string, now: string): void {
    const statuses = (this.database.prepare(`SELECT status FROM passage_proposal_groups
      WHERE project_id = ? AND proposal_id = ?`).all(projectId, proposalId) as Array<{ status: PassageProposalStatus }>)
      .map((row) => row.status);
    const status: PassageProposalStatus = statuses.length > 0 && statuses.every((item) => item === "applied")
      ? "applied"
      : statuses.length > 0 && statuses.every((item) => item === "rejected")
        ? "rejected"
        : statuses.includes("stale") ? "stale" : "proposed";
    this.database.prepare(`UPDATE passage_proposal_sets SET status = ?, updated_at = ?
      WHERE project_id = ? AND id = ?`).run(status, now, projectId, proposalId);
  }
}

function mapOperation(row: OperationRow): PassageProposalOperationRecord {
  return {
    id: row.id, groupId: row.group_id, position: row.position, kind: row.operation_kind,
    entityKind: row.entity_kind, entityId: row.entity_id, baseVersionId: row.base_version_id,
    before: row.before_json ? JSON.parse(row.before_json) : null, after: JSON.parse(row.after_json),
    fieldDiffs: JSON.parse(row.field_diffs_json), sourceCandidateIds: JSON.parse(row.source_candidate_ids_json),
  };
}

function mapPreview(row: PreviewRow): PassageProposalPreviewRecord {
  return {
    id: row.id, projectId: row.project_id, proposalId: row.proposal_id,
    selectedGroupIds: JSON.parse(row.selected_group_ids_json),
    selectedOperationIds: JSON.parse(row.selected_operation_ids_json),
    headVersions: JSON.parse(row.head_versions_json), validation: JSON.parse(row.validation_json),
    affectedEntityIds: JSON.parse(row.affected_entity_ids_json),
    downstreamInvalidations: JSON.parse(row.downstream_invalidations_json),
    beforeAfter: JSON.parse(row.before_after_json), previewFingerprint: row.preview_fingerprint,
    valid: Boolean(row.valid), createdAt: row.created_at,
  };
}

function mapApplication(row: ApplicationRow): PassageProposalApplicationRecord {
  return {
    id: row.id, projectId: row.project_id, proposalId: row.proposal_id,
    selectedGroupIds: JSON.parse(row.selected_group_ids_json),
    appliedOperationIds: JSON.parse(row.applied_operation_ids_json),
    candidateProvenance: JSON.parse(row.candidate_provenance_json),
    previousVersionIds: JSON.parse(row.previous_version_ids_json),
    resultingVersionIds: JSON.parse(row.resulting_version_ids_json),
    affectedEntityIds: JSON.parse(row.affected_entity_ids_json),
    validationPreviewFingerprint: row.validation_preview_fingerprint,
    validation: JSON.parse(row.validation_json),
    downstreamInvalidations: JSON.parse(row.downstream_invalidations_json), createdAt: row.created_at,
  };
}
