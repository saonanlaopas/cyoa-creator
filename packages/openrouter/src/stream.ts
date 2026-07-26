import type { GenerationUsage } from "./client.js";
import { boundedDiagnosticBody, type OpenRouterDiagnostic } from "./diagnostics.js";
import { OpenRouterError, type OpenRouterErrorCode } from "./errors.js";
import { redactValue } from "./redact.js";

export type ReasoningKind = "text" | "summary" | "encrypted" | "unavailable";

/** Reasoning callback payload; the callback makes a redundant event type unnecessary. */
export type ReasoningEvent = { kind: ReasoningKind; text?: string };

export type OpenRouterStreamEvent =
  | { type: "content"; text: string }
  | ({ type: "reasoning" } & ReasoningEvent)
  | { type: "usage"; usage: GenerationUsage };

export interface StreamCallbacks {
  onContent?: (text: string) => void;
  onReasoning?: (event: ReasoningEvent) => void;
  onUsage?: (usage: GenerationUsage) => void;
}

export interface StreamedCompletion {
  content: string;
  usage: GenerationUsage;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  reportedCost: unknown;
  diagnostic: OpenRouterDiagnostic;
}

interface StreamState {
  content: string;
  usage: GenerationUsage;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  reportedCost: unknown;
  finished: boolean;
}

/** Parses an OpenRouter SSE completion without retaining its source or reasoning body. */
export async function parseOpenRouterStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamedCompletion> {
  const diagnostic = streamDiagnostic(response);
  if (!response.body) {
    if (!response.ok) throw providerError(diagnostic);
    throw new OpenRouterError("STREAM_INTERRUPTED", "OpenRouter returned an empty stream", { diagnostic });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: StreamState = {
    content: "",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    provider: null,
    model: null,
    generationId: null,
    reportedCost: undefined,
    finished: false,
  };
  let done = false;
  let buffer = "";
  let eventData: string[] = [];
  const onAbort = () => { void reader.cancel(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  const dispatch = () => {
    if (eventData.length === 0) return;
    const data = eventData.join("\n");
    eventData = [];
    if (data === "[DONE]") {
      done = true;
      return;
    }
    processEvent(data, state, callbacks, diagnostic);
  };
  const processLine = (line: string) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalized === "") {
      dispatch();
    } else if (normalized.startsWith("data:")) {
      eventData.push(normalized.slice(5).trimStart());
    }
  };
  const processBuffer = (final = false) => {
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      processLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (final && buffer.length > 0) {
      processLine(buffer);
      buffer = "";
    }
  };

  try {
    while (!done) {
      if (signal?.aborted) throw cancelledError(diagnostic);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal?.aborted) throw cancelledError(diagnostic);
        throw new OpenRouterError("STREAM_INTERRUPTED", "OpenRouter stream was interrupted", { diagnostic });
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      processBuffer();
    }
    buffer += decoder.decode();
    processBuffer(true);
    dispatch();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  if (signal?.aborted) throw cancelledError(diagnostic);
  if (!response.ok) throw providerError(diagnostic);
  if (!done && !state.finished) {
    throw new OpenRouterError("STREAM_INTERRUPTED", "OpenRouter stream ended before completion", { diagnostic });
  }
  return { ...state, diagnostic };
}

function processEvent(data: string, state: StreamState, callbacks: StreamCallbacks, diagnostic: OpenRouterDiagnostic): void {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "OpenRouter returned an invalid stream event", { diagnostic });
  }
  if (!isRecord(value)) {
    throw new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "OpenRouter returned an invalid stream event", { diagnostic });
  }
  if (typeof value.provider === "string") state.provider = value.provider;
  if (typeof value.model === "string") state.model = value.model;
  if (typeof value.id === "string") state.generationId = value.id;
  if (typeof value.generation_id === "string") state.generationId = value.generation_id;
  if (isRecord(value.error)) {
    const provider = providerDiagnostic(value.error, diagnostic, state);
    throw providerError(provider);
  }

  if ("cost" in value) state.reportedCost = reportedCost(value.cost);
  if (isRecord(value.usage)) {
    state.usage = usageFrom(value.usage);
    if ("cost" in value.usage) state.reportedCost = reportedCost(value.usage.cost);
    callbacks.onUsage?.(state.usage);
  }

  if (!Array.isArray(value.choices)) return;
  for (const choice of value.choices) {
    if (!isRecord(choice)) continue;
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) state.finished = true;
    if (!isRecord(choice.delta)) continue;
    const { delta } = choice;
    const content = textFrom(delta.content);
    if (content !== undefined) {
      state.content += content;
      callbacks.onContent?.(content);
    }
    const reasoning = textFrom(delta.reasoning) ?? textFrom(delta.reasoning_content);
    if (reasoning !== undefined) callbacks.onReasoning?.({ kind: "text", text: reasoning });
    if ("reasoning_details" in delta) emitReasoningDetails(delta.reasoning_details, callbacks);
  }
}

