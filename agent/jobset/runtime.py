# -*- coding: utf-8 -*-
"""作业集运行时 —— 与 MaaFramework 的胶水层（CustomAction 注册）。

注册的动作
----------
JobSetLoad   载入作业集、初始化关卡计数器，把「当前阵容」暴露给后续节点。
             挂在空壳节点「无尽挑战_加载作业集代码」上。
JobSetLevel  喂入一次 OCR 原始天数 -> 输出融合后的可信关卡号。
             挂在天数识别之后。
JobSetSlot   输出当前关该用的种植规则（non_boss / boss），供种植节点消费。
JobSetInfo   只读查询当前状态（调试用，不产生副作用）。
JobSetReset  显式重置计数器（重新开始任务时）。

与 pipeline 的对接方式：本模块**不修改任何 pipeline JSON**，
需要的信息通过 CustomAction 的返回值 / 日志传递；
需要「覆盖」的节点由 pipeline 侧用 JobSetLoad 输出的 param 驱动。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction
from maa.custom_recognition import CustomRecognition

from .engine import JobSet, JobSetError, load_jobset
from .level_tracker import LevelTracker, from_params
from . import dsl as _dsl

# ---------------------------------------------------------------------------
# 进程级单例状态
#
# MAA 的 CustomAction 是每次执行新实例化的，所以状态必须放在模块级。
# 生命周期与 Agent 进程一致；每次「重新开始任务」由 JobSetReset / task 变化重置。
# ---------------------------------------------------------------------------

_STATE: Dict[str, Any] = {
    "jobset": None,        # JobSet
    "tracker": LevelTracker,
    "table_index": None,   # 当前活动表序号（换阵容时变化）
    "error": None,
}


def _log(msg: str) -> None:
    print(f"[JobSet] {msg}", file=sys.stderr, flush=True)


def _parse_param(raw: Any) -> Dict[str, Any]:
    """宽松解析 custom_action_param（可能是 dict / JSON 串 / 空）。"""
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return {}
        # MAA 有时会把 JSON 串再包一层引号
        if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
            s = s[1:-1]
        try:
            data = json.loads(s)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            _log(f"参数不是合法 JSON，已忽略：{raw!r}")
            return {}
    return {}


def _ensure_tracker(param: Dict[str, Any]) -> LevelTracker:
    """取得/初始化本进程的计数器。"""
    tr = _STATE.get("tracker")
    if tr is None:
        tr = from_params(param)
        _STATE["tracker"] = tr
        _log("计数器已初始化")
    return tr


def _ok() -> CustomAction.RunResult:
    """统一成功返回。

    MAA 的 CustomAction.RunResult 只有 success 字段；
    需要向下游传值时走 context.override_pipeline（见 JobSetLoad）。
    """
    return CustomAction.RunResult(success=True)


def _fail() -> CustomAction.RunResult:
    return CustomAction.RunResult(success=False)


# ---------------------------------------------------------------------------
# JobSetLoad —— 挂在「无尽挑战_加载作业集代码」
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetLoad")
class JobSetLoad(CustomAction):
    """载入作业集 + 初始化关卡计数器。

    custom_action_param（全部可选）：
        {
          "作业集代码": "pvz_20260926_015808",   // 缺省读 jobs/current.json
          "起始关卡": 1,                          // 已知起点（中途进入时用）
          "初始分": 50, "封顶分": 100,            // 计数器调参（见 level_tracker）
          "加分": 20, "扣分": 10, "容差": 2,
          "重置": true                            // 重新开始任务 -> 清空计数器
        }

    失败（作业集不存在/未选择）时返回 success=False，
    让 pipeline 走它的失败分支，而不是静默用错配置。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))

        # ---- 重置（重新开始任务） ----
        if param.get("重置"):
            _STATE["jobset"] = None
            _STATE["tracker"] = None
            _STATE["table_index"] = None
            _log("已重置作业集状态（重新开始任务）")

        # ---- 载入作业集 ----
        code = str(param.get("作业集代码") or "").strip()
        try:
            js = load_jobset(code or None)
        except JobSetError as e:
            _STATE["error"] = str(e)
            _log(f"载入失败：{e}")
            return _fail()
        except Exception as e:  # pragma: no cover
            _STATE["error"] = str(e)
            _log(f"载入异常：{type(e).__name__}: {e}")
            return _fail()

        _STATE["jobset"] = js
        _STATE["error"] = None
        _log(f"已载入作业集「{js.name}」 code={js.code} 表数={len(js.tables)}")
        for t in js.tables:
            rng = f"{t.from_level}~{t.to_level if t.to_level is not None else '末'}"
            _log(f"  表{t.index + 1} 关卡{rng} 植物={t.plants}")

        # ---- 计数器 ----
        tr = from_params(param)
        start = param.get("起始关卡")
        if start not in (None, ""):
            try:
                first = tr.observe(int(start))
                _log(f"起始关卡={first}（由参数给定）")
            except (TypeError, ValueError):
                _log(f"起始关卡参数非法，忽略：{start!r}")
        _STATE["tracker"] = tr

        # ---- 当前阵容 ----
        lv = tr.count if tr.count > 0 else (param.get("起始关卡") or 1)
        try:
            lv = int(lv)
        except (TypeError, ValueError):
            lv = 1
        table = js.pick_table(lv)
        _STATE["table_index"] = table.index
        _log(
            f"当前关卡={lv} -> 表{table.index + 1} "
            f"(关卡{table.from_level}~{table.to_level if table.to_level is not None else '末'}) "
            f"选卡植物={table.plants}"
        )

        # 把选卡植物暴露给下游（SelectPlants 节点消费）
        try:
            context.override_pipeline({
                "无尽挑战_选取植物": {
                    "custom_action_param": json.dumps(
                        {"植物列表": table.plants}, ensure_ascii=False
                    )
                }
            })
            _log(f"已注入选卡参数：{table.plants}")
        except Exception as e:
            # override 失败不该致命：日志留痕，继续走
            _log(f"注入选卡参数失败（{type(e).__name__}: {e}），下游可能拿到空参数")

        return _ok()


