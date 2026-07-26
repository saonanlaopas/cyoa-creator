import type { FastifyInstance, FastifyReply } from "fastify";
import type { CommandRepository, InstructionCommand, ProjectRepository } from "@story-to-cyoa/persistence";

type ProjectParams = { projectId: string };
type CommandParams = ProjectParams & { commandId: string };
type GlobalCommandParams = { commandId: string };
type CommandBody = { name?: unknown; instruction?: unknown; enabled?: unknown; position?: unknown };
type ValidatedCommandInput = { name: string; instruction: string; enabled?: boolean; position?: number };

const sendError = (reply: FastifyReply, statusCode: number, error: string) => reply.code(statusCode).send({ error });

function validateText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

const isPosition = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function validateCreateBody(body: CommandBody | undefined): { value?: ValidatedCommandInput; error?: string } {
  const name = validateText(body?.name);
  if (!name) return { error: "name must be a non-empty string" };
  const instruction = validateText(body?.instruction);
  if (!instruction) return { error: "instruction must be a non-empty string" };
  if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return { error: "enabled must be a boolean" };
  if (body?.position !== undefined && !isPosition(body.position)) {
    return { error: "position must be a non-negative integer" };
  }
  return { value: { name, instruction, ...(body?.enabled === undefined ? {} : { enabled: body.enabled }), ...(body?.position === undefined ? {} : { position: body.position }) } };
}

function validatePatchBody(body: CommandBody | undefined): { value?: Partial<Pick<InstructionCommand, "name" | "instruction" | "enabled" | "position">>; error?: string } {
  if (!body || (body.name === undefined && body.instruction === undefined && body.enabled === undefined && body.position === undefined)) {
    return { error: "command update is required" };
  }
  if (body.name !== undefined && !validateText(body.name)) return { error: "name must be a non-empty string" };
  if (body.instruction !== undefined && !validateText(body.instruction)) return { error: "instruction must be a non-empty string" };
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return { error: "enabled must be a boolean" };
  if (body.position !== undefined && !isPosition(body.position)) return { error: "position must be a non-negative integer" };
  return {
    value: {
      ...(body.name === undefined ? {} : { name: validateText(body.name)! }),
      ...(body.instruction === undefined ? {} : { instruction: validateText(body.instruction)! }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.position === undefined ? {} : { position: body.position }),
    },
  };
}

export function registerCommandRoutes(app: FastifyInstance, projects: ProjectRepository, commands: CommandRepository): void {
  const projectExists = (projectId: string, reply: FastifyReply): boolean => {
    if (projects.get(projectId)) return true;
    sendError(reply, 404, "Project not found");
    return false;
  };
  const projectCommand = (projectId: string, commandId: string) =>
    commands.list({ scope: "project", projectId }).find((command) => command.id === commandId);
  const globalCommand = (commandId: string) => commands.list({ scope: "global" }).find((command) => command.id === commandId);

  app.get("/api/commands/global", async () => commands.list({ scope: "global" }));
  app.post<{ Body: CommandBody }>("/api/commands/global", async (request, reply) => {
    const body = validateCreateBody(request.body);
    if (!body.value) return sendError(reply, 400, body.error!);
    return reply.code(201).send(commands.create({ ...body.value, scope: "global" }));
  });
  app.patch<{ Params: GlobalCommandParams; Body: CommandBody }>("/api/commands/global/:commandId", async (request, reply) => {
    const body = validatePatchBody(request.body);
    if (!body.value) return sendError(reply, 400, body.error!);
    if (!globalCommand(request.params.commandId)) return sendError(reply, 404, "Command not found");
    return commands.update(request.params.commandId, body.value);
  });
  app.delete<{ Params: GlobalCommandParams }>("/api/commands/global/:commandId", async (request, reply) => {
    if (!globalCommand(request.params.commandId)) return sendError(reply, 404, "Command not found");
    commands.delete(request.params.commandId);
    return reply.code(204).send();
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/commands/effective", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    return commands.listEffective(request.params.projectId);
  });
  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/commands", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    return commands.list({ scope: "project", projectId: request.params.projectId });
  });
  app.post<{ Params: ProjectParams; Body: CommandBody }>("/api/projects/:projectId/commands", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    const body = validateCreateBody(request.body);
    if (!body.value) return sendError(reply, 400, body.error!);
    return reply.code(201).send(commands.create({ ...body.value, scope: "project", projectId: request.params.projectId }));
  });
  app.patch<{ Params: CommandParams; Body: CommandBody }>("/api/projects/:projectId/commands/:commandId", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    const body = validatePatchBody(request.body);
    if (!body.value) return sendError(reply, 400, body.error!);
    if (!projectCommand(request.params.projectId, request.params.commandId)) return sendError(reply, 404, "Command not found");
    return commands.update(request.params.commandId, body.value);
  });
  app.delete<{ Params: CommandParams }>("/api/projects/:projectId/commands/:commandId", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    if (!projectCommand(request.params.projectId, request.params.commandId)) return sendError(reply, 404, "Command not found");
    commands.delete(request.params.commandId);
    return reply.code(204).send();
  });
  app.post<{ Params: CommandParams }>("/api/projects/:projectId/commands/:commandId/promote", async (request, reply) => {
    if (!projectExists(request.params.projectId, reply)) return;
    const command = projectCommand(request.params.projectId, request.params.commandId);
    if (!command) return sendError(reply, 404, "Command not found");
    return reply.code(201).send(commands.create({
      scope: "global",
      name: command.name,
      instruction: command.instruction,
      enabled: command.enabled,
      position: command.position,
    }));
  });
}
