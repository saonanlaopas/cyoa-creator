import type { FastifyInstance } from "fastify";
import {
  NativeCompilationService,
  NativeCompilationServiceError,
} from "../services/native-compilation-service.js";

interface ProjectParams { projectId: string }

export function registerNativeCompilationRoutes(
  app: FastifyInstance,
  service: NativeCompilationService,
): void {
  const root = "/api/long-form/projects/:projectId/publication";
  app.get<{ Params: ProjectParams }>(`${root}/readiness`, async (request, reply) =>
    respond(reply, () => service.readiness(request.params.projectId)));
  app.get<{ Params: ProjectParams }>(`${root}/inputs`, async (request, reply) =>
    respond(reply, () => ({ items: service.listInputs(request.params.projectId) })));
  app.post<{ Params: ProjectParams }>(`${root}/inputs`, async (request, reply) =>
    respond(reply, () => service.captureInput(request.params.projectId), 201));
  app.post<{ Params: ProjectParams; Body: { inputArtifactVersionId?: unknown } }>(
    `${root}/compile`,
    async (request, reply) => {
      const inputArtifactVersionId = request.body?.inputArtifactVersionId;
      if (inputArtifactVersionId !== undefined && typeof inputArtifactVersionId !== "string") {
        return reply.code(400).send({ code: "native_input_invalid", error: "inputArtifactVersionId must be a string" });
      }
      return respond(
        reply,
        () => service.compile(request.params.projectId, inputArtifactVersionId),
        201,
      );
    },
  );
  app.get<{ Params: ProjectParams }>(`${root}/builds`, async (request, reply) =>
    respond(reply, () => ({ items: service.listBuilds(request.params.projectId) })));
}
function respond<T>(
  reply: { code(status: number): { send(value: unknown): unknown } },
  action: () => T,
  successStatus = 200,
): T | unknown {
  try {
    const value = action();
    return successStatus === 200 ? value : reply.code(successStatus).send(value);
  } catch (error) {
    if (!(error instanceof NativeCompilationServiceError)) throw error;
    const status = error.code === "project_not_found" || error.code === "native_input_not_found" ? 404
      : error.code === "publication_not_ready" || error.code.includes("lineage") || error.code.includes("mismatch")
        ? 409 : 400;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
