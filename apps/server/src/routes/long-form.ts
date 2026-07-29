import type { FastifyInstance } from "fastify";
import { defaultProjectBrief, ProjectBriefSchema, type ProjectBrief } from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";

interface ProjectParams {
  projectId: string;
}

function markdownList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "_None yet._";
}

export function renderBriefMarkdown(brief: ProjectBrief): string {
  return [
    `# ${brief.workingTitle}`,
    "",
    "## Premise",
    "",
    brief.premise || "_Not written yet._",
    "",
    "## Story direction",
    "",
    `- Source: ${brief.sourceMode === "imported-source" ? "Imported source" : "Original premise"}`,
    `- Protagonist: ${brief.protagonist || "Not chosen"}`,
    `- Point of view: ${brief.pointOfView}`,
    `- Adaptation fidelity: ${brief.adaptationFidelity}`,
    `- Branching style: ${brief.branchingStyle}`,
    `- Tone: ${brief.tone || "Not chosen"}`,
    "",
    "## Planning targets",
    "",
    `- Total words: ${brief.totalWordTarget.toLocaleString("en-US")}`,
    `- Typical playthrough: ${brief.typicalPlaythroughWordTarget.toLocaleString("en-US")} words`,
    `- Major routes: ${brief.routeTarget}`,
    `- Endings: ${brief.endingTarget}`,
    `- Average passage: ${brief.passageWordTarget} words`,
    "",
    "## Content boundaries",
    "",
    markdownList(brief.contentBoundaries),
    "",
    "## Priority characters",
    "",
    markdownList(brief.priorityCharacters),
    "",
    "## Priority relationships",
    "",
    markdownList(brief.priorityRelationships),
    "",
    "## Project constraints",
    "",
    markdownList(brief.projectConstraints),
    "",
    "## Unresolved questions",
    "",
    markdownList(brief.unresolvedQuestions),
    "",
  ].join("\n");
}

export function registerLongFormRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
  workflow: WorkflowRepository,
): void {
  const longFormProject = (projectId: string) => {
    const project = projects.get(projectId);
    return project?.mode === "long-form" ? project : undefined;
  };

  app.post<{ Body: { name?: string } }>("/api/long-form/projects", async (request, reply) => {
    try {
      const project = projects.create(request.body?.name ?? "", undefined, "long-form");
      const brief = artifacts.saveArtifact({
        projectId: project.id,
        artifactId: "brief",
        artifactType: "brief",
        schema: ProjectBriefSchema,
        content: defaultProjectBrief(project.name),
      });
      return reply.code(201).send({ project, brief, workflow: workflow.markDraft(project.id, "brief") });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: ProjectParams }>("/api/long-form/projects/:projectId", async (request, reply) => {
    const project = longFormProject(request.params.projectId);
    if (!project) return reply.code(404).send({ error: "Long-form project not found" });
    return {
      project,
      brief: artifacts.getCurrent<ProjectBrief>(project.id, "brief") ?? null,
      workflow: {
        brief: workflow.get(project.id, "brief"),
        bible: workflow.get(project.id, "bible"),
      },
    };
  });

  app.put<{ Params: ProjectParams; Body: ProjectBrief }>(
    "/api/long-form/projects/:projectId/brief",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      try {
        const brief = artifacts.saveArtifact({
          projectId: project.id,
          artifactId: "brief",
          artifactType: "brief",
          schema: ProjectBriefSchema,
          content: request.body,
        });
        return reply.code(201).send({ brief, workflow: workflow.markDraft(project.id, "brief") });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/brief/approve",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      const versionId = request.body?.versionId ?? artifacts.getCurrent(project.id, "brief")?.id;
      if (!versionId) return reply.code(404).send({ error: "Project brief not found" });
      try {
        return workflow.approve(project.id, "brief", versionId);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { format?: string } }>(
    "/api/long-form/projects/:projectId/brief/export",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      const brief = project && artifacts.getCurrent<ProjectBrief>(project.id, "brief");
      if (!project || !brief) return reply.code(404).send({ error: "Project brief not found" });
      if (request.query.format === "markdown") {
        return reply
          .header("content-type", "text/markdown; charset=utf-8")
          .header("content-disposition", `attachment; filename="${project.id}-brief.md"`)
          .send(renderBriefMarkdown(brief.content));
      }
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}-brief.json"`)
        .send({
          project: { id: project.id, name: project.name, mode: project.mode },
          artifact: brief,
          workflow: workflow.get(project.id, "brief"),
        });
    },
  );
}
