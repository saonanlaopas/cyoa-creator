/** A credential source deliberately exposes no value to browser-facing callers. */
export interface CredentialStore {
  getOpenRouterKey(): Promise<string | null>;
  setOpenRouterKey(value: string): Promise<void>;
  deleteOpenRouterKey(): Promise<void>;
}

export interface EnvironmentCredentialStoreOptions {
  environment?: NodeJS.ProcessEnv;
  /** Optional process-local secure store (for example a DPAPI-backed adapter). */
  secureStore?: CredentialStore;
}

/**
 * Keeps a user-entered key only for this process when no OS credential vault is
 * available. Environment keys always remain the fallback and are never written.
 */
export class EnvironmentCredentialStore implements CredentialStore {
  private processKey: string | null = null;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly secureStore?: CredentialStore;

  public constructor(options: EnvironmentCredentialStoreOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.secureStore = options.secureStore;
  }

  public async getOpenRouterKey(): Promise<string | null> {
    const secured = await this.secureStore?.getOpenRouterKey();
    return (secured ?? this.processKey ?? this.environment.OPENROUTER_API_KEY?.trim()) || null;
  }

  public async setOpenRouterKey(value: string): Promise<void> {
    const key = value.trim();
    if (!key) throw new Error("OpenRouter API key must not be empty");
    if (this.secureStore) return this.secureStore.setOpenRouterKey(key);
    this.processKey = key;
  }

  public async deleteOpenRouterKey(): Promise<void> {
    if (this.secureStore) await this.secureStore.deleteOpenRouterKey();
    this.processKey = null;
  }
}
