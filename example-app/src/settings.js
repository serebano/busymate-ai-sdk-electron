// Example settings: defaults and validation. Pure; unit-tested by the SDK's test suite.
"use strict";

const ASSISTANT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Guest defaults: the real hosted Busymate support assistant. */
function defaults() {
  return {
    assistant: "busyproxy",
    chatUrl: "https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en",
    locale: "en",
    origins: "https://busymate.ai",
    signedIn: false,
    accountId: "",
    mintUrl: "",
    microphone: true,
    handleCloseAction: false,
    closeCallback: true,
  };
}

/** Same rule as the SDK: an exact https origin, no wildcard, path, query, fragment or credentials. */
function exactOrigin(raw) {
  const text = String(raw).trim();
  if (!text || text.includes("*")) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" || /^https:\/\/[^/]+\/./i.test(text)) return null;
  return url.origin.toLowerCase();
}

function secureUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Validate the form. Returns { ok: true, value } with the chat URL's locale
 * applied, or { ok: false, error }. An account id is NOT a login: identified
 * mode also needs your authenticated mint endpoint.
 */
function validate(input) {
  const form = { ...defaults(), ...input };
  const assistant = String(form.assistant).trim();
  if (!ASSISTANT.test(assistant)) return { ok: false, error: "Use a valid assistant slug." };
  const chat = secureUrl(form.chatUrl);
  if (!chat || chat.hash) return { ok: false, error: "Chat URL must use HTTPS with no credentials or fragment." };
  const locale = String(form.locale).trim();
  if (locale && !LOCALE.test(locale)) return { ok: false, error: "Locale must look like en or pt-BR." };
  if (locale) chat.searchParams.set("locale", locale);
  const origins = [];
  for (const raw of String(form.origins).split(/[\s,]+/).filter(Boolean)) {
    const origin = exactOrigin(raw);
    if (!origin) return { ok: false, error: "Origins must be exact HTTPS origins, without paths or wildcards." };
    if (!origins.includes(origin)) origins.push(origin);
  }
  const own = `https://${assistant}.busymate.ai`;
  if (!origins.includes(chat.origin) && chat.origin !== own) {
    return { ok: false, error: "Include the actual chat origin in the allowed origins." };
  }
  const mintUrl = String(form.mintUrl).trim();
  const mint = mintUrl ? secureUrl(mintUrl) : null;
  if (mintUrl && (!mint || mint.hash)) return { ok: false, error: "The mint endpoint must be an HTTPS URL." };
  const accountId = String(form.accountId).trim();
  if (form.signedIn === true) {
    if (!accountId) return { ok: false, error: "Identified mode requires your actual signed-in account ID. This is not a login." };
    if (!mint) return { ok: false, error: "Identified mode requires your authenticated HTTPS mint endpoint." };
  }
  return {
    ok: true,
    value: {
      assistant,
      chatUrl: chat.href,
      locale,
      origins,
      signedIn: form.signedIn === true,
      accountId: form.signedIn === true ? accountId : "",
      mintUrl: mint ? mint.href : "",
      microphone: form.microphone !== false,
      handleCloseAction: form.handleCloseAction === true,
      closeCallback: form.closeCallback !== false,
    },
  };
}

module.exports = { defaults, validate, exactOrigin };
