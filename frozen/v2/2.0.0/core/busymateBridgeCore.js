// Busymate AI — kit v2 host core for JavaScript hosts (`busymate.bridge/2`, build 2.0.0).
//
// FROZEN, like the Android and iOS bridges: the same five operations over the
// same JSON envelope, for hosts whose native side is JavaScript (React Native,
// Electron). It only moves envelopes and calls YOUR callbacks; every policy is in
// the chat served from busymate.ai. No dependencies (SHA-256 included).
//
// Contract: https://busymate.ai/sdk/v2/2.0.0/CONTRACT.md

"use strict";

var VERSION = 2;
var BUILD = "2.0.0";
var MAX_ENVELOPE = 64 * 1024;
var MINT_CEILING_MS = 15000;
var ASSISTANT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
var EXACT_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;

/** "https://host[:port]", lower-case, default port dropped; null for anything else (wildcards, "null"). */
function normalizedOrigin(raw) {
  if (typeof raw !== "string") return null;
  var value = raw.trim().toLowerCase().replace(/\/$/, "").replace(/:443$/, "");
  return EXACT_ORIGIN.test(value) ? value : null;
}

/**
 * Who may ask: EXACTLY https://<assistant>.busymate.ai plus the exact https
 * origins you list. No wildcards: another tenant's chat, or any other
 * busymate.ai page, is refused and never reaches your mint.
 */
function allowedOrigins(config) {
  var out = [];
  if (typeof config.assistant === "string" && ASSISTANT.test(config.assistant)) out.push("https://" + config.assistant + ".busymate.ai");
  (config.origins || []).forEach(function (origin) {
    var value = normalizedOrigin(origin);
    if (value && out.indexOf(value) < 0) out.push(value);
  });
  return out;
}

/**
 * @param {object} config
 * @param {string} config.platform          "react-native" | "electron"
 * @param {string} config.assistant         your assistant slug; https://<assistant>.busymate.ai may ask
 * @param {string} config.appId             your bundle/package id (salts the account key)
 * @param {string} [config.appVersion]
 * @param {string} [config.appBuild]
 * @param {string} [config.webview]         e.g. "Chrome/140"
 * @param {string[]} [config.origins]       extra EXACT https origins that load the chat (no wildcards)
 * @param {() => (string|null)} config.account             signed-in account id, or null
 * @param {(request: object) => Promise<{token: string, nonce: string}|null>} config.mint
 *        `request` is the chat's, plus `assistant` and `origin` set by this file (never by the page)
 * @param {(url: string, mode: string) => (boolean|Promise<boolean>)} config.open   open an https URL outside the app
 * @param {(name: string, params: object) => boolean} [config.onAction]
 * @param {() => void} [config.onClose]
 */
