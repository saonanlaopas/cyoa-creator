import { z } from "zod";

const Id = z.string().trim().min(1).max(200);
const ShortText = z.string().trim().max(500);
const LongText = z.string().trim().max(10_000);

export const BibleCharacterSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  role: ShortText.default(""),
  summary: LongText.default(""),
  motivations: z.array(ShortText).max(30).default([]),
  knowledge: z.array(ShortText).max(50).default([]),
  plannedArc: LongText.default(""),
});

export const BibleRelationshipSchema = z.object({
  id: Id,
  characterIds: z.array(Id).min(2).max(6),
  label: ShortText.default(""),
  currentState: LongText.default(""),
  plannedArc: LongText.default(""),
});

export const BibleSectionEntrySchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(300),
  description: LongText.default(""),
});

export const BibleCanonFactSchema = z.object({
  id: Id,
  statement: z.string().trim().min(1).max(5_000),
  sourceExcerptIds: z.array(Id).max(50).default([]),
  confidence: z.enum(["confirmed", "likely", "uncertain"]).default("confirmed"),
});

export const BibleContradictionSchema = z.object({
  id: Id,
  description: z.string().trim().min(1).max(5_000),
  resolution: LongText.default(""),
});

export const BibleOpportunitySchema = z.object({
  id: Id,
  description: z.string().trim().min(1).max(5_000),
  rationale: LongText.default(""),
});

export const BibleQuestionSchema = z.object({
  id: Id,
  question: z.string().trim().min(1).max(2_000),
  answer: LongText.default(""),
});

export const LongFormStoryBibleSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(300),
  overview: LongText.default(""),
  characters: z.array(BibleCharacterSchema).max(200).default([]),
  relationships: z.array(BibleRelationshipSchema).max(300).default([]),
  settings: z.array(BibleSectionEntrySchema).max(200).default([]),
  timeline: z.array(BibleSectionEntrySchema).max(500).default([]),
  worldRules: z.array(BibleSectionEntrySchema).max(200).default([]),
  themes: z.array(BibleSectionEntrySchema).max(100).default([]),
  proseGuidance: z.object({
    tone: z.array(ShortText).max(30).default([]),
    pointOfView: ShortText.default(""),
    style: z.array(ShortText).max(50).default([]),
    avoid: z.array(ShortText).max(50).default([]),
  }).default({ tone: [], pointOfView: "", style: [], avoid: [] }),
  canonFacts: z.array(BibleCanonFactSchema).max(2_000).default([]),
  contradictions: z.array(BibleContradictionSchema).max(200).default([]),
  adaptationOpportunities: z.array(BibleOpportunitySchema).max(300).default([]),
  unresolvedQuestions: z.array(BibleQuestionSchema).max(300).default([]),
}).superRefine((bible, context) => {
  const identified = [
    ...bible.characters,
    ...bible.relationships,
    ...bible.settings,
    ...bible.timeline,
    ...bible.worldRules,
    ...bible.themes,
    ...bible.canonFacts,
    ...bible.contradictions,
    ...bible.adaptationOpportunities,
    ...bible.unresolvedQuestions,
  ];
  const seen = new Set<string>();
  for (const item of identified) {
    if (seen.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `Bible entry IDs must be unique: ${item.id}`,
      });
    }
    seen.add(item.id);
  }
  const characterIds = new Set(bible.characters.map((character) => character.id));
  bible.relationships.forEach((relationship, index) => {
    if (relationship.characterIds.some((characterId) => !characterIds.has(characterId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationships", index, "characterIds"],
        message: "Relationship participants must reference characters in this bible",
      });
    }
  });
});

export type LongFormStoryBible = z.infer<typeof LongFormStoryBibleSchema>;

export function defaultLongFormStoryBible(input: {
  title: string;
  overview?: string;
  protagonist?: string;
  pointOfView?: string;
  tone?: string;
}): LongFormStoryBible {
  const protagonist = input.protagonist?.trim() ?? "";
  return LongFormStoryBibleSchema.parse({
    title: `${input.title} story bible`,
    overview: input.overview ?? "",
    characters: protagonist
      ? [{
          id: "character-protagonist",
          name: protagonist,
          role: "Protagonist",
          summary: "",
          motivations: [],
          knowledge: [],
          plannedArc: "",
        }]
      : [],
    proseGuidance: {
      tone: input.tone?.trim() ? [input.tone.trim()] : [],
      pointOfView: input.pointOfView ?? "",
      style: [],
      avoid: [],
    },
  });
}
