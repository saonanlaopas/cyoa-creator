import { createHash, randomUUID } from "node:crypto";
import {
  REPAIR_PROPOSAL_POLICY_V1,
  validateRepairProposalUnitCandidate,
  type RepairExpectedBase,
} from "@story-to-cyoa/domain";
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
    const rows = this.rows(projectId, `${prefix}${generationId}`);
    return rows.length ? checkedHistory<T>(projectId, rows).at(-1) : undefined;
  }

  list<T extends RepairProposalGenerationAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    const rows = this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_type = ? ORDER BY artifact_id, version`)
      .all(projectId, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row[];
    const grouped = new Map<string, Row[]>();
    for (const row of rows) grouped.set(row.artifact_id, [...(grouped.get(row.artifact_id) ?? []), row]);
    return [...grouped.values()].map((history) => checkedHistory<T>(projectId, history).at(-1)!)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.artifactId.localeCompare(right.artifactId));
  }

  history<T extends RepairProposalGenerationAggregateShape>(projectId: string, generationId: string): ArtifactVersion<T>[] {
    return checkedHistory<T>(projectId, this.rows(projectId, `${prefix}${generationId}`)).reverse();
  }

  private rows(projectId: string, artifactId: string): Row[] {
    return this.database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version`)
      .all(projectId, artifactId, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row[];
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
  assertRepairProposalGenerationAggregate(content);
  const rows = database.prepare(`SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version`)
    .all(content.projectId, `${prefix}${content.generation.id}`, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE) as Row[];
  const history = rows.length ? checkedHistory<RepairProposalGenerationAggregateShape>(content.projectId, rows) : [];
  const current = history.at(-1);
  if (options.requireMissing && current) throw new Error("Repair-proposal generation plan already exists");
  if (!options.requireMissing && !current) throw new Error("Repair-proposal generation plan not found");
  if (current) assertTransition(current.content, content);
  else assertInitial(content);
  options.assertFreshInTransaction?.();
  const id = randomUUID(); const version = (current?.version ?? 0) + 1;
  database.prepare(`INSERT INTO artifact_versions
    (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)`)
    .run(id, content.projectId, `${prefix}${content.generation.id}`, REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE, version, JSON.stringify(content), new Date().toISOString());
  if (options.simulateFailure) throw new Error("Simulated repair-proposal generation transaction failure");
  return checkedRow<T>(content.projectId, database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(id) as Row);
}

export function assertRepairProposalGenerationAggregate(
  content: RepairProposalGenerationAggregateShape,
  options: { allowUnlinkedCompleted?: boolean } = {},
): void {
  assertLineage(content);
  for (const unit of content.job.units) assertUnitSnapshot(content, unit);
  assertJobState(content, options);
}

function checkedHistory<T extends RepairProposalGenerationAggregateShape>(projectId: string, rows: Row[]): ArtifactVersion<T>[] {
  const versions = rows.map((row, index) => {
    if (row.version !== index + 1) throw new Error("Repair-proposal generation history versions are not contiguous");
    return checkedRow<T>(projectId, row);
  });
  if (versions[0]) assertInitial(versions[0].content);
  for (let index = 1; index < versions.length; index += 1) assertTransition(versions[index - 1]!.content, versions[index]!.content);
  return versions;
}

function checkedRow<T extends RepairProposalGenerationAggregateShape>(projectId: string, row: Row): ArtifactVersion<T> {
  if (row.project_id !== projectId || row.artifact_type !== REPAIR_PROPOSAL_GENERATION_ARTIFACT_TYPE || row.schema_version !== 1) {
    throw new Error("Repair-proposal generation artifact identity mismatch");
  }
  const version = map<T>(row);
  if (version.artifactId !== `${prefix}${version.content.generation.id}` || version.content.projectId !== projectId) {
    throw new Error("Repair-proposal generation artifact identity mismatch");
  }
  assertRepairProposalGenerationAggregate(version.content);
  return version;
}

function assertInitial(content: RepairProposalGenerationAggregateShape): void {
  if (content.generation.status !== "planned" || content.generation.authorizedFingerprint !== null) throw new Error("Repair-proposal generation must start planned and unauthorized");
  const job = content.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  if (job.status !== "planned" || job.startedAt !== null || job.finishedAt !== null || job.proposalId !== null || job.proposalArtifactVersionId !== null) {
    throw new Error("Repair-proposal generation job must start planned");
  }
  for (const unit of content.job.units) if (unit.status !== "pending" || unit.attempts.length || unit.candidates.length) throw new Error("Repair-proposal generation units must start pending with empty history");
}

