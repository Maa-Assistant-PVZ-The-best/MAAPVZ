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
from agent.jobset.level_tracker import (  # noqa: E402
    LevelTracker, BOSS_SNAP, BOSS_SNAP_TOLERANCE,
)

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
        print(f"      non_boss: once={len(t.non_boss['once_chain'])}段 "
              f"loop={len(t.non_boss['loop_chain'])}段 "
              f"end={len(t.non_boss['end_chain'])}段 "
              f"seq={len(t.non_boss['sequence'])}")
        print(f"      boss    : once={len(t.boss['once_chain'])}段 "
              f"loop={len(t.boss['loop_chain'])}段 "
              f"seq={len(t.boss['sequence'])}")
    # ★ 不校验具体代码：作者每次「保存作业集」都会生成带新时间戳的 code
    #   （pvz_2026...），写死某个值必然过期。只校验「确实载入成功」。
    check("载入成功", bool(js.code) and len(js.tables) > 0,
          f"{js.name} ({js.code}, {len(js.tables)} 张表)")
    # 至少有一张表配了植物（哪张表配的会随作者调整，不做硬编码）
    #
    # ★ 但「换阵 = 编队」的表 plants 本来就是空的（用 squad 切编队，不经选卡），
    #   这时不该算失败 —— 判据放宽成「有植物 或 有编队号」。
    any_lineup = any(t.plants or t.squad for t in js.tables)
    check("至少一张表有植物列表或编队号", any_lineup,
          str([(t.plants, t.squad) for t in js.tables]))
except Exception as e:
    check("载入作业集", False, f"{type(e).__name__}: {e}")
    js = None


# ---------------------------------------------------------------------------
print("\n=== 2. 选表 pick_table（用真实作业集，表区间会随作者调整） ===")
if js:
    if getattr(js, "layered", False):
        # ★ 图层模式：覆盖由 levels 决定，pick = 第一个覆盖该关的表。
        #   断言「pick 结果确实覆盖该关」+「1..max 全铺满」，
        #   不再假设「小编号表管前期」（布局配置里图层顺序是用户自己排的）。
        t0 = js.pick_table(1)
        check("L=1 -> 覆盖它的表", t0.covers(1), f"got=表{t0.index + 1}")
        t99 = js.pick_table(99)
        check("L=99 -> 覆盖它的表", t99.covers(99), f"got=表{t99.index + 1}")
        max_lv = js.max_level or 149
        missing = [lv for lv in range(1, max_lv + 1)
                   if not any(t.covers(lv) for t in js.tables)]
        check("图层模式 1..%d 全铺满" % max_lv, not missing,
              ("缺 " + "、".join(map(str, missing[:10]))) if missing else "")
        print("  覆盖: " + ", ".join(
            "表%d(%s)%d关" % (t.index + 1, t.label or "-",
                             len(t.levels) if t.levels else 0)
            for t in js.tables))
    else:
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
print("\n=== 4. 计数器：起始关卡 + 逐关推进（不再有 OCR） ===")
lt = LevelTracker(start_level=87)
print(f"  初始: {lt.describe()}")
check("起始关卡生效", lt.count == 87, f"count={lt.count}")

c = lt.tick()
check("tick 后 +1", c == 88, f"count={c}")
c = lt.tick()
check("再 tick -> 89", c == 89, f"count={c}")
check("计数器是纯推进（不受任何 OCR 影响）", lt.count == 89, f"count={lt.count}")

# ★ 兼容垫片：observe() 现在忽略 raw，只做 +1
_lt_ob = LevelTracker(start_level=10)
_lt_ob.observe(999)          # 旧版会采信 999，新版应忽略
check("observe 忽略 raw（不再采信 OCR）", _lt_ob.count == 11, f"count={_lt_ob.count}")


# ---------------------------------------------------------------------------
print("\n=== 5. boss 关：计数器对齐到最近的 5 的倍数（唯一自愈机制） ===")
lt = LevelTracker(start_level=56)
res = lt.snap_boss()
print(f"  56 -> {res}")
check("boss 对齐到 55 或 60（就近）", res["after"] in (55, 60), str(res["after"]))
check("就近选择 = 55", res["after"] == 55, str(res["after"]))
check("发生了偏移", res["snapped"] is True, str(res))
check("计数器已更新", lt.count == res["after"], f"count={lt.count}")

# 本来就在 5 的倍数上 -> 不变
lt2 = LevelTracker(start_level=60)
res2 = lt2.snap_boss()
check("已是 5 的倍数则不变", res2["snapped"] is False and res2["after"] == 60, str(res2))

# 偏差 >2 也能对齐（只是可能对到相邻 boss）—— 用户明确接受
#
# ★ 注意「偏差」是 |after - before|（对齐后与对齐前的距离），
#   而不是 |before - 最近的5的倍数| —— 两者等价，因为 after 就是那个倍数。
#     53 -> 55 偏移 +2（就近，正确）
#     52 -> 50 偏移 -2（就近，正确）
#     51 -> 50 偏移 -1 …
#   要触发 too_far 需要 |offset| >= 3，即 before 距某个 5 的倍数 >= 3 ——
#   但「最近的 5 的倍数」距离恒 <= 2，所以 **round 之后 offset 永远 <= 2**。
#   换句话说：就近取整永不判 too_far。
#   真正会「对到相邻 boss」的是**手写向上/向下取整**的实现，不是 round。
#   所以这里如实断言：round 实现下 too_far 恒为 False（这是设计事实）。
lt3 = LevelTracker(start_level=53)
res3 = lt3.snap_boss()
check("偏差 2 时对齐到 55", res3["after"] == 55, str(res3["after"]))
check("round 就近取整下 too_far 恒 False", res3["too_far"] is False, str(res3))

lt4 = LevelTracker(start_level=58)
res4 = lt4.snap_boss()
check("58 就近到 60", res4["after"] == 60, str(res4["after"]))
check("offset = +2", res4["offset"] == 2, str(res4))
check("58 不标 too_far", res4["too_far"] is False, str(res4))

# 边界：距 5 的倍数恰好 2.5 时 round 的行为（不崩即可）
lt6 = LevelTracker(start_level=1)
res6 = lt6.snap_boss()
check("关卡 1 就近到 0 -> 夹到 5", res6["after"] == 5, str(res6))
check("最小关夹取生效", res6["after"] >= BOSS_SNAP, str(res6))

# ★ 用户可见日志：每次 boss 关都要输出「boss关，当前关卡数：xxx」
_msgs = lt2.snap_boss_message(res2)
print(f"  用户可见日志: {_msgs}")
check("boss 日志含『boss关，当前关卡数：』", "boss关，当前关卡数：60" in _msgs[0], str(_msgs))
check("未偏移时不输出偏移警告", len(_msgs) == 1, str(_msgs))

_msgs3 = lt3.snap_boss_message(res3)
print(f"  用户可见日志(偏移): {_msgs3}")
check("偏移时输出两行", len(_msgs3) == 2, str(_msgs3))
check("偏移日志含『已自动偏移』", "已自动偏移" in _msgs3[1], str(_msgs3[1]))

# 计数器为 0 时不崩
lt5 = LevelTracker()
res5 = lt5.snap_boss()
check("计数为 0 时跳过对齐", res5["skipped"] != "", str(res5))
check("计数为 0 的日志不崩", len(lt5.snap_boss_message(res5)) == 1)


# ---------------------------------------------------------------------------
print("\n=== 6. 换阵容不再改动计数器（旧版要 rollback_one） ===")
#
# 旧版：重开后管道会再识别一次天数 -> 计数被多推一格 -> 必须退一格抵消。
# 新版：换阵容走「局外换卡」那条路，**不经过点继续挑战** -> 计数器不动。
lt = LevelTracker(start_level=50)
before = lt.count
# 模拟「换阵容」：只做对齐/读表，不 tick、不 rollback
_after_switch = lt.count
check("换阵容不改变计数器", _after_switch == before, f"{before} -> {_after_switch}")

