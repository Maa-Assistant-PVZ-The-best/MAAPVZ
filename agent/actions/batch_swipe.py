import json
import time
import os
import random
from maa.custom_action import CustomAction
from maa.context import Context
from maa.agent.agent_server import AgentServer


@AgentServer.custom_action("BatchSwipe")
class BatchSwipe(CustomAction):
    COORDS = {}
    # 每个动作之间的默认间隔（秒）。可由 custom_action_param 前缀 "@0.3;" 覆盖，未设置时用此值。
    INTERVAL = 0.1

    @classmethod
    def load_coords(cls, filepath: str):
        """从 JSON 文件加载坐标映射。文件格式：{"键名": [x, y], ...}"""
        if not os.path.exists(filepath):
            print(f"[BatchSwipe] 坐标文件不存在: {filepath}")
            return
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for key, val in data.items():
            if isinstance(val, (list, tuple)) and len(val) >= 2:
                cls.COORDS[key] = (int(val[0]), int(val[1]))
            elif isinstance(val, dict) and 'x' in val and 'y' in val:
                cls.COORDS[key] = (int(val['x']), int(val['y']))
            else:
                print(f"[BatchSwipe] 忽略无效坐标项: {key}: {val}")

    def _get_coord(self, key):
        """根据键名获取坐标，支持直接传入 [x, y] 列表或坐标字符串（如 'x,y'）"""
        if key is None:
            print("[BatchSwipe] 坐标键为空")
            return None
        if isinstance(key, (list, tuple)):
            if len(key) >= 2:
                return int(key[0]), int(key[1])
            else:
                print(f"[BatchSwipe] 无效的坐标数组: {key}")
                return None
        if isinstance(key, str):
            # 尝试解析 "x,y" 格式
            if ',' in key:
                parts = key.split(',')
                if len(parts) >= 2:
                    return int(parts[0].strip()), int(parts[1].strip())
            # 从 COORDS 查找
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
                print(f"[BatchSwipe] 无效的命令: {cmd}")
                return None
            act_type, args_str = cmd.split(':', 1)
            act_type = act_type.strip().lower()
            args = args_str.split(',')
            if act_type == 'swipe':
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

        # 执行所有动作
        executed = 0
        total = len(actions)
        for act in actions:
            act_type = act.get('type', '').lower()
            if act_type == 'swipe':
                coord_from = self._get_coord(act.get('from'))
                if coord_from is None:
                    print(f"[BatchSwipe] ⚠️ 执行到第 {executed+1}/{len(actions)} 个动作中断：起点坐标键「{act.get('from')}」未定义，请确认坐标表已加载且包含该键")
                    return False
                x1, y1 = coord_from
                to_key = act.get('to')
                if to_key:
                    coord_to = self._get_coord(to_key)
                    if coord_to is None:
                        print(f"[BatchSwipe] ⚠️ 执行到第 {executed+1}/{len(actions)} 个动作中断：终点坐标键「{to_key}」未定义，请确认坐标表已加载且包含该键")
                        return False
                    x2, y2 = coord_to
                else:
                    x2, y2 = x1, y1
                duration = int(act.get('duration', 100))
                controller.post_swipe(x1, y1, x2, y2, duration).wait()
            elif act_type == 'click':
                coord = self._get_coord(act.get('target'))
                if coord is None:
                    print(f"[BatchSwipe] ⚠️ 执行到第 {executed+1}/{len(actions)} 个动作中断：点击坐标键「{act.get('target')}」未定义，请确认坐标表已加载且包含该键")
                    return False
                x, y = coord
                controller.post_click(x, y).wait()
            elif act_type == 'sleep':
                time.sleep(float(act.get('seconds', 0.2)))
            else:
                print(f"[BatchSwipe] 未知动作类型: {act_type}")
                return False
            executed += 1
            if executed < total and interval > 0:
                time.sleep(interval)
        return True