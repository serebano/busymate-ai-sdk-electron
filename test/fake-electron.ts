// A minimal in-memory stand-in for the "electron" module. The same object is
// returned to ESM imports (vi.mock) and to CommonJS require("electron") from
// the frozen kit files (require.cache), so tests drive the real frozen code.
import { EventEmitter } from "node:events";
import Module, { createRequire } from "node:module";

type Handler = (...args: never[]) => unknown;

export class FakeSession {
  requestHandler: Handler | null = null;
  checkHandler: Handler | null = null;
  setPermissionRequestHandler(handler: Handler | null) {
    this.requestHandler = handler;
  }
  setPermissionCheckHandler(handler: Handler | null) {
    this.checkHandler = handler;
  }
}

export class FakeFrame {
  sent: Array<[string, string]> = [];
  destroyed = false;
  constructor(
    public origin: string,
    public url = origin + "/",
  ) {}
  isDestroyed() {
    return this.destroyed;
  }
  send(channel: string, message: string) {
    this.sent.push([channel, message]);
  }
}

export class FakeWebContents extends EventEmitter {
  url = "";
  destroyed = false;
  reloads = 0;
  sent: Array<[string, string]> = [];
  session: FakeSession;
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
  constructor(session = new FakeSession()) {
    super();
    this.session = session;
  }
  getURL() {
    return this.url;
  }
  isDestroyed() {
    return this.destroyed;
  }
  reload() {
    this.reloads++;
  }
  send(channel: string, message: string) {
    this.sent.push([channel, message]);
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.windowOpenHandler = handler;
  }
  loadURL(url: string) {
    this.url = url;
    return Promise.resolve();
  }
  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

export const created: { windows: FakeBrowserWindow[]; views: FakeWebContentsView[] } = { windows: [], views: [] };

export class FakeBrowserWindow extends EventEmitter {
  webContents: FakeWebContents;
  constructor(public options: { webPreferences?: { session?: FakeSession } } & Record<string, unknown>) {
    super();
    this.webContents = new FakeWebContents(options.webPreferences?.session ?? new FakeSession());
    created.windows.push(this);
  }
}

export class FakeWebContentsView {
  webContents: FakeWebContents;
  constructor(public options: { webPreferences?: { session?: FakeSession } }) {
    this.webContents = new FakeWebContents(options.webPreferences?.session ?? new FakeSession());
    created.views.push(this);
  }
}

export const ipcMain = new EventEmitter();
export const shell = {
  opened: [] as string[],
  async openExternal(url: string) {
    shell.opened.push(url);
  },
};
export const systemPreferences = {
  status: "granted" as string,
  asks: 0,
  getMediaAccessStatus() {
    return systemPreferences.status;
  },
  async askForMediaAccess() {
    systemPreferences.asks++;
    return true;
  },
};
const partitions = new Map<string, FakeSession>();
export const session = {
  fromPartition(name: string) {
    let value = partitions.get(name);
    if (!value) {
      value = new FakeSession();
      partitions.set(name, value);
    }
    return value;
  },
};

export const electron = {
  ipcMain,
  shell,
  systemPreferences,
  session,
  BrowserWindow: FakeBrowserWindow,
  WebContentsView: FakeWebContentsView,
};

// CommonJS: make the frozen files' require("electron") return this fake.
const load = createRequire(import.meta.url);
const resolved = load.resolve("electron");
const fake = new Module(resolved);
fake.exports = electron;
fake.loaded = true;
load.cache[resolved] = fake;

/** An IPC event as Electron delivers it to ipcMain listeners. */
export function ipcEvent(sender: FakeWebContents, frame: FakeFrame | null) {
  const replies: string[] = [];
  return {
    replies,
    event: {
      sender,
      senderFrame: frame,
      reply: (_channel: string, message: string) => replies.push(message),
    },
  };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
