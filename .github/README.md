# MaaPVZ - 植物大战僵尸2自动化脚本

<div align="center">
  <img src="./docs/imgs/PVZAA.png" alt="MaaPVZ" width="400">
</div>

基于图像识别技术的《植物大战僵尸2》自动化工具。

## ✨ 主要功能

### 🔄 日常

- [x] 启动游戏（支持4399、小米、B服、华为、TapTap、应用宝等主流渠道服）
- [x] 每日签到
- [x] 免广告卡（每日50钻、潘妮秘宝、超Z钥匙等）
- [x] 植物探险（多世界、支持双倍碎片）
- [x] 关闭游戏

### 🔧工具类

- [x] 小工具（测定向序列）
- [x] 日志清理
- [x] 刷胜场/金币、幸运宝藏、旅行原木（测试中）

### ♾️ 无尽挑战（重构版）

- [x] 无尽挑战：**作业集模式**——按关卡区间自动换阵容、选卡、局内种植、神器补给、148 关全程无人值守
- [x] 作业集编辑器：网页端可视化管理阵容表/卡槽/boss 关覆盖，保存即预编译
- [x] 智能选卡（局内/编队/局外 80 选）与组合动作引擎（多指种植、识别触发中断、断点续做）

### ⚔️ 战斗类

- [x] 碎片挑战（巨人危机、邪恶入侵，支持自定义植物配置）
- [x] 双人对决（支持自选/帮选模式，僵尸释放时机及强化buff配置）
- [x] 创意庭院（刷点赞/金币，OCR 关卡 ID）
- [x] 时空秘境 / 潘妮秘宝（测试中）

## 📋 前置条件

- 模拟器分辨率调整为平板 **720p (1280×720)** 或 **1080p (1920×1080)**
- **锁定屏幕旋转**为横屏，以达到最佳运行效果

## 🚀 运行方法

1. 前往 [Release页面](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/releases/latest) 下载最新版本。
2. 确保模拟器满足上述前置条件。
3. 调整软件配置，选择对应渠道服与任务，然后启动。

📖 完整使用教程见官网 **[MaaPvz 用户手册](https://daoyanxiaoz.github.io/Maapvz_User_md/)**。

## 🛠️ 构建与开发方法

1. 环境依赖：`Python >= 3.12`，参考 `requirements.txt` 安装依赖。
2. 本项目基于 **[MaaFramework](https://github.com/MaaXYZ/MaaFramework)** 驱动，Pipeline 配置存放于 `assets/resource/pipeline/` 目录。
3. 本项目前端使用了 **[MFAAvalonia](https://github.com/SweetSmellFox/MFAAvalonia)**。
4. 提交代码前，请配置 Pre-commit Hooks 以确保代码格式规范（参考 `.pre-commit-config.yaml`）。
5. 版本推送说明
触发方式说明
方式 关键词 / 标签 生成的标签格式 发布类型
推送 commit，消息含 v.x.y.z-beta 预发布
推送 commit，消息含 v.x.y.z 正式版
手动推送标签 标签名以 正式版‑ 或 测试版‑ 开头 直接使用推送的标签名 依标签名决定

📚 开发文档（命名规范 / Custom 使用教程 / 文件位置）：
**[MaaPvz 开发文档](https://daoyanxiaoz.github.io/Maapvz_User_md/开发文档/开发文档.html)**
· 仓库内另有 `AGENTS.md`（协作铁律精简版）与 `game_assist_tools/endless_setup/HANDOFF.md`（作业集编辑器专题）。

## 💬 交流反馈

- QQ群：669689256
- GitHub Issues：[提交问题](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/issues)

## 🤝 鸣谢

感谢以下开发者对本项目作出的贡献：

[![Contributors](https://contrib.rocks/image?repo=Maa-Assistant-PVZ-The-best/MAAPVZ)](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/graphs/contributors)

## 📄 许可证与声明

本项目基于 [MIT](https://opensource.org/licenses/MIT) 许可证开源，相关细则如下：

- **使用：** 本项目使用者可以按自己的意愿自由使用本软件。对于由此可能产生的损失，本项目开发者不负任何责任。
- **分发：** 允许任何人自由分发本软件，但必须保留原有版权声明，不得删除或隐瞒原作者信息。
- **传播：** 原则上允许自由传播，但不希望在游戏官方媒体或官方社群下提及本软件，以免引起不必要的麻烦，希望各位理解。
- **图像：** `MaaPVZ 图标` 及相关游戏截图素材著作权归原作者及游戏厂商所有，仅限非商业用途使用。
