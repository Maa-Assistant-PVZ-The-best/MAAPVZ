#!/usr/bin/env python3
"""给 agent-dist 里 pure.zip 补 flask/sansio/__init__.py;

Flask 3.1.x 官方 wheel 把 flask/sansio 做成 namespace package(无 __init__.py);
而 build_agent_bundle.py 的 pack_site_packages 只写文件条目,不写目录条目;
zipimport 找不到 flask.sansio,补一个空 __init__.py 即可

用法:python tools/patch_pure_zip.py <agent-dist-dir>
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

TARGETS = [
    "flask/sansio/__init__.py",
]


def patch_one(zip_path: Path) -> bool:
    with zipfile.ZipFile(zip_path) as z:
        existing = set(z.namelist())
    todo = [t for t in TARGETS if t not in existing]
    if not todo:
        print(f"  ok      {zip_path}")
        return False
    with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as z:
        for name in todo:
            z.writestr(name, b"")
            print(f"  patched {zip_path} :: {name}")
    return True


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: patch_pure_zip.py <agent-dist-dir>", file=sys.stderr)
        return 2
    root = Path(argv[0]).resolve()
    if not root.is_dir():
        print(f"not a dir: {root}", file=sys.stderr)
        return 1
    zips = sorted(root.rglob("pure.zip"))
    if not zips:
        print(f"no pure.zip under {root}", file=sys.stderr)
        return 1
    changed = 0
    for z in zips:
        if patch_one(z):
            changed += 1
    print(f"done: {changed}/{len(zips)} zip(s) patched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
