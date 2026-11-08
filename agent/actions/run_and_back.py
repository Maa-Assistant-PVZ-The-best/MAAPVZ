# -*- coding: utf-8 -*-
"""run_and_back —— 引用回弹：跑一段子链，跑完回到本节点继续。

用法：本节点的 action 写 Custom + custom_action: run_and_back，参数：

    {
      "run":  "起始节点",        // 可选：从这里开始跑一条子链；不写 = 不跑子链，直接走本节点 next
      "back": "结束节点",        // 可选：执行完这个节点后结束本子 action
                                 //       （子跑期间它的 next 被临时清空）；
                                 //       不写 = 子链跑到自然结束（next 为空）为止
      "pipe_over": {             // 可选：一整个 pipe 片段，按同名节点覆盖其内部字段
          "某节点": {"next": [...], "recognition": {...}}
      }
    }

语义：
  - context.run_task(run, override) 同步跑子链；子链结束（back 执行完 /
    链尾无 next）后返回，本 action 返回 True，流程继续走本节点的 next。
  - run 指向本节点自己 = 「按本节点 next 起跑」：本次子跑的 override 会把
    本节点自身改写成 DirectHit + DoNothing + next=<本节点 next>，再拿它当入口。
    于是遍历发生在**子跑内部**——这是让 pipe_over 生效的唯一办法（任务级
    覆盖管不到父链的 next）；action 被换成 DoNothing，不会重入本 action。
    next 取自本节点当前数据；pipe_over 里若也给了本节点的 next，以 pipe_over 为准。
  - back 的 next 清空优先级最高：pipe_over 里若给 back 设了 next，会被接管
    并记日志。
  - pipe_over / back 的 next 清空都**只在子跑期间生效**，且通过
    context.clone() 隔离——克隆体上的覆盖不污染原始 context，
    子跑结束克隆体销毁，天然还原，不需要快照。

注意：
  - back 不在子链上时无法检测，子链会一路跑到自然结束——写 pipe 时自己保证
    back 可达（日志会打出子跑结果，可对照检查）。
  - run 指向本节点自己时，本节点 next 不能为空（取不到就报错并打印节点数据）。
  - 想让本子链结束后重新评估本节点自己（循环），把本节点的 next 指回自己；
    默认语义是继续走 next，不回环。

日志前缀：[run_and_back]
"""

import json
import sys

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction


def _parse_param(raw):
    """宽松解析 custom_action_param：dict / JSON 字符串 / 二次编码都容忍。"""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return {}
        try:
            v = json.loads(s)
        except Exception:
            return {}
        # 二次编码（字符串里还是 JSON 字符串）再解一层
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except Exception:
                return {}
        return v if isinstance(v, dict) else {}
    return {}


def _log(msg):
    print(f"[run_and_back] {msg}", file=sys.stderr, flush=True)


@AgentServer.custom_action("run_and_back")
class RunAndBack(CustomAction):
    """跑 run 起始的子链，到 back 为止，随后回本节点继续走 next。"""

    def run(self, context: Context, argv: CustomAction.RunArg) -> bool:
        param = _parse_param(argv.custom_action_param)

        entry = str(param.get("run") or "").strip()
        back = str(param.get("back") or "").strip()
        over = param.get("pipe_over") or {}

        if not entry:
            _log("未设 run（起始节点），跳过子跑，直接走本节点 next")
            return True
        if not isinstance(over, dict):
            _log("pipe_over 不是对象，忽略（收到：%s）" % type(over).__name__)
            over = {}

        override = dict(over)

        # ★ run 指向本节点 = 「按本节点 next 起跑」。
        #   做法：在本次子跑的 override 里把**本节点自己**改写成
        #   DirectHit + DoNothing + next=<本节点 next>，再拿它自己当入口。
        #   - 遍历因此跑在子跑内部，pipe_over 才真正生效；
        #   - action 被换成 DoNothing，不会重入本 Custom action（无递归）；
        #   - 不引入不存在的节点名（override 能否新增节点未经证实，不冒险）。
        self_name = str(getattr(argv, "node_name", "") or "").strip()
        if self_name and entry == self_name:
            node = context.get_node_data(self_name) or {}
            ov_self = dict(override.get(self_name) or {})
            raw = ov_self.get("next") or node.get("next") or []
            nxt = []
            if isinstance(raw, list):
                for it in raw:
                    if isinstance(it, str):
                        nxt.append(it)
                    elif isinstance(it, dict) and it.get("name"):
                        nxt.append(str(it["name"]))
            if not nxt:
                _log(f"run 指向本节点「{self_name}」，但取不到可跑的 next——"
                     f"本节点当前数据：{json.dumps(node, ensure_ascii=False)}")
                return False
            ov_self["recognition"] = "DirectHit"
            ov_self["action"] = "DoNothing"
            ov_self["next"] = nxt
            override[self_name] = ov_self
            _log(f"run 指向本节点自己 → 本次子跑以「{self_name}」自身为入口"
                 f"（DirectHit+DoNothing，next {len(nxt)} 个候选），pipe_over 生效")

        if back:
            b = dict(override.get(back) or {})
            if "next" in b:
                _log(f"pipe_over 里对 back 节点「{back}」设了 next，"
                     f"与回弹语义冲突——next 被接管为 []")
            b["next"] = []
            override[back] = b
            _log(f"子跑：{entry} → … → {back}（到 back 为止）"
                 f"{'，pipe_over 覆盖 ' + str(len(over)) + ' 个节点' if over else ''}")
        else:
            _log(f"子跑：{entry} → 链尾（未设 back）"
                 f"{'，pipe_over 覆盖 ' + str(len(over)) + ' 个节点' if over else ''}")

        try:
            cloned = context.clone()
        except Exception as e:
            _log(f"clone 失败：{e}，回退到原始 context（pipe_over 将污染主流程）")
            cloned = context

        detail = cloned.run_task(entry, override)
        if detail is None:
            _log(f"子跑失败：run_task 未返回任务详情（起点 {entry}）")
            return False

        _log(f"子跑完成：{entry} 起，回弹回本节点继续 next")
        return True
