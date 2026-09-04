import type { FastifyInstance } from "fastify";
import type { AssistantScope, AuthorMemoryRepository, DecisionScope, ProjectRepository } from "@story-to-cyoa/persistence";

interface ProjectParams { projectId: string }
interface ConversationParams extends ProjectParams { conversationId: string }
interface DecisionParams extends ProjectParams { decisionId: string }

export function registerAuthorMemoryRoutes(app: FastifyInstance, projects: ProjectRepository, memory: AuthorMemoryRepository): void {
  const projectExists = (id: string) => projects.get(id)?.mode === "long-form";

  app.get<{ Params: ConversationParams; Querystring: { scope?: string } }>(
    "/api/long-form/projects/:projectId/conversations/:conversationId/author-memory/context",
    async (request, reply) => {
      if (!projectExists(request.params.projectId)) return reply.code(404).send({ error: "Long-form project not found" });
      let scope: AssistantScope;
      try { scope = request.query.scope ? JSON.parse(request.query.scope) as AssistantScope : { kind: "project", projectId: request.params.projectId }; }
      catch { return reply.code(400).send({ error: "Author-memory scope is invalid" }); }
      if (scope.projectId !== request.params.projectId) return reply.code(400).send({ error: "Author-memory scope is invalid" });
      try { return memory.buildContext(request.params.projectId, request.params.conversationId, scope); }
      catch (error) { return reply.code(404).send({ error: (error as Error).message }); }
    },
  );

  app.get<{ Params: ConversationParams }>(
    "/api/long-form/projects/:projectId/conversations/:conversationId/summaries",
    async (request, reply) => {
      if (!projectExists(request.params.projectId)) return reply.code(404).send({ error: "Long-form project not found" });
      try { return memory.listSummaries(request.params.projectId, request.params.conversationId); }
      catch (error) { return reply.code(404).send({ error: (error as Error).message }); }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { history?: string } }>(
    "/api/long-form/projects/:projectId/pinned-decisions",
    async (request, reply) => {
      if (!projectExists(request.params.projectId)) return reply.code(404).send({ error: "Long-form project not found" });
      return memory.listDecisions(request.params.projectId, request.query.history === "true");
    },
  );

  app.post<{ Params: ProjectParams; Body: { scope?: DecisionScope; relatedIds?: string[]; content?: string;
    provenance?: { messageId?: string; changeSetId?: string; note?: string } } }>(
    "/api/long-form/projects/:projectId/pinned-decisions",
    async (request, reply) => {
      if (!projectExists(request.params.projectId)) return reply.code(404).send({ error: "Long-form project not found" });
      try {
        return reply.code(201).send(memory.createDecision({ projectId: request.params.projectId,
          scope: request.body?.scope ?? { kind: "project" }, relatedIds: request.body?.relatedIds,
          content: request.body?.content ?? "", provenance: request.body?.provenance }));
      } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    },
  );

  app.patch<{ Params: DecisionParams; Body: { scope?: DecisionScope; relatedIds?: string[]; content?: string;
    status?: "active" | "superseded" | "withdrawn"; provenance?: { messageId?: string; changeSetId?: string; note?: string } } }>(
    "/api/long-form/projects/:projectId/pinned-decisions/:decisionId",
    async (request, reply) => {
      if (!projectExists(request.params.projectId)) return reply.code(404).send({ error: "Long-form project not found" });
      try { return memory.reviseDecision(request.params.projectId, request.params.decisionId, request.body ?? {}); }
      catch (error) {
        const message = (error as Error).message;
        return reply.code(message.includes("not found") ? 404 : 400).send({ error: message });
      }
    },
  );
}
