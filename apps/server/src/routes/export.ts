import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { ProjectSchema, validateGraph, type Project } from "@story-to-cyoa/domain";
import { compileSugarCube, renderTwee } from "@story-to-cyoa/export-twine";
import type { ArtifactRepository, ProjectRepository } from "@story-to-cyoa/persistence";

interface ProjectParams { projectId: string }

function exportableProject(artifacts: ArtifactRepository, projectId: string): Project | undefined {
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

function validateForExport(project: Project): void {
  const errors = validateGraph(project).filter((finding) => finding.severity === "error");
  if (errors.length) throw new Error(`Project is not exportable: ${errors.map((finding) => finding.code).join(", ")}`);
}

export function registerExportRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
): void {
  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/export/twee", async (request, reply) => {
    if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
    const project = exportableProject(artifacts, request.params.projectId);
    if (!project) return reply.code(409).send({ error: "Drafted project is required" });
    try {
      validateForExport(project);
      const twee = renderTwee(project);
      artifacts.saveArtifact({
        projectId: request.params.projectId, artifactId: "export", artifactType: "export",
        content: { format: "twee", generatedAt: new Date().toISOString() }, dependencies: ["drafts"],
      });
      return reply.header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}.twee"`).send(twee);
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/export/html", async (request, reply) => {
    if (!projects.get(request.params.projectId)) return reply.code(404).send({ error: "Project not found" });
    const project = exportableProject(artifacts, request.params.projectId);
    if (!project) return reply.code(409).send({ error: "Drafted project is required" });
    try {
      validateForExport(project);
      const directory = await mkdtemp(join(tmpdir(), "story-to-cyoa-export-"));
      const outputPath = join(directory, `${project.id}.html`);
      const result = await compileSugarCube(renderTwee(project), outputPath);
      const html = await readFile(outputPath);
      artifacts.saveArtifact({
        projectId: request.params.projectId, artifactId: "export", artifactType: "export",
        content: { format: "html", compiler: result.compiler, generatedAt: new Date().toISOString() },
        dependencies: ["drafts"],
      });
      return reply.header("content-type", "text/html; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}.html"`).send(html);
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    }
  });
}
