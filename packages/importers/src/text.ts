import { assertSize, decodeUtf8, normalizeSource, type RawChapter } from "./normalize.js";
import type { ImportInput, NormalizedSource } from "./types.js";

const chapterHeading = /^(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*.*)?$/i;

export function importText(input: ImportInput): NormalizedSource {
  assertSize(input.data, input.maxBytes);
  const text = decodeUtf8(input.data).replace(/\r\n?/g, "\n");
  const paragraphs = text.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const chapters: RawChapter[] = [];
  let current: RawChapter = { title: "Chapter 1", blocks: [] };
  for (const paragraph of paragraphs) {
    const oneLine = paragraph.replace(/\s+/g, " ").trim();
    if (chapterHeading.test(oneLine)) {
      if (current.blocks.length) chapters.push(current);
      current = { title: oneLine, blocks: [{ type: "heading", text: oneLine }] };
    } else {
      current.blocks.push({ type: "paragraph", text: paragraph });
    }
  }
  if (current.blocks.length || chapters.length === 0) chapters.push(current);
  return normalizeSource("txt", chapters, {
    title: input.filename?.replace(/\.[^.]+$/, ""),
  });
}