# ---------------------------------------------------------------------------
# JobSetLevel —— 天数识别之后
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetLevel")
class JobSetLevel(CustomAction):
    """喂入一次 OCR 原始天数，更新计数器。

    两种用法：
      1) 参数直接给数：  {"原始天数": 57}
      2) 参数给识别节点名：{"识别节点": "frame_wj_custom_识别天数"}
         -> 引擎自己跑一次识别拿原始值（需要 MaaFw 支持 run_recognition_direct）

    OCR 没认出来（识别失败）时传 {"原始天数": null} 或直接不传，
    计数器会按「+1 推进」处理。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        tr = _ensure_tracker(param)

        raw: Optional[int] = None
        has_raw = "原始天数" in param
        if has_raw:
            v = param.get("原始天数")
            if v not in (None, ""):
                try:
                    raw = int(float(v))
                except (TypeError, ValueError):
                    _log(f"原始天数非法，按未识别处理：{v!r}")
                    raw = None
        else:
            node = param.get("识别节点")
            if node:
                raw = self._recognize(context, str(node), param)

        before = tr.count
        level = tr.observe(raw)
        _log(f"识别={raw} -> {tr.describe()}（{before} -> {level}）")

        # 换阵容检测：跨过锚点则更新活动表并重新注入选卡
        self._maybe_switch(context, tr, level)
        return _ok()

    # -- 内部 --------------------------------------------------------------

    def _recognize(self, context: Context, node: str, param: Dict[str, Any]) -> Optional[int]:
        """用 run_recognition_direct 跑一次天数 OCR。"""
        try:
            from maa.pipeline import JRecognitionType, JOCR
        except Exception:
            _log("当前 MaaFw 不支持 run_recognition_direct，无法按节点识别")
            return None
        if not hasattr(context, "run_recognition_direct"):
            _log("context 没有 run_recognition_direct，无法按节点识别")
            return None

        roi = param.get("识别roi") or [555, 61, 414, 81]   # 旧版实测区域
        replace = param.get("替换") or [["g", "9"], ["G", "6"]]
        try:
            detail = context.run_recognition_direct(
                JRecognitionType.OCR,
                JOCR(only_rec=True, roi=list(roi), replace=replace),
            )
            text = self._extract_text(detail)
        except Exception as e:
            _log(f"识别异常（{type(e).__name__}: {e}）")
            return None

        if not text:
            _log(f"节点 {node} 未识别到文字")
            return None
        digits = "".join(ch for ch in str(text) if ch.isdigit())
        if not digits:
            _log(f"识别结果无数字：{text!r}")
            return None
        try:
            return int(digits)
        except ValueError:
            return None

    @staticmethod
    def _extract_text(detail: Any) -> str:
        for attr in ("best_result", "text", "detail"):
            v = getattr(detail, attr, None)
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, dict):
                for k in ("text", "best_result"):
                    if isinstance(v.get(k), str):
                        return v[k].strip()
        return ""

    @staticmethod
    def _maybe_switch(context: Context, tr: LevelTracker, level: int) -> None:
        """关卡跨过阵容锚点时，切换活动表并重新注入选卡参数。"""
        js: Optional[JobSet] = _STATE.get("jobset")
        if js is None:
            return
        table = js.pick_table(level)
        prev = _STATE.get("table_index")
        if prev == table.index:
            return

        _STATE["table_index"] = table.index
        _log(
            f"★ 换阵容：关卡 {level} 跨入表{table.index + 1}"
            f"（关卡{table.from_level}起）-> 植物 {table.plants}"
        )
        try:
            context.override_pipeline({
                "无尽挑战_选取植物": {
                    "custom_action_param": json.dumps(
                        {"植物列表": table.plants}, ensure_ascii=False
                    )
                }
            })
            _log("已注入新阵容的选卡参数")
        except Exception as e:
            _log(f"注入选卡参数失败：{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# JobSetSlot —— 输出当前关该用的种植规则
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetSlot")
class JobSetSlot(CustomAction):
    """按「当前关卡 + 是否 boss 关」取出该用的种植规则。

    参数：
        {"是boss关": true}       // boss 判定由 pipeline 侧完成（见下）
        {"关卡": 55}             // 可选，不给就用计数器当前值

    boss 判定：**本引擎不判断 boss**。pipeline 侧用
        「无尽通用框架_识别boss关_开始阶段」（09_Frame_Endless_boss.json，
         模板 僵王的头 / 功夫僵王，ROI [169,8,335,69]）
    判定后把结果作为参数传进来即可。

    规则以 JSON 形式打印到日志，并 redirect 到 pipeline 变量供下游消费。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        if js is None:
            _log("尚未载入作业集（JobSetLoad 未执行）")
            return _fail()

        tr = _ensure_tracker(param)
        lv = param.get("关卡")
        if lv in (None, ""):
            lv = tr.count if tr.count > 0 else 1
        try:
            lv = int(lv)
        except (TypeError, ValueError):
            lv = 1

        is_boss = bool(param.get("是boss关"))

        table = js.pick_table(lv)
        rules = table.rules(is_boss)
        kind = "boss" if is_boss else "普通关"

        _log(
            f"关卡{lv} {kind} -> 表{table.index + 1} "
            f"| 种植{len(rules['plant'])}组 喂豆{len(rules['feed'])} "
            f"铲子{len(rules['shovel'])} 顺序{len(rules['sequence'])} 点波={rules['wave']}"
        )
        return _ok()


