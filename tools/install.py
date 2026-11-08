import sys
import io

# 修复 Windows 控制台编码
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
from pathlib import Path

import shutil
import sys

try:
    import jsonc
except ModuleNotFoundError as e:
    raise ImportError(
        "Missing dependency 'json-with-comments' (imported as 'jsonc').\n"
        f"Install it with:\n  {sys.executable} -m pip install json-with-comments\n"
        "Or add it to your project's requirements."
    ) from e

from configure import configure_ocr_model


working_dir = Path(__file__).parent.parent.resolve()
version = len(sys.argv) > 1 and sys.argv[1] or "v0.0.1"

# the first parameter is self name
if sys.argv.__len__() < 4:
    print("Usage: python install.py <version> <os> <arch> [mfa|mxu]")
    print("Example: python install.py v1.0.0 win x86_64")
    print("         python install.py v1.0.0 win x86_64 mxu")
    sys.exit(1)

os_name = sys.argv[2]
arch = sys.argv[3]
# 第四个参数选择发行包形态：mfa（默认，MFAAvalonia）或 mxu（MXU）。
# 两者共用 resource / agent / 网页工具，只是 UI 宿主和 MaaFramework 的摆放位置不同：
#   MFA: runtimes/<rid>/native + MaaAgentBinary
#   MXU: maafw/ + maafw/MaaAgentBinary（目录约定见 https://github.com/MaaXYZ/MXU）
target = sys.argv[4].lower() if len(sys.argv) > 4 else "mfa"
if target not in ("mfa", "mxu"):
    print(f"Unknown install target: {target} (expected 'mfa' or 'mxu')")
    sys.exit(1)

install_path = working_dir / ("install-mxu" if target == "mxu" else "install")


def get_dotnet_platform_tag():
    """自动检测当前平台并返回对应的dotnet平台标签"""
    if os_name == "win" and arch == "x86_64":
        platform_tag = "win-x64"
    elif os_name == "win" and arch == "aarch64":
        platform_tag = "win-arm64"
    elif os_name == "macos" and arch == "x86_64":
        platform_tag = "osx-x64"
    elif os_name == "macos" and arch == "aarch64":
        platform_tag = "osx-arm64"
    elif os_name == "linux" and arch == "x86_64":
        platform_tag = "linux-x64"
    elif os_name == "linux" and arch == "aarch64":
        platform_tag = "linux-arm64"
    else:
        print("Unsupported OS or architecture.")
        print("available parameters:")
        print("version: e.g., v1.0.0")
        print("os: [win, macos, linux, android]")
        print("arch: [aarch64, x86_64]")
        sys.exit(1)

    return platform_tag


def _copy_agent_binary():
    """把 MaaAgentBinary 放到各 UI 约定的位置。"""
    deps_dir = working_dir / "deps"
    share_source = deps_dir / "share" / "MaaAgentBinary"
    if not share_source.exists():
        share_source = deps_dir / "MaaAgentBinary"
    if share_source.exists():
        # MXU 从 maafw/ 加载运行库，AgentBinary 也跟随放在 maafw 下；
        # MFA 则沿用包根的 MaaAgentBinary/。
        dest = install_path / "maafw" / "MaaAgentBinary" if target == "mxu" else install_path / "MaaAgentBinary"
        shutil.copytree(
            share_source,
            dest,
            dirs_exist_ok=True,
        )
    else:
        print("Warning: MaaAgentBinary not found, skipping.")


def install_deps():
    print("=== [DEBUG] Running install_deps (with auto-flatten) ===")
    deps_dir = working_dir / "deps"
    print(f"[DEBUG] deps_dir = {deps_dir}")

    bin_source = deps_dir / "bin"
    if not bin_source.exists():
        # 尝试自动扁平化：查找以 MAA- 开头的子目录
        subdirs = [d for d in deps_dir.iterdir() if d.is_dir() and d.name.startswith("MAA-")]
        if subdirs:
            print(f"Found MaaFramework subdirectories: {subdirs}")
            for sub in subdirs:
                print(f"Moving contents of {sub} to {deps_dir}")
                for item in sub.iterdir():
                    dest = deps_dir / item.name
                    if dest.exists():
                        if dest.is_dir():
                            shutil.rmtree(dest)
                        else:
                            dest.unlink()
                    shutil.move(str(item), str(dest))
                sub.rmdir()
            print("Finished flattening deps directory.")
        # 再次检查 bin_source
        if not bin_source.exists():
            print('Please download the MaaFramework to "deps" first (missing bin directory).')
            print('请先下载 MaaFramework 到 "deps"（缺少 bin 目录）。')
            sys.exit(1)

    # 验证关键库文件存在（Windows 用 .dll，其他用 .so 或 .dylib）
    if os_name == "win":
        if not (bin_source / "MaaFramework.dll").exists():
            print("Error: MaaFramework.dll not found in bin directory.")
            sys.exit(1)
    else:
        if not (bin_source / "libMaaFramework.so").exists() and not (bin_source / "libMaaFramework.dylib").exists():
            print("Error: MaaFramework library not found in bin directory.")
            sys.exit(1)

    print(f"[DEBUG] Using binary source: {bin_source}")

    # MXU 直接在项目根目录加载 maafw/ 下的运行库，不走 MFA 的 runtimes/<rid>/native。
    if target == "mxu":
        shutil.copytree(
            bin_source,
            install_path / "maafw",
            ignore=shutil.ignore_patterns(
                "*MaaDbgControlUnit*",
                "*MaaThriftControlUnit*",
                "*MaaRpc*",
                "*MaaHttp*",
                "*MaaNode*",
                "*MaaPiCli*",
                "*.node",
            ),
            dirs_exist_ok=True,
        )
        _copy_agent_binary()
        return

    # 复制二进制文件
    if os_name == "android":
        shutil.copytree(
            bin_source,
            install_path,
            dirs_exist_ok=True,
        )
    else:
        shutil.copytree(
            bin_source,
            install_path / "runtimes" / get_dotnet_platform_tag() / "native",
            ignore=shutil.ignore_patterns(
                "*MaaDbgControlUnit*",
                "*MaaThriftControlUnit*",
                "*MaaRpc*",
                "*MaaHttp*",
            ),
            dirs_exist_ok=True,
        )

    _copy_agent_binary()
    if os_name == "macos":
        libs_dir = install_path / "libs"
        libs_dir.mkdir(parents=True, exist_ok=True)
        
        # 从 bin_source 复制所有 .dylib 到 libs/（确保完整性）
        for dylib in bin_source.glob("*.dylib"):
            dest = libs_dir / dylib.name
            shutil.copy2(dylib, dest)
            # macOS 动态库需要可执行权限
            dest.chmod(0o755)
        print(f"Copied macOS dynamic libraries to {libs_dir}")

        
