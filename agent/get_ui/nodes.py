# -*- coding: utf-8 -*-
"""
================================================================================
get_ui/nodes.py — 注册层
================================================================================

职责：把 helper.py 的能力【注册】成 MAA pipeline 能引用的节点。

整个文件只注册一个识别节点 "get_ui"——通用定位器（控件树 + 窗口双通道）。
动作不用写：pipeline 原生 Click / Swipe 会自动接住识别返回的位置。

【"注册"到底是怎么回事】
@AgentServer.custom_recognition("get_ui") 这一行叫【装饰器】。
效果：MAA 的 agent 启动时 import 这个模块，装饰器就把下面这个类
登记到 MAA 的名单上，名字是 "get_ui"。之后 pipeline 里写
"custom_recognition": "get_ui" 就能找到它。

【识别节点的契约（就两条）】
  入：MAA 调 analyze(self, context, argv)，argv 里带着当前截图和 pipeline 参数
  出：返回 AnalyzeResult(box=..., detail=...)
      box 给了 (x, y, w, h) → 命中，pipeline 的动作会点这个位置
      box 给了 None        → 没命中，MAA 按 rate_limit 轮询 / timeout 后走下一个

pipeline 里怎么用（嵌套对象写法）：
    "找关闭钮": {
        "recognition": { "type": "Custom", "param": {
            "custom_recognition": "get_ui",
            "custom_recognition_param": { "keyword": "close" } } },
        "action": "Click",
        "rate_limit": 3000
    }
    "找悬浮球（大小还得对得上，否则算没识别到）": {
        "recognition": { "type": "Custom", "param": {
            "custom_recognition": "get_ui",
            "custom_recognition_param": {
                "keyword": "win:GameAssistWindow",
                "size": 70 } } },        // size 单位 = 识别截图（MAA）的像素，720p 项目按 1280x720 量
        "action": "Click"
    }
================================================================================
"""
from __future__ import annotations

import json
from typing import Any

from maa.agent.agent_server import AgentServer          # 注册中心
from maa.custom_recognition import CustomRecognition    # 识别节点的基类（爹）

# 相对导入：点(.)开头 = "和我在同一个包里找"。
# 这行只在"作为包的一部分被 import"时有效（import get_ui.nodes 就是这种），
# 直接 python nodes.py 单跑会报错——单文件调试请用包外的方式导入。
from .helper import (
    _pick_index, _sort_by_area,
    dump_ui_tree, find_topmost, find_window_frames, frame_to_maa, maa_size,
    parse_size_limit, size_ok, to_maa_rect, valid_box,
)

# 允许从 pipeline 透传的"选目标"参数白名单（原样喂给 find_topmost）
_QUERY_KEYS = ("keyword", "clickable", "sort", "index")
# 尺寸限定参数：不进 find_topmost，由 nodes.py 自己先筛一遍（要换算坐标）
_SIZE_KEYS = ("size", "size_tol")


