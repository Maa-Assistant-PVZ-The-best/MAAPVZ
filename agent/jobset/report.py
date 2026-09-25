# -*- coding: utf-8 -*-
"""把作业集里每张表的落子顺序链打印成人能核对的形式。

    python agent/jobset/report.py            # 用 current.json 的作业集
    python agent/jobset/report.py <code>     # 指定作业集
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

TYPE_CN = {"plant": "种", "feed": "喂豆", "shovel": "铲"}


def main():
    code = sys.argv[1] if len(sys.argv) > 1 else None
    js = load_jobset(code)
    coords = dsl.load_coords()

    print("=" * 70)
    print(f"作业集「{js.name}」 code={js.code}  表数={len(js.tables)}")
    print(f"坐标表键数={len(coords)}")
    print("=" * 70)

    for t in js.tables:
        rng = f"{t.from_level} ~ {t.to_level if t.to_level is not None else '末'}"
        print(f"\n{'#' * 70}")
        print(f"# 表{t.index + 1}   关卡 {rng}")
        print(f"# 选卡植物: {t.plants}")
        print(f"# 槽位: {t.slots}")
        print(f"{'#' * 70}")

        for label, key in (("普通关 non_boss", "non_boss"), ("BOSS关 boss", "boss")):
            rules = t.rules(key == "boss")
            print(f"\n--- {label} ---")
            print(f"  wave(点波)={rules['wave']}  loop={rules['loop']}  once={rules['once']}")
            print(f"  数据源: once_chain={len(rules['once_chain'])}段 "
                  f"loop_chain={len(rules['loop_chain'])}段 "
                  f"sequence={len(rules['sequence'])}步")

            r = dsl.rules_dsl(rules, t.slots, coords)
            print(f"  采用数据源: {r['source']}")

            for nm, cn in (("once", "单次链（只执行一遍）"), ("loop", "循环链（反复执行）")):
                v = r[nm]
                print(f"\n  --- {cn} ---  {v['count']} 条动作，缺失 {len(v['missing'])}")
                if v["dsl"]:
                    for i, seg in enumerate(v["dsl"].split(";"), 1):
                        print(f"    {i:>3}. {seg}")
                for m in v["missing"]:
                    print(f"      !! {m}")

        print()


if __name__ == "__main__":
    main()
