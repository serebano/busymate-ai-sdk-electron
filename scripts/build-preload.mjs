// dist/preload.js = the frozen kit v2 preload, byte for byte, followed by the
// microphone port in its own function scope. A sandboxed preload cannot
// require sibling files, so the two must live in one file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frozen = readFileSync(join(root, "frozen/v2/2.0.0/electron/preload.js"));
const microphone = readFileSync(join(root, "build/preload/preload-microphone.js"), "utf8");
const tail =
  "\n// ── BusymateMicrophone (wire 1, adapter 1.0.0) — @busymate/ai-electron ──\n" +
  "(function () {\n" + microphone.trimEnd() + "\n})();\n";
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/preload.js"), Buffer.concat([frozen, Buffer.from(tail, "utf8")]));
console.log("wrote dist/preload.js");
