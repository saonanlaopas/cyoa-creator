import {
  REPAIR_APPLICATION_POLICY_V1,
  RepairApplicationRecordSchema,
  type RepairApplicationRecord,
  type RepairProposalRecord,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { RepairProposalRepository } from "./repair-proposal-repository.js";

export interface RepairDraftProvenance {
  applicationId: string;
  applicationDefinitionFingerprint: string;
  proposalId: string;
  proposalArtifactVersionId: string;
  proposalDefinitionFingerprint: string;
  repairPlanId: string;
  repairPlanArtifactVersionId: string;
  repairPlanDefinitionFingerprint: string;
  operationId: string;
  sourceFindingFingerprints: string[];
  passagePlanBaseVersionId: string;
  expectedCurrentDraftVersionId: string | null;
  expectedAcceptedDraftVersionId: string | null;
  upstreamVersions: Record<string, string>;
  neighboringDraftVersions: Record<string, string>;
  draftVersionId: string;
}

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
      const result = input.mutateInTransaction(proposalVersion.content, selection);
      const record = RepairApplicationRecordSchema.parse(result.application);
      if (Buffer.byteLength(JSON.stringify(record), "utf8") > REPAIR_APPLICATION_POLICY_V1.maxAuditBytes) {
        throw new Error("Repair application audit exceeds its saved byte limit");
      }
      assertApplicationIdentity(record, input, proposalVersion.content, selection);
      assertResultLineage(this.database, record, result.draftLinks);
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
    const row = this.database.prepare(`SELECT provenance_json FROM repair_application_draft_links
      WHERE project_id = ? AND draft_version_id = ?`).get(projectId, draftVersionId) as { provenance_json: string } | undefined;
    return row ? JSON.parse(row.provenance_json) as RepairDraftProvenance : undefined;
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
}

function assertResultLineage(
  database: StoryDatabase,
  record: RepairApplicationRecord,
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
  for (const result of record.resultingVersions) {
    const exists = result.entityKind === "passage-prose"
      ? database.prepare(`SELECT id FROM passage_draft_versions
          WHERE project_id = ? AND id = ? AND passage_id = ? AND lifecycle_status = 'candidate'`)
        .get(record.projectId, result.versionId, result.entityId)
      : ["passage", "choice", "thread"].includes(result.entityKind)
        ? database.prepare(`SELECT id FROM passage_entity_versions
            WHERE project_id = ? AND id = ? AND entity_kind = ? AND entity_id = ?`)
          .get(record.projectId, result.versionId, result.entityKind, result.entityId)
        : database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND id = ?")
          .get(record.projectId, result.versionId);
    if (!exists) throw new Error(`Repair application result ${result.operationId} is not a canonical version`);
  }
  const proseResults = record.resultingVersions.filter((item) => item.entityKind === "passage-prose");
  if (draftLinks.length !== proseResults.length) throw new Error("Repair application draft provenance is incomplete");
  for (const link of draftLinks) {
    const result = resultByOperation.get(link.operationId);
    if (!result || result.entityKind !== "passage-prose" || result.entityId !== link.passageId
      || result.versionId !== link.draftVersionId || link.provenance.applicationId !== record.id
      || link.provenance.applicationDefinitionFingerprint !== record.definitionFingerprint
      || link.provenance.proposalId !== record.proposalId
      || link.provenance.proposalArtifactVersionId !== record.proposalArtifactVersionId
      || link.provenance.operationId !== link.operationId
      || link.provenance.draftVersionId !== link.draftVersionId) {
      throw new Error("Repair application draft provenance does not match its result");
    }
  }
}
