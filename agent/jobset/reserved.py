# -*- coding: utf-8 -*-
"""作业集「预留接口」—— **只放接口，不放实现**（agent 侧镜像）。

对应网页端 ``game_assist_tools/endless_setup/static/js/16-jobset-reserved.js``，
两边**同名同 id**，`selfcheck.py` 第 22 节会拿真实 JS 文件做漂移比对。

为什么要有这个文件
------------------
2026-11-01 用户需求：作业集后续还能适配的选项（开局前动作 / 选卡标收藏 /
选卡自由阶数 / 植物主动技能 / 智能切换形态 / 世界作业链 / 正赛检查）
**先把接口留出来，功能以后再开发**。

所以这里的每一张表都是「形状 + 缺省值 + 归一化 + 一个恒返回空结果的编译入口」，
没有任何一处会真的去点屏幕。将来实现时按下面的步骤做，**不要改形状**：

    1. 把对应条目的 ``implemented`` 改成 ``True``；
    2. 补编译（``pre_battle_dsl`` 的 wait 分支之类）或补注入
       （``runtime.py`` 里 ``_reserved_notice`` 换成真正的 ``override_pipeline``）；
    3. ``selfcheck.py`` 第 22 节把「恒空」断言换成真实编译断言。

⚠️ 铁律：**预留字段一律「缺省不改变行为」**——旧作业集没有这些键，解析结果必须
   与没有这个模块时一字不差（``selfcheck`` 有断言盯着）。
"""

from typing import Any, Dict, List, Optional

# 预留接口版本号（字段形状变了就 +1；网页端导出 reserved_version 同值）
RESERVED_VERSION = 1

# 关别取值：both = 普通关 + boss 关都执行
RESERVED_SIDES = ("both", "normal", "boss")


# ---------------------------------------------------------------------------
# 一、开局前额外动作（选完植物和神器 -> 开始战斗之前）
# ---------------------------------------------------------------------------
#   字段：t.pre_battle = [{"id": "wait", "side": "both", "ms": 3000}, ...]
#
#   ★ 未来唯一的挂钩点（位置见 runtime.py：_inject_pre_battle 的 docstring）：
#       `选取植物.next` / `无尽_选择编队.next` / `关闭神器界面.next`
#       从 ``[开始战斗]`` 改指到「开场前动作链」，链尾 next = ``[开始战斗]``。
#       与神器闸门同一个位置，所以必须和 ``_inject_artifact`` 合起来算 next，
#       不能各自 override（§10.5「字段分工」）。
PREBATTLE_ACTIONS: Dict[str, Dict[str, Any]] = {
    "wait": {
        "name": "等待",
        "implemented": False,
        "desc": "开始战斗前先等指定时长（毫秒）",
        "params": {"ms": {"type": "int", "def": 3000, "min": 0, "max": 600000}},
    },
    "spawn": {
        "name": "刷僵尸",
        "implemented": False,
        "desc": "开局前刷一波僵尸（技术力未到，接口预留；坐标与手法待实测）",
        "params": {"times": {"type": "int", "def": 1, "min": 1, "max": 99}},
    },
    "zombieSpeed": {
        "name": "切换僵尸场外加速",
        "implemented": False,
        "desc": "开局前打开/关闭「僵尸场外加速」（开关坐标待拆包）",
        "params": {"on": {"type": "switch", "def": 1}},
    },
    "refreshWave": {
        "name": "自动刷新下一波",
        "implemented": False,
        "desc": "开局前打开/关闭「自动刷新下一波」（开关坐标待拆包）",
        "params": {"on": {"type": "switch", "def": 1}},
    },
}


# ---------------------------------------------------------------------------
# 二、选卡相关
# ---------------------------------------------------------------------------
#   favorite -> t.pick_favorite（布尔）；落点 = SelectPlants 的 custom_action_param
#   tiers    -> t.pick_tiers（{卡片号: 0..5}，0 = 不指定）；落点 = 选卡前的阶数界面
PICK_FEATURES: Dict[str, Dict[str, Any]] = {
    "favorite": {
        "name": "选卡同时标收藏",
        "implemented": False,
        "desc": "选卡时顺手把用到的植物标成收藏（加快下次选卡）",
        "export_key": "pick_favorite",
    },
    "tiers": {
        "name": "选卡时自由切换阶数",
        "implemented": False,
        "desc": "按槽位指定阶数（0 = 不指定），开局前逐槽切到指定阶数",
        "export_key": "pick_tiers",
    },
}


# ---------------------------------------------------------------------------
# 三、局内相关
# ---------------------------------------------------------------------------
INBATTLE_RESERVED: Dict[str, Dict[str, Any]] = {
    "skill": {
        "name": "植物主动技能",
        "kind": "boardAction",
        "implemented": False,
        "desc": "从「槽N切换形态」位置拖到格子（触发主动技能）",
        # 段字段（不是 params 系统）：拖拽起点按槽位取坐标
        "seg_fields": {"slot": {"type": "int", "def": 1, "min": 1, "max": 8}},
    },
    "formSmart": {
        "name": "切换形态·智能",
        "kind": "genericAction",
        "implemented": False,
        "desc": "切换形态先选植物、再选点几下（扩展 ga:form，段上多 plant 字段）",
        "extra_params": {"plant": {"type": "plant", "def": ""}},
    },
}

