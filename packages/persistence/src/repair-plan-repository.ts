import { createHash, randomUUID } from "node:crypto";
import {
  REPAIR_PLANNING_POLICY_V1,
  RepairPlanRecordSchema,
  validateRepairPlanDefinition,
  type RepairPlanRecord,
} from "@story-to-cyoa/domain";
import type { ArtifactVersion } from "./artifact-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const REPAIR_PLAN_ARTIFACT_TYPE = "repair-plan";
const prefix = "repair-plan:";
const maximumPlanBytes = REPAIR_PLANNING_POLICY_V1.maxSavedPlanBytes;

export type RepairPlanAggregateShape = RepairPlanRecord;

type Row = {
  id: string; project_id: string; artifact_id: string; artifact_type: string;
  version: number; schema_version: number; content_json: string; stale: number;
  restored_from_version_id: string | null; created_at: string;
};

export class RepairPlanRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create<T extends RepairPlanAggregateShape>(projectId: string, content: T): ArtifactVersion<T> {
    assertDefinition(projectId, content);
    const serialized = JSON.stringify(content);
    return transaction(this.database, () => {
      if (!this.database.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) throw new Error("Repair-plan project not found");
      if (this.database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?").get(projectId, `${prefix}${content.id}`)) {
        throw new Error("Repair plan already exists");
      }
      const id = randomUUID();
      this.database.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, 0, ?)`)
        .run(id, projectId, `${prefix}${content.id}`, REPAIR_PLAN_ARTIFACT_TYPE, serialized, content.createdAt);
      return this.getVersion<T>(projectId, id)!;
    });
  }

  get<T extends RepairPlanAggregateShape>(projectId: string, planId: string): ArtifactVersion<T> | undefined {
    const rows = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND artifact_id = ? AND artifact_type = ? ORDER BY version DESC`)
      .all(projectId, `${prefix}${planId}`, REPAIR_PLAN_ARTIFACT_TYPE) as Row[];
    if (rows.length > 1 || rows[0]?.version !== 1) throw new Error("Repair-plan definitions are immutable");
    if (!rows[0]) return undefined;
    const version = map<T>(rows[0]);
    assertArtifactIdentity(version.artifactId, version.content);
    assertDefinition(projectId, version.content);
    return version;
  }

  getVersion<T extends RepairPlanAggregateShape>(projectId: string, versionId: string): ArtifactVersion<T> | undefined {
    const row = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND id = ? AND artifact_type = ?`)
      .get(projectId, versionId, REPAIR_PLAN_ARTIFACT_TYPE) as Row | undefined;
    if (!row) return undefined;
    if (row.version !== 1) throw new Error("Repair-plan definitions are immutable");
    const version = map<T>(row);
    assertArtifactIdentity(version.artifactId, version.content);
    assertDefinition(projectId, version.content);
    return version;
  }

  list<T extends RepairPlanAggregateShape>(projectId: string): ArtifactVersion<T>[] {
    const rows = this.database.prepare(`SELECT * FROM artifact_versions
      WHERE project_id = ? AND artifact_type = ? ORDER BY created_at DESC, artifact_id`)
      .all(projectId, REPAIR_PLAN_ARTIFACT_TYPE) as Row[];
    const seen = new Set<string>();
    return rows.map((row) => {
      if (row.version !== 1 || seen.has(row.artifact_id)) throw new Error("Repair-plan definitions are immutable");
      seen.add(row.artifact_id);
      const version = map<T>(row);
      assertArtifactIdentity(version.artifactId, version.content);
      assertDefinition(projectId, version.content);
      return version;
    });
  }
}

function assertDefinition(projectId: string, content: RepairPlanAggregateShape): void {
  const record = RepairPlanRecordSchema.parse(content);
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > maximumPlanBytes) throw new Error("Repair plan exceeds its saved byte limit");
  if (record.definition.projectId !== projectId) throw new Error("Repair-plan identity mismatch");
  validateRepairPlanDefinition(record.definition, fingerprint);
  const definitionFingerprint = fingerprint(content.definition);
  if (content.definitionFingerprint !== definitionFingerprint) throw new Error("Repair-plan definition fingerprint mismatch");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertArtifactIdentity(artifactId: string, content: RepairPlanAggregateShape): void {
  if (artifactId !== `${prefix}${content.id}`) throw new Error("Repair-plan artifact identity mismatch");
}

function map<T>(row: Row): ArtifactVersion<T> {
  return {
    id: row.id, projectId: row.project_id, artifactId: row.artifact_id,
    artifactType: row.artifact_type, version: row.version, schemaVersion: row.schema_version,
    content: JSON.parse(row.content_json) as T, stale: Boolean(row.stale),
    restoredFromVersionId: row.restored_from_version_id ?? undefined, createdAt: row.created_at,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
