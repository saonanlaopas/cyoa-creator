import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export type ArtifactWorkflowStatus = "empty" | "draft" | "reviewed" | "approved" | "stale";

export interface ArtifactWorkflowState {
  projectId: string;
  artifactId: string;
  status: ArtifactWorkflowStatus;
  approvedVersionId: string | null;
  updatedAt: string;
}

type WorkflowRow = {
  project_id: string;
  artifact_id: string;
  status: ArtifactWorkflowStatus;
  approved_version_id: string | null;
  updated_at: string;
};

const mapWorkflow = (row: WorkflowRow): ArtifactWorkflowState => ({
  projectId: row.project_id,
  artifactId: row.artifact_id,
  status: row.status,
  approvedVersionId: row.approved_version_id,
  updatedAt: row.updated_at,
});

export class WorkflowRepository {
  public constructor(private readonly database: StoryDatabase) {}

  get(projectId: string, artifactId: string): ArtifactWorkflowState {
    const row = this.database.prepare(`
      SELECT * FROM artifact_workflow_state WHERE project_id = ? AND artifact_id = ?
    `).get(projectId, artifactId) as WorkflowRow | undefined;
    return row ? mapWorkflow(row) : {
      projectId,
      artifactId,
      status: "empty",
      approvedVersionId: null,
      updatedAt: "",
    };
  }

  markDraft(projectId: string, artifactId: string): ArtifactWorkflowState {
    return this.set(projectId, artifactId, "draft");
  }

  markStale(projectId: string, artifactId: string): ArtifactWorkflowState {
    return this.set(projectId, artifactId, "stale");
  }

  approve(projectId: string, artifactId: string, versionId: string): ArtifactWorkflowState {
    return transaction(this.database, () => {
      const version = this.database.prepare(`
        SELECT id FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = ?
      `).get(versionId, projectId, artifactId);
      if (!version) throw new Error("Artifact version not found");
      const now = new Date().toISOString();
      const state = this.set(projectId, artifactId, "approved", versionId, now);
      this.database.prepare(`INSERT OR IGNORE INTO artifact_version_approvals
        (project_id, artifact_id, version_id, approved_at) VALUES (?, ?, ?, ?)`)
        .run(projectId, artifactId, versionId, now);
      return state;
    });
  }

  private set(
    projectId: string,
    artifactId: string,
    status: ArtifactWorkflowStatus,
    approvedVersionId?: string,
    timestamp?: string,
  ): ArtifactWorkflowState {
    const now = timestamp ?? new Date().toISOString();
    this.database.prepare(`
      INSERT INTO artifact_workflow_state
        (project_id, artifact_id, status, approved_version_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, artifact_id) DO UPDATE SET
        status = excluded.status,
        approved_version_id = COALESCE(excluded.approved_version_id, artifact_workflow_state.approved_version_id),
        updated_at = excluded.updated_at
    `).run(projectId, artifactId, status, approvedVersionId ?? null, now);
    return this.get(projectId, artifactId);
  }
}
