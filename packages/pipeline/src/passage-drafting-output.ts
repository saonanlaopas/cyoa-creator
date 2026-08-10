import { z } from "zod";

export const passageDraftingUnitOutputSchema = Object.freeze({
  id: "cyoa.passage-drafting-unit-output",
  version: 1,
});

const PassageOutputSchema = z.object({
  passageId: z.string().trim().min(1).max(200),
  basedOnPassagePlanVersionId: z.string().trim().min(1).max(200),
  proseMarkdown: z.string(),
}).strict();

export const PassageDraftingUnitOutputSchema = z.object({
  schemaId: z.literal(passageDraftingUnitOutputSchema.id),
  schemaVersion: z.literal(passageDraftingUnitOutputSchema.version),
  passages: z.array(PassageOutputSchema).min(1).max(8),
}).strict();

export type PassageDraftingUnitOutput = z.infer<typeof PassageDraftingUnitOutputSchema>;

export const passageDraftingOutputLimits = Object.freeze({
  maximumSerializedBytes: 96_000,
  maximumRepairInputBytes: 96_000,
  maximumRepairsPerExecutionAttempt: 1,
});

export interface PassageDraftingOutputValidationInput {
  raw: string;
  expectedPassages: Array<{ passageId: string; passagePlanVersionId: string; wordTarget: number }>;
  maximumOutputTokensPerPassage: number;
  maximumOutputTokens: number;
  maximumSerializedBytes?: number;
}

export class PassageDraftingOutputError extends Error {
  public readonly code = "drafting_output_validation_failed";
  public readonly retryable = true;
  public constructor(
    message: string,
    public readonly issues: string[] = [message],
    public readonly structurallyRepairable = true,
  ) { super(message); }
}

export function validatePassageDraftingOutput(input: PassageDraftingOutputValidationInput): {
  output: PassageDraftingUnitOutput;
  diagnostics: {
    valid: true;
    serializedBytes: number;
    estimatedOutputTokens: number;
    passages: Array<{ passageId: string; estimatedOutputTokens: number; wordCount: number; wordTarget: number; difference: number; percentageDifference: number | null }>;
    checks: string[];
  };
} {
  const serializedBytes = Buffer.byteLength(input.raw, "utf8");
  if (serializedBytes > (input.maximumSerializedBytes ?? passageDraftingOutputLimits.maximumSerializedBytes)) {
    throw new PassageDraftingOutputError("Drafting output exceeds the serialized candidate byte limit", undefined, false);
  }
  let raw: unknown;
  try { raw = JSON.parse(input.raw) as unknown; }
  catch { throw new PassageDraftingOutputError("Drafting output is not valid JSON"); }
  const parsed = PassageDraftingUnitOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PassageDraftingOutputError(
      "Drafting output does not match the strict unit schema",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const expected = new Map(input.expectedPassages.map((item) => [item.passageId, item]));
  const seen = new Set<string>();
  const issues: string[] = [];
  let structurallyRepairable = true;
  const diagnostics = parsed.data.passages.map((passage) => {
    if (seen.has(passage.passageId)) issues.push(`Duplicate passage ${passage.passageId}`);
    seen.add(passage.passageId);
    const planned = expected.get(passage.passageId);
    if (!planned) issues.push(`Unauthorized passage ${passage.passageId}`);
    else if (planned.passagePlanVersionId !== passage.basedOnPassagePlanVersionId) {
      issues.push(`Passage ${passage.passageId} has the wrong passage-plan version`);
    }
    if (!passage.proseMarkdown.trim()) {
      issues.push(`Passage ${passage.passageId} has empty prose`);
      structurallyRepairable = false;
    }
    const estimatedOutputTokens = estimateTokens(passage.proseMarkdown);
    if (estimatedOutputTokens > input.maximumOutputTokensPerPassage) {
      issues.push(`Passage ${passage.passageId} exceeds the per-passage output-token limit`);
      structurallyRepairable = false;
    }
    const wordCount = countWords(passage.proseMarkdown);
    const target = planned?.wordTarget ?? 0;
    return {
      passageId: passage.passageId,
      estimatedOutputTokens,
      wordCount,
      wordTarget: target,
      difference: wordCount - target,
      percentageDifference: target > 0 ? ((wordCount - target) / target) * 100 : null,
    };
  });
  for (const passageId of expected.keys()) {
    if (!seen.has(passageId)) issues.push(`Missing expected passage ${passageId}`);
  }
  const estimatedOutputTokens = diagnostics.reduce((total, item) => total + item.estimatedOutputTokens, 0);
  if (estimatedOutputTokens > input.maximumOutputTokens) {
    issues.push("Drafting output exceeds the unit output-token limit");
    structurallyRepairable = false;
  }
  if (issues.length) throw new PassageDraftingOutputError(issues[0]!, issues, structurallyRepairable);
  return {
    output: parsed.data,
    diagnostics: {
      valid: true,
      serializedBytes,
      estimatedOutputTokens,
      passages: diagnostics,
      checks: ["strict-schema", "exact-passages", "exact-passage-plan-versions", "non-empty-prose", "token-bounds", "byte-bound"],
    },
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 4));
}

function countWords(value: string): number {
  return value.match(/[\p{L}\p{N}]+(?:[\u2019'\u2010-\u2015-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
