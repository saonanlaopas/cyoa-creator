import { z } from "zod";
import { sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { ArtifactRepository, ConversationRepository, ProjectRepository, transaction, type StoryDatabase } from "@story-to-cyoa/persistence";
import { EDIT_LIMITS, EditResponseSchema, type EditPlan, type EditResponse } from "./conversational-edit-contract.js";
import type { ConversationalEditService } from "./conversational-edit-service.js";

const id = z.string().min(1).max(240), digest = z.string().regex(/^[a-f0-9]{64}$/);
const project = { projectId: id }, operation = { ...project, operationId: z.string().uuid() };
const selection = { ...project, proposalId: id, groupIds: z.array(id).min(1).max(EDIT_LIMITS.groups) };
export const ConnectedEditInputs = {
  list_projects: z.object({}).strict(),
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
  constructor(private readonly database: StoryDatabase, private readonly edits: ConversationalEditService, private readonly projectIds: readonly string[]) {
    this.conversations = new ConversationRepository(database); this.projects = new ProjectRepository(database);
  }
  private access(projectId: string) {
    if (!this.projectIds.includes(projectId)) throw new Error("connected_project_access_denied");
    const project = this.projects.get(projectId);
    if (!project || project.archived || project.mode !== "long-form") throw new Error("connected_project_unavailable");
  }
  private assertReceipt(tool: ConnectedEditTool, input: unknown, result: unknown) {
    const equal = (a: unknown, b: unknown) => sourceCanonicalJson(a) === sourceCanonicalJson(b);
    const r = result as { plan: EditPlan; proposalId: string; conversationId: string; applicationId: string; status: string; provenance: string; providerCalls: number; resultingVersions: Record<string, string> };
    if (tool === "prepare_edit") {
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
  private once<T>(projectId: string, operationId: string, tool: ConnectedEditTool, input: unknown, run: () => T): T {
    return transaction(this.database, () => {
      this.access(projectId);
      const fingerprint = sourceDigest({ tool, input });
      const row = this.database.prepare(`SELECT m.metadata_json FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.project_id=? AND json_extract(m.metadata_json,'$.connectedOperation.operationId')=? LIMIT 1`).get(projectId, operationId) as { metadata_json: string } | undefined;
      if (row) {
        const saved = JSON.parse(row.metadata_json).connectedOperation;
        if (saved.fingerprint !== fingerprint || saved.tool !== tool) throw new Error("connected_operation_id_conflict");
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
    }) };
    if (!("projectId" in input) || typeof input.projectId !== "string") throw new Error("connected_project_required");
    const projectId = input.projectId; this.access(projectId);
    // Parse each concrete schema again for static narrowing as well as a closed public operation contract.
    switch (tool) {
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
