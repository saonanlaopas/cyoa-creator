import type { FastifyInstance, FastifyReply } from "fastify";
import type { ArtifactRepository, ProjectRepository } from "@story-to-cyoa/persistence";

interface ProjectParams { projectId: string }
interface ArtifactParams extends ProjectParams { artifactId: string }

export function registerProjectRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
): void {
  app.post<{ Body: { name?: string } }>("/api/projects", async (request, reply) => {
    try {
      return reply.code(201).send(projects.create(request.body?.name ?? ""));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Querystring: { includeArchived?: string } }>("/api/projects", async (request) =>
    projects.list({ includeArchived: request.query.includeArchived === "true" }));

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId", async (request, reply) => {
    const project = projects.get(request.params.projectId);
    return project ?? reply.code(404).send({ error: "Project not found" });
  });

  app.patch<{ Params: ProjectParams; Body: { name?: string } }>("/api/projects/:projectId", async (request, reply) => {
    try {
      return projects.rename(request.params.projectId, request.body?.name ?? "");
    } catch (error) {
      return reply.code((error as Error).message === "Project not found" ? 404 : 400)
        .send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: ProjectParams; Body: { name?: string } }>("/api/projects/:projectId/duplicate", async (request, reply) => {
    try {
      return reply.code(201).send(projects.duplicate(request.params.projectId, request.body?.name));
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  const archive = async (projectId: string, reply: FastifyReply) => {
    try {
      return projects.archive(projectId);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  };
  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/archive", async (request, reply) =>
    archive(request.params.projectId, reply));
  app.delete<{ Params: ProjectParams }>("/api/projects/:projectId", async (request, reply) =>
    archive(request.params.projectId, reply));

  app.get<{ Params: ArtifactParams }>("/api/projects/:projectId/artifacts/:artifactId/versions", async (request, reply) => {
    if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
    return artifacts.listVersions(request.params.projectId, request.params.artifactId);
  });

  app.get<{
    Params: ArtifactParams;
    Querystring: { from?: string; to?: string };
  }>("/api/projects/:projectId/artifacts/:artifactId/compare", async (request, reply) => {
    if (!request.query.from || !request.query.to) return reply.code(400).send({ error: "from and to are required" });
    try {
      return artifacts.compare(
        request.params.projectId, request.params.artifactId, request.query.from, request.query.to,
      );
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.post<{
    Params: ArtifactParams;
    Body: { versionId?: string };
  }>("/api/projects/:projectId/artifacts/:artifactId/restore", async (request, reply) => {
    if (!request.body?.versionId) return reply.code(400).send({ error: "versionId is required" });
    try {
      return reply.code(201).send(artifacts.restore(
        request.params.projectId, request.params.artifactId, request.body.versionId,
      ));
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });
}
