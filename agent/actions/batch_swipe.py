import json
import time
import os
import re
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
print("[BatchSwipe] batch_swipe.py 已加载 · 版本 v4（watch/ref/roi(键名)/every）")


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
        roi:盒1|盒2         —— 可选，全局识别范围（多个盒，每个盒可为 x,y,w,h 或坐标表键名），作用于所有未自带区域的 watch。缺省为全屏。
        every:N             —— 可选，每 N 个动作识别一次（默认 1 = 每个动作后都识别）。输入 3 表示每 3 个动作识别一次。
        resume              —— 可选，断点续做：记录本批次洗牌后的执行顺序与已完成条数；下次进入同一节点按同一顺序跳过已做、继续做。全部做完自动清除进度。
        reset               —— 可选，清除该节点的断点进度（配合 resume 使用）。
        watch / ref 可各放多个（即多状态/多触发），任一命中即触发；不配置时行为与原来完全一致。
        说明：roi 里的“盒”既可直接写数字 x,y,w,h，也可写坐标表(索引 JSON)里的键名（该键值为 [x,y,w,h] 时做识别区域）。
             文件路径（如 load_coords）会自动兼容“Agent 启动后工作目录切到 agent”的情况：相对路径先在当前目录找，找不到再按插件脚本所在目录回退。
    示例：
        swipe:a,b;watch:已领取|集齐;ref:地宫2_后期_识别鬼火并种植;roi:识别框|300,400,200,100;every:3
    """

    COORDS = {}
    # 每个动作之间的默认间隔（秒）。可由 custom_action_param 前缀 "@0.3;" 覆盖，未设置时用此值。
    INTERVAL = 0.1
    # 断点续做进度缓存（会话内有效）：{节点名: {'order': 动作列表, 'done': 已完成条数}}
    _PROGRESS = {}

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
        # 否则按分号分隔的紧凑命令解析
        actions = []
        for cmd in param_str.split(';'):
            cmd = cmd.strip()
            if not cmd:
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
            elif act_type == 'roi':
                # 识别范围：roi:盒1|盒2…（每个 x,y,w,h），作用于本批次所有未带自己区域的 watch
                boxes = self._parse_roi_list(args_str)
                if boxes is None:
                    print(f"[BatchSwipe] roi 需要 x,y,w,h（多个用 | 分隔）: {cmd}")
                    return None
                actions.append({'type': 'roi', 'roi': boxes})
            elif act_type == 'every':
                # 识别间隔：every:N 表示每 N 个动作识别一次（不参与执行，默认 1）
                if len(args) < 1:
                    print(f"[BatchSwipe] every 需要整数: {cmd}")
                    return None
                try:
                    n = int(args[0].strip())
                except ValueError:
                    print(f"[BatchSwipe] every 参数不是整数: {cmd}")
                    return None
                actions.append({'type': 'every', 'n': n})
            elif act_type == 'resume':
                # 断点续做：记录本批次洗牌后的顺序与已完成条数，下次按同一顺序跳过已做、继续做
                actions.append({'type': 'resume'})
            elif act_type == 'reset':
                # 清除该节点的断点进度
                actions.append({'type': 'reset'})
            elif act_type == 'swipe':
                if len(args) < 2:
                    print(f"[BatchSwipe] swipe 参数不足: {cmd}")
                    return None
                act = {'type': 'swipe', 'from': args[0].strip(), 'to': args[1].strip()}
                if len(args) >= 3:
                    act['duration'] = int(args[2].strip())
                actions.append(act)
            elif act_type == 'click':
                if len(args) < 1:
                    print(f"[BatchSwipe] click 参数不足: {cmd}")
                    return None
                act = {'type': 'click', 'target': args[0].strip()}
                actions.append(act)
            elif act_type == 'sleep':
                if len(args) < 1:
                    print(f"[BatchSwipe] sleep 参数不足: {cmd}")
                    return None
                act = {'type': 'sleep', 'seconds': float(args[0].strip())}
                actions.append(act)
            else:
                print(f"[BatchSwipe] 未知动作类型: {act_type}")
                return None
        return actions

    def _parse_random_block(self, block_str: str):
        """
        解析随机块内容，返回元素列表。
        每个元素可能是：
        - 动作字典（独立动作）
        - 元组 ('combo', 动作列表, 是否内部随机)（组合动作，(…)顺序 / […]随机）
        - 元组 ('random_block', 元素列表)（嵌套 {…) 随机块，作为整体参与外层打乱）
        """
        elements = []
        i = 0
        length = len(block_str)
        while i < length:
            # 跳过空白和分号
            if block_str[i] in (' ', '\t', '\n', ';'):
                i += 1
                continue

            if block_str[i] == '{':
                # 嵌套随机块：递归解析
                depth = 0
                start = i
                while i < length:
                    if block_str[i] == '{':
                        depth += 1
                    elif block_str[i] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    i += 1
                if i >= length:
                    print("[BatchSwipe] 大括号不匹配")
                    return None
                inner = block_str[start+1:i].strip()
                sub = self._parse_random_block(inner)
                if sub is None:
                    return None
                elements.append(('random_block', sub))
                i += 1
                continue

            if block_str[i] in ('(', '['):
                start_char = block_str[i]
                end_char = ')' if start_char == '(' else ']'
                # 内部随机标志：方括号表示内部随机，圆括号表示有序
                inner_random = (start_char == '[')
                depth = 0
                start = i
                while i < length:
                    if block_str[i] == start_char:
                        depth += 1
                    elif block_str[i] == end_char:
                        depth -= 1
                        if depth == 0:
                            break
                    i += 1
                if i >= length:
                    print(f"[BatchSwipe] 组合括号不匹配")
                    return None
                group_content = block_str[start+1:i].strip()
                group_actions = self._parse_actions(group_content)
                if group_actions is None:
                    return None
                elements.append(('combo', group_actions, inner_random))
                i += 1
                continue

            # 独立动作：扫描直到分号或括号/大括号
            j = i
            while j < length and block_str[j] not in ('(', '[', '{', ';'):
                j += 1
            action_str = block_str[i:j].strip()
            if action_str:
                # 单个动作，解析为动作字典
                act_list = self._parse_actions(action_str)
                if act_list is None or len(act_list) != 1:
                    print(f"[BatchSwipe] 无效的独立动作: {action_str}")
                    return None
                elements.append(act_list[0])
            i = j

        return elements

    def _expand_shuffled(self, elements):
        """递归展开一组已打乱的元素，返回按顺序执行的动作列表。

        元素可能是单动作、('combo', actions, inner_random)、('random_block', sub_elements)。
        """
        out = []
        for element in elements:
            if isinstance(element, dict):
                out.append(element)
                continue
            kind = element[0]
            if kind == 'combo':
                _, actions, inner_random = element
                if inner_random:
                    random.shuffle(actions)
                out.extend(actions)
            elif kind == 'random_block':
                _, sub = element
                random.shuffle(sub)
                out.extend(self._expand_shuffled(sub))
        return out

    def _split_blocks(self, param_str: str):
        """
        将参数分割成有序部分和随机块部分。
        返回列表，每个元素为 (类型, 内容)，类型为 'ordered' 或 'random'。
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
        return missing

    def _collect_every(self, actions):
        """提取 every:N 识别间隔（每 N 个动作识别一次），未设置则默认 1（每动作都识别）。"""
        for act in actions:
            if not isinstance(act, dict):
                continue
            if str(act.get('type', '')).lower() != 'every':
                continue
            try:
                n = int(act.get('n'))
            except Exception:
                continue
            return n if n > 0 else 1
        return 1

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
        return any(isinstance(a, dict) and str(a.get('type', '')).lower() == 'resume' for a in actions)

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
            for block_type, block_content in blocks:
                if block_type == 'ordered':
                    acts = self._parse_actions(block_content)
                    if acts is None:
                        return False
                    final_actions.extend(acts)
                else:  # random
                    elements = self._parse_random_block(block_content)
                    if elements is None:
                        return False
                    # 随机打乱元素（元素可能是动作、组合、或嵌套随机块）
                    random.shuffle(elements)
                    # 展开元素（递归处理嵌套随机块）
                    final_actions.extend(self._expand_shuffled(elements))
            actions = final_actions
        else:
            # 没有大括号：处理 random: 前缀或普通解析
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
                    random.shuffle(random_actions)
                ordered_actions = self._parse_actions(ordered_part) if ordered_part else []
                if ordered_actions is None:
                    return False
                actions = random_actions + ordered_actions
            else:
                actions = self._parse_actions(param_str)
                if actions is None:
                    return False

        # 提取识别触发(watch/ref)、全局 roi、识别间隔（若有），并从执行列表中剔除（它们不实际执行）
        resume = self._collect_resume(actions)
        do_reset = self._collect_reset(actions)
        watch_triggers = self._collect_watch(actions)
        watch_rois = self._collect_roi(actions)
        watch_every = self._collect_every(actions)
        actions = [
            a for a in actions
            if not (isinstance(a, dict) and str(a.get('type', '')).lower() in ('watch', 'ref', 'roi', 'every', 'resume', 'reset'))
        ]

        # 预检坐标：缺任何一个键就一次性列出，避免执行到一半才因坐标失败
        missing = self._missing_coords(actions)
        if missing:
            print(f"[BatchSwipe] ❌ 坐标键未定义，本次批量不执行：总计 {len(missing)} 个缺失 → {', '.join(missing)}")
            print("[BatchSwipe] 请确认：已加载坐标表（load_coords）；参数里的键名与坐标表中的键名完全一致。")
            return False

        # 断点续做：记录/恢复本批次的执行顺序与已完成条数（进度存缓存，会话内有效）
        start_index = 0
        if do_reset:
            self._PROGRESS.pop(argv.node_name, None)
        if resume:
            cached = self._PROGRESS.get(argv.node_name)
            if cached and self._same_exec_set(cached.get('order', []), actions):
                # 同一批量配置：沿用上次的顺序（避免随机块重新洗牌），跳过已做部分
                actions = list(cached['order'])
                start_index = min(cached.get('done', 0), len(actions))
            else:
                start_index = 0
            self._PROGRESS[argv.node_name] = {'order': list(actions), 'done': start_index}

        # 执行所有动作
        executed = start_index
        total = len(actions)

        # 若配置了识别触发，执行前先识别一次（屏幕当前已命中则直接停止，不做任何动作）
        if watch_triggers and self._watch_check(context, controller, watch_triggers, watch_rois):
            print("[BatchSwipe] 🔍 开始前即识别到命中内容，停止本次批量，跟随当前节点 next 列表执行")
            return True

        for idx, act in enumerate(actions):
            if idx < start_index:
                # 已做过的动作：跳过
                continue
            act_type = act.get('type', '').lower()
            if act_type == 'swipe':
                coord_from = self._get_coord(act.get('from'))
                if coord_from is None:
                    print(f"[BatchSwipe] ⚠️ 执行到第 {idx+1}/{len(actions)} 个动作中断：起点坐标键「{act.get('from')}」未定义，请确认坐标表已加载且包含该键")
                    return False
                x1, y1 = self._coord_point(coord_from)
                to_key = act.get('to')
                if to_key:
                    coord_to = self._get_coord(to_key)
                    if coord_to is None:
                        print(f"[BatchSwipe] ⚠️ 执行到第 {idx+1}/{len(actions)} 个动作中断：终点坐标键「{to_key}」未定义，请确认坐标表已加载且包含该键")
                        return False
                    x2, y2 = self._coord_point(coord_to)
                else:
                    x2, y2 = x1, y1
                duration = int(act.get('duration', 100))
                controller.post_swipe(x1, y1, x2, y2, duration).wait()
            elif act_type == 'click':
                coord = self._get_coord(act.get('target'))
                if coord is None:
                    print(f"[BatchSwipe] ⚠️ 执行到第 {idx+1}/{len(actions)} 个动作中断：点击坐标键「{act.get('target')}」未定义，请确认坐标表已加载且包含该键")
                    return False
                x, y = self._coord_point(coord)
                controller.post_click(x, y).wait()
            elif act_type == 'sleep':
                time.sleep(float(act.get('seconds', 0.2)))
            else:
                print(f"[BatchSwipe] 未知动作类型: {act_type}")
                return False
            executed = idx + 1
            if resume:
                self._PROGRESS[argv.node_name]['done'] = executed
            # 每 N 个动作识别一次（every:N，默认 1）。命中即停止剩余动作，跟随当前节点 next 列表执行
            if watch_triggers and executed % watch_every == 0 and self._watch_check(context, controller, watch_triggers, watch_rois):
                print(f"[BatchSwipe] 🔍 执行第 {executed}/{total} 个动作后识别到命中内容，停止剩余动作，跟随当前节点 next 列表执行")
                return True
            if executed < total and interval > 0:
                time.sleep(interval)

        # 全部做完：清除该节点的断点进度
        if resume and executed >= total:
            self._PROGRESS.pop(argv.node_name, None)
        return True