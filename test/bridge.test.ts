import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeFrame, FakeWebContents, flush, ipcEvent, ipcMain, shell } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electron);

const { frozenCore, installBusymateBridge, BRIDGE_BUILD } = await import("../src/index");

const OWN = "https://acme.busymate.ai";
const MAPPED = "https://support.acme.com";

function bridgeFor(overrides: Record<string, unknown> = {}) {
  const webContents = new FakeWebContents();
  webContents.url = OWN + "/";
  const handle = installBusymateBridge(webContents as never, {
    assistant: "acme",
    appId: "com.acme.desktop",
    appVersion: "3.1.0",
    origins: [MAPPED, "https://*.acme.com", "http://insecure.acme.com", "https://acme.com/path"],
    account: () => "user-42",
    mint: async (request) => ({ token: "t." + String(request.nonce), nonce: String(request.nonce) }),
    ...overrides,
  });
  const send = async (envelope: unknown, origin: string | null = OWN, sender = webContents) => {
    const frame = origin === null ? null : new FakeFrame(origin);
    const { event, replies } = ipcEvent(sender, frame);
    ipcMain.emit("busymate:bridge", event, typeof envelope === "string" ? envelope : JSON.stringify(envelope));
    await flush();
    return replies.map((reply) => JSON.parse(reply));
  };
  return { webContents, handle, send };
}

const installed: Array<{ dispose(): void }> = [];
afterEach(() => {
  while (installed.length) installed.pop()?.dispose();
  ipcMain.removeAllListeners();
  shell.opened.length = 0;
});
function track<T extends { handle: { dispose(): void } }>(value: T): T {
  installed.push(value.handle);
  return value;
}

