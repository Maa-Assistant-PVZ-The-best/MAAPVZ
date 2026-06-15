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
install_path = working_dir / Path("install")
version = len(sys.argv) > 1 and sys.argv[1] or "v0.0.1"

# the first parameter is self name
if sys.argv.__len__() < 4:
    print("Usage: python install.py <version> <os> <arch>")
    print("Example: python install.py v1.0.0 win x86_64")
    sys.exit(1)

os_name = sys.argv[2]
arch = sys.argv[3]


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

    # 复制 MaaAgentBinary（通常位于 deps/share/MaaAgentBinary）
    share_source = deps_dir / "share" / "MaaAgentBinary"
    if not share_source.exists():
        share_source = deps_dir / "MaaAgentBinary"
    if share_source.exists():
        shutil.copytree(
            share_source,
            install_path / "MaaAgentBinary",
            dirs_exist_ok=True,
        )
    else:
        print("Warning: MaaAgentBinary not found, skipping.")
        
def install_resource():
    configure_ocr_model()

    # 复制整个 resource 目录（包含 task 子目录及其中所有文件）
    shutil.copytree(
        working_dir / "assets" / "resource",
        install_path / "resource",
        dirs_exist_ok=True,
    )
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


def install_agent():
    shutil.copytree(
        working_dir / "agent",
        install_path / "agent",
        dirs_exist_ok=True,
    )


if __name__ == "__main__":
    install_deps()
    install_resource()
    install_chores()
    install_agent()

    print(f"Install to {install_path} successfully.")
