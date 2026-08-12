import { createHash, randomUUID } from "node:crypto";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const NARRATIVE_REVIEW_ARTIFACT_TYPE = "narrative-review";
const prefix = "narrative-review:";
const terminalAttemptStatuses = new Set(["completed", "failed", "cancelled"]);

export interface NarrativeReviewAggregateShape {
  schemaVersion: 1;
  projectId: string;
  plan: { id: string; fingerprint: string; definitionFingerprint: string };
}

type Row = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

export class NarrativeReviewRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create<T extends NarrativeReviewAggregateShape>(content: T): ArtifactVersion<T> {
    return this.append(content.projectId, content.plan.id, content, { requireMissing: true });
  }

  update<T extends NarrativeReviewAggregateShape>(
    content: T,
    options: { assertFreshInTransaction?: () => void; simulateFailure?: boolean } = {},
  ): ArtifactVersion<T> {
    return this.append(content.projectId, content.plan.id, content, options);
  }

  get<T extends NarrativeReviewAggregateShape>(projectId: string, planId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1`)
      .get(projectId, `${prefix}${planId}`) as Row | undefined;
    return row ? map<T>(row) : undefined;
  }

  getVersion<T extends NarrativeReviewAggregateShape>(projectId: string, versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND id = ? AND artifact_type = ?`)
      .get(projectId, versionId, NARRATIVE_REVIEW_ARTIFACT_TYPE) as Row | undefined;
    return row ? map<T>(row) : undefined;
  }

  list<T extends NarrativeReviewAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`SELECT versions.* FROM artifact_versions versions
      JOIN (
        SELECT artifact_id, MAX(version) version FROM artifact_versions
        WHERE project_id = ? AND artifact_type = ? GROUP BY artifact_id
      ) latest ON latest.artifact_id = versions.artifact_id AND latest.version = versions.version
      WHERE versions.project_id = ? AND versions.artifact_type = ?
      ORDER BY versions.created_at DESC, versions.artifact_id`)
      .all(projectId, NARRATIVE_REVIEW_ARTIFACT_TYPE, projectId, NARRATIVE_REVIEW_ARTIFACT_TYPE) as Row[]).map(map<T>);
  }

  history<T extends NarrativeReviewAggregateShape>(projectId: string, planId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version DESC`)
      .all(projectId, `${prefix}${planId}`, NARRATIVE_REVIEW_ARTIFACT_TYPE) as Row[]).map(map<T>);
  }

  private append<T extends NarrativeReviewAggregateShape>(
    projectId: string,
    planId: string,
    content: T,
    options: { requireMissing?: boolean; assertFreshInTransaction?: () => void; simulateFailure?: boolean },
  ): ArtifactVersion<T> {
    if (content.projectId !== projectId || content.plan.id !== planId) throw new Error("Narrative-review aggregate identity mismatch");
    assertAggregateLineage(content);
    const serialized = JSON.stringify(content);
    return transaction(this.database, () => {
      const current = this.database.prepare(`SELECT * FROM artifact_versions
        WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1`)
        .get(projectId, `${prefix}${planId}`) as Row | undefined;
      if (options.requireMissing && current) throw new Error("Narrative-review plan already exists");
      if (!options.requireMissing && !current) throw new Error("Narrative-review plan not found");
      if (current) {
        const previous = JSON.parse(current.content_json) as NarrativeReviewAggregateShape;
        if (previous.plan.id !== content.plan.id
          || previous.plan.fingerprint !== content.plan.fingerprint
          || previous.plan.definitionFingerprint !== content.plan.definitionFingerprint) {
          throw new Error("Narrative-review plan definition is immutable");
        }
        assertImmutableAggregateDefinition(previous, content);
      } else {
        assertInitialAggregateState(content);
      }
      options.assertFreshInTransaction?.();
      const id = randomUUID();
      const version = (current?.version ?? 0) + 1;
      this.database.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)`)
        .run(id, projectId, `${prefix}${planId}`, NARRATIVE_REVIEW_ARTIFACT_TYPE, version, serialized, new Date().toISOString());
      if (options.simulateFailure) throw new Error("Simulated narrative-review transaction failure");
      return map<T>(this.database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(id) as Row);
    });
  }
}

