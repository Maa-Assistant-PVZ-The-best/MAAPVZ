# -*- coding: utf-8 -*-
"""get_ui 窗口通道离线自测（不连设备）。

    python agent/get_ui/selftest.py

fixture 来自 2026-10 真机抓到的应用宝渠道悬浮球窗口块：
  - frame 含负坐标 [-52,218][53,323]（半隐藏在左边缘）
  - 同一窗口名在 Window 行与 WindowStateAnimator 行各出现一次（重复命中陷阱）
  - 紧跟一个全屏正坐标窗口（错抓陷阱）
"""
import sys
from pathlib import Path

# 直接 import 同包 helper（纯工具模块，不依赖 maa）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helper import _FRAME_RE, _parse_window_frames, frame_to_maa  # noqa: E402
from helper import DumpNode, find_topmost, valid_box  # noqa: E402

# ---- 真实 fixture（逐行保留关键结构；注意 dumpsys 里 "  Window #" 标题行有两个前导空格）----
DUMP = """  Window #4 Window{36e6808 u0 ShellDropTarget}:
    mHasSurface=true isReadyForDisplay()=true
    Frames: parent=[0,0][1920,1080] display=[0,0][1920,1080] frame=[0,0][1920,64] last=[0,0][1920,64] insetsChanged=false
  Window #5 Window{f1f95fa u0 Panel:com.tencent.tmgp.pvz2hdtxyyb/com.popcap.pvz2cthddev.SexyAppActivity}:
    mOwnerUid=10078 showForAllUsers=false package=com.tencent.tmgp.pvz2hdtxyyb appop=NONE
    mAttrs={(-52,218)(105x105) gr=TOP LEFT CENTER ty=APPLICATION_PANEL fmt=TRANSLUCENT
      fl=NOT_FOCUSABLE NOT_TOUCH_MODAL LAYOUT_NO_LIMITS}
    mHasSurface=true isReadyForDisplay()=true
    Frames: parent=[0,0][1920,1080] display=[-100000,-100000][100000,100000] frame=[-52,218][53,323] last=[-52,218][53,323] insetsChanged=false
    WindowStateAnimator{3813cdf Panel:com.tencent.tmgp.pvz2hdtxyyb/com.popcap.pvz2cthddev.SexyAppActivity}:
    mSurface=Surface(name=Panel:com.tencent.tmgp.pvz2hdtxyyb)/@0x20d0d2c
  Window #6 Window{c34b0d7 u0 InputMethod}:
    mHasSurface=true isReadyForDisplay()=true
    Frames: parent=[0,0][1920,1080] display=[0,0][1920,1080] frame=[0,0][1920,1080] last=[0,0][1920,1080] insetsChanged=false
"""

# 双 Panel 场景：悬浮球 + 一个广告面板（验证同名窗口各出一帧、顺序保持、面积可分）
DUMP_TWO_PANELS = DUMP.replace(
    "  Window #6",
    """  Window #55 Window{aaa1111 u0 Panel:com.tencent.tmgp.pvz2hdtxyyb/com.popcap.pvz2cthddev.SexyAppActivity}:
    mAttrs={(400,200)(800x400) ty=APPLICATION_PANEL fmt=TRANSLUCENT fl=FOCUSABLE}
    Frames: parent=[0,0][1920,1080] display=[0,0][1920,1080] frame=[400,200][1200,600] last=[400,200][1200,600] insetsChanged=false
  Window #6""",
)

failures = []


def check(name: str, cond: bool, extra: str = ""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" | {extra}" if extra else ""))
    if not cond:
        failures.append(name)


print("== 1. 负坐标悬浮球：命中且只命中一次，不抢下一窗口 ==")
frames = _parse_window_frames(DUMP, "Panel:com.tencent.tmgp.pvz2hdtxyyb")
check("恰好一帧", len(frames) == 1, f"frames={frames}")
check("frame 正确", frames == [(-52, 218, 53, 323)])
check("不含 InputMethod 全屏框", (0, 0, 1920, 1080) not in frames)

