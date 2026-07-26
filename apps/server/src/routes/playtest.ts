import type { FastifyInstance } from "fastify";
import { ProjectSchema, simulateProject, type Project, type SimulationLimits } from "@story-to-cyoa/domain";
import type { ArtifactRepository, ProjectRepository } from "@story-to-cyoa/persistence";

interface ProjectParams { projectId: string }

export interface NarrativeReviewRouteService {
  reviewNarrative(projectId: string, project: Project, storyBible: unknown): Promise<string>;
}

function currentProject(artifacts: ArtifactRepository, projectId: string): Project | undefined {
  for (const artifactId of ["drafts", "routes", "project"]) {
    const artifact = artifacts.getCurrent<unknown>(projectId, artifactId);
    if (!artifact) continue;
    const candidate = typeof artifact.content === "object" && artifact.content &&
      "project" in artifact.content ? (artifact.content as { project: unknown }).project : artifact.content;
    const parsed = ProjectSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

export function registerPlaytestRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
  reviewService?: NarrativeReviewRouteService,
): void {
  app.post<{ Params: ProjectParams; Body: SimulationLimits }>(
    "/api/projects/:projectId/playtest/simulate",
    async (request, reply) => {
      if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
      const project = currentProject(artifacts, request.params.projectId);
      if (!project) return reply.code(409).send({ error: "A canonical route or draft artifact is required" });
      const report = simulateProject(project, request.body ?? {});
      artifacts.saveArtifact({
        projectId: request.params.projectId, artifactId: "simulation", artifactType: "simulation",
        content: report, dependencies: ["drafts", "routes"],
      });
      return report;
    },
  );

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/playtest/latest", async (request, reply) => {
    const report = artifacts.getCurrent(request.params.projectId, "simulation");
    return report ?? reply.code(404).send({ error: "No simulation exists" });
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/review", async (request, reply) => {
    if (!reviewService) return reply.code(503).send({ error: "Narrative review provider is not configured" });
    const project = currentProject(artifacts, request.params.projectId);
    const bible = artifacts.getCurrent(request.params.projectId, "bible");
    if (!project || !bible) return reply.code(409).send({ error: "Drafts and story bible are required" });
    const jobId = await reviewService.reviewNarrative(request.params.projectId, project, bible.content);
    return reply.code(202).send({ jobId });
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/review", async (request, reply) => {
    const review = artifacts.getCurrent(request.params.projectId, "review");
    return review ?? reply.code(404).send({ error: "No narrative review exists" });
  });
}
