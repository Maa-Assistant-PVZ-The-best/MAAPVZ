# AGENTS.md — MaaPvz 协作铁律（精简版）

PVZ2 自动化（MAA 框架）。详细开发规范见官网：
**[开发规范 — MaaPvz 用户文档](https://daoyanxiaoz.github.io/Maapvz_User_md/开发规范.html)**
（本页只列不可违反的硬规则与门禁命令；理由、示例、表格都在官网那篇。）

请使用 [everything-maa](https://github.com/KhazixW2/Everything-Maa/tree/main) 中专门为 coding agent 提供的 skills

## 铁律（不可违反）

1. **无尽机制只信实测/拆包**——普通关资料禁止推断无尽行为；推断结论必须标注「未验证」。
2. **快照原则**——runtime 的还原快照只收它自己改动的字段（通常 recognition/action/next）；
   pipe 里 `//会被覆盖` 标记的字段改动必须同步 runtime 对应快照常量（selfcheck §13 断言守门）。
3. **不覆盖优于打补丁**——runtime 与 pipe 打架时，优先让 runtime 别碰该字段。
4. **资源文件名 = 对照表英文名**（小写）；`植物中英文对照表.md` 是命名唯一权威；
   OCR 别名白名单制，不开模糊匹配。
5. **卡槽连续**——槽 1 起不允许中间空槽（游戏卡条紧排）。
6. **禁绝对路径**——一切路径从 `__file__` 相对推算；日志走 stderr 带模块前缀；
   Python 调用统一 `.\.venv\Scripts\python.exe -X utf8`。
7. **小步提交**——一次功能/修复一次 commit，提交前门禁全绿。
8. **AI 一律不许碰 `git commit` / `git push`**——提交与推送**只能用户本人执行**
   （2026-11-02 用户明确要求：「不要帮我提交啊」「所有 push 必须我自己来」）。
   AI 只改工作区文件；改完只列出「改了哪些文件 + 建议的 commit message + 跑了哪些门禁」，
   由用户自己决定怎么提交。**理由**：commit 错了还能 `reset`，push 出去就是远端历史。

## 测试门禁（改动后对号入座，全绿才算完）

| 改动 | 命令 |
|---|---|
| agent Python | `.\.venv\Scripts\python.exe -X utf8 agent\jobset\selfcheck.py` |
| pipeline 流程 | `.\.venv\Scripts\python.exe -X utf8 agent\jobset\check_supply_bypass.py` |
| pipeline 节点 | `.\.venv\Scripts\python.exe -X utf8 agent\jobset\check_graph.py` |
| 资源文件 | `.\.venv\Scripts\python.exe -X utf8 check_resource.py assets\resource` |
| 编辑器 JS | `node --check static\js\<文件>.js` |

## 生效矩阵

编辑器静态文件 → 浏览器 Ctrl+F5；agent/pipeline/资源 → 构建包更新后重启 MaaPvz；
坐标表/作业集 JSON → 编辑器实时重读。

## 专题长文档

作业集编辑器架构与踩坑史：`game_assist_tools/endless_setup/HANDOFF.md`
