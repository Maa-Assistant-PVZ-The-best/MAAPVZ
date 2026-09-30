# -*- coding: utf-8 -*-
"""创意庭院 —— 关卡 ID 的 OCR 提取与输入（CustomAction）。

对应节点
--------
创意庭院_OCRID   -> CreateYardOCRLevelID
    在 roi 内 OCR，把 "关卡ID：and*********" 解析成 "and*********" 存进单例。

创意庭院_InputID -> CreateYardInputLevelID
    从单例取出 ID，用 `input text` 输入到当前输入框。
"""

import json
import re
import shutil
import subprocess
import sys
from typing import Any, Dict, Optional, Tuple

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction

try:
    from maa.pipeline import JRecognitionType, JOCR

    _DIRECT_OCR = True
except Exception:  # 老版本 maafw 没有 run_recognition_direct
    _DIRECT_OCR = False


def _log(msg: str) -> None:
    print(f"[CreateYardID] {msg}", file=sys.stderr, flush=True)


# ===========================================================================
# 进程级单例：跨 CustomAction 保存变量
# ===========================================================================

class LevelIDStore:
    """进程级单例，跨 CustomAction 共享解析结果。

    用法：
        LevelIDStore().set("level_id", "and*********")
        LevelIDStore().get("level_id")
    """

    _instance: Optional["LevelIDStore"] = None
    _values: Dict[str, str] = {}

    def __new__(cls) -> "LevelIDStore":
        if cls._instance is None:
            inst = super().__new__(cls)
            inst._values = {}
            cls._instance = inst
        return cls._instance

    def set(self, key: str, value: str) -> None:
        self._values[key] = value or ""

    def get(self, key: str, default: str = "") -> str:
        return self._values.get(key, default)

    def clear(self, key: Optional[str] = None) -> None:
        if key is None:
            self._values.clear()
        else:
            self._values.pop(key, None)


LEVEL_ID_STORE = LevelIDStore()
DEFAULT_KEY = "level_id"

# "关卡ID：and*********" / "关卡 ID: and*********" / OCR 把 ID 认成 1D、lD 等情况
_LEVEL_ID_RE = re.compile(r"关卡\s*[Iil1]\s*[Dd]\s*[:：=]?\s*([A-Za-z0-9_\-]+)")
_TOKEN_RE = re.compile(r"[A-Za-z0-9_\-]+")


def parse_level_id(text: str, keyword: str = "关卡ID") -> str:
    """从 "关卡ID：and*********" 里取出 "and*********"。

    优先按 "关卡ID" 前缀提取；识别不到时退化为「去掉中文和标点后，
    取第一段带数字的英数字」。
    """
    if not text:
        return ""

    text = str(text).strip()

    if keyword:
        kw = re.escape(keyword).replace(r"\ ", r"\s*")
        m = re.search(kw + r"\s*[:：=]?\s*([A-Za-z0-9_\-]+)", text)
        if m:
            return m.group(1)

    m = _LEVEL_ID_RE.search(text)
    if m:
        return m.group(1)

    tokens = _TOKEN_RE.findall(text)
    for token in tokens:
        if re.search(r"\d", token):
            return token
    return tokens[0] if tokens else ""


