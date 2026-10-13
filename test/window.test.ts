import { readFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeFrame, FakeWebContents, created, flush, ipcEvent, ipcMain, shell } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electron);

const sdk = await import("../src/index");
const OWN = "https://busyproxy.busymate.ai";

afterEach(() => {
  ipcMain.removeAllListeners();
  shell.opened.length = 0;
  created.windows.length = 0;
  created.views.length = 0;
});

describe("origins", () => {
  it("parses exact https origins only", () => {
    expect(sdk.parseExactOrigin("https://Support.Acme.com")).toBe("https://support.acme.com");
    expect(sdk.parseExactOrigin("https://acme.com:443")).toBe("https://acme.com");
    expect(sdk.parseExactOrigin("https://acme.com:8443")).toBe("https://acme.com:8443");
    expect(sdk.parseExactOrigin("https://acme.com/")).toBe("https://acme.com");
    for (const bad of ["http://acme.com", "https://*.acme.com", "https://acme.com/path", "https://u:p@acme.com", "https://acme.com?q=1", "https://acme.com#f", "acme.com", "null", ""]) {
      expect(sdk.parseExactOrigin(bad), bad).toBeNull();
    }
  });

  it("builds the allow-list exactly as the frozen core does", () => {
    expect(sdk.allowedOrigins({ assistant: "acme", origins: ["https://support.acme.com/", "https://*.x.com", "http://a.com"] })).toEqual([
      "https://acme.busymate.ai",
      "https://support.acme.com",
    ]);
    expect(sdk.allowedOrigins({ assistant: "Bad_Slug" })).toEqual([]);
    expect(sdk.isAllowedOrigin(["https://a.com"], "https://A.com:443")).toBe(true);
    expect(sdk.isAllowedOrigin(["https://a.com"], "null")).toBe(false);
    expect(sdk.originOfUrl("javascript:alert(1)")).toBeNull();
    expect(sdk.originOfUrl("https://a.com/x?y")).toBe("https://a.com");
  });

  it("defaults the guest chat to the desktop_sdk channel and English", () => {
    expect(sdk.DEFAULT_GUEST_CHAT_URL).toBe("https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en");
    expect(sdk.SDK_VERSION).toBe("1.0.1");
    expect(sdk.MICROPHONE_ADAPTER).toBe("1.0.0");
  });
});

