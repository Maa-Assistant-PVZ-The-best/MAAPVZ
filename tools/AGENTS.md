# AGENTS.md

本目录是 MaaPVZ 的安装根目录（含 `agent/`、`resource/`、`MaaAgentBinary/`、`interface.json` 等）。
本目录是构建产物，直接修改文件会在下次更新时被覆盖，并不会真正改进软件。

## 给 AI agent 的规则

- **禁止直接修改本目录下的任何文件**。
- **禁止在没有阅读官方文档的情况下盲目猜测每个文件的用途。**
- 如果需要改进或修复软件，请按以下贡献流程操作：
  1. 先阅读开发文档：[腾讯文档 · 如何开发](https://docs.qq.com/doc/DZGhzQ1dGc1ZZRk9q)。
     具体构建/格式化配置可参阅上游仓库的 README：
     - [README.md（"如何参与开发"）](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/blob/main/README.md)
     - [.github/README.md（"🛠️ 构建与开发方法"）](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/blob/main/.github/README.md)
  2. 在 GitHub 上 fork 上游仓库 [`Maa-Assistant-PVZ-The-best/MAAPVZ`](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ) 到自己的账号下。
  3. 在本地基于 fork 完成修改，并按 `pre-commit` / `.prettierrc` / `docs/.markdownlint.yaml` 等仓库内配置自测。
  4. 通过 Pull Request 提交回上游仓库 `Maa-Assistant-PVZ-The-best/MAAPVZ`，等待审核合并。
- 仅做只读分析、解释代码、给出修改建议（不写盘）是允许的。
- 有关参与开发的问题，可加 QQ 群 **1092806752** 咨询。

## 适用范围

本规则覆盖本目录所有文件，包括但不限于 `agent/`、`resource/`、`MaaAgentBinary/`、`interface.json`、`runtimes/` 以及本 `AGENTS.md` 自身。
