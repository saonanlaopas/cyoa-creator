import { randomUUID } from "node:crypto";
import { CreativeDirectionInputSchema, creativeDirectionFingerprints, sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { PORTABLE_PROJECT_TABLES, type PortableRow } from "./portable-project-repository.js";
import { SOURCE_ANALYSIS_TABLES } from "./source-analysis-duplication.js";
import { FOUNDATION_BOOTSTRAP_TABLES } from "./foundation-bootstrap-schema.js";
import type { StoryDatabase } from "./database.js";

const tables = PORTABLE_PROJECT_TABLES.filter((table) => !["projects", "artifact_versions", "artifact_workflow_state", "artifact_version_approvals", "artifact_dependencies",
  ...SOURCE_ANALYSIS_TABLES, ...FOUNDATION_BOOTSTRAP_TABLES].includes(table));

export function remapStudioValue(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapStudioValue(item, ids));
  if (!value || typeof value !== "object") return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapStudioValue(child, ids)]));
  if (mapped.schemaId === "cyoa.creative-direction") {
    const { materialFingerprint: _, provenanceFingerprint: _p, ...input } = mapped;
    const direction = CreativeDirectionInputSchema.parse(input); Object.assign(mapped, creativeDirectionFingerprints(direction));
  }
  return mapped;
}

export function prepareAuthoringDuplicate(database: StoryDatabase, projectId: string, ids: Map<string, string>): Map<string, PortableRow[]> {
  const result = new Map<string, PortableRow[]>();
  for (const table of tables) {
    const rows = (table === "passage_plan_snapshot_items" ? database.prepare(`SELECT i.* FROM passage_plan_snapshot_items i
      JOIN passage_plan_snapshots s ON s.id=i.snapshot_id WHERE s.project_id=? ORDER BY i.rowid`)
      : database.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`)).all(projectId) as PortableRow[];
    result.set(table, rows);
    for (const row of rows) if (typeof row.id === "string") ids.set(row.id, randomUUID());
  }
  return result;
}

export function copyAuthoringRows(database: StoryDatabase, rows: Map<string, PortableRow[]>, ids: Map<string, string>): void {
  const pending: Array<{ table: string; row: PortableRow; status: unknown }> = [];
  for (const [table, records] of rows) for (const original of records) {
    const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, key.endsWith("_json") && typeof value === "string"
      ? JSON.stringify(remapStudioValue(JSON.parse(value), ids)) : typeof value === "string" && (key === "id" || key.endsWith("_id") || key.endsWith("_fingerprint")) ? ids.get(value) ?? value : value]));
    if (table === "repair_applications") {
      const application = JSON.parse(String(row.content_json));
      application.explicitlySelectedGroupIds.sort();
      row.content_json = JSON.stringify(application);
    }
    if (["drafting_jobs", "drafting_job_units", "drafting_unit_attempts"].includes(table) && row.status !== "running") {
      pending.push({ table, row: { ...row }, status: row.status }); row.status = "running";
    }
    const columns = Object.keys(row);
    database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
  }
  for (const { table, row, status } of pending) {
    const keys = table === "drafting_job_units" ? ["job_id", "unit_id"] : ["id"];
    database.prepare(`UPDATE ${table} SET status=? WHERE ${keys.map((key) => `${key}=?`).join(" AND ")}`).run(status as string, ...keys.map((key) => row[key]));
  }
}

/** Re-seal copied discussion/proposal caches; captured head commitments stay historical, so Apply requires re-preview. */
export function prepareEditDuplicate(messages: PortableRow[], changes: PortableRow[], ids: Map<string, string>): { messages: Map<string, string>; proposals: Map<string, string> } {
  const mappedMessages = new Map<string, string>(), mappedProposals = new Map<string, string>();
  for (const message of messages) {
    const original = JSON.parse(String(message.metadata_json));
    if (!original.editPlan) continue;
    if (sourceDigest(original.editPlan) !== original.editFingerprint) throw new Error("edit_duplicate_plan_invalid");
    const metadata = remapStudioValue(original, ids) as typeof original;
    metadata.editPlan.contextBytes = Buffer.byteLength(sourceCanonicalJson(metadata.editPlan.context));
    metadata.editFingerprint = sourceDigest(metadata.editPlan);
    metadata.copiedFrom = { projectId: original.editPlan.projectId, planId: message.id, headFingerprint: original.editPlan.headFingerprint };
    ids.set(original.editFingerprint, metadata.editFingerprint); mappedMessages.set(String(message.id), JSON.stringify(metadata));
  }
  for (const change of changes) {
    const original = change.proposal_json ? JSON.parse(String(change.proposal_json)) : null;
    if (original?.kind !== "conversational-edit-v1") continue;
    const definition = ({ plan, response, generatedIds, expectedStaleness, expectedDraftImpacts }: typeof original) => ({ plan, response, generatedIds, expectedStaleness, ...(expectedDraftImpacts === undefined ? {} : { expectedDraftImpacts }) });
    if (original.fingerprint !== sourceDigest(definition(original))) throw new Error("edit_duplicate_proposal_invalid");
    const mapped = remapStudioValue(original, ids) as typeof original;
    const message = mappedMessages.get(String(original.plan.id));
    if (!message) throw new Error("edit_duplicate_plan_missing");
    const metadata = JSON.parse(message);
    mapped.plan = { ...metadata.editPlan, id: ids.get(original.plan.id)!, fingerprint: metadata.editFingerprint };
    mapped.fingerprint = sourceDigest(definition(mapped)); ids.set(original.fingerprint, mapped.fingerprint);
    mappedProposals.set(String(change.id), JSON.stringify(mapped));
  }
  return { messages: mappedMessages, proposals: mappedProposals };
}
