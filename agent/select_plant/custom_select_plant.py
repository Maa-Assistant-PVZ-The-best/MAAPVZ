# -*- coding: utf-8 -*-
"""
custom_select_plant.py —— custom 选植物逻辑（MAA CustomAction / CustomRecognition）
====================================================================================

目标界面：PVZ2 720x1280 的「选卡界面」（顶部标题为「选择你的植物」）。玩家给出想要的植物列表，
本逻辑每次滑动识别并查找品质对应的植物卡，找到就点击，然后用「核对roi」的 OCR 名字 + 槽位识别
一起核对是不是对的：对得上就滑回最顶上寻找下一个；对不上就把拿错的植物丢回（点对应槽位）再滑回
最顶重新找。若开启「选卡界面槽位检查」，会先逐个看 1..8 槽是不是已经是对应植物，是就直接结束。

核心机制（对应需求）：
    1. 中英文名：custom 参数是中文，内部会查 植物中英文对照表.md 转成英文名去匹配。
    2. 品质筛选：每个植物都带品质（橙/紫/蓝/绿/白），只在对应品质的 plant_ref_card/<品质>/ 里找模板。
    3. 皮肤/多模板：放在子文件夹里的植物（有 `_newrare_*` 皮肤），命中任意一个模板就算命中。
    4. 对不上就点槽位：寻找第 N 个植物时点错了，就点击第 N 个槽位把拿错的植物放回去，再滑回顶重找。
    5. 保底机制：滑动后连续两帧截图相似（基本没滚动），判定本轮没找到，滑回最顶上重找。
    6. 不足 8 个植物：全部找完后滑回最顶上，把剩余空槽按顺序依次点一遍占位。

实现依赖：
    - maa.agent / maa.custom_action / maa.custom_recognition（MAAPVZ venv 里有）
    - numpy（有）、pillow（有）
    - 刻意不 import cv2（目标 venv 没有 opencv），匹配全部用 numpy/pillow。

移植提醒：
    - 注册方式与 MAAPVZ 的 agent 一致（@AgentServer.custom_recognition / custom_action），
      把本文件 import 进 agent/main.py 即可。
    - 所有路径默认值均可用 custom_action_param / 环境变量覆盖，中文路径已兼容。
"""
import os
import re
import sys
import time

import numpy as np

from maa.agent.agent_server import AgentServer
from maa.custom_action import CustomAction
from maa.custom_recognition import CustomRecognition
from maa.context import Context

try:
    from maa.pipeline import JRecognitionType, JOCR
    _DIRECT_OCR = True
except Exception:
    _DIRECT_OCR = False

import plant_lib as PL
import plant_match as PM


# ===========================================================================
# 工具函数
# ===========================================================================