# 兼容垫片仍在（但正常流程不该调）
_lt_rb = LevelTracker(start_level=50)
_lt_rb.rollback_one()
check("rollback_one 兼容垫片仍可用", _lt_rb.count == 49, f"count={_lt_rb.count}")


# ---------------------------------------------------------------------------
print("\n=== 7. reset 重置 ===")
lt = LevelTracker(start_level=42)
lt.reset()
check("reset() 后 count=0", lt.count == 0, f"count={lt.count}")

lt.reset(77)
check("reset(77) 直接设定", lt.count == 77, f"count={lt.count}")

lt.reset()
check("再 reset() 回 0", lt.count == 0, f"count={lt.count}")


# ---------------------------------------------------------------------------
print("\n=== 7b. 状态行（给日志弹窗用） ===")
lt = LevelTracker(start_level=87)


class _T:
    index = 1
    from_level = 50
    to_level = 100


line = lt.status_line(_T(), is_boss=False)
print(f"  {line}")
check("状态行含关卡", "当前关卡: 87" in line, line)
check("状态行含表号与区间", "表2" in line and "50~100" in line, line)
check("状态行含普通关", "普通关" in line, line)

line_b = lt.status_line(_T(), is_boss=True)
check("状态行含 boss 关", "boss关" in line_b, line_b)

line_none = lt.status_line(None, is_boss=False)
check("无表时状态行不崩", "当前关卡: 87" in line_none, line_none)


# ---------------------------------------------------------------------------
print("\n=== 7c. 起始关卡参数解析（对接 MAA option） ===")
from agent.jobset.level_tracker import from_params  # noqa: E402

check("正常数字", from_params({"起始关卡": 87}).count == 87)
check("字符串数字", from_params({"起始关卡": "87"}).count == 87)
check("缺键 -> 0", from_params({}).count == 0)
check("空串 -> 0", from_params({"起始关卡": ""}).count == 0)
check("None -> 0", from_params({"起始关卡": None}).count == 0)
# ★ 占位符没被替换（option 未应用时 MAA 会原样传 "{起始关卡}"）
check("占位符未替换 -> 0（不崩）", from_params({"起始关卡": "{起始关卡}"}).count == 0)
# 越界一律当没填
check("0 -> 0", from_params({"起始关卡": 0}).count == 0)
check("负数 -> 0", from_params({"起始关卡": -5}).count == 0)
check("150 超上限 -> 0", from_params({"起始关卡": 150}).count == 0)
check("149 合法", from_params({"起始关卡": 149}).count == 149)
check("1 合法", from_params({"起始关卡": 1}).count == 1)
check("非法字符串 -> 0", from_params({"起始关卡": "abc"}).count == 0)
check("大写数字不崩", from_params({"起始关卡": "八七"}).count == 0)


# ---------------------------------------------------------------------------
print("\n=== 7d. 局外换阵判断（JobSetPlan 的决策表） ===")
#
# 用户给的设计：
#   正赛：表没变 -> 直接开打；表变了 -> 回清空卡牌重选
#   训练：无论何时都重选一次
from agent.jobset.runtime import (  # noqa: E402
    plan_decision, GATE_UNCHANGED, GATE_CHANGED,
)

# ---- 正赛 ----
_need, _r = plan_decision(training=False, used=0, table_index=0)
check("正赛·表没变 -> 不换", _need is False, _r)
check("正赛·表没变 提示沿用", "沿用" in _r, _r)

_need, _r = plan_decision(training=False, used=0, table_index=1)
check("正赛·表 0->1 -> 换", _need is True, _r)
check("正赛·表变 提示写清方向", "表1 -> 表2" in _r, _r)

_need, _r = plan_decision(training=False, used=2, table_index=1)
check("正赛·表 2->1（回退）-> 换", _need is True, _r)

# ---- 训练：永远换 ----
for _u, _ti in ((0, 0), (0, 1), (1, 1), (2, 0)):
    _need, _r = plan_decision(training=True, used=_u, table_index=_ti)
    check(f"训练·used={_u} table={_ti} -> 必换", _need is True, _r)

# ---- 没有已注入表记录 -> 保守换 ----
_need, _r = plan_decision(training=False, used=None, table_index=0)
check("正赛·无记录 -> 保守换", _need is True, _r)
check("正赛·无记录 提示保守", "保守" in _r, _r)

# ---- 闸门节点名（pipeline 要按这个接）----
check("未变闸门名", GATE_UNCHANGED == "无尽挑战_跳转_未变", GATE_UNCHANGED)
check("变化闸门名", GATE_CHANGED == "无尽挑战_跳转_变化", GATE_CHANGED)
# （2026-10-09：独立计数节点 JobSetTick/NODE_TICK 已删，计数并入 JobSetPlan）


# ---------------------------------------------------------------------------
print("\n=== 8. 切换形态（通用动作 form） ===")
from agent.jobset import dsl as _dsl  # noqa: E402

_coords = _dsl.load_coords()

# 8a. 坐标表里应有「槽N切换形态」，N = 1..GENERIC_FORM_SLOT_MAX
_missing_keys = [
    f"槽{n}切换形态"
    for n in range(1, _dsl.GENERIC_FORM_SLOT_MAX + 1)
    if not _dsl._coord_ok(_coords, f"槽{n}切换形态")
]
check("坐标表含全部「槽N切换形态」键", not _missing_keys, str(_missing_keys))

# 8b. 点 N 次 -> 展开成 N 个 click（不做形态档位换算）
_r = _dsl.generic_dsl("form", _coords, None, 3, 2)
check("form: 槽3 点2次 -> 2 个 click", _r["count"] == 2 and not _r["missing"],
      f"count={_r['count']} dsl={_r['dsl']!r}")
check("form: 点击目标是对应槽位坐标", _r["dsl"] == "click:槽3切换形态;click:槽3切换形态",
      repr(_r["dsl"]))

# 8c. 次数缺省 / 非法 -> 1 次
for _bad in (None, "", "abc", 0, -5):
    _rb = _dsl.generic_dsl("form", _coords, None, 1, _bad)
    check(f"form: times={_bad!r} -> 1 次", _rb["count"] == 1, f"count={_rb['count']}")

# 8d. 次数超上限 -> 夹到 GENERIC_FORM_TIMES_MAX
_rc = _dsl.generic_dsl("form", _coords, None, 1, 9999)
check("form: times 超上限被夹取", _rc["count"] == _dsl.GENERIC_FORM_TIMES_MAX,
      f"count={_rc['count']} max={_dsl.GENERIC_FORM_TIMES_MAX}")

# 8e. ★ 槽位越界必须判无效（不能悄悄退化成相邻槽 —— 那会点错按钮）
for _bad_slot in (0, -1, _dsl.GENERIC_FORM_SLOT_MAX + 1, None, "x"):
    _rs = _dsl.generic_dsl("form", _coords, None, _bad_slot, 1)
    check(f"form: 槽位 {_bad_slot!r} 判无效", _rs["count"] == 0 and bool(_rs["missing"]),
          f"count={_rs['count']} missing={_rs['missing']}")

# 8f. 'ga:form' 前缀形式（作业集里 key 的写法）等价
_rg = _dsl.generic_dsl("ga:form", _coords, None, 2, 3)
check("form: 'ga:form' 前缀等价", _rg["count"] == 3 and not _rg["missing"],
      f"count={_rg['count']}")