def _extract_text(detail) -> str:
    """从 RecognitionDetail（或兼容 dict 形态）里取出 OCR 文本。"""
    if detail is None:
        return ""

    best = getattr(detail, "best_result", None)
    if best is not None:
        text = getattr(best, "text", None)
        if text:
            return str(text).strip()

    if isinstance(detail, dict):
        for key in ("best_result", "best"):
            item = detail.get(key)
            if isinstance(item, dict) and item.get("text"):
                return str(item["text"]).strip()

    for attr in ("text", "detail"):
        value = getattr(detail, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _recognize_text(context: Context, image, roi) -> str:
    """在 roi 内跑一次 OCR，返回识别到的原始文本。"""
    x, y, w, h = (int(v) for v in roi)
    roi_t: Tuple[int, int, int, int] = (x, y, w, h)

    if _DIRECT_OCR and hasattr(context, "run_recognition_direct"):
        try:
            detail = context.run_recognition_direct(
                JRecognitionType.OCR, JOCR(roi=roi_t), image
            )
            text = _extract_text(detail)
            if text:
                return text
        except Exception as e:
            _log(f"run_recognition_direct 失败，改用节点覆盖方式：{e}")

    try:
        detail = context.run_recognition(
            "CreateYardOCRLevelID_OCR",
            image,
            pipeline_override={
                "CreateYardOCRLevelID_OCR": {
                    "recognition": "OCR",
                    "roi": list(roi_t),
                }
            },
        )
        return _extract_text(detail)
    except Exception as e:
        _log(f"OCR 识别失败：{e}")
        return ""


def _parse_param(raw) -> dict:
    """宽松解析 custom_action_param（dict / JSON 串 / 双层 JSON 串 / 空）。"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
            s = s[1:-1]
        for _ in range(2):
            try:
                data = json.loads(s)
            except Exception:
                return {}
            if isinstance(data, dict):
                return data
            if not isinstance(data, str):
                return {}
            s = data
    return {}


# ===========================================================================
# CustomAction：OCR 提取关卡 ID
# ===========================================================================

@AgentServer.custom_action("CreateYardOCRLevelID")
class CreateYardOCRLevelID(CustomAction):
    """在指定 roi 内 OCR，解析出关卡 ID 并存入单例。

    custom_action_param:
        roi:     [x, y, w, h]，默认 [610, 210, 290, 45]
        keyword: 前缀关键字，默认 "关卡ID"
        key:     单例里的变量名，默认 "level_id"
        required: 解析不到时是否判定失败，默认 false
    """

    DEFAULT_ROI = [610, 210, 290, 45]

    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = _parse_param(argv.custom_action_param)

        roi = param.get("roi") or self.DEFAULT_ROI
        if not isinstance(roi, (list, tuple)) or len(roi) != 4:
            _log(f"无效的 roi：{roi!r}，使用默认值 {self.DEFAULT_ROI}")
            roi = self.DEFAULT_ROI

        keyword = str(param.get("keyword") or "关卡ID")
        key = str(param.get("key") or DEFAULT_KEY)
        required = bool(param.get("required", False))

        try:
            image = context.tasker.controller.post_screencap().wait().get()
        except Exception as e:
            _log(f"截图失败：{e}")
            return CustomAction.RunResult(success=False)

        if image is None:
            _log("截图为空，无法 OCR")
            return CustomAction.RunResult(success=False)

        raw_text = _recognize_text(context, image, roi)
        if not raw_text:
            _log(f"roi={list(roi)} 内未识别到文本")
            return CustomAction.RunResult(success=not required)

        level_id = parse_level_id(raw_text, keyword)
        if not level_id:
            _log(f"识别到 {raw_text!r}，但解析不出关卡 ID")
            return CustomAction.RunResult(success=not required)

        LEVEL_ID_STORE.set(key, level_id)
        _log(f"OCR 原文={raw_text!r} -> 解析结果={level_id!r}（已存入单例 [{key}]）")
        return CustomAction.RunResult(success=True)


# ===========================================================================
# CustomAction：用 Shell input text 输入关卡 ID
# ===========================================================================

def _escape_input_text(text: str) -> str:
    """转义 adb shell `input text` 的特殊字符（空格必须写成 %s）。"""
    out = text.replace("\\", "\\\\")
    for ch in "\"'`$&|;<>()*?#~":
        out = out.replace(ch, "\\" + ch)
    return out.replace(" ", "%s")


def _controller_of(context: Context) -> Any:
    """兼容不同版本获取控制器对象。"""
    for path in ("tasker.controller", "controller", "_controller"):
        obj: Any = context
        for part in path.split("."):
            obj = getattr(obj, part, None)
            if obj is None:
                break
        if obj is not None:
            return obj
    return None


def _controller_info(context: Context) -> Dict[str, Any]:
    try:
        info = getattr(_controller_of(context), "info", None)
        return info if isinstance(info, dict) else {}
    except Exception:
        return {}


# run_action 里临时生成的节点名（无需预先存在）
_SHELL_NODE = "CreateYardInputLevelID_Shell"


def _input_text_via_shell_action(context: Context, text: str) -> bool:
    if not hasattr(context, "run_action"):
        return False

    shell_cmd = "input text " + _escape_input_text(text)
    node = _SHELL_NODE
    try:
        detail = context.run_action(
            node,
            pipeline_override={
                node: {
                    "action": {"type": "Shell", "param": {"cmd": shell_cmd}},
                    "next": [],
                }
            },
        )
    except Exception as e:
        _log(f"Shell action 异常：{e}")
        return False

    if detail is None:
        _log("Shell action 节点未能启动")
        return False
    if not detail.success:
        _log("Shell action 执行失败")
        return False

    _log(f"已通过 Shell action 输入：{shell_cmd}")
    return True


def _input_text_via_shell(context: Context, text: str) -> bool:
    """依次尝试：原生 Shell action -> 直接调用 adb。"""
    shell_cmd = "input text " + _escape_input_text(text)

    if _input_text_via_shell_action(context, text):
        return True

    info = _controller_info(context)
    adb_path = info.get("adb_path") or shutil.which("adb")
    if not adb_path:
        _log("未找到 adb，无法输入文本")
        return False

    adb_serial = info.get("adb_serial")
    cmd_line = [adb_path]
    if adb_serial:
        cmd_line += ["-s", adb_serial]
    cmd_line += ["shell", shell_cmd]

    try:
        result = subprocess.run(cmd_line, capture_output=True, text=True)
    except Exception as e:
        _log(f"adb 调用异常：{e}")
        return False

    if result.returncode != 0:
        _log(f"adb 调用失败（code {result.returncode}）：{result.stderr.strip()}")
        return False

    _log(f"已通过 adb 输入：{' '.join(cmd_line)}")
    return True


@AgentServer.custom_action("CreateYardInputLevelID")
class CreateYardInputLevelID(CustomAction):
    """从单例取出关卡 ID，用 Shell `input text` 输入。

    custom_action_param:
        key:  单例里的变量名，默认 "level_id"
        text: 直接指定要输入的文本（填了就忽略单例），默认空
    """

    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        param = _parse_param(argv.custom_action_param)

        key = str(param.get("key") or DEFAULT_KEY)
        text = str(param.get("text") or "").strip()

        if not text:
            text = LEVEL_ID_STORE.get(key, "")
        if not text:
            _log(f"单例 [{key}] 里没有可输入的关卡 ID")
            return CustomAction.RunResult(success=False)

        if _input_text_via_shell(context, text):
            _log(f"输入完成：{text!r}")
            return CustomAction.RunResult(success=True)
        return CustomAction.RunResult(success=False)
