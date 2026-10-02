import type { SourceEvidence, SourceRecord, SourceDossier, SourceCorrectionOperation } from "@story-to-cyoa/domain";

export interface SourceMetadata {
  sourceVersionId: string | null; sourceFingerprint?: string; metadata?: { title?: string; sourceFormat: string };
  chapterCount: number; chapters: Array<{ id: string; title: string; order: number; blockCount: number; characters: number }>;
  scope: { versionId: string; chapterIds: string[]; sourceVersionId?: string } | null;
}
export interface SourcePreview {
  id: string; fingerprint: string; sourceCharacters: number; sourceBytes: number; selectedChapters: number;
  unitCount: number; maxUnitCharacters: number; estimatedInputTokens: number; tokenEstimate: string;
  maximumOutputTokensPerUnit: number; providerId: string; modelId: string; cost: number | null; costStatus: string;
}
export interface AnalysisJob {
  id: string; planId: string; status: string; executing: boolean; unitCount: number; dossierVersionId: string | null;
  counts: Record<string, number>; units: Array<{ id: string; status: string; attempts: Array<{ number: number; status: string; diagnostic: string; repairCount: number; usage: { cost: number | null; inputTokens: number; outputTokens: number } }> }>;
}
export interface DossierMetadata {
  id: string; version: number; stale: boolean; materialFingerprint: string; recordCount: number; conflictCount: number; correctionCount: number;
  categories: Record<string, number>; workflow: { status: string; approvedVersionId: string | null };
}
export type RecordSummary = Omit<SourceRecord, "evidence" | "observationIds"> & { evidenceCount: number; observationCount: number };
export type RecordDetails = SourceRecord & { evidenceCount: number; originals: SourceDossier["provenance"]; conflicts: SourceDossier["conflicts"]; corrections: SourceDossier["corrections"] };
export class SourceAnalysisApi {
  readonly root: string;
  constructor(readonly projectId: string) { this.root = `/api/long-form/projects/${encodeURIComponent(projectId)}/source-analysis`; }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.root}${path}`, { method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) {
      const error = await response.json() as { error?: string; code?: string };
      throw Object.assign(new Error(error.error ?? "Source analysis request failed"), { code: error.code, status: response.status });
    }
    return response.json() as Promise<T>;
  }
  source(offset = 0) { return this.request<SourceMetadata>(`/source?offset=${offset}`); }
  scope(value: { entireWork: true } | { chapterIds: string[] }) { return this.request<{ versionId: string; chapterIds: string[] }>("/scope", value); }
  preview(providerId: string, modelId: string) { return this.request<SourcePreview>("/preview", { providerId, modelId }); }
  start(preview: SourcePreview) { return this.request<AnalysisJob>(`/plans/${preview.id}/start`, { fingerprint: preview.fingerprint }); }
  job(id: string, offset = 0) { return this.request<AnalysisJob>(`/jobs/${id}?offset=${offset}`); }
  jobs() { return this.request<{ items: Array<{ id: string; status: string; executing: boolean; unitCount: number; completedUnits: number }> }>("/jobs"); }
  action(id: string, action: "resume" | "cancel") { return this.request<AnalysisJob>(`/jobs/${id}/${action}`, {}); }
  dossier() { return this.request<DossierMetadata>("/dossier"); }
  records(query: { category: string; search: string; conflictsOnly: boolean; offset: number }) {
    const params = new URLSearchParams({ category: query.category, search: query.search, conflictsOnly: String(query.conflictsOnly), offset: String(query.offset) });
    return this.request<{ total: number; items: RecordSummary[] }>(`/records?${params}`);
  }
  record(id: string, offset = 0) { return this.request<RecordDetails>(`/records/${id}?offset=${offset}&limit=20`); }
  evidence(value: SourceEvidence) { return this.request<{ reference: SourceEvidence; text: string }>("/evidence", value); }
  correct(operation: SourceCorrectionOperation) { return this.request<DossierMetadata>("/corrections", operation); }
  approve(versionId: string) { return this.request("/approve", { versionId }); }
}
