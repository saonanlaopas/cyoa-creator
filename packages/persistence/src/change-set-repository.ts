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
  candidate: T;
  invalidations: string[];
  appliedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

type ChangeSetRow = {
  id: string; project_id: string; conversation_id: string; artifact_id: string;
  base_version_id: string; status: ChangeSetStatus; summary: string; rationale: string;
  candidate_json: string; invalidations_json: string; applied_version_id: string | null;
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
  candidate: JSON.parse(row.candidate_json) as T,
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

  get<T = unknown>(id: string): ChangeSetRecord<T> | undefined {
    const row = this.database.prepare("SELECT * FROM change_sets WHERE id = ?").get(id) as ChangeSetRow | undefined;
    return row ? mapChangeSet<T>(row) : undefined;
  }

  list<T = unknown>(conversationId: string): ChangeSetRecord<T>[] {
    return (this.database.prepare(`
      SELECT * FROM change_sets WHERE conversation_id = ? ORDER BY created_at, id
    `).all(conversationId) as ChangeSetRow[]).map(mapChangeSet<T>);
  }

  reject(id: string): ChangeSetRecord {
    const current = this.get(id);
    if (!current) throw new Error("Proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending proposals can be rejected");
    this.database.prepare("UPDATE change_sets SET status = 'rejected', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
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
}
