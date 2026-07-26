export type ImportFormat = "txt" | "html" | "epub";

export interface ImportInput {
  data: string | Uint8Array;
  filename?: string;
  mimeType?: string;
  format?: ImportFormat;
  maxBytes?: number;
}

export interface SourceMetadata {
  title?: string;
  author?: string;
  language?: string;
  sourceFormat: ImportFormat;
}

export interface NormalizedBlock {
  type: "heading" | "paragraph";
  text: string;
  excerptId: string;
}

export interface NormalizedChapter {
  id: string;
  title: string;
  order: number;
  blocks: NormalizedBlock[];
}

export interface NormalizedSource {
  metadata: SourceMetadata;
  chapters: NormalizedChapter[];
}
