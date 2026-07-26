import type { Project } from "@story-to-cyoa/domain";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeTweeText(value: string): string {
  return escapeHtml(value)
    .replace(/\[\[/g, "&#91;&#91;")
    .replace(/<</g, "&lt;&lt;");
}

export function passageNameMap(project: Project): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const passage of project.passages) {
    const base = (passage.title || passage.id)
      .normalize("NFC")
      .replace(/[\[\]{}|<>]/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Passage";
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${base} (${suffix++})`;
    used.add(candidate.toLocaleLowerCase());
    names.set(passage.id, candidate);
  }
  return names;
}
