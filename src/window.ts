// Secure chat hosts: a BrowserWindow or a WebContentsView with contextIsolation,
// the Chromium sandbox, no Node.js in the page, navigation and window.open
// restricted to the exact allowed origins, both bridges installed before the
// first load, and renderer-crash handling.
import {
  BrowserWindow,
  WebContentsView,
  session as electronSession,
  shell,
  ipcMain,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type RenderProcessGoneDetails,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import { bridgePreloadPath, frozenMain, preloadPath, type BridgeConfig, type BridgeHandle } from "./frozen.js";
import { installBusymateMicrophone, type MicrophoneEvent, type MicrophoneHandle, type MicrophoneOptions } from "./microphone.js";
import { allowedOrigins, isAllowedOrigin, normalizeOrigin, originOfUrl } from "./origins.js";

/** The dedicated session partition the chat uses unless you pass one. */
export const DEFAULT_PARTITION = "persist:busymate-chat";
const BRIDGE_CHANNEL = "busymate:bridge";

/** Host events for your log. Never carries tokens, nonces, account ids or audio. */
export type BusymateHostEvent =
  | MicrophoneEvent
  | { type: "bridge-request"; op: string; origin: string | null; allowed: boolean }
  | { type: "navigation-blocked"; url: string; openedExternally: boolean }
  | { type: "window-open-blocked"; url: string; openedExternally: boolean }
  | { type: "webview-blocked" }
  | { type: "render-process-gone"; reason: string; exitCode: number }
  | { type: "unresponsive" }
  | { type: "responsive" };

/** The webPreferences every chat host uses. Your own values cannot weaken them. */
export function secureWebPreferences(options: { preload: string; session?: Session; partition?: string }): WebPreferences {
  const prefs: WebPreferences = {
    preload: options.preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
  };
  if (options.session) prefs.session = options.session;
  else prefs.partition = options.partition ?? DEFAULT_PARTITION;
  return prefs;
}

/** Open only https URLs outside the app. */
export async function openExternalHttps(url: string): Promise<boolean> {
  if (originOfUrl(url) === null) return false;
  await shell.openExternal(url);
  return true;
}

export interface HardenOptions {
  /** Exact origins the chat may navigate to. */
  origins: readonly string[];
  /** Opens a refused https URL in the user's browser. Return false to refuse. Default: openExternalHttps. */
  openExternal?: (url: string) => boolean | Promise<boolean>;
  onEvent?: (event: BusymateHostEvent) => void;
}

/**
 * Restrict a chat WebContents: top-level navigation and redirects stay on the
 * exact allowed origins; every new window is denied (https targets open in the
 * user's browser instead); <webview> attachment is refused.
 */
export function hardenWebContents(webContents: WebContents, options: HardenOptions): void {
  const allowed = [...options.origins];
  const open = options.openExternal ?? openExternalHttps;
  const emit = (event: BusymateHostEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      /* a log callback threw */
    }
  };
  const external = (url: string): boolean => {
    if (originOfUrl(url) === null) return false;
    try {
      void Promise.resolve(open(url)).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  };
  const guard = (event: { preventDefault(): void; url?: string; isMainFrame?: boolean }, url?: string) => {
    const target = typeof url === "string" ? url : (event.url ?? "");
    if (event.isMainFrame === false) return;
    if (isAllowedOrigin(allowed, originOfUrl(target))) return;
    event.preventDefault();
    emit({ type: "navigation-blocked", url: redact(target), openedExternally: external(target) });
  };
  webContents.on("will-navigate", (event, url) => guard(event, url));
  webContents.on("will-redirect", (event, url) => guard(event, url));
  webContents.setWindowOpenHandler(({ url }) => {
    emit({ type: "window-open-blocked", url: redact(url), openedExternally: external(url) });
    return { action: "deny" };
  });
  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
    emit({ type: "webview-blocked" });
  });
  webContents.on("unresponsive", () => emit({ type: "unresponsive" }));
  webContents.on("responsive", () => emit({ type: "responsive" }));
}

/** Drop query and fragment before logging a URL: they may carry tokens. */
export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin + parsed.pathname : parsed.protocol;
  } catch {
    return "invalid";
  }
}

export interface BusymateChatOptions extends Omit<BridgeConfig, "open"> {
  /** The hosted chat URL (https). Its origin must be one of the allowed origins. */
  url: string;
  /** Install the microphone adapter and expose `window.BusymateMicrophone`. Default true. */
  microphone?: boolean;
  /** A session for the chat. Default: the dedicated partition `persist:busymate-chat`. */
  session?: Session;
  /** Partition name when no session is given. */
  partition?: string;
  /** Opens https URLs outside the app (bridge `open`, refused navigations, window.open). */
  openExternal?: (url: string) => boolean | Promise<boolean>;
  /** Called after the renderer died; the frozen bridge reloads the chat and emits `restored`. */
  onRenderProcessGone?: (details: RenderProcessGoneDetails) => void;
  /** Host events for your log. */
  onEvent?: (event: BusymateHostEvent) => void;
  /** Permissions for other WebContents on the same session (see MicrophoneOptions). */
  otherPermission?: MicrophoneOptions["otherPermission"];
  /** OS access override (tests). */
  media?: MicrophoneOptions["media"];
}

export interface BusymateChatHost {
  /** The exact origins allowed to use the bridges and to be navigated to. */
  readonly origins: readonly string[];
  readonly webContents: WebContents;
  readonly bridge: BridgeHandle;
  readonly microphone: MicrophoneHandle | null;
  /** Load the chat URL. */
  load(): Promise<void>;
  /** Emit `resume` to the chat (the app returned to the foreground). */
  resume(): void;
  /** Emit `state` to the chat after sign-in, sign-out or an account switch. */
  accountChanged(): void;
  /** Remove listeners. The WebContents' owner closes it. */
  dispose(): void;
}

