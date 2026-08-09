import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import type { PassagePlanEntityMutation } from "./draft-staleness.js";

export type PassageEntityKind = "passage" | "choice" | "thread";
export interface PassageVersion<T = unknown> {
  id: string;
  projectId: string;
  entityKind: PassageEntityKind;
  entityId: string;
  version: number;
  content: T;
  restoredFromVersionId?: string;
  createdAt: string;
}
export interface StructureVersion<T = unknown> {
  id: string;
  projectId: string;
  version: number;
  content: T;
  restoredFromVersionId?: string;
  createdAt: string;
}
export interface PassageSnapshot {
  id: string;
  projectId: string;
  version: number;
  structureVersionId: string;
  upstreamVersions: Record<string, string>;
  validation: unknown;
  status: "draft" | "approved";
  createdAt: string;
}
export interface PassagePlanState {
  projectId: string;
  status: "empty" | "draft" | "approved" | "stale";
  approvedSnapshotId: string | null;
  updatedAt: string;
}
export interface FindingOverrideRecord {
  projectId: string;
  code: string;
  entityId: string;
  rationale: string;
  createdAt: string;
  updatedAt: string;
}

type EntityRow = {
  id: string; project_id: string; entity_kind: PassageEntityKind; entity_id: string;
  version: number; content_json: string; restored_from_version_id: string | null; created_at: string;
};
type StructureRow = {
  id: string; project_id: string; version: number; content_json: string;
  restored_from_version_id: string | null; created_at: string;
};
type SnapshotRow = {
  id: string; project_id: string; version: number; structure_version_id: string;
  upstream_versions_json: string; validation_json: string; status: "draft" | "approved"; created_at: string;
};

const mapEntity = <T>(row: EntityRow): PassageVersion<T> => ({
  id: row.id, projectId: row.project_id, entityKind: row.entity_kind, entityId: row.entity_id,
  version: row.version, content: JSON.parse(row.content_json) as T,
  restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
});
const mapStructure = <T>(row: StructureRow): StructureVersion<T> => ({
  id: row.id, projectId: row.project_id, version: row.version,
  content: JSON.parse(row.content_json) as T,
  restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
});
const mapSnapshot = (row: SnapshotRow): PassageSnapshot => ({
  id: row.id, projectId: row.project_id, version: row.version, structureVersionId: row.structure_version_id,
  upstreamVersions: JSON.parse(row.upstream_versions_json) as Record<string, string>,
  validation: JSON.parse(row.validation_json), status: row.status, createdAt: row.created_at,
});

export class PassagePlanRepository {
  public constructor(
    private readonly database: StoryDatabase,
    private readonly mutationObserver?: (mutation: PassagePlanEntityMutation) => void,
  ) {}

  initialize(projectId: string, structure: unknown, entities: Array<{
    kind: PassageEntityKind; id: string; content: unknown;
  }>): void {
    transaction(this.database, () => {
      if (this.currentStructure(projectId)) throw new Error("Passage plan already exists");
      this.insertStructure(projectId, structure);
      entities.forEach((entity) => this.insertEntity(projectId, entity.kind, entity.id, entity.content));
      this.setState(projectId, "draft");
    });
  }

  currentStructure<T = unknown>(projectId: string): StructureVersion<T> | undefined {
    const row = this.database.prepare(`
      SELECT versions.* FROM passage_structure_heads heads
      JOIN passage_structure_versions versions ON versions.id = heads.version_id
      WHERE heads.project_id = ?
    `).get(projectId) as StructureRow | undefined;
    return row ? mapStructure<T>(row) : undefined;
  }

  saveStructure<T>(projectId: string, content: T): StructureVersion<T> {
    return transaction(this.database, () => {
      const result = this.insertStructure<T>(projectId, content);
      this.setState(projectId, "draft");
      return result;
    });
  }

  listStructureVersions<T = unknown>(projectId: string): StructureVersion<T>[] {
    return (this.database.prepare(`
      SELECT * FROM passage_structure_versions WHERE project_id = ? ORDER BY version DESC
    `).all(projectId) as StructureRow[]).map(mapStructure<T>);
  }

  getStructureVersion<T = unknown>(versionId: string): StructureVersion<T> | undefined {
    const row = this.database.prepare("SELECT * FROM passage_structure_versions WHERE id = ?")
      .get(versionId) as StructureRow | undefined;
    return row ? mapStructure<T>(row) : undefined;
  }

  currentEntities<T = unknown>(projectId: string, kind: PassageEntityKind): PassageVersion<T>[] {
    return (this.database.prepare(`
      SELECT versions.* FROM passage_entity_heads heads
      JOIN passage_entity_versions versions ON versions.id = heads.version_id
      WHERE heads.project_id = ? AND heads.entity_kind = ? AND heads.tombstoned = 0
      ORDER BY heads.entity_id
    `).all(projectId, kind) as EntityRow[]).map(mapEntity<T>);
  }

