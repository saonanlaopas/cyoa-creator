import { stableFingerprint } from "@story-to-cyoa/runtime";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const PORTABLE_PROJECT_TABLES = [
  "projects", "artifact_versions", "artifact_workflow_state", "artifact_dependencies",
  "passage_structure_versions", "passage_structure_heads", "passage_entity_versions", "passage_entity_heads",
  "passage_plan_snapshots", "passage_plan_snapshot_items", "passage_plan_state", "passage_finding_overrides",
  "drafting_plans", "drafting_plan_units", "drafting_plan_unit_passages", "drafting_jobs", "drafting_job_units",
  "drafting_unit_attempts", "drafting_unit_outputs",
  "passage_draft_versions", "passage_draft_upstream_artifacts", "passage_draft_neighbor_versions",
  "passage_draft_generation_provenance", "passage_draft_heads", "passage_draft_staleness_events", "passage_draft_acceptance_applications",
  "passage_draft_acceptance_items", "repair_applications", "repair_application_draft_links",
  "repair_application_result_versions",
] as const;

export type PortableProjectTable = typeof PORTABLE_PROJECT_TABLES[number];
export type PortableSqlValue = string | number | null;
export type PortableRow = Record<string, PortableSqlValue>;
export interface PortableProjectRows { projectId: string; tables: Record<PortableProjectTable, PortableRow[]> }

const rowFingerprint = (row: PortableRow) => stableFingerprint(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));

export class PortableProjectRepository {
  public constructor(private readonly database: StoryDatabase) {}

  exportRows(projectId: string): PortableProjectRows {
    const project = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as PortableRow | undefined;
    if (!project) throw new Error("Portable project does not exist");
    const tables = {} as Record<PortableProjectTable, PortableRow[]>;
    for (const table of PORTABLE_PROJECT_TABLES) {
      let rows: PortableRow[];
      if (table === "projects") rows = [project];
      else if (table === "passage_plan_snapshot_items") rows = this.database.prepare(`
        SELECT items.* FROM passage_plan_snapshot_items items
        JOIN passage_plan_snapshots snapshots ON snapshots.id = items.snapshot_id
        WHERE snapshots.project_id = ?`).all(projectId) as PortableRow[];
      else if (table === "artifact_versions") rows = this.database.prepare(
        "SELECT * FROM artifact_versions WHERE project_id = ? AND artifact_id NOT IN ('source', 'source-scope')",
      ).all(projectId) as PortableRow[];
      else if (table === "artifact_workflow_state") rows = this.database.prepare(
        "SELECT * FROM artifact_workflow_state WHERE project_id = ? AND artifact_id NOT IN ('source', 'source-scope')",
      ).all(projectId) as PortableRow[];
      else if (table === "artifact_dependencies") rows = this.database.prepare(
        "SELECT * FROM artifact_dependencies WHERE project_id = ? AND upstream_artifact_id NOT IN ('source', 'source-scope') AND dependent_artifact_id NOT IN ('source', 'source-scope')",
      ).all(projectId) as PortableRow[];
      else rows = this.database.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId) as PortableRow[];
      tables[table] = rows.sort((a, b) => rowFingerprint(a).localeCompare(rowFingerprint(b)));
    }
    return { projectId, tables };
  }

  importRows(bundle: PortableProjectRows): void {
    if (this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(bundle.projectId)) {
      throw new Error("portable_project_conflict: a project with this stable ID already exists");
    }
    transaction(this.database, () => {
      this.database.exec("PRAGMA defer_foreign_keys = ON");
      const deferredStatuses: Array<{ table: string; keys: PortableRow; status: PortableSqlValue }> = [];
      for (const table of PORTABLE_PROJECT_TABLES) {
        const expected = this.columns(table);
        for (const row of bundle.tables[table]) {
          const keys = Object.keys(row).sort();
          if (keys.join("\0") !== [...expected].sort().join("\0")) throw new Error(`portable_project_schema_invalid: ${table} columns differ`);
          if (table === "projects") {
            if (row.id !== bundle.projectId) throw new Error("portable_project_lineage_invalid: project identity differs");
          } else if (table !== "passage_plan_snapshot_items" && row.project_id !== bundle.projectId) {
            throw new Error(`portable_project_lineage_invalid: ${table} belongs to another project`);
          }
          const insertRow = { ...row };
          if (["drafting_jobs", "drafting_job_units", "drafting_unit_attempts"].includes(table) && row.status !== "running") {
            deferredStatuses.push({ table, keys: table === "drafting_jobs" ? { id: row.id } : table === "drafting_job_units"
              ? { job_id: row.job_id, unit_id: row.unit_id } : { id: row.id }, status: row.status });
            insertRow.status = "running";
          }
          const placeholders = expected.map(() => "?").join(",");
          this.database.prepare(`INSERT INTO ${table} (${expected.join(",")}) VALUES (${placeholders})`)
            .run(...expected.map((key) => insertRow[key]));
        }
      }
      for (const pending of deferredStatuses) {
        const keys = Object.keys(pending.keys);
        this.database.prepare(`UPDATE ${pending.table} SET status = ? WHERE ${keys.map((key) => `${key} = ?`).join(" AND ")}`)
          .run(pending.status, ...keys.map((key) => pending.keys[key]));
      }
      const violations = this.database.prepare("PRAGMA foreign_key_check").all() as unknown[];
      if (violations.length) throw new Error("portable_project_lineage_invalid: foreign-key validation failed");
    });
  }

  private columns(table: PortableProjectTable): string[] {
    return (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name);
  }
}
