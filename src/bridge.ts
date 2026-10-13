import type { WebContents } from "electron";
import { frozenMain, type BridgeConfig, type BridgeHandle } from "./frozen.js";

/**
 * The frozen kit v2 Electron bridge, typed. Install before the first load and
 * pair with the frozen preload (or the combined `@busymate/ai-electron/preload`).
 */
export function installBusymateBridge(webContents: WebContents, config: BridgeConfig): BridgeHandle {
  return frozenMain().installBusymateBridge(webContents, config);
}
