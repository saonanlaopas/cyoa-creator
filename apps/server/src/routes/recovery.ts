import type { FastifyInstance, FastifyReply } from "fastify";
import { RecoveryOperationError, PROJECT_BACKUP_LIMITS, type RecoveryService } from "../services/recovery-service.js";

interface ProjectParams { projectId: string }

export function registerRecoveryRoutes(
  app: FastifyInstance,
  service: RecoveryService,
  maximumUploadBytes = PROJECT_BACKUP_LIMITS.archiveBytes,
): void {
  const uploadLimit = resolveBackupUploadLimit(maximumUploadBytes);

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/recovery", async (request, reply) => {
    try { return service.status(request.params.projectId); }
    catch (error) { return sendRecoveryError(reply, error); }
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/recovery/backups", async (request, reply) => {
    try {
      const result = await service.createVerifiedBackup(request.params.projectId);
      return reply
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="${result.filename}"`)
        .header("x-cyoa-backup-id", result.record.backupId)
        .header("x-cyoa-artifact-fingerprint", result.record.portableProjectFingerprint)
        .header("x-cyoa-backup-verification", "verified")
        .header("x-content-type-options", "nosniff")
        .send(Buffer.from(result.bytes));
    } catch (error) { return sendRecoveryError(reply, error); }
  });

  app.post<{ Params: ProjectParams; Body: { action?: "dismiss-current" | "snooze" | "reset"; days?: number } }>(
    "/api/projects/:projectId/recovery/reminder",
    async (request, reply) => {
      try {
        if (!request.body?.action) throw new RecoveryOperationError("reminder_action_required", "A reminder action is required.");
        return service.updateReminder(request.params.projectId, { action: request.body.action, days: request.body.days });
      } catch (error) { return sendRecoveryError(reply, error); }
    },
  );

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/recovery/deletion-preview", async (request, reply) => {
    try { return service.deletionPreview(request.params.projectId); }
    catch (error) { return sendRecoveryError(reply, error); }
  });

  app.post<{ Params: ProjectParams; Body: { projectId?: string; projectFingerprint?: string } }>(
    "/api/projects/:projectId/recovery/permanent-delete",
    async (request, reply) => {
      try {
        service.deleteProject(request.params.projectId, {
          projectId: request.body?.projectId ?? "",
          projectFingerprint: request.body?.projectFingerprint ?? "",
        });
        return reply.code(204).send();
      } catch (error) { return sendRecoveryError(reply, error); }
    },
  );

  app.post("/api/recovery/backups/preview", async (request, reply) => {
    try { return await service.previewBackup(await upload(request, uploadLimit)); }
    catch (error) { return sendRecoveryError(reply, error); }
  });

  app.post("/api/recovery/backups/restore", async (request, reply) => {
    try { return reply.code(201).send(await service.restoreBackup(await upload(request, uploadLimit))); }
    catch (error) { return sendRecoveryError(reply, error); }
  });

  app.get("/api/recovery/database", async () => service.integrityCheck().compatibility);
  app.post("/api/recovery/database/integrity", async (request, reply) => {
    try { return service.integrityCheck(); }
    catch (error) { return sendRecoveryError(reply, error); }
  });
}

export function resolveBackupUploadLimit(configured?: number): number {
  if (configured === undefined) return PROJECT_BACKUP_LIMITS.archiveBytes;
  if (!Number.isSafeInteger(configured) || configured <= 0) throw new Error("project_backup_upload_limit_invalid");
  return Math.min(configured, PROJECT_BACKUP_LIMITS.archiveBytes);
}

async function upload(
  request: { file(options: { limits: { files: number; fileSize: number } }): Promise<{ toBuffer(): Promise<Buffer>; file: { truncated: boolean } } | undefined> },
  maximumBytes: number,
): Promise<Uint8Array> {
  try {
    const file = await request.file({ limits: { files: 1, fileSize: maximumBytes } });
    if (!file) throw new RecoveryOperationError("backup_file_required", "A project backup file is required.");
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.byteLength > maximumBytes) throw new RecoveryOperationError("backup_upload_too_large", "The project backup upload exceeds its byte limit.");
    return new Uint8Array(buffer);
  } catch (error) {
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      throw new RecoveryOperationError("backup_upload_too_large", "The project backup upload exceeds its byte limit.");
    }
    throw error;
  }
}

function sendRecoveryError(reply: FastifyReply, error: unknown) {
  const operation = error instanceof RecoveryOperationError
    ? error
    : new RecoveryOperationError("recovery_operation_failed", "The recovery operation failed safely.", { cause: error });
  const status = operation.code === "project_not_found" ? 404
    : operation.code.includes("conflict") ? 409
      : operation.code.includes("too_large") ? 413
        : operation.code === "delete_confirmation_stale" ? 409 : 400;
  return reply.code(status).send({ code: operation.code, error: operation.message });
}
