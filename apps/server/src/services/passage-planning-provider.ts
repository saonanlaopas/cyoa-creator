import type {
  PassagePlanningContextPack,
  PassagePlanningProvider,
  PassagePlanningProviderRequest,
  PassagePlanningProviderResult,
} from "@story-to-cyoa/pipeline";
import { passagePlanningCandidateSchema } from "@story-to-cyoa/pipeline";

export interface DeterministicPassagePlanningProviderOptions {
  delayMs?: number;
  failFirstAttemptForUnitIds?: string[];
  failFirstRequest?: boolean;
  malformedFirstOutputForUnitIds?: string[];
  malformedFirstSuccessfulRequest?: boolean;
  invalidRepairForUnitIds?: string[];
  oversizedRepairOutputForUnitIds?: string[];
  oversizedOutputForUnitIds?: string[];
}

export class DeterministicPassagePlanningProvider implements PassagePlanningProvider {
  public readonly id = "offline-kernel";
  public readonly capabilities = { structuredOutput: true };
  public calls: PassagePlanningProviderRequest[] = [];
  private readonly attempts = new Map<string, number>();
  private readonly contexts = new Map<string, PassagePlanningContextPack>();
  private malformedSuccessfulRequestEmitted = false;

  public constructor(private readonly options: DeterministicPassagePlanningProviderOptions = {}) {}

  async generate(request: PassagePlanningProviderRequest): Promise<PassagePlanningProviderResult> {
    this.calls.push(request);
    if (request.mode === "generate") this.contexts.set(request.unitId, request.boundedContext as PassagePlanningContextPack);
    const attempt = (this.attempts.get(request.unitId) ?? 0) + 1;
    this.attempts.set(request.unitId, attempt);
    await abortableDelay(this.options.delayMs ?? 5, request.signal);
    if ((this.options.failFirstRequest && this.calls.length === 1)
      || (this.options.failFirstAttemptForUnitIds?.includes(request.unitId) && attempt === 1)) {
      throw Object.assign(new Error("Deterministic offline provider failure."), {
        code: "offline_fixture_failure",
        retryable: true,
      });
    }
    let output: string;
    if (this.options.oversizedOutputForUnitIds?.includes(request.unitId) && request.mode === "generate") {
      output = "x".repeat(1_048_577);
    } else if (request.modelId === "deterministic-fixture-invalid-v1") {
      output = request.mode === "generate" ? "{ malformed" : "{ still-malformed";
    } else if (request.mode === "generate" && (this.options.malformedFirstOutputForUnitIds?.includes(request.unitId)
      || (this.options.malformedFirstSuccessfulRequest && !this.malformedSuccessfulRequestEmitted))) {
      this.malformedSuccessfulRequestEmitted = true;
      output = "{ malformed";
    } else if (request.mode === "repair" && this.options.invalidRepairForUnitIds?.includes(request.unitId)) {
      output = "{ still-malformed";
    } else if (request.mode === "repair" && this.options.oversizedRepairOutputForUnitIds?.includes(request.unitId)) {
      const candidate = candidateFor(request, this.contexts.get(request.unitId));
      candidate.passages[0] = { ...candidate.passages[0]!, summary: "x".repeat(6_000) };
      output = JSON.stringify(candidate);
    } else {
      output = JSON.stringify(candidateFor(request, this.contexts.get(request.unitId)));
    }
    return {
      output,
      usage: {
        inputTokens: Math.max(1, Math.ceil(JSON.stringify(request.boundedContext).length / 4)),
        outputTokens: Math.max(1, Math.ceil(output.length / 4)),
        cost: 0,
      },
    };
  }
}

function candidateFor(request: PassagePlanningProviderRequest, context = request.boundedContext as PassagePlanningContextPack) {
  const selectedIds = new Set(context.selectedPassages.map((item) => item.content.id));
  return {
    schemaId: passagePlanningCandidateSchema.id,
    schemaVersion: passagePlanningCandidateSchema.version,
    jobId: request.jobId,
    unitId: request.unitId,
    inputFingerprint: request.inputFingerprint,
    passages: context.selectedPassages.map((item) => item.content),
    choices: context.choices.filter((item) => selectedIds.has(item.content.sourcePassageId)).map((item) => item.content),
    threads: context.threads.map((item) => item.content),
    generatedIds: [],
  };
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
