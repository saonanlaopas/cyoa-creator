import type { FastifyInstance } from "fastify";
import {
  RepairApplicationService,
  RepairApplicationServiceError,
} from "../services/repair-application-service.js";

interface ProjectParams { projectId: string }
interface ProposalParams extends ProjectParams { proposalId: string }
interface ApplicationParams extends ProjectParams { applicationId: string }

export function registerRepairApplicationRoutes(app: FastifyInstance, service: RepairApplicationService): void {
  const root = "/api/long-form/projects/:projectId/repair";
  app.post<{ Params: ProposalParams; Body: { selectedGroupIds?: unknown } }>(
    `${root}/proposals/:proposalId/application-preview`,
    async (request, reply) => respond(reply, () => service.preview(
      request.params.projectId, request.params.proposalId, groupIds(request.body?.selectedGroupIds),
    )),
  );
  app.post<{ Params: ProposalParams; Body: { selectedGroupIds?: unknown; previewFingerprint?: unknown } }>(
    `${root}/proposals/:proposalId/apply`,
    async (request, reply) => respond(reply, () => service.apply(
      request.params.projectId,
      request.params.proposalId,
      groupIds(request.body?.selectedGroupIds),
      requiredString(request.body?.previewFingerprint, "An exact application preview fingerprint is required"),
    ), 201),
  );
  app.get<{ Params: ProjectParams }>(`${root}/applications`, async (request, reply) =>
    respond(reply, () => ({ items: service.list(request.params.projectId) })));
  app.get<{ Params: ApplicationParams }>(`${root}/applications/:applicationId`, async (request, reply) =>
    respond(reply, () => service.get(request.params.projectId, request.params.applicationId)));
}

function groupIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new RepairApplicationServiceError("repair_application_request_invalid", "Select one or more proposal groups");
  }
  return value.map((item) => String(item).trim());
}
function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new RepairApplicationServiceError("repair_application_request_invalid", message);
  return value.trim();
}
function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T, success = 200): T | unknown {
  try { const value = action(); return success === 200 ? value : reply.code(success).send(value); }
  catch (error) {
    if (!(error instanceof RepairApplicationServiceError)) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /stale|lineage|already|base|collision/i.test(message) ? 409 : 400;
      return reply.code(status).send({ code: status === 409 ? "stale_repair_proposal" : "repair_application_invalid", error: message });
    }
    const status = error.code === "project_not_found" || error.code.endsWith("_not_found") ? 404
      : error.code.includes("stale") || error.code.includes("lineage") ? 409 : 400;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
