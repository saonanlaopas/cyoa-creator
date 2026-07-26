import { EnvironmentCredentialStore, type CredentialStore } from "./credential-store.js";
import { PowerShellDpapiAdapter } from "./powershell-dpapi-adapter.js";

/** Narrow boundary around an optional native DPAPI implementation. */
export interface WindowsDpapiAdapter {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  delete(service: string): Promise<void>;
}

/** Wraps the current-user DPAPI adapter behind the application credential API. */
export class WindowsCredentialStore implements CredentialStore {
  public constructor(
    private readonly adapter: WindowsDpapiAdapter,
    private readonly service = "story-to-cyoa/openrouter",
  ) {}

  public getOpenRouterKey(): Promise<string | null> {
    return this.adapter.get(this.service);
  }

  public setOpenRouterKey(value: string): Promise<void> {
    return this.adapter.set(this.service, value);
  }

  public deleteOpenRouterKey(): Promise<void> {
    return this.adapter.delete(this.service);
  }
}

export function createDefaultCredentialStore(options: {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  localAppData?: string;
} = {}): CredentialStore {
  const platform = options.platform ?? process.platform;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const secureStore = platform === "win32" && localAppData
    ? new WindowsCredentialStore(new PowerShellDpapiAdapter({ localAppData }))
    : undefined;
  return new EnvironmentCredentialStore({ environment: options.environment, secureStore });
}
