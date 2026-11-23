# -*- coding: utf-8 -*-
"""galaxy —— 一维界面导航：识别当前页 → 朝目标滑一格 → 再识别 …直到到达。

拓扑：每张表的 N 屏排成一个**环**（首尾相接，实测：最右端继续左滑会绕回第 1 屏），
每步按环上最短方向走；`{"wrap": false}` 可强制按纯一字排开算。
每步都重新识别，所以丢格/误判/绕回都能当场修正；手势方向用"滑一格后位置实际变了多少"
当场校准；滑不动时先假设"其实不绕回"再换一条路。上限 MAX_SWIPES 次，只告警不中断。

维护点两条：
  PAGES_TABLES —— 表号 → 该表按界面从左到右的页面名（新世界群加个键；18→19 在表里加一项）
  VARIANT      —— OCR 常读错的繁体/异体字 → 简体，一字对一字（实锤：「海盜港湾」被读成「盜」）
识别容忍：去空白 + 异体折算，并且**只差 1 个字也算认出**（FUZZY_MAX=1）；差 2 个字放弃；
两个页面同时只差 1 字 → 判歧义不猜（宁可失败也不导航到错页）。

用法：节点 action 写 Custom + custom_action: NavToPage
    {"target": "神秘埃及"}                    ← 页面名（本表内）；也收本表 0 起下标 {"target": 0}
    {"world": 2}                              ← 选第 2 张表（省略 = DEFAULT_WORLD = 1）
    {"page_node": "Nav_CurrentPage", "roi": [503, 407, 276, 150], "wrap": false}   ← 调参
到达后 return True → 框架立刻识别本节点 next，直接进业务链路。日志前缀：[galaxy]
"""

import json
import sys
import time

from maa.agent.agent_server import AgentServer
from maa.context import Context
from maa.custom_action import CustomAction

PAGE_NODE = "Nav_CurrentPage"        # OCR 节点：recognition.param 只给 roi，★不要写 expected
ROI = [503, 407, 276, 150]           # PAGE_NODE 不存在时的兜底 ROI
# 页面表：键 = 表号（custom_action_param 写 {"world": N}），值 = 从左到右的页面名，一项一屏。
PAGES_TABLES = {
    1: [
        "神秘埃及", "海盗港湾", "狂野西部", "功夫世界", "未来世界", "黑暗时代",
        "巨浪沙滩", "冰河世界", "天空之城", "失落之城", "摇滚年代", "恐龙危机",
        "摩登世界", "蒸汽时代", "复兴时代", "平安时代", "海底世界", "月球基地",
    ],
    2: [],                            # 暂时留空：以后往这里填（空表会明确报"还没配置"，不会崩）
}
DEFAULT_WORLD = 1                    # 不写 world 时用第 1 表
SWIPE = ((637, 572), (366, 576), 240)   # 单屏滑动标定：(begin), (end), duration（右→左＝前进）
SETTLE = 0.35                        # 滑动后等吸附动画（秒）；动画长就往上调
MAX_SWIPES = 50                      # 一次导航最多滑多少次（硬上限，远大于页数）
STALL_WARN = 3                       # 连续"滑了没动"几次就先假设不绕回、换一条路
WRAP = True                          # 界面首尾相接（实测：最右端继续左滑绕回第 1 屏）
READ_TRIES = 3                       # 每次读屏的重试次数
FUZZY_MAX = 1                        # 同长度页面名允许差几个字（1 = 一个字读错也认）
# OCR 常见繁体/异体字 → 简体（一字对一字；表里只放页面名出现过的字）
VARIANT = str.maketrans({
    "盜": "盗", "灣": "湾", "來": "来", "時": "时", "灘": "滩", "搖": "摇",
    "滾": "滚", "龍": "龙", "機": "机", "復": "复", "興": "兴", "氣": "气",
})


def log(msg):
    print(f"[galaxy] {msg}", file=sys.stderr, flush=True)


# 启动打一行：确认跑的是哪一版参数（不用猜构建包有没有更新）
log(f"模块已加载：表1={len(PAGES_TABLES.get(1) or [])} 项 表2={len(PAGES_TABLES.get(2) or [])} 项 "
    f"DEFAULT_WORLD={DEFAULT_WORLD} MAX_SWIPES={MAX_SWIPES} FUZZY_MAX={FUZZY_MAX} "
    f"WRAP={WRAP} SWIPE={SWIPE[0]}→{SWIPE[1]} SETTLE={SETTLE}")


def _parse_param(raw):
    """宽松解析 custom_action_param（dict / JSON 串 / 二次编码），保证返回 dict。

    非 dict（JSON 数组、数字…）一律当空参：否则下游 .get 会抛 AttributeError，
    只剩一句"异常终止"，看不出是参数写错了。
    """
    try:
        for _ in range(3):                       # 最多解三层编码
            if not isinstance(raw, str):
                break
            raw = json.loads(raw)
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _norm(s):
    """OCR 文本归一化：去掉所有空白（含全角空格），并把繁体/异体字折算成简体。"""
    return "".join(str(s or "").split()).translate(VARIANT)


