import type { GraphFinding, Project } from "@story-to-cyoa/domain";
import type { CostRange, GenerationUsage, OpenRouterErrorCode } from "@story-to-cyoa/openrouter";
import type { ServerResponse } from "node:http";

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

export interface PublicGenerationError {
  code: OpenRouterErrorCode | "GRAPH_INVALID" | "EXPORT_FAILED" | "LOCAL_STREAM_INVALID";
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

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

/** Writes only browser-safe, typed records; raw provider chunks never cross this boundary. */
export function writeNdjson(raw: ServerResponse, event: QuickGenerationEvent): void {
  raw.write(`${JSON.stringify(event)}\n`);
}