def _parse_params(raw: Any) -> dict[str, Any]:
    """把 pipeline 传进来的参数统一成 dict。

    MAA 传参有两种形态：直接是 dict，或是一段 JSON 字符串，这里都兼容。
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def _size_mismatch_detail(controller, limit: tuple[int, int, int, int],
                          rects: list[Any], image: Any = None) -> dict[str, Any]:
    """尺寸限定把候选全刷掉时，统一生成一份"看得懂"的调试信息。

    里面把候选各自的 MAA 尺寸打出来——照着日志里的数字填 pipeline 的 size 就行，
    不用再去猜"到底该填多少"。
    """
    return {
        "status": "size mismatch" if rects else "not found",
        "size_limit": list(limit),
        "candidate_sizes": [list(maa_size(controller, r, image=image)) for r in rects[:20]],
    }


@AgentServer.custom_recognition("get_ui")
class GetUi(CustomRecognition):
    """通用定位：找匹配控件/窗口，返回它的位置 box。

    pipeline 参数：
      keyword    必填（允许空字符串）。关键词，支持前缀指定通道/字段：
                   "close"     → id/desc/text 三字段任一命中（控件树通道）
                   "id:close"  → 只在 id 里找
                   "desc:跳过" → 只在 desc 里找
                   "text:领取" → 只在 text 里找
                   ""          → ★ 不按文字匹配，全部可点控件都是候选，
                                 配 sort/index 选目标。适用：小米渠道悬浮球这类
                                 "无 id 无文字、但当时屏幕上唯一可点"的控件。
                                 复杂界面慎用（候选=全部可点，选错会误点）。
                   "win:GameAssistWindow" → 【窗口通道】找独立窗口（悬浮球），
                                 走 dumpsys，不经控件树（悬浮球不在树里）
                   "win:Panel:" → 应用宝渠道悬浮球（APPLICATION_PANEL 子窗口）
      clickable  可选，默认 true：只要可点控件（win: 模式下忽略）
      sort       可选，命中多个时按面积排序："min"=小的在前，"max"=大的在前
      index      可选，序号（从 1 开始）：排序后选第几个。
                 不给时——控件树通道选"最上层"，窗口通道选 dumpsys 列表第一个

      size       ★可选，尺寸限定：大小对不上的候选一律当作【没识别到】（box=None）。
                 搞不清屏幕上有几个同名目标、或者怕点到旁边那个大面板时，用它能一票否决。
                 【单位是 MAA 空间的像素 = 识别截图的分辨率，不是设备物理像素】
                 项目设成 720p（1280x720）就按 720p 量：悬浮球约 70x70 → 填 70 或 [70,70]
                 写法：70（正方形）/ [70,70] / "70x70"
                 判定看的是窗口/控件的【原始宽高】：悬浮球半藏在屏幕边缘时
                 （frame=[-52,218][53,323]）也不会因为只剩一窄条而被判掉。
      size_tol   可选，尺寸容差（同单位像素）：不给 = 期望值 ±10%（够容不同密度的手机）；
                 给 3 或 [3,3] = 宽高各上下放宽 3 像素；给 0 = 严丝合缝（一个像素都不许差）。

    悬浮球经典用法（两个同名 GameAssistWindow：小球 vs 底部关闭区）：
      找球：    { "keyword": "win:GameAssistWindow", "sort": "min", "index": 1 }
      找球（更牢·推荐）：{ "keyword": "win:GameAssistWindow", "size": 70 }
                → 大关闭区尺寸对不上，直接被判成"没识别到"，不会误点
      找关闭区：{ "keyword": "win:GameAssistWindow", "sort": "max", "index": 1 }
    小米渠道悬浮球（控件树里唯一可点控件）：
      { "keyword": "", "sort": "min", "index": 1 }
      更牢：{ "keyword": "", "size": 103 }      ← 1920x1080 下实测 154px，720p ≈ 103

    未命中返回 box=None。
    """

    def analyze(self, context, argv: CustomRecognition.AnalyzeArg):
        # ---- 1. 读参数，白名单透传 ----
        params = _parse_params(argv.custom_recognition_param)
        query = {k: params[k] for k in _QUERY_KEYS if k in params}
        keyword = query.get("keyword")
        if keyword is None:                      # 空字符串合法（= 全部可点控件）
            return CustomRecognition.AnalyzeResult(
                box=None, detail={"status": "keyword required"}
            )
        # 尺寸限定：解析成 MAA 空间的尺寸区间；没写 size → None（不限定，老行为）
        size_params = {k: params[k] for k in _SIZE_KEYS if k in params}
        try:
            limit = parse_size_limit(size_params.get("size"), size_params.get("size_tol"))
        except ValueError as exc:
            # 参数写错了就明确报"没识别到"，不静默忽略（否则这道安全门悄悄失效）
            return CustomRecognition.AnalyzeResult(
                box=None, detail={"status": "bad size param", "reason": str(exc)}
            )
        ctrl = context.tasker.controller

        # ---- 2a. 窗口通道：win: 前缀 → dumpsys 找独立窗口（悬浮球）----
        if keyword.startswith("win:"):
            win_kw = keyword[len("win:"):]
            frames_all = find_window_frames(ctrl, win_kw)
            # 尺寸限定要先筛、再排序/取序号——反过来的话 sort/index 会先落在错的目标上
            frames = [f for f in frames_all
                      if size_ok(maa_size(ctrl, f, image=argv.image), limit)]
            _sort_by_area(frames, query.get("sort"))              # 给了 sort 才排
            # 窗口默认拿第一个（dumpsys 顺序 ≈ 层叠序，上层在前）
            frame = _pick_index(frames, query.get("index"),
                                default=(frames[0] if frames else None))
            if frame is None:
                detail = {"status": "not found", "window": win_kw,
                          "found_frames": [list(f) for f in frames]}
                if limit is not None:
                    detail["found_frames"] = [list(f) for f in frames_all]  # 限定前看到的全部
                    detail.update(_size_mismatch_detail(ctrl, limit, frames_all, argv.image))
                return CustomRecognition.AnalyzeResult(box=None, detail=detail)
            box = frame_to_maa(ctrl, frame, image=argv.image)
            # 空结果（宽/高为 0，如隐藏窗口 frame=[0,0][0,0]）视为没识别到，不拿去做点击
            if not valid_box(box):
                return CustomRecognition.AnalyzeResult(
                    box=None, detail={"status": "empty box", "window": win_kw,
                                      "raw_frame": list(frame),
                                      "found_frames": [list(f) for f in frames]}
                )
            detail = {"status": "hit", "window": win_kw,
                      "raw_frame": list(frame), "maa_box": list(box),
                      "found_frames": [list(f) for f in frames]}
            if limit is not None:
                detail["size_limit"] = list(limit)                 # 命中时也留个凭据
                detail["maa_size"] = list(maa_size(ctrl, frame, image=argv.image))
            return CustomRecognition.AnalyzeResult(box=box, detail=detail)

        # ---- 2b. 控件树通道：uiautomator dump 读焦点窗口 ----
        try:
            nodes_all = dump_ui_tree(ctrl)
        except RuntimeError as exc:
            return CustomRecognition.AnalyzeResult(
                box=None, detail={"status": "dump failed", "reason": str(exc)}
            )
        # 同样先按尺寸筛再挑：筛完的池子里选，sort/index 才不会落到不合格的候选上
        nodes = [n for n in nodes_all
                 if size_ok(maa_size(ctrl, n.bounds, image=argv.image), limit)]

        # ---- 3. 挑目标（**query 把 dict 拆成关键字参数喂进去）----
        node = find_topmost(nodes, **query)
        if node is None:
            detail = {"status": "not found", "query": query}
            if limit is not None:
                # 日志里给个提示：把可点候选的尺寸都列出来（最多 20 个）
                hints = [n.bounds for n in nodes_all if n.clickable]
                detail.update(_size_mismatch_detail(ctrl, limit, hints, argv.image))
            return CustomRecognition.AnalyzeResult(box=None, detail=detail)

        # ---- 4. 换算成 MAA 坐标并返回。image=argv.image 是 MAA 递进来的当前截图 ----
        box = to_maa_rect(ctrl, node, image=argv.image)
        # 空结果（宽/高为 0，如 bounds="[0,0][0,0]" 的节点）视为没识别到，不拿去做点击
        if not valid_box(box):
            return CustomRecognition.AnalyzeResult(
                box=None,
                detail={"status": "empty box",
                        "matched_id": node.resource_id,
                        "raw_bounds": list(node.bounds)},
            )
        detail = {                         # ← 调试信息，只进日志，不影响行为
            "status": "hit",
            "matched_id": node.resource_id,
            "desc": node.desc,
            "text": node.text,
            "maa_box": list(box),
        }
        if limit is not None:
            detail["size_limit"] = list(limit)                 # 命中时也留个凭据
            detail["maa_size"] = list(maa_size(ctrl, node.bounds, image=argv.image))
        return CustomRecognition.AnalyzeResult(box=box, detail=detail)
