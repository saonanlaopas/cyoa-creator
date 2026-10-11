import type { FastifyInstance, FastifyReply } from "fastify";
import { strToU8, zipSync } from "fflate";
import { importSource } from "@story-to-cyoa/importers";
import { z } from "zod";
import type { PublicationExportService } from "../services/publication-export-service.js";
import { PORTABLE_PROJECT_LIMITS } from "../services/publication-export-service.js";

interface ProjectParams { projectId: string }
interface FormatParams extends ProjectParams { format: "portable" | "markdown" | "static" | "standalone" | "twee" }
interface Query { inputArtifactVersionId?: string; mode?: "full-fidelity" | "privacy-redacted" }

export function resolvePortableUploadLimit(configured?: number): number {
  if (configured === undefined) return PORTABLE_PROJECT_LIMITS.archiveBytes;
  if (!Number.isSafeInteger(configured) || configured <= 0) throw new Error("portable_project_upload_limit_invalid");
  return Math.min(configured, PORTABLE_PROJECT_LIMITS.archiveBytes);
}

export function registerPublicationExportRoutes(
  app: FastifyInstance,
  service: PublicationExportService,
  maximumUploadBytes: number = PORTABLE_PROJECT_LIMITS.archiveBytes,
): void {
  const uploadLimit = resolvePortableUploadLimit(maximumUploadBytes);
  app.get<{ Params: ProjectParams; Querystring: Query }>("/api/long-form/projects/:projectId/publication/twee-compatibility", async (request, reply) => {
    try { return service.inspectTwee(request.params.projectId, request.query.inputArtifactVersionId); }
    catch (error) { return reply.code(400).send({ code: "twee_compatibility_failed", error: (error as Error).message }); }
  });
  app.get<{ Params: FormatParams; Querystring: Query }>("/api/long-form/projects/:projectId/publication/exports/:format", async (request, reply) => {
    try {
      const { projectId, format } = request.params; const input = request.query.inputArtifactVersionId;
      if (format === "portable") { const mode = z.enum(["full-fidelity", "privacy-redacted"]).default("full-fidelity").parse(request.query.mode);
        const result = service.exportStudioPortable(projectId, mode); return send(reply, result.bytes, "application/zip", `cyoa-${mode}-project.zip`, result.manifest.projectFingerprint); }
      if (format === "markdown") { const result = service.exportMarkdown(projectId, input); return send(reply, strToU8(result.text), "text/markdown; charset=utf-8", "cyoa-manuscript.md", result.fingerprint); }
      if (format === "static") { const result = await service.exportStatic(projectId, input); return send(reply, result.bytes, "application/zip", "cyoa-native-static.zip", result.fingerprint); }
      if (format === "standalone") { const result = await service.exportStandalone(projectId, input); return send(reply, strToU8(result.html), "text/html; charset=utf-8", "cyoa-standalone.html", result.fingerprint); }
      if (format === "twee") {
        const result = await service.exportTwee(projectId, input); const date = new Date("1980-01-01T00:00:00.000Z");
        const archive = zipSync({ "manifest.json": [strToU8(JSON.stringify(result.manifest)), { mtime: date }], "story.twee": [strToU8(result.twee), { mtime: date }], "story.html": [result.html, { mtime: date }] }, { level: 9 });
        return send(reply, archive, "application/zip", "cyoa-twee3-sugarcube.zip", result.fingerprint);
      }
      return reply.code(404).send({ code: "export_format_unknown", error: "Unknown export format" });
    } catch (error) { return reply.code(400).send({ code: "publication_export_failed", error: (error as Error).message }); }
  });
  app.post("/api/portable-projects/preview", async (request, reply) => {
    try { return service.previewPortable(await upload(request, uploadLimit)); }
    catch (error) { return reply.code(uploadStatus(error)).send({ code: "portable_project_invalid", error: (error as Error).message }); }
  });
  app.post("/api/portable-projects/import", async (request, reply) => {
    try { return reply.code(201).send(service.importPortable(await upload(request, uploadLimit))); }
    catch (error) { return reply.code((error as Error).message.includes("conflict") ? 409 : uploadStatus(error)).send({ code: "portable_project_import_failed", error: (error as Error).message }); }
  });
  app.get<{ Params: ProjectParams; Querystring: { offset?: string } }>("/api/long-form/projects/:projectId/source-availability", (request, reply) => {
    const offset = Number(request.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return reply.code(400).send({ code: "source_offset_invalid" });
    try { return service.unavailableSourcePage(request.params.projectId, offset); }
    catch { return reply.code(404).send({ code: "source_project_not_found" }); }
  });
  app.post<{ Params: ProjectParams & { versionId: string } }>("/api/long-form/projects/:projectId/sources/:versionId/reattach", async (request, reply) => {
    try {
      const file = await request.file({ limits: { files: 1, fileSize: uploadLimit } });
      if (!file) throw new Error("source_reattachment_file_required");
      const bytes = await file.toBuffer();
      if (file.file.truncated || bytes.length > uploadLimit) throw new Error("source_reattachment_upload_too_large");
      const source = file.filename.toLowerCase().endsWith(".json") ? JSON.parse(bytes.toString("utf8"))
        : await importSource({ filename: file.filename, data: bytes, mimeType: file.mimetype, maxBytes: uploadLimit });
      return service.reattachSource(request.params.projectId, request.params.versionId, source);
    } catch (error) {
      const code = /^source_reattachment_[a-z_]+/.exec((error as Error).message)?.[0] ?? "source_reattachment_invalid";
      return reply.code(code.includes("too_large") || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" ? 413 : 400).send({ code, error: code.includes("mismatch") ? "The file does not match the archived source fingerprint. Nothing was changed." : "Could not verify this exact source. Nothing was changed." });
    }
  });
}

async function upload(request: { file(options: { limits: { files: number; fileSize: number } }): Promise<{ toBuffer(): Promise<Buffer>; file: { truncated: boolean } } | undefined> }, maximumBytes: number): Promise<Uint8Array> {
  try {
    const file = await request.file({ limits: { files: 1, fileSize: maximumBytes } });
    if (!file) throw new Error("portable_project_file_required");
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.byteLength > maximumBytes) throw new Error("portable_project_upload_too_large");
    return new Uint8Array(buffer);
  } catch (error) {
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new Error("portable_project_upload_too_large");
    throw error;
  }
}
function uploadStatus(error: unknown): 400 | 413 { return (error as Error).message.includes("upload_too_large") ? 413 : 400; }
function send(reply: FastifyReply, bytes: Uint8Array, contentType: string, filename: string, fingerprint: string) {
  return reply.header("content-type", contentType).header("content-disposition", `attachment; filename="${filename}"`)
    .header("x-cyoa-artifact-fingerprint", fingerprint).header("x-content-type-options", "nosniff").send(Buffer.from(bytes));
}
