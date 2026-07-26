import { ProjectSchema, type GraphFinding, type Project } from "@story-to-cyoa/domain";

export type GenerationStage =
  | "preparing"
  | "request"
  | "receiving"
  | "schema-validation"
  | "structured-repair"
  | "graph-validation"
  | "graph-repair"
  | "export"
  | "complete"
  | "failed";

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

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostRange {
  currency: "USD";
  input: number;
  output: number;
  total: number;
}

export interface PublicGenerationError {
  code: OpenRouterErrorCode | "GRAPH_INVALID" | "EXPORT_FAILED" | "LOCAL_STREAM_INVALID";
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface InstructionCommand {
  id: string;
  scope: "global" | "project";
  projectId: string | null;
  name: string;
  instruction: string;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type GameplayEffect = Project["passages"][number]["choices"][number]["effects"][number];
export type GameplayProject = Project;

export interface QuickGenerationResult {
  project: Project;
  twee: string;
  html: string;
  compiler: string;
  findings: GraphFinding[];
  usage: GenerationUsage;
  cost: CostRange | null;
}

export type QuickGenerationEvent =
  | { type: "status"; stage: GenerationStage; message: string; at: string }
  | { type: "reasoning"; kind: "text" | "summary" | "encrypted" | "unavailable"; text?: string; at: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number; at: string }
  | { type: "validation"; phase: "schema" | "graph"; findings: unknown[]; at: string }
  | { type: "repair"; phase: "structured-output" | "graph"; attempt: 1; at: string }
  | { type: "result"; generation: QuickGenerationResult; at: string }
  | { type: "error"; error: PublicGenerationError; diagnosticId?: string; at: string };

export interface QuickGenerationInput {
  projectId: string;
  source: string;
  instructions?: string;
  model: string;
  targetPassages?: number;
  showReasoning?: boolean;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export class LocalStreamError extends Error implements PublicGenerationError {
  readonly code = "LOCAL_STREAM_INVALID" as const;
  readonly retryable = true;

  constructor(message: string, readonly rawLine?: string) {
    super(message);
    this.name = "LocalStreamError";
  }
}

export async function consumeNdjson(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: QuickGenerationEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeLines(buffer, onEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseLine(buffer, onEvent);
  } finally {
    reader.releaseLock();
  }
}

function consumeLines(buffer: string, onEvent: (event: QuickGenerationEvent) => void): string {
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    if (line.trim()) parseLine(line, onEvent);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
  }
  return buffer;
}

function parseLine(line: string, onEvent: (event: QuickGenerationEvent) => void): void {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new LocalStreamError("The generation stream contained malformed JSON.", line);
  }
  if (!isQuickGenerationEvent(value)) {
    throw new LocalStreamError("The generation stream contained an invalid event.", line);
  }
  onEvent(value.type === "reasoning" ? { ...value, text: undefined } : value);
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isQuickGenerationEvent(value: unknown): value is QuickGenerationEvent {
  if (!isRecord(value) || !isString(value.type) || !isString(value.at)) return false;
  switch (value.type) {
    case "status": return isGenerationStage(value.stage) && isString(value.message);
    case "reasoning": return isReasoningKind(value.kind) && (value.text === undefined || isString(value.text));
    case "usage": return isNumber(value.inputTokens) && isNumber(value.outputTokens) && isNumber(value.totalTokens);
    case "validation": return (value.phase === "schema" || value.phase === "graph") && Array.isArray(value.findings);
    case "repair": return (value.phase === "structured-output" || value.phase === "graph") && value.attempt === 1;
    case "result": return isQuickGenerationResult(value.generation);
    case "error": return isPublicGenerationError(value.error) && (value.diagnosticId === undefined || isString(value.diagnosticId));
    default: return false;
  }
}

function isQuickGenerationResult(value: unknown): value is QuickGenerationResult {
  if (!isRecord(value) || !isString(value.twee) || !isString(value.html) || !isString(value.compiler) ||
    !Array.isArray(value.findings) || !isUsage(value.usage) || !(value.cost === null || isCost(value.cost))) return false;
  if (!ProjectSchema.safeParse(value.project).success) return false;
  return value.findings.every(isGraphFinding);
}

function isUsage(value: unknown): value is GenerationUsage {
  return isRecord(value) && isNumber(value.inputTokens) && isNumber(value.outputTokens) && isNumber(value.totalTokens);
}

function isCost(value: unknown): value is CostRange {
  return isRecord(value) && value.currency === "USD" && isNumber(value.input) && isNumber(value.output) && isNumber(value.total);
}

function isGraphFinding(value: unknown): value is GraphFinding {
  return isRecord(value) && isString(value.code) && isString(value.severity) &&
    ["missing_start", "duplicate_passage", "missing_destination", "unreachable_passage", "unreachable_ending", "no_reachable_ending", "variable_read_before_initialization"].includes(value.code) &&
    ["error", "warning", "info"].includes(value.severity) &&
    (value.passageId === undefined || isString(value.passageId)) && (value.choiceId === undefined || isString(value.choiceId)) && (value.detail === undefined || isString(value.detail));
}

function isGenerationStage(value: unknown): value is GenerationStage {
  return ["preparing", "request", "receiving", "schema-validation", "structured-repair", "graph-validation", "graph-repair", "export", "complete", "failed"].includes(value as string);
}

function isReasoningKind(value: unknown): boolean {
  return ["text", "summary", "encrypted", "unavailable"].includes(value as string);
}

function isPublicGenerationError(value: unknown): value is PublicGenerationError {
  return isRecord(value) && isString(value.code) && isString(value.message) && typeof value.retryable === "boolean" &&
    (value.retryAfterSeconds === undefined || isNumber(value.retryAfterSeconds));
}

export async function streamQuickGeneration(
  input: QuickGenerationInput,
  onEvent: (event: QuickGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/quick/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) throw await httpError(response);
  await consumeNdjson(response.body, onEvent);
}

export async function httpError(response: Response): Promise<PublicGenerationError> {
  const fallback = `Generation request failed (${response.status}).`;
  try {
    const value = await response.json() as unknown;
    if (isRecord(value) && isPublicGenerationError(value.error)) return value.error;
    if (isRecord(value) && isString(value.error)) {
      return { code: "PROVIDER_FAILURE", message: value.error, retryable: response.status >= 500 };
    }
  } catch {
    // Non-JSON error bodies are intentionally reduced to a browser-safe fallback.
  }
  return { code: "PROVIDER_FAILURE", message: fallback, retryable: response.status >= 500 };
}
