import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";

export interface JobRecord {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  checkpoint?: unknown;
}

type JobRow = { id: string; project_id: string; kind: string; status: string; checkpoint_json: string | null };

export class JobRepository {
  constructor(private readonly database: StoryDatabase) {}

  create(projectId: string, kind: string): JobRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO jobs (id, project_id, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, projectId, kind, now, now);
    return this.get(id)!;
  }

  get(id: string): JobRecord | undefined {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? {
      id: row.id, projectId: row.project_id, kind: row.kind, status: row.status,
      checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : undefined,
    } : undefined;
  }

  checkpoint(id: string, checkpoint: unknown, status = "running"): JobRecord {
    const result = this.database.prepare(`
      UPDATE jobs SET checkpoint_json = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(checkpoint), status, new Date().toISOString(), id);
    if (!result.changes) throw new Error("Job not found");
    return this.get(id)!;
  }

  checkpointUnit(jobId: string, unitKey: string, checkpoint: unknown, status = "completed"): void {
    this.database.prepare(`
      INSERT INTO job_units (id, job_id, unit_key, status, checkpoint_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_id, unit_key) DO UPDATE SET status = excluded.status, checkpoint_json = excluded.checkpoint_json
    `).run(randomUUID(), jobId, unitKey, status, JSON.stringify(checkpoint));
  }

  recordUsage(jobId: string, usage: { promptTokens: number; completionTokens: number; cost: number }): void {
    this.database.prepare(`
      INSERT INTO usage_records (id, job_id, prompt_tokens, completion_tokens, cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), jobId, usage.promptTokens, usage.completionTokens, usage.cost, new Date().toISOString());
  }

  usageTotals(jobId: string): { promptTokens: number; completionTokens: number; cost: number } {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(cost), 0) AS cost
      FROM usage_records WHERE job_id = ?
    `).get(jobId) as { promptTokens: number; completionTokens: number; cost: number };
    return row;
  }
}
