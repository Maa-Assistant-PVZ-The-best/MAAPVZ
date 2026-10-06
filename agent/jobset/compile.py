"""作业集 -> pipeline override 的**纯函数编译器**（无 maa 依赖）。

★ 这是「保存时预编译」与「运行时现编译」共用的唯一编译入口：

  - pvz.py（网页端保存接口）：存盘前给每张表编译出 compiled.normal / compiled.boss
    -> 作业集文件里直接带「成品 override 字典」，运行时零翻译。
  - runtime.py（JobSetFight）：作业集没有 compiled 块（旧格式）时的回退路径。

  两边跑同一份代码、同一份输入 -> 同一份输出，保证双轨一致。

为什么编译器放这里而不是 HTML 的 JS：
  DSL 语法（swipe/click/sleep/every/ref/@间隔）的规则都在 Python 的 dsl.py 里，
  移植到 JS 必然漂移。pvz.py 本来就是 Python，保存时顺手编译即可，
  「HTML 一次编译好」= 存进文件的 JSON 一次到位，不要求在浏览器里算。
"""

from typing import Any, Callable, Dict, List, Optional, Tuple

from . import dsl as _dsl
from .engine import JobSet

# ---------------------------------------------------------------------------
# 节点名常量（与 pipeline 文件一一对应）
# ---------------------------------------------------------------------------

# 三条链的组合动作节点（0301Endless_fight_1.json）
CHAIN_NODE_TPL = "无尽挑战_组合动作_{kind}"
KIND_CN = {"once": "单次", "loop": "循环", "end": "收尾"}

# 组合动作里的 ref 触发节点（识别命中即停本批、跟随 next）
REF_SETTLE = "无尽局内_继续挑战"      # 结算画面（正赛）
REF_LAST_WAVE = "无尽挑战_收尾"       # 最后一波（僵尸头像）-> 跳收尾链
REF_TRAIN = "无尽训练_继续训练"       # 结算画面（训练模式）
REF_FAILED = "无尽挑战_失败"          # 战斗失败画面（pipe 节点由用户自己接线）

# 链首节点（JobSetStage 的 next 落点 / 收尾链回跳落点）
NODE_ONCE_ENTRY = "无尽局内_单次种植"
NODE_LOOP_ENTRY = "无尽局内_循环种植"
NODE_END_DETECT = "无尽挑战_收尾"
NODE_END_RESTART = "无尽挑战_收尾重开"
NODE_LOOP_CHAIN = CHAIN_NODE_TPL.format(kind=KIND_CN["loop"])

# ★ 循环链为空时注入的空动作：节点仍在，靠 next 自循环等结算。
#   sleep 稍长避免空转时疯狂刷屏。
EMPTY_LOOP_DSL = "sleep:5"

# 槽位 key -> 节点里的中文序数（白名单校验用）
_SLOT_NODE_NAME = {
    "card1": "一槽", "card2": "二槽", "card3": "三槽", "card4": "四槽",
    "card5": "五槽", "card6": "六槽", "card7": "七槽", "card8": "八槽",
    "shovel": "铲子", "feed": "喂豆",
}

LogFn = Callable[[str], None]


def _noop(_msg: str) -> None:
    pass


# ---------------------------------------------------------------------------
# 三条链 -> 三个组合动作节点
# ---------------------------------------------------------------------------