describe("frozen kit v2 Electron bridge (build 2.0.0)", () => {
  it("answers hello with the contract fields", async () => {
    const { send } = track(bridgeFor());
    const [reply] = await send({ bm: 2, id: 1, op: "hello" });
    expect(BRIDGE_BUILD).toBe("2.0.0");
    expect(reply).toEqual({
      ok: true,
      r: {
        bridge: "busymate",
        v: 2,
        build: "2.0.0",
        platform: "electron",
        transport: "host-js",
        assistant: "acme",
        origin: OWN,
        origins: [OWN, MAPPED],
        caps: ["hello", "state", "mint", "open", "action", "ev:resume", "ev:state", "ev:restored"],
        webview: expect.stringMatching(/^Electron\//),
        app: { id: "com.acme.desktop", version: "3.1.0", build: null },
      },
      bm: 2,
      id: 1,
    });
  });

  it("refuses other origins, opaque frames and wildcard-configured hosts with denied", async () => {
    const mint = vi.fn();
    const { send } = track(bridgeFor({ mint }));
    for (const origin of ["https://other.busymate.ai", "https://busymate.ai", "null", "http://acme.busymate.ai", "https://x.acme.com"]) {
      expect(await send({ bm: 2, id: "m", op: "mint", p: { nonce: "n" } }, origin)).toEqual([{ ok: false, e: "denied", bm: 2, id: "m" }]);
    }
    expect(mint).not.toHaveBeenCalled();
  });

  it("accepts the mapped origin and normalizes a :443 port", async () => {
    const { send } = track(bridgeFor());
    expect((await send({ bm: 2, id: 2, op: "state" }, "https://support.acme.com:443"))[0].ok).toBe(true);
  });

  it("ignores messages from another WebContents and malformed envelopes", async () => {
    const { send } = track(bridgeFor());
    expect(await send({ bm: 2, id: 1, op: "hello" }, OWN, new FakeWebContents())).toEqual([]);
    expect(await send("not json")).toEqual([]);
    expect(await send({ bm: 1, id: 1, op: "hello" })).toEqual([]);
    expect(await send({ bm: 2, op: "hello" })).toEqual([]);
    expect(await send(JSON.stringify({ bm: 2, id: 1, op: "hello", pad: "x".repeat(65 * 1024) }))).toEqual([]);
  });

  it("hashes the account as SHA-256(appId:account) truncated to 128 bits", async () => {
    const { send } = track(bridgeFor());
    const [reply] = await send({ bm: 2, id: 3, op: "state" });
    const expected = createHash("sha256").update("com.acme.desktop:user-42").digest("hex").slice(0, 32);
    expect(reply.r).toEqual({ signedIn: true, account: expected });
    expect(frozenCore().sha256Hex("héllo ✓")).toBe(createHash("sha256").update("héllo ✓").digest("hex"));
  });

  it("mints with assistant and origin set by the bridge, never by the page", async () => {
    const mint = vi.fn(async (request: Record<string, unknown>) => ({ token: "tok", nonce: String(request.nonce) }));
    const { send } = track(bridgeFor({ mint }));
    const [reply] = await send({ bm: 2, id: 4, op: "mint", p: { nonce: "abc", aud: "x", assistant: "evil", origin: "https://evil.example" } });
    expect(mint).toHaveBeenCalledWith({ nonce: "abc", aud: "x", assistant: "acme", origin: OWN });
    expect(reply).toEqual({ ok: true, r: { token: "tok", nonce: "abc" }, bm: 2, id: 4 });
  });

  it("maps signed out, null and failing mints to not_signed_in and mint_failed", async () => {
    let bridge = track(bridgeFor({ account: () => null }));
    expect((await bridge.send({ bm: 2, id: 5, op: "mint", p: {} }))[0].e).toBe("not_signed_in");
    bridge.handle.dispose();
    bridge = track(bridgeFor({ mint: async () => null }));
    expect((await bridge.send({ bm: 2, id: 6, op: "mint", p: {} }))[0].e).toBe("not_signed_in");
    bridge.handle.dispose();
    bridge = track(bridgeFor({ mint: async () => Promise.reject(new Error("backend")) }));
    expect((await bridge.send({ bm: 2, id: 7, op: "mint", p: {} }))[0].e).toBe("mint_failed");
  });

  it("opens only https URLs and answers unsupported for unknown ops", async () => {
    const { send } = track(bridgeFor());
    expect((await send({ bm: 2, id: 8, op: "open", p: { url: "http://x.test", mode: "external" } }))[0].e).toBe("bad_request");
    expect((await send({ bm: 2, id: 9, op: "open", p: { url: "https://x.test/a", mode: "external" } }))[0]).toEqual({ ok: true, r: { opened: true }, bm: 2, id: 9 });
    expect(shell.opened).toEqual(["https://x.test/a"]);
    expect((await send({ bm: 2, id: 10, op: "eval" }))[0].e).toBe("unsupported");
  });

  it("routes close to onAction first, then onClose", async () => {
    const onClose = vi.fn();
    let bridge = track(bridgeFor({ onClose }));
    expect((await bridge.send({ bm: 2, id: 11, op: "action", p: { name: "close" } }))[0].r).toEqual({ handled: true });
    expect(onClose).toHaveBeenCalledOnce();
    expect((await bridge.send({ bm: 2, id: 12, op: "action", p: { name: "ready" } }))[0].r).toEqual({ handled: false });
    bridge.handle.dispose();
    bridge = track(bridgeFor({ onAction: (name: string) => name === "close", onClose }));
    await bridge.send({ bm: 2, id: 13, op: "action", p: { name: "close" } });
    expect(onClose).toHaveBeenCalledOnce();
    expect((await bridge.send({ bm: 2, id: 14, op: "action", p: { name: "" } }))[0].e).toBe("bad_request");
  });

  it("reloads after a renderer crash and emits restored to the chat", async () => {
    const { webContents } = track(bridgeFor());
    webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    expect(webContents.reloads).toBe(1);
    webContents.emit("did-finish-load");
    expect(webContents.sent.map(([, body]) => JSON.parse(body))).toEqual([{ bm: 2, ev: "restored", r: {} }]);
  });

  it("emits resume and state events and stops after dispose", async () => {
    const { webContents, handle, send } = track(bridgeFor());
    handle.resume();
    handle.accountChanged();
    const events = webContents.sent.map(([, body]) => JSON.parse(body));
    expect(events[0]).toEqual({ bm: 2, ev: "resume", r: {} });
    expect(events[1].ev).toBe("state");
    expect(events[1].r.signedIn).toBe(true);
    handle.dispose();
    expect(await send({ bm: 2, id: 1, op: "hello" })).toEqual([]);
  });
});
