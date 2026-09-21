# -*- coding: utf-8 -*-
"""
plant_lib.py —— 植物名映射 + 卡槽模板解析（纯 numpy/pillow，不依赖 cv2）
========================================================================

为 custom 选植物逻辑提供两样核心数据：

1) 中英文对照: 解析 `植物中英文对照表.md`
    中文名 -> (英文名, 品质)  品质 ∈ {橙,紫,蓝,绿,白}

2) 模板路径解析: 解析 `plant_ref_card/<品质>/` 目录
     - 平坦文件:      <品质>/<英文名>.png                 （单一模板）
     - 皮肤子文件夹:  <品质>/<英文名>/<英文名>*.png        （多个皮肤模板，命中其一即算命中）
     -> resolve_templates(英文名, 品质) 返回该植物全部候选模板文件

说明:
    - 本文件刻意不 import cv2（目标 MAAPVZ 的 venv 没有 opencv），
      只用 numpy + pillow，方便直接移植进 agent。
    - 所有路径都开放为参数 / 环境变量覆盖，避免中文路径 或 移植后改路径 出问题。
"""

import os
import re
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# 默认路径（可通过环境变量覆盖，避免移植后硬编码）
# ---------------------------------------------------------------------------

# 中英文对照表（中文名 -> 英文名/品质）
DEFAULT_TABLE_MD = os.environ.get(
    "SELECT_PLANT_TABLE",
    str(Path(__file__).resolve().parent / "植物中英文对照表.md"),
)

# 卡槽模板根目录（选卡界面按品质分夹）
# 相对定位: 本文件位于 <工程根>/agent/select_plant/ 下,
#           模板在 <工程根>/assets/resource/image/General/plant/plant_ref_card
DEFAULT_TEMPLATE_DIR = os.environ.get(
    "SELECT_PLANT_TEMPLATE_DIR",
    str(Path(__file__).resolve().parent.parent.parent
        / "assets" / "resource" / "image" / "General" / "plant" / "plant_ref_card"),
)

# 品质别名 -> 目录名（吉利/兼容）
QUALITY_FOLDER = {
    "橙": "橙卡",
    "紫": "紫卡",
    "蓝": "蓝卡",
    "绿": "绿卡",
    "白": "白卡",
}


# ===========================================================================
# 1. 中英文对照
# ===========================================================================

# 表格里的品质列只认这些值
_QUALITY_CELLS = {"橙", "紫", "蓝", "绿", "白"}

# 正则: | 中文名 | `英文名` | 品质 |   （英文名用反引号包裹，品质为 橙/紫/蓝/绿/白）
_ROW_RE = re.compile(
    r"^\s*\|\s*(?P<zh>[^|]+?)\s*\|\s*`?(?P<en>[^`|]+?)`?\s*\|\s*(?P<quality>[橙紫蓝绿白])\s*\|"
)


def load_name_table(table_md=None):
    """解析 植物中英文对照表.md。

    返回 { 中文名: {"en": 英文名, "quality": 品质} }
    """
    table_md = table_md or DEFAULT_TABLE_MD
    table_path = Path(table_md)
    if not table_path.is_file():
        raise FileNotFoundError(f"找不到中英文对照表: {table_path}")

    mapping = {}
    for line in table_path.read_text(encoding="utf-8").splitlines():
        m = _ROW_RE.match(line)
        if not m:
            continue
        zh = m.group("zh").strip()
        en = m.group("en").strip()
        quality = m.group("quality").strip()
        if not zh or not en or quality not in _QUALITY_CELLS:
            continue
        # 中英文名去重，中文优先（同 zh 冲突时后者覆盖）
        mapping[zh] = {"en": en, "quality": quality}
        # 也登记英文名 -> 同一记录，方便直接传英文名
        mapping.setdefault(en, {"en": en, "quality": quality})
    return mapping


def resolve(name, table_md=None):
    """把用户输入的中文名（或英文名）解析为 (英文名, 品质)。

    找不到时返回 (None, None)。
    """
    mapping = load_name_table(table_md)
    rec = mapping.get(str(name).strip())
    if not rec:
        return None, None
    return rec["en"], rec["quality"]


# ===========================================================================
# 2. 模板路径解析
# ===========================================================================


def quality_dir(template_dir, quality):
    """品质 -> 目录路径。"""
    folder = QUALITY_FOLDER.get(quality)
    if not folder:
        raise ValueError(f"未知品质: {quality!r}（应传入 橙/紫/蓝/绿/白）")
    return Path(template_dir) / folder


def resolve_templates(en_name, quality, template_dir=None, table_md=None):
    """返回某植物（英文名 + 品质）的全部候选模板 PNG 路径。

    - 平坦:        <品质>/<en>.png
    - 皮肤子夹:    <品质>/<en>/<en>*.png
    - 命中其一即算命中。

    返回 list[Path]；找不到返回 []
    """
    template_dir = template_dir or DEFAULT_TEMPLATE_DIR
    qdir = quality_dir(template_dir, quality)

    candidates = []

    # 平坦单模板
    flat = qdir / f"{en_name}.png"
    if flat.is_file():
        candidates.append(flat)

    # 皮肤子文件夹（多个模板）
    subdir = qdir / en_name
    if subdir.is_dir():
        for f in sorted(subdir.iterdir()):
            if f.is_file() and f.suffix.lower() == ".png":
                candidates.append(f)

    return candidates


def load_template_png(path):
    """读取 PNG -> (灰度图HxW float32, 可选alpha mask)。

    返回 (gray, alpha_mask 或 None)。
    """
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGBA")
    arr = np.asarray(im, dtype=np.uint8)  # HxWx4
    r = arr[..., 0].astype(np.float32)
    g = arr[..., 1].astype(np.float32)
    b = arr[..., 2].astype(np.float32)
    gray = 0.299 * r + 0.587 * g + 0.114 * b

    alpha = arr[..., 3].astype(np.float32)
    # 半透明按 alpha 作为 mask 权重（>=1 算有效）
    mask = (alpha > 16).astype(np.float32)
    if float(mask.sum()) <= 4.0:
        mask = None  # 无有效 alpha，当作普通图，走灰度匹配
    return gray, mask


# ===========================================================================
# 3. 图像读写（兼容中文路径）
# ===========================================================================


def imread_any(path, rgb=False):
    """读任意路径图片（含中文）-> numpy HxWx3 uint8（BGR 或 RGB）。"""
    from PIL import Image

    with Image.open(str(path)) as im:
        im = im.convert("RGB")
    arr = np.asarray(im, dtype=np.uint8)  # HxWx3
    # cv2 默认 BGR，PIL 为 RGB；这里统一转 BGR 以兼容既有 "cv2-match scenes" 语义
    if rgb:
        return arr
    return arr[..., ::-1].copy()


def bgr_to_gray(img):
    """HxWx3(BGR) -> HxW float32 灰度。"""
    b = img[..., 0].astype(np.float32)
    g = img[..., 1].astype(np.float32)
    r = img[..., 2].astype(np.float32)
    return 0.299 * r + 0.587 * g + 0.114 * b