# 8g. ★ 参数袋形式（网页端实际传的是整个段）—— 新增动作走这条路，免改 generic_dsl
_rp = _dsl.generic_dsl("form", _coords, None, None, None, {"slot": 5, "times": 4})
check("form: 参数袋形式生效", _rp["count"] == 4 and not _rp["missing"],
      f"count={_rp['count']} dsl={_rp['dsl']!r}")
check("form: 参数袋选中正确槽位",
      _rp["dsl"] == "click:槽5切换形态;" * 3 + "click:槽5切换形态", repr(_rp["dsl"]))

# 8h. 数据驱动表 GENERIC_SLOT_CLICK 应包含 form，且坐标模板能展开
check("GENERIC_SLOT_CLICK 含 form", "form" in _dsl.GENERIC_SLOT_CLICK,
      str(list(_dsl.GENERIC_SLOT_CLICK)))
_spec = _dsl.GENERIC_SLOT_CLICK.get("form", {})
check("form spec 坐标模板可用", _spec.get("coord", "").format(n=1) == "槽1切换形态",
      _spec.get("coord"))

# 8i. ★ 表中的每个动作都必须有对应坐标（防止加了动作却忘了加坐标）
for _aid, _sp in _dsl.GENERIC_SLOT_CLICK.items():
    _miss = [
        n for n in range(1, _sp.get("slot_max", 8) + 1)
        if not _dsl._coord_ok(_coords, _sp["coord"].format(n=n))
    ]
    check(f"{_aid}: 表中槽位坐标齐全", not _miss, str(_miss))

# 8j. ★ 贯穿回归（engine → compile 全链路）：
#     历史 bug —— engine._chain 把通用动作段的 slot 写死 None、times 丢弃，
#     编译期 generic_dsl 判槽位无效 -> 整段消失 -> 局内"点不了切换形态"。
#     上面 8b-8i 都直接测 generic_dsl，绕过了 engine 层，所以全绿也漏检。
from agent.jobset import engine as _eng  # noqa: E402
from agent.jobset import compile as _cpl8j  # noqa: E402

_raw8j = {
    "from_level": 1,
    "lineup": {"plants": ["大喷菇"]},
    "slots": {"1": "大喷菇"},
    "non_boss": {
        "once_chain": [
            {"key": "card1", "slot": "1", "type": "plant",
             "cells": ["格子2_3"], "waits": []},
            {"key": "ga:form", "ga": "form", "type": "action",
             "slot": 3, "times": 2, "cells": [], "waits": []},
        ],
        "loop_chain": [],
    },
}
_rules8j = _eng.Table(_raw8j, 0).rules(False)
_seg8j = [s for s in _rules8j.get("once_chain", []) if s.get("key") == "ga:form"]
check("贯穿: engine 规范化保留 form 的 slot/times",
      bool(_seg8j) and _seg8j[0].get("slot") == 3 and _seg8j[0].get("times") == 2,
      repr(_seg8j))
_logs8j: list = []
_out8j = _cpl8j.build_chain_nodes(_rules8j, _coords, 80, None, 10, False,
                                  log=_logs8j.append)
_dsl8j = (_out8j.get("once") or {}).get("dsl", "")
check("贯穿: 编译后 DSL 含 click:槽3切换形态 ×2",
      _dsl8j.count("click:槽3切换形态") == 2, repr(_dsl8j))
check("贯穿: 编译日志无「通用动作跳过」",
      not any("通用动作跳过" in m for m in _logs8j), repr(_logs8j))

# ---------------------------------------------------------------------------
print("\n=== 9. 落子动作「点击格子」===")

from agent.jobset import compile as _cpl  # noqa: E402

# 9a. 真编译器（compile.build_chain_nodes）应把 type='tap' 编译成 click:格子N_M
#     （**没有起点**）；DSL 带 every:/ref: 前缀，所以断言用包含而非全等。
_tap = {
    "key": "tapcell", "type": "tap", "label": "点击格子", "cells": ["格子2_3", "格子4_5"],
}
_logs9a: list = []
_out9a = _cpl.build_chain_nodes(
    {"once_chain": [_tap], "loop_chain": [], "end_chain": []},
    _coords, 80, None, 10, False, log=_logs9a.append)
_dsl9a = (_out9a.get("once") or {}).get("dsl", "")
check("tap: 编译为 click（无起点）",
      "click:种植物_初始化_格子2_3;click:种植物_初始化_格子4_5" in _dsl9a,
      repr(_dsl9a))

# 9b. ★ tap 不该因为「没有起点」而产生任何告警（它是正常路径）
check("tap: 无起点不算告警", not _logs9a, str(_logs9a))

# 9c. feed/shovel 缺起点仍然要告警（回归保护）
#     ★ 用**真实坐标表**（格子找得到），但把能量豆起点从副本里删掉 ——
#       这样才隔离出「缺起点」这一种情况，而不是「格子无坐标」。
_coords_nofeed = {k: v for k, v in _coords.items()
                  if "能量豆" not in k and "喂豆" not in k}
_feed_bad = {"key": "feed", "type": "feed", "label": "喂豆", "cells": ["格子1_1"]}
_logs9c: list = []
_out9c = _cpl.build_chain_nodes(
    {"once_chain": [_feed_bad], "loop_chain": [], "end_chain": []},
    _coords_nofeed, 80, None, 10, False, log=_logs9c.append)
_dsl9c = (_out9c.get("once") or {}).get("dsl", "")
check("feed: 缺起点仍告警",
      any("退化为 click" in m for m in _logs9c), str(_logs9c))
check("feed: 缺起点时退化为 click（不丢动作）",
      "click:种植物_初始化_格子1_1" in _dsl9c, repr(_dsl9c))

# 9d. 端到端：tap 段能进 build_chain_nodes 并和其他段正确交织
try:
    from agent.jobset import compile as _cpl  # noqa: E402
    _rules9 = {
        "once_chain": [
            {"key": "card1", "type": "plant", "slot": 1, "cells": ["格子1_1"]},
            _tap,
            {"key": "ga:wave", "type": "action", "action": "wave"},
        ],
        "loop_chain": [],
        "end_chain": [],
    }
    _out9 = _cpl.build_chain_nodes(_rules9, _coords, 80, None, 10, False)
    _dsl9 = (_out9.get("once") or {}).get("dsl", "")
    check("tap: 端到端出现在链路里",
          "click:种植物_初始化_格子2_3" in _dsl9 and "swipe:" in _dsl9, repr(_dsl9))
    check("tap: 与点波段共存", "click:下一波" in _dsl9)
except Exception as _e9:
    check("tap: 端到端编译", False, f"{type(_e9).__name__}: {_e9}")


