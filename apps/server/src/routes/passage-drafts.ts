import type { FastifyInstance } from "fastify";
import type { PassageDraftLifecycle } from "@story-to-cyoa/persistence";
import type { PassageDraftService } from "../services/passage-draft-service.js";

interface ProjectParams { projectId: string }
interface PassageParams extends ProjectParams { passageId: string }

const status = (error: unknown): 400 | 404 | 409 => {
  const message = (error as Error).message;
  if (message.includes("not found")) return 404;
  if (message.includes("locked") || message.includes("transition") || message.includes("stale") || message.includes("Approve")) return 409;
  return 400;
};
const lifecycleStatuses = new Set<PassageDraftLifecycle>(["candidate", "accepted", "reviewed", "locked"]);

export function registerPassageDraftRoutes(app: FastifyInstance, service: PassageDraftService): void {
  const root = "/api/long-form/projects/:projectId/drafts";
  app.get<{ Params: ProjectParams }>(`${root}/summary`, async (request, reply) => {
    try { return service.summary(request.params.projectId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: PassageParams }>(`${root}/passages/:passageId`, async (request, reply) => {
    try { return service.get(request.params.projectId, request.params.passageId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.put<{ Params: PassageParams; Body: { proseMarkdown?: unknown; authorNote?: unknown } }>(
    `${root}/passages/:passageId`, async (request, reply) => {
      try { return reply.code(201).send(service.saveManual(request.params.projectId, request.params.passageId, request.body ?? {})); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: PassageParams; Body: { versionId?: string } }>(
    `${root}/passages/:passageId/restore`, async (request, reply) => {
      if (!request.body?.versionId) return reply.code(400).send({ error: "versionId is required" });
      try { return reply.code(201).send(service.restore(request.params.projectId, request.params.passageId, request.body.versionId)); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: PassageParams; Body: { versionId?: string; status?: PassageDraftLifecycle } }>(
    `${root}/passages/:passageId/transition`, async (request, reply) => {
      if (!request.body?.versionId || !request.body.status || !lifecycleStatuses.has(request.body.status)) {
        return reply.code(400).send({ error: "A valid versionId and lifecycle status are required" });
      }
      try {
        return reply.code(201).send(service.transition(
          request.params.projectId, request.params.passageId, request.body.versionId, request.body.status,
        ));
      } catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: PassageParams }>(`${root}/passages/:passageId/unlock`, async (request, reply) => {
    try { return service.unlock(request.params.projectId, request.params.passageId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
}
