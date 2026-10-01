# -*- coding: utf-8 -*-
"""把作业集里每张表的落子顺序链打印成人能核对的形式。

    python agent/jobset/report.py            # 用 current.json 的作业集
    python agent/jobset/report.py <code>     # 指定作业集

★ 打印的是**真编译产物**（compile.build_fight_override —— 与保存时预编译、
  运行时注入同一条代码路径），不再是旧的 rules_dsl 第二编译器。
"""

import sys
from pathlib import Path

if __package__ in (None, ""):
    # .../agent/jobset/report.py -> .../agent -> 仓库根
    _AGENT_DIR = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(_AGENT_DIR.parent))
    sys.path.insert(0, str(_AGENT_DIR))

from agent.jobset.engine import load_jobset  # noqa: E402
from agent.jobset import dsl  # noqa: E402
from agent.jobset import compile as _cpl  # noqa: E402


def main():
    code = sys.argv[1] if len(sys.argv) > 1 else None
    js = load_jobset(code)
    coords = dsl.load_coords()
    every_n = int(js.raw.get("everyN") or 10)

    print("=" * 70)
    print(f"作业集「{js.name}」 code={js.code}  表数={len(js.tables)}")
    print(f"坐标表键数={len(coords)}  everyN={every_n}")
    print("=" * 70)

    for t in js.tables:
        rng = f"{t.from_level} ~ {t.to_level if t.to_level is not None else '末'}"
        print(f"\n{'#' * 70}")
        print(f"# 表{t.index + 1}   关卡 {rng}")
        print(f"# 选卡植物: {t.plants}")
        print(f"# 槽位: {t.slots}")
        print(f"{'#' * 70}")

        for label, is_boss in (("普通关 normal", False), ("BOSS关 boss", True)):
            rules = t.rules(is_boss)
            print(f"\n--- {label} ---")
            print(f"  数据源: once_chain={len(rules['once_chain'])}段 "
                  f"loop_chain={len(rules['loop_chain'])}段 "
                  f"end_chain={len(rules['end_chain'])}段 "
                  f"sequence={len(rules['sequence'])}步")

            _override, chain_nodes = _cpl.build_fight_override(
                t, is_boss, coords, every_n)
            if chain_nodes is None:
                print("  （boss 关未配置 -> 短路等结算，不种植）")
                continue

            for kind, cn in (("once", "单次链（只执行一遍）"),
                             ("loop", "循环链（反复执行）"),
                             ("end", "收尾链")):
                node = chain_nodes.get(kind)
                if not node:
                    print(f"\n  --- {cn} ---  （空）")
                    continue
                segs = [x for x in node["dsl"].split(";") if x.strip()]
                print(f"\n  --- {cn} ---  {len(segs)} 条动作 -> {node['node']}")
                for i, seg in enumerate(segs, 1):
                    print(f"    {i:>3}. {seg}")

        print()


if __name__ == "__main__":
    main()
