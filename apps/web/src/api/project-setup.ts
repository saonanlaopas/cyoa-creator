import type { ConversationRecord, MessageRecord, ProjectRecord } from "./long-form.js";

export interface SetupChange {
  path: string; label: string; before: unknown; after: unknown;
  basis: "stated" | "inferred"; messageIds: string[]; excerpt: string;
}
export interface SetupGroup {
  id: string; artifactId: string; label: string; summary: string; dependsOnGroupIds: string[];
  candidate: unknown; changes: SetupChange[];
}
export interface SetupProposal {
  id: string; status: "proposed" | "applied" | "rejected" | "superseded"; summary: string;
  groups: SetupGroup[]; validationFindings: Array<{ severity: string; message: string }>;
}
export interface SetupSession {
  conversation: ConversationRecord; messages: MessageRecord[]; messageCount: number; messagesTruncated: boolean;
  understanding: {
    stale?: boolean;
    readiness: "needs-input" | "ready-to-propose";
    understanding: { summary: string; items: Array<{ id: string; statement: string; basis: string; excerpt: string }>;
      unresolved: Array<{ id: string; note: string }> };
    questions: Array<{ id: string; question: string; why: string }>;
  } | null;
  proposals: SetupProposal[];
}
export interface SetupPreview {
  contextFingerprint: string; provider: { model: string }; ready: boolean; withinLimits: boolean; generatesProse: false;
  diagnostics: { serializedBytes: number; estimatedInputTokens: number; maximumOutputTokens?: number; [key: string]: unknown };
}
const base = (projectId: string, conversationId?: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/setup/sessions${conversationId ? `/${encodeURIComponent(conversationId)}` : ""}`;
async function request<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, ...(body === undefined ? {} : {
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ...(signal ? { signal } : {}) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Studio request failed");
  return result;
}
export const createSetupProject = (name?: string) => request<{ project: ProjectRecord }>("/api/long-form/setup-projects", "POST", { name });
export const startSetupSession = (projectId: string) => request<ConversationRecord>(base(projectId), "POST");
export const loadSetupSession = (projectId: string, conversationId: string) => request<SetupSession>(base(projectId, conversationId));
export const saveSetupMessage = (projectId: string, conversationId: string, content: string) => request(base(projectId, conversationId) + "/messages", "POST", { content });
export const askSetup = (projectId: string, conversationId: string, model: string, signal: AbortSignal) => request(base(projectId, conversationId) + "/ask", "POST", { model }, signal);
export const previewSetup = (projectId: string, conversationId: string, model: string) => request<SetupPreview>(base(projectId, conversationId) + "/proposal-preview", "POST", { model });
export const draftSetup = (projectId: string, conversationId: string, preview: SetupPreview, signal: AbortSignal) => request(base(projectId, conversationId) + "/proposals", "POST", { model: preview.provider.model, expectedContextFingerprint: preview.contextFingerprint }, signal);
export const applySetup = (projectId: string, conversationId: string, proposalId: string, groupIds: string[]) => request(base(projectId, conversationId) + `/proposals/${encodeURIComponent(proposalId)}/apply`, "POST", { groupIds });
export const rejectSetup = (projectId: string, conversationId: string, proposalId: string) => request(base(projectId, conversationId) + `/proposals/${encodeURIComponent(proposalId)}/reject`, "POST");
export const reviseSetup = (projectId: string, conversationId: string, proposalId: string, edits: Array<{ groupId: string; path: string; value: unknown }>) => request(base(projectId, conversationId) + `/proposals/${encodeURIComponent(proposalId)}/revise`, "POST", { edits });
