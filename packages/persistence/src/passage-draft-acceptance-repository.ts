import { createHash } from "node:crypto";
import type { StoryDatabase } from "./database.js";
import type {
  PassageDraftHeadRecord,
  PassageDraftRepository,
  PassageDraftVersionRecord,
} from "./passage-draft-repository.js";

export interface DraftAcceptanceSelection {
  passageId: string;
  candidateDraftVersionId: string;
}

export type DraftAcceptanceIssueCode =
  | "duplicate_passage"
  | "candidate_not_found"
  | "candidate_passage_mismatch"
  | "candidate_not_unaccepted"
  | "stale_candidate"
  | "outdated_passage_plan_base"
  | "outdated_upstream_dependency"
  | "outdated_neighbor_dependency"
  | "stale_neighbor_dependency"
  | "locked_accepted_replacement"
  | "already_accepted";

export interface DraftAcceptanceIssue {
  code: DraftAcceptanceIssueCode;
  severity: "error" | "warning";
  passageId: string;
  candidateDraftVersionId: string;
  message: string;
  dependencyId?: string;
  expectedVersionId?: string | null;
  actualVersionId?: string | null;
}

export interface DraftAcceptanceImpact {
  draftVersionId: string;
  passageId: string;
  neighborPassageId: string;
  previousAcceptedVersionId: string;
  resultingAcceptedVersionId: string;
}

export interface DraftAcceptancePreviewItem {
  passageId: string;
  candidateDraftVersionId: string;
  previousAcceptedVersionId: string | null;
  resultingAcceptedVersionId: string | null;
  resultingLifecycle: "accepted";
  acceptedLocked: boolean;
  candidateWordCount: number | null;
  previousAcceptedWordCount: number;
  acceptedWordDelta: number;
  noOp: boolean;
}

export interface DraftAcceptancePreview {
  projectId: string;
  selections: DraftAcceptanceSelection[];
  items: DraftAcceptancePreviewItem[];
  issues: DraftAcceptanceIssue[];
  downstreamStaleness: DraftAcceptanceImpact[];
  acceptedWordDelta: number;
  acceptedPassageDelta: number;
  valid: boolean;
  fingerprint: string;
}

export interface DraftAcceptanceApplication {
  id: string | null;
  projectId: string;
  previewFingerprint: string;
  selectedCandidates: DraftAcceptanceSelection[];
  previousAcceptedVersions: Record<string, string | null>;
  resultingAcceptedVersions: Record<string, string>;
  downstreamStaleness: DraftAcceptanceImpact[];
  acceptedWordDelta: number;
  createdAt: string;
}

type PreviewState = {
  selection: DraftAcceptanceSelection;
  candidate: PassageDraftVersionRecord | null;
  head: PassageDraftHeadRecord | null;
  currentPassagePlanVersionId: string | null;
};

export class PassageDraftAcceptanceRepository {
  public constructor(
    private readonly database: StoryDatabase,
    private readonly drafts: PassageDraftRepository,
  ) {}

