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
    # ★ 换阵容后的一次性「跳过识别」标记。
    #   重开打的还是同一关，再识别一次会得到同样的关卡号 ->
    #   又会判定「不需要换」-> 死循环。所以换阵容重开后置 True，
    #   进关时消费掉（读一次就清），直接按新表种植。
    "skip_detect": False,
    # ★ 本次任务里 JobSetStage 是否已经跑过第一次（基准帧）。
    #   第一次调用会无条件采信 OCR 作为起始关卡并重建基准，
    #   之后才进入「得分匹配」模式。
    "stage_seen": False,
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
        #
        # ★ 这里**故意不猜表**。
        #   首次进关时我们还不知道打到第几关，如果按「起始关卡 or 1」猜一张表，
        #   并把 _STATE["table_index"] 设成它，那么接下来识别到真实关卡（比如 55）
        #   算出的是表2，就会判定「换了阵容」-> 触发重开。
        #   但首次进关根本没有「上一套阵容」可换，也不需要重开——
        #   直接按识别结果选表、选卡、开种就行。
        #
        #   所以 table_index 保持 None：JobSetStageChanged 见到 None 一律返回
        #   「不需要换」，直到 JobSetFight 第一次真正按识别结果锁定表。
        _STATE["table_index"] = None

        lv = tr.count if tr.count > 0 else (param.get("起始关卡") or 1)
        try:
            lv = int(lv)
        except (TypeError, ValueError):
            lv = 1
        table = js.pick_table(lv)
        _log(
            f"载入完成：关卡={lv if tr.count > 0 else '待识别'} "
            f"预计表{table.index + 1}（首次进关以识别结果为准，不重开）"
        )

        # 选卡参数先用「预计表」注入，保证首帧进选卡界面时有植物可选；
        # 真实关卡识别出来后，JobSetFight 会按识别结果重新注入。
        try:
            context.override_pipeline({
                "无尽挑战_选取植物": {
                    "custom_action_param": json.dumps(
                        {"植物列表": table.plants}, ensure_ascii=False
                    )
                }
            })
            _log(f"已注入选卡参数（预计）：{table.plants}")
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
        """用 run_recognition_direct 跑一次天数 OCR。

        ★ 第三个参数必须是**自己截好的图**（同 JobSetStage._recognize）。
        """
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

        # ---- 先截图 ----
        try:
            image = context.tasker.controller.post_screencap().wait().get()
        except Exception as e:
            _log(f"识别：截图失败（{type(e).__name__}: {e}）")
            return None
        if image is None:
            _log("识别：截图为空")
            return None

        try:
            detail = context.run_recognition_direct(
                JRecognitionType.OCR,
                JOCR(only_rec=True, roi=list(roi), replace=replace),
                image,
            )
            text = self._extract_text(detail)
        except Exception as e:
            _log(f"识别异常（{type(e).__name__}: {e}）")
            return None

        if not text:
            _log(f"节点 {node} 未识别到文字")
            return None
        # 统一走「第N关 / 第N天 / 纯数字」解析，避免拼接多个数字出错
        return JobSetStage._parse_day(str(text))

    @staticmethod
    def _extract_text(detail: Any) -> str:
        """从 run_recognition_direct 的返回值里取出 OCR 文本。

        真实返回是 RecognitionDetail，文本在 `.best_result.text`；
        为兼容不同版本/字典形态，逐层尝试 best_result / text / all / detail。
        """
        if detail is None:
            return ""

        def _from(obj: Any) -> str:
            if obj is None:
                return ""
            if isinstance(obj, str):
                return obj.strip()
            for attr in ("best_result", "text", "all", "detail"):
                v = getattr(obj, attr, None)
                if v is None and isinstance(obj, dict):
                    v = obj.get(attr)
                if v is None:
                    continue
                got = _from(v)
                if got:
                    return got
            if isinstance(obj, (list, tuple)):
                for it in obj:
                    got = _from(it)
                    if got:
                        return got
            return ""

        txt = _from(detail)
        if txt:
            return txt
        inner = getattr(detail, "detail", None)
        if inner is None and isinstance(detail, dict):
            inner = detail.get("detail")
        return _from(inner)

    def _maybe_switch(self, context: Context, tr: LevelTracker, level: int) -> None:
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

