import type { OpenRouterDiagnostic } from "./diagnostics.js";

export type OpenRouterErrorCode =
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "CONTENT_REJECTED"
  | "PROVIDER_FAILURE"
  | "TIMEOUT"
  | "CANCELLED"
  | "OPENROUTER_ENVELOPE_INVALID"
  | "STREAM_INTERRUPTED"
  | "COMPLETION_EMPTY"
  | "COMPLETION_JSON_INVALID"
  | "SCHEMA_INVALID";

export interface OpenRouterErrorOptions {
  status?: number;
  diagnostic?: OpenRouterDiagnostic;
  cause?: unknown;
  schemaIssues?: Array<{ path: Array<string | number>; message: string }>;
}

export class OpenRouterError extends Error {
  public readonly code: OpenRouterErrorCode;
  public readonly status?: number;
  public readonly diagnostic?: OpenRouterDiagnostic;
  public readonly schemaIssues?: Array<{ path: Array<string | number>; message: string }>;

  public constructor(code: OpenRouterErrorCode, message: string, options: OpenRouterErrorOptions = {}) {
    if (options.cause === undefined) super(message);
    else super(message, { cause: options.cause });
    this.name = "OpenRouterError";
    this.code = code;
    this.status = options.status;
    this.diagnostic = options.diagnostic;
    this.schemaIssues = options.schemaIssues;
  }
}
