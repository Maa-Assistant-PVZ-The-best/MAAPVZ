"""刷家族天赋相关的 CustomRecognition。

- FamilyTalentCountCheck      : 解析家族页底部的「今日免费刷新次数：N」，判断还能不能刷
- FamilyTalentEvaluate        : 按「类型优先」规则评估弹窗里的候选属性（详见类 docstring）
- FamilyTalentDoubleLockCheck : 双锁防呆，右栏两个槽位是否都刷不了（都显示「属性不会刷新」）

OCR 直接走 context.run_recognition_direct(JRecognitionType.OCR, JOCR(...))，
与 ocr_return_action.py 里的写法保持一致；老版本没有该接口时返回空文本，
此时两个识别器都会返回未命中（安全停止，不会点保存/不会消耗钻石）。
"""

import json
import re
import unicodedata

from maa.agent.agent_server import AgentServer
from maa.custom_recognition import CustomRecognition

try:
    from maa.pipeline import JRecognitionType, JOCR

    _DIRECT_RECO = True
except Exception:
    _DIRECT_RECO = False


NUMBER_PATTERN = re.compile(r"-?\d+(?:\.\d+)?")

# OCR 常见字符误读（数字区间里出现的字母）
OCR_CHAR_FIX = {
    "O": "0",
    "o": "0",
    "D": "0",
    "g": "9",
    "G": "6",
    "I": "1",
    "l": "1",
    "|": "1",
    "S": "5",
    "s": "5",
    "B": "8",
}

# 属性方向关键字：越小越好的属性（越低越好：数值 <= 目标算达标）
LOWER_IS_BETTER_KEYWORDS = ("降低", "减少", "下降", "减低", "缩短")
# 属性方向关键字：越大越好的属性（越高越好：数值 >= 目标算达标）
# 「恢复」用于「每N秒恢复生命」这类没有增加/降低字样的属性，数值越高越好
HIGHER_IS_BETTER_KEYWORDS = ("增加", "提升", "提高", "增高", "恢复")


def _log(message):
    print(f"[家族天赋] {message}", flush=True)


def _parse_param(raw_param):
    """兼容 dict / JSON 字符串 / 双层 JSON 字符串。"""
    if isinstance(raw_param, dict):
        return raw_param
    if isinstance(raw_param, str):
        for _ in range(2):
            try:
                parsed = json.loads(raw_param)
            except Exception:
                return {}
            if isinstance(parsed, dict):
                return parsed
            raw_param = parsed
    return {}


def _normalize_ocr_text(text):
    """修正常见 OCR 字符误读，便于后续取数字。"""
    fixed = []
    for char in text or "":
        fixed.append(OCR_CHAR_FIX.get(char, char))
    return "".join(fixed)


def _normalize_for_match(text):
    """归一化文本用于属性类型关键词匹配。

    全角转半角(NFKC) + 去掉所有空白 + 转小写，OCR 文本和用户填的关键词都过一遍，
    这样「攻击速度 增加」「Attack Speed」这类空白/大小写差异不会导致匹配失败。
    """
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    return "".join(ch for ch in normalized if not ch.isspace()).lower()


def _is_subsequence(needle, haystack):
    """needle 的字符是否按顺序出现在 haystack 里（用于「攻速」匹配「攻击速度」）。"""
    iterator = iter(haystack)
    return all(char in iterator for char in needle)


def _match_type(keyword, normalized_text):
    """关键词是否出现在 OCR 文本里。

    先做包含匹配（推荐用法：关键词=完整类型名，如「攻击速度」）；
    包含失败且关键词长度 >= 2 时退化为顺序子串匹配，容忍「攻速」这类简写。
    """
    if not keyword or not normalized_text:
        return False
    if keyword in normalized_text:
        return True
    if len(keyword) >= 2 and _is_subsequence(keyword, normalized_text):
        return True
    return False


