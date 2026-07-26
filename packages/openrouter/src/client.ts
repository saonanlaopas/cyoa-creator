import { z, type ZodType } from "zod";
import type { CredentialStore } from "./credential-store.js";
import { actualCost, type CostRange } from "./cost.js";
import { parseJsonResponse, type OpenRouterDiagnostic } from "./diagnostics.js";
import { OpenRouterError } from "./errors.js";
import { parseModelCatalog, supportsStrictJsonSchema, type OpenRouterModel } from "./model-catalog.js";
import { redactSecret } from "./redact.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredGenerationRequest {
  model: string;
  messages: ChatMessage[];
  /** Use a catalog entry to enable strict JSON Schema for capable models. */
  modelCapabilities?: OpenRouterModel;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerationResult<T> {
  data: T;
  usage: GenerationUsage;
  cost: CostRange | null;
  repaired: boolean;
}

export interface OpenRouterClientOptions {
  credentialStore: CredentialStore;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost?: unknown };
  cost?: unknown;
  error?: { message?: unknown };
}

function toNumber(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function contentFrom(response: ChatResponse, diagnostic: OpenRouterDiagnostic): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "")
      .join("");
  }
  throw new OpenRouterError("COMPLETION_EMPTY", "OpenRouter returned no completion content", { diagnostic });
}

/** HTTP client with bounded retries only for locally-invalid structured output. */
export class OpenRouterClient {
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(private readonly options: OpenRouterClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  public async listModels(signal?: AbortSignal): Promise<OpenRouterModel[]> {
    const response = await this.request("/models", { method: "GET", signal });
    return parseModelCatalog((await this.json<{ data?: unknown }>(response)).data);
  }

  public async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: ZodType<T>,
  ): Promise<GenerationResult<T>> {
    let lastSchemaError: unknown;
    let lastDiagnostic: OpenRouterDiagnostic | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = attempt === 0 ? request.messages : [
        ...request.messages,
        {
          role: "system" as const,
          content: "Your previous response was invalid. Return only JSON that exactly matches the requested schema.",
        },
      ];
      const payload: Record<string, unknown> = {
        model: request.model,
        messages,
        provider: { require_parameters: true },
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      };
      if (supportsStrictJsonSchema(request.modelCapabilities)) {
        payload.response_format = {
          type: "json_schema",
          json_schema: {
            name: "structured_response",
            strict: true,
            schema: zodToJsonSchema(schema),
          },
        };
      } else {
        payload.response_format = { type: "json_object" };
      }

      const response = await this.request("/chat/completions", {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify(payload),
      });
      const { data: parsed, diagnostic } = await this.json<ChatResponse>(response);
      try {
        const raw = JSON.parse(contentFrom(parsed, diagnostic)) as unknown;
        const data = schema.parse(raw);
        const usage: GenerationUsage = {
          inputTokens: toNumber(parsed.usage?.prompt_tokens),
          outputTokens: toNumber(parsed.usage?.completion_tokens),
          totalTokens: toNumber(parsed.usage?.total_tokens),
        };
        const cost = request.modelCapabilities
          ? actualCost(request.modelCapabilities, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost: parsed.usage?.cost ?? parsed.cost,
          })
          : null;
        return { data, usage, cost, repaired: attempt === 1 };
      } catch (error) {
        if (error instanceof OpenRouterError) throw error;
        lastSchemaError = error;
        lastDiagnostic = diagnostic;
      }
    }
    throw new OpenRouterError(
      "SCHEMA_INVALID",
      `OpenRouter returned invalid structured data: ${lastSchemaError instanceof Error ? lastSchemaError.message : "unknown error"}`,
      { diagnostic: lastDiagnostic, cause: lastSchemaError },
    );
  }

  private async request(path: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
    const key = await this.options.credentialStore.getOpenRouterKey();
    if (!key) throw new OpenRouterError("UNAUTHENTICATED", "OpenRouter is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    const onAbort = () => controller.abort("cancelled");
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (controller.signal.aborted) {
        throw new OpenRouterError("CANCELLED", "OpenRouter request cancelled");
      }
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      return response;
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      if (init.signal?.aborted) throw new OpenRouterError("CANCELLED", "OpenRouter request cancelled");
      if (controller.signal.aborted) throw new OpenRouterError("TIMEOUT", "OpenRouter request timed out");
      throw new OpenRouterError("PROVIDER_FAILURE", error instanceof Error ? redactSecret(error.message) : "OpenRouter request failed", { cause: error });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async json<T = unknown>(response: Response): Promise<{ data: T; diagnostic: OpenRouterDiagnostic }> {
    try {
      const parsed = await parseJsonResponse<T>(response);
      if (parsed.diagnostic.providerError || !response.ok) {
        throw providerError(parsed.diagnostic);
      }
      return parsed;
    } catch (error) {
      if (error instanceof OpenRouterError && error.code === "OPENROUTER_ENVELOPE_INVALID" && !response.ok) {
        throw providerError(error.diagnostic!);
      }
      throw error;
    }
  }
}

function providerError(diagnostic: OpenRouterDiagnostic): OpenRouterError {
  const code = providerErrorCode(diagnostic);
  const message = diagnostic.providerError?.message ?? `OpenRouter request failed (${diagnostic.status})`;
  return new OpenRouterError(code, message, { status: diagnostic.status, diagnostic });
}

function providerErrorCode(diagnostic: OpenRouterDiagnostic): OpenRouterError["code"] {
  switch (diagnostic.providerError?.errorType?.toLowerCase()) {
    case "insufficient_credits": return "INSUFFICIENT_CREDITS";
    case "rate_limit_exceeded":
    case "rate_limited": return "RATE_LIMITED";
    case "provider_unavailable":
    case "provider_timeout": return "PROVIDER_UNAVAILABLE";
    case "content_rejected":
    case "content_policy_violation": return "CONTENT_REJECTED";
    case "unauthorized":
    case "invalid_api_key": return "UNAUTHENTICATED";
    default: break;
  }
  switch (diagnostic.status) {
    case 401: return "UNAUTHENTICATED";
    case 402: return "INSUFFICIENT_CREDITS";
    case 429: return "RATE_LIMITED";
    case 503: return "PROVIDER_UNAVAILABLE";
    default: return "PROVIDER_FAILURE";
  }
}

/** Zod v3 intentionally doesn't export JSON Schema; this covers its JSON-safe core. */
function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const def = (schema as unknown as { _def?: { typeName?: string; shape?: () => Record<string, ZodType<unknown>>; values?: string[]; innerType?: ZodType<unknown>; type?: ZodType<unknown> } })._def;
  switch (def?.typeName) {
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodArray": return { type: "array", items: zodToJsonSchema(def.type!) };
    case "ZodEnum": return { type: "string", enum: def.values };
    case "ZodOptional": return zodToJsonSchema(def.innerType!);
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value)]));
      const required = Object.entries(shape)
        .filter(([, value]) => (value as unknown as { isOptional?: () => boolean }).isOptional?.() !== true)
        .map(([key]) => key);
      return { type: "object", properties, required, additionalProperties: false };
    }
    default: return { type: "object" };
  }
}
