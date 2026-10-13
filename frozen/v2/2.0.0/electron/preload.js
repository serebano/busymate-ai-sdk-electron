// Busymate AI — kit v2 for Electron, PRELOAD (`busymate.bridge/2`, build 2.0.0).
//
// FROZEN pipe. Sandbox-safe: requires only "electron". Exposes the same object
// shape the Android WebView injects (postMessage + addEventListener("message")),
// so the chat served from busymate.ai speaks to every host the same way.
// Pair with ./main.js. Contract: https://busymate.ai/sdk/v2/2.0.0/CONTRACT.md

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

contextBridge.exposeInMainWorld("BusymateBridge", {
  postMessage: (envelope) => ipcRenderer.send("busymate:bridge", String(envelope)),
  addEventListener: (type, callback) => {
    if (type === "message" && typeof callback === "function") listeners.add(callback);
  },
  removeEventListener: (type, callback) => { listeners.delete(callback); },
});

ipcRenderer.on("busymate:bridge", (_event, envelope) => {
  for (const callback of listeners) {
    try { callback({ data: String(envelope) }); } catch (_) { /* a page listener threw */ }
  }
});
