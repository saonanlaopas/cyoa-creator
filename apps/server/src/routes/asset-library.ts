import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IMAGE_ASSET_LIMITS } from "@story-to-cyoa/domain";
import type { AssetLibraryService } from "../services/asset-library-service.js";

type Project = { projectId: string };
type Asset = Project & { assetId: string };
export function registerAssetLibrary(app: FastifyInstance, service: AssetLibraryService) {
  const base = "/api/long-form/projects/:projectId/assets";
  const onRequest = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) || !/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/.test(req.headers.host ?? "")
      || req.headers["sec-fetch-site"] === "cross-site" || req.headers.origin !== undefined && req.headers.origin !== `${req.protocol}://${req.headers.host}`) {
      return reply.code(403).send({ error: "image_same_origin_loopback_required" });
    }
  };
  const errorStatus = (error: unknown) => /processing_busy_retry/.test((error as Error).message) ? 429 : /size_exceeded|too_large|dimensions_exceeded/.test((error as Error).message) ? 413
    : /stale|conflict|current_candidate_required/.test((error as Error).message) ? 409 : /not_found|unavailable/.test((error as Error).message) ? 404 : 400;
  app.get<{ Params: Project; Querystring: { search?: string; offset?: string } }>(base, { onRequest }, async (req, reply) => {
    try { return await service.call("list_assets", { ...req.params, search: req.query.search ?? "", offset: Number(req.query.offset ?? 0) }); }
    catch (error) { return reply.code(errorStatus(error)).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: Project & { hash: string } }>(`${base}/files/:hash`, { onRequest }, async (req, reply) => {
    try { const file = service.file(req.params.projectId, req.params.hash);
      return reply.header("Content-Type", "image/png").header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox").header("Cache-Control", "private, max-age=31536000, immutable")
        .header("ETag", `"${file.sha256}"`).send(Buffer.from(file.base64, "base64"));
    } catch (error) { return reply.code(errorStatus(error)).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: Asset; Querystring: { versionId?: string; offset?: string } }>(`${base}/:assetId`, { onRequest }, async (req, reply) => {
    try { return await service.call("read_asset", { ...req.params, ...(req.query.versionId ? { versionId: req.query.versionId } : {}), offset: Number(req.query.offset ?? 0) }); }
    catch (error) { return reply.code(errorStatus(error)).send({ error: (error as Error).message }); }
  });
  for (const [path, tool] of [["usage", "asset_usage"], ["review", "review_asset"]] as const) {
    app.get<{ Params: Asset; Querystring: { versionId?: string } }>(`${base}/:assetId/${path}`, { onRequest }, async (req, reply) => {
      try { return await service.call(tool, { ...req.params, ...(path === "review" ? { versionId: req.query.versionId } : {}) }); }
      catch (error) { return reply.code(errorStatus(error)).send({ error: (error as Error).message }); }
    });
  }
  for (const [path, tool] of [["revise", "revise_asset"], ["approve", "approve_asset"], ["reject", "reject_asset"]] as const) {
    app.post<{ Params: Asset; Body: Record<string, unknown> }>(`${base}/:assetId/${path}`, { onRequest }, async (req, reply) => {
      try { return reply.code(201).send(await service.call(tool, { ...req.body, ...req.params })); }
      catch (error) { return reply.code(errorStatus(error)).send({ error: (error as Error).message }); }
    });
  }
  app.post<{ Params: Project }>(`${base}/candidates`, { onRequest, bodyLimit: IMAGE_ASSET_LIMITS.inputBytes + 20000 }, async (req, reply) => {
    try {
      let input: unknown, bytes: Buffer | undefined, name = "", mime = "";
      for await (const part of req.parts({ limits: { files: 1, fields: 1, parts: 2, fileSize: IMAGE_ASSET_LIMITS.inputBytes, fieldSize: 12000 } })) {
        if (part.type === "file") {
          if (bytes || part.fieldname !== "file") throw new Error("image_single_file_required");
          bytes = await part.toBuffer(); name = part.filename; mime = part.mimetype;
          if (part.file.truncated) throw new Error("image_upload_size_exceeded");
        } else {
          if (input || part.fieldname !== "metadata" || part.valueTruncated || typeof part.value !== "string") throw new Error("image_metadata_required");
          input = JSON.parse(part.value);
        }
      }
      if (!bytes || !input || typeof input !== "object" || Array.isArray(input)) throw new Error("image_file_and_metadata_required");
      return reply.code(201).send(await service.upload({ ...input, projectId: req.params.projectId }, bytes, name, mime));
    } catch (error) { return reply.code((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" ? 413 : errorStatus(error)).send({ error: (error as Error).message }); }
  });
}
