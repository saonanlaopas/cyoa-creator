export interface ModelPricing {
  prompt: number;
  completion: number;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: ModelPricing;
  supportedParameters: string[];
}

interface ModelApiResponse {
  data?: unknown;
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseModelCatalog(payload: ModelApiResponse): OpenRouterModel[] {
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): OpenRouterModel[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id) return [];
    const pricing = (value.pricing ?? {}) as Record<string, unknown>;
    return [{
      id: value.id,
      name: typeof value.name === "string" ? value.name : value.id,
      contextLength: Number.isFinite(Number(value.context_length))
        ? Number(value.context_length)
        : null,
      pricing: {
        prompt: numberOrZero(pricing.prompt),
        completion: numberOrZero(pricing.completion),
      },
      supportedParameters: Array.isArray(value.supported_parameters)
        ? value.supported_parameters.filter((parameter): parameter is string => typeof parameter === "string")
        : [],
    }];
  });
}

export function supportsStrictJsonSchema(model: OpenRouterModel | undefined): boolean {
  return Boolean(model?.supportedParameters.some((parameter) =>
    parameter === "response_format" || parameter === "structured_outputs",
  ));
}
