import sys
from pathlib import Path
from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.context import Context
import json
import time

_offset_state_map = {}


@AgentServer.custom_action("CleanupMaafwBakLogs")
class CleanupMaafwBakLogs(CustomAction):
    def run(
        self, context: Context, argv: CustomAction.RunArg
    ) -> CustomAction.RunResult:
        try:
            keep_count = 3
            if argv.custom_action_param:
                param_dict = json.loads(argv.custom_action_param)
                count_value = param_dict.get("save_log_count", "")
                if count_value and str(count_value).isdigit():
                    keep_count = int(count_value)
            cleanup_maafw_bak_logs(context, keep_count=keep_count)
            return CustomAction.RunResult(success=True)
        except Exception as e:
            print(f"日志清理执行异常: {e}")
            return CustomAction.RunResult(success=False)


def cleanup_maafw_bak_logs(context=None, keep_count: int = 3):
    root = Path(__file__).parent.parent
    try:
        debug_folder = root / "debug"
        if not debug_folder.exists():
            print("[日志清理] debug文件夹不存在")
            return
        log_files = list(debug_folder.glob("maafw.bak.*.log"))
        if not log_files:
            print("[日志清理] 无符合格式的日志")
            return
        log_files.sort(reverse=True)
        to_delete = log_files[keep_count:]
        for f in to_delete:
            f.unlink()
        print(f"[日志清理] 完成!保留最新 {keep_count} 个日志")
    except Exception as e:
        print(f"[日志清理] 异常:{e}")


@AgentServer.custom_action("OffsetClick")
class OffsetClick(CustomAction):
    def run(
        self, context: Context, argv: CustomAction.RunArg
    ) -> CustomAction.RunResult:
        try:
            key = "FragmentChallenge"
            state = _offset_state_map.get(key)

            param = {}
            if argv.custom_action_param:
                try:
                    param = json.loads(argv.custom_action_param)
                except:
                    pass

            initial_x = param.get("initial_x")
            initial_y = param.get("initial_y")
            if initial_x is None or initial_y is None:
                print("[OffsetClick] 缺少 initial_x 或 initial_y")
                return CustomAction.RunResult(success=False)

            dx = param.get("dx", 50)
            max_hits = param.get("max_hits", 3)
            n = param.get("n", 100)

            if state is None:
                state = {"current_x": initial_x, "current_y": initial_y, "hit_count": 0}
                _offset_state_map[key] = state

            click_x = state["current_x"]
            click_y = state["current_y"]

            print(f"[OffsetClick] 准备点击 ({click_x}, {click_y})")

            # 正确获取控制器：通过 tasker.controller
            ctrl = context.tasker.controller
            ctrl.post_click(click_x, click_y)
            print(f"[OffsetClick] 已执行点击 ({click_x}, {click_y})")

            state["current_x"] += dx
            state["hit_count"] += 1

            if state["hit_count"] >= max_hits:
                state["current_x"] = initial_x
                state["current_y"] = initial_y - n
                state["hit_count"] = 0
                print(f"[OffsetClick] 重置: 新基准 y = {state['current_y']}")

            return CustomAction.RunResult(success=True)
        except Exception as e:
            import traceback

            traceback.print_exc()
            print(f"OffsetClick 异常: {e}")
            return CustomAction.RunResult(success=False)
