import { passageGenerationPolicyV1 } from "@story-to-cyoa/pipeline";
import { authoringMessages, quotedAuthoringContext, type AuthoringInstructions } from "@story-to-cyoa/domain";
import { PassagePlanningUnitCandidateSchema, stableJson, type PassagePlanningProvider, type PassagePlanningProviderRequest } from "@story-to-cyoa/pipeline";
import type { OpenRouterClient } from "@story-to-cyoa/openrouter";

export function passagePlanningMessages(request: Pick<PassagePlanningProviderRequest, "mode" | "boundedContext" | "jobId" | "unitId" | "inputFingerprint" | "repair">) {
    const messages = request.mode === "repair"
      ? [
          { role: "system" as const, content: "Repair the supplied JSON. Return only one object matching cyoa.passage-planning-unit-candidate version 1. Preserve jobId, unitId, and inputFingerprint exactly." },
          { role: "user" as const, content: stableJson(quotedAuthoringContext({ malformedOutput: request.repair?.malformedOutput, validationIssues: request.repair?.validationIssues, expected: request.boundedContext })) },
        ]
      : [
          { role: "system" as const, content: "Produce only strict JSON for one bounded CYOA passage-planning unit. Use only supplied stable IDs and context. Do not emit prose drafts or executable code." },
          { role: "user" as const, content: stableJson(quotedAuthoringContext({ identity: { jobId: request.jobId, unitId: request.unitId, inputFingerprint: request.inputFingerprint }, context: request.boundedContext })) },
        ];
    return authoringMessages(messages, (request.boundedContext as { authoringInstructions?: AuthoringInstructions }).authoringInstructions);
}

export class OpenRouterPassagePlanningProvider implements PassagePlanningProvider {
  public readonly id = "openrouter";
  public readonly capabilities = { structuredOutput: true };

  public constructor(private readonly client: OpenRouterClient) {}

  async generate(request: PassagePlanningProviderRequest) {
    const messages = passagePlanningMessages(request);
    const result = await this.client.generateStructuredRaw({
      maximumInputBytes: passageGenerationPolicyV1.maxEstimatedInputTokensPerUnit * 4,
      model: request.modelId,
      messages,
      maxTokens: request.maximumOutputTokens,
      temperature: 0,
      signal: request.signal,
    }, PassagePlanningUnitCandidateSchema);
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
