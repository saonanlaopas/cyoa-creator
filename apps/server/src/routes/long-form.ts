import type { FastifyInstance } from "fastify";
import {
  type LongFormRoutePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type LongFormStoryBible,
  type ProjectBrief,
} from "@story-to-cyoa/pipeline";
import type {
  ArtifactRepository,
  ProjectRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";
import { LongFormProjectService, findingsFromError } from "../services/long-form-project-service.js";

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

export function renderEndingPlanMarkdown(plan: LongFormEndingPlan): string {
  const allocated = plan.endings.reduce((total, ending) => total + ending.wordTarget, 0);
  return [
    `# ${plan.title}`,
    "",
    plan.overview || "_Overview not written yet._",
    "",
    "## Ending budget",
    "",
    `- Project words: ${plan.projectWordTarget.toLocaleString("en-US")}`,
    `- Ending subset target: ${plan.endingWordTarget.toLocaleString("en-US")}`,
    `- Allocated: ${allocated.toLocaleString("en-US")}`,
    "",
    ...plan.endings.flatMap((ending) => [
      `## ${ending.title}`,
      "",
      `- Route: \`${ending.routeId}\``,
      `- Type: ${ending.type}`,
      `- Word target: ${ending.wordTarget.toLocaleString("en-US")}`,
      `- Route hook: \`${ending.hookId}\``,
      "",
      ending.summary || "_Outcome summary not written yet._",
      "",
      `**Thematic payoff:** ${ending.thematicPayoff || "Not set"}`,
      "",
      `**Requirements:** ${ending.requirements.join("; ") || "None yet"}`,
      "",
      `**Exclusions:** ${ending.exclusions.join("; ") || "None yet"}`,
      "",
      `**Contributing decisions:** ${ending.contributingDecisionIds.join(", ") || "None yet"}`,
      "",
      `**Foreshadowing:** ${ending.foreshadowing.join("; ") || "None yet"}`,
      "",
      `**Character outcomes:** ${ending.characterOutcomes.map((item) => `${item.characterId}: ${item.outcome}`).join("; ") || "None yet"}`,
      "",
      `**Relationship outcomes:** ${ending.relationshipOutcomes.map((item) => `${item.relationshipId}: ${item.outcome}`).join("; ") || "None yet"}`,
      "",
      `**State consequences:** ${ending.stateConsequences.join("; ") || "None yet"}`,
      "",
      `**Variants:** ${ending.variants.map((variant) => variant.label).join("; ") || "None yet"}`,
      "",
    ]),
    "## Unresolved questions",
    "",
    ...(plan.unresolvedQuestions.length
      ? plan.unresolvedQuestions.map((item) => `- ${item.question}${item.answer ? ` — ${item.answer}` : ""}`)
      : ["_None yet._"]),
    "",
  ].join("\n");
}

function renderMechanicsMarkdown(plan: LongFormMechanicsPlan): string {
  return [
    `# ${plan.title}`, "", plan.overview, "",
    "## Visible stats", "",
    ...plan.visibleStats.map((item) => `- **${item.label}** (\`${item.key}\`, ${item.minimum}…${item.maximum}, starts ${item.initial}): ${item.description}`),
    "", "## Relationships", "",
    ...plan.relationships.map((item) => `- **${item.label}** (\`${item.key}\`): ${item.description}`),
    "", "## Flags and resources", "",
    ...[...plan.flags, ...plan.resources].map((item) => `- **${item.label}** (\`${item.key}\`): ${item.meaning}`),
    "", "## Route and ending gates", "",
    ...(plan.gates.length ? plan.gates.map((gate) => `- **${gate.targetType} \`${gate.targetId}\`**: ${gate.conditions.map((condition) => `${condition.mechanicKey} ${condition.operator}${condition.value === null ? "" : ` ${condition.value}`}`).join(` ${gate.logic} `)}`) : ["_None yet._"]),
    "", "## Choice-effect plans", "",
    ...(plan.choiceEffectPlans.length ? plan.choiceEffectPlans.map((effect) => `- **${effect.label}:** ${effect.mechanicKeys.join(", ")} — ${effect.effectGuidance.join("; ")}`) : ["_None yet._"]),
    "", "## Balancing rules", "",
    ...plan.balancingRules.map((rule) => `- **${rule.label}:** ${rule.description}`), "",
  ].join("\n");
}

export function registerLongFormRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  artifacts: ArtifactRepository,
  workflow: WorkflowRepository,
  service: LongFormProjectService,
): void {
  const longFormProject = (projectId: string) => {
    const project = projects.get(projectId);
    return project?.mode === "long-form" ? project : undefined;
  };

  app.post<{ Body: { name?: string } }>("/api/long-form/projects", async (request, reply) => {
    try {
      return reply.code(201).send(service.createProject(request.body?.name ?? ""));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: ProjectParams }>("/api/long-form/projects/:projectId", async (request, reply) => {
    try {
      return service.getState(request.params.projectId);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.put<{ Params: ProjectParams; Body: ProjectBrief }>(
    "/api/long-form/projects/:projectId/brief",
    async (request, reply) => {
      try {
        const result = service.saveArtifact(request.params.projectId, "brief", request.body);
        return reply.code(201).send({ brief: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/bible",
    async (request, reply) => {
      try {
        const result = service.createArtifact(request.params.projectId, "bible");
        return reply.code(201).send({ bible: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message });
      }
    },
  );

  app.put<{ Params: ProjectParams; Body: LongFormStoryBible }>(
    "/api/long-form/projects/:projectId/bible",
    async (request, reply) => {
      try {
        const result = service.saveArtifact(request.params.projectId, "bible", request.body);
        return reply.code(201).send({ bible: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("Create") ? 409 : 400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/bible/approve",
    async (request, reply) => {
      const versionId = request.body?.versionId ?? artifacts.getCurrent(request.params.projectId, "bible")?.id;
      if (!versionId) return reply.code(404).send({ error: "Story bible not found" });
      try {
        return service.approveArtifact(request.params.projectId, "bible", versionId);
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message, findings: findingsFromError(error) });
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
      try {
        const result = service.createArtifact(request.params.projectId, "routes");
        return reply.code(201).send({ routes: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message });
      }
    },
  );

  app.put<{ Params: ProjectParams; Body: LongFormRoutePlan }>(
    "/api/long-form/projects/:projectId/routes",
    async (request, reply) => {
      try {
        const result = service.saveArtifact(request.params.projectId, "routes", request.body);
        return reply.code(201).send({ routes: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("Create") ? 409 : 400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/routes/approve",
    async (request, reply) => {
      const versionId = request.body?.versionId ?? artifacts.getCurrent(request.params.projectId, "routes")?.id;
      if (!versionId) return reply.code(404).send({ error: "Route architecture not found" });
      try {
        return service.approveArtifact(request.params.projectId, "routes", versionId);
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message, findings: findingsFromError(error) });
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

  app.post<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/endings",
    async (request, reply) => {
      try {
        const result = service.createArtifact(request.params.projectId, "endings");
        return reply.code(201).send({ endings: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message });
      }
    },
  );

  app.put<{ Params: ProjectParams; Body: LongFormEndingPlan }>(
    "/api/long-form/projects/:projectId/endings",
    async (request, reply) => {
      try {
        const result = service.saveArtifact(request.params.projectId, "endings", request.body);
        return reply.code(201).send({ endings: result.artifact, workflow: result.workflow, validation: result.validation });
      } catch (error) {
        return reply.code((error as Error).message.includes("Create") ? 409 : 400).send({ error: (error as Error).message });
      }
    },
  );

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/endings/approve",
    async (request, reply) => {
      const versionId = request.body?.versionId ?? artifacts.getCurrent(request.params.projectId, "endings")?.id;
      if (!versionId) return reply.code(404).send({ error: "Ending architecture not found" });
      try {
        return service.approveArtifact(request.params.projectId, "endings", versionId);
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message, findings: findingsFromError(error) });
      }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { format?: string } }>(
    "/api/long-form/projects/:projectId/endings/export",
    async (request, reply) => {
      const project = longFormProject(request.params.projectId);
      const endings = project && artifacts.getCurrent<LongFormEndingPlan>(project.id, "endings");
      if (!project || !endings) return reply.code(404).send({ error: "Ending architecture not found" });
      if (request.query.format === "markdown") {
        return reply
          .header("content-type", "text/markdown; charset=utf-8")
          .header("content-disposition", `attachment; filename="${project.id}-endings.md"`)
          .send(renderEndingPlanMarkdown(endings.content));
      }
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${project.id}-endings.json"`)
        .send({
          project: { id: project.id, name: project.name, mode: project.mode },
          artifact: endings,
          workflow: workflow.get(project.id, "endings"),
        });
    },
  );

  app.post<{ Params: ProjectParams }>("/api/long-form/projects/:projectId/mechanics", async (request, reply) => {
    try {
      const result = service.createArtifact(request.params.projectId, "mechanics");
      return reply.code(201).send({ mechanics: result.artifact, workflow: result.workflow, validation: result.validation });
    } catch (error) {
      return reply.code((error as Error).message.includes("not found") ? 404 : 409)
        .send({ error: (error as Error).message });
    }
  });

  app.put<{ Params: ProjectParams; Body: LongFormMechanicsPlan }>("/api/long-form/projects/:projectId/mechanics", async (request, reply) => {
    try {
      const result = service.saveArtifact(request.params.projectId, "mechanics", request.body);
      return reply.code(201).send({ mechanics: result.artifact, workflow: result.workflow, validation: result.validation });
    } catch (error) {
      return reply.code((error as Error).message.includes("Create") ? 409 : 400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>("/api/long-form/projects/:projectId/mechanics/approve", async (request, reply) => {
    const versionId = request.body?.versionId ?? artifacts.getCurrent(request.params.projectId, "mechanics")?.id;
    if (!versionId) return reply.code(404).send({ error: "Mechanics not found" });
    try {
      return service.approveArtifact(request.params.projectId, "mechanics", versionId);
    } catch (error) {
      return reply.code((error as Error).message.includes("not found") ? 404 : 409)
        .send({ error: (error as Error).message, findings: findingsFromError(error) });
    }
  });

  app.get<{ Params: ProjectParams; Querystring: { format?: string } }>("/api/long-form/projects/:projectId/mechanics/export", async (request, reply) => {
    const project = longFormProject(request.params.projectId);
    const mechanics = project && artifacts.getCurrent<LongFormMechanicsPlan>(project.id, "mechanics");
    if (!project || !mechanics) return reply.code(404).send({ error: "Mechanics not found" });
    if (request.query.format === "markdown") return reply.header("content-type", "text/markdown; charset=utf-8").send(renderMechanicsMarkdown(mechanics.content));
    return reply.send({ project, artifact: mechanics, workflow: workflow.get(project.id, "mechanics") });
  });

  app.post<{ Params: ProjectParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/brief/approve",
    async (request, reply) => {
      const versionId = request.body?.versionId ?? artifacts.getCurrent(request.params.projectId, "brief")?.id;
      if (!versionId) return reply.code(404).send({ error: "Project brief not found" });
      try {
        return service.approveArtifact(request.params.projectId, "brief", versionId);
      } catch (error) {
        return reply.code((error as Error).message.includes("not found") ? 404 : 409)
          .send({ error: (error as Error).message, findings: findingsFromError(error) });
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
