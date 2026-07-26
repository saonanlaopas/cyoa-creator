import type { OpenRouterModel } from "./model-catalog.js";

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export interface CostRange {
  currency: "USD";
  input: number;
  output: number;
  total: number;
}

export function estimateCost(model: Pick<OpenRouterModel, "pricing">, estimate: TokenEstimate): CostRange {
  const input = Math.max(0, estimate.inputTokens) * model.pricing.prompt;
  const output = Math.max(0, estimate.outputTokens) * model.pricing.completion;
  return { currency: "USD", input, output, total: input + output };
}

export function actualCost(
  model: Pick<OpenRouterModel, "pricing">,
  usage: Partial<TokenEstimate> & { cost?: unknown },
): CostRange {
  const estimated = estimateCost(model, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });
  const reported = typeof usage.cost === "number" ? usage.cost : Number(usage.cost);
  return Number.isFinite(reported) && reported >= 0
    ? { ...estimated, total: reported }
    : estimated;
}