def _parse_param(raw):
    """兼容 dict / 单层 JSON 字符串 / 双层 JSON 字符串。"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        for _ in range(2):
            try:
                parsed = json_loads(raw)
            except Exception:
                return None
            if isinstance(parsed, dict):
                return parsed
            raw = parsed
    return None


def json_loads(s):
    import json
    return json.loads(s)


def _norm_list(v):
    """把 字符串/列表 规整成 list[str]。"""
    if v is None:
        return []
    if isinstance(v, str):
        return [x.strip() for x in re.split(r"[,，;；|\n]+", v) if x.strip()]
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            s = str(x).strip()
            if s:
                out.append(s)
        return out
    return []


def _noop(*a, **k):
    return None


# ===========================================================================
# PlantMatch —— 自定义识别：在截图中找某植物模板（品质目录 + 多皮肤命中其一）
# ===========================================================================

@AgentServer.custom_recognition("PlantMatch")
class PlantMatch(CustomRecognition):
    """在截图 ROI 内查找某个植物的卡槽模板。

    参数（中文）:
        {
          "plant": "豌豆射手",            // 中文名（或英文名），必填
          "roi": [x, y, w, h],           // 可选，限定搜索区
          "threshold": 0.7,              // 匹配阈值
          "template_dir": "...",         // 可选，plant_ref_card 根目录
          "table_md": "...",             // 可选，中英文对照表
          "scales": [0.9, 1.0, 1.1]      // 可选，多尺度
        }

    hit=True -> box 为最优命中框（整图坐标）；未命中 box=None。
    """
    def analyze(self, context: Context, argv: CustomRecognition.AnalyzeArg):
        param = _parse_param(argv.custom_recognition_param) or {}
        plant = param.get("plant") or param.get("name")
        if not plant:
            return CustomRecognition.AnalyzeResult(box=None, detail="[PlantMatch] 缺少 plant 参数")

        en, quality = PL.resolve(str(plant), param.get("table_md"))
        if not en:
            return CustomRecognition.AnalyzeResult(
                box=None, detail=f"[PlantMatch] 对照表找不到 {plant}")

        tdir = param.get("template_dir") or PL.DEFAULT_TEMPLATE_DIR
        templates = PL.resolve_templates(en, quality, template_dir=tdir,
                                         table_md=param.get("table_md"))
        if not templates:
            return CustomRecognition.AnalyzeResult(
                box=None, detail=f"[PlantMatch] {en} 没有模板")

        roi = param.get("roi")
        threshold = float(param.get("threshold", 0.70))
        scales = param.get("scales")
        hit = PM.find_best(argv.image, templates, roi=roi, threshold=threshold,
                           scales=scales)
        if hit is None:
            return CustomRecognition.AnalyzeResult(
                box=None, detail=f"[PlantMatch] 未命中 {en}")
        return CustomRecognition.AnalyzeResult(
            box=(hit["x"], hit["y"], hit["w"], hit["h"]),
            detail=f"[PlantMatch] {hit['name']} score={hit['score']:.3f}")


# ===========================================================================
# SelectPlants —— 主自定义动作：整段「滑→识别→点→核对→槽位→保底→填充」编排
# ===========================================================================

@AgentServer.custom_action("SelectPlants")
class SelectPlants(CustomAction):
    """在选卡界面按玩家指定列表选取植物。

    参数（中文）:
        {
          "植物列表": ["豌豆射手","向日葵"],        // 必填，按槽位顺序
          "模板目录": "...",                        // 可选
          "对照表":   "...",                        // 可选
          "核对roi":  [347,95,177,61],              // 可选，点卡后核对名字的 OCR 区域
          "槽位roi":  [[x,y,w,h],...8个],            // 可选，每个槽位识别区域；[0,0,0,0]=关闭
          "槽位坐标":  [[x,y],...8个],               // 可选，点错时把植物丢回对应槽的点击点
          "占位坐标":  [[x,y],...8个],               // 可选，不足8个时填充空槽用；缺省取槽位坐标
          "选卡界面槽位检查": true/1/"Yes",           // 可选，先查1..8槽是否已就绪
          "搜索roi":  [x,y,w,h],                     // 可选，植物列表滚动区
          "匹配阈值": 0.70,                          // 可选
          "滑动":  {"begin":[x,y],"end":[x,y],"duration":600},
          "回顶":  {"begin":[x,y],"end":[x,y],"repeat":8,"duration":80},
          "滑动后等待": 300,
          "点击后等待": 900,
          "截图相似阈值": 0.96,       // 单次滑动前后几乎一致才视为“没滚动”
          "保底连续帧": 2,           // 连续多少帧相似判定到达列表尽头
          "最多重试": 6,             // 单个植物最多重试轮次
        }
    """

    # ---- 缺省参数 ----
    DEFAULT_VERIFY_ROI = [347, 95, 177, 61]

    # 8 个槽位的识别 ROI（写死，来自玩家实测选卡界面竖排槽位）
    #   一槽 [4,75,125,86]  二槽 [5,152,126,86]  三槽 [1,219,126,87]  四槽 [3,293,126,86]
    #   五槽 [4,358,125,86] 六槽 [5,429,126,86]  七槽 [3,501,126,86]  八槽 [4,572,126,86]
    # 注意：这里 x 较靠左且每个槽占一个固定竖条，作为「槽位识别核对」的区域。
    DEFAULT_SLOT_ROI = [
        [4, 75, 125, 86],
        [5, 152, 126, 86],
        [1, 219, 126, 87],
        [3, 293, 126, 86],
        [4, 358, 125, 86],
        [5, 429, 126, 86],
        [3, 501, 126, 86],
        [4, 572, 126, 86],
    ]

    # 8 个槽位的「点错取消（丢回）」点击坐标：优先读 agent 下的坐标表 coords.json
    #   coords.json 里键名：种植物_初始化_第一个槽位 ~ 第八个槽位
    #   若读不到（例如未移植 / 未在本工程里跑），回退为用槽位识别 ROI 的中心点。
    COORDS_FILE_DEFAULT = r"D:\maapvz\MAAPVZ\agent\assets\resource\coords.json"
    COORDS_SLOT_KEY = (
        "种植物_初始化_第一个槽位", "种植物_初始化_第二个槽位",
        "种植物_初始化_第三个槽位", "种植物_初始化_第四个槽位",
        "种植物_初始化_第五个槽位", "种植物_初始化_第六个槽位",
        "种植物_初始化_第七个槽位", "种植物_初始化_第八个槽位",
    )

    # 植物列表滚动搜索区（玩家实测选卡界面植物卡列表范围）
    DEFAULT_SEARCH_ROI = [138, 389, 595, 302]
    DEFAULT_SWIPE = {"begin": [215, 587], "end": [215, 200], "duration": 600}
    DEFAULT_BACKTOP = {"begin": [381, 401], "end": [381, 611], "repeat": 30, "duration": 80}

    # 默认填充位置（滑回最顶上后依次快速点击这些坐标占位）
    # 当 custom_action_param 没传「填充位置」时使用。
    DEFAULT_FILL_POSITIONS = [
        [195, 437], [312, 439], [429, 439], [552, 439], [671, 428],
        [180, 507], [299, 504], [415, 505], [539, 502], [655, 505],
        [176, 583], [301, 583], [422, 581], [539, 581], [661, 583],
    ]

    # ------------------------------------------------------------------
    @staticmethod
    def _load_coords_slot_xy(coords_file=None, default_roi=None):
        """从 coords.json 读 8 个槽位点击坐标；失败则回退为识别 ROI 中心点。

        返回 [[x,y] x8] 或 None。
        """
        path = coords_file or SelectPlants.COORDS_FILE_DEFAULT
        try:
            import os
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    data = json_loads(f.read())
                out = []
                for key in SelectPlants.COORDS_SLOT_KEY:
                    v = data.get(key)
                    if isinstance(v, (list, tuple)) and len(v) >= 2:
                        out.append([int(v[0]), int(v[1])])
                    else:
                        return None
                if len(out) == 8:
                    return out
        except Exception as e:
            print(f"[SelectPlants] 读取坐标表失败 {path}: {e}",
                  file=sys.stderr, flush=True)

        # 回退：用识别 ROI 中心点当点击点
        if default_roi:
            roi = default_roi if len(default_roi) == 8 else SelectPlants.DEFAULT_SLOT_ROI
            return [[int(r[0] + r[2] / 2), int(r[1] + r[3] / 2)] for r in roi]
        return None

    # ------------------------------------------------------------------
    def run(self, context: Context, argv: CustomAction.RunArg) -> CustomAction.RunResult:
        try:
            param = _parse_param(argv.custom_action_param) or {}
            plants = _norm_list(param.get("植物列表") or param.get("plants"))
            if not plants:
                print("[SelectPlants] 缺少 植物列表", file=sys.stderr, flush=True)
                return CustomAction.RunResult(success=False)

            tdir = param.get("模板目录") or PL.DEFAULT_TEMPLATE_DIR
            table = param.get("对照表")
            verify_roi = param.get("核对roi") or self.DEFAULT_VERIFY_ROI
            slot_rois = param.get("槽位roi") or self.DEFAULT_SLOT_ROI
            # 槽位坐标：优先用「坐标表」参数指定路径读 coords.json，其次用 槽位坐标 手填，
            # 都没有则用默认坐标表（agent/assets/resource/coords.json），失败回退 ROI 中心。
            coords_file = param.get("槽位坐标表") or param.get("坐标表") \
                or param.get("coords_file")
            slot_xy = param.get("槽位坐标")
            if not slot_xy:
                slot_xy = self._load_coords_slot_xy(coords_file, slot_rois)
            fill_xy = param.get("占位坐标") or slot_xy
            check_slots_first = self._to_bool(param.get(
                "选卡界面槽位检查", False))
            search_roi = param.get("搜索roi") or self.DEFAULT_SEARCH_ROI
            threshold = float(param.get("匹配阈值", 0.70))
            swipe = dict(self.DEFAULT_SWIPE)
            swipe.update(param.get("滑动") or {})
            backtop = dict(self.DEFAULT_BACKTOP)
            backtop.update(param.get("回顶") or {})
            post_swipe_wait = int(param.get("滑动后等待", 300))
            post_click_wait = int(param.get("点击后等待", 900))
            sim_threshold = float(param.get("截图相似阈值", 0.96))
            backoff_frames = int(param.get("保底连续帧", 2))
            max_retry = int(param.get("最多重试", 6))
            # 填充位置：可选。滑回最顶上后，依次快速点击这些坐标占位。
            # 未传「填充位置」时，使用内置默认 DEFAULT_FILL_POSITIONS（玩家实测占位点）。
            fill_positions = param.get("填充位置", None)
            if fill_positions is None:
                fill_positions = list(self.DEFAULT_FILL_POSITIONS)
            fill_click_gap = int(param.get("填充点击间隔", 100))

            # 解析每个目标 -> (中文名, 英文名, 品质, 模板列表, 有效槽位roi)
            targets = []
            for zh in plants:
                en, q = PL.resolve(zh, table)
                if not en:
                    print(f"[SelectPlants] 对照表找不到植物 **{zh}**，跳过",
                          file=sys.stderr, flush=True)
                    continue
                tpls = PL.resolve_templates(en, q, template_dir=tdir, table_md=table)
                if not tpls:
                    print(f"[SelectPlants] **{zh}**({en}) 无模板，跳过",
                          file=sys.stderr, flush=True)
                    continue
                targets.append({
                    "zh": zh, "en": en, "quality": q, "templates": tpls,
                })
            if not targets:
                print("[SelectPlants] 没有可执行的植物", file=sys.stderr, flush=True)
                return CustomAction.RunResult(success=False)

            ctl = context.tasker.controller

            # ---- 槽位状态：-1=跳过/未用 0=未就绪 1=已就绪 ----
            slot_done = [False] * min(8, len(targets))

            # ---- 可选：先在选卡界面检查 1..8 槽是否已是对应植物 ----
            if check_slots_first:
                self._precheck_slots(context, ctl, targets, slot_rois,
                                     threshold, slot_done)

            # ---- 主循环：逐个植物 ----
            for i, tgt in enumerate(targets):
                if i >= 8:
                    break
                if self._stopped(context):
                    return CustomAction.RunResult(success=False)
                # 已被槽位检查确认就绪 -> 跳过
                if slot_done[i]:
                    print(f"[SelectPlants] #{i+1} **{tgt['zh']}** 已在槽位，跳过",
                          file=sys.stderr, flush=True)
                    continue

                placed = self._find_and_place(
                    context, ctl, tgt, i, search_roi, verify_roi,
                    slot_rois[i] if i < len(slot_rois) else None,
                    slot_xy[i] if i < len(slot_xy) else None,
                    backtop, swipe, threshold, post_swipe_wait,
                    post_click_wait, sim_threshold, backoff_frames,
                    max_retry)
                if placed:
                    slot_done[i] = True

            # ---- 占位填充：滑回最顶后填剩余位置 ----
            # ---- 占位填充：滑回最顶后，依次快速点击填充位置 ----
            # 填充位置 = 用户传入的「填充位置」，未传则用内置默认 DEFAULT_FILL_POSITIONS。
            if not fill_positions:
                print("[SelectPlants] 没有可用的填充位置，跳过占位",
                      file=sys.stderr, flush=True)
            else:
                self._do_swipe_backtop(ctl, backtop)
                if self._stopped(context):
                    return CustomAction.RunResult(success=False)
                pts = fill_positions if isinstance(fill_positions, (list, tuple)) else [fill_positions]
                for p in pts:
                    if self._stopped(context):
                        return CustomAction.RunResult(success=False)
                    try:
                        pp = [float(v) for v in p]
                        if len(pp) >= 2:
                            self._click(ctl, int(pp[0]), int(pp[1]))
                            time.sleep(fill_click_gap / 1000.0)
                            print(f"[SelectPlants] 填充位置点击 ({int(pp[0])},{int(pp[1])})",
                                  file=sys.stderr, flush=True)
                        elif len(pp) >= 4:
                            self._click(ctl, int(pp[0] + pp[2] / 2),
                                        int(pp[1] + pp[3] / 2))
                            time.sleep(fill_click_gap / 1000.0)
                    except Exception as e:
                        print(f"[SelectPlants] 填充位置点击异常 {p}: {e}",
                              file=sys.stderr, flush=True)

            print("[SelectPlants] 完成", file=sys.stderr, flush=True)
            return CustomAction.RunResult(success=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[SelectPlants] 异常: {e}", file=sys.stderr, flush=True)
            return CustomAction.RunResult(success=False)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    @staticmethod
    def _to_bool(v):
        if v is None:
            return False
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return bool(v)
        return str(v).strip().lower() in ("yes", "true", "1", "是", "开")

    def _click(self, ctl, x, y):
        try:
            ctl.post_click(int(x), int(y)).wait()
        except Exception as e:
            print(f"[SelectPlants] 点击失败 ({x},{y}): {e}",
                  file=sys.stderr, flush=True)

    def _screen(self, ctl):
        try:
            return ctl.post_screencap().wait().get()
        except Exception as e:
            print(f"[SelectPlants] 截图失败: {e}", file=sys.stderr, flush=True)
            return None

    @staticmethod
    def _stopped(context):
        """协作式停止检查：Maa 任务被关闭时 tasker.running 会变 False，
        长循环应据此尽快退出，避免 python 停不下来。"""
        try:
            t = getattr(context, "tasker", None)
            if t is not None:
                run = getattr(t, "running", None)
                if callable(run):
                    run = run()
                if run is False:
                    return True
        except Exception:
            pass
        return False

    def _do_swipe(self, ctl, swipe, backtop=False):
        begin = swipe["end"] if backtop else swipe["begin"]
        end = swipe["begin"] if backtop else swipe["end"]
        dur = int(swipe.get("duration", 600))
        try:
            ctl.post_swipe(int(begin[0]), int(begin[1]),
                           int(end[0]), int(end[1]),
                           duration=dur).wait()
        except Exception as e:
            print(f"[SelectPlants] 滑动失败: {e}", file=sys.stderr, flush=True)

    def _do_swipe_backtop(self, ctl, backtop):
        # 连续重复上滑直到顶上
        repeat = int(backtop.get("repeat", 8))
        dur = int(backtop.get("duration", 80))
        b = backtop.get("begin", [381, 401])
        e = backtop.get("end", [381, 611])
        for _ in range(repeat):
            try:
                ctl.post_swipe(int(b[0]), int(b[1]), int(e[0]), int(e[1]),
                               duration=dur).wait()
            except Exception as ex:
                print(f"[SelectPlants] 回顶滑动失败: {ex}",
                      file=sys.stderr, flush=True)

    @staticmethod
    def _image_similarity(img_a, img_b):
        """两帧整图相似度 ~1 表示基本一致（用降采样灰度差衡量）。"""
        if img_a is None or img_b is None:
            return 0.0
        if img_a.shape != img_b.shape:
            return 0.0
        # 降采样到约 96x54 再算灰度差
        from PIL import Image
        a = np.asarray(Image.fromarray(img_a).convert("L").resize((96, 54)),
                       dtype=np.float32)
        b = np.asarray(Image.fromarray(img_b).convert("L").resize((96, 54)),
                       dtype=np.float32)
        diff = np.abs(a - b).mean()
        # 平均灰度差 -> 0..255，映射到 0..1 相似（差<=2为相似）
        return max(0.0, 1.0 - diff / 128.0)

    # ---- OCR 取名字（built-in OCR, 免预置节点） ----
    @staticmethod
    def _ocr_roi_text(context, image, roi):
        if not _DIRECT_OCR:
            return ""
        # image 为 numpy 数组，只能用 is None 判断；不做布尔运算
        if image is None or getattr(image, "size", 0) == 0:
            return ""
        if not roi or len(roi) != 4:
            return ""
        try:
            r = tuple(int(v) for v in roi)
            detail = context.run_recognition_direct(
                JRecognitionType.OCR, JOCR(roi=r), image)
            if detail is not None and detail.hit and detail.best_result is not None:
                return (getattr(detail.best_result, "text", None) or "").strip()
        except Exception as e:
            print(f"[SelectPlants] OCR 失败: {e}", file=sys.stderr, flush=True)
        return ""

    # ---- 槽位核对：模板匹配 -> 是否已含目标植物 ----
    @staticmethod
    def _slot_has(img, tgt_templates, slot_roi, threshold):
        if slot_roi is None or len(slot_roi) != 4:
            return False
        if slot_roi[2] <= 0 or slot_roi[3] <= 0:
            return False
        hit = PM.find_best(img, tgt_templates, roi=slot_roi,
                           threshold=threshold)
        return hit is not None

    # ---- 位置否定记忆：判断一个卡位(topleft x,y,w,h)中心是否落在任一已否定框内 ----
    @staticmethod
    def _center_in_any(box, rejected, tol=12):
        """box 中心点是否落在任一 rejected 框(容差 tol px)内。box: [x,y,w,h]"""
        if not rejected:
            return False
        cx = box[0] + box[2] // 2
        cy = box[1] + box[3] // 2
        for rb in rejected:
            rx, ry, rw, rh = rb[0], rb[1], rb[2], rb[3]
            if (rx - tol) <= cx <= (rx + rw + tol) and \
               (ry - tol) <= cy <= (ry + rh + tol):
                return True
        return False

    # ---- 预先检查 1..8 槽 ----
    def _precheck_slots(self, context, ctl, targets, slot_rois, threshold, slot_done):
        img = self._screen(ctl)
        if img is None:
            return
        for i, tgt in enumerate(targets):
            if i >= 8:
                break
            if self._stopped(context):
                return
            sr = slot_rois[i] if i < len(slot_rois) else None
            if self._slot_has(img, tgt["templates"], sr, threshold):
                slot_done[i] = True
                print(f"[SelectPlants] 槽位检查: #{i+1} 已是 **{tgt['zh']}**",
                      file=sys.stderr, flush=True)

    # ---- 关键: 寻找+点击+核对+重试 单个植物 ----
    def _find_and_place(
            self, context, ctl, tgt, slot_index, search_roi, verify_roi,
            slot_roi, slot_xy, backtop, swipe, threshold,
            post_swipe_wait, post_click_wait, sim_threshold,
            backoff_frames, max_retry):
        """返回 True=该槽已正确放入目标植物。"""

        # 顶点重启扫描
        self._do_swipe_backtop(ctl, backtop)

        retry = 0
        identical_run = 0

        # 位置否定记忆：点错/核验失败过一次的卡位坐标框，后续扫描跳过，
        # 避免同一张电能豌豆被反复当成鸭梨选中。
        rejected = []

        while retry <= max_retry:
            if self._stopped(context):
                return False
            # ---- 每次"识别"前先截图当前画面 ----
            img = self._screen(ctl)
            if img is None:
                time.sleep(0.3)
                continue

            # ---- 在这帧里找目标植物：取多个候选，跳过已否定的卡位，避免反复选中同一张电能豌豆 ----
            found = None
            candidates = PM.match_plants(img, tgt["templates"],
                                         roi=search_roi, threshold=threshold,
                                         topk=60)
            # 同一卡位常被多个尺度/皮肤模板命中，按中心粗去重，避免 top 候选被同一位置占满
            seen_centers = set()
            deduped = []
            for cd in candidates:
                key = (round((cd["x"] + cd["w"] / 2) / 18),
                       round((cd["y"] + cd["h"] / 2) / 18))
                if key in seen_centers:
                    continue
                seen_centers.add(key)
                deduped.append(cd)
            for cd in deduped:
                if self._center_in_any(
                        [cd["x"], cd["y"], cd["w"], cd["h"]], rejected):
                    continue
                found = cd
                break
            if found is not None:
                # 点它
                cx = found["x"] + found["w"] // 2
                cy = found["y"] + found["h"] // 2
                print(f"[SelectPlants] #{slot_index+1} 找到 **{tgt['zh']}** "
                      f"({found['name']}, score={found['score']:.3f}) 点击 ({cx},{cy})",
                      file=sys.stderr, flush=True)
                self._click(ctl, cx, cy)
                time.sleep(post_click_wait / 1000.0)

                # ---- 核对：(a) OCR 名字 为主, (b) 槽位识别 仅当 OCR 读不到时兜底 ----
                img2 = self._screen(ctl)
                ocr_text = self._ocr_roi_text(context, img2, verify_roi)
                ocr_hit = self._name_match(ocr_text, tgt)

                # 槽位识别兜底：OCR 读到了字（比如是别的植物名）就直接以名字为准拒绝，
                # 槽位 top-1 匹配很容易在槽区误命中，不能单独让 ok=True。
                ok = ocr_hit
                slot_hit = False
                if ocr_text.strip() == "":
                    # 槽位核对用更高阈值降低误报（threshold+0.1, 封顶0.9）
                    slot_thr = min(0.90, round(threshold + 0.10, 3))
                    slot_hit = self._slot_has(img2, tgt["templates"],
                                              slot_roi, slot_thr)
                    ok = slot_hit
                print(f"[SelectPlants] 核对 #{slot_index+1}: "
                      f"ocr='{ocr_text}' ocr_hit={ocr_hit} slot_hit={slot_hit} -> ok={ok}",
                      file=sys.stderr, flush=True)

                if ok:
                    print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 核对通过",
                          file=sys.stderr, flush=True)
                    # 通过 -> 滑回最顶上，继续下一个
                    self._do_swipe_backtop(ctl, backtop)
                    return True

                # ---- 对不上：否定这个卡位(记录其坐标框)，把拿错的植物丢回对应槽位
                #      然后【继续在当前画面滑动识别】，不滑回最顶上 ----
                if found is not None:
                    rejected.append([found["x"], found["y"],
                                     found["w"], found["h"]])
                print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 核对失败，"
                      f"否定卡位 {rejected[-1] if rejected else None}，"
                      f"取消(点槽位 #{slot_index+1})后继续滑动识别",
                      file=sys.stderr, flush=True)
                if slot_xy is not None and slot_xy and len(slot_xy) >= 2:
                    self._click(ctl, slot_xy[0], slot_xy[1])
                    time.sleep(post_click_wait / 1000.0)
                # 不滑回顶上：continue 后本循环重截当前帧，已被否定的卡位会被跳过，
                # 画面里若还有下一个候选就直接点; 没有则落到下方"滑一步继续"分支。
                retry += 1
                identical_run = 0
                continue

            # ---- 这帧没找到 -> 滑一步继续 ----
            # 保底机制：比较「同一次滑动」前后的帧。只有单次滑动几乎没变化
            # （列表已到尽头/卡住）才判为"没滚动到底"，且需连续 backoff_frames 次。
            # 这样正常滑动时画面明显变化，不会误判。
            img_before = PL.bgr_to_gray(img) if img is not None else None
            self._do_swipe(ctl, swipe)
            time.sleep(post_swipe_wait / 1000.0)
            img_after = self._screen(ctl)   # 滑动后的一帧，作为下一轮识别用
            if img_after is None:
                time.sleep(0.3)
                continue

            if img_before is not None:
                sim = self._gray_sim(img_before, PL.bgr_to_gray(img_after))
                identical_run = identical_run + 1 if sim >= sim_threshold else 0
            else:
                identical_run = 0
            if identical_run >= backoff_frames:
                print(f"[SelectPlants] 保底: 连续 {identical_run} 次滑动无明显变化"
                      f"(sim={sim:.3f})，判断本轮没找到，滑回最顶上重找",
                      file=sys.stderr, flush=True)
                self._do_swipe_backtop(ctl, backtop)
                retry += 1
                identical_run = 0
                img_after = None
                continue

            # 用滑动后的帧继续识别
            img = img_after

            if retry > max_retry:
                break

        print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 达到重试上限，放弃",
              file=sys.stderr, flush=True)
        return False

    @staticmethod
    def _gray_sim(ga, gb):
        if ga is None or gb is None:
            return 0.0
        if ga.shape != gb.shape:
            ga = ga.astype(np.float32).ravel()
            gb = gb.astype(np.float32).ravel()
            n = min(ga.size, gb.size)
            diff = np.abs(ga[:n] - gb[:n]).mean()
        else:
            diff = np.abs(ga - gb).mean()
        return max(0.0, 1.0 - diff / 128.0)

    @staticmethod
    def _name_match(ocr_text, tgt):
        """OCR 文本与目标中文/英文名是否对得上（严格对照）。

        要求去掉空格/标点后与目标名【相等】才算命中，不再做"包含"模糊匹配，
        避免「毒液豌豆射手」被当成「豌豆射手」。
        仅额外宽容"名字后粘等级/星级数字(如 豌豆射手3)"这一种前缀情况。
        """
        if not ocr_text:
            return False

        def norm(s):
            s = re.sub(r"\s+", "", str(s))
            # 去掉常用标点和 OCR 尾部杂物
            s = re.sub(r"[。.;,，；:：！!？?·、\"'“”‘’()（）\[\]【】x×X*+]+", "", s)
            return s

        t = norm(ocr_text).lower()
        zh = norm(tgt["zh"]).lower()
        en = norm(tgt["en"]).lower()

        if zh and t == zh:
            return True
        if en and t == en:
            return True
        # 兼容「名字 + 等级数字」：豌豆射手3 / peashooter3（数字粘在名字后）
        for name in (zh, en):
            if not name:
                continue
            if t.startswith(name):
                tail = t[len(name):]
                if tail and re.fullmatch(r"\d+x?|级|阶", tail):
                    return True
        return False