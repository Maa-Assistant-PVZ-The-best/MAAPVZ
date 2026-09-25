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
    last_verdict: str = "init"      # init/agree/disagree/trust_ocr/trust_counter/tick

    def to_dict(self) -> Dict[str, Any]:
        return {
            "count": self.count,
            "score": self.score,
            "locked": self.locked,
            "stage": self.stage,
            "last_raw": self.last_raw,
            "last_predicted": self.last_predicted,
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
        """
        st = self.state
        if st.count > self.min_level:
            st.count = self._clamp(st.count - 1)
            self._note(f"重开回退 -> count={st.count}（分数保持 {st.score}）")
        else:
            self._note(f"重开回退：已在最小关 {st.count}，保持不变")
        st.last_verdict = "rollback"
        return st.count

    # -- 主入口 ------------------------------------------------------------

    def observe(self, raw: Optional[int]) -> int:
        """喂入一次 OCR 原始天数，返回融合后的可信关卡号。

        raw 为 None（本帧没认出来）时：不改变分数，纯计数器推进一格。
        """
        st = self.state

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

        # ---- 纯计数器模式：只做边界校正，不再看 OCR ----
        if st.locked:
            st.count = self._clamp(st.count + 1)
            st.last_predicted = st.count
            st.last_verdict = "tick"
            self._note(f"纯计数器模式 -> {st.count}")
            return st.count

        # ---- 首次：直接采信 OCR，给初始分 ----
        if st.count <= 0:
            st.count = raw
            st.score = self.init_score
            st.last_predicted = raw
            st.last_verdict = "init"
            self._note(f"首次识别 -> count={raw}, score={st.score}")
            return st.count

        # ---- 常规：与预测值比对 ----
        predicted = self._clamp(st.count + 1)
        st.last_predicted = predicted
        delta = abs(raw - predicted)

        if raw == predicted:
            # 验证通过
            st.score = min(self.score_max, st.score + self.gain)
            st.count = raw
            st.last_verdict = "agree"
            self._note(f"验证通过 {raw}（score={st.score}）")
        elif delta <= self.tolerance:
            # 抖动：惩罚、保持计数器、等下次重识别
            st.score = max(self.score_min, st.score - self.penalty)
            st.last_verdict = "disagree"
            self._note(
                f"抖动 raw={raw} vs 预测={predicted}（容差{self.tolerance}）"
                f" -> 扣分 score={st.score}，计数保持 {st.count}"
            )
        else:
            # 偏差过大：先扣分，再看分数决定信谁
            st.score = max(self.score_min, st.score - self.penalty)
            if st.score <= self.score_min:
                # 计数器已经不可信 -> 回头信 OCR
                st.count = raw
                st.score = self.init_score
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

        # ---- 结算：是否进入纯计数器模式 ----
        if st.score >= self.score_max:
            st.locked = True
            self._note(f"得分达 {st.score} -> 进入纯计数器模式（此后 count += 1）")

        return st.count

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
