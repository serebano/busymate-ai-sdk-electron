# Configuration reference

## `createBusymateChatWindow(options)` / `createBusymateChatView(options)`

| Option | Behavior |
|---|---|
| `url` | Required https chat URL. Its origin must be in the allow-list, otherwise the call throws. No credentials. |
| `assistant` | Required assistant slug; adds exactly `https://<assistant>.busymate.ai` to the allowed origins. Obtain the actual assistant URL from Busymate; a marketing page is not a chat URL. |
| `origins` | Extra exact HTTPS origins (mapped support hosts). No wildcards, paths, queries or `http:`; invalid entries are ignored by the frozen bridge. The same list governs identity, microphone and navigation. |
| `appId` | Required. Your app id; salts the account hash and is reported in `hello`. |
| `appVersion`, `appBuild` | Optional, reported in `hello`. |
| `account` | Function returning the current account ID or `null`, read when state/mint is requested. |
| `mint` | Required authenticated-backend callback; `Promise<{ token, nonce } \| null>`, fresh for every request. |
| `onAction` | Optional fixed app-action handler; return `true` only when handled. |
| `onClose` | Optional host dismissal; fallback for the `close` action. |
| `microphone` | Default `true`: installs the microphone adapter and the combined preload. `false` loads the frozen identity-only preload, so the page sees no `BusymateMicrophone` and every media request is denied. |
| `session` / `partition` | Default: the dedicated session `persist:busymate-chat`. The adapter owns that session's permission handlers. |
| `otherPermission` | When you share the session with other WebContents: decides their permissions (default deny). |
| `openExternal` | Opens https URLs outside the app (bridge `open`, blocked navigations, `window.open`). Default `shell.openExternal` for https only. |
| `onRenderProcessGone` | Told when the renderer died. The frozen bridge reloads the chat and emits `restored`. |
| `onEvent` | Host log: `bridge-request` (op and origin only), microphone decisions, `media-permission`, `navigation-blocked`, `window-open-blocked`, `webview-blocked`, `render-process-gone`, `unresponsive`, `responsive`. URLs are logged without query or fragment. |
| `window` | `createBusymateChatWindow` only: your `BrowserWindow` options (size, parent, title…). `webPreferences` are always the secure set. |

The returned host has `load()`, `resume()`, `accountChanged()`, `dispose()`, `origins`, `webContents`, `bridge`, `microphone`, and `window` or `view`. Add a view to your window with `win.contentView.addChildView(chat.view)` and size it with `setBounds`; call `chat.resume()` when your app returns to the foreground.

## Secure defaults

`secureWebPreferences()` sets `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `webviewTag: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `navigateOnDragDrop: false` and `safeDialogs: true`. `hardenWebContents()` keeps top-level navigation and redirects on the allowed origins, denies every `window.open`, refuses `<webview>` attachment and reports unresponsive renderers. Sub-frames get no bridge (the preload runs only in the main frame), so load the hosted chat page directly rather than a page that embeds it.

## Lower-level APIs

- `installBusymateChat(webContents, options)`: everything above on a WebContents you created with `secureWebPreferences({ preload: preloadPath() })`.
- `installBusymateBridge(webContents, config)`: the frozen identity bridge only (pair with `bridgePreloadPath()` or `preloadPath()`).
- `installBusymateMicrophone(webContents, { origins })`: the microphone adapter only (pair with `preloadPath()`).
- `preloadPath()`: `dist/preload.js`, the frozen identity preload byte-for-byte followed by the microphone port. `bridgePreloadPath()`: the frozen identity-only preload. Both are sandbox-safe single files (they require only `electron`). Package subpaths: `@busymate/ai-electron/preload` and `@busymate/ai-electron/preload-bridge`.
- `allowedOrigins`, `parseExactOrigin`, `normalizeOrigin`, `isAllowedOrigin`, `originOfUrl`: the exact-origin rules.
- `guestChatUrl({ assistant, channel, locale })`, `DEFAULT_GUEST_CHAT_URL`, `SDK_VERSION`, `BRIDGE_BUILD`, `MICROPHONE_ADAPTER`.

If you bundle your own preload, it must still expose `window.BusymateBridge` exactly as the frozen preload does; prefer using `preloadPath()`.

## Chat URL and channel

Preserve the tenant-generated chat URL, including supported query parameters such as `locale`. The default guest chat is `https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en` (assistant `busyproxy`, extra origin `https://busymate.ai`). `channel=desktop_sdk` is the hosted product's channel for third-party desktop apps on the official desktop SDKs: the chat loads as the window's top-level page with no parent frame, uses the normal chat layout (no Busymate Console title-bar inset), applies `locale` on the first frame, asks this SDK's bridge for identity, and labels sessions "Desktop app (SDK)" in the Console. Do not use `channel=desktop`, which is reserved for Busymate's own Console app and brings its desktop-shell styling, or `channel=embed`, which needs an allow-listed parent frame and cannot start as a top-level window. Hosted appearance, theme, voice availability and tenant behavior are configured in the Busymate Console, not by native flags.

There is no SDK setting for automatic OS prompts on page load, camera access, opening system settings, timeout override, provider credentials or token caching. The SDK does not own window chrome, layout, menus or audio routing; your host does.
