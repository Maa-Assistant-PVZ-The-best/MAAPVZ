# -*- coding: utf-8 -*-
"""离线自测：engine + level_tracker，不需要设备/MaaFw。

    python -m agent.jobset.selfcheck
    （或 python agent/jobset/selfcheck.py）
"""

import sys
from pathlib import Path

# 允许直接 python agent/jobset/selfcheck.py
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from agent.jobset.engine import JobSet, Table, load_jobset, pick_table  # noqa: E402
from agent.jobset.level_tracker import LevelTracker  # noqa: E402

FAILED = []


def check(name, cond, detail=""):
    tag = "OK  " if cond else "FAIL"
    print(f"  [{tag}] {name}" + (f"  {detail}" if detail else ""))
    if not cond:
        FAILED.append(name)


# ---------------------------------------------------------------------------
print("\n=== 1. 载入真实作业集（心塔） ===")
try:
    js = load_jobset()
    print(f"  code={js.code}  name={js.name}  tables={len(js.tables)}")
    for t in js.tables:
        print(f"    {t!r}")
        print(f"      lineup.plants = {t.plants}")
        print(f"      slots         = {t.slots}")
        print(f"      non_boss: plant={len(t.non_boss['plant'])} "
              f"feed={len(t.non_boss['feed'])} shovel={len(t.non_boss['shovel'])} "
              f"seq={len(t.non_boss['sequence'])}")
        print(f"      boss    : plant={len(t.boss['plant'])} seq={len(t.boss['sequence'])}")
    check("载入成功", js.code == "pvz_20260926_015808", js.name)
    # 至少有一张表配了植物（哪张表配的会随作者调整，不做硬编码）
    any_plants = any(t.plants for t in js.tables)
    check("至少一张表有植物列表", any_plants,
          str([t.plants for t in js.tables]))
except Exception as e:
    check("载入作业集", False, f"{type(e).__name__}: {e}")
    js = None


# ---------------------------------------------------------------------------
print("\n=== 2. 选表 pick_table（用真实作业集，表区间会随作者调整） ===")
if js:
    t0 = js.pick_table(1)
    check("L=1 -> 第一张表", t0.index == 0, f"got=表{t0.index + 1}")
    t99 = js.pick_table(99)
    check("L=99 -> 最后一张表", t99.index == len(js.tables) - 1,
          f"got=表{t99.index + 1}")
    t999 = js.pick_table(200)
    check("L=200 仍在有效表内", t999 is not None)
    print(f"  表区间: " + ", ".join(
        f"表{t.index + 1}[{t.from_level}~{t.to_level if t.to_level is not None else '末'}]"
        for t in js.tables))
    print(f"  lineup@1   = {js.lineup_at(1)['plants']}")
    print(f"  rules@1    = non_boss seq={len(js.rules_at(1, False)['sequence'])}")
    print(f"  transition_levels = {js.transition_levels()}")


# ---------------------------------------------------------------------------
print("\n=== 3. 合成多表作业集：换阵容锚点 ===")
raw = {
    "code": "t", "name": "三表测试", "max_level": 149,
    "tables": [
        {"from_level": 1,  "to_level": 50,  "lineup": {"plants": ["A", "B"]},
         "slots": {"1": "A"}, "non_boss": {"feed": ["c1"]}, "boss": {}},
        {"from_level": 50, "to_level": 70,  "lineup": {"plants": ["C", "D"]},
         "slots": {"1": "C"}, "non_boss": {"feed": ["c2"]}, "boss": {}},
        {"from_level": 70, "to_level": None, "lineup": {"plants": ["E"]},
         "slots": {"1": "E"}, "non_boss": {"feed": ["c3"]}, "boss": {}},
    ],
}
js2 = JobSet(raw, code="t")
# ★ 区间上半是开区间：表1 的 to_level=50 表示「50 关开始归表2」
cases = [(1, 0), (49, 0), (50, 1), (51, 1), (69, 1), (70, 2), (71, 2), (149, 2)]
for lv, want in cases:
    got = js2.pick_table(lv).index
    check(f"L={lv} -> 表{want + 1}", got == want, f"got=表{got + 1}")
check("锚点列表", js2.transition_levels() == [50, 70], str(js2.transition_levels()))
check("换阵容后 plant 变了", js2.lineup_at(50)["plants"] == ["C", "D"],
      str(js2.lineup_at(50)["plants"]))
check("边界 L=50 归表2", js2.pick_table(50).index == 1)
check("边界 L=49 归表1", js2.pick_table(49).index == 0)

