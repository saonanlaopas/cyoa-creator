import { type ArtifactRepository, type PassagePlanRepository, type WorkflowRepository } from "@story-to-cyoa/persistence";
import type { ZodType } from "zod";

/** Shared version writer for reviewed planning/repair operations. Call inside the application's transaction. */
export class StructuredMutationService {
  constructor(private readonly artifacts: ArtifactRepository, private readonly workflow: WorkflowRepository, private readonly passages: PassagePlanRepository) {}
  artifact(projectId: string, artifactId: string, content: unknown, schema: ZodType, dependencies: string[], materialChanged = true) {
    const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId, content, schema, dependencies, markDependentsStale: false });
    this.workflow.markDraft(projectId, artifactId);
    if (materialChanged) {
      this.artifacts.markDependentsStale(projectId, artifactId).forEach((id) => this.workflow.markStale(projectId, id));
      if (this.passages.currentStructure(projectId)) this.passages.markStale(projectId);
    }
    return version;
  }
  entity(projectId: string, kind: "passage" | "choice" | "thread", id: string, content: unknown) {
    const version = this.passages.insertEntityVersionInTransaction(projectId, kind, id, content);
    this.passages.markDraftInTransaction(projectId);
    return version;
  }
}
