import { OpenRouterError } from "./errors.js";
import { redactSecret, redactValue } from "./redact.js";

export interface BoundedBody {
  text: string;
  originalBytes: number;
  truncated: boolean;
}

export interface OpenRouterDiagnostic {
  status: number;
  contentType: string | null;
  requestId: string | null;
  retryAfter: string | null;
  provider?: string | null;
  generationId?: string | null;
  body: BoundedBody;
  providerError?: {
    code?: number;
    message?: string;
    errorType?: string;
    providerCode?: string;
  };
}

export function boundedDiagnosticBody(body: string, maxBytes = 1_000_000): BoundedBody {
  const safe = redactDiagnosticBody(body);
  const bytes = Buffer.byteLength(safe);
  if (bytes <= maxBytes) return { text: safe, originalBytes: bytes, truncated: false };
  const half = Math.floor(maxBytes / 2);
  return {
    text: `${Buffer.from(safe).subarray(0, half).toString()}\n…[${bytes - maxBytes} bytes omitted]…\n${Buffer.from(safe).subarray(-half).toString()}`,
    originalBytes: bytes,
    truncated: true,
  };
}

function redactDiagnosticBody(body: string): string {
  const secretRedacted = redactSecret(body);
  try {
    return JSON.stringify(redactValue(JSON.parse(secretRedacted)));
  } catch {
    return secretRedacted;
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<{ data: T; diagnostic: OpenRouterDiagnostic }> {
  const text = await response.text();
  const diagnostic: OpenRouterDiagnostic = {
    status: response.status,
    contentType: response.headers.get("content-type"),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
    retryAfter: response.headers.get("retry-after"),
    body: boundedDiagnosticBody(text),
  };
  try {
    const data = JSON.parse(text) as T;
    const providerError = extractProviderError(data);
    if (providerError) diagnostic.providerError = providerError;
    return { data, diagnostic };
  } catch (cause) {
    throw new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "OpenRouter returned invalid JSON", {
      status: response.status,
      diagnostic,
      cause,
    });
  }
}

function extractProviderError(value: unknown): OpenRouterDiagnostic["providerError"] | undefined {
  const redacted = redactValue(value);
  if (!isRecord(redacted) || !isRecord(redacted.error)) return undefined;
  const error = redacted.error;
  const metadata = isRecord(error.metadata) ? error.metadata : {};
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;
  const errorType = typeof metadata.error_type === "string" ? metadata.error_type : undefined;
  const providerCode = typeof metadata.provider_code === "string" ? metadata.provider_code : undefined;
  return code === undefined && message === undefined && errorType === undefined && providerCode === undefined
    ? undefined
    : { code, message, errorType, providerCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
