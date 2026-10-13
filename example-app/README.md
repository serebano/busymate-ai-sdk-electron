# Electron SDK example app

A real Electron application consuming the **local `@busymate/ai-electron`
package** in the parent directory (`file:..`). It uses the frozen identity
bridge v2 build 2.0.0 and the microphone adapter 1.0.0. There are no copied or
mock SDK implementations in the app.

## Run

From the SDK repository root:

```sh
npm ci && npm run build
cd example-app
npm ci
npm start
```

`npm run smoke` launches the app, opens the default chat, checks the secure
preferences and the bridges, prints `SMOKE_RESULT {…}` and exits (CI runs it
under xvfb on Linux).

## Try the live guest flow

The default URL is the real hosted chat:
`https://busymate.ai/support/busyproxy?channel=desktop&locale=en`. The assistant
slug is `busyproxy` and the explicit extra origin is `https://busymate.ai`. This
is a guest support assistant, not an authenticated example workspace or a stub.
Its availability, knowledge and features belong to that tenant.

Press **Apply and open chat**, send a message, and tap dictation or voice if the
hosted chat offers them. The OS is asked by the SDK adapter in response to that
tap. Test real acceptance and refusal on your own machine.

## Settings

| Control | What it configures |
|---|---|
| Assistant slug | `assistant`; validated slug. |
| Chat HTTPS URL | The URL loaded in the chat window. |
| Locale | Sets the chat URL's `locale` parameter. |
| Exact HTTPS origins | `origins`, shared by identity, microphone and navigation. The chat origin must be allowed. |
| Guest / Identified | Guest supplies an account reader returning `null` (no mint request). Identified returns the entered account ID and calls your mint endpoint. An entered ID is **not** a login. |
| Authenticated mint endpoint | The example's `mint` POSTs `nonce`, optional `aud`/`reason`, and the bridge-supplied `assistant`/`origin`, refuses redirects, and expects `{"token","nonce"}` with the same nonce. 401/403 means signed out; anything else fails closed. |
| Backend session token | Optional Bearer credential for your existing backend, kept in memory only. Never enter signing or admin keys. |
| Microphone | Installs the adapter (combined preload) or the identity-only frozen preload. |
| Handle close through onAction | Supplies `onAction`; OFF supplies `undefined`. Returns true only for `close`. |
| onClose fallback | Supplies `onClose`; OFF supplies `undefined`. |
| Forward accountChanged() | Applies the identity fields and calls the real `accountChanged()`. |
| Close chat / Reset | Closes the chat window / restores guest defaults and clears the session token. Reset does not change OS microphone permission. |

The **Callbacks log** shows bridge requests (op and origin), microphone requests
and replies, Chromium media decisions, blocked navigations and pop-ups, renderer
crashes, mint outcomes and `onAction`/`onClose`. It never shows tokens, nonces,
account IDs, URLs' query strings or audio, keeps 100 entries and is not persisted.

## What is and is not verified

`npm test` in the root runs the settings validator, the mint client and the
callback factory used by this app. CI builds the app against the packed SDK on
Ubuntu, macOS and Windows and launches it under xvfb on Linux. OS microphone
dialogs, a packaged/signed build and your authenticated backend need your own
verification on real machines (see [microphone acceptance](../docs/microphone.md#acceptance-checklist-for-your-app-release)).
