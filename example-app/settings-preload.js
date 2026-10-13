// Settings window preload (sandboxed). Exposes a fixed set of example actions;
// the settings page never gets ipcRenderer or Node.js.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("demo", {
  state: () => ipcRenderer.invoke("demo:state"),
  apply: (form, sessionToken) => ipcRenderer.invoke("demo:apply", form, sessionToken),
  accountChanged: (form) => ipcRenderer.invoke("demo:account-changed", form),
  closeChat: () => ipcRenderer.invoke("demo:close-chat"),
  reset: () => ipcRenderer.invoke("demo:reset"),
  onLog: (callback) => {
    if (typeof callback === "function") ipcRenderer.on("demo:log", (_event, entry) => callback(entry));
  },
});
