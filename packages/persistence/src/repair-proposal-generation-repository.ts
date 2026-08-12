import { createHash, randomUUID } from "node:crypto";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { assertUnitHistoryTransition } from "./narrative-review-repository.js";

export const REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE = "repair-proposal-generation";
const prefix = "repair-proposal-generation:";

export interface RepairProposalGenerationAggregateShape {
  schemaVersion: 1;
  projectId: string;
  generation: {
    id: string;
    fingerprint: string;
    definitionFingerprint: string;
    status: "planned" | "authorized";
    authorizedFingerprint: string | null;
    repairPlanId: string;
    repairPlanArtifactVersionId: string;
    repairPlanDefinitionFingerprint: string;
  };
  job: {
    id: string;
    createdAt: string;
    units: Array<{ id: string; status: string; attempts: unknown[]; candidates: unknown[] }>;
  };
}

type Row = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

export class RepairProposalGenerationRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create<T extends RepairProposalGenerationAggregateShape>(content: T): ArtifactVersion<T> {
    return this.append(content, { requireMissing: true });
  }

  update<T extends RepairProposalGenerationAggregateShape>(content: T, options: { assertFreshInTransaction?: () => void; simulateFailure?: boolean } = {}): ArtifactVersion<T> {
    return this.append(content, options);
  }

  get<T extends RepairProposalGenerationAggregateShape>(projectId: string, generationId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version DESC LIMIT 1`)
      .get(projectId, `${prefix}${generationId}`, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row | undefined;
    return row ? map<T>(row) : undefined;
  }

  list<T extends RepairProposalGenerationAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`SELECT versions.* FROM artifact_versions versions JOIN (
      SELECT artifact_id, MAX(version) version FROM artifact_versions WHERE project_id = ? AND artifact_type = ? GROUP BY artifact_id
    ) latest ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
    WHERE versions.project_id = ? AND versions.artifact_type = ? ORDER BY versions.created_at DESC, versions.artifact_id`)
      .all(projectId, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE, projectId, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row[]).map(map<T>);
  }

  history<T extends RepairProposalGenerationAggregateShape>(projectId: string, generationId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version DESC`)
      .all(projectId, `${prefix}${generationId}`, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row[]).map(map<T>);
  }

  private append<T extends RepairProposalGenerationAggregateShape>(content: T, options: { requireMissing?: boolean; assertFreshInTransaction?: () => void; simulateFailure?: boolean }): ArtifactVersion<T> {
    return transaction(this.database, () => appendRepairProposalGenerationInTransaction(this.database, content, options));
  }
}

