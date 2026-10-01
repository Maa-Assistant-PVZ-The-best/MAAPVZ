# -*- coding: utf-8 -*-
"""作业集运行时 —— 与 MaaFramework 的胶水层（CustomAction 注册）。

注册的动作
----------
JobSetLoad        载入作业集、初始化关卡计数器，把「当前阵容」暴露给后续节点。
                  挂在空壳节点「无尽挑战_加载作业集代码」上。
JobSetStage       识别当前天数 -> 计数/计分 -> 必要时换阵容重开。
                  挂在「无尽挑战_确认自己当前阶段」。
JobSetFight       核心：把三条链（单次/循环/收尾）拼成 DSL 注入组合动作节点，
                  并覆盖补给链顺序。挂在「无尽局内_单次/循环种植」。
JobSetInfo        只读查询当前状态（调试用，不产生副作用）。

⚠️ 曾经还有 7 个动作，因三链重构 / pipe 化后不再需要而删除：
   JobSetLevel / JobSetSlot / JobSetReset / JobSetFightPlan / JobSetRollback
   / JobSetStageChanged —— 逻辑已并入上面几个。
   JobSetEndRestart —— 已 pipe 化（next + [Anchor]下一个动作），见 03-1-01。

   ★ 教训：**能用 pipe 表达的，不要写 custom**。
     run_task 是同步的，看着像必须用代码；但 pipe 的 next + [Anchor]
     同样能表达「跑完子流程再继续」，而且可读性好得多。

与 pipeline 的对接方式：本模块**不修改任何 pipeline JSON**，
需要的信息通过 CustomAction 的返回值 / 日志传递；
需要「覆盖」的节点由 pipeline 侧用 JobSetLoad 输出的 param 驱动。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction
from maa.custom_recognition import CustomRecognition

from .engine import JobSet, JobSetError, load_jobset
from .level_tracker import LevelTracker, from_params
from .level_tracker import BOSS_SNAP as _BOSS_SNAP
from . import dsl as _dsl

# ---------------------------------------------------------------------------
# 进程级单例状态
#
# MAA 的 CustomAction 是每次执行新实例化的，所以状态必须放在模块级。
# 生命周期与 Agent 进程一致；每次「重新开始任务」由 JobSetLoad(重置) / task 变化重置。
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


# ---------------------------------------------------------------------------
# 切换编队（用编队代替选卡）
#
# 需求（用户原话）：
#   「换阵使用换编队的话就不需要选卡逻辑了」
#   「需要重开的，也需要确认自己在选卡界面」
#   「如果用户选择了切换编队，则强制输入 1-6 的数字，
#     并将『无尽挑战_识别开始战斗_清空卡牌』的 next 改成『无尽挑战_切换编队』」
#   「将『无尽_切换编队序号』的 expected 改成用户输入的数字，写入作业集
#     并让作业集的 custom 读取覆盖」
#
# pipe 里的链路（02_Endless_plant_Choose_ref.json）：
#   无尽挑战_识别开始战斗_清空卡牌   (OCR 识别到「清空卡牌」-> Click)
#        └─ next: ["无尽挑战_选取植物"]              <- 默认走选卡
#   无尽挑战_切换编队                (OCR 识别到「配队」-> Click)
#        └─ next: ["无尽_过滤编队颜色"]
#   无尽_过滤编队颜色                (ColorMatch 找蓝色 -> DoNothing)
#        └─ next: ["无尽_切换编队序号", "无尽_滑动寻找编队"]
#   无尽_切换编队序号                (Or + 两个 any_of OCR -> Click)
#        └─ next: ["无尽挑战_选取植物_开始战斗"]     <- 跳过选卡，直接开战
#
# 所以运行时要改的只有两个字段：
#   1) 「清空卡牌」的 next  -> ["无尽挑战_切换编队"]   （默认是 ["无尽挑战_选取植物"]）
#   2) 「切换编队序号」的 expected -> ["3"]            （默认是 []）
#
# ★ 「确认自己在选卡界面」由「清空卡牌」那个 OCR 节点天然保证：
#   它认到「清空卡牌」才会 Click 并走 next。认不到 -> OCR 超时 -> 不会误点编队。
#   所以这里不需要额外加识别节点。
#
# ★★ 「切换编队序号」是 **Or 节点**（2026-10 由单 any_of 改成**两个** any_of）：
#   Or 的命中由各 any_of[i] 自己的 expected 决定，**节点顶层的 expected 对 Or 无效**。
#   所以编队号必须写进**每一个** any_of 项里。
#   原来只往节点顶层写 expected —— 对 Or 节点等于没写，编队号永远匹配不上。
#
#   两个 any_of 的 roi 不同（135,129,57,167 与 132,125,77,566），对应
#   「编队列表的不同显示区域」，是**同一个语义**：同一个编队号要同时写进两项。
#
#   ⚠️ 这里**重建整个 any_of 数组**，而不是只盖 any_of[i].expected ——
#     不依赖 MAA 对「any_of 子项能不能被 override 合进去」的实现细节。
#     roi/threshold 等字段从 pipe 原值照抄，改的只有 expected。
# ---------------------------------------------------------------------------

# pipe 节点名（与 02_Endless_plant_Choose_ref.json 一一对应）
NODE_CLEAR_CARDS = "无尽挑战_识别开始战斗_清空卡牌"
NODE_CHOOSE_PLANTS = "无尽挑战_选取植物"
NODE_SWITCH_SQUAD = "无尽挑战_切换编队"
NODE_SQUAD_INDEX = "无尽_切换编队序号"

# 选卡 / 编队两条分支各自的下一步
NEXT_PICK_PLANTS = [NODE_CHOOSE_PLANTS]

# 「无尽_切换编队序号」的 Or 分支骨架（从 pipe 照抄，只留结构字段）。
#   两项的 roi 不同 = 覆盖编队列表的不同显示区域；expected 由 squad 注入。
#   ⚠️ 这两项必须与 02_Endless_plant_Choose_ref.json 的 any_of **保持同步**：
#      改了 pipe 里的 roi / 项数，这里也要跟着改，否则注入会把 pipe 的改动盖掉。
_SQUAD_ANY_OF = [
    {"recognition": "OCR", "roi": [135, 129, 57, 167], "threshold": 0.5},
    {"recognition": "OCR", "roi": [132, 125, 77, 566], "threshold": 0.5},
]


def _squad_any_of(expected: List[str]) -> List[Dict[str, Any]]:
    """按 expected 重建 Or 的 any_of 数组（每个分支都写入同一个 expected）。"""
    return [
        dict(entry, expected=list(expected))
        for entry in _SQUAD_ANY_OF
    ]


def _squad_param(squad: Optional[int]) -> Dict[str, Any]:
    """把编队号翻成一份 pipeline_override。

    squad 为 None -> 回滚成「选卡」分支（把 next 和 expected 都还原）。
    这样从「编队表」切回「选卡表」时不会残留上一次的编队设置。
    """
    if squad is None:
        return {
            NODE_CLEAR_CARDS: {"next": list(NEXT_PICK_PLANTS)},
            # ★ 回滚也要走 any_of：只写顶层 expected 对 Or 节点无效，清不掉编队号。
            NODE_SQUAD_INDEX: {"any_of": _squad_any_of([])},
        }
    return {
        NODE_CLEAR_CARDS: {"next": [NODE_SWITCH_SQUAD]},
        # expected 必须是**字符串列表**（OCR 的比对格式）；
        # 写成数字 MAA 会当成非法 expected，识别永不命中。
        # ★ Or 节点：两个 any_of 分支都要写，只写顶层 expected 是无效的。
        NODE_SQUAD_INDEX: {"any_of": _squad_any_of([str(squad)])},
    }


def _inject_squad(context: Context, squad: Optional[int]) -> None:
    """注入编队切换配置。失败只记日志，不影响主流程。"""
    try:
        context.override_pipeline(_squad_param(squad))
        if squad is None:
            _log("编队切换：未配置 -> 走选卡逻辑")
        else:
            _log(f"编队切换：已启用 -> 点「清空卡牌」后切到编队 {squad}")
    except Exception as e:
        _log(f"注入编队配置失败（{type(e).__name__}: {e}）")


def _ok() -> CustomAction.RunResult:
    """统一成功返回。

    MAA 的 CustomAction.RunResult 只有 success 字段；
    需要向下游传值时走 context.override_pipeline（见 JobSetLoad）。
    """
    return CustomAction.RunResult(success=True)


def _fail() -> CustomAction.RunResult:
    return CustomAction.RunResult(success=False)


# ---------------------------------------------------------------------------
# JobSetTick —— 过关计数器 +1（挂在「点继续挑战/继续训练」之后）
#
# ★★ 这是砍掉 OCR 之后，关卡号**唯一的推进点**。
#
#   用户给的语义（原话）：
#     「看点击继续战斗/继续训练那一个地方，只要点了就必定是下一关了，
#       所以可以在后面加计数器，刚好重开也不会去点这个地方」
#
#   为什么这个挂载点是可靠的：
#     · 「点继续挑战」= 这一局已经结束 → 点完必定进入下一关，**不需要判断**
#     · **重开不会走到这里**（重开走 `通用_重开_暂停`），所以天然不会误 +1
#       —— 这正是旧版需要 `rollback_one()` 手动退格的原因，现在不需要了
#
#   pipeline 里的接线：
#     无尽局内_继续挑战  (OCR 识别「继续挑战」-> Click)
#         next: [无尽局内_补给, 无尽挑战_选取植物_开始战斗]
#                                              ↑ 插到这两个之前
#     无尽训练_继续训练  (OCR 识别「继续训练」-> Click)
#         next: [无尽挑战_识别开始战斗_清空卡牌, 无尽挑战_训练完成]
#
#   ★ 必须插在 Click 之后、下一局动作之前，且在**所有**后继之前，
#     这样无论后面走哪条分支（补给/直接开战/回清空卡牌），计数都已经推进了。
# ---------------------------------------------------------------------------

# 计数器节点名（pipeline 里由本动作覆盖填充）
NODE_TICK = "无尽局内_过关计数"

# 需要计数的两个「结算按钮」节点 -> 它们点完之后要先去计数节点
TICK_SOURCES = ("无尽局内_继续挑战", "无尽训练_继续训练")


@AgentServer.custom_action("JobSetTick")
class JobSetTick(CustomAction):
    """过关一次：计数器 +1。

    ★ 不做任何判断 —— 走到这里就意味着「继续挑战/继续训练」已经被点过了，
      而点过就必定是下一关（用户明确的游戏语义）。

    参数（全部可选）：
        {"关卡": 55}    # 显式指定要设置的关卡；缺省则 = 当前 + 1
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        tr = _ensure_tracker(param)

        before = tr.count

        # 显式指定关卡（调试/纠错用）：直接设定，不走 +1
        raw = param.get("关卡")
        if raw not in (None, ""):
            try:
                lv = int(raw)
            except (TypeError, ValueError):
                lv = None
            if lv is not None:
                tr.reset(lv)
                _log(f"过关计数：由参数直接设定关卡 {before} -> {lv}")
                return _ok()

        lv = tr.tick()
        _log(f"过关计数：{before} -> {lv}（已点继续挑战/继续训练）")

        # ★ 把新关卡同步给下游的种植节点，保证 JobSetFight 用的是最新关卡。
        #   只在参数显式要求时同步？—— 不，这里每次都同步：
        #   因为下游 JobSetFight 会读 _STATE 里的 tracker，不读这个 param；
        #   这个 override 主要是给「日志/排查」与旧调用点看的。
        try:
            context.override_pipeline({
                "无尽局内_单次种植": {"custom_action_param": {"关卡": lv}},
                "无尽局内_循环种植": {"custom_action_param": {"关卡": lv}},
            })
        except Exception as e:
            _log(f"同步关卡失败（{type(e).__name__}: {e}）")
        return _ok()


