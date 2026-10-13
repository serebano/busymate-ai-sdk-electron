// Busymate AI SDK for Electron — example app (main process).
//
// A Settings window configures the real SDK; "Apply and open chat" creates a
// secure chat window with createBusymateChatWindow(). Guest mode needs no
// backend. Identified mode calls YOUR authenticated mint endpoint. The log
// shows callback and permission decisions, never tokens, nonces, account ids
// or audio.
"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("node:path");
const sdk = require("@busymate/ai-electron");
const { defaults, validate } = require("./src/settings");
const { createBackendMint } = require("./src/mint");
const { actionCallback, closeCallback } = require("./src/callbacks");

const SMOKE = process.argv.includes("--busymate-smoke") || process.env.BUSYMATE_EXAMPLE_SMOKE === "1";
const LOG_LIMIT = 100;

let settingsWindow = null;
let chat = null;
let form = defaults();
let sessionToken = ""; // your existing backend session credential: memory only, never persisted
let accountId = null;
const log = [];
const smokeEvents = [];

function record(kind, detail = "") {
  const entry = { at: new Date().toISOString().slice(11, 19), kind, detail: String(detail).slice(0, 200) };
  log.push(entry);
  if (log.length > LOG_LIMIT) log.shift();
  smokeEvents.push(entry);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send("demo:log", entry);
  if (SMOKE) console.log(`[event] ${entry.kind} ${entry.detail}`);
}

function describe(event) {
  switch (event.type) {
    case "bridge-request":
      return `${event.op} from ${event.origin ?? "opaque"}${event.allowed ? "" : " (denied)"}`;
    case "microphone-request":
      return `${event.source || "?"} from ${event.origin}${event.userActivation ? " after tap" : " without tap"}`;
    case "microphone-reply":
      return `granted=${event.granted}${event.prompted ? " (OS asked)" : ""}`;
    case "microphone-refused":
      return `${event.reason} ${event.origin ?? "opaque"}`;
    case "media-permission":
      return `${event.mediaTypes.join("+") || "none"} from ${event.origin ?? "opaque"}: ${event.granted ? "granted" : "denied"}`;
    case "navigation-blocked":
    case "window-open-blocked":
      return `${event.url}${event.openedExternally ? " (opened in browser)" : ""}`;
    case "render-process-gone":
      return `${event.reason} (${event.exitCode}); reloading`;
    default:
      return "";
  }
}

function closeChat() {
  const current = chat;
  chat = null;
  if (current && !current.window.isDestroyed()) current.window.close();
}

async function openChat(value) {
  closeChat();
  accountId = value.signedIn ? value.accountId : null;
  const mint = value.mintUrl
    ? createBackendMint({ url: value.mintUrl, sessionToken, log: (what) => record("mint", what) })
    : async () => null;
  const created = sdk.createBusymateChatWindow({
    url: value.chatUrl,
    assistant: value.assistant,
    origins: value.origins,
    appId: "ai.busymate.sdk.electron.example",
    appVersion: app.getVersion(),
    account: () => accountId,
    mint: async (request) => {
      try {
        return await mint(request);
      } catch (error) {
        record("mint", "failed");
        throw error;
      }
    },
    onAction: actionCallback(value.handleCloseAction, {
      close: () => {
        record("onAction", "close (handled)");
        closeChat();
      },
      ready: () => record("onAction", "ready"),
    }),
    onClose: closeCallback(value.closeCallback, () => {
      record("onClose", "chat asked to close");
      closeChat();
    }),
    microphone: value.microphone,
    onEvent: (event) => record(event.type, describe(event)),
    window: { title: "Busymate chat", width: 440, height: 720 },
  });
  chat = created;
  created.window.on("closed", () => {
    if (chat === created) chat = null;
    record("chat", "closed");
  });
  record("chat", `opening ${sdk.redact(value.chatUrl)} (microphone ${value.microphone ? "on" : "off"}, ${value.signedIn ? "identified" : "guest"})`);
  try {
    await created.load();
    return { host: created, loaded: "loaded" };
  } catch (error) {
    record("chat", `load failed: ${error.code || error.message}`);
    return { host: created, loaded: `failed ${error.code || error.message}` };
  }
}

function fromSettings(event) {
  return settingsWindow && event.sender === settingsWindow.webContents;
}

