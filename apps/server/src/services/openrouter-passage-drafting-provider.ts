import {
  PassageDraftingUnitOutputSchema,
  passageDraftingUnitOutputSchema,
  stableJson,
  type PassageDraftingProvider,
  type PassageDraftingProviderRequest,
} from "@story-to-cyoa/pipeline";
import type { OpenRouterClient, OpenRouterModel } from "@story-to-cyoa/openrouter";

export class OpenRouterPassageDraftingProvider implements PassageDraftingProvider {
  public readonly id = "openrouter-drafting";
  public readonly capabilities = { structuredOutput: true };

  public constructor(
    private readonly client: OpenRouterClient,
    private readonly modelCapabilities?: OpenRouterModel | ((modelId: string) => OpenRouterModel | undefined),
  ) {}

  async generate(request: PassageDraftingProviderRequest) {
    const messages = request.mode === "repair"
      ? [
          {
            role: "system" as const,
            content: `Repair only the JSON structure. Return one strict ${passageDraftingUnitOutputSchema.id} version ${passageDraftingUnitOutputSchema.version} object. Preserve all prose verbatim where present.`,
          },
          {
            role: "user" as const,
            content: stableJson({
              malformedOutput: request.repair?.malformedOutput,
              validationIssues: request.repair?.validationIssues,
              expected: request.boundedContext,
            }),
          },
        ]
      : [
          {
            role: "system" as const,
            content: "Draft prose for exactly the supplied CYOA passages. Return only the strict structured wrapper. Use no executable code and invent no durable IDs.",
          },
          {
            role: "user" as const,
            content: stableJson({
              identity: {
                jobId: request.jobId,
                unitId: request.unitId,
                inputFingerprint: request.inputFingerprint,
                contextFingerprint: request.contextFingerprint,
              },
              context: request.boundedContext,
            }),
          },
        ];
    const result = await this.client.generateStructuredRaw({
      model: request.modelId,
      modelCapabilities: typeof this.modelCapabilities === "function"
        ? this.modelCapabilities(request.modelId) : this.modelCapabilities,
      messages,
      maxTokens: request.maximumOutputTokens,
      temperature: 0,
      signal: request.signal,
    }, PassageDraftingUnitOutputSchema);
    return {
      output: result.content,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: result.cost?.total ?? null,
      },
      providerRepairCount: 0,
      providerMetadata: {
        structuredOutputRequested: true,
        provider: result.attempt.provider,
        generationId: result.attempt.generationId,
      },
    };
  }
}
