import type { GenerationResult, OpenRouterClient, StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";

/**
 * Deterministic, keyword-based stand-in for the setup assistant. Used only by tests and the offline E2E provider;
 * it never reads credentials or opens a network connection. It deliberately mirrors the contract rules a real
 * provider must follow: cite stated facts, mark inferences, keep unknowns unknown, ask at most a few questions.
 */
interface AuthorMessage { id: string; content: string }
interface Finding { value: string; messageId: string; excerpt: string }

const ROMANCE = /\b(bl|boys'? love|mlm|wlw|gl|romance|romantic|love story|yaoi|yuri)\b/i;
const NO_ROMANCE = /\b(no|without|not a|zero)\s+(romance|romantic|love story|shipping)\b/i;
const GENRES: Array<[RegExp, string]> = [
  [/\b(bl|boys'? love|mlm)\b/i, "BL romance"], [/\bromance\b/i, "romance"], [/\bmystery|detective|whodunit|murder\b/i, "mystery"],
  [/\bhorror|haunted|creepy\b/i, "horror"], [/\badventure|quest|expedition\b/i, "adventure"], [/\bfantasy|magic\b/i, "fantasy"],
  [/\bsci-?fi|science fiction|space station|starship\b/i, "science fiction"], [/\bthriller\b/i, "thriller"],
  [/\bfriendship|friends\b/i, "friendship"], [/\bslice[- ]of[- ]life\b/i, "slice of life"],
];
const TONES: Array<[RegExp, string]> = [
  [/\bwarm(th)?\b/i, "warm"], [/\bcozy|cosy\b/i, "cozy"], [/\bintimate\b/i, "intimate"], [/\bwistful|melanchol/i, "wistful"],
  [/\bbittersweet\b/i, "bittersweet"], [/\bhopeful\b/i, "hopeful"], [/\bdark\b/i, "dark"], [/\bbleak\b/i, "bleak"],
  [/\btense|suspense/i, "tense"], [/\beerie|uncanny|unsettling\b/i, "uncanny"], [/\bfunny|comedic|humou?r/i, "comedic"],
  [/\bgentle|tender\b/i, "tender"], [/\bangst/i, "angsty"],
];
const SETTINGS = /\bset (?:in|on|at|aboard) (?:a |an |the )?([^.,;!?\n]{3,60}?)(?=\s+(?:where|who|that|with|during|and)\b|[.,;!?\n]|$)/i;
const NAMES = /\b(?:named|called)\s+([A-Z][\p{L}'-]+)(?:\s*(?:,|and|&)\s*([A-Z][\p{L}'-]+))?(?:\s*(?:,|and|&)\s*([A-Z][\p{L}'-]+))?/u;
const PAIR = /\btwo (guys|men|boys|women|girls|friends|siblings|strangers|rivals|detectives|kids)\b/i;

function excerptAround(content: string, index: number): string {
  const start = Math.max(0, content.lastIndexOf(".", index) + 1);
  const endStop = content.slice(index).search(/[.!?\n]/);
  const end = endStop < 0 ? content.length : index + endStop + 1;
  return content.slice(start, end).trim().slice(0, 280);
}

/** Latest author message wins, so later clarifications refine earlier statements. */
function latest(messages: AuthorMessage[], pattern: RegExp, map: (match: RegExpMatchArray) => string | null = (match) => match[0]): Finding | null {
  for (const message of [...messages].reverse()) {
    const match = message.content.match(pattern);
    if (match && match.index !== undefined) {
      const value = map(match);
      if (value) return { value, messageId: message.id, excerpt: excerptAround(message.content, match.index) };
    }
  }
  return null;
}

function all(messages: AuthorMessage[], table: Array<[RegExp, string]>): Finding[] {
  const found = new Map<string, Finding>();
  for (const message of messages) {
    for (const [pattern, value] of table) {
      const match = message.content.match(pattern);
      if (match?.index !== undefined) found.set(value, { value, messageId: message.id, excerpt: excerptAround(message.content, match.index) });
    }
  }
  return [...found.values()];
}

function words(value: string): number {
  const [, amount, thousands] = value.toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/) ?? [];
  return Math.round(Number(amount ?? "0") * (thousands ? 1_000 : 1));
}

export interface OfflineSetupReading {
  authorMessageIds: string[];
  genre: Finding[];
  romance: Finding | null;
  noRomance: Finding | null;
  tones: Finding[];
  lowMelodrama: Finding | null;
  slowBurn: Finding | null;
  brisk: Finding | null;
  descriptive: Finding | null;
  interiority: Finding | null;
  longProse: Finding | null;
  pointOfView: Finding | null;
  tense: Finding | null;
  length: Finding | null;
  lengthScope: "whole" | "playthrough" | null;
  lengthScopeEvidence: Finding | null;
  endings: Finding | null;
  routes: Finding | null;
  setting: Finding | null;
  names: Finding | null;
  pair: Finding | null;
  mutual: Finding | null;
  title: Finding | null;
}

export function readSetupConversation(messages: AuthorMessage[]): OfflineSetupReading {
  const noRomance = latest(messages, NO_ROMANCE);
  const romance = noRomance ? null : latest(messages, ROMANCE);
  const scope = latest(messages, /\b(whole (?:thing|project|story)|in total|total(?:ly)?|across (?:all|every) (?:route|branch)|all routes combined|one (?:read-?through|playthrough|path)|per (?:read-?through|playthrough)|each (?:read-?through|playthrough)|single (?:read-?through|playthrough))\b/i,
    (match) => /whole|total|across|combined/i.test(match[0]) ? "whole" : "playthrough");
  return {
    authorMessageIds: messages.map((message) => message.id),
    genre: all(messages, GENRES).filter((item) => !(noRomance && /romance/.test(item.value))),
    romance,
    noRomance,
    tones: all(messages, TONES),
    lowMelodrama: latest(messages, /\b(low|little|no|not much|minimal|without)\s+melodrama|not melodramatic|melodrama[- ]free\b/i),
    slowBurn: latest(messages, /\bslow[- ]burn\b/i),
    brisk: latest(messages, /\b(fast[- ]paced|brisk|quick pace|punchy)\b/i),
    descriptive: latest(messages, /\b(lush|descriptive|restrained|sparse prose|minimal prose)\b/i, (match) =>
      /lush/i.test(match[0]) ? "lush" : /descriptive/i.test(match[0]) ? "descriptive" : "restrained"),
    interiority: latest(messages, /\b(lots of interiority|deep interiority|introspective|inner thoughts|interiority)\b/i),
    longProse: latest(messages, /\b(long prose|long-form prose|not (?:short )?visual[- ]novel|not dialogue[- ]only|literary)\b/i),
    pointOfView: latest(messages, /\b(first|second|third)[- ]person\b/i, (match) =>
      match[1]!.toLowerCase() === "first" ? "first-person" : match[1]!.toLowerCase() === "second" ? "second-person" : "third-person-close"),
    tense: latest(messages, /\b(present|past)[- ]tense\b/i, (match) => match[1]!.toLowerCase()),
    length: latest(messages, /\b\d+(?:[.,]\d+)?\s*(?:k|,000|000)\b(?:\s*words?)?/i),
    lengthScope: (scope?.value as "whole" | "playthrough" | undefined) ?? null,
    lengthScopeEvidence: scope,
    endings: latest(messages, /\b(\d+)\s+endings?\b/i, (match) => match[1]!),
    routes: latest(messages, /\b(\d+)\s+routes?\b/i, (match) => match[1]!),
    setting: latest(messages, SETTINGS, (match) => match[1]!.trim()),
    names: latest(messages, NAMES, (match) => [match[1], match[2], match[3]].filter(Boolean).join("|")),
    pair: latest(messages, PAIR, (match) => match[1]!.toLowerCase()),
    mutual: latest(messages, /\b(already (?:like|love|have feelings for) each other|mutual (?:crush|feelings|pining)|both (?:like|love) each other)\b/i),
    title: latest(messages, /\b(?:titled|working title(?: is)?|call it)\s+["“']([^"”']{2,80})["”']/i, (match) => match[1]!),
  };
}

const stated = (finding: Finding) => ({ basis: "stated" as const, messageIds: [finding.messageId], excerpt: finding.excerpt });
const inferred = (excerpt = "") => ({ basis: "inferred" as const, messageIds: [], excerpt });

function lengthPlan(reading: OfflineSetupReading) {
  if (!reading.length) return null;
  const amount = words(reading.length.value);
  const scope = reading.lengthScope ?? "playthrough";
  const ambiguous = reading.lengthScope === null;
  return { amount, scope, ambiguous };
}

function questionsFor(reading: OfflineSetupReading) {
  const questions: Array<{ id: string; question: string; why: string }> = [];
  const plan = lengthPlan(reading);
  if (plan?.ambiguous) questions.push({
    id: "length-scope",
    question: `Is ${plan.amount.toLocaleString("en-US")} words the length of one read-through, or the whole project across every branch?`,
    why: "It decides how much branching and how many routes the story can support.",
  });
  if (!reading.genre.length && !reading.setting && !reading.pair && !reading.names) questions.push({
    id: "premise",
    question: "What is the story about: who is at the centre, and what situation starts it?",
    why: "Everything else in the setup builds on the premise.",
  });
  if (!reading.tones.length && !reading.slowBurn && !reading.descriptive && !reading.interiority) questions.push({
    id: "feel",
    question: "How should it feel to read: cozy, tense, bittersweet, or something else?",
    why: "Tone shapes the Creative Direction for every later scene.",
  });
  if (!reading.endings && !reading.routes && questions.length < 2) questions.push({
    id: "branching",
    question: "Would you like one main path with a few variations, or several distinct routes with their own endings?",
    why: "It sets the branching shape before any routes are planned.",
  });
  return questions.slice(0, 3);
}

export function offlineSetupReply(messages: AuthorMessage[]) {
  const reading = readSetupConversation(messages);
  const items: Array<Record<string, unknown>> = [];
  const add = (id: string, topic: string, statement: string, finding: Finding | null, basis?: "inferred") => {
    items.push({ id, topic, statement, ...(finding && !basis ? stated(finding) : inferred(finding?.excerpt ?? "")) });
  };
  for (const genre of reading.genre) add(`genre-${genre.value.replace(/[^a-z]+/gi, "-").toLowerCase()}`, "genre", `Genre: ${genre.value}.`, genre);
  if (reading.noRomance) add("no-romance", "relationships", "No romance plot.", reading.noRomance);
  const plan = lengthPlan(reading);
  if (plan) add("length", "length", plan.ambiguous
    ? `About ${plan.amount.toLocaleString("en-US")} words; read here as one read-through until you confirm.`
    : `About ${plan.amount.toLocaleString("en-US")} words ${plan.scope === "whole" ? "for the whole project" : "per read-through"}.`, reading.length);
  if (reading.pair) add("leads", "cast", `Two central characters (${reading.pair}).`, reading.pair);
  if (reading.names) add("names", "cast", `Named characters: ${reading.names.value.split("|").join(", ")}.`, reading.names);
  if (reading.mutual) add("mutual", "relationships", "The leads already have feelings for each other at the start.", reading.mutual);
  if (reading.setting) add("setting", "setting", `Set in ${reading.setting.value}.`, reading.setting);
  if (reading.slowBurn) add("slow-burn", "pacing", "Slow-burn development.", reading.slowBurn);
  for (const tone of reading.tones) add(`tone-${tone.value}`, "tone", `Tone: ${tone.value}.`, tone);
  if (reading.lowMelodrama) add("low-melodrama", "tone", "Keep melodrama low.", reading.lowMelodrama);
  if (reading.descriptive) add("descriptive", "prose", `Prose: ${reading.descriptive.value}.`, reading.descriptive);
  if (reading.interiority) add("interiority", "prose", "Lots of interiority.", reading.interiority);
  if (reading.pointOfView) add("pov", "prose", `Point of view: ${reading.pointOfView.value.replaceAll("-", " ")}.`, reading.pointOfView);
  if (reading.tense) add("tense", "prose", `${reading.tense.value} tense.`, reading.tense);
  const questions = questionsFor(reading);
  const unresolved = [
    ...(plan?.ambiguous ? [{ id: "length-scope", topic: "length", note: "Whether the length is per read-through or for the whole project." }] : []),
    ...(!reading.setting ? [{ id: "setting", topic: "setting", note: "Where and when the story takes place." }] : []),
    ...(!reading.endings && !reading.routes ? [{ id: "branching", topic: "structure", note: "How many routes and endings." }] : []),
    ...(!reading.names && (reading.pair || reading.romance) ? [{ id: "names", topic: "cast", note: "Names for the central characters." }] : []),
  ];
  const ready = messages.length > 0 && (reading.genre.length > 0 || Boolean(reading.pair || reading.names || reading.setting))
    && (reading.tones.length > 0 || Boolean(reading.slowBurn || reading.descriptive || reading.interiority || reading.pointOfView));
  const summary = [
    reading.genre.length ? `A ${reading.genre.map((genre) => genre.value).join(" / ")} story` : "An original story",
    reading.pair ? ` about two ${reading.pair}` : "",
    reading.mutual ? " who already care for each other" : "",
    reading.setting ? `, set in ${reading.setting.value}` : "",
    plan ? `, around ${plan.amount.toLocaleString("en-US")} words` : "",
    ".",
    reading.tones.length ? ` It should feel ${reading.tones.map((tone) => tone.value).join(", ")}.` : "",
  ].join("");
  return {
    message: ready
      ? `That's a lovely starting point. ${questions.length ? "One thing would help before I draft:" : "I have enough to propose a draft foundation whenever you're ready."}`
      : "Thanks, that's a start. A little more would help me shape it.",
    understanding: { summary, items: items.slice(0, 24), unresolved: unresolved.slice(0, 12) },
    questions,
    readiness: ready ? "ready-to-propose" : "needs-input",
  };
}

export function offlineSetupProposal(messages: AuthorMessage[], projectName: string) {
  const reading = readSetupConversation(messages);
  const first = messages[0];
  const plan = lengthPlan(reading);
  const briefChanges: Record<string, unknown> = {};
  const briefEvidence: Array<Record<string, unknown>> = [];
  const set = (field: string, value: unknown, evidence: Record<string, unknown>) => {
    briefChanges[field] = value; briefEvidence.push({ field, ...evidence });
  };
  if (reading.title) set("workingTitle", reading.title.value, stated(reading.title));
  if (first) {
    const sentence = first.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim().slice(0, 600);
    set("premise", sentence, { basis: "stated", messageIds: [first.id], excerpt: sentence.slice(0, 280) });
  }
  const constraints: string[] = [];
  const openQuestions: string[] = [];
  if (plan) {
    if (plan.scope === "whole") {
      if (plan.amount >= 50_000) {
        set("totalWordTarget", plan.amount, stated(reading.length!));
        set("typicalPlaythroughWordTarget", Math.max(10_000, Math.round(plan.amount * 0.4 / 1_000) * 1_000), inferred("About 40% of the whole project per read-through"));
      } else {
        constraints.push(`Author's stated whole-project length: about ${plan.amount.toLocaleString("en-US")} words. Long-form planning currently expects at least 50,000 words in total; review before approving.`);
      }
    } else if (plan.amount >= 10_000) {
      set("typicalPlaythroughWordTarget", plan.amount, plan.ambiguous ? inferred(reading.length!.excerpt) : stated(reading.length!));
      set("totalWordTarget", Math.max(50_000, Math.ceil(plan.amount * 3 / 5_000) * 5_000), inferred("Room for branches beyond one read-through"));
      if (plan.ambiguous) openQuestions.push(`Is ${plan.amount.toLocaleString("en-US")} words one read-through or the whole project?`);
    }
  }
  if (reading.routes) set("routeTarget", Math.min(20, Math.max(2, Number(reading.routes.value))), stated(reading.routes));
  if (reading.endings) set("endingTarget", Math.min(30, Math.max(3, Number(reading.endings.value))), stated(reading.endings));
  const names = reading.names?.value.split("|") ?? [];
  if (names[0]) set("protagonist", names[0], stated(reading.names!));
  if (names.length) set("priorityCharacters", names, stated(reading.names!));
  if (reading.romance && (reading.pair || names.length >= 2)) {
    set("priorityRelationships", [reading.slowBurn ? "The leads' slow-burn romance" : "The leads' romance"], stated(reading.romance));
  }
  if (!reading.endings && !reading.routes) openQuestions.push("How many routes and endings should the story have?");
  if (!reading.setting) openQuestions.push("Where and when does the story take place?");
  if (constraints.length) set("projectConstraints", constraints, stated(reading.length!));
  if (openQuestions.length) set("unresolvedQuestions", openQuestions, inferred());

  const tone: Record<string, unknown> = {}; const pacing: Record<string, unknown> = {}; const prose: Record<string, unknown> = {};
  const directionEvidence: Array<Record<string, unknown>> = [];
  const direction = (section: Record<string, unknown>, path: string, value: unknown, evidence: Record<string, unknown>) => {
    section[path.split(".")[1]!] = value; directionEvidence.push({ field: path, ...evidence });
  };
  const toneValues = reading.tones.filter((item) => item.value !== "angsty");
  if (toneValues.length) direction(tone, "tone.descriptors", toneValues.map((item) => item.value), stated(toneValues[0]!));
  const angst = reading.tones.find((item) => item.value === "angsty");
  if (angst || reading.lowMelodrama) {
    direction(tone, "tone.customGuidance", [angst ? "Some angst is welcome" : "", reading.lowMelodrama ? "keep melodrama low" : ""]
      .filter(Boolean).join(", but ").replace(/^k/, "K") + ".", stated((angst ?? reading.lowMelodrama)!));
  }
  if (reading.lowMelodrama) direction(tone, "tone.exclusions", ["melodramatic"], stated(reading.lowMelodrama));
  if (reading.slowBurn) direction(pacing, "pacing.developmentPace", "slow-burn", stated(reading.slowBurn));
  else if (reading.brisk) direction(pacing, "pacing.developmentPace", "brisk", stated(reading.brisk));
  if (reading.slowBurn) direction(pacing, "pacing.quietScenesAllowed", true, inferred("Slow-burn stories need quieter scenes"));
  if (reading.descriptive) direction(prose, "prose.descriptiveness", reading.descriptive.value, stated(reading.descriptive));
  if (reading.interiority) direction(prose, "prose.interiority", "high", stated(reading.interiority));
  if (reading.longProse || reading.descriptive) direction(prose, "prose.treatment", "long-form", reading.longProse ? stated(reading.longProse) : inferred("Descriptive prose suits long-form treatment"));
  if (reading.pointOfView) direction(prose, "prose.pointOfView", reading.pointOfView.value, stated(reading.pointOfView));
  if (reading.tense) direction(prose, "prose.tense", reading.tense.value, stated(reading.tense));
  const relationshipFocus = reading.romance ?? null;
  const relationshipPresentation = relationshipFocus ? {
    projectDefault: {
      mechanicsVisibility: "subtle",
      customGuidance: [
        reading.slowBurn ? "Slow-burn romance between the leads" : "Romance between the leads",
        reading.mutual ? "; they already have feelings for each other, so tension comes from acting on them" : "",
        reading.lowMelodrama ? "; keep melodrama low" : "",
        ".",
      ].join(""),
    },
  } : undefined;
  if (relationshipFocus) {
    directionEvidence.push({ field: "relationshipPresentation.projectDefault.customGuidance", ...stated(relationshipFocus) });
    directionEvidence.push({ field: "relationshipPresentation.projectDefault.mechanicsVisibility", ...inferred("Relationship mechanics stay in the background by default") });
  }

  const characters: Array<Record<string, unknown>> = [];
  if (names.length) names.forEach((name) => characters.push({
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, role: characters.length === 0 ? "Lead" : "Lead",
    summary: "", motivations: [], evidence: stated(reading.names!),
  }));
  else if (reading.pair) ["first", "second"].forEach((ordinal) => characters.push({
    key: `${ordinal}-lead`, name: `${ordinal[0]!.toUpperCase()}${ordinal.slice(1)} lead (unnamed)`, role: "Lead",
    summary: "Placeholder: name and details not decided yet.", motivations: [], evidence: stated(reading.pair!),
  }));
  const relationships: Array<Record<string, unknown>> = [];
  if (characters.length >= 2 && (reading.romance || reading.mutual || /friend/i.test(reading.pair?.value ?? ""))) {
    relationships.push({
      key: "leads", characterKeys: characters.slice(0, 2).map((item) => item.key),
      label: reading.romance ? (reading.slowBurn ? "Slow-burn romance" : "Romance") : "Central friendship",
      currentState: reading.mutual ? "They already like each other; neither has acted on it yet." : "",
      plannedArc: "",
      evidence: stated((reading.mutual ?? reading.romance ?? reading.pair)!),
    });
  }
  const bibleSeeds = characters.length || reading.setting || reading.genre.length ? {
    ...(first ? { overview: String(briefChanges.premise ?? "") } : {}),
    characters, relationships,
    settings: reading.setting ? [{ key: "primary", label: reading.setting.value.replace(/^./, (value) => value.toUpperCase()), description: "", evidence: stated(reading.setting) }] : [],
    themes: [], worldNotes: [],
    openQuestions: [
      ...(!reading.setting ? [{ key: "setting", question: "Where and when does the story take place?" }] : []),
      ...(reading.genre.some((genre) => genre.value === "mystery") ? [{ key: "mystery-core", question: "What is the central mystery, and who is responsible?" }] : []),
    ],
  } : null;

  const hasDirection = Object.keys(tone).length || Object.keys(pacing).length || Object.keys(prose).length || relationshipPresentation;
  return {
    message: "Here is a draft foundation to review. Nothing changes until you apply it, and applied drafts still need your approval.",
    summary: `Draft setup for ${JSON.stringify(briefChanges.workingTitle ?? projectName)}`,
    brief: Object.keys(briefChanges).length ? { changes: briefChanges, fieldEvidence: briefEvidence } : null,
    creativeDirection: hasDirection ? {
      ...(Object.keys(tone).length ? { tone } : {}),
      ...(Object.keys(pacing).length ? { pacing } : {}),
      ...(Object.keys(prose).length ? { prose } : {}),
      ...(relationshipPresentation ? { relationshipPresentation } : {}),
      fieldEvidence: directionEvidence,
    } : null,
    bibleSeeds,
  };
}

/** Parses the bounded setup prompt produced by `buildSetupContext`. */
export function parseSetupPrompt(prompt: string): { mode: "ask" | "propose"; projectName: string; messages: AuthorMessage[] } {
  const mode = prompt.startsWith("You are Studio, drafting") ? "propose" : "ask";
  const nameMatch = prompt.match(/^Project working name: (.+)$/m);
  const conversationMatch = prompt.match(/^Setup conversation, oldest first[^\n]*:\n(.+)$/m);
  const conversation = conversationMatch ? JSON.parse(conversationMatch[1]!) as Array<{ id: string; role: string; content: string }> : [];
  return {
    mode,
    projectName: nameMatch ? JSON.parse(nameMatch[1]!) as string : "Untitled project",
    messages: conversation.filter((message) => message.role === "author").map(({ id, content }) => ({ id, content })),
  };
}

export function offlineSetupResponse(prompt: string): unknown {
  const parsed = parseSetupPrompt(prompt);
  return parsed.mode === "ask" ? offlineSetupReply(parsed.messages) : offlineSetupProposal(parsed.messages, parsed.projectName);
}

export function isSetupPrompt(prompt: string): boolean {
  return prompt.startsWith("You are Studio, helping an author set up") || prompt.startsWith("You are Studio, drafting");
}

/** A deterministic OpenRouter-shaped client for the setup routes (tests only). */
export function createOfflineSetupClient(options: {
  onRequest?: (request: StructuredGenerationStreamRequest) => void;
  transform?: (value: unknown, prompt: string) => unknown;
  delay?: () => Promise<void>;
} = {}): OpenRouterClient {
  return {
    async generateStructuredStream<T>(request: StructuredGenerationStreamRequest, schema: { parse(value: unknown): T }): Promise<GenerationResult<T>> {
      options.onRequest?.(request);
      await options.delay?.();
      if (request.signal?.aborted) throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
      const prompt = request.messages.at(-1)?.content ?? "";
      const value = options.transform ? options.transform(offlineSetupResponse(prompt), prompt) : offlineSetupResponse(prompt);
      return {
        data: schema.parse(value),
        usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 400, totalTokens: Math.ceil(prompt.length / 4) + 400 },
        cost: null, repaired: false, attempts: [],
      } as unknown as GenerationResult<T>;
    },
  } as unknown as OpenRouterClient;
}
