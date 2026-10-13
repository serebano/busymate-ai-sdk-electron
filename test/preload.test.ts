// Runs the built sandboxed preload (dist/preload.js) in a VM with a stand-in
// contextBridge/ipcRenderer, the only things a sandboxed preload may require.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadPreload(file: string, isActive: boolean) {
  const exposed: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  const sent: unknown[][] = [];
  const handlers = new Map<string, (event: unknown, message: unknown) => void>();
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: Record<string, (...args: unknown[]) => unknown>) => (exposed[name] = api) },
    ipcRenderer: {
      send: (...args: unknown[]) => sent.push(args),
      on: (channel: string, handler: (event: unknown, message: unknown) => void) => handlers.set(channel, handler),
    },
  };
  const requireStub = (name: string) => {
    if (name !== "electron") throw new Error("sandboxed preload may not require " + name);
    return electron;
  };
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  runInNewContext(`(function (require) {\n${source}\n})`, { navigator: { userActivation: { isActive } } })(requireStub);
  return { exposed, sent, handlers };
}

describe("sandboxed preload", () => {
  it("exposes BusymateBridge (frozen) and BusymateMicrophone with the Android object shape", () => {
    const { exposed, sent, handlers } = loadPreload("../dist/preload.js", true);
    expect(Object.keys(exposed).sort()).toEqual(["BusymateBridge", "BusymateMicrophone"]);
    for (const api of Object.values(exposed)) {
      expect(Object.keys(api).sort()).toEqual(["addEventListener", "postMessage", "removeEventListener"]);
    }
    const mic = exposed.BusymateMicrophone!;
    const received: unknown[] = [];
    const listener = (event: unknown) => received.push(event);
    mic.addEventListener!("message", listener);
    mic.postMessage!('{"type":"busymate.microphone.v1.request","id":"mic-1","source":"voice"}');
    expect(sent).toEqual([["busymate:microphone", '{"type":"busymate.microphone.v1.request","id":"mic-1","source":"voice"}', true]]);
    handlers.get("busymate:microphone")!({}, '{"id":"mic-1","granted":true}');
    expect(received).toEqual([{ data: '{"id":"mic-1","granted":true}' }]);
    mic.removeEventListener!("message", listener);
    handlers.get("busymate:microphone")!({}, '{"id":"mic-2","granted":false}');
    expect(received).toHaveLength(1);

    exposed.BusymateBridge!.postMessage!('{"bm":2,"id":1,"op":"hello"}');
    expect(sent[1]).toEqual(["busymate:bridge", '{"bm":2,"id":1,"op":"hello"}']);
  });

  it("reports no user activation outside a tap", () => {
    const { exposed, sent } = loadPreload("../dist/preload.js", false);
    exposed.BusymateMicrophone!.postMessage!("x");
    expect(sent[0]![2]).toBe(false);
  });

  it("the identity-only preload exposes no microphone port", () => {
    const { exposed } = loadPreload("../frozen/v2/2.0.0/electron/preload.js", true);
    expect(Object.keys(exposed)).toEqual(["BusymateBridge"]);
  });
});
