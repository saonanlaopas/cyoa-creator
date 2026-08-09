import type { PassagePlan } from "@story-to-cyoa/pipeline";
import type {
  PassageDraftLifecycle,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";

const upstreamArtifactIds = ["brief", "bible", "routes", "endings", "mechanics"] as const;
const maximumManualDraftBytes = 96_000;

export class PassageDraftService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly workflow: WorkflowRepository,
    private readonly passagePlans: PassagePlanRepository,
    private readonly drafts: PassageDraftRepository,
  ) {}

  get(projectId: string, passageId: string) {
    this.requireProject(projectId);
    const passage = this.requirePassage(projectId, passageId);
    return {
      passagePlanVersionId: passage.id,
      passagePlan: passage.content,
      head: this.drafts.getHead(projectId, passageId) ?? null,
      history: this.drafts.listVersions(projectId, passageId),
      summary: this.drafts.projectSummary(projectId),
    };
  }

  summary(projectId: string) {
    this.requireProject(projectId);
    return this.drafts.projectSummary(projectId);
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
    const draft = this.drafts.transition(projectId, passageId, versionId, status);
    return { draft, state: this.get(projectId, passageId) };
  }

  unlock(projectId: string, passageId: string) {
    this.requireProject(projectId);
    return { head: this.drafts.unlockAccepted(projectId, passageId), state: this.get(projectId, passageId) };
  }

  private approvedUpstreamVersions(projectId: string): Record<string, string> {
    return Object.fromEntries(upstreamArtifactIds.map((artifactId) => {
      const versionId = this.workflow.get(projectId, artifactId).approvedVersionId;
      if (!versionId) throw new Error(`Approve ${artifactId} before drafting`);
      return [artifactId, versionId];
    }));
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
