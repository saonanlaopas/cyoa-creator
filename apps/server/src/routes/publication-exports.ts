import type { FastifyInstance, FastifyReply } from "fastify";
import { strToU8, zipSync } from "fflate";
import type { PublicationExportService } from "../services/publication-export-service.js";

interface ProjectParams { projectId: string }
interface FormatParams extends ProjectParams { format: "portable" | "markdown" | "static" | "standalone" | "twee" }
interface Query { inputArtifactVersionId?: string }

export function registerPublicationExportRoutes(app: FastifyInstance, service: PublicationExportService): void {
  app.get<{ Params: ProjectParams; Querystring: Query }>("/api/long-form/projects/:projectId/publication/twee-compatibility", async (request, reply) => {
    try { return service.inspectTwee(request.params.projectId, request.query.inputArtifactVersionId); }
    catch (error) { return reply.code(400).send({ code: "twee_compatibility_failed", error: (error as Error).message }); }
  });
  app.get<{ Params: FormatParams; Querystring: Query }>("/api/long-form/projects/:projectId/publication/exports/:format", async (request, reply) => {
    try {
      const { projectId, format } = request.params; const input = request.query.inputArtifactVersionId;
      if (format === "portable") { const result = service.exportPortable(projectId); return send(reply, result.bytes, "application/zip", "cyoa-portable-project.zip", result.manifest.projectFingerprint); }
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
    try { return service.previewPortable(await upload(request)); }
    catch (error) { return reply.code(400).send({ code: "portable_project_invalid", error: (error as Error).message }); }
  });
  app.post("/api/portable-projects/import", async (request, reply) => {
    try { return reply.code(201).send(service.importPortable(await upload(request))); }
    catch (error) { return reply.code((error as Error).message.includes("conflict") ? 409 : 400).send({ code: "portable_project_import_failed", error: (error as Error).message }); }
  });
}

async function upload(request: { file(): Promise<{ toBuffer(): Promise<Buffer> } | undefined> }): Promise<Uint8Array> {
  const file = await request.file(); if (!file) throw new Error("portable_project_file_required"); return new Uint8Array(await file.toBuffer());
}
function send(reply: FastifyReply, bytes: Uint8Array, contentType: string, filename: string, fingerprint: string) {
  return reply.header("content-type", contentType).header("content-disposition", `attachment; filename="${filename}"`)
    .header("x-cyoa-artifact-fingerprint", fingerprint).header("x-content-type-options", "nosniff").send(Buffer.from(bytes));
}
