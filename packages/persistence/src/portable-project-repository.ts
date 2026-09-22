import { CreativeDirectionSchema } from "@story-to-cyoa/domain";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const PORTABLE_PROJECT_TABLES = [
  "projects", "artifact_versions", "artifact_workflow_state", "artifact_version_approvals", "artifact_dependencies",
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
export type PortableProjectValidator = (database: StoryDatabase, projectId: string) => void;

const rowFingerprint = (row: PortableRow) => stableFingerprint(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));

export function reconstructLegacyArtifactApprovalHistory(bundle: PortableProjectRows): PortableRow[] {
  const artifacts = new Map<string, PortableRow>();
  for (const row of bundle.tables.artifact_versions) {
    if (row.project_id !== bundle.projectId || typeof row.id !== "string" || typeof row.artifact_id !== "string") {
      throw new Error("portable_project_lineage_invalid: legacy approval artifact identity");
    }
    if (artifacts.has(row.id)) throw new Error("portable_project_lineage_invalid: duplicate artifact version identity");
    artifacts.set(row.id, row);
  }
  const approvals = new Map<string, PortableRow>();
  const add = (artifactId: unknown, versionId: unknown, approvedAt: unknown): void => {
    if (typeof artifactId !== "string" || typeof versionId !== "string" || typeof approvedAt !== "string") {
      throw new Error("portable_project_lineage_invalid: legacy approval identity");
    }
    const artifact = artifacts.get(versionId);
    if (!artifact || artifact.project_id !== bundle.projectId || artifact.artifact_id !== artifactId) {
      throw new Error("portable_project_lineage_invalid: legacy approval artifact/version mismatch");
    }
    const key = `${artifactId}\0${versionId}`;
    if (!approvals.has(key)) approvals.set(key, {
      project_id: bundle.projectId, artifact_id: artifactId, version_id: versionId, approved_at: approvedAt,
    });
  };

  for (const workflow of bundle.tables.artifact_workflow_state) {
    if (workflow.project_id !== bundle.projectId) {
      throw new Error("portable_project_lineage_invalid: legacy approval workflow project");
    }
    if (workflow.approved_version_id !== null) {
      add(workflow.artifact_id, workflow.approved_version_id, workflow.updated_at);
    }
  }
  for (const row of bundle.tables.artifact_versions) {
    if (row.artifact_id !== "creative-direction" && row.artifact_type !== "creative-direction") continue;
    if (row.artifact_id !== "creative-direction" || row.artifact_type !== "creative-direction") {
      throw new Error("portable_project_lineage_invalid: legacy Creative Direction identity");
    }
    if (row.schema_version !== 1 || typeof row.content_json !== "string" || typeof row.created_at !== "string") {
      throw new Error("portable_project_domain_invalid: legacy Creative Direction schema");
    }
    let direction: ReturnType<typeof CreativeDirectionSchema.parse>;
    try { direction = CreativeDirectionSchema.parse(JSON.parse(row.content_json)); }
    catch (error) {
      throw new Error(`portable_project_domain_invalid: legacy Creative Direction provenance: ${(error as Error).message}`);
    }
    for (const provenance of direction.fieldProvenance) {
      if (provenance.reference?.kind === "approved-artifact") {
        add(provenance.reference.targetId, provenance.reference.versionId, row.created_at);
      }
    }
  }
  return [...approvals.values()].sort((left, right) => rowFingerprint(left).localeCompare(rowFingerprint(right)));
}

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

  importRows(bundle: PortableProjectRows, validateProject: PortableProjectValidator): void {
    transaction(this.database, () => this.importRowsInTransaction(bundle, validateProject));
  }

  importRowsInTransaction(bundle: PortableProjectRows, validateProject: PortableProjectValidator): void {
    if (this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(bundle.projectId)) {
      throw new Error("portable_project_conflict: a project with this stable ID already exists");
    }
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
    this.validateJsonFields(bundle);
    this.validateExactLineage(bundle.projectId);
    validateProject(this.database, bundle.projectId);
  }

  private validateJsonFields(bundle: PortableProjectRows): void {
    for (const table of PORTABLE_PROJECT_TABLES) {
      for (const row of bundle.tables[table]) {
        for (const [column, value] of Object.entries(row)) {
          if (!column.endsWith("_json") || typeof value !== "string") continue;
          try { JSON.parse(value); }
          catch { throw new Error(`portable_project_json_invalid: ${table}.${column}`); }
        }
      }
    }
  }

  private validateExactLineage(projectId: string): void {
    const invalid = (sql: string): boolean => Boolean(this.database.prepare(sql).get(projectId));
    const checks: Array<[string, string]> = [
      ["structure head", `SELECT 1 FROM passage_structure_heads h LEFT JOIN passage_structure_versions v
        ON v.id = h.version_id AND v.project_id = h.project_id
        WHERE h.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["entity head", `SELECT 1 FROM passage_entity_heads h LEFT JOIN passage_entity_versions v
        ON v.id = h.version_id AND v.project_id = h.project_id AND v.entity_kind = h.entity_kind AND v.entity_id = h.entity_id
        WHERE h.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["artifact workflow approval", `SELECT 1 FROM artifact_workflow_state w LEFT JOIN artifact_versions v
        ON v.id = w.approved_version_id AND v.project_id = w.project_id AND v.artifact_id = w.artifact_id
        WHERE w.project_id = ? AND ((w.approved_version_id IS NOT NULL AND v.id IS NULL)
          OR (w.status = 'approved' AND w.approved_version_id IS NULL)) LIMIT 1`],
      ["artifact workflow approval history", `SELECT 1 FROM artifact_workflow_state w
        LEFT JOIN artifact_version_approvals a ON a.project_id = w.project_id
          AND a.artifact_id = w.artifact_id AND a.version_id = w.approved_version_id
        WHERE w.project_id = ? AND w.approved_version_id IS NOT NULL AND a.version_id IS NULL LIMIT 1`],
      ["artifact approval history", `SELECT 1 FROM artifact_version_approvals a LEFT JOIN artifact_versions v
        ON v.id = a.version_id AND v.project_id = a.project_id AND v.artifact_id = a.artifact_id
        WHERE a.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["approved passage snapshot", `SELECT 1 FROM passage_plan_state s LEFT JOIN passage_plan_snapshots p
        ON p.id = s.approved_snapshot_id AND p.project_id = s.project_id AND p.status = 'approved'
        WHERE s.project_id = ? AND ((s.approved_snapshot_id IS NOT NULL AND p.id IS NULL)
          OR (s.status = 'approved' AND s.approved_snapshot_id IS NULL)) LIMIT 1`],
      ["snapshot item", `SELECT 1 FROM passage_plan_snapshot_items i
        JOIN passage_plan_snapshots s ON s.id = i.snapshot_id
        LEFT JOIN passage_entity_versions v ON v.id = i.version_id AND v.project_id = s.project_id
          AND v.entity_kind = i.entity_kind AND v.entity_id = i.entity_id
        WHERE s.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["snapshot structure", `SELECT 1 FROM passage_plan_snapshots s LEFT JOIN passage_structure_versions v
        ON v.id = s.structure_version_id AND v.project_id = s.project_id
        WHERE s.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["artifact restore", `SELECT 1 FROM artifact_versions a LEFT JOIN artifact_versions source
        ON source.id = a.restored_from_version_id AND source.project_id = a.project_id
          AND source.artifact_id = a.artifact_id AND source.version < a.version
        WHERE a.project_id = ? AND a.restored_from_version_id IS NOT NULL AND source.id IS NULL LIMIT 1`],
      ["structure restore", `SELECT 1 FROM passage_structure_versions v LEFT JOIN passage_structure_versions source
        ON source.id = v.restored_from_version_id AND source.project_id = v.project_id AND source.version < v.version
        WHERE v.project_id = ? AND v.restored_from_version_id IS NOT NULL AND source.id IS NULL LIMIT 1`],
      ["entity restore", `SELECT 1 FROM passage_entity_versions v LEFT JOIN passage_entity_versions source
        ON source.id = v.restored_from_version_id AND source.project_id = v.project_id
          AND source.entity_kind = v.entity_kind AND source.entity_id = v.entity_id AND source.version < v.version
        WHERE v.project_id = ? AND v.restored_from_version_id IS NOT NULL AND source.id IS NULL LIMIT 1`],
      ["draft base", `SELECT 1 FROM passage_draft_versions d LEFT JOIN passage_entity_versions v
        ON v.id = d.based_on_passage_plan_version_id AND v.project_id = d.project_id
          AND v.entity_kind = 'passage' AND v.entity_id = d.passage_id
        WHERE d.project_id = ? AND v.id IS NULL LIMIT 1`],
      ["draft restore", `SELECT 1 FROM passage_draft_versions d LEFT JOIN passage_draft_versions source
        ON source.id = d.restored_from_version_id AND source.project_id = d.project_id
          AND source.passage_id = d.passage_id AND source.version < d.version
        WHERE d.project_id = ? AND d.restored_from_version_id IS NOT NULL AND source.id IS NULL LIMIT 1`],
      ["draft head", `SELECT 1 FROM passage_draft_heads h
        LEFT JOIN passage_draft_versions current ON current.id = h.current_version_id
          AND current.project_id = h.project_id AND current.passage_id = h.passage_id
        LEFT JOIN passage_draft_versions accepted ON accepted.id = h.accepted_version_id
          AND accepted.project_id = h.project_id AND accepted.passage_id = h.passage_id
          AND accepted.lifecycle_status IN ('accepted', 'reviewed', 'locked')
        WHERE h.project_id = ? AND (current.id IS NULL OR (h.accepted_version_id IS NOT NULL AND accepted.id IS NULL)
          OR (h.accepted_locked = 1 AND accepted.lifecycle_status != 'locked')) LIMIT 1`],
      ["repair application proposal", `SELECT 1 FROM repair_applications a LEFT JOIN artifact_versions proposal
        ON proposal.id = a.proposal_artifact_version_id AND proposal.project_id = a.project_id
          AND proposal.artifact_type = 'repair-proposal'
        LEFT JOIN artifact_versions plan ON plan.id = a.repair_plan_artifact_version_id AND plan.project_id = a.project_id
          AND plan.artifact_type = 'repair-plan'
        WHERE a.project_id = ? AND (proposal.id IS NULL OR plan.id IS NULL) LIMIT 1`],
      ["repair draft link", `SELECT 1 FROM repair_application_draft_links l
        LEFT JOIN repair_applications a ON a.id = l.application_id AND a.project_id = l.project_id
        LEFT JOIN passage_draft_versions d ON d.id = l.draft_version_id AND d.project_id = l.project_id
          AND d.passage_id = l.passage_id
        WHERE l.project_id = ? AND (a.id IS NULL OR d.id IS NULL) LIMIT 1`],
      ["repair result", `SELECT 1 FROM repair_application_result_versions r
        LEFT JOIN repair_applications a ON a.id = r.application_id AND a.project_id = r.project_id
        WHERE r.project_id = ? AND a.id IS NULL LIMIT 1`],
    ];
    for (const [label, sql] of checks) {
      if (invalid(sql)) throw new Error(`portable_project_lineage_invalid: ${label}`);
    }
  }

  private columns(table: PortableProjectTable): string[] {
    return (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name);
  }
}