  currentEntity<T = unknown>(projectId: string, kind: PassageEntityKind, entityId: string): PassageVersion<T> | undefined {
    const row = this.database.prepare(`
      SELECT versions.* FROM passage_entity_heads heads
      JOIN passage_entity_versions versions ON versions.id = heads.version_id
      WHERE heads.project_id = ? AND heads.entity_kind = ? AND heads.entity_id = ? AND heads.tombstoned = 0
    `).get(projectId, kind, entityId) as EntityRow | undefined;
    return row ? mapEntity<T>(row) : undefined;
  }

  getEntityVersion<T = unknown>(versionId: string): PassageVersion<T> | undefined {
    const row = this.database.prepare("SELECT * FROM passage_entity_versions WHERE id = ?")
      .get(versionId) as EntityRow | undefined;
    return row ? mapEntity<T>(row) : undefined;
  }

  listEntityVersions<T = unknown>(
    projectId: string, kind: PassageEntityKind, entityId: string,
  ): PassageVersion<T>[] {
    return (this.database.prepare(`
      SELECT * FROM passage_entity_versions
      WHERE project_id = ? AND entity_kind = ? AND entity_id = ? ORDER BY version DESC
    `).all(projectId, kind, entityId) as EntityRow[]).map(mapEntity<T>);
  }

  listAllEntityVersions<T = unknown>(projectId: string): PassageVersion<T>[] {
    return (this.database.prepare(`
      SELECT * FROM passage_entity_versions
      WHERE project_id = ? ORDER BY entity_kind, entity_id, version DESC
    `).all(projectId) as EntityRow[]).map(mapEntity<T>);
  }

  saveEntity<T>(projectId: string, kind: PassageEntityKind, entityId: string, content: T): PassageVersion<T> {
    return transaction(this.database, () => {
      const result = this.insertEntity(projectId, kind, entityId, content);
      this.setState(projectId, "draft");
      return result;
    });
  }

  saveEntities(projectId: string, entities: Array<{
    kind: PassageEntityKind; id: string; content: unknown;
  }>): PassageVersion[] {
    return transaction(this.database, () => {
      const result = entities.map((entity) => this.insertEntity(projectId, entity.kind, entity.id, entity.content));
      this.setState(projectId, "draft");
      return result;
    });
  }

  saveBundle(projectId: string, structure: unknown, entities: Array<{
    kind: PassageEntityKind; id: string; content: unknown;
  }>, retained: Record<PassageEntityKind, Set<string>>): void {
    transaction(this.database, () => {
      let changed = false;
      const currentStructure = this.currentStructure(projectId);
      if (!currentStructure || JSON.stringify(currentStructure.content) !== JSON.stringify(structure)) {
        this.insertStructure(projectId, structure);
        changed = true;
      }
      for (const entity of entities) {
        const current = this.database.prepare(`
          SELECT versions.content_json, heads.tombstoned FROM passage_entity_heads heads
          JOIN passage_entity_versions versions ON versions.id = heads.version_id
          WHERE heads.project_id = ? AND heads.entity_kind = ? AND heads.entity_id = ?
        `).get(projectId, entity.kind, entity.id) as { content_json: string; tombstoned: number } | undefined;
        if (!current || current.tombstoned || current.content_json !== JSON.stringify(entity.content)) {
          this.insertEntity(projectId, entity.kind, entity.id, entity.content);
          changed = true;
        }
      }
      for (const kind of ["passage", "choice", "thread"] as PassageEntityKind[]) {
        const keep = retained[kind];
        const heads = this.database.prepare(`
          SELECT entity_id FROM passage_entity_heads WHERE project_id = ? AND entity_kind = ? AND tombstoned = 0
        `).all(projectId, kind) as Array<{ entity_id: string }>;
        heads.filter((head) => !keep.has(head.entity_id)).forEach((head) => {
          const before = this.currentEntity(projectId, kind, head.entity_id);
          const result = this.database.prepare(`
            UPDATE passage_entity_heads SET tombstoned = 1
            WHERE project_id = ? AND entity_kind = ? AND entity_id = ?
          `).run(projectId, kind, head.entity_id);
          if (result.changes) {
            changed = true;
            this.mutationObserver?.({
              projectId, kind, entityId: head.entity_id,
              beforeVersionId: before?.id ?? null, afterVersionId: null,
              before: before?.content ?? null, after: null,
            });
          }
        });
      }
      if (changed) this.setState(projectId, "draft");
    });
  }