export function appendRepairProposalGenerationInTransaction<T extends RepairProposalGenerationAggregateShape>(
  database: StoryDatabase,
  content: T,
  options: { requireMissing?: boolean; assertFreshInTransaction?: () => void; simulateFailure?: boolean } = {},
): ArtifactVersion<T> {
  assertLineage(content);
  const current = database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1`)
    .get(content.projectId, `${prefix}${content.generation.id}`) as Row | undefined;
  if (options.requireMissing && current) throw new Error("Repair-proposal generation plan already exists");
  if (!options.requireMissing && !current) throw new Error("Repair-proposal generation plan not found");
  if (current) assertTransition(JSON.parse(current.content_json) as RepairProposalGenerationAggregateShape, content);
  else assertInitial(content);
  options.assertFreshInTransaction?.();
  const id = randomUUID(); const version = (current?.version ?? 0) + 1;
  database.prepare(`INSERT INTO artifact_versions
    (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)`)
    .run(id, content.projectId, `${prefix}${content.generation.id}`, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE, version, JSON.stringify(content), new Date().toISOString());
  if (options.simulateFailure) throw new Error("Simulated repair-proposal generation transaction failure");
  return map<T>(database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(id) as Row);
}

function assertInitial(content: RepairProposalGenerationAggregateShape): void {
  if (content.generation.status !== "planned" || content.generation.authorizedFingerprint !== null) throw new Error("Repair-proposal generation must start planned and unauthorized");
  for (const unit of content.job.units) if (unit.status !== "pending" || unit.attempts.length || unit.candidates.length) throw new Error("Repair-proposal generation units must start pending with empty history");
  assertJobState(content);
}

function assertTransition(previous: RepairProposalGenerationAggregateShape, next: RepairProposalGenerationAggregateShape): void {
  const beforeDefinition = stripMutable(previous); const afterDefinition = stripMutable(next);
  if (canonical(beforeDefinition) !== canonical(afterDefinition)) throw new Error("Repair-proposal generation definition is immutable");
  if (previous.job.id !== next.job.id || previous.job.createdAt !== next.job.createdAt) throw new Error("Repair-proposal generation job identity is immutable");
  if (previous.job.units.length !== next.job.units.length) throw new Error("Repair-proposal generation unit definitions are immutable");
  previous.job.units.forEach((unit, index) => {
    const after = next.job.units[index]!;
    const beforeDefinition = stripUnitMutable(unit); const afterDefinition = stripUnitMutable(after);
    if (canonical(beforeDefinition) !== canonical(afterDefinition)) throw new Error("Repair-proposal generation unit definitions are immutable");
    assertUnitHistoryTransition({ ...unit, findings: unit.candidates } as Record<string, unknown>, { ...after, findings: after.candidates } as Record<string, unknown>);
  });
  assertJobTransition(previous, next);
  assertJobState(next);
}

function stripMutable(content: RepairProposalGenerationAggregateShape): unknown {
  const copy = structuredClone(content) as RepairProposalGenerationAggregateShape & Record<string, unknown>;
  const { job, currentState: _currentState, ...definition } = copy;
  return {
    ...definition,
    generation: { ...copy.generation, status: "planned", authorizedFingerprint: null },
    job: { id: job.id, createdAt: job.createdAt },
  };
}
function stripUnitMutable(unit: { status?: unknown; attempts?: unknown; candidates?: unknown } & object): unknown {
  const { status: _status, attempts: _attempts, candidates: _candidates, ...definition } = unit; return definition;
}
function assertLineage(content: RepairProposalGenerationAggregateShape): void {
  if (!content.projectId || !content.generation.id || content.generation.fingerprint !== content.generation.definitionFingerprint) throw new Error("Repair-proposal generation lineage is invalid");
  const ids = content.job.units.map((unit) => unit.id); if (new Set(ids).size !== ids.length) throw new Error("Repair-proposal generation unit IDs are duplicated");
  const aggregate = content as RepairProposalGenerationAggregateShape & Record<string, unknown>;
  const generation = content.generation as RepairProposalGenerationAggregateShape["generation"] & Record<string, unknown>;
  if (typeof aggregate.baseFingerprint !== "string" || hash(aggregate.base) !== aggregate.baseFingerprint) throw new Error("Repair-proposal generation base fingerprint is invalid");
  const expected = hash({
    repairPlanId: generation.repairPlanId, repairPlanArtifactVersionId: generation.repairPlanArtifactVersionId,
    repairPlanDefinitionFingerprint: generation.repairPlanDefinitionFingerprint,
    providerId: generation.providerId, modelId: generation.modelId, policy: generation.policy,
    baseFingerprint: aggregate.baseFingerprint,
    units: content.job.units.map((unit) => {
      const stored = unit as typeof unit & Record<string, unknown>; return { position: stored.position, targetKeys: stored.targetKeys };
    }),
  });
  if (content.generation.fingerprint !== expected) throw new Error("Repair-proposal generation fingerprint is invalid");
  for (const unit of content.job.units) {
    const stored = unit as typeof unit & Record<string, unknown>;
    if (typeof stored.contextFingerprint !== "string" || hash(stored.context) !== stored.contextFingerprint
      || stored.inputFingerprint !== hash({ fingerprint: expected, id: unit.id, contextFingerprint: stored.contextFingerprint })) {
      throw new Error("Repair-proposal generation unit fingerprint is invalid");
    }
  }
}
function assertJobState(content: RepairProposalGenerationAggregateShape): void {
  const job = content.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  const statuses = content.job.units.map((unit) => unit.status);
  if (job.status === "planned" && (content.generation.status !== "planned" || statuses.some((status) => status !== "pending"))) throw new Error("Repair-proposal planned job state is invalid");
  if (job.status === "authorized" && (content.generation.status !== "authorized" || statuses.some((status) => status !== "pending" && status !== "completed"))) throw new Error("Repair-proposal authorized job state is invalid");
  if (job.status === "running" && (content.generation.status !== "authorized" || statuses.some((status) => status === "cancelled") || statuses.filter((status) => status === "running").length > 1)) throw new Error("Repair-proposal running job state is invalid");
  if (job.status === "completed" && (statuses.some((status) => status !== "completed") || typeof job.proposalId !== "string" || typeof job.proposalArtifactVersionId !== "string")) throw new Error("Repair-proposal completed job state is invalid");
  if (job.status === "failed" && !statuses.every((status) => status === "failed" || status === "completed")) throw new Error("Repair-proposal failed job state is invalid");
  if (job.status === "partially-failed" && (!statuses.includes("failed") || !statuses.includes("completed"))) throw new Error("Repair-proposal partially-failed job state is invalid");
  if (job.status === "cancelled" && statuses.some((status) => status === "pending" || status === "running")) throw new Error("Repair-proposal cancelled job state is invalid");
}
function assertJobTransition(previous: RepairProposalGenerationAggregateShape, next: RepairProposalGenerationAggregateShape): void {
  const before = String((previous.job as Record<string, unknown>).status); const after = String((next.job as Record<string, unknown>).status);
  const allowed: Record<string, string[]> = {
    planned: ["planned", "authorized"], authorized: ["authorized", "running", "cancelled"],
    running: ["running", "completed", "partially-failed", "failed", "cancelled"],
    "partially-failed": ["partially-failed", "authorized"], failed: ["failed", "authorized"],
    completed: ["completed"], cancelled: ["cancelled"],
  };
  if (!allowed[before]?.includes(after)) throw new Error("Repair-proposal job lifecycle transition is invalid");
}
function hash(value: unknown): string {
  const serializable = JSON.parse(JSON.stringify(value)) as unknown;
  return createHash("sha256").update(canonical(serializable)).digest("hex");
}
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
