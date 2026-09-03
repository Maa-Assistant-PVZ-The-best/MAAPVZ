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
        """解析参数，支持 JSON 数组或紧凑命令序列"""
        param_str = param_str.strip()
        if not param_str:
            return []
        # 如果以 '[' 开头，按 JSON 数组解析
        if param_str.startswith('['):
            data = json.loads(param_str)
            if isinstance(data, list):
                return data
            else:
                print("[BatchSwipe] JSON 数组格式错误")
                return None
        # 否则按分号分隔的紧凑命令解析
        actions = []
        for cmd in param_str.split(';'):
            cmd = cmd.strip()
            if not cmd:
                continue
            # 格式：动作类型:参数
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

    def run(self, context: Context, argv: CustomAction.RunArg) -> bool:
        param_str = argv.custom_action_param
        if not param_str:
            print("[BatchSwipe] 参数为空")
            return False

        # 去除可能包裹的外层双引号
        param_str = param_str.strip()
        if len(param_str) >= 2 and param_str.startswith('"') and param_str.endswith('"'):
            param_str = param_str[1:-1]

        if not param_str:
            print("[BatchSwipe] 参数为空")
            return False

        controller = self._get_controller(context)
        if controller is None:
            print("[BatchSwipe] 无法获取控制器")
            return False

        # ---------- 大括号随机块处理 ----------
        # 格式示例：act1;act2;{(act3;sleep:0.1);(act4;sleep:0.1)};act5
        # 仅支持单个随机块，大括号内可包含分组圆括号
        if '{' in param_str or '}' in param_str:
            if param_str.count('{') != 1 or param_str.count('}') != 1:
                print("[BatchSwipe] 大括号必须成对且仅支持一个随机块")
                return False
            start = param_str.find('{')
            end = param_str.find('}', start)
            if start == -1 or end == -1 or end < start:
                print("[BatchSwipe] 大括号位置错误")
                return False

            before = param_str[:start].strip()
            random_block = param_str[start+1:end].strip()
            after = param_str[end+1:].strip()

            before_actions = self._parse_actions(before) if before else []
            after_actions = self._parse_actions(after) if after else []

            if before_actions is None or after_actions is None:
                return False

            # 解析随机块，支持圆括号分组
            if '(' in random_block and ')' in random_block:
                groups = []
                current_pos = 0
                while current_pos < len(random_block):
                    if random_block[current_pos] == '(':
                        close_pos = random_block.find(')', current_pos)
                        if close_pos == -1:
                            print("[BatchSwipe] 圆括号不匹配")
                            return False
                        group_content = random_block[current_pos+1:close_pos].strip()
                        group_actions = self._parse_actions(group_content)
                        if group_actions is None:
                            return False
                        groups.append(group_actions)
                        current_pos = close_pos + 1
                    else:
                        # 跳过非括号字符（如空白或分号），若发现未分组内容可提示错误
                        while current_pos < len(random_block) and random_block[current_pos] not in '(':
                            ch = random_block[current_pos]
                            if ch not in (' ', '\t', '\n', ';'):
                                print(f"[BatchSwipe] 随机块内只允许圆括号分组，发现未分组字符: {ch}")
                                return False
                            current_pos += 1
                random.shuffle(groups)
                random_actions = [act for group in groups for act in group]
            else:
                random_actions = self._parse_actions(random_block) if random_block else []
                if random_actions is None:
                    return False
                if random_actions:
                    random.shuffle(random_actions)

            actions = before_actions + random_actions + after_actions
        else:
            # ---------- 原有 random: 前缀处理 ----------
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
        for act in actions:
            act_type = act.get('type', '').lower()
            if act_type == 'swipe':
                coord_from = self._get_coord(act.get('from'))
                if coord_from is None:
                    return False
                x1, y1 = coord_from

                to_key = act.get('to')
                if to_key:
                    coord_to = self._get_coord(to_key)
                    if coord_to is None:
                        return False
                    x2, y2 = coord_to
                else:
                    x2, y2 = x1, y1

                duration = int(act.get('duration', 100))
                controller.post_swipe(x1, y1, x2, y2, duration).wait()
            elif act_type == 'click':
                coord = self._get_coord(act.get('target'))
                if coord is None:
                    return False
                x, y = coord
                controller.post_click(x, y).wait()
            elif act_type == 'sleep':
                time.sleep(float(act.get('seconds', 0.2)))
            else:
                print(f"[BatchSwipe] 未知动作类型: {act_type}")
                return False
        return True