def install_resource():
    configure_ocr_model()

    # 复制整个 resource 目录（包含 task 子目录及其中所有文件）
    shutil.copytree(
        working_dir / "assets" / "resource",
        install_path / "resource",
        dirs_exist_ok=True,
    )

    # 作业集（用户数据）在这里**不预建**：正式落点是 <包根>/jobs（包外），
    # 由 agent / 网页编辑器首次使用时自己创建。口径见
    # agent/jobset/engine.py 的 jobs_dir_for()。
    # ★ 千万别让作业集回到 resource/ 下面 —— 那是包根级条目，安卓端 App
    #   升级会把整棵 resource/ 删掉重解，用户作业集被清空（2026-10-30 事故）。

    # 复制 interface.json（只一次）
    shutil.copy2(
        working_dir / "assets" / "interface.json",
        install_path,
    )

    interface_path = install_path / "interface.json"
    with open(interface_path, "r", encoding="utf-8") as f:
        interface = jsonc.load(f)

    # 设置版本
    interface["version"] = version

    # 修正 agent 配置
    if "agent" in interface:
        if target == "mxu":
            # MXU 在项目根目录启动子进程，路径统一用 ./ 前缀；child_args 固定为
            # “-u ./agent/main.py”，与 MXU 的日志/停止行为对齐。
            interface["agent"]["child_exec"] = "./python/python.exe" if os_name == "win" else "./python/bin/python3"
            interface["agent"]["child_args"] = ["-u", "./agent/main.py"]
            # debug_session 是 MFA 宿主的扩展字段，不在 PI V2 schema 内；
            # MXU 严格按 schema 解析，输出时去掉，避免未知字段被拒绝。
            interface["agent"].pop("debug_session", None)
            interface["title"] = f"MaaPVZ {version} | 植物大战僵尸2小助手"
        else:
            if os_name == "win":
                interface["agent"]["child_exec"] = "python\\python.exe"
            else:
                interface["agent"]["child_exec"] = "python/bin/python3"

            if "child_args" in interface["agent"] and len(interface["agent"]["child_args"]) >= 2:
                script_path = interface["agent"]["child_args"][1]
                if script_path.startswith(".."):
                    interface["agent"]["child_args"][1] = "agent/main.py"

    with open(interface_path, "w", encoding="utf-8") as f:
        jsonc.dump(interface, f, ensure_ascii=False, indent=4)
        
def install_chores():
    shutil.copy2(
        working_dir / "README.md",
        install_path,
    )
    shutil.copy2(
        working_dir / "LICENSE",
        install_path,
    )
    shutil.copy2(
        working_dir / "docs" / "imgs" / "logo.ico",
        install_path / "resource" / "logo.ico",
    )
    # ★ PNG 版图标：interface.json 的 icon 引用它（ico 是 Windows 专用格式，
    #   Mac/Linux 的 MFA 宿主不认，PNG 全平台可显示）。
    shutil.copy2(
        working_dir / "docs" / "imgs" / "logo.png",
        install_path / "resource" / "logo.png",
    )
    shutil.copy2(
        Path(__file__).parent / "AGENTS.md",
        install_path,
    )


def install_agent():
    shutil.copytree(
        working_dir / "agent",
        install_path / "agent",
        dirs_exist_ok=True,
    )


def install_game_assist_tools():
    """复制网页工具目录（作业集编辑器）。

    OpenJobEditor 动作按 <仓库根>/game_assist_tools/endless_setup/pvz.py 定位脚本，
    不复制的话发行包内该路径必然缺失，动作恒定失败（见 0930 日志）。
    """
    source = working_dir / "game_assist_tools"
    if not source.exists():
        print("Warning: game_assist_tools not found, skipping.")
        return
    shutil.copytree(
        source,
        install_path / "game_assist_tools",
        dirs_exist_ok=True,
    )


if __name__ == "__main__":
    install_deps()
    install_resource()
    install_chores()
    install_agent()
    install_game_assist_tools()

    print(f"Install to {install_path} successfully.")
