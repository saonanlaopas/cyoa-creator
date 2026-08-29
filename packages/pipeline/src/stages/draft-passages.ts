import { z } from "zod";
import type { Project } from "@story-to-cyoa/domain";

export const DraftedPassageSchema = z.object({
  passageId: z.string().min(1),
  prose: z.string(),
  citations: z.array(z.string()),
  versionKey: z.string().min(1),
}).strict();

export const DraftedPassagesArtifactSchema = z.object({
  passages: z.array(DraftedPassageSchema),
}).strict();

export type DraftedPassage = z.infer<typeof DraftedPassageSchema>;
export function draftPassageBatch(graph: Project, passageIds?: string[]): DraftedPassage[] { const wanted = new Set(passageIds ?? graph.passages.map((p) => p.id)); return graph.passages.filter((p) => wanted.has(p.id)).map((p) => ({ passageId: p.id, prose: p.prose || `${p.title}. ${p.purpose}`.trim(), citations: p.requiredKnowledge, versionKey: `passage:${p.id}` })); }
export function regenerateSelection(graph: Project, ids: string[]): DraftedPassage[] { return draftPassageBatch(graph, ids); }
