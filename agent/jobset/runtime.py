# -*- coding: utf-8 -*-
"""作业集运行时 —— 与 MaaFramework 的胶水层（CustomAction 注册）。

注册的动作
----------
JobSetLoad        载入作业集、初始化关卡计数器，把「当前阵容」暴露给后续节点。
                  挂在空壳节点「无尽挑战_加载作业集代码」上。
JobSetStage       纯计数器阶段确认：取关卡 -> boss 对齐 -> 必要时换阵容重开。
                  挂在「无尽挑战_确认自己当前阶段」。
JobSetFight       局内种植：把当前表的预编译 override（compiled 块）零翻译注入，
                  并覆盖补给链顺序。挂在「无尽局内_单次/循环种植」。
                  （链 -> DSL 的编译在作业集保存时由 compile.py 完成。）
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
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction
from maa.custom_recognition import CustomRecognition

from .engine import JobSet, JobSetError, load_jobset, RESOURCE_DIR
from .level_tracker import LevelTracker, from_params
from .level_tracker import BOSS_SNAP as _BOSS_SNAP
# 链节点名常量（日志打印用）；编译器本体在 compile.py（pvz.py 保存时调用）
from .compile import CHAIN_NODE_TPL, KIND_CN

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
    # ★ 本次任务里 JobSetStage 是否已经跑过第一次。
    #   首次进入阶段确认时重置表指针，避免沿用上一次任务的表。
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


def _prewarm_for_level(context: Context, js: JobSet, lv: int) -> None:
    """按关卡 lv 预热选卡 / 编队注入（JobSetLoad 与 JobSetAutoCount 共用）。

    ★ 故意**不锁表**（不动 table_index）：「本关用哪张表」的最终决定权
      在 JobSetStage / JobSetFight（它们才知道是不是 boss 关、换阵走到哪）。
      这里只是把「预计表」的选卡植物 + 编队注入好，让首帧进选卡界面
      就有正确的东西可用。

    ★ plan_table_index 会记下预热的是哪张表 —— 局外换阵节点
      （JobSetPlan）靠它判断「表有没有变」。这是不走 _apply_table 的
      注入路径，所以手动记一笔。
    """
    lv = lv if lv > 0 else 1
    table = js.pick_table(lv)
    _log(f"预热：关卡={lv} -> 预计表{table.index + 1}（关卡 {table.from_level} 起）")

    # ★ 首关若是 boss 关（5 的倍数，与局内判定的计数口径一致），
    #   预热也要用 boss 阵容 —— 否则 boss 单独配卡时首关会错选普通关植物。
    _pw_boss = (lv % _BOSS_SNAP == 0)

    # 选卡参数先用「预计表」注入，保证首帧进选卡界面时有植物可选
    try:
        context.override_pipeline({
            "无尽挑战_选取植物": {
                "custom_action_param": json.dumps(
                    {"植物列表": table.eff_plants(_pw_boss)}, ensure_ascii=False
                )
            }
        })
        _log(f"已注入选卡参数（预计，{'boss 关' if _pw_boss else '普通关'}）："
             f"{table.eff_plants(_pw_boss)}")
    except Exception as e:
        # override 失败不该致命：日志留痕，继续走
        _log(f"注入选卡参数失败（{type(e).__name__}: {e}），下游可能拿到空参数")

    # ★ 编队切换：同样按「预计表」先注入一次。
    #   这样首帧进选卡界面时，「清空卡牌」的 next 就已经是对的
    #   （选卡 or 切换编队），不会先走错分支再纠正。
    _inject_squad(context, table.eff_squad(_pw_boss))

    _STATE["plan_table_index"] = table.index


def _ensure_tracker(param: Dict[str, Any]) -> LevelTracker:
    """取得/初始化本进程的计数器。"""
    tr = _STATE.get("tracker")
    if tr is None:
        tr = from_params(param)
        _STATE["tracker"] = tr
        _log("计数器已初始化")
    return tr


_LEVEL_TEXT_RE = re.compile(r"(\d+)")


def _parse_level_text(text: str) -> Optional[int]:
    """从「第87关」之类的关卡文本里解析关卡号；解析不出返回 None。"""
    if not text:
        return None
    m = _LEVEL_TEXT_RE.search(str(text))
    if not m:
        return None
    try:
        lv = int(m.group(1))
    except ValueError:
        return None
    return lv if lv > 0 else None


def _reco_text(argv: Any) -> Optional[str]:
    """从 custom action 的 argv 里取本次识别的 OCR 文本（best > filtered > all）。

    ★ 节点本身是 OCR 识别（expected=["第"]），命中后 MAA 会把识别详情
      一起传给 action（reco_detail）—— 不用自己再截图识别一次。
    """
    reco = getattr(argv, "reco_detail", None)
    if reco is None:
        return None
    cands = []
    best = getattr(reco, "best_result", None)
    if best is not None:
        cands.append(best)
    cands.extend(getattr(reco, "filtered_results", None) or [])
    cands.extend(getattr(reco, "all_results", None) or [])
    for r in cands:
        t = getattr(r, "text", None)
        if t:
            return str(t)
    return None


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

# ---- 无尽局外 80 选卡（作业集级 outer_pick 的注入目标）----
# pipe 文件：06_Endless_80plant_choose/0601~0603
NODE_OUTER_GATE = "无尽挑战_检查是否需要选植物"              # 闸口：OCR「选择挑战植物」，next 由 runtime 按模式分流
NODE_OUTER_PICK = "无尽80植物编辑方案1_准备选择80个植物"      # SelectPlants custom（无尽局外选卡）
NODE_OUTER_AUTO_ENTRY = "无尽挑战_80植物界面_选项1_清空植物"  # auto：清空链入口
NODE_OUTER_ONECLICK = "无尽选卡_80个植物_一键选择"            # oneclick：点一键选择（自带 next -> 确定）
NODE_OUTER_CONFIRM = "无尽选卡_80个植物_确定"                 # 确定按钮（next -> 识别开始战斗）
_OUTER_PICK_PIPE_PARTS = (
    "pipeline", "Endless_ref.json", "06_Endless_80plant_choose", "0601_80plant_choose_1.json",
)


def _apply_outer_pick(context: Context, js) -> None:
    """把作业集级 outer_pick（无尽局外 80 选卡）注入 pipeline。失败只记日志。

    按 mode 覆盖「无尽挑战_检查是否需要选植物」的 next 分流：
      - auto:     next -> 清空链入口（清空 -> 全部植物 -> SelectPlants 自动选 ->
                  确定），并把 plants 合并进 pipe 节点**现有的**
                  custom_action_param 注入（搜索roi/滑动/回顶/匹配阈值是用户
                  在 pipe 里实测的，必须保留；custom_action_param 是整体替换，
                  所以先读 pipe 再合并）；
      - oneclick: next -> 「无尽选卡_80个植物_一键选择」（它自带 next -> 确定）；
      - confirm:  next -> 「无尽选卡_80个植物_确定」—— 复用当前配置，直接确定。

    auto 但 plants 为空（旧作业集/没配）-> 退化为复用当前配置 + 告警，
    保证流程不会停在选卡界面没人点确定。
    """
    mode = getattr(js, "outer_pick_mode", "auto")
    plants = getattr(js, "outer_pick_plants", []) or []

    if mode == "oneclick":
        try:
            context.override_pipeline({
                NODE_OUTER_GATE: {"next": [NODE_OUTER_ONECLICK]},
            })
            _log("局外选卡=一键选取：「选择挑战植物」-> 一键选择 -> 确定")
        except Exception as e:
            _log(f"局外选卡注入失败（{type(e).__name__}: {e}）")
        return

    if mode == "confirm":
        try:
            context.override_pipeline({
                NODE_OUTER_GATE: {"next": [NODE_OUTER_CONFIRM]},
            })
            _log("局外选卡=复用当前配置：「选择挑战植物」-> 直接点确定")
        except Exception as e:
            _log(f"局外选卡注入失败（{type(e).__name__}: {e}）")
        return

    # auto：闸口 -> 清空链；plants 合并进 pipe 现有参数（坐标是用户实测的，不能丢）
    if not plants:
        _log("局外选卡=按列表自动选取，但作业集 outer_pick.plants 为空 —— "
             "退化为「复用当前配置」直接点确定"
             "（要自动选：去网页端「局外选卡」配置后重新保存作业集）")
        try:
            context.override_pipeline({
                NODE_OUTER_GATE: {"next": [NODE_OUTER_CONFIRM]},
            })
        except Exception as e:
            _log(f"局外选卡注入失败（{type(e).__name__}: {e}）")
        return
    merged = {"无尽局外选卡": True, "植物列表": plants}
    pipe_path = RESOURCE_DIR.joinpath(*_OUTER_PICK_PIPE_PARTS)
    try:
        with open(pipe_path, "r", encoding="utf-8") as f:
            node = (json.load(f) or {}).get(NODE_OUTER_PICK) or {}
        base = node.get("custom_action_param")
        if isinstance(base, str):
            base = json.loads(base)
        if isinstance(base, dict):
            merged = {**base, **merged}     # 植物列表/开关覆盖，坐标参数保留
    except Exception as e:
        _log(f"读取 80 选卡 pipe 参数失败，坐标将用 custom 缺省值"
             f"（{type(e).__name__}: {e}）")
    try:
        context.override_pipeline({
            NODE_OUTER_GATE: {"next": [NODE_OUTER_AUTO_ENTRY]},
            NODE_OUTER_PICK: {
                "custom_action_param": json.dumps(merged, ensure_ascii=False),
            },
        })
        _log(f"局外选卡=按列表自动选取：「选择挑战植物」-> 清空 -> 自动选 "
             f"{len(plants)} 个 -> 确定；已注入 {plants[:5]}"
             f"{'...' if len(plants) > 5 else ''}")
    except Exception as e:
        _log(f"局外选卡注入失败（{type(e).__name__}: {e}）")


# 选卡 / 编队两条分支各自的下一步
NEXT_PICK_PLANTS = [NODE_CHOOSE_PLANTS]

# 「开始战斗」节点（跳过选卡时「清空卡牌」直跳这里）
NODE_BATTLE_START = "无尽挑战_选取植物_开始战斗"

# 「清空卡牌」节点 pipe 原值照抄（02_Endless_plant_Choose_ref.json）——
# 阵容不变时 runtime 把它改成 DirectHit+DoNothing 直跳开始战斗（跳过清空/选卡/编队），
# 阵容变了要还原成这套原值。
# ⚠️ 改了 pipe 里这个节点的 recognition/roi/action/next，这里必须同步。
_CLEAR_CARDS_ORIG = {
    "recognition": "OCR",
    "expected": ["清空卡牌"],
    "roi": [22, 660, 75, 27],
    "action": "Click",
    "next": [NODE_CHOOSE_PLANTS],
}


def _inject_lineup(context: Context, table, is_boss: bool) -> None:
    """按关卡形态注入阵容（选卡植物 + 编队），并维护「当前生效阵容」签名。

    ★ 签名相同（boss 关配置与普通关一致 / 换表后阵容没变）->
       「清空卡牌」改成 DirectHit + DoNothing 直跳「开始战斗」：
       不清空卡牌、不重新选卡、不切编队（未来：不重选神器——签名已含神器占位），
       只换种植链（compiled 注入在调用方，不受影响）。
       首次进关（签名为 None）永远不跳 —— 局内还没有任何配置。
    """
    sig = table.lineup_sig(is_boss)
    # ★ 训练模式永不跳：用户设定「训练 = 每一关都清空卡牌重选阵容」，
    #   闸门（lineup_gate_adjust）挡不住这里 —— 它只翻 next 分支，
    #   清空卡牌节点本身会不会被改成空跳是这里说了算。
    if (not _STATE.get("training")
            and _STATE.get("lineup_sig") is not None
            and _STATE.get("lineup_sig") == sig):
        try:
            context.override_pipeline({
                NODE_CLEAR_CARDS: {
                    "recognition": "DirectHit",
                    "action": "DoNothing",
                    "next": [NODE_BATTLE_START],
                },
            })
            _log(f"阵容未变 -> 跳过清空卡牌/选卡/编队，直接开始战斗"
                 f"（{'boss 关' if is_boss else '普通关'}配置与当前生效阵容一致）")
        except Exception as e:
            _log(f"跳过选卡注入失败（{type(e).__name__}: {e}）")
        return

    # 阵容变了（或首次进关）：还原清空卡牌节点 + 正常注入选卡/编队
    plants = table.eff_plants(is_boss)
    squad = table.eff_squad(is_boss)
    kind_cn = "boss 关" if is_boss else "普通关"
    try:
        context.override_pipeline({
            NODE_CHOOSE_PLANTS: {
                "custom_action_param": json.dumps(
                    {"植物列表": plants}, ensure_ascii=False)
            },
            NODE_CLEAR_CARDS: dict(_CLEAR_CARDS_ORIG),
        })
        _log(f"已注入选卡植物（{kind_cn}）：{plants}")
    except Exception as e:
        _log(f"注入选卡失败（{type(e).__name__}: {e}）")
    _inject_squad(context, squad)
    _STATE["lineup_sig"] = sig

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


def lineup_gate_adjust(training: bool, need: bool, table: Any,
                       upcoming_boss: bool, cur_sig) -> "Tuple[bool, Optional[str]]":
    """阵容维度修正闸门判断（纯函数，便于离线自测）。

    闸门原来只看「表变没变」（plan_decision）。一张表有普通/boss 两套阵容后：

        · 表没变，但下一关形态的阵容 ≠ 当前生效阵容（boss 单独配卡/编队）
          -> 按「变化」走：清空卡牌重选；
        · 表变了，但阵容 == 当前生效阵容 -> 按「未变」走：
          跳过清空/选卡/编队直接开打，只换种植链（compiled 照表切换）。

    训练模式每关必重选（用户设定），不做任何修正。
    cur_sig 为 None（首次进关/签名为未知）时不修正 —— 保守走原判断。

    返回 (need, 修正原因 or None)。
    """
    if training or cur_sig is None:
        return need, None
    target_sig = table.lineup_sig(upcoming_boss)
    if need and cur_sig == target_sig:
        return False, "表切换但阵容相同 -> 跳过清空/选卡，直接开打"
    if not need and cur_sig != target_sig:
        return True, ("阵容与当前生效阵容不同（"
                      + ("boss 关" if upcoming_boss else "普通关")
                      + "配置）-> 重新选卡")
    return need, None


@AgentServer.custom_action("JobSetPlan")
class JobSetPlan(CustomAction):
    """局外决定换不换阵容，并播报当前关卡/表。

    参数（全部可选）：

        {
          "训练模式": false,   # true = 无条件换阵（每关都重选，训练模式用）
          "计数": false,       # true = 顺便把计数器 +1（把 tick 与 plan 合成一个节点时用）
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

        # ★ 每关开局把 boss 判定清零 —— 它是「只进不出」的粘滞状态：
        #   boss 关由头像路径（无尽局内_BOSS关种植，param 显式 true）置 True，
        #   但原来没有任何代码负责置回 False，导致 boss 关的**下一关**被
        #   染色成 boss（91 关误判事故）。本节点每关开局必跑（局外），
        #   是最天然的复位点；JobSetFight 侧另有「按关卡号钉住」的双保险。
        _STATE["is_boss"] = False
        _STATE["is_boss_level"] = None

        if js is None:
            _log("尚未载入作业集（JobSetLoad 未执行）-> 无法判断阵容")
            return _fail()

        lv = tr.count
        table = js.pick_table(lv)
        training = bool(param.get("训练模式"))
        # ★ 记下来给 _inject_lineup 用：训练模式永不跳过清空/选卡
        #   （节点参数只有 JobSetPlan 有，Fight/Stage 的注入路径读不到）。
        _STATE["training"] = training

        # ---- 播报（每关都报；两种模式都经过本节点）----
        # ★ 「本关是否 boss」此时还不知道（头像识别在局内才发生），
        #   param 里的「是boss关」键早已没人传 —— 只能用计数器**预测**：
        #   boss 关恒定 5 的倍数、计数器有 snap_boss 对齐，
        #   所以 lv % 5 == 0 即「预计 boss 关」（仅影响显示，不影响判定）。
        _log(f"📋 {tr.status_line(table, lv > 0 and lv % _BOSS_SNAP == 0)}")

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

        # ---- ★ 阵容维度修正（boss 拆分 + 阵容相同跳过，纯函数在 lineup_gate_adjust）----
        #   闸门原来只看「表变没变」。现在一张表有普通/boss 两套阵容：
        #     · 表没变，但下一关形态的阵容 ≠ 当前生效阵容
        #       （boss 单独配卡/编队）-> 按「变化」走：清空卡牌重选；
        #     · 表变了，但阵容 == 当前生效阵容 -> 按「未变」走：
        #       跳过清空/选卡/编队直接开打，只换种植链（compiled 照表切换）。
        #   训练模式永远每关重选（用户设定），不做跳过。
        #   boss 预判用计数器（lv % 5 == 0，与补给预告同口径）——
        #   局外此刻还没有头像识别可用。
        upcoming_boss = lv > 0 and lv % _BOSS_SNAP == 0
        need2, adj = lineup_gate_adjust(
            training, need, table, upcoming_boss, _STATE.get("lineup_sig"))
        if adj:
            _log(f"★ 阵容维度修正：{adj}")
            reason = f"{reason}；{adj}"
        if need and not need2:
            # 表变但阵容同 -> 按「未变」走。表指针照样推进（种植链要换新表的）；
            # _apply_table 内部走签名跳过路径，不会动清空卡牌节点的正常形态。
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv
            JobSetStage._apply_table(context, js, table, upcoming_boss)
        need = need2

        # ---- 需要换：注入新表的选卡植物 + 编队 ----
        if need:
            _STATE["table_index"] = table.index
            _STATE["locked_level"] = lv
            # _apply_table 内部会记录 plan_table_index；is_boss 传「下一关」的预判
            ok = JobSetStage._apply_table(context, js, table, upcoming_boss)
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
            _STATE["lineup_sig"] = None     # 当前生效阵容签名（跳过选卡判定）
            _STATE["training"] = None       # 训练模式标记（JobSetPlan 每关重写）
            _log("已重置作业集状态（重新开始任务）")

        # ★ 任务起点清 boss 判定残留：它是跨关/跨任务的粘滞状态
        #   （上一任务若停在 boss 关，True 会带进本任务第一关）。
        _STATE["is_boss"] = False
        _STATE["is_boss_level"] = None

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
            _log(f"起始关卡={tr.count}（由参数给定）")
        else:
            _log("未给定起始关卡 -> 计数器暂从 0 起；若流程走「自动计数」节点，"
                 "会用主界面识别到的关卡号覆盖，否则请在 option 里填「起始关卡」")
        _STATE["tracker"] = tr

        # ---- 当前阵容（预热） ----
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
        # ★ 阵容签名同理保持 None：新任务开局时局内卡牌状态未知，
        #   首次锁定必须走完整的清空+选卡，不能跳过。
        _STATE["lineup_sig"] = None
        # 训练标记同理清空，等 JobSetPlan 首跑重写
        _STATE["training"] = None

        # ★ 有了计数器，这里的「预估」不再是「猜」—— 起始关卡就是真实关卡。
        #   （若流程走了「无尽挑战_自动计数」，它识别出主界面关卡号后会
        #   再调一次预热，把这里可能不准的预热纠正过来。）
        lv = tr.count if tr.count > 0 else 1
        _prewarm_for_level(context, js, lv)

        # ---- 无尽局外 80 选卡（作业集级 outer_pick -> 80 选卡 custom 节点）----
        _apply_outer_pick(context, js)

        return _ok()


# ---------------------------------------------------------------------------
# JobSetAutoCount —— 挂在「无尽挑战_自动计数」
# ---------------------------------------------------------------------------

@AgentServer.custom_action("JobSetAutoCount")
class JobSetAutoCount(CustomAction):
    """自动计数：把主界面识别到的「第X关」设为计数器初始关卡。

    挂在「无尽挑战_自动计数」上（recognition=OCR 盯主界面的关卡名区域）。
    OCR 命中后 MAA 会把识别详情随 argv.reco_detail 传进来，
    这里解析出关卡号并设为计数器初始值：

        「第87关」 -> 87 -> tracker.reset(87)

    ★ 设完关卡必须**重新预热**选卡/编队：JobSetLoad 预热时计数器可能还是
      option 里的「起始关卡」（甚至 0），预热的表不一定是要打的表。

    ★ 解析失败**不致命**：保留计数器原值、日志告警、流程继续 ——
      这样「手动填起始关卡」的用法即使路过本节点也不受影响。
    """

    def run(self, context: Context, argv) -> Any:
        text = _reco_text(argv)
        lv = _parse_level_text(text or "")
        if lv is None:
            cur = _STATE.get("tracker")
            _log(f"⚠️ 自动计数：识别文本「{text}」里没解析出关卡号"
                 f" -> 保持计数器原值（{cur.count if cur else 0}）")
            return _ok()

        tr = _ensure_tracker({})
        tr.reset(lv)
        _log(f"📟 自动计数：识别到「{text}」-> 起始关卡 = {tr.count}")

        js: Optional[JobSet] = _STATE.get("jobset")
        if js is not None:
            _prewarm_for_level(context, js, tr.count)
        else:
            _log("⚠️ 作业集未载入（JobSetLoad 未执行？）-> 只设了计数器，没做预热")
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
#
# 链节点名 / ref 触发 / 槽位白名单等常量已搬到 compile.py（保存时预编译共用）。
# 死定义 FIGHT_NODE_TPL / GA_NODE_TPL（「每段一个节点」时代的残留）已删除。


def _resolve_is_boss(param: Dict[str, Any], lv: int) -> bool:
    """判定本关是否 boss 关（带跨关防染色，供 JobSetFight 调用）。

    1) param 显式给了 是boss关 -> 用它，并把判定**钉在本关**（供同关的
       后续空 param 调用读取 —— 链首节点会被反复触发）。
    2) param 没给 -> 只允许吃「本关」记下的 state；跨关一律普通关。

    ★ 为什么必须带关卡号：链首节点「无尽局内_单次种植/循环种植」的 param
      会被预编译注入永久覆盖成 {}（compile.py 刻意置空），跨关时 param 里
      没有任何判定信息。而 state 原来只置位、不复位 —— boss 关记下的
      True 会残留到下一关，把它染色成 boss 关（91 关误判事故）。
      JobSetPlan 每关开局还会再清一次（双保险）。
    """
    if "是boss关" in param:
        is_boss = bool(param.get("是boss关"))
        _STATE["is_boss"] = is_boss
        _STATE["is_boss_level"] = lv
        return is_boss
    return (bool(_STATE.get("is_boss"))
            and _STATE.get("is_boss_level") == lv)


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
    """局内种植：把当前表的预编译 override（compiled 块）注入 pipeline。

    参数：
        {"是boss关": false}      # boss 判定由 pipeline 侧完成并传入
        {"关卡": 55}             # 可选，缺省用计数器当前值

    ★ 只吃预编译（作业集 format:2）：链 -> BatchSwipe DSL 的编译在保存时
      由 pvz.py 调用 agent/jobset/compile.py 完成，这里零翻译直接注入。
      旧格式作业集（没有 compiled 块）会明确报错，去编辑器重新保存一次即可。
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

        # ★ boss 判定：规则与防染色机制见 _resolve_is_boss 的注释
        #   （91 关误判事故的修复点）。
        is_boss = _resolve_is_boss(param, lv)

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
            # ★ 阵容注入统一走 _inject_lineup：按普通/boss 取有效阵容，
            #   签名相同会跳过清空/选卡直接开打（首次进关签名未知，必走完整选卡）
            _inject_lineup(context, table, is_boss)
        elif prev_index != table.index:
            _log(
                f"★ 阵容切换：表{prev_index + 1} -> 表{table.index + 1}"
                f"（关卡 {table.from_level} 起，植物 {table.plants}）"
            )
            # 推进表指针 —— 换阵容流程里**唯一**推进它的地方。
            #   同时重新注入阵容（选卡/编队/跳过逻辑都在 _inject_lineup 里）。
            _STATE["table_index"] = table.index
            _inject_lineup(context, table, is_boss)

        _log(
            f"关卡{lv} {kind_cn} -> 表{table.index + 1} "
            f"| once_chain={len(rules['once_chain'])}段 "
            f"loop_chain={len(rules['loop_chain'])}段 "
            f"end_chain={len(rules['end_chain'])}段"
        )

        # ★ boss 关未配置（作业集里没有 bossSlotOrder/bossLoopOrder）时：
        #   不做任何种植，直接**等结算** —— 只保留「继续挑战」的识别与点击。
        #   这符合用户要求：「如果没有 Boss 字段的话，就直接等待结算」。
        #   判定逻辑与 compile.build_fight_override 内部的短路一致（同源数据）。
        _boss_short = bool(is_boss) and not bool(
            table.raw.get("bossSlotOrder")
            or table.raw.get("bossLoopOrder")
            or rules.get("once_chain")
            or rules.get("loop_chain")
        )

        # ★ 只吃预编译（format:2）：作业集保存时 pvz.py 已把 override 算好写进
        #   table.compiled（normal/boss 两个变体），运行时零翻译直接注入。
        #   没有 compiled 块 = 旧格式作业集 -> 明确报错，去编辑器重新保存一次即可。
        compiled = table.raw.get("compiled")
        variant = compiled.get("boss" if is_boss else "normal") \
            if isinstance(compiled, dict) else None
        if not (isinstance(variant, dict) and variant):
            _log("❌ 作业集没有 compiled 块（旧格式）—— "
                 "请用编辑器打开该作业集重新保存一次（保存时会自动预编译）")
            return _fail()
        override = variant
        _log(f"使用预编译 compiled（{'boss' if is_boss else 'normal'}"
             f" 变体，{len(variant)} 个节点）")

        # ---- boss 未配置短路：只等结算，不动补给（保持旧行为）----
        if _boss_short:
            try:
                context.override_pipeline(override)
                _log(f"已注入 {len(override)} 个节点")
            except Exception as e:
                _log(f"注入失败（{type(e).__name__}: {e}）")
                return _fail()
            return _ok()

        _STATE["is_boss"] = is_boss
        _STATE["is_boss_level"] = lv

        # （组合动作节点 / 收尾 / 收尾重开的装配已全部搬进 compile.build_fight_override，
        #   本函数只负责：选表 -> 取 compiled -> override_pipeline -> 补给。）

        # ---- 2) 「无尽局内_继续挑战」——**不覆盖**（见下方血泪注释）----

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

        # ---- 3) 自检：注入的 next 目标是否都存在 ----
        #
        # 踩过的坑：曾把「无尽局内_继续挑战」的 next 指向一个已被注释掉的节点，
        # 结果点完继续挑战后找不到后继 -> 3ms 内整条任务结束（表现为 Task.Failed）。
        # 这里在注入前先把可疑目标挑出来写日志，避免又静默断链。
        self._warn_missing_targets(context, override)

        try:
            context.override_pipeline(override)
            _log(f"已注入 {len(override)} 个节点")
            # 打印三条链各自的动作数（从 override 读 DSL，compiled/现编译两路通用）
            for kind, cn in (("once", "单次"), ("loop", "循环"), ("end", "收尾")):
                node_name = CHAIN_NODE_TPL.format(kind=KIND_CN[kind])
                body = override.get(node_name)
                dsl = (body or {}).get("custom_action_param")
                if not isinstance(dsl, str):
                    _log(f"  [{cn}链] （空）")
                    continue
                n = len([x for x in dsl.split(";") if x.strip()])
                _log(f"  [{cn}链] {node_name}  共 {n} 条动作")
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

@AgentServer.custom_action("JobSetStage")
class JobSetStage(CustomAction):
    """纯计数器版阶段确认：取计数器关卡 -> boss 对齐 -> 必要时换阵容重开。

    ★ 已彻底砍掉天数 OCR（实测不稳：81 读成 21、87 读成 89）。
      关卡号完全由「起始关卡 + 过关计数」推导；
      boss 关靠 pipeline 侧的头像模板匹配判定，是唯一的外部校准信号。

    参数（全部可选）：
        {
          "通用重开节点": "通用_重开_暂停",     # 换阵容时调用的重开任务
          "重开后回跳节点": "无尽挑战_识别开始战斗_清空卡牌",
          "重开": false                   # true = 强制走一次换阵容（调试用）
        }
    """

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

    @staticmethod
    def _apply_table(context: Context, js: JobSet, table: Any,
                     is_boss: Optional[bool] = None) -> bool:
        """把指定表的阵容与种植逻辑注入 pipeline。

        ★ 唯一职责是「注入」，并顺手记下**当前已注入的是哪张表**
          （`_STATE["plan_table_index"]`）—— 局外换阵节点靠它判断
          「表有没有变」。所有换阵路径都走这里，所以记录不会漏。

        is_boss：目标关卡的 boss 形态。局外换阵（JobSetPlan）传「下一关」的
          计数器预判；局内纠正路径（JobSetStage）不传 -> 用当前关的识别结果。
        """
        if is_boss is None:
            is_boss = bool(_STATE.get("is_boss"))
        try:
            # ★ 阵容注入统一走 _inject_lineup：boss 关取 boss 阵容；
            #   与当前生效阵容相同会跳过清空/选卡/编队直接开打
            _inject_lineup(context, table, is_boss)
            _log(f"已切换到表{table.index + 1}："
                 f"选卡植物={table.eff_plants(is_boss)}（{'boss 关' if is_boss else '普通关'}）")
            # ★ 记录「当前已注入的表」——给 JobSetPlan 判断表有没有变
            _STATE["plan_table_index"] = table.index
            return True
        except Exception as e:
            _log(f"切换表失败（{type(e).__name__}: {e}）")
            return False