function createBusymateBridgeCore(config) {
  var origins = allowedOrigins(config);

  function originAllowed(origin) {
    var value = normalizedOrigin(origin);
    return !!value && origins.indexOf(value) >= 0;
  }

  function state() {
    var account = null;
    try { account = config.account(); } catch (_) { account = null; }
    return account == null
      ? { signedIn: false, account: null }
      : { signedIn: true, account: sha256Hex(config.appId + ":" + account).slice(0, 32) };
  }

  function hello(origin) {
    return {
      bridge: "busymate", v: VERSION, build: BUILD, platform: config.platform, transport: "host-js",
      assistant: config.assistant, origin: origin, origins: origins.slice(),
      caps: ["hello", "state", "mint", "open", "action", "ev:resume", "ev:state", "ev:restored"],
      webview: config.webview || null,
      app: { id: config.appId, version: config.appVersion || null, build: config.appBuild || null },
    };
  }

  /**
   * Handle ONE envelope string from the page. `reply(string)` is called at most
   * once with the reply envelope. `origin` is the sender's origin as your host
   * knows it (the page URL's origin). Never throws.
   */
  function handle(raw, origin, reply) {
    var envelope;
    try {
      if (typeof raw !== "string" || raw.length > MAX_ENVELOPE) return;
      envelope = JSON.parse(raw);
    } catch (_) { return; }
    if (!envelope || envelope.bm !== VERSION || envelope.id == null) return;
    var sent = false;
    function respond(body) {
      if (sent) return;
      sent = true;
      body.bm = VERSION;
      body.id = envelope.id;
      try { reply(JSON.stringify(body)); } catch (_) { /* host gone */ }
    }
    if (!originAllowed(origin)) return respond({ ok: false, e: "denied" });
    var from = normalizedOrigin(origin);
    var p = envelope.p && typeof envelope.p === "object" ? envelope.p : {};
    switch (envelope.op) {
      case "hello": return respond({ ok: true, r: hello(from) });
      case "state": return respond({ ok: true, r: state() });
      case "mint": {
        if (!state().signedIn) return respond({ ok: false, e: "not_signed_in" });
        var timer = setTimeout(function () { respond({ ok: false, e: "timeout" }); }, MINT_CEILING_MS);
        // Who asked is stated by this file, never by the page.
        var request = {};
        for (var key in p) if (Object.prototype.hasOwnProperty.call(p, key)) request[key] = p[key];
        request.assistant = config.assistant;
        request.origin = from;
        Promise.resolve().then(function () { return config.mint(request); }).then(function (token) {
          clearTimeout(timer);
          if (token && typeof token.token === "string" && typeof token.nonce === "string") {
            respond({ ok: true, r: { token: token.token, nonce: token.nonce } });
          } else {
            respond({ ok: false, e: "not_signed_in" });
          }
        }, function () { clearTimeout(timer); respond({ ok: false, e: "mint_failed" }); });
        return;
      }
      case "open": {
        var url = typeof p.url === "string" ? p.url : "";
        if (!/^https:\/\/[^/\s]+/i.test(url)) return respond({ ok: false, e: "bad_request" });
        Promise.resolve().then(function () { return config.open(url, p.mode === "auth" ? "auth" : "external"); })
          .then(function (opened) { respond({ ok: true, r: { opened: opened !== false } }); },
            function () { respond({ ok: false, e: "unsupported" }); });
        return;
      }
      case "action": {
        var name = typeof p.name === "string" ? p.name : "";
        if (!name || name.length > 64) return respond({ ok: false, e: "bad_request" });
        var handled = false;
        try { handled = !!(config.onAction && config.onAction(name, p.params || {})); } catch (_) { handled = false; }
        if (!handled && name === "close" && config.onClose) { config.onClose(); handled = true; }
        return respond({ ok: true, r: { handled: handled } });
      }
      default: return respond({ ok: false, e: "unsupported" });
    }
  }

  /** An event envelope string: "resume" | "state" | "restored". */
  function event(ev) {
    return JSON.stringify({ bm: VERSION, ev: ev, r: ev === "state" ? state() : {} });
  }

  return { handle: handle, event: event, originAllowed: originAllowed, origins: origins.slice() };
}

/** The page-side event delivery, as a script string your host evaluates in the page. */
function deliverScript(envelopeString) {
  return "window.dispatchEvent(new CustomEvent('busymate-bridge',{detail:" + JSON.stringify(envelopeString) + "}));true;";
}

// ── SHA-256 (FIPS 180-4), UTF-8 in, hex out ─────────────────────────────────
var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8(text) {
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      var cp = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function sha256Hex(text) {
  var bytes = utf8(String(text));
  var bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, (bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff);
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64);
  for (var off = 0; off < bytes.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
    }
    for (t = 16; t < 64; t++) {
      var a0 = w[t - 15], a1 = w[t - 2];
      var s0 = ((a0 >>> 7) | (a0 << 25)) ^ ((a0 >>> 18) | (a0 << 14)) ^ (a0 >>> 3);
      var s1 = ((a1 >>> 17) | (a1 << 15)) ^ ((a1 >>> 19) | (a1 << 13)) ^ (a1 >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (k + S1 + ch + K[t] + w[t]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }
  return h.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
}

var busymateBridgeCore = {
  createBusymateBridgeCore: createBusymateBridgeCore, allowedOrigins: allowedOrigins, normalizedOrigin: normalizedOrigin,
  deliverScript: deliverScript, sha256Hex: sha256Hex, BUILD: BUILD,
};
// CommonJS (React Native / Metro, Electron main) — the file ships as-is.
if (typeof module === "object" && module && module.exports) module.exports = busymateBridgeCore;
