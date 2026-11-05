import type { FastifyInstance } from "fastify";
import { AuthoringSettingsInputs, AuthoringSettingsService, type AuthoringSettingsTool } from "../services/authoring-settings-service.js";
export function registerAuthoringSettings(app: FastifyInstance, service: AuthoringSettingsService) {
  app.post<{ Params: { projectId: string; tool: string }; Body: Record<string, unknown> }>("/api/projects/:projectId/authoring/:tool", async (req, reply) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) || !/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/.test(req.headers.host ?? "") || req.headers["sec-fetch-site"] === "cross-site" || req.headers.origin !== undefined && req.headers.origin !== `${req.protocol}://${req.headers.host}`) return reply.code(403).send({ error: "authoring_same_origin_loopback_required" });
    if (!Object.hasOwn(AuthoringSettingsInputs, req.params.tool)) return reply.code(404).send({ error: "authoring_tool_not_found" });
    try { return service.call(req.params.tool as AuthoringSettingsTool, { ...req.body, projectId: req.params.projectId }); }
    catch (error) { return reply.code(/stale|conflict/.test((error as Error).message) ? 409 : 400).send({ error: (error as Error).message }); }
  });
}
