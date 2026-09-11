import json
import re
import sys
import time
import threading
from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.custom_recognition import CustomRecognition
from maa.context import Context

# 直接 OCR 能力（用于“识别数字并比较”）。老版本不支持时降级为仅引用节点模式。
try:
    from maa.pipeline import JRecognitionType, JOCR
    _DIRECT_RECO = True
except Exception:
    _DIRECT_RECO = False


# ==================== 共用工具 ====================

_OCR_CACHE = {}          # key -> (timestamp, hit, text, num)
_OCR_CACHE_TTL = 3.0     # 秒


def _parse_param(raw):
    """兼容：dict / 单层 JSON 字符串 / 双层 JSON 字符串。"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        for _ in range(2):
            try:
                parsed = json.loads(raw)
            except Exception:
                return None
            if isinstance(parsed, dict):
                return parsed
            raw = parsed
    return None


def _extract_number(text):
    m = re.search(r'-?\d+(?:\.\d+)?', text or "")
    if not m:
        return None
    s = m.group()
    return float(s) if "." in s else int(s)


def _parse_compare(compare):
    m = re.match(r'^\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$', str(compare or "").strip())
    if not m:
        return None
    return m.group(1), float(m.group(2))


def _do_compare(num, cmp_spec):
    if num is None or cmp_spec is None:
        return False
    op, bound = cmp_spec
    if op == "<":
        return num < bound
    if op == "<=":
        return num <= bound
    if op == ">":
        return num > bound
    if op == ">=":
        return num >= bound
    if op == "==":
        return num == bound
    if op == "!=":
        return num != bound
    return False


def _cache_key(recognition_name, roi=None):
    if roi and len(roi) == 4:
        return f"{recognition_name}|{int(roi[0])},{int(roi[1])},{int(roi[2])},{int(roi[3])}"
    return recognition_name


def _cached_reco(context, image, recognition_name, roi=None, ttl=_OCR_CACHE_TTL):
    """引用节点识别 + 短期缓存。返回 (hit, text, num)。"""
    key = _cache_key(recognition_name, roi)
    now = time.time()
    cached = _OCR_CACHE.get(key)
    if cached and now - cached[0] < ttl:
        return cached[1], cached[2], cached[3]

    try:
        override = {}
        if roi and len(roi) == 4:
            override[recognition_name] = {"roi": tuple(int(v) for v in roi)}
        detail = context.run_recognition(recognition_name, image, pipeline_override=override)
    except Exception as e:
        print(f"warn:引用识别失败 {recognition_name}: {e}", file=sys.stderr, flush=True)
        return (False, "", None)

    hit = bool(detail is not None and detail.hit)
    text = ""
    num = None
    if hit:
        try:
            best = detail.best_result
            if best is not None:
                text = getattr(best, "text", None) or ""
                num = _extract_number(text)
        except Exception:
            pass

    if hit:
        _OCR_CACHE[key] = (now, hit, text, num)
    return (hit, text, num)


# ==================== 旧版：CustomAction ====================

@AgentServer.custom_action("returnOCR")
class ReturnOCR(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        if not argv.custom_action_param:
            return CustomAction.RunResult(success=True)

        param = _parse_param(argv.custom_action_param)
        if not isinstance(param, dict):
            print(f"warn:returnOCR 参数不是 JSON 对象: {param!r}", file=sys.stderr, flush=True)
            return CustomAction.RunResult(success=False)

        return_text = param.get("return_text", "")
        roi = param.get("roi", [])
        hold_position = param.get("hold_position", [])
        hold_before = param.get("hold_before", 0.0)
        click_before = param.get("click_before", [])
        wait_before = param.get("wait_before", 500)
        click_target = param.get("click_target", [])
        hold_after = param.get("hold_after", 0.0)
        compare = param.get("compare", "")
        recognition_name = param.get("recognition_name", "")
        ttl = float(param.get("ttl", _OCR_CACHE_TTL))

        if not compare and not recognition_name:
            return CustomAction.RunResult(success=False)

        def do_tap(box, hold_seconds=0.0):
            if not box or len(box) != 4:
                return
            x = box[0] + box[2] // 2
            y = box[1] + box[3] // 2
            if hold_seconds > 0:
                context.tasker.controller.post_swipe(x, y, x, y, duration=int(hold_seconds * 1000)).wait()
            else:
                context.tasker.controller.post_click(x, y).wait()

        hit = False
        text = ""
        num = None
        if hold_position and len(hold_position) == 4 and hold_before > 0:
            x = hold_position[0] + hold_position[2] // 2
            y = hold_position[1] + hold_position[3] // 2
            context.tasker.controller.post_touch_down(x, y).wait()
            time.sleep(hold_before)
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param, ttl)
            context.tasker.controller.post_touch_up().wait()
            if wait_before > 0:
                time.sleep(wait_before / 1000.0)
        elif click_before:
            do_tap(click_before, 0)
            if wait_before > 0:
                time.sleep(wait_before / 1000.0)
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param, ttl)
        else:
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param, ttl)

        if not hit:
            return CustomAction.RunResult(success=False)

        comp = str(num) if num is not None else text
        full_message = f"{return_text}{comp}"
        print(f"info:{full_message}", file=sys.stderr, flush=True)

        if click_target:
            do_tap(click_target, hold_after)

        return CustomAction.RunResult(success=True)

    def _recognize(self, context, image, param, ttl=_OCR_CACHE_TTL):
        if param.get("compare"):
            return self._number_compare(context, image, param)
        return self._node_reference(context, image, param, ttl)

    def _number_compare(self, context, image, param):
        if not _DIRECT_RECO:
            return (False, "", None)
        roi = param.get("roi")
        roi_t = tuple(int(v) for v in roi) if roi and len(roi) == 4 else (0, 0, 0, 0)
        try:
            ocr = JOCR(roi=roi_t)
            detail = context.run_recognition_direct(JRecognitionType.OCR, ocr, image)
        except Exception as e:
            print(f"warn:识别数字 OCR 失败 {e}", file=sys.stderr, flush=True)
            return (False, "", None)
        text = ""
        num = None
        if detail is not None and detail.hit and detail.best_result is not None:
            text = getattr(detail.best_result, "text", None) or ""
            num = _extract_number(text)
        cmp_spec = _parse_compare(param.get("compare"))
        return (_do_compare(num, cmp_spec), text, num)

    def _node_reference(self, context, image, param, ttl=_OCR_CACHE_TTL):
        name = param.get("recognition_name")
        if not name:
            return (True, "", None)
        roi = param.get("roi")
        hit, text, num = _cached_reco(context, image, name, roi, ttl)
        if param.get("compare"):
            cmp_spec = _parse_compare(param.get("compare"))
            return (_do_compare(num, cmp_spec), text, num)
        return (hit, text, num)

    # 保留原静态方法签名，避免外部引用失效
    _extract_number = staticmethod(_extract_number)
    _parse_compare = staticmethod(_parse_compare)
    _do_compare = staticmethod(_do_compare)


# ==================== 新版：CustomRecognition ====================

@AgentServer.custom_recognition("returnOCRReco")
class ReturnOCRRecognition(CustomRecognition):
    """识别层判断：
       - hit=True  → 本节点成立，走 next 第一个候选
       - hit=False → 本节点不成立，框架自动尝试 next 的下一个候选

    参数（三种模式任选）：
      1) 引用节点 + 数字比较（天数判断）：
         {"recognition_name": "通用_识别天数", "compare": ">=3", "ttl": 3}
      2) 仅引用节点：只要 hit 就成立
         {"recognition_name": "某识别节点"}
      3) 裸 OCR ROI + 数字比较：
         {"roi": [...], "compare": ">=100"}
    """
    def analyze(self, context: Context, argv: CustomRecognition.AnalyzeArg):
        param = _parse_param(argv.custom_recognition_param)
        if not param:
            return CustomRecognition.AnalyzeResult(box=None, detail="no param")

        recognition_name = param.get("recognition_name")
        compare = param.get("compare")
        roi = param.get("roi")
        ttl = float(param.get("ttl", _OCR_CACHE_TTL))

        # 模式 1 / 2：引用节点
        if recognition_name:
            hit, text, num = _cached_reco(context, argv.image, recognition_name, roi, ttl)

            if compare:
                ok = _do_compare(num, _parse_compare(compare))
                if ok:
                    return CustomRecognition.AnalyzeResult(
                        box=(0, 0, 100, 100),
                        detail=f"{recognition_name}={num} {compare}"
                    )
                return CustomRecognition.AnalyzeResult(
                    box=None,
                    detail=f"{recognition_name}={num} not {compare}"
                )

            if hit:
                return CustomRecognition.AnalyzeResult(box=(0, 0, 100, 100), detail=text or "hit")
            return CustomRecognition.AnalyzeResult(box=None, detail="miss")

        # 模式 3：裸 OCR ROI + 比较
        if compare and _DIRECT_RECO:
            roi_t = tuple(int(v) for v in roi) if roi and len(roi) == 4 else (0, 0, 0, 0)
            try:
                ocr = JOCR(roi=roi_t)
                detail = context.run_recognition_direct(JRecognitionType.OCR, ocr, argv.image)
            except Exception as e:
                print(f"warn:returnOCRReco 直接 OCR 失败: {e}", file=sys.stderr, flush=True)
                return CustomRecognition.AnalyzeResult(box=None, detail="ocr fail")

            num = None
            text = ""
            if detail is not None and detail.hit and detail.best_result is not None:
                text = getattr(detail.best_result, "text", "") or ""
                num = _extract_number(text)

            if _do_compare(num, _parse_compare(compare)):
                return CustomRecognition.AnalyzeResult(box=(0, 0, 100, 100), detail=f"{text} ok")
            return CustomRecognition.AnalyzeResult(box=None, detail=f"{text} not {compare}")

        return CustomRecognition.AnalyzeResult(box=None, detail="no mode")


# ==================== 锁存（DayLatch，支持多 key） ====================

_LATCH_LOCK = threading.Lock()
_LATCH = {}   # key -> bool


@AgentServer.custom_recognition("DayLatchCheck")
class DayLatchCheck(CustomRecognition):
    """锁存判断（支持多把锁）：
       - 该 key 已锁 → 直接 hit，不再 OCR
       - 未锁 → OCR 比较，命中则锁定并 hit

       参数：
       {
           "key": "ge3",                           # 锁的标识，默认 "default"
           "recognition_name": "通用_识别天数",
           "compare": ">=3"
       }
    """
    def analyze(self, context, argv):
        param = _parse_param(argv.custom_recognition_param) or {}
        key = param.get("key", "default")
        recognition_name = param.get("recognition_name", "通用_识别天数")
        compare = param.get("compare", ">=3")

        with _LATCH_LOCK:
            if _LATCH.get(key, False):
                return CustomRecognition.AnalyzeResult(
                    box=(0, 0, 100, 100), detail=f"[{key}] locked"
                )

        hit, _text, num = _cached_reco(context, argv.image, recognition_name, None, _OCR_CACHE_TTL)
        if hit and _do_compare(num, _parse_compare(compare)):
            with _LATCH_LOCK:
                _LATCH[key] = True
            print(f"[DayLatch:{key}] 首次命中 {num}，已锁定", file=sys.stderr, flush=True)
            return CustomRecognition.AnalyzeResult(
                box=(0, 0, 100, 100), detail=f"[{key}] first hit {num}"
            )

        return CustomRecognition.AnalyzeResult(
            box=None, detail=f"[{key}] not yet (num={num})"
        )


@AgentServer.custom_action("DayLatchReset")
class DayLatchReset(CustomAction):
    """解锁：
       - 不传 key：清空所有锁
       - 传 key：只清该 key 的锁

       参数：{"key": "ge3"}  或  {}
    """
    def run(self, context, argv):
        param = _parse_param(argv.custom_action_param) or {}
        key = param.get("key")
        with _LATCH_LOCK:
            if key is None:
                _LATCH.clear()
                print("[DayLatch] 已清空所有锁", file=sys.stderr, flush=True)
            else:
                _LATCH[key] = False
                print(f"[DayLatch:{key}] 已重置", file=sys.stderr, flush=True)
        return CustomAction.RunResult(success=True)