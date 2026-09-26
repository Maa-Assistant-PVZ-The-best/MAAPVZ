# -*- coding: utf-8 -*-
"""关卡计数器 + 得分期望状态机（纯逻辑，可离线单测）。

背景
----
无尽挑战**允许中途插入**：用户可能从第 55 关进去，而 55 的 OCR 很容易被认成
56 / 57。单帧 OCR 不可信，所以用「计数器为主、OCR 为验证信号」的融合策略：

    predicted = count + 1
    raw == predicted        -> 验证通过，score += +20（封顶 100），count = raw
    |raw - predicted| <= T  -> 疑似抖动，score -= 10，count 不变（重新识别）
    其它                    -> 偏差过大，score -= 10，count = predicted（信任计数器）

    score 升到 100  -> 进入「纯计数器模式」：count += 1，不再依赖 OCR
    score 触底 0    -> 回头信任 OCR：count = raw，score 回升（避免计数器一路跑偏）

每次重新开始任务都要重置（用户可能关掉 maafw 自己手打几关再用脚本）。

你给的例子
----------
    实际 55，OCR 错认成 57（首次识别）
        count=57, score=50
    下一关实际 56，OCR = 56
        predicted = 58，raw = 56 -> 偏差 2 -> score 50-10=40，count 保持 57（重识别）
    再识别仍得 56，predicted 仍是 58
        如果容差 T=2 且我们允许「重识别」直接采信……
        -> 该场景见 test_level_tracker.py，此处策略按「连续错 -> 信任 OCR」收敛
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# 默认参数（都可在 JobSetLevel 的 custom_action_param 里覆盖）
# ---------------------------------------------------------------------------

DEFAULT_INIT_SCORE = 50      # 首次识别后的初始分
DEFAULT_SCORE_MAX = 100      # 达到即转纯计数器
DEFAULT_SCORE_MIN = 0        # 触底即回头信任 OCR
DEFAULT_GAIN = 20            # 验证通过加分
DEFAULT_PENALTY = 10         # 验证失败扣分
DEFAULT_TOLERANCE = 2        # |raw - predicted| <= 容差 视为「抖动」

DEFAULT_MIN_LEVEL = 1
DEFAULT_MAX_LEVEL = 149


@dataclass
class LevelState:
    """可序列化的状态快照（便于日志 / 跨动作传递）。"""
    count: int = 0
    score: int = DEFAULT_INIT_SCORE
    locked: bool = False            # True = 已进入纯计数器模式
    stage: int = 0                  # 当前所属表序号（0 起）
    samples: List[int] = field(default_factory=list)   # 最近的原始识别值
    last_raw: Optional[int] = None
    last_predicted: Optional[int] = None
    # ★ 「锚点」= 上一次**被采信**的 OCR 值。
    #   后续的「匹配」判定以 last_anchor + 1 为基准，而不是 count + 1。
    #   这样即使中途跳关（12 -> 49），只要 OCR 连续，基准就跟着真实关卡走。
    last_anchor: Optional[int] = None
    # 连续「对不上」的次数。用于判断是偶发抖动还是计数器真的跑偏。
    consecutive_bad: int = 0
    last_verdict: str = "init"      # init/agree/disagree/trust_ocr/trust_counter/resync/tick

    def to_dict(self) -> Dict[str, Any]:
        return {
            "count": self.count,
            "score": self.score,
            "locked": self.locked,
            "stage": self.stage,
            "last_raw": self.last_raw,
            "last_predicted": self.last_predicted,
            "last_anchor": self.last_anchor,
            "consecutive_bad": self.consecutive_bad,
            "last_verdict": self.last_verdict,
            "samples": list(self.samples[-8:]),
        }


class LevelTracker:
    """关卡融合器：OCR 原始值 -> 可信关卡号。"""

    def __init__(
        self,
        init_score: int = DEFAULT_INIT_SCORE,
        score_max: int = DEFAULT_SCORE_MAX,
        score_min: int = DEFAULT_SCORE_MIN,
        gain: int = DEFAULT_GAIN,
        penalty: int = DEFAULT_PENALTY,
        tolerance: int = DEFAULT_TOLERANCE,
        min_level: int = DEFAULT_MIN_LEVEL,
        max_level: int = DEFAULT_MAX_LEVEL,
    ):
        self.init_score = int(init_score)
        self.score_max = int(score_max)
        self.score_min = int(score_min)
        self.gain = int(gain)
        self.penalty = int(penalty)
        self.tolerance = max(0, int(tolerance))
        self.min_level = int(min_level)
        self.max_level = int(max_level)

        self.state = LevelState(score=self.init_score)
        self.log: List[str] = []

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

    @property
    def score(self) -> int:
        return self.state.score

    @property
    def locked(self) -> bool:
        return self.state.locked

    # -- 生命周期 ----------------------------------------------------------

    def reset(self) -> None:
        """重新开始任务时调用：全部清零。"""
        self.state = LevelState(score=self.init_score)
        self._note("重置：计数器与得分期望已清零")

    def rollback_one(self) -> int:
        """重开（换阵容）后回退一关：count -= 1，**分数不变**。

        为什么需要它：换阵容时脚本会「重开」当前关，重开后打的还是同一关，
        但管道会再走一次天数识别 -> 计数器会被多推一格。
        所以重开路径上要显式回退，且不该扣分（这不是识别错误）。

        锚点（last_anchor）**不回退**：它记的是「上次 OCR 读到的真实值」，
        重开后再识别到的仍是同一关，锚点保持原值才能让下一次比对成立。
        """
        st = self.state
        if st.count > self.min_level:
            st.count = self._clamp(st.count - 1)
            self._note(f"重开回退 -> count={st.count}（分数保持 {st.score}）")
        else:
            self._note(f"重开回退：已在最小关 {st.count}，保持不变")
        st.last_verdict = "rollback"
        return st.count

    def clear_anchor(self) -> None:
        """清掉锚点 —— 换阵容后想让下一次识别重新做基准时调用。"""
        self.state.last_anchor = None
        self._note("锚点已清除，下一次识别将作为新基准")

    # -- 主入口 ------------------------------------------------------------

    def observe(self, raw: Optional[int], first: bool = False) -> int:
        """喂入一次 OCR 原始天数，返回融合后的可信关卡号。

        参数
        ----
        raw   : OCR 读到的天数；None 表示本帧没认出来
        first : **本次任务的第一次识别**（基准帧）。为 True 时无条件采信 raw，
                用它作为起始关卡并重置分数。由调用方（JobSetStage）在任务首次
                调用时显式传入，不靠 count<=0 推断——因为上一次任务可能残留
                了 count，靠推断会误判。

        规则（得分匹配模式）
        ------------------
        首次（first=True）  : count = raw，score 重置为初始分
        未识别（raw=None）  : 不比分，计数器 +1
        纯计数模式（locked）: 计数器 +1，忽略 OCR
        常规                : 与「**上次识别值 + 1**」比对
                               相等            -> score += 加分，count = raw
                               |差| <= 容差    -> score -= 扣分，count 不动（重识别）
                               否则            -> score -= 扣分
                                                  触底 -> count = raw（回头信 OCR）
                                                  否则 -> count = 上次识别值 + 1
        """
        st = self.state

        # ---- 基准帧：无条件采信 ----
        if first:
            if raw is None:
                self._note("基准帧未识别到天数 -> 等待下一次识别")
                st.last_verdict = "init_wait"
                return st.count
            raw = self._clamp(int(raw))
            st.count = raw
            st.last_raw = raw
            st.last_predicted = raw
            st.last_anchor = raw          # ★ 基准帧也要设锚点，否则后续比对没有依据
            st.score = self.init_score
            st.locked = False
            st.samples.append(raw)
            st.last_verdict = "init"
            self._note(f"基准识别（本次任务首个天数）-> count={raw}, score={st.score}")
            return st.count

        # ---- 没认出来：靠计数器走一格 ----
        if raw is None:
            if st.count <= 0:
                st.last_verdict = "init"
                st.last_raw = None
                self._note("OCR 未识别，且计数器尚未起步 -> 维持 0")
                return st.count
            st.count = self._clamp(st.count + 1)
            st.last_raw = None
            st.last_predicted = st.count
            st.last_verdict = "tick"
            self._note(f"OCR 未识别 -> 计数器推进到 {st.count}（score={st.score}）")
            return st.count

        raw = self._clamp(int(raw))
        st.last_raw = raw
        st.samples.append(raw)

        # ---- 纯计数器模式：不再看 OCR ----
        if st.locked:
            st.count = self._clamp(st.count + 1)
            st.last_predicted = st.count
            st.last_verdict = "tick"
            self._note(f"纯计数器模式 -> {st.count}")
            return st.count

        # ---- 还没有基准（既非 first 也没识别过）：直接采信 ----
        if st.count <= 0 or st.last_anchor is None:
            st.count = raw
            st.score = self.init_score
            st.last_predicted = raw
            st.last_anchor = raw
            st.last_verdict = "init"
            self._note(f"首次识别 -> count={raw}, score={st.score}")
            return st.count

        # ---- 常规：与「上次识别值 + 1」比对 ----
        # ★ 比对基准是**上次 OCR 读到的值**（anchor），不是计数器推算值。
        #   这样只要 OCR 连续，基准就跟着真实关卡走，支持中途跳关。
        base = st.last_anchor if st.last_anchor is not None else st.count
        predicted = self._clamp(base + 1)
        st.last_predicted = predicted
        delta = abs(raw - predicted)

        if raw == predicted:
            st.score = min(self.score_max, st.score + self.gain)
            st.count = raw
            st.last_anchor = raw          # 基准前移
            st.consecutive_bad = 0
            st.last_verdict = "agree"
            self._note(f"验证通过 {raw}（score={st.score}）")
            if st.score >= self.score_max:
                st.locked = True
                self._note(f"得分达 {st.score} -> 进入纯计数器模式（此后 count += 1）")
            return st.count

        if delta <= self.tolerance:
            # 抖动：计数与基准都不动，等下次重识别
            st.score = max(self.score_min, st.score - self.penalty)
            st.consecutive_bad += 1
            st.last_verdict = "disagree"
            self._note(
                f"抖动 raw={raw} vs 预测={predicted}（容差{self.tolerance}）"
                f" -> 扣分 score={st.score}，计数保持 {st.count}"
            )
            self._post_penalty(st, raw)
            return st.count

        # ---- 偏差过大 ----
        # ★ 关键改进：连续多次 OCR 都对不上，而且这几帧的 OCR **自己是连贯的**
        #   （每帧 +1），说明不是噪声，而是计数器真的跑偏了（例如中途跳关）。
        #   这时应该重新采信 OCR，把基准重设到 OCR 上。
        if self._ocr_self_consistent():
            st.count = raw
            st.last_anchor = raw
            st.score = self.init_score
            st.consecutive_bad = 0
            st.locked = False
            st.last_verdict = "resync"
            self._note(
                f"OCR 连续自洽（{st.samples[-3:]}）-> 判定计数器跑偏，"
                f"重设基准 count={raw}，score 重置为 {st.score}"
            )
            return st.count

        st.score = max(self.score_min, st.score - self.penalty)
        st.consecutive_bad += 1

        if st.score <= self.score_min:
            # 分数触底 -> 无条件回头信 OCR
            st.count = raw
            st.last_anchor = raw
            st.score = self.init_score
            st.consecutive_bad = 0
            st.last_verdict = "trust_ocr"
            self._note(
                f"偏差过大且分数触底 -> 回头信任 OCR，count={raw}，"
                f"score 重置为 {st.score}"
            )
        else:
            st.count = predicted
            st.last_verdict = "trust_counter"
            self._note(
                f"偏差过大 raw={raw} vs 预测={predicted} -> 信任计数器 {st.count}"
                f"（score={st.score}）"
            )
        return st.count

    def _ocr_self_consistent(self) -> bool:
        """最近几次 OCR 是否「自己连成一条 +1 的序列」。

        用来区分两种情况：
          · OCR 是噪声（值乱跳）        -> 不该信，继续用计数器
          · OCR 是稳定的真实关卡（连续 +1）-> 该信，计数器跑偏了
        """
        s = [x for x in self.state.samples[-3:] if x is not None]
        if len(s) < 3:
            return False
        return s[1] == s[0] + 1 and s[2] == s[1] + 1

    def _post_penalty(self, st: LevelState, raw: int) -> None:
        """抖动分支的共同收尾：判断是否触底回头信 OCR。"""
        if st.score <= self.score_min:
            st.count = raw
            st.last_anchor = raw
            st.score = self.init_score
            st.consecutive_bad = 0
            st.locked = False
            st.last_verdict = "trust_ocr"
            self._note(f"分数触底 -> 回头信任 OCR，count={raw}")

    def rebase(self, raw: Optional[int]) -> int:
        """把「本次任务的第一次识别」重置为基准（等价 observe(..., first=True)）。"""
        return self.observe(raw, first=True)

    # -- 只读 --------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        return self.state.to_dict()

    def describe(self) -> str:
        st = self.state
        mode = "纯计数器" if st.locked else "融合"
        return (
            f"关卡={st.count} 分数={st.score}/{self.score_max} 模式={mode} "
            f"判定={st.last_verdict}"
        )


def from_params(param: Dict[str, Any]) -> LevelTracker:
    """从 custom_action_param 构造（缺省值全部走 DEFAULT_*）。"""
    param = param if isinstance(param, dict) else {}
    return LevelTracker(
        init_score=param.get("初始分", DEFAULT_INIT_SCORE),
        score_max=param.get("封顶分", DEFAULT_SCORE_MAX),
        score_min=param.get("触底分", DEFAULT_SCORE_MIN),
        gain=param.get("加分", DEFAULT_GAIN),
        penalty=param.get("扣分", DEFAULT_PENALTY),
        tolerance=param.get("容差", DEFAULT_TOLERANCE),
        min_level=param.get("最小关", DEFAULT_MIN_LEVEL),
        max_level=param.get("最大关", DEFAULT_MAX_LEVEL),
    )
