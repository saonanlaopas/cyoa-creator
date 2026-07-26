import type { NormalizedSource } from "@story-to-cyoa/importers";
import { StoryBibleSchema, type StoryBible } from "../schemas/story-bible.js";
export function analyzeNormalizedSource(source: NormalizedSource, scopeChapterIds: string[]): StoryBible {
  const chapters = source.chapters.filter((chapter) => scopeChapterIds.includes(chapter.id)); const facts = chapters.flatMap((chapter) => chapter.blocks.filter((b) => b.type === "paragraph").map((block, index) => ({ id: `${chapter.id}-fact-${index}`, kind: "observation", value: block.text.slice(0, 280), excerptIds: [block.excerptId], confidence: block.text.length < 20 ? 0.45 : 0.8, contradiction: false })));
  const words = facts.flatMap((fact) => fact.value.match(/\b[A-Z][a-z]{2,}\b/g) ?? []); const characters = [...new Set(words)].slice(0, 12);
  return StoryBibleSchema.parse({ scopeChapterIds, facts, characters, relationships: [], locations: [], timeline: chapters.map((c) => c.title), unresolvedThreads: [], tone: ["source-faithful"], proseTraits: ["preserve source voice"], sensitivityMarkers: [] });
}
