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


# ---------------------------------------------------------------------------
# 通用动作（不需要格子，直接插在链里）
#
#   wave  点波 —— 点击「下一波」
#   bean  捡豆 —— 5 根手指从「N阳光起始点」滑到「N阳光终点」（时长 100ms）
#   speed 加速 —— 点击「加速」
#   wait  等待 —— 不需要坐标，直接翻成 sleep:秒（毫秒来自网页端输入框）
#   form  切换形态 —— 点击「槽N切换形态」N 次（次数来自网页端输入框）
#
# 坐标键来自 agent/assets/resource/coords.json（顶层，无前缀）。
# ---------------------------------------------------------------------------

# 动作 id -> 点击用的坐标键
GENERIC_CLICK_KEY = {
    "wave": "下一波",
    "speed": "加速",
}

# 切换形态：每个槽位一个按钮（coords.json 顶层键「槽N切换形态」，N=1..8）。
# 点击该按钮即为切换对应槽位植物的形态。
GENERIC_FORM_SLOT_MAX = 8

# 切换次数上限 —— 防止用户误填 999 把整条链拖垮。
GENERIC_FORM_TIMES_MAX = 9999

# ---------------------------------------------------------------------------
# ★★ 可扩展的「按槽位点 N 次」通用动作表
#
#   这一族动作的形态完全一样：选一个槽位 -> 点对应的按钮 -> 点 N 次。
#   新增同类动作（「滑飞弹」「使用神器」等）**只需在这里加一行**，
#   generic_dsl 和网页端都无需改动（网页端在 24-jobset-fields.js 的
#   JOB_MORE_ACTIONS 里加对应定义，params 用同样的 slot/times 键）。
#
#   字段：
#     coord        坐标键模板，{n} 会被替换成槽位号
#     slot_max     槽位上限
#     slot_param   段上表示槽位的字段名（默认 'slot'）
#     times_param  段上表示次数的字段名（默认 'times'）
#     times_max    次数上限（默认 GENERIC_FORM_TIMES_MAX）
#
#   ★ 坐标表里对应的键必须齐全，否则该槽位会被记 missing 并跳过
#     （宁可少点一次，也不点错位置）。
# ---------------------------------------------------------------------------
GENERIC_SLOT_CLICK: Dict[str, Dict[str, Any]] = {
    "form": {
        "coord": "槽{n}切换形态",
        "slot_max": GENERIC_FORM_SLOT_MAX,
        "times_max": GENERIC_FORM_TIMES_MAX,
    },
}

# 捡豆：要滑的 5 条线（起始点键, 终点键）
GENERIC_BEAN_LINES = [
    ("1阳光起始点", "1阳光终点"),
    ("2阳光起始点", "2阳光终点"),
    ("3阳光起始点", "3阳光终点"),
    ("4阳光起始点", "4阳光终点"),
    ("5阳光起始点", "5阳光终点"),
]
GENERIC_BEAN_MS = 100


def _coord_any(coords: Dict[str, Any], name: str) -> Optional[str]:
    """在坐标表里找一个键（先带前缀、再裸名）。"""
    for c in (name, f"{PREFIX_INIT}{name}"):
        if _coord_ok(coords, c):
            return c
    return None


def _as_seconds(ms: Any, fallback: float) -> float:
    """毫秒 -> 秒；非正数/非法值一律回落到 fallback（秒）。"""
    try:
        sec = float(ms) / 1000.0
    except (TypeError, ValueError):
        return fallback
    if not sec > 0:
        return fallback
    return sec


def _clamp_int(value: Any, lo: int, hi: int, fallback: int) -> int:
    """把网页端来的值夹到 [lo, hi]；非法/缺失时用 fallback。"""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, n))


def form_point(coords: Dict[str, Any], slot: Any) -> Optional[str]:
    """槽位号（1..8）-> 「槽N切换形态」坐标键名；越界/缺失返回 None。

    ★ 越界**不夹取**：slot=9 不能悄悄退化成 8 —— 那会点错槽位的按钮。
      越界一律返回 None，由调用方记 missing，宁可不点也不点错。
    """
    try:
        n = int(slot)
    except (TypeError, ValueError):
        return None
    if not 1 <= n <= GENERIC_FORM_SLOT_MAX:
        return None
    return _coord_any(coords, f"槽{n}切换形态")