# 边界：单表 to_level=None
js3 = JobSet({"name": "单表", "tables": [{"from_level": 1, "lineup": {"plants": ["X"]}}]}, code="s")
check("单表 L=1", js3.pick_table(1).index == 0)
check("单表 L=149", js3.pick_table(149).index == 0)
check("单表 L=0 兜底", js3.pick_table(0).index == 0)


# ---------------------------------------------------------------------------
print("\n=== 4. 关卡计数器 · 你给的场景（实际55，错认57） ===")
lt = LevelTracker()
print(f"  初始: {lt.describe()}")
c = lt.observe(57, first=True)      # ★ 基准帧
print(f"  首次 OCR=57 -> count={c} score={lt.score}  {lt.state.last_verdict}")
check("首次采信 OCR", c == 57, f"count={c}")
check("初始分 50", lt.score == 50, f"score={lt.score}")

c = lt.observe(56)
print(f"  下一关 OCR=56 -> count={c} score={lt.score}  {lt.state.last_verdict}")
check("抖动时计数保持 57", c == 57, f"count={c}")
check("抖动扣分 40", lt.score == 40, f"score={lt.score}")


# ---------------------------------------------------------------------------
print("\n=== 5. 连续识别正确 -> 进入纯计数器 ===")
lt = LevelTracker()
lt.observe(10, first=True)      # 基准
for i in range(11, 14):
    lt.observe(i)
    print(f"  OCR={i} -> count={lt.count} score={lt.score} locked={lt.locked}")
check("连续正确后锁定", lt.locked, f"score={lt.score}")
check("锁定分=100", lt.score == 100, f"score={lt.score}")
before = lt.count
c = lt.observe(None)    # 锁定后 OCR 不再影响
print(f"  锁定后 OCR=None -> count={c}")
check("锁定后仍能推进", c == before + 1, f"{before} -> {c}")


# ---------------------------------------------------------------------------
print("\n=== 6. 大幅偏差 -> 信任计数器 / 分数触底回头信 OCR ===")
lt = LevelTracker()
lt.observe(30, first=True)     # 基准
c = lt.observe(35)             # 预测31，偏差4 > 容差2，扣到40 -> 信计数器
print(f"  30 -> OCR=35: count={c} score={lt.score} {lt.state.last_verdict}")
check("偏差大信计数器", c == 31, f"count={c}")
check("扣分后 40", lt.score == 40, f"score={lt.score}")

lt2 = LevelTracker(init_score=10, penalty=10, tolerance=2)  # 一次就触底
lt2.observe(30, first=True)
c = lt2.observe(99)
print(f"  触底场景: count={c} score={lt2.score} {lt2.state.last_verdict}")
check("触底回头信 OCR", c == 99, f"count={c}")
check("触底后分数回初始", lt2.score == 10, f"score={lt2.score}")


# ---------------------------------------------------------------------------
print("\n=== 6b. 跳关：中途从 12 直接到 49（OCR 连续，基准应跟上） ===")
lt = LevelTracker()
lt.observe(12, first=True)
print(f"  基准 OCR=12 -> count={lt.count} anchor={lt.state.last_anchor}")
for raw in (49, 50, 51):
    c = lt.observe(raw)
    print(f"  OCR={raw} -> count={c} anchor={lt.state.last_anchor} "
          f"score={lt.score} {lt.state.last_verdict}")
check("跳关后基准跟上真实关卡", lt.state.last_anchor == 51, f"anchor={lt.state.last_anchor}")
check("跳关后 count 正确", lt.count == 51, f"count={lt.count}")


# ---------------------------------------------------------------------------
print("\n=== 6c. 中途进入：本次任务第一次识别 40 关 -> count=40 ===")
lt = LevelTracker()
c = lt.observe(40, first=True)
print(f"  基准帧 OCR=40 -> count={c} score={lt.score}")
check("基准帧直接采信", c == 40, f"count={c}")
check("基准帧重置分数", lt.score == 50, f"score={lt.score}")


# ---------------------------------------------------------------------------
print("\n=== 7. reset 重置 ===")
lt.reset()
check("reset 后 count=0", lt.count == 0, f"count={lt.count}")
check("reset 后未锁定", not lt.locked)


# ---------------------------------------------------------------------------
print("\n" + "=" * 52)
if FAILED:
    print(f"FAILED {len(FAILED)}: {FAILED}")
    sys.exit(1)
print("全部通过")
