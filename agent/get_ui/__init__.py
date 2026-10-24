# -*- coding: utf-8 -*-
"""
get_ui 包 —— 通过 UI 控件树 / 系统窗口列表获取目标位置的最小识别包。

【包（package）是什么】
一个文件夹 + 这个 __init__.py 文件 = Python 眼里的"包"。
别人 import get_ui 时，Python 会先执行本文件，再找包里的模块。

【本文件的机关】
下面这行在"包被 import"的瞬间执行 nodes.py → nodes.py 里的装饰器运行
→ "get_ui" 识别节点注册到 MAA。
所以 MAAPVZ 的 main.py 只要写一句：
    import get_ui  # noqa: F401
注册就完成了——这就是"导入即注册"的最后一环。
"""
from . import nodes  # noqa: F401
