# -*- coding: utf-8 -*-
"""作业集规则 -> BatchSwipe DSL 翻译。

作业集里的落子数据是**格子名**（如 "格子2_2"），而 BatchSwipe 需要
「起点,终点」坐标对。坐标表 agent/assets/resource/coords.json 里既有格子点
也有槽位点，本模块负责把两者拼成 BatchSwipe 能吃的 DSL 片段。

DSL 片段形态（详见 agent/actions/batch_swipe.py 顶部注释）：
    swipe:1槽位,格子2_2,80        # 从「1槽位」滑到「格子2_2」，80ms
    click:格子2_2                 # 点击（喂豆/铲子用）

组合动作节点约定（03_Endless_fight/）：
    无尽挑战_{N}槽组合动作_单次 / _循环   -> 种一个槽位的植物
    无尽挑战_喂豆组合动作_单次 / _循环
    无尽挑战_铲子组合动作_单次 / _循环

槽位 key（作业集 slotModes）-> 中文序数：
    card1..card8 -> 一槽..八槽
    feed         -> 喂豆
    shovel       -> 铲子
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# 槽位名映射
# ---------------------------------------------------------------------------

CARD_ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八"]

SLOT_KEY_TO_ORDINAL: Dict[str, str] = {
    f"card{i}": CARD_ORDINALS[i - 1] for i in range(1, 9)
}

# 作业集 slots 里的数字键（"1".."8"）-> card key
NUM_TO_CARD_KEY: Dict[str, str] = {str(i): f"card{i}" for i in range(1, 9)}


def card_key_of(slot: Any) -> Optional[str]:
    """把作业集里的槽位标识统一成 cardN。

    接受 "1".."8" / 1..8 / "card1".."card8"；其余返回 None。
    """
    if slot is None:
        return None
    s = str(slot).strip()
    if not s:
        return None
    if s.startswith("card"):
        n = s[4:]
        if n.isdigit() and 1 <= int(n) <= 8:
            return f"card{int(n)}"
        return None
    if s.isdigit() and 1 <= int(s) <= 8:
        return f"card{int(s)}"
    return None


def ordinal_of(slot: Any) -> Optional[str]:
    """cardN -> 一/二/.../八；不是植物槽返回 None。"""
    key = card_key_of(slot)
    if key is None:
        return None
    return SLOT_KEY_TO_ORDINAL[key]


# ---------------------------------------------------------------------------
# 坐标表
# ---------------------------------------------------------------------------

def load_coords(path: Optional[Path] = None) -> Dict[str, Any]:
    """读坐标表。默认 agent/assets/resource/coords.json。"""
    if path is None:
        path = Path(__file__).resolve().parent.parent / "assets" / "resource" / "coords.json"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _coord_ok(coords: Dict[str, Any], name: str) -> bool:
    v = coords.get(name)
    if not isinstance(v, (list, tuple)) or len(v) < 2:
        return False
    return all(isinstance(x, (int, float)) for x in v[:2])


# ---- 真实坐标表的键名前缀（来自 agent/assets/resource/coords.json 实测） ----
PREFIX_INIT = "种植物_初始化_"

# 序数 -> 中文序号（第一个/第二个/...）
ORDINAL_WORD: Dict[str, str] = {
    "一": "第一个", "二": "第二个", "三": "第三个", "四": "第四个",
    "五": "第五个", "六": "第六个", "七": "第七个", "八": "第八个",
}


def find_slot_point(coords: Dict[str, Any], ordinal: str, slot_name: str = "") -> Optional[str]:
    """找某个槽位的「起始点」在坐标表里的键名。

    真实键名形如：种植物_初始化_第一个槽位
    返回**键名**（BatchSwipe 直接吃键名），找不到返回 None。
    """
    word = ORDINAL_WORD.get(ordinal, f"第{ordinal}个")
    candidates = [
        f"{PREFIX_INIT}{word}槽位",
        f"{PREFIX_INIT}{ordinal}槽位",
        f"{ordinal}槽位",
        f"{ordinal}槽",
        f"{ordinal}阳光起始点",
    ]
    if slot_name:
        candidates = [f"{PREFIX_INIT}{slot_name}"] + candidates + [slot_name]
    for c in candidates:
        if _coord_ok(coords, c):
            return c
    return None


def find_grass_point(coords: Dict[str, Any], grass: str) -> Optional[str]:
    """格子名（作业集里叫 "格子2_2"）-> 坐标表键名。

    真实键名形如：种植物_初始化_格子2_2
    """
    g = str(grass).strip()
    candidates = [
        f"{PREFIX_INIT}{g}",
        g,
        f"{PREFIX_INIT}格子{g}",
        f"格子{g}",
    ]
    # 兼容 "格子2_2" -> "2_2"
    if g.startswith("格子"):
        bare = g[2:]
        candidates += [f"{PREFIX_INIT}格子{bare}", f"{PREFIX_INIT}{bare}", bare]
    for c in candidates:
        if _coord_ok(coords, c):
            return c
    return None


def find_feed_point(coords: Dict[str, Any]) -> Optional[str]:
    """喂豆（能量豆）图标位置。"""
    for c in (f"{PREFIX_INIT}能量豆位置", f"{PREFIX_INIT}喂豆位置", "能量豆位置", "喂豆"):
        if _coord_ok(coords, c):
            return c
    return None


def find_shovel_point(coords: Dict[str, Any]) -> Optional[str]:
    """铲子图标位置。"""
    for c in (f"{PREFIX_INIT}铲子位置", "铲子位置", "铲子"):
        if _coord_ok(coords, c):
            return c
    return None


# ---------------------------------------------------------------------------
# DSL 生成
# ---------------------------------------------------------------------------

def plant_dsl(
    plants: List[Dict[str, Any]],
    slot_names: Dict[str, str],
    coords: Dict[str, Any],
    swipe_ms: int = 80,
    interval: Optional[float] = None,
) -> Dict[str, Any]:
    """把 non_boss.plant / boss.plant 翻成 BatchSwipe 参数。

    返回 {"dsl": "...", "missing": [...], "count": N}
        missing = 缺坐标的项（便于日志排查）
    """
    parts: List[str] = []
    missing: List[str] = []

    for group in plants or []:
        if not isinstance(group, dict):
            continue
        slot = group.get("slot")
        slot_name = ""
        key = card_key_of(slot)
        if key:
            slot_name = slot_names.get(str(slot)) or slot_names.get(key) or ""
        ordinal = ordinal_of(slot)

        src = None
        if ordinal:
            src = find_slot_point(coords, ordinal, slot_name)
        if src is None and slot_name:
            # 没有序数（例如自定义槽）时退化为直接用槽位名
            if _coord_ok(coords, slot_name):
                src = slot_name

        for cell in group.get("cells") or []:
            dst = find_grass_point(coords, str(cell))
            if src is None or dst is None:
                missing.append(f"slot={slot} cell={cell} (src={src}, dst={dst})")
                continue
            parts.append(f"swipe:{src},{dst},{swipe_ms}")

    dsl = ";".join(parts)
    if interval is not None:
        dsl = f"@{interval};{dsl}" if dsl else ""
    return {"dsl": dsl, "missing": missing, "count": len(parts)}


def simple_dsl(
    cells: List[str],
    coords: Dict[str, Any],
    action: str = "click",
    src: Optional[str] = None,
    swipe_ms: int = 80,
    interval: Optional[float] = None,
) -> Dict[str, Any]:
    """喂豆 / 铲子这类「对若干格子做同一动作」的翻译。

    action="click" -> click:格子名
    action="swipe" -> swipe:src,格子名,N  （需要 src）
    """
    parts: List[str] = []
    missing: List[str] = []

    for cell in cells or []:
        dst = find_grass_point(coords, str(cell))
        if dst is None:
            missing.append(f"cell={cell}")
            continue
        if action == "swipe":
            if src is None:
                missing.append(f"cell={cell} (缺 src，无法滑动)")
                continue
            parts.append(f"swipe:{src},{dst},{swipe_ms}")
        else:
            parts.append(f"click:{dst}")

    dsl = ";".join(parts)
    if interval is not None:
        dsl = f"@{interval};{dsl}" if dsl else ""
    return {"dsl": dsl, "missing": missing, "count": len(parts)}


def chain_dsl(
    chain: List[Dict[str, Any]],
    coords: Dict[str, Any],
    swipe_ms: int = 80,
    interval: Optional[float] = None,
) -> Dict[str, Any]:
    """把 once_chain / loop_chain 翻成 BatchSwipe DSL —— **首选路径**。

    chain 每项：{key, slot, type, label, cells:[...]}
    段顺序 = 执行顺序；段内 cells = 该槽落子先后。
    """
    parts: List[str] = []
    missing: List[str] = []

    for seg in chain or []:
        if not isinstance(seg, dict):
            continue
        typ = str(seg.get("type") or "plant").lower()
        slot = seg.get("slot")

        # 决定这一段的「起点」
        src: Optional[str] = None
        if typ == "plant":
            ordinal = ordinal_of(slot)
            src = find_slot_point(coords, ordinal) if ordinal else None
        elif typ == "feed":
            src = find_feed_point(coords)
        elif typ == "shovel":
            src = find_shovel_point(coords)

        for cell in seg.get("cells") or []:
            dst = find_grass_point(coords, str(cell))
            if dst is None:
                missing.append(f"{typ}:{seg.get('label')} cell={cell}（格子无坐标）")
                continue
            if src is None:
                # 找不到起点就退化为点击（至少不丢动作）
                parts.append(f"click:{dst}")
                if typ in ("feed", "shovel"):
                    missing.append(f"{typ}:{seg.get('label')} 无起点坐标，退化为 click")
            else:
                parts.append(f"swipe:{src},{dst},{swipe_ms}")

    dsl = ";".join(parts)
    if interval is not None:
        dsl = f"@{interval};{dsl}" if dsl else ""
    return {"dsl": dsl, "missing": missing, "count": len(parts)}


def rules_dsl(
    rules: Dict[str, Any],
    slot_names: Dict[str, str],
    coords: Dict[str, Any],
    swipe_ms: int = 80,
    interval: Optional[float] = None,
) -> Dict[str, Any]:
    """统一入口：优先用 once_chain / loop_chain，回退 sequence，再回退平铺数组。

    返回 {"once": {...}, "loop": {...}}，各含 dsl / missing / count。
    """
    out: Dict[str, Any] = {}

    once_chain = rules.get("once_chain") or []
    loop_chain = rules.get("loop_chain") or []

    if once_chain or loop_chain:
        out["once"] = chain_dsl(once_chain, coords, swipe_ms, interval)
        out["loop"] = chain_dsl(loop_chain, coords, swipe_ms, interval)
        out["source"] = "chain"
        return out

    # 回退：sequence（旧数据）
    seq = rules.get("sequence") or []
    if seq:
        r = sequence_dsl(seq, slot_names, coords, swipe_ms, interval)
        out["once"] = r
        out["loop"] = {"dsl": "", "missing": [], "count": 0}
        out["source"] = "sequence"
        return out

    # 回退：平铺数组
    r = plant_dsl(rules.get("plant") or [], slot_names, coords, swipe_ms, interval)
    out["once"] = {"dsl": r["dsl"], "missing": r["missing"], "count": r["count"]}
    out["loop"] = {"dsl": "", "missing": [], "count": 0}
    out["source"] = "plant"
    return out


def sequence_dsl(
    sequence: List[Dict[str, Any]],
    slot_names: Dict[str, str],
    coords: Dict[str, Any],
    swipe_ms: int = 80,
    interval: Optional[float] = None,
) -> Dict[str, Any]:
    """用 sequence（网页端的落子顺序）生成完整 DSL —— **推荐的权威路径**。

    sequence 是 [{slot, order, type, label, cell}]，已经含 plant/feed/shovel
    的先后关系，比 plant/feed/shovel 三个平铺数组更精确。
    """
    parts: List[str] = []
    missing: List[str] = []

    # 按 (order, 原始下标) 稳定排序 —— plant 与 feed/shovel 的 order 各自独立编号，
    # 网页端导出的顺序即为落子顺序，这里保持稳定即可。
    for item in sequence or []:
        if not isinstance(item, dict):
            continue
        typ = str(item.get("type") or "plant").lower()
        cell = item.get("cell")
        slot = item.get("slot")
        label = item.get("label") or ""

        dst = find_grass_point(coords, str(cell)) if cell else None
        if dst is None:
            missing.append(f"{typ}:{label} cell={cell}")
            continue

        if typ == "plant":
            ordinal = ordinal_of(slot)
            slot_name = ""
            key = card_key_of(slot)
            if key:
                slot_name = slot_names.get(str(slot)) or slot_names.get(key) or ""
            src = find_slot_point(coords, ordinal, slot_name) if ordinal else None
            if src is None and slot_name and _coord_ok(coords, slot_name):
                src = slot_name
            if src is None:
                missing.append(f"plant:{label} cell={cell}（找不到槽位起点）")
                continue
            parts.append(f"swipe:{src},{dst},{swipe_ms}")
        elif typ == "feed":
            # 喂豆：默认点击格子（若配了能量豆起点则滑动）
            src = find_feed_point(coords)
            if src:
                parts.append(f"swipe:{src},{dst},{swipe_ms}")
            else:
                parts.append(f"click:{dst}")
        elif typ == "shovel":
            src = find_shovel_point(coords)
            if src:
                parts.append(f"swipe:{src},{dst},{swipe_ms}")
            else:
                parts.append(f"click:{dst}")
        else:
            parts.append(f"click:{dst}")

    dsl = ";".join(parts)
    if interval is not None:
        dsl = f"@{interval};{dsl}" if dsl else ""
    return {"dsl": dsl, "missing": missing, "count": len(parts)}
