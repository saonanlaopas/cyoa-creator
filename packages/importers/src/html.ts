import { assertSize, decodeUtf8, normalizeSource, type RawChapter } from "./normalize.js";
import type { ImportInput, NormalizedSource } from "./types.js";

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", hellip: "…",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? "";
  });
}

function plainText(fragment: string): string {
  return decodeEntities(fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
  ).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${property}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return plainText(value);
  }
  return undefined;
}

export function importHtml(input: ImportInput): NormalizedSource {
  assertSize(input.data, input.maxBytes);
  const original = decodeUtf8(input.data);
  const title = metaContent(original, "og:title") ?? plainText(original.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const author = metaContent(original, "author") ??
    plainText(original.match(/class=["'][^"']*\bbyline\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? "");

  const inert = original
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg|canvas|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]+\b(?:download|onclick|onload|onerror)\b[^>]*>[\s\S]*?<\/[^>]+>/gi, "");
  const work = inert.match(/<(?:div|article)[^>]+(?:id=["']workskin["']|class=["'][^"']*\buserstuff\b[^"']*["'])[^>]*>([\s\S]*)<\/(?:div|article)>/i)?.[1] ?? inert;
  const tokens = [...work.matchAll(/<(h[1-4]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  const chapters: RawChapter[] = [];
  let current: RawChapter = { title: "Chapter 1", blocks: [] };
  for (const token of tokens) {
    const tag = token[1].toLowerCase();
    const text = plainText(token[2]);
    if (!text) continue;
    const isChapterHeading = /^h[1-4]$/.test(tag) && /^(?:chapter|part|book)\b/i.test(text);
    if (isChapterHeading) {
      if (current.blocks.length) chapters.push(current);
      current = { title: text, blocks: [{ type: "heading", text }] };
    } else {
      current.blocks.push({ type: /^h/.test(tag) ? "heading" : "paragraph", text });
    }
  }
  if (current.blocks.length || chapters.length === 0) chapters.push(current);
  return normalizeSource("html", chapters, { title: title || undefined, author: author || undefined });
}
