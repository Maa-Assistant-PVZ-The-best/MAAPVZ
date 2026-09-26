# -*- coding: utf-8 -*-
"""作业集载入与选表（纯数据层，不做任何设备操作）。

作业集 JSON 结构（由 game_assist_tools/endless_setup 网页端导出）：

    {
      "code": "pvz_20260926_015808",
      "name": "心塔",
      "version": "1.0",
      "worlds": [],
      "max_level": 149,
      "tables": [
        {
          "from_level": 1,
          "to_level": 50,              # null = 不设上限（一直用到下一张表）
          "lineup": {"plants": [...], "deck": null},
          "slots": {"1": "仙人掌", ...},
          "non_boss": {"plant": [...], "feed": [...], "shovel": [...],
                       "wave": bool, "loop": bool, "once": bool, "sequence": [...]},
          "boss":      {"plant": [...], "feed": [...], "shovel": [...],
                        "wave": bool, "sequence": [...]}
        },
        ...
      ]
    }

核心语义：**关卡是线性的，tables[] 按 from_level 升序切片**。
第 L 关用哪张表，由 from_level 决定 —— 这就是「换阵容锚点」。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# 路径
# ---------------------------------------------------------------------------

# <仓库根>/agent/jobset/engine.py  ->  <仓库根>
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

DEFAULT_JOBS_DIR = _REPO_ROOT / "assets" / "resource" / "jobs"
CURRENT_FILE = "current.json"


class JobSetError(Exception):
    """作业集载入/校验失败。"""


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _as_int(v: Any, default: Optional[int] = None) -> Optional[int]:
    """宽松取整数：None/''/非法值 -> default。"""
    if v is None or v == "":
        return default
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _as_bool(v: Any, default: bool = False) -> bool:
    """宽松取布尔：兼容 1/0、"true"/"True"/"yes"/"是"。"""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("1", "true", "yes", "y", "on", "是"):
            return True
        if s in ("0", "false", "no", "n", "off", "否", ""):
            return False
    return default


def _norm_plants(v: Any) -> List[str]:
    """规范化植物名列表：去空、去重（保序）、去首尾空白。"""
    if not isinstance(v, (list, tuple)):
        return []
    out: List[str] = []
    seen = set()
    for x in v:
        if not isinstance(x, str):
            continue
        name = x.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


# ---------------------------------------------------------------------------
# 单张表
# ---------------------------------------------------------------------------

class Table:
    """一张行为表 = 一个阵容阶段。"""

    def __init__(self, raw: Dict[str, Any], index: int):
        self.index = index
        self.raw = raw if isinstance(raw, dict) else {}

        self.from_level: int = _as_int(self.raw.get("from_level"), 1) or 1
        # to_level 允许 null（= 一直沿用到下一张表的 from_level）
        self.to_level: Optional[int] = _as_int(self.raw.get("to_level"), None)

        lineup = self.raw.get("lineup")
        lineup = lineup if isinstance(lineup, dict) else {}
        self.plants: List[str] = _norm_plants(lineup.get("plants"))
        self.deck: Optional[str] = lineup.get("deck") or None

        slots = self.raw.get("slots")
        self.slots: Dict[str, str] = {}
        if isinstance(slots, dict):
            for k, v in slots.items():
                if isinstance(v, str) and v.strip():
                    self.slots[str(k)] = v.strip()

        # 动作后等待：{ "once|card2|2,1|2": 2, ... }（网页端 jobPlacementKey 的键）
        # ★ 普通关与 boss 关各自独立（bossWaitAfter 缺省 -> 空表）
        wa = self.raw.get("waitAfter")
        self.wait_after: Dict[str, Any] = wa if isinstance(wa, dict) else {}
        bwa = self.raw.get("bossWaitAfter")
        self.boss_wait_after: Dict[str, Any] = bwa if isinstance(bwa, dict) else {}

        self.non_boss: Dict[str, Any] = self._norm_rules(self.raw.get("non_boss"), self.wait_after)
        # ★ boss 规则用 bossWaitAfter（boss 关的等待与普通关完全独立）
        self.boss: Dict[str, Any] = self._norm_rules(self.raw.get("boss"), self.boss_wait_after)

    # -- 规则规范化 --------------------------------------------------------

    @staticmethod
    def _norm_rules(raw: Any, wait_after: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """把一张表里的 non_boss / boss 规则块规范化。

        sequence 是网页端的「落子顺序」权威来源（含 plant/feed/shovel 的先后），
        plant/feed/shovel 三个平铺数组保留给需要分组执行的场景。
        wait_after 是本表的「动作后等待」表，会被挂到链条每一项的 waits 上。
        """
        raw = raw if isinstance(raw, dict) else {}
        wait_after = wait_after if isinstance(wait_after, dict) else {}

        def _cells(key: str) -> List[str]:
            v = raw.get(key)
            if not isinstance(v, (list, tuple)):
                return []
            out = []
            for x in v:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        # plant: [{"slot": "1", "cells": [...]}, ...] —— 保留多个格子可重复（同一格多次种）
        plants: List[Dict[str, Any]] = []
        raw_plant = raw.get("plant")
        if isinstance(raw_plant, (list, tuple)):
            for item in raw_plant:
                if not isinstance(item, dict):
                    continue
                cells = [
                    c.strip() for c in (item.get("cells") or [])
                    if isinstance(c, str) and c.strip()
                ]
                if not cells:
                    continue
                slot = item.get("slot")
                plants.append({
                    "slot": str(slot) if slot not in (None, "") else None,
                    "cells": cells,
                })

        # sequence: 落子顺序 [{slot, order, type, label, cell}, ...]
        # ★ 权威来源是 once_chain / loop_chain（见下）；sequence 只作为旧数据回退。
        sequence: List[Dict[str, Any]] = []
        raw_seq = raw.get("sequence")
        if isinstance(raw_seq, (list, tuple)):
            for item in raw_seq:
                if not isinstance(item, dict):
                    continue
                cell = item.get("cell")
                if not isinstance(cell, str) or not cell.strip():
                    continue
                slot = item.get("slot")
                sequence.append({
                    "slot": str(slot) if slot not in (None, "") else None,
                    "order": _as_int(item.get("order"), 0) or 0,
                    "type": str(item.get("type") or "plant").strip().lower(),
                    "label": item.get("label") or "",
                    "cell": cell.strip(),
                })

        def _chain(key: str) -> List[Dict[str, Any]]:
            """规范化 once_chain / loop_chain。

            每项：{key, slot, type, label, mode, cells:[格子R_C, ...], waits:[秒,...]}
            链条里段的先后 = 执行先后，段内 cells 的先后 = 该槽落子先后。
            waits 与 cells **等长**，waits[i] 是第 i 个落点动作**之后**要等待的秒数
            （0 表示不等待），来自作业集的 waitAfter。
            """
            out: List[Dict[str, Any]] = []
            raw_chain = raw.get(key)
            if not isinstance(raw_chain, (list, tuple)):
                return out
            which = "loop" if key == "loop_chain" else "once"
            for seg in raw_chain:
                if not isinstance(seg, dict):
                    continue
                cells = [
                    c.strip() for c in (seg.get("cells") or [])
                    if isinstance(c, str) and c.strip()
                ]
                if not cells:
                    continue
                slot = seg.get("slot")
                key_name = str(seg.get("key") or "").strip()
                out.append({
                    "key": key_name,
                    "slot": str(slot) if slot not in (None, "") else None,
                    "type": str(seg.get("type") or "plant").strip().lower(),
                    "label": seg.get("label") or "",
                    "cells": cells,
                    "waits": _waits_for_seg(key_name, cells, which),
                })
            return out

        def _waits_for_seg(key_name: str, cells: List[str], which: str) -> List[float]:
            """取这一段里每个格子的「动作后等待」秒数。

            waitAfter 的键格式（网页端 jobPlacementKey 定义）：
                {模式}|{槽位key}|{r},{c}|{seq}
            注意是 **(r, c)** —— 行在前、列在后，不是 (列,行)。

            网页端调用：jobPlacementKey(which, key, entry.r, entry.c, seq)
            而函数签名是 jobPlacementKey(mode, scopeId, r, c, seq)，
            所以键里的 "2,1" = r=2, c=1 = 行2 列1。

            格子名 "格子X_Y" 是 列X_行Y（网页端 '格子'+(c+1)+'_'+(r+1)），
            因此需要把键的 (r,c) 换算成 格子{c+1}_{r+1} 才能对上。

            同一格在链里可能出现多次（seq 不同），取**最大**等待 ——
            网页端对同一格多次落子一般配同一个等待，取最大最接近意图。
            """
            if not isinstance(wait_after, dict) or not wait_after:
                return [0.0] * len(cells)

            # 预处理：{模式|key|r,c|seq: 秒} -> {(模式, key, 格子名): [秒,...]}
            table: Dict[tuple, List[float]] = {}
            for wk, wv in wait_after.items():
                if not isinstance(wk, str):
                    continue
                parts = wk.split("|")
                if len(parts) != 4:
                    continue
                mode, skey, rc, _seq = parts
                try:
                    r_s, c_s = rc.split(",")
                    r = int(r_s)
                    c = int(c_s)
                except (ValueError, AttributeError):
                    continue
                try:
                    sec = float(wv)
                except (TypeError, ValueError):
                    continue
                # (r,c) -> 格子名（列c+1_行r+1）
                cell_name = f"格子{c + 1}_{r + 1}"
                table.setdefault((mode, skey, cell_name), []).append(sec)

            out: List[float] = []
            for cell in cells:
                hits = table.get((which, key_name, str(cell))) or []
                out.append(max(hits) if hits else 0.0)
            return out

        return {
            "plant": plants,
            "feed": _cells("feed"),
            "shovel": _cells("shovel"),
            "wave": _as_bool(raw.get("wave"), False),
            "loop": _as_bool(raw.get("loop"), False),
            "once": _as_bool(raw.get("once"), False),
            "sequence": sequence,
            "once_chain": _chain("once_chain"),
            "loop_chain": _chain("loop_chain"),
        }

    # -- 查询 --------------------------------------------------------------

    def covers(self, level: Optional[int]) -> bool:
        """第 level 关是否落在本表区间内。

        ★ 区间的上半是**开区间**：to_level 表示「下一张表的起始关」。
          表1 [from=1, to=50] -> 1~49 关用表1，**50 关开始用表2**。
          这与网页端「上一张的结束关 = 下一张的起始关」的联动一致，
          也符合「打到 50 关就换表2」的直觉。

          to_level 为 None 表示无上限（一直沿用到下一张表的 from_level）。
        """
        lv = _as_int(level, None)
        if lv is None:
            return False
        if lv < self.from_level:
            return False
        if self.to_level is not None and lv >= self.to_level:
            return False
        return True

    def rules(self, is_boss: bool) -> Dict[str, Any]:
        """按是否 boss 关取种植规则。"""
        return self.boss if is_boss else self.non_boss

    def __repr__(self) -> str:
        rng = f"{self.from_level}~{self.to_level if self.to_level is not None else '-'}"
        return f"<Table#{self.index} {rng} plants={self.plants}>"


# ---------------------------------------------------------------------------
# 作业集
# ---------------------------------------------------------------------------

class JobSet:
    """一份作业集（一个 <code>.json）。"""

    def __init__(self, raw: Dict[str, Any], code: str = "", source: Optional[Path] = None):
        if not isinstance(raw, dict):
            raise JobSetError("作业集根节点必须是 JSON 对象")

        self.raw = raw
        self.code: str = str(raw.get("code") or code or "").strip()
        self.name: str = str(raw.get("name") or "").strip() or self.code or "(未命名)"
        self.version: str = str(raw.get("version") or "").strip()
        self.source: Optional[Path] = source

        worlds = raw.get("worlds")
        self.worlds: List[str] = [
            w.strip() for w in worlds
            if isinstance(w, str) and w.strip()
        ] if isinstance(worlds, (list, tuple)) else []

        self.max_level: Optional[int] = _as_int(raw.get("max_level"), None)

        raw_tables = raw.get("tables")
        if not isinstance(raw_tables, (list, tuple)) or not raw_tables:
            raise JobSetError(f"作业集「{self.name}」没有任何行为表（tables 为空）")

        self.tables: List[Table] = [
            Table(t, i) for i, t in enumerate(raw_tables)
        ]
        # 按 from_level 升序 —— 网页端本就保证有序，这里做一次兜底
        self.tables.sort(key=lambda t: (t.from_level, t.index))

    # -- 选表 --------------------------------------------------------------

    def pick_table(self, level: int) -> Table:
        """按当前关卡选表。

        规则：取最后一张 from_level <= level 的表（区间上限是开区间）。
            L=1,  表1[1,50), 表2[50,-)  -> 表1
            L=49, 表1[1,50), 表2[50,-)  -> 表1
            L=50, 表1[1,50), 表2[50,-)  -> 表2   ★ 到 50 就换表2
            L=99, 表1[1,50), 表2[50,-)  -> 表2

        之所以按 from_level 取「最后一张 <= lv」，而不是按 to_level 找区间：
        作者可能只填 from_level（to_level 为 null），此时 to_level 不参与判定，
        而下一张表的 from_level 天然就是本表的上界。
        """
        lv = _as_int(level, None)
        if lv is None:
            return self.tables[0]

        chosen = self.tables[0]
        for t in self.tables:
            if t.from_level <= lv:
                chosen = t
            else:
                break
        return chosen

    def stage_of(self, level: int) -> int:
        """当前关属于第几张表（0 起）。"""
        return self.pick_table(level).index

    # -- 便捷访问 ----------------------------------------------------------

    def lineup_at(self, level: int) -> Dict[str, Any]:
        """第 level 关该用的选卡配置。"""
        t = self.pick_table(level)
        return {
            "plants": list(t.plants),
            "deck": t.deck,
            "slots": dict(t.slots),
            "table_index": t.index,
            "from_level": t.from_level,
            "to_level": t.to_level,
        }

    def rules_at(self, level: int, is_boss: bool = False) -> Dict[str, Any]:
        """第 level 关该用的种植规则。"""
        return self.pick_table(level).rules(is_boss)

    def transition_levels(self) -> List[int]:
        """所有换阵容锚点（第 2 张表起的 from_level），升序。"""
        return [t.from_level for t in self.tables[1:]]

    def __repr__(self) -> str:
        return f"<JobSet {self.code!r} name={self.name!r} tables={len(self.tables)}>"


# ---------------------------------------------------------------------------
# 载入
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise JobSetError(f"文件不存在：{path}")
    except json.JSONDecodeError as e:
        raise JobSetError(f"JSON 解析失败 {path}: {e}")
    except OSError as e:
        raise JobSetError(f"读取失败 {path}: {e}")


def read_current_code(jobs_dir: Optional[Path] = None) -> str:
    """读 jobs/current.json 里的 code（网页端点「选择作业集」时写入）。"""
    d = Path(jobs_dir) if jobs_dir else DEFAULT_JOBS_DIR
    cur = d / CURRENT_FILE
    if not cur.exists():
        return ""
    try:
        data = _read_json(cur)
    except JobSetError:
        return ""
    code = data.get("code") if isinstance(data, dict) else None
    return str(code).strip() if code else ""


def load_jobset(
    code: Optional[str] = None,
    jobs_dir: Optional[Path] = None,
) -> JobSet:
    """载入作业集。

    code 为 None/空 -> 用 jobs/current.json 里记录的当前作业集。
    """
    d = Path(jobs_dir) if jobs_dir else DEFAULT_JOBS_DIR
    if not d.is_dir():
        raise JobSetError(f"作业集目录不存在：{d}")

    code = (code or "").strip() or read_current_code(d)
    if not code:
        raise JobSetError(
            "未选择作业集：jobs/current.json 里没有 code，"
            "请先在网页编辑器里点「选择作业集」"
        )

    # 防目录穿越：code 只允许文件名安全字符
    if any(c in code for c in ("/", "\\", "..")):
        raise JobSetError(f"非法作业集代码：{code!r}")

    path = d / f"{code}.json"
    if not path.exists():
        raise JobSetError(f"作业集文件不存在：{path}")

    return JobSet(_read_json(path), code=code, source=path)


def pick_table(level: int, jobset: JobSet) -> Table:
    """模块级便捷函数：等价于 jobset.pick_table(level)。"""
    return jobset.pick_table(level)
