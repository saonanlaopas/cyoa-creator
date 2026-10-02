import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AdaptationIntentService } from "../services/adaptation-intent-service.js";
interface Params { projectId: string }
const version = z.object({ versionId: z.string().min(1).max(240) }).strict();
const page = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0), search: z.string().max(200).default(""), versionId: z.string().max(240).optional() }).strict();
export function registerAdaptationIntentRoutes(app: FastifyInstance, service: AdaptationIntentService) {
  const root = "/api/long-form/projects/:projectId/adaptation-intent";
  app.get<{ Params: Params }>(root, (r, reply) => respond(reply, () => service.state(r.params.projectId)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/create`, (r, reply) => respond(reply, () => service.create(r.params.projectId, r.body ?? {})));
  app.post<{ Params: Params; Body: unknown }>(`${root}/edit`, (r, reply) => respond(reply, () => service.patch(r.params.projectId, r.body)));
  app.post<{ Params: Params }>(`${root}/validate`, (r, reply) => respond(reply, () => service.validate(r.params.projectId)));
  for (const action of ["review", "approve", "restore", "apply", "reject"] as const) app.post<{ Params: Params; Body: unknown }>(`${root}/${action}`, (r, reply) => respond(reply, () => service[action](r.params.projectId, version.parse(r.body).versionId)));
  app.get<{ Params: Params; Querystring: unknown }>(`${root}/history`, (r, reply) => respond(reply, () => service.history(r.params.projectId, page.parse(r.query).offset)));
  app.get<{ Params: Params; Querystring: unknown }>(`${root}/source-records`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.sourceRecords(r.params.projectId, q.offset, q.search); }));
  app.get<{ Params: Params; Querystring: unknown }>(`${root}/proposals`, (r, reply) => respond(reply, () => service.proposals(r.params.projectId, page.parse(r.query).offset)));
  app.get<{ Params: Params & { versionId: string } }>(`${root}/proposals/:versionId`, (r, reply) => respond(reply, () => service.proposalReview(r.params.projectId, r.params.versionId)));
  app.get<{ Params: Params & { collection: string; id: string } }>(`${root}/collections/:collection/:id`, (r, reply) => respond(reply, () => service.item(r.params.projectId, z.enum(["overrides", "inventions", "obligations", "exceptions", "expansion"]).parse(r.params.collection), r.params.id)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/compare`, (r, reply) => respond(reply, () => { const v = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict().parse(r.body); return service.compare(r.params.projectId, v.from, v.to); }));
  app.get<{ Params: Params & { collection: string }; Querystring: unknown }>(`${root}/collections/:collection`, (r, reply) => respond(reply, () => {
    const collection = z.enum(["overrides", "inventions", "obligations", "exceptions", "expansion"]).parse(r.params.collection), q = page.parse(r.query);
    return service.collection(r.params.projectId, collection, q.offset, q.search, q.versionId);
  }));
  app.post<{ Params: Params; Body: unknown }>(`${root}/preview`, (r, reply) => respond(reply, () => service.preview(r.params.projectId, r.body)));
  app.post<{ Params: Params; Body: unknown }>(`${root}/generate`, (r, reply) => respond(reply, () => {
    const input = z.object({ previewId: z.string().min(1), fingerprint: z.string().min(1) }).strict().parse(r.body);
    return service.generate(r.params.projectId, input.previewId, input.fingerprint);
  }));
  app.get<{ Params: Params; Querystring: unknown }>(`${root}/export`, (r, reply) => {
    reply.header("Content-Disposition", 'attachment; filename="adaptation-intent.json"');
    return respond(reply, () => service.export(r.params.projectId, page.parse(r.query).versionId));
  });
}
async function respond(reply: FastifyReply, action: () => unknown) {
  try { return reply.send(await action()); }
  catch (error) {
    const code = /^adaptation_[a-z_]+/.exec((error as Error)?.message ?? "")?.[0] ?? "adaptation_request_invalid";
    const conflicts = code === "adaptation_override_conflict" ? z.array(z.object({ id: z.string().max(240), overrideIds: z.array(z.string().max(240)).max(32) }).strict()).max(32).safeParse((error as { conflicts?: unknown }).conflicts) : undefined;
    return reply.code(/stale|pending|running|already|current/.test(code) ? 409 : 400).send({ code, error: code.replaceAll("_", " "), ...(conflicts?.success ? { conflicts: conflicts.data } : {}) });
  }
}
