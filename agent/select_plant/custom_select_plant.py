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
       回顶次数**不写死**：等于「本轮实际下滑了几次 + 3」（见 DEFAULT_BACKTOP 注释）。
    6. 不足 8 个植物：全部找完后滑回最顶上，把剩余空槽按顺序依次点一遍占位。
    7. 可选开关（缺省 = 旧行为，互不影响）：
       - 「无尽局外选卡」：80 选卡模式（无尽局外「选择挑战植物」，无文本界面）。
         一帧内对所有未选植物匹配、命中即点、按名除名，触底回顶重扫；
         隐含不做核对 / 槽位检查 / 占位填充。详见 HANDOFF.md §13.2。
       - 「核对」「占位填充」「槽位上限」「尺度」均可单独关 / 调。

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
from pathlib import Path

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
# ★ OCR 别名表（可扩展）
# ---------------------------------------------------------------------------
#   游戏内 OCR 偶尔会把某些植物名读短/读错（实锤：「瓷砖萝卜」常被读成
#   「瓷砖萝」）。这里登记「正名 -> 可被接受的 OCR 变体」，命中别名 = 命中本体。
#
#   ⚠️ 只有登记在册的植物放宽，其余植物仍然严格相等匹配 —— 别名是逐个
#   审核过的白名单，不是模糊匹配开关。新增植物也按这个格式往下加。
#
#   变体比较前会走和正名一样的规范化（去空格/标点、小写），且兼容
#   「变体 + 等级数字」的尾巴（如「瓷砖萝3」也算命中）。
# ===========================================================================
PLANT_NAME_ALIASES = {
    "瓷砖萝卜": ["瓷砖萝"],
    "黄金蓓蕾": ["黃金蓓蕾"],  # OCR 把「黄」读成繁体「黃」
    "槲寄冰仙子": ["冰仙子"],  # 游戏内短名（用户确认：冰仙子 = 槲寄冰仙子）
}


def register_plant_alias(zh_name, *variants):
    """给某个植物正名追加 OCR 别名（运行期可扩展接口）。"""
    bucket = PLANT_NAME_ALIASES.setdefault(str(zh_name), [])
    for v in variants:
        v = str(v).strip()
        if v and v not in bucket:
            bucket.append(v)


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
# ★ 识别过程日志（2026-11-02 加）
# ---------------------------------------------------------------------------
#   背景（用户反馈）：「现在给的日志只有 OCR 核对那一条，识别过程本身是黑的；
#   局外 80 选卡更是完全没日志」。
#
#   所以这里把**识别过程**逐帧打出来，而不是只打结论：
#       · 这一帧为哪株植物找、在哪个 roi 找、什么阈值什么尺度
#       · 这一帧有几个候选 / 最高分是多少（**低于阈值也打**，才知道差多少）
#       · 被否定的卡位、顺路踩点的记录、滑动相似度、回顶次数
#       · 最后一条汇总：按顺序选中的植物 + 各在第几屏命中 + 耗时
#
#   前缀统一成 [SelectPlants][识别]，导出日志里直接搜这个词就能把
#   「识别过程」和「结论/播报」两类行分开。
#
#   ★ 逐帧日志比较啰嗦（局外 80 选卡一局几百帧），可以用参数
#     「详细日志」（缺省 true）关掉；关掉后只留结论行。
#   ★ 这里刻意**不引入 logging 模块**：本项目全部日志走
#     `print(..., file=sys.stderr, flush=True)`（AGENTS.md 铁律 6），
#     MaaFramework 会把它并进导出日志里，换 logging 反而可能丢在缓冲里。
# ===========================================================================

_VERBOSE = True          # 逐帧明细开关（run() 里按参数重设）

_T_RUN = [0.0]           # 本段运行的开始时刻（time.monotonic()）


def _ilog(msg: str) -> None:
    """识别过程明细日志（逐帧）。关掉「详细日志」后自动静音。"""
    if _VERBOSE:
        print(f"[SelectPlants][识别] {msg}", file=sys.stderr, flush=True)


def _wlog(msg: str) -> None:
    """识别过程的**关键结论**日志（不受「详细日志」开关影响）。"""
    print(f"[SelectPlants][识别] {msg}", file=sys.stderr, flush=True)


def _elapsed() -> str:
    """从 _clock_start() 起算的耗时文本（日志尾巴用）。"""
    if not _T_RUN[0]:
        return ""
    return f"{time.monotonic() - _T_RUN[0]:.1f}s"


def _clock_start() -> None:
    _T_RUN[0] = time.monotonic()


def _fmt_xy(box) -> str:
    """把 [x,y,w,h] / dict 命中框格式化成日志里的「@(中心x,中心y)」。"""
    if box is None:
        return "@(?)"
    if isinstance(box, dict):
        x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    else:
        x, y, w, h = box[0], box[1], box[2], box[3]
    return f"@({int(x + w // 2)},{int(y + h // 2)})"


def _fmt_cands(cands, limit=3) -> str:
    """候选列表 -> 「名字@(x,y):0.912x1.0 | ...」（日志用，最多 limit 个）。"""
    out = []
    for c in (cands or [])[:limit]:
        sc = c.get("scale")
        tag = f"x{sc:g}" if isinstance(sc, (int, float)) else ""
        out.append(f"{c['name']}{_fmt_xy(c)}:{c['score']:.3f}{tag}")
    return " | ".join(out) if out else "（无候选）"


def _fmt_scales(scales) -> str:
    if not scales:
        return "缺省(0.85~1.15)"
    return "[" + ",".join(f"{float(s):g}" for s in scales) + "]"


