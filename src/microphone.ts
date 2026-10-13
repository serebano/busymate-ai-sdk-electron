// BusymateMicrophone for Electron — microphone wire 1, adapter 1.0.0.
//
// The chat sends {"type":"busymate.microphone.v1.request","id":…,"source":…}
// when the user taps microphone or voice; this adapter asks the operating
// system and answers {"id":…,"granted":true|false}. Only after that grant does
// the session permission handler let Chromium capture AUDIO for an allowed
// origin. Camera and mixed camera+microphone requests are always refused.
import { ipcMain, systemPreferences, type IpcMainEvent, type Session, type WebContents } from "electron";
import { isAllowedOrigin, normalizeOrigin } from "./origins.js";

/** The microphone wire version. */
export const MICROPHONE_WIRE = 1;
/** The microphone adapter version. */
export const MICROPHONE_ADAPTER = "1.0.0";
/** The request type the chat sends. */
export const MICROPHONE_REQUEST_TYPE = "busymate.microphone.v1.request";
/** The IPC channel between the preload port and the main process. */
export const MICROPHONE_CHANNEL = "busymate:microphone";
const MAX_MESSAGE = 4096;

export type MicrophoneSource = "dictation" | "voice";

/** OS microphone status, as Electron's systemPreferences reports it. */
export type MediaStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** How the adapter reaches the OS. Injected for tests; defaults to Electron's systemPreferences. */
export interface MediaAccess {
  /** Current OS status, or "unknown" when the OS has no app-level microphone gate (Linux). */
  status(): MediaStatus;
  /** Show the OS prompt where one exists. Resolves whether access is granted. */
  ask(): Promise<boolean>;
}

/** A decision the adapter made, for your log. Never carries audio, tokens or account ids. */
export type MicrophoneEvent =
  | { type: "microphone-request"; origin: string; source: string; userActivation: boolean }
  | { type: "microphone-reply"; origin: string; granted: boolean; prompted: boolean }
  | { type: "microphone-refused"; origin: string | null; reason: "origin" | "malformed" }
  | { type: "media-permission"; origin: string | null; granted: boolean; mediaTypes: string[] };

/** Electron's own OS access (macOS prompt; Windows status only; Linux has no app-level gate). */
export function systemMediaAccess(platform: NodeJS.Platform = process.platform): MediaAccess {
  if (platform === "darwin") {
    return {
      status: () => systemPreferences.getMediaAccessStatus("microphone") as MediaStatus,
      ask: () => systemPreferences.askForMediaAccess("microphone"),
    };
  }
  if (platform === "win32") {
    return {
      status: () => systemPreferences.getMediaAccessStatus("microphone") as MediaStatus,
      // Windows has no per-app prompt API: the Privacy setting decides.
      ask: async () => systemPreferences.getMediaAccessStatus("microphone") !== "denied",
    };
  }
  return { status: () => "unknown", ask: async () => true };
}

interface ParsedRequest {
  id: string;
  source: string;
}

/** Parse one wire-1 request string; null when it is not a well-formed request. */
export function parseMicrophoneRequest(raw: unknown): ParsedRequest | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const request = value as { type?: unknown; id?: unknown; source?: unknown };
  if (request.type !== MICROPHONE_REQUEST_TYPE) return null;
  if (typeof request.id !== "string" || request.id.length === 0) return null;
  return { id: request.id, source: typeof request.source === "string" ? request.source : "" };
}

/** The wire-1 reply string, exactly `{"id":…,"granted":…}`. */
export function microphoneReply(id: string, granted: boolean): string {
  return JSON.stringify({ id, granted });
}

export interface MicrophoneGateOptions {
  /** Exact allowed origins (already normalized). */
  origins: readonly string[];
  media: MediaAccess;
  onEvent?: (event: MicrophoneEvent) => void;
}