function emitReasoningDetails(details: unknown, callbacks: StreamCallbacks): void {
  if (!Array.isArray(details)) {
    callbacks.onReasoning?.({ kind: "unavailable" });
    return;
  }
  for (const detail of details) {
    if (!isRecord(detail)) {
      callbacks.onReasoning?.({ kind: "unavailable" });
      continue;
    }
    const type = typeof detail.type === "string" ? detail.type : "";
    if (type === "reasoning.summary") {
      const summary = textFrom(detail.summary) ?? textFrom(detail.text);
      callbacks.onReasoning?.(summary === undefined
        ? { kind: "unavailable" }
        : { kind: "summary", text: summary });
    } else if (type === "reasoning.encrypted") {
      callbacks.onReasoning?.({ kind: "encrypted" });
    } else if (type === "reasoning.text") {
      const text = textFrom(detail.text);
      callbacks.onReasoning?.(text === undefined
        ? { kind: "unavailable" }
        : { kind: "text", text });
    } else {
      callbacks.onReasoning?.({ kind: "unavailable" });
    }
  }
}

function usageFrom(usage: Record<string, unknown>): GenerationUsage {
  return {
    inputTokens: numberFrom(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: numberFrom(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: numberFrom(usage.total_tokens),
  };
}

function streamDiagnostic(response: Response): OpenRouterDiagnostic {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
    retryAfter: response.headers.get("retry-after"),
    body: boundedDiagnosticBody(""),
  };
}

function providerDiagnostic(error: Record<string, unknown>, diagnostic: OpenRouterDiagnostic, state?: Pick<StreamState, "provider" | "generationId">): OpenRouterDiagnostic {
  const safeError = redactValue(error);
  if (!isRecord(safeError)) return diagnostic;
  const metadata = isRecord(safeError.metadata) ? safeError.metadata : {};
  return {
    ...diagnostic,
    provider: state?.provider ?? diagnostic.provider,
    generationId: state?.generationId ?? diagnostic.generationId,
    providerError: {
      code: typeof safeError.code === "number" ? safeError.code : undefined,
      message: typeof safeError.message === "string" ? safeError.message : undefined,
      errorType: typeof metadata.error_type === "string" ? metadata.error_type : undefined,
      providerCode: typeof metadata.provider_code === "string" ? metadata.provider_code : undefined,
    },
  };
}

function reportedCost(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function providerError(diagnostic: OpenRouterDiagnostic): OpenRouterError {
  const code = providerErrorCode(diagnostic);
  const message = diagnostic.providerError?.message ?? `OpenRouter request failed (${diagnostic.status})`;
  return new OpenRouterError(code, message, { status: diagnostic.status, diagnostic });
}

function providerErrorCode(diagnostic: OpenRouterDiagnostic): OpenRouterErrorCode {
  switch (diagnostic.providerError?.errorType?.toLowerCase()) {
    case "insufficient_credits": return "INSUFFICIENT_CREDITS";
    case "rate_limit_exceeded":
    case "rate_limited": return "RATE_LIMITED";
    case "provider_unavailable": return "PROVIDER_UNAVAILABLE";
    case "provider_timeout": return "TIMEOUT";
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
    case 504: return "TIMEOUT";
    default: return "PROVIDER_FAILURE";
  }
}

function cancelledError(diagnostic: OpenRouterDiagnostic): OpenRouterError {
  return new OpenRouterError("CANCELLED", "OpenRouter request cancelled", { diagnostic });
}

function numberFrom(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function textFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
