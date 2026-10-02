import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SourceAnalysisService } from "../services/source-analysis-service.js";

interface ProjectParams { projectId: string }
interface PlanParams extends ProjectParams { planId: string }
interface JobParams extends ProjectParams { jobId: string }
interface RecordParams extends ProjectParams { recordId: string }
const page = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(50).default(50), versionId: z.string().max(240).optional(),
  category: z.string().max(100).optional(), search: z.string().max(200).optional(), conflictsOnly: z.enum(["true", "false"]).optional() }).strict();
const version = z.object({ versionId: z.string().min(1).max(240) }).strict();
export function registerSourceAnalysisRoutes(app: FastifyInstance, service: SourceAnalysisService) {
  const root = "/api/long-form/projects/:projectId/source-analysis";
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/source`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.source(r.params.projectId, q.offset, q.limit); }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/scope`, (r, reply) => respond(reply, () => service.selectScope(r.params.projectId, r.body), 201));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/preview`, (r, reply) => respond(reply, () => service.preview(r.params.projectId, r.body ?? {})));
  app.post<{ Params: PlanParams; Body: unknown }>(`${root}/plans/:planId/start`, (r, reply) => respond(reply, () => service.authorizeAndStart(r.params.projectId, r.params.planId, z.object({ fingerprint: z.string().min(1) }).strict().parse(r.body).fingerprint), 201));
  app.get<{ Params: ProjectParams }>(`${root}/jobs`, (r, reply) => respond(reply, () => ({ items: service.listJobs(r.params.projectId) })));
  app.get<{ Params: JobParams; Querystring: unknown }>(`${root}/jobs/:jobId`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.job(r.params.projectId, r.params.jobId, q.offset, q.limit); }));
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/resume`, (r, reply) => respond(reply, () => service.start(r.params.projectId, r.params.jobId)));
  app.post<{ Params: JobParams }>(`${root}/jobs/:jobId/cancel`, (r, reply) => respond(reply, () => service.cancel(r.params.projectId, r.params.jobId)));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/dossier`, (r, reply) => respond(reply, () => service.dossierMetadata(r.params.projectId, page.parse(r.query).versionId)));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/records`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.records(r.params.projectId, { ...q, conflictsOnly: q.conflictsOnly === "true" }); }));
  app.get<{ Params: RecordParams; Querystring: unknown }>(`${root}/records/:recordId`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.record(r.params.projectId, r.params.recordId, q.versionId, q.offset, q.limit); }));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/reference-options`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.referenceOptions(r.params.projectId, q.offset, q.limit, q.search); }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/evidence`, (r, reply) => respond(reply, () => service.evidence(r.params.projectId, r.body)));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/evidence/options`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.evidenceOptions(r.params.projectId, q.offset, q.limit, q.search); }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/corrections`, { bodyLimit: 32 * 1024 * 1024 }, (r, reply) => respond(reply, () => service.correct(r.params.projectId, r.body), 201));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/approve`, (r, reply) => respond(reply, () => service.approve(r.params.projectId, version.parse(r.body).versionId)));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/history`, (r, reply) => respond(reply, () => { const q = page.parse(r.query); return service.history(r.params.projectId, q.offset, q.limit); }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/compare`, (r, reply) => respond(reply, () => { const input = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict().parse(r.body); return service.compare(r.params.projectId, input.from, input.to); }));
  app.post<{ Params: ProjectParams; Body: unknown }>(`${root}/restore`, (r, reply) => respond(reply, () => service.restore(r.params.projectId, version.parse(r.body).versionId)));
  app.get<{ Params: ProjectParams; Querystring: unknown }>(`${root}/export`, (r, reply) => {
    reply.header("Content-Disposition", 'attachment; filename="source-dossier.json"');
    return respond(reply, () => service.exportDossier(r.params.projectId, page.parse(r.query).versionId));
  });
}
function respond(reply: FastifyReply, action: () => unknown, status = 200): unknown {
  try { return reply.code(status).send(action()); }
  catch (error) {
    const message = (error as Error)?.message ?? "";
    const code = /^source_[a-z_]+/.exec(message)?.[0] ?? "source_analysis_request_invalid";
    const status = code.endsWith("not_found") || code.endsWith("missing") ? 404 : /stale|already|not_allowed|exhausted|current_version/.test(code) ? 409 : 400;
    const budgetMessages: Record<string, string> = {
      source_dossier_scope_budget_exceeded: "Analysis exceeds the dossier budget; select fewer chapters and preview again.",
      source_dossier_byte_budget_exceeded: "Dossier exceeds the byte budget; select fewer chapters and preview again.",
      source_dossier_count_budget_exceeded: "Dossier exceeds the record budget; select a smaller scope or review a new analysis draft.",
      source_correction_byte_budget_exceeded: "Correction exceeds the byte budget; use a smaller correction with exact evidence.",
      source_correction_count_budget_exceeded: "Correction history is full; review a new analysis draft.",
      source_dossier_history_budget_exceeded: "Dossier history is full; preserve this project and continue in a new project.",
    };
    // Never expose provider errors, supplied source text, validation payloads, or credentials.
    return reply.code(status).send({ code, error: budgetMessages[code] ?? code.replaceAll("_", " ") });
  }
}