def _slot_click_point(
    coords: Dict[str, Any],
    spec: Dict[str, Any],
    slot: Any,
) -> Optional[str]:
    """按 GENERIC_SLOT_CLICK 的 spec 求「槽N<后缀>」坐标键名。

    spec["coord"] 里的 {n} 会被替换成槽位号，例如 "槽{n}切换形态"。
    ★ 越界/非法一律返回 None（不夹取）—— 宁可不点，也不点错位置。
    """
    try:
        n = int(slot)
    except (TypeError, ValueError):
        return None
    if not 1 <= n <= spec.get("slot_max", GENERIC_FORM_SLOT_MAX):
        return None
    return _coord_any(coords, spec["coord"].format(n=n))


def rep_parts(part: str, n: int, gap_ms: Any = 0, watch: bool = True) -> List[str]:
    """连击展开：part 重复 n 次；gap_ms>0 时相邻两次之间插 sleep:秒（连击间隔）。

    ★ watch=False（网页端「连击参与识别」取消勾选）-> 用 BatchSwipe 原生
    `动作*n` 后缀：整体只算 1 个动作，中途**不识别**（结算画面也掐不断它），
    且原生连击次间无间隔 —— 此时 gap_ms 不适用（被忽略）。
    """
    n = max(1, int(n or 1))
    if not watch and n >= 2:
        return [f"{part}*{n}"]
    try:
        gap = float(gap_ms or 0)
    except (TypeError, ValueError):
        gap = 0.0
    out: List[str] = []
    for i in range(n):
        if i and gap > 0:
            out.append(f"sleep:{gap / 1000:g}")
        out.append(part)
    return out