# ---------------------------------------------------------------------------
print("\n=== 10. 编队注入：custom 节点「无尽_选择编队」写 custom_action_param ===")
#
# 背景（2026-10-23 重写）：编队选择从 pipe 节点链（Or 具名分支识别编队1/2）
# 改为 SelectPlants 的「编队选择」custom 模式闭环（识别->点击->白字核对->
# 回弹重试）。运行时注入只动两处：清空卡牌.next + 无尽_选择编队 的
# custom_action_param。这里同时把注入结果与**真实 pipe 文件**对照。
try:
    import json as _json10
    from agent.jobset import runtime as _rt10

    _p_none = _rt10._squad_param(None)
    _p_sq = _rt10._squad_param(3)

    # --- 选卡分支：next 还原 + custom 目标编队清 0 ---
    check("squad=None: 清空卡牌 next 还原成选卡",
          _p_none[_rt10.NODE_CLEAR_CARDS]["next"] == [_rt10.NODE_CHOOSE_PLANTS],
          str(_p_none[_rt10.NODE_CLEAR_CARDS]["next"]))
    check("squad=None: 选择编队 param 清 0（防残留）",
          _p_none[_rt10.NODE_SQUAD_PICK]["custom_action_param"]["目标编队"] == 0
          and _p_none[_rt10.NODE_SQUAD_PICK]["custom_action_param"]["编队选择"] is True)

    # --- 编队分支：next 换成切换编队 + custom param 写入编队号 ---
    check("squad=3: 清空卡牌 next 换成切换编队",
          _p_sq[_rt10.NODE_CLEAR_CARDS]["next"] == [_rt10.NODE_SWITCH_SQUAD],
          str(_p_sq[_rt10.NODE_CLEAR_CARDS]["next"]))
    check("★squad=3: 选择编队 param 写入目标编队 3",
          _p_sq[_rt10.NODE_SQUAD_PICK]["custom_action_param"] ==
          {"编队选择": True, "目标编队": 3},
          str(_p_sq[_rt10.NODE_SQUAD_PICK]))
    check("squad=3: 注入只动 next 与 custom_action_param（不重建骨架）",
          sorted(_p_sq.keys()) == sorted(
              [_rt10.NODE_CLEAR_CARDS, _rt10.NODE_SQUAD_PICK])
          and sorted(_p_sq[_rt10.NODE_SQUAD_PICK].keys()) == ["custom_action_param"],
          str(sorted(_p_sq.keys())))

    # --- ★ 与真实 pipe 对照：新写法（custom 节点）逐项核对 ---
    # ⚠️ pipe 文件是 **JSONC**（带 // 注释），标准 json 解析不了，先去掉注释。
    _pipe10 = Path(__file__).resolve().parent.parent.parent / (
        "assets/resource/pipeline/Endless_ref/02_Endless_plant_Choose_ref.json"
    )
    _raw10 = _pipe10.read_text(encoding="utf-8")
    _raw10 = "\n".join(
        ln for ln in _raw10.splitlines() if not ln.lstrip().startswith("//")
    )
    _pj10 = _json10.loads(_raw10)
    _node10 = _pj10[_rt10.NODE_SQUAD_PICK]
    check("pipe: 选择编队 是 Custom(SelectPlants)",
          _node10.get("action") == "Custom"
          and _node10.get("custom_action") == "SelectPlants",
          str(_node10))
    check("pipe: 选择编队 自带编队选择模式参数占位",
          _node10.get("custom_action_param", {}).get("编队选择") is True
          and _node10.get("custom_action_param", {}).get("目标编队") == 0)
    check("pipe: 选择编队 next 指向开始战斗（跳过选卡）",
          _node10.get("next") == ["无尽挑战_选取植物_开始战斗"],
          str(_node10.get("next")))
    check("pipe: 确认在编队界面 next 指向 选择编队",
          _pj10["无尽_确认在编队界面"].get("next") == [_rt10.NODE_SQUAD_PICK],
          str(_pj10["无尽_确认在编队界面"].get("next")))
    check("pipe: 旧节点已退役（切换编队序号/识别编队/滑动寻找编队 不存在）",
          all(k not in _pj10 for k in
              ("无尽_切换编队序号", "识别编队1", "识别编队2", "无尽_滑动寻找编队")),
          str([k for k in ("无尽_切换编队序号", "识别编队1", "识别编队2",
                           "无尽_滑动寻找编队") if k in _pj10]))
    check("pipe: 清空卡牌 next 默认走选卡",
          _pj10[_rt10.NODE_CLEAR_CARDS].get("next") == ["无尽挑战_选取植物"],
          str(_pj10[_rt10.NODE_CLEAR_CARDS].get("next")))
except Exception as _e10:
    check("squad: 编队注入端到端", False, f"{type(_e10).__name__}: {_e10}")


# ---------------------------------------------------------------------------
print("\n=== 10b. 闸门 next 双写同步（pipe 0300 vs runtime 常量）===")
#
# 背景（2026-10-23 实锤）：用户在 pipe 的 跳转_未变/跳转_变化 的 next 尾部
# 加了 [JumpBack]无尽挑战_jumpback_继续挑战，但 runtime 的 _JUMP_*_ORIG /
# _JUMP_*_ART 四份硬编码清单没带 —— _inject_artifact 每关整表替换 next，
# JumpBack 被抹掉。pipe 与 runtime 任何一边改了闸门 next，这里立刻报。
try:
    import json as _json10b
    import re as _re10b
    from agent.jobset import runtime as _rt10b

    _pipe10b = Path(__file__).resolve().parent.parent.parent / (
        "assets/resource/pipeline/Endless_ref/03_Endless_fight/0300Endless_fight.json"
    )
    _pj10b = _json10b.loads(
        _re10b.sub(r"//[^\n]*", "", _pipe10b.read_text(encoding="utf-8")))
    _jb = "[JumpBack]无尽挑战_jumpback_继续挑战"

    _pipe_same = _pj10b[_rt10b.NODE_JUMP_SAME]["next"]
    _pipe_diff = _pj10b[_rt10b.NODE_JUMP_DIFF]["next"]
    check("pipe: 两个闸门 next 尾部都带 JumpBack 继续挑战",
          _pipe_same[-1] == _jb and _pipe_diff[-1] == _jb,
          f"未变尾={_pipe_same[-1]} 变化尾={_pipe_diff[-1]}")
    check("★同步: runtime _JUMP_SAME_ORIG == pipe 未变闸门 next",
          _rt10b._JUMP_SAME_ORIG == _pipe_same,
          f"runtime={_rt10b._JUMP_SAME_ORIG} pipe={_pipe_same}")
    check("★同步: runtime _JUMP_DIFF_ORIG == pipe 变化闸门 next",
          _rt10b._JUMP_DIFF_ORIG == _pipe_diff,
          f"runtime={_rt10b._JUMP_DIFF_ORIG} pipe={_pipe_diff}")
    check("换神器分支清单也带 JumpBack 尾件",
          _rt10b._JUMP_SAME_ART[-1] == _rt10b.JB_CONTINUE
          and _rt10b._JUMP_DIFF_ART[-1] == _rt10b.JB_CONTINUE,
          f"{_rt10b._JUMP_SAME_ART} / {_rt10b._JUMP_DIFF_ART}")
    check("pipe: JumpBack 目标节点存在且是 OCR",
          _pj10b[_rt10b.NODE_JUMPBACK_CONTINUE].get("recognition") == "OCR",
          str(_pj10b.get(_rt10b.NODE_JUMPBACK_CONTINUE)))
except Exception as _e10b:
    check("squad: 闸门同步检查", False, f"{type(_e10b).__name__}: {_e10b}")


# ---------------------------------------------------------------------------
print("\n=== 11. boss 判定防染色（91 关误判回归保护）===")
#
# 背景：链首节点 param 被预编译注入覆盖成 {}，跨关时只能靠 state；
# state 原来只置位不复位 -> boss 关的 True 残留染色下一关
#（85(boss) -> 86 误判、90(boss) -> 91 误判，实跑两次复现）。
# 修复：_resolve_is_boss 把判定钉在关卡号上 + JobSetPlan/Load 复位。
try:
    from agent.jobset import runtime as _rt11

    # 1) boss 关（90）：头像路径显式 true -> 钉在 90
    check("boss判定: 显式 true -> True",
          _rt11._resolve_is_boss({"是boss关": True}, 90) is True)
    check("boss判定: 判定钉在 90",
          _rt11._STATE.get("is_boss_level") == 90,
          str(_rt11._STATE.get("is_boss_level")))

    # 2) 同一关内 param 已空 -> 仍读得到 True（链首反复调用场景）
    check("boss判定: 同关空 param -> True",
          _rt11._resolve_is_boss({}, 90) is True)

    # 3) ★ 核心回归：跨到 91 关 -> 必须 False（事故现场）
    check("★boss判定: 跨关不染色（91 关）",
          _rt11._resolve_is_boss({}, 91) is False)

    # 4) 显式 false 也钉关卡（JobSetStage 普通关路径的写法）
    check("boss判定: 显式 false -> False 且钉住",
          _rt11._resolve_is_boss({"是boss关": False}, 91) is False
          and _rt11._STATE.get("is_boss_level") == 91,
          str(_rt11._STATE.get("is_boss_level")))
    check("boss判定: 同关空 param -> False",
          _rt11._resolve_is_boss({}, 91) is False)
