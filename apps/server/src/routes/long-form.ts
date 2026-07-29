import type { FastifyInstance } from "fastify";
import {
  defaultLongFormStoryBible,
  defaultProjectBrief,
  LongFormStoryBibleSchema,
  ProjectBriefSchema,
  type LongFormStoryBible,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
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

function describedEntries(values: Array<{ label: string; description: string }>): string {
  return values.length
    ? values.map((item) => `### ${item.label}\n\n${item.description || "_Not described yet._"}`).join("\n\n")
    : "_None yet._";
}

export function renderBibleMarkdown(bible: LongFormStoryBible): string {
  return [
    `# ${bible.title}`,
    "",
    bible.overview || "_Overview not written yet._",
    "",
    "## Characters",
    "",
    bible.characters.length
      ? bible.characters.map((character) => [
          `### ${character.name}`,
          "",
          `**Role:** ${character.role || "Not set"}`,
          "",
          character.summary || "_Summary not written yet._",
          "",
          `**Motivations:** ${character.motivations.join("; ") || "None yet"}`,
          "",
          `**Knowledge:** ${character.knowledge.join("; ") || "None yet"}`,
          "",
          `**Planned arc:** ${character.plannedArc || "Not planned yet"}`,
        ].join("\n")).join("\n\n")
      : "_None yet._",
    "",
    "## Relationships",
    "",
    bible.relationships.length
      ? bible.relationships.map((relationship) =>
          `- **${relationship.label || relationship.characterIds.join(" / ")}:** ${relationship.currentState || "Not described"} — ${relationship.plannedArc || "No planned arc"}`,
        ).join("\n")
      : "_None yet._",
    "",
    "## Settings and institutions",
    "",
    describedEntries(bible.settings),
    "",
    "## Timeline and causality",
    "",
    describedEntries(bible.timeline),
    "",
    "## World rules",
    "",
    describedEntries(bible.worldRules),
    "",
    "## Themes",
    "",
    describedEntries(bible.themes),
    "",
    "## Prose guidance",
    "",
    `- Point of view: ${bible.proseGuidance.pointOfView || "Not set"}`,
    `- Tone: ${bible.proseGuidance.tone.join("; ") || "Not set"}`,
    `- Style: ${bible.proseGuidance.style.join("; ") || "Not set"}`,
    `- Avoid: ${bible.proseGuidance.avoid.join("; ") || "Nothing listed"}`,
    "",
    "## Canon facts",
    "",
    bible.canonFacts.length
      ? bible.canonFacts.map((fact) =>
          `- ${fact.statement} _(${fact.confidence}; excerpts: ${fact.sourceExcerptIds.join(", ") || "none"})_`,
        ).join("\n")
      : "_None yet._",
    "",
    "## Contradictions",
    "",
    bible.contradictions.length
      ? bible.contradictions.map((item) => `- ${item.description} — ${item.resolution || "Unresolved"}`).join("\n")
      : "_None yet._",
    "",
    "## Adaptation opportunities",
    "",
    bible.adaptationOpportunities.length
      ? bible.adaptationOpportunities.map((item) => `- ${item.description} — ${item.rationale || "No rationale yet"}`).join("\n")
      : "_None yet._",
    "",
    "## Unresolved questions",
    "",
    bible.unresolvedQuestions.length
      ? bible.unresolvedQuestions.map((item) => `- ${item.question}${item.answer ? ` — ${item.answer}` : ""}`).join("\n")
      : "_None yet._",
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
      bible: artifacts.getCurrent<LongFormStoryBible>(project.id, "bible") ?? null,
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
        if (artifacts.getCurrent(project.id, "bible")) workflow.markStale(project.id, "bible");
        return reply.code(201).send({ brief, workflow: workflow.markDraft(project.id, "brief") });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/bible",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      if (artifacts.getCurrent(project.id, "bible")) {
        return reply.code(409).send({ error: "Story bible already exists" });
      }
      const briefState = workflow.get(project.id, "brief");
      const approvedBrief = briefState.approvedVersionId
        ? artifacts.getVersion<ProjectBrief>(briefState.approvedVersionId)
        : undefined;
      if (!approvedBrief) return reply.code(409).send({ error: "Approve the project brief first" });
      const bible = artifacts.saveArtifact({
        projectId: project.id,
        artifactId: "bible",
        artifactType: "bible",
        schema: LongFormStoryBibleSchema,
        content: defaultLongFormStoryBible({
          title: approvedBrief.content.workingTitle,
          overview: approvedBrief.content.premise,
          protagonist: approvedBrief.content.protagonist,
          pointOfView: approvedBrief.content.pointOfView,
          tone: approvedBrief.content.tone,
        }),
        dependencies: ["brief", "source"],
      });
      return reply.code(201).send({ bible, workflow: workflow.markDraft(project.id, "bible") });
    },
  );

  app.put<{ Params: ProjectParams; Body: LongFormStoryBible }>(
    "/api/long-form/projects/:projectId/bible",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      if (!artifacts.getCurrent(project.id, "bible")) {
        return reply.code(409).send({ error: "Create the story bible first" });
      }
      try {
        const bible = artifacts.saveArtifact({
          projectId: project.id,
          artifactId: "bible",
          artifactType: "bible",
          schema: LongFormStoryBibleSchema,
          content: request.body,
          dependencies: ["brief", "source"],
        });
        return reply.code(201).send({ bible, workflow: workflow.markDraft(project.id, "bible") });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/bible/approve",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      const versionId = request.body?.versionId ?? artifacts.getCurrent(project.id, "bible")?.id;
      if (!versionId) return reply.code(404).send({ error: "Story bible not found" });
      try {
        return workflow.approve(project.id, "bible", versionId);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { format?: string } }>(
    "/api/long-form/projects/:projectId/bible/export",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      const bible = project && artifacts.getCurrent<LongFormStoryBible>(project.id, "bible");
      if (!project || !bible) return reply.code(404).send({ error: "Story bible not found" });
      if (request.query.format === "markdown") {
        return reply
          .header("content-type", "text/markdown; charset=utf-8")
          .header("content-disposition", `attachment; filename="${project.id}-bible.md"`)
          .send(renderBibleMarkdown(bible.content));
      }
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}-bible.json"`)
        .send({
          project: { id: project.id, name: project.name, mode: project.mode },
          artifact: bible,
          workflow: workflow.get(project.id, "bible"),
        });
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
