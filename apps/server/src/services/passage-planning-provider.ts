import type {
  PassagePlanningProvider,
  PassagePlanningProviderRequest,
  PassagePlanningProviderResult,
} from "@story-to-cyoa/pipeline";

export interface DeterministicPassagePlanningProviderOptions {
  delayMs?: number;
  failFirstAttemptForUnitIds?: string[];
  failFirstRequest?: boolean;
}

export class DeterministicPassagePlanningProvider implements PassagePlanningProvider {
  public readonly id = "offline-kernel";
  public calls: PassagePlanningProviderRequest[] = [];
  private readonly attempts = new Map<string, number>();

  public constructor(private readonly options: DeterministicPassagePlanningProviderOptions = {}) {}

  async generate(request: PassagePlanningProviderRequest): Promise<PassagePlanningProviderResult> {
    this.calls.push(request);
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
    return {
      usage: {
        inputTokens: Math.max(1, Math.ceil(JSON.stringify(request.boundedContext).length / 4)),
        outputTokens: 1,
        cost: 0,
      },
    };
  }
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
