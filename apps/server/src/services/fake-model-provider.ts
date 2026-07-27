import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boundedDiagnosticBody, OpenRouterError, type GenerationAttempt, type GenerationResult, type GenerationUsage, type OpenRouterClient, type ReasoningEvent, type StreamCallbacks, type StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";

type ParseSchema<T> = { parse(value: unknown): T };

interface OfflineFixture {
  success: {
    reasoning: ReasoningEvent;
    usage: GenerationUsage;
    repairAttempt: number;
    project: unknown;
  };
  nonJsonFailure: {
    status: number;
    contentType: string;
    requestId: string;
    body: string;
  };
}

/**
 * E2E-only deterministic provider. It never reads a credential or opens a network connection.
 * Set E2E_FAKE_MODEL_PROVIDER=1 before constructing the application to use it.
 */
export class FakeModelProvider {
  private readonly fixture: OfflineFixture;

  public constructor(fixturePath = resolve(process.cwd(), "e2e", "fixtures", "fake-model-responses.json")) {
    this.fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as OfflineFixture;
  }

  public async generateStructuredStream<T>(
    request: StructuredGenerationStreamRequest,
    schema: ParseSchema<T>,
    callbacks: StreamCallbacks & { onRepair?: (attempt: number) => void } = {},
  ): Promise<GenerationResult<T>> {
    if (request.model === "e2e/non-json") throw this.nonJsonFailure();

    const { success } = this.fixture;
    callbacks.onReasoning?.(success.reasoning);
    callbacks.onUsage?.(success.usage);
    callbacks.onRepair?.(success.repairAttempt);
    // Leave the emitted repair observable in a browser frame before completing the stream.
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 150));
    const data = schema.parse(success.project);
    const attempt = this.attempt(success.usage);
    return { data, usage: success.usage, cost: null, repaired: true, attempts: [attempt] };
  }

  private attempt(usage: GenerationUsage): GenerationAttempt {
    return {
      usage,
      cost: null,
      provider: "offline-e2e",
      generationId: "offline-success",
      diagnostic: {
        status: 200,
        contentType: "application/json",
        requestId: "offline-success",
        retryAfter: null,
        body: boundedDiagnosticBody("{\"offline\":true}"),
        provider: "offline-e2e",
        generationId: "offline-success",
      },
    };
  }

  private nonJsonFailure(): OpenRouterError {
    const failure = this.fixture.nonJsonFailure;
    return new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "Offline provider emitted an HTML response", {
      status: failure.status,
      diagnostic: {
        status: failure.status,
        contentType: failure.contentType,
        requestId: failure.requestId,
        retryAfter: null,
        body: boundedDiagnosticBody(failure.body),
        provider: "offline-e2e",
        generationId: "offline-non-json",
      },
    });
  }
}

export function createOfflineE2EClient(): OpenRouterClient {
  return new FakeModelProvider() as unknown as OpenRouterClient;
}
