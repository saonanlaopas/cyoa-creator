import type { FastifyInstance, FastifyReply } from "fastify";
import { ProjectSetupError, type ProjectSetupService } from "../services/project-setup-service.js";

interface ProjectParams { projectId: string }
interface ConversationParams extends ProjectParams { conversationId: string }
interface ProposalParams extends ConversationParams { proposalId: string }

function send(reply: FastifyReply, error: unknown) {
  if (error instanceof ProjectSetupError) return reply.code(error.status).send({ code: error.code, error: error.message });
  return reply.code(400).send({ code: "setup_failed", error: (error as Error).message });
}

/** Cancels the provider request when the browser abandons the HTTP request before a response is written. */
function abortOnClose(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => { if (!reply.raw.writableFinished) controller.abort(); });
  return controller.signal;
}

export function registerProjectSetupRoutes(app: FastifyInstance, setup: ProjectSetupService): void {
  const base = "/api/long-form/projects/:projectId/setup";

  app.post<{ Body: { name?: string } }>("/api/long-form/setup-projects", async (request, reply) => {
    try { return reply.code(201).send(setup.createProject(request.body?.name)); }
    catch (error) { return send(reply, error); }
  });

  app.post<{ Params: ProjectParams }>(`${base}/sessions`, async (request, reply) => {
    try { return reply.code(201).send(setup.startSession(request.params.projectId)); }
    catch (error) { return send(reply, error); }
  });

  app.get<{ Params: ConversationParams }>(`${base}/sessions/:conversationId`, async (request, reply) => {
    try { return setup.session(request.params.projectId, request.params.conversationId); }
    catch (error) { return send(reply, error); }
  });

  app.post<{ Params: ConversationParams; Body: { content?: string } }>(`${base}/sessions/:conversationId/messages`,
    async (request, reply) => {
      try {
        return reply.code(201).send(setup.addMessage(request.params.projectId, request.params.conversationId, request.body?.content ?? ""));
      } catch (error) { return send(reply, error); }
    });

  app.post<{ Params: ConversationParams; Body: { content?: string; model?: string } }>(`${base}/sessions/:conversationId/ask`,
    async (request, reply) => {
      try {
        return reply.code(201).send(await setup.ask(request.params.projectId, request.params.conversationId, {
          content: request.body?.content, model: request.body?.model, signal: abortOnClose(reply),
        }));
      } catch (error) { return send(reply, error); }
    });

  app.post<{ Params: ConversationParams; Body: { model?: string } }>(`${base}/sessions/:conversationId/proposal-preview`,
    async (request, reply) => {
      try { return setup.preview(request.params.projectId, request.params.conversationId, request.body?.model); }
      catch (error) { return send(reply, error); }
    });

  app.post<{ Params: ConversationParams; Body: { expectedContextFingerprint?: string; model?: string } }>(
    `${base}/sessions/:conversationId/proposals`,
    async (request, reply) => {
      try {
        return reply.code(201).send(await setup.draft(request.params.projectId, request.params.conversationId, {
          expectedContextFingerprint: request.body?.expectedContextFingerprint,
          model: request.body?.model,
          signal: abortOnClose(reply),
        }));
      } catch (error) { return send(reply, error); }
    },
  );

  app.post<{ Params: ProposalParams; Body: { groupIds?: string[] } }>(`${base}/sessions/:conversationId/proposals/:proposalId/apply`,
    async (request, reply) => {
      const groupIds = request.body?.groupIds;
      if (groupIds !== undefined && (!Array.isArray(groupIds) || groupIds.some((id) => typeof id !== "string"))) {
        return reply.code(400).send({ code: "setup_selection_invalid", error: "groupIds must be a list of group IDs" });
      }
      try {
        return reply.code(201).send(setup.apply(request.params.projectId, request.params.conversationId, request.params.proposalId, groupIds));
      } catch (error) { return send(reply, error); }
    });

  app.post<{ Params: ProposalParams }>(`${base}/sessions/:conversationId/proposals/:proposalId/reject`,
    async (request, reply) => {
      try { return setup.reject(request.params.projectId, request.params.conversationId, request.params.proposalId); }
      catch (error) { return send(reply, error); }
    });
}
