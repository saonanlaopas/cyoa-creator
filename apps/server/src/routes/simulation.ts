import type { FastifyInstance } from "fastify";
import { SimulationService, SimulationServiceError } from "../services/simulation-service.js";

interface ProjectParams { projectId: string }
interface RunParams extends ProjectParams { versionId: string }

export function registerSimulationRoutes(app: FastifyInstance, service: SimulationService): void {
  app.post<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/simulation/inputs",
    async (request, reply) => respond(reply, () => service.createInput(request.params.projectId), 201),
  );

  app.get<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/simulation/inputs",
    async (request, reply) => respond(reply, () => ({
      items: service.listInputs(request.params.projectId).map((version) => ({
        versionId: version.id,
        version: version.version,
        createdAt: version.createdAt,
        inputId: version.content.id,
        snapshotId: version.content.snapshotId,
        fingerprint: version.content.fingerprint,
        runtimeFingerprint: version.content.runtimeFingerprint,
        passageCount: version.content.passageVersions.length,
        choiceCount: version.content.choiceVersions.length,
        acceptedDraftCount: version.content.acceptedDraftVersions.length,
        policy: version.content.policy,
      })),
    })),
  );

  app.post<{
    Params: ProjectParams;
    Body: {
      inputArtifactVersionId?: unknown;
      choiceIds?: unknown;
      expectedEndingId?: unknown;
      expectedState?: unknown;
    };
  }>("/api/long-form/projects/:projectId/simulation/runs", async (request, reply) => respond(reply, () => {
    if (typeof request.body?.inputArtifactVersionId !== "string" || !Array.isArray(request.body.choiceIds)
      || request.body.choiceIds.some((item) => typeof item !== "string")) {
      throw new SimulationServiceError("simulation_path_invalid", "Input version and stable choice IDs are required");
    }
    if (request.body.expectedEndingId !== undefined && request.body.expectedEndingId !== null
      && typeof request.body.expectedEndingId !== "string") {
      throw new SimulationServiceError("simulation_path_invalid", "Expected ending ID must be a stable ID or null");
    }
    if (request.body.expectedState !== undefined && (!request.body.expectedState
      || typeof request.body.expectedState !== "object" || Array.isArray(request.body.expectedState))) {
      throw new SimulationServiceError("simulation_path_invalid", "Expected state assertions must be an object");
    }
    return service.run(request.params.projectId, {
      inputArtifactVersionId: request.body.inputArtifactVersionId,
      choiceIds: request.body.choiceIds as string[],
      ...(request.body.expectedEndingId !== undefined
        ? { expectedEndingId: request.body.expectedEndingId as string | null } : {}),
      ...(request.body.expectedState ? { expectedState: request.body.expectedState } : {}),
    });
  }, 201));

  app.get<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/simulation/runs",
    async (request, reply) => respond(reply, () => ({
      items: service.listRuns(request.params.projectId).map((version) => ({
        versionId: version.id,
        version: version.version,
        createdAt: version.createdAt,
        runId: version.content.id,
        inputArtifactVersionId: version.content.inputArtifactVersionId,
        inputFingerprint: version.content.inputFingerprint,
        runtimeFingerprint: version.content.runtimeFingerprint,
        traceFingerprint: version.content.trace.fingerprint,
        result: version.content.trace.result,
        stepCount: version.content.trace.steps.length,
        findingCount: version.content.trace.findings.length,
      })),
    })),
  );

  app.get<{ Params: RunParams }>(
    "/api/long-form/projects/:projectId/simulation/runs/:versionId",
    async (request, reply) => respond(reply, () => service.getRun(request.params.projectId, request.params.versionId)),
  );
}

function respond<T>(reply: { code(status: number): { send(value: unknown): unknown } }, action: () => T, successStatus = 200): T | unknown {
  try {
    const value = action();
    return successStatus === 200 ? value : reply.code(successStatus).send(value);
  } catch (error) {
    if (!(error instanceof SimulationServiceError)) throw error;
    const status = error.code === "project_not_found" || error.code.endsWith("_not_found") ? 404
      : error.code === "simulation_path_invalid" || error.code === "simulation_path_too_large" ? 400 : 409;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
