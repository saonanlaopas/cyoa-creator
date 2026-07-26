import type { Project } from "@story-to-cyoa/domain";
export interface DraftedPassage { passageId: string; prose: string; citations: string[]; versionKey: string }
export function draftPassageBatch(graph: Project, passageIds?: string[]): DraftedPassage[] { const wanted = new Set(passageIds ?? graph.passages.map((p) => p.id)); return graph.passages.filter((p) => wanted.has(p.id)).map((p) => ({ passageId: p.id, prose: p.prose || `${p.title}. ${p.purpose}`.trim(), citations: p.requiredKnowledge, versionKey: `passage:${p.id}` })); }
export function regenerateSelection(graph: Project, ids: string[]): DraftedPassage[] { return draftPassageBatch(graph, ids); }
