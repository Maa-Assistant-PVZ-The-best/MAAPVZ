# -*- coding: utf-8 -*-
"""exit_watchdog —— 任务停止/结束时让 agent python 进程随之退出（事件驱动版）。

背景：MFA 点「停止任务」只停 tasker，**不断开**与 agent 的 IPC 连接，
`AgentServer.join()` 一直阻塞 -> python.exe 残留在系统里
（用户侧表现：「python 一直没法终止进程」，改代码后重跑任务还是旧代码）。

方案演进（为什么是事件而不是轮询）：
- v1/v2 轮询 `tasker.running/stopping`：每次查询都是一次反向 IPC，
  而 context/tasker 句柄**在 action 结束时就被服务端回收** ——
  轮询会发出空 tasker_id 的请求（客户端打 `tasker not found [tasker_id=]`
  报错），且局内长时间无 custom 的窗口（等开始战斗 60s 超时、空阵容战斗）
  句柄必失效 -> 拿到假 False -> 误自杀。轮询方案已废弃。
- v3（本版）：注册 agent 侧 **tasker 事件 sink**（`MaaAgentServerAddTaskerSink`，
  绑定层：`AgentServer.add_tasker_sink`），收 `Tasker.Task.*` 通知——
  客户端->agent 单向推送，零反向查询。收到终态事件（非 .Starting）
  -> 宽限 3 秒（让收尾日志写完）-> `os._exit(0)`。

注意：
- `os._exit` 是强退：即使某个 action 卡在死循环里也能退掉；
- 自杀线程是 daemon，不阻碍正常退出；
- MFA 下次启动任务会重新拉起本进程（child_exec）。
  若 MFA 队列跨任务复用同一 agent 进程导致队列第二棒断连，再议。

用法（main.py）：`exit_watchdog.register_tasker_sink(AgentServer)`
（运行时 API，import 后即可调用，无顺序要求）。
"""

import os
import sys
import threading
import time

_exit_armed = False
_arm_lock = threading.Lock()

_TASK_PREFIX = "Tasker.Task."


def _schedule_exit(reason: str, grace: float = 3.0) -> None:
    """宽限 grace 秒后强退（只武装一次）。"""
    global _exit_armed
    with _arm_lock:
        if _exit_armed:
            return
        _exit_armed = True

    def _boom():
        try:
            print(f"[exit_watchdog] {reason}，{grace:.0f}s 后退出进程",
                  file=sys.stderr, flush=True)
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        time.sleep(grace)
        os._exit(0)

    threading.Thread(target=_boom, daemon=True, name="exit-watchdog").start()


def register_tasker_sink(AgentServer) -> None:
    """注册 agent 侧 tasker 事件 sink：任务终态（停止/成功/失败）-> 退出进程。

    Tasker.Task.Starting / .Succeeded / .Failed（停止也算终态的一种）——
    只有 .Starting 不算结束，其余一律触发。
    """
    from maa.tasker import TaskerEventSink

    class _ExitSink(TaskerEventSink):
        def on_raw_notification(self, tasker, msg, details):
            try:
                if (isinstance(msg, str)
                        and msg.startswith(_TASK_PREFIX)
                        and not msg.endswith(".Starting")):
                    _schedule_exit(f"收到任务终态事件 {msg}")
            except Exception:
                pass

    try:
        AgentServer.add_tasker_sink(sink=_ExitSink())
        print("[exit_watchdog] 已注册 tasker sink（任务结束即退出进程）",
              file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[exit_watchdog] tasker sink 注册失败：{type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
