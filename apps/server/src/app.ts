import fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ArtifactRepository, ChangeSetRepository, CommandRepository, ConversationRepository, DraftingRepository, GenerationRepository, JobRepository, openDatabase, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PassageProposalRepository, ProjectRepository, WorkflowRepository } from "@story-to-cyoa/persistence";
import { createDefaultCredentialStore, EnvironmentCredentialStore, type CredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { JobRunner, type PassageDraftingProvider, type PassagePlanningProvider } from "@story-to-cyoa/pipeline";
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
import { registerLongFormRoutes } from "./routes/long-form.js";
import { registerLongFormChatRoutes } from "./routes/long-form-chat.js";
import { LongFormProjectService } from "./services/long-form-project-service.js";
import { PassagePlanService } from "./services/passage-plan-service.js";
import { registerPassagePlanRoutes } from "./routes/passage-plan.js";
import { registerPassageGenerationRoutes } from "./routes/passage-generation.js";
import { PassageGenerationService } from "./services/passage-generation-service.js";
import { DeterministicPassagePlanningProvider } from "./services/passage-planning-provider.js";
import { OpenRouterPassagePlanningProvider } from "./services/openrouter-passage-planning-provider.js";
import { PassageProposalService } from "./services/passage-proposal-service.js";
import { registerPassageProposalRoutes } from "./routes/passage-proposals.js";
import { PassageDraftService } from "./services/passage-draft-service.js";
import { PassageDraftingService } from "./services/passage-drafting-service.js";
import { DeterministicPassageDraftingProvider } from "./services/passage-drafting-provider.js";
import { OpenRouterPassageDraftingProvider } from "./services/openrouter-passage-drafting-provider.js";
import { registerPassageDraftRoutes } from "./routes/passage-drafts.js";
import { registerPassageDraftingRoutes } from "./routes/passage-drafting.js";

export interface BuildAppOptions {
  databasePath?: string;
  maxImportBytes?: number;
  credentials?: CredentialStore;
  openRouterClient?: OpenRouterClient;
  passagePlanningProvider?: PassagePlanningProvider;
  passageDraftingProvider?: PassageDraftingProvider;
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
  const workflow = new WorkflowRepository(database);
  const conversations = new ConversationRepository(database);
  const changeSets = new ChangeSetRepository(database);
  const passageDrafts = new PassageDraftRepository(database);
  const passageDraftAcceptance = new PassageDraftAcceptanceRepository(database, passageDrafts);
  const passagePlans = new PassagePlanRepository(
    database,
    (mutation) => passageDrafts.handlePassagePlanMutationInTransaction(mutation),
  );
  const generations = new GenerationRepository(database);
  const drafting = new DraftingRepository(database);
  const passageProposals = new PassageProposalRepository(database);
  const longFormProjects = new LongFormProjectService(
    projects, artifacts, workflow, changeSets, passagePlans, passageDrafts,
  );
  const passagePlanService = new PassagePlanService(projects, artifacts, workflow, passagePlans);
  const passageDraftService = new PassageDraftService(
    database, projects, workflow, passagePlans, passageDrafts, passageDraftAcceptance,
  );
  const useOfflineE2EProvider = process.env.NODE_ENV === "test"
    && process.env.E2E_FAKE_MODEL_PROVIDER === "1";
  const credentials = options.credentials
    ?? (useOfflineE2EProvider
      ? new EnvironmentCredentialStore({ environment: {} })
      : createDefaultCredentialStore());
  const openRouter = options.openRouterClient
    ?? (useOfflineE2EProvider
      ? createOfflineE2EClient()
      : new OpenRouterClient({ credentialStore: credentials }));
  const offlinePassageProvider = options.passagePlanningProvider ?? new DeterministicPassagePlanningProvider({
    delayMs: process.env.E2E_PASSAGE_PLANNING_DELAY_MS
      ? Number(process.env.E2E_PASSAGE_PLANNING_DELAY_MS) : undefined,
    failFirstRequest: process.env.E2E_PASSAGE_PLANNING_FAIL_FIRST === "1",
    malformedFirstSuccessfulRequest: process.env.E2E_PASSAGE_PLANNING_MALFORMED === "1",
  });
  const passageGenerationService = new PassageGenerationService(
    projects, artifacts, passagePlans, generations,
    [offlinePassageProvider, new OpenRouterPassagePlanningProvider(openRouter)],
  );
  const offlineDraftingProvider = options.passageDraftingProvider ?? new DeterministicPassageDraftingProvider({
    delayMs: process.env.E2E_PASSAGE_DRAFTING_DELAY_MS
      ? Number(process.env.E2E_PASSAGE_DRAFTING_DELAY_MS) : undefined,
    failFirstRequest: process.env.E2E_PASSAGE_DRAFTING_FAIL_FIRST === "1",
    malformedFirstSuccessfulRequest: process.env.E2E_PASSAGE_DRAFTING_MALFORMED === "1",
  });
  const passageDraftingService = new PassageDraftingService(
    projects,
    artifacts,
    workflow,
    passagePlans,
    passageDrafts,
    drafting,
    [offlineDraftingProvider, new OpenRouterPassageDraftingProvider(openRouter)],
  );
  const passageProposalService = new PassageProposalService(
    database, projects, passagePlans, generations, passageProposals, passagePlanService,
  );
  const diagnostics = new GenerationDiagnosticStore();
  const runner = new JobRunner(new JobRepository(database));
  void app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: options.maxImportBytes ?? 25 * 1024 * 1024 },
  });
  app.addHook("onClose", async () => {
    await passageDraftingService.shutdown();
    await passageGenerationService.shutdown();
    database.close();
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "story-to-cyoa",
  }));

  registerProjectRoutes(app, projects, artifacts, longFormProjects);
  registerLongFormRoutes(app, projects, artifacts, workflow, longFormProjects);
  registerLongFormChatRoutes(app, openRouter, projects, artifacts, conversations, changeSets, longFormProjects);
  registerPassagePlanRoutes(app, passagePlanService);
  registerPassageGenerationRoutes(app, passageGenerationService);
  registerPassageProposalRoutes(app, passageProposalService);
  registerPassageDraftRoutes(app, passageDraftService);
  registerPassageDraftingRoutes(app, passageDraftingService);
  registerQuickDraftRoutes(app, projects);
  registerCommandRoutes(app, projects, commands);
  registerImportRoutes(app, projects, artifacts, options.maxImportBytes ?? 25 * 1024 * 1024, workflow);
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
