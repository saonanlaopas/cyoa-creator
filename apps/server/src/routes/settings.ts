import type { FastifyInstance } from "fastify";

/** Structural contracts keep this route independently compilable until app wiring. */
export interface CredentialStore {
  getOpenRouterKey(): Promise<string | null>;
  setOpenRouterKey(value: string): Promise<void>;
  deleteOpenRouterKey(): Promise<void>;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt: number; completion: number };
  supportedParameters: string[];
}

export interface ModelCatalogClient {
  listModels(signal?: AbortSignal): Promise<OpenRouterModel[]>;
}

export interface SettingsStore {
  getPreset(): Promise<string | null>;
  setPreset(value: string | null): Promise<void>;
  getSpendingCap(): Promise<number | null>;
  setSpendingCap(value: number | null): Promise<void>;
}

export class InMemorySettingsStore implements SettingsStore {
  private preset: string | null = null;
  private spendingCap: number | null = null;

  public async getPreset(): Promise<string | null> { return this.preset; }
  public async setPreset(value: string | null): Promise<void> { this.preset = value; }
  public async getSpendingCap(): Promise<number | null> { return this.spendingCap; }
  public async setSpendingCap(value: number | null): Promise<void> { this.spendingCap = value; }
}

export interface SettingsRoutesOptions {
  credentials: CredentialStore;
  client: ModelCatalogClient;
  settings?: SettingsStore;
}

/** Browser-safe settings routes: none return credential values or echo request keys. */
export async function registerSettingsRoutes(
  app: FastifyInstance,
  options: SettingsRoutesOptions,
): Promise<void> {
  const settings = options.settings ?? new InMemorySettingsStore();

  app.get("/api/settings/openrouter", async () => ({
    configured: Boolean(await options.credentials.getOpenRouterKey()),
  }));

  app.put<{ Body: { apiKey?: unknown } }>("/api/settings/openrouter", async (request, reply) => {
    const key = typeof request.body?.apiKey === "string" ? request.body.apiKey.trim() : "";
    if (!key) return reply.code(400).send({ error: "apiKey is required" });
    await options.credentials.setOpenRouterKey(key);
    return { configured: true };
  });

  app.delete("/api/settings/openrouter", async () => {
    await options.credentials.deleteOpenRouterKey();
    return { configured: Boolean(await options.credentials.getOpenRouterKey()) };
  });

  app.post("/api/settings/models/refresh", async (): Promise<{ models: OpenRouterModel[] }> => ({
    models: await options.client.listModels(),
  }));

  app.get("/api/settings/preferences", async () => ({
    preset: await settings.getPreset(),
    spendingCap: await settings.getSpendingCap(),
  }));

  app.put<{ Body: { preset?: unknown } }>("/api/settings/preset", async (request, reply) => {
    const preset = request.body?.preset;
    if (preset !== null && typeof preset !== "string") return reply.code(400).send({ error: "preset must be a string or null" });
    await settings.setPreset(preset ?? null);
    return { preset: await settings.getPreset() };
  });

  app.put<{ Body: { spendingCap?: unknown } }>("/api/settings/spending-cap", async (request, reply) => {
    const cap = request.body?.spendingCap;
    if (cap !== null && (typeof cap !== "number" || !Number.isFinite(cap) || cap < 0)) {
      return reply.code(400).send({ error: "spendingCap must be a non-negative number or null" });
    }
    await settings.setSpendingCap(cap ?? null);
    return { spendingCap: await settings.getSpendingCap() };
  });
}
