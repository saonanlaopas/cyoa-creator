import type { JobRecord, JobRepository } from "@story-to-cyoa/persistence";
export interface JobUnit { key: string; run(signal: AbortSignal): Promise<{ usage?: { promptTokens: number; completionTokens: number; cost: number }; checkpoint?: unknown }> }
export interface JobEvent { jobId: string; status: string; completed: number; total: number; unitKey?: string }
export class JobRunner {
  private listeners = new Set<(event: JobEvent) => void>(); private controllers = new Map<string, AbortController>();
  constructor(private readonly jobs: JobRepository) {}
  enqueue(projectId: string, kind: string): string { return this.jobs.create(projectId, kind).id; }
  get(id: string): JobRecord | undefined { return this.jobs.get(id); }
  subscribe(listener: (event: JobEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  cancel(id: string): JobRecord { this.controllers.get(id)?.abort(); return this.jobs.checkpoint(id, this.jobs.get(id)?.checkpoint ?? {}, "cancelled"); }
  async run(id: string, units: JobUnit[]): Promise<JobRecord> { const prior = (this.jobs.get(id)?.checkpoint as { completed?: string[] } | undefined)?.completed ?? []; const completed = new Set(prior); const controller = new AbortController(); this.controllers.set(id, controller); this.jobs.checkpoint(id, { completed: [...completed] }, "running"); try { for (const unit of units) { if (completed.has(unit.key)) continue; if (controller.signal.aborted) break; const value = await unit.run(controller.signal); if (controller.signal.aborted) break; completed.add(unit.key); this.jobs.checkpointUnit(id, unit.key, value.checkpoint ?? {}, "completed"); if (value.usage) this.jobs.recordUsage(id, value.usage); this.jobs.checkpoint(id, { completed: [...completed] }, "running"); this.emit({ jobId: id, status: "running", completed: completed.size, total: units.length, unitKey: unit.key }); } const status = controller.signal.aborted ? "cancelled" : "completed"; const record = this.jobs.checkpoint(id, { completed: [...completed] }, status); this.emit({ jobId: id, status, completed: completed.size, total: units.length }); return record; } finally { this.controllers.delete(id); } }
  private emit(event: JobEvent): void { for (const listener of this.listeners) listener(event); }
}
