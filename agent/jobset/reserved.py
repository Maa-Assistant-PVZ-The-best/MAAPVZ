# -*- coding: utf-8 -*-
"""作业集「预留接口」—— **只放接口，不放实现**（agent 侧镜像）。

对应网页端 ``game_assist_tools/endless_setup/static/js/16-jobset-reserved.js``，
两边**同名同 id**，`selfcheck.py` 第 22 节会拿真实 JS 文件做漂移比对。

为什么要有这个文件
------------------
2026-11-01 用户需求：作业集后续还能适配的选项（开局前动作 / 选卡标收藏 /
选卡自由阶数 / 植物主动技能 / 智能切换形态 / 世界作业链 / 正赛检查）
**先把接口留出来，功能以后再开发**。

2026-11-02 追加两项（同样只留接口）：
  · **特殊表** —— 满足触发条件（重开累计次数 / 失败累计次数）后改用另一张
    阵容表；用一次就回原表（``use='once'``）。
  · **局内两个开关** —— 战斗中切换「自动点波」「僵尸场外加速」（id 带 ``In``
    后缀，别和开局前那两个撞）。

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
        # ★ 2026-11-02 曾试做过一版（agent 侧把总毫秒注入「开始战斗」的 pre_delay，
        #   不碰任何 next、与神器闸门零冲突，门禁能过），但用户决定**先不要**，
        #   已整体撤回。将来实现的两条路子见 HANDOFF §10.10-B 第 1 行。
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
    # ★ 2026-11-02 追加（用户要求「局内切换自动点波和僵尸场外加速也要改，都预留一下」）：
    #   开局前（PREBATTLE_ACTIONS）已有同名开关，但那是开战前拨一次；
    #   这两个是**局内（战斗中）随时拨**，id 一律加 `In` 后缀，避免和开局前撞 id。
    #   ⚠️ 未验证：局内的「自动点波」与开局前的 refreshWave 是不是同一个游戏开关；
    #      「僵尸场外加速」局内局外是不是同一处 —— 实测确认后再决定是否合并 id。
    "autoWaveIn": {
        "name": "局内切换自动点波",
        "kind": "genericAction",
        "implemented": False,
        "desc": "战斗中切换「自动点波」开关"
                "（与开局前的「自动刷新下一波」是否同一开关：未验证）",
        "extra_params": {"on": {"type": "switch", "def": 1}},
    },
    "zombieSpeedIn": {
        "name": "局内切换僵尸场外加速",
        "kind": "genericAction",
        "implemented": False,
        "desc": "战斗中切换「僵尸场外加速」"
                "（与开局前的同名开关是否同一处：未验证）",
        "extra_params": {"on": {"type": "switch", "def": 1}},
    },
}

# 预留的**落子动作**类型（compile.build_chain_nodes 见到它只告警、不编译）
RESERVED_SEG_TYPES: Dict[str, str] = {
    "skill": "植物主动技能（预留：从槽位拖到格子）",
}

# 预留的**通用动作** id（dsl.generic_dsl 见到它只返回「预留未实现」）
#   ★ 「僵尸场外加速 / 自动刷新下一波」在链上出现时按通用动作处理，
#     但它们的真实形态是开局前开关（见 PREBATTLE_ACTIONS），这里留个名字兜底。
#   ★ `…In` 是 2026-11-02 追加的**局内**版本（战斗中拨开关），同样只报「预留」。
RESERVED_GENERIC_ACTIONS: Dict[str, str] = {
    "skill": "植物主动技能（预留）",
    "spawn": "刷僵尸（预留）",
    "zombieSpeed": "切换僵尸场外加速（预留）",
    "refreshWave": "自动刷新下一波（预留）",
    "autoWaveIn": "局内切换自动点波（预留）",
    "zombieSpeedIn": "局内切换僵尸场外加速（预留）",
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
# 五、★ 特殊表（作业集级）：满足触发条件后改用另一张阵容表
# ---------------------------------------------------------------------------
#   字段：jobset.special_tables =
#       {"enable": bool,
#        "triggers": {"restart": 3, "fail": 0},   # 0 = 该条件不参与
#        "table": 2,                              # 目标表序号（1 起，0 = 没选）
#        "side": "both",                          # both | normal | boss
#        "use": "once"}                           # once（打一次就回原表）| sticky
#
#   ★ 当前**只登记两个触发条件**（用户 2026-11-02 定：「目前只能加这俩」）：
#       restart = 重开累计次数 / fail = 失败累计次数
#     其余候选（关卡区间 / 世界 / 正赛 / 已用时 / 已换表次数…）不登记，
#     要的时候往 SPECIAL_TRIGGERS 加一行 —— 数据形状不用改。
#
#   ★ 判定语义（现在**一行都不执行**）：
#       · enable=False 或 table=0     -> 不生效（与旧作业集一字不差）
#       · triggers 里多个 > 0         -> **全部满足（AND）**才算命中
#       · use='once' 的「已用过」状态只放运行时内存（不写文件），
#         新任务 / JobSetReset 时清空。
#
#   ★ 未来实现时的两个挂钩点：① 在重开（JobSetEndRestart / JobSetStage 的
#     通用重开节点）与失败（pipe 的 `无尽挑战_失败`）处各埋一次计数 ——
#     现在代码里没有任何重开/失败计数器；② 命中后改 `_STATE["table_index"]`
#     走下一次选卡，别动 pipe。
SPECIAL_TRIGGERS: Dict[str, Dict[str, Any]] = {
    "restart": {
        "name": "重开累计次数",
        "implemented": False,
        "desc": "重开（收尾超时重开 / 换阵容重开）累计达到 N 次后启用特殊表",
        "unit": "次", "def": 3, "min": 1, "max": 9999,
    },
    "fail": {
        "name": "失败累计次数",
        "implemented": False,
        "desc": "判定为失败（走「无尽挑战_失败」分支）累计达到 N 次后启用特殊表",
        "unit": "次", "def": 1, "min": 1, "max": 9999,
    },
}

# 特殊表的 use 取值（once = 用一次就回原表 / sticky = 一直用）
SPECIAL_USES = ("once", "sticky")


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

    实现提示（2026-11-02 试做过 wait 的 pre_delay 版本，用户决定先不要，已撤回）：
      · ``wait``  -> 两条路任选：
          a) 注入「开始战斗」节点的 ``pre_delay``（不碰 next、与神器闸门零冲突，
             只能表达「开战前等 N 毫秒」，我们试过的是这条）
          b) 按 §10.10-E 在选卡终点与开始战斗之间插一条链，段里放 sleep
             （spawn / zombieSpeed / refreshWave 必须走 b，届时 wait 一起搬）
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


def _trigger_value(spec: Dict[str, Any], raw: Any) -> int:
    """把一个触发阈值夹到注册表声明的 min..max；<=0 / 非法 -> 0（= 不参与）。"""
    n = _as_int(raw, 0) or 0
    if n <= 0:
        return 0
    lo = spec.get("min", 1)
    hi = spec.get("max", 9999)
    return max(lo, min(hi, n))


def parse_special_tables(raw: Any) -> Dict[str, Any]:
    """``special_tables`` -> 归一化后的特殊表设置（缺省 = 未启用）。

    ★ 形状固定：``{"enable", "triggers", "table", "side", "use"}``；
      ``triggers`` 只保留 ``SPECIAL_TRIGGERS`` 里登记过的 id（手写 JSON 塞的
      未知条件一律丢 —— 否则将来实现时会拿一个没人认识的条件去判定）。
    """
    out: Dict[str, Any] = {
        "enable": False,
        "triggers": {aid: 0 for aid in SPECIAL_TRIGGERS},
        "table": 0,
        "side": "both",
        "use": "once",
    }
    if not isinstance(raw, dict):
        return out
    out["enable"] = raw.get("enable") is True
    trg = raw.get("triggers")
    if isinstance(trg, dict):
        for aid, spec in SPECIAL_TRIGGERS.items():
            out["triggers"][aid] = _trigger_value(spec, trg.get(aid))
    table = _as_int(raw.get("table"), 0) or 0
    out["table"] = table if table >= 1 else 0            # 0 = 没选
    out["side"] = norm_side(raw.get("side"))
    use = str(raw.get("use") or "once").strip()
    out["use"] = use if use in SPECIAL_USES else "once"
    return out


def special_tables_armed(cfg: Any) -> bool:
    """这份配置「算不算真配了东西」：启用 + 选了表 + 至少一个触发阈值 > 0。"""
    if not isinstance(cfg, dict) or cfg.get("enable") is not True:
        return False
    table = _as_int(cfg.get("table"), 0) or 0
    if table < 1:
        return False
    trg = cfg.get("triggers") or {}
    if not isinstance(trg, dict):
        return False
    return any((_as_int(trg.get(aid), 0) or 0) > 0 for aid in SPECIAL_TRIGGERS)


def special_table_decide(cfg: Any, counters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """★ 预留判定入口 —— **现在恒「不换表」**。

    返回 ``{"table": 0, "missing": [...], "counters": {...}}``；
    ``table = 0`` 表示不动表指针。将来实现时把这里换成真正的条件求值
    （读 ``counters`` + 作业集当前表指针），返回命中的目标表序号。
    """
    if not special_tables_armed(cfg):
        return {"table": 0, "missing": [], "counters": dict(counters or {})}
    return {
        "table": 0,
        "missing": ["特殊表：接口已预留，当前版本未实现（不会换表）"],
        "counters": dict(counters or {}),
    }


def special_tables_summary(cfg: Any) -> str:
    """一行摘要（日志/报告用），如「重开≥3次 → 表2（打一次就回原表）」。"""
    if not special_tables_armed(cfg):
        return ""
    trg = cfg.get("triggers") or {}
    parts: List[str] = []
    for aid, spec in SPECIAL_TRIGGERS.items():
        v = _trigger_value(spec, trg.get(aid))
        if v > 0:
            nm = str(spec.get("name") or aid).replace("累计次数", "")
            parts.append(f"{nm}≥{v}次")
    tail = "一直用" if cfg.get("use") == "sticky" else "打一次就回原表"
    return " 且 ".join(parts) + f" → 表{cfg.get('table')}（{tail}）"


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
    """作业集级的预留项提示（世界作业链 / 正赛检查 / 特殊表）。"""
    lines: List[str] = []
    wc = getattr(jobset, "world_chains", None) or {}
    if wc.get("enable") and wc.get("items"):
        lines.append(f"⏳ 世界作业链（{len(wc['items'])} 条）：接口已预留，"
                     f"当前版本未实现（不会替换阵容）")
    mc = getattr(jobset, "mode_check", None) or {}
    if mc.get("enable"):
        lines.append("⏳ 正赛模式检查：接口已预留，当前版本未实现（不会检查模式）")
    st = getattr(jobset, "special_tables", None) or {}
    if special_tables_armed(st):
        lines.append(f"⏳ 特殊表（{special_tables_summary(st)}）：接口已预留，"
                     f"当前版本未实现（不会换表）")
    return lines


def catalog() -> List[Dict[str, Any]]:
    """全部预留项（文档 / 自测用；顺序固定，方便比对）。"""
    out: List[Dict[str, Any]] = []
    for group, table in (
        ("preBattle", PREBATTLE_ACTIONS),
        ("pick", PICK_FEATURES),
        ("inBattle", INBATTLE_RESERVED),
        ("outer", OUTER_RESERVED),
        ("specialTable", SPECIAL_TRIGGERS),
    ):
        for aid, spec in table.items():
            item = {"group": group, "id": aid}
            item.update(spec)
            out.append(item)
    return out