def _tick_param() -> Dict[str, Any]:
    """计数器节点的 pipeline 定义（供 pipeline / 运行时共用）。"""
    return {
        "action": "Custom",
        "custom_action": "JobSetTick",
        "custom_action_param": {},
        "pre_delay": 0,
        "post_delay": 0,
        "next": [],
    }


# ---------------------------------------------------------------------------
# JobSetStatus —— 在「识别到开始战斗」时刷新用户可见的状态行
#
# ★ 用户要求（原话）：
#     「在选卡界面点击开始的时候刷新」
#     「顺便让日志显示计数器在日志弹窗，方便用户检查」
#
#   挂在「无尽挑战_识别开始战斗」（OCR 识别到「开始战斗」那一步）——
#   挂在**识别到**而不是**点击后**，因为点击可能带重试/延迟，时机不稳。
#
#   为什么选这个时机（而不是每次 +1 就刷）：
#     点「开始战斗」= 这一局即将开打，此刻的关卡/表/阵容**全都定下来了**，
#     这正是用户需要看到的信息。
#     而「+1 的那一刻」还在上一局的结算画面，接下来还要换卡，
#     刷出来的信息马上就会变 —— 等用户看到时已经过期。
#
#   ★ 额外好处：它天然覆盖了「换卡」这件事 ——
#     如果局外换卡换错了，用户在进局内**之前**就能在日志里发现。
#     这正好补上砍掉 OCR 之后失去的那部分自检能力。
# ---------------------------------------------------------------------------