function assertTransition(previous: RepairProposalGenerationAggregateShape, next: RepairProposalGenerationAggregateShape): void {
  const beforeDefinition = stripMutable(previous); const afterDefinition = stripMutable(next);
  if (canonical(beforeDefinition) !== canonical(afterDefinition)) throw new Error("Repair-proposal generation definition is immutable");
  if (previous.job.id !== next.job.id || previous.job.createdAt !== next.job.createdAt) throw new Error("Repair-proposal generation job identity is immutable");
  if (previous.job.units.length !== next.job.units.length) throw new Error("Repair-proposal generation unit definitions are immutable");
  previous.job.units.forEach((unit, index) => {
    const after = next.job.units[index]!;
    if (canonical(stripUnitMutable(unit)) !== canonical(stripUnitMutable(after))) throw new Error("Repair-proposal generation unit definitions are immutable");
    assertUnitHistoryTransition({ ...unit, findings: unit.candidates } as Record<string, unknown>, { ...after, findings: after.candidates } as Record<string, unknown>);
  });
  assertJobTransition(previous, next);
}

function stripMutable(content: RepairProposalGenerationAggregateShape): unknown {
  const copy = structuredClone(content) as RepairProposalGenerationAggregateShape & Record<string, unknown>;
  const { job, currentState: _currentState, ...definition } = copy;
  return { ...definition, generation: { ...copy.generation, status: "planned", authorizedFingerprint: null }, job: { id: job.id, createdAt: job.createdAt } };
}
function stripUnitMutable(unit: { status?: unknown; attempts?: unknown; candidates?: unknown } & object): unknown {
  const { status: _status, attempts: _attempts, candidates: _candidates, ...definition } = unit; return definition;
}

function assertLineage(content: RepairProposalGenerationAggregateShape): void {
  const aggregate = content as RepairProposalGenerationAggregateShape & Record<string, unknown>;
  const generation = content.generation as RepairProposalGenerationAggregateShape["generation"] & Record<string, unknown>;
  const job = content.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  if (content.schemaVersion !== 1 || !nonempty(content.projectId) || !nonempty(content.generation.id)
    || content.generation.fingerprint !== content.generation.definitionFingerprint
    || !fingerprintValue(content.generation.fingerprint) || !fingerprintValue(content.generation.repairPlanDefinitionFingerprint)
    || !nonempty(content.generation.repairPlanId) || !nonempty(content.generation.repairPlanArtifactVersionId)
    || !nonempty(job.id) || !dateValue(job.createdAt)) throw new Error("Repair-proposal generation lineage is invalid");
  const ids = content.job.units.map((unit) => unit.id); if (new Set(ids).size !== ids.length || !ids.length) throw new Error("Repair-proposal generation unit IDs are invalid");
  if (typeof aggregate.baseFingerprint !== "string" || hash(aggregate.base) !== aggregate.baseFingerprint) throw new Error("Repair-proposal generation base fingerprint is invalid");
  if (!nonempty(generation.providerId) || !nonempty(generation.modelId) || generation.mode !== "ai-assisted"
    || !validPolicy(generation.policy)) throw new Error("Repair-proposal generation provider/model/policy is invalid");
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
  if (content.generation.status === "planned" ? content.generation.authorizedFingerprint !== null : content.generation.authorizedFingerprint !== expected) {
    throw new Error("Repair-proposal generation authorization lineage is invalid");
  }
  content.job.units.forEach((unit, index) => {
    const stored = unit as typeof unit & Record<string, unknown>;
    if (stored.position !== index || !Array.isArray(stored.targetKeys) || !stored.targetKeys.length
      || stored.targetKeys.some((key) => !nonempty(key)) || new Set(stored.targetKeys as string[]).size !== stored.targetKeys.length
      || unit.id !== `rpu_${hash({ fingerprint: expected, position: stored.position, keys: stored.targetKeys }).slice(0, 32)}`
      || typeof stored.contextFingerprint !== "string" || hash(stored.context) !== stored.contextFingerprint
      || stored.inputFingerprint !== hash({ fingerprint: expected, id: unit.id, contextFingerprint: stored.contextFingerprint })) {
      throw new Error("Repair-proposal generation unit fingerprint is invalid");
    }
    assertContext(content, unit, stored);
  });
  const totalEstimatedInputTokens = content.job.units.reduce((sum, unit) => sum + Number((unit as typeof unit & Record<string, unknown>).estimatedInputTokens), 0);
  if (generation.estimatedInputTokens !== totalEstimatedInputTokens) throw new Error("Repair-proposal generation token estimate is invalid");
}

