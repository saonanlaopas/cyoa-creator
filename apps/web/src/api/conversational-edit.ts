export interface EditTarget { key: string; owner: string; targetId: string; label: string; path: string; versionId: string }
export interface EditPlan { id: string; conversationId: string; fingerprint: string; contextBytes: number; targets: EditTarget[] }
export type EditPreview = { status: "ready"; plan: EditPlan; impact: string[]; estimatedInputTokens: number; cost: number | null }
  | { status: "clarification"; question: string; candidates: EditTarget[] }
  | { status: "draft-workflow"; passageId: string | null };
export interface EditGroup { id: string; label: string; explanation: string; dependsOnGroupIds: string[]; operations: Array<{ targetKey: string; kind: string }> }
export interface EditProposal { id: string; status: string; summary: string; proposal: { response: { groups: EditGroup[] }; plan: EditPlan; generatedIds: Record<string, string> } }
export interface EditReview {
  fingerprint: string; selectedGroupIds: string[]; requiredGroupIds: string[]; wouldStale: string[]; protectedProse: string;
  outputs: Array<{ owner: string; targetId: string; before: unknown; after: unknown }>;
  findings: Array<{ code: string; severity: string; message: string; entityId?: string; entityType?: string; artifactId?: string; evidence?: string[] }>;
  draftImpacts: Array<{ passageId: string; reasonCode: string; changedFields: string[] }>;
  evidence: { request: string; messageId: string; sourceRecords: Array<{ record: { id: string; claim: string }; excerpts: Array<{ text: string }> }> }; generatedIds: Record<string, string>;
  validation: { totalFindings: number; omittedFindings: number };
}
export interface EditHistory { messages: Array<{ id: string; role: string; content: string }>; proposals: Array<Pick<EditProposal, "id" | "status" | "summary">> }
export class ConversationalEditApi {
  readonly root: string;
  constructor(projectId: string) { this.root = `/api/long-form/projects/${encodeURIComponent(projectId)}/editing`; }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.root + path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error((await response.json() as { error: string }).error);
    return response.json() as Promise<T>;
  }
  targets(search: string, offset: number) { return this.request<{ total: number; offset: number; items: EditTarget[] }>(`/targets?search=${encodeURIComponent(search)}&offset=${offset}`); }
  conversations() { return this.request<Array<{ id: string; title: string }>>("/conversations"); }
  history(id: string) { return this.request<EditHistory>(`/conversations/${encodeURIComponent(id)}`); }
  proposal(id: string) { return this.request<EditProposal>(`/proposals/${encodeURIComponent(id)}`); }
  preview(body: { message: string; targetKeys: string[]; intent: string; providerId: string; modelId: string; conversationId?: string }) { return this.request<EditPreview>("/preview", body); }
  generate(plan: EditPlan) { return this.request<{ message: string; proposal: EditProposal | null }>(`/plans/${encodeURIComponent(plan.id)}/generate`, { fingerprint: plan.fingerprint }); }
  cancel(plan: EditPlan) { return this.request(`/plans/${encodeURIComponent(plan.id)}/cancel`, {}); }
  review(id: string, groupIds: string[]) { return this.request<EditReview>(`/proposals/${encodeURIComponent(id)}/review`, { groupIds }); }
  apply(id: string, groupIds: string[], fingerprint: string) { return this.request(`/proposals/${encodeURIComponent(id)}/apply`, { groupIds, fingerprint }); }
  reject(id: string) { return this.request(`/proposals/${encodeURIComponent(id)}/reject`, {}); }
}
