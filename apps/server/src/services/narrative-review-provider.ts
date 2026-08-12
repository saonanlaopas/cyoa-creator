import {
  NarrativeReviewUnitOutputSchema,
  narrativeReviewOutputSchema,
  stableJson,
  type NarrativeReviewContext,
  type NarrativeReviewFindingCandidate,
  type NarrativeReviewProvider,
  type NarrativeReviewProviderRequest,
  type NarrativeReviewProviderResult,
} from "@story-to-cyoa/pipeline";

export interface DeterministicNarrativeReviewProviderOptions {
  delayMs?: number;
  malformedFirst?: boolean;
  invalidRepair?: boolean;
  failFirst?: boolean;
  oversized?: boolean;
  noFindings?: boolean;
  invalidEvidence?: boolean;
  onCall?: (request: NarrativeReviewProviderRequest) => void;
}

export class DeterministicNarrativeReviewProvider implements NarrativeReviewProvider {
  public readonly id = "offline-narrative-review";
  public readonly capabilities = { structuredOutput: true };
  public readonly calls: NarrativeReviewProviderRequest[] = [];
  private malformedEmitted = false;
  private failureEmitted = false;

  public constructor(private readonly options: DeterministicNarrativeReviewProviderOptions = {}) {}

  async generate(request: NarrativeReviewProviderRequest): Promise<NarrativeReviewProviderResult> {
    this.calls.push(request); this.options.onCall?.(request);
    await delay(this.options.delayMs ?? 2, request.signal);
    if ((this.options.failFirst || request.modelId === "deterministic-review-failure-v1") && !this.failureEmitted) {
      this.failureEmitted = true;
      throw Object.assign(new Error("Deterministic narrative-review failure"), { code: "offline_review_failure", retryable: true });
    }
    let output: string;
    if (this.options.oversized || request.modelId === "deterministic-review-oversized-v1") output = "x".repeat(100_000);
    else if ((this.options.malformedFirst || request.modelId === "deterministic-review-repair-v1") && request.mode === "generate" && !this.malformedEmitted) {
      this.malformedEmitted = true; output = "{ malformed";
    } else if (request.mode === "repair" && this.options.invalidRepair) output = "{ still-malformed";
    else output = JSON.stringify(validOutput(request.context, this.options.noFindings ?? request.modelId === "deterministic-review-empty-v1", this.options.invalidEvidence));
    return {
      output,
      usage: { inputTokens: Math.ceil(stableJson(request.context).length / 4), outputTokens: Math.ceil(output.length / 4), cost: 0 },
      metadata: { deterministic: true, mode: request.mode },
    };
  }
}

function validOutput(context: NarrativeReviewContext, empty: boolean, invalidEvidence = false) {
  const target = context.quotedAuthoringEvidence.targets.find((item) => item.acceptedDraft) ?? context.quotedAuthoringEvidence.targets[0]!;
  const choiceEvidence = context.quotedAuthoringEvidence.choices[0];
  const hasEvidence = Boolean(target.acceptedDraft || choiceEvidence);
  const findings: NarrativeReviewFindingCandidate[] = empty || !hasEvidence ? [] : [{
    logicalKey: `offline-${target.passage.id}`,
    category: "pacing",
    severity: "warning",
    confidence: "medium",
    message: "The bounded passage may move through its planned turn before the emotional beat has room to register.",
    reviewNote: "Review the beat duration and its relationship to the directly connected choices.",
    passageIds: [target.passage.id], choiceIds: [], routeIds: [], endingIds: [], mechanicKeys: [], factIds: [], threadIds: [],
    acceptedDraftVersionIds: target.acceptedDraft ? [target.acceptedDraft.draftVersionId] : [],
    evidenceReferences: target.acceptedDraft ? [{
      kind: "passage", passageId: target.passage.id,
      draftVersionId: invalidEvidence ? "invented-draft" : target.acceptedDraft.draftVersionId,
    }] : choiceEvidence ? [{
      kind: "choice", choiceId: choiceEvidence.content.id,
      sourcePassageId: invalidEvidence ? "invented-passage" : choiceEvidence.content.sourcePassageId,
    }] : [],
  }];
  return NarrativeReviewUnitOutputSchema.parse({
    schemaId: narrativeReviewOutputSchema.id, schemaVersion: narrativeReviewOutputSchema.version, findings,
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}
