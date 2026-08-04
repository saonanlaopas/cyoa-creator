export interface PassagePlanningProviderRequest {
  jobId: string;
  unitId: string;
  providerId: string;
  modelId: string;
  inputFingerprint: string;
  boundedContext: unknown;
  outputSchema: unknown;
  maximumOutputTokens: number;
  signal: AbortSignal;
}
export interface PassagePlanningProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface PassagePlanningProviderResult {
  candidateReference?: string;
  usage?: PassagePlanningProviderUsage;
}

export interface PassagePlanningProvider {
  readonly id: string;
  generate(request: PassagePlanningProviderRequest): Promise<PassagePlanningProviderResult>;
}

export interface NormalizedPassagePlanningError {
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: number;
}

export function normalizePassagePlanningError(error: unknown): NormalizedPassagePlanningError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "cancelled", message: "Passage-planning request was cancelled.", retryable: true };
  }
  if (error && typeof error === "object") {
    const item = error as { code?: unknown; message?: unknown; retryable?: unknown; status?: unknown };
    return {
      code: typeof item.code === "string" ? item.code : "provider_error",
      message: typeof item.message === "string" ? item.message : "Passage-planning provider failed.",
      retryable: typeof item.retryable === "boolean" ? item.retryable : true,
      providerStatus: typeof item.status === "number" ? item.status : undefined,
    };
  }
  return { code: "provider_error", message: String(error), retryable: true };
}