  tombstone(projectId: string, kind: PassageEntityKind, entityId: string): void {
    transaction(this.database, () => {
      const before = this.currentEntity(projectId, kind, entityId);
      const result = this.database.prepare(`
        UPDATE passage_entity_heads SET tombstoned = 1
        WHERE project_id = ? AND entity_kind = ? AND entity_id = ?
      `).run(projectId, kind, entityId);
      if (!result.changes) throw new Error("Passage-plan entity not found");
      this.mutationObserver?.({
        projectId, kind, entityId, beforeVersionId: before?.id ?? null, afterVersionId: null,
        before: before?.content ?? null, after: null,
      });
      this.setState(projectId, "draft");
    });
  }

  restoreEntity<T>(projectId: string, kind: PassageEntityKind, entityId: string, versionId: string): PassageVersion<T> {
    const source = this.getEntityVersion<T>(versionId);
    if (!source || source.projectId !== projectId || source.entityKind !== kind || source.entityId !== entityId) {
      throw new Error("Passage-plan entity version not found");
    }
    return transaction(this.database, () => {
      const result = this.insertEntity(projectId, kind, entityId, source.content, source.id);
      this.setState(projectId, "draft");
      return result;
    });
  }

  createSnapshot(
    projectId: string,
    upstreamVersions: Record<string, string>,
    validation: unknown,
  ): PassageSnapshot {
    return transaction(this.database, () => {
      const structure = this.currentStructure(projectId);
      if (!structure) throw new Error("Passage plan not found");
      const latest = this.database.prepare(`
        SELECT COALESCE(MAX(version), 0) version FROM passage_plan_snapshots WHERE project_id = ?
      `).get(projectId) as { version: number };
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO passage_plan_snapshots
          (id, project_id, version, structure_version_id, upstream_versions_json, validation_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
      `).run(id, projectId, latest.version + 1, structure.id, JSON.stringify(upstreamVersions), JSON.stringify(validation), now);
      this.database.prepare(`
        INSERT INTO passage_plan_snapshot_items (snapshot_id, entity_kind, entity_id, version_id)
        SELECT ?, entity_kind, entity_id, version_id FROM passage_entity_heads
        WHERE project_id = ? AND tombstoned = 0
      `).run(id, projectId);
      return this.getSnapshot(id)!;
    });
  }

  getSnapshot(id: string): PassageSnapshot | undefined {
    const row = this.database.prepare("SELECT * FROM passage_plan_snapshots WHERE id = ?")
      .get(id) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : undefined;
  }

  listSnapshots(projectId: string): PassageSnapshot[] {
    return (this.database.prepare(`
      SELECT * FROM passage_plan_snapshots WHERE project_id = ? ORDER BY version DESC
    `).all(projectId) as SnapshotRow[]).map(mapSnapshot);
  }

  snapshotEntities<T = unknown>(snapshotId: string, kind: PassageEntityKind): PassageVersion<T>[] {
    return (this.database.prepare(`
      SELECT versions.* FROM passage_plan_snapshot_items items
      JOIN passage_entity_versions versions ON versions.id = items.version_id
      WHERE items.snapshot_id = ? AND items.entity_kind = ? ORDER BY items.entity_id
    `).all(snapshotId, kind) as EntityRow[]).map(mapEntity<T>);
  }

  approveSnapshot(projectId: string, snapshotId: string): PassagePlanState {
    return transaction(this.database, () => {
      const snapshot = this.getSnapshot(snapshotId);
      if (!snapshot || snapshot.projectId !== projectId) throw new Error("Passage-plan snapshot not found");
      this.database.prepare("UPDATE passage_plan_snapshots SET status = 'approved' WHERE id = ?").run(snapshotId);
      return this.setState(projectId, "approved", snapshotId);
    });
  }

  restoreSnapshot(projectId: string, snapshotId: string): PassagePlanState {
    return transaction(this.database, () => {
      const snapshot = this.getSnapshot(snapshotId);
      if (!snapshot || snapshot.projectId !== projectId) throw new Error("Passage-plan snapshot not found");
      const structureRow = this.database.prepare("SELECT * FROM passage_structure_versions WHERE id = ?")
        .get(snapshot.structureVersionId) as StructureRow | undefined;
      if (!structureRow) throw new Error("Passage-plan snapshot structure is missing");
      this.insertStructure(projectId, JSON.parse(structureRow.content_json), snapshot.structureVersionId);
      this.database.prepare(`
        UPDATE passage_entity_heads SET tombstoned = 1 WHERE project_id = ?
      `).run(projectId);
      for (const source of this.snapshotEntities(snapshotId, "passage")) {
        this.insertEntity(projectId, "passage", source.entityId, source.content, source.id);
      }
      for (const source of this.snapshotEntities(snapshotId, "choice")) {
        this.insertEntity(projectId, "choice", source.entityId, source.content, source.id);
      }
      for (const source of this.snapshotEntities(snapshotId, "thread")) {
        this.insertEntity(projectId, "thread", source.entityId, source.content, source.id);
      }
      return this.setState(projectId, "draft");
    });
  }

  state(projectId: string): PassagePlanState {
    const row = this.database.prepare("SELECT * FROM passage_plan_state WHERE project_id = ?").get(projectId) as {
      project_id: string; status: PassagePlanState["status"]; approved_snapshot_id: string | null; updated_at: string;
    } | undefined;
    return row ? {
      projectId: row.project_id, status: row.status,
      approvedSnapshotId: row.approved_snapshot_id, updatedAt: row.updated_at,
    } : { projectId, status: "empty", approvedSnapshotId: null, updatedAt: "" };
  }

  markStale(projectId: string): PassagePlanState {
    return this.setState(projectId, "stale");
  }

  insertEntityVersionInTransaction<T>(
    projectId: string,
    kind: PassageEntityKind,
    entityId: string,
    content: T,
  ): PassageVersion<T> {
    return this.insertEntity(projectId, kind, entityId, content);
  }

  markDraftInTransaction(projectId: string): PassagePlanState {
    return this.setState(projectId, "draft");
  }

  listOverrides(projectId: string): FindingOverrideRecord[] {
    return this.database.prepare(`
      SELECT project_id projectId, code, entity_id entityId, rationale, created_at createdAt, updated_at updatedAt
      FROM passage_finding_overrides WHERE project_id = ? ORDER BY code, entity_id
    `).all(projectId) as unknown as FindingOverrideRecord[];
  }

  setOverride(projectId: string, code: string, entityId: string, rationale: string): FindingOverrideRecord {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO passage_finding_overrides (project_id, code, entity_id, rationale, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, code, entity_id) DO UPDATE SET rationale = excluded.rationale, updated_at = excluded.updated_at
    `).run(projectId, code, entityId, rationale.trim(), now, now);
    return this.listOverrides(projectId).find((item) => item.code === code && item.entityId === entityId)!;
  }

  deleteOverride(projectId: string, code: string, entityId: string): void {
    this.database.prepare(`
      DELETE FROM passage_finding_overrides WHERE project_id = ? AND code = ? AND entity_id = ?
    `).run(projectId, code, entityId);
  }

  private insertStructure<T>(
    projectId: string, content: T, restoredFromVersionId?: string,
  ): StructureVersion<T> {
    const latest = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) version FROM passage_structure_versions WHERE project_id = ?
    `).get(projectId) as { version: number };
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO passage_structure_versions
        (id, project_id, version, content_json, restored_from_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, latest.version + 1, JSON.stringify(content), restoredFromVersionId ?? null, new Date().toISOString());
    this.database.prepare(`
      INSERT INTO passage_structure_heads (project_id, version_id) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET version_id = excluded.version_id
    `).run(projectId, id);
    return this.currentStructure<T>(projectId)!;
  }

  private insertEntity<T>(
    projectId: string, kind: PassageEntityKind, entityId: string, content: T, restoredFromVersionId?: string,
  ): PassageVersion<T> {
    const before = this.currentEntity<T>(projectId, kind, entityId);
    const latest = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) version FROM passage_entity_versions
      WHERE project_id = ? AND entity_kind = ? AND entity_id = ?
    `).get(projectId, kind, entityId) as { version: number };
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO passage_entity_versions
        (id, project_id, entity_kind, entity_id, version, content_json, restored_from_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, kind, entityId, latest.version + 1, JSON.stringify(content), restoredFromVersionId ?? null, new Date().toISOString());
    this.database.prepare(`
      INSERT INTO passage_entity_heads (project_id, entity_kind, entity_id, version_id, tombstoned)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(project_id, entity_kind, entity_id) DO UPDATE SET version_id = excluded.version_id, tombstoned = 0
    `).run(projectId, kind, entityId, id);
    const result = this.getEntityVersion<T>(id)!;
    this.mutationObserver?.({
      projectId, kind, entityId,
      beforeVersionId: before?.id ?? null, afterVersionId: result.id,
      before: before?.content ?? null, after: result.content,
    });
    return result;
  }

  private setState(
    projectId: string, status: PassagePlanState["status"], approvedSnapshotId?: string,
  ): PassagePlanState {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO passage_plan_state (project_id, status, approved_snapshot_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        status = excluded.status,
        approved_snapshot_id = COALESCE(excluded.approved_snapshot_id, passage_plan_state.approved_snapshot_id),
        updated_at = excluded.updated_at
    `).run(projectId, status, approvedSnapshotId ?? null, now);
    return this.state(projectId);
  }
}
