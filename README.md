# Busymate AI SDK for Electron — 1.0.2

Official independent Electron package for Busymate AI hosted chat: `@busymate/ai-electron`. Install once in your app; hosted chat receives web updates independently.

It ships the frozen identity bridge `BusymateBridge` (identity wire v2, immutable build 2.0.0, byte-identical to `https://busymate.ai/sdk/v2/2.0.0/electron/`) plus `BusymateMicrophone` (microphone wire 1, adapter 1.0.0), and a main-process helper that creates the chat `BrowserWindow` or `WebContentsView` with secure defaults.

## Install from the GitHub release

The package is not published to the npm registry. Install the packed tarball attached to the [1.0.2 release](https://github.com/serebano/busymate-ai-sdk-electron/releases/tag/1.0.2):

```sh
npm install https://github.com/serebano/busymate-ai-sdk-electron/releases/download/1.0.2/busymate-ai-electron-1.0.2.tgz
```

Or pin the git tag and build it locally (`dist/` is not committed, so the tarball is the simpler option):

```sh
git clone --branch 1.0.2 --depth 1 https://github.com/serebano/busymate-ai-sdk-electron.git vendor/busymate-ai-sdk-electron
(cd vendor/busymate-ai-sdk-electron && npm ci && npm run build)
npm install ./vendor/busymate-ai-sdk-electron
```

The package ships CommonJS (`dist/index.js`) and ESM (`dist/index.mjs`) with TypeScript types. It has no runtime dependencies; `electron` (30 or later, for `WebContentsView`) is a peer dependency. The reference build uses Electron 44.4.5, Node 22 and TypeScript 6.0.

## Integrate

```js
const { app } = require("electron");
const { createBusymateChatWindow } = require("@busymate/ai-electron");

app.whenReady().then(() => {
  const chat = createBusymateChatWindow({
    url: "https://acme.busymate.ai/?channel=desktop_sdk", // your tenant's chat URL
    assistant: "acme",                                   // https://acme.busymate.ai may ask
    origins: ["https://support.acme.com"],               // your mapped support host, if any
    appId: "com.acme.desktop",
    account: () => session.userIdOrNull,                 // null = signed out
    mint: (request) => backend.mintBusymate(request),    // YOUR authenticated backend: { token, nonce } or null
    onClose: () => chat.window.close(),
  });
  chat.load();
});
```

1. Read [identity and authentication](docs/identity.md).
2. Configure the [complete SDK reference](docs/configuration.md).
3. Follow [microphone and voice integration](docs/microphone.md).
4. Validate on real macOS, Windows and Linux machines using the acceptance checklist; no OS prompt should occur merely on opening chat.

The helper uses `contextIsolation`, the Chromium `sandbox`, no `nodeIntegration`, no `<webview>`, and a dedicated `persist:busymate-chat` session. Top-level navigation and redirects stay on the exact allowed origins; `window.open` is always denied and https targets open in the user's browser. Both bridges are installed before the first load. When the renderer dies (`render-process-gone`), the frozen bridge reloads the chat and sends `restored`; your `onRenderProcessGone` callback is told too.

When the user taps microphone or voice, chat asks the adapter; the OS is asked then (`systemPreferences.askForMediaAccess` on macOS). Only an OS grant plus the session permission handler's allowed-origin, audio-only decision permits recording. Denial offers Retry; revoked permission is rechecked; cancelled chat cannot start capture after a late reply.

For a packaged macOS app add `NSMicrophoneUsageDescription` to `Info.plist` and, with the hardened runtime, the `com.apple.security.device.audio-input` entitlement.

## Run the example app

```sh
npm ci && npm run build
cd example-app && npm ci && npm start
```

The [example app](example-app/README.md) consumes this package (`file:..`). Its Settings window configures the chat URL, locale, exact origins, guest or identified mode (your mint endpoint), microphone on/off, the `onAction`/`onClose` callbacks, `accountChanged()`, and shows a callbacks log. The default guest chat is `https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en`.

`desktop_sdk` is the hosted product's channel for third-party desktop apps built on the official desktop SDKs: the chat loads as the window's top-level page, uses the normal chat layout (no Busymate Console title-bar inset), applies `locale` from the first frame, and sessions are labelled "Desktop app (SDK)" in the Console. Do not use `desktop` (reserved for Busymate's own Console app) or `embed` (it needs an allow-listed parent frame and cannot start as a top-level window); see [configuration](docs/configuration.md#chat-url-and-channel).

## Download the adapter

`microphone.ts` and `preload-microphone.ts` (microphone adapter 1.0.0, wire 1) ship in this SDK and are attached to every GitHub release, with `SHA256SUMS`:

`microphone.ts`:

- Latest release: https://github.com/serebano/busymate-ai-sdk-electron/releases/latest/download/microphone.ts
- Pinned, SDK 1.0.2: https://github.com/serebano/busymate-ai-sdk-electron/releases/download/1.0.2/microphone.ts

`preload-microphone.ts`:

- Latest release: https://github.com/serebano/busymate-ai-sdk-electron/releases/latest/download/preload-microphone.ts
- Pinned, SDK 1.0.2: https://github.com/serebano/busymate-ai-sdk-electron/releases/download/1.0.2/preload-microphone.ts

Checksums for both files:

- Checksums: https://github.com/serebano/busymate-ai-sdk-electron/releases/download/1.0.2/SHA256SUMS (`shasum -a 256 -c SHA256SUMS --ignore-missing`)

The SDK installs the adapter itself; the standalone files are for audit and vendoring.

This repository and its releases are the only source of the adapter. busymate.ai no longer publishes adapter copies; its legacy `https://busymate.ai/sdk/microphone/1.0.0/` files stay frozen for existing integrations.

## Release process

Every release attaches each `adapterAssets` file from [release-manifest.json](release-manifest.json) under its basename, plus `SHA256SUMS` covering every asset. `python3 scripts/verify-release.py` checks that each adapter asset is pinned in `files` with a matching sha256.

## Build, test and versions

```sh
python3 scripts/verify-release.py
npm ci
npm run build && npm run typecheck && npm run lint && npm test
```

CI (`sdk-check`) runs that on Ubuntu, macOS and Windows, builds the example against the packed tarball, and launches the example under xvfb on Linux (sandboxed renderer, real hosted guest chat, both bridges present, no Node.js in the page). It does not certify OS microphone dialogs, code signing/notarization, auto-update or your backend integration.

Distribution 1.0.2 differs from identity wire 2/build 2.0.0 and microphone wire 1/adapter 1.0.0. [Release manifest](release-manifest.json) pins the source hashes; the frozen kit files match `https://busymate.ai/sdk/v2/2.0.0/SHA256SUMS`. This repository is canonical for Electron SDK releases; [busymate.ai official documentation](https://busymate.ai/docs/guides/electron-sdk) owns the human integration guides ([identity bridge compatibility](https://busymate.ai/docs/guides/app-bridge-v2)). See [changelog](CHANGELOG.md) and [v2 wire contract](CONTRACT-v2.md).
