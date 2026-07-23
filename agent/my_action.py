import sys
import time
from pathlib import Path
from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.context import Context
import json
from PIL import Image

# 智能获取根目录（兼容开发与 PyInstaller 打包）
if getattr(sys, 'frozen', False):
    ROOT_DIR = Path(sys.executable).parent
else:
    ROOT_DIR = Path(__file__).parent.parent

_screenshot_counter = {}
_offset_state_map = {}
_plant_states = {}
SCREENSHOT_DIR = ROOT_DIR / "screenshots"


def _get_plant_state(name: str, level: int = None, initial_count: int = None, initial_counts: dict = None) -> dict:
    """获取或初始化指定植物的计数状态，支持单独设置某阶初始运行次数。
    如果状态已存在但对应阶的 run_counts 为 0，仍会应用 initial_count。
    """
    if name not in _plant_states:
        state = {
            "level": 1,
            "counts": {1: 0, 2: 0, 3: 0, 4: 0},
            "run_counts": {1: 0, 2: 0, 3: 0, 4: 0},
        }
        _plant_states[name] = state
    else:
        state = _plant_states[name]

    # 应用 initial_count（如果该阶尚未运行过）
    if initial_count is not None and level is not None and level in (1, 2, 3, 4):
        if state["run_counts"][level] == 0:
            state["run_counts"][level] = int(initial_count) - 1
    elif initial_counts:
        for k in (1, 2, 3, 4):
            if state["run_counts"][k] == 0:
                v = initial_counts.get(k) or initial_counts.get(str(k))
                if v is not None:
                    state["run_counts"][k] = int(v) - 1

    return state


