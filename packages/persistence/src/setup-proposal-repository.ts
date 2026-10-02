import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type StoryDatabase } from "./database.js";
import { AUTHOR_MEMORY_BUDGETS } from "./author-memory-repository.js";

export type SetupProposalStatus = "proposed" | "applied" | "rejected" | "superseded";

const SourceId = z.string().min(1).max(240);
const Usage = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative() }).strict();
const Cost = z.object({ currency: z.literal("USD"), input: z.number().nonnegative(), output: z.number().nonnegative(), total: z.number().nonnegative() }).strict().nullable();
export const SetupProposalSourceSchema = z.object({
  authority: z.literal("non-canonical-setup-proposal"),
  schemaVersion: z.literal(1),
  messageRange: z.object({
    firstMessageId: SourceId, lastMessageId: SourceId, messageCount: z.number().int().positive().max(200),
    authorMessageIds: z.array(SourceId).min(1).max(200),
    // Earlier v19 records have only the range. New records also identify bounded-context omissions exactly.
    messageIds: z.array(SourceId).min(1).max(200).optional(),
  }).strict(),
  summaryVersionId: SourceId.nullable(),
  decisionVersionIds: z.array(SourceId).max(24),
  promptVersion: z.string().min(1).max(120),
  provider: z.object({
    model: z.string().min(1).max(240), usage: Usage, cost: Cost, repaired: z.boolean(),
    attemptCount: z.number().int().min(1).max(2),
    attempts: z.array(z.object({ usage: Usage, cost: Cost, provider: z.string().nullable(), generationId: z.string().nullable(), diagnostic: z.unknown() }).strict()).max(2),
  }).strict(),
  omissions: z.array(z.string()).max(100),
  generatesProse: z.literal(false),
  revisedFromProposalId: SourceId.optional(),
  reviewedEditMessageId: SourceId.optional(),
}).strict();
export type SetupProposalSource = z.infer<typeof SetupProposalSourceSchema>;

/** Validate durable context evidence, not just the author citations displayed in candidate changes. */
export function assertSetupProposalSource(database: StoryDatabase, projectId: string, conversationId: string, value: unknown): SetupProposalSource {
  const source = SetupProposalSourceSchema.parse(value);
  const range = source.messageRange;
  const messages = database.prepare(`SELECT id, role, content FROM messages WHERE conversation_id = ?
    AND rowid BETWEEN (SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?)
      AND (SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?)
    ORDER BY created_at, rowid`).all(conversationId, range.firstMessageId, conversationId, range.lastMessageId, conversationId) as Array<{ id: string; role: string; content: string }>;
  // Reconstruct shipped v19 ranges with the same deterministic 8C byte limits, never guess missing evidence.
  let bytes = 0;
  const legacyIds = [...messages.slice(-AUTHOR_MEMORY_BUDGETS.recentMessageCount)].reverse().flatMap((message) => {
    const size = Buffer.byteLength(message.content, "utf8");
    if (size > AUTHOR_MEMORY_BUDGETS.recentMessageIndividualBytes || bytes + size > AUTHOR_MEMORY_BUDGETS.recentMessageBytes) return [];
    bytes += size; return [message.id];
  }).reverse();
  const ids = range.messageIds ?? legacyIds;
  const selected = messages.filter((message) => ids.includes(message.id));
  if (ids.length !== range.messageCount || new Set(ids).size !== ids.length
    || ids[0] !== range.firstMessageId || ids.at(-1) !== range.lastMessageId
    || JSON.stringify(selected.map((message) => message.id)) !== JSON.stringify(ids)
    || !selected.length) throw new Error("Invalid setup source message range");
  const authorIds = selected.filter((message) => message.role === "user").map((message) => message.id);
  if (JSON.stringify(authorIds) !== JSON.stringify(range.authorMessageIds)) throw new Error("Invalid setup author evidence ownership or source range");
  if (source.summaryVersionId && !database.prepare(`SELECT 1 FROM conversation_summary_versions
    WHERE id = ? AND project_id = ? AND conversation_id = ?`).get(source.summaryVersionId, projectId, conversationId)) {
    throw new Error("Invalid setup source summary lineage");
  }
  if (new Set(source.decisionVersionIds).size !== source.decisionVersionIds.length
    || source.decisionVersionIds.some((id) => !database.prepare("SELECT 1 FROM pinned_decision_versions WHERE id = ? AND project_id = ?").get(id, projectId))) {
    throw new Error("Invalid setup source decision lineage");
  }
  if (source.provider.attemptCount !== Math.max(1, source.provider.attempts.length)) throw new Error("Invalid setup provider attempt count");
  if (Boolean(source.revisedFromProposalId) !== Boolean(source.reviewedEditMessageId)) throw new Error("Invalid setup revision lineage");
  if (source.revisedFromProposalId && !database.prepare("SELECT 1 FROM setup_proposals WHERE id = ? AND project_id = ? AND conversation_id = ?")
    .get(source.revisedFromProposalId, projectId, conversationId)) throw new Error("Invalid setup revision proposal lineage");
  if (source.reviewedEditMessageId && !database.prepare("SELECT 1 FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user'")
    .get(source.reviewedEditMessageId, conversationId)) throw new Error("Invalid setup revision author lineage");
  return source;
}

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
  source: SetupProposalSource;
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
  source: SetupProposalSource; bases: SetupProposalBase[]; groups: Array<SetupProposalGroupRecord<T>>;
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
  source: SetupProposalSourceSchema.parse(JSON.parse(row.source_json)),
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
    const source = assertSetupProposalSource(this.database, input.projectId, input.conversationId, input.source);
    const messageIds = new Set([...source.messageRange.authorMessageIds, ...input.groups.flatMap((group) =>
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
        JSON.stringify(source), JSON.stringify(input.bases), JSON.stringify(input.groups),
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