def _one_off(a, b):
    """a 与 b 只差一个字（换一个 / 多一个 / 少一个）→ 返回差异描述，否则 None。"""
    if len(a) == len(b):
        d = [k for k in range(len(a)) if a[k] != b[k]]
        return f"{a[d[0]]}→{b[d[0]]}" if 1 <= len(d) <= FUZZY_MAX else None
    if abs(len(a) - len(b)) != 1:
        return None
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    for k in range(len(long_)):
        if long_[:k] + long_[k + 1:] == short:
            return f"{'少' if len(a) < len(b) else '多'}一字「{long_[k]}」"
    return None


def _page_index(texts, pages):
    """在一批 OCR 候选里找当前页在 pages 里的下标；认不出返回 None。

    三轮退化：① 完全相等（去空白 + 异体折算）→ ② 包含（页面名长的优先，
    防「神秘埃及 海盗港湾」这种拼接文本）→ ③ 单字容错（只差 1 字也认，歧义不猜）。
    """
    norms = [_norm(p) for p in pages]
    cand = [_norm(t) for t in texts]

    for c in cand:                                        # ① 完全相等
        if c and c in norms:
            return norms.index(c)
    for c in cand:                                        # ② 包含
        for i in sorted(range(len(norms)), key=lambda i: -len(norms[i])):
            if norms[i] and norms[i] in c:
                log(f"包含命中：「{c}」含「{norms[i]}」→ 判为第 {i} 页（非精确匹配，请核对 ROI）")
                return i
    hits = {}                                             # ③ 单字容错：下标 → (候选, 差异)
    for c in cand:
        for i, p in enumerate(norms):
            desc = _one_off(c, p) if p else None
            if desc and i not in hits:
                hits[i] = (c, desc)
    if len(hits) > 1:
        log("容错命中多个页面，判歧义放弃：" + "；".join(
            f"「{c}」≈「{norms[i]}」" for i, (c, _) in hits.items()))
        return None
    if hits:
        i, (c, desc) = next(iter(hits.items()))
        log(f"容错命中：「{c}」≈「{norms[i]}」（{desc}）")
        return i
    return None


def _resolve_target(target, pages):
    """target → 本表下标；解析不出返回 None（原因写日志）。文案优先，其次 0 起下标。"""
    if isinstance(target, bool):                     # JSON true 会被 int() 当 1，静默走错页
        log(f"target 是布尔值：{target!r}，请写页面文案或下标")
        return None
    if isinstance(target, str):
        target = _norm(target)
        for i, p in enumerate(pages):
            if _norm(p) == target:                   # 归一化后比对，容忍空格/异体字
                return i
    if isinstance(target, float) and not target.is_integer():   # 1.9 会被 int() 截成 1
        log(f"target 不是整数：{target!r}")
        return None
    try:
        i = int(target)
    except (TypeError, ValueError):
        log(f"target 无法解析：{target!r}（可写页面文案或本表 0 起下标）")
        return None
    if not 0 <= i < len(pages):
        log(f"target 下标越界：{i}（本表合法 0~{len(pages) - 1}）")
        return None
    return i


def _resolve_world(world):
    """world → (表号, 页面列表)；解析不出或表是空的返回 (None, None)（原因写日志）。"""
    raw = DEFAULT_WORLD if world is None else world
    try:
        key = DEFAULT_WORLD if isinstance(raw, bool) else int(str(raw).strip())
    except (TypeError, ValueError):
        log(f"world 无法解析：{world!r}（现有表：{sorted(PAGES_TABLES)}）")
        return None, None
    if key not in PAGES_TABLES:
        log(f"world={key} 不存在（现有表：{sorted(PAGES_TABLES)}）")
        return None, None
    if not PAGES_TABLES[key]:
        log(f"第 {key} 表还没配置（0 项）——请往 PAGES_TABLES[{key}] 里填页面名")
        return None, None
    return key, PAGES_TABLES[key]


def _dist(cur, t, wrap, n):
    """环上有符号最短距离（正 = 下标增大方向）：月球基地(17)→埃及(0) 是 +1，不是 −17。

    wrap=False 就是普通的一字排开 t − cur；正好半个环时偏向正方向。
    """
    if not wrap:
        return t - cur
    d = (t - cur) % n
    return d - n if d > n // 2 else d


def _texts(detail):
    """一次识别的全部候选文本（best > filtered > all，去重保序）。"""
    out = []
    for r in [getattr(detail, "best_result", None)] + \
             list(getattr(detail, "filtered_results", None) or []) + \
             list(getattr(detail, "all_results", None) or []):
        t = getattr(r, "text", None)
        if t and str(t) not in out:
            out.append(str(t))
    return out