function registerIpc() {
  ipcMain.handle("demo:state", (event) => {
    if (!fromSettings(event)) return null;
    return {
      form,
      log,
      versions: {
        sdk: sdk.SDK_VERSION,
        bridge: sdk.BRIDGE_BUILD,
        microphone: sdk.MICROPHONE_ADAPTER,
        electron: process.versions.electron,
        platform: process.platform,
      },
    };
  });
  ipcMain.handle("demo:apply", async (event, input, token) => {
    if (!fromSettings(event)) return { ok: false, error: "refused" };
    const result = validate(input);
    if (!result.ok) return result;
    form = { ...result.value, origins: result.value.origins.join("\n") };
    sessionToken = typeof token === "string" ? token.trim() : "";
    try {
      await openChat(result.value);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, form };
  });
  ipcMain.handle("demo:account-changed", (event, input) => {
    if (!fromSettings(event)) return { ok: false };
    const result = validate({ ...form, ...input });
    if (!result.ok) return result;
    accountId = result.value.signedIn ? result.value.accountId : null;
    form = { ...form, signedIn: result.value.signedIn, accountId: result.value.accountId };
    if (chat) chat.accountChanged();
    record("accountChanged", accountId ? "signed in" : "signed out");
    return { ok: true };
  });
  ipcMain.handle("demo:close-chat", (event) => {
    if (fromSettings(event)) closeChat();
    return { ok: true };
  });
  ipcMain.handle("demo:reset", (event) => {
    if (!fromSettings(event)) return null;
    closeChat();
    form = defaults();
    sessionToken = "";
    accountId = null;
    record("settings", "reset to guest defaults");
    return form;
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    title: "Busymate SDK example — Settings",
    width: 560,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  const wc = settingsWindow.webContents;
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
}

async function smoke() {
  const result = { checks: {}, ok: false };
  const fail = (why) => {
    result.error = why;
  };
  try {
    result.checks.settingsPreload = await settingsWindow.webContents.executeJavaScript("typeof window.demo === 'object' && typeof window.demo.apply === 'function' && typeof require === 'undefined'");
    const value = validate(defaults()).value;
    const { host: opened, loaded } = await openChat(value);
    const wc = opened.webContents;
    result.checks.load = loaded;
    const prefs = wc.getLastWebPreferences();
    result.checks.webPreferences = { contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration };
    result.checks.page = await wc.executeJavaScript(
      "({ origin: location.origin, bridge: typeof (window.BusymateBridge && window.BusymateBridge.postMessage), microphone: typeof (window.BusymateMicrophone && window.BusymateMicrophone.postMessage), require: typeof require, process: typeof process })",
    );
    // Informational (the hosted chat's behaviour, not the SDK's): on `channel=desktop_sdk` the
    // document carries the generic native canvas (`data-native-chrome="1"`), never the
    // Busymate Console's `"desktop"` value, and `<html lang>` follows `locale` from the first frame.
    result.checks.document = await wc.executeJavaScript(
      "({ url: location.href, nativeChrome: document.documentElement.getAttribute('data-native-chrome'), lang: document.documentElement.lang })",
    );
    // Give the hosted chat time to say hello over the bridge (its behaviour, not the SDK's).
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !smokeEvents.some((e) => e.kind === "bridge-request")) await new Promise((r) => setTimeout(r, 250));
    result.checks.bridgeRequests = smokeEvents.filter((e) => e.kind === "bridge-request").map((e) => e.detail);
    const page = result.checks.page;
    result.ok =
      result.checks.settingsPreload === true &&
      loaded === "loaded" &&
      prefs.contextIsolation === true &&
      prefs.sandbox === true &&
      prefs.nodeIntegration === false &&
      page.bridge === "function" &&
      page.microphone === "function" &&
      page.require === "undefined" &&
      page.process === "undefined";
    if (!result.ok) fail("a check failed");
  } catch (error) {
    fail(error.message);
  }
  console.log("SMOKE_RESULT " + JSON.stringify(result));
  closeChat();
  app.exit(result.ok ? 0 : 1);
}

app.whenReady().then(async () => {
  // The settings page needs no permission at all. The chat uses its own
  // session partition, whose handlers the SDK owns.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  await createSettingsWindow();
  record("app", `SDK ${sdk.SDK_VERSION}, bridge ${sdk.BRIDGE_BUILD}, microphone adapter ${sdk.MICROPHONE_ADAPTER}, Electron ${process.versions.electron}`);
  if (SMOKE) await smoke();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || SMOKE) app.quit();
});

app.on("activate", () => {
  if (!settingsWindow) void createSettingsWindow();
});
