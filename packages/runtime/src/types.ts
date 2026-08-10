export type RuntimeScalar = number | boolean | string;

export type RuntimeCondition =
  | { kind: "all"; items: RuntimeCondition[] }
  | { kind: "any"; items: RuntimeCondition[] }
  | { kind: "not"; item: RuntimeCondition }
  | { kind: "compare"; mechanicKey: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: RuntimeScalar }
  | { kind: "visit-count"; passageId: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number };

export interface RuntimeEffect {
  id: string;
  mechanicKey: string;
  operation: "set" | "add" | "subtract" | "clear";
  value: RuntimeScalar | null;
  feedback: string;
  visibility: "visible" | "hidden";
}

export interface RuntimeMechanicsSource {
  visibleStats: Array<{ key: string; minimum: number; maximum: number; initial: number }>;
  relationships: Array<{ key: string; minimum: number; maximum: number; initial: number; bands: Array<{ minimum: number; label: string }> }>;
  flags: Array<{ key: string }>;
  resources: Array<{ key: string; kind: "inventory" | "currency" | "counter"; initial: number }>;
  gates: Array<{
    id: string;
    targetType: "route" | "ending";
    targetId: string;
    logic: "all" | "any";
    conditions: Array<{
      id: string;
      mechanicKey: string;
      operator: "at-least" | "at-most" | "equals" | "present" | "absent";
      value: number | null;
    }>;
  }>;
}

export interface RuntimeCompileSource {
  snapshotId: string;
  structureVersionId: string;
  startPassageId: string | null;
  passageVersions: Array<{
    versionId: string;
    id: string;
    choiceIds: string[];
    terminal: boolean;
    endingId: string | null;
    routeIds: string[];
    requiredFactIds: string[];
    revealedFactIds: string[];
  }>;
  choiceVersions: Array<{
    versionId: string;
    id: string;
    sourcePassageId: string;
    destinationPassageId: string;
    condition: RuntimeCondition | null;
    unavailableBehavior: "hidden" | "disabled";
    unavailableExplanation: string;
    effects: RuntimeEffect[];
    sourceDecisionIds: string[];
    position: number;
  }>;
  threadVersionIds: string[];
  routeIds: string[];
  routeDecisionIds: string[];
  endings: Array<{ id: string; routeId: string }>;
  mechanics: RuntimeMechanicsSource;
}

export type RuntimeMechanicCategory = "stat" | "relationship" | "flag" | "resource";
export interface RuntimeMechanicDefinition {
  key: string;
  category: RuntimeMechanicCategory;
  valueType: "number" | "boolean" | "string";
  initial: RuntimeScalar;
  minimum?: number;
  maximum?: number;
  bands?: Array<{ minimum: number; label: string }>;
}

export interface CompiledRuntimeChoice {
  id: string;
  sourcePassageId: string;
  destinationPassageId: string;
  condition: RuntimeCondition | null;
  routeGateConditions: RuntimeCondition[];
  unavailableBehavior: "hidden" | "disabled";
  unavailableExplanation: string;
  effects: RuntimeEffect[];
  sourceDecisionIds: string[];
  position: number;
}

export interface CompiledRuntimePassage {
  id: string;
  choiceIds: string[];
  terminal: boolean;
  endingId: string | null;
  routeIds: string[];
  requiredFactIds: string[];
  revealedFactIds: string[];
}

export interface CompiledRuntimeEnding {
  id: string;
  routeId: string;
  gateConditions: RuntimeCondition[];
}

export interface CompiledRuntime {
  schemaVersion: 1;
  simulationPolicyVersion: "foundation-5a-v1";
  sourceSnapshotId: string;
  sourceStructureVersionId: string;
  fingerprint: string;
  startPassageId: string;
  mechanics: Record<string, RuntimeMechanicDefinition>;
  passages: Record<string, CompiledRuntimePassage>;
  choices: Record<string, CompiledRuntimeChoice>;
  endings: Record<string, CompiledRuntimeEnding>;
  routeIds: string[];
  decisionIds: string[];
}

export interface RuntimeState {
  currentPassageId: string;
  stats: Record<string, number>;
  relationships: Record<string, number>;
  flags: Record<string, boolean>;
  resources: Record<string, number | string>;
  decisions: string[];
  routes: string[];
  knownFacts: string[];
  visitCounts: Record<string, number>;
  turn: number;
}

export interface RuntimeStateDelta {
  path: string;
  before: RuntimeScalar | null;
  after: RuntimeScalar | null;
}

export interface RuntimeChoiceAvailability {
  choiceId: string;
  visible: boolean;
  enabled: boolean;
  reason: string | null;
  conditionResult: boolean;
}

export type RuntimeFindingCode =
  | "runtime.current-passage-missing"
  | "runtime.choice-missing"
  | "runtime.choice-wrong-source"
  | "runtime.choice-unavailable"
  | "runtime.destination-missing"
  | "runtime.condition-invalid"
  | "runtime.effect-invalid"
  | "runtime.terminal-invalid"
  | "runtime.ending-ineligible"
  | "runtime.path-after-terminal"
  | "runtime.step-limit-reached"
  | "runtime.cycle-guard-reached"
  | "runtime.trace-limit-reached"
  | "runtime.expected-ending-mismatch"
  | "runtime.expected-state-mismatch";

export interface RuntimeFinding {
  id: string;
  code: RuntimeFindingCode;
  message: string;
  simulationInputFingerprint: string;
  compiledRuntimeFingerprint: string;
  stepIndex: number;
  passageId?: string;
  choiceId?: string;
  mechanicKey?: string;
  endingId?: string;
}

export interface RuntimeTraceStep {
  stepIndex: number;
  passageId: string;
  selectedChoiceId: string;
  nextPassageId: string;
  availability: RuntimeChoiceAvailability;
  stateBefore: RuntimeState;
  appliedEffects: RuntimeEffect[];
  stateDelta: RuntimeStateDelta[];
  stateAfter: RuntimeState;
}

export type RuntimeResultKind =
  | "completed-ending"
  | "ending-ineligible"
  | "path-exhausted"
  | "blocked"
  | "step-limit-reached"
  | "cycle-guard-reached"
  | "trace-limit-reached";

export interface RuntimeResult {
  kind: RuntimeResultKind;
  passageId: string;
  endingId: string | null;
  eligible: boolean | null;
}

export interface DeterministicPathPolicy {
  version: "foundation-5a-v1";
  maxSteps: number;
  maxVisitsPerPassage: number;
  maxTraceBytes: number;
}

export interface DeterministicPathDefinition {
  choiceIds: string[];
  expectedEndingId?: string | null;
  expectedState?: Partial<Pick<RuntimeState, "stats" | "relationships" | "flags" | "resources" | "decisions" | "routes">>;
  policy: DeterministicPathPolicy;
}

export interface RuntimeTrace {
  schemaVersion: 1;
  simulationInputFingerprint: string;
  compiledRuntimeFingerprint: string;
  path: DeterministicPathDefinition;
  visitedPassageIds: string[];
  selectedChoiceIds: string[];
  steps: RuntimeTraceStep[];
  finalState: RuntimeState;
  result: RuntimeResult;
  findings: RuntimeFinding[];
  fingerprint: string;
}

export interface RuntimeCompileFinding {
  code: string;
  message: string;
  passageId?: string;
  choiceId?: string;
  mechanicKey?: string;
  endingId?: string;
}