def generic_dsl(
    action: str,
    coords: Dict[str, Any],
    ms: Any = None,
    slot: Any = None,
    times: Any = None,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """把一个通用动作翻成 BatchSwipe DSL。

    action: wave / bean / speed / wait / form（也接受作业集里的 'ga:wave' 形式）
    ms:     仅 wait 用 —— 等待的毫秒数（网页端输入框填的值），缺省/非法时用 1000ms
    slot:   仅 form 用 —— 槽位号 1..8（决定点哪个「槽N切换形态」）
    times:  仅 form 用 —— 点击次数，缺省/非法/越界时用 1（上限见 GENERIC_FORM_TIMES_MAX）
    params: ★ 通用参数袋 —— 网页端段上的所有自定义参数（{key: value}）。
            新增「带参数的通用动作」时优先走这里，见下方 GENERIC_SLOT_CLICK。
    返回 {"dsl": str, "missing": [...], "count": int}
    """
    aid = str(action or "").strip()
    if aid.startswith("ga:"):
        aid = aid[3:]

    params = params if isinstance(params, dict) else {}

    # ★ 兼容：老调用点是位置参数 slot/times，把它们并进 params，
    #   这样下面所有分支统一从 params 取值。显式 params 优先。
    merged: Dict[str, Any] = {}
    if slot is not None:
        merged["slot"] = slot
    if times is not None:
        merged["times"] = times
    merged.update(params)

    parts: List[str] = []
    missing: List[str] = []

    # ★★ 通用「按槽位点 N 次」动作 —— 数据驱动，见下方 GENERIC_SLOT_CLICK。
    #    新增同类动作（如「滑飞弹」「使用神器」）只需往那张表里加一行。
    if aid in GENERIC_SLOT_CLICK:
        spec = GENERIC_SLOT_CLICK[aid]
        key = _slot_click_point(coords, spec, merged.get(spec.get("slot_param", "slot")))
        if key is None:
            # 报错里把 {n} 还原成 N，别让用户看到模板占位符
            _label = spec["coord"].replace("{n}", "N")
            missing.append(
                f"{aid}：槽位 {merged.get(spec.get('slot_param', 'slot'))!r} 无效"
                f"或坐标表缺少「{_label}」(N=1..{spec.get('slot_max', 8)})"
            )
        else:
            n = _clamp_int(
                merged.get(spec.get("times_param", "times")),
                1,
                spec.get("times_max", GENERIC_FORM_TIMES_MAX),
                1,
            )
            # ★ 连击间隔 comboMs（默认 0 = 紧挨着连做）；comboWatch=false = 原子连击（不识别）
            gap = _clamp_int(merged.get("comboMs"), 0, 10000, 0)
            watch = merged.get("comboWatch", True) is not False
            parts.extend(rep_parts(f"click:{key}", n, gap, watch))

    elif aid in GENERIC_CLICK_KEY:
        key = _coord_any(coords, GENERIC_CLICK_KEY[aid])
        if key is None:
            missing.append(f"{aid}：坐标表缺少「{GENERIC_CLICK_KEY[aid]}」")
        else:
            # ★ 连击：网页端 ⚙ 弹窗调的 times（点一下 = 连点 N 次）
            n = _clamp_int(merged.get("times"), 1, GENERIC_FORM_TIMES_MAX, 1)
            gap = _clamp_int(merged.get("comboMs"), 0, 10000, 0)
            watch = merged.get("comboWatch", True) is not False
            parts.extend(rep_parts(f"click:{key}", n, gap, watch))

    elif aid == "custom":
        # ★ 自定义动作（网页端「更多 -> 自定义动作」）：段上带 act/from/to/ms/pairs
        #   act=click  点击坐标 from
        #   act=swipe  从 from 滑到 to，时长 ms
        #   act=hold   长按：from 滑到自身，时长 ms（= 长按时间）
        #   act=multi  多指：pairs=[[from,to],...]（2~5 组），同时按下/移动/抬起
        #   键名必须是坐标表里的**原名**（用户从坐标表挑的），不做前缀猜测。
        act = str(merged.get("act") or "").strip()
        ms_v = _clamp_int(merged.get("ms"), 50, 600000, 600)
        # ★ 连击：所有自定义动作通用（点/滑/长按/多指 连做 N 次）
        n = _clamp_int(merged.get("times"), 1, GENERIC_FORM_TIMES_MAX, 1)
        # ★ 连击间隔 comboMs（默认 0 = 紧挨着连做；>0 时相邻两次间插 sleep）
        gap = _clamp_int(merged.get("comboMs"), 0, 10000, 0)
        watch = merged.get("comboWatch", True) is not False

        def _need(name: str) -> Optional[str]:
            k = str(merged.get(name) or "").strip()
            if not _coord_ok(coords, k):
                missing.append(f"自定义动作：坐标表缺少「{k or name}」")
                return None
            return k

        if act == "click":
            k = _need("from")
            if k:
                parts.extend(rep_parts(f"click:{k}", n, gap, watch))
        elif act == "swipe":
            a, b = _need("from"), _need("to")
            if a and b:
                parts.extend(rep_parts(f"swipe:{a},{b},{ms_v}", n, gap, watch))
        elif act == "hold":
            k = _need("from")
            if k:
                parts.extend(rep_parts(f"swipe:{k},{k},{ms_v}", n, gap, watch))
        elif act == "multi":
            raw_pairs = merged.get("pairs")
            if not isinstance(raw_pairs, list):
                raw_pairs = []
            lines = []
            for pr in raw_pairs[:5]:
                if not isinstance(pr, (list, tuple)) or len(pr) < 2:
                    continue
                pa = str(pr[0] or "").strip()
                pb = str(pr[1] or "").strip()
                if not _coord_ok(coords, pa) or not _coord_ok(coords, pb):
                    missing.append(f"自定义多指：坐标表缺少「{pa or '?'} / {pb or '?'}」")
                    continue
                lines.append(f"{pa},{pb},{ms_v}")
            if len(lines) >= 2:
                parts.extend(rep_parts("multi:(" + ";".join(lines) + ")", n, gap, watch))
            elif not missing:
                missing.append("自定义多指：至少需要 2 组有效坐标对")
        else:
            missing.append(f"未知自定义动作类型：{act!r}")

    elif aid == "artifact":
        # ★ 使用神器（独立链路）：插入时网页端把神器快照进段
        #   （artName/artType/artBody），这里按快照翻坐标。
        #   click   -> 点「神器_初始化_神器位置」
        #   hold    -> 长按神器位置（swipe 到自身，1s）
        #   special -> 葫芦：点神器位置 -> 点「神器_初始化_葫芦X体型」（不等弹窗）
        #   swipe   -> 暂未支持（需要目标格子，等需求再定）
        pos = _coord_any(coords, "神器_初始化_神器位置")
        if pos is None:
            missing.append("artifact：坐标表缺少「神器_初始化_神器位置」")
        else:
            atype = str(merged.get("artType") or "click").strip()
            aname = str(merged.get("artName") or "神器")
            n = _clamp_int(merged.get("times"), 1, GENERIC_FORM_TIMES_MAX, 1)
            gap = _clamp_int(merged.get("comboMs"), 0, 10000, 0)
            watch = merged.get("comboWatch", True) is not False
            if atype == "special":
                body_cn = {"small": "小", "mid": "中", "big": "大"}.get(
                    str(merged.get("artBody") or "mid"), "中")
                bk = _coord_any(coords, f"神器_初始化_葫芦{body_cn}体型")
                if bk is None:
                    missing.append(
                        f"artifact：坐标表缺少「神器_初始化_葫芦{body_cn}体型」")
                else:
                    # 一次使用 = 2 步（点神器 -> 点体型，中间不等 —— 用户实测不需要等弹窗）；
                    # ★ 多段组合塞不进原生 `动作*n`，所以连击只能展开重复
                    #   （watch=False 对 special 无效，仅记日志语义）。
                    for i in range(n):
                        if i and gap > 0:
                            parts.append(f"sleep:{gap / 1000:g}")
                        parts.extend([f"click:{pos}", f"click:{bk}"])
            elif atype == "hold":
                parts.extend(rep_parts(f"swipe:{pos},{pos},1000", n, gap, watch))
            elif atype == "swipe":
                missing.append(f"artifact：滑动类神器「{aname}」暂未支持（需要目标格子）")
            else:
                parts.extend(rep_parts(f"click:{pos}", n, gap, watch))

    elif aid == "wait":
        # ★ 等待：不需要坐标，直接翻成 sleep:秒（BatchSwipe 原生支持小数秒）
        #   网页端填的是毫秒（默认 1000），这里换算成秒 —— 1ms 精度会保留。
        sec = _as_seconds(ms, 1.0)
        parts.append(f"sleep:{sec:g}")

    elif aid == "bean":
        lines: List[str] = []
        for a, b in GENERIC_BEAN_LINES:
            ka = _coord_any(coords, a)
            kb = _coord_any(coords, b)
            if ka is None or kb is None:
                miss = a if ka is None else b
                missing.append(f"bean：坐标表缺少「{miss}」")
                continue
            lines.append(f"{ka},{kb},{GENERIC_BEAN_MS}")
        if lines:
            # multi:(...)：原生 MultiSwipe，5 指同时按下/移动/抬起
            parts.append("multi:(" + ";".join(lines) + ")")

    else:
        missing.append(f"未知通用动作：{action}")

    dsl = ";".join(parts)
    return {"dsl": dsl, "missing": missing, "count": len(parts)}


def find_shovel_point(coords: Dict[str, Any]) -> Optional[str]:
    """铲子图标位置。"""
    for c in (f"{PREFIX_INIT}铲子位置", "铲子位置", "铲子"):
        if _coord_ok(coords, c):
            return c
    return None


def find_artifact_point(coords: Dict[str, Any]) -> Optional[str]:
    """神器图标位置（拖拽类神器滑动的起点，如魔豆神器）。
    注意前缀是「神器_初始化_」不是 PREFIX_INIT（种植物_初始化_）。"""
    for c in ("神器_初始化_神器位置", "神器位置"):
        if _coord_ok(coords, c):
            return c
    return None

