import json
import time
import os
import re
import math
import random
from maa.custom_action import CustomAction
from maa.context import Context
from maa.agent.agent_server import AgentServer

# 直接识别能力（OCR）。maa.pipeline 里提供 JRecognitionType / JOCR，
# Context.run_recognition_direct() 可无节点地执行一次识别。若当前安装版本不支持则降级为不识别。
try:
    from maa.pipeline import JRecognitionType, JOCR
    _DIRECT_RECOGNITION = True
except Exception:
    _DIRECT_RECOGNITION = False

# 加载标记：用于确认 MAA 代理实际加载的版本（重载插件后应看到本行）
print("[BatchSwipe] batch_swipe.py 已加载 · 版本 v19（watch/ref/gateref(定点守卫)/guard(触点或滑动路径进区域先识别节点)/roi(键名)/every(N或block,块末识别)/fixed(N或block,含多指)/固定动作前先识别/权重@N/异步组{!…}/附属块attach/多指动作multi/无间隔块「」/连击*n/断点续做(动作级·顺序块级·只在本次任务内)）")


@AgentServer.custom_action("BatchSwipe")
class BatchSwipe(CustomAction):
    """批量滑动/点击自定义动作。

    参数（custom_action_param）除原有 swipe/click/sleep 与随机块语法外，新增：
        watch:文本A|文本B   —— OCR 触发：出现任一文本即停止并跟随 next（识别区域用下方 roi 或全屏）。
        watch:文本@@roi:盒1|盒2 —— OCR 触发并自带一个/多个识别区域（每个盒可为 x,y,w,h 或坐标表键名）。
        watch:@@roi:盒1|盒2@@compare:<=900 —— OCR 数值对比：识别区域里的数字并按表达式比较（无需认文字），成立才触发。
        watch:@@roi:盒A|盒B@@compare:$1<$0 —— 多区域比较：分别 OCR 每个区域取数字，用 $i 引用第 i+1 个区域，比较成立才触发（如 $1<$0 表示 区域2数字 < 区域1数字）。
        ref:节点名A|节点名B  —— 引用触发：复用这几个 pipeline 节点里已定义的 recognition（OCR/ColorMatch/TemplateMatch…），任一命中即停止并跟随 next。
                              节点名后可加 @inv（如 ref:节点A@inv）：把该节点的命中结果再反转一次，用于 inverse:true 的节点（取“正向出现”语义）。
gateref:节点名A|节点名B —— 定点守卫：走到这个位置就识别一次，任一命中即停止剩余动作并跟随 next
 （与 ref 全局触发不同：只在它所在位置检查；不占动作计数/识别点/间隔。用途：误触跳屏防护）。
guard:节点A|节点B@@roi:盒1|盒2 —— 区域守卫声明：click/swipe/multi 的触点或滑动路径（每 ~24px 采样）
 碰到这些区域时，执行该动作前先跑这些节点的识别，命中即停止剩余动作并跟随 next（可声明多个）。
        roi:盒1|盒2         —— 可选，全局识别范围（多个盒，每个盒可为 x,y,w,h 或坐标表键名），作用于所有未自带区域的 watch。缺省为全屏。
        every:N             —— 可选，每 N 个动作识别一次（默认 1 = 每个动作后都识别）。输入 3 表示每 3 个动作识别一次。
        every:block         —— 可选，**每个顺序块结束后**识别一次（块末 = 顺序块最后一个动作做完、固定动作之前）。
                               「顺序块」的定义与 fixed:block 完全一致（空随机块 {} / 随机块 {…} / 异步组 {!…} / 附属块 attach:(…) 都是分界）。
                               只写 every:block 时不再按动作点识别；需要「每 N 个动作 + 每个顺序块结束」都认，
                               就两个都写（every:3;every:block），识别点 = 两者的并集。
                               ⚠️ every:block 的识别点正好落在「固定动作之前」，所以和 fixed:block 一起用时
                                  命中会先停本批、不执行这次固定动作（这就是「出 next」最想看到的行为）。
        fixed:N:动作         —— 可选，固定动作：每执行 N 个普通动作就额外执行一次「动作」（不占 N 的计数）。动作可为 swipe/click/sleep/multi。
                            例：fixed:5:swipe:收取按钮,收取框,50（每 5 个动作后滑一次收取）；fixed:3:click:确认按钮（每 3 个动作点一次确认）。
                            多指也可当固定动作（走原生 MultiSwipe 真并发）：
                            例：fixed:4:multi:(1阳光起始点,1阳光终点,80;2阳光起始点,2阳光终点,80)
                            说明：fixed 与 every 独立计数；识别命中会先中断（不补执行 fixed）。N 为 0 或负数按 1 处理。
                            ⚠️ every:N>1 时识别点不落在固定动作那一步，所以**执行固定动作前会再识别一次**：
                               命中就不执行这次固定动作，直接停止本批、跟随 next（避免「早该跳 next 了还多做一下」）。
        fixed:block:动作     —— 固定动作的**另一种触发方式**：每个「顺序块」结束后执行一次「动作」（同样不占 N 的计数、不参与识别点）。
                            「顺序块」= 参数里被 空随机块 {} / 随机块 {…} / 异步组 {!…} / 附属块 attach:(…) 隔开的一段顺序动作；
                            最后一段顺序动作跑完（本批次结束前）也会执行一次。
                            单个 {} 就是一道分界，所以 A;B;{};C;D 是「两个顺序块」→ 共执行 2 次（B 之后一次、D 之后一次）。
                            例：swipe:种,格;swipe:种,格;{};swipe:收,框;fixed:block:click:确认（每跑完一个顺序块点一次确认）
                            说明：随机块 {…} 本身不算顺序块（它结束时不触发）；block 与 every:N 只能二选一。
        @N 权重              —— 在随机块 / 随机池的元素末尾加 @数字（如 {swipe:a,b@2;swipe:c,d@5} 块内随机；{块A}@3;{块B}@1 块间池随机）。
                            权重越大越可能被排到前面（加权随机，默认 1）。仅对「参与随机」的元素有效，顺序执行的元素忽略。
        {!动作;动作;…}      —— 异步组：整组动作「提交后不等待」连续压入控制器队列，组内**有序**（不打乱），
                            组内默认**不插入动作间隔**。退出组后自动恢复同步，并在这三处强制排空（等全部做完）：
                              ① 识别点（every:N / 开始前 / watch|ref）截图之前
                              ② 遇到同步动作（含 sleep、fixed）之前
                              ③ 本批次 return 之前
                            组内可自带间隔：{!@0.02;swipe:a,b;swipe:c,d}（组内动作间隔 0.02 秒）。
                            例：…;{!swipe:1阳光起始点,1阳光终点;swipe:2阳光起始点,2阳光终点};swipe:收,框,50;…
                            ⚠️ 重要实测结论（MaaFw 5.10.4 / AdbShell 输入法 / x86_64 设备）：
                              控制器动作队列是**串行**的。5 个 duration=300 的 swipe，无论
                              同步逐个 wait、异步连续提交、还是把 contact 换成 0~4，
                              完成时刻都是 333ms 等距的严格串行，总耗时完全一样。
                              即：**异步 ≠ 并发**，它只让 Python 侧不阻塞 + 去掉组内间隔，
                              不会让 5 个滑动在设备上同时执行。去掉组内间隔会让设备背靠背收到手势，
                              若游戏需要「手势结算间隔」，请给组内加 @0.05~@0.1，否则会退回
                              「只有最后一个动作生效」的老问题。
        「动作;动作;…」     —— **无间隔包裹块**：块内动作之间**不插动作间隔**（默认的 0.1s 和 @前缀都不插），
                              背靠背逐个同步执行（每个动作仍 wait 完成再发下一个，比异步组安全）；
                              块首之前、块末之后仍按正常间隔。
                              例：swipe:a,b;「click:x;click:y」;swipe:c,d —— x、y 两下点击之间没有间隔。
                              计数：块内每个动作仍各算 1 个动作（every:N / fixed:N / resume 粒度不变），
                              但落在组中间的识别点和固定动作会**挪到组末补做**，不拆组。
                              随机块 {…} 里也可用：「…」作为**整体**参与打乱（组内顺序固定）。
                              ⚠️ 块内不支持嵌套 {} 随机块 / {!…} 异步组（会报错，不会静默错跑）。
                              ⚠️ 次间零间隔是它的意义；游戏若需要「每次操作的结算间隔」，
                                 块内靠后的动作可能不生效——那种情况请改用普通顺序动作。
        动作*n              —— **连击后缀**：任何动作（swipe/click/sleep/multi）末尾加 *n（n≥2），
                              该动作连续执行 n 次、次间**不插间隔**，整体算 1 个动作
                              （占 every:N 计数的 1、断点续做的 1 步；间隔只在 n 次全做完后插一次）。
                              例：click:确认按钮*3（连点 3 次）；swipe:起点,终点,80*2（同一滑动连做 2 次）。
                              可与「」搭配：「click:a*2;click:b*3」—— 组内无间隔 + 组内动作各自连击。
                              配置类 token（watch/ref/every/fixed…）不支持 *n，会告警并忽略；
                              无间隔块整体也不支持（块内动作可以各自带 *n）。
                              随机块里要和权重共存时，顺序是 动作*n@权重（如 click:a*3@2）。
                              ⚠️ 连击内部没有间隔是它存在的意义；游戏若需要「每次点击的结算间隔」，
                                 请改用 n 个普通动作（让默认间隔生效），不要用 *n。
        multi:(起点1,终点1,时长1;起点2,终点2,时长2;…)
                            —— **多指动作**：和 swipe/click/sleep 同级的一种动作，一个动作描述 N 根手指。
                              走原生 MultiSwipe（context.run_action），N 根手指**真正同时**按下/移动/抬起。
                              实测 5 指可在 1ms 内同时按下。时长可省略（默认 100ms）。
                              例：multi:(1阳光起始点,1阳光终点,80;2阳光起始点,2阳光终点,80)
                              环境不支持 run_action 时会自动退化为「逐根手指串行滑动」，不丢动作。
        attach:动作         —— 附属块。**像顺序块一样摆在序列里的某个位置**：
        attach:(动作;动作;…)   主块走到这个位置时，它才和「紧跟在后面的动作」一起执行（默认一一对应）。
                              不占用主块的 every:N 计数、不触发 fixed、不计入 resume 进度，
                              因此不会打乱主块原有的节奏与识别点。
                              起始位置默认**由它在参数里的位置自动决定**（前面有几个可执行动作），
                              也可以用 attach_start:N 手动指定。主块跑完后若还有剩余附属动作，会在末尾补齐。
        attach_every:N      —— 节奏：每 N 个主块动作配 1 个附属动作（默认 1 = 与后面的块一一对应）。
        attach_start:N      —— 手动指定从第 N 个主块动作（1 起算）开始配；不写就按位置自动推导。
                              例：…;swipe:A;swipe:B;{};attach:(swipe:S1;swipe:S2);{};swipe:C;swipe:D;…
                              表示 A、B 正常跑，跑到第 3 个动作（C）时，S1 与 C 同时、S2 与 D 同时。
        attach_mode:merge   —— 执行方式（默认 merge）：
                              merge  = 把「主块动作 + 附属动作」合成**一个多指 MultiSwipe**，
                                       两根手指真正同时动（实测 5 指可在 1ms 内同时按下/抬起）。
                                       例：主块在拖植物去格子时，另一指同时在别处滑走阳光。
                              insert = 附属动作紧跟主块动作之后串行执行（最保险，但不会更快）。
                              以下情况自动退化为 insert（不丢动作）：动作不是 swipe/click（如 sleep）、
                              主块动作在 {!…} 异步组里、或 run_action 不可用/执行失败。
        例（种植全程顺带领阳光）：
            …;attach:(swipe:1阳光起始点,1阳光终点;swipe:2阳光起始点,2阳光终点;swipe:3阳光起始点,3阳光终点);attach_every:4;every:5;resume
        ⚠️ merge 的两个前提：① 输入法必须是 Minitouch（maa_pi_config.json 里 "input":"3"，
              已实测：默认值会退化到 AdbShell，多指静默失效）；② 走 context.run_action + 原生 MultiSwipe。
              另外「一指拖植物 + 一指领阳光」游戏端是否接受，需要实机确认；
              若发现种植失败，把 attach_mode 改成 insert。
        resume              —— 可选，断点续做：**精确到「第几个顺序块的第几个动作」**。
                               ★ 生效范围：**只在当前这次任务运行（也就是当前这条 next 链）里**。
                                 MAA 每次「开始任务 / 重新开启任务」都会 post 一个新任务（新的 task_id），
                                 一旦换了任务，上一轮留下的断点进度**全部作废**，本节点从第 1 个动作重新开始。
                                 同一任务内被 next 链绕回来（比如触发命中→走了 next→过一会儿又回到这个节点），
                                 才会从上次断掉的那个动作继续。进度只放在内存里，**不生成任何文件**。
                               语义（关键）：进度记的是「**还没做完的那个动作**」——
                               我在 5 个动作的顺序块的第 2 个动作断掉，下次回来就从第 2 个动作重做，
                               不会跳到第 3 个，也不会退回第 1 个。具体：
                                 · 动作发出去一半就被打断（任务被杀 / 崩溃）→ 从那个动作重做；
                                 · 做完某动作后「识别触发」命中而停批（要走 next）→ 也从那个动作重做
                                   （因为它很可能没被游戏结算，重做一次最稳）；
                                 · 前面的动作照常跳过，随机块沿用上次洗牌后的顺序（不会重排打乱进度）。
                               日志会明说续在哪里，例如：
                                 [BatchSwipe] ⏯ 断点续做：上次断在 第 1 个顺序块的第 2 个动作（全程第 2 个），
                                              本次从 第 1 个顺序块的第 2 个动作（全程第 2 个）继续（已完成 1/5）
                               （旧参数里的 resume:disk 仍能读，但已经不会落盘了 —— 重新开任务照样从头开始。）
        reset               —— 可选，清除该节点的断点进度（只在当前任务内有效）。
        watch / ref 可各放多个（即多状态/多触发），任一命中即触发；不配置时行为与原来完全一致。
        说明：roi 里的“盒”既可直接写数字 x,y,w,h，也可写坐标表(索引 JSON)里的键名（该键值为 [x,y,w,h] 时做识别区域）。
             文件路径（如 load_coords）会自动兼容“Agent 启动后工作目录切到 agent”的情况：相对路径先在当前目录找，找不到再按插件脚本所在目录回退。
    示例：
        swipe:a,b;watch:已领取|集齐;ref:地宫2_后期_识别鬼火并种植;roi:识别框|300,400,200,100;every:3;fixed:5:click:确认按钮
    """

    COORDS = {}
    # 每个动作之间的默认间隔（秒）。可由 custom_action_param 前缀 "@0.3;" 覆盖，未设置时用此值。
    INTERVAL = 0.1
    # 断点续做进度：**只在当前这次任务运行内有效，而且只在内存里**（不生成任何文件）
    # {节点名: {'v':2,'sig':批次签名,'order':动作列表,'done':已完成数,…}}
    _PROGRESS = {}
    # 当前任务的标识（task_id + 入口名）。一变就说明「重新开了任务」→ 上一轮进度全部作废。
    _TASK_KEY = None


    @classmethod
    def load_coords(cls, filepath: str):
        """从 JSON 文件加载坐标映射（索引）。文件格式：{"键名": [x, y] 或 [x, y, w, h] 或 {"x":x,"y":y,"w":w,"h":h}}

        [x, y]        = 单个点（点击/长按/滑动都用这个点）
        [x, y, w, h]  = 方框范围（点击/长按用方框中心点，滑动用两个中心点；也可作为识别 ROI）

        说明：Agent 启用后工作目录会切到 agent，相对路径可能失效。这里先按传入路径找，
        找不到时再回退到“本插件脚本所在目录”下找（这样相对路径在 agent 环境下也能命中）。
        """
        target = cls._resolve_path(filepath)
        if target is None:
            print(f"[BatchSwipe] 坐标文件不存在: {filepath}（当前工作目录: {os.getcwd()}）")
            return
        try:
            with open(target, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"[BatchSwipe] 坐标文件读取失败: {target} → {e}")
            return
        for key, val in data.items():
            if isinstance(val, (list, tuple)) and len(val) >= 2:
                if len(val) >= 4:
                    cls.COORDS[key] = (int(val[0]), int(val[1]), int(val[2]), int(val[3]))
                else:
                    cls.COORDS[key] = (int(val[0]), int(val[1]))
            elif isinstance(val, dict) and 'x' in val and 'y' in val:
                if 'w' in val and 'h' in val:
                    cls.COORDS[key] = (int(val['x']), int(val['y']), int(val['w']), int(val['h']))
                else:
                    cls.COORDS[key] = (int(val['x']), int(val['y']))
            else:
                print(f"[BatchSwipe] 忽略无效坐标项: {key}: {val}")

    @staticmethod
    def _strip_quotes(s):
        """去掉首尾成对的单/双引号（容错误加引号）。"""
        if not s:
            return s
        if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
            return s[1:-1]
        return s

    @staticmethod
    def _extract_weight(s):
        """从元素串末尾提取 @权重（如 swipe:a,b@3 → ('swipe:a,b', 3)；无权重 → (s, 1)）。
        只在整串以 @数字 结尾时才识别，避免误伤 ref:节点@inv 之类。"""
        s = (s or '').strip()
        m = re.search(r'@(\d+(?:\.\d+)?)\s*$', s)
        if m:
            w = float(m.group(1))
            return s[:m.start()].rstrip(), (w if w > 0 else 1)
        return s, 1

    @staticmethod
    def _extract_combo(s):
        """从动作串末尾提取 *N 连击后缀（click:a*3 → ('click:a', 3)；无 → (s, 1)）。
        只在整串以 *整数 结尾时才识别；n<=1 视为没写。"""
        s = (s or '').strip()
        m = re.search(r'\*(\d+)\s*$', s)
        if m:
            n = int(m.group(1))
            return s[:m.start()].rstrip(), (n if n > 1 else 1)
        return s, 1

    @staticmethod
    def _resolve_path(filepath: str):
        """解析文件路径：优先用传入路径；相对路径在当前工作目录找不到时，回退到本脚本所在目录。
        用于规避 Agent 启动后工作目录切到 agent 目录导致的相对路径失效。"""
        if not filepath:
            return None
        candidates = [filepath]
        if not os.path.isabs(filepath):
            candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), filepath))
        for c in candidates:
            if os.path.exists(c):
                return c
        return None

    def _get_coord(self, key):
        """根据键名获取坐标，支持直接传入 [x, y] / [x, y, w, h] 列表或坐标字符串（如 'x,y'）"""
        if key is None:
            print("[BatchSwipe] 坐标键为空")
            return None
        if isinstance(key, (list, tuple)):
            if len(key) >= 2:
                return tuple(int(v) for v in key)
            else:
                print(f"[BatchSwipe] 无效的坐标数组: {key}")
                return None
        if isinstance(key, str):
            # 尝试解析 "x,y" 格式
            if ',' in key:
                parts = key.split(',')
                if len(parts) >= 2:
                    return int(parts[0].strip()), int(parts[1].strip())
            # 从 COORDS 查找（可能是点或方框）
            if key in self.COORDS:
                return self.COORDS[key]
            # 尝试解析 JSON 数组字符串
            if key.startswith('['):
                arr = json.loads(key)
                return self._get_coord(arr)
            print(f"[BatchSwipe] 未定义的坐标键: {key}")
            return None
        print(f"[BatchSwipe] 无效的坐标类型: {type(key)}")
        return None

    @staticmethod
    def _coord_point(coord):
        """把坐标（点 [x,y] 或方框 [x,y,w,h]）转成可点击/长按的中心点。"""
        if len(coord) >= 4:
            return int(coord[0] + coord[2] / 2), int(coord[1] + coord[3] / 2)
        return int(coord[0]), int(coord[1])

    def _get_controller(self, context: Context):
        """兼容不同版本获取控制器"""
        for path in ['tasker.controller', 'controller', '_controller']:
            obj = context
            for part in path.split('.'):
                if hasattr(obj, part):
                    obj = getattr(obj, part)
                else:
                    obj = None
                    break
            if obj and hasattr(obj, 'post_swipe'):
                return obj
        return None

    def _parse_actions(self, param_str: str):
        """解析参数，支持 JSON 数组或紧凑命令序列（不含括号）"""
        param_str = param_str.strip()
        if not param_str:
            return []
        # 如果以 '[' 开头，按 JSON 数组解析（但注意 [ 可能是随机组合开始，这里排除）
        if param_str.startswith('[') and not param_str.startswith('[('):
            try:
                data = json.loads(param_str)
                if isinstance(data, list):
                    return data
                else:
                    print("[BatchSwipe] JSON 数组格式错误")
                    return None
            except:
                pass
        # 否则按分号分隔的紧凑命令解析。
        # 用「顶层分割」（不进入 {} () [] 内部），这样 attach:(a;b) / fixed:N:(a;b) 里的分号不会被误切。
        actions = []
        for cmd in self._split_top_level_semis(param_str):
            cmd = cmd.strip()
            if not cmd:
                continue
            # 权重后缀：swipe:a,b@3 → 权重 3（附着到动作，供加权随机用）
            cmd, cmd_w = self._extract_weight(cmd)
            if not cmd:
                continue
            # 连击后缀：动作*n（n≥2）→ 同一动作连续执行 n 次、次间无间隔，整体算 1 个动作
            cmd, combo_n = self._extract_combo(cmd)
            if not cmd:
                continue
            # 「…」无间隔包裹块：块内动作背靠背执行、次间不插间隔（组号标记，执行循环里识别）。
            # 块内不支持 {} 随机块 / {!…} 异步组（嵌套块语义冲突，直接报错不静默错跑）。
            if cmd.startswith('「'):
                if combo_n > 1:
                    print(f"[BatchSwipe] ⚠️ 无间隔块整体不支持 *{combo_n} 连击（块内动作可以各自带 *n），已忽略: {cmd}")
                if not cmd.endswith('」'):
                    print(f"[BatchSwipe] 无间隔块缺少收尾的 」: {cmd}")
                    return None
                inner = cmd[1:-1].strip()
                if not inner:
                    print(f"[BatchSwipe] 无间隔块为空: {cmd}")
                    return None
                if '{' in inner or '}' in inner:
                    print(f"[BatchSwipe] 无间隔块「…」内不支持 {{}} 随机块/异步组: {cmd}")
                    return None
                sub = self._parse_actions(inner)
                if sub is None:
                    return None
                self._mark_noint(sub)
                actions.extend(sub)
                continue
            if ':' not in cmd:
                low = cmd.strip().lower()
                if low in ('resume', 'reset'):
                    actions.append({'type': low})
                    continue
                print(f"[BatchSwipe] 无效的命令: {cmd}")
                return None
            act_type, args_str = cmd.split(':', 1)
            act_type = act_type.strip().lower()
            args = args_str.split(',')
            if combo_n > 1 and act_type not in ('swipe', 'click', 'sleep', 'multi'):
                print(f"[BatchSwipe] ⚠️ 连击后缀 *{combo_n} 只对 swipe/click/sleep/multi 有效，已在「{cmd}」上忽略")
                combo_n = 1
            if act_type == 'watch':
                # 识别触发：watch:文本 或 watch:文本@@roi:盒|盒@@compare:<=900 或 watch:@@roi:盒@@compare:<=900（数值对比，无需文字）
                segs = args_str.split('@@')
                expected = [t.strip() for t in segs[0].split('|') if t.strip()]
                has_compare = any(seg.strip().startswith('compare:') for seg in segs[1:])
                if not expected and not has_compare:
                    print(f"[BatchSwipe] watch 需要至少一个 OCR 文本（或用 compare 做数值对比）: {cmd}")
                    return None
                act = {'type': 'watch', 'expected': expected}
                for seg in segs[1:]:
                    seg = seg.strip()
                    if not seg:
                        continue
                    if seg.startswith('roi:'):
                        rois = self._parse_roi_list(seg[4:].strip())
                        if rois is None:
                            print(f"[BatchSwipe] watch 的 roi 格式错误: {cmd}")
                            return None
                        act['roi'] = rois
                    elif seg.startswith('compare:'):
                        act['compare'] = seg[8:].strip()
                actions.append(act)
            elif act_type == 'guard':
                # ★ 守卫声明：guard:节点A|节点B@@roi:盒1|盒2
                #   click/swipe/multi 的触点或滑动路径（路径每 ~24px 采样）碰到这些区域时，
                #   执行前先跑这些节点的识别，任一命中即停止剩余动作、跟随 next。
                #   可声明多个（各管各的区域）；节点名后可加 @inv（同 ref）。
                #   用途：误触防护 —— 例 guard:无尽局内_继续挑战@@roi:683,613,244,63
                segs = args_str.split('@@')
                nodes = []
                for seg in segs[0].split('|'):
                    seg = self._strip_quotes(seg.strip())
                    if not seg:
                        continue
                    invert = False
                    if seg.endswith('@inv'):
                        invert = True
                        seg = seg[:-4].strip()
                    if seg:
                        nodes.append({'name': seg, 'invert': invert})
                boxes = None
                for seg in segs[1:]:
                    seg = seg.strip()
                    if seg.startswith('roi:'):
                        boxes = self._parse_roi_list(seg[4:].strip())
                if not nodes:
                    print(f"[BatchSwipe] guard 需要至少一个节点名: {cmd}")
                    return None
                if not boxes:
                    print(f"[BatchSwipe] guard 需要 @@roi:盒1|盒2（x,y,w,h 或坐标表键名）: {cmd}")
                    return None
                actions.append({'type': 'guard', 'nodes': nodes, 'boxes': boxes})
            elif act_type == 'ref':
                # 引用识别：ref:节点A|节点B（复用节点识别，任一命中即触发），节点名后可加 @inv 反转命中（用于 inverse:true 的节点）
                nodes = []
                for seg in args_str.split('|'):
                    seg = self._strip_quotes(seg.strip())
                    if not seg:
                        continue
                    invert = False
                    if seg.endswith('@inv'):
                        invert = True
                        seg = seg[:-4].strip()
                    if seg:
                        nodes.append({'name': seg, 'invert': invert})
                if not nodes:
                    print(f"[BatchSwipe] ref 需要至少一个节点名: {cmd}")
                    return None
                actions.append({'type': 'ref', 'nodes': nodes})
            elif act_type == 'gateref':
                # ★ 定点守卫：gateref:节点A|节点B —— 走到这个位置就识别一次，
                #   任一命中即停止剩余动作、跟随当前节点 next 列表执行。
                #   与 ref 的区别：ref 是「全局触发」（识别点 = every:N/块末等固定节奏），
                #   gateref 是「位置触发」——只在它所在的这个位置检查一次。
                #   不占动作计数、不触发识别点、不插间隔。节点名后可加 @inv（同 ref）。
                #   用途：误触防护 —— 在「可能点到继续挑战/继续训练」的动作前插一个，
                #   发现已经跳屏就立刻停手交还 next 链，而不是在错误界面继续盲点。
                nodes = []
                for seg in args_str.split('|'):
                    seg = self._strip_quotes(seg.strip())
                    if not seg:
                        continue
                    invert = False
                    if seg.endswith('@inv'):
                        invert = True
                        seg = seg[:-4].strip()
                    if seg:
                        nodes.append({'name': seg, 'invert': invert})
                if not nodes:
                    print(f"[BatchSwipe] gateref 需要至少一个节点名: {cmd}")
                    return None
                actions.append({'type': 'gateref', 'nodes': nodes})
            elif act_type == 'roi':
                # 识别范围：roi:盒1|盒2…（每个 x,y,w,h），作用于本批次所有未带自己区域的 watch
                boxes = self._parse_roi_list(args_str)
                if boxes is None:
                    print(f"[BatchSwipe] roi 需要 x,y,w,h（多个用 | 分隔）: {cmd}")
                    return None
                actions.append({'type': 'roi', 'roi': boxes})
            elif act_type == 'every':
                # 识别间隔：every:N 表示每 N 个动作识别一次；every:block 表示每个顺序块结束后识别一次
                # （两者可以同时写：every:3;every:block = 两处识别点都生效）
                tok = args[0].strip().lower() if args else ''
                if tok in ('block', 'blocks'):
                    actions.append({'type': 'every', 'mode': 'block', 'n': 1})
                    continue
                if not tok:
                    print(f"[BatchSwipe] every 需要整数或 block: {cmd}")
                    return None
                try:
                    n = int(tok)
                except ValueError:
                    print(f"[BatchSwipe] every 参数不是整数（也不是 block）: {cmd}")
                    return None
                actions.append({'type': 'every', 'mode': 'every', 'n': n})
            elif act_type == 'fixed':
                # fixed:N:动作     —— 每执行 N 个普通动作就额外执行一次该固定动作
                # fixed:block:动作 —— 每个顺序块结束后执行一次该固定动作
                # （动作可为 swipe/click/sleep/multi）
                inner = args_str.split(':', 1)
                if len(inner) < 2:
                    print(f"[BatchSwipe] fixed 需要 N 和动作（如 fixed:5:swipe:收,框,50）: {cmd}")
                    return None
                tok = inner[0].strip().lower()
                if tok in ('block', 'blocks'):
                    mode, n = 'block', 0
                else:
                    try:
                        n = int(tok)
                    except ValueError:
                        print(f"[BatchSwipe] fixed 的 N 不是整数（也不是 block）: {cmd}")
                        return None
                    mode = 'every'
                    n = n if n > 0 else 1
                sub = self._parse_actions(inner[1].strip())
                if not sub or len(sub) != 1 or not isinstance(sub[0], dict):
                    print(f"[BatchSwipe] fixed 需要单个动作（swipe/click/sleep/multi）: {cmd}")
                    return None
                actions.append({'type': 'fixed', 'mode': mode, 'every': n, 'action': sub[0]})
            elif act_type == 'resume':
                # 断点续做：进度只在当前这次任务（next 链）内、只在内存里；重新开任务会自动作废。
                mode = args[0].strip().lower() if args and args[0].strip() else ''
                if mode in ('disk', 'file', 'save', 'json'):
                    print("[BatchSwipe] ℹ️ resume:disk 已取消（不再生成任何文件）：断点续做只在当前任务内有效，"
                          "重新开启任务会自动从第 1 个动作开始")
                actions.append({'type': 'resume'})
            elif act_type == 'reset':
                # 清除该节点的断点进度
                actions.append({'type': 'reset'})
            elif act_type == 'attach':
                # 附属顺序块：attach:动作  或  attach:(动作;动作;…)
                # 语义：这些动作与主块「叠加」执行，不占用主块计数、不触发识别点、不计入 resume。
                body = args_str.strip()
                if body.startswith('(') and body.endswith(')'):
                    body = body[1:-1].strip()
                sub = self._parse_actions(body) if body else []
                if sub is None:
                    print(f"[BatchSwipe] attach 解析失败: {cmd}")
                    return None
                sub = [a for a in sub
                       if isinstance(a, dict)
                       and str(a.get('type', '')).lower() in ('swipe', 'click', 'sleep')]
                if not sub:
                    print(f"[BatchSwipe] attach 里没有可执行动作（只支持 swipe/click/sleep）: {cmd}")
                    return None
                actions.append({'type': 'attach', 'actions': sub})
            elif act_type == 'attach_every':
                # 节奏：每 N 个主块动作配一个附属动作（默认 1 = 每个主块动作配一个）
                try:
                    n = int(args[0].strip())
                except (ValueError, IndexError):
                    print(f"[BatchSwipe] attach_every 需要整数: {cmd}")
                    return None
                actions.append({'type': 'attach_every', 'n': n if n > 0 else 1})
            elif act_type == 'attach_start':
                # 从第 N 个主块动作（1 起算）开始才配附属动作
                try:
                    n = int(args[0].strip())
                except (ValueError, IndexError):
                    print(f"[BatchSwipe] attach_start 需要整数: {cmd}")
                    return None
                actions.append({'type': 'attach_start', 'n': n if n > 0 else 1})
            elif act_type == 'attach_mode':
                # merge = 合成多指 MultiSwipe 真并发（默认）；insert = 紧跟主块动作串行执行（最保险）
                m = args[0].strip().lower() if args else ''
                if m not in ('merge', 'insert'):
                    print(f"[BatchSwipe] attach_mode 只能是 merge 或 insert: {cmd}")
                    return None
                actions.append({'type': 'attach_mode', 'mode': m})
            elif act_type == 'multi':
                # 多指动作：multi:(起点1,终点1[,时长1];起点2,终点2[,时长2];…)
                body = args_str.strip()
                if body.startswith('(') and body.endswith(')'):
                    body = body[1:-1].strip()
                fingers = []
                for seg in self._split_top_level_semis(body):
                    seg = seg.strip()
                    if not seg:
                        continue
                    parts = [p.strip() for p in seg.split(',')]
                    if len(parts) < 2 or not parts[0] or not parts[1]:
                        print(f"[BatchSwipe] multi 每根手指需要 起点,终点[,时长]：{seg}")
                        return None
                    f = {'from': parts[0], 'to': parts[1]}
                    if len(parts) >= 3:
                        try:
                            f['duration'] = int(float(parts[2]))
                        except ValueError:
                            print(f"[BatchSwipe] multi 的时长不是数字：{seg}")
                            return None
                    fingers.append(f)
                if not fingers:
                    print(f"[BatchSwipe] multi 里没有手指：{cmd}")
                    return None
                act = {'type': 'multi', 'fingers': fingers}
                if combo_n > 1: act['_combo'] = combo_n
                actions.append(act)
            elif act_type == 'swipe':
                if len(args) < 2:
                    print(f"[BatchSwipe] swipe 参数不足: {cmd}")
                    return None
                act = {'type': 'swipe', 'from': args[0].strip(), 'to': args[1].strip()}
                if len(args) >= 3:
                    act['duration'] = int(args[2].strip())
                if cmd_w != 1: act['_w'] = cmd_w
                if combo_n > 1: act['_combo'] = combo_n
                actions.append(act)
            elif act_type == 'click':
                if len(args) < 1:
                    print(f"[BatchSwipe] click 参数不足: {cmd}")
                    return None
                act = {'type': 'click', 'target': args[0].strip()}
                if cmd_w != 1: act['_w'] = cmd_w
                if combo_n > 1: act['_combo'] = combo_n
                actions.append(act)
            elif act_type == 'sleep':
                if len(args) < 1:
                    print(f"[BatchSwipe] sleep 参数不足: {cmd}")
                    return None
                act = {'type': 'sleep', 'seconds': float(args[0].strip())}
                if cmd_w != 1: act['_w'] = cmd_w
                if combo_n > 1: act['_combo'] = combo_n
                actions.append(act)
            else:
                print(f"[BatchSwipe] 未知动作类型: {act_type}")
                return None
        return actions

    # 无间隔块「…」的组号种子（只需在一次运行的动作列表内唯一，自增即可）
    _NOINT_SEQ = 0

    def _mark_noint(self, acts):
        """把一组动作标记为同一个「无间隔块」：执行循环里相邻同组动作之间不插间隔。"""
        BatchSwipe._NOINT_SEQ += 1
        gid = BatchSwipe._NOINT_SEQ
        for a in acts:
            if isinstance(a, dict) and str(a.get('type', '')).lower() in self.EXEC_TYPES:
                a['_noint'] = gid

    def _split_top_level_semis(self, s: str):
        """按顶层 ; 分割（不进入 {} () [] 「」 内）。返回片段列表。"""
        parts = []
        cur = ''
        depth = 0
        for ch in (s or ''):
            if ch in '({[「':
                depth += 1
            elif ch in ')}]」':
                depth -= 1
            if ch == ';' and depth == 0:
                parts.append(cur)
                cur = ''
            else:
                cur += ch
        if cur.strip():
            parts.append(cur)
        return parts

    def _parse_random_block(self, block_str: str):
        """
        解析随机块内容，返回元素列表。
        每个元素可能是：
        - 动作字典（独立动作，可带权重键 _w）
        - 元组 ('combo', 动作列表, 是否内部随机, 权重)（组合动作，(…)顺序 / […]随机）
        - 元组 ('random_block', 元素列表, 权重)（嵌套 {…) 随机块，作为整体参与外层打乱）
        权重由元素末尾的 @N 指定（如 swipe:a,b@3 权重 3，swipe:a,b@0.5 权重 0.5），缺省为 1。
        权重越大越可能被排前（加权随机）。
        """
        elements = []
        for token in self._split_top_level_semis(block_str):
            token = token.strip()
            if not token:
                continue
            clean, weight = self._extract_weight(token)
            if not clean:
                continue
            if clean[0] == '{':
                # 嵌套随机块：递归解析
                inner = clean[1:-1].strip()
                sub = self._parse_random_block(inner)
                if sub is None:
                    print("[BatchSwipe] 嵌套随机块解析失败")
                    return None
                elements.append(('random_block', sub, weight))
            elif clean[0] in ('(', '['):
                # 组合：(…)顺序 / […]内部随机
                start_char = clean[0]
                end_char = ')' if start_char == '(' else ']'
                inner_random = (start_char == '[')
                inner = clean[1:-1].strip()
                group_actions = self._parse_actions(inner)
                if group_actions is None:
                    print(f"[BatchSwipe] 组合解析失败: {clean}")
                    return None
                elements.append(('combo', group_actions, inner_random, weight))
            elif clean[0] == '「':
                # 无间隔块：作为**整体**参与外层打乱（组内顺序固定、次间无间隔）
                if not clean.endswith('」'):
                    print(f"[BatchSwipe] 无间隔块缺少收尾的 」: {clean}")
                    return None
                inner = clean[1:-1].strip()
                if not inner:
                    print(f"[BatchSwipe] 无间隔块为空: {clean}")
                    return None
                if '{' in inner or '}' in inner:
                    print(f"[BatchSwipe] 无间隔块「…」内不支持 {{}} 随机块/异步组: {clean}")
                    return None
                group_actions = self._parse_actions(inner)
                if group_actions is None:
                    print(f"[BatchSwipe] 无间隔块解析失败: {clean}")
                    return None
                self._mark_noint(group_actions)
                elements.append(('combo', group_actions, False, weight))
            else:
                # 独立动作
                act_list = self._parse_actions(clean)
                if act_list is None or len(act_list) != 1:
                    print(f"[BatchSwipe] 无效的独立动作: {clean}")
                    return None
                ele = act_list[0]
                if weight != 1:
                    ele['_w'] = weight
                elements.append(ele)
        return elements

    def _weighted_shuffle(self, items):
        """按权重打乱列表：权重大更可能排前（加权采样不放回）。元素权重：
        dict → _w；('combo',…,权重) 取第4项；('random_block',…,权重) 取第3项。缺省为 1。"""
        def _w(elem):
            try:
                if isinstance(elem, dict):
                    return float(elem.get('_w', 1) or 1)
                if isinstance(elem, tuple):
                    if elem[0] == 'combo':
                        return float(elem[3])
                    if elem[0] == 'random_block':
                        return float(elem[2])
            except Exception:
                pass
            return 1.0
        if not items:
            return items
        pool = list(items)
        ws = [_w(x) for x in pool]
        out = []
        while pool:
            total = sum(ws)
            if total <= 0:
                r = random.random()
                idx = int(r * len(pool))
            else:
                r = random.random() * total
                acc = 0
                idx = len(pool) - 1
                for i, wt in enumerate(ws):
                    acc += wt
                    if r <= acc:
                        idx = i
                        break
            out.append(pool.pop(idx))
            ws.pop(idx)
        return out

    def _expand_shuffled(self, elements):
        """递归展开一组已打乱的元素，返回按顺序执行的动作列表。

        元素可能是单动作、('combo', actions, inner_random, weight)、('random_block', sub_elements, weight)。
        """
        out = []
        for element in elements:
            if isinstance(element, dict):
                out.append(element)
                continue
            kind = element[0]
            if kind == 'combo':
                _, actions, inner_random, _w = element
                if inner_random:
                    self._weighted_shuffle(actions)
                out.extend(actions)
            elif kind == 'random_block':
                _, sub, _w = element
                self._weighted_shuffle(sub)
                out.extend(self._expand_shuffled(sub))
        return out

    def _split_blocks(self, param_str: str):
        """
        将参数分割成有序部分、随机块部分和异步组部分。
        返回列表，每个元素为 (类型, 内容)，类型为 'ordered' / 'random' / 'async'。
        '{!…}' 为异步组（内容不含前导 '!'）。
        """
        blocks = []
        current = ''
        i = 0
        length = len(param_str)
        while i < length:
            if param_str[i] == '{':
                if current.strip():
                    blocks.append(('ordered', current.strip()))
                    current = ''
                # 找到匹配的 }
                depth = 0
                start = i
                while i < length:
                    if param_str[i] == '{':
                        depth += 1
                    elif param_str[i] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    i += 1
                if i >= length:
                    print("[BatchSwipe] 大括号不匹配")
                    return None
                random_content = param_str[start+1:i].strip()
                if random_content.startswith('!'):
                    # 异步组：{! 动作;动作;… }（内容剥掉前导 '!'；可再带 @间隔 前缀）
                    blocks.append(('async', random_content[1:].strip()))
                else:
                    blocks.append(('random', random_content))
                i += 1
                continue
            current += param_str[i]
            i += 1
        if current.strip():
            blocks.append(('ordered', current.strip()))
        return blocks

    def _resolve_box(self, spec):
        """把一个 ROI 说明解析成一个盒子 (x,y,w,h)。

        支持：
        - 数字 'x,y,w,h'（可带 [ ] ( ) 和空格、尾逗号）
        - 坐标表(索引 JSON)里的键名，其值为 [x,y,w,h]（或 {x,y,w,h}），用作识别区域
        - 坐标表键名值为 [x,y]（单点）时，按零尺寸盒子 (x,y,0,0) 处理
        无法解析返回 None。
        """
        cleaned = self._strip_quotes((spec or '').strip())
        if not cleaned:
            return None
        numeric = cleaned.replace('[', '').replace(']', '').replace('(', '').replace(')', '').strip()
        parts = [p.strip() for p in numeric.split(',') if p.strip()]
        if len(parts) == 4:
            try:
                return tuple(int(p) for p in parts)
            except ValueError:
                pass
        # 坐标表键名（索引 JSON 字段）
        if cleaned in self.COORDS:
            c = self.COORDS[cleaned]
            if isinstance(c, (list, tuple)):
                if len(c) >= 4:
                    return tuple(int(v) for v in c[:4])
                if len(c) == 2:
                    return (int(c[0]), int(c[1]), 0, 0)
        # 'x,y' 单点 -> 零尺寸盒
        if len(parts) == 2:
            try:
                return (int(parts[0]), int(parts[1]), 0, 0)
            except ValueError:
                pass
        return None

    def _parse_roi_list(self, spec):
        """解析 ROI 列表：支持一个或多个盒子（| 分隔），每个盒子为数字 x,y,w,h 或坐标表键名。
        返回 [(x,y,w,h),…]；一个都没解析出则返回 None。"""
        if not spec or not spec.strip():
            return None
        boxes = []
        for chunk in spec.split('|'):
            box = self._resolve_box(chunk)
            if box is not None:
                boxes.append(box)
            else:
                print(f"[BatchSwipe] ⚠️ ROI 无法解析（不是 x,y,w,h 也不在坐标表里）: {chunk}")
                print(f"[BatchSwipe]   提示：引用其它节点请用 ref:节点名（会自动用它的识别/区域，无需填 ROI）；ROI 只填 数字 x,y,w,h 或 坐标表键名")
        return boxes if boxes else None

    def _collect_watch(self, actions):
        """收集所有识别触发（watch / ref），返回触发列表。每个触发：
           {'kind':'ocr','expected':[...],'roi':[盒,…] 或 None}
           {'kind':'ref','nodes':[{'name':..,'invert':bool},…]}
        任一命中即触发（多状态 = 多触发）。"""
        triggers = []
        for act in actions:
            if not isinstance(act, dict):
                continue
            t = str(act.get('type', '')).lower()
            if t == 'watch':
                exp = act.get('expected')
                if isinstance(exp, str):
                    exp = [e.strip() for e in exp.split('|') if e.strip()]
                if isinstance(exp, (list, tuple)):
                    exp = [e for e in exp if isinstance(e, str) and e.strip()]
                    compare = act.get('compare')
                    if exp or compare:
                        rois = act.get('roi')
                        if not isinstance(rois, list) or len(rois) == 0:
                            rois = None
                        triggers.append({'kind': 'ocr', 'expected': exp, 'roi': rois, 'compare': compare})
            elif t == 'ref':
                raw = act.get('nodes')
                if isinstance(raw, str):
                    raw = [n.strip() for n in raw.split('|') if n.strip()]
                nodes = []
                if isinstance(raw, (list, tuple)):
                    for n in raw:
                        if isinstance(n, dict):
                            nodes.append({'name': n.get('name') or '', 'invert': bool(n.get('invert'))})
                        elif isinstance(n, str) and n.strip():
                            nodes.append({'name': n.strip(), 'invert': False})
                nodes = [n for n in nodes if n['name']]
                if nodes:
                    triggers.append({'kind': 'ref', 'nodes': nodes})
        return triggers

    def _collect_roi(self, actions):
        """提取全局 roi 盒子列表（多个），无则返回 []。"""
        for act in actions:
            if not isinstance(act, dict):
                continue
            if str(act.get('type', '')).lower() != 'roi':
                continue
            r = act.get('roi')
            if isinstance(r, (list, tuple)) and r:
                return [tuple(int(v) for v in box) for box in r]
        return []

    def _missing_coords(self, actions):
        """预检所有 swipe/click 用到的坐标键，返回未定义键的清单（便于一次性定位问题）。

        只校验需要坐标的地址：swipe 的 from/to、click 的 target。缺失则对应动作失败。
        """
        missing = []
        for act in actions:
            if not isinstance(act, dict):
                continue
            t = str(act.get('type', '')).lower()
            if t == 'swipe':
                for field in ('from', 'to'):
                    key = act.get(field)
                    if key and self._get_coord(key) is None:
                        missing.append(f"{'起点' if field == 'from' else '终点'}「{key}」")
            elif t == 'click':
                key = act.get('target')
                if key and self._get_coord(key) is None:
                    missing.append(f"点击「{key}」")
            elif t == 'multi':
                for i, f in enumerate(act.get('fingers') or [], 1):
                    for field, tag in (('from', '起点'), ('to', '终点')):
                        key = f.get(field)
                        if key and self._get_coord(key) is None:
                            missing.append(f"多指第{i}根·{tag}「{key}」")
        return missing

    def _collect_every(self, actions):
        """提取识别间隔，返回 (每N个动作, 是否每个顺序块结束后也识别)。

        every:N     → (N, False)：每 N 个动作识别一次
        every:block → (0, True) ：只在每个顺序块结束后识别
        两个都写     → (N, True) ：两处识别点都生效（并集）
        完全没写     → (1, False)：默认每个动作后都识别（保持老行为）
        """
        toks = [a for a in actions
                if isinstance(a, dict) and str(a.get('type', '')).lower() == 'every']
        if not toks:
            return 1, False
        n, block = 0, False
        for act in toks:
            if str(act.get('mode', 'every')).lower() in ('block', 'blocks'):
                block = True
                continue
            try:
                v = int(act.get('n'))
            except Exception:
                continue
            if v > 0:
                n = v
        return (n if n > 0 else 0), block

    # 会真的发到设备上的动作类型（其余 token 是识别/节奏/固定动作之类的配置）
    EXEC_TYPES = ('swipe', 'click', 'sleep', 'multi')

    # ★ guard 守卫：触点判定参数。盒子外扩余量（覆盖相邻点位，如按钮边缘的点击），
    #   滑动路径按每 ~24px 采样一个点参与判定（「经过」也算碰到）。
    GUARD_MARGIN = 50
    GUARD_PATH_STEP = 24

    def _act_touch_points(self, act) -> list:
        """动作的触点集合：click=点；swipe/multi=滑动路径采样点（起终点必含）。"""
        t = str(act.get('type', '')).lower()
        pts = []

        def _pt(key):
            coord = self._get_coord(key)
            return self._coord_point(coord) if coord is not None else None

        def _path(k1, k2):
            p1 = _pt(k1)
            p2 = _pt(k2)
            if p1 is None and p2 is None:
                return
            if p1 is None or p2 is None:
                pts.append(p1 or p2)
                return
            dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
            if dist <= self.GUARD_PATH_STEP:
                pts.append(p1)
                pts.append(p2)
                return
            n = int(dist // self.GUARD_PATH_STEP)
            for i in range(n + 1):
                f = i * self.GUARD_PATH_STEP / dist
                pts.append((p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f))
            pts.append(p2)

        if t == 'click':
            p = _pt(act.get('target'))
            if p:
                pts.append(p)
        elif t == 'swipe':
            _path(act.get('from'), act.get('to'))
        elif t == 'multi':
            for fin in act.get('fingers') or []:
                _path(fin.get('from'), fin.get('to'))
        return pts

    def _guard_match(self, act, guards):
        """动作触点是否碰到某个守卫的区域；碰到返回该 guard，否则 None。"""
        pts = self._act_touch_points(act)
        if not pts:
            return None
        m = self.GUARD_MARGIN
        for g in guards:
            for box in g.get('boxes') or []:
                bx, by, bw, bh = box
                for (x, y) in pts:
                    if bx - m <= x <= bx + bw + m and by - m <= y <= by + bh + m:
                        return g
        return None

    @classmethod
    def _mark_block_ends(cls, acts):
        """给「这一段顺序动作」里最后一个可执行动作打上 _block_end（供 fixed:block 用）。

        段内若夹着附属块 attach:(…)，它本身就是一道分界（参数里的位置就是语义）：
        A;A;attach:(S);C;C 会得到两段 → A 的末尾、C 的末尾各打一次。
        段末（本批次结束前）同样算一次。
        """
        for i, a in enumerate(acts):
            if not isinstance(a, dict):
                continue
            if str(a.get('type', '')).lower() not in cls.EXEC_TYPES:
                continue
            nxt = None
            for b in acts[i + 1:]:
                if not isinstance(b, dict):
                    continue
                tb = str(b.get('type', '')).lower()
                if tb in cls.EXEC_TYPES:
                    nxt = 'exec'
                    break
                if tb == 'attach':
                    nxt = 'attach'
                    break
            if nxt != 'exec':
                a['_block_end'] = True
        return acts

    @classmethod
    def _annotate_segments(cls, acts, state, ordered):
        """给「一段动作」标注位置：段号 / 段内序号（顺序段还标「第几个顺序块 / 块内第几个动作」）。

        为什么要在解析时就打好：
          · 断点续做要把进度定位到「第几个顺序块的第几个动作」，不能等执行时靠数数去猜；
          · 块级识别（every:block）要知道哪一步是顺序块的末步（_block_end，由 _mark_block_ends 打）；
          · 随机块 / 异步组里的动作也会被执行、也会被断点跳过，所以同样要能说清「第几段第几个」。
        state = {'seg': 已出现的段数, 'blk': 已出现的顺序块数}，原地更新；返回这段里的可执行动作。
        """
        ex = [a for a in acts
              if isinstance(a, dict) and str(a.get('type', '')).lower() in cls.EXEC_TYPES]
        if not ex:
            return ex
        state['seg'] += 1
        if ordered:
            state['blk'] += 1
        for i, a in enumerate(ex, 1):
            a['_seg'] = state['seg']
            a['_sidx'] = i
            if ordered:
                a['_blk'] = state['blk']
                a['_bidx'] = i
        return ex

    @staticmethod
    def _pos_name(act, idx):
        """把一个动作说成「第几个顺序块的第几个动作（全程第几个）」，断点日志一眼就能对上。"""
        if isinstance(act, dict):
            blk, bidx = act.get('_blk'), act.get('_bidx')
            if blk and bidx:
                return f"第 {blk} 个顺序块的第 {bidx} 个动作（全程第 {idx + 1} 个）"
            seg, sidx = act.get('_seg'), act.get('_sidx')
            if seg and sidx:
                return f"第 {seg} 段（随机/异步块）的第 {sidx} 个动作（全程第 {idx + 1} 个）"
        return f"第 {idx + 1} 个动作"

    # ---------------- 断点续做进度：**只在当前这次任务运行内有效，而且只在内存里** ----------------

    @staticmethod
    def _task_key(argv):
        """「这次任务运行」的标识：MAA 每次「开始任务 / 重新开启任务」都会 post 一个新任务，
        新的 task_id 就代表新的一轮 —— 断点续做只在同一轮任务（同一条 next 链）里算数。

        拿不到 task_detail / task_id（很老的 MaaFw）时退回用「入口节点名」做标识，
        至少能保证「换了个任务就不会串用上一个任务的断点」。
        """
        td = getattr(argv, 'task_detail', None)
        tid = getattr(td, 'task_id', None)
        entry = getattr(td, 'entry', '') or ''
        if tid is None:
            return ('entry', str(entry))
        return ('task', str(tid), str(entry))

    @classmethod
    def _describe_task(cls, key):
        if isinstance(key, tuple) and key and key[0] == 'task':
            return f"task_id={key[1]}，入口「{key[2]}」"
        if isinstance(key, tuple) and len(key) > 1:
            return f"入口「{key[1]}」（这台设备/MaaFw 拿不到 task_id）"
        return str(key)

    @classmethod
    def _begin_task(cls, argv):
        """进节点时先对齐「当前任务」：只要换了任务，上一轮留下的断点全部作废。

        这就是「重新开启了任务就不续做」：重新开任务 = 新 task_id → 进度清空 → 本节点从第 1 个动作开始。
        """
        key = cls._task_key(argv)
        if key != cls._TASK_KEY:
            if cls._PROGRESS:
                names = "、".join(sorted(cls._PROGRESS.keys())[:3])
                more = "…" if len(cls._PROGRESS) > 3 else ""
                print(f"[BatchSwipe] ⏯ 检测到新的任务运行（{cls._describe_task(key)}）→ "
                      f"上一轮留下的断点进度全部作废（{names}{more}），本次从第 1 个动作开始")
            cls._PROGRESS = {}
            cls._TASK_KEY = key
        return key

    @classmethod
    def _store_progress(cls, node, sig, actions, cursor, param=''):
        """记录/刷新某节点的进度。cursor = 还没做完的那个动作的下标（下次从这个动作重做）。"""
        cur = actions[cursor] if 0 <= cursor < len(actions) else None
        cls._PROGRESS[node] = {
            'v': 2,
            'sig': sig,
            'order': list(actions),      # 上次洗牌后的执行顺序（含 _blk/_bidx 等位置标记）
            'done': int(cursor),
            'block': cur.get('_blk') if isinstance(cur, dict) else None,
            'step': cur.get('_bidx') if isinstance(cur, dict) else None,
            'pos': cls._pos_name(cur, cursor) if cur is not None else '全部完成',
            'total': len(actions),
            'param': (param or '')[:500],
        }

    @classmethod
    def _set_cursor(cls, node, cursor):
        """把进度挪到第 cursor 个动作（0 起算）。"""
        rec = cls._PROGRESS.get(node)
        if not isinstance(rec, dict):
            return
        if rec.get('done') == cursor:
            return
        rec['done'] = int(cursor)
        order = rec.get('order') or []
        cur = order[cursor] if 0 <= cursor < len(order) else None
        rec['block'] = cur.get('_blk') if isinstance(cur, dict) else None
        rec['step'] = cur.get('_bidx') if isinstance(cur, dict) else None
        rec['pos'] = cls._pos_name(cur, cursor) if cur is not None else '全部完成'

    @classmethod
    def _drop_progress(cls, node, quiet=False):
        """清除某节点的断点进度（只在内存里，没有文件要清）。"""
        had = cls._PROGRESS.pop(node, None) is not None
        if not quiet:
            if had:
                print(f"[BatchSwipe] ⏯ 已清除节点「{node}」的断点进度")
            else:
                print(f"[BatchSwipe] ⏯ 节点「{node}」本来就没有断点进度")
        return had

    @staticmethod
    def _batch_sig(param_str: str):
        """批次签名：整段参数（去掉空白）。参数一改，签名就变 → 断点进度作废、从头来（避免错位）。"""
        return re.sub(r'\s+', '', param_str or '')

    @staticmethod
    def _collect_fixed(actions):
        """提取固定动作（fixed:N:动作 / fixed:block:动作），无则返回 None。
        返回：{'type':'fixed','mode':'every'|'block','every':N,'action':{...}}（第一个匹配）。"""
        for act in actions:
            if isinstance(act, dict) and str(act.get('type', '')).lower() == 'fixed':
                return act
        return None

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
    def _compare_num(num, cmp_spec):
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

    @staticmethod
    def _collect_resume(actions):
        """断点续做开关（进度只在当前任务内 + 只在内存里，不生成任何文件）。"""
        return any(isinstance(a, dict) and str(a.get('type', '')).lower() == 'resume'
                   for a in actions)

    @staticmethod
    def _collect_reset(actions):
        return any(isinstance(a, dict) and str(a.get('type', '')).lower() == 'reset' for a in actions)

    @staticmethod
    def _sig(act):
        return tuple(sorted((str(k), str(v)) for k, v in act.items()))

    @classmethod
    def _same_exec_set(cls, a, b):
        """判断两次批量是否为同一批动作（只看内容，不看顺序）。用于断点续做时识别“同一配置”。"""
        return sorted(cls._sig(x) for x in a) == sorted(cls._sig(x) for x in b)

    @staticmethod
    def _compare_regions(nums, compare):
        """多区域比较：compare 形如 '$1<$0'（$i = 第 i+1 个区域 OCR 出的数字）。"""
        m = re.match(r'^\s*\$(\d+)\s*(<=|>=|==|!=|<|>)\s*\$(\d+)\s*$', str(compare or '').strip())
        if not m:
            return False
        a = nums[int(m.group(1))]
        op = m.group(2)
        b = nums[int(m.group(3))]
        if a is None or b is None:
            return False
        return BatchSwipe._compare_num(a, (op, b))

    def _watch_check(self, context, controller, triggers, global_rois=None):
        """截图一次，跑所有识别触发（OCR 多区域 / 引用节点），任一命中返回 True。
        任何失败都降级为 False（不中断批量）。"""
        if not triggers:
            return False
        need_direct = any(t.get('kind') == 'ocr' for t in triggers)
        need_ref = any(t.get('kind') == 'ref' for t in triggers)
        if need_direct and (not _DIRECT_RECOGNITION or not hasattr(context, 'run_recognition_direct')):
            return False
        if need_ref and not hasattr(context, 'run_recognition'):
            return False
        try:
            image = controller.post_screencap().wait().get()
        except Exception as e:
            print(f"[BatchSwipe] ⚠️ 识别截图失败: {e}")
            return False
        global_rois = global_rois or []
        for trig in triggers:
            if trig.get('kind') == 'ocr':
                exp = trig.get('expected') or []
                compare = trig.get('compare')
                if not exp and not compare:
                    continue
                rois = trig.get('roi')
                if not rois:
                    rois = global_rois if global_rois else [(0, 0, 0, 0)]
                if compare and isinstance(compare, str) and '$' in compare:
                    # 多区域比较：依次 OCR 每个区域，收集数字，用 $i op $j 比较（如 $1<$0 表示 区域2 < 区域1）
                    try:
                        nums = []
                        for roi in rois:
                            detail = context.run_recognition_direct(JRecognitionType.OCR, JOCR(expected=exp, roi=roi), image)
                            if detail is not None and detail.best_result is not None:
                                nums.append(self._extract_number(getattr(detail.best_result, 'text', None) or ''))
                            else:
                                nums.append(None)
                        if self._compare_regions(nums, compare):
                            return True
                    except Exception as e:
                        print(f"[BatchSwipe] ⚠️ OCR 识别失败: {e}")
                else:
                    for roi in rois:
                        try:
                            ocr = JOCR(expected=exp, roi=roi)
                            detail = context.run_recognition_direct(JRecognitionType.OCR, ocr, image)
                            if detail is None:
                                continue
                            if compare:
                                # 识别数字并比较：取 OCR 数字，与 compare 比较，成立才触发
                                text = getattr(detail.best_result, "text", None) or "" if detail.best_result else ""
                                num = self._extract_number(text)
                                cmp = self._parse_compare(compare)
                                if self._compare_num(num, cmp):
                                    return True
                            elif detail.hit:
                                return True
                        except Exception as e:
                            print(f"[BatchSwipe] ⚠️ OCR 识别失败: {e}")
            elif trig.get('kind') == 'ref':
                for node in trig.get('nodes') or []:
                    name = node.get('name', '') if isinstance(node, dict) else node
                    invert = node.get('invert', False) if isinstance(node, dict) else False
                    if not name:
                        continue
                    try:
                        detail = context.run_recognition(name, image)
                        if detail is None:
                            if not hasattr(self, '_missing_ref_nodes'):
                                self._missing_ref_nodes = set()
                            if name not in self._missing_ref_nodes:
                                self._missing_ref_nodes.add(name)
                                print(f"[BatchSwipe] ⚠️ 引用节点「{name}」未找到/未启用（请确认该节点在 pipe JSON 里且已作为资源加载）")
                            continue
                        hit = bool(detail.hit)
                        if invert:
                            hit = not hit  # @inv：再反转一次（用于 inverse:true 的节点，取“正向出现”语义）
                        if hit:
                            print(f"[BatchSwipe] 🔍 引用节点「{name}」识别命中" + ("（@inv 反转后）" if invert else ""))
                            return True
                    except Exception as e:
                        print(f"[BatchSwipe] ⚠️ 引用识别「{name}」失败: {e}")
        return False

    # ---------------- 附属顺序块（与主块叠加执行） ----------------

    ATTACH_CLICK_MS = 50        # 附属块里 click 合成 MultiSwipe 时的按压时长
    ATTACH_NODE = "BatchSwipe_MultiSwipe"   # run_action 里临时生成的节点名（无需预先存在）

    @staticmethod
    def _collect_attach(actions):
        """抽出附属块配置。返回 (附属动作列表, 节奏 every, 模式 mode, 起始位置 start)。
        start 为 None 表示没显式指定，调用方会按它在序列里的位置自动推导。"""
        attached, every, mode, start = [], 1, 'merge', None
        for a in actions:
            if not isinstance(a, dict):
                continue
            t = str(a.get('type', '')).lower()
            if t == 'attach':
                attached.extend([x for x in (a.get('actions') or []) if isinstance(x, dict)])
            elif t == 'attach_every':
                try:
                    n = int(a.get('n', 1))
                except Exception:
                    n = 1
                every = n if n > 0 else 1
            elif t == 'attach_start':
                try:
                    n = int(a.get('n', 1))
                except Exception:
                    n = 1
                start = n if n > 0 else 1
            elif t == 'attach_mode':
                mode = str(a.get('mode', 'merge')).lower() or 'merge'
        return attached, every, mode, start

    def _action_to_swipe_spec(self, act, contact):
        """把 swipe/click 动作转成 MultiSwipe 的一个 swipe 条目；不支持则返回 None。"""
        t = str(act.get('type', '')).lower()
        if t == 'swipe':
            cf = self._get_coord(act.get('from'))
            if cf is None:
                return None
            x1, y1 = self._coord_point(cf)
            tk = act.get('to')
            if tk:
                ct = self._get_coord(tk)
                if ct is None:
                    return None
                x2, y2 = self._coord_point(ct)
            else:
                x2, y2 = x1, y1
            dur = int(act.get('duration', 100))
        elif t == 'click':
            c = self._get_coord(act.get('target'))
            if c is None:
                return None
            x1, y1 = self._coord_point(c)
            x2, y2 = x1, y1
            dur = self.ATTACH_CLICK_MS
        else:
            return None
        return {"begin": [int(x1), int(y1)],
                "end": [[int(x2), int(y2)]],   # 注意：end 是列表
                "duration": [int(dur)],        # 注意：duration 也是列表
                "contact": int(contact),
                "starting": 0}

    def _run_merged(self, context, main_act, attach_act, pos=""):
        """把主块动作 + 附属动作合成成**一个多指 MultiSwipe** 一起发（真并发）。

        实测（MaaFw 5.10.4 + Minitouch）：2~5 根手指可在 1ms 内同时按下、同时抬起。
        返回 True = 已并发执行完毕；False = 条件不满足或执行失败，调用方应退化为串行。
        """
        if context is None or not hasattr(context, 'run_action'):
            return False
        s1 = self._action_to_swipe_spec(main_act, 0)
        s2 = self._action_to_swipe_spec(attach_act, 1)
        if s1 is None or s2 is None:
            return False
        node = self.ATTACH_NODE
        try:
            detail = context.run_action(
                node,
                pipeline_override={node: {"action": "MultiSwipe",
                                          "swipes": [s1, s2], "next": []}},
            )
        except Exception as e:
            print(f"[BatchSwipe] ⚠️ {pos} 合并 MultiSwipe 异常: {e}（本次退化为串行）")
            return False
        if detail is None:
            print(f"[BatchSwipe] ⚠️ {pos} MultiSwipe 节点未能启动（本次退化为串行）")
            return False
        if not detail.success:
            print(f"[BatchSwipe] ⚠️ {pos} MultiSwipe 执行失败（本次退化为串行）")
            return False
        return True

    def _run_multi_step(self, context, act, pos=""):
        """多指动作：一个动作里描述 N 根手指，走原生 MultiSwipe 真并发。

        返回 (ok, handled)：
          (True,  True)  = 已按多指并发执行完毕
          (False, False) = 环境不支持（没有 run_action / 坐标解析不了），调用方应退化为串行
          (False, True)  = 支持但执行失败，同样应退化
        """
        fingers = act.get('fingers') or []
        if not fingers:
            return True, True
        if context is None or not hasattr(context, 'run_action'):
            return False, False
        specs = []
        for i, f in enumerate(fingers):
            one = {'type': 'swipe', 'from': f.get('from'), 'to': f.get('to'),
                   'duration': int(f.get('duration', 100) or 100)}
            sp = self._action_to_swipe_spec(one, i)
            if sp is None:
                return False, False
            specs.append(sp)
        node = self.ATTACH_NODE
        try:
            detail = context.run_action(
                node,
                pipeline_override={node: {"action": "MultiSwipe",
                                          "swipes": specs, "next": []}},
            )
        except Exception as e:
            print(f"[BatchSwipe] ⚠️ {pos} 多指动作异常: {e}（退化为逐指串行）")
            return False, True
        if detail is None:
            print(f"[BatchSwipe] ⚠️ {pos} 多指动作节点未能启动（退化为逐指串行）")
            return False, True
        if not detail.success:
            print(f"[BatchSwipe] ⚠️ {pos} 多指动作执行失败（退化为逐指串行）")
            return False, True
        return True, True

    def _run_multi_serial(self, controller, act, pos=""):
        """多指动作的退化路径：一根一根串行滑（不丢动作，只是不并发）。"""
        for f in (act.get('fingers') or []):
            one = {'type': 'swipe', 'from': f.get('from'), 'to': f.get('to'),
                   'duration': int(f.get('duration', 100) or 100)}
            if not self._do_action(controller, one, pos=pos):
                return False
        return True

    def _post_action(self, controller, act, pos=None):
        """把单个 swipe/click 提交给控制器，**不等待**。返回 (ok, job)。
        sleep 不走这里（它是 Python 侧动作，没有 job）。"""
        act_type = act.get('type', '').lower()
        where = pos or '动作'
        if act_type == 'swipe':
            coord_from = self._get_coord(act.get('from'))
            if coord_from is None:
                print(f"[BatchSwipe] ⚠️ {where}中断：起点坐标键「{act.get('from')}」未定义，请确认坐标表已加载且包含该键")
                return False, None
            x1, y1 = self._coord_point(coord_from)
            to_key = act.get('to')
            if to_key:
                coord_to = self._get_coord(to_key)
                if coord_to is None:
                    print(f"[BatchSwipe] ⚠️ {where}中断：终点坐标键「{to_key}」未定义，请确认坐标表已加载且包含该键")
                    return False, None
                x2, y2 = self._coord_point(coord_to)
            else:
                x2, y2 = x1, y1
            duration = int(act.get('duration', 100))
            return True, controller.post_swipe(x1, y1, x2, y2, duration)
        if act_type == 'click':
            coord = self._get_coord(act.get('target'))
            if coord is None:
                print(f"[BatchSwipe] ⚠️ {where}中断：点击坐标键「{act.get('target')}」未定义，请确认坐标表已加载且包含该键")
                return False, None
            x, y = self._coord_point(coord)
            return True, controller.post_click(x, y)
        print(f"[BatchSwipe] 未知动作类型: {act_type}")
        return False, None

    def _do_action(self, controller, act, pos=None):
        """同步执行单个动作（swipe/click/sleep）：提交后立刻等到完成。
        成功返回 True；失败打印并返回 False。
        pos：错误信息里的位置描述，如 '执行到第 3/10 个动作' 或 '固定动作'。"""
        act_type = act.get('type', '').lower()
        if act_type == 'sleep':
            time.sleep(float(act.get('seconds', 0.2)))
            return True
        ok, job = self._post_action(controller, act, pos=pos)
        if not ok:
            return False
        job.wait()
        return True

    def run(self, context: Context, argv: CustomAction.RunArg) -> bool:
        param_str = argv.custom_action_param
        if not param_str:
            print("[BatchSwipe] 参数为空")
            return False

        param_str = param_str.strip()
        if len(param_str) >= 2 and param_str.startswith('"') and param_str.endswith('"'):
            param_str = param_str[1:-1]

        if not param_str:
            print("[BatchSwipe] 参数为空")
            return False

        # 可选前缀配置：@0.3; 表示每个动作之间等 0.3 秒。默认用类属性 INTERVAL（0.1）。
        interval = self.INTERVAL
        if param_str.startswith('@'):
            seg, _, rest = param_str.partition(';')
            try:
                interval = float(seg.lstrip('@').strip() or '0.1')
            except ValueError:
                interval = self.INTERVAL
            param_str = rest.strip()
            if not param_str:
                print("[BatchSwipe] 参数为空")
                return False

        # 断点续做的「批次签名」：用原始参数（含 random: 前缀、含块结构）算，参数一改进度就作废。
        resume_sig = self._batch_sig(param_str)

        controller = self._get_controller(context)
        if controller is None:
            print("[BatchSwipe] 无法获取控制器")
            return False

        # 检查是否包含随机块
        if '{' in param_str or '}' in param_str:
            blocks = self._split_blocks(param_str)
            if blocks is None:
                return False

            final_actions = []
            # 位置标记：段号 / 顺序块号（断点续做定位到「第几个顺序块的第几个动作」靠它）
            seg_state = {'seg': 0, 'blk': 0}
            for block_type, block_content in blocks:
                if block_type == 'ordered':
                    acts = self._parse_actions(block_content)
                    if acts is None:
                        return False
                    self._mark_block_ends(acts)      # ★ 顺序块：段末打点（fixed:block / every:block 用）
                    self._annotate_segments(acts, seg_state, ordered=True)   # ★ 顺序块：标块号/块内序号
                    final_actions.extend(acts)
                elif block_type == 'async':
                    # 异步组：{!@间隔;动作;动作;…}
                    # 组内间隔可选（默认 0 = 不插间隔）；组内顺序执行，不打乱（但支持嵌套 {…} 随机块）。
                    group_interval = 0.0
                    body = block_content
                    if body.startswith('@'):
                        seg, _, rest = body.partition(';')
                        try:
                            group_interval = float(seg.lstrip('@').strip() or '0')
                        except ValueError:
                            group_interval = 0.0
                        body = rest.strip()
                    elements = self._parse_random_block(body) if body else []
                    if elements is None:
                        return False
                    group_acts = []
                    for a in self._expand_shuffled(elements):
                        if isinstance(a, dict) and str(a.get('type', '')).lower() in ('swipe', 'click'):
                            a['_async'] = True          # 提交后不等待
                            a['_interval'] = group_interval
                        group_acts.append(a)
                    self._annotate_segments(group_acts, seg_state, ordered=False)   # ★ 异步组：单独一段
                    final_actions.extend(group_acts)
                else:  # random
                    elements = self._parse_random_block(block_content)
                    if elements is None:
                        return False
                    # 随机打乱元素（元素可能是动作、组合、或嵌套随机块）；带权重则加权（权重越大越可能在前）
                    self._weighted_shuffle(elements)
                    # 展开元素（递归处理嵌套随机块）
                    random_acts = self._expand_shuffled(elements)
                    self._annotate_segments(random_acts, seg_state, ordered=False)  # ★ 随机块：单独一段
                    final_actions.extend(random_acts)
            actions = final_actions
        else:
            # 没有大括号：处理 random: 前缀或普通解析
            seg_state = {'seg': 0, 'blk': 0}
            if param_str.startswith('random:'):
                param_str = param_str[7:].strip()
                if '|' in param_str:
                    random_part, ordered_part = param_str.split('|', 1)
                    random_part = random_part.strip()
                    ordered_part = ordered_part.strip()
                else:
                    random_part = param_str
                    ordered_part = ""
                random_actions = self._parse_actions(random_part) if random_part else []
                if random_actions is None:
                    return False
                if random_actions:
                    self._weighted_shuffle(random_actions)
                ordered_actions = self._parse_actions(ordered_part) if ordered_part else []
                if ordered_actions is None:
                    return False
                self._mark_block_ends(ordered_actions)     # ★ 顺序部分：段末打点
                self._annotate_segments(random_actions, seg_state, ordered=False)
                self._annotate_segments(ordered_actions, seg_state, ordered=True)
                actions = random_actions + ordered_actions
            else:
                actions = self._parse_actions(param_str)
                if actions is None:
                    return False
                self._mark_block_ends(actions)             # ★ 整段就是一个顺序块
                self._annotate_segments(actions, seg_state, ordered=True)

        # 提取识别触发(watch/ref)、全局 roi、识别间隔、固定动作（若有），并从执行列表中剔除（它们不实际顺序执行）
        resume = self._collect_resume(actions)
        do_reset = self._collect_reset(actions)
        watch_triggers = self._collect_watch(actions)
        watch_rois = self._collect_roi(actions)
        watch_every, watch_block_end = self._collect_every(actions)
        fixed_act = self._collect_fixed(actions)
        attach_actions, attach_every, attach_mode, attach_start = self._collect_attach(actions)
        # ★ guard 守卫声明（触点/滑动路径进区域 -> 动作前先识别节点）
        guards = [a for a in actions
                  if isinstance(a, dict) and str(a.get('type', '')).lower() == 'guard']
        # ★ 附属块的核心语义：它像顺序块一样「摆在序列里的某个位置」，
        #   主块走到那里时，它才和「紧跟在它后面的那些动作」一起执行。
        #   所以没显式写 attach_start 时，就用它在动作序列里的位置来自动推导：
        #   它前面有多少个可执行动作，就从第几个之后开始配。
        if attach_start is None:
            _seen = 0
            for _a in actions:
                if not isinstance(_a, dict):
                    continue
                _t = str(_a.get('type', '')).lower()
                if _t == 'attach':
                    break
                if _t in self.EXEC_TYPES:
                    _seen += 1
            attach_start = (_seen + 1) if _seen > 0 else 1
        actions = [
            a for a in actions
            if not (isinstance(a, dict) and str(a.get('type', '')).lower() in ('watch', 'ref', 'roi', 'every', 'resume', 'reset', 'fixed', 'attach', 'attach_every', 'attach_mode', 'attach_start', 'guard'))
        ]
        fixed_every = int(fixed_act.get('every', 1)) if fixed_act else 0
        # 固定动作的两种触发方式：every = 每 N 个动作；block = 每个顺序块结束后
        fixed_mode = str(fixed_act.get('mode', 'every')).lower() if fixed_act else 'every'
        if fixed_mode not in ('every', 'block'):
            fixed_mode = 'every'

        # 预检坐标：缺任何一个键就一次性列出，避免执行到一半才因坐标失败
        missing = self._missing_coords(actions)
        if fixed_act:
            missing += self._missing_coords([fixed_act.get('action', {})])
        if attach_actions:
            missing += self._missing_coords(attach_actions)
        if missing:
            print(f"[BatchSwipe] ❌ 坐标键未定义，本次批量不执行：总计 {len(missing)} 个缺失 → {', '.join(missing)}")
            print("[BatchSwipe] 请确认：已加载坐标表（load_coords）；参数里的键名与坐标表中的键名完全一致。")
            return False

        # ---------------- 断点续做（动作级 · 顺序块级 · 只在当前任务内） ----------------
        # 语义：进度记的是「**还没做完的那一个动作**」——
        #   断在第 N 个顺序块的第 K 个动作，下次回来就从那个动作重做，不跳步也不倒退。
        # 范围：**只在当前这次任务运行（当前这条 next 链）里算数**；重新开启任务 = 新 task_id
        #   → 上一轮进度全部作废、从第 1 个动作开始（进度只在内存里，不生成任何文件）。
        self._begin_task(argv)
        start_index = 0
        if do_reset:
            self._drop_progress(argv.node_name)
        if resume:
            cached = self._PROGRESS.get(argv.node_name)
            order = cached.get('order') if isinstance(cached, dict) else None
            same = (isinstance(order, list) and len(order) == len(actions)
                    and str(cached.get('sig', '')) == resume_sig)
            if same:
                # 同一批次（参数没变）：沿用上次洗牌后的顺序，避免重排打乱进度
                actions = list(order)
                try:
                    start_index = int(cached.get('done', 0) or 0)
                except (TypeError, ValueError):
                    start_index = 0
                start_index = max(0, min(start_index, len(actions)))
                if start_index < len(actions):
                    nxt = self._pos_name(actions[start_index], start_index)
                    print(f"[BatchSwipe] ⏯ 断点续做：上次断在 {cached.get('pos') or '?'}，"
                          f"本次从 {nxt} 继续（已完成 {start_index}/{len(actions)}）")
                else:
                    print(f"[BatchSwipe] ⏯ 断点续做：上一批已经全部做完（{len(actions)} 个），本次无事可做，清除进度")
            else:
                if cached:
                    print("[BatchSwipe] ⏯ 断点续做：本节点参数已改动（批次签名不一致），本批从头开始")
                start_index = 0
            self._store_progress(argv.node_name, resume_sig, actions, start_index, param_str)

        # 执行所有动作
        executed = start_index
        total = len(actions)

        # 「」无间隔组：落在组中间的识别点 / 固定动作不拆组，挂起到组末补做
        watch_pending = False
        fixed_pending = False

        # 异步组支持：pending_jobs 收集「已提交但还没等」的动作 job。
        pending_jobs = []

        def _drain():
            """排空未完成的异步动作。
            识别截图前 / 同步动作前 / sleep 前 / 返回前必须调用——
            否则会截到动作执行中的中间帧，或让 sleep 与排队中的动作重叠。"""
            while pending_jobs:
                job = pending_jobs.pop(0)
                try:
                    job.wait()
                except Exception as e:
                    print(f"[BatchSwipe] ⚠️ 异步动作等待失败: {e}")

        def _submit_or_run(act, pos):
            """异步动作 -> 只提交不等待；多指动作 -> 走原生 MultiSwipe；同步动作 -> 先排空再等它完成。
            ★ 连击（*n 后缀）：同一动作连续执行 n 次、次间不插任何间隔，整体算 1 个动作
              （同步路径每次 rep 都 wait 完再发下一次；异步路径 n 次全部压入 pending_jobs）。"""
            t = str(act.get('type', '')).lower()
            try:
                combo = max(1, int(act.get('_combo', 1) or 1))
            except (TypeError, ValueError):
                combo = 1
            for rep in range(combo):
                rpos = pos if combo == 1 else f"{pos}·连击第 {rep + 1}/{combo} 次"
                if t == 'multi':
                    _drain()
                    ok, handled = self._run_multi_step(context, act, pos=rpos)
                    if handled:
                        if not ok:
                            return False
                        continue
                    if not self._run_multi_serial(controller, act, pos=rpos):
                        return False
                    continue
                if act.get('_async') and t in ('swipe', 'click'):
                    ok, job = self._post_action(controller, act, pos=rpos)
                    if not ok:
                        return False
                    if job is not None:
                        pending_jobs.append(job)
                    continue
                # 同步路径：先排空，保证「前面的异步动作」都做完，顺序与识别点都干净
                _drain()
                if not self._do_action(controller, act, pos=rpos):
                    return False
            return True

        # 若配置了识别触发，执行前先识别一次（屏幕当前已命中则直接停止，不做任何动作）
        if watch_triggers and self._watch_check(context, controller, watch_triggers, watch_rois):
            print("[BatchSwipe] 🔍 开始前即识别到命中内容，停止本次批量，跟随当前节点 next 列表执行")
            return True

        # 附属顺序块：与主块叠加执行。不占主块计数、不触发识别点、不计入 resume。
        attach_queue = list(attach_actions)
        attach_used = 0
        if attach_queue:
            where = f"从第 {attach_start} 个主块动作开始，" if attach_start > 1 else ""
            print(f"[BatchSwipe] 🔗 附属顺序块 {len(attach_queue)} 个动作 · 模式={attach_mode} · "
                  f"{where}每 {attach_every} 个主块动作配 1 个（不占用主块计数/识别点）")
            # 断点续做时：被跳过的那些主块动作本该消耗掉的附属动作要先扣掉，
            # 否则续做之后「主块动作 ↔ 附属动作」的配对会整体错位。
            if start_index > 0 and attach_every > 0:
                for _j in range(start_index):
                    rel0 = _j - (attach_start - 1)
                    if rel0 >= 0 and rel0 % attach_every == 0 and attach_queue:
                        attach_queue.pop(0)

        for idx, act in enumerate(actions):
            if idx < start_index:
                # 已做过的动作：跳过
                continue

            # ★ 定点守卫（gateref）：不占动作计数、不触发识别点、不插间隔 ——
            #   走到这个位置就识别一次，命中即停止剩余动作、跟随 next（误触跳屏防护）。
            if isinstance(act, dict) and str(act.get('type', '')).lower() == 'gateref':
                _drain()
                if self._watch_check(context, controller,
                                     [{'kind': 'ref', 'nodes': act.get('nodes') or []}], None):
                    if resume:
                        # 断在守卫位置 → 下次从守卫后的动作续做
                        self._set_cursor(argv.node_name, idx)
                    print(f"[BatchSwipe] 🛡 定点守卫命中（第 {idx + 1}/{total} 个位置），"
                          f"停止剩余动作，跟随当前节点 next 列表执行")
                    return True
                continue

            pos = f"执行到第 {idx+1}/{len(actions)} 个动作"

            # ★ guard 误触守卫：click/swipe/multi 的触点或滑动路径碰到守卫区域时，
            #   执行前先跑守卫节点的识别 —— 命中（已跳屏）就停手、跟随 next。
            #   不占动作计数/识别点/间隔。
            if guards:
                g = self._guard_match(act, guards)
                if g is not None:
                    _drain()
                    if self._watch_check(context, controller,
                                         [{'kind': 'ref', 'nodes': g.get('nodes') or []}], None):
                        if resume:
                            self._set_cursor(argv.node_name, idx)
                        names = "|".join(n.get('name', '') for n in (g.get('nodes') or []) if isinstance(n, dict))
                        print(f"[BatchSwipe] 🛡 守卫命中：动作「{self._pos_name(act, idx)}」触点进守卫区，"
                              f"识别到（{names}），停止剩余动作，跟随当前节点 next 列表执行")
                        return True
            if resume:
                # 先把进度挪到「正在做的这个动作」：万一这次被判死/崩溃（来不及写完成），
                # 下次也是从这个动作重做，而不是悄悄跳过它
                self._set_cursor(argv.node_name, idx)

            # 该主块动作是否顺带带上一个附属动作（起始位置由 attach_start 决定，节奏由 attach_every 决定）
            partner = None
            if attach_queue and attach_every > 0:
                rel = idx - (attach_start - 1)          # 相对起始位置的第几个
                if rel >= 0 and rel % attach_every == 0:
                    partner = attach_queue.pop(0)

            if partner is not None:
                _drain()
                # ① merge：把主块动作 + 附属动作合成一个多指 MultiSwipe，真正同时执行
                merged = (attach_mode == 'merge'
                          and not act.get('_async')
                          and self._run_merged(context, act, partner, pos=pos))
                if merged:
                    attach_used += 1
                else:
                    # ② 退化：主块动作照常，附属动作紧跟其后串行执行（不丢动作）
                    if not _submit_or_run(act, pos=pos):
                        _drain()
                        return False
                    if not _submit_or_run(partner, pos=f"附属动作(第 {attach_used + 1} 个)"):
                        _drain()
                        return False
                    attach_used += 1
            else:
                if not _submit_or_run(act, pos=pos):
                    _drain()
                    return False

            executed = idx + 1
            if resume:
                # 这个动作做完了 → 进度往后挪一格
                self._set_cursor(argv.node_name, executed)
            # 识别点（命中即停止剩余动作，跟随当前节点 next 列表执行）：
            #   ① every:N  → 每 N 个动作识别一次（默认 1 = 每个动作后都识别）
            #   ② every:block → 每个顺序块结束后识别一次（块末 = 顺序块最后一个动作，固定动作之前）
            # 识别前必须排空，否则截图会截到 swipe 的中间帧
            at_block_end = bool(act.get('_block_end'))
            watch_due = bool(watch_triggers) and (
                (watch_every > 0 and executed % watch_every == 0)
                or (watch_block_end and at_block_end)
            )
            # ★ 「」无间隔组：当前动作后面还跟着同组动作 = 组中间。
            #   组中间不截图识别（会拖慢背靠背节奏），挂起到组末补做。
            nxt_act = actions[idx + 1] if idx + 1 < total else None
            mid_group = (isinstance(act, dict) and isinstance(nxt_act, dict)
                         and act.get('_noint') is not None
                         and act.get('_noint') == nxt_act.get('_noint'))
            if watch_due and mid_group:
                watch_pending = True
                watch_due = False
            elif watch_pending and not mid_group:
                watch_due = True
                watch_pending = False
            if watch_due:
                _drain()
                if self._watch_check(context, controller, watch_triggers, watch_rois):
                    if resume:
                        # 断在「这个动作」上 → 下次回来仍然从这个动作续（它很可能没被游戏结算完）
                        self._set_cursor(argv.node_name, idx)
                    reason = "本顺序块结束" if (watch_block_end and at_block_end) else f"第 {executed}/{total} 个动作"
                    print(f"[BatchSwipe] 🔍 {reason}后识别到命中内容（断点停在 {self._pos_name(act, idx)}），"
                          f"停止剩余动作，跟随当前节点 next 列表执行")
                    return True
            # 固定动作：每 fixed_every 个普通动作后额外执行一次（不占 N 的计数；识别命中会先中断，不补执行 fixed）
            #           或 block 模式：每个顺序块结束后额外执行一次（_block_end 在解析时打好）
            if fixed_act:
                if fixed_mode == 'block':
                    fire_fixed = at_block_end
                    why = '本顺序块结束'
                else:
                    fire_fixed = fixed_every > 0 and executed % fixed_every == 0
                    why = f'每 {fixed_every} 次一次'
                # ★ 「」无间隔组：固定动作落在组中间时不插进去（会打断背靠背节奏），挂起到组末补做
                if fire_fixed and mid_group:
                    fixed_pending = True
                    fire_fixed = False
                elif fixed_pending and not mid_group:
                    fire_fixed = True
                    fixed_pending = False
                    why = '无间隔组结束，补做'
                if fire_fixed:
                    # ★ 固定动作也要先看识别：every:N>1 时识别点不一定落在这个动作上，
                    #   不然「屏幕早就该跳 next 了」却还在这里多做一个固定动作（会把主块节奏打乱）。
                    #   命中 → 不执行固定动作，直接停（跟随 next）。
                    #   （every:block 的识别点正好在这里，watch_due 已认过就不重复截图）
                    if watch_triggers and not watch_due:
                        _drain()
                        if self._watch_check(context, controller, watch_triggers, watch_rois):
                            if resume:
                                self._set_cursor(argv.node_name, idx)
                            print(f"[BatchSwipe] 🔍 固定动作前识别到命中内容（断点停在 {self._pos_name(act, idx)}），"
                                  f"跳过本次固定动作并停止剩余动作，跟随当前节点 next 列表执行")
                            return True
                    print(f"[BatchSwipe] 🔁 执行第 {executed}/{total} 个动作后，执行固定动作（{why}）")
                    if not _submit_or_run(fixed_act['action'], pos="固定动作"):
                        _drain()
                        return False
            # 间隔：异步组内的动作用组内间隔（默认 0），其余用全局 interval；
            # ★ 「」无间隔组：组内相邻动作之间不插间隔（mid_group），块末之后恢复正常
            eff_interval = interval
            if isinstance(act, dict) and act.get('_async'):
                eff_interval = act.get('_interval', interval)
            if executed < total and eff_interval and eff_interval > 0 and not mid_group:
                time.sleep(eff_interval)

        # 附属块剩余动作：主块做完全部补齐（不计入主块计数，也不触发识别点）
        for i, leftover in enumerate(attach_queue):
            if not _submit_or_run(leftover, pos=f"附属动作(收尾 {i + 1}/{len(attach_queue)})"):
                _drain()
                return False

        # 全部做完：先排空剩余异步动作，再清除该节点的断点进度
        _drain()
        if attach_used:
            print(f"[BatchSwipe] 🔗 附属顺序块共执行 {attach_used} 个动作")
        if resume and executed >= total:
            self._drop_progress(argv.node_name, quiet=True)
        return True