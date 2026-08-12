import { createHash } from "node:crypto";
import {
  RepairProposalUnitCandidateSchema,
  repairProposalCandidateSchema,
  stableJson,
  type RepairProposalGenerationContext,
  type RepairProposalProvider,
  type RepairProposalProviderRequest,
  type RepairProposalUnitCandidate,
} from "@story-to-cyoa/pipeline";

export interface DeterministicRepairProposalProviderOptions {
  delayMs?: number;
  failFirst?: boolean;
  malformedFirst?: boolean;
  invalidRepair?: boolean;
  invalidSemanticFirst?: boolean;
  onCall?: (request: RepairProposalProviderRequest) => void;
}

export class DeterministicRepairProposalProvider implements RepairProposalProvider {
  public readonly id = "offline-repair-proposal";
  public readonly capabilities = { structuredOutput: true };
  public readonly calls: RepairProposalProviderRequest[] = [];
  private failed = false;
  private malformed = false;
  private semanticInvalid = false;

  public constructor(private readonly options: DeterministicRepairProposalProviderOptions = {}) {}

  async generate(request: RepairProposalProviderRequest) {
    this.calls.push(request); this.options.onCall?.(request);
    await delay(this.options.delayMs ?? 2, request.signal);
    if (this.options.failFirst && !this.failed) {
      this.failed = true;
      throw Object.assign(new Error("Deterministic repair-proposal failure"), { code: "offline_repair_proposal_failure", retryable: true });
    }
    let output: string;
    if (request.mode === "generate" && this.options.malformedFirst && !this.malformed) {
      this.malformed = true; output = "{ malformed";
    } else if (request.mode === "repair" && this.options.invalidRepair) output = "{ still-malformed";
    else {
      const candidate = buildDeterministicRepairCandidate(request.context);
      if (request.mode === "generate" && this.options.invalidSemanticFirst && !this.semanticInvalid) {
        this.semanticInvalid = true;
        candidate.groups[0]!.operations[0]!.entityId = "outside-authorized-base";
      }
      output = JSON.stringify(candidate);
    }
    return {
      output,
      usage: { inputTokens: Math.ceil(stableJson(request.context).length / 4), outputTokens: Math.ceil(output.length / 4), cost: 0 },
      metadata: { deterministic: true, mode: request.mode },
    };
  }
}

export function buildDeterministicRepairCandidate(context: RepairProposalGenerationContext): RepairProposalUnitCandidate {
  const findingFingerprints = context.repairPlan.selectedFindingFingerprints;
  const groups = context.quotedAuthoringEvidence.targets.map((target, index) => {
    const groupKey = `target-${target.targetKey}`;
    const operationCommon = { logicalKey: `repair-${target.targetKey}`, groupKey, sourceFindingFingerprints: findingFingerprints };
    const base = target.expectedBase;
    const current = structuredClone(target.current) as Record<string, unknown>;
    let operation: Record<string, unknown>;
    if (base.kind === "passage-prose-head") {
      operation = {
        ...operationCommon, kind: "create-passage-draft-candidate", entityKind: "passage-prose", entityId: base.passageId,
        expectedBase: base, proposedProse: `Proposed repair candidate for ${base.passageId}. The author retains full review and acceptance control.`,
        requiresUnlock: base.acceptedLocked,
      };
    } else if (base.kind === "passage-entity-version") {
      if (base.entityKind === "passage") current.draftingNotes = [...asStrings(current.draftingNotes), "Review this passage against the selected repair evidence."];
      if (base.entityKind === "choice") current.narrativeIntent = appendText(current.narrativeIntent, "Clarify the consequence identified by the repair evidence.");
      if (base.entityKind === "thread") current.description = appendText(current.description, "Strengthen the selected setup/payoff relationship.");
      operation = { ...operationCommon, kind: "update-entity", entityKind: base.entityKind, entityId: base.entityId, expectedBase: base, after: current };
    } else {
      const entityKind = artifactEntityKind(base.entityType);
      const field = repairTextField(entityKind, current);
      current[field] = Array.isArray(current[field])
        ? [...asStrings(current[field]), "Address the selected repair evidence."]
        : appendText(current[field], "Address the selected repair evidence.");
      operation = { ...operationCommon, kind: "update-entity", entityKind, entityId: base.entityId, expectedBase: base, after: current };
    }
    return {
      logicalKey: groupKey,
      label: `Repair ${target.targetKey}`,
      summary: "One bounded provider-free repair proposal for the exact authorized target.",
      sourceFindingFingerprints: findingFingerprints,
      authorizedTargetKeys: [target.targetKey],
      dependsOnGroupKeys: [],
      operations: [operation],
      position: index,
    };
  });
  return RepairProposalUnitCandidateSchema.parse({
    schemaId: repairProposalCandidateSchema.id,
    schemaVersion: repairProposalCandidateSchema.version,
    repairPlanDefinitionFingerprint: context.repairPlan.definitionFingerprint,
    generationFingerprint: context.unit.generationFingerprint,
    unitId: context.unit.id,
    contextFingerprint: fingerprintContext(context),
    generatedIds: [],
    groups: groups.map(({ position: _position, ...group }) => group),
  });
}

function artifactEntityKind(entityType: string): "mechanic" | "relationship" | "canon-fact" | "route" | "route-act" | "route-decision" | "route-reconvergence" | "route-ending-hook" | "ending" {
  if (["mechanic", "relationship", "canon-fact", "route", "route-act", "route-decision", "route-reconvergence", "route-ending-hook", "ending"].includes(entityType)) return entityType as ReturnType<typeof artifactEntityKind>;
  throw new Error(`Unsupported deterministic repair entity type: ${entityType}`);
}
function repairTextField(kind: ReturnType<typeof artifactEntityKind>, current: Record<string, unknown>): string {
  if (kind === "relationship") return "currentState";
  if (kind === "canon-fact") return "statement";
  if (kind === "route-decision") return "question";
  if (kind === "route-reconvergence") return "preservedDifferences";
  if (kind === "mechanic") return "description" in current ? "description" : "meaning";
  return "summary";
}
function appendText(value: unknown, addition: string): string { return `${typeof value === "string" ? value.trim() : ""}${value ? " " : ""}${addition}`; }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function fingerprintContext(context: RepairProposalGenerationContext): string {
  return createHash("sha256").update(stableJson(context)).digest("hex");
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}
