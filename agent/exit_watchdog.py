# -*- coding: utf-8 -*-
"""exit_watchdog —— 任务停止/结束、或 MFA 关闭时让 agent python 进程随之退出。

背景：MFA 的 agent 是独立子进程。停任务只停 tasker、**不断开** IPC；
关闭 MFA 时 `AgentServer.join()` 也不会返回（连接静默断开，nanomsg 服务端
感知不到）——两种情况下 python.exe 都会残留。

本模块提供两条互补的退出路径：

1. **任务终态事件**（快路径）：注册 agent 侧 tasker sink
   （`AgentServer.add_tasker_sink`），收 `Tasker.Task.*` 终态通知
   （停止/成功/失败）→ 宽限 3 秒 → `os._exit(0)`。
   客户端→agent 单向推送，零反向查询。
   ⚠️ 不要用轮询 `tasker.running` 的方案：context/tasker 句柄在 action 结束
   即被服务端回收，轮询会发空 id 反向请求（客户端报 `tasker not found`）
   且局内无 custom 的长窗口会误自杀。轮询方案已废弃（v1/v2 教训）。

2. **祖先进程监控**（MFA 关闭路径）：启动时用 toolhelp32 快照记录祖先链
   （父进程 pwsh/终端宿主 + 祖父进程 MFA，各记 PID+ exe 名），后台线程
   每 1.5s 复查：任一祖先进程消失或 PID 被复用（同名校验）→
   判定 MFA 已关 → 宽限 2 秒 → `os._exit(0)`。
   toolhelp32 对同用户进程无权限要求（不碰 CIM/WMI——部分环境拒绝访问）。

注意：
- `os._exit` 是强退：即使某个 action 卡在死循环里也能退掉；
- 所有线程均为 daemon，不阻碍正常退出；
- MFA 下次启动任务会重新拉起本进程（child_exec）。

用法（main.py）：`exit_watchdog.arm(AgentServer)`
（import maa 后即可调用，无顺序要求）。
"""

import ctypes
import os
import sys
import threading
import time
from ctypes import wintypes

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


# ===========================================================================
# 路径 1：任务终态事件 sink
# ===========================================================================

def register_tasker_sink(AgentServer) -> None:
    """注册 agent 侧 tasker 事件 sink：任务终态（停止/成功/失败）-> 退出进程。"""
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


# ===========================================================================
# 路径 2：祖先进程监控（MFA 整个关掉时）
# ===========================================================================

_TH32CS_SNAPPROCESS = 0x2
_INVALID_HANDLE = ctypes.c_void_p(-1).value


class _PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_void_p),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * wintypes.MAX_PATH),
    ]


def _process_map() -> dict:
    """{pid: (ppid, exe_name)} 快照。toolhelp32 对同用户进程无权限要求。"""
    k32 = ctypes.windll.kernel32
    snap = k32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
    if not snap or snap == _INVALID_HANDLE:
        return {}
    m = {}
    try:
        e = _PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            m[e.th32ProcessID] = (e.th32ParentProcessID, e.szExeFile)
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    return m


def _ancestor_chain(levels: int = 2):
    """启动时记录祖先链 [(pid, exe_name), ...]：直接父进程起最多 levels 层。

    典型链路：MFA -> pwsh(终端宿主) -> python，即 [(pwsh), (MFA)]；
    MFA 直拉时 [(MFA), (它的父进程)]。任一死亡即说明宿主已关。
    """
    m = _process_map()
    chain = []
    pid = os.getppid()
    for _ in range(levels):
        info = m.get(pid)
        if not info:
            break
        ppid, name = info
        chain.append((pid, name))
        pid = ppid
    return chain


def start_ancestor_watch() -> None:
    """启动祖先监控线程：任一祖先进程死亡 -> 退出本进程。"""
    chain = _ancestor_chain()
    if not chain:
        print("[exit_watchdog] 未能获取祖先进程链，跳过祖先监控",
              file=sys.stderr, flush=True)
        return
    desc = " <- ".join(f"{name}({pid})" for pid, name in chain)
    print(f"[exit_watchdog] 祖先监控：{desc}", file=sys.stderr, flush=True)

    def _watch():
        while True:
            time.sleep(1.5)
            try:
                m = _process_map()
                for pid, name in chain:
                    cur = m.get(pid)
                    # 进程消失，或 PID 被复用（exe 名变了）都算祖先已死
                    if cur is None or cur[1].lower() != name.lower():
                        _schedule_exit(
                            f"祖先进程 {name}({pid}) 已退出（MFA 已关闭？）",
                            grace=2.0)
                        return
            except Exception:
                pass  # 快照失败不致命，下轮再查

    threading.Thread(target=_watch, daemon=True, name="ancestor-watch").start()


# ===========================================================================
# 入口
# ===========================================================================

def arm(AgentServer) -> None:
    """武装全部退出路径（任务终态事件 + 祖先进程监控）。"""
    register_tasker_sink(AgentServer)
    start_ancestor_watch()