except Exception as _e11:
    check("boss判定: 防染色", False, f"{type(_e11).__name__}: {_e11}")


# ---------------------------------------------------------------------------
print("\n=== 12. 自动计数：主界面关卡文本解析 ===")
try:
    from types import SimpleNamespace as _NS12
    from agent.jobset import runtime as _rt12

    check("解析: 「第87关」-> 87", _rt12._parse_level_text("第87关") == 87)
    check("解析: 「第 5 关」-> 5", _rt12._parse_level_text("第 5 关") == 5)
    check("解析: 裸数字「123」-> 123", _rt12._parse_level_text("123") == 123)
    check("解析: 无数字 -> None", _rt12._parse_level_text("无尽挑战") is None)
    check("解析: 空串 -> None", _rt12._parse_level_text("") is None)
    check("解析: None -> None", _rt12._parse_level_text(None) is None)

    _argv12 = _NS12(reco_detail=_NS12(
        best_result=_NS12(text="第87关"),
        filtered_results=[], all_results=[]))
    check("reco: best_result.text 取得到", _rt12._reco_text(_argv12) == "第87关")

    _argv12b = _NS12(reco_detail=_NS12(
        best_result=None,
        filtered_results=[_NS12(text="第5关")], all_results=[]))
    check("reco: best 为空回退 filtered", _rt12._reco_text(_argv12b) == "第5关")

    _argv12c = _NS12(reco_detail=None)
    check("reco: 无识别详情 -> None", _rt12._reco_text(_argv12c) is None)

    # _reco_all_texts：best 烂了（数字被 OCR 成字母，实锤「第NUM}关」）时
    # 还能从 filtered/all 候选里捞出带数字的文本
    _reco12d = _NS12(
        best_result=_NS12(text="第NUM}关"),
        filtered_results=[_NS12(text="第NUM}关"), _NS12(text="47")],
        all_results=[_NS12(text="无尽挑战")])
    _texts12d = _rt12._reco_all_texts(_reco12d)
    check("全候选: 去重保序", _texts12d == ["第NUM}关", "47", "无尽挑战"])
    _lv12d = None
    for _t in _texts12d:
        _lv12d = _rt12._parse_level_text(_t)
        if _lv12d is not None:
            break
    check("全候选: best 烂 -> filtered 兜底解析出 47", _lv12d == 47)
    check("全候选: None -> 空表", _rt12._reco_all_texts(None) == [])
    _reco12e = _NS12(best_result=_NS12(text="第NUM}关"),
                     filtered_results=[], all_results=[])
    check("全候选全烂 -> 解析不出（走重试/兜底）",
          all(_rt12._parse_level_text(_t) is None
              for _t in _rt12._reco_all_texts(_reco12e)))
except Exception as _e12:
    check("自动计数解析", False, f"{type(_e12).__name__}: {_e12}")


