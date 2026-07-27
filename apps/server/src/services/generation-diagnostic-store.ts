import { randomUUID } from "node:crypto";
import type { GraphFinding } from "@story-to-cyoa/domain";
import { boundedDiagnosticBody, redactValue, type OpenRouterDiagnostic } from "@story-to-cyoa/openrouter";

const MAX_DIAGNOSTIC_BODY_BYTES = 1_024;
const MIN_SOURCE_EXCERPT_LENGTH = 40;

export interface StoredGenerationDiagnostic {
  model: string;
  provider: string | null;
  generationId: string | null;
  containsSourceText: boolean;
  response: OpenRouterDiagnostic;
  schemaIssues?: Array<{ path: Array<string | number>; message: string }>;
  graphFindings?: GraphFinding[];
}

/** In-memory, one-run evidence retention. Do not use this as persistent storage. */
export class GenerationDiagnosticStore {
  private current: { id: string; value: StoredGenerationDiagnostic } | undefined;

  replace(value: StoredGenerationDiagnostic, sourceText = ""): string {
    const responseText = value.response.body.text;
    const safe = redactValue(value) as StoredGenerationDiagnostic;
    const body = boundedDiagnosticBody(responseText, MAX_DIAGNOSTIC_BODY_BYTES);
    const id = randomUUID();
    this.current = {
      id,
      value: {
        ...safe,
        containsSourceText: value.containsSourceText || containsSourceExcerpt(responseText, sourceText),
        response: { ...safe.response, body },
      },
    };
    return id;
  }

  get(id: string): StoredGenerationDiagnostic | undefined {
    return this.current?.id === id ? this.current.value : undefined;
  }

  clear(): void {
    this.current = undefined;
  }
}

function containsSourceExcerpt(responseBody: string, sourceText: string): boolean {
  const response = normalize(responseBody);
  const source = normalize(sourceText);
  if (source.length < MIN_SOURCE_EXCERPT_LENGTH || !response) return false;
  for (let offset = 0; offset <= source.length - MIN_SOURCE_EXCERPT_LENGTH; offset += MIN_SOURCE_EXCERPT_LENGTH) {
    if (response.includes(source.slice(offset, offset + MIN_SOURCE_EXCERPT_LENGTH))) return true;
  }
  return response.includes(source.slice(-MIN_SOURCE_EXCERPT_LENGTH));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
