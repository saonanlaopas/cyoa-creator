import type { FastifyInstance } from "fastify";
import { SceneInputs } from "../services/illustrated-scene-service.js";
import { WorldInputs } from "../services/world-service.js";
import type { ConnectedEditService } from "../services/connected-edit-service.js";

export function registerIllustratedScenes(app: FastifyInstance, service: (projectId: string) => ConnectedEditService) {
  for (const { path, inputs } of [{ path: "scenes", inputs: SceneInputs }, { path: "world", inputs: WorldInputs }]) {
  app.post<{ Params: { projectId: string; tool: string }; Body: Record<string, unknown> }>(`/api/long-form/projects/:projectId/${path}/:tool`, async (req, reply) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) || !/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/.test(req.headers.host ?? "")
      || req.headers["sec-fetch-site"] === "cross-site" || req.headers.origin !== undefined && req.headers.origin !== `${req.protocol}://${req.headers.host}`) return reply.code(403).send({ error: "scene_same_origin_loopback_required" });
    const tool = req.params.tool;
    if (!Object.hasOwn(inputs, tool)) return reply.code(404).send({ error: "scene_tool_not_found" });
    try { return await service(req.params.projectId).call(tool as keyof typeof SceneInputs | keyof typeof WorldInputs, { ...req.body, projectId: req.params.projectId }); }
    catch (error) { return reply.code(/stale|conflict/.test((error as Error).message) ? 409 : 400).send({ error: (error as Error).message }); }
  });
  }
}