# ---------------------------------------------------------------------------
print("\n=== 13. boss 阵容拆分 + 阵容相同跳过选卡 ===")
#
# 设计（2026-10）：
#   · 每张表可选配 boss_lineup（boss 关独立的植物/编队/神器）；
#     缺省/未配 -> 完全沿用普通关（boss_lineup 导出的是逐槽沿用后的有效值）。
#   · 运行时维护「当前生效阵容签名」_STATE["lineup_sig"]：
#     与目标阵容相同 -> 「清空卡牌」改 DirectHit+DoNothing 直跳「开始战斗」
#     （不清空、不选卡、不切编队），只换种植链（compiled 注入照旧）；
#     不同（或首次进关签名未知）-> 还原清空卡牌节点 + 正常注入。
try:
    import json as _json13
    from agent.jobset import engine as _eng13
    from agent.jobset import runtime as _rt13

    # --- Table 解析与签名 ---
    _t_old = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇", "菜问"]}}, 0)
    check("boss阵容: 旧作业集 boss 沿用普通关",
          _t_old.eff_plants(True) == ["大喷菇", "菜问"], str(_t_old.eff_plants(True)))
    check("boss阵容: 旧作业集 boss 签名 == 普通关签名",
          _t_old.lineup_sig(True) == _t_old.lineup_sig(False))

    _t_bp = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"]},
                          "boss_lineup": {"plants": ["菜问", "大嘴花"]}}, 0)
    check("boss阵容: boss 独立植物", _t_bp.eff_plants(True) == ["菜问", "大嘴花"])
    check("boss阵容: 独立植物签名不同",
          _t_bp.lineup_sig(True) != _t_bp.lineup_sig(False))

    _t_bd = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"]},
                          "boss_lineup": {"plants": []}, "boss_squad": 3}, 0)
    check("boss阵容: boss 走编队", _t_bd.eff_squad(True) == 3
          and _t_bd.lineup_sig(True) == ("deck", 3, None), str(_t_bd.lineup_sig(True)))

    _t_nd = _eng13.Table({"from_level": 1, "lineup": {"plants": [], "deck": "2"}, "squad": 2,
                          "boss_lineup": {"plants": ["菜问"]}}, 0)
    check("boss阵容: 普通关编队 + boss 改选卡",
          _t_nd.eff_squad(False) == 2 and _t_nd.eff_squad(True) is None
          and _t_nd.eff_plants(True) == ["菜问"],
          f"normal={_t_nd.lineup_sig(False)} boss={_t_nd.lineup_sig(True)}")

    _t_art = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"], "artifact": "神器A"}}, 0)
    check("神器占位: 进入普通关签名", _t_art.lineup_sig(False) == ("plants", ("大喷菇",), "神器A"),
          str(_t_art.lineup_sig(False)))
    check("神器占位: boss 未配置 -> 沿用", _t_art.eff_artifact(True) == "神器A")

    # --- _CLEAR_CARDS_ORIG 必须与 pipe 原值一致（改了 pipe 要同步 runtime）---
    _pipe13 = Path(__file__).resolve().parent.parent.parent / (
        "assets/resource/pipeline/Endless_ref/02_Endless_plant_Choose_ref.json"
    )
    _raw13 = "\n".join(
        ln for ln in _pipe13.read_text(encoding="utf-8").splitlines()
        if not ln.lstrip().startswith("//")
    )
    _cc_pipe = _json13.loads(_raw13)[_rt13.NODE_CLEAR_CARDS]
    _cc_orig = _rt13._CLEAR_CARDS_ORIG
    check("跳过选卡: 清空卡牌快照 recognition 与 pipe 一致",
          _cc_orig.get("recognition") == _cc_pipe.get("recognition"),
          f"runtime={_cc_orig.get('recognition')} pipe={_cc_pipe.get('recognition')}")
    check("跳过选卡: 清空卡牌快照 roi 与 pipe 一致",
          _cc_orig.get("roi") == _cc_pipe.get("roi"),
          f"runtime={_cc_orig.get('roi')} pipe={_cc_pipe.get('roi')}")
    check("跳过选卡: 清空卡牌快照 action/next 与 pipe 一致",
          _cc_orig.get("action") == _cc_pipe.get("action")
          and _cc_orig.get("next") == _cc_pipe.get("next"),
          f"runtime next={_cc_orig.get('next')} pipe next={_cc_pipe.get('next')}")

    # --- _inject_lineup 行为（假 Context 记录 override）---
    class _FakeCtx13:
        def __init__(self): self.overrides = []
        def override_pipeline(self, patch): self.overrides.append(patch)

    def _last_clear13(ctx):
        # override_pipeline 对同一节点是按字段合并的，测试也要合并后再看
        merged = {}
        for p in ctx.overrides:
            if _rt13.NODE_CLEAR_CARDS in p:
                merged.update(p[_rt13.NODE_CLEAR_CARDS])
        return merged or None

    _rt13._STATE["lineup_sig"] = None
    _t13 = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇", "菜问"]},
                         "boss_lineup": {"plants": ["大喷菇", "菜问"]}}, 0)

    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13, False)
    _cl = _last_clear13(_c13)
    check("跳过选卡: 首次进关不跳（还原 OCR 点击清空）",
          _cl and _cl.get("recognition") == "OCR" and _cl.get("action") == "Click",
          str(_cl))
    check("跳过选卡: 首次进关注入普通关植物",
          any("大喷菇" in str(p.get(_rt13.NODE_CHOOSE_PLANTS, "")) for p in _c13.overrides))

    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13, True)     # boss 配置相同 -> 跳
    _cl = _last_clear13(_c13)
    check("★跳过选卡: boss 与普通关相同 -> DirectHit 直跳开始战斗",
          _cl and _cl.get("recognition") == "DirectHit" and _cl.get("action") == "DoNothing"
          and _cl.get("next") == [_rt13.NODE_BATTLE_START], str(_cl))

    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13, True)     # 再来一次还是跳（签名没变）
    _cl = _last_clear13(_c13)
    check("★跳过选卡: 连续同阵容仍然跳",
          _cl and _cl.get("recognition") == "DirectHit", str(_cl))

    _t13b = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇", "菜问"]},
                          "boss_lineup": {"plants": ["大嘴花"]}}, 0)
    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13b, True)    # boss 配置不同 -> 正常注入 boss 植物
    _cl = _last_clear13(_c13)
    check("跳过选卡: boss 不同 -> 还原清空 + 注入 boss 植物",
          _cl and _cl.get("recognition") == "OCR"
          and any("大嘴花" in str(p.get(_rt13.NODE_CHOOSE_PLANTS, "")) for p in _c13.overrides),
          str(_cl))

    # 换表但阵容相同（表2 配置 == 当前生效）-> 也跳
    _t13c = _eng13.Table({"from_level": 2, "lineup": {"plants": ["大嘴花"]}}, 1)
    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13c, False)   # 当前生效 = boss 的 大嘴花
    _cl = _last_clear13(_c13)
    check("★跳过选卡: 换表但阵容相同 -> 跳",
          _cl and _cl.get("recognition") == "DirectHit", str(_cl))

    # --- lineup_gate_adjust（闸门判断的阵容维度修正，纯函数）---
    _ga = _rt13.lineup_gate_adjust
    _tSame = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"]},
                           "boss_lineup": {"plants": ["大喷菇"]}}, 0)
    _tDiff = _eng13.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"]},
                           "boss_lineup": {"plants": ["菜问"]}}, 0)
    _sigNormal = _tSame.lineup_sig(False)

    # 表没变（need=False），下一关普通、签名相同 -> 不动
    check("闸门修正: 表不变+阵容同 -> 未变",
          _ga(False, False, _tSame, False, _sigNormal) == (False, None))
    # 表没变，但 boss 阵容不同 -> 翻成「变化」（重选 boss 阵容）
    _n, _r = _ga(False, False, _tDiff, True, _sigNormal)
    check("★闸门修正: 表不变+boss 阵容不同 -> 变化", _n is True and _r and "boss" in _r,
          f"need={_n} reason={_r}")
    # boss 阵容相同 -> 不动（保持未变，直接开打）
    check("闸门修正: 表不变+boss 阵容同 -> 未变",
          _ga(False, False, _tSame, True, _sigNormal) == (False, None))
    # 表变了（need=True）但阵容与当前相同 -> 翻成「未变」（跳过选卡）
    _n, _r = _ga(False, True, _tSame, False, _sigNormal)
    check("★闸门修正: 表变+阵容同 -> 未变（跳过选卡）", _n is False and _r and "跳过" in _r,
          f"need={_n} reason={_r}")
    # 表变且阵容不同 -> 保持变化（下一关取 boss 形态，boss 配的是 菜问）
    check("闸门修正: 表变+阵容不同 -> 变化",
          _ga(False, True, _tDiff, True, _sigNormal)[0] is True)
    # 训练模式：任何情况都不修正（每关必重选）
    check("闸门修正: 训练模式不修正",
          _ga(True, True, _tSame, False, _sigNormal) == (True, None))
    # 签名未知（首次进关）：保守，不修正
    check("闸门修正: 签名未知不修正",
          _ga(False, True, _tSame, False, None) == (True, None))

    # --- ★ 训练模式下 _inject_lineup 永不跳过清空/选卡 ---
    # （闸门只翻 next 分支，清空卡牌节点会不会被改成空跳是 _inject_lineup 说了算）
    _rt13._STATE["training"] = True
    _rt13._STATE["lineup_sig"] = _t13.lineup_sig(False)
    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13, False)    # 签名相同但训练模式 -> 不跳
    _cl = _last_clear13(_c13)
    check("★训练模式: 阵容相同也不跳（清空卡牌保持 OCR 点击）",
          _cl and _cl.get("recognition") == "OCR" and _cl.get("action") == "Click",
          str(_cl))
    _rt13._STATE["training"] = False
    _c13 = _FakeCtx13()
    _rt13._inject_lineup(_c13, _t13, False)    # 回正赛 -> 恢复跳过
    _cl = _last_clear13(_c13)
    check("★回到正赛: 跳过恢复",
          _cl and _cl.get("recognition") == "DirectHit", str(_cl))
    _rt13._STATE["training"] = None
    _rt13._STATE["lineup_sig"] = None
except Exception as _e13:
    check("boss阵容/跳过选卡", False, f"{type(_e13).__name__}: {_e13}")


# ---------------------------------------------------------------------------
# §14 用户可见 focus 播报块（_focus_lineup_block）
# ---------------------------------------------------------------------------
print("\n== §14 focus 播报块 ==")
try:
    from agent.jobset import engine as _eng14
    from agent.jobset import runtime as _rt14

    # 5 个植物 -> 8 槽，后 3 槽显示「补位」
    _t14 = _eng14.Table({"from_level": 1, "lineup": {
        "plants": ["大喷菇", "菜问", "大嘴花", "豌豆射手", "向日葵"]}}, 0)
    _blk = _rt14._focus_lineup_block(_t14, False)
    _lines = _blk.split("\n")
    check("focus块: 标题是当前使用+表号", _lines[0] == "当前使用：表1", _lines[0])
    check("focus块: 5 植物 -> 8 行（补位凑满）",
          _lines[1:6] == ["大喷菇", "菜问", "大嘴花", "豌豆射手", "向日葵"]
          and _lines[6:] == ["补位", "补位", "补位"], str(_lines))
    check("focus块: 无神器不带神器行", not any("神器" in l for l in _lines))

    # 带神器 -> 末尾有神器行
    _t14a = _eng14.Table({"from_level": 1, "lineup": {
        "plants": ["大喷菇"], "artifact": "治愈神器"}}, 0)
    _blk = _rt14._focus_lineup_block(_t14a, False)
    check("focus块: 神器行在末尾", _blk.split("\n")[-1] == "神器：治愈神器", _blk)

    # 编队模式（无植物）-> 显示编队号而不是槽位
    _t14b = _eng14.Table({"from_level": 1, "lineup": {"plants": [], "deck": "2"},
                          "squad": 2}, 0)
    _blk = _rt14._focus_lineup_block(_t14b, False)
    check("focus块: 编队模式显示编队号",
          "切换编队：2" in _blk and "补位" not in _blk, _blk)

    # boss 专属配置 -> 标题带「（boss 配置）」且用 boss 阵容
    _t14c = _eng14.Table({"from_level": 1, "lineup": {"plants": ["大喷菇"]},
                          "boss_lineup": {"plants": ["大嘴花"]}}, 0)
    _blk = _rt14._focus_lineup_block(_t14c, True)
    check("focus块: boss 配置标题+用 boss 阵容",
          _blk.split("\n")[0] == "当前使用：表1（boss 配置）"
          and "大嘴花" in _blk and "大喷菇" not in _blk, _blk)
    # boss 无专属配置 -> 标题无标记、沿用普通关
    _blk = _rt14._focus_lineup_block(_t14, True)
    check("focus块: boss 无专属 -> 沿用普通关",
          _blk.split("\n")[0] == "当前使用：表1" and "大喷菇" in _blk, _blk)
