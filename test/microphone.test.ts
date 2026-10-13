import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeFrame, FakeSession, FakeWebContents, flush, ipcEvent, ipcMain } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electron);

const { createMicrophoneGate, installBusymateMicrophone, microphoneReply, parseMicrophoneRequest, systemMediaAccess } = await import("../src/index");
type MediaStatus = import("../src/index").MediaStatus;

const OWN = "https://acme.busymate.ai";
const request = (id = "mic-1", source = "dictation") => JSON.stringify({ type: "busymate.microphone.v1.request", id, source });

function media(initial: MediaStatus, answer = true) {
  const state = { status: initial, asks: 0, answer };
  let release: (value: boolean) => void = () => undefined;
  return {
    state,
    access: {
      status: () => state.status,
      ask: () => {
        state.asks++;
        return new Promise<boolean>((resolve) => {
          release = (value) => {
            state.status = value ? "granted" : "denied";
            resolve(value);
          };
        });
      },
    },
    release: (value = state.answer) => release(value),
  };
}

describe("microphone wire 1 messages", () => {
  it("parses only well-formed requests within 4096 characters", () => {
    expect(parseMicrophoneRequest(request())).toEqual({ id: "mic-1", source: "dictation" });
    expect(parseMicrophoneRequest(JSON.stringify({ type: "busymate.microphone.v2.request", id: "a" }))).toBeNull();
    expect(parseMicrophoneRequest(JSON.stringify({ type: "busymate.microphone.v1.request", id: "" }))).toBeNull();
    expect(parseMicrophoneRequest(JSON.stringify({ type: "busymate.microphone.v1.request", id: 5 }))).toBeNull();
    expect(parseMicrophoneRequest("{")).toBeNull();
    expect(parseMicrophoneRequest(request("x".repeat(4100)))).toBeNull();
    expect(parseMicrophoneRequest({ type: "busymate.microphone.v1.request", id: "a" })).toBeNull();
  });

  it("replies with exactly the same id and a boolean", () => {
    expect(microphoneReply("mic-unique-id", true)).toBe('{"id":"mic-unique-id","granted":true}');
    expect(microphoneReply("m", false)).toBe('{"id":"m","granted":false}');
  });
});

describe("microphone gate", () => {
  it("answers an existing OS grant without prompting, then allows audio only", async () => {
    const os = media("granted");
    const gate = createMicrophoneGate({ origins: [OWN], media: os.access });
    expect(gate.allowMedia(OWN, ["audio"])).toBe(false); // nothing asked yet
    expect(await gate.handle(request(), OWN, false)).toBe('{"id":"mic-1","granted":true}');
    expect(os.state.asks).toBe(0);
    expect(gate.allowMedia(OWN, ["audio"])).toBe(true);
    expect(gate.allowMedia(OWN, ["video"])).toBe(false);
    expect(gate.allowMedia(OWN, ["audio", "video"])).toBe(false);
    expect(gate.allowMedia(OWN, [])).toBe(false);
    expect(gate.allowMedia("https://other.busymate.ai", ["audio"])).toBe(false);
    expect(gate.checkMedia(OWN, "audio")).toBe(true);
    expect(gate.checkMedia(OWN, "video")).toBe(false);
  });

  it("prompts only on a user activation and shares one pending ask", async () => {
    const os = media("not-determined");
    const gate = createMicrophoneGate({ origins: [OWN], media: os.access });
    expect(await gate.handle(request("no-tap"), OWN, false)).toBe('{"id":"no-tap","granted":false}');
    expect(os.state.asks).toBe(0);
    const first = gate.handle(request("a"), OWN, true);
    const second = gate.handle(request("b", "voice"), OWN, true);
    await flush();
    expect(os.state.asks).toBe(1);
    os.release(true);
    expect(await first).toBe('{"id":"a","granted":true}');
    expect(await second).toBe('{"id":"b","granted":true}');
  });

  it("denies, lets Retry ask again, and re-checks a revoked grant", async () => {
    const os = media("not-determined");
    const gate = createMicrophoneGate({ origins: [OWN], media: os.access });
    const denied = gate.handle(request("d"), OWN, true);
    await flush();
    os.release(false);
    expect(await denied).toBe('{"id":"d","granted":false}');
    expect(gate.allowMedia(OWN, ["audio"])).toBe(false);
    // Retry: the OS now refuses without a prompt until the user changes Settings.
    expect(await gate.handle(request("retry"), OWN, true)).toBe('{"id":"retry","granted":false}');
    expect(os.state.asks).toBe(1);
    // The user granted access in Settings; Retry succeeds.
    os.state.status = "granted";
    expect(await gate.handle(request("retry-2"), OWN, true)).toBe('{"id":"retry-2","granted":true}');
    expect(gate.allowMedia(OWN, ["audio"])).toBe(true);
    // Revoked in Settings: capture is refused on the next activation.
    os.state.status = "denied";
    expect(gate.allowMedia(OWN, ["audio"])).toBe(false);
    expect(await gate.handle(request("again"), OWN, true)).toBe('{"id":"again","granted":false}');
  });

  it("drops requests from other or opaque origins and malformed messages without a reply", async () => {
    const events: string[] = [];
    const gate = createMicrophoneGate({ origins: [OWN], media: media("granted").access, onEvent: (e) => events.push(e.type) });
    expect(await gate.handle(request(), "https://evil.example", true)).toBeNull();
    expect(await gate.handle(request(), "null", true)).toBeNull();
    expect(await gate.handle("garbage", OWN, true)).toBeNull();
    expect(events).toEqual(["microphone-refused", "microphone-refused", "microphone-refused"]);
  });

  it("forgets grants on reset (navigation, reload, crash)", async () => {
    const gate = createMicrophoneGate({ origins: [OWN], media: media("granted").access });
    await gate.handle(request(), OWN, false);
    gate.reset();
    expect(gate.allowMedia(OWN, ["audio"])).toBe(false);
  });

  it("treats Linux as having no app-level OS gate", async () => {
    const access = systemMediaAccess("linux");
    expect(access.status()).toBe("unknown");
    expect(await access.ask()).toBe(true);
  });
});

