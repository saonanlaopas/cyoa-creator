import { randomUUID } from "node:crypto";
import { AnalysisSourceSchema, CreativeDirectionSchema, SourceEvidenceMaterialSchema, UnavailableSourceSchema, isUnavailableSource, sourceDigest } from "@story-to-cyoa/domain";
import { readSourceMaterial } from "./source-material.js";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { SOURCE_ANALYSIS_TABLES } from "./source-analysis-duplication.js";
import { validateSourceAnalysisDatabase } from "./source-analysis-validation.js";
import { validateAdaptationDatabase } from "./adaptation-intent-validation.js";
import { FOUNDATION_BOOTSTRAP_TABLES } from "./foundation-bootstrap-schema.js";
import { validateFoundationBootstrapDatabase } from "./foundation-bootstrap-repository.js";
import { redactFoundationBootstrapRows, unavailableConversationEvidence } from "./foundation-bootstrap-portability.js";
import { assertSetupProposalSource } from "./setup-proposal-repository.js";
import { validateImageAssets } from "./image-asset-validation.js";
import { validateIllustratedScenes } from "./illustrated-scene-validation.js";

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
  ...SOURCE_ANALYSIS_TABLES,
  ...FOUNDATION_BOOTSTRAP_TABLES,
] as const;

export type PortableProjectTable = typeof PORTABLE_PROJECT_TABLES[number];
export type PortableSqlValue = string | number | null;
export type PortableRow = Record<string, PortableSqlValue>;
export const STUDIO_PORTABLE_TABLES = ["conversations", "messages", "change_sets", "conversation_summary_series",
  "conversation_summary_versions", "conversation_summary_heads", "pinned_decisions", "pinned_decision_versions",
  "pinned_decision_heads", "setup_proposals"] as const;
export type StudioPortableTable = typeof STUDIO_PORTABLE_TABLES[number];
export interface PortableProjectRows {
  projectId: string;
  tables: Record<PortableProjectTable, PortableRow[]>;
  studio?: Record<StudioPortableTable, PortableRow[]>;
}
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

/**
 * Portable archives (and the verified backups built on them) exclude chat bodies and conversation proposals.
 * Creative Direction provenance that cites them is exported with an explicit unavailable marker so an imported
 * project never presents that evidence as resolved. Material content and its fingerprint are unchanged.
 */
const CONVERSATION_EVIDENCE_KINDS = new Set(["user-message", "proposal"]);
function redactConversationEvidence(row: PortableRow): PortableRow {
  if (row.artifact_id !== "creative-direction" || typeof row.content_json !== "string") return row;
  const content = JSON.parse(row.content_json) as {
    fieldProvenance?: Array<{ reference?: { kind?: string; unavailable?: boolean } }>;
  };
  const records = content.fieldProvenance ?? [];
  if (!records.some((record) => CONVERSATION_EVIDENCE_KINDS.has(record.reference?.kind ?? "") && record.reference?.unavailable !== true)) {
    return row;
  }
  const redacted = unavailableConversationEvidence(CreativeDirectionSchema.parse(content));
  return { ...row, content_json: JSON.stringify(redacted) };
}

export class PortableProjectRepository {
  public constructor(private readonly database: StoryDatabase) {}