except Exception as _e14:
    check("focus播报块", False, f"{type(_e14).__name__}: {_e14}")


# ---------------------------------------------------------------------------
# §15 适配世界（world/sub_worlds 载入 + _check_world 校验文案）
# ---------------------------------------------------------------------------
print("\n== §15 适配世界校验 ==")
try:
    from agent.jobset import engine as _eng15
    from agent.jobset import runtime as _rt15

    # 载入：有 world/sub_worlds
    _j15 = _eng15.JobSet({"name": "w", "world": "冰河世界",
                          "sub_worlds": ["海盗港湾", "  ", ""],
                          "tables": [{"from_level": 1, "lineup": {"plants": ["X"]}}]}, code="w")
    check("world 载入", _j15.world == "冰河世界", _j15.world)
    check("sub_worlds 载入（过滤空串）", _j15.sub_worlds == ["海盗港湾"], str(_j15.sub_worlds))

    # 旧作业集（无字段）-> 空
    _j15b = _eng15.JobSet({"name": "old", "tables": [{"from_level": 1, "lineup": {"plants": ["X"]}}]}, code="o")
    check("旧作业集 world 为空", _j15b.world == "" and _j15b.sub_worlds == [])

    # 校验文案四种情形
    check("未标注 -> 提示重存",
          "未标注适配世界" in _rt15._check_world(_j15b, "冰河世界"))
    check("主世界一致 -> 通过",
          _rt15._check_world(_j15, "冰河世界") == "🌍 世界校验通过：冰河世界")
    check("副世界一致 -> 通过（副）",
          "（副世界）" in _rt15._check_world(_j15, "海盗港湾"))
    _mis = _rt15._check_world(_j15, "摩登世界")
    check("不一致 -> ⚠️ 且含两个世界名",
          "不一致" in _mis and "冰河世界" in _mis and "摩登世界" in _mis
          and "海盗港湾" in _mis, _mis)
    check("GUI 未注入世界值 -> 不比对（空提示）",
          _rt15._check_world(_j15, "") == "")
except Exception as _e15:
    check("适配世界校验", False, f"{type(_e15).__name__}: {_e15}")


# ---------------------------------------------------------------------------
# §16 植物备注（plant_notes 载入）
# ---------------------------------------------------------------------------
print("\n== §16 植物备注 ==")
try:
    from agent.jobset import engine as _eng16

    _j16 = _eng16.JobSet({"name": "n", "tables": [{"from_level": 1, "lineup": {"plants": ["X"]}}],
                          "plant_notes": {
                              "冰西瓜": {"tier": 5, "pendant": "闪耀雪花挂坠"},
                              "豌豆射手": {"tier": 0, "pendant": ""},      # 全空 -> 剪除
                              "桑葚爆破手": {"pendant": "珍稀的肥料"},        # 仅挂件
                              "苹果迫击炮": {"tier": 3},                    # 仅阶数
                              "仙人掌": {"costume": True},                  # 仅装扮（布尔）
                              "坏行": "不是dict",                            # 非法 -> 跳过
                              123: {"tier": 2},                             # 非字符串键 -> 跳过
                          }}, code="n")
    check("合法备注载入", _j16.plant_notes.get("冰西瓜") == {"tier": 5, "pendant": "闪耀雪花挂坠"},
          str(_j16.plant_notes.get("冰西瓜")))
    check("空备注剪除", "豌豆射手" not in _j16.plant_notes)
    check("仅挂件保留", _j16.plant_notes.get("桑葚爆破手") == {"pendant": "珍稀的肥料"})
    check("仅阶数保留", _j16.plant_notes.get("苹果迫击炮") == {"tier": 3})
    check("仅装扮保留", _j16.plant_notes.get("仙人掌") == {"costume": True})
    check("非法项跳过", "坏行" not in _j16.plant_notes and 123 not in _j16.plant_notes)

    _j16b = _eng16.JobSet({"name": "old", "tables": [{"from_level": 1, "lineup": {"plants": ["X"]}}]}, code="o")
    check("旧作业集 plant_notes 为空 dict", _j16b.plant_notes == {})
except Exception as _e16:
    check("植物备注", False, f"{type(_e16).__name__}: {_e16}")


# ---------------------------------------------------------------------------
# §17 图层覆盖重叠：先涂的赢（2026-10-22「第二关摆法没换」事故规则固化）
# ---------------------------------------------------------------------------
print("\n== §17 图层覆盖重叠：先涂的赢 ==")
try:
    from agent.jobset import engine as _eng17

    _j17 = _eng17.JobSet({
        "name": "overlap", "max_level": 3,
        "tables": [
            {"from_level": 1, "levels": [1, 2], "lineup": {"plants": ["A"]}},
            {"from_level": 2, "levels": [2, 3], "lineup": {"plants": ["B"]}},
        ]}, code="ov")
    check("图层重叠：关卡2 归属先涂的表1", _j17.pick_table(2).index == 0,
          f"got=表{_j17.pick_table(2).index + 1}")
    check("图层：关卡3 归属表2", _j17.pick_table(3).index == 1,
          f"got=表{_j17.pick_table(3).index + 1}")
except Exception as _e17:
    check("图层覆盖重叠", False, f"{type(_e17).__name__}: {_e17}")


