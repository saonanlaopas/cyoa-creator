import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";
import { classifyPassageDraftStaleness, type PassagePlanEntityMutation } from "./draft-staleness.js";

export type PassageDraftLifecycle = "candidate" | "accepted" | "reviewed" | "locked";
export type PassageDraftStatus = PassageDraftLifecycle | "stale";
export type PassageDraftSource = "manual" | "generated" | "restore" | "lifecycle";

export interface PassageDraftStalenessEvent {
  id: string;
  reasonCode: string;
  sourceEntityKind: string;
  sourceEntityId: string;
  fromVersionId: string | null;
  toVersionId: string | null;
  changedFields: string[];
  createdAt: string;
}

export interface PassageDraftVersionRecord {
  id: string;
  projectId: string;
  passageId: string;
  version: number;
  basedOnPassagePlanVersionId: string;
  proseMarkdown: string;
  wordCount: number;
  lifecycleStatus: PassageDraftLifecycle;
  status: PassageDraftStatus;
  sourceKind: PassageDraftSource;
  generationPlanId: string | null;
  generationJobId: string | null;
  generationUnitId: string | null;
  authorNote: string;
  upstreamVersions: Record<string, string>;
  neighboringDraftVersions: Record<string, string>;
  restoredFromVersionId: string | null;
  stale: boolean;
  staleReasons: PassageDraftStalenessEvent[];
  createdAt: string;
}

export interface PassageDraftHeadRecord {
  projectId: string;
  passageId: string;
  current: PassageDraftVersionRecord;
  accepted: PassageDraftVersionRecord | null;
  acceptedLocked: boolean;
  updatedAt: string;
}

export interface CreatePassageDraftInput {
  projectId: string;
  passageId: string;
  basedOnPassagePlanVersionId: string;
  proseMarkdown: string;
  lifecycleStatus?: PassageDraftLifecycle;
  sourceKind: PassageDraftSource;
  generationPlanId?: string | null;
  generationJobId?: string | null;
  generationUnitId?: string | null;
  authorNote?: string;
  upstreamVersions: Record<string, string>;
  neighboringDraftVersions?: Record<string, string>;
  restoredFromVersionId?: string | null;
}

type DraftRow = {
  id: string; project_id: string; passage_id: string; version: number;
  based_on_passage_plan_version_id: string; prose_markdown: string; word_count: number;
  lifecycle_status: PassageDraftLifecycle; source_kind: PassageDraftSource;
  generation_plan_id: string | null; generation_job_id: string | null; generation_unit_id: string | null;
  author_note: string; restored_from_version_id: string | null; created_at: string;
};
type HeadRow = {
  project_id: string; passage_id: string; current_version_id: string;
  accepted_version_id: string | null; accepted_locked: number; updated_at: string;
};
type StaleRow = {
  id: string; reason_code: string; source_entity_kind: string; source_entity_id: string;
  from_version_id: string | null; to_version_id: string | null; changed_fields_json: string; created_at: string;
};

const lifecycleTransitions: Record<PassageDraftLifecycle, PassageDraftLifecycle[]> = {
  candidate: ["accepted"],
  accepted: ["reviewed"],
  reviewed: ["locked"],
  locked: [],
};

