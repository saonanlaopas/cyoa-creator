import type { FastifyInstance } from "fastify";
import { NarrativeReviewService, NarrativeReviewServiceError, type NarrativeReviewRequest } from "../services/narrative-review-service.js";

interface ProjectParams { projectId: string }
interface PlanParams extends ProjectParams { planId: string }
interface UnitParams extends PlanParams { unitId: string }

export function registerNarrativeReviewRoutes(app: FastifyInstance, service: NarrativeReviewService): void {
  const root = "/api/long-form/projects/:projectId/narrative-review";
  app.post<{ Params: ProjectParams; Body: NarrativeReviewRequest }>(`${root}/plans/preview`, async (request, reply) => respond(reply, () => service.preview(request.params.projectId, request.body ?? {})));
  app.post<{ Params: ProjectParams; Body: NarrativeReviewRequest }>(`${root}/plans`, async (request, reply) => respond(reply, () => service.create(request.params.projectId, request.body ?? {}), 201));
  app.get<{ Params: ProjectParams }>(`${root}/plans`, async (request, reply) => respond(reply, () => ({ items: service.list(request.params.projectId) })));
  app.get<{ Params: PlanParams }>(`${root}/plans/:planId`, async (request, reply) => respond(reply, () => service.get(request.params.projectId, request.params.planId)));
  app.get<{ Params: PlanParams }>(`${root}/plans/:planId/history`, async (request, reply) => respond(reply, () => ({ items: service.history(request.params.projectId, request.params.planId) })));
  app.post<{ Params: PlanParams; Body: { fingerprint?: unknown } }>(`${root}/plans/:planId/authorize`, async (request, reply) => respond(reply, () => {
    if (typeof request.body?.fingerprint !== "string") throw new NarrativeReviewServiceError("review_request_invalid", "Exact plan fingerprint is required");
    return service.authorize(request.params.projectId, request.params.planId, request.body.fingerprint);
  }));
  app.post<{ Params: PlanParams }>(`${root}/plans/:planId/start`, async (request, reply) => respond(reply, () => service.start(request.params.projectId, request.params.planId)));
  app.post<{ Params: PlanParams }>(`${root}/plans/:planId/cancel`, async (request, reply) => respond(reply, () => service.cancel(request.params.projectId, request.params.planId)));
  app.post<{ Params: UnitParams }>(`${root}/plans/:planId/units/:unitId/retry`, async (request, reply) => respond(reply, () => service.retryUnit(request.params.projectId, request.params.planId, request.params.unitId)));
}

function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T, success = 200): T | unknown {
  try { const value = action(); return success === 200 ? value : reply.code(success).send(value); }
  catch (error) {
    const item = error as Error & { code?: string; retryable?: boolean; details?: unknown };
    const status = item.code === "project_not_found" || item.code?.endsWith("_not_found") ? 404
      : item.code === "stale_review_plan" || item.code?.includes("transition") || item.code?.includes("authorized") ? 409 : 400;
    return reply.code(status).send({ error: item.message, ...(item.code ? { code: item.code } : {}), ...(typeof item.retryable === "boolean" ? { retryable: item.retryable } : {}), ...(item.details ? { details: item.details } : {}) });
  }
}
