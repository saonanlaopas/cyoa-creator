import type { FastifyInstance } from "fastify";
import type { RepairFindingSourceKind } from "@story-to-cyoa/pipeline";
import {
  RepairPlanningService,
  RepairPlanningServiceError,
  type RepairPlanRequest,
} from "../services/repair-planning-service.js";

interface ProjectParams { projectId: string }
interface PlanParams extends ProjectParams { planId: string }

export function registerRepairPlanningRoutes(app: FastifyInstance, service: RepairPlanningService): void {
  const root = "/api/long-form/projects/:projectId/repair";
  app.get<{ Params: ProjectParams; Querystring: { sourceKind?: string } }>(`${root}/findings`, async (request, reply) => respond(reply, () => {
    if (!isSourceKind(request.query.sourceKind)) throw new RepairPlanningServiceError("repair_request_invalid", "A supported finding source kind is required");
    return service.listFindings(request.params.projectId, request.query.sourceKind);
  }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/findings/resolve`, async (request, reply) => respond(reply, () => service.resolveLocator(request.params.projectId, request.body)));
  app.post<{ Params: ProjectParams; Body: { findings?: unknown; intent?: unknown } }>(`${root}/targets`, async (request, reply) => respond(reply, () => service.eligibleTargets(request.params.projectId, request.body?.findings, request.body?.intent)));
  app.post<{ Params: ProjectParams; Body: RepairPlanRequest }>(`${root}/plans/preview`, async (request, reply) => respond(reply, () => service.preview(request.params.projectId, request.body ?? {})));
  app.post<{ Params: ProjectParams; Body: RepairPlanRequest }>(`${root}/plans`, async (request, reply) => respond(reply, () => service.save(request.params.projectId, request.body ?? {}), 201));
  app.get<{ Params: ProjectParams }>(`${root}/plans`, async (request, reply) => respond(reply, () => ({ items: service.list(request.params.projectId) })));
  app.get<{ Params: PlanParams }>(`${root}/plans/:planId`, async (request, reply) => respond(reply, () => service.get(request.params.projectId, request.params.planId)));
}

function isSourceKind(value: string | undefined): value is RepairFindingSourceKind {
  return value === "foundation-3-static-validation" || value === "foundation-5a-runtime"
    || value === "foundation-5b-playtest" || value === "foundation-5c-narrative-review";
}

function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T, success = 200): T | unknown {
  try { const value = action(); return success === 200 ? value : reply.code(success).send(value); }
  catch (error) {
    if (!(error instanceof RepairPlanningServiceError)) {
      const candidate = error as { name?: string; issues?: unknown; message?: string };
      if (candidate.name !== "ZodError") throw error;
      return reply.code(400).send({ code: "repair_request_invalid", error: "Repair request is invalid", details: candidate.issues });
    }
    const status = error.code === "project_not_found" || error.code.endsWith("_not_found") ? 404
      : error.code.includes("stale") || error.code.includes("lineage") || error.code.includes("integrity") ? 409 : 400;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
