import fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ArtifactRepository, JobRepository, openDatabase, ProjectRepository } from "@story-to-cyoa/persistence";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { JobRunner } from "@story-to-cyoa/pipeline";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerImportRoutes } from "./routes/import.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerAdaptationRoutes } from "./routes/adaptation.js";
import { registerRouteGraphRoutes } from "./routes/routes.js";
import { registerPassageRoutes } from "./routes/passages.js";
import { registerConversationRoutes } from "./routes/conversation.js";

export interface BuildAppOptions {
  databasePath?: string;
  maxImportBytes?: number;
}

const webDistPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false });
  const database = openDatabase(options.databasePath ?? ":memory:");
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const runner = new JobRunner(new JobRepository(database));
  const credentials = new EnvironmentCredentialStore();
  const openRouter = new OpenRouterClient({ credentialStore: credentials });
  void app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: options.maxImportBytes ?? 25 * 1024 * 1024 },
  });
  app.addHook("onClose", async () => database.close());

  app.get("/api/health", async () => ({
    ok: true,
    service: "story-to-cyoa",
  }));

  registerProjectRoutes(app, projects, artifacts);
  registerImportRoutes(app, projects, artifacts, options.maxImportBytes ?? 25 * 1024 * 1024);
  void registerSettingsRoutes(app, { credentials, client: openRouter });
  registerJobRoutes(app, runner);
  registerAnalysisRoutes(app, projects, artifacts, runner);
  registerAdaptationRoutes(app, artifacts);
  registerRouteGraphRoutes(app, artifacts);
  registerPassageRoutes(app, artifacts);
  registerConversationRoutes(app, artifacts);

  if (existsSync(webDistPath)) {
    void app.register(fastifyStatic, {
      root: webDistPath,
      index: ["index.html"],
    });
  }

  return app;
}
