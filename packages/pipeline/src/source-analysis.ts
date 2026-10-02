export { SOURCE_ANALYSIS_POLICY, SOURCE_CATEGORIES, SourceObservationSchema, SourceUnitOutputSchema,
  SourceAnalysisPlanSchema, SourceDossierSchema, planSourceAnalysis, sourceUnitContext, validateSourceOutput,
  consolidateSourceDossier, correctSourceDossier } from "@story-to-cyoa/domain";
export type { SourceAnalysisPlan, SourceUnit, SourceUnitOutput, SourceObservation, SourceEvidence, SourceDossier } from "@story-to-cyoa/domain";

import type { sourceUnitContext } from "@story-to-cyoa/domain";
export interface SourceAnalysisProviderRequest {
  modelId: string; mode: "analyze" | "repair"; context: ReturnType<typeof sourceUnitContext>;
  maximumOutputTokens: number; signal: AbortSignal; malformedOutput?: string;
}
export interface SourceAnalysisProvider {
  readonly id: string;
  generate(request: SourceAnalysisProviderRequest): Promise<{
    output: string; usage: { inputTokens: number; outputTokens: number; cost: number | null };
  }>;
}
