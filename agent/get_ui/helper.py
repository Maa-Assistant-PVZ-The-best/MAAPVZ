# -*- coding: utf-8 -*-
"""
================================================================================
get_ui/helper.py — 工具库
================================================================================

职责：把"读设备界面"这件事拆成小函数，每个只干一件事：

    dump_ui_tree()        读屏幕 → 控件列表（list[DumpNode]）      【控件树通道】
    find_topmost()        从列表里挑目标（关键词 + 排序 + 序号）
    find_window_frames()  读系统窗口列表 → 窗口框列表               【窗口通道】
    maa_scale()           算坐标比例（设备像素 → MAA 空间）
    frame_to_maa()        物理像素框 → MAA 认的 (x, y, w, h)
    to_maa_rect()         控件的 bounds → MAA 框（frame_to_maa 的控件版）

调用链（记住这一条线，全库就懂了）：
    屏幕 → dump_ui_tree → find_topmost → to_maa_rect → box
    系统 → dumpsys     → find_window_frames → frame_to_maa → box   （win: 前缀走这条）

本文件不注册任何 MAA 节点，它是纯工具。注册在同包的 nodes.py。
================================================================================
"""
from __future__ import annotations

import re                        # 正则：从 "[1700,100][1784,184]" 这种字符串里抠数字
import time                      # 重试前睡一会儿用
import xml.etree.ElementTree as ET   # 解析 uiautomator 吐出的 XML
from dataclasses import dataclass    # 让"定义一个数据类"少写很多样板代码
from typing import Any, Optional

# dump 出来的 XML 先存到设备这个路径，再读回来。_mini_ 前缀是为了不和别的 dump 文件搞混
DUMP_PATH = "/sdcard/_mini_dump.xml"

# 预编译正则：匹配 "[数字,数字][数字,数字]"，抓出 4 个整数
# 控件位置在 XML 里长这样：bounds="[1319,292][1403,376]"
_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")