/**
 * The platform-independent decision logic. One gate per chat WebContents.
 *
 * - An OS prompt is shown only for a request made during a user activation
 *   (the tap); an existing grant answers immediately, a refusal answers false.
 * - Concurrent requests share one pending OS ask.
 * - Chromium media capture is allowed only for AUDIO, from an allowed origin,
 *   after this gate granted a request from that origin, and while the OS still
 *   grants access (a revoked grant is re-checked every time).
 */
export function createMicrophoneGate(options: MicrophoneGateOptions) {
  const allowed = [...options.origins];
  const armed = new Set<string>();
  let pending: Promise<boolean> | null = null;
  const emit = (event: MicrophoneEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      /* a log callback threw */
    }
  };

  function osGranted(): boolean {
    const status = options.media.status();
    return status === "granted" || status === "unknown";
  }

  async function decide(userActivation: boolean): Promise<{ granted: boolean; prompted: boolean }> {
    const status = options.media.status();
    if (status === "granted" || status === "unknown") return { granted: true, prompted: false };
    if (status !== "not-determined" || !userActivation) return { granted: false, prompted: false };
    if (!pending) {
      pending = options.media.ask().then(
        (granted) => granted === true,
        () => false,
      );
      void pending.finally(() => {
        pending = null;
      });
    }
    return { granted: await pending, prompted: true };
  }

  return {
    origins: allowed,
    /**
     * Handle one request string from `origin` (the sending frame's security
     * origin). Resolves the reply string, or null when nothing must be sent
     * (malformed message or a refused origin, as on iOS and Android).
     */
    async handle(raw: unknown, origin: unknown, userActivation: boolean): Promise<string | null> {
      const from = normalizeOrigin(origin);
      if (!isAllowedOrigin(allowed, origin) || from === null) {
        emit({ type: "microphone-refused", origin: from, reason: "origin" });
        return null;
      }
      const request = parseMicrophoneRequest(raw);
      if (!request) {
        emit({ type: "microphone-refused", origin: from, reason: "malformed" });
        return null;
      }
      emit({ type: "microphone-request", origin: from, source: request.source, userActivation });
      let result: { granted: boolean; prompted: boolean };
      try {
        result = await decide(userActivation);
      } catch {
        result = { granted: false, prompted: false };
      }
      if (result.granted) armed.add(from);
      emit({ type: "microphone-reply", origin: from, granted: result.granted, prompted: result.prompted });
      return microphoneReply(request.id, result.granted);
    },
    /** Chromium media decision: audio only, allowed origin, after a granted request, OS still granting. */
    allowMedia(origin: unknown, mediaTypes: readonly string[] | undefined): boolean {
      const from = normalizeOrigin(origin);
      const types = [...(mediaTypes ?? [])];
      const granted =
        from !== null &&
        allowed.includes(from) &&
        armed.has(from) &&
        types.length > 0 &&
        types.every((type) => type === "audio") &&
        osGranted();
      emit({ type: "media-permission", origin: from, granted, mediaTypes: types });
      return granted;
    },
    /** Chromium permission check (no prompt): same rule as allowMedia for one media type. */
    checkMedia(origin: unknown, mediaType: string | undefined): boolean {
      const from = normalizeOrigin(origin);
      return from !== null && allowed.includes(from) && armed.has(from) && mediaType === "audio" && osGranted();
    },
    /** Forget earlier grants (navigation, reload, renderer crash). */
    reset(): void {
      armed.clear();
    },
  };
}

export type MicrophoneGate = ReturnType<typeof createMicrophoneGate>;

export interface MicrophoneOptions {
  /** Exact allowed origins. Use the same list as the identity bridge. */
  origins: readonly string[];
  /** OS access; defaults to systemMediaAccess(). */
  media?: MediaAccess;
  onEvent?: (event: MicrophoneEvent) => void;
  /**
   * Decide permissions for OTHER WebContents on the same session. The adapter
   * owns the session's permission handlers; anything that is not a chat
   * WebContents is denied unless you answer here. Default: deny.
   */
  otherPermission?: (webContents: WebContents | null, permission: string, details: unknown) => boolean;
}

export interface MicrophoneHandle {
  readonly gate: MicrophoneGate;
  dispose(): void;
}

