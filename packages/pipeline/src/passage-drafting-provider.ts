export interface PassageDraftingProviderRequest {
  mode: "generate" | "repair";
  jobId: string;
  unitId: string;
  providerId: string;
  modelId: string;
  inputFingerprint: string;
  contextFingerprint: string;
  boundedContext: unknown;
  outputSchema: { id: string; version: number };
  capabilityRequirements: { structuredOutput: boolean; localValidation: boolean };
  maximumOutputTokens: number;
  repair?: { malformedOutput: string; validationIssues: string[] };
  signal: AbortSignal;
}

export interface PassageDraftingProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface PassageDraftingProviderResult {
  output: string;
  usage?: PassageDraftingProviderUsage;
  providerRepairCount?: number;
  providerMetadata?: Record<string, unknown>;
}

export interface PassageDraftingProvider {
  readonly id: string;
  readonly capabilities: { structuredOutput: boolean };
  generate(request: PassageDraftingProviderRequest): Promise<PassageDraftingProviderResult>;
}

export interface NormalizedPassageDraftingError {
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: number;
}

export function normalizePassageDraftingError(error: unknown): NormalizedPassageDraftingError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "cancelled", message: "Passage-drafting request was cancelled.", retryable: true };
  }
  if (error && typeof error === "object") {
    const item = error as { code?: unknown; message?: unknown; retryable?: unknown; status?: unknown };
    return {
      code: typeof item.code === "string" ? item.code : "drafting_provider_error",
      message: typeof item.message === "string" ? item.message : "Passage-drafting provider failed.",
      retryable: typeof item.retryable === "boolean" ? item.retryable : true,
      providerStatus: typeof item.status === "number" ? item.status : undefined,
    };
  }
  return { code: "drafting_provider_error", message: String(error), retryable: true };
}
