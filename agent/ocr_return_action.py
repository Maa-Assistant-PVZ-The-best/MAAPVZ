import json
import re
import sys
import time
from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.context import Context

# 直接 OCR 能力（用于“识别数字并比较”）。老版本不支持时降级为仅引用节点模式。
try:
    from maa.pipeline import JRecognitionType, JOCR
    _DIRECT_RECO = True
except Exception:
    _DIRECT_RECO = False


@AgentServer.custom_action("returnOCR")
class ReturnOCR(CustomAction):
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        """截图 -> 识别 -> 比较。动作 success = 是否命中/比较成立。

        两种模式（二选一）：
        - 比较模式（识别数字）：custom_action_param 里给 compare（如 "<=900"）和 roi，
          截图后用 OCR 取出 ROI 里的数字，与阈值比较；成立则 success=True。
        - 引用节点模式：给 recognition_name（引用某个节点的识别，含算法/区域），
          运行该节点识别，hit 则 success=True。

        success=False 时节点走 on_error；可用来做“条件判断/分流”。
        """
        if not argv.custom_action_param:
            return CustomAction.RunResult(success=True)

        try:
            param = json.loads(argv.custom_action_param)
        except json.JSONDecodeError:
            return CustomAction.RunResult(success=False)
        if not isinstance(param, dict):
            # 防御：param 被解析成字符串/数组等（说明填错了），返回失败而不是抛异常
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

        if not compare and not recognition_name:
            return CustomAction.RunResult(success=False)

        # ---------- 辅助函数 ----------
        def do_tap(box, hold_seconds=0.0):
            if not box or len(box) != 4:
                return
            x = box[0] + box[2] // 2
            y = box[1] + box[3] // 2
            if hold_seconds > 0:
                context.tasker.controller.post_swipe(x, y, x, y, duration=int(hold_seconds * 1000)).wait()
            else:
                context.tasker.controller.post_click(x, y).wait()

        # ---------- 截图并识别（可带前置按住/点击） ----------
        hit = False
        text = ""
        num = None
        if hold_position and len(hold_position) == 4 and hold_before > 0:
            x = hold_position[0] + hold_position[2] // 2
            y = hold_position[1] + hold_position[3] // 2
            context.tasker.controller.post_touch_down(x, y).wait()
            time.sleep(hold_before)
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param)
            context.tasker.controller.post_touch_up().wait()
            if wait_before > 0:
                time.sleep(wait_before / 1000.0)
        elif click_before:
            do_tap(click_before, 0)
            if wait_before > 0:
                time.sleep(wait_before / 1000.0)
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param)
        else:
            image = context.tasker.controller.post_screencap().wait().get()
            hit, text, num = self._recognize(context, image, param)

        if not hit:
            # 未命中 / 比较不成立：保持安静，动作失败（走 on_error）
            return CustomAction.RunResult(success=False)

        comp = str(num) if num is not None else text
        full_message = f"{return_text}{comp}"
        print(f"info:{full_message}", file=sys.stderr, flush=True)

        if click_target:
            do_tap(click_target, hold_after)

        return CustomAction.RunResult(success=True)

    # ---------- 识别分发 ----------
    def _recognize(self, context, image, param):
        """返回 (hit, text, num)。hit=命中/比较成立；text=识别文字；num=提取到的数字(若为数字比较)。"""
        if param.get("compare"):
            return self._number_compare(context, image, param)
        return self._node_reference(context, image, param)

    def _number_compare(self, context, image, param):
        """识别 ROI 里的数字并比较。compare 形如 '<=900'、'>=100'、'==50'、'!=30'、'>10'、'<200'。"""
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
            num = self._extract_number(text)
        cmp_spec = self._parse_compare(param.get("compare"))
        return (self._do_compare(num, cmp_spec), text, num)

    def _node_reference(self, context, image, param):
        """引用别的节点识别：run_recognition(节点名)，hit 即命中。"""
        name = param.get("recognition_name")
        if not name:
            return (True, "", None)
        try:
            override = {}
            roi = param.get("roi")
            if roi and len(roi) == 4:
                override[name] = {"roi": tuple(int(v) for v in roi)}
            detail = context.run_recognition(name, image, pipeline_override=override)
        except Exception as e:
            print(f"warn:引用识别失败 {name}: {e}", file=sys.stderr, flush=True)
            return (False, "", None)
        hit = bool(detail is not None and detail.hit)
        text = ""
        num = None
        if hit:
            try:
                best = detail.best_result
                if best is not None:
                    text = getattr(best, "text", None) or ""
                    num = self._extract_number(text)
            except Exception:
                pass
        return (hit, text, num)

    # ---------- 数字解析/比较 ----------
    @staticmethod
    def _extract_number(text):
        m = re.search(r'-?\d+(?:\.\d+)?', text or "")
        if not m:
            return None
        s = m.group()
        return float(s) if "." in s else int(s)

    @staticmethod
    def _parse_compare(compare):
        m = re.match(r'^\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$', str(compare or "").strip())
        if not m:
            return None
        return m.group(1), float(m.group(2))

    @staticmethod
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