# ---------------------------------------------------------------------------
# 辅助动作
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetInfo")
class JobSetInfo(CustomAction):
    """只读查询当前状态（调试用）。"""

    def run(self, context: Context, argv) -> Any:
        js: Optional[JobSet] = _STATE.get("jobset")
        tr: Optional[LevelTracker] = _STATE.get("tracker")
        if js is None:
            _log(f"作业集：未载入（{_STATE.get('error') or '无错误信息'}）")
        else:
            _log(f"作业集：「{js.name}」 code={js.code} 表数={len(js.tables)}")
        if tr is not None:
            _log(f"计数器：{tr.describe()}")
            _log(f"快照：{json.dumps(tr.snapshot(), ensure_ascii=False)}")
        return _ok()


@AgentServer.custom_action("JobSetReset")
class JobSetReset(CustomAction):
    """显式重置计数器（保留已载入的作业集）。"""

    def run(self, context: Context, argv) -> Any:
        tr: Optional[LevelTracker] = _STATE.get("tracker")
        if tr is not None:
            tr.reset()
            _STATE["table_index"] = None
            _log("计数器已重置")
        else:
            _log("计数器尚未初始化，无需重置")
        return _ok()


# ---------------------------------------------------------------------------
# JobSetFight —— 局内种植：把当前表的链翻成 DSL 注入组合动作节点
# ---------------------------------------------------------------------------

