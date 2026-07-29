import type { FastifyInstance } from "fastify";
import { importSource, type NormalizedSource } from "@story-to-cyoa/importers";
import type { ArtifactRepository, ProjectRepository, WorkflowRepository } from "@story-to-cyoa/persistence";

interface Params { projectId: string }

function summary(source: NormalizedSource, artifactVersionId: string) {
  return {
    artifactVersionId,
    metadata: source.metadata,
    chapters: source.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      blockCount: chapter.blocks.length,
    })),
    scopeRequired: true,
  };
}

export function registerImportRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
  maxImportBytes: number,
  workflow?: WorkflowRepository,
): void {
  const staleBibleIfNeeded = (projectId: string) => {
    if (
      workflow
      && projects.get(projectId)?.mode === "long-form"
      && artifacts.getCurrent(projectId, "bible")
    ) {
      workflow.markStale(projectId, "bible");
      if (artifacts.getCurrent(projectId, "routes")) workflow.markStale(projectId, "routes");
    }
  };
  app.post<{
    Params: Params;
    Body: { text?: string; filename?: string };
  }>("/api/projects/:projectId/source/text", async (request, reply) => {
    if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
    if (typeof request.body?.text !== "string") return reply.code(400).send({ error: "text is required" });
    try {
      const source = await importSource({
        data: request.body.text,
        filename: request.body.filename ?? "pasted.txt",
        mimeType: "text/plain",
        maxBytes: maxImportBytes,
      });
      const version = artifacts.saveArtifact({
        projectId: request.params.projectId, artifactId: "source", artifactType: "source", content: source,
      });
      staleBibleIfNeeded(request.params.projectId);
      return reply.code(201).send(summary(source, version.id));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: Params }>("/api/projects/:projectId/source", async (request, reply) => {
    if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
    try {
      const file = await request.file({ limits: { files: 1, fileSize: maxImportBytes } });
      if (!file) return reply.code(400).send({ error: "file is required" });
      const source = await importSource({
        data: await file.toBuffer(),
        filename: file.filename,
        mimeType: file.mimetype,
        maxBytes: maxImportBytes,
      });
      const version = artifacts.saveArtifact({
        projectId: request.params.projectId, artifactId: "source", artifactType: "source", content: source,
      });
      staleBibleIfNeeded(request.params.projectId);
      return reply.code(201).send(summary(source, version.id));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{
    Params: Params;
    Body: { chapterIds?: string[] };
  }>("/api/projects/:projectId/source/scope", async (request, reply) => {
    const sourceVersion = artifacts.getCurrent<NormalizedSource>(request.params.projectId, "source");
    if (!sourceVersion) return reply.code(409).send({ error: "Import a source before choosing scope" });
    const available = new Set(sourceVersion.content.chapters.map((chapter) => chapter.id));
    const chapterIds = request.body?.chapterIds;
    if (!Array.isArray(chapterIds) || !chapterIds.length || chapterIds.some((id) => !available.has(id))) {
      return reply.code(400).send({ error: "chapterIds must select imported chapters" });
    }
    const version = artifacts.saveArtifact({
      projectId: request.params.projectId,
      artifactId: "source-scope",
      artifactType: "source-scope",
      content: { chapterIds },
      dependencies: ["source"],
    });
    return reply.code(201).send(version);
  });
}
