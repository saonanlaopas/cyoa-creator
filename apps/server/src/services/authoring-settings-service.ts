import { z } from "zod";
import { AUTHORING_SETTINGS_ID, AuthoringSettingsSchema, builtinFictionCraft, sourceDigest } from "@story-to-cyoa/domain";
import { ArtifactRepository, AuthoringInstructionsRepository, ConversationRepository, ProjectRepository, transaction, type StoryDatabase } from "@story-to-cyoa/persistence";
const projectId = z.string().min(1).max(240), fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const change = { projectId, expectedVersionId: z.string().nullable(), enabled: z.boolean() };
export const AuthoringSettingsInputs = {
  read_authoring_settings: z.object({ projectId }).strict(),
  review_authoring_settings: z.object(change).strict(),
  apply_authoring_settings: z.object({ ...change, fingerprint, operationId: z.string().uuid(), approved: z.literal(true) }).strict(),
};
export type AuthoringSettingsTool = keyof typeof AuthoringSettingsInputs;
/** Shared browser/MCP boundary. Settings changes never approve or modify creative content. */
export class AuthoringSettingsService {
  private readonly repository: AuthoringInstructionsRepository;
  constructor(private readonly database: StoryDatabase) { this.repository = new AuthoringInstructionsRepository(database); }
  private access(projectId: string) { const p = new ProjectRepository(this.database).get(projectId); if (!p || p.archived) throw new Error("authoring_project_unavailable"); }
  private review(input: z.infer<typeof AuthoringSettingsInputs.review_authoring_settings>) {
    this.access(input.projectId);
    const current = this.repository.settings(input.projectId);
    if (current.versionId !== input.expectedVersionId) throw new Error("authoring_settings_stale_refresh_review");
    const settings = AuthoringSettingsSchema.parse({ ...current.settings, enabled: input.enabled, origin: "author-choice", guide: current.settings.guide ?? builtinFictionCraft() });
    const review = { projectId: input.projectId, expectedVersionId: current.versionId, before: current.settings, after: settings,
      retainedCustomInstructions: this.repository.context(input.projectId).customInstructions,
      effect: "Future authoring contexts change. Existing prose, custom instructions, Creative Direction, locks and approvals remain intact.", providerCalls: 0 };
    return { ...review, fingerprint: sourceDigest(review) };
  }
  call(tool: AuthoringSettingsTool, value: unknown): unknown {
    if (tool === "read_authoring_settings") { const i = AuthoringSettingsInputs.read_authoring_settings.parse(value); this.access(i.projectId); const stored = this.repository.settings(i.projectId); return { ...stored, settings: { ...stored.settings, guide: stored.settings.guide ? { id: stored.settings.guide.id, version: stored.settings.guide.version, sha256: stored.settings.guide.sha256 } : null }, context: this.repository.context(i.projectId), providerCalls: 0 }; }
    if (tool === "review_authoring_settings") {
      const review = this.review(AuthoringSettingsInputs.review_authoring_settings.parse(value));
      const display = (v: typeof review.before) => ({ ...v, guide: v.guide ? { id: v.guide.id, version: v.guide.version, sha256: v.guide.sha256 } : null });
      return { ...review, before: display(review.before), after: display(review.after) };
    }
    const i = AuthoringSettingsInputs.apply_authoring_settings.parse(value);
    return transaction(this.database, () => {
      this.access(i.projectId);
      const hash = sourceDigest({ tool, input: i });
      const receipt = this.database.prepare(`SELECT m.metadata_json FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=? AND (json_extract(m.metadata_json,'$.connectedOperation.operationId')=? OR json_extract(m.metadata_json,'$.assetOperation.operationId')=?) LIMIT 1`).get(i.projectId, i.operationId, i.operationId) as { metadata_json: string } | undefined;
      if (receipt) {
        const saved = JSON.parse(receipt.metadata_json).connectedOperation;
        if (!saved || saved.tool !== tool || saved.fingerprint !== hash) throw new Error("authoring_operation_id_conflict");
        const version = new ArtifactRepository(this.database).getVersion(saved.result.versionId);
        if (!version || version.projectId !== i.projectId || version.artifactId !== AUTHORING_SETTINGS_ID || sourceDigest(version.content) !== saved.result.settingsDigest) throw new Error("authoring_receipt_lineage_invalid");
        return saved.result;
      }
      const review = this.review(i);
      if (review.fingerprint !== i.fingerprint) throw new Error("authoring_settings_review_stale");
      const version = this.repository.saveInTransaction(i.projectId, review.after);
      const result = { versionId: version.id, settingsDigest: sourceDigest(version.content), settings: { ...version.content, guide: version.content.guide ? { id: version.content.guide.id, version: version.content.guide.version, sha256: version.content.guide.sha256 } : null }, providerCalls: 0 };
      const conversations = new ConversationRepository(this.database), scope = { kind: "project" as const, projectId: i.projectId };
      const c = conversations.list(i.projectId).find(c => c.title === "Authoring settings operations") ?? conversations.create(i.projectId, scope, "Authoring settings operations");
      conversations.addMessage({ conversationId: c.id, role: "assistant", intent: "discuss", scope, context: {}, content: "Author-approved Fiction Craft setting applied", metadata: { connectedOperation: { operationId: i.operationId, tool, fingerprint: hash, result } } });
      return result;
    });
  }
}