  preview(projectId: string, selections: DraftAcceptanceSelection[]): DraftAcceptancePreview {
    const normalized = selections.map((selection) => ({ ...selection })).sort((left, right) =>
      left.passageId.localeCompare(right.passageId)
      || left.candidateDraftVersionId.localeCompare(right.candidateDraftVersionId));
    const duplicatePassages = new Set<string>();
    const seen = new Set<string>();
    for (const selection of normalized) {
      if (seen.has(selection.passageId)) duplicatePassages.add(selection.passageId);
      seen.add(selection.passageId);
    }
    const states = normalized.map((selection): PreviewState => ({
      selection,
      candidate: this.drafts.getVersion(projectId, selection.candidateDraftVersionId) ?? null,
      head: this.drafts.getHead(projectId, selection.passageId) ?? null,
      currentPassagePlanVersionId: this.currentPassagePlanVersion(projectId, selection.passageId),
    }));
    const upstreamVersions = this.currentApprovedUpstreamVersions(projectId);
    const baseState = states.map((state) => ({
      passageId: state.selection.passageId,
      candidateDraftVersionId: state.selection.candidateDraftVersionId,
      previousAcceptedVersionId: state.head?.accepted?.id ?? null,
      currentVersionId: state.head?.current.id ?? null,
      acceptedLocked: state.head?.acceptedLocked ?? false,
      currentPassagePlanVersionId: state.currentPassagePlanVersionId,
      candidateBaseVersionId: state.candidate?.basedOnPassagePlanVersionId ?? null,
      candidateUpstreamVersions: state.candidate?.upstreamVersions ?? null,
      candidateNeighborVersions: state.candidate?.neighboringDraftVersions ?? null,
      candidateStaleReasons: state.candidate?.staleReasons.map((reason) => reason.id) ?? null,
    }));
    const seedFingerprint = fingerprint({ selections: normalized, state: baseState, upstreamVersions });
    const resultingByPassage = new Map<string, string | null>();
    const noOpByPassage = new Map<string, boolean>();
    for (const state of states) {
      const previous = state.head?.accepted?.id ?? null;
      const noOp = Boolean(previous && this.wasCandidateAcceptedAs(
        projectId, state.selection.passageId, state.selection.candidateDraftVersionId, previous,
      ));
      noOpByPassage.set(state.selection.passageId, noOp);
      resultingByPassage.set(
        state.selection.passageId,
        noOp ? previous : acceptedVersionId(seedFingerprint, state.selection),
      );
    }

    const issues: DraftAcceptanceIssue[] = [];
    for (const passageId of duplicatePassages) {
      const selection = normalized.find((item) => item.passageId === passageId)!;
      issues.push(issue("duplicate_passage", selection, "Each passage may appear only once in an acceptance batch"));
    }
    for (const state of states) {
      const { selection, candidate, head } = state;
      if (!candidate) {
        issues.push(issue("candidate_not_found", selection, "The exact selected candidate does not exist in this project"));
        continue;
      }
      if (candidate.passageId !== selection.passageId) {
        issues.push(issue("candidate_passage_mismatch", selection, "The selected candidate belongs to another passage"));
        continue;
      }
      if (candidate.lifecycleStatus !== "candidate") {
        issues.push(issue("candidate_not_unaccepted", selection, "Only an immutable candidate version can be accepted"));
      }
      if (candidate.stale) {
        issues.push(issue("stale_candidate", selection, "A stale candidate cannot be accepted"));
      }
      if (!state.currentPassagePlanVersionId || (candidate.basedOnPassagePlanVersionId !== state.currentPassagePlanVersionId
        && this.drafts.isPassagePlanVersionChangeRelevant(
          projectId, selection.passageId, candidate.basedOnPassagePlanVersionId, state.currentPassagePlanVersionId,
        ))) {
        issues.push({
          ...issue("outdated_passage_plan_base", selection, "The candidate passage-plan base is no longer current"),
          expectedVersionId: state.currentPassagePlanVersionId,
          actualVersionId: candidate.basedOnPassagePlanVersionId,
        });
      }
      for (const [artifactId, candidateVersionId] of Object.entries(candidate.upstreamVersions)) {
        const currentVersionId = upstreamVersions[artifactId] ?? null;
        if (currentVersionId !== candidateVersionId && (!currentVersionId
          || this.drafts.isUpstreamVersionChangeRelevant(
            projectId, selection.passageId, artifactId, candidateVersionId, currentVersionId,
          ))) issues.push({
          ...issue("outdated_upstream_dependency", selection, `Approved ${artifactId} provenance has changed`),
          dependencyId: artifactId,
          expectedVersionId: currentVersionId,
          actualVersionId: candidateVersionId,
        });
      }
      for (const [neighborPassageId, candidateNeighborVersionId] of Object.entries(candidate.neighboringDraftVersions)) {
        const neighborHead = this.drafts.getHead(projectId, neighborPassageId);
        const selectedNeighborChanges = resultingByPassage.has(neighborPassageId)
          && !noOpByPassage.get(neighborPassageId);
        const resultingNeighborVersionId = resultingByPassage.has(neighborPassageId)
          ? resultingByPassage.get(neighborPassageId) ?? null
          : neighborHead?.accepted?.id ?? null;
        if (!resultingNeighborVersionId || !this.drafts.acceptedVersionsAreEquivalent(
          projectId, candidateNeighborVersionId, resultingNeighborVersionId,
        )) issues.push({
          ...issue("outdated_neighbor_dependency", selection, `Accepted neighbor ${neighborPassageId} will not match the candidate context`),
          dependencyId: neighborPassageId,
          expectedVersionId: resultingNeighborVersionId,
          actualVersionId: candidateNeighborVersionId,
        });
        else if (!selectedNeighborChanges && neighborHead?.accepted?.stale) issues.push({
          ...issue("stale_neighbor_dependency", selection, `Accepted neighbor ${neighborPassageId} is stale`),
          dependencyId: neighborPassageId,
          expectedVersionId: neighborHead.accepted.id,
          actualVersionId: candidateNeighborVersionId,
        });
      }
      if (head?.acceptedLocked && !noOpByPassage.get(selection.passageId)) {
        issues.push(issue("locked_accepted_replacement", selection, "Locked accepted prose must be explicitly unlocked before replacement"));
      }
      if (noOpByPassage.get(selection.passageId)) {
        issues.push({ ...issue("already_accepted", selection, "This exact candidate is already the accepted head"), severity: "warning" });
      }
    }

    const items = states.map((state): DraftAcceptancePreviewItem => {
      const previous = state.head?.accepted ?? null;
      const candidateWords = state.candidate?.wordCount ?? null;
      const noOp = noOpByPassage.get(state.selection.passageId) ?? false;
      return {
        passageId: state.selection.passageId,
        candidateDraftVersionId: state.selection.candidateDraftVersionId,
        previousAcceptedVersionId: previous?.id ?? null,
        resultingAcceptedVersionId: state.candidate ? resultingByPassage.get(state.selection.passageId) ?? null : null,
        resultingLifecycle: "accepted",
        acceptedLocked: state.head?.acceptedLocked ?? false,
        candidateWordCount: candidateWords,
        previousAcceptedWordCount: previous?.wordCount ?? 0,
        acceptedWordDelta: candidateWords === null || noOp ? 0 : candidateWords - (previous?.wordCount ?? 0),
        noOp,
      };
    });
    const downstreamStaleness = items.flatMap((item) => item.noOp || !item.previousAcceptedVersionId || !item.resultingAcceptedVersionId
      ? []
      : this.downstreamImpacts(
        projectId, item.passageId, item.previousAcceptedVersionId, item.resultingAcceptedVersionId,
      )).sort(compareImpact);
    const acceptedWordDelta = items.reduce((total, item) => total + item.acceptedWordDelta, 0);
    const acceptedPassageDelta = items.filter((item) => !item.noOp && !item.previousAcceptedVersionId && item.candidateWordCount !== null).length;
    const finalState = {
      selections: normalized,
      state: baseState,
      upstreamVersions,
      items,
      issues,
      downstreamStaleness,
      acceptedWordDelta,
      acceptedPassageDelta,
    };
    return {
      projectId,
      selections: normalized,
      items,
      issues,
      downstreamStaleness,
      acceptedWordDelta,
      acceptedPassageDelta,
      valid: normalized.length > 0 && !issues.some((item) => item.severity === "error"),
      fingerprint: fingerprint(finalState),
    };
  }

