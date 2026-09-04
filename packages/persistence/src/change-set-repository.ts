import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ArtifactVersion } from "./artifact-repository.js";
import { transaction, type StoryDatabase } from "./database.js";

export type ChangeSetStatus = "proposed" | "applied" | "rejected" | "superseded";

export interface ChangeSetRecord<T = unknown> {
  id: string;
  projectId: string;
  conversationId: string;
  artifactId: string;
  baseVersionId: string;
  status: ChangeSetStatus;
  summary: string;
  rationale: string;
  candidate: T | null;
  proposal: unknown | null;
  validationFindings: unknown[];
  invalidations: string[];
  appliedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

type ChangeSetRow = {
  id: string; project_id: string; conversation_id: string; artifact_id: string;
  base_version_id: string; status: ChangeSetStatus; summary: string; rationale: string;
  candidate_json: string; proposal_json: string | null; validation_json: string;
  invalidations_json: string; applied_version_id: string | null;
  created_at: string; updated_at: string;
};

const mapChangeSet = <T>(row: ChangeSetRow): ChangeSetRecord<T> => ({
  id: row.id,
  projectId: row.project_id,
  conversationId: row.conversation_id,
  artifactId: row.artifact_id,
  baseVersionId: row.base_version_id,
  status: row.status,
  summary: row.summary,
  rationale: row.rationale,
  candidate: JSON.parse(row.candidate_json) as T | null,
  proposal: row.proposal_json ? JSON.parse(row.proposal_json) : null,
  validationFindings: JSON.parse(row.validation_json) as unknown[],
  invalidations: JSON.parse(row.invalidations_json) as string[],
  appliedVersionId: row.applied_version_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ChangeSetRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create<T>(input: {
    projectId: string;
    conversationId: string;
    artifactId: string;
    baseVersionId: string;
    summary: string;
    rationale: string;
    candidate: T;
    invalidations?: string[];
  }): ChangeSetRecord<T> {
    const base = this.database.prepare(`
      SELECT id FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = ?
    `).get(input.baseVersionId, input.projectId, input.artifactId);
    if (!base) throw new Error("Proposal base version not found");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO change_sets
        (id, project_id, conversation_id, artifact_id, base_version_id, status, summary,
         rationale, candidate_json, invalidations_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.projectId, input.conversationId, input.artifactId, input.baseVersionId,
      input.summary.trim(), input.rationale.trim(), JSON.stringify(input.candidate),
      JSON.stringify(input.invalidations ?? []), now, now,
    );
    return this.get<T>(id)!;
  }

  createOperations(input: {
    projectId: string;
    conversationId: string;
    artifactId: string;
    baseVersionId: string;
    summary: string;
    rationale: string;
    proposal: unknown;
    validationFindings?: unknown[];
    invalidations?: string[];
  }): ChangeSetRecord {
    const base = this.database.prepare(`
      SELECT id FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = ?
    `).get(input.baseVersionId, input.projectId, input.artifactId);
    if (!base) throw new Error("Proposal base version not found");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO change_sets
        (id, project_id, conversation_id, artifact_id, base_version_id, status, summary,
         rationale, candidate_json, proposal_json, validation_json, invalidations_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, 'null', ?, ?, ?, ?, ?)
    `).run(
      id, input.projectId, input.conversationId, input.artifactId, input.baseVersionId,
      input.summary.trim(), input.rationale.trim(), JSON.stringify(input.proposal),
      JSON.stringify(input.validationFindings ?? []), JSON.stringify(input.invalidations ?? []), now, now,
    );
    return this.get(id)!;
  }

  get<T = unknown>(id: string): ChangeSetRecord<T> | undefined {
    const row = this.database.prepare("SELECT * FROM change_sets WHERE id = ?").get(id) as ChangeSetRow | undefined;
    return row ? mapChangeSet<T>(row) : undefined;
  }

  list<T = unknown>(conversationId: string): ChangeSetRecord<T>[] {
    return (this.database.prepare(`
      SELECT * FROM change_sets WHERE conversation_id = ? ORDER BY created_at, id
    `).all(conversationId) as ChangeSetRow[]).map(mapChangeSet<T>);
  }

  listRecent<T = unknown>(conversationId: string, limit = 100): ChangeSetRecord<T>[] {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (this.database.prepare(`SELECT * FROM (
      SELECT *, rowid AS change_order FROM change_sets WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    ) recent ORDER BY created_at, change_order`).all(conversationId, bounded) as ChangeSetRow[]).map(mapChangeSet<T>);
  }

  count(conversationId: string): number {
    return (this.database.prepare("SELECT COUNT(*) count FROM change_sets WHERE conversation_id = ?")
      .get(conversationId) as { count: number }).count;
  }

  reject(id: string): ChangeSetRecord {
    const current = this.get(id);
    if (!current) throw new Error("Proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending proposals can be rejected");
    this.database.prepare("UPDATE change_sets SET status = 'rejected', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.get(id)!;
  }

  markSuperseded(id: string): ChangeSetRecord {
    const current = this.get(id);
    if (!current) throw new Error("Proposal not found");
    this.database.prepare("UPDATE change_sets SET status = 'superseded', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.get(id)!;
  }

  markApplied(id: string, appliedVersionId: string): ChangeSetRecord {
    const current = this.get(id);
    if (!current) throw new Error("Proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending proposals can be applied");
    this.database.prepare(`
      UPDATE change_sets SET status = 'applied', applied_version_id = ?, updated_at = ? WHERE id = ?
    `).run(appliedVersionId, new Date().toISOString(), id);
    return this.get(id)!;
  }

  apply<T>(id: string, schema: z.ZodType<T>): { changeSet: ChangeSetRecord<T>; version: ArtifactVersion<T> } {
    const current = this.get<T>(id);
    if (!current) throw new Error("Proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending proposals can be applied");
    const candidate = schema.parse(current.candidate);
    const result = transaction(this.database, () => {
      const latest = this.database.prepare(`
        SELECT id, version FROM artifact_versions
        WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1
      `).get(current.projectId, current.artifactId) as { id: string; version: number } | undefined;
      if (!latest || latest.id !== current.baseVersionId) {
        this.database.prepare("UPDATE change_sets SET status = 'superseded', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), id);
        return null;
      }
      const versionId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO artifact_versions
          (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)
      `).run(
        versionId, current.projectId, current.artifactId, current.artifactId,
        latest.version + 1, JSON.stringify(candidate), now,
      );
      this.database.prepare(`
        INSERT INTO artifact_workflow_state
          (project_id, artifact_id, status, approved_version_id, updated_at)
        VALUES (?, ?, 'draft', NULL, ?)
        ON CONFLICT(project_id, artifact_id) DO UPDATE SET status = 'draft', updated_at = excluded.updated_at
      `).run(current.projectId, current.artifactId, now);
      this.markDependentsStale(current.projectId, current.artifactId, now);
      this.database.prepare(`
        UPDATE change_sets SET status = 'applied', applied_version_id = ?, updated_at = ? WHERE id = ?
      `).run(versionId, now, id);
      const row = this.database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(versionId) as {
        id: string; project_id: string; artifact_id: string; artifact_type: string; version: number;
        schema_version: number; content_json: string; stale: number; restored_from_version_id: string | null;
        created_at: string;
      };
      return {
        changeSet: this.get<T>(id)!,
        version: {
          id: row.id,
          projectId: row.project_id,
          artifactId: row.artifact_id,
          artifactType: row.artifact_type,
          version: row.version,
          schemaVersion: row.schema_version,
          content: JSON.parse(row.content_json) as T,
          stale: Boolean(row.stale),
          createdAt: row.created_at,
        },
      };
    });
    if (!result) throw new Error("PROPOSAL_BASE_STALE");
    return result;
  }

  applyPrepared<T>(
    id: string,
    content: T,
    schema: z.ZodType<T>,
    dependencies: string[] = [],
  ): { changeSet: ChangeSetRecord<T>; version: ArtifactVersion<T> } {
    const current = this.get<T>(id);
    if (!current) throw new Error("Proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending proposals can be applied");
    const candidate = schema.parse(content);
    const result = transaction(this.database, () => {
      const latest = this.database.prepare(`
        SELECT id, version FROM artifact_versions
        WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1
      `).get(current.projectId, current.artifactId) as { id: string; version: number } | undefined;
      if (!latest || latest.id !== current.baseVersionId) {
        this.database.prepare("UPDATE change_sets SET status = 'superseded', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), id);
        return null;
      }
      const versionId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO artifact_versions
          (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)
      `).run(
        versionId, current.projectId, current.artifactId, current.artifactId,
        latest.version + 1, JSON.stringify(candidate), now,
      );
      for (const upstream of dependencies) {
        this.database.prepare(`
          INSERT OR IGNORE INTO artifact_dependencies
            (project_id, upstream_artifact_id, dependent_artifact_id) VALUES (?, ?, ?)
        `).run(current.projectId, upstream, current.artifactId);
      }
      this.database.prepare(`
        INSERT INTO artifact_workflow_state
          (project_id, artifact_id, status, approved_version_id, updated_at)
        VALUES (?, ?, 'draft', NULL, ?)
        ON CONFLICT(project_id, artifact_id) DO UPDATE SET status = 'draft', updated_at = excluded.updated_at
      `).run(current.projectId, current.artifactId, now);
      this.markDependentsStale(current.projectId, current.artifactId, now);
      this.database.prepare(`
        UPDATE change_sets SET status = 'applied', applied_version_id = ?, updated_at = ? WHERE id = ?
      `).run(versionId, now, id);
      const row = this.database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(versionId) as {
        id: string; project_id: string; artifact_id: string; artifact_type: string; version: number;
        schema_version: number; content_json: string; stale: number; restored_from_version_id: string | null;
        created_at: string;
      };
      return {
        changeSet: this.get<T>(id)!,
        version: {
          id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
          artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
          content: JSON.parse(row.content_json) as T, stale: Boolean(row.stale), createdAt: row.created_at,
        },
      };
    });
    if (!result) throw new Error("PROPOSAL_BASE_STALE");
    return result;
  }

  private markDependentsStale(projectId: string, artifactId: string, now: string): void {
    const stale = new Set<string>();
    const queue = [artifactId];
    while (queue.length) {
      const upstream = queue.shift()!;
      const rows = this.database.prepare(`
        SELECT dependent_artifact_id FROM artifact_dependencies
        WHERE project_id = ? AND upstream_artifact_id = ?
      `).all(projectId, upstream) as Array<{ dependent_artifact_id: string }>;
      for (const row of rows) {
        if (stale.has(row.dependent_artifact_id)) continue;
        stale.add(row.dependent_artifact_id);
        queue.push(row.dependent_artifact_id);
      }
    }
    for (const dependent of stale) {
      this.database.prepare(`
        UPDATE artifact_versions SET stale = 1 WHERE id = (
          SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
          ORDER BY version DESC LIMIT 1
        )
      `).run(projectId, dependent);
      this.database.prepare(`
        UPDATE artifact_workflow_state SET status = 'stale', updated_at = ?
        WHERE project_id = ? AND artifact_id = ?
      `).run(now, projectId, dependent);
    }
  }
}