@AgentServer.custom_action("CleanupMaafwBakLogs")
class CleanupMaafwBakLogs(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
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
    try:
        debug_folder = ROOT_DIR / "debug"
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


def get_node_name_from_argv(argv):
    candidates = ['node', 'node_name', 'name', 'task_node', 'current_node', 'recognition_name']
    for attr in candidates:
        if hasattr(argv, attr):
            val = getattr(argv, attr)
            if val is not None and isinstance(val, str):
                return val
    attrs = [a for a in dir(argv) if not a.startswith('_')]
    print(f"[DEBUG] argv 属性: {attrs}")
    return None


@AgentServer.custom_action("OffsetClick_y")
class OffsetClick(CustomAction):
    """原版：每次点击 x 增加 dx，每 max_hits 次后重置，重置时 y 减去 n，x 回到初始值+dx"""
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        try:
            node_name = get_node_name_from_argv(argv)
            if node_name is None:
                print("[OffsetClick] 警告：无法获取节点名称，使用固定键'DefaultNode'，状态可能串扰")
                node_name = "DefaultNode"
            
            key = f"OffsetState_{node_name}"
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
                print(f"[OffsetClick][{node_name}] 缺少 initial_x 或 initial_y")
                return CustomAction.RunResult(success=False)

            dx = param.get("dx", 50)
            max_hits = param.get("max_hits", 3)
            n = param.get("n", 100)

            if state is None:
                state = {
                    "current_x": initial_x,
                    "base_y_offset": 0,
                    "hit_count": 0,
                    "initial_x": initial_x,
                    "initial_y": initial_y
                }
                _offset_state_map[key] = state
                print(f"[OffsetClick][{node_name}] 初始化: x={initial_x}, y基={initial_y}, dx={dx}, max_hits={max_hits}, n={n}")

            current_y = state["initial_y"] + state["base_y_offset"]
            will_reset = (state["hit_count"] + 1) >= max_hits

            if will_reset:
                new_offset = state["base_y_offset"] - n
                click_y = state["initial_y"] + new_offset
                click_x = state["initial_x"]
                print(f"[OffsetClick][{node_name}] 重置点击 ({click_x}, {click_y}) (第{state['hit_count']+1}次)")
            else:
                click_x = state["current_x"]
                click_y = current_y
                print(f"[OffsetClick][{node_name}] 正常点击 ({click_x}, {click_y}) (第{state['hit_count']+1}次)")

            context.tasker.controller.post_click(click_x, click_y, contact=0)

            if will_reset:
                state["current_x"] = state["initial_x"] + dx
                state["base_y_offset"] -= n
                state["hit_count"] = 0
                print(f"[OffsetClick][{node_name}] 重置后: y偏移={state['base_y_offset']}, x起点={state['current_x']}")
            else:
                state["current_x"] += dx
                state["hit_count"] += 1

            return CustomAction.RunResult(success=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"OffsetClick 异常: {e}")
            return CustomAction.RunResult(success=False)


@AgentServer.custom_action("OffsetClick_x")
class OffsetClickSwapped(CustomAction):
    """
    交换版：每次点击 y 增加 dy，每 max_hits 次后重置，重置时 x 减去 n，y 回到初始值
    参数：
        initial_x, initial_y: 初始坐标（必需）
        dy: 每次点击 y 的增加量（默认 50）
        max_hits: 触发重置的点击次数（默认 3）
        n: 重置时 x 的减少量（默认 100）
    """
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        node_name = get_node_name_from_argv(argv)
        if node_name is None:
            print("[OffsetClick_x] 警告：无法获取节点名称，使用固定键'DefaultNode'，状态可能串扰")
            node_name = "DefaultNode"
        
        key = f"OffsetSwapped_{node_name}"
        state = _offset_state_map.get(key)

        param = {}
        if argv.custom_action_param:
            param = json.loads(argv.custom_action_param)

        initial_x = param.get("initial_x")
        initial_y = param.get("initial_y")
        if initial_x is None or initial_y is None:
            print(f"[OffsetClick_x][{node_name}] 缺少 initial_x 或 initial_y")
            return CustomAction.RunResult(success=False)

        dy = param.get("dy", 50)
        max_hits = param.get("max_hits", 3)
        n = param.get("n", 100)

        if state is None:
            state = {
                "current_y": initial_y,
                "base_x_offset": 0,
                "hit_count": 0,
                "initial_x": initial_x,
                "initial_y": initial_y
            }
            _offset_state_map[key] = state
            print(f"[OffsetClick_x][{node_name}] 初始化: x基={initial_x}, y基={initial_y}, dy={dy}, max_hits={max_hits}, n={n}")

        current_x = state["initial_x"] + state["base_x_offset"]
        will_reset = (state["hit_count"] + 1) >= max_hits

        if will_reset:
            new_x_offset = state["base_x_offset"] - n
            click_x = state["initial_x"] + new_x_offset
            click_y = state["initial_y"]
            print(f"[OffsetClick_x][{node_name}] 重置点击 ({click_x}, {click_y}) (第{state['hit_count']+1}次)")
        else:
            click_x = current_x
            click_y = state["current_y"]
            print(f"[OffsetClick_x][{node_name}] 正常点击 ({click_x}, {click_y}) (第{state['hit_count']+1}次)")

        context.tasker.controller.post_click(click_x, click_y, contact=0)

        if will_reset:
            state["current_y"] = state["initial_y"]
            state["base_x_offset"] -= n
            state["hit_count"] = 0
            print(f"[OffsetClick_x][{node_name}] 重置后: x偏移={state['base_x_offset']}, y起点={state['current_y']}")
        else:
            state["current_y"] += dy
            state["hit_count"] += 1

        return CustomAction.RunResult(success=True)

    
@AgentServer.custom_action("ResetOffset")
class ResetOffset(CustomAction):
    """
    重置指定节点的偏移状态（使其下次点击时从初始值重新开始）
    参数（custom_action_param）可选：
    {
        "node_name": "节点名"   // 如果不提供，则使用当前执行此动作的节点名
    }
    """
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = {}
        if argv.custom_action_param:
            param = json.loads(argv.custom_action_param)
        
        target_node = param.get("node_name")
        if target_node is None:
            target_node = get_node_name_from_argv(argv)
        
        if target_node is None:
            print("[ResetOffset] 错误：无法确定要重置的节点名")
            return CustomAction.RunResult(success=False)
        
        key_y = f"OffsetState_{target_node}"
        key_x = f"OffsetSwapped_{target_node}"
        
        removed_y = _offset_state_map.pop(key_y, None) is not None
        removed_x = _offset_state_map.pop(key_x, None) is not None
        
        if removed_y or removed_x:
            print(f"[ResetOffset] 已重置节点 '{target_node}' 的状态")
        else:
            print(f"[ResetOffset] 节点 '{target_node}' 没有偏移状态记录，无需重置")
        
        return CustomAction.RunResult(success=True)


@AgentServer.custom_action("ResetAllOffsets")
class ResetAllOffsets(CustomAction):
    """
    重置所有节点的偏移状态（清空整个状态字典）
    不需要任何参数
    """
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        global _offset_state_map
        count = len(_offset_state_map)
        _offset_state_map.clear()
        print(f"[ResetAllOffsets] 已清空所有偏移状态，共 {count} 条记录")
        return CustomAction.RunResult(success=True)


# ---------- 点击并计数（已添加调试日志） ----------
@AgentServer.custom_action("ClickAndCount")
class ClickAndCount(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = {}
        if argv.custom_action_param:
            try:
                param = json.loads(argv.custom_action_param)
            except Exception as e:
                print(f"[ClickAndCount] 参数解析失败: {e}")
                return CustomAction.RunResult(success=False)

        template = param.get("template", "")
        plant_name = param.get("name", "default")
        specified_level = param.get("level", None)
        threshold = param.get("threshold", 0.7)
        roi = param.get("roi", None)
        delay = param.get("delay", 0)
        reset_after = param.get("reset_after", 0)
        initial_count = param.get("initial_count", None)
        # 调试日志：打印接收到的 initial_count
        print(f"[ClickAndCount] 调试 - initial_count 原始值: {initial_count}")
        initial_counts = param.get("initial_counts", None)
        force_initial = param.get("force_initial", False)

        # 处理 repeat 参数
        repeat_param = None
        if "repeat" in param:
            try:
                repeat_param = int(param["repeat"])
                if repeat_param < 1:
                    print("[ClickAndCount] repeat 必须 >= 1")
                    return CustomAction.RunResult(success=False)
            except (ValueError, TypeError):
                print("[ClickAndCount] repeat 必须是整数")
                return CustomAction.RunResult(success=False)

        if not template:
            print("[ClickAndCount] 缺少 template 参数")
            return CustomAction.RunResult(success=False)

        # 合并初始化：仅调用一次 _get_plant_state，确保 initial_count 仅作用于 run_counts
        init_level = specified_level if specified_level is not None else 1
        state = _get_plant_state(plant_name, level=init_level,
                                 initial_count=initial_count,
                                 initial_counts=initial_counts)

        level = specified_level if specified_level is not None else state["level"]
        if level not in (1, 2, 3, 4):
            print(f"[ClickAndCount] 无效的阶数 {level}，仅支持 1~4")
            return CustomAction.RunResult(success=False)

        # force_initial 现在只重置运行次数，不修改累计点击次数
        if force_initial and initial_count is not None:
            state["run_counts"][level] = int(initial_count) - 1
            print(f"[ClickAndCount] 强制初始化运行次数：{plant_name} {level}阶={initial_count - 1}")

        # 确定本次点击次数
        if repeat_param is not None:
            actual_repeat = repeat_param
            mode_str = f"手动固定({actual_repeat}次)"
        else:
            run_count = state["run_counts"][level] + 1
            state["run_counts"][level] = run_count
            actual_repeat = run_count
            mode_str = f"自动递增(第{run_count}次运行)"

        try:
            res = context.tasker.controller.resolution
            print(f"[ClickAndCount] 当前截图分辨率: {res[0]}x{res[1]}")
        except:
            pass

        roi_str = f", roi={roi}" if roi else ""
        reset_str = f", 重置阈值={reset_after}" if (reset_after > 0 and repeat_param is None) else ""
        print(f"[ClickAndCount] 准备识别: 植物={plant_name}, 模板={template}, 阶数={level}, 阈值={threshold}, {mode_str}, 实际点击={actual_repeat}次, 延迟={delay}ms{roi_str}{reset_str}")

        recognition_param = {
            "recognition": "TemplateMatch",
            "template": template,
            "threshold": threshold,
        }
        if roi is not None:
            recognition_param["roi"] = roi

        reco = context.run_recognition(
            "click_and_count_recog",
            context.tasker.controller.cached_image,
            {"click_and_count_recog": recognition_param}
        )

        if reco is None:
            print("[ClickAndCount] 识别返回 None")
            return CustomAction.RunResult(success=False)

        print(f"[ClickAndCount] 识别完成，命中状态: {reco.hit}")
        if hasattr(reco, 'results') and reco.results:
            print(f"[ClickAndCount] 候选结果数量: {len(reco.results)}")
            for idx, res in enumerate(reco.results[:5]):
                print(f"  候选{idx}: box={res.box}, score={res.score:.4f}")
        elif reco.best_result:
            print(f"[ClickAndCount] 最佳匹配: score={reco.best_result.score:.3f}, box={reco.best_result.box}")
        else:
            print("[ClickAndCount] 未获取到任何候选结果（请检查资源包是否加载）")

        if not reco.hit:
            return CustomAction.RunResult(success=False)

        box = reco.best_result.box
        x = box[0] + box[2] // 2
        y = box[1] + box[3] // 2

        for i in range(actual_repeat):
            print(f"[ClickAndCount] 第 {i+1}/{actual_repeat} 次点击，坐标: ({x}, {y})")
            context.tasker.controller.post_click(x, y).wait()
            if delay > 0:
                time.sleep(delay / 1000.0)

        state["counts"][level] += actual_repeat
        if specified_level is None:
            state["level"] = level

        print(f"[ClickAndCount] 完成 {actual_repeat} 次点击 {plant_name} {level}阶，该阶累计点击: {state['counts'][level]}次")

        if repeat_param is None and reset_after > 0 and state["run_counts"][level] >= reset_after:
            state["run_counts"][level] = 0
            print(f"[ClickAndCount] {plant_name} {level}阶运行次数已达 {reset_after}，已重置为 0（下次从 1 开始）")

        return CustomAction.RunResult(success=True)


@AgentServer.custom_action("TakeCountScreenshot")
class TakeCountScreenshot(CustomAction):
    # ...（未改动）
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = {}
        if argv.custom_action_param:
            try:
                param = json.loads(argv.custom_action_param)
            except Exception as e:
                print(f"[TakeCountScreenshot] 参数解析失败: {e}")
                return CustomAction.RunResult(success=False)

        folder_name = param.get("name", "default")
        state = _get_plant_state("default")
        counts = state["counts"]
        total = sum(counts.values())
        if total == 0:
            print(f"[TakeCountScreenshot] 尚未点击过，不保存截图")
            return CustomAction.RunResult(success=True)

        folder_path = SCREENSHOT_DIR / folder_name
        folder_path.mkdir(parents=True, exist_ok=True)

        filename = (
            f"一阶{counts[1]}次_"
            f"二阶{counts[2]}次_"
            f"三阶{counts[3]}次_"
            f"四阶{counts[4]}次.png"
        )
        filepath = folder_path / filename

        image = context.tasker.controller.cached_image
        if image is None:
            print("[TakeCountScreenshot] 截图失败：cached_image 为空")
            return CustomAction.RunResult(success=False)

        rgb_image = image[..., ::-1]
        Image.fromarray(rgb_image).save(str(filepath))
        print(f"[TakeCountScreenshot] 截图已保存: {filepath}")
        return CustomAction.RunResult(success=True)


@AgentServer.custom_action("ResetPlantCount")
class ResetPlantCount(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        count = len(_plant_states)
        _plant_states.clear()
        print(f"[ResetPlantCount] 已清空所有植物计数器（含运行次数），共 {count} 条记录")
        return CustomAction.RunResult(success=True)


@AgentServer.custom_action("ResetCounts")
class ResetCounts(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        for plant_name, state in _plant_states.items():
            state["counts"] = {1: 0, 2: 0, 3: 0, 4: 0}
        print(f"[ResetCounts] 已重置所有植物的点击次数，保留运行次数")
        return CustomAction.RunResult(success=True)
    
@AgentServer.custom_action("SaveScreenshot")
class SaveScreenshot(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = json.loads(argv.custom_action_param) if argv.custom_action_param else {}

        # 如果提供了 filename，直接使用（兼容旧用法）
        filename = param.get("filename")
        fmt = param.get("format", "png").lower()
        if fmt not in ("png", "jpg", "jpeg"):
            fmt = "png"

        # 如果未提供 filename，则使用 base_name 自动编号
        if filename is None:
            base_name = param.get("base_name", "screenshot")
            count = _screenshot_counter.get(base_name, 0)
            if count == 0:
                file_name = base_name
            else:
                file_name = f"{base_name}{count}"
            _screenshot_counter[base_name] = count + 1
            file_name = f"{file_name}.{fmt}"
        else:
            if not filename.endswith(f".{fmt}"):
                file_name = f"{filename}.{fmt}"
            else:
                file_name = filename

        # 处理保存路径（支持相对路径自动拼接 ROOT_DIR）
        save_dir = param.get("save_path", "./screenshots")
        save_path = Path(save_dir)
        if not save_path.is_absolute():
            save_path = ROOT_DIR / save_path
        save_path.mkdir(parents=True, exist_ok=True)
        filepath = save_path / file_name

        # 获取截图
        image = context.tasker.controller.cached_image
        if image is None:
            return CustomAction.RunResult(success=False)

        # 保存图片
        rgb_image = image[..., ::-1]  # BGR -> RGB
        Image.fromarray(rgb_image).save(str(filepath))
        print(f"[SaveScreenshot] 已保存: {filepath}")
        return CustomAction.RunResult(success=True)
@AgentServer.custom_action("PasteClipboard")
class PasteClipboard(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        # ---------- 1. 确保 pyperclip 可用 ----------
        try:
            import pyperclip
        except ImportError:
            import subprocess, sys
            print("[PasteClipboard] pyperclip 未安装，正在自动安装...")
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "pyperclip"])
                import pyperclip
                print("[PasteClipboard] pyperclip 安装成功")
            except Exception as e:
                print(f"[PasteClipboard] 自动安装失败: {e}")
                return CustomAction.RunResult(success=False)

        # ---------- 2. 读取剪贴板 ----------
        try:
            text = pyperclip.paste()
        except Exception as e:
            print(f"[PasteClipboard] 读取剪贴板失败: {e}")
            return CustomAction.RunResult(success=False)

        if not text:
            print("[PasteClipboard] 剪贴板为空")
            return CustomAction.RunResult(success=True)

        # ---------- 3. 获取 ADB 信息 ----------
        adb_path = None
        adb_serial = None

        # 3a. 尝试从控制器信息中获取（推荐）
        try:
            ctrl_info = context.tasker.controller.info
            if isinstance(ctrl_info, dict):
                adb_path = ctrl_info.get("adb_path")
                adb_serial = ctrl_info.get("adb_serial")
            else:
                adb_path = getattr(ctrl_info, "adb_path", None)
                adb_serial = getattr(ctrl_info, "adb_serial", None)
        except Exception as e:
            print(f"[PasteClipboard] 从控制器获取 ADB 信息失败: {e}")

        # 3b. 如果失败，尝试从系统 PATH 中查找 adb
        if not adb_path:
            import shutil
            adb_path = shutil.which("adb")
            if not adb_path:
                print("[PasteClipboard] 未找到 adb，请确保 adb 已安装并在 PATH 中")
                return CustomAction.RunResult(success=False)

        # 如果序列号仍未获取，尝试从 adb devices 自动获取（仅当只有一个设备时）
        if not adb_serial:
            import subprocess
            try:
                result = subprocess.run([adb_path, "devices"], capture_output=True, text=True)
                lines = result.stdout.strip().split('\n')[1:]  # 跳过标题
                devices = [line.split('\t')[0] for line in lines if line.strip() and 'device' in line]
                if len(devices) == 1:
                    adb_serial = devices[0]
                    print(f"[PasteClipboard] 自动检测到设备: {adb_serial}")
                elif len(devices) > 1:
                    print("[PasteClipboard] 检测到多个设备，请手动指定序列号")
                    # 这里可以继续执行，但可能出错，由用户自行选择
                else:
                    print("[PasteClipboard] 未检测到已连接的设备")
                    return CustomAction.RunResult(success=False)
            except Exception as e:
                print(f"[PasteClipboard] 自动检测设备失败: {e}")

        # ---------- 4. 转义文本 ----------
        escaped = text.replace('\\', '\\\\').replace('"', '\\"')
        escaped = escaped.replace('\r\n', ' ').replace('\n', ' ')
        if len(escaped) > 3800:
            print(f"[PasteClipboard] 文本过长，截断至 3800 字符")
            escaped = escaped[:3800]

        # ---------- 5. 执行 ADB 命令 ----------
        if adb_serial:
            cmd = f'"{adb_path}" -s {adb_serial} shell input text "{escaped}"'
        else:
            cmd = f'"{adb_path}" shell input text "{escaped}"'
        print(f"[PasteClipboard] 执行命令: {cmd[:200]}...")
        import subprocess
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"[PasteClipboard] 执行失败 (code {result.returncode}): {result.stderr}")
            return CustomAction.RunResult(success=False)
        else:
            print(f"[PasteClipboard] 发送成功，文本长度: {len(text)}")
            return CustomAction.RunResult(success=True)
