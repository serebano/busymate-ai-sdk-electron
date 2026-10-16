# Changelog

## 1.0.2

Release packaging: the microphone adapter source (`microphone.ts` sha256 `d15274b9aac0c9b326d30b3bc035af79c25b04583eafe4d8f1be1bd73cc912f2`, `preload-microphone.ts` sha256 `1444678c27f4b7a73f5815e0c4b9addfaeeedb391e0e3ee4e323aad94c2a72f2`; adapter 1.0.0, wire 1) is attached to every GitHub release and listed in `SHA256SUMS`; docs link the release ([Download the adapter](docs/microphone.md#download-the-adapter)). `release-manifest.json` lists `adapterAssets` and `scripts/verify-release.py` checks them. No adapter or bridge code change (refs serebano/busymate-ai-src#2156).

## 1.0.1

The default hosted chat URL now uses `channel=desktop_sdk` (`https://busymate.ai/support/busyproxy?channel=desktop_sdk&locale=en`), the hosted product's channel for third-party desktop SDK apps. The chat loads top-level with the normal layout (no Busymate Console title-bar inset), applies `locale` on the first frame, and labels sessions "Desktop app (SDK)". `guestChatUrl()` defaults to it. Previously the default was `channel=desktop`, which is reserved for Busymate's own Console app. The frozen identity bridge build 2.0.0 and microphone adapter 1.0.0 are unchanged, and their pinned hashes are identical to 1.0.0.

## 1.0.0

First independent Electron distribution, `@busymate/ai-electron`: the frozen identity v2 bridge build 2.0.0 (core, main and preload byte-identical to `https://busymate.ai/sdk/v2/2.0.0/`), microphone adapter 1.0.0 for Electron (wire 1), and a secure chat host helper for `BrowserWindow` and `WebContentsView` (contextIsolation, sandbox, no Node.js integration, exact-origin navigation, denied window.open, renderer-crash handling). Built as ESM and CommonJS with TypeScript types; distributed as a release tarball. Hosted chat receives updates separately; your app release is needed to install or upgrade native SDK code.
