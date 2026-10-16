"""Verify the pinned source hashes and version metadata of this SDK release."""
from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parents[1]
m = json.loads((root / "release-manifest.json").read_text())
pkg = json.loads((root / "package.json").read_text())
for name, expected in m["files"].items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    assert actual == expected, f"Pinned source changed: {name}"
    print(f"verified {name} {actual}")
# The frozen kit v2 files are exactly what busymate.ai publishes under /sdk/v2/2.0.0/.
published = {
    "frozen/v2/2.0.0/core/busymateBridgeCore.js": "b4590d7fb20ba0ac3d79c80e41bebd880cfd6eda170d95e8b3f1cf7b4e8410f7",
    "frozen/v2/2.0.0/electron/main.js": "7d52a2fccf94ad671a3d811f36989fc4649bed103c5d87f234973def887a2022",
    "frozen/v2/2.0.0/electron/preload.js": "d5aaa1ff93374dabf4f653835ba527ba650fa330bdbf20b06b9e38961583a9be",
}
for name, expected in published.items():
    assert m["files"].get(name) == expected, f"Frozen kit v2 differs from busymate.ai: {name}"
assert m["version"] == "1.0.2" == pkg["version"], "version mismatch"
assert "channel=desktop_sdk&" in m["defaultGuestChat"], "default guest chat must use the desktop_sdk channel"
assert m["package"] == pkg["name"]
assert m["identityWire"]["v2Build"] == "2.0.0" and m["microphoneAdapter"] == "1.0.0"
example = json.loads((root / "example-app" / "package.json").read_text())
assert example["dependencies"]["@busymate/ai-electron"] == "file:..", "example must consume this SDK"
print(f"release {m['version']} verified")

# Every release attaches each adapter source file under its basename, listed in SHA256SUMS.
_assets = m['adapterAssets']
assert _assets, 'adapterAssets must list the microphone adapter source file(s)'
assert len({Path(a).name for a in _assets}) == len(_assets), 'adapter asset basenames must be unique'
for _a in _assets:
    assert _a in m['files'], f'adapter asset {_a} is not pinned in files'
    _sha = hashlib.sha256((root / _a).read_bytes()).hexdigest()
    assert _sha == m['files'][_a], f'adapter asset {_a} changed'
    print(f'verified adapter asset {Path(_a).name} {_sha}')
