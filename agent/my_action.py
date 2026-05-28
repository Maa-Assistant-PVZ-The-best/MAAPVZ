import sys
from pathlib import Path
from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.context import Context
import json


@AgentServer.custom_action("CleanupMaafwBakLogs")
class CleanupMaafwBakLogs(CustomAction):
    """
    清理maafw.bak日志文件
    参数：{"save_log_count": 保留日志数量}
    默认留3个
    """

    def run(
        self,
        context: Context,
        argv: CustomAction.RunArg,
    ) -> CustomAction.RunResult:
        try:
            keep_count = 3  # 默认值
            if argv.custom_action_param:
                param_dict = json.loads(argv.custom_action_param)
                count_value = param_dict.get("save_log_count", "")
                # 安全解析数字
                if count_value and str(count_value).isdigit():
                    keep_count = int(count_value)

            cleanup_maafw_bak_logs(context, keep_count=keep_count)

            return CustomAction.RunResult(success=True)

        except Exception as e:
            print(f"日志清理执行异常: {e}")
            return CustomAction.RunResult(success=False)


def cleanup_maafw_bak_logs(context=None, keep_count: int = 3):
    import sys
    from pathlib import Path

    root = Path(__file__).parent.parent
    sys.path.insert(0, str(root))

    try:
        debug_folder = root / "debug"
        print(f"[调试] debug_folder 的实际路径是: {debug_folder.resolve()}")

        if not debug_folder.exists():
            print("[日志清理] debug文件夹不存在")
            return

        log_files = list(debug_folder.glob("maafw.bak.*.log"))
        print(f"[日志清理] 找到日志总数:{len(log_files)}")

        if not log_files:
            print("[日志清理] 无符合格式的日志")
            return

        # 按时间从新到旧排序
        log_files.sort(reverse=True)
        to_delete = log_files[keep_count:]
        print(f"[日志清理] 待删除旧日志:{len(to_delete)} 个")

        # 删除
        for f in to_delete:
            try:
                f.unlink()
                print(f"[日志清理] 已删除:{f.name}")
            except Exception as e:
                print(f"[日志清理] 删除失败 {f.name}:{e}")

        print(f"[日志清理] 完成!保留最新 {keep_count} 个日志")

    except Exception as e:
        print(f"[日志清理] 异常:{e}")
