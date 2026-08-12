import { createHash, randomUUID } from "node:crypto";
import {
  REPAIR_PROPOSAL_POLICY_V1,
  RepairPlanRecordSchema,
  validateRepairPlanDefinition,
  validateRepairProposalRecord,
  type RepairProposalOperation,
  type RepairProposalRecord,
} from "@story-to-cyoa/domain";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import {
  appendRepairProposalGenerationInTransaction,
  assertRepairProposalGenerationAggregate,
  RepairProposalGenerationRepository,
  type RepairProposalGenerationAggregateShape,
} from "./repair-proposal-generation-repository.js";

export const REPAIR_PROPOSAL_ARTIFACT_TYPE = "repair-proposal";
const REPAIR_PLAN_ARTIFACT_TYPE = "repair-plan";
const prefix = "repair-proposal:";

export interface RepairProposalAggregateShape {
  id: string;
  projectId: string;
  repairPlanArtifactVersionId: string;
  createdAt: string;
}

type Row = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

export class RepairProposalRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create<T extends RepairProposalAggregateShape>(projectId: string, content: T, assertFreshInTransaction?: () => void): ArtifactVersion<T> {
    const serialized = JSON.stringify(assertProposal(this.database, projectId, content));
    return transaction(this.database, () => {
      if (!this.database.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) throw new Error("Repair-proposal project not found");
      if (this.database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?").get(projectId, `${prefix}${content.id}`)) {
        throw new Error("Repair proposal already exists");
      }
      assertFreshInTransaction?.();
      const id = randomUUID();
      this.database.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, 0, ?)`)
        .run(id, projectId, `${prefix}${content.id}`, REPAIR_PROPOSAL_ARTIFACT_TYPE, serialized, content.createdAt);
      return this.getVersion<T>(projectId, id)!;
    });
  }

  completeGeneration<G extends RepairProposalGenerationAggregateShape, P extends RepairProposalAggregateShape>(
    generation: G,
    proposal: P,
    options: { assertFreshInTransaction?: () => void; simulateFailure?: boolean } = {},
  ): { generation: ArtifactVersion<G>; proposal: ArtifactVersion<P> } {
    assertRepairProposalGenerationAggregate(generation, { allowUnlinkedCompleted: true });
    const canonicalProposal = assertProposal(this.database, generation.projectId, proposal);
    assertCompletionLineage(generation, canonicalProposal);
    return transaction(this.database, () => {
      if (this.database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?").get(generation.projectId, `${prefix}${proposal.id}`)) throw new Error("Repair proposal already exists");
      options.assertFreshInTransaction?.();
      // Revalidate both untrusted aggregates inside the same transaction that commits them.
      assertRepairProposalGenerationAggregate(generation, { allowUnlinkedCompleted: true });
      const transactionProposal = assertProposal(this.database, generation.projectId, proposal);
      assertCompletionLineage(generation, transactionProposal);
      const proposalVersionId = randomUUID();
      const next = structuredClone(generation) as G & { job: G["job"] & Record<string, unknown> };
      const nextJob = next.job as Record<string, unknown>;
      nextJob.proposalId = proposal.id; nextJob.proposalArtifactVersionId = proposalVersionId;
      const generationVersion = appendRepairProposalGenerationInTransaction(this.database, next);
      this.database.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, 0, ?)`)
        .run(proposalVersionId, generation.projectId, `${prefix}${proposal.id}`, REPAIR_PROPOSAL_ARTIFACT_TYPE, JSON.stringify(proposal), proposal.createdAt);
      if (options.simulateFailure) throw new Error("Simulated repair-proposal completion failure");
      return { generation: generationVersion, proposal: this.getVersion<P>(generation.projectId, proposalVersionId)! };
    });
  }

  get<T extends RepairProposalAggregateShape>(projectId: string, proposalId: string): ArtifactVersion<T> | undefined {
    const rows = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version DESC`)
      .all(projectId, `${prefix}${proposalId}`, REPAIR_PROPOSAL_ARTIFACT_TYPE) as Row[];
    if (rows.length > 1 || (rows[0] && rows[0].version !== 1)) throw new Error("Repair proposals are immutable");
    return rows[0] ? checked<T>(this.database, projectId, rows[0]) : undefined;
  }

  getVersion<T extends RepairProposalAggregateShape>(projectId: string, versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_type = ?`)
      .get(projectId, versionId, REPAIR_PROPOSAL_ARTIFACT_TYPE) as Row | undefined;
    return row ? checked<T>(this.database, projectId, row) : undefined;
  }

  list<T extends RepairProposalAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    const rows = this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_type = ? ORDER BY created_at DESC, artifact_id`)
      .all(projectId, REPAIR_PROPOSAL_ARTIFACT_TYPE) as Row[];
    const seen = new Set<string>();
    return rows.map((row) => {
      if (seen.has(row.artifact_id)) throw new Error("Repair proposals are immutable");
      seen.add(row.artifact_id);
      return checked<T>(this.database, projectId, row);
    });
  }
}

function checked<T extends RepairProposalAggregateShape>(database: StoryDatabase, projectId: string, row: Row): ArtifactVersion<T> {
  if (row.project_id !== projectId || row.artifact_type !== REPAIR_PROPOSAL_ARTIFACT_TYPE || row.schema_version !== 1 || row.version !== 1) {
    throw new Error("Repair-proposal artifact identity mismatch");
  }
  const version = map<T>(row);
  if (version.artifactId !== `${prefix}${version.content.id}`) throw new Error("Repair-proposal artifact identity mismatch");
  const proposal = assertProposal(database, projectId, version.content);
  if (proposal.provenance.mode === "ai-assisted") assertStoredGenerationLineage(database, proposal, version.id);
  return version;
}

function assertStoredGenerationLineage(database: StoryDatabase, proposal: RepairProposalRecord, proposalArtifactVersionId: string): void {
  const generations = new RepairProposalGenerationRepository(database).list<RepairProposalGenerationAggregateShape>(proposal.projectId)
    .filter((item) => item.content.job.id === proposal.provenance.jobId);
  if (generations.length !== 1) throw new Error("Repair-proposal AI generation provenance is missing or duplicated");
  const generation = generations[0]!.content;
  assertCompletionLineage(generation, proposal);
  const job = generation.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  if (job.proposalId !== proposal.id || job.proposalArtifactVersionId !== proposalArtifactVersionId) {
    throw new Error("Repair-proposal AI generation completion linkage mismatch");
  }
}

function assertProposal(database: StoryDatabase, projectId: string, value: unknown): RepairProposalRecord {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > REPAIR_PROPOSAL_POLICY_V1.maxProposalBytes) throw new Error("Repair proposal exceeds its saved byte limit");
  const candidate = value as Partial<RepairProposalRecord>;
  const row = typeof candidate.repairPlanArtifactVersionId === "string"
    ? database.prepare("SELECT * FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_type = ?")
      .get(projectId, candidate.repairPlanArtifactVersionId, REPAIR_PLAN_ARTIFACT_TYPE) as Row | undefined
    : undefined;
  if (!row || row.version !== 1 || row.schema_version !== 1) throw new Error("Repair-proposal exact repair plan not found");
  const planRecord = RepairPlanRecordSchema.parse(JSON.parse(row.content_json));
  validateRepairPlanDefinition(planRecord.definition, fingerprint);
  if (row.artifact_id !== `repair-plan:${planRecord.id}` || planRecord.definitionFingerprint !== fingerprint(planRecord.definition)) {
    throw new Error("Repair-proposal repair-plan artifact is invalid");
  }
  return validateRepairProposalRecord(value, {
    projectId,
    repairPlanId: planRecord.id,
    repairPlanArtifactVersionId: row.id,
    repairPlanDefinitionFingerprint: planRecord.definitionFingerprint,
    repairPlan: planRecord.definition,
    fingerprint,
    expectedBefore: (operation) => exactBefore(database, projectId, operation),
  });
}

function exactBefore(database: StoryDatabase, projectId: string, operation: RepairProposalOperation): unknown {
  if (operation.kind !== "update-entity") return null;
  const base = operation.expectedBase;
  if (base.kind === "passage-entity-version") {
    const row = database.prepare(`SELECT project_id, entity_kind, entity_id, content_json FROM passage_entity_versions WHERE id = ?`)
      .get(base.versionId) as { project_id: string; entity_kind: string; entity_id: string; content_json: string } | undefined;
    if (!row || row.project_id !== projectId || row.entity_kind !== base.entityKind || row.entity_id !== base.entityId) throw new Error("Repair-proposal exact passage base is missing");
    return JSON.parse(row.content_json);
  }
  if (base.kind !== "artifact-entity-version") throw new Error("Repair-proposal update base kind is invalid");
  const row = database.prepare("SELECT project_id, artifact_id, content_json FROM artifact_versions WHERE id = ?")
    .get(base.artifactVersionId) as { project_id: string; artifact_id: string; content_json: string } | undefined;
  if (!row || row.project_id !== projectId || row.artifact_id !== base.artifactId) throw new Error("Repair-proposal exact artifact base is missing");
  const entity = locateArtifactEntity(JSON.parse(row.content_json), base.entityType, base.entityId);
  if (!entity || fingerprint(entity) !== base.entityFingerprint) throw new Error("Repair-proposal exact artifact entity base is missing");
  return entity;
}

function locateArtifactEntity(artifact: unknown, entityType: string, entityId: string): unknown {
  if (!artifact || typeof artifact !== "object") return undefined;
  const value = artifact as Record<string, unknown>;
  const collection = entityType === "relationship" ? value.relationships
    : entityType === "canon-fact" ? value.canonFacts
      : entityType === "route" ? value.routes
        : entityType === "route-act" ? value.acts
          : entityType === "route-decision" ? value.decisionPoints
            : entityType === "route-reconvergence" ? value.reconvergences
              : entityType === "route-ending-hook" ? value.endingHooks
                : entityType === "ending" ? value.endings : undefined;
  if (entityType === "mechanic") {
    const mechanics = [value.visibleStats, value.relationships, value.flags, value.resources].flatMap((items) => Array.isArray(items) ? items : []);
    return mechanics.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).key === entityId);
  }
  return Array.isArray(collection) ? collection.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === entityId) : undefined;
}

function assertCompletionLineage(generation: RepairProposalGenerationAggregateShape, proposal: RepairProposalRecord): void {
  const aggregate = generation as RepairProposalGenerationAggregateShape & Record<string, unknown>;
  const generationRecord = generation.generation as RepairProposalGenerationAggregateShape["generation"] & Record<string, unknown>;
  const job = generation.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  const equal = proposal.projectId === generation.projectId
    && proposal.repairPlanId === generationRecord.repairPlanId
    && proposal.repairPlanArtifactVersionId === generationRecord.repairPlanArtifactVersionId
    && proposal.repairPlanDefinitionFingerprint === generationRecord.repairPlanDefinitionFingerprint
    && proposal.generationFingerprint === generationRecord.fingerprint
    && proposal.provenance.mode === "ai-assisted"
    && proposal.provenance.providerId === generationRecord.providerId
    && proposal.provenance.modelId === generationRecord.modelId
    && proposal.provenance.jobId === generation.job.id;
  if (!equal || aggregate.schemaVersion !== 1 || job.status !== "completed") throw new Error("Repair-proposal completion generation lineage mismatch");
  const provenanceByUnit = new Map(proposal.provenance.candidates.map((item) => [item.unitId, item]));
  if (provenanceByUnit.size !== proposal.provenance.candidates.length || provenanceByUnit.size !== generation.job.units.length) {
    throw new Error("Repair-proposal completion candidate provenance is incomplete or duplicated");
  }
  for (const unit of generation.job.units) {
    const stored = unit as typeof unit & Record<string, unknown>;
    const candidates = Array.isArray(unit.candidates) ? unit.candidates as Array<Record<string, unknown>> : [];
    const attempts = Array.isArray(unit.attempts) ? unit.attempts as Array<Record<string, unknown>> : [];
    const provenance = provenanceByUnit.get(unit.id);
    if (unit.status !== "completed" || candidates.length !== 1 || !provenance) throw new Error("Repair-proposal completion unit lineage is invalid");
    const candidate = candidates[0]!;
    const attempt = attempts.find((item) => item.id === candidate.attemptId);
    if (!attempt || attempt.status !== "completed" || provenance.attemptId !== candidate.attemptId
      || provenance.contextFingerprint !== stored.contextFingerprint || provenance.candidateFingerprint !== candidate.fingerprint) {
      throw new Error("Repair-proposal completion candidate lineage mismatch");
    }
  }
}

function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function map<T>(row: Row): ArtifactVersion<T> {
  return { id: row.id, projectId: row.project_id, artifactId: row.artifact_id, artifactType: row.artifact_type,
    version: row.version, schemaVersion: row.schema_version, content: JSON.parse(row.content_json) as T,
    stale: Boolean(row.stale), restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at };
}