def _direct_ocr(context, roi, image):
    """没有 OCR 节点时直接识别一次；接口不存在或出错都返回 None（原因写日志）。"""
    try:
        from maa.pipeline import JRecognitionType, JOCR
    except Exception as e:
        log(f"直接识别不可用（import 失败）：{type(e).__name__}: {e}")
        return None
    if not hasattr(context, "run_recognition_direct"):
        log("直接识别不可用：当前 maafw 没有 run_recognition_direct，请建 Nav_CurrentPage 节点")
        return None
    try:
        return context.run_recognition_direct(JRecognitionType.OCR, JOCR(roi=list(roi)), image)
    except Exception as e:
        log(f"直接识别异常：{type(e).__name__}: {e}")
        return None


def _current(context, page_node, roi, pages):
    """读当前页下标；重试 READ_TRIES 次仍认不出返回 None。"""
    for i in range(READ_TRIES):
        image = context.tasker.controller.post_screencap().wait().get()
        detail = (context.run_recognition(page_node, image)
                  if page_node else _direct_ocr(context, roi, image))
        texts = _texts(detail)
        idx = _page_index(texts, pages)
        if idx is not None:
            return idx
        if i + 1 < READ_TRIES:                       # 还有下次才等，最后一次不必白等
            time.sleep(SETTLE)
    log(f"读屏 {READ_TRIES} 次都认不出页面，最后候选={texts}（差 2 字以上就放弃，"
        f"确属 OCR 读错请把差异字补进 VARIANT）")
    return None


@AgentServer.custom_action("NavToPage")
class NavToPage(CustomAction):
    """param: {"target": 页面名或本表下标, "world": 表号（省略=1）}"""

    def run(self, context: Context, argv: CustomAction.RunArg) -> bool:
        try:
            return self._run(context, argv)
        except Exception as e:
            log(f"异常终止：{type(e).__name__}: {e}")
            return False

    def _run(self, context, argv):
        param = _parse_param(argv.custom_action_param)
        target = param.get("target")
        if target is None:
            log("target 为空（custom_action_param 里要写 target）")
            return False

        world, pages = _resolve_world(param.get("world"))
        t = None if pages is None else _resolve_target(target, pages)
        if t is None:
            return False
        n = len(pages)
        wrap = param.get("wrap")
        wrap = wrap if isinstance(wrap, bool) else WRAP

        page_node = str(param.get("page_node") or PAGE_NODE)
        roi = param.get("roi") or ROI
        if context.get_node_data(page_node) is None:
            log(f"节点「{page_node}」不存在，改用直接识别（roi={roi}）")
            page_node = ""
        log(f"第 {world} 表 {n} 项 →「{pages[t]}」（下标 {t}）"
            f"{'，环上取最短方向' if wrap else '，按一字排开算'}")

        sign = 1                                 # 1 = SWIPE 原样滑等于"下标 +1"，用实测位移校准
        prev = None                              # 上一次滑之前：(位置, 意图 ±1)
        stall = 0                                # 连续"滑了没动"的次数
        for step in range(MAX_SWIPES):
            cur = _current(context, page_node, roi, pages)
            if cur is None:
                log(f"step={step} 认不出当前页，放弃")
                return False

            if prev is not None:                             # ★用真实位移校准手势 / 判滑不动
                pcur, padv = prev
                delta = (cur - pcur) % n
                if delta == 0:
                    stall += 1
                    if stall >= STALL_WARN and wrap:         # 可能其实不绕回：换一条路试
                        wrap, stall = False, 0
                        log(f"step={step} ⚠️ 连续 {STALL_WARN} 次滑不动 → 先假定不绕回（wrap=false）")
                else:
                    stall = 0
                    got = 1 if delta == 1 else (-1 if delta == n - 1 else 0)
                    if got == -padv:                         # 手势走反了 → 翻过来继续
                        sign = -sign
                        log(f"step={step} ⚠️ 手势方向与预期相反（想 {padv:+d} 格，实际 {got:+d} 格）"
                            f"→ 已自动翻转")
                    elif got == 0:
                        log(f"step={step} ⚠️ 一次滑动跨了 {delta} 格（SWIPE 偏大，多走几步才到位）")

            if cur == t:
                log(f"step={step} 已到达「{pages[t]}」，进 next")
                return True

            d = _dist(cur, t, wrap, n)
            advance = d > 0
            (x1, y1), (x2, y2), dur = SWIPE
            if advance != (sign > 0):
                x1, y1, x2, y2 = x2, y2, x1, y1
            aim = cur + (1 if advance else -1)
            log(f"step={step} 当前={pages[cur]} 差={d:+d} → {'前进' if advance else '后退'} 1 格"
                + ("（跨首尾绕回）" if wrap and not 0 <= aim < n else ""))
            context.tasker.controller.post_swipe(x1, y1, x2, y2, dur).wait()
            time.sleep(SETTLE)
            prev = (cur, 1 if advance else -1)

        log(f"滑满 {MAX_SWIPES} 次仍未到达「{pages[t]}」，放弃（查 SWIPE 标定/分辨率/ROI）")
        return False
