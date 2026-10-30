# -*- coding: utf-8 -*-
"""创意庭院「分享到抖音」—— 点开关卡卡片并发布（CustomAction）。

Pipeline 做不了这一步的两个原因：
1. 关卡卡片位置不固定（列表里残留「删不掉的幽灵关卡」会打乱顺序），
   只能靠 `create_yard/share.png` 模板（自带「未发布」红章）找到新建的那张。
2. 详情页底部左键在「发布 / 已发布」之间切换，而 OCR 是**包含匹配**，
   `expected: ["发布"]` 会把「已发布」也命中 → 点在灰色按钮上 → 等不到「确定」→ 超时。
   这里用精确等值比较。

流程：等列表刷出卡片 → 点缩略图中心 → 等详情页 → 精确点「发布」→ 清「确定」弹窗（最多 3 次）。

custom_action_param（全部可选）
------------------------------
template     卡片模板，默认 "create_yard/share.png"
card_roi     卡片搜索区域，默认 [340, 140, 740, 220]
publish_roi  详情页底部「发布」按钮区域，默认 [330, 540, 180, 100]
confirm_roi  确认弹窗按钮区域，默认 [480, 450, 340, 130]
threshold    模板阈值，默认 0.8
card_wait    等关卡列表刷出来的秒数，默认 12（关卡退出有黑/白屏过场）
open_wait    点卡片后等详情页出现的秒数，默认 6
confirm_wait 点发布后等「确定」弹窗的秒数，默认 6
"""

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction


def _log(msg: str) -> None:
    print(f"[SharePublish] {msg}", file=sys.stderr, flush=True)


# ===========================================================================
# 参数与结果解析
# ===========================================================================

def _parse_param(raw: Any) -> Dict[str, Any]:
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


def _get(res: Any, name: str) -> Any:
    """同时兼容对象属性与 dict 取值。"""
    if res is None:
        return None
    if isinstance(res, dict):
        return res.get(name)
    return getattr(res, name, None)


def _as_box(value: Any) -> Optional[Tuple[int, int, int, int]]:
    if not value:
        return None
    try:
        x, y, w, h = (int(v) for v in list(value)[:4])
    except Exception:
        return None
    if w <= 0 or h <= 0:
        return None
    return (x, y, w, h)


def _best_box(detail: Any) -> Optional[Tuple[int, int, int, int]]:
    """从 RecognitionDetail 里取最佳结果的框。"""
    best = _get(detail, "best_result")
    box = _as_box(_get(best, "box"))
    if box:
        return box
    # 有些版本 best_result 只给 detail，不外露 box
    return _as_box(_get(detail, "box"))


def _all_results(detail: Any) -> List[Any]:
    """取识别结果列表，优先 filtered_results（已过阈值/期望过滤）。"""
    for attr in ("filtered_results", "all_results", "results"):
        value = _get(detail, attr)
        if value:
            return list(value)
    return []


def _norm(text: Any) -> str:
    """归一化 OCR 文本：去空白、全角转半角。"""
    if text is None:
        return ""
    s = str(text)
    s = s.replace("\u3000", "").replace(" ", "").replace("\t", "").replace("\n", "")
    return s.strip()


def _find_text_box(
    detail: Any, wanted: set, exact: bool = True
) -> Optional[Tuple[Tuple[int, int, int, int], str]]:
    """在识别结果里找期望文本，返回 (框, 原文)。"""
    for item in _all_results(detail):
        text = _norm(_get(item, "text"))
        if not text:
            continue
        matched = text in wanted if exact else any(w in text for w in wanted)
        if not matched:
            continue
        box = _as_box(_get(item, "box"))
        if box:
            return box, str(_get(item, "text") or "")
    return None


# ===========================================================================
# CustomAction：点开关卡卡片 → 发布 → 清确认弹窗
# ===========================================================================

