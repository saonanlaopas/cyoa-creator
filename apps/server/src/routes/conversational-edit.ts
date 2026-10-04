import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConversationalEditService } from "../services/conversational-edit-service.js";
const id = z.string().min(1).max(240);
const selection = z.object({ groupIds: z.array(id).min(1).max(12), fingerprint: id.optional() }).strict();
export function registerConversationalEditRoutes(app: FastifyInstance, service: ConversationalEditService) {
  const root = "/api/long-form/projects/:projectId/editing";
  type Params = { projectId: string; id: string };
  const call = async (reply: { code(n: number): unknown }, run: () => unknown) => {
    try { return await run(); } catch (error) { reply.code(error instanceof z.ZodError ? 400 : /not_found/.test((error as Error).message) ? 404 : 409); return { error: (error as Error).message }; }
  };
  app.get<{ Params: Params }>(`${root}/conversations`, (req, reply) => call(reply, () => service.conversationsForProject(req.params.projectId)));
  app.get<{ Params: Params; Querystring: unknown }>(`${root}/targets`, (req, reply) => call(reply, () => {
    const q = z.object({ search: z.string().max(300).default(""), offset: z.coerce.number().int().min(0).max(50000).default(0) }).strict().parse(req.query);
    return service.catalogue(req.params.projectId, q.search, q.offset);
  }));
  app.post<{ Params: Params; Body: unknown }>(`${root}/preview`, (req, reply) => call(reply, () => service.preview(req.params.projectId, req.body)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/plans/:id/generate`, (req, reply) => call(reply, () => service.generate(req.params.projectId, req.params.id, z.object({ fingerprint: id }).strict().parse(req.body).fingerprint)));
  app.post<{ Params: Params }>(`${root}/plans/:id/cancel`, (req, reply) => call(reply, () => service.cancel(req.params.projectId, req.params.id)));
  app.get<{ Params: Params }>(`${root}/conversations/:id`, (req, reply) => call(reply, () => service.history(req.params.projectId, req.params.id)));
  app.get<{ Params: Params }>(`${root}/proposals/:id`, (req, reply) => call(reply, () => service.proposal(req.params.projectId, req.params.id)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/proposals/:id/review`, (req, reply) => call(reply, () => service.review(req.params.projectId, req.params.id, selection.parse(req.body).groupIds)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/proposals/:id/apply`, (req, reply) => call(reply, () => { const s = selection.extend({ fingerprint: id }).parse(req.body); return service.apply(req.params.projectId, req.params.id, s.groupIds, s.fingerprint); }));
  app.post<{ Params: Params }>(`${root}/proposals/:id/reject`, (req, reply) => call(reply, () => service.reject(req.params.projectId, req.params.id)));
}
