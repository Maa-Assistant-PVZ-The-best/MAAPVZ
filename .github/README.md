# MaaPVZ - 植物大战僵尸2自动化脚本

<div align="center">
  <img src="./docs/imgs/PVZAA.png" alt="MaaPVZ" width="640">
</div>

基于图像识别技术的《植物大战僵尸2》自动化工具。

## ✨ 主要功能

### 🔄 日常

- [x] 启动游戏（支持4399、小米、B服、华为等主流渠道服）
- [x] 每日签到
- [x] 每日50钻（需拥有免广告卡）
- [x] 植物探险
- [x] 日志清理

### ⚔️ 战斗类

- [x] 碎片挑战（巨人危机、邪恶入侵，支持自定义植物配置）
- [x] 双人对决（支持自选/帮选模式，僵尸释放时机及强化buff配置）
- [ ] 创意庭院（开发中...）

## 📋 前置条件

- 模拟器分辨率调整为平板 **720p (1280×720)** 或 **1080p (1920×1080)**
- **锁定屏幕旋转**为横屏，以达到最佳运行效果

## 🚀 运行方法

1. 前往 [Release页面](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ/releases/latest) 下载最新版本。（暂不可用）
2. 确保模拟器满足上述前置条件。
3. 调整软件配置，选择对应渠道服与任务，然后启动。

## 🛠️ 构建与开发方法

1. 环境依赖：`Python >= 3.12`，参考 `requirements.txt` 安装依赖。
2. 本项目基于 **[MaaFramework](https://github.com/MaaXYZ/MaaFramework)** 驱动，Pipeline 配置存放于 `assets/resource/pipeline/` 目录。
3. 本项目前端使用了 **[MFAAvalonia](https://github.com/SweetSmellFox/MFAAvalonia)**。
4. 提交代码前，请配置 Pre-commit Hooks 以确保代码格式规范（参考 `.pre-commit-config.yaml`）。

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
