import type { FastifyInstance } from "fastify";
import { ProjectHealthService } from "../services/project-health-service.js";

interface ProjectParams { projectId: string }
interface UsageQuery { workflow?: string; providerId?: string; modelId?: string; from?: string; to?: string }

export function registerProjectHealthRoutes(app: FastifyInstance, service: ProjectHealthService): void {
  const root = "/api/long-form/projects/:projectId/health";
  app.get<{ Params: ProjectParams }>(root, async (request, reply) => respond(reply, () => service.get(request.params.projectId)));
  app.get<{ Params: ProjectParams; Querystring: UsageQuery }>(`${root}/usage`, async (request, reply) => respond(reply, () => service.usage(request.params.projectId, request.query)));
  app.get<{ Params: ProjectParams }>(`${root}/resume`, async (request, reply) => respond(reply, () => service.resume(request.params.projectId)));
  app.get<{ Params: ProjectParams }>(`${root}/storage`, async (request, reply) => respond(reply, () => service.storageDiagnostics(request.params.projectId)));
  app.get<{ Params: ProjectParams }>(`${root}/query-plans`, async (request, reply) => respond(reply, () => ({ items: service.queryPlans(request.params.projectId) })));
}

function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T): T | unknown {
  try { return action(); }
  catch (error) {
    const message = (error as Error).message;
    return reply.code(message.includes("not found") ? 404 : 400).send({ error: message });
  }
}
