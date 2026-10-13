// @busymate/ai-electron — official Busymate AI SDK for Electron (main process).
// Identity: frozen kit v2 bridge (`busymate.bridge/2`, build 2.0.0).
// Microphone: BusymateMicrophone wire 1, adapter 1.0.0.

/** This SDK distribution's version. */
export const SDK_VERSION = "1.0.1";

/** The hosted guest chat used by the example: https://busymate.ai/support/<assistant>?channel=<channel>&locale=<locale>. */
export function guestChatUrl(options: { assistant?: string; channel?: string; locale?: string } = {}): string {
  const url = new URL(`https://busymate.ai/support/${encodeURIComponent(options.assistant ?? "busyproxy")}`);
  url.searchParams.set("channel", options.channel ?? "desktop_sdk");
  url.searchParams.set("locale", options.locale ?? "en");
  return url.href;
}

/** https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en */
export const DEFAULT_GUEST_CHAT_URL = guestChatUrl();

export {
  BRIDGE_BUILD,
  BRIDGE_WIRE,
  bridgePreloadPath,
  frozenCore,
  frozenMain,
  preloadPath,
  type BridgeConfig,
  type BridgeHandle,
  type MintRequest,
  type MintToken,
} from "./frozen.js";
export { allowedOrigins, isAllowedOrigin, normalizeOrigin, originOfUrl, parseExactOrigin } from "./origins.js";
export {
  MICROPHONE_ADAPTER,
  MICROPHONE_CHANNEL,
  MICROPHONE_REQUEST_TYPE,
  MICROPHONE_WIRE,
  createMicrophoneGate,
  installBusymateMicrophone,
  microphoneReply,
  parseMicrophoneRequest,
  systemMediaAccess,
  type MediaAccess,
  type MediaStatus,
  type MicrophoneEvent,
  type MicrophoneGate,
  type MicrophoneHandle,
  type MicrophoneOptions,
  type MicrophoneSource,
} from "./microphone.js";
export {
  DEFAULT_PARTITION,
  createBusymateChatView,
  createBusymateChatWindow,
  hardenWebContents,
  installBusymateChat,
  openExternalHttps,
  redact,
  resolveChatTarget,
  secureWebPreferences,
  type BusymateChatHost,
  type BusymateChatOptions,
  type BusymateChatView,
  type BusymateChatWindow,
  type BusymateHostEvent,
  type HardenOptions,
} from "./window.js";

/** Install only the frozen identity bridge on a WebContents (advanced; createBusymateChatWindow does this for you). */
export { installBusymateBridge } from "./bridge.js";
