import type { FastifyInstance } from "fastify";
import {
  defaultLongFormStoryBible,
  defaultLongFormRoutePlan,
  defaultProjectBrief,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  ProjectBriefSchema,
  type LongFormRoutePlan,
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

export function renderRoutePlanMarkdown(plan: LongFormRoutePlan): string {
  const plannedWords = plan.acts.reduce((total, act) => total + act.wordTarget, 0);
  return [
    `# ${plan.title}`,
    "",
    plan.overview || "_Overview not written yet._",
    "",
    "## Word budget",
    "",
    `- Project target: ${plan.totalWordTarget.toLocaleString("en-US")}`,
    `- Allocated across acts: ${plannedWords.toLocaleString("en-US")}`,
    `- Remaining: ${(plan.totalWordTarget - plannedWords).toLocaleString("en-US")}`,
    "",
    "## Acts",
    "",
    ...plan.acts.flatMap((act) => [
      `### ${act.label}`,
      "",
      `- Scope: ${act.routeId ? `Route \`${act.routeId}\`` : "Shared"}`,
      `- Word target: ${act.wordTarget.toLocaleString("en-US")}`,
      `- Purpose: ${act.purpose || "Not set"}`,
      "",
      act.summary || "_Summary not written yet._",
      "",
    ]),
    "## Major routes",
    "",
    ...plan.routes.flatMap((route) => [
      `### ${route.name}`,
      "",
      route.promise ? `**Promise:** ${route.promise}` : "**Promise:** Not set",
      "",
      route.summary || "_Summary not written yet._",
      "",
      `**Entry conditions:** ${route.entryConditions.join("; ") || "None yet"}`,
      "",
      `**Ending hooks:** ${route.endingHookIds.join(", ") || "None yet"}`,
      "",
    ]),
    "## Decision points",
    "",
    ...(plan.decisionPoints.length
      ? plan.decisionPoints.map((decision) =>
          `- **${decision.label}:** ${decision.question || "No question yet"} (${decision.choices.length} choices)`)
      : ["_None yet._"]),
    "",
    "## Reconvergences",
    "",
    ...(plan.reconvergences.length
      ? plan.reconvergences.map((item) =>
          `- **${item.label}:** ${item.fromActIds.join(", ")} → ${item.toActId}; preserves ${item.preservedDifferences.join("; ") || "no listed differences"}`)
      : ["_None yet._"]),
    "",
    "## Ending hooks",
    "",
    ...(plan.endingHooks.length
      ? plan.endingHooks.map((ending) =>
          `- **${ending.label}** (${ending.type}, route \`${ending.routeId}\`): ${ending.summary || "Not developed yet"}`)
      : ["_None yet._"]),
    "",
    "## Unresolved questions",
    "",
    ...(plan.unresolvedQuestions.length
      ? plan.unresolvedQuestions.map((item) => `- ${item.question}${item.answer ? ` — ${item.answer}` : ""}`)
      : ["_None yet._"]),
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
      routes: artifacts.getCurrent<LongFormRoutePlan>(project.id, "routes") ?? null,
      workflow: {
        brief: workflow.get(project.id, "brief"),
        bible: workflow.get(project.id, "bible"),
        routes: workflow.get(project.id, "routes"),
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
        if (artifacts.getCurrent(project.id, "routes")) workflow.markStale(project.id, "routes");
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
        if (artifacts.getCurrent(project.id, "routes")) workflow.markStale(project.id, "routes");
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

  app.post<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/routes",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      if (artifacts.getCurrent(project.id, "routes")) {
        return reply.code(409).send({ error: "Route architecture already exists" });
      }
      const bibleState = workflow.get(project.id, "bible");
      const approvedBible = bibleState.approvedVersionId
        ? artifacts.getVersion<LongFormStoryBible>(bibleState.approvedVersionId)
        : undefined;
      const briefState = workflow.get(project.id, "brief");
      const approvedBrief = briefState.approvedVersionId
        ? artifacts.getVersion<ProjectBrief>(briefState.approvedVersionId)
        : undefined;
      if (!approvedBible || !approvedBrief) {
        return reply.code(409).send({ error: "Approve the project brief and story bible first" });
      }
      const routes = artifacts.saveArtifact({
        projectId: project.id,
        artifactId: "routes",
        artifactType: "routes",
        schema: LongFormRoutePlanSchema,
        content: defaultLongFormRoutePlan(approvedBrief.content),
        dependencies: ["brief", "bible"],
      });
      return reply.code(201).send({ routes, workflow: workflow.markDraft(project.id, "routes") });
    },
  );

  app.put<{ Params: ProjectParams; Body: LongFormRoutePlan }>(
    "/api/long-form/projects/:projectId/routes",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      if (!artifacts.getCurrent(project.id, "routes")) {
        return reply.code(409).send({ error: "Create the route architecture first" });
      }
      try {
        const routes = artifacts.saveArtifact({
          projectId: project.id,
          artifactId: "routes",
          artifactType: "routes",
          schema: LongFormRoutePlanSchema,
          content: request.body,
          dependencies: ["brief", "bible"],
        });
        return reply.code(201).send({ routes, workflow: workflow.markDraft(project.id, "routes") });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/routes/approve",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Long-form project not found" });
      const versionId = request.body?.versionId ?? artifacts.getCurrent(project.id, "routes")?.id;
      if (!versionId) return reply.code(404).send({ error: "Route architecture not found" });
      try {
        return workflow.approve(project.id, "routes", versionId);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { format?: string } }>(
    "/api/long-form/projects/:projectId/routes/export",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      const routes = project && artifacts.getCurrent<LongFormRoutePlan>(project.id, "routes");
      if (!project || !routes) return reply.code(404).send({ error: "Route architecture not found" });
      if (request.query.format === "markdown") {
        return reply
          .header("content-type", "text/markdown; charset=utf-8")
          .header("content-disposition", `attachment; filename="${project.id}-routes.md"`)
          .send(renderRoutePlanMarkdown(routes.content));
      }
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}-routes.json"`)
        .send({
          project: { id: project.id, name: project.name, mode: project.mode },
          artifact: routes,
          workflow: workflow.get(project.id, "routes"),
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