function assertImmutableAggregateDefinition(previous: NarrativeReviewAggregateShape, next: NarrativeReviewAggregateShape): void {
  type StoredAggregate = NarrativeReviewAggregateShape & {
    reviewInput?: unknown;
    plan: NarrativeReviewAggregateShape["plan"] & Record<string, unknown>;
    job?: { id?: unknown; createdAt?: unknown; units?: Array<Record<string, unknown>> };
  };
  const before = previous as StoredAggregate; const after = next as StoredAggregate;
  if (JSON.stringify(before.reviewInput) !== JSON.stringify(after.reviewInput)) {
    throw new Error("Narrative-review input is immutable");
  }
  const planDefinition = ({ status: _status, authorizedFingerprint: _authorization, ...definition }: Record<string, unknown>) => definition;
  if (JSON.stringify(planDefinition(before.plan)) !== JSON.stringify(planDefinition(after.plan))) {
    throw new Error("Narrative-review plan definition is immutable");
  }
  if (!before.job && !after.job) return;
  if (!before.job || !after.job || before.job.id !== after.job.id || before.job.createdAt !== after.job.createdAt) {
    throw new Error("Narrative-review job identity is immutable");
  }
  const unitDefinition = ({ status: _status, attempts: _attempts, findings: _findings, ...definition }: Record<string, unknown>) => definition;
  if (JSON.stringify((before.job.units ?? []).map(unitDefinition)) !== JSON.stringify((after.job.units ?? []).map(unitDefinition))) {
    throw new Error("Narrative-review unit definitions are immutable");
  }
  for (let index = 0; index < (before.job.units ?? []).length; index += 1) {
    assertUnitHistoryTransition(before.job.units![index]!, after.job.units![index]!);
  }
}

function assertInitialAggregateState(content: NarrativeReviewAggregateShape): void {
  const aggregate = content as NarrativeReviewAggregateShape & { job?: { units?: Array<{ attempts?: unknown[]; findings?: unknown[] }> } };
  for (const unit of aggregate.job?.units ?? []) {
    if ((unit.attempts?.length ?? 0) !== 0 || (unit.findings?.length ?? 0) !== 0) {
      throw new Error("Narrative-review history must start empty");
    }
  }
}

function assertUnitHistoryTransition(previous: Record<string, unknown>, next: Record<string, unknown>): void {
  const beforeAttempts = arrayOfRecords(previous.attempts, "attempt history");
  const afterAttempts = arrayOfRecords(next.attempts, "attempt history");
  if (afterAttempts.length < beforeAttempts.length || afterAttempts.length > beforeAttempts.length + 1) {
    throw new Error("Narrative-review attempts are append-only");
  }
  let completedAttemptId: string | undefined;
  for (let index = 0; index < beforeAttempts.length; index += 1) {
    const before = beforeAttempts[index]!; const after = afterAttempts[index]!;
    if (before.id !== after.id) throw new Error("Narrative-review attempts are append-only");
    if (terminalAttemptStatuses.has(String(before.status))) {
      if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Terminal narrative-review attempts are immutable");
      continue;
    }
    if (before.status !== "running") throw new Error("Narrative-review attempt lifecycle is invalid");
    if (after.status === "running") {
      if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Running narrative-review attempts may only change when they finish");
      continue;
    }
    if (!terminalAttemptStatuses.has(String(after.status))
      || canonicalJson(stableAttemptFields(before)) !== canonicalJson(stableAttemptFields(after))
      || typeof after.finishedAt !== "string" || !after.finishedAt) {
      throw new Error("Narrative-review attempt completion is invalid");
    }
    if (after.status === "completed" && after.error !== null) throw new Error("Completed narrative-review attempts cannot contain an error");
    if (after.status === "failed" && (!after.error || typeof after.error !== "object")) throw new Error("Failed narrative-review attempts require an error");
    completedAttemptId = String(after.id);
  }
  if (afterAttempts.length === beforeAttempts.length + 1) {
    if (beforeAttempts.some((attempt) => attempt.status === "running")) throw new Error("A running narrative-review attempt must finish before retry");
    const appended = afterAttempts.at(-1)!;
    if (appended.status !== "running" || appended.number !== beforeAttempts.length + 1
      || typeof appended.id !== "string" || typeof appended.startedAt !== "string") {
      throw new Error("New narrative-review attempts must append in running state");
    }
  }

  const beforeFindings = arrayOfRecords(previous.findings, "finding history");
  const afterFindings = arrayOfRecords(next.findings, "finding history");
  if (afterFindings.length < beforeFindings.length) throw new Error("Narrative-review findings are append-only");
  for (let index = 0; index < beforeFindings.length; index += 1) {
    if (canonicalJson(beforeFindings[index]) !== canonicalJson(afterFindings[index])) {
      throw new Error("Narrative-review findings are immutable");
    }
  }
  if (previous.status === "completed" && (next.status !== "completed" || afterFindings.length !== beforeFindings.length)) {
    throw new Error("Completed narrative-review unit findings are immutable");
  }
  if (afterFindings.length > beforeFindings.length) {
    if (!completedAttemptId || next.status !== "completed"
      || afterFindings.slice(beforeFindings.length).some((finding) => finding.attemptId !== completedAttemptId)) {
      throw new Error("Narrative-review findings may only be appended by their completed attempt");
    }
  }
}

