import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreativeDirectionSchema } from "@story-to-cyoa/domain";
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
  markDependentsStale?: boolean;
}

type ArtifactRow = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

function mapArtifact<T>(row: ArtifactRow): ArtifactVersion<T> {
  const parsed = JSON.parse(row.content_json) as unknown;
  const creativeIdentity = row.artifact_id === "creative-direction" || row.artifact_type === "creative-direction";
  if (creativeIdentity && (row.artifact_id !== "creative-direction" || row.artifact_type !== "creative-direction")) {
    throw new Error("Creative Direction artifact identity is invalid");
  }
  const creativeDirection = creativeIdentity ? CreativeDirectionSchema.parse(parsed) : undefined;
  if (creativeDirection && row.schema_version !== creativeDirection.schemaVersion) {
    throw new Error("Creative Direction schema version is invalid");
  }
  const content = creativeDirection ?? parsed;
  return {
    id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
    artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
    content: content as T, stale: Boolean(row.stale),
    restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly database: StoryDatabase) {}

  saveArtifact<T>(input: SaveArtifactInput<T>): ArtifactVersion<T> {
    return transaction(this.database, () => this.saveArtifactInTransaction(input));
  }

  saveArtifactInTransaction<T>(input: SaveArtifactInput<T>): ArtifactVersion<T> {
    const artifactType = input.artifactType ?? input.artifactId;
    const creativeIdentity = input.artifactId === "creative-direction" || artifactType === "creative-direction";
    if (creativeIdentity && (input.artifactId !== "creative-direction" || artifactType !== "creative-direction")) {
      throw new Error("Creative Direction artifact identity is invalid");
    }
    const creativeDirection = creativeIdentity ? CreativeDirectionSchema.parse(input.content) : undefined;
    const content = creativeDirection ?? (input.schema ? input.schema.parse(input.content) : input.content);
    JSON.stringify(content);
    const latest = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
    `).get(input.projectId, input.artifactId) as { version: number };
    if (creativeIdentity) {
      if ((input.schemaVersion ?? 1) !== creativeDirection!.schemaVersion) {
        throw new Error("Creative Direction schema version is invalid");
      }
      this.validateCreativeDirectionProvenance(input.projectId, input.artifactId, creativeDirection);
    }
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
    if (input.markDependentsStale !== false) this.markDependentsStale(input.projectId, input.artifactId);
    if (input.simulateFailure) throw new Error("Simulated artifact transaction failure");
    return this.getVersion<T>(id)!;
  }

  private addDependency(projectId: string, upstream: string, dependent: string): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO artifact_dependencies
        (project_id, upstream_artifact_id, dependent_artifact_id) VALUES (?, ?, ?)
    `).run(projectId, upstream, dependent);
  }

  listVersions<T = unknown>(projectId: string, artifactId: string): ArtifactVersion<T>[] {
    const versions = (this.database.prepare(`
      SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC
    `).all(projectId, artifactId) as ArtifactRow[]).map(mapArtifact<T>);
    versions.forEach((version) => {
      if (version.artifactId === "creative-direction") this.validateCreativeDirectionProvenance(projectId, artifactId, version.content);
    });
    return versions;
  }

  getCurrent<T = unknown>(projectId: string, artifactId: string): ArtifactVersion<T> | undefined {
    return this.listVersions<T>(projectId, artifactId)[0];
  }

  getVersion<T = unknown>(versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare("SELECT * FROM artifact_versions WHERE id = ?").get(versionId) as ArtifactRow | undefined;
    const version = row ? mapArtifact<T>(row) : undefined;
    if (version?.artifactId === "creative-direction") {
      this.validateCreativeDirectionProvenance(version.projectId, version.artifactId, version.content);
    }
    return version;
  }

  restore<T = unknown>(projectId: string, artifactId: string, versionId: string, options: { markDependentsStale?: boolean } = {}): ArtifactVersion<T> {
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
      if (options.markDependentsStale !== false) this.markDependentsStale(projectId, artifactId);
      return this.getVersion<T>(id)!;
    });
  }

  private validateCreativeDirectionProvenance(projectId: string, artifactId: string, content: unknown): void {
    if (artifactId !== "creative-direction" || !content || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("Creative Direction artifact identity is invalid");
    }
    const records = (content as { fieldProvenance?: unknown }).fieldProvenance;
    if (!Array.isArray(records)) throw new Error("Creative Direction provenance is invalid");
    for (const item of records) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Creative Direction provenance is invalid");
      const reference = (item as { reference?: unknown }).reference;
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error("Creative Direction provenance is invalid");
      const value = reference as { kind?: unknown; targetId?: unknown; versionId?: unknown; unavailable?: unknown };
      const targetId = typeof value.targetId === "string" ? value.targetId : undefined;
      const versionId = typeof value.versionId === "string" ? value.versionId : undefined;
      if (value.unavailable === true) continue;
      switch (value.kind) {
        case "manual-edit":
          if (versionId && !this.database.prepare(`SELECT 1 FROM artifact_versions
            WHERE id = ? AND project_id = ? AND artifact_id = 'creative-direction'`).get(versionId, projectId)) {
            throw new Error("Creative Direction provenance references another project or missing version");
          }
          break;
        case "migration-derived":
          if (!targetId || !versionId || !this.database.prepare(`SELECT 1 FROM artifact_versions
            WHERE id = ? AND project_id = ? AND artifact_id = ?`).get(versionId, projectId, targetId)) {
            throw new Error("Creative Direction provenance references another project or missing artifact version");
          }
          break;
        case "approved-artifact":
          if (!targetId || !versionId || !this.database.prepare(`SELECT 1 FROM artifact_versions version
            JOIN artifact_workflow_state workflow
              ON workflow.project_id = version.project_id AND workflow.artifact_id = version.artifact_id
            WHERE version.id = ? AND version.project_id = ? AND version.artifact_id = ?
              AND workflow.approved_version_id = version.id`).get(versionId, projectId, targetId)) {
            throw new Error("Creative Direction approved-artifact provenance must reference the exact approved version in this project");
          }
          break;
        case "user-message":
          if (!targetId || !this.database.prepare(`SELECT 1 FROM messages message
            JOIN conversations conversation ON conversation.id = message.conversation_id
            WHERE message.id = ? AND conversation.project_id = ?`).get(targetId, projectId)) {
            throw new Error("Creative Direction provenance references another project or missing message");
          }
          break;
        case "proposal":
          if (!targetId || !this.database.prepare("SELECT 1 FROM change_sets WHERE id = ? AND project_id = ?")
            .get(targetId, projectId)) {
            throw new Error("Creative Direction provenance references another project or missing proposal");
          }
          break;
        case "source-evidence":
        case "source-observation":
        case "author-override":
          throw new Error(`Creative Direction provenance kind ${String(value.kind)} is not available in A1`);
        default:
          throw new Error("Creative Direction provenance kind is invalid");
      }
    }
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

  markCurrentStale(projectId: string, artifactId: string): boolean {
    const result = this.database.prepare(`UPDATE artifact_versions SET stale = 1 WHERE id = (
      SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ? ORDER BY version DESC LIMIT 1
    )`).run(projectId, artifactId);
    return result.changes > 0;
  }
}
