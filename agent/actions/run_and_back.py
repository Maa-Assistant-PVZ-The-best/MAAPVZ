# -*- coding: utf-8 -*-
"""run_and_back —— 引用回弹：跑一段子链，跑完回到本节点继续。

用法：本节点的 action 写 Custom + custom_action: run_and_back，参数：

    {
      "run":  "起始节点",        // 必填：从这里开始跑一条子链
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
  - back 的 next 清空优先级最高：pipe_over 里若给 back 设了 next，会被接管
    并记日志。
  - pipe_over / back 的 next 清空都**只在子跑期间生效**（run_task 的
    pipeline_override 是一次性的，不污染已加载的 pipeline，跑完自动还原，
    不需要快照）。

注意：
  - back 不在子链上时无法检测，子链会一路跑到自然结束——写 pipe 时自己保证
    back 可达（日志会打出子跑结果，可对照检查）。
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
            _log("参数缺 run（起始节点），本节点不做任何事，直接失败")
            return False
        if not isinstance(over, dict):
            _log("pipe_over 不是对象，忽略（收到：%s）" % type(over).__name__)
            over = {}

        override = dict(over)
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

        detail = context.run_task(entry, override)
        if detail is None:
            _log(f"子跑失败：run_task 未返回任务详情（起点 {entry}）")
            return False

        _log(f"子跑完成：{entry} 起，回弹回本节点继续 next")
        return True
