import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "@story-to-cyoa/persistence";

const draftName = "Untitled adaptation";

export function registerQuickDraftRoutes(app: FastifyInstance, projects: ProjectRepository): void {
  app.post("/api/quick/drafts", async (_request, reply) =>
    reply.code(201).send({ projectId: projects.create(draftName).id, name: draftName }));
}