export interface BusymateChatWindow extends BusymateChatHost {
  readonly window: BrowserWindow;
}

export interface BusymateChatView extends BusymateChatHost {
  readonly view: WebContentsView;
}

/** Validate the chat URL against the allow-list; throws for anything unsafe. */
export function resolveChatTarget(options: { url: string; assistant: string; origins?: string[] }): {
  url: string;
  origins: string[];
} {
  const origins = allowedOrigins(options);
  if (origins.length === 0) throw new Error("Busymate: no valid assistant slug or exact https origin was configured.");
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error("Busymate: the chat URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Busymate: the chat URL must be https without credentials.");
  }
  if (!isAllowedOrigin(origins, normalizeOrigin(parsed.origin))) {
    throw new Error(`Busymate: the chat origin ${parsed.origin} is not in the allowed origins (${origins.join(", ")}).`);
  }
  return { url: parsed.href, origins };
}

function emitter(onEvent?: (event: BusymateHostEvent) => void) {
  return (event: BusymateHostEvent) => {
    try {
      onEvent?.(event);
    } catch {
      /* a log callback threw */
    }
  };
}

/**
 * Install everything on an existing chat WebContents, before its first load:
 * hardening, the frozen identity bridge and (optionally) the microphone adapter.
 * The WebContents must have been created with secureWebPreferences().
 */
export function installBusymateChat(webContents: WebContents, options: BusymateChatOptions): BusymateChatHost {
  const target = resolveChatTarget(options);
  const emit = emitter(options.onEvent);
  const openExternal = options.openExternal ?? openExternalHttps;

  hardenWebContents(webContents, { origins: target.origins, openExternal, onEvent: emit });

  const { onRenderProcessGone, otherPermission, media } = options;
  const bridge = frozenMain().installBusymateBridge(webContents, {
    assistant: options.assistant,
    appId: options.appId,
    appVersion: options.appVersion,
    appBuild: options.appBuild,
    origins: options.origins,
    account: options.account,
    mint: options.mint,
    onAction: options.onAction,
    onClose: options.onClose,
    open: async (url: string) => (await openExternal(url)) !== false,
  });

  // Observe (never answer) bridge requests for the host log: op name and origin only.
  const observe = (event: IpcMainEvent, raw: unknown) => {
    if (event.sender !== webContents) return;
    let op = "unreadable";
    try {
      const envelope = JSON.parse(String(raw)) as { op?: unknown };
      op = typeof envelope.op === "string" ? envelope.op.slice(0, 32) : "none";
    } catch {
      /* unreadable */
    }
    const origin = event.senderFrame ? normalizeOrigin(event.senderFrame.origin) : null;
    emit({ type: "bridge-request", op, origin, allowed: isAllowedOrigin(target.origins, origin) });
  };
  ipcMain.on(BRIDGE_CHANNEL, observe);

  const microphone =
    options.microphone === false
      ? null
      : installBusymateMicrophone(webContents, { origins: target.origins, onEvent: emit, otherPermission, media });

  const onGone = (_event: unknown, details: RenderProcessGoneDetails) => {
    emit({ type: "render-process-gone", reason: details.reason, exitCode: details.exitCode });
    try {
      onRenderProcessGone?.(details);
    } catch {
      /* host callback threw */
    }
  };
  webContents.on("render-process-gone", onGone);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener(BRIDGE_CHANNEL, observe);
    bridge.dispose();
    microphone?.dispose();
    if (!webContents.isDestroyed()) webContents.removeListener("render-process-gone", onGone);
  };
  webContents.once("destroyed", dispose);

  return {
    origins: target.origins,
    webContents,
    bridge,
    microphone,
    load: () => webContents.loadURL(target.url),
    resume: () => bridge.resume(),
    accountChanged: () => bridge.accountChanged(),
    dispose,
  };
}

function chatPreferences(options: BusymateChatOptions): WebPreferences {
  const session = options.session ?? (options.partition ? undefined : electronSession.fromPartition(DEFAULT_PARTITION));
  return secureWebPreferences({
    preload: options.microphone === false ? bridgePreloadPath() : preloadPath(),
    session,
    partition: options.partition,
  });
}

/**
 * Create a BrowserWindow hosting the chat with secure defaults. `window`
 * options are yours (size, parent, title…); webPreferences are always the
 * secure set. Call `load()` to open the chat.
 */
export function createBusymateChatWindow(
  options: BusymateChatOptions & { window?: Omit<BrowserWindowConstructorOptions, "webPreferences"> },
): BusymateChatWindow {
  resolveChatTarget(options);
  const window = new BrowserWindow({
    width: 440,
    height: 720,
    show: true,
    ...options.window,
    webPreferences: chatPreferences(options),
  });
  const host = installBusymateChat(window.webContents, options);
  // A desktop window regaining focus is the app returning to the foreground.
  const onFocus = () => host.resume();
  window.on("focus", onFocus);
  window.once("closed", () => host.dispose());
  return { ...host, window };
}

/** Create a WebContentsView hosting the chat with secure defaults. Add it to your window's contentView. */
export function createBusymateChatView(options: BusymateChatOptions): BusymateChatView {
  resolveChatTarget(options);
  const view = new WebContentsView({ webPreferences: chatPreferences(options) });
  const host = installBusymateChat(view.webContents, options);
  return { ...host, view };
}