def build_chain_nodes(
    rules: Dict[str, Any],
    coords: Dict[str, Any],
    swipe_ms: int,
    interval: Any,
    every_n: int = 10,
    has_end: bool = False,
    log: LogFn = _noop,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """三条链各生成**一个**节点（整条链拼成一条 DSL）。

    返回 {"once": {"node": 节点名, "kind": "once", "dsl": "..."} 或 None,
          "loop": ..., "end": ...}
    链为空时对应项为 None（不生成节点）。

    ★ 为什么整条链一个节点（而不是旧做法的「每段一个节点」）：
      旧做法节点数随链长膨胀（20+），每段跑完都要回「继续挑战」识别一次。
      现在整条链一次跑完，中途靠 every:N 定期识别结算，
      命中即停本批、跟随 next —— 既省节点又不容易乱点。
    """
    out: Dict[str, Optional[Dict[str, Any]]] = {"once": None, "loop": None, "end": None}

    for kind, field in (
        ("once", "once_chain"),
        ("loop", "loop_chain"),
        ("end", "end_chain"),
    ):
        chain = rules.get(field) or []
        parts: List[str] = []

        # ★ 无间隔组「」：连续 noint=true 的段，其动作合成一个「a;b;c」块，
        #   BatchSwipe 内部不加间隔连发。缓冲到遇到普通段（或链尾）时 flush。
        noint_buf: List[str] = []

        def _flush_noint() -> None:
            if noint_buf:
                parts.append("「" + ";".join(noint_buf) + "」")
                noint_buf.clear()

        def _emit(seg: Dict[str, Any], seg_parts: List[str]) -> None:
            if seg.get("noint"):
                noint_buf.extend(seg_parts)
            else:
                _flush_noint()
                parts.extend(seg_parts)

        for seg in chain:
            key = str(seg.get("key") or "").strip()
            typ = str(seg.get("type") or "plant").lower()

            # ---- 通用动作段（点波/捡豆/加速/等待/切换形态/自定义）：没有格子，整段 = 一条 DSL ----
            if typ == "action" or key.startswith("ga:"):
                r = _dsl.generic_dsl(
                    seg.get("action") or key,
                    coords,
                    seg.get("ms"),
                    seg.get("slot"),
                    seg.get("times"),
                    seg,          # ★ 整个段都当参数袋 —— 新动作免改这里
                )
                if r["dsl"]:
                    _emit(seg, [p for p in r["dsl"].split(";") if p.strip()])
                for m in r["missing"]:
                    log(f"  ⚠️ 通用动作跳过：{m}")
                continue

            # ★ 只对**植物槽**做白名单校验。
            #   落子动作（feed/shovel/tapcell/未来扩展）不在 _SLOT_NODE_NAME 里，
            #   一刀切 continue 会把它们**静默丢弃** ——
            #   表现为「网页端配了、跑起来没执行」，非常难查。
            #   现在：植物槽必须有名（否则是真错误），其余交给下面的
            #   通用起点逻辑处理（找不到起点 -> 编译成 click:格子）。
            _is_plant_slot = key.startswith("card") or key.startswith("patch_slot")
            if _is_plant_slot and key not in _SLOT_NODE_NAME:
                log(f"  ⚠️ 未知植物槽 {key!r}，跳过")
                continue

            # 决定这一段每株的起点
            src = None
            if typ == "plant":
                ordinal = _dsl.ordinal_of(seg.get("slot"))
                src = _dsl.find_slot_point(coords, ordinal) if ordinal else None
            elif typ == "feed":
                src = _dsl.find_feed_point(coords)
            elif typ == "shovel":
                src = _dsl.find_shovel_point(coords)
            # ★ typ == "tap"（点击格子）：**故意不设起点** —— 落到下面的
            #   `src is None` 分支，编译成 click:格子N_M。这正是要的语义。
            # ★ feed/shovel 本该有起点；缺起点会静默退化成「点击格子」
            #   （点格子不拖豆子 = 什么都没做），必须告警。
            if src is None and typ in ("feed", "shovel"):
                log(f"  ⚠️ {typ}:{seg.get('label') or key} 无起点坐标，退化为 click")

            # 该段每个落点的「动作后等待」秒数（与 cells 等长，来自 waitAfter）
            waits = seg.get("waits") or []

            for i, cell in enumerate(seg.get("cells") or []):
                dst = _dsl.find_grass_point(coords, str(cell))
                if dst is None:
                    continue
                seg_parts: List[str] = []
                # ★ 连击：所有动作通用（点击/滑动都 ×N = 连做 N 次）
                n_rep = _num(seg.get("times"), 1)
                n_rep = min(9999, max(1, n_rep))
                # ★ 连击间隔 comboMs（默认 0 = 紧挨着；>0 时相邻两次间插 sleep）
                gap_rep = _num(seg.get("comboMs"), 0)
                gap_rep = min(10000, max(0, gap_rep))
                if src is None:
                    seg_parts.extend(_dsl.rep_parts(f"click:{dst}", n_rep, gap_rep))
                else:
                    seg_parts.extend(_dsl.rep_parts(f"swipe:{src},{dst},{swipe_ms}", n_rep, gap_rep))
                # 等待：这个动作之后插入 sleep:N（BatchSwipe 支持 sleep:秒）
                try:
                    sec = float(waits[i]) if i < len(waits) else 0.0
                except (TypeError, ValueError):
                    sec = 0.0
                if sec > 0:
                    seg_parts.append(f"sleep:{sec:g}")
                _emit(seg, seg_parts)

        _flush_noint()   # 链尾：把末尾的无间隔组收进「」
        body = ";".join(parts)
        if not body:
            continue
        # ★ 识别触发（放在动作之前，是「触发条件」不是动作）：
        #   ref:无尽局内_继续挑战  —— 结算画面出现 -> 停本批、跟随 next
        #   ref:无尽挑战_收尾      —— 检测到最后一波 -> 停本批，next 里会跳收尾链
        #   ref:无尽挑战_失败      —— 战斗失败画面 -> 停本批，next 里跳失败处理
        #   ref:无尽训练_继续训练  —— 训练模式的结算按钮（正赛下识别不到，无害）
        #
        #   这几个 ref 复用 pipe 节点里已定义的识别配置，无需写 ROI。
        #   收尾链自己**不加**「收尾」触发（它已经在收尾链里了，避免自跳）。
        refs: List[str] = [REF_SETTLE]
        if kind != "end" and has_end:
            refs.append(REF_LAST_WAVE)
        refs.append(REF_FAILED)
        refs.append(REF_TRAIN)
        body = "ref:" + "|".join(refs) + ";" + body

        # ★ every:N —— 每 N 个动作识别一遍「有无结算」（识别结算速率）
        if every_n and every_n > 1:
            body = f"every:{every_n};{body}"
        if interval not in (None, ""):
            body = f"@{interval};{body}"

        out[kind] = {
            "node": CHAIN_NODE_TPL.format(kind=KIND_CN[kind]),
            "kind": kind,
            "dsl": body,
        }

    return out


# ---------------------------------------------------------------------------
# 一张表 × 一个变体 -> 完整 override 字典
# ---------------------------------------------------------------------------

def _num(v: Any, default: int) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def build_fight_override(
    table: Any,
    is_boss: bool,
    coords: Dict[str, Any],
    every_n: int,
    swipe_ms: int = 80,
    interval: Any = None,
    log: LogFn = _noop,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """把一张表（普通关或 boss 关）的种植配置编译成**完整的 override 字典**。

    返回 (override, chain_nodes)：
        chain_nodes 为 None 表示走了「boss 关未配置」短路
        （此时 override 只有 3 个节点：两个链首都指去等结算）。

    这就是「粒度 B」的 compiled 变体：节点名 -> 要覆盖的字段，
    runtime 拿到直接 override_pipeline()，零翻译。
    """
    rules = table.rules(is_boss)

    # ★ boss 关未配置（作业集里没有 bossSlotOrder/bossLoopOrder）时：
    #   不做任何种植，直接**等结算** —— 只保留「继续挑战」的识别与点击。
    #   这符合用户要求：「如果没有 Boss 字段的话，就直接等待结算」。
    if is_boss:
        has_boss_cfg = bool(
            table.raw.get("bossSlotOrder")
            or table.raw.get("bossLoopOrder")
            or rules.get("once_chain")
            or rules.get("loop_chain")
        )
        if not has_boss_cfg:
            log("★ boss 关未配置种植链 -> 不种植，直接等结算（只保留继续挑战识别）")
            return ({
                NODE_ONCE_ENTRY: {
                    "action": "Custom",
                    "custom_action": "JobSetFight",
                    "custom_action_param": {},
                    "pre_delay": 0,
                    "post_delay": 0,
                    # 空 next 链 -> 交给管道去识别「继续挑战」等结算
                    "next": [REF_SETTLE],
                },
                NODE_LOOP_ENTRY: {
                    "action": "Custom",
                    "custom_action": "JobSetFight",
                    "custom_action_param": {},
                    "pre_delay": 0,
                    "post_delay": 0,
                    "next": [REF_SETTLE],
                },
                NODE_END_DETECT: {"enabled": False},
            }, None)

    if every_n < 1:
        every_n = 10

    # 收尾链是否存在（决定组合动作里要不要挂「最后一波」触发）
    # ★ boss 关不能有收尾：boss 关一律不跑收尾链（用户要求）。
    _end_chain = rules.get("end_chain") or []
    has_end = bool(_end_chain) and not is_boss

    chain_nodes = build_chain_nodes(
        rules, coords, swipe_ms, interval, every_n, has_end, log=log)

    once_node = chain_nodes.get("once")
    loop_node = chain_nodes.get("loop")
    end_node = chain_nodes.get("end")

    # ★ boss 关不能有收尾：boss 关一律不跑收尾链（用户要求）。
    if is_boss:
        end_node = None

    # ★ 收尾链的可调参数（网页端「棋盘下侧」编辑，作业集导出）：
    #   · 「收尾类型」     = detect（识别僵尸头像，默认）/ loops（循环链重复次数）
    #   · 「收尾前等待」   = 「无尽挑战_收尾」检测节点的 post_delay（默认 15000ms，仅 detect）
    #   · 「循环链重复次数」= 仅 loops：循环链跑满 N 次后直接进收尾链（期间不识别收尾）
    #   · 「收尾超时后动作」= sub（执行子动作）/ restart（重开）/ settle（等待结算）
    #   · 「等待结算时长」 = 仅 settle：结算识别节点的 timeout（超时识别不到 = 任务结束）
    #   · 「子动作」       = once（单次动作）/ loop（循环动作）/ end（收尾动作）
    #   （endLastPostDelay 已删除：post_delay 做不到边等边识别，等待结算改用 timeout）
    end_type = str(table.raw.get("endType") or "detect").strip()
    if end_type not in ("detect", "loops"):
        end_type = "detect"
    end_post_delay = _num(table.raw.get("endPostDelay"), 15000)
    end_loop_count = int(min(999, max(1, _num(table.raw.get("endLoopCount"), 3))))
    end_after_action = str(table.raw.get("endAfterAction") or "sub").strip()
    end_settle_ms = _num(table.raw.get("endSettleMs"), 15000)
    end_sub_action = str(table.raw.get("endSubAction") or "loop").strip()
    if end_sub_action not in ("once", "loop", "end"):
        end_sub_action = "loop"
    # ★ loops 模式：循环链自循环改走「循环种植入口」（JobSetFight 在里面数次数），
    #   且不再挂收尾检测；detect 模式维持原样（自循环 + 挂收尾检测）。
    loops_gate = (end_type == "loops") and bool(has_end) and not is_boss

    override: Dict[str, Any] = {}

    # ---- 1) 三个组合动作节点 ----
    #
    # next 结构（顺序 = 优先级，命中第一个就走第一个）：
    #     ["无尽局内_继续挑战",   <- 结算出现了就点它（放第一位，命中即走）
    #      "无尽挑战_收尾",       <- 没结算但检测到最后一波 -> 跳收尾链
    #      "无尽挑战_失败",       <- 战斗失败画面 -> 跳失败处理（pipe 用户自接）
    #      <跑完这条链之后去哪>]  <- 没结算也没到最后一波 -> 继续下一环
    #
    #   单次链 -> 无尽局内_循环种植
    #   循环链 -> 自己（自循环）
    #   收尾链 -> 「收尾超时后动作」（sub/restart），没有收尾检测位
    if once_node:
        nxt = [REF_SETTLE]
        if has_end and not loops_gate:
            nxt.append(NODE_END_DETECT)
        nxt.append(REF_FAILED)
        nxt.append(NODE_LOOP_ENTRY)
        override[once_node["node"]] = {
            "action": "Custom",
            "custom_action": "BatchSwipe",
            "custom_action_param": once_node["dsl"],
            "pre_delay": 0,
            "post_delay": 0,
            "next": nxt,
        }

    if loop_node:
        nxt = [REF_SETTLE]
        if has_end and not loops_gate:
            nxt.append(NODE_END_DETECT)
        nxt.append(REF_FAILED)
        # ★ loops 收尾：自循环改走循环入口（JobSetFight 数次数，数够 N 掰向收尾链）；
        #   detect 收尾：直接自循环（省一道工序）。
        nxt.append(NODE_LOOP_ENTRY if loops_gate else loop_node["node"])
        override[loop_node["node"]] = {
            "action": "Custom",
            "custom_action": "BatchSwipe",
            "custom_action_param": loop_node["dsl"],
            "pre_delay": 0,
            "post_delay": 0,
            "next": nxt,
        }
    else:
        # ★ 循环链为空：节点仍然存在，只是 DSL 是一个空动作（sleep:5）
        #   靠 next 自循环等待结算/收尾。
        nxt = [REF_SETTLE]
        if has_end and not loops_gate:
            nxt.append(NODE_END_DETECT)
        nxt.append(REF_FAILED)
        # loops 收尾同样改走循环入口（空循环也要数次数）
        nxt.append(NODE_LOOP_ENTRY if loops_gate else NODE_LOOP_CHAIN)
        override[NODE_LOOP_CHAIN] = {
            "action": "Custom",
            "custom_action": "BatchSwipe",
            "custom_action_param": EMPTY_LOOP_DSL,
            "pre_delay": 0,
            "post_delay": 0,
            "next": nxt,
        }

    if end_node:
        # 收尾链跑完之后的去向：
        #   · settle（等待结算）：next 只挂结算/失败两个识别，结算节点 timeout = 等待时长，
        #     边等边识别；超时识别不到 -> 无 on_error -> 任务结束（网页端已告知用户）。
        #   · 其余（sub/restart）：detect 模式挂结算识别 + 收尾超时后动作；
        #     loops 模式按用户设定**不再识别**，直接走收尾超时后动作。
        if end_after_action == "restart":
            after = [NODE_END_RESTART]
        elif end_sub_action == "once":
            after = [NODE_ONCE_ENTRY]
        elif end_sub_action == "end":
            after = [NODE_END_DETECT]
        else:
            after = [NODE_LOOP_ENTRY]
        if end_after_action == "settle":
            end_next = [REF_SETTLE, REF_FAILED]
            # ★ 只覆写 timeout 一个字段（next 等沿用 pipe/任务选项，别整体替换 ——
            #   训练模式的「继续训练」接线就是任务选项覆写的，顶掉就完了）。
            override[REF_SETTLE] = {"timeout": int(end_settle_ms)}
            override[REF_TRAIN] = {"timeout": int(end_settle_ms)}
        elif loops_gate:
            end_next = [REF_FAILED] + after
        else:
            end_next = [REF_SETTLE, REF_FAILED] + after
        override[end_node["node"]] = {
            "action": "Custom",
            "custom_action": "BatchSwipe",
            "custom_action_param": end_node["dsl"],
            "pre_delay": 0,
            "post_delay": 0,
            "next": end_next,
        }

    # ---- 2) 链首节点：各自指向自己的那条链 ----
    once_next = [once_node["node"]] if once_node else [NODE_LOOP_ENTRY]
    # ★ 循环链为空也要进 —— 上面的 override 已经把它写成了
    #   「sleep:5 空动作 + 自循环等待结算」，所以这里永远指向它。
    #   以前是 loop_node 为 None 就给空 next -> 链断 -> Task.Failed
    #   （表现为「一到循环种植就停了」）。
    loop_next = [NODE_LOOP_CHAIN]

    override[NODE_ONCE_ENTRY] = {
        "action": "Custom",
        "custom_action": "JobSetFight",
        "custom_action_param": {},          # 空 -> 由 state 决定
        "pre_delay": 0,
        "post_delay": 0,
        "next": once_next,
    }
    override[NODE_LOOP_ENTRY] = {
        "action": "Custom",
        "custom_action": "JobSetFight",
        "custom_action_param": {},          # 空 -> 由 state 决定
        "pre_delay": 0,
        "post_delay": 0,
        "next": loop_next,
    }

    # ---- 3) 收尾检测节点：检测到最后一波 -> 执行收尾链 -> 等结算 ----
    #
    # 「无尽挑战_收尾」是 TemplateMatch 识别（僵尸头像出现在右上角 = 最后一波）。
    #   · 配了收尾链（棋盘上有「收尾」形态的落子）-> enabled=True，next 指向收尾链第一段；
    #   · 没配 -> enabled=False（保持 pipeline 里的空壳，不参与）。
    # post_delay 由网页端「棋盘下侧」编辑（默认 15000ms）。
    #
    # override_pipeline 是深合并：这里只改 enabled / next / post_delay，
    # 识别配置（recognition=TemplateMatch / template / roi / green_mask）
    # 沿用 pipeline 里 03-1-01 写死的值。
    if has_end and not loops_gate:
        override[NODE_END_DETECT] = {
            "enabled": True,
            "post_delay": end_post_delay,
            "next": [end_node["node"]],
        }
    else:
        # ★ loops 收尾：不识别僵尸头像（检测节点关停，改由循环计数门进收尾）
        override[NODE_END_DETECT] = {"enabled": False}

    # ---- 4) 收尾重开节点：**已 pipe 化，运行时只管 enabled** ----
    #
    # 「无尽挑战_收尾重开」现在是一个纯 pipe 节点（03-1-01）：
    #     next   = ["通用_重开_暂停"]
    #     anchor = {"下一个动作": "无尽挑战_识别开始战斗_清空卡牌"}
    # 重开完靠 [Anchor]下一个动作 回到锚点直接开局。
    #
    # 壳节点在 pipeline 里是 enabled=false（避免没配收尾链时参与识别），
    # 只有作业集选了「重开」且配了收尾链时才启用。
    if has_end and end_after_action == "restart":
        override[NODE_END_RESTART] = {"enabled": True}
    else:
        override[NODE_END_RESTART] = {"enabled": False}

    return override, chain_nodes


# ---------------------------------------------------------------------------
# 整份作业集 -> 带 compiled 块的 JSON（pvz.py 保存接口用）
# ---------------------------------------------------------------------------

def compile_jobset(raw: Dict[str, Any], log: LogFn = _noop) -> Dict[str, Any]:
    """给整份作业集 JSON 补上 compiled 块 + format:2。返回**新** dict（不改原对象）。

    每张表编译两个变体：
        compiled.normal = 普通关的 override 字典
        compiled.boss   = boss 关的 override 字典（未配置时是短路形态）

    everyN 读作业集顶层（HTML 导出位置）；历史上 runtime 误读表级字段
    （table.raw["everyN"] 恒为 None -> 恒为 10），编译时按顶层来。
    """
    import copy
    import json as _json

    coords = _dsl.load_coords()
    if not coords:
        log("⚠️ 坐标表为空（agent/assets/resource/coords.json 未找到），编译会跳过所有落点")

    js = JobSet(raw, code=str(raw.get("code") or ""))
    every_n = _num(raw.get("everyN"), 10)
    # ★ 调配参数（步骤块 ⚙ 弹窗里调）：默认滑动毫秒数 / 动作间隔秒数。
    #   swipeMs 空 -> 80；actionInterval 空 -> 不加 @前缀（BatchSwipe 用自己的默认间隔）。
    swipe_ms = _num(raw.get("swipeMs"), 80)
    interval = raw.get("actionInterval")
    if interval in (None, ""):
        interval = None
    else:
        try:
            interval = float(interval)
        except (TypeError, ValueError):
            interval = None

    out = copy.deepcopy(raw)
    out["format"] = 2

    for i, t in enumerate(js.tables):
        compiled = {}
        for variant, is_boss in (("normal", False), ("boss", True)):
            ov, _chains = build_fight_override(
                t, is_boss, coords, every_n,
                swipe_ms=swipe_ms, interval=interval, log=log)
            compiled[variant] = ov
        out["tables"][i]["compiled"] = compiled

        # 日志里摘要一下，方便保存时肉眼核对
        for variant in ("normal", "boss"):
            ov = compiled[variant]
            kinds = []
            for node, body in ov.items():
                d = body.get("custom_action_param")
                if isinstance(d, str):
                    kinds.append(f"{node}({len([x for x in d.split(';') if x.strip()])}动作)")
            log(f"  表{t.index + 1} [{variant}] {len(ov)} 节点: "
                + (", ".join(kinds) if kinds else "(无动作节点)"))

    # 确保 JSON 可序列化（compile 产物全是 dict/list/str/int/bool，这里只是兜底）
    _json.dumps(out, ensure_ascii=False)
    return out