@AgentServer.custom_action("ShareClickLevelPublish")
class ShareClickLevelPublish(CustomAction):
    """在关卡列表里挑「未发布」的 share 卡片，点开并发布。"""

    NAME = "ShareClickLevelPublish"

    # ---- 基础操作 --------------------------------------------------------

    def _shot(self, ctl) -> Any:
        try:
            return ctl.post_screencap().wait().get()
        except Exception as e:  # 截图失败通常意味着控制器断了
            _log(f"截图失败：{e}")
            return None

    def _click(self, ctl, cx: int, cy: int) -> None:
        try:
            ctl.post_click(int(cx), int(cy)).wait()
        except Exception as e:
            _log(f"点击 ({cx},{cy}) 失败：{e}")

    def _match(self, context: Context, image, key: str, template: str,
               roi: List[int], threshold: float):
        return context.run_recognition(
            key, image,
            pipeline_override={
                key: {
                    "recognition": "TemplateMatch",
                    "template": [template],
                    "roi": list(roi),
                    "threshold": threshold,
                }
            },
        )

    def _ocr(self, context: Context, image, key: str, roi: List[int]):
        return context.run_recognition(
            key, image,
            pipeline_override={key: {"recognition": "OCR", "roi": list(roi)}},
        )

    def _texts(self, context: Context, image, key: str, roi: List[int]) -> List[str]:
        detail = self._ocr(context, image, key, roi)
        out = []
        for item in _all_results(detail):
            t = _norm(_get(item, "text"))
            if t:
                out.append(t)
        return out

    def _wait_text(self, context: Context, ctl, key: str, roi: List[int],
                   wanted: set, exact: bool, seconds: float):
        """反复截图 + OCR，直到出现期望文本；返回 (框, 原文) 或 None。"""
        deadline = time.time() + max(0.0, seconds)
        while True:
            image = self._shot(ctl)
            if image is not None:
                detail = self._ocr(context, image, key, roi)
                found = _find_text_box(detail, wanted, exact=exact)
                if found:
                    return found
            if time.time() >= deadline:
                return None
            time.sleep(0.35)

    def _save_debug(self, image, tag: str) -> None:
        """失败时留一张现场图，方便事后定位。"""
        if image is None:
            return
        try:
            import numpy as np
            from PIL import Image

            out_dir = Path("debug/share_publish")
            out_dir.mkdir(parents=True, exist_ok=True)
            arr = np.asarray(image)
            if arr.ndim == 3 and arr.shape[2] >= 3:
                # Maa 给的是 BGR，PIL 要 RGB
                arr = arr[:, :, 2::-1]
            path = out_dir / f"{time.strftime('%Y%m%d-%H%M%S')}_{tag}.png"
            Image.fromarray(arr.astype("uint8")).save(path)
            _log(f"现场图已保存：{path}")
        except Exception as e:
            _log(f"保存现场图失败：{e}")

    # ---- 主流程 ----------------------------------------------------------

    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        p = _parse_param(argv.custom_action_param)

        template = str(p.get("template") or "create_yard/share.png")
        card_roi = p.get("card_roi") or [340, 140, 740, 220]
        publish_roi = p.get("publish_roi") or [330, 540, 180, 100]
        confirm_roi = p.get("confirm_roi") or [480, 450, 340, 130]
        threshold = float(p.get("threshold", 0.8))
        card_wait = float(p.get("card_wait", 12))
        open_wait = float(p.get("open_wait", 6))
        confirm_wait = float(p.get("confirm_wait", 6))

        ctl = context.tasker.controller

        # ---- ① 找「未发布」卡片并点开 -----------------------------------
        # 必须轮询：点完「继续」后游戏会先黑/白屏过场再回列表，只截一张图容易抓到白屏。
        box = None
        deadline = time.time() + card_wait
        image = None
        while True:
            image = self._shot(ctl)
            if image is not None:
                detail = self._match(context, image, f"{self.NAME}_Card", template,
                                     card_roi, threshold)
                box = _best_box(detail)
                if box:
                    break
            if time.time() >= deadline:
                break
            time.sleep(0.5)

        if not box:
            _log(f"{card_wait:g} 秒内列表里一直没出现「未发布」的关卡卡片"
                 f"（模板 {template} 在 roi={list(card_roi)} 阈值 {threshold} 下没命中）"
                 "—— 可能关卡没建成，或卡片已经变成「已发布」")
            self._save_debug(image, "no_card")
            return CustomAction.RunResult(success=False)

        cx, cy = box[0] + box[2] // 2, box[1] + box[3] // 2
        _log(f"卡片 box={box} → 点缩略图中心 ({cx},{cy})")
        self._click(ctl, cx, cy)

        # ---- ② 等详情页出现，读出底部按钮状态 ---------------------------
        state = ""
        deadline = time.time() + open_wait
        while time.time() < deadline:
            time.sleep(0.5)
            img = self._shot(ctl)
            if img is None:
                continue
            # 先看「已发布」，避免「已发布」被当成「发布」
            detail = self._ocr(context, img, f"{self.NAME}_Btn", publish_roi)
            joined = "".join(self._texts(context, img, f"{self.NAME}_Btn", publish_roi))
            if "已发布" in joined:
                state = "已发布"
                break
            if "发布" in joined:
                state = "发布"
                break

        if not state:
            _log(f"点了卡片但 {open_wait:g} 秒内没等到关卡详情页（底部既没有「发布」也没有「已发布」）")
            self._save_debug(self._shot(ctl), "no_detail")
            return CustomAction.RunResult(success=False)

        if state == "已发布":
            _log("关卡详情页显示「已发布」—— 这张卡已经发布过，跳过发布，直接交给后续分享流程")
            return CustomAction.RunResult(success=True)

        # ---- ③ 精确点「发布」（绝不吃「已发布」）------------------------
        img = self._shot(ctl)
        if img is None:
            return CustomAction.RunResult(success=False)
        detail = self._ocr(context, img, f"{self.NAME}_Btn2", publish_roi)
        found = _find_text_box(detail, {"发布"}, exact=True)
        if not found:
            # 可能是显示「已发布」了（并发状态变化），放行交给后续
            joined = "".join(self._texts(context, img, f"{self.NAME}_Btn2", publish_roi))
            if "已发布" in joined:
                _log("复查时按钮已是「已发布」，跳过发布")
                return CustomAction.RunResult(success=True)
            _log(f"没在 roi={list(publish_roi)} 里精确匹配到「发布」文本，实际读到：{joined!r}")
            self._save_debug(img, "no_publish_button")
            return CustomAction.RunResult(success=False)

        pbox, ptext = found
        bx = pbox[0] + pbox[2] // 2
        by = pbox[1] + pbox[3] // 2
        _log(f"点「发布」文本={ptext!r} box={pbox} → ({bx},{by})")
        self._click(ctl, bx, by)

        # ---- ④ 清「确定」弹窗（个数不定，最多 3 次）----------------------
        clicks = 0
        for i in range(3):
            wait = confirm_wait if i == 0 else 3.0
            found = self._wait_text(
                context, ctl, f"{self.NAME}_Confirm{i}", confirm_roi,
                {"确定", "确认", "确定发布"}, exact=True, seconds=wait,
            )
            if not found:
                break
            cbox, ctext = found
            ccx = cbox[0] + cbox[2] // 2
            ccy = cbox[1] + cbox[3] // 2
            _log(f"第 {i + 1} 个确认弹窗，点「{ctext}」box={cbox} → ({ccx},{ccy})")
            self._click(ctl, ccx, ccy)
            clicks += 1
            time.sleep(0.9)

        _log(f"发布动作完成，共点了 {clicks} 个确认弹窗")
        return CustomAction.RunResult(success=True)
