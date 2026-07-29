import type { FastifyInstance } from "fastify";
import type { PassageEntityKind } from "@story-to-cyoa/persistence";
import type { PassagePlanService } from "../services/passage-plan-service.js";

interface ProjectParams { projectId: string }
interface EntityParams extends ProjectParams { kind: PassageEntityKind; entityId: string }
interface SnapshotParams extends ProjectParams { snapshotId: string }

const validKind = (value: string): value is PassageEntityKind =>
  value === "passage" || value === "choice" || value === "thread";

function passagePlanMarkdown(state: ReturnType<PassagePlanService["getState"]>): string {
  if (!state.structure) throw new Error("Passage plan not found");
  const passages = new Map(state.passages.map((item) => [item.entityId, item.content]));
  const choices = new Map(state.choices.map((item) => [item.entityId, item.content]));
  const lines = [
    `# ${state.structure.content.title}`, "",
    `- Project target: ${state.structure.content.projectWordTarget.toLocaleString()} words`,
    `- Typical path target: ${state.structure.content.typicalPathWordTarget.toLocaleString()} words`,
    `- Start passage: ${state.structure.content.startPassageId ?? "Not selected"}`, "",
  ];
  for (const act of [...state.structure.content.acts].sort((a, b) => a.position - b.position)) {
    lines.push(`## ${act.label}`, "", act.purpose, "", `Budget: ${act.wordTarget.toLocaleString()} words`, "");
    for (const sequence of state.structure.content.sequences.filter((item) => item.actId === act.id).sort((a, b) => a.position - b.position)) {
      lines.push(`### ${sequence.label}`, "", sequence.purpose, "", `Budget: ${sequence.wordTarget.toLocaleString()} words`, "");
      for (const passageId of sequence.passageIds) {
        const passage = passages.get(passageId);
        if (!passage) continue;
        lines.push(`#### ${passage.title} \`${passage.id}\``, "", passage.summary || passage.purpose, "",
          `Words: ${passage.wordTarget.toLocaleString()} · Status: ${passage.planningStatus}${passage.terminal ? " · Terminal" : ""}`, "");
        for (const choiceId of passage.choiceIds) {
          const choice = choices.get(choiceId);
          if (choice) lines.push(`- **${choice.label}** → \`${choice.destinationPassageId}\``);
        }
        lines.push("");
      }
    }
  }
  if (state.threads.length) {
    lines.push("## Narrative threads", "");
    state.threads.forEach((item) => lines.push(`- **${item.content.label}**: ${item.content.description}`));
  }
  return lines.join("\n");
}

