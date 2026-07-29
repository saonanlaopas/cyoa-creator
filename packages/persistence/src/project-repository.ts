import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export interface ProjectRecord {
  id: string;
  name: string;
  mode: "quick" | "long-form";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProjectRow = { id: string; name: string; mode: "quick" | "long-form"; archived: number; created_at: string; updated_at: string };

const mapProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id, name: row.name, mode: row.mode, archived: Boolean(row.archived),
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export class ProjectRepository {
  constructor(private readonly database: StoryDatabase) {}

  create(name: string, id = randomUUID(), mode: ProjectRecord["mode"] = "quick"): ProjectRecord {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Project name is required");
    if (mode !== "quick" && mode !== "long-form") throw new Error("Project mode is invalid");
    const now = new Date().toISOString();
    this.database.prepare(
      "INSERT INTO projects (id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, cleanName, mode, now, now);
    return this.get(id)!;
  }

  list(options: { includeArchived?: boolean } = {}): ProjectRecord[] {
    const sql = options.includeArchived
      ? "SELECT * FROM projects ORDER BY updated_at DESC, id"
      : "SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC, id";
    return (this.database.prepare(sql).all() as ProjectRow[]).map(mapProject);
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : undefined;
  }

  rename(id: string, name: string): ProjectRecord {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Project name is required");
    const result = this.database.prepare(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
    ).run(cleanName, new Date().toISOString(), id);
    if (!result.changes) throw new Error("Project not found");
    return this.get(id)!;
  }

  archive(id: string, archived = true): ProjectRecord {
    const result = this.database.prepare(
      "UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?",
    ).run(archived ? 1 : 0, new Date().toISOString(), id);
    if (!result.changes) throw new Error("Project not found");
    return this.get(id)!;
  }

  duplicate(id: string, name?: string): ProjectRecord {
    const source = this.get(id);
    if (!source) throw new Error("Project not found");
    return transaction(this.database, () => {
      const copy = this.create(name ?? `${source.name} (copy)`, randomUUID(), source.mode);
      const versions = this.database.prepare(`
        SELECT av.* FROM artifact_versions av
        JOIN (
          SELECT artifact_id, MAX(version) AS version
          FROM artifact_versions WHERE project_id = ? GROUP BY artifact_id
        ) latest ON latest.artifact_id = av.artifact_id AND latest.version = av.version
        WHERE av.project_id = ?
      `).all(id, id) as Array<Record<string, string | number>>;
      for (const version of versions) {
        this.database.prepare(`
          INSERT INTO artifact_versions
            (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          randomUUID(), copy.id, version.artifact_id, version.artifact_type,
          version.schema_version, version.content_json, version.stale, new Date().toISOString(),
        );
      }
      const dependencies = this.database.prepare(
        "SELECT upstream_artifact_id, dependent_artifact_id FROM artifact_dependencies WHERE project_id = ?",
      ).all(id) as Array<{ upstream_artifact_id: string; dependent_artifact_id: string }>;
      for (const dependency of dependencies) {
        this.database.prepare(`
          INSERT INTO artifact_dependencies (project_id, upstream_artifact_id, dependent_artifact_id)
          VALUES (?, ?, ?)
        `).run(copy.id, dependency.upstream_artifact_id, dependency.dependent_artifact_id);
      }
      return copy;
    });
  }
}
