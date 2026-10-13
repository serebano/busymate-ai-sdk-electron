// Exact-origin helpers. The identity allow-list itself comes from the frozen
// core (`allowedOrigins`), so navigation, microphone and identity checks use
// the very same list the bridge enforces.
import { frozenCore } from "./frozen.js";

const EXACT_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;

/**
 * "https://host[:port]", lower-case, default port dropped; null for anything
 * else, including "null" (an opaque, sandboxed frame), wildcards and http.
 * Same rule as the frozen bridge.
 */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/\/$/, "").replace(/:443$/, "");
  return EXACT_ORIGIN.test(value) ? value : null;
}

/**
 * Strict parser for a configured origin: scheme + host + optional port only.
 * Rejects wildcards, paths, queries, fragments, credentials and non-https.
 */
export function parseExactOrigin(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" || /^https:\/\/[^/]+\/./i.test(text)) return null;
  return normalizeOrigin(url.origin);
}

/** The https origin of a URL, or null (http, file, data, javascript, opaque, malformed). */
export function originOfUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return normalizeOrigin(url.origin);
  } catch {
    return null;
  }
}

/**
 * The exact origins allowed to use the bridges: https://<assistant>.busymate.ai
 * plus your exact https origins. Computed by the frozen core.
 */
export function allowedOrigins(config: { assistant: string; origins?: string[] }): string[] {
  return frozenCore().allowedOrigins({ assistant: config.assistant, origins: config.origins ?? [] });
}

/** Whether `origin` is exactly one of `allowed`. */
export function isAllowedOrigin(allowed: readonly string[], origin: unknown): boolean {
  const value = normalizeOrigin(origin);
  return value !== null && allowed.includes(value);
}
