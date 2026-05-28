import os
import sys
from pathlib import Path

current_file_path = Path(__file__).resolve()
current_script_dir = current_file_path.parent
project_root_dir = current_script_dir
if Path.cwd() != project_root_dir:
    os.chdir(project_root_dir)
    print(f"[启动] 工作目录已切换至: {Path.cwd()}")

sys.path.insert(0, str(project_root_dir))
sys.path.insert(0, str(project_root_dir / "agent"))

from maa.agent.agent_server import AgentServer
from maa.toolkit import Toolkit

import my_action
import my_reco


def main():
    Toolkit.init_option("./")

    if len(sys.argv) < 2:
        print("错误：缺少 socket_id 参数")
        print("使用方法: python main.py <socket_id>")
        sys.exit(1)

    socket_id = sys.argv[-1]
    print(f"[启动] socket_id = {socket_id}")

    AgentServer.start_up(socket_id)
    print("[启动] AgentServer 已启动")
    AgentServer.join()
    AgentServer.shut_down()
    print("[启动] AgentServer 已关闭")


if __name__ == "__main__":
    main()