NODE_START_FIGHT = "无尽挑战_识别开始战斗"


@AgentServer.custom_action("JobSetStatus")
class JobSetStatus(CustomAction):
    """刷新用户可见的状态行（关卡 / 当前表 / boss 或普通关）。

    参数（全部可选）：
        {"是boss关": false}   # 用来显示「本关: boss关/普通关」
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        tr = _ensure_tracker(param)

        is_boss = bool(param.get("是boss关"))

        # 表：优先用已锁定的（那才是本局真正在用的），否则按计数器算
        table = None
        if js is not None:
            idx = _STATE.get("table_index")
            if isinstance(idx, int) and 0 <= idx < len(js.tables):
                table = js.tables[idx]
            else:
                table = js.pick_table(tr.count)

        line = tr.status_line(table, is_boss)
        # 前缀让它在日志流里醒目、易搜
        _log(f"📋 {line}")
        return _ok()


# ---------------------------------------------------------------------------
# JobSetPlan —— 局外（选卡界面）判断「要不要换阵容」+ 播报状态
#
# ★ 这是把「换阵容」从局内搬到局外的**主路径**。
#
#   用户描述的设计（原话整理）：
#     「播报 + 判断当前阵容」
#     正赛：表就是当前的表 -> next 接「无尽挑战_选取植物_开始战斗」（直接开打）
#           不是的话 -> 覆盖（注入新表植物/编队）+ 接「识别开始战斗_清空卡牌」
#     训练：无论如何都点一次「清空卡牌」换阵，新表用新表的逻辑换阵
#
#   为什么要搬到局外：计数器在**开局前**就知道关卡号，
#   于是「该用哪张表」提前可算 —— 不用等打完一关在局内发现才重开。
#
#   ★ 为什么不再挂在「无尽挑战_识别开始战斗」上：
#     那个节点只是**任务开始的入口**，不在每关循环里
#     （正赛循环是 继续挑战 → 补给 → 选取植物_开始战斗；训练循环是 继续训练 → 清空卡牌），
#     挂在那儿根本报不到第 2 关之后。本节点在每关循环上，两种模式都会经过。
#
# ---------------------------------------------------------------------------
# ★ 分支实现：**enabled 闸门**（不用 run_task）
#
#   CustomAction 返回时**改不了自己的 next**。这里不去用 run_task 嵌套调用
#   （那会让 after 的 next 语义变得难懂，还容易「链断了 -> Task.Failed」），
#   而是用两个「直通节点」当闸门：
#
#       plan.next = [未变闸门, 变化闸门]         ← 无识别条件，默认 DirectHit
#       Python:  未变.enabled = not need
#                变化.enabled = need
#
#   这样整条分支结构**在 pipeline 图上是完整可见的**（check_graph.py 查得到），
#   而且只用 `next` + `enabled` 两个本项目已验证的机制。
# ---------------------------------------------------------------------------

# 默认闸门节点名（pipeline 里由本动作翻 enabled）
GATE_UNCHANGED = "无尽挑战_跳转_未变"
GATE_CHANGED = "无尽挑战_跳转_变化"


def plan_decision(training: bool, used: Optional[int], table_index: int) -> "Tuple[bool, str]":
    """局外换阵的判断（纯函数，便于离线自测）。

    参数
    ----
    training    : 是不是训练模式（true = 每关都重选阵容）
    used        : 当前**已注入**的是第几张表（0 起）；None = 没有记录
    table_index : 计数器算出来本关**该用**第几张表（0 起）

    返回 (need, reason)
    """
    if training:
        # 训练模式：每关都重选（用户要求「无论如何都点一次清空卡牌换阵」）
        return True, "训练模式：每关都重选阵容"
    if used is None:
        # 没有「已注入表」的记录 —— 说明 JobSetLoad 没跑到。
        # 保守起见换一次：宁多重选一次，也别用错阵容开打。
        return True, "无已注入表记录，保守换阵"
    if used != table_index:
        return True, f"表{used + 1} -> 表{table_index + 1}"
    return False, f"沿用表{table_index + 1}"


@AgentServer.custom_action("JobSetPlan")
class JobSetPlan(CustomAction):
    """局外决定换不换阵容，并播报当前关卡/表。

    参数（全部可选）：

        {
          "训练模式": false,   # true = 无条件换阵（每关都重选，训练模式用）
          "计数": false,       # true = 顺便把计数器 +1（把 tick 与 plan 合成一个节点时用）
          "是boss关": false,    # 仅用于播报显示
          "未变节点": "无尽挑战_跳转_未变",
          "变化节点": "无尽挑战_跳转_变化"
        }

    「表有没有变」是拿**计数器算出来的表**和**当前已注入的表**比：

        _STATE["plan_table_index"]  ← 由 _apply_table() 维护，
                                       JobSetLoad 预热时也会设为「预计表」

    所以它不是「猜」——起始关卡是真的，算出来的表就是对的表。
    """

    def run(self, context: Context, argv) -> Any:
        param = _parse_param(getattr(argv, "custom_action_param", None))
        js: Optional[JobSet] = _STATE.get("jobset")
        tr = _ensure_tracker(param)

        # ---- 可选：顺便计数（合并节点时用）----
        if param.get("计数"):
            before = tr.count
            lv_new = tr.tick()
            _log(f"过关计数：{before} -> {lv_new}（已点继续挑战/继续训练）")

        if js is None:
            _log("尚未载入作业集（JobSetLoad 未执行）-> 无法判断阵容")
            return _fail()

        lv = tr.count
        table = js.pick_table(lv)
        training = bool(param.get("训练模式"))

        # ---- 播报（每关都报；两种模式都经过本节点）----
        _log(f"📋 {tr.status_line(table, bool(param.get('是boss关')))}")

        # ★ 补给预告（只有正赛有补给，且只在 boss 关**前一关**出现）：
        #   用户说明：84 关末尾点继续挑战 -> 直接出现补给选择（因为 85 是 boss 关）。
        #   也就是说 count % 5 == 0 的那一关（= 即将开打的这一关）是 boss 关时，
        #   补给界面才会出现。
        #
        #   把它打出来是给用户**核对计数器**用的：
        #     日志说到 boss 关，但游戏里没出现补给 -> 计数器偏了（或起始关卡填错）
        #     游戏里出现了补给，但日志没说 boss 关 -> 同上
        if not training and lv > 0 and lv % _BOSS_SNAP == 0:
            _log(f"⚔️ 第 {lv} 关是 boss 关 -> 本关开始前应出现「补给选择」"
                 f"（没出现的话说明计数器偏了，请核对起始关卡）")

        # ---- 决定要不要换阵 ----
        used = _STATE.get("plan_table_index")
        need, reason = plan_decision(training, used, table.index)

        # ---- 需要换：注入新表的选卡植物 + 编队 ----
        if need:
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv
            # _apply_table 内部会记录 plan_table_index
            ok = JobSetStage._apply_table(context, js, table)
            if not ok:
                _log("⚠️ 换阵注入失败，仍会回「清空卡牌」重选，但选卡参数可能是旧的")

        # ---- 翻闸门（每次都写，避免残留上一次的判断）----
        #
        # ★ 「不给这个参数」和「显式给空串」是两件事：
        #     · 不带 "未变节点"      -> 用默认名（GATE_UNCHANGED）
        #     · "未变节点": ""       -> 这条模式**没有**这个闸门，跳过不写
        #   例：训练模式**永远**换阵，「未变」闸门根本用不上，
        #   传空串就不会去写它（免得凭空创建一个垃圾节点）。
        _gu = param.get("未变节点", GATE_UNCHANGED)
        gate_u = str(_gu).strip() if _gu else ""
        _gc = param.get("变化节点", GATE_CHANGED)
        gate_c = str(_gc).strip() if _gc else ""

        patch: Dict[str, Any] = {}
        if gate_u:
            patch[gate_u] = {"enabled": not need}
        if gate_c:
            patch[gate_c] = {"enabled": need}
        if patch:
            try:
                context.override_pipeline(patch)
            except Exception as e:
                _log(f"⚠️ 翻跳转闸门失败（{type(e).__name__}: {e}）"
                     f" -> 会走 pipeline 里的默认闸门状态")
        else:
            _log("⚠️ 未提供任何闸门节点名 -> next 分支不会被切换")

        _log(f"局外换阵：{reason} -> "
             + ("回「清空卡牌」重选阵容" if need else "直接「开始战斗」开打"))
        return _ok()


# ---------------------------------------------------------------------------
# JobSetLoad —— 挂在「无尽挑战_加载作业集代码」
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetLoad")
class JobSetLoad(CustomAction):
    """载入作业集 + 初始化关卡计数器。

    custom_action_param：
        {
          "作业集代码": "pvz_20260926_015808",   // 缺省读 jobs/current.json
          "起始关卡": 87,                          // ★ 由 MAA option「无尽_起始关卡」填入
          "重置": true                             // 重新开始任务 -> 清空计数器
        }

    ★ 「起始关卡」是**必需**的：砍掉 OCR 后关卡号只由它 + 计数器推出。
      没填 -> 计数器从 0 起 -> 表选择落回第 1 张表（日志会告警）。
      option 侧接线见 task/Endless/framework/frame/option.json 的「无尽_起始关卡」。

    ★ 旧版的计数器调参键（初始分/封顶分/加分/扣分/容差）**已废弃** ——
      没有 OCR 就没有得分期望。传了也会被忽略。

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
        #
        # ★ 起始关卡由用户在 MAA option 里填（他会在 option 界面自己加输入框）。
        #   有了它，**开局前就知道当前在第几关**，于是：
        #     · 能直接算出该用哪张表（不用等进局内识别）
        #     · 换卡可以发生在**局外**（这就是「不重开」的关键）
        tr = from_params(param)
        if tr.count > 0:
            _log(f"起始关卡={tr.count}（由参数给定，本局不再做 OCR 识别）")
        else:
            _log("⚠️ 未给定起始关卡 -> 计数器从 0 起。"
                 "请在 option 里填「起始关卡」，否则表选择会落回第 1 张表")
        _STATE["tracker"] = tr

        # ---- 当前阵容 ----
        #
        # ★ 这里**故意不锁表**（table_index 保持 None）。
        #   原因：JobSetLoad 只是「预热」—— 它按起始关卡预估一张表，
        #   把选卡/编队参数先注入好，让首帧进选卡界面时就有东西可用。
        #   但「本关用哪张表」的**最终决定权**在 JobSetStage / JobSetFight
        #   （它们才知道是不是 boss 关、以及换阵流程走到哪一步）。
        #
        #   把 table_index 保持 None -> 首次进关一律按「第一次进表」处理，
        #   不会因为「预估表 ≠ 实际表」而误触发换阵容。
        _STATE["table_index"] = None

        # ★ 有了计数器，这里的「预估」不再是「猜」——
        #   起始关卡就是真实关卡，所以算出来的表就是对的表。
        lv = tr.count if tr.count > 0 else 1
        table = js.pick_table(lv)
        _log(
            f"载入完成：起始关卡={lv} "
            f"-> 预计表{table.index + 1}（关卡 {table.from_level} 起）"
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

        # ★ 编队切换：同样按「预计表」先注入一次。
        #   这样首帧进选卡界面时，「清空卡牌」的 next 就已经是对的
        #   （选卡 or 切换编队），不会先走错分支再纠正。
        _inject_squad(context, table.squad)

        # ★ 记下「当前已注入的是哪张表」——局外换阵节点（JobSetPlan）
        #   靠它判断「表有没有变」。
        #   这里是**唯一**不走 _apply_table 的注入路径（预热），所以手动记一笔。
        _STATE["plan_table_index"] = table.index

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



# ---------------------------------------------------------------------------
# JobSetFight —— 局内种植：把当前表的链翻成 DSL 注入组合动作节点
# ---------------------------------------------------------------------------

# 组合动作节点名模板（03_Endless_fight/）
FIGHT_NODE_TPL = "无尽挑战_{slot}组合动作_{kind}"
# 通用动作（点波/捡豆/加速）：无格子的虚拟槽位，节点名独立
GA_NODE_TPL = "无尽挑战_通用动作_{kind}"
# ★ 三条链各一个节点（见 0301Endless_fight_1.json）
CHAIN_NODE_TPL = "无尽挑战_组合动作_{kind}"
KIND_CN = {"once": "单次", "loop": "循环", "end": "收尾"}

# ★ 组合动作里的 ref 触发节点（识别命中即停本批、跟随 next）
REF_SETTLE = "无尽局内_继续挑战"      # 结算画面（正赛）
REF_LAST_WAVE = "无尽挑战_收尾"       # 最后一波（僵尸头像）-> 跳收尾链
REF_TRAIN = "无尽训练_继续训练"       # 结算画面（训练模式）

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
            # ★ 编队：首次锁定时也注入，保证后续重开走对分支
            _inject_squad(context, table.squad)
        elif prev_index != table.index:
            _log(
                f"★ 阵容切换：表{prev_index + 1} -> 表{table.index + 1}"
                f"（关卡 {table.from_level} 起，植物 {table.plants}）"
            )
            # 推进表指针 —— 换阵容流程里**唯一**推进它的地方。
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
            # ★ 编队：换阵容时**必须**重新注入 —— 这正是「换阵用编队」的入口。
            #   重开后跳回「清空卡牌」，那里会按这里注入的 next 决定走选卡还是切编队。
            _inject_squad(context, table.squad)

        _log(
            f"关卡{lv} {kind_cn} -> 表{table.index + 1} "
            f"| once_chain={len(rules['once_chain'])}段 "
            f"loop_chain={len(rules['loop_chain'])}段 "
            f"end_chain={len(rules['end_chain'])}段"
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
                    "无尽挑战_收尾": {"enabled": False},
                })
                return _ok()

        coords = _dsl.load_coords()
        if not coords:
            _log("坐标表为空（agent/assets/resource/coords.json 未找到）")

        # ★ 三条链各一个节点（不再按段拆分）
        #
        # 整条链的动作拼成一条 BatchSwipe DSL，一次跑完。
        # 中途靠 every:N 定期识别「有没有结算」，命中即停本批、跟随 next。
        # ★ 识别结算速率（网页端「高级设置」，默认 10）
        every_n = int(table.raw.get("everyN") or 10)
        if every_n < 1:
            every_n = 10

        # 收尾链是否存在（决定组合动作里要不要挂「最后一波」触发）
        # ★ boss 关不能有收尾：boss 关一律不跑收尾链（用户要求）。
        _end_chain = rules.get("end_chain") or []
        has_end = bool(_end_chain) and not is_boss

        chain_nodes = self._build_chain_nodes(
            rules, coords, swipe_ms, interval, every_n, has_end)

        once_node = chain_nodes.get("once")
        loop_node = chain_nodes.get("loop")
        end_node = chain_nodes.get("end")

        # ★ boss 关不能有收尾：boss 关一律不跑收尾链（用户要求）。
        if is_boss:
            end_node = None
        # has_end 已在上面（构建组合动作前）算过，用于决定 ref 触发

        # ★ 收尾链的可调参数（网页端「棋盘下侧」编辑，作业集导出）：
        #   · 「收尾前等待」   = 「无尽挑战_收尾」检测节点的 post_delay（默认 15000ms）
        #   · 「收尾超时时间」 = **收尾链末尾追加的 sleep 秒数**（默认 6000ms -> 6s）
        #   · 「收尾超时后动作」 = sub（执行子动作）/ restart（重开）
        #   · 「子动作」       = once（单次动作）/ loop（循环动作）/ end（收尾动作）
        def _num(v: Any, default: int) -> int:
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return default

        end_post_delay = _num(table.raw.get("endPostDelay"), 15000)
        end_last_post_delay = _num(table.raw.get("endLastPostDelay"), 6000)
        end_after_action = str(table.raw.get("endAfterAction") or "sub").strip()
        end_sub_action = str(table.raw.get("endSubAction") or "loop").strip()
        if end_sub_action not in ("once", "loop", "end"):
            end_sub_action = "loop"

        override: Dict[str, Any] = {}

        # ---- 1) 三个组合动作节点 ----
        #
        # next 结构：
        #     ["无尽局内_继续挑战",   <- 结算出现了就点它（放第一位，命中即走）
        #      "无尽挑战_收尾",       <- 没结算但检测到最后一波 -> 跳收尾链
        #      <跑完这条链之后去哪>]  <- 没结算也没到最后一波 -> 继续下一环
        #
        #   单次链 -> 无尽局内_循环种植
        #   循环链 -> 自己（自循环）
        #   收尾链 -> 「收尾超时后动作」（sub/restart）
        if once_node:
            nxt = ["无尽局内_继续挑战"]
            if has_end:
                nxt.append("无尽挑战_收尾")
            nxt.append("无尽局内_循环种植")
            override[once_node["node"]] = {
                "action": "Custom",
                "custom_action": "BatchSwipe",
                "custom_action_param": once_node["dsl"],
                "pre_delay": 0,
                "post_delay": 0,
                "next": nxt,
            }

        if loop_node:
            nxt = ["无尽局内_继续挑战"]
            if has_end:
                nxt.append("无尽挑战_收尾")
            nxt.append(loop_node["node"])          # 自循环
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
            #   靠 next 自循环等待结算/收尾。sleep 稍长避免空转时疯狂刷屏。
            nxt = ["无尽局内_继续挑战"]
            if has_end:
                nxt.append("无尽挑战_收尾")
            nxt.append("无尽挑战_组合动作_循环")  # 自循环
            override["无尽挑战_组合动作_循环"] = {
                "action": "Custom",
                "custom_action": "BatchSwipe",
                "custom_action_param": "sleep:5",
                "pre_delay": 0,
                "post_delay": 0,
                "next": nxt,
            }

        if end_node:
            # 收尾链跑完：先看结算，没结算再走「收尾超时后动作」
            if end_after_action == "restart":
                after = ["无尽挑战_收尾重开"]
            elif end_sub_action == "once":
                after = ["无尽局内_单次种植"]
            elif end_sub_action == "end":
                after = ["无尽挑战_收尾"]
            else:
                after = ["无尽局内_循环种植"]
            # ★「收尾超时时间」不再是 post_delay，而是末尾的 sleep 动作
            dsl = end_node["dsl"]
            if end_last_post_delay > 0:
                dsl = f"{dsl};sleep:{end_last_post_delay / 1000.0:g}" if dsl \
                    else f"sleep:{end_last_post_delay / 1000.0:g}"
            override[end_node["node"]] = {
                "action": "Custom",
                "custom_action": "BatchSwipe",
                "custom_action_param": dsl,
                "pre_delay": 0,
                "post_delay": 0,
                "next": ["无尽局内_继续挑战"] + after,
            }

        # ---- 2) 链首节点：各自指向自己的那条链 ----
        once_next = [once_node["node"]] if once_node else ["无尽局内_循环种植"]
        # ★ 循环链为空也要进 —— 上面的 override 已经把它写成了
        #   「sleep:0.1 空动作 + 自循环等待结算」，所以这里永远指向它。
        #   以前是 loop_node 为 None 就给空 next -> 链断 -> Task.Failed
        #   （表现为「一到循环种植就停了」）。
        loop_next = [CHAIN_NODE_TPL.format(kind=KIND_CN["loop"])]

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

        # ---- 3) 「无尽局内_继续挑战」——**不再覆盖** ----
        #
        # 这个节点的内容已经写死在 03_Endless_fight/0300Endless_fight.json：
        #     next = ["无尽局内_补给", "无尽挑战_选取植物_开始战斗"]
        # 曾经这里用 override 重写了一遍（内容与 pipe 完全相同），属于无用功，
        # 而且**有害**：override_pipeline 对 next 是整体替换，会顶掉
        # 「无尽模式=训练模式」任务选项里配的
        #     next = ["无尽训练_继续训练"]
        # 导致训练模式永远走不到「继续训练」。
        #
        # 教训：**不要覆盖 pipeline 里已经正确的内容** ——
        #       任务选项（task option）的 pipeline_override 优先级无法被 custom 感知，
        #       custom 一旦写同名字段就会把它顶掉。
        #       需要调整落点时，改 pipe JSON，而不是在 custom 里重写。

        # ---- 3b) 收尾检测节点：检测到最后一波 -> 执行收尾链 -> 等结算 ----
        #
        # 「无尽挑战_收尾」是 TemplateMatch 识别（僵尸头像出现在右上角 = 最后一波）。
        #   · 配了收尾链（棋盘上有「收尾」形态的落子）-> enabled=True，next 指向收尾链第一段；
        #   · 没配 -> enabled=False（保持 pipeline 里的空壳，不参与）。
        # post_delay 由网页端「棋盘下侧」编辑（默认 15000ms）。
        #
        # override_pipeline 是深合并：这里只改 enabled / next / post_delay，
        # 识别配置（recognition=TemplateMatch / template / roi / green_mask）
        # 沿用 pipeline 里 03-1-01 写死的值。
        if has_end:
            override["无尽挑战_收尾"] = {
                "enabled": True,
                "post_delay": end_post_delay,
                "next": [end_node["node"]],
            }
        else:
            override["无尽挑战_收尾"] = {"enabled": False}

        # ---- 3c) 收尾重开节点：**已 pipe 化，运行时不再注入** ----
        #
        # 「无尽挑战_收尾重开」现在是一个纯 pipe 节点（03-1-01）：
        #     next   = ["通用_重开_暂停"]
        #     anchor = {"下一个动作": "无尽挑战_识别开始战斗_清空卡牌"}
        # 重开完靠 [Anchor]下一个动作 回到锚点直接开局。
        #
        # 曾经这里用 CustomAction（JobSetEndRestart）跑 run_task 串两次调用，
        # 但 run_task 是同步的，pipe 的 next 表达不了——于是写了 40 行 Python。
        # 改成 pipe 后那 40 行完全不需要：next + [Anchor] 天然能表达。
        #
        # ★ 唯一还需要运行时管的是 enabled：
        #   壳节点在 pipeline 里是 enabled=false（避免没配收尾链时参与识别），
        #   只有作业集选了「重开」且配了收尾链时才启用。
        if has_end and end_after_action == "restart":
            override["无尽挑战_收尾重开"] = {"enabled": True}
        else:
            override["无尽挑战_收尾重开"] = {"enabled": False}

        # ---- 4) 自检：注入的 next 目标是否都存在 ----
        #
        # 踩过的坑：曾把「无尽局内_继续挑战」的 next 指向一个已被注释掉的节点，
        # 结果点完继续挑战后找不到后继 -> 3ms 内整条任务结束（表现为 Task.Failed）。
        # 这里在注入前先把可疑目标挑出来写日志，避免又静默断链。
        self._warn_missing_targets(context, override)

        try:
            context.override_pipeline(override)
            _log(f"已注入 {len(override)} 个节点")
            # 打印三条链各自的动作数
            for kind, cn in (("once", "单次"), ("loop", "循环"), ("end", "收尾")):
                node = chain_nodes.get(kind)
                if not node:
                    _log(f"  [{cn}链] （空）")
                    continue
                n = len([x for x in node["dsl"].split(";") if x.strip()])
                _log(f"  [{cn}链] {node['node']}  共 {n} 条动作")
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
    def _build_chain_nodes(
        cls,
        rules: Dict[str, Any],
        coords: Dict[str, Any],
        swipe_ms: int,
        interval: Any,
        every_n: int = 10,
        has_end: bool = False,
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

        # ★ 三条链各一个节点：整条链的动作拼成**一条** BatchSwipe DSL。
        #   节点名固定（见 0301Endless_fight_1.json）：
        #       无尽挑战_组合动作_单次 / _循环 / _收尾
        #
        #   为什么不按段拆节点（旧做法）：
        #     旧做法每段一个节点、靠 next 串起来，节点数随链长膨胀（20+），
        #     而且每段跑完都要回「继续挑战」识别一次，开销大。
        #     现在整条链一次跑完，中途靠 every:N 定期识别结算
        #     （识别结算速率在网页端「高级设置」里配，默认 10）。
        for kind, field in (
            ("once", "once_chain"),
            ("loop", "loop_chain"),
            ("end", "end_chain"),
        ):
            chain = rules.get(field) or []
            parts: List[str] = []

            for seg in chain:
                key = str(seg.get("key") or "").strip()
                typ = str(seg.get("type") or "plant").lower()

                # ---- 通用动作段（点波/捡豆/加速/等待/切换形态）：没有格子，整段 = 一条 DSL ----
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
                        parts.append(r["dsl"])
                    for m in r["missing"]:
                        _log(f"  ⚠️ 通用动作跳过：{m}")
                    continue

                # ★ 只对**植物槽**做白名单校验。
                #   落子动作（feed/shovel/tapcell/未来扩展）不在 _SLOT_NODE_NAME 里，
                #   以前这里一刀切 `continue` 会把它们**静默丢弃** ——
                #   表现为「网页端配了、跑起来没执行」，非常难查。
                #   现在：植物槽必须有名（否则是真错误），其余交给下面的
                #   通用起点逻辑处理（找不到起点 -> 编译成 click:格子）。
                _is_plant_slot = key.startswith("card") or key.startswith("patch_slot")
                if _is_plant_slot and key not in _SLOT_NODE_NAME:
                    _log(f"  ⚠️ 未知植物槽 {key!r}，跳过")
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

                # 该段每个落点的「动作后等待」秒数（与 cells 等长，来自 waitAfter）
                waits = seg.get("waits") or []

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
                    except (TypeError, ValueError):
                        sec = 0.0
                    if sec > 0:
                        parts.append(f"sleep:{sec:g}")

            body = ";".join(parts)
            if not body:
                continue
            # ★ 识别触发（放在动作之前，是「触发条件」不是动作）：
            #   ref:无尽局内_继续挑战  —— 结算画面出现 -> 停本批、跟随 next
            #   ref:无尽挑战_收尾      —— 检测到最后一波 -> 停本批，next 里会跳收尾链
            #   ref:无尽训练_继续训练  —— 训练模式的结算按钮（正赛下识别不到，无害）
            #
            #   这几个 ref 复用 pipe 节点里已定义的识别配置，无需写 ROI。
            #   收尾链自己**不加**「收尾」触发（它已经在收尾链里了，避免自跳）。
            refs: List[str] = [REF_SETTLE]
            if kind != "end" and has_end:
                refs.append(REF_LAST_WAVE)
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

        # ---- 0) 本次任务是否首次进入阶段确认 ----
        # ★ 首次进入时重置表指针，避免沿用上一次任务的表。
        first = not bool(_STATE.get("stage_seen"))
        if first:
            _log("本次任务首次进入阶段确认")
            if param.get("重置阶段", True):
                _STATE["table_index"] = None
                _STATE["seen_stages"] = set()

        # ---- 1) 不再识别天数：关卡号完全来自计数器 ----
        #
        # ★★ 这是本轮重构的核心：**砍掉 OCR 识别**。
        #
        #   旧流程：进局内 -> OCR 读天数 -> 融合/计分 -> 判断该不该换表
        #           -> 发现该换 -> 重开 -> 回局外换卡
        #   新流程：局外已知关卡（用户填的起始关卡 + 计数器）
        #           -> 开局前就知道该用哪张表 -> 直接在局外换卡
        #
        #   之所以能砍：OCR 读数字不稳（实测 81 读成 21、87 读成 89），
        #   而「关卡号」其实可以完全由「起始关卡 + 过关次数」推出来，
        #   不需要去读屏幕上的数字。
        #
        #   为什么这样就够：本关是不是 boss 关，靠的是**头像模板匹配**
        #   （僵王的头 / 功夫僵王），是「是/否」判断而非「读一个数」，
        #   误差模型完全不同 —— 它足够可靠，可以当作唯一的外部校准信号。
        #
        # ★ boss 关判定仍由 pipeline 侧完成（「无尽挑战_局内识别boss关」）：
        #   调用顺序：进入到局内 -> 识别boss关(命中) -> 无尽挑战_确认阶段_BOSS -> 本动作
        is_boss = bool(param.get("是boss关"))

        # ---- 1b) boss 关：计数器对齐到最近的 5 的倍数（唯一的自愈机制）----
        #
        # 依据（用户给的规律）：boss 关恒定出现在 5 的倍数关。
        # ★ 这是砍掉 OCR 之后**唯一**的校准点 —— 每隔 5 关自动纠一次偏。
        #   偏差 <= 2 能纠回正确值；更大则会对到相邻 boss（用户已知并接受，
        #   属于「起始关卡填错」的问题），日志会如实提示。
        if is_boss:
            snap = tr.snap_boss()
            # ★ 用户可见日志：每次进 boss 关都输出一行，方便他核对
            for _line in tr.snap_boss_message(snap):
                _log(_line)

        # ---- 2) 取当前关卡（来自计数器，不再 observe OCR）----
        lv = tr.count
        _STATE["stage_seen"] = True
        _log(f"计数器：{tr.describe()}")

        # ---- 3) 判断当前阶段 ----
        table = js.pick_table(lv)
        prev = _STATE.get("table_index")
        seen: set = _STATE.setdefault("seen_stages", set())

        to_switch = False
        reason = ""

        if param.get("重开"):
            to_switch = True
            reason = "参数强制"
        elif prev is None:
            # ★ 首次进关：跟「局外已注入的表」（plan_table_index）比，
            #   不是跟 None 比。局外 JobSetLoad 已经按计数器注入了植物，
            #   所以这里应该比对「局外配的表」和「计数器算出的表」是否一致。
            used = _STATE.get("plan_table_index")
            if used is not None and used != table.index:
                to_switch = True
                reason = (f"局外已配表{used + 1}，"
                          f"但计数器算出表{table.index + 1}（关卡{lv}）")
            else:
                reason = f"首次进关落在表{table.index + 1}（关卡{lv}），不换阵容"
        elif prev != table.index:
            if table.index in seen:
                reason = f"表{table.index + 1} 进入过，不换"
            else:
                to_switch = True
                reason = f"进入表{table.index + 1}（关卡 {table.from_level} 起）"

        if to_switch:
            # ★ 换阵容**不改计数器**。
            #
            #   旧版这里要 `rollback_one()`，是因为：重开后会再识别一次天数，
            #   把计数多推一格，所以要退一格抵消。
            #   现在没有识别了 —— 计数器只在「点继续挑战」时 +1，
            #   而换阵容走的是另一条路（局外换卡），**不会碰计数器**。
            #   所以既不该退也不该进，保持原值。
            _log(f"★ 换阵容（{reason}）：计数器保持 {lv}")

            # 锁定目标表：**先写 state 再注入**，保证选卡与种植用的是同一张表。
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv
            seen.add(table.index)

            ok = self._apply_table(context, js, table)

            # ★ 先重开（退出当前关回到局外），再跳回清空卡牌。
            #   清空卡牌是局外节点，必须先重开退出局内才能工作。
            restart_node = str(param.get("通用重开节点") or "通用_重开_暂停")
            _log(f"换阵容 -> 重开（{restart_node}）退出当前关")
            try:
                context.run_task(restart_node)
                _log("重开完成")
            except Exception as e:
                _log(f"重开失败（{type(e).__name__}: {e}）")
                return _fail()

            # 重开后再跳回清空卡牌
            node = str(param.get("重开后回跳节点") or "无尽挑战_识别开始战斗_清空卡牌")
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
        """从 OCR 文本里取出关卡数字。

        ★ 现在 roi 只覆盖**数字区**（不再包含「第 / 关」），所以优先走纯数字路径。
          但保留「第N关 / 第N天」的兼容分支 —— roi 万一放宽了也不会失效。

        真实日志出现过这些形态：
            "55"                  纯数字（现在的常态）
            "第55关" / "第 55 关"   带「第N关」（旧 roi 会读到）
            "亚瑟的挑战-第8关"      带前缀的关卡名

        规则（按优先级）：
          1. 整串就是个纯数字 -> 直接用（现在的常态）
          2. 「第 <数字> 关」
          3. 「第 <数字> 天」
          4. 取最后一段里的数字（兼容 "A-B第8关"）
          5. 整串里最后一个数字
        """
        import re as _re

        s = text.strip()
        if not s:
            return None

        # 1) 纯数字（只 OCR 数字区时的常态）
        if _re.fullmatch(r"\d{1,3}", s):
            return int(s)
        # 2) 第N关
        m = _re.search(r"第\s*(\d{1,3})\s*关", s)
        if m:
            return int(m.group(1))
        # 3) 第N天
        m = _re.search(r"第\s*(\d{1,3})\s*天", s)
        if m:
            return int(m.group(1))
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

    @staticmethod
    def _apply_table(context: Context, js: JobSet, table: Any) -> bool:
        """把指定表的阵容与种植逻辑注入 pipeline。

        ★ 唯一职责是「注入」，并顺手记下**当前已注入的是哪张表**
          （`_STATE["plan_table_index"]`）—— 局外换阵节点靠它判断
          「表有没有变」。所有换阵路径都走这里，所以记录不会漏。
        """
        try:
            context.override_pipeline({
                "无尽挑战_选取植物": {
                    "custom_action_param": json.dumps(
                        {"植物列表": table.plants}, ensure_ascii=False
                    )
                }
            })
            _log(f"已切换到表{table.index + 1}：选卡植物={table.plants}")
            # ★ 编队：切表时一并注入（换阵用编队时的另一条入口）
            _inject_squad(context, table.squad)
            # ★ 记录「当前已注入的表」——给 JobSetPlan 判断表有没有变
            _STATE["plan_table_index"] = table.index
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

