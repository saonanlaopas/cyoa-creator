import { randomUUID } from "node:crypto";
import { transaction, type StoryDatabase } from "./database.js";

export type SetupProposalStatus = "proposed" | "applied" | "rejected" | "superseded";

/** Exact artifact precondition captured when the proposal was generated. */
export interface SetupProposalBase {
  artifactId: string;
  precondition: "exact-base" | "must-not-exist";
  versionId: string | null;
}

export interface SetupProposalGroupRecord<T = unknown> {
  id: string;
  artifactId: string;
  label: string;
  summary: string;
  dependsOnGroupIds: string[];
  candidate: T;
  changes: unknown[];
}

export interface SetupProposalApplication {
  appliedGroupIds: string[];
  createdVersions: Array<{ groupId: string; artifactId: string; versionId: string }>;
  appliedAt: string;
}

export interface SetupProposalRecord<T = unknown> {
  id: string;
  projectId: string;
  conversationId: string;
  schemaVersion: 1;
  status: SetupProposalStatus;
  summary: string;
  source: Record<string, unknown>;
  bases: SetupProposalBase[];
  groups: Array<SetupProposalGroupRecord<T>>;
  validationFindings: unknown[];
  contextFingerprint: string;
  application: SetupProposalApplication | null;
  createdAt: string;
  updatedAt: string;
}

interface SetupProposalInput<T> {
  id?: string; projectId: string; conversationId: string; summary: string;
  source: Record<string, unknown>; bases: SetupProposalBase[]; groups: Array<SetupProposalGroupRecord<T>>;
  validationFindings?: unknown[]; contextFingerprint: string; beforeInsert?: () => void;
}

type SetupProposalRow = {
  id: string; project_id: string; conversation_id: string; schema_version: 1; status: SetupProposalStatus;
  summary: string; source_json: string; bases_json: string; groups_json: string; validation_json: string;
  context_fingerprint: string; application_json: string | null; created_at: string; updated_at: string;
};

