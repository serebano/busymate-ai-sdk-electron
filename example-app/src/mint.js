// The example's implementation of the SDK `mint` callback: it asks YOUR
// authenticated backend for a fresh launch token. No signing key, admin key or
// backend logic lives in the app. Unit-tested by the SDK's test suite.
"use strict";

/**
 * @param {{ url: string, sessionToken?: string, fetch?: typeof fetch, timeoutMs?: number, log?: (what: string) => void }} options
 * @returns {(request: { nonce?: string, aud?: string, reason?: string, assistant: string, origin: string }) => Promise<{token: string, nonce: string} | null>}
 */
function createBackendMint(options) {
  const doFetch = options.fetch || fetch;
  const log = options.log || (() => {});
  return async function mint(request) {
    const nonce = typeof request.nonce === "string" ? request.nonce : "";
    if (!nonce) throw new Error("mint request without nonce");
    const body = { nonce, assistant: request.assistant, origin: request.origin };
    if (typeof request.aud === "string") body.aud = request.aud;
    if (typeof request.reason === "string") body.reason = request.reason;
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    const token = options.sessionToken || "";
    if (token) {
      if (/[\r\n]/.test(token)) throw new Error("invalid session token");
      headers.Authorization = "Bearer " + token;
    }
    log("mint requested");
    // redirect: "error" — never forward the app session credential to another endpoint.
    const response = await doFetch(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs || 12000),
    });
    if (response.status === 401 || response.status === 403) {
      log("mint: signed out");
      return null;
    }
    if (!response.ok) throw new Error("mint failed");
    const json = await response.json();
    if (!json || typeof json.token !== "string" || !json.token || json.nonce !== nonce) throw new Error("mint reply rejected");
    log("mint: token received");
    return { token: json.token, nonce: json.nonce };
  };
}

module.exports = { createBackendMint };
