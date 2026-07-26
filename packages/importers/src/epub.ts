import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { importHtml } from "./html.js";
import { assertSize, normalizeSource, type RawChapter } from "./normalize.js";
import type { ImportInput, NormalizedSource } from "./types.js";

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

export function importEpub(input: ImportInput): NormalizedSource {
  assertSize(input.data, input.maxBytes);
  if (typeof input.data === "string") throw new Error("EPUB input must be binary");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.data);
  } catch {
    throw new Error("Invalid EPUB archive");
  }
  if (Object.keys(files).some((name) => name.toLowerCase().endsWith("encryption.xml"))) {
    throw new Error("Encrypted EPUBs are not supported");
  }
  const container = files["META-INF/container.xml"];
  if (!container) throw new Error("EPUB container is missing");
  const rootPath = strFromU8(container).match(/\bfull-path=["']([^"']+)["']/i)?.[1];
  if (!rootPath || !files[rootPath]) throw new Error("EPUB package document is missing");
  const opf = strFromU8(files[rootPath]);
  const base = posix.dirname(rootPath);
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attribute(match[0], "id");
    const href = attribute(match[0], "href");
    if (id && href) manifest.set(id, posix.normalize(posix.join(base, decodeURIComponent(href))));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => attribute(match[0], "idref"))
    .filter((id): id is string => Boolean(id));
  if (!spine.length) throw new Error("EPUB spine is empty");
  const title = opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  const author = opf.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  const chapters: RawChapter[] = spine.flatMap((id, order) => {
    const path = manifest.get(id);
    const entry = path ? files[path] : undefined;
    if (!entry) return [];
    const parsed = importHtml({ data: entry, format: "html" });
    return parsed.chapters.map((chapter) => ({
      title: chapter.title === "Chapter 1" ? `Chapter ${order + 1}` : chapter.title,
      blocks: chapter.blocks.map(({ type, text }) => ({ type, text })),
    }));
  });
  return normalizeSource("epub", chapters, { title, author });
}
