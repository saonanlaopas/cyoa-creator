import type { PassagePlan } from "@story-to-cyoa/pipeline";
import type {
  DraftAcceptanceSelection,
  PassageDraftAcceptanceRepository,
  PassageDraftLifecycle,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
  StoryDatabase,
} from "@story-to-cyoa/persistence";
import { StaleDraftAcceptancePreviewError, transaction } from "@story-to-cyoa/persistence";

const upstreamArtifactIds = ["brief", "creative-direction", "bible", "routes", "endings", "mechanics"] as const;
const maximumManualDraftBytes = 96_000;

export class PassageDraftService {
  public constructor(
    private readonly database: StoryDatabase,
    private readonly projects: ProjectRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
    private readonly acceptance: PassageDraftAcceptanceRepository,
  ) {}

  get(projectId: string, passageId: string) {
    this.requireProject(projectId);
    const passage = this.requirePassage(projectId, passageId);
    return {
      passagePlanVersionId: passage.id,
      passagePlan: passage.content,
      head: this.drafts.getHead(projectId, passageId) ?? null,
      history: this.drafts.listVersions(projectId, passageId),
      acceptanceHistory: this.acceptance.listApplications(projectId, passageId),
      summary: this.drafts.projectSummary(projectId),
    };
  }

  summary(projectId: string) {
    this.requireProject(projectId);
    return this.drafts.projectSummary(projectId);
  }

  queue(projectId: string) {
    this.requireProject(projectId);
    return { items: this.drafts.listReviewQueue(projectId), summary: this.drafts.projectSummary(projectId) };
  }

  previewAcceptance(projectId: string, input: { selections?: unknown }) {
    this.requireProject(projectId);
    return this.acceptance.preview(projectId, this.acceptanceSelections(input.selections));
  }

  accept(projectId: string, input: { selections?: unknown; previewFingerprint?: unknown }) {
    this.requireProject(projectId);
    const selections = this.acceptanceSelections(input.selections);
    if (typeof input.previewFingerprint !== "string" || !input.previewFingerprint) {
      throw new Error("previewFingerprint is required");
    }
    return transaction(this.database, () => {
      const preview = this.acceptance.preview(projectId, selections);
      if (preview.fingerprint !== input.previewFingerprint) throw new StaleDraftAcceptancePreviewError(preview);
      const application = this.acceptance.applyInTransaction(preview);
      return { application, preview, summary: this.drafts.projectSummary(projectId) };
    });
  }

  compare(projectId: string, passageId: string, beforeVersionId: string | null, afterVersionId: string) {
    this.requireProject(projectId);
    this.requirePassage(projectId, passageId);
    const before = beforeVersionId ? this.drafts.getVersion(projectId, beforeVersionId) ?? null : null;
    const after = this.drafts.getVersion(projectId, afterVersionId);
    if ((before && before.passageId !== passageId) || !after || after.passageId !== passageId) {
      throw new Error("Passage draft version not found");
    }
    return {
      before,
      after,
      wordCountDelta: after.wordCount - (before?.wordCount ?? 0),
      baseVersionChanged: Boolean(before && before.basedOnPassagePlanVersionId !== after.basedOnPassagePlanVersionId),
      provenanceChanged: Boolean(before && JSON.stringify({
        source: before.sourceKind, upstream: before.upstreamVersions, neighbors: before.neighboringDraftVersions,
      }) !== JSON.stringify({
        source: after.sourceKind, upstream: after.upstreamVersions, neighbors: after.neighboringDraftVersions,
      })),
      paragraphs: paragraphDiff(before?.proseMarkdown ?? "", after.proseMarkdown),
    };
  }

