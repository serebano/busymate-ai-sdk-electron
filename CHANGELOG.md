# Changelog

## 1.0.0

First independent Electron distribution, `@busymate/ai-electron`: the frozen identity v2 bridge build 2.0.0 (core, main and preload byte-identical to `https://busymate.ai/sdk/v2/2.0.0/`), microphone adapter 1.0.0 for Electron (wire 1), and a secure chat host helper for `BrowserWindow` and `WebContentsView` (contextIsolation, sandbox, no Node.js integration, exact-origin navigation, denied window.open, renderer-crash handling). Built as ESM and CommonJS with TypeScript types; distributed as a release tarball. Hosted chat receives updates separately; your app release is needed to install or upgrade native SDK code.
