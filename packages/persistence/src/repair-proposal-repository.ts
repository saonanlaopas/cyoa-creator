import { createHash, randomUUID } from "node:crypto";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { appendRepairProposalGenerationInTransaction, type RepairProposalGenerationAggregateShape } from "./repair-proposal-generation-repository.js";

export const REPAIR_PROPOSAL_ARTIFACT_TYPE = "repair-proposal";
const prefix = "repair-proposal:";
const maximumBytes = 2_000_000;

export interface RepairProposalAggregateShape {
  schemaId: "cyoa.repair-proposal";
  schemaVersion: 1;
  id: string;
  projectId: string;
  repairPlanId: string;
  repairPlanArtifactVersionId: string;
  repairPlanDefinitionFingerprint: string;
  definitionFingerprint: string;
  sourceFindingFingerprints: string[];
  expectedBases: unknown[];
  generatedIds: Array<{ id: string }>;
  groups: Array<{ id: string; operationIds: string[]; dependsOnGroupIds: string[]; sourceFindingFingerprints?: string[]; authorizedTargetKeys?: string[] }>;
  operations: Array<{
    id: string; groupId: string; sourceFindingFingerprints: string[]; kind?: unknown; entityKind?: unknown;
    entityId?: unknown; targetKey?: unknown; expectedBase?: unknown; authorizedParentTargetKey?: unknown;
    before?: unknown; after?: unknown; fieldDiffs?: unknown; requiresUnlock?: unknown;
  }>;
  validation: { status: "valid"; errors: string[] };
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
    assertProposal(projectId, content);
    const serialized = JSON.stringify(content);
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
    assertProposal(generation.projectId, proposal);
    return transaction(this.database, () => {
      if (this.database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?").get(generation.projectId, `${prefix}${proposal.id}`)) throw new Error("Repair proposal already exists");
      options.assertFreshInTransaction?.();
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
    return rows[0] ? checked<T>(projectId, rows[0]) : undefined;
  }

  getVersion<T extends RepairProposalAggregateShape>(projectId: string, versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND id = ? AND artifact_type = ?`)
      .get(projectId, versionId, REPAIR_PROPOSAL_ARTIFACT_TYPE) as Row | undefined;
    return row ? checked<T>(projectId, row) : undefined;
  }

  list<T extends RepairProposalAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_type = ? ORDER BY created_at DESC, artifact_id`)
      .all(projectId, REPAIR_PROPOSAL_ARTIFACT_TYPE) as Row[]).map((row) => checked<T>(projectId, row));
  }
}

function checked<T extends RepairProposalAggregateShape>(projectId: string, row: Row): ArtifactVersion<T> {
  if (row.version !== 1) throw new Error("Repair proposals are immutable");
  const version = map<T>(row);
  if (version.artifactId !== `${prefix}${version.content.id}`) throw new Error("Repair-proposal artifact identity mismatch");
  assertProposal(projectId, version.content);
  return version;
}

function assertProposal(projectId: string, content: RepairProposalAggregateShape): void {
  if (content.schemaId !== "cyoa.repair-proposal" || content.schemaVersion !== 1 || content.projectId !== projectId) throw new Error("Repair-proposal identity mismatch");
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > maximumBytes) throw new Error("Repair proposal exceeds its saved byte limit");
  if (content.validation.status !== "valid" || content.validation.errors.length) throw new Error("Invalid repair proposal cannot be persisted");
  const { id: _id, definitionFingerprint: _fingerprint, createdAt: _createdAt, ...definition } = content;
  const fingerprint = hash(definition);
  if (content.definitionFingerprint !== fingerprint || content.id !== `rpp_${fingerprint.slice(0, 32)}`) throw new Error("Repair-proposal definition fingerprint mismatch");
  unique(content.sourceFindingFingerprints, "Repair-proposal finding lineage is duplicated");
  unique(content.generatedIds.map((item) => item.id), "Repair-proposal generated IDs are duplicated");
  unique(content.groups.map((item) => item.id), "Repair-proposal groups are duplicated");
  unique(content.operations.map((item) => item.id), "Repair-proposal operations are duplicated");
  if (!content.groups.length || !content.operations.length || !content.expectedBases.length || !content.sourceFindingFingerprints.length) throw new Error("Repair proposal must contain bounded groups, operations, bases, and finding lineage");
  const groupIds = new Set(content.groups.map((item) => item.id));
  const operationIds = new Set(content.operations.map((item) => item.id));
  for (const group of content.groups) {
    if (group.dependsOnGroupIds.some((id) => !groupIds.has(id) || id === group.id)) throw new Error("Repair-proposal group dependency is invalid");
    if (group.operationIds.some((id) => !operationIds.has(id))) throw new Error("Repair-proposal group operation lineage is invalid");
    if (!group.operationIds.length || group.sourceFindingFingerprints?.some((id) => !content.sourceFindingFingerprints.includes(id))) throw new Error("Repair-proposal group lineage is invalid");
  }
  const expectedBases = new Set(content.expectedBases.map(canonical));
  const generatedIds = new Set(content.generatedIds.map((item) => item.id));
  for (const operation of content.operations) {
    if (!groupIds.has(operation.groupId) || operation.sourceFindingFingerprints.some((id) => !content.sourceFindingFingerprints.includes(id))) {
      throw new Error("Repair-proposal operation lineage is invalid");
    }
    if (!operation.id || typeof operation.entityId !== "string" || typeof operation.targetKey !== "string" || !Array.isArray(operation.fieldDiffs)
      || typeof operation.requiresUnlock !== "boolean" || !["update-entity", "add-entity", "create-passage-draft-candidate"].includes(String(operation.kind))) {
      throw new Error("Repair-proposal operation contract is invalid");
    }
    if (operation.kind === "add-entity") {
      if (operation.expectedBase !== null || !generatedIds.has(operation.entityId) || typeof operation.authorizedParentTargetKey !== "string") throw new Error("Repair-proposal add operation authority is invalid");
    } else if (!expectedBases.has(canonical(operation.expectedBase))) throw new Error("Repair-proposal operation expected base is invalid");
  }
  const assigned = content.groups.flatMap((group) => group.operationIds);
  if (assigned.length !== operationIds.size || new Set(assigned).size !== assigned.length) throw new Error("Repair-proposal operations must belong to exactly one group");
  assertAcyclic(content.groups);
}

function assertAcyclic(groups: RepairProposalAggregateShape["groups"]): void {
  const byId = new Map(groups.map((group) => [group.id, group])); const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Repair-proposal group dependency cycle");
    if (visited.has(id)) return;
    const group = byId.get(id); if (!group) throw new Error("Repair-proposal group dependency is invalid");
    visiting.add(id); group.dependsOnGroupIds.forEach(visit); visiting.delete(id); visited.add(id);
  };
  groups.forEach((group) => visit(group.id));
}

function unique(values: string[], message: string): void { if (new Set(values).size !== values.length) throw new Error(message); }
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
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