# 窗口位置正则：dumpsys 输出里长这样：frame=[260,0][351,91]
# 坐标可为负：悬浮球半隐藏在屏幕边缘时 frame=[-52,218][53,323]，\d+ 会漏匹配并错抓下一窗口
_FRAME_RE = re.compile(r"frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


# ==============================================================================
# 数据结构：一个 DumpNode = 屏幕上一个控件
# ==============================================================================

@dataclass
class DumpNode:
    """屏幕上的一个控件（按钮/图片/文字……）。

    @dataclass 是 Python 的装饰器：写上它，Python 自动帮你生成
    __init__(self, resource_id, cls, ...) 这些构造函数代码，
    你只需要列出字段名和类型。

    bounds 是 (x1, y1, x2, y2)：左上角 + 右下角，单位是【设备物理像素】。
    """
    resource_id: str                     # 资源 id，如 "xxx:id/close_image"（找关闭钮的主力线索）
    cls: str                             # 控件类型，如 "android.widget.ImageView"
    desc: str                            # 无障碍描述（content-desc），如 "关闭"、"跳过 5s"
    text: str                            # 控件上显示的文字
    bounds: tuple[int, int, int, int]    # 位置
    clickable: bool                      # 能不能点（找按钮时只要 True 的）
    checked: bool                        # 勾选框状态（"今日不再展示"那种）
    package: str                         # 属于哪个应用（包名）

    @property
    def center(self) -> tuple[int, int]:
        """包围盒中心点。@property 让 n.center 像属性一样用，实际是个函数。"""
        x1, y1, x2, y2 = self.bounds
        return ((x1 + x2) // 2, (y1 + y2) // 2)

    @property
    def short_id(self) -> str:
        """短 id："xxx:id/close_image" → "close_image"，日志里好看。"""
        return self.resource_id.split("/")[-1] if "/" in self.resource_id else self.resource_id


def _to_node(el: ET.Element) -> DumpNode:
    """把 XML 里的一个 <node> 元素变成 DumpNode（下划线开头 = 内部函数，外面别直接用）。"""
    m = _BOUNDS_RE.search(el.get("bounds", ""))          # el.get("属性名", 默认值) 读 XML 属性
    bounds = tuple(int(g) for g in m.groups()) if m else (0, 0, 0, 0)
    return DumpNode(
        resource_id=el.get("resource-id", ""),
        cls=el.get("class", ""),
        desc=el.get("content-desc", ""),
        text=el.get("text", ""),
        bounds=bounds,  # type: ignore[arg-type]
        clickable=el.get("clickable", "false") == "true",   # XML 里是字符串 "true"/"false"，转成布尔
        checked=el.get("checked", "false") == "true",
        package=el.get("package", ""),
    )


# ==============================================================================
# 通用小工具：面积 / 排序 / 按序号挑选
# ==============================================================================

def _area_of_rect(rect: tuple[int, int, int, int]) -> int:
    """(x1,y1,x2,y2) 框的面积 = 宽×高。控件 bounds 和窗口 frame 通用。"""
    return (rect[2] - rect[0]) * (rect[3] - rect[1])


def _sort_by_area(areas: list, sort: Optional[str]) -> None:
    """按面积原地排序。"min"=小的在前，"max"=大的在前，其它值不动。

    areas 里的元素可以是 DumpNode（取 .bounds）也可以是裸 frame 元组——
    用 key 函数统一取出各自的框再算面积。
    """
    def area_of(item) -> int:
        # 鸭子类型：不问"你是不是 DumpNode"，只问"你有没有 bounds"
        # （isinstance 跨模块会失效——测试夹具的 DumpNode 来自另一个文件）
        rect = getattr(item, "bounds", item)
        return _area_of_rect(rect)

    if sort == "min":
        areas.sort(key=area_of)                    # 升序：最小的是第 1 个
    elif sort == "max":
        areas.sort(key=area_of, reverse=True)      # 降序：最大的是第 1 个


def _pick_index(items: list, index: Any, default: Optional[Any]) -> Optional[Any]:
    """按序号挑选（序号从 1 开始，符合人的习惯）。

    index 没给 → 返回 default（调用方决定默认拿哪个）。
    index 越界或不是数字 → None（识别失败，安全）。
    """
    if not items:
        return None
    if index is None:
        return default
    try:
        i = int(index)
    except (TypeError, ValueError):
        return None
    return items[i - 1] if 1 <= i <= len(items) else None


# ==============================================================================
# 函数①：读屏幕（控件树通道）
# ==============================================================================

def dump_ui_tree(controller, retries: int = 2) -> list[DumpNode]:
    """抓取当前屏幕（焦点窗口）的控件树，返回控件列表。

    参数 controller 是 MAA 给的"设备遥控器"——它能让你在设备上跑命令、点屏幕。
    这一句 shell 干两件事（分号连接）：
      uiautomator dump 文件 >/dev/null 2>&1   → 把当前界面结构存成 XML 文件
      cat 文件                                 → 把文件内容读出来（这才是我们要的）
    post_shell(cmd).get(wait=True)：发命令并【等它跑完】，拿回全部输出文字。

    失败会重试 retries 次（设备忙时偶尔拿到半截 XML），还不行就抛 RuntimeError。
    """
    cmd = f"uiautomator dump {DUMP_PATH} >/dev/null 2>&1; cat {DUMP_PATH}"
    last_err = "no output"
    for _ in range(retries + 1):                 # range(3)：最多试 3 次
        out = controller.post_shell(cmd).get(wait=True) or ""
        start = out.find("<")                    # XML 一定以 "<" 开头，先粗校验
        if start >= 0:
            try:
                root = ET.fromstring(out[start:])            # 解析 XML
                return [_to_node(el) for el in root.iter("node")]   # 每个 <node> → DumpNode
            except ET.ParseError as exc:
                last_err = str(exc)
        time.sleep(0.3)
    raise RuntimeError(f"uiautomator dump 解析失败: {last_err}")


# ==============================================================================
# 函数②：挑目标（本包唯一的"识别逻辑"）
# ==============================================================================

def find_topmost(nodes: list[DumpNode], keyword: Optional[str] = None,
                 clickable: bool = True,
                 sort: Optional[str] = None,
                 index: Optional[Any] = None) -> Optional[DumpNode]:
    """从控件列表里挑一个匹配控件。没找到返回 None。

    keyword 支持前缀指定"在哪个字段找"：
      "close"      → 不带前缀：id / desc / text 三个字段任一命中即可
      "id:close"   → 只在 resource_id 里找
      "desc:跳过"  → 只在 desc 里找（适合"跳过 5s"这种倒计时，子串匹配）
      "text:领取"  → 只在 text 里找
      ""（空）     → ★ 不做文字匹配，全部可点控件都是候选（配 sort/index 选目标）。
                     适用：小米渠道悬浮球这类"无 id 无文字、但当时屏幕上唯一可点"的控件。
                     注意：复杂界面慎用——候选 = 全部可点控件，选错会误点。

    clickable=True 过滤掉纯图片和纯容器（只留真能点的）。

    命中多个时怎么选：
      sort   "min"=按面积小的在前，"max"=大的在前；不给 = 保持树序（屏幕叠放序）
      index  序号（从 1 开始）：排序后选第几个；
             不给 = 选树序最后一个（= 屏幕最上层，历史默认行为）
    """
    # ---- 解析前缀："desc:跳过" → 只在 desc 字段找 "跳过" ----
    field = None                                   # None = 不带前缀，三字段都找
    if keyword:
        for prefix, attr in (("id:", "resource_id"), ("desc:", "desc"), ("text:", "text")):
            if keyword.startswith(prefix):             # startswith：字符串以什么开头
                field = attr                           # 记住要找哪个字段
                keyword = keyword[len(prefix):]        # 把前缀切掉，留下真正的关键词
                break

    hits = []
    for n in nodes:
        if clickable and not n.clickable:
            continue                               # 不可点的不要
        if keyword:
            if field is not None:
                # 指定了字段：getattr(n, 字段名) 按名字取属性，只在这一个字段里找
                if keyword not in getattr(n, field):
                    continue
            elif keyword not in n.resource_id and keyword not in n.desc and keyword not in n.text:
                continue                               # 没带前缀：三字段任一不命中就跳过
        hits.append(n)

    _sort_by_area(hits, sort)                      # 给了 sort 才排序，不给保持树序
    return _pick_index(hits, index, default=(hits[-1] if hits else None))


# ==============================================================================
# 函数③：窗口通道（win: 前缀用）——找悬浮球这类"独立窗口"
# ==============================================================================

def _parse_window_frames(dumpsys_text: str, keyword: str) -> list[tuple[int, int, int, int]]:
    """在 dumpsys 文本里找【所有】标题含 keyword 的窗口的 frame（同名窗口可能有多个）。

    单独拆出来是为了能离线测试（喂假文本，不连设备）。
    原理：按 "Window #" 切块；关键词只认块的【标题行】——WindowStateAnimator 行
    也含窗口名，在那里命中会错抓下一个窗口的 frame（实测复现）。
    块内第一个 frame= 即本窗口的（Frames: 行）。
    """
    frames = []
    for block in re.split(r"\n(?=  Window #)", dumpsys_text):
        head = block.split("\n", 1)[0]                       # 块首行 = 窗口标题行
        if keyword not in head:                              # Animator 行命中不算
            continue
        m = _FRAME_RE.search(block)                          # 块内第一个 frame 即本窗口
        if m:
            frames.append(tuple(int(g) for g in m.groups()))  # type: ignore[arg-type]
    return frames


def find_window_frames(controller, keyword: str) -> list[tuple[int, int, int, int]]:
    """dumpsys 通道：在全系统窗口列表里找标题含 keyword 的窗口，返回物理像素框列表。

    为什么需要它：悬浮球这类【独立窗口】不在 uiautomator 控件树里
    （dump 只读"焦点窗口"），只能用 dumpsys 这条通道。
    注意：它只能给窗口的位置，窗口内部有什么控件看不见。
    找不到返回空列表。列表顺序 = dumpsys 窗口顺序（≈ 层叠序，上层在前）。
    """
    # 全量取回：窗口标题行到 Frames 行实测有 21 行，grep -A 20 会截断（悬浮球的 frame 直接被切掉）。
    # dumpsys 全文仅几十 KB，一次取回无压力；解析按窗口块切分（见 _parse_window_frames），
    # 不依赖 grep 上下文，也不赌设备上 grep 对 -A 的支持。
    out = controller.post_shell(
        "dumpsys window windows"
    ).get(wait=True) or ""
    return _parse_window_frames(out, keyword)


# ==============================================================================
# 函数④：坐标换算
# ==============================================================================

def maa_scale(controller, image: Any = None) -> tuple[float, float]:
    """算比例：MAA 截图尺寸 ÷ 设备物理尺寸。

    为什么要换算：dump 给的坐标是设备物理像素（如 1920×1080），
    而 MAA 的点击用的是截图缩放后的坐标（如 1280×720），两者差 1.5 倍。
    运行时现算，不写死，换分辨率的设备也能用。

    image：识别回调里 MAA 递进来的当前截图（numpy 数组，shape=(高,宽,3)）。
    """
    rw, rh = controller.resolution                 # 设备物理分辨率，如 (1920, 1080)
    if rw <= 0 or rh <= 0:                         # 还没初始化就先截一帧逼它初始化
        controller.post_screencap().wait()
        rw, rh = controller.resolution
    if image is not None:
        ih, iw = int(image.shape[0]), int(image.shape[1])     # 截图尺寸，如 720, 1280
    else:
        img = controller.cached_image              # 没有现成截图就用框架缓存的
        ih, iw = int(img.shape[0]), int(img.shape[1])
    if rw <= 0 or rh <= 0 or iw <= 0 or ih <= 0:
        raise RuntimeError(f"无法确定分辨率换算比例: raw=({rw},{rh}) img=({iw},{ih})")
    return iw / rw, ih / rh                        # 如 1280/1920 = 0.667


def frame_to_maa(controller, frame: tuple[int, int, int, int], image: Any = None) -> tuple[int, int, int, int]:
    """物理像素 (x1, y1, x2, y2) → MAA 空间 (x, y, 宽, 高)。窗口框和控件框通用。"""
    sx, sy = maa_scale(controller, image)
    x1, y1, x2, y2 = frame
    # 悬浮球半隐藏在屏幕边缘时 frame 越界（如 x1=-52）：几何中心落在屏幕外/最边缘会点不中，
    # 且 MAA 侧不允许负坐标。钳到屏幕内，让点击中心 = 可见部分的中心。
    rw, rh = controller.resolution
    if rw > 0 and rh > 0:
        x1, x2 = max(0, x1), min(rw, x2)
        y1, y2 = max(0, y1), min(rh, y2)
    return (int(x1 * sx), int(y1 * sy), int((x2 - x1) * sx), int((y2 - y1) * sy))


def to_maa_rect(controller, node: DumpNode, image: Any = None) -> tuple[int, int, int, int]:
    """把控件的 bounds（物理像素）换算成 MAA 空间的 (x, y, 宽, 高)。

    这个四元组就是要返回给 MAA 的 box——MAA 拿到它会自动换算出点击中心点。
    """
    return frame_to_maa(controller, node.bounds, image)


def valid_box(box: Any) -> bool:
    """box 是否有效：必须存在且宽、高都 > 0。

    空结果一律视为【没识别到】，否则 MAA 会拿 (x,y,0,0) 去点 → 误点屏幕角落：
      - 窗口通道：隐藏/已销毁窗口的 frame 可能是 [0,0][0,0]，钳制后也可能宽0高0
      - 控件树通道：uiautomator 偶发给出 bounds="[0,0][0,0]" 的可点节点
    """
    return box is not None and box[2] > 0 and box[3] > 0
