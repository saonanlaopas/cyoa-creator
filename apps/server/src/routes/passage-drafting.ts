import type { FastifyInstance } from "fastify";
import type { PassageDraftingService } from "../services/passage-drafting-service.js";

interface ProjectParams { projectId: string }
interface PlanParams extends ProjectParams { planId: string }
interface JobParams extends ProjectParams { jobId: string }
interface UnitParams extends JobParams { unitId: string }

const status = (error: unknown): 400 | 404 | 409 => {
  const message = (error as Error).message;
  if (message.includes("not found")) return 404;
  if (message.includes("transition") || message.includes("authorized") || message.includes("Approve")
    || message.includes("running") || message.includes("failed") || message.includes("unfinished")) return 409;
  return 400;
};

export function registerPassageDraftingRoutes(app: FastifyInstance, service: PassageDraftingService): void {
  const root = "/api/long-form/projects/:projectId/drafting";
  app.post<{ Params: ProjectParams; Body: { scope?: unknown; providerId?: string; modelId?: string; policy?: unknown } }>(
    `${root}/plans/preview`, async (request, reply) => {
      try { return service.preview(request.params.projectId, { ...request.body, scope: request.body?.scope }); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: ProjectParams; Body: { scope?: unknown; providerId?: string; modelId?: string; policy?: unknown } }>(
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
    try { return service.startJob(request.params.projectId, request.params.jobId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/finalize`, async (request, reply) => {
    try { return service.finalizeJob(request.params.projectId, request.params.jobId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/cancel`, async (request, reply) => {
    try { return service.cancel(request.params.projectId, request.params.jobId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: UnitParams }>(`${root}/jobs/:jobId/units/:unitId/start`, async (request, reply) => {
    try { return service.startUnit(request.params.projectId, request.params.jobId, request.params.unitId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: UnitParams; Body: { attemptId?: string } }>(
    `${root}/jobs/:jobId/units/:unitId/complete`, async (request, reply) => {
      if (!request.body?.attemptId) return reply.code(400).send({ error: "attemptId is required" });
      try { return service.completeUnit(request.params.projectId, request.params.jobId, request.params.unitId, request.body.attemptId); }
      catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: UnitParams; Body: { attemptId?: string; error?: unknown } }>(
    `${root}/jobs/:jobId/units/:unitId/fail`, async (request, reply) => {
      if (!request.body?.attemptId) return reply.code(400).send({ error: "attemptId is required" });
      try {
        return service.failUnit(
          request.params.projectId, request.params.jobId, request.params.unitId,
          request.body.attemptId, request.body.error ?? { code: "synthetic_failure", retryable: true },
        );
      } catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
    },
  );
  app.post<{ Params: UnitParams }>(`${root}/jobs/:jobId/units/:unitId/retry`, async (request, reply) => {
    try { return service.retryUnit(request.params.projectId, request.params.jobId, request.params.unitId); }
    catch (error) { return reply.code(status(error)).send({ error: (error as Error).message }); }
  });
}
