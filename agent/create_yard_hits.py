# -*- coding: utf-8 -*-
"""创意庭院 —— 每轮开头清零自重试节点的命中次数（CustomAction）。

为什么需要
----------
主流程里很多节点靠「next 里再放一次自己」重试点击。点击一直不生效时，
它会永远命中自己，任务既不超时也不结束。给这些节点加 max_hit 可以封顶，
但 max_hit 是**整个任务累计**的：刷赞要重复建关 N 次、刷币要反复游玩直到
代币上限，累计几轮就会把正常路径上的节点耗尽。

所以在每一轮的入口节点（创意庭院_确认自己在创意庭院 / 创意庭院_刷币_点击游玩）
挂上本动作，把下面这批节点的命中次数清零 —— max_hit 就变成了「单轮上限」。

⚠️ 这里只列「单轮上限」节点。下面两类**绝不能**清零：
    创意庭院_刷赞_重新创建关卡检测次数   max_hit = 用户填的点赞次数（跨轮计数器）
    创意庭院_分享_*                      分享链每次任务只跑一次，靠 max_hit 防重入
"""

import sys

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction


def _log(msg: str) -> None:
    print(f"[CreateYardHits] {msg}", file=sys.stderr, flush=True)


# 与 pipeline/create_yard 里带 max_hit 的自重试节点一一对应（改一边要同步另一边）
PER_ROUND_NODES = (
    # 01_create_yard.json：建关
    "创意庭院_选择砸罐子_确定",
    "创意庭院_选择砸罐子_设置名字",
    "创意庭院_选择砸罐子_输入名字_点击白框",
    "创意庭院_选择砸罐子_输入名字",
    # 01：试玩 + 发布
    "创意庭院_砸罐子_局内_点罐子",
    "创意庭院_砸罐子_局内_结算",
    "创意庭院_砸罐子_发布_点击关卡",
    "创意庭院_砸罐子_发布",
    "创意庭院_砸罐子_发布_确定",
    "创意庭院_砸罐子_发布_确定2",
    "创意庭院_砸罐子_发布_关闭",
    # 01：搜索 + 游玩
    "创意庭院_点击游玩",
    "创意庭院_点击搜索",
    "创意庭院_点击输入_搜索",
    "创意庭院_点击输入_搜索_选择关卡",
    "创意庭院_点击输入_搜索_选择关卡_挑战",
    "创意庭院_游玩_点罐子",
    "创意庭院_游玩_结算",
    # custom_create_yard.json
    "创意庭院_点击输入_粘贴",
    "创意庭院_InputID",
)


@AgentServer.custom_action("CreateYardResetHits")
class CreateYardResetHits(CustomAction):
    """清零 PER_ROUND_NODES 的命中次数。清零失败不影响流程（最坏退化为累计上限）。"""

    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        failed = []
        for node in PER_ROUND_NODES:
            try:
                if not context.clear_hit_count(node):
                    failed.append(node)
            except Exception as e:  # 老版本 maafw 没有 clear_hit_count
                _log(f"clear_hit_count 不可用：{e}")
                break
        if failed:
            # 从没命中过的节点清零会返回 False，属正常
            _log(f"{len(failed)} 个节点无需清零/清零失败")
        return CustomAction.RunResult(success=True)