# 预留的**落子动作**类型（compile.build_chain_nodes 见到它只告警、不编译）
RESERVED_SEG_TYPES: Dict[str, str] = {
    "skill": "植物主动技能（预留：从槽位拖到格子）",
}

# 预留的**通用动作** id（dsl.generic_dsl 见到它只返回「预留未实现」）
#   ★ 「僵尸场外加速 / 自动刷新下一波」在链上出现时按通用动作处理，
#     但它们的真实形态是开局前开关（见 PREBATTLE_ACTIONS），这里留个名字兜底。
RESERVED_GENERIC_ACTIONS: Dict[str, str] = {
    "skill": "植物主动技能（预留）",
    "spawn": "刷僵尸（预留）",
    "zombieSpeed": "切换僵尸场外加速（预留）",
    "refreshWave": "自动刷新下一波（预留）",
}


# ---------------------------------------------------------------------------
# 四、局外相关（作业集级）
# ---------------------------------------------------------------------------
OUTER_RESERVED: Dict[str, Dict[str, Any]] = {
    "worldChains": {
        "name": "世界作业链",
        "implemented": False,
        "export_key": "world_chains",
        "desc": "每个世界一套阵容替换方案；运行时识别当前世界后套用",
    },
    "modeCheck": {
        "name": "正赛模式检查",
        "implemented": False,
        "export_key": "mode_check",
        "desc": "开局前检查当前是不是正赛；不是则按 on_missing 告警/中止",
    },
}

MODE_CHECK_EXPECT = ("ranked", "training", "any")
MODE_CHECK_ON_MISSING = ("warn", "abort")


# ---------------------------------------------------------------------------
# 归一化 / 解析（一律「缺省不改变行为」）
# ---------------------------------------------------------------------------

def norm_side(v: Any) -> str:
    """关别归一化：非法/缺省 -> 'both'。"""
    s = str(v or "").strip()
    return s if s in RESERVED_SIDES else "both"


def _as_int(v: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def parse_pre_battle(raw: Any) -> List[Dict[str, Any]]:
    """把网页端导出的 pre_battle 规范成 ``[{id, side, <该动作声明过的参数>}]``。

    ★ 只收 ``PREBATTLE_ACTIONS`` 里认得出来的 id（未知 id 直接丢，
      免得手写 JSON 塞垃圾进、运行时又猜不出该做什么）；
      只收该动作 ``params`` 里声明过的键（其余字段一律不搬）。
    """
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, (list, tuple)):
        return out
    for it in raw:
        if not isinstance(it, dict):
            continue
        aid = str(it.get("id") or "").strip()
        spec = PREBATTLE_ACTIONS.get(aid)
        if not spec:
            continue
        item: Dict[str, Any] = {"id": aid, "side": norm_side(it.get("side"))}
        for key, pspec in (spec.get("params") or {}).items():
            if it.get(key) is None or it.get(key) == "":
                continue
            if pspec.get("type") == "int":
                n = _as_int(it.get(key), None)
                if n is None:
                    continue
                lo = pspec.get("min")
                hi = pspec.get("max")
                if lo is not None:
                    n = max(lo, n)
                if hi is not None:
                    n = min(hi, n)
                item[key] = n
            else:
                item[key] = it.get(key)
        out.append(item)
    return out


def pre_battle_applies(item: Dict[str, Any], is_boss: bool) -> bool:
    """该项在这一关别下要不要执行（现在只有数据层判定，没有消费者）。"""
    side = norm_side((item or {}).get("side"))
    if side == "both":
        return True
    return side == ("boss" if is_boss else "normal")


def pre_battle_for(items: Any, is_boss: bool) -> List[Dict[str, Any]]:
    """某一关别下真正会跑的那些项（顺序 = 用户排列顺序）。"""
    return [it for it in (items or []) if pre_battle_applies(it, is_boss)]


