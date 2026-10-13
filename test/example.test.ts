// Tests the example app's own settings, mint client and callbacks: the exact
// modules example-app/main.js uses.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const load = createRequire(import.meta.url);
const { defaults, validate } = load("../example-app/src/settings.js");
const { createBackendMint } = load("../example-app/src/mint.js");
const { actionCallback, closeCallback } = load("../example-app/src/callbacks.js");

describe("example settings", () => {
  it("defaults to the real hosted guest chat on the desktop_sdk channel", () => {
    const result = validate(defaults());
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      assistant: "busyproxy",
      chatUrl: "https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en",
      origins: ["https://busymate.ai"],
      signedIn: false,
      microphone: true,
      mintUrl: "",
    });
  });

  it("applies the locale to the chat URL", () => {
    expect(validate({ ...defaults(), locale: "pt-BR" }).value.chatUrl).toBe("https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=pt-BR");
    expect(validate({ ...defaults(), locale: "x y" }).ok).toBe(false);
  });

  it("rejects unsafe URLs and origins", () => {
    expect(validate({ ...defaults(), assistant: "Bad Slug" }).ok).toBe(false);
    expect(validate({ ...defaults(), chatUrl: "http://busymate.ai/support/busyproxy" }).ok).toBe(false);
    expect(validate({ ...defaults(), chatUrl: "https://busymate.ai/x#frag" }).ok).toBe(false);
    expect(validate({ ...defaults(), origins: "https://*.busymate.ai" }).ok).toBe(false);
    expect(validate({ ...defaults(), origins: "https://busymate.ai/path" }).ok).toBe(false);
    expect(validate({ ...defaults(), origins: "https://other.example" }).error).toMatch(/actual chat origin/);
  });

  it("accepts the assistant's own origin without listing it", () => {
    expect(validate({ ...defaults(), chatUrl: "https://busyproxy.busymate.ai/", origins: "" }).ok).toBe(true);
  });

  it("requires an account id and an HTTPS mint endpoint for identified mode", () => {
    expect(validate({ ...defaults(), signedIn: true }).error).toMatch(/account ID/);
    expect(validate({ ...defaults(), signedIn: true, accountId: "u1" }).error).toMatch(/mint endpoint/);
    expect(validate({ ...defaults(), signedIn: true, accountId: "u1", mintUrl: "http://api.example/mint" }).ok).toBe(false);
    const ok = validate({ ...defaults(), signedIn: true, accountId: "u1", mintUrl: "https://api.example/mint" });
    expect(ok.value).toMatchObject({ signedIn: true, accountId: "u1", mintUrl: "https://api.example/mint" });
    expect(validate({ ...defaults(), signedIn: false, accountId: "u1" }).value.accountId).toBe("");
  });
});

describe("example backend mint", () => {
  const request = { nonce: "n-1", aud: "busymate", reason: "launch", assistant: "busyproxy", origin: "https://busymate.ai" };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("posts the bridge request without caching or following redirects", async () => {
    const fetch = reply(200, { token: "jwt", nonce: "n-1" });
    const mint = createBackendMint({ url: "https://api.example/mint", sessionToken: "s3ss10n", fetch });
    expect(await mint(request)).toEqual({ token: "jwt", nonce: "n-1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.example/mint");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.headers.Authorization).toBe("Bearer s3ss10n");
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it("maps 401/403 to signed out and fails closed on anything else", async () => {
    expect(await createBackendMint({ url: "https://a", fetch: reply(401, {}) })(request)).toBeNull();
    expect(await createBackendMint({ url: "https://a", fetch: reply(403, {}) })(request)).toBeNull();
    await expect(createBackendMint({ url: "https://a", fetch: reply(500, {}) })(request)).rejects.toThrow();
    await expect(createBackendMint({ url: "https://a", fetch: reply(200, { token: "t", nonce: "other" }) })(request)).rejects.toThrow();
    await expect(createBackendMint({ url: "https://a", fetch: reply(200, { token: "", nonce: "n-1" }) })(request)).rejects.toThrow();
    await expect(createBackendMint({ url: "https://a", sessionToken: "a\r\nX: y", fetch: reply(200, {}) })(request)).rejects.toThrow();
  });
});

describe("example callbacks", () => {
  it("supplies onAction only when enabled and handles close only", () => {
    expect(actionCallback(false, {})).toBeUndefined();
    const close = vi.fn();
    const ready = vi.fn();
    const action = actionCallback(true, { close, ready });
    expect(action("close")).toBe(true);
    expect(action("ready")).toBe(false);
    expect(action("unknown")).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    expect(closeCallback(false, close)).toBeUndefined();
    expect(closeCallback(true, close)).toBe(close);
  });
});