# ---------------------------------------------------------------------------
# 补给选取（04_Endless_Supply.json）
#
# 作业集里的 supplyPicks 决定补给界面的「优先拿哪个」顺序。运行时把
# 「无尽局内_补给」的 next 按作业集顺序重写，并控制两个开关：
#   · 无尽补给_使用金币查看  enabled = 作业集里有没有「查看」（固定项）
#   · 无尽局内_补给          enabled = 有没有配任何补给项
#
# ⚠️ 两个节点的位置**永远不变**：
#   · 无尽补给_使用金币查看  = 永远是 next 的第 1 个
#   · 无尽补给_兜底选择      = 永远是 next 的最后一个
#   中间那段才是按作业集顺序排列的能力项。
# ---------------------------------------------------------------------------

# 作业集里的补给项 id -> pipeline 节点名
SUPPLY_NODE_BY_ID = {
    "all":      "无尽补给_全部植物",
    "orange":   "无尽补给_橙色植物",
    "purple":   "无尽补给_紫色植物",
    "blue":     "无尽补给_蓝色植物",
    "green":    "无尽补给_绿色植物",
    "white":    "无尽补给_白色植物",
    "artifact": "无尽补给_神器",
    "sun":      "无尽补给_能量豆",
    "cucumber": "无尽补给_黄瓜",
    "view":     "无尽补给_使用金币查看",
}

# 固定位置的节点
SUPPLY_NODE_VIEW = "无尽补给_使用金币查看"
SUPPLY_NODE_FALLBACK = "无尽补给_兜底选择"
SUPPLY_NODE_ENTRY = "无尽局内_补给"

