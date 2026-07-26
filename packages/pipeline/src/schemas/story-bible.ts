import { z } from "zod";
export const BibleFactSchema = z.object({ id: z.string(), kind: z.string(), value: z.string(), excerptIds: z.array(z.string()).min(1), confidence: z.number().min(0).max(1), contradiction: z.boolean().default(false) });
export const StoryBibleSchema = z.object({ version: z.number().int().positive().default(1), scopeChapterIds: z.array(z.string()), facts: z.array(BibleFactSchema), characters: z.array(z.string()), relationships: z.array(z.string()), locations: z.array(z.string()), timeline: z.array(z.string()), unresolvedThreads: z.array(z.string()), tone: z.array(z.string()), proseTraits: z.array(z.string()), sensitivityMarkers: z.array(z.string()) });
export type StoryBible = z.infer<typeof StoryBibleSchema>;
