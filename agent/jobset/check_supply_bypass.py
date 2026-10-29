# -*- coding: utf-8 -*-
"""图级回归：真实 pipe 图 + 真实运行时 override 序列 -> 枚举
「闸门 -> 开始战斗」的全部路径，检查是否每条都经过 清空卡牌+选取植物。

背景（2026-10-24 水皮实锤）：boss 关前必弹补给屏，补给终点
「神器补给_确定」pipe 原值 next=[开始战斗]；「神器没变但阵容变」时
若无条件还原原值，选卡整段被旁路 —— boss 槽位覆盖永远不进卡组。
（2026-10-28「骨架固定、只翻动作」重构后，补给确定永远是
 [清空卡牌, 自己]，旁路在图上不存在了；本脚本继续当守门员。）

四个场景：
  A. boss 关 + 补给屏在 + 阵容变 + 神器没变   <- 水皮场景
  B. boss 关 + 补给屏在 + 阵容变 + 神器也变（神器由选卡终点接）
  C. 普通关 + 补给屏不在 + 阵容变（换表）
  D. boss 关 + 补给屏在 + 阵容没变 + 神器没变（合法跳过，特性）

依赖：无（自包含夹具，内置 boss 槽位覆盖；编译用真实 compile_jobset）。
用法：.\\.venv\\Scripts\\python.exe -X utf8 agent\\jobset\\check_supply_bypass.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agent.jobset import runtime as rt  # noqa: E402
from agent.jobset.check_graph import strip_comments  # noqa: E402

# ---------- 1) 载入真实 pipe（JSONC：剥 // 与 /* */ 注释，含行尾注释）----------
PIPE_DIR = ROOT / "assets" / "resource" / "pipeline" / "Endless_ref"
nodes = {}
for f in list(PIPE_DIR.glob("*.json")) + list(PIPE_DIR.glob("*/*.json")):
    raw = strip_comments(f.read_text(encoding="utf-8"))
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"!! 解析失败 {f.name}: {e}")
        continue
    nodes.update(data)
print(f"pipe 节点数: {len(nodes)}")

BATTLE = "无尽挑战_选取植物_开始战斗"
CLEAR = "无尽挑战_识别开始战斗_清空卡牌"
PICK = "无尽挑战_选取植物"
SUPPLY = "无尽局内_补给"
GATE_C = "无尽挑战_跳转_变化"
GATE_U = "无尽挑战_跳转_未变"


class Ctx:
    def __init__(self): self.overrides = []
    def override_pipeline(self, patch): self.overrides.append(patch)
    def run_task(self, node): return True


class Argv:
    def __init__(self, p): self.custom_action_param = json.dumps(p, ensure_ascii=False)


def build_graph(overrides_seq):
    """pipe 静态图 + 依序应用 override（字段级合并）。"""
    g = {k: json.loads(json.dumps(v)) for k, v in nodes.items()}
    for patch in overrides_seq:
        for name, fields in patch.items():
            if name == "__run_task__":
                continue
            g.setdefault(name, {})
            g[name].update(fields)
    return g


def paths_to_battle(g, entry, supply_screen, max_paths=64):
    """DFS 枚举 entry -> BATTLE 的全部路径（禁环）。
    supply_screen=False 时，补给节点识别不中（屏不在），该候选剪掉。
    返回 (good_paths, bad_paths)。"""
    good, bad = [], []

    def hit(name, screen):
        nd = g.get(name)
        if nd is None or nd.get("enabled") is False:
            return False
        if name == SUPPLY and not screen:
            return False
        return True

    def dfs(name, path):
        if len(good) + len(bad) >= max_paths:
            return
        if name == BATTLE:
            ok = (CLEAR in path) and (PICK in path)
            (good if ok else bad).append(path + [name])
            return
        if name in path:  # 环（含 self-retry）：截断
            return
        nd = g.get(name)
        if nd is None:
            return  # 悬空节点（资源外），视为终止
        nxt = nd.get("next") or []
        if isinstance(nxt, str):
            nxt = [nxt]
        for n2 in nxt:
            if isinstance(n2, str) and n2.startswith("[JumpBack]"):
                n2 = n2[len("[JumpBack]"):]
            if not isinstance(n2, str):
                continue
            if not hit(n2, supply_screen):
                continue
            dfs(n2, path + [name])

    # 入口本身先过一遍 hit（闸门被 disable 时 = 无路径）
    if hit(entry, supply_screen):
        for n2 in (g.get(entry, {}).get("next") or []):
            if isinstance(n2, str) and n2.startswith("[JumpBack]"):
                n2 = n2[len("[JumpBack]"):]
            if isinstance(n2, str) and hit(n2, supply_screen):
                dfs(n2, [entry])
    return good, bad


def _load_test_job():
    """自包含夹具：构造一张带 boss 槽位覆盖的作业集，用真实编译器
    （agent.jobset.compile.compile_jobset，与编辑器 /save_job 同源）编成 v3。
    不依赖编辑器在线、不依赖用户当前作业集长什么样。"""
    from agent.jobset.compile import compile_jobset
    raw = {
        "code": "_sim_current", "name": "_sim_supply_bypass", "version": "1.0",
        "world": "失落之城",
        "sub_worlds": ["神秘埃及"],
        "tables": [{
            "levels": list(range(1, 53)),
            "slots": {"1": "向日葵", "2": "豌豆射手"},
            "artifact": None, "bossArtifact": None,
            "bossSlots": {"2": "菜问"},          # boss 槽2 覆盖 -> 阵容差异
            "bossLineupMode": "plants",
            "lineup": {"plants": ["向日葵", "豌豆射手"], "artifact": None},
            "boss_lineup": {"plants": ["向日葵", "菜问"], "artifact": None},
            "supplyPicks": [{"id": "all", "img": "全部植物.png", "name": "全部植物"}],
            "boardEarly": [], "boardLate": [],
            "onceSegs": [], "loopSegs": [], "endSegs": [],
            "bossOnceSegs": [], "bossLoopSegs": [], "bossEndSegs": [],
        }, {
            # 铺满校验要求 1-149 全覆盖 —— 第二张表只负责补位
            "levels": list(range(53, 150)),
            "slots": {"1": "向日葵"},
            "lineup": {"plants": ["向日葵"], "artifact": None},
            "boss_lineup": {"plants": ["向日葵"], "artifact": None},
            "supplyPicks": [],
            "boardEarly": [], "boardLate": [],
            "onceSegs": [], "loopSegs": [], "endSegs": [],
            "bossOnceSegs": [], "bossLoopSegs": [], "bossEndSegs": [],
        }],
    }
    job = compile_jobset(raw, log=lambda m: None)
    print("（用自包含夹具作业集：表1 boss 槽2=菜问 覆盖）")
    return job


def simulate_overrides(boss_lv, lineup_changed, artifact_changed):
    """驱动真实 runtime，收集一个 boss 关开局前的全部 override。
    boss_lv=None -> 自动挑「带 boss 差异阵容的表」覆盖的第一个 5 倍数关
    （找不到差异表就退而求其次：任何 5 倍数关，供场景 D 用）。"""
    job = _load_test_job()
    dst = ROOT / "assets" / "resource" / "jobs" / "_sim_current.json"
    dst.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
    try:
        if boss_lv is None:
            # 两遍法：先 Load 拿表清单，挑出合适的 boss 关再重新 Load
            rt._STATE.clear()
            rt.JobSetLoad().run(Ctx(), Argv({"作业集代码": "_sim_current",
                                              "起始关卡": 1, "重置": True}))
            js0 = rt._STATE["jobset"]
            pick = None
            for want_diff in (True, False):   # 优先有差异的表
                for t in js0.tables:
                    lvs = sorted(t.raw.get("levels") or [])
                    cand = next((l for l in lvs if l % 5 == 0 and l > 1), None)
                    if cand is None:
                        continue
                    diff = t.lineup_sig(True) != t.lineup_sig(False)
                    if diff == want_diff:
                        pick = cand
                        break
                if pick:
                    break
            if pick is None:
                raise SystemExit("当前作业集没有任何 5 倍数关 —— 没法跑 boss 场景")
            boss_lv = pick
        rt._STATE.clear()
        rt.JobSetLoad().run(Ctx(), Argv({"作业集代码": "_sim_current",
                                          "起始关卡": boss_lv - 1, "重置": True}))
        js = rt._STATE["jobset"]
        t2 = js.pick_table(boss_lv)  # 覆盖 boss_lv 的表
        print(f"  （模拟关卡 L{boss_lv}，表{t2.index + 1}，"
              f"boss差异={'有' if t2.lineup_sig(True) != t2.lineup_sig(False) else '无'}）")

        # 摆状态：前一关普通阵容已生效
        rt._STATE["lineup_sig"] = t2.lineup_sig(False)
        rt._STATE["artifact_sig"] = t2.eff_artifact(False)  # None（该表没配神器）
        rt._STATE["plan_table_index"] = t2.index
        rt._STATE["table_index"] = t2.index
        rt._STATE["locked_level"] = boss_lv - 1
        rt._STATE["is_boss"] = False
        rt._STATE["is_boss_level"] = None
        rt._STATE["training"] = False

        if lineup_changed and t2.lineup_sig(True) == t2.lineup_sig(False):
            raise SystemExit("当前作业集没有任何 boss 差异阵容 —— 场景 A/B 无从模拟，"
                             "先在编辑器里给某张表配个 boss 槽位覆盖再跑")

        if artifact_changed:
            # 临时给表2塞个 boss 神器（葫芦神器 + en），制造「神器也变」
            t2.boss_artifact = "葫芦神器"
            t2.boss_artifact_en = "artifact_calabash"
        if not lineup_changed:
            # 抹掉 boss 覆盖：boss 名单 == 普通名单
            t2.boss_plants = list(t2.plants)

        ctx = Ctx()
        rt.JobSetPlan().run(ctx, Argv({"训练模式": False, "计数": True}))
        return ctx.overrides
    finally:
        dst.unlink(missing_ok=True)


def report(tag, entry, supply_screen, overrides, expect_bypass=False):
    g = build_graph(overrides)
    good, bad = paths_to_battle(g, entry, supply_screen)
    print(f"\n### {tag}")
    print(f"  到「开始战斗」的路径: 经过选卡 {len(good)} 条 / 绕过选卡 {len(bad)} 条")
    for p in bad[:3]:
        print(("  ✗ 旁路: " if not expect_bypass else "  · 合法直跳: ") + " -> ".join(p))
    for p in good[:2]:
        print("  ✓ 正路: " + " -> ".join(p))
    if expect_bypass:
        # 阵容没变：合法直跳是特性；若反而全走选卡 = 跳过失效（浪费一关时间）
        return 0 if len(bad) > 0 else 1
    return len(bad)


total_bad = 0
# A: 水皮场景（boss + 补给屏 + 阵容变 + 神器没变）
total_bad += report("A boss关 阵容变+神器没变（水皮场景）", GATE_C, True,
                    simulate_overrides(None, lineup_changed=True, artifact_changed=False))
# B: boss + 阵容变 + 神器也变
total_bad += report("B boss关 阵容变+神器也变", GATE_C, True,
                    simulate_overrides(None, lineup_changed=True, artifact_changed=True))
# C: 普通关（无补给屏）+ 阵容变
total_bad += report("C 普通关 阵容变（无补给屏）", GATE_C, False,
                    simulate_overrides(None, lineup_changed=True, artifact_changed=False))
# D: boss + 阵容没变 + 神器没变（合法跳过 —— 走未变闸门）
total_bad += report("D boss关 阵容没变（合法直跳，特性）", GATE_U, True,
                    simulate_overrides(None, lineup_changed=False, artifact_changed=False),
                    expect_bypass=True)

print("\n" + ("❌ 图级确认：存在绕过选卡的路径（见上）" if total_bad
      else "✅ 全绿：阵容变的场景每条路径都过选卡；阵容不变的合法直跳保留"))