export function registerPassagePlanRoutes(app: FastifyInstance, service: PassagePlanService): void {
  const status = (error: unknown) => {
    const message = (error as Error).message;
    return message.includes("not found") ? 404 : message.includes("already") || message.includes("Approve") ? 409 : 400;
  };
  app.get<{ Params: ProjectParams }>("/api/long-form/projects/:projectId/passage-plan", async (request, reply) => {
    try { return service.getState(request.params.projectId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: ProjectParams }>("/api/long-form/projects/:projectId/passage-plan", async (request, reply) => {
    try { return reply.code(201).send(service.create(request.params.projectId)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.put<{ Params: ProjectParams; Body: unknown }>("/api/long-form/projects/:projectId/passage-plan/structure", async (request, reply) => {
    try { return reply.code(201).send(service.saveStructure(request.params.projectId, request.body)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.put<{ Params: ProjectParams; Body: unknown }>("/api/long-form/projects/:projectId/passage-plan", async (request, reply) => {
    try { return reply.code(201).send(service.saveBundle(request.params.projectId, request.body)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: ProjectParams; Body: { entities?: Array<{ kind: PassageEntityKind; id: string; content: unknown }> } }>(
    "/api/long-form/projects/:projectId/passage-plan/entities/bulk",
    async (request, reply) => {
      try { return reply.code(201).send(service.saveEntities(request.params.projectId, request.body?.entities ?? [])); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.put<{ Params: EntityParams; Body: unknown }>(
    "/api/long-form/projects/:projectId/passage-plan/entities/:kind/:entityId",
    async (request, reply) => {
      if (!validKind(request.params.kind)) return reply.code(400).send({ error: "Invalid passage-plan entity kind" });
      try { return reply.code(201).send(service.saveEntity(request.params.projectId, request.params.kind, request.params.entityId, request.body)); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.delete<{ Params: EntityParams }>("/api/long-form/projects/:projectId/passage-plan/entities/:kind/:entityId", async (request, reply) => {
    if (!validKind(request.params.kind)) return reply.code(400).send({ error: "Invalid passage-plan entity kind" });
    try { return service.deleteEntity(request.params.projectId, request.params.kind, request.params.entityId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: EntityParams }>("/api/long-form/projects/:projectId/passage-plan/entities/:kind/:entityId/versions", async (request, reply) => {
    if (!validKind(request.params.kind)) return reply.code(400).send({ error: "Invalid passage-plan entity kind" });
    try { return service.listEntityVersions(request.params.projectId, request.params.kind, request.params.entityId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: EntityParams; Body: { versionId?: string } }>(
    "/api/long-form/projects/:projectId/passage-plan/entities/:kind/:entityId/restore",
    async (request, reply) => {
      if (!validKind(request.params.kind)) return reply.code(400).send({ error: "Invalid passage-plan entity kind" });
      if (!request.body?.versionId) return reply.code(400).send({ error: "versionId is required" });
      try { return reply.code(201).send(service.restoreEntity(request.params.projectId, request.params.kind, request.params.entityId, request.body.versionId)); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: ProjectParams }>("/api/long-form/projects/:projectId/passage-plan/snapshots", async (request, reply) => {
    try { return reply.code(201).send(service.createSnapshot(request.params.projectId)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: ProjectParams; Body: { snapshotId?: string } }>("/api/long-form/projects/:projectId/passage-plan/approve", async (request, reply) => {
    try { return reply.code(201).send(service.approve(request.params.projectId, request.body?.snapshotId)); }
    catch (error) { return reply.code(409).send({ error: (error as Error).message, findings: (error as { findings?: unknown }).findings }); }
  });
  app.post<{ Params: SnapshotParams }>("/api/long-form/projects/:projectId/passage-plan/snapshots/:snapshotId/restore", async (request, reply) => {
    try { return reply.code(201).send(service.restoreSnapshot(request.params.projectId, request.params.snapshotId)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: ProjectParams; Body: { code?: string; entityId?: string; rationale?: string } }>(
    "/api/long-form/projects/:projectId/passage-plan/overrides",
    async (request, reply) => {
      if (!request.body?.code || !request.body.entityId) return reply.code(400).send({ error: "Finding code and entity ID are required" });
      try { return reply.code(201).send(service.setOverride(request.params.projectId, request.body.code, request.body.entityId, request.body.rationale ?? "")); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.delete<{ Params: ProjectParams; Querystring: { code?: string; entityId?: string } }>(
    "/api/long-form/projects/:projectId/passage-plan/overrides",
    async (request, reply) => {
      if (!request.query.code || !request.query.entityId) return reply.code(400).send({ error: "Finding code and entity ID are required" });
      return service.deleteOverride(request.params.projectId, request.query.code, request.query.entityId);
    },
  );
  app.get<{ Params: ProjectParams; Querystring: { format?: "markdown" | "json" | "bundle" } }>(
    "/api/long-form/projects/:projectId/passage-plan/export",
    async (request, reply) => {
      try {
        const state = service.getState(request.params.projectId);
        if (!state.structure) return reply.code(404).send({ error: "Passage plan not found" });
        const format = request.query.format ?? "markdown";
        reply.header("Content-Disposition", `attachment; filename="passage-plan.${format === "markdown" ? "md" : "json"}"`);
        if (format === "markdown") return reply.type("text/markdown; charset=utf-8").send(passagePlanMarkdown(state));
        const payload = format === "bundle"
          ? { ...service.portableBundle(request.params.projectId), readableMarkdown: passagePlanMarkdown(state) }
          : service.bundle(request.params.projectId);
        return reply.type("application/json; charset=utf-8").send(JSON.stringify(payload, null, 2));
      } catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
}