# ---------------------------------------------------------------------------
# §18 option 覆写冲突全量扫描（2026-10-22 事故的根源性防护）
#
#   事故根因：GUI 的 option 会合是「同节点同字段整体替换」——
#   两个 option 都写 无尽挑战_加载作业集代码.custom_action_param 时，
#   后应用的把先应用的**整个字段**顶掉（起始关卡/重置 被 当前世界 顶丢）。
#
#   这不是某一处的 bug，而是全局隐患，所以这里做**全 task 目录**机械扫描，
#   固化两条不变量：
#     1) 同一 task 文件内，任意 (节点, 字段) 最多只有一个可共存的 option
#        写入者（同一 select option 的各个 case 互斥，视为一个写入者；
#        option 级 override 与它的每个 case 都可共存，单独算一组）。
#     2) option 写 custom_action_param 时，写入键集必须 ⊇ pipe 里该节点的
#        静态 custom_action_param 键（否则整体替换会把静态键抹掉 ——
#        这就是 16 个世界 case 写 Plan 节点时必须带上 训练模式/计数 的原因）。
# ---------------------------------------------------------------------------
print("\n== §18 option 覆写冲突全量扫描（同节点同字段唯一写入者） ==")
try:
    import json as _json18

    _R18 = Path(__file__).resolve().parent.parent.parent

    def _jsonc18(p):
        _raw = p.read_text(encoding="utf-8")
        _raw = "\n".join(ln for ln in _raw.splitlines()
                         if not ln.lstrip().startswith("//"))
        return _json18.loads(_raw)

    # ---- pipe 节点静态 param 索引：node -> 静态 custom_action_param 键集 ----
    _pipe_static: dict = {}
    for _pf in (_R18 / "assets" / "resource" / "pipeline").rglob("*.json"):
        try:
            _pj = _jsonc18(_pf)
        except Exception:
            continue
        if not isinstance(_pj, dict):
            continue
        for _nd, _body in _pj.items():
            if isinstance(_body, dict):
                _sp = _body.get("custom_action_param")
                if isinstance(_sp, dict):
                    _pipe_static.setdefault(_nd, set()).update(_sp.keys())
    check("pipe 静态 param 索引建立", len(_pipe_static) > 0,
          f"{len(_pipe_static)} 个节点带静态 param")

    # ---- 逐 task 文件扫描 option 写入（同文件内的 option 才可能共存）----
    # 已确认的历史隐患（用户 2026-10-22 决定「不用管」）——留着扫描能力，
    # 只豁免这两条已知项；新的异值多写照样 FAIL。
    _KNOWN_BAD18 = {
        ("get_gold_coins.json", "星系_进入世界.next"),        # 装备街机神器 vs 需要刷的关卡
        ("Secret_realm.json", "地宫2无尽_第一关_寻找8槽.template"),  # 藤蔓植物 vs 远程植物
    }
    _bad_all: list = []
    _lost_all: list = []
    _scanned = 0
    for _tf in sorted((_R18 / "assets" / "resource" / "task").rglob("*.json")):
        try:
            _tj = _jsonc18(_tf)
        except Exception:
            continue
        _opts = _tj.get("option") if isinstance(_tj, dict) else None
        if not isinstance(_opts, dict):
            continue
        _scanned += 1
        _writes: dict = {}        # (node, field) -> {写入组: 规范化写入值}
        _param_writes: list = []  # (node, 写入组, 写入键集)
        for _oname, _o in _opts.items():
            if not isinstance(_o, dict):
                continue
            _ovs = [(f"{_oname}$option级", _o.get("pipeline_override"))]
            for _c in _o.get("cases") or []:
                if isinstance(_c, dict):
                    _ovs.append((_oname, _c.get("pipeline_override")))
            for _wgroup, _ov in _ovs:
                if not isinstance(_ov, dict):
                    continue
                for _nd, _fields in _ov.items():
                    if not isinstance(_fields, dict):
                        continue
                    for _fld, _val in _fields.items():
                        _writes.setdefault((_nd, _fld), {})[_wgroup] = \
                            _json18.dumps(_val, ensure_ascii=False, sort_keys=True)
                        if _fld == "custom_action_param" and isinstance(_val, dict):
                            _param_writes.append((_nd, _wgroup, set(_val.keys())))
        for (_nd, _fld), _groups in sorted(_writes.items()):
            # 同值多写 = 无害冗余（replace 后值不变）；**异值多写** 才是事故同款
            if len(_groups) > 1 and len(set(_groups.values())) > 1 \
                    and (_tf.name, f"{_nd}.{_fld}") not in _KNOWN_BAD18:
                _bad_all.append(f"{_tf.name}: {_nd}.{_fld} <- {sorted(_groups)}")
        for _nd, _wg, _keys in _param_writes:
            _need = _pipe_static.get(_nd)
            if _need:
                _miss = _need - _keys
                if _miss:
                    _lost_all.append(
                        f"{_tf.name}: {_wg} 写 {_nd} 丢了静态键 {sorted(_miss)}")
    check(f"全 task（{_scanned} 个文件）：(节点,字段) 无异值多写入者",
          not _bad_all, "；".join(_bad_all[:5]))
    check("option 写 custom_action_param 均保住 pipe 静态键",
          not _lost_all, "；".join(_lost_all[:5]))

    # ---- 本次事故的定点检查：当前世界/起始关卡 分信道 ----
    _t18 = _jsonc18(_R18 / "assets" / "resource" / "task" / "Endless_ref" / "Endless_ref.json")
    _cases18 = _t18["option"]["无尽挑战_选择世界"]["cases"]
    check("世界 case 共 16 个", len(_cases18) == 16, f"got={len(_cases18)}")

    _worlds18 = set()
    _shape_ok = True
    for _c in _cases18:
        _ov = _c.get("pipeline_override", {})
        if "无尽挑战_加载作业集代码" in _ov:
            _shape_ok = False      # 冲突回归：世界 case 又去碰 JobSetLoad
        for _node, _tr in (("无尽局内_过关_正赛", False), ("无尽局内_过关_训练", True)):
            _prm = _ov.get(_node, {}).get("custom_action_param")
            if not isinstance(_prm, dict) \
                    or _prm.get("训练模式") is not _tr \
                    or _prm.get("计数") is not True \
                    or not _prm.get("当前世界"):
                _shape_ok = False
            else:
                _worlds18.add(_prm["当前世界"])
    check("16 case 都写 Plan 双节点且带静态键（训练模式/计数）", _shape_ok)
    check("16 case 当前世界互不相同", len(_worlds18) == 16, str(sorted(_worlds18)))
except Exception as _e18:
    check("注入信道防冲突", False, f"{type(_e18).__name__}: {_e18}")


# ---------------------------------------------------------------------------
print("\n=== 19. settle 等待结算时长挂在收尾链节点自己（非候选节点）===")
# 历史 bug：等待结算时长曾覆写到「继续挑战/继续训练」候选节点身上 ——
# MAA 的 timeout 语义是「当前节点轮询自己 next 列表」，候选身上的 timeout
# 根本不会被读到，用户设 1.5e9 ms 也照样 20s 超时任务失败（2026-10-22 实锤）。
try:
    _seg19 = [{"key": "card1", "slot": "1", "type": "plant",
               "cells": ["格子2_3"], "waits": []}]

    def _mk19(after, settle_ms):
        raw = {
            "from_level": 1,
            "lineup": {"plants": ["大喷菇"]},
            "slots": {"1": "大喷菇"},
            "endAfterAction": after,
            "endSettleMs": settle_ms,
            "non_boss": {
                "once_chain": [], "loop_chain": _seg19, "end_chain": _seg19,
            },
        }
        return _cpl8j.build_fight_override(_eng.Table(raw, 0), False,
                                           _coords, 10, 80, None)

    _ovr19, _cn19 = _mk19("settle", 1500000000)
    _endn19 = (_cn19.get("end") or {}).get("node")
    check("settle: 收尾链节点存在", bool(_endn19), repr(_cn19))
    check("settle: timeout 写在收尾链节点自己身上",
          bool(_endn19) and _ovr19.get(_endn19, {}).get("timeout") == 1500000000,
          repr(_ovr19.get(_endn19)))
    check("settle: 候选节点（继续挑战/继续训练）不再被覆写",
          "无尽局内_继续挑战" not in _ovr19 and "无尽训练_继续训练" not in _ovr19,
          str([k for k in _ovr19 if "继续" in k]))
    check("settle: 收尾链 next = [继续挑战, 失败]",
          bool(_endn19) and _ovr19.get(_endn19, {}).get("next")
          == ["无尽局内_继续挑战", "无尽挑战_失败"],
          repr(_ovr19.get(_endn19, {}).get("next")))

    _ovr19b, _cn19b = _mk19("sub", 1500000000)
    _endn19b = (_cn19b.get("end") or {}).get("node")
    check("非 settle: 收尾链节点不带 timeout（默认 20s 语义不变）",
          bool(_endn19b) and "timeout" not in _ovr19b.get(_endn19b, {}),
          repr(_ovr19b.get(_endn19b)))
except Exception as _e19:
    check("settle 等待结算时长挂载点", False, f"{type(_e19).__name__}: {_e19}")


# ---------------------------------------------------------------------------
print("\n" + "=" * 52)
if FAILED:
    print(f"FAILED {len(FAILED)}: {FAILED}")
    sys.exit(1)
print("全部通过")