export function countDraftWords(markdown: string): number {
  return markdown.match(/[\p{L}\p{N}]+(?:[\u2019'\u2010-\u2015-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function assertPassageDraftTransition(from: PassageDraftLifecycle, to: PassageDraftLifecycle): void {
  if (!lifecycleTransitions[from].includes(to)) {
    throw new Error(`Invalid passage draft transition: ${from} -> ${to}`);
  }
}

export class PassageDraftRepository {
  public constructor(private readonly database: StoryDatabase) {}

  createVersion(input: CreatePassageDraftInput): PassageDraftVersionRecord {
    return transaction(this.database, () => this.createVersionInTransaction(input));
  }

  createVersionInTransaction(input: CreatePassageDraftInput): PassageDraftVersionRecord {
    const lifecycleStatus = input.lifecycleStatus ?? "candidate";
    if (input.sourceKind === "generated") {
      if (!input.generationPlanId || !input.generationJobId || !input.generationUnitId) {
        throw new Error("Generated draft provenance requires plan, job, and unit IDs");
      }
    } else if (input.sourceKind !== "lifecycle"
      && (input.generationPlanId || input.generationJobId || input.generationUnitId)) {
      throw new Error("Non-generated drafts cannot claim generation provenance");
    } else if (input.sourceKind === "lifecycle") {
      const supplied = [input.generationPlanId, input.generationJobId, input.generationUnitId]
        .filter((value) => Boolean(value)).length;
      if (supplied !== 0 && supplied !== 3) throw new Error("Lifecycle draft generation provenance must be complete");
    }
    const latest = this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version
      FROM passage_draft_versions WHERE project_id = ? AND passage_id = ?`)
      .get(input.projectId, input.passageId) as { version: number };
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO passage_draft_versions (
      id, project_id, passage_id, version, based_on_passage_plan_version_id,
      prose_markdown, word_count, lifecycle_status, source_kind,
      generation_plan_id, generation_job_id, generation_unit_id, author_note,
      restored_from_version_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, input.projectId, input.passageId, latest.version + 1,
        input.basedOnPassagePlanVersionId, input.proseMarkdown, countDraftWords(input.proseMarkdown),
        lifecycleStatus, input.sourceKind, input.generationPlanId ?? null,
        input.generationJobId ?? null, input.generationUnitId ?? null,
        input.authorNote ?? "", input.restoredFromVersionId ?? null, now,
      );
    const insertUpstream = this.database.prepare(`INSERT INTO passage_draft_upstream_artifacts
      (draft_version_id, project_id, artifact_id, artifact_version_id) VALUES (?, ?, ?, ?)`);
    for (const [artifactId, versionId] of Object.entries(input.upstreamVersions).sort(([a], [b]) => a.localeCompare(b))) {
      insertUpstream.run(id, input.projectId, artifactId, versionId);
    }
    const insertNeighbor = this.database.prepare(`INSERT INTO passage_draft_neighbor_versions
      (draft_version_id, project_id, neighbor_passage_id, neighbor_draft_version_id) VALUES (?, ?, ?, ?)`);
    for (const [passageId, versionId] of Object.entries(input.neighboringDraftVersions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      insertNeighbor.run(id, input.projectId, passageId, versionId);
    }
    this.database.prepare(`INSERT INTO passage_draft_heads
      (project_id, passage_id, current_version_id, accepted_version_id, accepted_locked, updated_at)
      VALUES (?, ?, ?, NULL, 0, ?)
      ON CONFLICT(project_id, passage_id) DO UPDATE SET
        current_version_id = excluded.current_version_id,
        updated_at = excluded.updated_at`)
      .run(input.projectId, input.passageId, id, now);
    return this.getVersion(input.projectId, id)!;
  }

  getVersion(projectId: string, versionId: string): PassageDraftVersionRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM passage_draft_versions
      WHERE project_id = ? AND id = ?`).get(projectId, versionId) as DraftRow | undefined;
    return row ? this.mapDraft(row) : undefined;
  }

  getHead(projectId: string, passageId: string): PassageDraftHeadRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM passage_draft_heads
      WHERE project_id = ? AND passage_id = ?`).get(projectId, passageId) as HeadRow | undefined;
    if (!row) return undefined;
    return {
      projectId: row.project_id,
      passageId: row.passage_id,
      current: this.getVersion(projectId, row.current_version_id)!,
      accepted: row.accepted_version_id ? this.getVersion(projectId, row.accepted_version_id) ?? null : null,
      acceptedLocked: Boolean(row.accepted_locked),
      updatedAt: row.updated_at,
    };
  }

  listVersions(projectId: string, passageId: string): PassageDraftVersionRecord[] {
    return (this.database.prepare(`SELECT * FROM passage_draft_versions
      WHERE project_id = ? AND passage_id = ? ORDER BY version DESC`)
      .all(projectId, passageId) as DraftRow[]).map((row) => this.mapDraft(row));
  }

  restore(projectId: string, passageId: string, versionId: string): PassageDraftVersionRecord {
    const source = this.getVersion(projectId, versionId);
    if (!source || source.passageId !== passageId) throw new Error("Passage draft version not found");
    return this.createVersion({
      projectId,
      passageId,
      basedOnPassagePlanVersionId: source.basedOnPassagePlanVersionId,
      proseMarkdown: source.proseMarkdown,
      sourceKind: "restore",
      authorNote: source.authorNote,
      upstreamVersions: source.upstreamVersions,
      neighboringDraftVersions: source.neighboringDraftVersions,
      restoredFromVersionId: source.id,
    });
  }

  transition(projectId: string, passageId: string, versionId: string, to: PassageDraftLifecycle): PassageDraftVersionRecord {
    return transaction(this.database, () => {
      const head = this.getHead(projectId, passageId);
      const source = this.getVersion(projectId, versionId);
      if (!head || !source || source.passageId !== passageId) throw new Error("Passage draft version not found");
      if (source.stale) throw new Error("A stale passage draft cannot become accepted, reviewed, or locked");
      assertPassageDraftTransition(source.lifecycleStatus, to);
      if (head.acceptedLocked && head.accepted?.id !== source.id) {
        throw new Error("Locked accepted prose cannot be replaced without explicit unlock");
      }
      const next = this.createVersionInTransaction({
        projectId,
        passageId,
        basedOnPassagePlanVersionId: source.basedOnPassagePlanVersionId,
        proseMarkdown: source.proseMarkdown,
        lifecycleStatus: to,
        sourceKind: "lifecycle",
        generationPlanId: source.generationPlanId,
        generationJobId: source.generationJobId,
        generationUnitId: source.generationUnitId,
        authorNote: source.authorNote,
        upstreamVersions: source.upstreamVersions,
        neighboringDraftVersions: source.neighboringDraftVersions,
      });
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE passage_draft_heads SET accepted_version_id = ?, accepted_locked = ?, updated_at = ?
        WHERE project_id = ? AND passage_id = ?`)
        .run(next.id, to === "locked" ? 1 : 0, now, projectId, passageId);
      return this.getVersion(projectId, next.id)!;
    });
  }

  unlockAccepted(projectId: string, passageId: string): PassageDraftHeadRecord {
    return transaction(this.database, () => {
      const head = this.getHead(projectId, passageId);
      if (!head?.acceptedLocked) throw new Error("Accepted passage draft is not locked");
      this.database.prepare(`UPDATE passage_draft_heads SET accepted_locked = 0, updated_at = ?
        WHERE project_id = ? AND passage_id = ?`).run(new Date().toISOString(), projectId, passageId);
      return this.getHead(projectId, passageId)!;
    });
  }

  handlePassagePlanMutationInTransaction(mutation: PassagePlanEntityMutation): void {
    for (const impact of classifyPassageDraftStaleness(mutation)) {
      const rows = this.database.prepare(`SELECT id FROM passage_draft_versions
        WHERE project_id = ? AND passage_id = ?
          AND (? IS NULL OR based_on_passage_plan_version_id != ?)`)
        .all(mutation.projectId, impact.passageId, mutation.afterVersionId, mutation.afterVersionId) as Array<{ id: string }>;
      for (const row of rows) this.insertStaleness({
        projectId: mutation.projectId,
        passageId: impact.passageId,
        draftVersionId: row.id,
        reasonCode: impact.reasonCode,
        sourceEntityKind: mutation.kind,
        sourceEntityId: mutation.entityId,
        fromVersionId: mutation.beforeVersionId,
        toVersionId: mutation.afterVersionId,
        changedFields: impact.changedFields,
      });
    }
  }

  markStaleForUpstreamVersion(projectId: string, artifactId: string, approvedVersionId: string): number {
    return transaction(this.database, () => {
      const rows = this.database.prepare(`SELECT drafts.id, drafts.passage_id
        FROM passage_draft_versions drafts
        LEFT JOIN passage_draft_upstream_artifacts dependencies
          ON dependencies.project_id = drafts.project_id
          AND dependencies.draft_version_id = drafts.id
          AND dependencies.artifact_id = ?
        WHERE drafts.project_id = ?
          AND (dependencies.artifact_version_id IS NULL OR dependencies.artifact_version_id != ?)`)
        .all(artifactId, projectId, approvedVersionId) as Array<{ id: string; passage_id: string }>;
      rows.forEach((row) => this.insertStaleness({
        projectId,
        passageId: row.passage_id,
        draftVersionId: row.id,
        reasonCode: "approved-upstream-version-change",
        sourceEntityKind: "artifact",
        sourceEntityId: artifactId,
        fromVersionId: null,
        toVersionId: approvedVersionId,
        changedFields: [artifactId],
      }));
      return rows.length;
    });
  }

  refreshStaleness(
    projectId: string,
    versionId: string,
    currentPassageVersionId: string,
    currentPassageContent: unknown,
    approvedUpstreamVersions: Record<string, string>,
  ): PassageDraftVersionRecord {
    return transaction(this.database, () => {
      const draft = this.getVersion(projectId, versionId);
      if (!draft) throw new Error("Passage draft version not found");
      const based = this.database.prepare("SELECT content_json FROM passage_entity_versions WHERE id = ?")
        .get(draft.basedOnPassagePlanVersionId) as { content_json: string } | undefined;
      if (!based) throw new Error("Passage draft base version not found");
      this.handlePassagePlanMutationInTransaction({
        projectId,
        kind: "passage",
        entityId: draft.passageId,
        beforeVersionId: draft.basedOnPassagePlanVersionId,
        afterVersionId: currentPassageVersionId,
        before: JSON.parse(based.content_json),
        after: currentPassageContent,
      });
      for (const [artifactId, approvedVersionId] of Object.entries(approvedUpstreamVersions)) {
        if (draft.upstreamVersions[artifactId] === approvedVersionId) continue;
        this.insertStaleness({
          projectId,
          passageId: draft.passageId,
          draftVersionId: draft.id,
          reasonCode: "approved-upstream-version-change",
          sourceEntityKind: "artifact",
          sourceEntityId: artifactId,
          fromVersionId: draft.upstreamVersions[artifactId] ?? null,
          toVersionId: approvedVersionId,
          changedFields: [artifactId],
        });
      }
      return this.getVersion(projectId, versionId)!;
    });
  }

  projectSummary(projectId: string): {
    passageCount: number; currentDraftCount: number; acceptedDraftCount: number;
    currentCandidateWords: number; acceptedWords: number; plannedWords: number; remainingWords: number;
  } {
    const counts = this.database.prepare(`SELECT
      COUNT(*) AS passage_count,
      SUM(CASE WHEN heads.current_version_id IS NOT NULL THEN 1 ELSE 0 END) AS current_draft_count,
      SUM(CASE WHEN heads.accepted_version_id IS NOT NULL THEN 1 ELSE 0 END) AS accepted_draft_count,
      COALESCE(SUM(current_versions.word_count), 0) AS current_candidate_words,
      COALESCE(SUM(accepted_versions.word_count), 0) AS accepted_words
      FROM passage_entity_heads passages
      LEFT JOIN passage_draft_heads heads
        ON heads.project_id = passages.project_id AND heads.passage_id = passages.entity_id
      LEFT JOIN passage_draft_versions current_versions ON current_versions.id = heads.current_version_id
      LEFT JOIN passage_draft_versions accepted_versions ON accepted_versions.id = heads.accepted_version_id
      WHERE passages.project_id = ? AND passages.entity_kind = 'passage' AND passages.tombstoned = 0`)
      .get(projectId) as {
        passage_count: number; current_draft_count: number; accepted_draft_count: number;
        current_candidate_words: number; accepted_words: number;
      };
    const planned = this.database.prepare(`SELECT COALESCE(SUM(CAST(json_extract(versions.content_json, '$.wordTarget') AS INTEGER)), 0) AS words
      FROM passage_entity_heads heads JOIN passage_entity_versions versions ON versions.id = heads.version_id
      WHERE heads.project_id = ? AND heads.entity_kind = 'passage' AND heads.tombstoned = 0`)
      .get(projectId) as { words: number };
    return {
      passageCount: counts.passage_count,
      currentDraftCount: counts.current_draft_count,
      acceptedDraftCount: counts.accepted_draft_count,
      currentCandidateWords: counts.current_candidate_words,
      acceptedWords: counts.accepted_words,
      plannedWords: planned.words,
      remainingWords: Math.max(0, planned.words - counts.accepted_words),
    };
  }

  private insertStaleness(input: {
    projectId: string; passageId: string; draftVersionId: string; reasonCode: string;
    sourceEntityKind: string; sourceEntityId: string; fromVersionId: string | null;
    toVersionId: string | null; changedFields: string[];
  }): void {
    this.database.prepare(`INSERT OR IGNORE INTO passage_draft_staleness_events (
      id, project_id, passage_id, draft_version_id, reason_code, source_entity_kind,
      source_entity_id, from_version_id, to_version_id, changed_fields_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        randomUUID(), input.projectId, input.passageId, input.draftVersionId, input.reasonCode,
        input.sourceEntityKind, input.sourceEntityId, input.fromVersionId, input.toVersionId,
        JSON.stringify(input.changedFields), new Date().toISOString(),
      );
  }

  private mapDraft(row: DraftRow): PassageDraftVersionRecord {
    const upstreamRows = this.database.prepare(`SELECT artifact_id, artifact_version_id
      FROM passage_draft_upstream_artifacts WHERE draft_version_id = ? ORDER BY artifact_id`)
      .all(row.id) as Array<{ artifact_id: string; artifact_version_id: string }>;
    const neighborRows = this.database.prepare(`SELECT neighbor_passage_id, neighbor_draft_version_id
      FROM passage_draft_neighbor_versions WHERE draft_version_id = ? ORDER BY neighbor_passage_id`)
      .all(row.id) as Array<{ neighbor_passage_id: string; neighbor_draft_version_id: string }>;
    const staleReasons = (this.database.prepare(`SELECT id, reason_code, source_entity_kind, source_entity_id,
      from_version_id, to_version_id, changed_fields_json, created_at
      FROM passage_draft_staleness_events WHERE project_id = ? AND draft_version_id = ? ORDER BY created_at, id`)
      .all(row.project_id, row.id) as StaleRow[]).map((item) => ({
        id: item.id,
        reasonCode: item.reason_code,
        sourceEntityKind: item.source_entity_kind,
        sourceEntityId: item.source_entity_id,
        fromVersionId: item.from_version_id,
        toVersionId: item.to_version_id,
        changedFields: JSON.parse(item.changed_fields_json) as string[],
        createdAt: item.created_at,
      }));
    return {
      id: row.id,
      projectId: row.project_id,
      passageId: row.passage_id,
      version: row.version,
      basedOnPassagePlanVersionId: row.based_on_passage_plan_version_id,
      proseMarkdown: row.prose_markdown,
      wordCount: row.word_count,
      lifecycleStatus: row.lifecycle_status,
      status: staleReasons.length ? "stale" : row.lifecycle_status,
      sourceKind: row.source_kind,
      generationPlanId: row.generation_plan_id,
      generationJobId: row.generation_job_id,
      generationUnitId: row.generation_unit_id,
      authorNote: row.author_note,
      upstreamVersions: Object.fromEntries(upstreamRows.map((item) => [item.artifact_id, item.artifact_version_id])),
      neighboringDraftVersions: Object.fromEntries(neighborRows.map((item) => [item.neighbor_passage_id, item.neighbor_draft_version_id])),
      restoredFromVersionId: row.restored_from_version_id,
      stale: staleReasons.length > 0,
      staleReasons,
      createdAt: row.created_at,
    };
  }
}
