// BusymateMicrophone port for the sandboxed preload (microphone wire 1).
// Appended to the frozen identity preload to form `dist/preload.js`. It
// exposes the same object shape as the Android adapter (postMessage plus
// addEventListener("message")), so the hosted chat detects it unchanged.
// Requires only "electron"; the page never gets ipcRenderer.
import { contextBridge, ipcRenderer } from "electron";

const CHANNEL = "busymate:microphone";
type Listener = (event: { data: string }) => void;
const micListeners = new Set<Listener>();

function userActivation(): boolean {
  try {
    // Transient activation of THIS document: true right after the user's tap.
    // Read in the isolated world, so the page cannot forge it.
    return globalThis.navigator?.userActivation?.isActive === true;
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld("BusymateMicrophone", {
  postMessage: (message: unknown) => {
    ipcRenderer.send(CHANNEL, String(message), userActivation());
  },
  addEventListener: (type: unknown, callback: unknown) => {
    if (type === "message" && typeof callback === "function") micListeners.add(callback as Listener);
  },
  removeEventListener: (_type: unknown, callback: unknown) => {
    micListeners.delete(callback as Listener);
  },
});

ipcRenderer.on(CHANNEL, (_event, reply: unknown) => {
  for (const callback of micListeners) {
    try {
      callback({ data: String(reply) });
    } catch {
      /* a page listener threw */
    }
  }
});
