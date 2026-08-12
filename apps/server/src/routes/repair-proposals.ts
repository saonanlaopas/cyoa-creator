import type { FastifyInstance } from "fastify";
import {
  RepairProposalService,
  RepairProposalServiceError,
  type RepairProposalGenerationRequest,
} from "../services/repair-proposal-service.js";

interface ProjectParams { projectId: string }
interface GenerationParams extends ProjectParams { generationId: string }
interface UnitParams extends GenerationParams { unitId: string }
interface ProposalParams extends ProjectParams { proposalId: string }

export function registerRepairProposalRoutes(app: FastifyInstance, service: RepairProposalService): void {
  const root = "/api/long-form/projects/:projectId/repair";
  app.post<{ Params: ProjectParams; Body: RepairProposalGenerationRequest }>(`${root}/proposals/generation-preview`, async (request, reply) => respond(reply, () => service.preview(request.params.projectId, request.body ?? {})));
  app.post<{ Params: ProjectParams; Body: { repairPlanId?: unknown } }>(`${root}/proposals/manual-preview`, async (request, reply) => respond(reply, () => service.manualPreview(request.params.projectId, stringBody(request.body?.repairPlanId))));
  app.post<{ Params: ProjectParams; Body: { repairPlanId?: unknown } }>(`${root}/proposals/manual`, async (request, reply) => respond(reply, () => service.saveManual(request.params.projectId, stringBody(request.body?.repairPlanId)), 201));
  app.get<{ Params: ProjectParams }>(`${root}/proposals`, async (request, reply) => respond(reply, () => ({ items: service.listProposals(request.params.projectId) })));
  app.get<{ Params: ProposalParams }>(`${root}/proposals/:proposalId`, async (request, reply) => respond(reply, () => service.getProposal(request.params.projectId, request.params.proposalId)));

  app.post<{ Params: ProjectParams; Body: RepairProposalGenerationRequest }>(`${root}/proposal-generations`, async (request, reply) => respond(reply, () => service.createGeneration(request.params.projectId, request.body ?? {}), 201));
  app.get<{ Params: ProjectParams }>(`${root}/proposal-generations`, async (request, reply) => respond(reply, () => ({ items: service.listGenerations(request.params.projectId) })));
  app.get<{ Params: GenerationParams }>(`${root}/proposal-generations/:generationId`, async (request, reply) => respond(reply, () => service.getGeneration(request.params.projectId, request.params.generationId)));
  app.get<{ Params: GenerationParams }>(`${root}/proposal-generations/:generationId/history`, async (request, reply) => respond(reply, () => ({ items: service.history(request.params.projectId, request.params.generationId) })));
  app.post<{ Params: GenerationParams; Body: { fingerprint?: unknown } }>(`${root}/proposal-generations/:generationId/authorize`, async (request, reply) => respond(reply, () => service.authorize(request.params.projectId, request.params.generationId, stringBody(request.body?.fingerprint))));
  app.post<{ Params: GenerationParams }>(`${root}/proposal-generations/:generationId/start`, async (request, reply) => respond(reply, () => service.start(request.params.projectId, request.params.generationId), 202));
  app.post<{ Params: GenerationParams }>(`${root}/proposal-generations/:generationId/cancel`, async (request, reply) => respond(reply, () => service.cancel(request.params.projectId, request.params.generationId)));
  app.post<{ Params: UnitParams }>(`${root}/proposal-generations/:generationId/units/:unitId/retry`, async (request, reply) => respond(reply, () => service.retryUnit(request.params.projectId, request.params.generationId, request.params.unitId)));
}

function stringBody(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new RepairProposalServiceError("repair_proposal_request_invalid", "A non-empty string is required");
  return value.trim();
}
function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T, success = 200): T | unknown {
  try { const value = action(); return success === 200 ? value : reply.code(success).send(value); }
  catch (error) {
    if (!(error instanceof RepairProposalServiceError)) {
      const candidate = error as { name?: string; issues?: unknown };
      if (candidate.name !== "ZodError") throw error;
      return reply.code(400).send({ code: "repair_proposal_request_invalid", error: "Repair proposal request is invalid", details: candidate.issues });
    }
    const status = error.code === "project_not_found" || error.code.endsWith("_not_found") ? 404
      : error.code.includes("stale") || error.code.includes("lineage") || error.code.includes("integrity") ? 409 : 400;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
