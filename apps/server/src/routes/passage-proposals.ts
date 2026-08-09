import type { FastifyInstance, FastifyReply } from "fastify";
import { PassageProposalServiceError, type PassageProposalService } from "../services/passage-proposal-service.js";

interface ProjectParams { projectId: string }
interface JobParams extends ProjectParams { jobId: string }
interface ProposalParams extends ProjectParams { proposalId: string }

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof PassageProposalServiceError) {
    const status = error.code === "not_found" ? 404
      : error.code === "stale_preview" ? 409
        : error.code === "hard_validation" ? 422 : 400;
    return reply.code(status).send({ error: error.message, code: error.code, details: error.details });
  }
  return reply.code(400).send({ error: (error as Error).message });
}

export function registerPassageProposalRoutes(app: FastifyInstance, service: PassageProposalService): void {
  const root = "/api/long-form/projects/:projectId/passage-generation";
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/proposals`, async (request, reply) => {
    try { return reply.code(201).send(service.create(request.params.projectId, request.params.jobId)); }
    catch (error) { return sendError(reply, error); }
  });
  app.get<{ Params: ProjectParams }>(`${root}/proposals`, async (request, reply) => {
    try { return service.list(request.params.projectId); }
    catch (error) { return sendError(reply, error); }
  });
  app.get<{ Params: ProposalParams }>(`${root}/proposals/:proposalId`, async (request, reply) => {
    try { return service.get(request.params.projectId, request.params.proposalId); }
    catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: ProposalParams; Body: { groupIds?: string[] } }>(
    `${root}/proposals/:proposalId/preview`, async (request, reply) => {
      try { return service.preview(request.params.projectId, request.params.proposalId, request.body?.groupIds ?? []); }
      catch (error) { return sendError(reply, error); }
    },
  );
  app.post<{ Params: ProposalParams; Body: { groupIds?: string[]; previewFingerprint?: string } }>(
    `${root}/proposals/:proposalId/apply`, async (request, reply) => {
      if (!request.body?.previewFingerprint) {
        return reply.code(400).send({ error: "A reviewed preview fingerprint is required", code: "stale_preview" });
      }
      try {
        return reply.code(201).send(service.apply(
          request.params.projectId,
          request.params.proposalId,
          request.body.groupIds ?? [],
          request.body.previewFingerprint,
        ));
      } catch (error) { return sendError(reply, error); }
    },
  );
  app.post<{ Params: ProposalParams; Body: { groupIds?: string[] } }>(
    `${root}/proposals/:proposalId/reject`, async (request, reply) => {
      try { return service.reject(request.params.projectId, request.params.proposalId, request.body?.groupIds ?? []); }
      catch (error) { return sendError(reply, error); }
    },
  );
}