function assertContext(content: RepairProposalGenerationAggregateShape, unit: RepairProposalGenerationAggregateShape["job"]["units"][number], stored: Record<string, unknown>): void {
  const generation = content.generation as RepairProposalGenerationAggregateShape["generation"] & Record<string, unknown>;
  const policy = generation.policy as typeof REPAIR_PROPOSAL_POLICY_V1;
  const context = stored.context as Record<string, unknown> | undefined;
  const contextUnit = context?.unit as Record<string, unknown> | undefined;
  const contextPlan = context?.repairPlan as Record<string, unknown> | undefined;
  const serializedBytes = Buffer.byteLength(canonicalJsonSerializable(stored.context), "utf8");
  if (!context || context.schemaVersion !== 1 || contextUnit?.id !== unit.id || contextUnit.position !== stored.position
    || canonical(contextUnit.targetKeys) !== canonical(stored.targetKeys) || contextUnit.generationFingerprint !== content.generation.fingerprint
    || contextPlan?.id !== content.generation.repairPlanId || contextPlan.artifactVersionId !== content.generation.repairPlanArtifactVersionId
    || contextPlan.definitionFingerprint !== content.generation.repairPlanDefinitionFingerprint
    || canonical(contextPlan.authorizedTargetKeys) !== canonical(stored.targetKeys)
    || stored.serializedContextBytes !== serializedBytes || stored.estimatedInputTokens !== Math.max(1, Math.ceil(serializedBytes / 4))
    || serializedBytes > policy.maxContextBytesPerUnit || Number(stored.estimatedInputTokens) > policy.maxEstimatedInputTokensPerUnit
    || !Number.isInteger(stored.maximumOutputTokens) || Number(stored.maximumOutputTokens) < 1 || Number(stored.maximumOutputTokens) > policy.maxOutputTokensPerUnit) {
    throw new Error("Repair-proposal generation bounded context is invalid");
  }
  const diagnostics = stored.diagnostics as Record<string, unknown> | undefined;
  if (!diagnostics || diagnostics.requiredContextComplete !== true || canonical(diagnostics.included) !== canonical(stored.targetKeys)
    || !Array.isArray(diagnostics.omitted) || diagnostics.omitted.length) throw new Error("Repair-proposal generation context diagnostics are invalid");
}

function assertUnitSnapshot(content: RepairProposalGenerationAggregateShape, unit: RepairProposalGenerationAggregateShape["job"]["units"][number]): void {
  const stored = unit as typeof unit & Record<string, unknown>;
  if (!['pending', 'running', 'completed', 'failed', 'cancelled'].includes(unit.status) || !Array.isArray(unit.attempts) || !Array.isArray(unit.candidates)) {
    throw new Error("Repair-proposal generation unit state is invalid");
  }
  const attempts = unit.attempts as Array<Record<string, unknown>>;
  const candidates = unit.candidates as Array<Record<string, unknown>>;
  const attemptIds = new Set<string>();
  attempts.forEach((attempt, index) => {
    if (!nonempty(attempt.id) || attemptIds.has(String(attempt.id)) || attempt.number !== index + 1
      || !['running', 'completed', 'failed', 'cancelled'].includes(String(attempt.status)) || !dateValue(attempt.startedAt)) throw new Error("Repair-proposal generation attempt lineage is invalid");
    attemptIds.add(String(attempt.id));
    if (attempt.status === "running" ? attempt.finishedAt !== null : !dateValue(attempt.finishedAt)) throw new Error("Repair-proposal generation attempt completion is invalid");
    if (attempt.status === "completed" && attempt.error !== null) throw new Error("Repair-proposal completed attempt contains an error");
    if (attempt.status === "failed" && (!attempt.error || typeof attempt.error !== "object")) throw new Error("Repair-proposal failed attempt lacks an error");
  });
  if (attempts.filter((attempt) => attempt.status === "running").length > 1 || attempts.slice(0, -1).some((attempt) => attempt.status === "running")) {
    throw new Error("Repair-proposal generation running attempt order is invalid");
  }
  if (unit.status === "pending" && (attempts.some((attempt) => attempt.status === "running") || candidates.length)) throw new Error("Repair-proposal pending unit state is invalid");
  if (unit.status === "running" && attempts.at(-1)?.status !== "running") throw new Error("Repair-proposal running unit state is invalid");
  if (unit.status === "failed" && attempts.at(-1)?.status !== "failed") throw new Error("Repair-proposal failed unit state is invalid");
  if (unit.status === "completed" && (attempts.at(-1)?.status !== "completed" || candidates.length !== 1)) throw new Error("Repair-proposal completed unit state is invalid");
  if (unit.status === "cancelled" && attempts.length && attempts.at(-1)?.status !== "cancelled") throw new Error("Repair-proposal cancelled unit state is invalid");
  if (unit.status !== "completed" && candidates.length) throw new Error("Repair-proposal candidate exists outside a completed unit");
  for (const item of candidates) {
    const candidate = item.candidate as Record<string, unknown> | undefined;
    const attempt = attempts.find((entry) => entry.id === item.attemptId);
    if (!candidate || attempt?.status !== "completed" || item.fingerprint !== hash(candidate)
      || candidate.schemaId !== "cyoa.repair-proposal-unit-candidate" || candidate.schemaVersion !== 1
      || candidate.unitId !== unit.id || candidate.contextFingerprint !== stored.contextFingerprint
      || candidate.generationFingerprint !== content.generation.fingerprint
      || candidate.repairPlanDefinitionFingerprint !== content.generation.repairPlanDefinitionFingerprint) {
      throw new Error("Repair-proposal generation candidate lineage is invalid");
    }
    const context = stored.context as Record<string, unknown>;
    const repairPlan = context.repairPlan as Record<string, unknown>;
    validateRepairProposalUnitCandidate(candidate, {
      repairPlanDefinitionFingerprint: content.generation.repairPlanDefinitionFingerprint,
      generationFingerprint: content.generation.fingerprint,
      unitId: unit.id,
      contextFingerprint: String(stored.contextFingerprint),
      authorizedTargetKeys: stored.targetKeys as string[],
      expectedBases: repairPlan.expectedBases as RepairExpectedBase[],
      fingerprint: hash,
    });
  }
}

