/** Collects the canonical stable-ID namespace used by Foundation 6 repairs. */
export function collectStableIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStableIds(item, result));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "id" || key === "key") && typeof item === "string") result.add(item);
      collectStableIds(item, result);
    }
  }
  return result;
}
