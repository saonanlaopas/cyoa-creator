import { randomUUID } from "node:crypto";
import {
  CreativeDirectionSchema,
  compareCreativeDirectionStrings,
  creativeDirectionFingerprints,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { ArtifactRepository } from "./artifact-repository.js";

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

  remove(id: string): void {
    const result = this.database.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (!result.changes) throw new Error("Project not found");
  }

  duplicate(id: string, name?: string): ProjectRecord {
    const source = this.get(id);
    if (!source) throw new Error("Project not found");
    return transaction(this.database, () => {
      const copy = this.create(name ?? `${source.name} (copy)`, randomUUID(), source.mode);
      const versions = this.database.prepare(`
        SELECT * FROM artifact_versions WHERE project_id = ? ORDER BY artifact_id, version
      `).all(id) as Array<Record<string, string | number | null>>;
      const versionIdMap = new Map<string, string>();
      const conversations = this.database.prepare(
        "SELECT * FROM conversations WHERE project_id = ? ORDER BY created_at, id",
      ).all(id) as Array<Record<string, string | number | null>>;
      const conversationIdMap = new Map(conversations.map((row) => [String(row.id), randomUUID()]));
      const messages = this.database.prepare(`SELECT messages.* FROM messages
        JOIN conversations ON conversations.id = messages.conversation_id
        WHERE conversations.project_id = ? ORDER BY messages.created_at, messages.rowid`).all(id) as Array<Record<string, string | number | null>>;
      const messageIdMap = new Map(messages.map((row) => [String(row.id), randomUUID()]));
      const changeSets = this.database.prepare(
        "SELECT * FROM change_sets WHERE project_id = ? ORDER BY created_at, id",
      ).all(id) as Array<Record<string, string | number | null>>;
      const changeSetIdMap = new Map(changeSets.map((row) => [String(row.id), randomUUID()]));
      for (const version of versions) versionIdMap.set(String(version.id), randomUUID());
      const allIds = new Map<string, string>([
        [id, copy.id], ...versionIdMap, ...conversationIdMap, ...messageIdMap, ...changeSetIdMap,
      ]);

      for (const version of versions) {
        let contentJson = String(version.content_json);
        if (version.artifact_id === "creative-direction") {
          const content = remapJsonValue(
            CreativeDirectionSchema.parse(JSON.parse(contentJson)), allIds,
          ) as ReturnType<typeof CreativeDirectionSchema.parse>;
          content.fieldProvenance.sort((left, right) => compareCreativeDirectionStrings(JSON.stringify(left), JSON.stringify(right)));
          content.provenanceFingerprint = creativeDirectionFingerprints(content).provenanceFingerprint;
          contentJson = JSON.stringify(CreativeDirectionSchema.parse(content));
        }
        this.database.prepare(`
          INSERT INTO artifact_versions
            (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, restored_from_version_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          versionIdMap.get(String(version.id))!, copy.id, version.artifact_id, version.artifact_type,
          version.version, version.schema_version, contentJson, version.stale,
          version.restored_from_version_id ? requireMapped(versionIdMap, String(version.restored_from_version_id)) : null,
          version.created_at,
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
      const workflows = this.database.prepare(
        "SELECT * FROM artifact_workflow_state WHERE project_id = ? ORDER BY artifact_id",
      ).all(id) as Array<Record<string, string | number | null>>;
      for (const workflow of workflows) {
        this.database.prepare(`INSERT INTO artifact_workflow_state
          (project_id, artifact_id, status, approved_version_id, updated_at) VALUES (?, ?, ?, ?, ?)`)
          .run(copy.id, workflow.artifact_id, workflow.status,
            workflow.approved_version_id ? requireMapped(versionIdMap, String(workflow.approved_version_id)) : null,
            workflow.updated_at);
      }
      const approvals = this.database.prepare(
        "SELECT * FROM artifact_version_approvals WHERE project_id = ? ORDER BY approved_at, version_id",
      ).all(id) as Array<Record<string, string | number | null>>;
      for (const approval of approvals) this.database.prepare(`INSERT INTO artifact_version_approvals
        (project_id, artifact_id, version_id, approved_at) VALUES (?, ?, ?, ?)`)
        .run(copy.id, approval.artifact_id, requireMapped(versionIdMap, String(approval.version_id)), approval.approved_at);

      for (const conversation of conversations) this.database.prepare(`INSERT INTO conversations
        (id, project_id, title, scope_json, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(requireMapped(conversationIdMap, String(conversation.id)), copy.id, conversation.title,
          remapJsonText(String(conversation.scope_json), allIds), conversation.summary,
          conversation.created_at, conversation.updated_at);
      for (const message of messages) this.database.prepare(`INSERT INTO messages
        (id, conversation_id, role, content, intent, scope_json, context_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(requireMapped(messageIdMap, String(message.id)), requireMapped(conversationIdMap, String(message.conversation_id)),
          message.role, message.content, message.intent, remapJsonText(String(message.scope_json), allIds),
          remapJsonText(String(message.context_json), allIds), remapJsonText(String(message.metadata_json), allIds), message.created_at);
      for (const change of changeSets) this.database.prepare(`INSERT INTO change_sets
        (id, project_id, conversation_id, artifact_id, base_version_id, status, summary, rationale,
          candidate_json, proposal_json, validation_json, invalidations_json, applied_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(requireMapped(changeSetIdMap, String(change.id)), copy.id,
          requireMapped(conversationIdMap, String(change.conversation_id)), change.artifact_id,
          requireMapped(versionIdMap, String(change.base_version_id)), change.status, change.summary, change.rationale,
          remapJsonText(String(change.candidate_json), allIds),
          change.proposal_json === null ? null : remapJsonText(String(change.proposal_json), allIds),
          remapJsonText(String(change.validation_json), allIds), remapJsonText(String(change.invalidations_json), allIds),
          change.applied_version_id ? requireMapped(versionIdMap, String(change.applied_version_id)) : null,
          change.created_at, change.updated_at);

      new ArtifactRepository(this.database).listVersions(copy.id, "creative-direction");
      return copy;
    });
  }
}

function requireMapped(map: ReadonlyMap<string, string>, id: string): string {
  const mapped = map.get(id);
  if (!mapped) throw new Error(`Project duplicate is missing required lineage for ${id}`);
  return mapped;
}

function remapJsonText(value: string, ids: ReadonlyMap<string, string>): string {
  return JSON.stringify(remapJsonValue(JSON.parse(value), ids));
}

function remapJsonValue(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapJsonValue(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, remapJsonValue(item, ids)]),
  );
  return value;
}
