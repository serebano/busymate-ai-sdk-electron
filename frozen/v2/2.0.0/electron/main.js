// Busymate AI — kit v2 for Electron, MAIN process (`busymate.bridge/2`, build 2.0.0).
//
// FROZEN pipe: the same five operations as every other host, answered by YOUR
// callbacks. The sender is authorised by the FRAME's own security origin
// (event.senderFrame.origin — "null" for a sandboxed frame), never by the
// window's URL: exactly https://<assistant>.busymate.ai or an origin you list.
//
//   const { installBusymateBridge } = require("./busymate/main");
//   const bridge = installBusymateBridge(win.webContents, {
//     assistant: "acme",
//     appId: "com.acme.desktop",
//     account: () => store.userId ?? null,
//     mint: (request) => api.mintBusymate(request.nonce, request.aud),
//     onClose: () => win.close(),
//   });
//   app.on("browser-window-focus", () => bridge.resume());
//
// Contract: https://busymate.ai/sdk/v2/2.0.0/CONTRACT.md

"use strict";

const { ipcMain, shell } = require("electron");
const core = require("../core/busymateBridgeCore");

function originOf(frame, fallbackUrl) {
  // The frame's own security origin wins: a sandboxed frame is "null" whatever its URL.
  if (frame && typeof frame.origin === "string") return frame.origin.indexOf("https://") === 0 ? frame.origin : null;
  try {
    const parsed = new URL(frame ? frame.url : fallbackUrl);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch (_) { return null; }
}

function installBusymateBridge(webContents, options) {
  let helloFrame = null;
  const bridge = core.createBusymateBridgeCore(Object.assign({
    platform: "electron",
    webview: "Electron/" + process.versions.electron,
    open: (url) => shell.openExternal(url).then(() => true),
  }, options));

  const onMessage = (event, raw) => {
    if (event.sender !== webContents) return;
    const frame = event.senderFrame;
    const origin = originOf(frame, webContents.getURL());
    bridge.handle(String(raw), origin, (reply) => {
      try { if (JSON.parse(String(raw)).op === "hello") helloFrame = frame; } catch (_) { /* unreadable */ }
      event.reply("busymate:bridge", reply);
    });
  };
  ipcMain.on("busymate:bridge", onMessage);

  const emit = (ev) => {
    const envelope = bridge.event(ev);
    try {
      if (helloFrame && !helloFrame.isDestroyed?.()) helloFrame.send("busymate:bridge", envelope);
      else webContents.send("busymate:bridge", envelope);
    } catch (_) { /* window gone */ }
  };
  webContents.on("render-process-gone", () => { webContents.once("did-finish-load", () => emit("restored")); webContents.reload(); });

  return {
    resume: () => emit("resume"),
    accountChanged: () => emit("state"),
    dispose: () => ipcMain.removeListener("busymate:bridge", onMessage),
  };
}

module.exports = { installBusymateBridge };