interface SessionRegistry {
  gates: Map<WebContents, MicrophoneGate>;
  other?: MicrophoneOptions["otherPermission"];
}
const registries = new WeakMap<Session, SessionRegistry>();

/** Chat-only permissions that need no OS access, granted to allowed origins. */
const HARMLESS = new Set(["clipboard-sanitized-write"]);

function frameOrigin(details: unknown, fallback?: string): string | null {
  const d = (details ?? {}) as { securityOrigin?: unknown; requestingUrl?: unknown; requestingOrigin?: unknown };
  if (typeof d.securityOrigin === "string" && d.securityOrigin) return normalizeOrigin(d.securityOrigin);
  const url = typeof d.requestingUrl === "string" ? d.requestingUrl : fallback;
  if (!url) return null;
  try {
    return normalizeOrigin(new URL(url).origin);
  } catch {
    return null;
  }
}

function registryFor(session: Session, other: MicrophoneOptions["otherPermission"]): SessionRegistry {
  const registry = registries.get(session);
  if (registry) {
    if (other) registry.other = other;
    return registry;
  }
  const created: SessionRegistry = { gates: new Map(), other };
  registries.set(session, created);
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const gate = webContents ? created.gates.get(webContents) : undefined;
    if (!gate) {
      let answer: boolean;
      try {
        answer = created.other?.(webContents, permission, details) === true;
      } catch {
        answer = false;
      }
      callback(answer);
      return;
    }
    const origin = frameOrigin(details, webContents.getURL());
    if (permission === "media") {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
      callback(gate.allowMedia(origin, mediaTypes));
      return;
    }
    callback(HARMLESS.has(permission) && gate.origins.includes(origin ?? ""));
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const gate = webContents ? created.gates.get(webContents) : undefined;
    if (!gate) {
      try {
        return created.other?.(webContents, permission, details) === true;
      } catch {
        return false;
      }
    }
    const origin = frameOrigin(details, requestingOrigin);
    if (permission === "media") return gate.checkMedia(origin, (details as { mediaType?: string }).mediaType);
    return HARMLESS.has(permission) && gate.origins.includes(origin ?? "");
  });
  return created;
}

/**
 * Install the microphone adapter on a chat WebContents, before its first load.
 * Pair it with the combined preload (`@busymate/ai-electron/preload`), which
 * exposes `window.BusymateMicrophone` to the page.
 */
export function installBusymateMicrophone(webContents: WebContents, options: MicrophoneOptions): MicrophoneHandle {
  const gate = createMicrophoneGate({
    origins: options.origins,
    media: options.media ?? systemMediaAccess(),
    onEvent: options.onEvent,
  });
  const registry = registryFor(webContents.session, options.otherPermission);
  registry.gates.set(webContents, gate);

  const onMessage = (event: IpcMainEvent, raw: unknown, userActivation: unknown) => {
    if (event.sender !== webContents) return;
    const frame = event.senderFrame;
    // The frame's own security origin: "null" for a sandboxed document, whatever its URL.
    const origin = frame ? frame.origin : null;
    void gate.handle(raw, origin, userActivation === true).then((reply) => {
      if (reply === null) return;
      try {
        if (frame && !frame.isDestroyed()) frame.send(MICROPHONE_CHANNEL, reply);
      } catch {
        /* the frame is gone: a cancelled chat never receives a late grant */
      }
    });
  };
  ipcMain.on(MICROPHONE_CHANNEL, onMessage);

  const reset = () => gate.reset();
  const onNavigate = (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) reset();
  };
  webContents.on("did-start-navigation", onNavigate);
  webContents.on("render-process-gone", reset);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener(MICROPHONE_CHANNEL, onMessage);
    registry.gates.delete(webContents);
    gate.reset();
    if (!webContents.isDestroyed()) {
      webContents.removeListener("did-start-navigation", onNavigate);
      webContents.removeListener("render-process-gone", reset);
    }
  };
  webContents.once("destroyed", dispose);
  return { gate, dispose };
}
