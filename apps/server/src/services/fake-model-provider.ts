import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boundedDiagnosticBody, OpenRouterError, type GenerationAttempt, type GenerationResult, type GenerationUsage, type OpenRouterClient, type ReasoningEvent, type StreamCallbacks, type StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";
import { defaultProjectBrief } from "@story-to-cyoa/pipeline";

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
 * It is selected only when NODE_ENV=test and E2E_FAKE_MODEL_PROVIDER=1.
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
    if (request.model === "e2e/chat") {
      const prompt = request.messages.at(-1)?.content ?? "";
      const briefMatch = prompt.match(/Current project brief:\n(.+)\n\nRecent scoped discussion:/s);
      const currentBrief = briefMatch
        ? JSON.parse(briefMatch[1]) as ReturnType<typeof defaultProjectBrief>
        : defaultProjectBrief("The Long-form E2E Project");
      const proposing = prompt.includes("User intent: propose");
      callbacks.onReasoning?.({ kind: "summary" });
      const usage = { inputTokens: 80, outputTokens: 30, totalTokens: 110 };
      return {
        data: schema.parse({
          message: proposing
            ? "I prepared a six-route version for review."
            : "Five routes is a practical baseline; six gives secondary relationships more room.",
          proposal: proposing
            ? {
                summary: "Expand the brief to six routes",
                rationale: "A sixth route creates more room for relationship consequences.",
                candidate: { ...currentBrief, routeTarget: 6 },
              }
            : null,
        }),
        usage,
        cost: null,
        repaired: false,
        attempts: [this.attempt(usage)],
      };
    }

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
