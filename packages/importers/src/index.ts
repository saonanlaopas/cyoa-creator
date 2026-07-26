import { importEpub } from "./epub.js";
import { importHtml } from "./html.js";
import { importText } from "./text.js";
import type { ImportFormat, ImportInput, NormalizedSource } from "./types.js";

const formatsByMime: Record<string, ImportFormat> = {
  "text/plain": "txt",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/epub+zip": "epub",
};

function detectFormat(input: ImportInput): ImportFormat {
  if (input.format) return input.format;
  const extension = input.filename?.toLowerCase().match(/\.([^.]+)$/)?.[1];
  const byExtension = extension === "txt" ? "txt" : extension === "html" || extension === "htm"
    ? "html" : extension === "epub" ? "epub" : undefined;
  const byMime = input.mimeType ? formatsByMime[input.mimeType.toLowerCase().split(";")[0].trim()] : undefined;
  if (byMime && byExtension && byMime !== byExtension) throw new Error("File extension and MIME type disagree");
  const detected = byMime ?? byExtension;
  if (!detected) throw new Error("Unsupported source format");
  return detected;
}

export async function importSource(input: ImportInput): Promise<NormalizedSource> {
  const format = detectFormat(input);
  if (format === "txt") return importText(input);
  if (format === "html") return importHtml(input);
  return importEpub(input);
}

export * from "./epub.js";
export * from "./html.js";
export * from "./normalize.js";
export * from "./text.js";
export * from "./types.js";
