import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importSource } from "../src/index.js";

describe("source importers", () => {
  it("normalizes text with stable excerpt identifiers", async () => {
    const input = { data: "Chapter 1\n\nFirst  paragraph.\n\nChapter 2\n\nSecond.", filename: "story.txt", mimeType: "text/plain" };
    const first = await importSource(input);
    const second = await importSource(input);
    expect(first.chapters).toHaveLength(2);
    expect(first.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.excerptId)))
      .toEqual(second.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.excerptId)));
  });

  it("keeps AO3 prose and headings while stripping active and chrome content", async () => {
    const source = await importSource({
      filename: "work.html", mimeType: "text/html",
      data: `<html><head><title>Work</title><script>alert("bad")</script></head><body>
        <nav>Download EPUB</nav><div id="workskin"><h2>Chapter 1</h2><p>Keep <em>this</em>.</p></div></body></html>`,
    });
    const text = JSON.stringify(source);
    expect(text).toContain("Keep this.");
    expect(text).not.toContain("Download EPUB");
    expect(text).not.toContain("alert");
  });

  it("honors EPUB spine order and rejects encrypted books", async () => {
    const epub = zipSync({
      "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`),
      "OPS/book.opf": strToU8(`<package><metadata><dc:title>Book</dc:title></metadata><manifest>
        <item id="two" href="two.xhtml"/><item id="one" href="one.xhtml"/></manifest>
        <spine><itemref idref="one"/><itemref idref="two"/></spine></package>`),
      "OPS/one.xhtml": strToU8("<html><body><h2>Chapter 1</h2><p>First</p></body></html>"),
      "OPS/two.xhtml": strToU8("<html><body><h2>Chapter 2</h2><p>Second</p></body></html>"),
    });
    const source = await importSource({ data: epub, filename: "book.epub", mimeType: "application/epub+zip" });
    expect(source.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    const encrypted = zipSync({
      "META-INF/container.xml": strToU8("<container/>"),
      "META-INF/encryption.xml": strToU8("<encryption/>"),
    });
    await expect(importSource({ data: encrypted, filename: "bad.epub" })).rejects.toThrow("Encrypted");
  });
  it("rejects unsupported, invalid UTF-8, over-limit and incomplete/expanded EPUB sources without silently dropping chapters", async () => {
    await expect(importSource({ data: "story", filename: "story.pdf" })).rejects.toThrow();
    await expect(importSource({ data: new Uint8Array([0xff]), filename: "story.txt" })).rejects.toThrow();
    await expect(importSource({ data: "too long", filename: "story.txt", maxBytes: 2 })).rejects.toThrow(/limit/);
    const base = {
      "META-INF/container.xml": strToU8('<container><rootfile full-path="book.opf"/></container>'),
      "book.opf": strToU8('<package><manifest><item id="missing" href="missing.xhtml"/></manifest><spine><itemref idref="missing"/></spine></package>'),
    };
    await expect(importSource({ data: zipSync(base), filename: "missing.epub" })).rejects.toThrow(/chapter is missing/);
    await expect(importSource({ data: zipSync({ ...base, "big.xhtml": strToU8("a".repeat(50_000)) }), filename: "big.epub", maxBytes: 1000 })).rejects.toThrow();
  });
});
