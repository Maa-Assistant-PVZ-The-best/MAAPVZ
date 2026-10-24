# -*- coding: utf-8 -*-
# ★ 必须存在且必须 import 子模块 —— 注册全靠副作用：
#   custom_select_plant.py 顶部的 @AgentServer.custom_action("SelectPlants") 装饰器
#   只有在文件被 import 时才会执行。没有本文件时，`import select_plant`（main.py）
#   只会解析成 PEP 420 命名空间包（空包），SelectPlants 静默不注册 ——
#   beta.4 用户「无尽挑战_选取植物」Action is null 连挂 16 次就是这个。
#   （2026-10-18 修复，根因 commit 193f2d3 把 import custom_select_plant 改成了
#     import select_plant，但忘了补 __init__.py）
from . import custom_select_plant  # noqa: F401
