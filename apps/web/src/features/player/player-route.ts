import type { NativePlayerRoute } from "./NativePlayer.js";

export function nativePlayerHash(gameId: string, bundleFingerprint: string, debug = false): string {
  return `#player/${encodeURIComponent(gameId)}/${encodeURIComponent(bundleFingerprint)}${debug ? "/debug" : ""}`;
}

export function parseNativePlayerRoute(hash: string): NativePlayerRoute | null {
  const match = /^#player\/([^/]+)\/([0-9a-f]{32})(\/debug)?$/.exec(hash);
  if (!match) return null;
  try {
    return { gameId: decodeURIComponent(match[1]!), bundleFingerprint: match[2]!, debug: Boolean(match[3]) };
  } catch {
    return null;
  }
}
