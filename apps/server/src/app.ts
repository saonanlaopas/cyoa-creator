import fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ArtifactRepository, CommandRepository, JobRepository, openDatabase, ProjectRepository } from "@story-to-cyoa/persistence";
import { createDefaultCredentialStore, EnvironmentCredentialStore, type CredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
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
import { registerPlaytestRoutes } from "./routes/playtest.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerQuickGenerateRoutes } from "./routes/quick-generate.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerQuickDraftRoutes } from "./routes/quick-drafts.js";
import { GenerationDiagnosticStore } from "./services/generation-diagnostic-store.js";
import { createOfflineE2EClient } from "./services/fake-model-provider.js";

export interface BuildAppOptions {
  databasePath?: string;
  maxImportBytes?: number;
  credentials?: CredentialStore;
  openRouterClient?: OpenRouterClient;
}

const webDistPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false });
  const database = openDatabase(options.databasePath ?? ":memory:");
  const projects = new ProjectRepository(database);
  const commands = new CommandRepository(database);
  const artifacts = new ArtifactRepository(database);
  const diagnostics = new GenerationDiagnosticStore();
  const runner = new JobRunner(new JobRepository(database));
  const useOfflineE2EProvider = process.env.E2E_FAKE_MODEL_PROVIDER === "1";
  const credentials = options.credentials
    ?? (useOfflineE2EProvider
      ? new EnvironmentCredentialStore({ environment: {} })
      : createDefaultCredentialStore());
  const openRouter = options.openRouterClient
    ?? (useOfflineE2EProvider
      ? createOfflineE2EClient()
      : new OpenRouterClient({ credentialStore: credentials }));
  void app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: options.maxImportBytes ?? 25 * 1024 * 1024 },
  });
  app.addHook("onClose", async () => database.close());

  app.get("/api/health", async () => ({
    ok: true,
    service: "story-to-cyoa",
  }));

  registerProjectRoutes(app, projects, artifacts);
  registerQuickDraftRoutes(app, projects);
  registerCommandRoutes(app, projects, commands);
  registerImportRoutes(app, projects, artifacts, options.maxImportBytes ?? 25 * 1024 * 1024);
  void registerSettingsRoutes(app, { credentials, client: openRouter });
  registerJobRoutes(app, runner);
  registerAnalysisRoutes(app, projects, artifacts, runner);
  registerAdaptationRoutes(app, artifacts);
  registerRouteGraphRoutes(app, artifacts);
  registerPassageRoutes(app, artifacts);
  registerConversationRoutes(app, artifacts);
  registerPlaytestRoutes(app, projects, artifacts);
  registerExportRoutes(app, projects, artifacts);
  registerQuickGenerateRoutes(app, openRouter, projects, commands, artifacts, diagnostics);

  if (existsSync(webDistPath)) {
    void app.register(fastifyStatic, {
      root: webDistPath,
      index: ["index.html"],
    });
  }

  return app;
}