# 组合动作节点名模板（03_Endless_fight/）
FIGHT_NODE_TPL = "无尽挑战_{slot}组合动作_{kind}"
KIND_CN = {"once": "单次", "loop": "循环"}

# 槽位 key -> 节点里的中文序数
_SLOT_NODE_NAME = {
    "card1": "一槽", "card2": "二槽", "card3": "三槽", "card4": "四槽",
    "card5": "五槽", "card6": "六槽", "card7": "七槽", "card8": "八槽",
    "shovel": "铲子", "feed": "喂豆",
}


@AgentServer.custom_action("JobSetFight")
class JobSetFight(CustomAction):
    """把当前阵容的「单次链 / 循环链」翻成 BatchSwipe DSL 并注入组合动作节点。

    参数：
        {"是boss关": false}      # boss 判定由 pipeline 侧完成并传入
        {"关卡": 55}             # 可选，缺省用计数器当前值
        {"间隔": 0.1}            # 可选，动作间隔（BatchSwipe 的 @N 前缀）
        {"滑动时长": 80}         # 可选，swipe 的 duration

    注入方式：每个槽位/铲子/喂豆都有「单次」和「循环」两个节点，
    本动作把它们各自的 custom_action_param 写成对应段落的 DSL。
    节点为空（该槽在这条链里没落子）时写成空串，BatchSwipe 会直接跳过。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        if js is None:
            _log("尚未载入作业集（JobSetLoad 未执行）")
            return _fail()

        tr = _ensure_tracker(param)
        lv = param.get("关卡")
        if lv in (None, ""):
            lv = tr.count if tr.count > 0 else 1
        try:
            lv = int(lv)
        except (TypeError, ValueError):
            lv = 1

        is_boss = bool(param.get("是boss关"))
        swipe_ms = int(param.get("滑动时长") or 80)
        interval = param.get("间隔")

        table = js.pick_table(lv)
        prev_index = _STATE.get("table_index")
        rules = table.rules(is_boss)
        kind_cn = "BOSS关" if is_boss else "普通关"

        if prev_index != table.index:
            _log(
                f"★ 阵容切换：表{prev_index + 1 if prev_index is not None else '?'} "
                f"-> 表{table.index + 1}（关卡 {table.from_level} 起，植物 {table.plants}）"
            )
            # 推进表指针 —— 这是**唯一**推进它的地方（JobSetStageChanged 无副作用）。
            # 同时重新注入选卡参数，保证新阵容真的被选上。
            _STATE["table_index"] = table.index
            try:
                context.override_pipeline({
                    "无尽挑战_选取植物": {
                        "custom_action_param": json.dumps(
                            {"植物列表": table.plants}, ensure_ascii=False
                        )
                    }
                })
                _log(f"已重新注入选卡植物：{table.plants}")
            except Exception as e:
                _log(f"重新注入选卡失败（{type(e).__name__}: {e}）")

        _log(
            f"关卡{lv} {kind_cn} -> 表{table.index + 1} "
            f"| once_chain={len(rules['once_chain'])}段 "
            f"loop_chain={len(rules['loop_chain'])}段"
        )

        coords = _dsl.load_coords()
        if not coords:
            _log("坐标表为空（agent/assets/resource/coords.json 未找到）")

        # 按槽位聚合：把整条链拆成「每个槽位各自的动作串」
        groups = self._group_by_slot(rules, table, coords, swipe_ms, interval)

        # 链里各槽出现的**真实先后**（决定了 next 列表顺序）
        once_order = self._chain_slot_order(rules.get("once_chain") or [])
        loop_order = self._chain_slot_order(rules.get("loop_chain") or [])

        # 各槽对应的节点名
        def node_of(key: str, kind: str) -> str:
            return FIGHT_NODE_TPL.format(slot=_SLOT_NODE_NAME[key], kind=KIND_CN[kind])

        override: Dict[str, Any] = {}

        # ---- 1) 组合动作节点：DSL + next（每个节点自己指向链里的下一个） ----
        #
        # next 结构完全按你的要求：
        #     ["无尽局内_继续挑战",   <- 识别不到结算，说明这局还没结束
        #      "顺序链下一个动作"]     <- 继续做链里的下一步
        #
        # 「继续挑战」放**第一个**：命中了就点它去结算流程；
        # 没命中就自然落到第二个（链里的下一个动作），不需要 on_error、不等超时。
        #
        # 链尾：单次链最后一个 -> 无尽局内_循环种植
        #       循环链最后一个 -> 循环链第一个（自循环）
        for kind, order in (("once", once_order), ("loop", loop_order)):
            for i, key in enumerate(order):
                if i + 1 < len(order):
                    next_node = node_of(order[i + 1], kind)
                elif kind == "once":
                    next_node = "无尽局内_循环种植"
                else:
                    next_node = node_of(order[0], "loop")   # 循环链自循环

                override[node_of(key, kind)] = {
                    "action": "Custom",
                    "custom_action": "BatchSwipe",
                    "custom_action_param": groups.get(kind, {}).get(key, ""),
                    "pre_delay": 0,
                    "post_delay": 0,
                    "next": [
                        "无尽局内_继续挑战",
                        next_node,
                    ],
                }

        # 该链里没落子的槽：节点清空，避免残留上次的 DSL
        for kind in ("once", "loop"):
            for key in _SLOT_NODE_NAME:
                if key in (once_order if kind == "once" else loop_order):
                    continue
                override[node_of(key, kind)] = {
                    "action": "Custom",
                    "custom_action": "BatchSwipe",
                    "custom_action_param": "",
                    "next": [],
                }

        # ---- 2) 链首节点：单次链/循环链的入口 ----
        once_next = [node_of(k, "once") for k in once_order] or ["无尽局内_循环种植"]
        loop_next = [node_of(k, "loop") for k in loop_order] or []

        override["无尽局内_单次种植"] = {
            "action": "Custom",
            "custom_action": "JobSetFight",
            "custom_action_param": {"是boss关": is_boss},
            "pre_delay": 0,
            "post_delay": 0,
            "next": once_next,
        }
        override["无尽局内_循环种植"] = {
            "action": "Custom",
            "custom_action": "JobSetFight",
            "custom_action_param": {"是boss关": is_boss},
            "pre_delay": 0,
            "post_delay": 0,
            "next": loop_next,
        }

        # ---- 3) 继续挑战节点：结算 -> 重开一局 -> 判断是否换阵容 ----
        override["无尽局内_继续挑战"] = {
            "recognition": "OCR",
            "expected": "继续挑战",
            "roi": [716, 621, 179, 50],
            "action": "Click",
            "pre_delay": 800,
            "post_delay": 300,
            "next": ["无尽局内_判断是否换阵容"],
        }

        try:
            context.override_pipeline(override)
            _log(f"已注入 {len(override)} 个节点")
            _log(f"  单次链顺序: {[k for k in once_order] or '（空）'}")
            _log(f"  循环链顺序: {[k for k in loop_order] or '（空）'}")
        except Exception as e:
            _log(f"注入失败（{type(e).__name__}: {e}）")
            return _fail()

        # 打印每段摘要，便于实机核对
        for kind in ("once", "loop"):
            cn = "单次" if kind == "once" else "循环"
            for key, name in _SLOT_NODE_NAME.items():
                d = groups.get(kind, {}).get(key)
                if d:
                    _log(f"  [{cn}] {name}: {len(d.split(';'))} 条")

        return _ok()

    # -- 内部 --------------------------------------------------------------

    @staticmethod
    def _chain_slot_order(chain: List[Dict[str, Any]]) -> List[str]:
        """取出链里各槽**首次出现**的先后（去重保序）。

        同一槽可能被拆成多段（种槽1 → 喂豆 → 再种槽1），
        这些段的动作已经在 _group_by_slot 里按顺序拼接到同一个节点，
        所以 next 列表里该槽只需出现一次，位置取它**首次**出现的地方。
        """
        seen: List[str] = []
        for seg in chain:
            key = str(seg.get("key") or "").strip()
            if key in _SLOT_NODE_NAME and key not in seen:
                seen.append(key)
        return seen

    @staticmethod
    def _group_by_slot(
        rules: Dict[str, Any],
        table: Any,
        coords: Dict[str, Any],
        swipe_ms: int,
        interval: Any,
    ) -> Dict[str, Dict[str, str]]:
        """把 once_chain / loop_chain 按「槽位」聚合成各自的 DSL 串。

        链条里同一槽可能出现多段（种槽1 → 喂豆 → 再种槽1），
        这些段要**按链里出现顺序拼接**，才能保持穿插关系。

        返回 {"once": {"card2": "swipe:...;swipe:...", ...}, "loop": {...}}
        """
        out: Dict[str, Dict[str, str]] = {"once": {}, "loop": {}}

        for kind, field in (("once", "once_chain"), ("loop", "loop_chain")):
            chain = rules.get(field) or []
            for seg in chain:
                key = str(seg.get("key") or "").strip()
                if key not in _SLOT_NODE_NAME:
                    continue
                typ = str(seg.get("type") or "plant").lower()

                # 决定这一段每株的起点
                src = None
                if typ == "plant":
                    ordinal = _dsl.ordinal_of(seg.get("slot"))
                    src = _dsl.find_slot_point(coords, ordinal) if ordinal else None
                elif typ == "feed":
                    src = _dsl.find_feed_point(coords)
                elif typ == "shovel":
                    src = _dsl.find_shovel_point(coords)

                parts = []
                for cell in seg.get("cells") or []:
                    dst = _dsl.find_grass_point(coords, str(cell))
                    if dst is None:
                        continue
                    if src is None:
                        parts.append(f"click:{dst}")
                    else:
                        parts.append(f"swipe:{src},{dst},{swipe_ms}")

                if not parts:
                    continue
                body = ";".join(parts)
                prev = out[kind].get(key)
                out[kind][key] = (prev + ";" + body) if prev else body

        # 加统一的间隔前缀
        if interval not in (None, ""):
            for kind in ("once", "loop"):
                for key, body in out[kind].items():
                    out[kind][key] = f"@{interval};{body}"

        return out


@AgentServer.custom_action("JobSetFightPlan")
class JobSetFightPlan(CustomAction):
    """告诉 pipeline「本次该跑单次链还是循环链」（只查询，不注入）。

    用于调度节点 decide 流程：
        单次链非空 -> 跑单次；单次跑完 -> 跑循环；循环也空 -> 等对局结束。

    参数：{"是boss关": false}
    日志输出，并返回 success；pipeline 侧按日志/后续节点分支。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        if js is None:
            _log("尚未载入作业集")
            return _fail()

        tr = _ensure_tracker(param)
        lv = tr.count if tr.count > 0 else 1
        table = js.pick_table(lv)
        rules = table.rules(bool(param.get("是boss关")))

        has_once = bool(rules.get("once_chain"))
        has_loop = bool(rules.get("loop_chain"))
        _log(
            f"调度：关卡{lv} 表{table.index + 1} "
            f"once={'有' if has_once else '无'} loop={'有' if has_loop else '无'}"
        )
        _STATE["has_once"] = has_once
        _STATE["has_loop"] = has_loop
        return _ok()