function stableAttemptFields(attempt: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, finishedAt: _finishedAt, error: _error, repair: _repair,
    usage: _usage, providerMetadata: _providerMetadata, ...stable } = attempt;
  return stable;
}

function arrayOfRecords(value: unknown, label: string): Array<Record<string, unknown>> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Narrative-review ${label} is invalid`);
  }
  return value as Array<Record<string, unknown>>;
}

function assertAggregateLineage(content: NarrativeReviewAggregateShape): void {
  const aggregate = content as NarrativeReviewAggregateShape & {
    reviewInput?: { fingerprint?: unknown };
    job?: { id?: unknown; units?: Array<{
      id?: unknown; inputFingerprint?: unknown; contextFingerprint?: unknown;
      attempts?: Array<{ id?: unknown }>;
      findings?: Array<{
        id?: unknown; reviewPlanId?: unknown; jobId?: unknown; unitId?: unknown; attemptId?: unknown;
        reviewInputFingerprint?: unknown; contextFingerprint?: unknown;
      }>;
    }> };
  };
  if (!aggregate.job) return;
  if (typeof aggregate.job.id !== "string" || !Array.isArray(aggregate.job.units)) throw new Error("Narrative-review job lineage is invalid");
  const unitIds = new Set<string>(); const findingIds = new Set<string>();
  for (const unit of aggregate.job.units) {
    if (typeof unit.id !== "string" || unitIds.has(unit.id)) throw new Error("Narrative-review unit lineage is invalid");
    unitIds.add(unit.id);
    const attemptIds = new Set((unit.attempts ?? []).map((attempt) => attempt.id).filter((id): id is string => typeof id === "string"));
    if (attemptIds.size !== (unit.attempts ?? []).length) throw new Error("Narrative-review attempt lineage is invalid");
    for (const finding of unit.findings ?? []) {
      if (typeof finding.id !== "string" || findingIds.has(finding.id)
        || finding.reviewPlanId !== content.plan.id || finding.jobId !== aggregate.job.id
        || finding.unitId !== unit.id || !attemptIds.has(String(finding.attemptId))
        || finding.reviewInputFingerprint !== aggregate.reviewInput?.fingerprint
        || finding.contextFingerprint !== unit.contextFingerprint) {
        throw new Error("Narrative-review finding lineage is invalid");
      }
      const stored = finding as Record<string, unknown>;
      if (typeof stored.schemaVersion === "number" && stored.schemaVersion >= 2) {
        const fingerprint = narrativeReviewFindingFingerprint(stored);
        if (stored.fingerprint !== fingerprint || stored.id !== `nrf_${fingerprint.slice(0, 24)}`) {
          throw new Error("Narrative-review finding fingerprint is invalid");
        }
      }
      findingIds.add(finding.id);
    }
  }
}

export function narrativeReviewFindingFingerprint(finding: Record<string, unknown>): string {
  const { schemaId: _schemaId, schemaVersion: _schemaVersion, id: _id, fingerprint: _fingerprint, ...durable } = finding;
  return createHash("sha256").update(canonicalJson(durable)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function map<T>(row: Row): ArtifactVersion<T> {
  return {
    id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
    artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
    content: JSON.parse(row.content_json) as T, stale: Boolean(row.stale),
    restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
  };
}
