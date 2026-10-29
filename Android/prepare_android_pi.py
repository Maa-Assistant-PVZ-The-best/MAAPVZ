#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把仓库里的 assets + agent 合成 MaaFwApp 能 sync 的一份 PI 根（Android/pi-root/）。

布局：interface.json 在 assets/ 里，agent 在仓库根；Gradle 的 include 只能相对
assets 目录，所以先摊成 pi-root/：根上 interface.json，旁边 resource/、agent/。

顺带两件事：
  1. rid 补丁：APK 在 Mirror酱 是独立资源 MaaPVZ_exec（与桌面端 MaaPVZ 分开），
     只改 pi-root 里的拷贝，assets/interface.json 原样不动（行内替换，不解析
     JSON——该文件带 // 注释，解析回写会丢注释；目标串必须恰好出现 1 次）。
  2. OCR 模型：resource/model/ocr/ 不入 git。本地存在就直接用；否则从官方 CDN
     拉 ppocr_v6-small。打完校验 det.onnx / rec.onnx 必须在。

pi-root/ 是构建产物，不进 git。
（本脚本放 Android/ 而非 tools/：tools/ 有自己的 AGENTS.md，禁止改动。）
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEST = REPO / "Android" / "pi-root"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".git")

OLD_RID = '"mirrorchyan_rid": "MaaPVZ",'
NEW_RID = '"mirrorchyan_rid": "MaaPVZ_exec",'

OCR_URL = "https://download.maafw.xyz/MaaCommonAssets/OCR/ppocr_v6/ppocr_v6-small.zip"
OCR_DIR = "resource/model/ocr"  # pi-root 内的落点


def copy_tree(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=IGNORE)


def patch_rid() -> None:
    p = DEST / "interface.json"
    s = p.read_text(encoding="utf-8")
    n = s.count(OLD_RID)
    if n != 1:
        raise SystemExit(
            f"interface.json 里目标串出现 {n} 次（应为 1 次），拒绝继续：{OLD_RID}"
        )
    p.write_text(s.replace(OLD_RID, NEW_RID, 1), encoding="utf-8")
    print("rid 补丁：MaaPVZ -> MaaPVZ_exec（仅 pi-root 拷贝）")


def ensure_ocr_models() -> None:
    target = DEST / OCR_DIR
    local = REPO / "assets" / "resource" / "model" / "ocr"
    if (local / "det.onnx").is_file() and (local / "rec.onnx").is_file():
        # assets 摊平时已经拷进 pi-root；这里只是确认
        if (target / "det.onnx").is_file() and (target / "rec.onnx").is_file():
            print("OCR 模型：复用仓库本地副本")
            return
    print(f"OCR 模型：本地没有，从 CDN 下载 {OCR_URL}")
    tmp_zip = REPO / "Android" / "_ppocr_tmp.zip"
    tmp_dir = REPO / "Android" / "_ppocr_tmp"
    try:
        urllib.request.urlretrieve(OCR_URL, tmp_zip)
        with zipfile.ZipFile(tmp_zip) as z:
            z.extractall(tmp_dir)
        target.mkdir(parents=True, exist_ok=True)
        src = tmp_dir / "model"
        if not src.is_dir():
            src = tmp_dir / "ppocr_v6-small"
        if not src.is_dir():
            src = tmp_dir
        for f in src.iterdir():
            if f.is_file():
                shutil.copy2(f, target / f.name)
    finally:
        tmp_zip.unlink(missing_ok=True)
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
    if not ((target / "det.onnx").is_file() and (target / "rec.onnx").is_file()):
        raise SystemExit(f"OCR 模型缺失：{target} 下没有 det.onnx / rec.onnx")
    print(f"OCR 模型：已就位 {target}")


def main() -> int:
    assets = REPO / "assets"
    if not (assets / "interface.json").is_file():
        print(f"missing {assets / 'interface.json'}", file=sys.stderr)
        return 1

    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)

    # assets/* 全部摊到 pi-root 根（interface.json、resource/ 等）
    for child in assets.iterdir():
        target = DEST / child.name
        if child.is_dir():
            copy_tree(child, target)
        else:
            shutil.copy2(child, target)

    # 作业集是用户数据（gitignored），不打进包里。
    # 安卓端它的正式落点是 <pi>/../jobs（见 agent/jobset/engine.py 的 jobs_dir_for），
    # 但开发仓库的 assets/resource/jobs 会被上面那次摊平拷进来，这里一律清掉。
    shutil.rmtree(DEST / "resource" / "jobs", ignore_errors=True)
    shutil.rmtree(DEST / "jobs", ignore_errors=True)

    copy_tree(REPO / "agent", DEST / "agent")

    endless_src = REPO / "game_assist_tools" / "endless_setup"
    if endless_src.is_dir():
        endless_dest = DEST / "game_assist_tools" / "endless_setup"
        endless_dest.mkdir(parents=True, exist_ok=True)

        for name in ("pvz_android.py", "config.json"):
            src = endless_src / name
            if src.is_file():
                shutil.copy2(src, endless_dest / name)

        static_src = endless_src / "static"
        if static_src.is_dir():
            copy_tree(static_src, endless_dest / "static")

    for name in ("LICENSE", "CONTACT"):
        src = REPO / name
        if src.is_file():
            shutil.copy2(src, DEST / name)

    logo = REPO / "docs" / "imgs" / "logo.png"
    if logo.is_file():
        dest_logo = DEST / "docs" / "imgs"
        dest_logo.mkdir(parents=True, exist_ok=True)
        shutil.copy2(logo, dest_logo / "logo.png")
        # MaaFwApp 的 PI 图标固定找 resource/logo.png（缺了只告警，顺手补上）
        shutil.copy2(logo, DEST / "resource" / "logo.png")

    patch_rid()
    ensure_ocr_models()

    files = sum(1 for p in DEST.rglob("*") if p.is_file())
    print(f"{files} files -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