@AgentServer.custom_action("JobSetRollback")
class JobSetRollback(CustomAction):
    """换阵容重开后回退计数器（count-1，分数不变）。

    ★ 关键点：重开后打的还是同一关，如果管道再走一次天数识别，
      计数器会被多推一格。所以在「通用_重开」路径上显式回退。

    参数：{"次数": 1}   # 可选，默认退 1
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        tr: Optional[LevelTracker] = _STATE.get("tracker")
        if tr is None:
            _log("计数器未初始化，无法回退")
            return _fail()

        try:
            times = int(param.get("次数") or 1)
        except (TypeError, ValueError):
            times = 1
        times = max(1, times)

        for _ in range(times):
            tr.rollback_one()
        _log(f"重开回退 {times} 次 -> {tr.describe()}")
        return _ok()


# ---------------------------------------------------------------------------
# JobSetStageChanged —— 自定义识别：本关是否跨入了新阵容阶段
# ---------------------------------------------------------------------------

try:
    @AgentServer.custom_recognition("JobSetStageChanged")
    class JobSetStageChanged(CustomRecognition):
        """判断当前关卡是否跨过了阵容锚点（需要换阵容 + 重开）。

        用作 pipeline 的 recognition，**命中 = 需要换阵容**。
        pipeline 侧写法：
            "recognition": "Custom",
            "custom_recognition": "JobSetStageChanged",
            "next": ["换阵容重开节点"],
            "on_error": ["继续当前链"]

        判定依据：当前关卡所属的表序号 != 上次记录的表序号。

        ★ 本识别**无副作用（幂等）**：它只读不写 _STATE["table_index"]。
          因为 pipeline 里「正向 + inverse 反向」两个兄弟节点会各调用一次，
          如果在这里推进表指针，第二次调用就会把指针再推一格 -> 判定错乱。
          真正的推进由 JobSetFight（注入新阵容时）负责，它每次换阵容只跑一次。
        """

        def analyze(self, context: Context, argv) -> Any:
            param = _parse_param(getattr(argv, "custom_recognition_param", None))
            js: Optional[JobSet] = _STATE.get("jobset")
            if js is None:
                _log("[换阵容判断] 作业集未载入 -> 判定为「不需要换」")
                return CustomRecognition.AnalyzeResult(
                    box=None, detail={"reason": "no_jobset"}
                )

            tr = _ensure_tracker(param)
            lv = param.get("关卡")
            if lv in (None, ""):
                lv = tr.count if tr.count > 0 else 1
            try:
                lv = int(lv)
            except (TypeError, ValueError):
                lv = 1

            table = js.pick_table(lv)
            prev = _STATE.get("table_index")
            # 首次（prev 为 None）不算「换阵容」：那是本轮第一次注入，
            # JobSetLoad/JobSetFight 已经按当前关选好表了。
            changed = (prev is not None) and (prev != table.index)

            if changed:
                _log(
                    f"[换阵容判断] 关卡{lv} 从表{(prev or 0) + 1} 跨入表{table.index + 1} "
                    f"-> 需要换阵容（植物 {table.plants}）"
                )
                return CustomRecognition.AnalyzeResult(
                    box=(0, 0, 1, 1),
                    detail={"stage": table.index, "level": lv, "plants": table.plants},
                )

            _log(f"[换阵容判断] 关卡{lv} 仍在表{table.index + 1} -> 不需要换")
            return CustomRecognition.AnalyzeResult(
                box=None, detail={"stage": table.index, "level": lv}
            )

except Exception as _e:  # pragma: no cover
    _log(f"JobSetStageChanged 注册失败（MaaFw 版本可能不支持 CustomRecognition）：{_e}")
