#!/usr/bin/env python3
"""
Syncs the web UI files (`index.html`, `styles.css`, `app.js`, `manifest.json`, `icon.svg`, `sw.js`)
into the native Android (`android/app/src/main/assets/web/`) and iOS (`ios/MafiaHub/WebAssets/`) bundles.
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_FILES = ["index.html", "styles.css", "app.js", "manifest.json", "icon.svg", "sw.js"]

TARGETS = [
    ROOT / "android" / "app" / "src" / "main" / "assets" / "web",
    ROOT / "ios" / "MafiaHub" / "WebAssets",
]


def main():
    for target_dir in TARGETS:
        target_dir.mkdir(parents=True, exist_ok=True)
        for fname in WEB_FILES:
            src = ROOT / fname
            if src.exists():
                shutil.copy2(src, target_dir / fname)
        print(f"Synced {len(WEB_FILES)} web assets -> {target_dir.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