  saveManual(projectId: string, passageId: string, input: { proseMarkdown?: unknown; authorNote?: unknown }) {
    this.requireProject(projectId);
    const passage = this.requirePassage(projectId, passageId);
    if (typeof input.proseMarkdown !== "string") throw new Error("proseMarkdown is required");
    if (Buffer.byteLength(input.proseMarkdown, "utf8") > maximumManualDraftBytes) {
      throw new Error(`Manual passage draft exceeds the ${maximumManualDraftBytes}-byte safety limit`);
    }
    const authorNote = typeof input.authorNote === "string" ? input.authorNote : "";
    if (Buffer.byteLength(authorNote, "utf8") > 10_000) throw new Error("Draft author note is too large");
    const upstreamVersions = this.approvedUpstreamVersions(projectId);
    const draft = this.drafts.createVersion({
      projectId,
      passageId,
      basedOnPassagePlanVersionId: passage.id,
      proseMarkdown: input.proseMarkdown,
      sourceKind: "manual",
      authorNote,
      upstreamVersions,
    });
    return { draft, state: this.get(projectId, passageId) };
  }

  restore(projectId: string, passageId: string, versionId: string) {
    this.requireProject(projectId);
    const passage = this.requirePassage(projectId, passageId);
    const restored = this.drafts.restore(projectId, passageId, versionId);
    const draft = this.drafts.refreshStaleness(
      projectId,
      restored.id,
      passage.id,
      passage.content,
      this.approvedUpstreamVersions(projectId),
    );
    return { draft, state: this.get(projectId, passageId) };
  }

  transition(projectId: string, passageId: string, versionId: string, status: PassageDraftLifecycle) {
    this.requireProject(projectId);
    if (status !== "reviewed" && status !== "locked") {
      throw new Error("Candidate acceptance requires an exact acceptance preview");
    }
    const head = this.drafts.getHead(projectId, passageId);
    if (!head?.accepted || head.accepted.id !== versionId) {
      throw new Error("Only the current accepted version can advance its review lifecycle");
    }
    const draft = this.drafts.transition(projectId, passageId, versionId, status);
    return { draft, state: this.get(projectId, passageId) };
  }

  unlock(projectId: string, passageId: string) {
    this.requireProject(projectId);
    return { head: this.drafts.unlockAccepted(projectId, passageId), state: this.get(projectId, passageId) };
  }

  private approvedUpstreamVersions(projectId: string): Record<string, string> {
    return Object.fromEntries(upstreamArtifactIds.flatMap((artifactId) => {
      const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
      if (!versionId && artifactId === "creative-direction") return [];
      if (!versionId) throw new Error(`Approve ${artifactId} before drafting`);
      return [[artifactId, versionId]];
    }));
  }

  private acceptanceSelections(value: unknown): DraftAcceptanceSelection[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 300) {
      throw new Error("Select between 1 and 300 exact passage candidates");
    }
    return value.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Invalid draft acceptance selection");
      const selection = item as Record<string, unknown>;
      if (typeof selection.passageId !== "string" || typeof selection.candidateDraftVersionId !== "string"
        || !selection.passageId || !selection.candidateDraftVersionId) {
        throw new Error("Every selection requires passageId and candidateDraftVersionId");
      }
      return { passageId: selection.passageId, candidateDraftVersionId: selection.candidateDraftVersionId };
    });
  }

  private requirePassage(projectId: string, passageId: string) {
    const passage = this.passagePlans.currentEntity<PassagePlan>(projectId, "passage", passageId);
    if (!passage) throw new Error("Passage-plan passage not found");
    return passage;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.mode !== "long-form") throw new Error("Long-form project not found");
    return project;
  }
}

export const passageDraftManualMaximumBytes = maximumManualDraftBytes;

function paragraphDiff(before: string, after: string): Array<{ kind: "unchanged" | "removed" | "added"; text: string }> {
  const left = paragraphs(before);
  const right = paragraphs(after);
  const lengths = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = left[i] === right[j] ? 1 + lengths[i + 1]![j + 1]!
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const result: Array<{ kind: "unchanged" | "removed" | "added"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "unchanged", text: left[i]! }); i += 1; j += 1;
    } else if (j < right.length && (i === left.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      result.push({ kind: "added", text: right[j]! }); j += 1;
    } else {
      result.push({ kind: "removed", text: left[i]! }); i += 1;
    }
  }
  return result;
}

function paragraphs(value: string): string[] {
  return value.trim() ? value.split(/\r?\n\s*\r?\n/).map((item) => item.trim()) : [];
}
