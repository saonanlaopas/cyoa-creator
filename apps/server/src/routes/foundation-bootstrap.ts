import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FOUNDATION_ARTIFACT_IDS } from "@story-to-cyoa/domain";
import type { FoundationBootstrapService } from "../services/foundation-bootstrap-service.js";
const id = z.string().min(1).max(240), selection = z.object({ artifactIds: z.array(z.enum(FOUNDATION_ARTIFACT_IDS)).min(1).max(6) }).strict();
interface Params { projectId: string; jobId: string }
export function registerFoundationBootstrapRoutes(app: FastifyInstance, service: FoundationBootstrapService) {
  const root = "/api/long-form/projects/:projectId/foundation-bootstrap";
  app.get<{ Params: Params }>(root, (request, reply) => respond(reply, () => service.state(request.params.projectId)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/preview`, (request, reply) => respond(reply, () => service.preview(request.params.projectId, request.body)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/start`, (request, reply) => respond(reply, () => { const input = z.object({ planId: id, fingerprint: id }).strict().parse(request.body); return service.start(request.params.projectId, input.planId, input.fingerprint); }));
  app.get<{ Params: Params }>(`${root}/jobs/:jobId`, (request, reply) => respond(reply, () => service.job(request.params.projectId, request.params.jobId)));
  app.get<{ Params: Params }>(`${root}/jobs/:jobId/review`, (request, reply) => respond(reply, () => service.review(request.params.projectId, request.params.jobId)));
  for (const action of ["cancel", "retry"] as const) app.post<{ Params: Params }>(`${root}/jobs/:jobId/${action}`, (request, reply) => respond(reply, () => service[action](request.params.projectId, request.params.jobId)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/jobs/:jobId/preview-apply`, (request, reply) => respond(reply, () => service.previewApply(request.params.projectId, request.params.jobId, selection.parse(request.body).artifactIds)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/jobs/:jobId/apply`, (request, reply) => respond(reply, () => { const input = selection.extend({ fingerprint: id }).parse(request.body); return service.apply(request.params.projectId, request.params.jobId, input.artifactIds, input.fingerprint); }));
}
async function respond(reply: FastifyReply, action: () => unknown) {
  try { return reply.send(await action()); } catch (error) {
    const code = /^bootstrap_[a-z_]+/.exec((error as Error)?.message ?? "")?.[0] ?? "bootstrap_request_invalid";
    return reply.code(/stale|running|active|selection/.test(code) ? 409 : 400).send({ code, error: code.replaceAll("_", " ") });
  }
}
