import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { artifactChain } from "./schema.js";

export interface ArtifactVersion<T = unknown> {
  id: string;
  projectId: string;
  artifactId: string;
  artifactType: string;
  version: number;
  schemaVersion: number;
  content: T;
  stale: boolean;
  restoredFromVersionId?: string;
  createdAt: string;
}

export interface SaveArtifactInput<T = unknown> {
  projectId: string;
  artifactId: string;
  artifactType?: string;
  schemaVersion?: number;
  content: T;
  schema?: z.ZodType<T>;
  dependencies?: string[];
  simulateFailure?: boolean;
}

type ArtifactRow = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

function mapArtifact<T>(row: ArtifactRow): ArtifactVersion<T> {
  return {
    id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
    artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
    content: JSON.parse(row.content_json) as T, stale: Boolean(row.stale),
    restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly database: StoryDatabase) {}

  saveArtifact<T>(input: SaveArtifactInput<T>): ArtifactVersion<T> {
    const content = input.schema ? input.schema.parse(input.content) : input.content;
    JSON.stringify(content);
    return transaction(this.database, () => {
      const latest = this.database.prepare(`
        SELECT COALESCE(MAX(version), 0) AS version
        FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
      `).get(input.projectId, input.artifactId) as { version: number };
      const artifactType = input.artifactType ?? input.artifactId;
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO artifact_versions
          (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id, input.projectId, input.artifactId, artifactType, latest.version + 1,
        input.schemaVersion ?? 1, JSON.stringify(content), new Date().toISOString(),
      );
      for (const upstream of input.dependencies ?? []) {
        this.addDependency(input.projectId, upstream, input.artifactId);
      }
      const chainIndex = artifactChain.indexOf(artifactType as typeof artifactChain[number]);
      if (chainIndex > 0) this.addDependency(input.projectId, artifactChain[chainIndex - 1], input.artifactId);
      this.markDependentsStale(input.projectId, input.artifactId);
      if (input.simulateFailure) throw new Error("Simulated artifact transaction failure");
      return this.getVersion<T>(id)!;
    });
  }

  private addDependency(projectId: string, upstream: string, dependent: string): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO artifact_dependencies
        (project_id, upstream_artifact_id, dependent_artifact_id) VALUES (?, ?, ?)
    `).run(projectId, upstream, dependent);
  }

  listVersions<T = unknown>(projectId: string, artifactId: string): ArtifactVersion<T>[] {
    return (this.database.prepare(`
      SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC
    `).all(projectId, artifactId) as ArtifactRow[]).map(mapArtifact<T>);
  }

  getCurrent<T = unknown>(projectId: string, artifactId: string): ArtifactVersion<T> | undefined {
    return this.listVersions<T>(projectId, artifactId)[0];
  }

  getVersion<T = unknown>(versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(versionId) as ArtifactRow | undefined;
    return row ? mapArtifact<T>(row) : undefined;
  }

  restore<T = unknown>(projectId: string, artifactId: string, versionId: string): ArtifactVersion<T> {
    const source = this.getVersion<T>(versionId);
    if (!source || source.projectId !== projectId || source.artifactId !== artifactId) {
      throw new Error("Artifact version not found");
    }
    return transaction(this.database, () => {
      const latest = this.getCurrent(projectId, artifactId);
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO artifact_versions
          (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, restored_from_version_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id, projectId, artifactId, source.artifactType, (latest?.version ?? 0) + 1,
        source.schemaVersion, JSON.stringify(source.content), source.id, new Date().toISOString(),
      );
      this.markDependentsStale(projectId, artifactId);
      return this.getVersion<T>(id)!;
    });
  }

  compare(projectId: string, artifactId: string, fromId: string, toId: string): {
    from: ArtifactVersion; to: ArtifactVersion; equal: boolean;
  } {
    const from = this.getVersion(fromId);
    const to = this.getVersion(toId);
    if (!from || !to || from.projectId !== projectId || to.projectId !== projectId ||
      from.artifactId !== artifactId || to.artifactId !== artifactId) {
      throw new Error("Artifact version not found");
    }
    return { from, to, equal: JSON.stringify(from.content) === JSON.stringify(to.content) };
  }

  markDependentsStale(projectId: string, artifactId: string): string[] {
    const stale = new Set<string>();
    const queue = [artifactId];
    while (queue.length) {
      const upstream = queue.shift()!;
      const rows = this.database.prepare(`
        SELECT dependent_artifact_id FROM artifact_dependencies
        WHERE project_id = ? AND upstream_artifact_id = ? ORDER BY dependent_artifact_id
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
    }
    return [...stale].sort();
  }
}
