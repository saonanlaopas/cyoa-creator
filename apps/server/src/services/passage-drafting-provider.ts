import { createHash } from "node:crypto";
import {
  passageDraftingUnitOutputSchema,
  stableJson,
  type PassageDraftingContextPack,
  type PassageDraftingProvider,
  type PassageDraftingProviderRequest,
  type PassageDraftingProviderResult,
} from "@story-to-cyoa/pipeline";

export interface DeterministicPassageDraftingProviderOptions {
  delayMs?: number;
  failFirstAttemptForUnitIds?: string[];
  failFirstRequest?: boolean;
  malformedFirstOutputForUnitIds?: string[];
  malformedFirstSuccessfulRequest?: boolean;
  invalidRepairForUnitIds?: string[];
  oversizedOutputForUnitIds?: string[];
  oversizedPassageForUnitIds?: string[];
}

export class DeterministicPassageDraftingProvider implements PassageDraftingProvider {
  public readonly id = "offline-drafting";
  public readonly capabilities = { structuredOutput: true };
  public readonly calls: PassageDraftingProviderRequest[] = [];
  private readonly attempts = new Map<string, number>();
  private readonly contexts = new Map<string, PassageDraftingContextPack>();
  private malformedSuccessfulRequestEmitted = false;

  public constructor(private readonly options: DeterministicPassageDraftingProviderOptions = {}) {}

  async generate(request: PassageDraftingProviderRequest): Promise<PassageDraftingProviderResult> {
    this.calls.push(request);
    if (request.mode === "generate") this.contexts.set(request.unitId, request.boundedContext as PassageDraftingContextPack);
    const attempt = (this.attempts.get(request.unitId) ?? 0) + 1;
    this.attempts.set(request.unitId, attempt);
    await abortableDelay(this.options.delayMs ?? 5, request.signal);
    if ((this.options.failFirstRequest && this.calls.length === 1)
      || (this.options.failFirstAttemptForUnitIds?.includes(request.unitId) && request.mode === "generate" && attempt === 1)
      || request.modelId === "deterministic-prose-failure-v1") {
      throw Object.assign(new Error("Deterministic offline prose provider failure."), {
        code: "offline_drafting_fixture_failure", retryable: true,
      });
    }
    let output: string;
    if (this.options.oversizedOutputForUnitIds?.includes(request.unitId)
      || request.modelId === "deterministic-prose-oversized-v1") {
      output = "x".repeat(96_001);
    } else if (request.modelId === "deterministic-prose-invalid-v1") {
      output = request.mode === "generate" ? "{ malformed" : "{ still-malformed";
    } else if (request.mode === "generate" && (
      this.options.malformedFirstOutputForUnitIds?.includes(request.unitId)
      || request.modelId === "deterministic-prose-repair-v1"
      || (this.options.malformedFirstSuccessfulRequest && !this.malformedSuccessfulRequestEmitted)
    )) {
      this.malformedSuccessfulRequestEmitted = true;
      output = "{ malformed";
    } else if (request.mode === "repair" && this.options.invalidRepairForUnitIds?.includes(request.unitId)) {
      output = "{ still-malformed";
    } else {
      const context = this.contexts.get(request.unitId) ?? request.boundedContext as PassageDraftingContextPack;
      const result = outputFor(context, request.contextFingerprint);
      if (this.options.oversizedPassageForUnitIds?.includes(request.unitId)) {
        result.passages[0]!.proseMarkdown = "word ".repeat(12_000);
      }
      output = JSON.stringify(result);
    }
    return {
      output,
      usage: {
        inputTokens: Math.max(1, Math.ceil(Buffer.byteLength(stableJson(request.boundedContext), "utf8") / 4)),
        outputTokens: Math.max(1, Math.ceil(Buffer.byteLength(output, "utf8") / 4)),
        cost: 0,
      },
      providerMetadata: { deterministic: true },
    };
  }
}

function outputFor(context: PassageDraftingContextPack, contextFingerprint: string) {
  return {
    schemaId: passageDraftingUnitOutputSchema.id,
    schemaVersion: passageDraftingUnitOutputSchema.version,
    passages: context.targets.map((item) => ({
      passageId: item.content.id,
      basedOnPassagePlanVersionId: item.versionId,
      proseMarkdown: deterministicProse(item.content.title, item.content.purpose, item.content.summary, contextFingerprint),
    })),
  };
}

function deterministicProse(title: string, purpose: string, summary: string, fingerprint: string): string {
  const marker = createHash("sha256").update(`${fingerprint}\0${title}`).digest("hex").slice(0, 12);
  const intent = purpose.trim() || summary.trim() || "the planned turning point";
  return `## ${title}\n\nThe scene opens on ${intent}. Every visible choice follows the approved state and continuity obligations. This deterministic offline candidate carries marker ${marker}; it is synthetic prose for local verification, not accepted story text.`;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
