import { randomUUID } from "node:crypto";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const NARRATIVE_REVIEW_ARTIFACT_TYPE = "narrative-review";
const prefix = "narrative-review:";

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
      findingIds.add(finding.id);
    }
  }
}

function map<T>(row: Row): ArtifactVersion<T> {
  return {
    id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
    artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
    content: JSON.parse(row.content_json) as T, stale: Boolean(row.stale),
    restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
  };
}
