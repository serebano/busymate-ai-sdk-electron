// Loads the byte-frozen kit v2 files (`frozen/v2/2.0.0`) exactly as busymate.ai
// publishes them. They are CommonJS and are never bundled or rewritten: the
// release manifest pins their SHA-256 and CI refuses any change.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { WebContents } from "electron";

/** The frozen identity bridge build this SDK ships. */
export const BRIDGE_BUILD = "2.0.0";
/** The identity wire version (`bm`). */
export const BRIDGE_WIRE = 2;

const FROZEN = "../frozen/v2/2.0.0/";
const load = createRequire(import.meta.url);

/** A mint reply from your authenticated backend, or null when signed out. */
export interface MintToken {
  token: string;
  nonce: string;
}

/** The chat's mint request plus `assistant` and `origin`, which the bridge sets itself. */
export interface MintRequest {
  nonce?: string;
  aud?: string;
  reason?: string;
  assistant: string;
  origin: string;
  [key: string]: unknown;
}

/** Options accepted by the frozen `installBusymateBridge` (kit v2 build 2.0.0). */
export interface BridgeConfig {
  /** Your assistant slug: https://<assistant>.busymate.ai may ask. */
  assistant: string;
  /** Your app id (salts the account hash). */
  appId: string;
  appVersion?: string;
  appBuild?: string;
  /** Extra EXACT https origins that load the chat. Wildcards, paths and http are ignored. */
  origins?: string[];
  /** The signed-in account id, or null when signed out. Never leaves the device raw. */
  account: () => string | null;
  /** Ask YOUR backend for a fresh launch token. Resolve null when signed out; reject on failure. */
  mint: (request: MintRequest) => Promise<MintToken | null>;
  /** Open an https URL outside the app. Defaults to shell.openExternal. */
  open?: (url: string, mode: "external" | "auth") => boolean | Promise<boolean>;
  /** Fixed host actions; return true only when handled. */
  onAction?: (name: string, params: Record<string, unknown>) => boolean;
  /** The chat asked to be closed. */
  onClose?: () => void;
}

/** What the frozen main-process bridge returns. */
export interface BridgeHandle {
  /** Emit `resume` (the app returned to the foreground). */
  resume(): void;
  /** Emit `state` after sign-in, sign-out or an account switch. */
  accountChanged(): void;
  /** Remove the IPC listener. */
  dispose(): void;
}

interface CoreModule {
  allowedOrigins(config: { assistant?: string; origins?: string[] }): string[];
  normalizedOrigin(raw: unknown): string | null;
  sha256Hex(text: string): string;
  BUILD: string;
  createBusymateBridgeCore(config: Record<string, unknown>): {
    handle(raw: string, origin: string | null, reply: (envelope: string) => void): void;
    event(ev: "resume" | "state" | "restored"): string;
    originAllowed(origin: string | null): boolean;
    origins: string[];
  };
}

interface MainModule {
  installBusymateBridge(webContents: WebContents, options: BridgeConfig): BridgeHandle;
}

/** The frozen JavaScript host core (`core/busymateBridgeCore.js`). */
export function frozenCore(): CoreModule {
  return load(FROZEN + "core/busymateBridgeCore.js") as CoreModule;
}

/** The frozen Electron main-process bridge (`electron/main.js`). */
export function frozenMain(): MainModule {
  return load(FROZEN + "electron/main.js") as MainModule;
}

/** Absolute path of the frozen identity-only preload (`electron/preload.js`). */
export function bridgePreloadPath(): string {
  return fileURLToPath(new URL(FROZEN + "electron/preload.js", import.meta.url));
}

/** Absolute path of the combined preload: the frozen identity preload plus the microphone port. */
export function preloadPath(): string {
  return fileURLToPath(new URL("../dist/preload.js", import.meta.url));
}