  exportRows(projectId: string, fullFidelity = false): PortableProjectRows {
    const project = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as PortableRow | undefined;
    if (!project) throw new Error("Portable project does not exist");
    validateFoundationBootstrapDatabase(this.database, projectId);
    validateImageAssets(this.database, projectId);
    validateIllustratedScenes(this.database, projectId);
    const tables = {} as Record<PortableProjectTable, PortableRow[]>;
    const sourceRows = project.mode === "long-form" ? this.database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'source'").all(projectId) as Array<{ content_json: string }> : [];
    const retainSourceEvidence = sourceRows.some((row) => AnalysisSourceSchema.safeParse(JSON.parse(row.content_json)).success || UnavailableSourceSchema.safeParse(JSON.parse(row.content_json)).success);
    for (const table of PORTABLE_PROJECT_TABLES) {
      let rows: PortableRow[];
      if (table === "projects") rows = [project];
      else if (table === "passage_plan_snapshot_items") rows = this.database.prepare(`
        SELECT items.* FROM passage_plan_snapshot_items items
        JOIN passage_plan_snapshots snapshots ON snapshots.id = items.snapshot_id
        WHERE snapshots.project_id = ?`).all(projectId) as PortableRow[];
      else if (table === "artifact_versions") rows = (this.database.prepare(
        `SELECT * FROM artifact_versions WHERE project_id = ? ${retainSourceEvidence ? "" : "AND artifact_id NOT IN ('source', 'source-scope')"}`,
      ).all(projectId) as PortableRow[]).map((row) => fullFidelity ? row : redactConversationEvidence(row));
      else if (table === "artifact_workflow_state") rows = this.database.prepare(
        `SELECT * FROM artifact_workflow_state WHERE project_id = ? ${retainSourceEvidence ? "" : "AND artifact_id NOT IN ('source', 'source-scope')"}`,
      ).all(projectId) as PortableRow[];
      else if (table === "artifact_dependencies") rows = this.database.prepare(
        `SELECT * FROM artifact_dependencies WHERE project_id = ? ${retainSourceEvidence ? "" : "AND upstream_artifact_id NOT IN ('source', 'source-scope') AND dependent_artifact_id NOT IN ('source', 'source-scope')"}`,
      ).all(projectId) as PortableRow[];
      else rows = this.database.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId) as PortableRow[];
      tables[table] = rows.sort((a, b) => rowFingerprint(a).localeCompare(rowFingerprint(b)));
    }
    const bundle = { projectId, tables };
    if (!fullFidelity) redactFoundationBootstrapRows(bundle);
    for (const table of FOUNDATION_BOOTSTRAP_TABLES) tables[table].sort((a, b) => rowFingerprint(a).localeCompare(rowFingerprint(b)));
    return bundle;
  }

  exportStudioRows(projectId: string): PortableProjectRows {
    const bundle = this.exportRows(projectId, true);
    bundle.studio = {} as Record<StudioPortableTable, PortableRow[]>;
    for (const table of STUDIO_PORTABLE_TABLES) {
      bundle.studio[table] = (table === "messages"
        ? this.database.prepare("SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = ? ORDER BY m.rowid")
        : this.database.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY rowid`)).all(projectId) as PortableRow[];
    }
    return bundle;
  }

  sourceEvidenceRows(projectId: string): { projectId: string; tables: { artifact_versions: PortableRow[] } } {
    if (!this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("Project not found");
    return { projectId, tables: { artifact_versions: this.database.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND (artifact_id='source' OR artifact_type='source-evidence-material') ORDER BY id").all(projectId) as PortableRow[] } };
  }

  unavailableSourcePage(projectId: string, offset: number) {
    if (!this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("Project not found");
    const evidence = this.database.prepare(`SELECT s.id AS sourceVersionId,
      json_extract(s.content_json,'$.sourceFingerprint') AS sourceFingerprint,
      json_extract(s.content_json,'$.availability') AS availability FROM artifact_versions s
      WHERE s.project_id=? AND s.artifact_id='source' AND json_extract(s.content_json,'$.schemaId')='cyoa.unavailable-source'
      AND NOT EXISTS(SELECT 1 FROM artifact_versions m WHERE m.project_id=s.project_id
        AND m.artifact_type='source-evidence-material' AND json_extract(m.content_json,'$.sourceVersionId')=s.id)
      ORDER BY s.id LIMIT 21 OFFSET ?`).all(projectId, offset);
    const omissions = this.database.prepare(`SELECT json_array_length(content_json,'$.omissions') AS count FROM artifact_versions
      WHERE project_id=? AND artifact_id='studio-archive-evidence' ORDER BY version DESC LIMIT 1`).get(projectId) as { count: number } | undefined;
    return { evidence: evidence.slice(0, 20), hasMore: evidence.length > 20, omittedHistoryCount: omissions?.count ?? 0 };
  }

  reattachSource(projectId: string, versionId: string, value: unknown, validateProject: PortableProjectValidator): void {
    transaction(this.database, () => {
      const row = this.database.prepare("SELECT content_json FROM artifact_versions WHERE project_id=? AND id=? AND artifact_id='source' AND artifact_type='source'").get(projectId, versionId) as { content_json: string } | undefined;
      if (!row || !isUnavailableSource(readSourceMaterial(this.database, projectId, versionId))) throw new Error("source_reattachment_not_required");
      const expected = UnavailableSourceSchema.parse(JSON.parse(row.content_json)), source = AnalysisSourceSchema.parse(value);
      if (sourceDigest(source) !== expected.sourceFingerprint) throw new Error("source_reattachment_fingerprint_mismatch: this is not the exact archived source");
      // Attach material to the committed identity without updating the immutable source version.
      const material = SourceEvidenceMaterialSchema.parse({ schemaId: "cyoa.source-evidence-material", schemaVersion: 1, projectId, sourceVersionId: versionId, sourceFingerprint: expected.sourceFingerprint, source });
      this.database.prepare(`INSERT INTO artifact_versions (id,project_id,artifact_id,artifact_type,version,schema_version,content_json,stale,created_at)
        VALUES (?,?,?,'source-evidence-material',1,1,?,0,?)`).run(randomUUID(), projectId, `source-evidence-material-${versionId}`, JSON.stringify(material), new Date().toISOString());
      readSourceMaterial(this.database, projectId, versionId);
      validateSourceAnalysisDatabase(this.database, projectId);
      validateAdaptationDatabase(this.database, projectId);
      validateFoundationBootstrapDatabase(this.database, projectId);
      validateProject(this.database, projectId);
    });
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
    if (bundle.studio) this.importStudioRows(bundle);
    const violations = this.database.prepare("PRAGMA foreign_key_check").all() as unknown[];
    if (violations.length) throw new Error("portable_project_lineage_invalid: foreign-key validation failed");
    this.validateJsonFields(bundle);
    this.validateExactLineage(bundle.projectId);
    validateImageAssets(this.database, bundle.projectId);
    validateIllustratedScenes(this.database, bundle.projectId);
    validateSourceAnalysisDatabase(this.database, bundle.projectId);
    validateAdaptationDatabase(this.database, bundle.projectId);
    validateFoundationBootstrapDatabase(this.database, bundle.projectId);
    validateProject(this.database, bundle.projectId);
  }

  private importStudioRows(bundle: PortableProjectRows): void {
    const studio = bundle.studio!;
    for (const table of STUDIO_PORTABLE_TABLES) {
      if (table === "conversation_summary_heads" || table === "pinned_decision_heads") continue;
      const columns = this.columns(table);
      for (const row of studio[table]) {
        if (Object.keys(row).sort().join("\0") !== [...columns].sort().join("\0")) throw new Error(`portable_project_schema_invalid: ${table} columns differ`);
        if (table === "messages") {
          if (!this.database.prepare("SELECT 1 FROM conversations WHERE id = ? AND project_id = ?").get(row.conversation_id, bundle.projectId)) throw new Error("portable_project_conversation_lineage_invalid");
        } else if (row.project_id !== bundle.projectId) throw new Error("portable_project_conversation_lineage_invalid");
        const inserted = { ...row };
        if (table === "setup_proposals") { inserted.status = "proposed"; inserted.application_json = null; }
        this.database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .run(...columns.map((key) => inserted[key]));
        if (table === "conversation_summary_versions" || table === "pinned_decision_versions") {
          const headTable = table === "conversation_summary_versions" ? "conversation_summary_heads" : "pinned_decision_heads";
          const key = table === "conversation_summary_versions" ? "series_id" : "decision_id";
          const head = studio[headTable].find((item) => item[key] === row[key]);
          if (!head) throw new Error("portable_project_memory_head_missing");
          this.database.prepare(`INSERT INTO ${headTable} (${key},project_id,current_version_id,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(${key}) DO UPDATE SET current_version_id = excluded.current_version_id, updated_at = excluded.updated_at`)
            .run(row[key], bundle.projectId, row.id, head.current_version_id === row.id ? head.updated_at : row.created_at);
        }
        if (table === "setup_proposals" && row.status !== "proposed") this.database.prepare("UPDATE setup_proposals SET status = ?, application_json = ?, updated_at = ? WHERE id = ?")
          .run(row.status, row.application_json, row.updated_at, row.id);
      }
    }
    for (const table of ["conversation_summary_heads", "pinned_decision_heads"] as const) {
      const key = table === "conversation_summary_heads" ? "series_id" : "decision_id";
      for (const head of studio[table]) {
        if (!this.database.prepare(`SELECT 1 FROM ${table} WHERE ${key} = ? AND project_id = ? AND current_version_id = ?`).get(head[key], bundle.projectId, head.current_version_id)) throw new Error("portable_project_memory_head_invalid");
      }
    }
    for (const row of studio.setup_proposals) assertSetupProposalSource(this.database, bundle.projectId, String(row.conversation_id), JSON.parse(String(row.source_json)));
    for (const row of studio.change_sets) {
      if (!this.database.prepare("SELECT 1 FROM conversations WHERE id = ? AND project_id = ?").get(row.conversation_id, bundle.projectId)
        || !this.database.prepare("SELECT 1 FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = ?").get(row.base_version_id, bundle.projectId, row.artifact_id)
        || (row.status === "applied") !== Boolean(row.applied_version_id)
        || (row.applied_version_id && !this.database.prepare("SELECT 1 FROM artifact_versions WHERE id = ? AND project_id = ?").get(row.applied_version_id, bundle.projectId))) throw new Error("portable_project_proposal_lineage_invalid");
    }
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

  private columns(table: PortableProjectTable | StudioPortableTable): string[] {
    return (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name);
  }
}