describe("installBusymateMicrophone", () => {
  afterEach(() => ipcMain.removeAllListeners());

  function setup(status: MediaStatus = "granted") {
    const session = new FakeSession();
    const webContents = new FakeWebContents(session);
    webContents.url = OWN + "/";
    const os = media(status);
    const handle = installBusymateMicrophone(webContents as never, { origins: [OWN], media: os.access });
    const ask = async (origin: string, raw = request(), activation = true, sender = webContents) => {
      const frame = new FakeFrame(origin);
      const { event } = ipcEvent(sender, frame);
      ipcMain.emit("busymate:microphone", event, raw, activation);
      await flush();
      await flush();
      return frame.sent;
    };
    const permission = (wc: unknown, name: string, details: Record<string, unknown>) =>
      new Promise<boolean>((resolve) => (session.requestHandler as (...a: unknown[]) => void)(wc, name, resolve, details));
    return { session, webContents, handle, ask, permission, os };
  }

  it("replies to the asking frame over IPC and grants Chromium audio afterwards", async () => {
    const { webContents, ask, permission } = setup();
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(false);
    expect(await ask(OWN)).toEqual([["busymate:microphone", '{"id":"mic-1","granted":true}']]);
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(true);
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["video"] })).toBe(false);
    expect(await permission(webContents, "media", { securityOrigin: "https://evil.example", mediaTypes: ["audio"] })).toBe(false);
    expect(await permission(webContents, "geolocation", { requestingUrl: OWN + "/" })).toBe(false);
    expect(await permission(webContents, "clipboard-sanitized-write", { requestingUrl: OWN + "/" })).toBe(true);
  });

  it("ignores other senders and denies other WebContents on the session", async () => {
    const { ask, permission } = setup();
    const stranger = new FakeWebContents();
    expect(await ask(OWN, request(), true, stranger)).toEqual([]);
    expect(await permission(stranger, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(false);
  });

  it("resets on a cross-document main-frame navigation and on renderer death", async () => {
    const { webContents, ask, permission } = setup();
    await ask(OWN);
    webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(true);
    webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(false);
    await ask(OWN);
    webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    expect(await permission(webContents, "media", { securityOrigin: OWN, mediaTypes: ["audio"] })).toBe(false);
  });

  it("stops after dispose and when the WebContents is destroyed", async () => {
    const { webContents, ask } = setup();
    webContents.destroy();
    expect(await ask(OWN)).toEqual([]);
  });
});
