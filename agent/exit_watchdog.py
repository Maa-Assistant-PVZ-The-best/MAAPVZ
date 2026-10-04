# -*- coding: utf-8 -*-
"""exit_watchdog —— MFA 关闭时让 agent python 进程随之退出。

背景：MFA 的 agent 是独立子进程。关闭 MFA 时 `AgentServer.join()` 不会返回
（IPC 连接静默断开，nanomsg 服务端感知不到），python.exe 残留在系统里。

方案：祖先进程监控。启动时用 toolhelp32 快照记录祖先链
（父进程 pwsh/终端宿主 + 祖父进程 MFA，各记 PID + exe 名），后台线程
每 1.5s 复查：任一祖先进程消失或 PID 被复用（同名校验）→ 判定宿主已关
→ 宽限 2 秒 → `os._exit(0)`。
toolhelp32 对同用户进程无权限要求（不碰 CIM/WMI——部分环境拒绝访问）。

⚠️ 已废弃的路线（别再走）：
- 轮询 `tasker.running/stopping`：context/tasker 句柄在 action 结束即被
  服务端回收，轮询会发空 id 反向请求（客户端报 `tasker not found`），
  且局内无 custom 的长窗口会拿到假 False 误自杀。

⚠️ 「任务终态事件自杀」只在 VSCode 扩展宿主下武装：
- 桌面端 MFAAvalonia 停任务后**不会重拉 agent，只复用原进程**——
  自杀后第二次任务 custom 全废只能重启软件（2026-10-04 打包版实测踩坑）。
- VSCode 扩展（maa-support）每次 startTask 都会 agent start race 尝试重拉，
  进程死了自动起新的——停任务即自杀反而顺手实现了
  「改代码 -> 停 -> 重跑 = 新代码」的 dev 循环。
  注意：扩展复用进程 => 任何 agent 代码改动都要旧进程先死才生效，
  所以这条路径对 dev 是刚需。

注意：
- `os._exit` 是强退：即使某个 action 卡在死循环里也能退掉；
- 所有线程均为 daemon，不阻碍正常退出。

用法（main.py）：`exit_watchdog.arm(AgentServer)`（import 后即可调用）。
"""

import ctypes
import os
import sys
import threading
import time
from ctypes import wintypes

_exit_armed = False
_arm_lock = threading.Lock()
_dev_mode = False  # VSCode 扩展宿主（arm 时按祖先链判定）


def _schedule_exit(reason: str, grace: float = 2.0) -> None:
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
# 祖先进程监控（toolhelp32 快照，同用户无权限要求）
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
    """{pid: (ppid, exe_name)} 快照。"""
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


def _register_tasker_sink(AgentServer) -> None:
    """注册 agent 侧 tasker 事件 sink：任务终态（停止/成功/失败）-> 退出进程。

    客户端->agent 单向推送，零反向查询。只在 VSCode 扩展宿主下由 arm() 调用。
    """
    from maa.tasker import TaskerEventSink

    class _ExitSink(TaskerEventSink):
        def on_raw_notification(self, tasker, msg, details):
            try:
                if (isinstance(msg, str)
                        and msg.startswith("Tasker.Task.")
                        and not msg.endswith(".Starting")):
                    _schedule_exit(f"收到任务终态事件 {msg}", grace=3.0)
            except Exception:
                pass

    try:
        AgentServer.add_tasker_sink(sink=_ExitSink())
        print("[exit_watchdog] 已注册 tasker sink（任务结束即退出进程）",
              file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[exit_watchdog] tasker sink 注册失败：{type(e).__name__}: {e}",
              file=sys.stderr, flush=True)


def _start_ancestor_watch(chain) -> None:
    """启动祖先监控线程：任一祖先进程死亡 -> 退出本进程。"""
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
                            f"祖先进程 {name}({pid}) 已退出（MFA 已关闭？）")
                        return
            except Exception:
                pass  # 快照失败不致命，下轮再查

    threading.Thread(target=_watch, daemon=True, name="ancestor-watch").start()


def on_task_stopped(reason: str = "任务停止（VSCode 宿主）") -> None:
    """custom action 在运行期间观测到任务停止（tasker.stopping/running=False）时调用。

    action 运行期间 context/tasker 句柄是有效的，这是**唯一可靠的停止观测点**
    （action 外句柄即被回收；终态事件 sink 是否被客户端转发没有保证）。
    VSCode 宿主下安排进程退出；桌面端复用进程，无视。
    """
    if _dev_mode:
        _schedule_exit(reason, grace=1.0)


def arm(AgentServer=None) -> None:
    """武装退出路径。

    - 祖先进程监控：总是武装（宿主进程死了就退）。
    - Tasker.Task 终态事件自杀：仅当祖先链显示运行在 VSCode 扩展宿主
      （Code.exe）下才武装——扩展每次 startTask 都会重拉死掉的 agent，
      停任务即退出 = dev 改代码即刻生效；桌面端 MFAAvalonia 复用进程，
      绝不能武装（否则停一次任务后续全废）。
    """
    global _dev_mode
    chain = _ancestor_chain()
    _start_ancestor_watch(chain)
    if any("code" in name.lower() for _pid, name in chain):
        _dev_mode = True
        _register_tasker_sink(AgentServer)
        print("[exit_watchdog] 检测到 VSCode 扩展宿主：停任务即退出进程"
              "（重跑自动加载新代码）", file=sys.stderr, flush=True)
