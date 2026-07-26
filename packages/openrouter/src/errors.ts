export type OpenRouterErrorCode =
  | "UNAUTHENTICATED"
  | "RATE_LIMITED"
  | "PROVIDER_FAILURE"
  | "TIMEOUT"
  | "CANCELLED"
  | "SCHEMA_INVALID";

export class OpenRouterError extends Error {
  public readonly code: OpenRouterErrorCode;
  public readonly status?: number;

  public constructor(code: OpenRouterErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.code = code;
    this.status = status;
  }
}