# 作业集里的「查看」id
SUPPLY_ID_VIEW = "view"


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

        # ★ boss 判定来源（按优先级）：
        #   1) param 里显式给了 是boss关  -> 用 param（最外层触发点会传）
        #   2) param 没给                 -> 用上次记录在 state 里的值
        #      因为链首节点「无尽局内_单次种植」会被反复调用，它的 param 是
        #      注入时写死的空值；真正「本关是不是 boss」记在 state 里。
        if "是boss关" in param:
            is_boss = bool(param.get("是boss关"))
            _STATE["is_boss"] = is_boss
        else:
            is_boss = bool(_STATE.get("is_boss"))
        swipe_ms = int(param.get("滑动时长") or 80)
        interval = param.get("间隔")

        # ★ 优先用 JobSetStage 已经锁定好的表，保证「选卡」与「种植」是同一张表。
        #   只有 JobSetStage 没跑过（table_index 为 None）时才自己按关卡算。
        prev_index = _STATE.get("table_index")
        if prev_index is not None and 0 <= prev_index < len(js.tables):
            table = js.tables[prev_index]
            locked_lv = _STATE.get("locked_level")
            _log(
                f"沿用已锁定表{table.index + 1}"
                f"（锁定时关卡={locked_lv}，本次关卡={lv}）"
            )
        else:
            table = js.pick_table(lv)

        rules = table.rules(is_boss)
        kind_cn = "BOSS关" if is_boss else "普通关"

        if prev_index is None:
            # ★ 首次锁定表：这次是「首次进关」，直接按识别结果选表开种，
            #   不算换阵容、不重开。JobSetLoad 故意把 table_index 留成 None
            #   就是为了区分「首次」与「真的换了表」。
            _STATE["table_index"] = table.index
            _log(
                f"首次锁定阵容：关卡{lv} -> 表{table.index + 1}"
                f"（植物 {table.plants}），不重开"
            )
            try:
                context.override_pipeline({
                    "无尽挑战_选取植物": {
                        "custom_action_param": json.dumps(
                            {"植物列表": table.plants}, ensure_ascii=False
                        )
                    }
                })
                _log(f"已注入选卡植物：{table.plants}")
            except Exception as e:
                _log(f"注入选卡失败（{type(e).__name__}: {e}）")
        elif prev_index != table.index:
            _log(
                f"★ 阵容切换：表{prev_index + 1} -> 表{table.index + 1}"
                f"（关卡 {table.from_level} 起，植物 {table.plants}）"
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
                _log("★ boss 关未配置种植链 -> 不种植，直接等结算（只保留继续挑战识别）")
                context.override_pipeline({
                    "无尽局内_单次种植": {
                        "action": "Custom",
                        "custom_action": "JobSetFight",
                        "custom_action_param": {},
                        "pre_delay": 0,
                        "post_delay": 0,
                        # 空 next 链 -> 交给管道去识别「继续挑战」等结算
                        "next": ["无尽局内_继续挑战"],
                    },
                    "无尽局内_循环种植": {
                        "action": "Custom",
                        "custom_action": "JobSetFight",
                        "custom_action_param": {},
                        "pre_delay": 0,
                        "post_delay": 0,
                        "next": ["无尽局内_继续挑战"],
                    },
                })
                return _ok()

        coords = _dsl.load_coords()
        if not coords:
            _log("坐标表为空（agent/assets/resource/coords.json 未找到）")

        # ★ 每「段」一个节点（不再按槽位聚合）
        #
        # 为什么：链条里同一个槽可以多次出现且**不相邻**，
        #   例如「铲子(格子1_3) → 种心叶兰 → 铲子(2_2,2_3,2_4) → 种大喷菇」。
        #   如果按槽位聚合成一个节点，两段铲子会被合并、节点排在 card1 之前，
        #   实际就变成「先铲完所有，再种」—— 与顺序链不符。
        #   所以这里改成：链里第 i 段 -> 独立节点（名字带段号），
        #   节点之间的 next 严格按链的先后串起来。
        seg_nodes = self._build_seg_nodes(rules, coords, swipe_ms, interval)

        # 各链的节点序列（按链里段的先后）
        once_seq = seg_nodes.get("once", [])
        loop_seq = seg_nodes.get("loop", [])
        once_order = [s["key"] for s in once_seq]
        loop_order = [s["key"] for s in loop_seq]

        override: Dict[str, Any] = {}

        # ---- 1) 组合动作节点：每个链段一个节点 ----
        #
        # next 结构：
        #     ["无尽局内_继续挑战",   <- 识别不到结算，说明这局还没结束
        #      "链里的下一个段节点"]   <- 继续做链里的下一步
        #
        # 「继续挑战」放**第一个**：命中了就点它去结算流程；
        # 没命中就自然落到第二个，不需要 on_error、不等超时。
        #
        # 链尾：单次链最后一段 -> 无尽局内_循环种植
        #       循环链最后一段 -> 循环链第一段（自循环）
        for kind, seq in (("once", once_seq), ("loop", loop_seq)):
            for i, seg in enumerate(seq):
                if i + 1 < len(seq):
                    next_node = seq[i + 1]["node"]
                elif kind == "once":
                    next_node = "无尽局内_循环种植"
                else:
                    next_node = seq[0]["node"] if seq else "无尽局内_循环种植"

                override[seg["node"]] = {
                    "action": "Custom",
                    "custom_action": "BatchSwipe",
                    "custom_action_param": seg["dsl"],
                    "pre_delay": 0,
                    "post_delay": 0,
                    "next": [
                        "无尽局内_继续挑战",
                        next_node,
                    ],
                }

        # ---- 2) 链首节点：单次链/循环链的入口 ----
        once_next = [s["node"] for s in once_seq] or ["无尽局内_循环种植"]
        loop_next = [s["node"] for s in loop_seq]

        # 记录本关的 boss 状态，供链首节点复用
        _STATE["is_boss"] = is_boss

        override["无尽局内_单次种植"] = {
            "action": "Custom",
            "custom_action": "JobSetFight",
            "custom_action_param": {},          # 空 -> 由 state 决定
            "pre_delay": 0,
            "post_delay": 0,
            "next": once_next,
        }
        override["无尽局内_循环种植"] = {
            "action": "Custom",
            "custom_action": "JobSetFight",
            "custom_action_param": {},          # 空 -> 由 state 决定
            "pre_delay": 0,
            "post_delay": 0,
            "next": loop_next,
        }

        # ---- 3) 继续挑战节点：结算画面 -> 点击 -> 回到「开始战斗」再进一局 ----
        #
        # ⚠️ 这里的 next 必须指向**真实存在**的节点。
        #    「无尽局内_判断是否换阵容」已被注释（换阵容流程由用户重写），
        #    曾经把它写在这里 -> 点完继续挑战后找不到后继 -> 3ms 内 Task.Failed。
        #
        # ★ 顺序很重要：先走「无尽局内_补给」（结算后可能进入补给界面），
        #   没进补给就自然落到「选取植物_开始战斗」继续下一局。
        #   之前这里只写了「选取植物_开始战斗」，把补给漏掉了 ——
        #   结果补给链永远不执行（作业集里配了也没用）。
        after_pick = str(param.get("继续挑战后续") or "无尽挑战_选取植物_开始战斗")
        override["无尽局内_继续挑战"] = {
            "recognition": "OCR",
            "expected": "继续挑战",
            "roi": [716, 621, 179, 50],
            "action": "Click",
            "pre_delay": 800,
            "post_delay": 300,
            "next": ["无尽局内_补给", after_pick],
        }

        # ---- 4) 自检：注入的 next 目标是否都存在 ----
        #
        # 踩过的坑：曾把「无尽局内_继续挑战」的 next 指向一个已被注释掉的节点，
        # 结果点完继续挑战后找不到后继 -> 3ms 内整条任务结束（表现为 Task.Failed）。
        # 这里在注入前先把可疑目标挑出来写日志，避免又静默断链。
        self._warn_missing_targets(context, override)

        try:
            context.override_pipeline(override)
            _log(f"已注入 {len(override)} 个节点")
            # 打印每段的节点名与动作数（段序 = 执行顺序）
            for kind, seq in (("once", once_seq), ("loop", loop_seq)):
                cn = "单次" if kind == "once" else "循环"
                if not seq:
                    _log(f"  [{cn}链] （空）")
                    continue
                names = [s["node"] for s in seq]
                _log(f"  [{cn}链] 共 {len(seq)} 段，执行顺序：")
                for s in seq:
                    n = len([x for x in s["dsl"].split(";") if x.strip()])
                    _log(f"      {s['node']}  （{s['key']}，{n} 条动作）")
        except Exception as e:
            _log(f"注入失败（{type(e).__name__}: {e}）")
            return _fail()

        # ---- 补给选取：一并覆盖（见 _apply_supply）----
        self._apply_supply(context, table)

        return _ok()

    # -- 内部 --------------------------------------------------------------

    @classmethod
    def _apply_supply(cls, context: Context, table: Any) -> None:
        """按作业集的补给顺序覆盖「无尽局内_补给」的 next + 两个开关。

        规则（用户明确要求）：
          · 「无尽补给_使用金币查看」永远是 next 的**第 1 个**，
            enabled = 作业集里有没有「查看」
          · 「无尽补给_兜底选择」永远是 next 的**最后一个**
          · 中间那段 = 按作业集 supplyPicks 的顺序排列的能力项
          · 「无尽局内_补给」enabled = 有没有配任何补给项
            （没配 -> false，整块补给不参与）

        位置不变的这两个节点头尾固定，不参与排序。
        """
        picks = table.raw.get("supplyPicks")
        if not isinstance(picks, list):
            picks = []

        # 按作业集顺序映射成节点名（跳过未知 id 与「查看」本身）
        middle: List[str] = []
        seen: set = set()
        has_view = False
        for it in picks:
            if not isinstance(it, dict):
                continue
            pid = str(it.get("id") or "").strip()
            if not pid:
                # 没有 id 就用中文名兜底匹配
                nm = str(it.get("name") or "").strip()
                pid = {"全部植物": "all", "橙色植物": "orange", "紫色植物": "purple",
                       "蓝色植物": "blue", "绿色植物": "green", "白色植物": "white",
                       "神器": "artifact", "能量豆": "sun", "黄瓜": "cucumber",
                       "查看": "view"}.get(nm, "")
            if pid == SUPPLY_ID_VIEW:
                has_view = True
                continue                      # 「查看」走独立开关，不进中间列表
            node = SUPPLY_NODE_BY_ID.get(pid)
            if not node or node in seen:
                continue
            # 中间列表里也要排除两个固定位
            if node in (SUPPLY_NODE_VIEW, SUPPLY_NODE_FALLBACK):
                continue
            seen.add(node)
            middle.append(node)

        # 组装 next：查看(首) + 中间(按作业集顺序) + 兜底(尾)
        next_list: List[str] = [SUPPLY_NODE_VIEW] + middle + [SUPPLY_NODE_FALLBACK]

        override: Dict[str, Any] = {
            # ★「无尽局内_补给」**只覆盖 next，不碰 enabled**。
            #   它的开关由 pipeline（task option / 用户设置）决定，
            #   custom 不该抢这个决定权 —— 否则用户手动关掉补给也会被强行打开。
            SUPPLY_NODE_ENTRY: {
                "next": next_list,
            },
            # 「查看」按作业集的选择开/关（位置永远在第一个）
            SUPPLY_NODE_VIEW: {"enabled": has_view},
        }

        # 「查看」节点自己的 next 也保持同样的中间列表 + 兜底
        override[SUPPLY_NODE_VIEW]["next"] = middle + [SUPPLY_NODE_FALLBACK]

        try:
            context.override_pipeline(override)
            _log(
                f"补给：已覆盖 next 顺序（查看={'开' if has_view else '关'}；"
                f"无尽局内_补给 的 enabled 不动）-> "
                f"{' > '.join(middle) if middle else '（无中间项）'}"
            )
        except Exception as e:
            _log(f"补给覆盖失败（{type(e).__name__}: {e}）")

    @staticmethod
    def _warn_missing_targets(context: Context, override: Dict[str, Any]) -> None:
        """注入前自检：override 里所有 next 目标是否真的存在。

        存在的节点 = 本次 override 里新增的节点 ∪ 资源里已有的节点。
        找不到的就写日志告警（不阻断）—— 这类目标一旦缺失，
        运行时表现为「链走完了」-> 任务结束，很难排查，所以必须留痕。
        """
        known = set(override.keys())
        probe = getattr(context, "get_node_data", None)
        missing: List[str] = []
        for node_name, node in override.items():
            nx = node.get("next") if isinstance(node, dict) else None
            if not nx:
                continue
            for tgt in (nx if isinstance(nx, list) else [nx]):
                if not isinstance(tgt, str) or tgt.startswith(("[", "@")):
                    continue
                if tgt in known:
                    continue
                if callable(probe):
                    try:
                        if probe(tgt) is not None:
                            continue
                    except Exception:
                        pass
                missing.append(f"{node_name} -> {tgt}")

        if missing:
            _log("⚠️ 以下 next 目标在资源里找不到，运行时会断链：")
            for m in missing:
                _log(f"    {m}")
        else:
            _log("next 目标自检通过")

    @classmethod
    def _build_seg_nodes(
        cls,
        rules: Dict[str, Any],
        coords: Dict[str, Any],
        swipe_ms: int,
        interval: Any,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """链里**每一段**生成一个独立节点。

        返回 {"once": [{"node": 节点名, "key": 槽位key, "dsl": "..."}], "loop": [...]}
        列表顺序 = 链里段的先后，运行时按此顺序串 next。

        ★ 为什么按段而不是按槽：
          同一个槽可以在链里多次出现且不相邻，比如
            shovel(格子1_3) → card1 → shovel(2_2,2_3,2_4) → card2
          如果按槽聚合成一个节点，两段铲子会被合并、节点排到 card1 前面，
          实际执行就变成「先铲完所有，再种」—— 与顺序链不符。
        """
        out: Dict[str, List[Dict[str, Any]]] = {"once": [], "loop": []}

        for kind, field in (("once", "once_chain"), ("loop", "loop_chain")):
            chain = rules.get(field) or []
            # 段序号：同名槽多段时用于区分节点（第一个 _1，第二个 _2 …）
            seq_no: Dict[str, int] = {}

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

                # 该段每个落点的「动作后等待」秒数（与 cells 等长，来自 waitAfter）
                waits = seg.get("waits") or []

                parts: List[str] = []
                for i, cell in enumerate(seg.get("cells") or []):
                    dst = _dsl.find_grass_point(coords, str(cell))
                    if dst is None:
                        continue
                    if src is None:
                        parts.append(f"click:{dst}")
                    else:
                        parts.append(f"swipe:{src},{dst},{swipe_ms}")
                    # 等待：这个动作之后插入 sleep:N（BatchSwipe 支持 sleep:秒）
                    try:
                        sec = float(waits[i]) if i < len(waits) else 0.0
                    except (TypeError, ValueError, IndexError):
                        sec = 0.0
                    if sec > 0:
                        parts.append(f"sleep:{sec:g}")

                if not parts:
                    continue

                body = ";".join(parts)
                if interval not in (None, ""):
                    body = f"@{interval};{body}"

                # 节点名：<槽位>组合动作_<单次/循环>_<段号>
                seq_no[key] = seq_no.get(key, 0) + 1
                node = (
                    FIGHT_NODE_TPL.format(slot=_SLOT_NODE_NAME[key], kind=KIND_CN[kind])
                    + f"_{seq_no[key]}"
                )
                out[kind].append({
                    "node": node,
                    "key": key,
                    "seq": seq_no[key],
                    "dsl": body,
                })

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

            # ★ prev 为 None = 还没锁定过任何表 = 本轮**首次进关**。
            #   首次进关直接按识别结果选表开种，不重开（没有「上一套阵容」可换）。
            #   JobSetLoad 故意不猜表，就是靠这个 None 来区分首次与真的换表。
            if prev is None:
                _log(
                    f"[换阵容判断] 首次进关（尚未锁定表）-> 不换阵容，"
                    f"按识别结果用表{table.index + 1}（植物 {table.plants}）"
                )
                return CustomRecognition.AnalyzeResult(
                    box=None, detail={"stage": table.index, "level": lv, "first": True},
                )

            if prev != table.index:
                _log(
                    f"[换阵容判断] 关卡{lv} 从表{prev + 1} 跨入表{table.index + 1} "
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


# ---------------------------------------------------------------------------
# JobSetStage —— 挂在「无尽挑战_确认自己当前阶段」
#
# 一个动作干完四件事：识别天数 -> 计数 -> 计分 -> 判断是否换阵容。
#
# 关键语义（用户明确要求）：
#   · 本次任务里**第一次**识别到「属于另一张表」的天数时（比如表2 是 50~149），
#     **不增加计数**，而是用「通用暂停」重开，把作业集切换成表2 的阵容与种植逻辑，
#     然后继续开始游戏，走表2 的种植流程。
#   · 之后同一张表内的关卡，按正常的「计数 + 得分期望」推进。
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetStage")
class JobSetStage(CustomAction):
    """识别当前天数 -> 计数/计分 -> 必要时换阵容重开。

    参数（全部可选）：
        {
          "识别roi": [555,61,414,81],   # 天数识别区域（缺省用旧版实测值）
          "识别节点": "无尽挑战_局内识别天数",  # 也可直接引用已有 OCR 节点
          "通用重开节点": "通用_重开_暂停",     # 换阵容时调用的重开任务
          "重开": false                   # true = 强制走一次换阵容（调试用）
        }
    """

    DEFAULT_ROI = [555, 61, 414, 81]

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        if js is None:
            _log("尚未载入作业集（JobSetLoad 未执行）")
            return _fail()

        tr = _ensure_tracker(param)

        # ---- 0) 是不是「本次任务的第一次识别」----
        # ★ 每次执行任务都要从「一开始识别」重新建立基准，
        #   不能沿用上一次任务残留的 count（用户可能关掉脚本自己打了几关）。
        #   用显式标志而不是 count<=0 推断，避免残留状态误判。
        first = not bool(_STATE.get("stage_seen"))
        if first:
            _log("本次任务首次进入阶段确认 -> 用本次识别值重建基准")
            # 首次进关时表指针也应重置，避免沿用上一次任务的表
            if param.get("重置阶段", True):
                _STATE["table_index"] = None
                _STATE["seen_stages"] = set()

        # ---- 1) 识别天数 ----
        raw = self._recognize(context, param)
        if raw is None:
            _log("天数识别失败" + ("（基准帧）" if first else " -> 仅按计数器推进一格"))
        else:
            _log(f"天数识别：{raw}")

        # ---- 2~3) 计数 + 计分（交给 LevelTracker）----
        lv = tr.observe(raw, first=first)
        _STATE["stage_seen"] = True
        _log(f"计数/计分后：{tr.describe()}")

        # ---- 4) 判断当前阶段 ----
        table = js.pick_table(lv)
        prev = _STATE.get("table_index")

        # 「第一次识别到切换阵容的天数」= 本次任务里还没锁定过，
        # 或者锁定的表与当前识别出的表不同。
        seen: set = _STATE.setdefault("seen_stages", set())

        to_switch = False
        reason = ""

        if param.get("重开"):
            to_switch = True
            reason = "参数强制"
        elif prev is None:
            # ★ 首次进关：用**第一次识别的天数**选表。
            #   · 落在表1（第一张表）-> 就用表1，不重开（本来就是对的阵容）
            #   · 落在表2 及以后     -> **要重开**，因为进关时用的是表1 的
            #     阵容/选卡，得先重开把阵容换成目标表的（用户明确要求）
            if table.index == 0:
                reason = f"首次进关落在表1（关卡{lv}），不换阵容"
            else:
                to_switch = True
                reason = f"首次进关即落在表{table.index + 1}（关卡{lv}）"
        elif prev != table.index:
            if table.index in seen:
                # 这张表之前进去过 —— 说明是识别抖动回到旧表，不重开
                reason = f"表{table.index + 1} 进入过，疑似识别抖动，不换"
            else:
                to_switch = True
                reason = f"首次进入表{table.index + 1}（关卡 {table.from_level} 起）"

        if to_switch:
            # ★ 换阵容时**不增加计数**：重开打的还是同一关，
            #   如果管道再识别一次会把计数多推一格，所以这里先退一格抵消。
            #
            #   ⚠️ 但「首次进关」的识别**不该退** —— 那是本次任务第一次拿到
            #   真实关卡号，退一格会让计数从 9 变成 8，与实际关卡对不上。
            #   首次进关没有「多推一格」的问题，因为之前根本没有计数。
            if first:
                _log(f"★ 换阵容（{reason}）：首次进关，计数保持 {tr.count}（不回退）")
            else:
                tr.rollback_one()
                _log(f"★ 换阵容（{reason}）：计数回退 -> {tr.count}（分数保持 {tr.score}）")

            # 锁定目标表：**先写 state 再注入**，保证选卡与种植用的是同一张表。
            # （否则 JobSetFight 稍后自己再 pick_table 一次，可能算出不同结果）
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv          # 记住是哪一关锁的
            seen.add(table.index)

            # 切换作业集：注入新表的选卡植物 + 种植链
            ok = self._apply_table(context, js, table)

            # 换阵容后要重新选卡 -> 用 run_task 直接跳回「清空卡牌」，
            # 走完整的「清空卡牌 -> 选取植物 -> 开始战斗 -> 进入局内」流程。
            # 不能用 next（本节点是 Custom action，next 由 pipeline 决定，
            # 而 pipeline 里 next 指向的是种植，不是选卡）。
            node = str(param.get("重开后回跳节点") or "无尽挑战_识别开始战斗_清空卡牌")
            _log(f"调用通用重开：{param.get('通用重开节点') or '通用_重开_暂停'}")
            try:
                context.run_task(str(param.get("通用重开节点") or "通用_重开_暂停"))
                _log("通用重开完成")
            except Exception as e:
                _log(f"通用重开失败（{type(e).__name__}: {e}）")

            _log(f"重开完成 -> 跳回「{node}」重新走选卡流程")
            try:
                context.run_task(node)
                _log("选卡流程已走完")
            except Exception as e:
                _log(f"跳回选卡失败（{type(e).__name__}: {e}）")
            return _ok() if ok else _fail()

        # ---- 不换阵容：正常锁定/沿用当前表 ----
        if prev != table.index:
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv
            self._apply_table(context, js, table)
            _log(f"锁定表{table.index + 1}（关卡{lv}，植物 {table.plants}）")
        seen.add(table.index)

        _log(f"阶段确认完成：{reason or '维持当前表'} -> 表{table.index + 1}")

        # 把 boss 判定结果也准备好，供下游 JobSetFight 使用
        try:
            context.override_pipeline({
                "无尽局内_BOSS关种植": {
                    "custom_action_param": {"是boss关": True, "关卡": lv}
                },
                "无尽局内_单次种植": {
                    "custom_action_param": {"是boss关": False, "关卡": lv}
                },
                "无尽局内_循环种植": {
                    "custom_action_param": {"是boss关": False, "关卡": lv}
                },
            })
        except Exception as e:
            _log(f"同步关卡到种植节点失败（{type(e).__name__}: {e}）")

        return _ok()

    # -- 内部 --------------------------------------------------------------

    def _recognize(self, context: Context, param: Dict[str, Any]) -> Optional[int]:
        """跑一次天数 OCR，返回整数关卡；失败返回 None。

        ★ run_recognition_direct(reco_type, reco_param, image) 的第三个参数
          是一张**已经截好的图**，必须自己先 post_screencap 拿到。
          （之前漏传 image，直接 TypeError。）
        """
        roi = list(param.get("识别roi") or self.DEFAULT_ROI)
        replace = param.get("替换") or [["g", "9"], ["G", "6"], ["《", "8"]]

        try:
            from maa.pipeline import JRecognitionType, JOCR
        except Exception:
            _log("当前 MaaFw 不支持 run_recognition_direct")
            return None

        if not hasattr(context, "run_recognition_direct"):
            _log("context 没有 run_recognition_direct")
            return None

        # ---- 1) 先截图 ----
        image = None
        try:
            ctl = context.tasker.controller
            image = ctl.post_screencap().wait().get()
        except Exception as e:
            _log(f"天数识别：截图失败（{type(e).__name__}: {e}）")
            return None
        if image is None:
            _log("天数识别：截图为空")
            return None

        # ---- 2) 直接对这张图跑 OCR ----
        text = ""
        try:
            detail = context.run_recognition_direct(
                JRecognitionType.OCR,
                JOCR(only_rec=True, roi=roi, replace=replace),
                image,
            )
            text = self._extract_text(detail)
        except Exception as e:
            _log(f"天数识别异常（{type(e).__name__}: {e}）")
            return None

        if not text:
            _log("天数识别：未读到文字")
            return None
        return self._parse_day(str(text))

    @staticmethod
    def _parse_day(text: str) -> Optional[int]:
        """从 OCR 文本里取出「第几关/第几天」的数字。

        真实日志出现过这些形态：
            "55"                  纯数字（最理想）
            "亚瑟的挑战-第8关"      带前缀的关卡名
            "第55关" / "第 55 关"   带「第N关」

        规则（按优先级）：
          1. 先找「第 <数字> 关」这种明确写法
          2. 否则找「第 <数字> 天」
          3. 否则若整串就是个纯数字，直接用
          4. 否则把 `-` `_` `/` `|` 当分隔符，取最后一段里的数字
             （"亚瑟的挑战-第8关" -> "第8关" -> 8）
        """
        import re as _re

        s = text.strip()
        if not s:
            return None

        # 1) 第N关
        m = _re.search(r"第\s*(\d{1,3})\s*关", s)
        if m:
            return int(m.group(1))
        # 2) 第N天
        m = _re.search(r"第\s*(\d{1,3})\s*天", s)
        if m:
            return int(m.group(1))
        # 3) 纯数字
        if _re.fullmatch(r"\d{1,3}", s):
            return int(s)
        # 4) 取最后一段里的数字（兼容「A-B第8关」这类）
        tail = _re.split(r"[-_/|]", s)[-1]
        nums = _re.findall(r"\d{1,3}", tail)
        if nums:
            return int(nums[-1])
        # 5) 兜底：整串里最后一个数字
        nums = _re.findall(r"\d{1,3}", s)
        if nums:
            return int(nums[-1])
        return None

    @staticmethod
    def _extract_text(detail: Any) -> str:
        """见 JobSetLevel._extract_text（同一套兼容逻辑）。"""
        return JobSetLevel._extract_text(detail)

    @staticmethod
    def _apply_table(context: Context, js: JobSet, table: Any) -> bool:
        """把指定表的阵容与种植逻辑注入 pipeline。"""
        try:
            context.override_pipeline({
                "无尽挑战_选取植物": {
                    "custom_action_param": json.dumps(
                        {"植物列表": table.plants}, ensure_ascii=False
                    )
                }
            })
            _log(f"已切换到表{table.index + 1}：选卡植物={table.plants}")
            return True
        except Exception as e:
            _log(f"切换表失败（{type(e).__name__}: {e}）")
            return False


# ---------------------------------------------------------------------------
# 【已移除】JobSetArmSkip / JobSetSkipCheck
#
# 原设计：换阵容重开后打一个「跳过天数识别」的一次性标记，
#         进关时消费掉，避免重复识别导致再次判定换阵容 -> 死循环。
#
# 移除原因：这套「正向 + inverse 反向」的写法在 pipeline 侧不好接，
#           用户决定自己重写这一段流程。
#
# 如果以后要恢复，注意两点：
#   1) 选表必须用「回退前」的关卡号（last_raw），不能用已被 rollback 减过的 count，
#      否则会算回上一张表。
#   2) inverse 兄弟节点必须显式写进正向节点的 next 里，否则未命中时会卡死。
#
# 相关状态 _STATE["skip_detect"] 保留（无害），重新启用时可直接复用。
# ---------------------------------------------------------------------------