def _parse_number(normalized_text):
    """取文本里第一个数字，取不到返回 None。"""
    match = NUMBER_PATTERN.search(normalized_text)
    if match is None:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _resolve_direction(normalized_text):
    """从文本里的方向词判断属性方向。

    返回 "越低越好" / "越高越好" / None（识别不出）。
    「降低/缩短」类先判，避免「消耗降低」这类词被误判成增加。
    """
    if any(keyword in normalized_text for keyword in LOWER_IS_BETTER_KEYWORDS):
        return "越低越好"
    if any(keyword in normalized_text for keyword in HIGHER_IS_BETTER_KEYWORDS):
        return "越高越好"
    return None


def _to_float(value):
    """把 option 插值进来的目标值转成 float。

    只有纯数字才算有效：占位符没被插值(例如 "{属性1目标值}")或其它文本一律返回 None，
    避免把占位符里的数字当成目标值而误判达标、误点保存。
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text) is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _ocr_text(context, image, roi, only_rec=True):
    """对指定 ROI 做一次 OCR，返回文本（没识别到返回空字符串）。"""
    if not _DIRECT_RECO:
        _log("当前 maa 版本不支持 run_recognition_direct，无法直接 OCR")
        return ""

    roi_tuple = tuple(int(v) for v in roi) if isinstance(roi, (list, tuple)) and len(roi) == 4 else (0, 0, 0, 0)
    try:
        ocr_param = JOCR(roi=roi_tuple, only_rec=only_rec)
        detail = context.run_recognition_direct(JRecognitionType.OCR, ocr_param, image)
    except Exception as exc:
        _log(f"OCR 调用异常: {exc}")
        return ""

    if detail is None or not detail.hit or detail.best_result is None:
        return ""
    return getattr(detail.best_result, "text", "") or ""


def _ocr_all_texts(context, image, roi):
    """对指定 ROI 做一次 OCR，返回所有文本行（没识别到返回空列表）。

    与 _ocr_text 的区别：这里要数「几行」文案，所以取 all_results(全部文本行)而不是 best_result。
    """
    if not _DIRECT_RECO:
        _log("当前 maa 版本不支持 run_recognition_direct，无法直接 OCR")
        return []

    roi_tuple = tuple(int(v) for v in roi) if isinstance(roi, (list, tuple)) and len(roi) == 4 else (0, 0, 0, 0)
    try:
        ocr_param = JOCR(roi=roi_tuple, only_rec=True)
        detail = context.run_recognition_direct(JRecognitionType.OCR, ocr_param, image)
    except Exception as exc:
        _log(f"OCR 调用异常: {exc}")
        return []

    if detail is None:
        return []

    texts = []
    for result in getattr(detail, "all_results", None) or []:
        text = getattr(result, "text", "") or ""
        if text:
            texts.append(text)
    return texts


def _parse_free_count(text):
    """从「今日免费刷新次数：N」里取出 N，取不到返回 None。"""
    normalized = _normalize_ocr_text(text)
    if not normalized:
        return None

    # 优先取冒号后面的数字，冒号识别不到时退化成取整行最后一个数字
    tail = normalized
    for colon in ("：", ":"):
        index = normalized.rfind(colon)
        if index >= 0:
            tail = normalized[index + 1 :]
            break

    matches = NUMBER_PATTERN.findall(tail)
    if not matches:
        matches = NUMBER_PATTERN.findall(normalized)
    if not matches:
        return None

    try:
        return int(float(matches[-1]))
    except ValueError:
        return None


def _ad_card_enabled(param):
    """免广告卡链是否启用：由 option「使用免广告卡次数」整段覆盖 param 时置 true。"""
    return bool(param.get("免广告卡已启用"))


# 「这个槽不会刷新」类文案的特征词（实测锁定后右栏该槽显示「属性不会刷新」）
NO_REFRESH_NEGATIONS = ("不", "无法", "不能")
NO_REFRESH_WORDS = ("刷新", "制新", "理新")  # 「制新/理新」= OCR 把「刷」读错时的兜底


def _looks_like_no_refresh(text):
    """文本是否是「该槽不会刷新」类文案（容忍 OCR 错字/空白）。"""
    normalized = _normalize_for_match(_normalize_ocr_text(text))
    if not normalized:
        return False
    has_negation = any(word in normalized for word in NO_REFRESH_NEGATIONS)
    has_refresh = any(word in normalized for word in NO_REFRESH_WORDS)
    return has_negation and has_refresh


@AgentServer.custom_recognition("FamilyTalentCountCheck")
class FamilyTalentCountCheck(CustomRecognition):
    """免费次数判断。

    param:
        {
            "免费次数文本框": [x, y, w, h],     # 家族页底部「今日免费刷新次数：N」所在 ROI
            "免广告卡已启用": false              # option 开了免广告卡链时为 true
        }

    文本由本识别器自己 OCR(不依赖外部传入)：
    命中 = 免费次数 > 0，或免费次数 = 0 但免广告卡已启用(还能靠广告换刷新)
    未命中 = 免费次数 = 0 且没开免广告卡 → 交给上一节点的 on_error 走安全收尾
    """

    def analyze(self, context, argv):
        param = _parse_param(argv.custom_recognition_param)
        roi = param.get("免费次数文本框") or [640, 515, 380, 60]

        text = _ocr_text(context, argv.image, roi, only_rec=True)
        free_count = _parse_free_count(text)
        ad_enabled = _ad_card_enabled(param)
        box = (int(roi[0]), int(roi[1]), int(roi[2]), int(roi[3]))
        _log(f"免费次数原文={text!r} 解析结果={free_count} 免广告卡已启用={ad_enabled}")

        if free_count is None:
            # 「今日免费刷新次数：」读到了但数字解析不出(实测：次数为 0 时是空心字，OCR 读不出数字)
            # 此时有免广告卡就放行走卡链(卡链终点仍受防钻石守卫保护，不会误点钻石)；
            # 没开卡则安全停止
            if ad_enabled:
                return CustomRecognition.AnalyzeResult(box=box, detail="免费次数解析不出(可能为0)，免广告卡已启用，走卡链")
            return CustomRecognition.AnalyzeResult(box=None, detail=f"无法解析免费刷新次数: {text!r}，且免广告卡未启用，安全停止")

        if free_count > 0:
            return CustomRecognition.AnalyzeResult(box=box, detail=f"免费刷新次数={free_count}，继续刷")

        if ad_enabled:
            return CustomRecognition.AnalyzeResult(box=box, detail="免费次数=0，改用免广告卡刷新")

        return CustomRecognition.AnalyzeResult(box=None, detail="免费次数=0 且免广告卡未启用，安全停止")


@AgentServer.custom_recognition("FamilyTalentEvaluate")
class FamilyTalentEvaluate(CustomRecognition):
    """刷新属性评估（类型优先 v2）。

    param:
        {
            "框1": [660, 350, 330, 60], "框2": [660, 420, 330, 60],       # 右侧候选框(新刷出的属性)
            "左框1": [385, 350, 275, 60], "左框2": [385, 420, 275, 60],   # 左侧当前属性框(已有属性)
            "槽位1类型": "攻击速度", "槽位1目标": 24,                      # 空 / "不限" = 不指定类型
            "槽位2类型": "", "槽位2目标": 24
        }

    每个槽位 i(1/2) 独立评估（槽位 i 右侧候选框 = 框i，左侧当前属性 = 左框i）：
      - 指定了类型 T：
          T 不在右侧候选文本里                    → 不达标（类型不符）
          左框 OCR 文本为空                        → 不达标（无法确认左侧状态，保守处理，
                                                    空文本 ≠ 左侧没有该类型，不当作类型换新）
          T 在右侧、左侧没有 T                    → 达标（类型换新，数值无所谓，直接保存）
          T 在右侧、左侧也有 T                    → 数值比较：右数字 >= 目标才达标；
                                                    文本含「降低/缩短」类方向词时要求 <= 目标
      - 没指定类型（""/"不限"）：退化为 v1 的纯数值规则，右侧文本能解析出数字+方向才比较
    任一槽位达标 → 命中(box = 该槽位右侧候选框)，detail 说明达标原因；都不达标 → 未命中。
    目标值没被 option 插值、OCR 读不出文本等异常一律算不达标，绝不会误保存。

    类型关键词匹配：OCR 文本和关键词都做归一化(全角转半角/去空白/小写)后包含匹配，
    包含失败且关键词长度 >= 2 时退化顺序子串匹配，容忍「攻速」匹配「攻击速度增加」这类简写。
    """

    def analyze(self, context, argv):
        param = _parse_param(argv.custom_recognition_param)

        details = []
        hit_box = None

        for index in (1, 2):
            right_roi = param.get("框{}".format(index)) or []
            left_roi = param.get("左框{}".format(index)) or right_roi
            if not param.get("左框{}".format(index)):
                _log("槽位{}: 未配置左框，用右框文本兜底(按同类型走数值比较，保守不直接保存)".format(index))

            type_keyword = _normalize_for_match(param.get("槽位{}类型".format(index)))
            if type_keyword == "不限":
                type_keyword = ""
            raw_target = param.get("槽位{}目标".format(index))
            target = _to_float(raw_target)

            right_text = _ocr_text(context, argv.image, right_roi, only_rec=False)
            right_fixed = _normalize_ocr_text(right_text)
            right_norm = _normalize_for_match(right_fixed)
            left_text = _ocr_text(context, argv.image, left_roi, only_rec=False)
            left_fixed = _normalize_ocr_text(left_text)
            left_norm = _normalize_for_match(left_fixed)

            number = _parse_number(right_fixed)
            direction = _resolve_direction(right_norm)

            prefix = "槽位{}: 右文={!r} 左文={!r}".format(index, right_text, left_text)
            reached = False

            if not type_keyword:
                # 不指定类型(留空/"不限") → 退化为 v1 的纯数值规则
                if target is None:
                    details.append("{} 不限类型，目标值无法解析({!r})，视为未达标".format(prefix, raw_target))
                elif number is None:
                    details.append("{} 不限类型，右侧无数字，视为未达标".format(prefix))
                elif direction is None:
                    details.append("{} 不限类型，识别不出属性方向，视为未达标".format(prefix))
                else:
                    reached = number <= target if direction == "越低越好" else number >= target
                    details.append("{} 不限类型 {} 数字={} 目标={} → {}".format(
                        prefix, direction, number, target, "达标" if reached else "未达标"))
            elif not _match_type(type_keyword, right_norm):
                details.append("{} 指定类型「{}」未出现在右侧候选，视为未达标".format(prefix, type_keyword))
            elif not left_fixed.strip():
                # 左框 OCR 返回空文本 ≠ 左侧没有该类型(可能只是识别失败/被遮挡)，
                # 不能据此判「类型换新」直接保存；按无法确认左侧状态处理，保守视为不达标
                details.append("{} 左框识别为空，无法确认左侧状态，保守视为未达标".format(prefix))
            elif not _match_type(type_keyword, left_norm):
                reached = True
                details.append("{} 左侧没有「{}」 → 类型换新，直接保存(不看数值)".format(prefix, type_keyword))
            elif target is None:
                details.append("{} 左右同为「{}」但目标值无法解析({!r})，视为未达标".format(prefix, type_keyword, raw_target))
            elif number is None:
                details.append("{} 左右同为「{}」但右侧无数字，视为未达标".format(prefix, type_keyword))
            elif direction is None:
                details.append("{} 左右同为「{}」但识别不出属性方向，视为未达标".format(prefix, type_keyword))
            else:
                reached = number <= target if direction == "越低越好" else number >= target
                details.append("{} 左右同为「{}」，{} 数字={} 目标={} → {}".format(
                    prefix, type_keyword, direction, number, target, "达标" if reached else "未达标"))

            if reached and hit_box is None and len(right_roi) == 4:
                hit_box = (int(right_roi[0]), int(right_roi[1]), int(right_roi[2]), int(right_roi[3]))

        for line in details:
            _log(line)

        summary = "；".join(details) if details else "没有可评估的槽位"

        if hit_box is None:
            _log("两个槽位都不达标，本轮不保存")
            return CustomRecognition.AnalyzeResult(box=None, detail=summary)

        _log("有槽位达标，交给下一节点点保存")
        return CustomRecognition.AnalyzeResult(box=hit_box, detail=summary)


# 右栏槽位文本行 ROI 默认值（实测 dual_slot_locked_state.png：槽1 行 y=350~410，槽2 行 y=420~480）
NO_REFRESH_ROW_DEFAULT = {
    "槽1区": (660, 350, 330, 60),
    "槽2区": (660, 420, 330, 60),
}


@AgentServer.custom_recognition("FamilyTalentDoubleLockCheck")
class FamilyTalentDoubleLockCheck(CustomRecognition):
    """双锁防呆：右栏两个槽位是不是都刷不了（都显示「属性不会刷新」）。

    param:
        {
            "槽1区": [660, 350, 330, 60],   # 右栏槽1(第一行)文本 ROI
            "槽2区": [660, 420, 330, 60],   # 右栏槽2(第二行)文本 ROI
            "最少命中数": 2                  # 判定双锁需要的命中行数（默认 2）
        }

    为什么按行 OCR、不整块右栏一起 OCR（实测 dual_slot_locked_state.png）：
      整块 [660,300,340,180] 送 OCR 只会返回一个盖住整块、score=0.0、text="" 的框
      （detect 把两行并成一块，识别不出任何文字）；按行 [660,350,330,60] 能稳定读出
      「属性不会刷新」(score 0.99)。所以这里每个槽单独 OCR 一次，再数有几行是「不会刷新」类文案。

    锁定后右栏该槽显示「属性不会刷新」，两个槽都显示它 = 一个能刷的槽都没有
    (option「家族天赋刷新槽位」两个框位都没勾时可能锁成这样)。
    命中   = 命中行数 >= 最少命中数 → 由 pipeline 的 next 走安全收尾
             (锁定态下刷新按钮要花钻石，绝不能去点刷新)
    未命中 = 正常情况(0/1 个槽显示) → 交给下一个候选节点「评估属性」
    """

    def analyze(self, context, argv):
        param = _parse_param(argv.custom_recognition_param)
        raw_min_hits = _to_float(param.get("最少命中数"))
        min_hits = int(raw_min_hits) if raw_min_hits is not None else 2

        used_rois = []
        row_texts = {}
        hits = []
        for name in ("槽1", "槽2"):
            roi = param.get("{}区".format(name)) or list(NO_REFRESH_ROW_DEFAULT["{}区".format(name)])
            used_rois.append([int(v) for v in roi])
            texts = _ocr_all_texts(context, argv.image, roi)
            row_texts[name] = texts
            matched = [text for text in texts if _looks_like_no_refresh(text)]
            if matched:
                hits.append({"槽位": name, "文本": matched})

        _log("双锁防呆：逐行文本={!r} 命中行数={} 阈值={}".format(row_texts, len(hits), min_hits))

        if len(hits) >= min_hits:
            x1 = min(r[0] for r in used_rois)
            y1 = min(r[1] for r in used_rois)
            x2 = max(r[0] + r[2] for r in used_rois)
            y2 = max(r[1] + r[3] for r in used_rois)
            return CustomRecognition.AnalyzeResult(
                box=(x1, y1, x2 - x1, y2 - y1),
                detail="两个槽位都显示「属性不会刷新」：没有可刷新的槽位，安全收尾；命中={}".format(hits),
            )

        return CustomRecognition.AnalyzeResult(
            box=None,
            detail="未出现双锁(命中行数={}/{}，逐行文本={})".format(len(hits), min_hits, row_texts),
        )
