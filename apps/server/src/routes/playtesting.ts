import type { FastifyInstance } from "fastify";
import { PlaytestPolicyError, type PlaytestPolicyRequest } from "@story-to-cyoa/runtime";
import { PlaytestService, PlaytestServiceError } from "../services/playtest-service.js";

interface ProjectParams { projectId: string }
interface CampaignParams extends ProjectParams { versionId: string }
interface SampleParams extends CampaignParams { sampleId: string }

interface CampaignBody {
  inputArtifactVersionId?: unknown;
  seed?: unknown;
  policy?: unknown;
}

export function registerPlaytestingRoutes(app: FastifyInstance, service: PlaytestService): void {
  app.post<{ Params: ProjectParams; Body: CampaignBody }>(
    "/api/long-form/projects/:projectId/simulation/playtests/policy",
    async (request, reply) => respond(reply, () => {
      const body = parseBody(request.body, false);
      return service.previewPolicy(request.params.projectId, body.inputArtifactVersionId, body.policy);
    }),
  );

  app.post<{ Params: ProjectParams; Body: CampaignBody }>(
    "/api/long-form/projects/:projectId/simulation/playtests/campaigns",
    async (request, reply) => respond(reply, () => {
      const body = parseBody(request.body, true);
      return service.runCampaign(request.params.projectId, body);
    }, 201),
  );

  app.get<{ Params: ProjectParams }>(
    "/api/long-form/projects/:projectId/simulation/playtests/campaigns",
    async (request, reply) => respond(reply, () => ({
      items: service.listCampaigns(request.params.projectId).map((version) => ({
        versionId: version.id,
        version: version.version,
        createdAt: version.createdAt,
        campaignId: version.content.id,
        fingerprint: version.content.fingerprint,
        simulationInputArtifactVersionId: version.content.simulationInputArtifactVersionId,
        simulationInputFingerprint: version.content.simulationInputFingerprint,
        runtimeFingerprint: version.content.compiledRuntimeFingerprint,
        seed: version.content.seed,
        sampleCount: version.content.actualSampleCount,
        hardFailureSampleCount: version.content.report.hardFailureSampleCount,
        passageCoveragePercentage: version.content.report.passageCoverage.percentage,
        routeCoverageCount: version.content.report.routeCoverage.filter((item) => item.sampleCount > 0).length,
        endingCoverageCount: version.content.report.endingCoverage.filter((item) => item.observedCount > 0).length,
        findingCount: version.content.findings.length,
        reportFingerprint: version.content.report.fingerprint,
      })),
    })),
  );

  app.get<{ Params: CampaignParams }>(
    "/api/long-form/projects/:projectId/simulation/playtests/campaigns/:versionId",
    async (request, reply) => respond(reply, () => service.getCampaign(request.params.projectId, request.params.versionId)),
  );

  app.post<{ Params: SampleParams }>(
    "/api/long-form/projects/:projectId/simulation/playtests/campaigns/:versionId/samples/:sampleId/replay",
    async (request, reply) => respond(reply, () => service.replay(
      request.params.projectId, request.params.versionId, request.params.sampleId,
    )),
  );
}

function parseBody(body: CampaignBody | undefined, requireSeed: boolean): {
  inputArtifactVersionId: string;
  seed: string;
  policy: PlaytestPolicyRequest;
} {
  if (typeof body?.inputArtifactVersionId !== "string" || !body.inputArtifactVersionId.trim()) {
    throw new PlaytestServiceError("playtest_request_invalid", "An exact simulation input version is required");
  }
  if (requireSeed && (typeof body.seed !== "string" || !body.seed.length)) {
    throw new PlaytestServiceError("playtest_request_invalid", "A deterministic campaign seed is required");
  }
  if (body.policy !== undefined && (!body.policy || typeof body.policy !== "object" || Array.isArray(body.policy))) {
    throw new PlaytestServiceError("playtest_request_invalid", "Playtest policy overrides must be an object");
  }
  const policy = (body.policy ?? {}) as PlaytestPolicyRequest;
  for (const key of Object.keys(policy)) if (![
    "sampleCount", "maxStepsPerSample", "maxVisitsPerPassage", "maxTraceBytesPerSample",
    "linearStretchThreshold", "denseChoiceThreshold",
  ].includes(key)) throw new PlaytestServiceError("playtest_request_invalid", `Unknown playtest policy field: ${key}`);
  return {
    inputArtifactVersionId: body.inputArtifactVersionId,
    seed: typeof body.seed === "string" ? body.seed : "policy-preview",
    policy,
  };
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
    if (error instanceof PlaytestPolicyError) {
      return reply.code(400).send({ code: error.code, error: error.message, details: error.details });
    }
    if (!(error instanceof PlaytestServiceError)) throw error;
    const status = error.code === "project_not_found" || error.code.endsWith("_not_found") ? 404
      : error.code === "playtest_request_invalid" || error.code.includes("too_large") || error.code.includes("_invalid") ? 400 : 409;
    return reply.code(status).send({ code: error.code, error: error.message, details: error.details });
  }
}