function assertJobState(content: RepairProposalGenerationAggregateShape, options: { allowUnlinkedCompleted?: boolean } = {}): void {
  const job = content.job as RepairProposalGenerationAggregateShape["job"] & Record<string, unknown>;
  const statuses = content.job.units.map((unit) => unit.status);
  if (!['planned', 'authorized', 'running', 'completed', 'partially-failed', 'failed', 'cancelled'].includes(String(job.status))) throw new Error("Repair-proposal job status is invalid");
  if (job.status === "planned" && (content.generation.status !== "planned" || statuses.some((status) => status !== "pending"))) throw new Error("Repair-proposal planned job state is invalid");
  if (job.status === "authorized" && (content.generation.status !== "authorized" || statuses.some((status) => status !== "pending" && status !== "completed"))) throw new Error("Repair-proposal authorized job state is invalid");
  if (job.status === "running" && (content.generation.status !== "authorized" || statuses.some((status) => status === "cancelled") || statuses.filter((status) => status === "running").length > 1)) throw new Error("Repair-proposal running job state is invalid");
  if (job.status === "completed" && (statuses.some((status) => status !== "completed")
    || (!options.allowUnlinkedCompleted && (typeof job.proposalId !== "string" || typeof job.proposalArtifactVersionId !== "string")))) throw new Error("Repair-proposal completed job state is invalid");
  if (job.status === "failed" && !statuses.every((status) => status === "failed" || status === "completed")) throw new Error("Repair-proposal failed job state is invalid");
  if (job.status === "partially-failed" && (!statuses.includes("failed") || !statuses.includes("completed"))) throw new Error("Repair-proposal partially-failed job state is invalid");
  if (job.status === "cancelled" && statuses.some((status) => status === "pending" || status === "running")) throw new Error("Repair-proposal cancelled job state is invalid");
  if (job.status !== "completed" && (job.proposalId !== null || job.proposalArtifactVersionId !== null)) throw new Error("Repair-proposal job has premature proposal lineage");
  if (job.status === "planned") {
    if (job.startedAt !== null || job.finishedAt !== null) throw new Error("Repair-proposal unstarted job timestamps are invalid");
  } else if (job.status === "authorized") {
    if ((job.startedAt !== null && !dateValue(job.startedAt)) || job.finishedAt !== null) throw new Error("Repair-proposal authorized job timestamps are invalid");
  } else if (!dateValue(job.startedAt) || (job.status === "running" ? job.finishedAt !== null : !dateValue(job.finishedAt))) {
    throw new Error("Repair-proposal job timestamps are invalid");
  }
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
function canonicalJsonSerializable(value: unknown): string { return JSON.stringify(JSON.parse(JSON.stringify(value))); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function dateValue(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function fingerprintValue(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function validPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  const expected = REPAIR_PROPOSAL_POLICY_V1 as Record<string, string | number>;
  if (Object.keys(policy).sort().join("\0") !== Object.keys(expected).sort().join("\0") || policy.id !== expected.id) return false;
  return Object.entries(expected).every(([key, maximum]) => key === "id" || (Number.isInteger(policy[key]) && Number(policy[key]) >= 1 && Number(policy[key]) <= Number(maximum)));
}
function map<T>(row: Row): ArtifactVersion<T> {
  return { id: row.id, projectId: row.project_id, artifactId: row.artifact_id, artifactType: row.artifact_type,
    version: row.version, schemaVersion: row.schema_version, content: JSON.parse(row.content_json) as T,
    stale: Boolean(row.stale), restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at };
}
