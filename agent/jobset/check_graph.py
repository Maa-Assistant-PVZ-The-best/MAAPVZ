# -*- coding: utf-8 -*-
"""反模式检查：找出「有反向兄弟节点、但正向节点的 next 里没引用它」的断路。

这类 bug 的症状：正向识别未命中时没有任何后继 -> 节点一直重试/卡死。
（本项目真实踩过：第一次进关卡在「局内跳过识别」处。）

    python agent/jobset/check_graph.py
"""

import json
import re
import sys
from pathlib import Path

# <仓库根>/agent/jobset/check_graph.py -> <仓库根>
ROOT = Path(__file__).resolve().parent.parent.parent
PIPE = ROOT / "assets" / "resource" / "pipeline"


def strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"^[ \t]*//.*$", "", s, flags=re.M)
    s = re.sub(r",(\s*[}\]])", r"\1", s)
    return s


def load_all(base: Path):
    nodes = {}
    for f in sorted(base.rglob("*.json")):
        if not f.is_file():
            continue
        try:
            j = json.loads(strip_comments(f.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
        if isinstance(j, dict):
            for k, v in j.items():
                nodes[k] = (v, f)
    return nodes


def refs(v):
    out = []
    if isinstance(v, dict):
        for fld in ("next", "on_error"):
            t = v.get(fld)
            if isinstance(t, str):
                out.append(t)
            elif isinstance(t, list):
                out += [x for x in t if isinstance(x, str)]
    return [x for x in out if not x.startswith(("[", "@"))]


def main():
    scope = PIPE / "Endless_ref.json"
    local = load_all(scope)
    allnodes = load_all(PIPE)

    problems = []

    # ---- 1) 悬挂引用 ----
    for n, (v, f) in local.items():
        for t in refs(v):
            if t not in allnodes:
                problems.append(f"悬挂引用: {f.name}  {n} -> {t}")

    # ---- 2) inverse 兄弟节点断路 ----
    # 约定：名字以「_反向」结尾的节点是反向兄弟；
    #       与之配对的「正向」节点必须在自己的 next 里引用它。
    for n, (v, f) in local.items():
        if not n.endswith("_反向"):
            continue
        fwd = n[: -len("_反向")]
        if fwd not in local:
            problems.append(f"孤立反向节点: {f.name}  {n}（找不到正向 {fwd}）")
            continue
        fwd_next = refs(local[fwd][0])
        if n not in fwd_next:
            problems.append(
                f"断路: {f.name}  「{fwd}」的 next 里没有「{n}」"
                f" -> 正向未命中时会卡死"
            )
        else:
            # 正向命中分支不能是空的
            hit = [x for x in fwd_next if x != n]
            if not hit:
                problems.append(f"空闲: {f.name}  「{fwd}」命中后没有后继")

    # ---- 3) 节点 next 全空（可能是漏写） ----
    for n, (v, f) in local.items():
        if not isinstance(v, dict):
            continue
        if v.get("enabled") is False:
            continue
        nx = v.get("next")
        if nx == [] or nx is None:
            if "补给占位" not in n:
                problems.append(f"空 next: {f.name}  {n}（确认是否有意为之）")

    print(f"Endless_ref 节点 {len(local)} / 全局 {len(allnodes)}\n")
    if not problems:
        print("✅ 未发现断路 / 悬挂引用")
        return 0

    print(f"❌ 发现 {len(problems)} 个问题：")
    for p in problems:
        print("  -", p)
    return 1


if __name__ == "__main__":
    sys.exit(main())
