# -*- coding: utf-8 -*-
"""无尽挑战重构 —— 作业集运行时。

模块划分：
    engine.py        作业集载入 / 选表 / 规则翻译（纯数据，无副作用）
    level_tracker.py 关卡计数器 + 得分期望状态机（纯逻辑，可离线单测）
    runtime.py       与 MaaFramework 的胶水层（CustomAction 注册）

设计约定见 game_assist_tools/endless_setup/HANDOFF.md。
"""

from .engine import JobSet, JobSetError, load_jobset, pick_table
from .level_tracker import LevelTracker

__all__ = [
    "JobSet",
    "JobSetError",
    "load_jobset",
    "pick_table",
    "LevelTracker",
]
