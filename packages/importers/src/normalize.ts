import { createHash } from "node:crypto";
import type { ImportFormat, NormalizedBlock, NormalizedChapter, NormalizedSource, SourceMetadata } from "./types.js";

export interface RawChapter {
  title: string;
  blocks: Array<{ type: "heading" | "paragraph"; text: string }>;
}

export function normalizeText(value: string): string {
  return value.normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function normalizeSource(
  format: ImportFormat,
  chapters: RawChapter[],
  metadata: Omit<SourceMetadata, "sourceFormat"> = {},
): NormalizedSource {
  const normalizedChapters: NormalizedChapter[] = chapters.map((chapter, chapterIndex) => {
    const title = normalizeText(chapter.title) || `Chapter ${chapterIndex + 1}`;
    const chapterIdentity = `${chapterIndex}:${stableHash(title.toLocaleLowerCase())}`;
    const blocks: NormalizedBlock[] = chapter.blocks
      .map((block) => ({ ...block, text: normalizeText(block.text) }))
      .filter((block) => block.text.length > 0)
      .map((block, blockIndex) => ({
        ...block,
        excerptId: `ex_${stableHash(`${chapterIdentity}:${blockIndex}:${stableHash(block.text)}`)}`,
      }));
    return { id: `ch_${stableHash(chapterIdentity)}`, title, order: chapterIndex, blocks };
  });
  return { metadata: { ...metadata, sourceFormat: format }, chapters: normalizedChapters };
}

export function assertSize(data: string | Uint8Array, maxBytes = 25 * 1024 * 1024): void {
  const byteLength = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
  if (byteLength > maxBytes) throw new Error(`Source exceeds ${maxBytes} byte limit`);
}

export function decodeUtf8(data: string | Uint8Array): string {
  if (typeof data === "string") return data;
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
