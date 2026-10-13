# Microphone integration for Electron — adapter 1.0.0

A user taps the chat microphone or voice button; the chat sends a request to
the app, the app asks the operating system for microphone access, and the chat
starts capture only after permission is granted. No separate native button is
needed. Opening chat never shows an OS prompt.

## Install

`createBusymateChatWindow` / `createBusymateChatView` install the adapter by
default (`microphone: true`). For your own WebContents:

```js
const { installBusymateChat, secureWebPreferences, preloadPath } = require("@busymate/ai-electron");
const view = new WebContentsView({ webPreferences: secureWebPreferences({ preload: preloadPath() }) });
const chat = installBusymateChat(view.webContents, { url, assistant, origins, appId, account, mint });
await chat.load();
```

Install once per chat WebContents, before the first load. Keep the WebContents'
session dedicated to the chat (the default `persist:busymate-chat`): the adapter
owns that session's `setPermissionRequestHandler` and `setPermissionCheckHandler`.
If you must share a session, answer other WebContents through `otherPermission`.

macOS packaged apps need `NSMicrophoneUsageDescription` in `Info.plist`
(electron-builder: `mac.extendInfo`; Electron Forge: `packagerConfig.extendInfo`)
and, with the hardened runtime, the `com.apple.security.device.audio-input`
entitlement. Localize the usage string. Without them macOS refuses or kills
the capture.

## What happens on a tap

1. The page calls `window.BusymateMicrophone.postMessage(JSON string)`, exposed by
   the sandboxed preload through `contextBridge`. The preload adds whether the
   document has a transient user activation (the tap), read in the isolated world
   so the page cannot forge it, and sends it over IPC channel `busymate:microphone`.
2. The main process accepts only messages from the chat WebContents whose sending
   frame's security origin (`event.senderFrame.origin`) is exactly an allowed
   origin, at most 4096 characters, with type `busymate.microphone.v1.request` and
   a non-empty string `id`. Anything else gets no reply, as on iOS and Android.
3. The OS is consulted with `systemPreferences`:
   - **macOS:** `getMediaAccessStatus("microphone")`. `granted` answers at once.
     `not-determined` shows the prompt with `askForMediaAccess("microphone")`, but
     only for a request made during a user activation. `denied`/`restricted`
     answer `false` without a prompt.
   - **Windows:** `getMediaAccessStatus("microphone")`; there is no per-app prompt
     API, so `denied` (Settings → Privacy & security → Microphone) answers `false`.
   - **Linux:** no app-level OS gate; the request is granted at the OS step.
   Concurrent requests share one pending OS ask.
4. The reply goes back to the asking frame only: `{"id":"<same id>","granted":true|false}`.
5. When the chat then calls `getUserMedia`, the session permission handler grants
   `media` only if every requested type is `audio`, the requesting origin is
   allowed, a request from that origin was granted in this document, and the OS
   still grants access. Camera and camera+microphone are always refused. Other
   permissions are denied, except `clipboard-sanitized-write` for allowed origins.

## Deny, Retry, revoked and cancel

- **Deny:** the reply is `granted:false`; the chat shows its blocked notice. No
  prompt loop: macOS shows its prompt once; later refusals need System Settings
  → Privacy & Security → Microphone. The adapter does not open Settings.
- **Retry:** the chat's **Try again** sends a new request; the OS state is
  rechecked, so a grant made in Settings succeeds.
- **Revoked:** every request and every Chromium media decision rechecks the OS
  status. The adapter forgets earlier grants on cross-document navigation,
  reload and renderer death.
- **Cancel:** the chat ignores a late reply after cancel or unmount. If the
  window or frame is gone, no reply is delivered. Cancelling does not dismiss an
  OS-owned prompt or undo an OS grant.

## Wire

```json
{"type":"busymate.microphone.v1.request","id":"mic-unique-id","source":"dictation"}
{"id":"mic-unique-id","granted":true}
```

`source` is `dictation` or `voice`. The reply reaches the page as a `message`
event whose `data` is the JSON string, exactly like the Android adapter. Do not
call the port from a page-load script: the chat owns the tap trigger and
correlation, and waits up to 60 seconds.

## Troubleshooting

| Symptom | Check |
|---|---|
| No OS prompt on first tap | Permission may already be decided (System Settings). Confirm the chat origin is allowed, `microphone` is not `false`, and the request came from the tap. |
| OS accepted, chat still cannot record | The chat must be the top-level document of the chat WebContents with an allowed origin; check `onEvent` `media-permission` entries. A packaged macOS app needs the usage string and audio-input entitlement. |
| Retry shows no new prompt | Expected after a macOS refusal: grant access in System Settings, return, tap **Try again**. |
| Other windows lost permissions | They share the chat session; use the default dedicated partition or `otherPermission`. |
| Camera request denied | Expected: microphone only. |

## Acceptance checklist for your app release

Build your packaged, signed app, then verify on real macOS, Windows and Linux machines:

1. Fresh permission state: open chat without a prompt; tap **microphone**, see the
   OS prompt (macOS), allow, and dictate. Repeat for **voice mode**.
2. Deny: blocked notice, no capture, no prompt loop. Grant in Settings, return,
   **Try again** succeeds.
3. Already granted: activation starts without a prompt. Revoke in Settings and
   confirm the next activation is refused.
4. While the prompt is pending, cancel dictation or leave voice mode; accept the
   prompt afterwards and confirm capture does not start.
5. Close/reopen the chat window and reload; force a renderer crash
   (`webContents.forcefullyCrashRenderer()`) and confirm the chat reloads and
   the microphone still asks correctly.
6. Confirm untrusted origins and camera requests are refused.

CI runs unit tests with an in-memory Electron stand-in and a sandboxed launch of
the example on Linux. It does not show or verify any OS microphone dialog.
Record those results with your own app release before rollout.

## Platform references

- [Electron: session permission handlers](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler)
- [Electron: systemPreferences.askForMediaAccess](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
