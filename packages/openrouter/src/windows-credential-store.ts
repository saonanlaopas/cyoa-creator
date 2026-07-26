import type { CredentialStore } from "./credential-store.js";

/** Narrow boundary around an optional native DPAPI implementation. */
export interface WindowsDpapiAdapter {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  delete(service: string): Promise<void>;
}

/**
 * This module contains no native dependency. The desktop host may pass a DPAPI
 * adapter; otherwise EnvironmentCredentialStore provides the safe env fallback.
 */
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
