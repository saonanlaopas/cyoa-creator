import { z } from "zod";
import { sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { ArtifactRepository, ConversationRepository, ProjectRepository, transaction, type StoryDatabase } from "@story-to-cyoa/persistence";
import { planningArtifactIds, planningSection, type PlanningArtifact, type PlanningArtifactId } from "@story-to-cyoa/pipeline";
import { EDIT_LIMITS, EditResponseSchema, type EditPlan, type EditResponse } from "./conversational-edit-contract.js";
import type { ConversationalEditService } from "./conversational-edit-service.js";
import type { LongFormProjectService } from "./long-form-project-service.js";
import { ConnectedGameInputs, connectedGameMutations, type ConnectedGameService, type ConnectedGameTool } from "./connected-game-service.js";
import { ConnectedAssetInputs, type AssetLibraryService, type ConnectedAssetTool } from "./asset-library-service.js";

const id = z.string().min(1).max(240), digest = z.string().regex(/^[a-f0-9]{64}$/);
const project = { projectId: id }, operation = { ...project, operationId: z.string().uuid() };
const selection = { ...project, proposalId: id, groupIds: z.array(id).min(1).max(EDIT_LIMITS.groups) };
const foundation = { ...project, artifactId: z.enum(planningArtifactIds) };
export const ConnectedEditInputs = {
  ...ConnectedAssetInputs,
  ...ConnectedGameInputs,
  list_projects: z.object({}).strict(),
  create_project: z.object({ ...operation, projectId: z.string().uuid(), name: z.string().trim().min(1).max(200), approved: z.literal(true) }).strict(),
  initialize_foundation: z.object({ ...operation, artifactId: z.enum(["bible", "routes", "endings", "mechanics"]), headFingerprint: digest, approved: z.literal(true) }).strict(),
  read_foundation: z.object({ ...foundation, sectionId: id.default("root") }).strict(),
  review_foundation_approval: z.object({ ...foundation, versionId: id }).strict(),
  approve_foundation: z.object({ ...operation, ...foundation, versionId: id, fingerprint: digest, approved: z.literal(true) }).strict(),
  project_state: z.object(project).strict(),
  list_edit_targets: z.object({ ...project, search: z.string().max(300).default(""), offset: z.number().int().min(0).max(50000).default(0) }).strict(),
  list_edits: z.object({ ...project, offset: z.number().int().min(0).max(50000).default(0) }).strict(),
  prepare_edit: z.object({ ...operation, message: z.string().trim().min(1).max(6000), headFingerprint: digest,
    targets: z.array(z.object({ key: id, versionId: id }).strict()).min(1).max(EDIT_LIMITS.targets) }).strict(),
  submit_edit: z.object({ ...operation, planId: id, fingerprint: digest, response: EditResponseSchema }).strict(),
  get_edit: z.object({ ...project, proposalId: id }).strict(),
  review_edit: z.object(selection).strict(),
  apply_edit: z.object({ ...operation, ...selection, fingerprint: digest, approved: z.literal(true) }).strict(),
  reject_edit: z.object({ ...operation, proposalId: id }).strict(),
};
export type ConnectedEditTool = keyof typeof ConnectedEditInputs;
export const CONNECTED_RESULT_BYTES = 256_000;
export function boundedConnectedResult<T>(value: T): T {
  if (Buffer.byteLength(sourceCanonicalJson(value)) > CONNECTED_RESULT_BYTES) throw new Error("connected_result_overflow_narrow_scope");
  return value;
}

export class ConnectedEditService {
  private readonly conversations: ConversationRepository;
  private readonly projects: ProjectRepository;
  constructor(private readonly database: StoryDatabase, private readonly edits: ConversationalEditService, private readonly projectIds: readonly string[],
    private readonly longForm: LongFormProjectService, private readonly allowProjectCreation = false, private readonly game?: ConnectedGameService, private readonly assets?: AssetLibraryService) {
    this.conversations = new ConversationRepository(database); this.projects = new ProjectRepository(database);
  }
  private access(projectId: string, allowMissing = false) {
    if (!this.projectIds.includes(projectId)) throw new Error("connected_project_access_denied");
    const project = this.projects.get(projectId);
    if (!project && allowMissing) return;
    if (!project || project.archived || project.mode !== "long-form") throw new Error("connected_project_unavailable");
  }
  private approvalReview(input: z.infer<typeof ConnectedEditInputs.review_foundation_approval>) {
    const current = new ArtifactRepository(this.database).getCurrent(input.projectId, input.artifactId);
    if (!current || current.id !== input.versionId || current.stale) throw new Error("connected_approval_requires_fresh_current_version_revise_first");
    const review = this.longForm.reviewArtifactApproval(input.projectId, input.artifactId, input.versionId);
    const state = this.edits.connectedState(input.projectId);
    this.assertCurrentPrerequisites(input.projectId, input.artifactId);
    const result = { ...review, headFingerprint: state.headFingerprint, providerCalls: 0 };
    return boundedConnectedResult({ ...result, fingerprint: sourceDigest(result) });
  }
  private assertCurrentPrerequisites(projectId: string, artifactId: PlanningArtifactId) {
    const state = this.edits.connectedState(projectId), artifacts = new ArtifactRepository(this.database);
    if (this.longForm.approvalPrerequisites(artifactId).some((id) => {
      const entry = state.workflow.find((item) => item.artifactId === id)!;
      return entry.workflow.status !== "approved" || entry.workflow.approvedVersionId !== entry.currentVersionId || artifacts.getCurrent(projectId, id)?.stale;
    })) throw new Error("connected_approval_prerequisite_not_current");
  }
  private assertReceipt(tool: ConnectedEditTool, input: unknown, result: unknown) {
    if (tool in ConnectedGameInputs) {
      if (!this.game) throw new Error("connected_game_unavailable");
      return this.game.assertReceipt(tool as ConnectedGameTool, input, result);
    }
    const equal = (a: unknown, b: unknown) => sourceCanonicalJson(a) === sourceCanonicalJson(b);
    const r = result as { plan: EditPlan; proposalId: string; conversationId: string; applicationId: string; status: string; provenance: string; providerCalls: number; resultingVersions: Record<string, string> };
    if (tool === "create_project") {
      const i = ConnectedEditInputs.create_project.parse(input), saved = result as { project: { id: string; name: string; mode: string }; briefVersionId: string; creativeDirectionVersionId: string; providerCalls: number };
      const artifacts = new ArtifactRepository(this.database), brief = artifacts.getVersion<{ workingTitle: string; sourceMode: string }>(saved.briefVersionId), direction = artifacts.getVersion(saved.creativeDirectionVersionId);
      if (saved.project.id !== i.projectId || saved.project.name !== i.name || saved.project.mode !== "long-form" || saved.providerCalls !== 0
        || brief?.projectId !== i.projectId || brief.artifactId !== "brief" || brief.version !== 1 || brief.content.workingTitle !== i.name || brief.content.sourceMode !== "original-premise"
        || direction?.projectId !== i.projectId || direction.artifactId !== "creative-direction" || direction.version !== 1) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "initialize_foundation") {
      const i = ConnectedEditInputs.initialize_foundation.parse(input), saved = result as { artifactId: string; versionId: string; providerCalls: number };
      const version = new ArtifactRepository(this.database).getVersion(saved.versionId);
      if (saved.artifactId !== i.artifactId || saved.providerCalls !== 0 || version?.projectId !== i.projectId || version.artifactId !== i.artifactId || version.version !== 1) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "approve_foundation") {
      const i = ConnectedEditInputs.approve_foundation.parse(input), saved = result as { artifactId: string; versionId: string; fingerprint: string; status: string; providerCalls: number };
      const approved = this.database.prepare("SELECT 1 FROM artifact_version_approvals WHERE project_id=? AND artifact_id=? AND version_id=?").get(i.projectId, i.artifactId, i.versionId);
      if (!approved || saved.artifactId !== i.artifactId || saved.versionId !== i.versionId || saved.fingerprint !== i.fingerprint || saved.status !== "approved" || saved.providerCalls !== 0) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "prepare_edit") {
      const i = ConnectedEditInputs.prepare_edit.parse(input), plan = this.edits.connectedPlan(i.projectId, r.plan?.id);
      if (!equal(plan, r.plan) || plan.request.providerId !== "connected-assistant" || plan.request.message !== i.message || plan.headFingerprint !== i.headFingerprint
        || !equal(plan.targets.map(({ key, versionId }) => ({ key, versionId })), i.targets)) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "submit_edit") {
      const i = ConnectedEditInputs.submit_edit.parse(input), record = this.edits.proposal(i.projectId, r.proposalId);
      const edit = record.proposal as { plan: EditPlan; response: EditResponse; generatedIds: Record<string, string> };
      const remap = (v: unknown): unknown => typeof v === "string" ? edit.generatedIds[v] ?? v : Array.isArray(v) ? v.map(remap)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, child]) => [k, remap(child)])) : v;
      if (edit.plan.id !== i.planId || edit.plan.fingerprint !== i.fingerprint || !equal(edit.response, remap(i.response))
        || r.conversationId !== record.conversationId || r.status !== "proposed" || r.provenance !== "connected-assistant" || r.providerCalls !== 0) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "apply_edit") {
      const i = ConnectedEditInputs.apply_edit.parse(input), record = this.edits.proposal(i.projectId, i.proposalId);
      const audit = new ArtifactRepository(this.database).getVersion<{ proposalId: string; previewFingerprint: string; selectedGroupIds: string[]; resultingVersions: Record<string, string> }>(record.appliedVersionId ?? "");
      if (record.status !== "applied" || !audit || audit.projectId !== i.projectId || audit.id !== r.applicationId
        || audit.content.proposalId !== i.proposalId || audit.content.previewFingerprint !== i.fingerprint || !equal(audit.content.selectedGroupIds, i.groupIds)
        || !equal(audit.content.resultingVersions, r.resultingVersions) || r.proposalId !== i.proposalId || r.status !== "applied" || r.providerCalls !== 0) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "reject_edit") {
      const i = ConnectedEditInputs.reject_edit.parse(input);
      if (r.proposalId !== i.proposalId || r.status !== "rejected" || this.edits.proposal(i.projectId, i.proposalId).status !== "rejected") throw new Error("connected_receipt_lineage_invalid");
    }
  }
  // The receipt and the shared mutation commit together. Conversation metadata travels with full backups,
  // but disappears with private conversation history in redacted exports. It never enters author memory.
  private once<T>(projectId: string, operationId: string, tool: ConnectedEditTool, input: unknown, run: () => T, allowMissing = false): T {
    return transaction(this.database, () => {
      this.access(projectId, allowMissing);
      const fingerprint = sourceDigest({ tool, input });
      const row = this.database.prepare(`SELECT m.metadata_json FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.project_id=? AND (json_extract(m.metadata_json,'$.connectedOperation.operationId')=? OR json_extract(m.metadata_json,'$.assetOperation.operationId')=?) LIMIT 1`).get(projectId, operationId, operationId) as { metadata_json: string } | undefined;
      if (row) {
        const saved = JSON.parse(row.metadata_json).connectedOperation;
        if (!saved || saved.fingerprint !== fingerprint || saved.tool !== tool) throw new Error("connected_operation_id_conflict");
        this.assertReceipt(tool, input, saved.result);
        return boundedConnectedResult(saved.result as T);
      }
      const result = boundedConnectedResult(run());
      const scope = { kind: "project" as const, projectId };
      const conversation = this.conversations.list(projectId).find((c) => c.title === "Connected editing operations")
        ?? this.conversations.create(projectId, scope, "Connected editing operations");
      this.conversations.addMessage({ conversationId: conversation.id, role: "assistant", intent: "discuss", scope, context: {},
        content: `${tool} completed`, metadata: { connectedOperation: { operationId, tool, fingerprint, result } } });
      return result;
    });
  }
  call(tool: ConnectedEditTool, value: unknown): unknown {
    const input = ConnectedEditInputs[tool].parse(value);
    if (tool === "list_projects") return { projects: this.projectIds.flatMap((id) => {
      const p = this.projects.get(id); return p && !p.archived && p.mode === "long-form" ? [{ id: p.id, name: p.name, mode: p.mode }] : [];
    }), ...(this.allowProjectCreation ? { creationSlots: this.projectIds.filter((id) => !this.projects.get(id)) } : {}) };
    if (!("projectId" in input) || typeof input.projectId !== "string") throw new Error("connected_project_required");
    if (tool === "create_project") {
      if (!this.allowProjectCreation) throw new Error("connected_project_creation_disabled");
      const i = ConnectedEditInputs.create_project.parse(input);
      return this.once(i.projectId, i.operationId, tool, i, () => {
        if (this.projects.get(i.projectId)) throw new Error("connected_project_slot_occupied");
        const created = this.longForm.createProject(i.name, "original-premise", { projectId: i.projectId, inTransaction: true });
        return { project: created.project, briefVersionId: created.brief.id, creativeDirectionVersionId: created.creativeDirection.id, providerCalls: 0 };
      }, true);
    }
    const projectId = input.projectId; this.access(projectId);
    if (tool in ConnectedAssetInputs) {
      if (!this.assets) throw new Error("connected_assets_unavailable");
      return this.assets.call(tool as ConnectedAssetTool, input).then(boundedConnectedResult);
    }
    if (tool in ConnectedGameInputs) {
      if (!this.game) throw new Error("connected_game_unavailable");
      const name = tool as ConnectedGameTool;
      return connectedGameMutations.has(name) && "operationId" in input && typeof input.operationId === "string"
        ? this.once(projectId, input.operationId, tool, input, () => this.game!.call(name, input))
        : boundedConnectedResult(this.game.call(name, input));
    }
    // Parse each concrete schema again for static narrowing as well as a closed public operation contract.
    switch (tool) {
      case "initialize_foundation": {
        const i = ConnectedEditInputs.initialize_foundation.parse(input);
        return this.once(projectId, i.operationId, tool, i, () => {
          if (this.edits.connectedState(projectId).headFingerprint !== i.headFingerprint) throw new Error("edit_base_stale_repreview");
          this.assertCurrentPrerequisites(projectId, i.artifactId);
          const created = this.longForm.createArtifact(projectId, i.artifactId, { inTransaction: true });
          return { artifactId: i.artifactId, versionId: created.artifact.id, status: "draft", providerCalls: 0 };
        });
      }
      case "read_foundation": {
        const i = ConnectedEditInputs.read_foundation.parse(input), current = new ArtifactRepository(this.database).getCurrent<PlanningArtifact>(projectId, i.artifactId);
        if (!current) throw new Error("connected_foundation_missing_initialize_first");
        const section = planningSection(current.content, i.sectionId);
        if (Buffer.byteLength(sourceCanonicalJson(section)) > EDIT_LIMITS.contextBytes) throw new Error("connected_context_overflow_narrow_section");
        return { artifactId: i.artifactId, versionId: current.id, stale: current.stale, ...section, headFingerprint: this.edits.connectedState(projectId).headFingerprint };
      }
      case "review_foundation_approval": return this.approvalReview(ConnectedEditInputs.review_foundation_approval.parse(input));
      case "approve_foundation": {
        const i = ConnectedEditInputs.approve_foundation.parse(input);
        return this.once(projectId, i.operationId, tool, i, () => {
          const review = this.approvalReview(i);
          if (review.fingerprint !== i.fingerprint) throw new Error("connected_approval_review_stale_repreview");
          this.longForm.approveArtifact(projectId, i.artifactId, i.versionId, { inTransaction: true });
          return { artifactId: i.artifactId, versionId: i.versionId, fingerprint: i.fingerprint, status: "approved", providerCalls: 0 };
        });
      }
      case "project_state": return this.edits.connectedState(projectId);
      case "list_edit_targets": { const i = ConnectedEditInputs.list_edit_targets.parse(input); return this.edits.catalogue(projectId, i.search, i.offset); }
      case "list_edits": {
        const i = ConnectedEditInputs.list_edits.parse(input);
        const total = this.database.prepare("SELECT COUNT(*) total FROM change_sets WHERE project_id=? AND json_extract(proposal_json,'$.kind')='conversational-edit-v1'").get(projectId) as { total: number };
        const items = this.database.prepare(`SELECT id,status,substr(summary,1,300) summary,created_at AS createdAt,
          json_extract(proposal_json,'$.plan.request.providerId') AS provenance FROM change_sets
          WHERE project_id=? AND json_extract(proposal_json,'$.kind')='conversational-edit-v1' ORDER BY created_at DESC,rowid DESC LIMIT 50 OFFSET ?`).all(projectId, i.offset);
        return { total: total.total, offset: i.offset, items };
      }
      case "prepare_edit": {
        const i = ConnectedEditInputs.prepare_edit.parse(input);
        return this.once(projectId, i.operationId, tool, i, () => {
          if (this.edits.connectedState(projectId).headFingerprint !== i.headFingerprint) throw new Error("edit_base_stale_repreview");
          const preview = this.edits.previewInTransaction(projectId, { message: i.message, targetKeys: i.targets.map((t) => t.key), providerId: "connected-assistant", modelId: "assistant-authored" });
          if (preview.status !== "ready") throw new Error(`connected_${preview.status}_use_browser_workflow`);
          if (preview.plan.targets.some((t, n) => t.versionId !== i.targets[n]!.versionId)) throw new Error("edit_target_version_stale_repreview");
          return preview;
        });
      }
      case "submit_edit": {
        const i = ConnectedEditInputs.submit_edit.parse(input);
        return this.once(projectId, i.operationId, tool, i, () => {
          const result = this.edits.submitExternalInTransaction(projectId, i.planId, i.fingerprint, i.response);
          return { proposalId: result.proposal!.id, conversationId: result.proposal!.conversationId, status: "proposed", provenance: "connected-assistant", providerCalls: 0 };
        });
      }
      case "get_edit": { const i = ConnectedEditInputs.get_edit.parse(input); return boundedConnectedResult(this.edits.proposal(projectId, i.proposalId)); }
      case "review_edit": { const i = ConnectedEditInputs.review_edit.parse(input); return boundedConnectedResult(this.edits.review(projectId, i.proposalId, i.groupIds)); }
      case "apply_edit": {
        const i = ConnectedEditInputs.apply_edit.parse(input);
        return this.once(projectId, i.operationId, tool, i, () => {
          const result = this.edits.applyInTransaction(projectId, i.proposalId, i.groupIds, i.fingerprint);
          return { proposalId: i.proposalId, applicationId: result.application.id, resultingVersions: result.resultingVersions, status: "applied", providerCalls: 0 };
        });
      }
      case "reject_edit": { const i = ConnectedEditInputs.reject_edit.parse(input); return this.once(projectId, i.operationId, tool, i, () => {
        this.edits.reject(projectId, i.proposalId); return { proposalId: i.proposalId, status: "rejected", providerCalls: 0 };
      }); }
    }
  }
}
