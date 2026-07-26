import type { Project } from "@story-to-cyoa/domain";
import type { ArtifactRepository, ArtifactVersion, JobRepository } from "@story-to-cyoa/persistence";
import { buildNarrativeReviewPrompt } from "../prompts/review-narrative.js";
import {
  NarrativeReviewSchema,
  type NarrativeFinding,
  type NarrativeReview,
} from "../schemas/narrative-finding.js";

export interface NarrativeReviewGenerator {
  generate(prompt: string): Promise<unknown>;
}

export interface ReviewNarrativeInput {
  projectId: string;
  project: Project;
  storyBible: unknown;
  generator: NarrativeReviewGenerator;
  artifacts: ArtifactRepository;
}

export async function reviewNarrative(
  input: ReviewNarrativeInput,
): Promise<ArtifactVersion<NarrativeReview>> {
  const response = await input.generator.generate(buildNarrativeReviewPrompt(input.project, input.storyBible));
  const review = NarrativeReviewSchema.parse(response);
  return input.artifacts.saveArtifact<NarrativeReview>({
    projectId: input.projectId,
    artifactId: "review",
    artifactType: "review",
    schemaVersion: review.schemaVersion,
    content: review,
    dependencies: ["drafts", "bible"],
  });
}

export function createNarrativeReviewService(dependencies: {
  artifacts: ArtifactRepository;
  jobs: JobRepository;
  generator: NarrativeReviewGenerator;
}) {
  return {
    async reviewNarrative(projectId: string, project: Project, storyBible: unknown): Promise<string> {
      const job = dependencies.jobs.create(projectId, "narrative-review");
      try {
        const artifact = await reviewNarrative({
          projectId,
          project,
          storyBible,
          generator: dependencies.generator,
          artifacts: dependencies.artifacts,
        });
        dependencies.jobs.checkpoint(job.id, { artifactVersionId: artifact.id }, "completed");
      } catch (error) {
        dependencies.jobs.checkpoint(job.id, { error: (error as Error).message }, "failed");
        throw error;
      }
      return job.id;
    },
  };
}

export function proposeNarrativeRepair(finding: NarrativeFinding) {
  return {
    kind: "narrative-repair" as const,
    findingId: finding.id,
    affectedPassageIds: [...finding.passageIds],
    preview: finding.suggestion ?? finding.message,
    approvalRequired: true as const,
    status: "proposed" as const,
  };
}
