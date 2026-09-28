# -*- coding: utf-8 -*-
"""确认 bug：boss 链里混进了普通关的通用动作。"""
import json

d = json.load(open("assets/resource/jobs/pvz_20260926_235614.json", encoding="utf-8"))
t = d["tables"][0]

print("=" * 68)
print("普通关 vs boss 链对比")
print("=" * 68)

nb = t.get("non_boss") or {}
b = t.get("boss") or {}

for name, src in (("普通关", nb), ("boss关", b)):
    print(f"\n[{name}]")
    for c in ("once_chain", "loop_chain", "end_chain"):
        lst = src.get(c) or []
        keys = [s.get("key") for s in lst]
        ga = [k for k in keys if str(k).startswith("ga:")]
        print(f"   {c:11s} {len(lst):2d} 段   通用动作: {ga if ga else '无'}")

print()
print("=" * 68)
print("顶部槽位顺序字段")
print("=" * 68)
for k in ("loopOrder", "bossLoopOrder"):
    v = t.get(k) or []
    keys = [s.get("key") for s in v]
    ga = [x for x in keys if str(x).startswith("ga:")]
    print(f"   {k:15s} {len(v):2d} 段   通用动作: {ga if ga else '无'}")

print()
print("=" * 68)
print("结论")
print("=" * 68)
bl = b.get("loop_chain") or []
bl_ga = [s.get("key") for s in bl if str(s.get("key", "")).startswith("ga:")]
if bl_ga:
    print(f"   ❌ boss.loop_chain 里有 {len(bl_ga)} 个通用动作: {bl_ga}")
    print("      -> 导出 boss 链时读错了字段（读了普通关的 loopOrder）")
else:
    print("   ✅ boss 链干净")
