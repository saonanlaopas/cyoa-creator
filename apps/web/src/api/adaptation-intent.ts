import type { AdaptationIntent, AdaptationProposal, AdaptationSuggestion, SourceRecord } from "@story-to-cyoa/domain";
export type IntentCollection = "overrides" | "inventions" | "obligations" | "exceptions" | "expansion";
export type IntentPolicy = Omit<AdaptationIntent, IntentCollection>;
export interface IntentState {
  current: { id: string; version: number; stale: boolean; policy: IntentPolicy; counts: Record<IntentCollection, number>;
    reconciliation: { planned: number | null; target: number | null; difference: number | null; status: string } } | null;
  approvedDossier: AdaptationIntent["binding"] | null;
  workflow: { status: string; approvedVersionId: string | null };
  legacyProjection: { briefVersionId: string; value: string; dimensions: AdaptationIntent["dimensions"]; adopted: boolean } | null;
}
export interface IntentPreview { id: string; fingerprint: string; baseVersionId: string | null; precondition: string; binding: AdaptationIntent["binding"];
  providerId: string; modelId: string; promptVersion: string; schemaVersion: number; records: Array<{ id: string; claim: string; classification: string }>;
  budget: AdaptationIntent["budget"]; bytes: number; estimatedInputTokens: number; cost: number | null; costStatus: string }
export interface IntentProposal { versionId: string; operations: AdaptationSuggestion["operations"]; status: string; reconciliation: { status: string } }
export interface IntentHistory { id: string; version: number; revision: AdaptationIntent["revision"]; materialFingerprint: string; provenanceFingerprint: string }
export class AdaptationIntentApi {
  readonly root: string;
  constructor(projectId: string) { this.root = `/api/long-form/projects/${encodeURIComponent(projectId)}/adaptation-intent`; }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.root + path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) { const error = await response.json() as { error: string; code: string; conflicts?: Array<{ id: string; overrideIds: string[] }> }; throw Object.assign(new Error(error.error), { code: error.code, conflicts: error.conflicts }); }
    return response.json() as Promise<T>;
  }
  state() { return this.request<IntentState>(""); }
  collection(collection: IntentCollection, offset: number, search: string) { return this.request<{ total: number; items: Array<AdaptationIntent[IntentCollection][number]> }>(`/collections/${collection}?offset=${offset}&search=${encodeURIComponent(search)}`); }
  edit(value: unknown) { return this.request<IntentState>("/edit", value); }
  history(offset: number) { return this.request<{ total: number; items: IntentHistory[] }>(`/history?offset=${offset}`); }
  preview(input: AdaptationProposal["input"]) { return this.request<IntentPreview>("/preview", input); }
}
export type IntentSourceRecord = SourceRecord;