print("== 2. 短关键词 win:Panel: 同名多窗口 ==")
frames2 = _parse_window_frames(DUMP_TWO_PANELS, "Panel:")
check("两帧", len(frames2) == 2, f"frames={frames2}")
check("顺序保持（球在前）", frames2[0] == (-52, 218, 53, 323) if len(frames2) == 2 else False)
areas = sorted((f[2] - f[0]) * (f[3] - f[1]) for f in frames2)
check("面积升序首个是球", areas and areas[0] == 105 * 105, f"areas={areas}")

print("== 3. 正坐标窗口不受影响（回归） ==")
frames3 = _parse_window_frames(DUMP, "InputMethod")
check("全屏框正确", frames3 == [(0, 0, 1920, 1080)], f"frames={frames3}")

print("== 4. frame_to_maa 钳制非负 ==")


class _FakeCtrl:
    resolution = (1920, 1080)


class _FakeImg:
    shape = (720, 1280, 3)


box = frame_to_maa(_FakeCtrl(), (-52, 218, 53, 323), image=_FakeImg())
check("box = (0,145,35,70)", box == (0, 145, 35, 70), f"box={box}")
check("box 非负", box[0] >= 0 and box[1] >= 0 and box[2] > 0 and box[3] > 0)
box2 = frame_to_maa(_FakeCtrl(), (100, 100, 300, 220), image=_FakeImg())
check("不越界窗口恒等", box2 == (66, 66, 133, 80), f"box2={box2}")

print("== 5. 正则本身 ==")
check("负坐标能匹配", _FRAME_RE.search("frame=[-52,218][53,323]") is not None)
check("不匹配 mFrame=", _FRAME_RE.search("mFrame=[1,2][3,4]") is None)

print("== 6. 控件树通道：空关键词 = 全部可点控件（小米悬浮球场景） ==")


def _mk(bounds, clickable=True, rid="", desc="", text="", checked=False, pkg="com.x"):
    return DumpNode(resource_id=rid, cls="android.view.View", desc=desc, text=text,
                    bounds=bounds, clickable=clickable, checked=checked, package=pkg)


# 小米球：无 id/desc/text 的唯一可点控件 [0,499,154,653]（侦察镜实测数据）
XIAOMI_TREE = [
    _mk([0, 0, 1920, 1080], clickable=False),                     # 根容器
    _mk([0, 499, 154, 653]),                                      # ← 悬浮球（唯一可点）
    _mk([500, 300, 900, 600], clickable=False, text="游戏画面"),   # 不可点内容
]
n = find_topmost(XIAOMI_TREE, "", sort="min", index=1)
check("空关键词命中唯一可点", n is not None and tuple(n.bounds) == (0, 499, 154, 653),
      f"bounds={n.bounds if n else None}")

# 回归：文字匹配不受影响
TREE2 = XIAOMI_TREE + [
    _mk([800, 400, 1100, 500], rid="com.x:id/confirm", text="确定"),
    _mk([100, 100, 200, 160], desc="关闭"),
]
n = find_topmost(TREE2, "text:确定")
check("text: 前缀仍工作", n is not None and "确定" in n.text)
n = find_topmost(TREE2, "关闭")
check("三字段兜底仍工作", n is not None and n.desc == "关闭")
n = find_topmost(TREE2, "", sort="max", index=1)
check("空关键词+sort:max 选最大可点", n is not None and tuple(n.bounds) == (800, 400, 1100, 500),
      f"bounds={n.bounds if n else None}")
check("不匹配返回 None", find_topmost(TREE2, "不存在的东西") is None)

print("== 7. valid_box：空结果视为没识别到 ==")
check("None 无效", not valid_box(None))
check("零宽无效", not valid_box((10, 10, 0, 5)))
check("零高无效", not valid_box((10, 10, 5, 0)))
check("全零无效", not valid_box((0, 0, 0, 0)))
check("正常 box 有效", valid_box((0, 145, 35, 70)))
# 越界窗口钳制后宽变 0 → 也应判无效（球被完全拖出屏幕的场景）
box_empty = frame_to_maa(_FakeCtrl(), (-200, 218, -120, 323), image=_FakeImg())
check("完全在屏外的窗口钳制后无效", not valid_box(box_empty), f"box={box_empty}")

print()
if failures:
    print(f"失败 {len(failures)} 项: {failures}")
    sys.exit(1)
print("全部通过")