  applyInTransaction(preview: DraftAcceptancePreview): DraftAcceptanceApplication {
    if (!preview.valid) throw new Error("Draft acceptance preview contains blocking errors");
    const now = new Date().toISOString();
    const changedItems = preview.items.filter((item) => !item.noOp);
    const previousAcceptedVersions: Record<string, string | null> = {};
    const resultingAcceptedVersions: Record<string, string> = {};
    for (const item of preview.items) {
      previousAcceptedVersions[item.passageId] = item.previousAcceptedVersionId;
      if (item.resultingAcceptedVersionId) resultingAcceptedVersions[item.passageId] = item.resultingAcceptedVersionId;
    }
    if (!changedItems.length) return {
      id: null,
      projectId: preview.projectId,
      previewFingerprint: preview.fingerprint,
      selectedCandidates: preview.selections,
      previousAcceptedVersions,
      resultingAcceptedVersions,
      downstreamStaleness: [],
      acceptedWordDelta: 0,
      createdAt: now,
    };

    for (const item of changedItems) {
      const candidate = this.drafts.getVersion(preview.projectId, item.candidateDraftVersionId)!;
      const result = this.drafts.createVersionInTransaction({
        id: item.resultingAcceptedVersionId!,
        projectId: preview.projectId,
        passageId: item.passageId,
        basedOnPassagePlanVersionId: candidate.basedOnPassagePlanVersionId,
        proseMarkdown: candidate.proseMarkdown,
        lifecycleStatus: "accepted",
        sourceKind: "lifecycle",
        generationPlanId: candidate.generationPlanId,
        generationJobId: candidate.generationJobId,
        generationUnitId: candidate.generationUnitId,
        authorNote: candidate.authorNote,
        upstreamVersions: candidate.upstreamVersions,
        neighboringDraftVersions: candidate.neighboringDraftVersions,
        promoteCurrent: this.drafts.getHead(preview.projectId, item.passageId)?.current.id === candidate.id,
      });
      this.database.prepare(`UPDATE passage_draft_heads
        SET accepted_version_id = ?, accepted_locked = 0, updated_at = ?
        WHERE project_id = ? AND passage_id = ?`)
        .run(result.id, now, preview.projectId, item.passageId);
    }
    const directlyStaleAcceptedHeads = new Map<string, string>();
    for (const impact of preview.downstreamStaleness) {
      this.drafts.insertStalenessInTransaction({
        projectId: preview.projectId,
        passageId: impact.passageId,
        draftVersionId: impact.draftVersionId,
        reasonCode: "accepted-neighbor-draft-change",
        sourceEntityKind: "accepted-passage-draft",
        sourceEntityId: impact.neighborPassageId,
        fromVersionId: impact.previousAcceptedVersionId,
        toVersionId: impact.resultingAcceptedVersionId,
        changedFields: ["acceptedVersionId"],
      });
      const accepted = this.drafts.getHead(preview.projectId, impact.passageId)?.accepted;
      if (accepted?.id === impact.draftVersionId && accepted.stale) {
        directlyStaleAcceptedHeads.set(impact.passageId, accepted.id);
      }
    }
    for (const [passageId, acceptedVersionId] of [...directlyStaleAcceptedHeads].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) {
      this.drafts.propagateAcceptedNeighborStaleInTransaction(
        preview.projectId, passageId, acceptedVersionId,
      );
    }
    const applicationId = `daa_${preview.fingerprint.slice(0, 32)}`;
    this.database.prepare(`INSERT INTO passage_draft_acceptance_applications (
      id, project_id, preview_fingerprint, selected_candidates_json,
      previous_accepted_versions_json, resulting_accepted_versions_json,
      downstream_staleness_json, accepted_word_delta, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        applicationId, preview.projectId, preview.fingerprint, JSON.stringify(preview.selections),
        JSON.stringify(previousAcceptedVersions), JSON.stringify(resultingAcceptedVersions),
        JSON.stringify(preview.downstreamStaleness), preview.acceptedWordDelta, now,
      );
    const insertItem = this.database.prepare(`INSERT INTO passage_draft_acceptance_items (
      application_id, project_id, passage_id, candidate_version_id,
      previous_accepted_version_id, resulting_accepted_version_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const item of changedItems) insertItem.run(
      applicationId, preview.projectId, item.passageId, item.candidateDraftVersionId,
      item.previousAcceptedVersionId, item.resultingAcceptedVersionId, now,
    );
    return {
      id: applicationId,
      projectId: preview.projectId,
      previewFingerprint: preview.fingerprint,
      selectedCandidates: preview.selections,
      previousAcceptedVersions,
      resultingAcceptedVersions,
      downstreamStaleness: preview.downstreamStaleness,
      acceptedWordDelta: preview.acceptedWordDelta,
      createdAt: now,
    };
  }

  listApplications(projectId: string, passageId?: string): DraftAcceptanceApplication[] {
    const rows = this.database.prepare(passageId ? `SELECT DISTINCT applications.*
      FROM passage_draft_acceptance_applications applications
      JOIN passage_draft_acceptance_items items
        ON items.project_id = applications.project_id AND items.application_id = applications.id
      WHERE applications.project_id = ? AND items.passage_id = ?
      ORDER BY applications.created_at DESC, applications.id DESC` : `SELECT *
      FROM passage_draft_acceptance_applications WHERE project_id = ?
      ORDER BY created_at DESC, id DESC`)
      .all(...(passageId ? [projectId, passageId] : [projectId])) as Array<{
        id: string; project_id: string; preview_fingerprint: string; selected_candidates_json: string;
        previous_accepted_versions_json: string; resulting_accepted_versions_json: string;
        downstream_staleness_json: string; accepted_word_delta: number; created_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      previewFingerprint: row.preview_fingerprint,
      selectedCandidates: JSON.parse(row.selected_candidates_json) as DraftAcceptanceSelection[],
      previousAcceptedVersions: JSON.parse(row.previous_accepted_versions_json) as Record<string, string | null>,
      resultingAcceptedVersions: JSON.parse(row.resulting_accepted_versions_json) as Record<string, string>,
      downstreamStaleness: JSON.parse(row.downstream_staleness_json) as DraftAcceptanceImpact[],
      acceptedWordDelta: row.accepted_word_delta,
      createdAt: row.created_at,
    }));
  }

  private currentPassagePlanVersion(projectId: string, passageId: string): string | null {
    const row = this.database.prepare(`SELECT version_id FROM passage_entity_heads
      WHERE project_id = ? AND entity_kind = 'passage' AND entity_id = ? AND tombstoned = 0`)
      .get(projectId, passageId) as { version_id: string } | undefined;
    return row?.version_id ?? null;
  }

  private currentApprovedUpstreamVersions(projectId: string): Record<string, string> {
    const rows = this.database.prepare(`SELECT artifact_id, approved_version_id
      FROM artifact_workflow_state WHERE project_id = ? AND approved_version_id IS NOT NULL
      ORDER BY artifact_id`).all(projectId) as Array<{ artifact_id: string; approved_version_id: string }>;
    return Object.fromEntries(rows.map((row) => [row.artifact_id, row.approved_version_id]));
  }

  private wasCandidateAcceptedAs(projectId: string, passageId: string, candidateId: string, acceptedId: string): boolean {
    const rows = this.database.prepare(`SELECT resulting_accepted_version_id
      FROM passage_draft_acceptance_items
      WHERE project_id = ? AND passage_id = ? AND candidate_version_id = ?`)
      .all(projectId, passageId, candidateId) as Array<{ resulting_accepted_version_id: string }>;
    return rows.some((row) => this.drafts.acceptedVersionsAreEquivalent(
      projectId, row.resulting_accepted_version_id, acceptedId,
    ));
  }

  private downstreamImpacts(
    projectId: string,
    neighborPassageId: string,
    previousAcceptedVersionId: string,
    resultingAcceptedVersionId: string,
  ): DraftAcceptanceImpact[] {
    const rows = this.database.prepare(`SELECT dependencies.draft_version_id, drafts.passage_id,
        dependencies.neighbor_draft_version_id
      FROM passage_draft_neighbor_versions dependencies
      JOIN passage_draft_versions drafts
        ON drafts.project_id = dependencies.project_id AND drafts.id = dependencies.draft_version_id
      WHERE dependencies.project_id = ? AND dependencies.neighbor_passage_id = ?
      ORDER BY drafts.passage_id, dependencies.draft_version_id`)
      .all(projectId, neighborPassageId) as Array<{
        draft_version_id: string; passage_id: string; neighbor_draft_version_id: string;
      }>;
    return rows.filter((row) => this.drafts.acceptedVersionsAreEquivalent(
      projectId, row.neighbor_draft_version_id, previousAcceptedVersionId,
    )).map((row) => ({
      draftVersionId: row.draft_version_id,
      passageId: row.passage_id,
      neighborPassageId,
      previousAcceptedVersionId: row.neighbor_draft_version_id,
      resultingAcceptedVersionId,
    }));
  }
}

function acceptedVersionId(seed: string, selection: DraftAcceptanceSelection): string {
  return `dav_${fingerprint({ seed, passageId: selection.passageId, candidateId: selection.candidateDraftVersionId }).slice(0, 32)}`;
}

function issue(
  code: DraftAcceptanceIssueCode,
  selection: DraftAcceptanceSelection,
  message: string,
): DraftAcceptanceIssue {
  return {
    code,
    severity: "error",
    passageId: selection.passageId,
    candidateDraftVersionId: selection.candidateDraftVersionId,
    message,
  };
}

function compareImpact(left: DraftAcceptanceImpact, right: DraftAcceptanceImpact): number {
  return left.passageId.localeCompare(right.passageId)
    || left.draftVersionId.localeCompare(right.draftVersionId)
    || left.neighborPassageId.localeCompare(right.neighborPassageId);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export class StaleDraftAcceptancePreviewError extends Error {
  public readonly code = "stale_acceptance_preview";
  public constructor(public readonly currentPreview: DraftAcceptancePreview) {
    super("Draft acceptance impact changed; refresh and review the preview");
  }
}
