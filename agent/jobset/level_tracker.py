# -*- coding: utf-8 -*-
"""关卡计数器（纯逻辑，可离线单测）。

背景 / 为什么砍掉了 OCR
-----------------------
旧版是「OCR 融合器」：靠 OCR 读游戏里的天数，再用得分期望（`penalty=30`、
自洽判断、锚点重同步）去兜住 OCR 的误读。那套机制复杂度极高，而根源是
**OCR 本身不稳**（实测会把 81 读成 21、87 读成 89）。

现在改成**纯计数器**：

    用户在 MAA option 里填「起始关卡」
        ↓
    点「继续挑战 / 继续训练」-> 计数器 +1
        ↓
    进 boss 关 -> 强制对齐到最近的 5 的倍数（自愈）

★ 为什么这样就够：**「点继续挑战」这个事件本身不依赖数字 OCR**，
  它是结算画面的按钮识别（模板/文字匹配），比数字识别可靠得多。
  而 boss 关的判定也是**头像模板匹配**（僵王的头 / 功夫僵王），同样可靠。
  两者都是「是/否」判断，不是「读出一个数」，误差模型完全不同。

★ 重开为什么不再需要 `rollback_one`：
  重开走的是 `通用_重开_暂停`，**不经过「点继续挑战」**，
  所以计数器天然不会被多推一格 —— 不需要再手动退格。
  （旧版的 `rollback_one` 是为了抵消「重开后又识别一次天数」而存在的，
    识别没了，它也就没有存在意义了。）

自愈：boss 关对齐
-----------------
boss 关恒定出现在 5 的倍数关。所以每次进 boss 关都是**一次校准机会**：

    计数器 56，进 boss 关 -> 就近取 5 的倍数 -> 60

这和旧版「就近取 5 的倍数」是同一个思路，只是**输入从 OCR 换成了计数器**。
偏差 <= 2 时能纠正到正确值；偏差更大就会对齐到相邻的 boss 关 ——
这是用户已知并接受的（属于用户填错起始关卡的问题），日志会如实打印。

保留但不再依赖
--------------
`rollback_one` / `clear_anchor` / `observe` 等旧接口保留为**兼容垫片**
（`selfcheck.py` 与其它调用点还在用），但内部语义已简化：
`observe(raw)` 现在**忽略 raw**，只做「计数 +1」。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# 默认参数
# ---------------------------------------------------------------------------

DEFAULT_MIN_LEVEL = 1
DEFAULT_MAX_LEVEL = 149

# boss 关对齐的倍数（boss 关恒定出现在 5 的倍数关）
BOSS_SNAP = 5

# 「就近取 5 的倍数」能容忍的最大偏差。超过它就会对齐到相邻的 boss 关。
#
#   BOSS_SNAP // 2 = 2 —— 与 int(round(x/5))*5 的行为一致：
#     偏差 0..2 -> 就近那个 boss（正确）
#     偏差 3..   -> 会落到相邻的 boss
BOSS_SNAP_TOLERANCE = BOSS_SNAP // 2


@dataclass
class LevelState:
    """可序列化的状态快照（便于日志 / 跨动作传递）。"""
    count: int = 0
    stage: int = 0                  # 当前所属表序号（0 起）
    last_verdict: str = "init"      # init/tick/snap/reset
    # 上一次「点继续挑战」时的关卡，仅用于日志展示（本关 -> 下一关）
    last_before_tick: Optional[int] = None
    # boss 关对齐的最近一次记录（给日志/排查用）
    last_snap: Optional[Dict[str, Any]] = None
    # 兼容旧快照的字段（不再有语义，保留以免旧代码 KeyError）
    score: int = 0
    locked: bool = True
    samples: List[int] = field(default_factory=list)
    last_raw: Optional[int] = None
    last_predicted: Optional[int] = None
    last_anchor: Optional[int] = None
    consecutive_bad: int = 0
    locked_last_raw: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "count": self.count,
            "stage": self.stage,
            "last_verdict": self.last_verdict,
            "last_before_tick": self.last_before_tick,
            "last_snap": self.last_snap,
        }


class LevelTracker:
    """纯关卡计数器：起始关卡 -> 逐关推进 -> boss 关对齐。"""

    def __init__(
        self,
        start_level: int = 0,
        min_level: int = DEFAULT_MIN_LEVEL,
        max_level: int = DEFAULT_MAX_LEVEL,
    ):
        self.min_level = int(min_level)
        self.max_level = int(max_level)
        self.state = LevelState(locked=True)
        self.log: List[str] = []
        if start_level:
            self.reset(start_level)

    # -- 内部 --------------------------------------------------------------

    def _clamp(self, lv: int) -> int:
        return max(self.min_level, min(self.max_level, lv))

    def _note(self, msg: str) -> None:
        self.log.append(msg)
        if len(self.log) > 200:
            del self.log[:-100]

    @property
    def count(self) -> int:
        return self.state.count

    # -- 生命周期 ----------------------------------------------------------

    def reset(self, start_level: Optional[int] = None) -> None:
        """重置计数器。

        给了 start_level 就用它当起点（用户填的「起始关卡」）；
        没给则清零。**不再依赖 OCR 基准帧。**
        """
        st = self.state
        if start_level is None:
            st.count = 0
            st.last_verdict = "reset"
            self._note("重置：计数清零（未指定起始关卡）")
            return
        st.count = self._clamp(int(start_level))
        st.last_verdict = "init"
        st.last_before_tick = None
        self._note(f"起始关卡 = {st.count}（由用户指定，不再做 OCR 识别）")

    def rollback_one(self) -> int:
        """**兼容垫片**：旧版用于抵消「重开后又识别一次天数」。

        新版重开不经过「点继续挑战」，计数器不会多推，所以正常流程
        **不应再调用这个**。保留它只为兼容旧调用点 / 旧自测。
        """
        st = self.state
        if st.count > self.min_level:
            st.count = self._clamp(st.count - 1)
            self._note(f"回退 -> count={st.count}")
        else:
            self._note(f"回退：已在最小关 {st.count}，保持不变")
        st.last_verdict = "rollback"
        return st.count

    def clear_anchor(self) -> None:
        """**兼容垫片**：新版没有锚点概念，空实现。"""

    # -- 主入口 ------------------------------------------------------------

    def tick(self) -> int:
        """过关一次：计数器 +1，返回新关卡号。

        ★ 调用时机：**点完「继续挑战 / 继续训练」之后**。
          用户给的语义：「只要点了就必定是下一关了」——
          所以这里不需要任何判断，点了就 +1。
          （重开不会走到这里，天然不会误加。）
        """
        st = self.state
        st.last_before_tick = st.count
        st.count = self._clamp(st.count + 1)
        st.last_verdict = "tick"
        self._note(f"过关：{st.last_before_tick} -> {st.count}")
        return st.count

    def observe(self, raw: Optional[int] = None, first: bool = False) -> int:
        """**兼容垫片**：旧版入口（喂 OCR 值）。

        ★ 新版**忽略 raw** —— 没有 OCR 了。
          · first=True  -> 只把计数器初始化（若 raw 有效则用作起始关卡）
          · 其余        -> 等价于 tick()（过关 +1）

        保留它是为了让旧调用点（`JobSetStage` 的过渡期）与旧自测不至于
        立刻崩掉；新代码请直接用 `reset()` / `tick()` / `snap_boss()`。
        """
        if first:
            self.reset(raw if (raw and raw > 0) else None)
            return self.count
        return self.tick()

    # -- boss 关对齐（唯一且主要的自愈机制）---------------------------------

    def snap_boss(self) -> Dict[str, Any]:
        """进入 boss 关时把计数器对齐到最近的 5 的倍数。

        返回一份「本次对齐结果」，给调用方打印**用户可见**的日志用：

            {
              "before": 56,          # 对齐前的计数器
              "after": 60,           # 对齐后
              "snapped": True,       # 是否发生了偏移
              "offset": 4,           # 偏了多少（after - before）
              "too_far": False,      # 偏差是否超出容忍（>2，可能对到相邻 boss）
            }
        """
        st = self.state
        before = st.count
        if before <= 0:
            # 计数器还没起步 —— 无从对齐，如实记一笔
            res = {
                "before": before, "after": before,
                "snapped": False, "offset": 0, "too_far": False,
                "skipped": "计数器尚未起步",
            }
            st.last_snap = res
            st.last_verdict = "snap"
            self._note("boss 关：计数器为 0，跳过对齐")
            return res

        after = int(round(before / float(BOSS_SNAP))) * BOSS_SNAP
        after = max(BOSS_SNAP, min(self.max_level, after))

        offset = after - before
        too_far = abs(offset) > BOSS_SNAP_TOLERANCE

        st.count = after
        st.last_verdict = "snap"
        res = {
            "before": before, "after": after,
            "snapped": (after != before),
            "offset": offset, "too_far": too_far, "skipped": "",
        }
        st.last_snap = res

        if after != before:
            self._note(
                f"boss 关对齐：{before} -> {after}"
                + (f"（偏差 {offset:+d}，已超容忍 ±{BOSS_SNAP_TOLERANCE}，"
                   f"可能对到了相邻 boss 关，请检查起始关卡）" if too_far else "")
            )
        else:
            self._note(f"boss 关对齐：{before} 已是 {BOSS_SNAP} 的倍数，不变")
        return res

    def snap_boss_message(self, res: Dict[str, Any]) -> List[str]:
        """把 `snap_boss()` 的结果翻成**给用户看的**日志行。

        用户要求（原话）：
            「识别到 boss 关时直接偏移过去，并在用户可观测的日志层面输出：
              boss关，当前关卡数：xxx
              若计数器的关卡数是 56，则检测到关卡数有误，已自动偏移，
              boss关，当前关卡数：xxx」

        ★ 每次进 boss 关都会输出第一行（即使没偏移）——
          这样用户能看到「每 5 关校准一次且正确」，这正是他要的检查能力。
        """
        after = res.get("after", 0)
        lines: List[str] = []
        if res.get("skipped"):
            lines.append(f"boss关，当前关卡数：{after}（{res['skipped']}）")
            return lines

        lines.append(f"boss关，当前关卡数：{after}")
        if res.get("snapped"):
            if res.get("too_far"):
                lines.append(
                    f"⚠️ 计数器为 {res['before']}，与 boss 关（{BOSS_SNAP} 的倍数）"
                    f"相差 {abs(res['offset'])}，已自动偏移到 {after}；"
                    f"偏差超过 ±{BOSS_SNAP_TOLERANCE}，请核对起始关卡"
                )
            else:
                lines.append(
                    f"检测到关卡数有误，已自动偏移"
                    f"（{res['before']} → {after}），boss关，当前关卡数：{after}"
                )
        return lines

    # -- 只读 --------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        return self.state.to_dict()

    def describe(self) -> str:
        st = self.state
        return f"关卡={st.count} 判定={st.last_verdict}"

    def status_line(self, table: Any = None, is_boss: bool = False) -> str:
        """给「日志弹窗」用的一行状态（在点「开始战斗」时刷新）。

            当前关卡: 87    当前表: 表2 (50~99)    本关: 普通关
        """
        lv = self.state.count
        kind = "boss关" if is_boss else "普通关"
        if table is None:
            return f"当前关卡: {lv}    本关: {kind}"
        try:
            rng = (f"{table.from_level}~{table.to_level}"
                   if getattr(table, "to_level", None) is not None
                   else f"{table.from_level}~")
            return (f"当前关卡: {lv}    "
                    f"当前表: 表{int(table.index) + 1} ({rng})    "
                    f"本关: {kind}")
        except Exception:
            return f"当前关卡: {lv}    本关: {kind}"


def from_params(param: Dict[str, Any]) -> LevelTracker:
    """从 custom_action_param 构造。

    ★ 起始关卡的来源是 MAA option「无尽_起始关卡」（用户自己配的），
      它的 pipeline_override 会把值填进 `起始关卡` 这个键。

    要防御的三种「没填」形态（都会导致计数器从 0 起）：
      · 键不存在          -> option 没配 / 没选中
      · 空串 ""           -> option 的 default 是空
      · 占位符未替换      -> pipeline_override 里写的是 "{起始关卡}"，
                             但该 option 没被应用，于是原样传了进来
    """
    param = param if isinstance(param, dict) else {}
    start = param.get("起始关卡")

    # 占位符没被替换的情况：MAA 没应用这个 option
    if isinstance(start, str) and start.strip() in ("{起始关卡}", ""):
        start = None

    try:
        start = int(start) if start not in (None, "") else 0
    except (TypeError, ValueError):
        start = 0

    # 越界一律当「没填」（play safe）：0 / 负数 / 超出 max_level 都不合理
    max_level = param.get("最大关", DEFAULT_MAX_LEVEL)
    try:
        max_level = int(max_level)
    except (TypeError, ValueError):
        max_level = DEFAULT_MAX_LEVEL
    if not (DEFAULT_MIN_LEVEL <= start <= max_level):
        start = 0

    return LevelTracker(
        start_level=start,
        min_level=param.get("最小关", DEFAULT_MIN_LEVEL),
        max_level=max_level,
    )
