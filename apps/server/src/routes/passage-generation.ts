import type { FastifyInstance } from "fastify";
import type { PassageGenerationService } from "../services/passage-generation-service.js";

interface ProjectParams { projectId: string }
interface PlanParams extends ProjectParams { planId: string }
interface JobParams extends ProjectParams { jobId: string }
interface UnitParams extends JobParams { unitId: string }

const status = (error: unknown): 400 | 404 | 409 => {
  const message = (error as Error).message;
  if (message.includes("not found")) return 404;
  if (message.includes("transition") || message.includes("authorized") || message.includes("Approve")
    || message.includes("running") || message.includes("failed")) return 409;
  return 400;
};

export function registerPassageGenerationRoutes(app: FastifyInstance, service: PassageGenerationService): void {
  const root = "/api/long-form/projects/:projectId/passage-generation";
  app.post<{ Params: ProjectParams; Body: { scope?: unknown; providerId?: string; modelId?: string } }>(
    `${root}/plans/preview`, async (request, reply) => {
      try { return service.preview(request.params.projectId, { ...request.body, scope: request.body?.scope }); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: ProjectParams; Body: { scope?: unknown; providerId?: string; modelId?: string } }>(
    `${root}/plans`, async (request, reply) => {
      try { return reply.code(201).send(service.create(request.params.projectId, { ...request.body, scope: request.body?.scope })); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.get<{ Params: ProjectParams }>(`${root}/plans`, async (request, reply) => {
    try { return service.list(request.params.projectId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: PlanParams }>(`${root}/plans/:planId`, async (request, reply) => {
    try { return service.getPlan(request.params.projectId, request.params.planId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: PlanParams; Body: { fingerprint?: string } }>(
    `${root}/plans/:planId/authorize`, async (request, reply) => {
      if (!request.body?.fingerprint) return reply.code(400).send({ error: "fingerprint is required" });
      try { return service.authorize(request.params.projectId, request.params.planId, request.body.fingerprint); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.get<{ Params: JobParams }>(`${root}/jobs/:jobId`, async (request, reply) => {
    try { return service.getJob(request.params.projectId, request.params.jobId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/start`, async (request, reply) => {
    try { return reply.code(202).send(service.start(request.params.projectId, request.params.jobId)); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/cancel`, async (request, reply) => {
    try { return service.cancel(request.params.projectId, request.params.jobId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: UnitParams }>(`${root}/jobs/:jobId/units/:unitId/retry`, async (request, reply) => {
    try { return service.retry(request.params.projectId, request.params.jobId, request.params.unitId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
}