describe("secure hosts", () => {
  const base = {
    url: "https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en",
    assistant: "busyproxy",
    origins: ["https://busymate.ai"],
    appId: "ai.busymate.example",
    account: () => null,
    mint: async () => null,
  };

  it("uses contextIsolation, the sandbox and no Node.js integration", () => {
    const prefs = sdk.secureWebPreferences({ preload: "/p.js" });
    expect(prefs).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: "persist:busymate-chat",
    });
  });

  it("refuses a chat URL outside the allow-list, http or with credentials", () => {
    expect(() => sdk.resolveChatTarget({ ...base, origins: [] })).toThrow(/not in the allowed origins/);
    expect(() => sdk.resolveChatTarget({ ...base, url: "http://busymate.ai/support/busyproxy" })).toThrow(/https/);
    expect(() => sdk.resolveChatTarget({ ...base, url: "https://u:p@busymate.ai/" })).toThrow(/https/);
    expect(() => sdk.resolveChatTarget({ ...base, assistant: "", origins: [] })).toThrow(/no valid/);
    expect(sdk.resolveChatTarget(base).origins).toEqual([OWN, "https://busymate.ai"]);
  });

  it("creates a window with the secure preferences, the combined preload and a hardened WebContents", async () => {
    const events: string[] = [];
    const chat = sdk.createBusymateChatWindow({ ...base, onEvent: (e) => events.push(e.type), window: { width: 500 } });
    const window = created.windows[0]!;
    const prefs = (window.options as { webPreferences: Record<string, unknown> }).webPreferences;
    expect(window.options.width).toBe(500);
    expect(prefs).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(String(prefs.preload)).toMatch(/dist[\\/]preload\.js$/);
    const wc = window.webContents;

    const navigate = (url: string, isMainFrame = true) => {
      let prevented = false;
      wc.emit("will-navigate", { url, isMainFrame, preventDefault: () => (prevented = true) }, url);
      return prevented;
    };
    expect(navigate("https://busymate.ai/support/busyproxy?x=1")).toBe(false);
    expect(navigate("https://example.com/page?token=secret")).toBe(true);
    expect(navigate("javascript:alert(1)")).toBe(true);
    expect(navigate("https://example.com/frame", false)).toBe(false);
    await flush();
    expect(shell.opened).toEqual(["https://example.com/page?token=secret"]);

    expect(wc.windowOpenHandler!({ url: "https://docs.example.com/" })).toEqual({ action: "deny" });
    expect(wc.windowOpenHandler!({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    await flush();
    expect(shell.opened).toEqual(["https://example.com/page?token=secret", "https://docs.example.com/"]);

    let attached = false;
    wc.emit("will-attach-webview", { preventDefault: () => (attached = true) });
    expect(attached).toBe(true);

    await chat.load();
    expect(wc.url).toBe(base.url);
    expect(events).toContain("navigation-blocked");
    expect(events).toContain("window-open-blocked");
    expect(events).toContain("webview-blocked");
  });

  it("logs bridge requests by op and origin only, and reports renderer crashes", async () => {
    const events: Array<Record<string, unknown>> = [];
    const gone = vi.fn();
    sdk.createBusymateChatWindow({ ...base, onEvent: (e) => events.push(e), onRenderProcessGone: gone });
    const wc = created.windows[0]!.webContents;
    const { event, replies } = ipcEvent(wc, new FakeFrame("https://busymate.ai"));
    ipcMain.emit("busymate:bridge", event, JSON.stringify({ bm: 2, id: 1, op: "hello" }));
    await flush();
    expect(JSON.parse(replies[0]!).ok).toBe(true);
    expect(events).toContainEqual({ type: "bridge-request", op: "hello", origin: "https://busymate.ai", allowed: true });
    wc.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
    expect(gone).toHaveBeenCalledWith({ reason: "oom", exitCode: 9 });
    expect(events).toContainEqual({ type: "render-process-gone", reason: "oom", exitCode: 9 });
    expect(wc.reloads).toBe(1);
  });

  it("uses the frozen identity-only preload when the microphone is off", () => {
    const chat = sdk.createBusymateChatView({ ...base, microphone: false });
    const prefs = created.views[0]!.options.webPreferences as Record<string, unknown>;
    expect(String(prefs.preload)).toMatch(/frozen[\\/]v2[\\/]2\.0\.0[\\/]electron[\\/]preload\.js$/);
    expect(chat.microphone).toBeNull();
  });

  it("redacts query and fragment from logged URLs", () => {
    expect(sdk.redact("https://a.com/p?token=x#y")).toBe("https://a.com/p");
    expect(sdk.redact("mailto:x@y.z")).toBe("mailto:");
  });

  it("disposes listeners when the WebContents is destroyed", () => {
    const view = sdk.createBusymateChatView(base);
    const wc = view.webContents as unknown as FakeWebContents;
    expect(ipcMain.listenerCount("busymate:bridge")).toBe(2);
    expect(ipcMain.listenerCount("busymate:microphone")).toBe(1);
    wc.destroy();
    expect(ipcMain.listenerCount("busymate:bridge")).toBe(0);
    expect(ipcMain.listenerCount("busymate:microphone")).toBe(0);
  });
});

describe("combined preload", () => {
  it("starts with the frozen kit v2 preload byte for byte", () => {
    const built = new URL("../dist/preload.js", import.meta.url);
    if (!existsSync(built)) throw new Error("run `npm run build` before the tests");
    const frozen = readFileSync(new URL("../frozen/v2/2.0.0/electron/preload.js", import.meta.url));
    const combined = readFileSync(built);
    expect(combined.subarray(0, frozen.length).equals(frozen)).toBe(true);
    expect(combined.toString("utf8")).toContain('exposeInMainWorld("BusymateMicrophone"');
  });
});
