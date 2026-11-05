import { passageDraftingPolicyV1 } from "@story-to-cyoa/pipeline";
import { authoringMessages, quotedAuthoringContext, type AuthoringInstructions } from "@story-to-cyoa/domain";
import {
  PassageDraftingUnitOutputSchema,
  passageDraftingUnitOutputSchema,
  stableJson,
  type PassageDraftingProvider,
  type PassageDraftingProviderRequest,
} from "@story-to-cyoa/pipeline";
import type { OpenRouterClient, OpenRouterModel } from "@story-to-cyoa/openrouter";

export function passageDraftingMessages(request: Pick<PassageDraftingProviderRequest, "mode" | "boundedContext" | "jobId" | "unitId" | "inputFingerprint" | "contextFingerprint" | "repair">) {
    const messages = request.mode === "repair"
      ? [
          {
            role: "system" as const,
            content: `Repair only the JSON structure. Return one strict ${passageDraftingUnitOutputSchema.id} version ${passageDraftingUnitOutputSchema.version} object. Preserve all prose verbatim where present.`,
          },
          {
            role: "user" as const,
            content: stableJson(quotedAuthoringContext({
              malformedOutput: request.repair?.malformedOutput,
              validationIssues: request.repair?.validationIssues,
              expected: request.boundedContext,
            })),
          },
        ]
      : [
          {
            role: "system" as const,
            content: "Draft prose for exactly the supplied CYOA passages. Return only the strict structured wrapper. Use no executable code and invent no durable IDs.",
          },
          {
            role: "user" as const,
            content: stableJson(quotedAuthoringContext({
              identity: {
                jobId: request.jobId,
                unitId: request.unitId,
                inputFingerprint: request.inputFingerprint,
                contextFingerprint: request.contextFingerprint,
              },
              context: request.boundedContext,
            })),
          },
        ];
    return authoringMessages(messages, (request.boundedContext as { authoringInstructions?: AuthoringInstructions }).authoringInstructions);
}

export class OpenRouterPassageDraftingProvider implements PassageDraftingProvider {
  public readonly id = "openrouter-drafting";
  public readonly capabilities = { structuredOutput: true };

  public constructor(
    private readonly client: OpenRouterClient,
    private readonly modelCapabilities?: OpenRouterModel | ((modelId: string) => OpenRouterModel | undefined),
  ) {}

  async generate(request: PassageDraftingProviderRequest) {
    const messages = passageDraftingMessages(request);
    const result = await this.client.generateStructuredRaw({
      maximumInputBytes: passageDraftingPolicyV1.maxEstimatedInputTokensPerUnit * 4,
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