const mapProposal = <T>(row: SetupProposalRow): SetupProposalRecord<T> => ({
  id: row.id,
  projectId: row.project_id,
  conversationId: row.conversation_id,
  schemaVersion: row.schema_version,
  status: row.status,
  summary: row.summary,
  source: JSON.parse(row.source_json) as Record<string, unknown>,
  bases: JSON.parse(row.bases_json) as SetupProposalBase[],
  groups: JSON.parse(row.groups_json) as Array<SetupProposalGroupRecord<T>>,
  validationFindings: JSON.parse(row.validation_json) as unknown[],
  contextFingerprint: row.context_fingerprint,
  application: row.application_json ? JSON.parse(row.application_json) as SetupProposalApplication : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const SETUP_PROPOSAL_LIST_LIMIT = 50;

/**
 * Non-canonical, reviewable setup proposals. Candidates never become artifact versions except through an
 * explicit application that the caller performs inside {@link SetupProposalRepository.markAppliedInTransaction}'s
 * surrounding transaction.
 */
export class SetupProposalRepository {
  public constructor(private readonly database: StoryDatabase) {}

  /** Stores a proposal and supersedes every earlier pending proposal in the same setup conversation. */
  create<T>(input: SetupProposalInput<T>): SetupProposalRecord<T> {
    return transaction(this.database, () => this.createInTransaction(input));
  }

  createInTransaction<T>(input: SetupProposalInput<T>): SetupProposalRecord<T> {
    if (!input.groups.length) throw new Error("A setup proposal needs at least one group");
    const conversation = this.database.prepare("SELECT project_id, purpose FROM conversations WHERE id = ?")
      .get(input.conversationId) as { project_id: string; purpose: string } | undefined;
    if (!conversation || conversation.project_id !== input.projectId || conversation.purpose !== "setup") throw new Error("Invalid setup proposal lineage");
    if (!/^[a-f0-9]{64}$/.test(input.contextFingerprint)) throw new Error("Invalid setup context fingerprint");
    if (input.groups.length > 3 || input.bases.length > 3 || Buffer.byteLength(JSON.stringify(input), "utf8") > 256_000) {
      throw new Error("Setup proposal exceeds storage limits");
    }
    const supported = new Set(["brief", "creative-direction", "bible"]);
    const groupIds = new Set(input.groups.map((group) => group.id));
    if (groupIds.size !== input.groups.length || new Set(input.groups.map((group) => group.artifactId)).size !== input.groups.length
      || new Set(input.bases.map((base) => base.artifactId)).size !== input.bases.length) throw new Error("Duplicate setup groups or bases");
    for (const base of input.bases) {
      if (!supported.has(base.artifactId)) throw new Error("Unsupported setup artifact base");
      if (base.precondition === "must-not-exist") {
        if (base.versionId !== null) throw new Error("Absent setup base cannot identify a version");
      } else {
        const version = this.database.prepare("SELECT project_id, artifact_id FROM artifact_versions WHERE id = ?")
          .get(base.versionId!) as { project_id: string; artifact_id: string } | undefined;
        if (base.precondition !== "exact-base" || !version || version.project_id !== input.projectId || version.artifact_id !== base.artifactId) {
          throw new Error("Invalid setup artifact base ownership");
        }
      }
    }
    for (const group of input.groups) {
      if (!supported.has(group.artifactId) || !input.bases.some((base) => base.artifactId === group.artifactId)
        || group.dependsOnGroupIds.some((dependency) => dependency === group.id || !groupIds.has(dependency))) throw new Error("Invalid setup group dependency or base");
    }
    const visit = (id: string, path = new Set<string>()): void => {
      if (path.has(id)) throw new Error("Cyclic setup group dependencies");
      const next = new Set([...path, id]);
      input.groups.find((group) => group.id === id)!.dependsOnGroupIds.forEach((dependency) => visit(dependency, next));
    };
    input.groups.forEach((group) => visit(group.id));
    const range = input.source.messageRange as { authorMessageIds?: string[] } | undefined;
    const messageIds = new Set([...(range?.authorMessageIds ?? []), ...input.groups.flatMap((group) =>
      group.changes.flatMap((change) => (change as { messageIds?: string[] }).messageIds ?? []))]);
    for (const messageId of messageIds) {
      const message = this.database.prepare("SELECT conversation_id, role FROM messages WHERE id = ?")
        .get(messageId) as { conversation_id: string; role: string } | undefined;
      if (!message || message.conversation_id !== input.conversationId || message.role !== "user") throw new Error("Invalid setup author evidence ownership");
    }
    const id = input.id ?? randomUUID();
    input.beforeInsert?.();
    const now = new Date().toISOString();
    this.database.prepare(`UPDATE setup_proposals SET status = 'superseded', updated_at = ?
      WHERE conversation_id = ? AND project_id = ? AND status = 'proposed'`)
      .run(now, input.conversationId, input.projectId);
    this.database.prepare(`INSERT INTO setup_proposals
      (id, project_id, conversation_id, schema_version, status, summary, source_json, bases_json, groups_json,
        validation_json, context_fingerprint, application_json, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'proposed', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(id, input.projectId, input.conversationId, input.summary.trim().slice(0, 1_000),
        JSON.stringify(input.source), JSON.stringify(input.bases), JSON.stringify(input.groups),
        JSON.stringify(input.validationFindings ?? []), input.contextFingerprint, now, now);
    return this.get<T>(id)!;
  }

  get<T = unknown>(id: string): SetupProposalRecord<T> | undefined {
    const row = this.database.prepare("SELECT * FROM setup_proposals WHERE id = ?").get(id) as SetupProposalRow | undefined;
    return row ? mapProposal<T>(row) : undefined;
  }

  listRecent<T = unknown>(conversationId: string, limit = SETUP_PROPOSAL_LIST_LIMIT): Array<SetupProposalRecord<T>> {
    const bounded = Math.max(1, Math.min(SETUP_PROPOSAL_LIST_LIMIT, Math.trunc(limit)));
    return (this.database.prepare(`SELECT * FROM (
      SELECT *, rowid AS proposal_order FROM setup_proposals WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    ) recent ORDER BY created_at, proposal_order`).all(conversationId, bounded) as SetupProposalRow[]).map(mapProposal<T>);
  }

  count(conversationId: string): number {
    return (this.database.prepare("SELECT COUNT(*) count FROM setup_proposals WHERE conversation_id = ?")
      .get(conversationId) as { count: number }).count;
  }

  reject(id: string): SetupProposalRecord {
    const current = this.get(id);
    if (!current) throw new Error("Setup proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending setup proposals can be rejected");
    this.database.prepare("UPDATE setup_proposals SET status = 'rejected', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.get(id)!;
  }

  markSuperseded(id: string): SetupProposalRecord {
    return transaction(this.database, () => this.markSupersededInTransaction(id));
  }

  markSupersededInTransaction(id: string): SetupProposalRecord {
    const current = this.get(id);
    if (!current) throw new Error("Setup proposal not found");
    if (current.status === "proposed") {
      this.database.prepare("UPDATE setup_proposals SET status = 'superseded', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
    }
    return this.get(id)!;
  }

  markAppliedInTransaction(id: string, application: SetupProposalApplication): SetupProposalRecord {
    const current = this.get(id);
    if (!current) throw new Error("Setup proposal not found");
    if (current.status !== "proposed") throw new Error("Only pending setup proposals can be applied");
    const selected = new Set(application.appliedGroupIds);
    if (!selected.size || selected.size !== application.appliedGroupIds.length || application.createdVersions.length !== selected.size
      || new Set(application.createdVersions.map((version) => version.groupId)).size !== selected.size
      || !Number.isFinite(Date.parse(application.appliedAt))) throw new Error("Invalid setup application audit");
    for (const version of application.createdVersions) {
      const group = current.groups.find((item) => item.id === version.groupId);
      const saved = this.database.prepare("SELECT project_id, artifact_id FROM artifact_versions WHERE id = ?")
        .get(version.versionId) as { project_id: string; artifact_id: string } | undefined;
      if (!selected.has(version.groupId) || !group || group.artifactId !== version.artifactId || !saved
        || saved.project_id !== current.projectId || saved.artifact_id !== version.artifactId
        || current.bases.some((base) => base.versionId === version.versionId)
        || group.dependsOnGroupIds.some((dependency) => !selected.has(dependency))) throw new Error("Invalid setup applied version ownership or dependency");
    }
    this.database.prepare(`UPDATE setup_proposals SET status = 'applied', application_json = ?, updated_at = ?
      WHERE id = ?`).run(JSON.stringify(application), application.appliedAt, id);
    return this.get(id)!;
  }

  /** Current head version ID for exact-base / must-not-exist precondition checks. */
  currentArtifactVersionId(projectId: string, artifactId: string): string | null {
    const row = this.database.prepare(`SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
      ORDER BY version DESC LIMIT 1`).get(projectId, artifactId) as { id: string } | undefined;
    return row?.id ?? null;
  }
}