def pre_battle_dsl(item: Dict[str, Any], coords: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """★ 预留编译入口 —— **现在恒返回空**。

    返回形状与 ``dsl.generic_dsl`` 完全一致（``{"dsl", "missing", "count"}``），
    所以将来接编译时调用方一行都不用改。

    实现提示：
      · ``wait``  -> ``f"sleep:{ms / 1000:g}"``（BatchSwipe 原生支持小数秒）
      · ``spawn`` / ``zombieSpeed`` / ``refreshWave``
        -> 先在 ``coords.json`` 里加开关坐标键，再翻成 ``click:键名``；
           认不到坐标时**必须记 missing 跳过**（宁可不动，也不点错位置）。
    """
    aid = str((item or {}).get("id") or "").strip()
    spec = PREBATTLE_ACTIONS.get(aid)
    if not spec:
        return {"dsl": "", "missing": [f"未知开局前动作：{aid!r}"], "count": 0}
    return {
        "dsl": "",
        "missing": [f"{spec['name']}：接口已预留，当前版本未实现"],
        "count": 0,
    }


def parse_pick_tiers(raw: Any) -> Dict[int, int]:
    """``pick_tiers`` -> ``{槽位号: 阶数}``；0 / 越界 / 非法一律丢掉（= 不指定）。"""
    out: Dict[int, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        slot = _as_int(k, None)
        tier = _as_int(v, None)
        if slot is None or not 1 <= slot <= 8:
            continue
        if tier is None or not 1 <= tier <= 5:
            continue
        out[slot] = tier
    return out


def parse_world_chains(raw: Any) -> Dict[str, Any]:
    """``world_chains`` -> ``{"enable": bool, "items": [{world, table, side, …}]}``。

    ★ 未启用 / 缺失 -> ``{"enable": False, "items": []}``（= 行为不变）。
    """
    out: Dict[str, Any] = {"enable": False, "items": []}
    if not isinstance(raw, dict):
        return out
    out["enable"] = raw.get("enable") is True
    items = raw.get("items")
    if not isinstance(items, (list, tuple)):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        world = str(it.get("world") or "").strip()
        if not world:
            continue
        squad = _as_int(it.get("squad"), None)
        out["items"].append({
            "world": world,
            "table": _as_int(it.get("table"), 0) or 0,     # 0 = 全部表
            "side": norm_side(it.get("side")),
            "slots": dict(it.get("slots") or {}) if isinstance(it.get("slots"), dict) else {},
            "lineup": [str(x) for x in (it.get("lineup") or [])
                       if isinstance(x, str) and x],
            "squad": squad if (squad is not None and 1 <= squad <= 6) else None,
            "artifact": it.get("artifact"),
        })
    return out


def parse_mode_check(raw: Any) -> Dict[str, Any]:
    """``mode_check`` -> ``{"enable", "expect", "on_missing"}``（缺省 = 未启用）。"""
    out = {"enable": False, "expect": "ranked", "on_missing": "warn"}
    if not isinstance(raw, dict):
        return out
    out["enable"] = raw.get("enable") is True
    ex = str(raw.get("expect") or "ranked").strip()
    out["expect"] = ex if ex in MODE_CHECK_EXPECT else "ranked"
    om = str(raw.get("on_missing") or raw.get("onMissing") or "warn").strip()
    out["on_missing"] = om if om in MODE_CHECK_ON_MISSING else "warn"
    return out


# ---------------------------------------------------------------------------
# 只读摘要（运行时告警 / 报告 / 自测用）
# ---------------------------------------------------------------------------

def reserved_notice_lines(table: Any, is_boss: bool) -> List[str]:
    """这张表里配了、但当前版本不会执行的预留项 —— 一行一条提示。

    ★ 只吐「用户真的配了东西」的项，没配就返回空列表（不制造噪音）。
      行首统一带 ⏳，方便 grep；文案里一定写清「未实现」，
      免得用户以为配好了却没生效是 bug。
    """
    lines: List[str] = []
    for it in pre_battle_for(getattr(table, "pre_battle", []) or [], is_boss):
        spec = PREBATTLE_ACTIONS.get(it.get("id")) or {}
        lines.append(f"⏳ 开局前动作「{spec.get('name', it.get('id'))}」接口已预留，"
                     f"当前版本未实现（不会执行）")
    if getattr(table, "pick_favorite", False):
        lines.append("⏳ 选卡标收藏：接口已预留，当前版本未实现（不会执行）")
    tiers = getattr(table, "pick_tiers", None) or {}
    if tiers:
        lines.append(f"⏳ 选卡自由阶数（{len(tiers)} 槽）：接口已预留，当前版本未实现（不会执行）")
    return lines


def jobset_notice_lines(jobset: Any) -> List[str]:
    """作业集级的预留项提示（世界作业链 / 正赛检查）。"""
    lines: List[str] = []
    wc = getattr(jobset, "world_chains", None) or {}
    if wc.get("enable") and wc.get("items"):
        lines.append(f"⏳ 世界作业链（{len(wc['items'])} 条）：接口已预留，"
                     f"当前版本未实现（不会替换阵容）")
    mc = getattr(jobset, "mode_check", None) or {}
    if mc.get("enable"):
        lines.append("⏳ 正赛模式检查：接口已预留，当前版本未实现（不会检查模式）")
    return lines


def catalog() -> List[Dict[str, Any]]:
    """全部预留项（文档 / 自测用；顺序固定，方便比对）。"""
    out: List[Dict[str, Any]] = []
    for group, table in (
        ("preBattle", PREBATTLE_ACTIONS),
        ("pick", PICK_FEATURES),
        ("inBattle", INBATTLE_RESERVED),
        ("outer", OUTER_RESERVED),
    ):
        for aid, spec in table.items():
            item = {"group": group, "id": aid}
            item.update(spec)
            out.append(item)
    return out