def _probe_cands(image, templates, roi, scales, topk=3):
    """「不设阈值」的匹配探针：拿这一帧的最高分与候选（日志用）。

    ★ 与 find_best 的区别：find_best 命中不了就返回 None，日志就只剩
      「没找到」三个字 —— 用户没法判断「差 0.01 还是差 0.4」。
      这里把最高分原样拿出来，命中判定由调用方按阈值自己比。
    ★ 计算量与 find_best 完全相同（NCC 相关图整幅都算，阈值只做过滤）。
    """
    if image is None or getattr(image, "size", 0) == 0:
        return []
    try:
        return PM.match_plants(image, templates, roi=roi, threshold=None,
                               scales=scales, topk=topk)
    except Exception as e:                      # pragma: no cover
        print(f"[SelectPlants][识别] 匹配异常: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        return []


# ===========================================================================
# PlantMatch —— 自定义识别：在截图中找某植物模板（品质目录 + 多皮肤命中其一）
# ===========================================================================

# ⚠️ 待删（零引用）：pipe 侧「找某植物模板」的识别入口（品质目录+多皮肤命中其一）；
#    新架构里 SelectPlants 已把识别全部内部化，注册后 pipe/agent 全库零引用。
#    真需要 pipe 直接识别植物时再加回来。〔退役清单 2026-10-25〕
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
          // ---- ★ 编队选择模式（2026-10-23 新增，与选卡互斥，给了就走编队）----
          "编队选择": true,            // 编队界面闭环选择模式
          "目标编队": 2,               // 1-6；白色集合={1,天生白}∪{选中}，
                                       //   核对：目标≠1 看目标变白，目标=1 看只剩 1 白
          "滑动按住": 1500,            // end_hold：滑到终点按住再松，防惯性过冲
          "核对等待": 500,             // 点击后等数字变白再核对

          "植物列表": ["豌豆射手","向日葵"],        // 选卡模式必填，按槽位顺序
          "模板目录": "...",                        // 可选
          "对照表":   "...",                        // 可选
          "核对roi":  [320,95,215,61],              // 可选，点卡后核对名字的 OCR 区域
          "槽位roi":  [[x,y,w,h],...8个],            // 可选，每个槽位识别区域；[0,0,0,0]=关闭
          "槽位坐标":  [[x,y],...8个],               // 可选，点错时把植物丢回对应槽的点击点
          "占位坐标":  [[x,y],...8个],               // 可选，不足8个时填充空槽用；缺省取槽位坐标
          "选卡界面槽位检查": true/1/"Yes",           // 可选，先查1..8槽是否已就绪
          "搜索roi":  [x,y,w,h],                     // 可选，植物列表滚动区
          "匹配阈值": 0.90,                          // 可选（局内缺省 0.90，0.70 太松会认错植物；
                                                     //   局外 80 选卡缺省 0.80，见 ENDLESS_THRESHOLD）
          "滑动":  {"begin":[x,y],"end":[x,y],"duration":600},
          "回顶":  {"begin":[x,y],"end":[x,y],"duration":600},   // 次数=本轮下滑次数+3
          "滑动后等待": 300,
          "点击后等待": 900,
          "截图相似阈值": 0.96,       // 单次滑动前后几乎一致才视为“没滚动”
          "保底连续帧": 2,           // 连续多少帧相似判定到达列表尽头
          "最多重试": 30,            // 核验失败上限（失败即停任务，不再跳过该植物）
          "最多滑动步数": 40,         // ★ 单轮向下扫描最多滑几次（到列表尽头由保底机制判定）

          // ---- 可选开关（缺省 = 旧行为）----
          "无尽局外选卡": false,     // ★ 80 选卡模式：严格按列表顺序逐个选，
                                     //    点完留在当前帧找下一个，没有就直接回顶重扫；
                                     //    隐含不做核对/槽位检查/占位填充，无槽位上限
          "踩点数量": 3,             // 局外选卡：每帧顺带记录后面几个未选植物的屏数
                                     //    （缺省 3；0 = 关掉顺路踩点）
          "回顶额外次数": 10,        // 局外选卡专用：回顶次数 = 本轮下滑次数 + 本值
                                     //    （缺省 10；局内 8 槽仍是 +3，不受影响）
          "核对": true,              // false = 点击即成功，不做 OCR/槽位核对（无文本界面）
          "占位填充": true,          // false = 结尾不做占位填充
          "槽位上限": 8,             // 仅单目标模式：最多处理列表前几个（局外选卡不生效）
          "尺度": [1.0],             // 匹配多尺度；单目标缺省 0.85~1.15，局外选卡缺省 [1.0]
          "局外点击间隔": 150,        // 无尽局外选卡模式每次点击之间的间隔 ms

          "详细日志": true,          // ★ 识别过程逐帧日志（缺省开；关掉只留结论行）
        }
    """

    # ---- 缺省参数 ----
    # 点卡后核对名字的 OCR 区域（顶部名字条）
    # ★ 左边界要留足：之前 x=347 把「暗物质火龙果」的「暗」左边「日」切掉，
    #   OCR 读成「音物质火龙果」（2026-10-03 反馈）。往左放宽到 320、加宽到 215。
    DEFAULT_VERIFY_ROI = [258,100,312,46]

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
    #   ★ 相对 __file__ 推算（install.py 整树拷贝 agent/，两种布局同位）——
    #     千万别写绝对路径（打包后用户机器没有 D:\maapvz）。
    COORDS_FILE_DEFAULT = str(
        Path(__file__).resolve().parent.parent / "assets" / "resource" / "coords.json")
    COORDS_SLOT_KEY = (
        "种植物_初始化_第一个槽位", "种植物_初始化_第二个槽位",
        "种植物_初始化_第三个槽位", "种植物_初始化_第四个槽位",
        "种植物_初始化_第五个槽位", "种植物_初始化_第六个槽位",
        "种植物_初始化_第七个槽位", "种植物_初始化_第八个槽位",
    )

    # 植物列表滚动搜索区（玩家实测选卡界面植物卡列表范围）
    DEFAULT_SEARCH_ROI = [138, 389, 595, 302]
    DEFAULT_SWIPE = {"begin": [215, 587], "end": [215, 200], "duration": 600}

    # ★ 回顶（往上翻回列表最顶）：次数**不再写死**，由「本轮实际下滑了几次 + 3」动态决定。
    #   旧默认值 {"begin":[381,401],"end":[381,611],"repeat":30,"duration":80} 已删除：
    #   repeat=30 是 Python 内部硬编码，每次回顶无条件连刷 30 次（≈2.4s+IPC），
    #   列表短时白刷、列表长时又不够，且和「这次到底滑了几屏」完全脱钩。
    #
    #   注意方向：回顶用**自己这组坐标**（381,401 -> 381,611，往下刷 = 列表往上翻），
    #   ⚠️ 不要图省事复用 DEFAULT_SWIPE 的反向坐标（215,200 -> 215,587），实测有 bug。
    #   duration 缺省 600（旧的 80 是给 30 次连刷用的；次数变成动态后单次滑稳一点更好）。
    #   若参数里显式给了 "回顶":{"repeat":N}，则仍按旧行为固定滑 N 次（兼容旧作业集）。
    DEFAULT_BACKTOP = {"begin": [381, 401], "end": [381, 611], "duration": 100}
    BACKTOP_EXTRA_STEPS = 3   # 回顶次数 = 本轮下滑次数 + 本值（局内 8 槽）
    # ★ 局外 80 选卡的余量单独一档（2026-10-29 用户定：+10，局内仍 +3 不动）。
    #   原因：80 个卡的网格比 8 槽列表长得多，按「本轮下滑 +3」算出的次数在
    #   中途回顶时容易欠一口气 —— 回不到顶，后面「从顶重扫」就是假的。
    ENDLESS_BACKTOP_EXTRA_STEPS = 10

    # ★ 局外 80 选卡的匹配阈值（2026-11-02 用户定：0.80）。
    #   局内 8 槽仍是 0.90（那里有 OCR 名字核对兜底，阈值必须紧）；
    #   局外界面卡牌**没有文字**、也没有核对手段，阈值略松更容易认到，
    #   而且它后面还有「按名除名 + 触底回顶重扫」兜着，误点的代价小。
    #   ⚠️ 只影响「参数里没写 匹配阈值」时的缺省值：
    #     pipe 里显式写了（0601 的 custom_action_param）就以 pipe 为准。
    ENDLESS_THRESHOLD = 0.80

    # 默认填充位置（滑回最顶上后依次快速点击这些坐标占位）
    # 当 custom_action_param 没传「填充位置」时使用。
    DEFAULT_FILL_POSITIONS = [
        [195, 437], [312, 439], [429, 439], [552, 439], [671, 428],
        [180, 507], [299, 504], [415, 505], [539, 502], [655, 505],
        [176, 583], [301, 583], [422, 581], [539, 581], [661, 583],
    ]

    # ==================== 编队选择模式（2026-10-23 新增） ====================
    # 目标界面：选卡屏点「配队」后的编队列表（标题「植物编队」，1-6 号编队）。
    # ★ 识别几何全部继承自已退役的 pipe 节点（识别编队1/2、滑动寻找编队）：
    #   整列 OCR roi = 原「识别编队2」的 [132,125,77,566]。
    #
    # ★ 白色语义（用户 2026-10-23 实测）：
    #   编队1 的数字天生纯白（不是选中态）；其余编号的数字被选中后才变白。
    #   => 白字集合 = {1} ∪ {当前选中}。核对了就靠这个：
    #      目标≠1 -> 目标号得在白色集合里；
    #      目标=1 -> 不走路由短路、无条件多点一次，然后看白色集合
    #                收窄为 {1}（旧选中号变回彩色才算选上）。
    #   白不白用 numpy 直接数近白像素（行框就是 OCR 给的 box），
    #   不再走 pipe 的 color_filter+二次 OCR —— v5 模型下瘦字形「1」会读成
    #   "(cid:)"（2026-10-23 事故），少一层 OCR 少一层脆。
    #
    # ★ 闭环：整列 OCR 找目标号 -> 点击 -> 等 500ms -> 白字核对 ->
    #   不对/找不到 -> 反向滑回顶 -> 重试；滑动带 end_hold=1500 防惯性过冲。
    #   逃逸：目标是 1/2/3 却连续 2 轮看到 6（列表不在顶部）-> 回弹。
    SQUAD_COL_ROI = [132, 125, 77, 566]
    SQUAD_SWIPE = {"begin": [447, 535], "end": [450, 147], "duration": 200}
    SQUAD_BACKTOP = {"begin": [450, 147], "end": [447, 535], "duration": 200}
    SQUAD_END_HOLD = 1500    # 滑到终点按住 1.5s 再松（用户定的值）
    SQUAD_VERIFY_WAIT = 500  # 点击后等数字变白的延迟（用户定的值）
    SQUAD_MAX_RETRY = 10     # 闭环总轮数上限
    SQUAD_MAX_SLIDES = 6     # 6 个编队、视口约 3 行，滑 6 次必到底

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
            # ★ 识别过程日志开关（缺省开）+ 计时起点：一进来就设好，
            #   后面所有分支（编队 / 局外 80 / 局内 8 槽）共用。
            global _VERBOSE
            _VERBOSE = self._to_bool(param.get("详细日志", True))
            _clock_start()
            plants = _norm_list(param.get("植物列表") or param.get("plants"))
            # ★ 植物列表为空 = 「不指定选哪些卡，直接占位填充」。
            #   用途：作业集里某张表没配植物时（例如表2 故意留空测试换阵容），
            #   仍然要清空卡牌后把卡槽填满再开始战斗，而不是直接失败。
            #   所以这里不 return，而是把 targets 留空，跳到下面的「占位填充」。
            fill_only = not plants
            # 无尽局外选卡开关要提前解析：模板目录缺省值按它分流（见下）
            endless_mode = self._to_bool(param.get("无尽局外选卡"))

            # ---- ★ 编队选择模式（与选卡无关，最先分流）----
            #   编队界面闭环选择：识别->点击->白字核对->回弹重试。
            #   参数：{"编队选择": true, "目标编队": 1..6}（由 runtime 注入）。
            if self._to_bool(param.get("编队选择")):
                try:
                    squad_target = int(param.get("目标编队", 0) or 0)
                except Exception:
                    squad_target = 0
                ok = self._run_squad_select(context, squad_target, param)
                return CustomAction.RunResult(success=ok)

            tdir = param.get("模板目录")
            if not tdir:
                # ★ 模板目录缺省按模式自动选：局外 80 选卡用 plant_ref_endless，
                #   单目标 8 槽选卡用 plant_ref_card（都从 plant_lib 的 __file__
                #   相对推算，打包后路径也能对上；pipeline 里不要写绝对路径）。
                tdir = PL.ENDLESS_TEMPLATE_DIR if endless_mode else PL.DEFAULT_TEMPLATE_DIR
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
            # ★ 匹配阈值缺省按模式分流：
            #   局内 8 槽 = 0.90（2026-10-07 改：0.70 太松，0.781 就把
            #   原始坚果墙认成电能豌豆）；
            #   局外 80 选卡 = 0.80（2026-11-02 用户定，见 ENDLESS_THRESHOLD）。
            threshold = float(param.get(
                "匹配阈值",
                self.ENDLESS_THRESHOLD if endless_mode else 0.90))
            swipe = dict(self.DEFAULT_SWIPE)
            swipe.update(param.get("滑动") or {})
            backtop = dict(self.DEFAULT_BACKTOP)
            backtop.update(param.get("回顶") or {})
            post_swipe_wait = int(param.get("滑动后等待", 300))
            post_click_wait = int(param.get("点击后等待", 900))
            sim_threshold = float(param.get("截图相似阈值", 0.96))
            backoff_frames = int(param.get("保底连续帧", 2))
            max_retry = int(param.get("最多重试", 30))     # 核验失败上限（6->30，2026-10-07）
            # ★ 单轮「向下扫描」最多滑几次：和重试轮数解耦。
            #   旧版把两者塞在同一个 retry 计数器里（默认 6），所以一个植物最多只下滑 6 屏，
            #   根本够不到列表深处 —— 那时候是靠 回顶.repeat=30 硬顶着。现在分开：
            #     slide_count 管「这一轮往下滑多远」；
            #     max_retry 管「失败上限」——核验失败按次计，触底反弹【不算失败】
            #     但连续触底 max_retry 次都没进展就放弃（2026-10-03 改）。
            max_slides = int(param.get("最多滑动步数", 40))
            # 填充位置：可选。滑回最顶上后，依次快速点击这些坐标占位。
            # 未传「填充位置」时，使用内置默认 DEFAULT_FILL_POSITIONS（玩家实测占位点）。
            fill_positions = param.get("填充位置", None)
            if fill_positions is None:
                fill_positions = list(self.DEFAULT_FILL_POSITIONS)
            fill_click_gap = int(param.get("填充点击间隔", 100))

            # ---- 可选开关（缺省 = 旧行为；runtime 注入只带「植物列表」，不会撞名）----
            # （无尽局外选卡 已在前面解析 —— 模板目录缺省值按它分流）
            verify = self._to_bool(param.get("核对", True))
            fill_enabled = self._to_bool(param.get("占位填充", True))
            slot_limit = max(1, int(param.get("槽位上限", 8)))
            scales = param.get("尺度") or param.get("scales")
            endless_click_gap = int(param.get("局外点击间隔", 150))

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
                # ★ 识别过程日志：这株植物最终会去哪几个模板、几张（皮肤/多模板）
                _ilog(f"目标 {len(targets)}：**{zh}** -> {en}（品质 {q}，"
                      f"模板 {len(tpls)} 张"
                      f"{'：' + '、'.join(Path(t).name for t in tpls[:4]) if len(tpls) > 1 else ''}"
                      f"{' …' if len(tpls) > 4 else ''}）")
            if not targets and not fill_only:
                print("[SelectPlants] 没有可执行的植物", file=sys.stderr, flush=True)
                return CustomAction.RunResult(success=False)

            ctl = context.tasker.controller

            if fill_only:
                print("[SelectPlants] 植物列表为空 -> 跳过选卡，直接占位填充",
                      file=sys.stderr, flush=True)

            # ---- ★ 识别过程横幅：一次把「用什么几何/阈值/尺度在找」说清楚 ----
            #   用户排查「为什么没认到」第一眼要看的就是这几个值。
            _wlog(f"开始识别：模式="
                  f"{'局外80选卡' if endless_mode else '局内8槽选卡'}，"
                  f"目标 {len(targets)} 株，模板目录={Path(tdir).name}")
            _ilog(f"识别几何：搜索roi={search_roi} 阈值={threshold:.2f} "
                  f"尺度={_fmt_scales(scales)} 滑动={swipe.get('begin')}->{swipe.get('end')}"
                  f"(duration={swipe.get('duration')}) "
                  f"回顶={backtop.get('begin')}->{backtop.get('end')}"
                  f"(duration={backtop.get('duration')})")
            _ilog(f"节奏：滑动后等待={post_swipe_wait}ms 点击后等待={post_click_wait}ms "
                  f"相似阈值={sim_threshold:.2f} 保底连续帧={backoff_frames} "
                  f"最多重试={max_retry} 最多滑动步数={max_slides}")
            if not endless_mode:
                _ilog(f"局内槽位：上限={slot_limit} 核对={'开' if verify else '关'} "
                      f"占位填充={'开' if fill_enabled else '关'} "
                      f"槽位预检查={'开' if check_slots_first else '关'} "
                      f"核对roi={verify_roi}")

            # ---- 无尽局外选卡模式（80 选卡）：一帧多目标，与单目标路径完全分离 ----
            # 隐含：不做核对 / 槽位检查 / 占位填充；触底回顶机制与单目标一致。
            if endless_mode:
                ok = self._run_endless_select(
                    context, ctl, targets, search_roi,
                    swipe, backtop, threshold, scales,
                    post_swipe_wait, endless_click_gap,
                    sim_threshold, backoff_frames,
                    max_retry, max_slides,
                    watch_count=int(param.get("踩点数量", 3)),
                    backtop_extra=int(param.get(
                        "回顶额外次数", self.ENDLESS_BACKTOP_EXTRA_STEPS)))
                return CustomAction.RunResult(success=ok)

            # ---- 槽位状态：-1=跳过/未用 0=未就绪 1=已就绪 ----
            slot_done = [False] * min(slot_limit, len(targets))

            # ---- 可选：先在选卡界面检查 1..8 槽是否已是对应植物 ----
            if check_slots_first:
                self._precheck_slots(context, ctl, targets, slot_rois,
                                     threshold, slot_done, slot_limit, scales)

            # ---- 主循环：逐个植物 ----
            # prev_slides = 上一个植物结束时列表下滑了几屏：本植物先看当前帧，
            # 够不着再按 prev_slides+3 回顶（顺序优化，见 _find_and_place）。
            # seen_depth = 顺路踩点记录：找前面植物时瞄到本植物在第几屏
            #   （屏数 < 当前屏数 -> 它在上方 -> 轮到它先回顶，不往下白滑）。
            prev_slides = 0
            seen_depth = {}
            for i, tgt in enumerate(targets):
                if i >= slot_limit:
                    break
                if self._stopped(context):
                    return CustomAction.RunResult(success=False)
                # 已被槽位检查确认就绪 -> 跳过
                if slot_done[i]:
                    print(f"[SelectPlants] #{i+1} **{tgt['zh']}** 已在槽位，跳过",
                          file=sys.stderr, flush=True)
                    continue

                # ★ 踩点命中且在上方 -> 先回顶（它在上面，往下滑是纯浪费）
                if i in seen_depth:
                    d = seen_depth.pop(i)
                    if d < prev_slides:
                        print(f"[SelectPlants] #{i+1} **{tgt['zh']}** "
                              f"之前在第 {d} 屏出现过（当前在第 {prev_slides} 屏）"
                              f"-> 先回顶再找", file=sys.stderr, flush=True)
                        self._do_swipe_backtop(ctl, backtop, prev_slides)
                        prev_slides = 0
                        time.sleep(post_swipe_wait / 1000.0)

                # 顺路踩点对象：盯「后面 3 个还没选的植物」
                # （2026-10-07 只盯下一个 -> 2026-10-25 改盯下 3 个：
                #   用户实测只盯 1 个会漏 —— 模板一晃没认出来就没踩到点，
                #   轮到它时丢「先回顶」提示白滑很多屏；
                #   盯 3 个每帧多 3 次模板匹配，开销仍可忽略）。
                watch_targets = []
                for j in range(i + 1, min(len(targets), slot_limit)):
                    if not slot_done[j]:
                        watch_targets.append({"idx": j, "zh": targets[j]["zh"],
                                              "templates": targets[j]["templates"]})
                        if len(watch_targets) >= 3:
                            break

                placed, prev_slides = self._find_and_place(
                    context, ctl, tgt, i, search_roi, verify_roi,
                    slot_rois[i] if i < len(slot_rois) else None,
                    slot_xy[i] if i < len(slot_xy) else None,
                    backtop, swipe, threshold, post_swipe_wait,
                    post_click_wait, sim_threshold, backoff_frames,
                    max_retry, max_slides, verify, scales,
                    start_slide_count=prev_slides,
                    watch_targets=watch_targets, watch_seen=seen_depth)
                if placed:
                    slot_done[i] = True
                else:
                    # ★ 核验失败（放弃）= 直接停止任务（2026-10-07 改）：
                    #   拿错植物硬打还不如立刻失败，让用户去查原因。
                    print(f"[SelectPlants] #{i+1} **{tgt['zh']}** 核验失败放弃，"
                          f"直接停止任务", file=sys.stderr, flush=True)
                    return CustomAction.RunResult(success=False)

            # ---- 占位填充：滑回最顶后填剩余位置 ----
            # ---- 占位填充：滑回最顶后，依次快速点击填充位置 ----
            # 填充位置 = 用户传入的「填充位置」，未传则用内置默认 DEFAULT_FILL_POSITIONS。
            if not fill_enabled:
                print("[SelectPlants] 占位填充已关闭，跳过",
                      file=sys.stderr, flush=True)
            elif not fill_positions:
                print("[SelectPlants] 没有可用的填充位置，跳过占位",
                      file=sys.stderr, flush=True)
            else:
                # 填充前要回到列表最顶：按最后一个植物的下滑屏数回顶
                _ilog(f"占位填充：先按第 {prev_slides} 屏回顶，再依次点 "
                      f"{len(fill_positions) if isinstance(fill_positions, (list, tuple)) else 1} 个填充点")
                self._do_swipe_backtop(ctl, backtop, prev_slides)
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
            _wlog(f"局内选卡汇总：目标 {len(targets)} 株，"
                  f"就绪 {sum(1 for d in slot_done if d)} 个槽，耗时 {_elapsed()}")
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
        """协作式停止检查：Maa 任务被关闭时 tasker 进入 stopping
        （running 要等当前 action 返回才变 False——停止期间它仍是 True，
        只查 running 会眼睁睁看着长循环继续跑，所以两个都要查）。

        观测到停止时顺手通知 exit_watchdog：action 运行期间是唯一可靠的
        停止观测点（action 外句柄即被回收）；VSCode 宿主下它会安排进程退出，
        桌面端复用进程则无视。
        """
        try:
            t = getattr(context, "tasker", None)
            if t is None:
                return False
            stopped = False
            for attr in ("stopping", "running"):
                v = getattr(t, attr, None)
                if callable(v):
                    v = v()
                # stopping=True 或 running=False 都算停
                if (attr == "stopping" and v is True) or (attr == "running" and v is False):
                    stopped = True
                    break
            if stopped:
                try:
                    import exit_watchdog
                    exit_watchdog.on_task_stopped()
                except Exception:
                    pass
            return stopped
        except Exception:
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

    def _do_swipe_backtop(self, ctl, backtop, steps=None, extra=None):
        """回顶：把植物列表往上翻回最顶端。

        ★ 次数是**动态**的：steps = 本轮实际往下滑了几次 -> 回顶 steps + extra 次。
          extra 缺省 = BACKTOP_EXTRA_STEPS(3)（局内 8 槽）；局外 80 选卡传
          ENDLESS_BACKTOP_EXTRA_STEPS(10) —— 80 个卡的网格更长、回顶更容易欠，
          3 次不够（2026-10-29 用户定：局外 +10，局内保持 +3 不变）。
          传 steps=None（还没滑过 / 独立调用）时按 0+extra 次刷，保证至少翻得到顶。

        兼容：参数里显式给了 回顶.repeat 时，仍按固定次数滑（老作业集行为不变）。

        方向：用 backtop 自己的 begin/end（381,401 -> 381,611），
              ⚠️ 不要改成滑动的反向坐标，实测有 bug。
        """
        b = backtop.get("begin", self.DEFAULT_BACKTOP["begin"])
        e = backtop.get("end", self.DEFAULT_BACKTOP["end"])
        dur = int(backtop.get("duration", self.DEFAULT_BACKTOP["duration"]))
        extra = self.BACKTOP_EXTRA_STEPS if extra is None else int(extra)

        forced = backtop.get("repeat")
        if forced is not None:
            # 旧写法：显式 repeat -> 固定次数（兼容）
            repeat = max(1, int(forced))
            why = f"固定 {repeat} 次(参数指定 repeat)"
        else:
            # 动态：本轮下滑 N 次 -> 回顶 N+extra 次
            repeat = max(1, int(steps or 0) + extra)
            why = f"本轮下滑 {int(steps or 0)} 次 + {extra}"

        for _ in range(repeat):
            try:
                ctl.post_swipe(int(b[0]), int(b[1]), int(e[0]), int(e[1]),
                               duration=dur).wait()
            except Exception as ex:
                print(f"[SelectPlants] 回顶滑动失败: {ex}",
                      file=sys.stderr, flush=True)
        print(f"[SelectPlants] 回顶: 上滑 {repeat} 次 ({why})",
              file=sys.stderr, flush=True)
        return repeat

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
    # ★ 现在主流程都走 _slot_score（要报最高分），本函数保留为语义封装，
    #   内部统一委托给它 —— 两个判据不会各写一份、不会漂移。
    @staticmethod
    def _slot_has(img, tgt_templates, slot_roi, threshold, scales=None):
        if slot_roi is None or len(slot_roi) != 4:
            return False
        if slot_roi[2] <= 0 or slot_roi[3] <= 0:
            return False
        return SelectPlants._slot_score(
            img, tgt_templates, slot_roi, scales=scales) >= threshold

    @staticmethod
    def _slot_score(img, tgt_templates, slot_roi, scales=None):
        """槽位区里的**最高分**（不设阈值，日志用）—— 0.0 表示没算成。

        ★ 和 _slot_has 的区别只有「过不过滤阈值」：报告「最高分 0.887
          （阈值 0.90）」比「没命中」有用得多。
        """
        if slot_roi is None or len(slot_roi) != 4:
            return 0.0
        if slot_roi[2] <= 0 or slot_roi[3] <= 0:
            return 0.0
        cands = _probe_cands(img, tgt_templates, slot_roi, scales, topk=1)
        return cands[0]["score"] if cands else 0.0

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

    # ---- 预先检查 1..N 槽 ----
    def _precheck_slots(self, context, ctl, targets, slot_rois, threshold,
                        slot_done, slot_limit=8, scales=None):
        img = self._screen(ctl)
        if img is None:
            return
        _ilog(f"槽位预检查：一帧截图里逐个比 1..{min(slot_limit, len(targets))} 槽"
              f"（阈值 {threshold:.2f}，尺度 {_fmt_scales(scales)}）")
        for i, tgt in enumerate(targets):
            if i >= slot_limit:
                break
            if self._stopped(context):
                return
            sr = slot_rois[i] if i < len(slot_rois) else None
            # 识别过程日志：每槽都打最高分，认不到才知道差多少
            score = self._slot_score(img, tgt["templates"], sr, scales=scales)
            hit = score >= threshold
            _ilog(f"  槽{i+1}（roi={sr}）**{tgt['zh']}** 最高分 {score:.3f}"
                  f"（阈值 {threshold:.2f}）-> {'已就绪' if hit else '未就绪'}")
            if hit:
                slot_done[i] = True
                print(f"[SelectPlants] 槽位检查: #{i+1} 已是 **{tgt['zh']}**",
                      file=sys.stderr, flush=True)

    # ---- 关键: 寻找+点击+核对+重试 单个植物 ----
    def _find_and_place(
            self, context, ctl, tgt, slot_index, search_roi, verify_roi,
            slot_roi, slot_xy, backtop, swipe, threshold,
            post_swipe_wait, post_click_wait, sim_threshold,
            backoff_frames, max_retry, max_slides, verify=True, scales=None,
            start_slide_count=0, watch_targets=None, watch_seen=None):
        """返回 (该槽是否已正确放入目标植物, 本植物结束时累计下滑屏数)。

        三个计数器分工（2026-10-03 改版）：
            slide_count —— 本轮已经往下滑了几次；回顶次数 = slide_count + 3。
            retry       —— 核验失败次数（拿错植物丢回，才算一次失败）。
            bounce_run  —— 连续触底反弹次数；【触底反弹不算失败】，
                           任何一次点击（选中/拿错）都把它清零，
                           连续 max_retry 次触底都没进展才放弃。

        ★ 顺序优化（2026-10）：放完一个不回顶，下一个进场先看当前帧；
          当前帧没有也【不回顶】，顺势往下滑，触底才反弹（2026-10-03 改）。
          slide_count 沿上一棒的屏数继续累计，反弹时回顶次数才准确。

        ★ 顺路踩点（2026-10-07 加）：找当前植物的每一帧，顺带识别后面还没选的
          植物（watch_targets），识别到就记一笔「它在第几屏出现过」
          （watch_seen[idx] = 屏数），不点它。轮到它时若记录屏数 < 当前屏数，
          说明它在上方，先回顶再找，不再往下白滑。

        verify=False 时点击即视为成功（无文本界面，无法核对）。
        """
        max_slides = max(1, int(max_slides))

        # 当前帧优先 + 顺势下滑：不再有「进场先回顶」，上一棒滑到哪就从哪继续
        slide_count = max(0, int(start_slide_count or 0))

        retry = 0
        bounce_run = 0
        identical_run = 0

        # 位置否定记忆：点错/核验失败过一次的卡位坐标框，后续扫描跳过，
        # 避免同一张电能豌豆被反复当成鸭梨选中。
        rejected = []

        # ★ 核验失败时读到过的 OCR 文本（放弃时汇总打出，方便加别名）
        ocr_seen = []

        if watch_targets is None:
            watch_targets = []

        # ★ 识别过程日志：逐帧计数器（日志里「帧N/屏M」就是这两个）
        frame = 0
        best_score = 0.0        # 最近一帧的最高分（放弃时汇总用）
        _ilog(f"#{slot_index+1} **{tgt['zh']}** 开始查找：模板 {len(tgt['templates'])} 张，"
              f"阈值 {threshold:.2f}，尺度 {_fmt_scales(scales)}，"
              f"从第 {slide_count} 屏开始，踩点对象 "
              f"{[w['zh'] for w in watch_targets] or '（无）'}")

        while retry <= max_retry and bounce_run < max_retry:
            if self._stopped(context):
                return False, slide_count
            # ---- 每次"识别"前先截图当前画面 ----
            img = self._screen(ctl)
            if img is None:
                time.sleep(0.3)
                continue
            frame += 1

            # ---- 顺路踩点：这帧里顺便看看后面没选的植物在不在（只记不点）----
            if watch_targets and watch_seen is not None:
                for wt in watch_targets:
                    if wt["idx"] in watch_seen:
                        continue     # 已踩过点，省一次匹配
                    hit = PM.find_best(img, wt["templates"], roi=search_roi,
                                       threshold=threshold, scales=scales)
                    if hit is not None:
                        watch_seen[wt["idx"]] = slide_count
                        print(f"[SelectPlants] 踩点: #{wt['idx']+1} "
                              f"**{wt['zh']}** 在第 {slide_count} 屏出现过"
                              f"（先记下，轮到它时少滑几屏）",
                              file=sys.stderr, flush=True)
                        _ilog(f"  踩点命中 #{wt['idx']+1} {wt['zh']} "
                              f"score={hit['score']:.3f}{_fmt_xy(hit)}"
                              f"（阈值 {threshold:.2f}）")

            # ---- 在这帧里找目标植物：取多个候选，跳过已否定的卡位，避免反复选中同一张电能豌豆 ----
            # ★ 探针用 threshold=None：这样即使一个都没过阈值，也能把「最高分」
            #   打出来（差 0.02 和差 0.40 是两种完全不同的故障）。
            found = None
            probed = _probe_cands(img, tgt["templates"], search_roi, scales, topk=60)
            best_score = probed[0]["score"] if probed else 0.0
            candidates = [c for c in probed if c["score"] >= threshold]
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
            _ilog(f"#{slot_index+1} 帧{frame} 屏{slide_count}："
                  f"候选 {len(candidates)} 个（去重 {len(deduped)}，"
                  f"已否定 {len(rejected)}）最高 {best_score:.3f}"
                  f"（阈值 {threshold:.2f}{'，过阈值' if best_score >= threshold else '，未过阈值'}）"
                  f" 最佳={_fmt_cands(candidates, 2)}"
                  f"{'，可用→点击' if found is not None else ('，全被否定' if deduped else '，无可点候选')}")
            if found is not None:
                # 点它
                cx = found["x"] + found["w"] // 2
                cy = found["y"] + found["h"] // 2
                print(f"[SelectPlants] #{slot_index+1} 找到 **{tgt['zh']}** "
                      f"({found['name']}, score={found['score']:.3f}) 点击 ({cx},{cy})",
                      file=sys.stderr, flush=True)
                self._click(ctl, cx, cy)
                time.sleep(post_click_wait / 1000.0)
                bounce_run = 0          # 有进展（点到东西了）-> 连续触底清零

                # ---- 核对关闭：点击即成功（无文本界面，无核对手段）----
                if not verify:
                    print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** "
                          f"核对已关闭，点击即通过",
                          file=sys.stderr, flush=True)
                    # ★ 成功后不回顶：下一个植物先看当前帧，够不着再自己回顶
                    return True, slide_count

                # ---- 核对：(a) OCR 名字 为主, (b) 槽位识别 仅当 OCR 读不到时兜底 ----
                img2 = self._screen(ctl)
                ocr_text = self._ocr_roi_text(context, img2, verify_roi)
                ocr_hit = self._name_match(ocr_text, tgt)

                # 槽位识别兜底：OCR 读到了字（比如是别的植物名）就直接以名字为准拒绝，
                # 槽位 top-1 匹配很容易在槽区误命中，不能单独让 ok=True。
                ok = ocr_hit
                slot_hit = False
                slot_thr = min(0.90, round(threshold + 0.10, 3))
                slot_score = 0.0
                if ocr_text.strip() == "":
                    # 槽位核对用更高阈值降低误报（threshold+0.1, 封顶0.9）
                    slot_score = self._slot_score(img2, tgt["templates"],
                                                  slot_roi, scales=scales)
                    slot_hit = slot_score >= slot_thr
                    ok = slot_hit
                print(f"[SelectPlants] 核对 #{slot_index+1}: "
                      f"ocr='{ocr_text}' ocr_hit={ocr_hit} slot_hit={slot_hit} -> ok={ok}",
                      file=sys.stderr, flush=True)
                _ilog(f"  核对明细：OCR文本='{ocr_text}'（roi={verify_roi}）"
                      f"名字匹配={ocr_hit}；槽位识别最高分={slot_score:.3f}"
                      f"（阈值 {slot_thr:.2f}）"
                      f"{'未走槽位判定（OCR 读到字，以名字为准）' if ocr_text.strip() else ''}")

                if ok:
                    print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 核对通过",
                          file=sys.stderr, flush=True)
                    # ★ 成功后不回顶：下一个植物先看当前帧，够不着再自己回顶
                    return True, slide_count

                # ---- 对不上：否定这个卡位(记录其坐标框)，把拿错的植物丢回对应槽位
                #      然后【继续在当前画面滑动识别】，不滑回最顶上 ----
                if found is not None:
                    rejected.append([found["x"], found["y"],
                                     found["w"], found["h"]])
                if ocr_text.strip() and ocr_text not in ocr_seen:
                    ocr_seen.append(ocr_text)
                print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 核对失败，"
                      f"否定卡位 {rejected[-1] if rejected else None}，"
                      f"取消(点槽位 #{slot_index+1})后继续滑动识别",
                      file=sys.stderr, flush=True)
                if slot_xy is not None and slot_xy and len(slot_xy) >= 2:
                    self._click(ctl, slot_xy[0], slot_xy[1])
                    time.sleep(post_click_wait / 1000.0)
                # 不滑回顶上：continue 后本循环重截当前帧，已被否定的卡位会被跳过，
                # 画面里若还有下一个候选就直接点; 没有则落到下方"滑一步继续"分支。
                retry += 1            # ★ 只有核验失败才算失败次数
                bounce_run = 0        # 有进展（点到过东西）-> 连续触底清零
                identical_run = 0
                continue

            # ---- 这帧没找到 -> 滑一步继续 ----
            # 保底机制：比较「同一次滑动」前后的帧。只有单次滑动几乎没变化
            # （列表已到尽头/卡住）才判为"没滚动到底"，且需连续 backoff_frames 次。
            # 这样正常滑动时画面明显变化，不会误判。
            img_before = PL.bgr_to_gray(img) if img is not None else None
            _ilog(f"#{slot_index+1} 帧{frame} 未命中 -> 下滑 1 步"
                  f"（屏 {slide_count}->{slide_count + 1}）")
            self._do_swipe(ctl, swipe)
            slide_count += 1          # ★ 记下这一轮到底滑了几屏，回顶次数由它决定
            time.sleep(post_swipe_wait / 1000.0)
            img_after = self._screen(ctl)   # 滑动后的一帧，作为下一轮识别用
            if img_after is None:
                time.sleep(0.3)
                continue

            if img_before is not None:
                sim = self._gray_sim(img_before, PL.bgr_to_gray(img_after))
                identical_run = identical_run + 1 if sim >= sim_threshold else 0
                # ★ 相似度是「到底没到底」的唯一依据，逐帧打出来
                _ilog(f"  滑动后相似度 {sim:.3f}"
                      f"（阈值 {sim_threshold:.2f}，连续『没动静』"
                      f" {identical_run}/{backoff_frames}）")
            else:
                identical_run = 0
                _ilog("  滑动前帧为空，本步不参与『到底』判定")

            # 判「到底」的两条路：
            #   a) 连续 backoff_frames 次滑动画面无变化 -> 列表已到尽头
            #   b) 滑动步数达到上限 -> 兜底，防止搜索区不滚动时无限滑下去
            reached_end = identical_run >= backoff_frames
            too_many = slide_count >= max_slides
            if reached_end or too_many:
                if reached_end:
                    print(f"[SelectPlants] 保底: 连续 {identical_run} 次滑动无明显变化"
                          f"(sim={sim:.3f})，判断本轮没找到，滑回最顶上重找",
                          file=sys.stderr, flush=True)
                else:
                    print(f"[SelectPlants] 本轮已下滑 {slide_count} 次(上限 {max_slides})，"
                          f"滑回最顶上重扫", file=sys.stderr, flush=True)
                self._do_swipe_backtop(ctl, backtop, slide_count)
                # ★ 触底反弹不算失败次数，只累计「连续」触底；
                #   点到任何东西（选中/拿错）都会把它清零
                bounce_run += 1
                print(f"[SelectPlants] 触底反弹（连续 {bounce_run}/{max_retry} 次，"
                      f"不耗失败次数）", file=sys.stderr, flush=True)
                slide_count = 0       # ★ 新的一轮，回顶次数重新按「本轮」计
                identical_run = 0
                img_after = None
                continue

            # 用滑动后的帧继续识别
            img = img_after

        print(f"[SelectPlants] #{slot_index+1} **{tgt['zh']}** 放弃："
              f"核验失败 {retry}/{max_retry} 次 / 连续触底反弹 {bounce_run}/{max_retry} 次",
              file=sys.stderr, flush=True)
        _wlog(f"#{slot_index+1} **{tgt['zh']}** 放弃明细：共扫 {frame} 帧，"
              f"核验失败 {retry} 次，触底反弹 {bounce_run} 次，"
              f"否定卡位 {len(rejected)} 个 {rejected[:3]}，"
              f"最后一次最高分 {best_score:.3f}（阈值 {threshold:.2f}），耗时 {_elapsed()}")
        if ocr_seen:
            # ★ 汇总这株植物核验时 OCR 读到过的所有文本 —— 加别名就照这个抄
            print(f"[SelectPlants]   期间 OCR 读到过：{ocr_seen[:8]}"
                  f"（若真身在里面，把读错的写法加进 PLANT_NAME_ALIASES）",
                  file=sys.stderr, flush=True)
        return False, slide_count

    # ==================== 编队选择模式 ====================
    def _squad_swipe(self, ctl, vec, end_hold):
        """带 end_hold 的滑动。

        controller 的 post_swipe 没有 end_hold 参数（pipe 里 Swipe 的
        end_hold 是框架层实现的），这里用 touch down/move/up 手工复现：
        分段移动到终点后按住 end_hold 毫秒再松手 —— 按住期间列表不动，
        松开即停，防止惯性滚动过冲把列表带跑。
        """
        try:
            x1, y1 = int(vec["begin"][0]), int(vec["begin"][1])
            x2, y2 = int(vec["end"][0]), int(vec["end"][1])
            dur = max(50, int(vec.get("duration", 200)))
            steps = 8
            ctl.post_touch_down(x1, y1).wait()
            for i in range(1, steps + 1):
                xi = int(x1 + (x2 - x1) * i / steps)
                yi = int(y1 + (y2 - y1) * i / steps)
                ctl.post_touch_move(xi, yi).wait()
                time.sleep(dur / steps / 1000.0)
            time.sleep(end_hold / 1000.0)
            ctl.post_touch_up().wait()
        except Exception as e:
            print(f"[SelectPlants] 编队选择: 滑动失败: {e}",
                  file=sys.stderr, flush=True)

    @staticmethod
    def _ocr_digits(context, image, roi):
        """整列 OCR -> {编队号: [x,y,w,h]}（同号多框取第一个）。

        候选取 best > filtered > all 全部扫（继承 _reco_all_texts 的策略：
        best 烂了不代表 all 里没有）。文本里抠第一串数字，只收 1-6。
        """
        out = {}
        if not _DIRECT_OCR:
            return out
        if image is None or getattr(image, "size", 0) == 0:
            return out
        try:
            r = tuple(int(v) for v in roi)
            detail = context.run_recognition_direct(
                JRecognitionType.OCR, JOCR(roi=r), image)
        except Exception as e:
            print(f"[SelectPlants] 编队选择: OCR 失败: {e}",
                  file=sys.stderr, flush=True)
            return out
        if detail is None:
            return out
        cands = []
        best = getattr(detail, "best_result", None)
        if best is not None:
            cands.append(best)
        cands.extend(getattr(detail, "filtered_results", None) or [])
        cands.extend(getattr(detail, "all_results", None) or [])
        for c in cands:
            t = getattr(c, "text", None)
            box = getattr(c, "box", None)
            if not t or box is None:
                continue
            m = re.search(r"\d+", str(t))
            if not m:
                continue
            n = int(m.group())
            if 1 <= n <= 6 and n not in out:
                out[n] = [int(v) for v in box]
        return out

    @staticmethod
    def _white_ratios(image, digit_boxes, white_min=235):
        """每个编队号数字框的「近白像素占比」—— 白字判定的原始依据（日志用）。"""
        ratios = {}
        if image is None or getattr(image, "size", 0) == 0:
            return ratios
        for n, box in digit_boxes.items():
            x, y, w, h = box
            crop = image[max(0, y):y + h, max(0, x):x + w]
            if crop.size == 0:
                continue
            near_white = (crop.min(axis=2) >= white_min)
            ratios[n] = float(near_white.mean())
        return ratios

    @staticmethod
    def _white_digits(image, digit_boxes, white_min=235, ratio=0.10):
        """白字核对：逐框数近白像素占比，>= ratio 判白，返回白字编队号集合。

        白色 = BGR 三通道都 >= white_min（纯白 + 抗锯齿近白）。
        白字笔画在紧凑框里的占比实测约 20-50%；彩色数字近白像素≈0，
        0.10 的阈值余量很大。
        """
        ratios = SelectPlants._white_ratios(image, digit_boxes, white_min)
        return {n for n, r in ratios.items() if r >= ratio}

    @staticmethod
    def _fmt_ratios(ratios, limit=8):
        """白字占比 -> 「1:0.42 2:0.00 …」（日志用）。"""
        if not ratios:
            return "（无）"
        items = sorted(ratios.items())[:limit]
        return " ".join(f"{n}:{r:.2f}" for n, r in items)

    @staticmethod
    def _squad_done(white_set, target):
        """选中核对（**点击后**用；目标≠1 时也用于点击前的完成短路）。

        目标≠1：目标号在白色集合里即可（1 天生白不影响判定）。
        目标=1：1 天生白，「1 是白的」区分不了选中态 —— 所以本函数对
        目标=1 只在点击后核对：看白色集合是否收窄为 {1}（旧选中号变回
        彩色；本来就没别的选中号时，点完白字仍={1}，也算选上）。
        点击前的完成短路【禁止】用于目标=1（必须无条件多点一次）。"""
        if target == 1:
            return white_set == {1}
        return target in white_set

    def _run_squad_select(self, context, target, param):
        """编队选择闭环主流程（参数语义见 SQUAD_* 常量注释）。

        每轮：整列 OCR -> 已经是目标直接收工 -> 看得见目标就点、
        500ms 后白字核对，不过就回弹重选 -> 看不见就下滑（end_hold=1500）；
        目标是 1/2/3 却连续 2 轮看到 6 -> 列表不在顶部 -> 回弹。
        """
        ctl = context.tasker.controller
        if not (1 <= target <= 6):
            print(f"[SelectPlants] 编队选择: 目标编队 {target} 非法（要 1-6）",
                  file=sys.stderr, flush=True)
            return False
        col_roi = param.get("编队列roi") or self.SQUAD_COL_ROI
        swipe = dict(self.SQUAD_SWIPE)
        swipe.update(param.get("滑动") or {})
        back = dict(self.SQUAD_BACKTOP)
        back.update(param.get("回弹") or {})
        end_hold = int(param.get("滑动按住", self.SQUAD_END_HOLD))
        verify_wait = int(param.get("核对等待", self.SQUAD_VERIFY_WAIT))
        max_retry = int(param.get("最多重试", self.SQUAD_MAX_RETRY))
        max_slides = int(param.get("最多滑动步数", self.SQUAD_MAX_SLIDES))
        post_swipe_wait = int(param.get("滑动后等待", 300))

        def backtop(n_slides):
            # 反着滑回顶：次数 = 本轮下滑次数 + 2（与选卡回顶同思路，留余量）
            for _ in range(max(1, n_slides + 2)):
                self._squad_swipe(ctl, back, end_hold)

        # ★ 识别过程日志：入口横幅（几何 + 判据），用户排查「编队选错」时要看
        _wlog(f"编队选择：开始，目标编队 {target}，整列 roi={col_roi}，"
              f"核对等待 {verify_wait}ms，滑动按住 {end_hold}ms，"
              f"最多 {max_retry} 轮 / 单轮 {max_slides} 滑")
        _ilog(f"  判据：白字集合={{{1}, 当前选中}}（目标≠1 看目标变白；"
              f"目标=1 看白色集合收窄为 {{1}}）；滑动={swipe.get('begin')}->{swipe.get('end')}")

        slides = 0
        consec_last6 = 0
        for attempt in range(1, max_retry + 1):
            if self._stopped(context):
                return False
            img = self._screen(ctl)
            if img is None:
                return False
            digits = self._ocr_digits(context, img, col_roi)
            # 白字集合仍走 _white_digits（判据唯一来源）；ratios 只为日志
            white = self._white_digits(img, digits)
            ratios = self._white_ratios(img, digits)
            print(f"[SelectPlants] 编队选择: 第{attempt}轮 "
                  f"可见={sorted(digits)} 白字={sorted(white)}",
                  file=sys.stderr, flush=True)
            _ilog(f"  第{attempt}轮 屏{slides}：OCR 可见数字 {sorted(digits)}，"
                  f"近白占比 {self._fmt_ratios(ratios)} -> 白字 {sorted(white)}；"
                  f"框={ {n: digits[n] for n in sorted(digits)} }")

            # 已完成短路只对 目标≠1 生效（不把已选中的再点一遍，防反选）。
            # ★ 编队1 是例外：它天生纯白，「白字={1}」不代表选中态 ——
            #   目标=1 时必须无条件多点一次（用户 2026-10-23 实测确认），
            #   点完再用「白色集合收窄为 {1}」核对（旧选中号变回彩色才算选上；
            #   本来就没有别的选中号时，点完白字仍={1}，也算选上）。
            if target != 1 and self._squad_done(white, target):
                print(f"[SelectPlants] 编队选择: 编队{target} 已是选中态 ✓",
                      file=sys.stderr, flush=True)
                return True

            if target in digits:
                x, y, w, h = digits[target]
                self._click(ctl, x + w // 2, y + h // 2)
                print(f"[SelectPlants] 编队选择: 点击编队{target} "
                      f"@({x + w // 2},{y + h // 2})", file=sys.stderr, flush=True)
                time.sleep(verify_wait / 1000.0)
                if self._stopped(context):
                    return False
                img2 = self._screen(ctl)
                digits2 = self._ocr_digits(context, img2, col_roi)
                white2 = self._white_digits(img2, digits2)
                ratios2 = self._white_ratios(img2, digits2)
                _ilog(f"  点击后复核：可见 {sorted(digits2)}，"
                      f"近白占比 {self._fmt_ratios(ratios2)} -> 白字 {sorted(white2)}，"
                      f"判据 {'满足' if self._squad_done(white2, target) else '不满足'}")
                if self._squad_done(white2, target):
                    print(f"[SelectPlants] 编队选择: 编队{target} 核对通过 ✓",
                          file=sys.stderr, flush=True)
                    return True
                print(f"[SelectPlants] 编队选择: 核对不过 "
                      f"（白字={sorted(white2)}）-> 回弹重选",
                      file=sys.stderr, flush=True)
                backtop(slides)
                slides = 0
                consec_last6 = 0
                time.sleep(post_swipe_wait / 1000.0)
                continue

            # 目标不可见：目标是 1/2/3 却连续看到 6 -> 列表肯定不在顶部
            if target <= 3 and 6 in digits:
                consec_last6 += 1
                if consec_last6 >= 2:
                    print(f"[SelectPlants] 编队选择: 目标是{target}但连续 2 轮"
                          f"看到 6 -> 列表不在顶部，回弹",
                          file=sys.stderr, flush=True)
                    backtop(slides)
                    slides = 0
                    consec_last6 = 0
                    time.sleep(post_swipe_wait / 1000.0)
                    continue
            else:
                consec_last6 = 0

            if slides >= max_slides:
                print(f"[SelectPlants] 编队选择: 单轮下滑 {slides} 次仍不见 "
                      f"{target} -> 回弹", file=sys.stderr, flush=True)
                backtop(slides)
                slides = 0
            else:
                _ilog(f"  目标 {target} 本帧不可见 -> 下滑 1 步（已滑 {slides + 1}）")
                self._squad_swipe(ctl, swipe, end_hold)
                slides += 1
            time.sleep(post_swipe_wait / 1000.0)

        print(f"[SelectPlants] 编队选择: {max_retry} 轮仍未选中编队{target}，放弃",
              file=sys.stderr, flush=True)
        _wlog(f"编队选择汇总（未完成）：{max_retry} 轮没选上编队 {target}，"
              f"耗时 {_elapsed()}")
        return False

    # ---- 无尽局外选卡：严格按列表顺序，当前帧优先找下一个，触底回顶重扫 ----
    def _run_endless_select(self, context, ctl, targets, search_roi, swipe,
                            backtop, threshold, scales, post_swipe_wait,
                            click_gap, sim_threshold, backoff_frames,
                            max_retry, max_slides, watch_count=3,
                            backtop_extra=None):
        """无尽局外 80 选卡（「选择挑战植物」界面，无文本、无核对手段）。

        ★ 严格按「植物列表」顺序选取（2026-10 改）：
          界面上 80 个卡位按点击先后排布，所以顺序就是优先级。
          - 每帧只为「列表里第一个未选的」植物做匹配：命中就点、弹出待选集，
            然后**留在当前画面**重截一帧找下一个（连续几个都在同一屏时一趟点完）；
          - 当前帧没有 -> 【顺势往下滑，不再直接回顶】（2026-10-03 改），
            直到触底（连续 保底连续帧 帧相似）或滑到 最多滑动步数 才反弹回顶
            （本轮下滑次数+3）从顶重扫；
          - ★ 触底反弹**不算失败次数**：选中任意一个就把连续触底计数清零，
            连续 max_retry 次触底都没选中才判失败。

        ★ 顺路踩点（2026-10-29 加，与局内 8 槽同款）：
          每帧除了找「当前第一个未选的」，顺带对**后面最多 watch_count 个**
          （参数「踩点数量」，缺省 3）未选植物做匹配，命中只**记录**它在第几屏
          （seen_depth），不点。
          当前目标这帧没找到时：若踩点记录显示「它在上方」（记录屏数 < 当前屏数），
          就直接回顶再找，不再一路滑到底 —— 省掉整轮下滑。
          记录用过即 pop，所以不会反复触发；真正的失败上限仍是「连续触底」。

        按名除名天然防呆：点过的植物弹出待选集，已打勾的卡留在原位也不会
        再为它匹配（重复点 = 取消选中）。

        返回 True = 全部选中；连续触底上限仍有剩余 -> 打日志 + False。
        （手截图严格对照时理论上不会漏，漏了就是该报警的信号。）
        """
        # seq = 原始列表序号（打印用）；dict 拷贝一份，别污染调用方的 targets
        pending = [dict(t, seq=i) for i, t in enumerate(targets)]
        if not pending:
            print("[SelectPlants] 局外选卡: 植物列表为空，直接完成",
                  file=sys.stderr, flush=True)
            _wlog("局外选卡：植物列表为空（作业集 outer_pick.plants 没配 / "
                  "注入被顶掉）—— 一株都没得选，直接返回成功。"
                  "要自动选卡请在网页端「局外选卡」里选够 80 个后重新保存作业集")
            return True
        if scales is None:
            # 手截图与界面同尺度，单尺度足够且快；
            # 要抗截图偏差就传 "尺度":[0.95,1.0,1.05]。
            scales = (1.0,)
        watch_count = max(0, int(watch_count))
        # 局外回顶余量单独一档（缺省 +10，局内保持不变）
        backtop_extra = (self.ENDLESS_BACKTOP_EXTRA_STEPS
                         if backtop_extra is None else int(backtop_extra))

        # 顶点重启扫描（还没滑过 -> 按 0+extra 次刷）
        _wlog(f"局外选卡：开始，共 {len(pending)} 株待选，"
              f"阈值 {threshold:.2f}，尺度 {_fmt_scales(scales)}，"
              f"踩点数量 {watch_count}，回顶余量 +{backtop_extra}")
        _ilog(f"  局外搜索roi={search_roi} 滑动={swipe.get('begin')}->{swipe.get('end')} "
              f"回顶={backtop.get('begin')}->{backtop.get('end')} "
              f"点击间隔={click_gap}ms 相似阈值={sim_threshold:.2f}")
        self._do_swipe_backtop(ctl, backtop, 0, extra=backtop_extra)

        bounce_run = 0           # 连续触底反弹次数（选中一个就清零）；到上限判失败
        slide_count = 0          # 本轮回顶之后，已经向下扫了几屏
        identical_run = 0
        seen_depth = {}          # seq -> 在第几屏出现过（顺路踩点记录）
        frame = 0                # 识别帧计数（日志用）
        picked_log = []          # [(中文名, 第几屏, score)] —— 完成时汇总「按什么顺序选的」

        # ★ 2026-10-03 扫描策略改版：
        #   - 点中一个 -> 留在当前帧再找下一个（循环开头重截帧就是这次检查），
        #     有就直接点（同屏连续命中一趟点完）；
        #   - 当前帧没有 -> 不再「直接回顶」，顺势往下滑，直到触底才反弹回顶；
        #   - 触底反弹【不算失败次数】，只有连续 max_retry 次触底都没选中才放弃。
        # ★ 2026-10-29 加顺路踩点：每帧顺带记录后面 watch_count 个在第几屏出现过；
        #   当前目标没找到且记录显示它在上方 -> 先回顶，别白滑到底。
        while pending and bounce_run < max_retry:
            if self._stopped(context):
                return False
            img = self._screen(ctl)
            if img is None:
                time.sleep(0.3)
                continue
            frame += 1

            # ---- 顺路踩点：只记不点（后面 watch_count 个未选的）----
            if watch_count:
                for wt in pending[1:1 + watch_count]:
                    if wt["seq"] in seen_depth:
                        continue          # 已踩过点，省一次匹配
                    hit_w = PM.find_best(img, wt["templates"], roi=search_roi,
                                         threshold=threshold, scales=scales)
                    if hit_w is not None:
                        seen_depth[wt["seq"]] = slide_count
                        print(f"[SelectPlants] 局外选卡: 踩点 #{wt['seq'] + 1} "
                              f"**{wt['zh']}** 在第 {slide_count} 屏出现过"
                              f"（先记下，轮到它时少滑几屏）",
                              file=sys.stderr, flush=True)
                        _ilog(f"  帧{frame} 踩点 #{wt['seq'] + 1} {wt['zh']} "
                              f"score={hit_w['score']:.3f}{_fmt_xy(hit_w)}"
                              f"（阈值 {threshold:.2f}）")

            # ---- 只找「第一个未选中的」（严格顺序）----
            tgt = pending[0]
            # ★ 探针不设阈值：没命中也要知道最高分（差多少才过阈值）
            probed = _probe_cands(img, tgt["templates"], search_roi, scales, topk=3)
            best_score = probed[0]["score"] if probed else 0.0
            hit = probed[0] if (probed and best_score >= threshold) else None
            _ilog(f"局外 帧{frame} 屏{slide_count} 目标 #{tgt['seq'] + 1} **{tgt['zh']}**："
                  f"最高 {best_score:.3f}（阈值 {threshold:.2f}"
                  f"{'，命中' if hit is not None else '，未过阈值'}）"
                  f" 最高点={_fmt_cands(probed, 2)} 剩 {len(pending)} 个")
            if hit is not None:
                cx = hit["x"] + hit["w"] // 2
                cy = hit["y"] + hit["h"] // 2
                print(f"[SelectPlants] 局外选卡: 选中 **{tgt['zh']}** "
                      f"({hit['name']}, score={hit['score']:.3f}) "
                      f"点击 ({cx},{cy})（剩 {len(pending) - 1} 个）",
                      file=sys.stderr, flush=True)
                _ilog(f"  -> 点击 ({cx},{cy})，该卡在整图 {_fmt_xy(hit)}，"
                      f"模板 {hit['name']} 尺度 x{hit.get('scale', 1):g}")
                self._click(ctl, cx, cy)
                time.sleep(click_gap / 1000.0)
                picked_log.append((tgt["zh"], slide_count, hit["score"]))
                seen_depth.pop(tgt["seq"], None)   # 已选上，踩点记录作废
                pending.pop(0)          # 按名除名：已打勾的卡不再匹配
                identical_run = 0
                bounce_run = 0          # 有进展 -> 连续触底清零
                continue                # 留在当前画面，重截帧找下一个

            # ---- 这帧没找到：踩点说它在上面 -> 先回顶（省掉整轮下滑）----
            d = seen_depth.get(tgt["seq"])
            if d is not None and d < slide_count:
                seen_depth.pop(tgt["seq"], None)   # 用过即清，避免反复触发
                print(f"[SelectPlants] 局外选卡: **{tgt['zh']}** "
                      f"之前在第 {d} 屏出现过（当前在第 {slide_count} 屏）"
                      f"-> 先回顶再找", file=sys.stderr, flush=True)
                self._do_swipe_backtop(ctl, backtop, slide_count,
                                       extra=backtop_extra)
                slide_count = 0
                identical_run = 0
                continue

            # ---- 没找到 -> 顺势往下滑（不回顶），触底才反弹 ----
            img_before = PL.bgr_to_gray(img)
            _ilog(f"  帧{frame} 未命中 -> 下滑 1 步（屏 {slide_count}->{slide_count + 1}）")
            self._do_swipe(ctl, swipe)
            slide_count += 1          # 记下这轮滑了几屏，回顶次数由它决定
            time.sleep(post_swipe_wait / 1000.0)
            img_after = self._screen(ctl)
            if img_after is None:
                time.sleep(0.3)
                continue
            sim = self._gray_sim(img_before, PL.bgr_to_gray(img_after))
            identical_run = identical_run + 1 if sim >= sim_threshold else 0
            _ilog(f"  滑动后相似度 {sim:.3f}（阈值 {sim_threshold:.2f}，"
                  f"连续『没动静』 {identical_run}/{backoff_frames}）")

            # 触底（连续无变化）或步数上限 -> 反弹回顶（不算失败，连续计数）
            if identical_run >= backoff_frames or slide_count >= max_slides:
                bounce_run += 1
                print(f"[SelectPlants] 局外选卡: 本轮下滑 {slide_count} 次 "
                      f"仍没找到 **{tgt['zh']}**（共剩 {len(pending)} 个），"
                      f"触底反弹回顶（连续 {bounce_run}/{max_retry} 次，不耗重试）",
                      file=sys.stderr, flush=True)
                _ilog(f"  反弹原因：{'连续相似' if identical_run >= backoff_frames else '步数上限'}"
                      f"（相似度 {sim:.3f}，连续 {identical_run}/{backoff_frames}，"
                      f"屏 {slide_count}/{max_slides}）")
                self._do_swipe_backtop(ctl, backtop, slide_count,
                                       extra=backtop_extra)
                slide_count = 0       # 新的一轮，回顶次数重新按「本轮」计
                identical_run = 0

        if pending:
            names = "、".join(t["zh"] for t in pending)
            print(f"[SelectPlants] 局外选卡: 连续触底反弹 {max_retry} 次仍没找到，"
                  f"剩 {len(pending)} 个未选中: {names}",
                  file=sys.stderr, flush=True)
            _wlog(f"局外选卡汇总（未完成）：已选 {len(picked_log)}/{len(targets)}，"
                  f"扫了 {frame} 帧，触底反弹 {bounce_run} 次，耗时 {_elapsed()}；"
                  f"已选顺序={[(n, f'屏{s}') for n, s, _ in picked_log]}")
            return False
        print(f"[SelectPlants] 局外选卡: {len(targets)} 个植物全部选中",
              file=sys.stderr, flush=True)
        _wlog(f"局外选卡汇总（完成）：{len(targets)}/{len(targets)}，"
              f"扫了 {frame} 帧，耗时 {_elapsed()}；按序选中="
              f"{[(n, f'屏{s}', round(sc, 2)) for n, s, sc in picked_log]}")
        return True

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
        """OCR 文本与目标中文/英文名是否对得上（严格对照 + 白名单别名）。

        要求去掉空格/标点后与目标名【相等】才算命中，不再做"包含"模糊匹配，
        避免「毒液豌豆射手」被当成「豌豆射手」。
        仅额外宽容两种情况：
          1. "名字后粘等级/星级数字"（如 豌豆射手3）；
          2. PLANT_NAME_ALIASES 里登记的 OCR 别名（如 瓷砖萝卜 -> 瓷砖萝）。
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
        # 别名（白名单，只有登记过的植物才有；规范化规则与正名一致）
        aliases = [norm(v).lower() for v in PLANT_NAME_ALIASES.get(tgt.get("zh") or "", [])]
        names = [n for n in [zh, en] + aliases if n]

        if t in names:
            return True
        # 兼容「名字 + 等级数字」：豌豆射手3 / peashooter3 / 瓷砖萝3（数字粘在名字后）
        for name in names:
            if t.startswith(name):
                tail = t[len(name):]
                if tail and re.fullmatch(r"\d+x?|级|阶", tail):
                    return True
        return False