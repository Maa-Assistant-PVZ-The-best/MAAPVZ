# MAAPVZ 作业集 / 无尽挑战重构 —— 交接文档

> 生成时间：2026-09-24
> 用途：把本会话的全部进度、约定、坑点交接给新工作区，读完即可直接接手。
> 配套知识库：`C:\Users\z'j's\Desktop\苦手给的妙妙小工具\skills\maa-endless-jobset\SKILL.md`（设计决策来源）

---

## 0. 一句话现状

**网页端（作业集编辑器）已完成并验证可用；运行时（agent 读作业集执行）尚未开始。**

网页端目前是一个「行为表编辑器」：作者在网页上配槽位植物 → 在棋盘落子 → 存成作业集 JSON 到 `assets/resource/jobs/`。
运行时那半边（MaaFramework 真跑起来读作业集执行 plant/feed/wave/换阵容）还是空的。

---

## 1. 目标（来自用户）

给「无尽挑战（重构）」加**作业集模式**，三种模式：

| 模式 | 说明 | 状态 |
|---|---|---|
| 编辑作业集 | 运行任务时打开本地网页编辑器 | 网页端已完成；agent 侧 `OpenJobEditor` 已写 |
| 使用本地作业集 | 读 `jobs/current.json` 指定的作业集 | 运行时**未实现** |
| 使用远程作业集 | 输短码从 GitPages 下载 | **已确认暂剔除**（用户还没建 GitPages） |

核心设计：**关卡是线性的**，行为表以换阵容为锚点可 N 张（表1 打 1~50 → 表2 从 50 开始 → …）。

---

## 2. 代码位置

```
D:\maapvz\MAAPVZ\
├── game_assist_tools\endless_setup\        ← 网页工具（本会话主要产出）
│   ├── pvz.py            4.4KB  Flask：/ + /save_config + 作业集 4 API
│   ├── pvz.bat           2.2KB  启动器（探测解释器→后台启动→轮询就绪→开浏览器）
│   ├── config.json       920B   默认实例配置
│   └── static\
│       ├── index.html    ~4008 行  ★ 编辑器全部逻辑（HTML+CSS+JS 单文件）
│       ├── plants.json   34KB   316 个植物（name/en/rarity/rare/img）
│       ├── plant\        1.34MB 316 张植物图标 WebP
│       └── card_bg\      0.01MB 5 张品质底图 rare_0~4.webp
├── assets\resource\jobs\                   ← 作业集数据（jobs/<code>.json + current.json）
├── assets\resource\pipeline\Endless_ref.json\
│   ├── 01_Endless_ref.json      空壳节点「无尽挑战_加载作业集代码」
│   └── Endless_html_ref.json    「无尽挑战_编辑作业集」→ Custom/OpenJobEditor ✅
├── assets\resource\task\Endless_ref\Endless_ref.json   作业集模式三个 option（已有接线）
├── agent\my_action.py           末尾有 OpenJobEditor CustomAction ✅
└── assets\interface.json        「无尽挑战（重构）」已挂 作业集模式 ✅
```

---

## 3. 已完成的工作（网页端）

### 3.1 图片资源
- 图源：`D:\.dsh-plugins\新工作区\选卡页面_植物`（355 PNG = 319 图标 + 5 品质底图 + 31 变种）
- **31 个变种（`*_newrare_*.png`）全部跳过**，转换 316 张 → WebP，**6.96MB → 1.34MB**
- 品质底图 `rare_0~4` 同步更新（白=0 绿=1 蓝=2 紫=3 橙=4）
- `plants.json` 由 `agent/select_plant/植物中英文对照表.md`（316 条全部匹配，0 缺失）生成

### 3.2 UI 清理（删掉 7 块旧界面）
卡槽备注面板、快捷开关&批量放置、📄 预览面板、棋盘控制行（列数/行数/应用/重置）、快捷键提示行、右侧快速控制、编队切换面板。
配套补了全套 JS 空值保护，并给状态提示加了**右下角浮动提示**（原状态栏随预览面板一起删了）。

### 3.3 槽位植物 + 喂豆 + 棋盘落子
- **8 个植物槽位** + 下方独立一行「🫘 喂豆」（不是「槽9」，就是个喂豆操作）
- 槽位显示：品质底图 + 植物头像 + 名称 + ✎（换植物）；点击选中 → 脉冲高亮 → 点棋盘格子落子
- 落子后格子里显示**植物头像 + 品质底图**；喂豆落子显示红色「喂豆」标记
- 位置语义：在**普通关**棋盘落子 = 小关喂豆；在 **boss关**棋盘落子 = boss 喂豆

### 3.4 选植物弹层
- **16:9 卡片**（实测 162×91，比例 1.778，仿 PVZ2 卡槽），弹层 900px，**每行 5 个**
- 品质筛选栏：`全部 / 收藏 / 橙 / 紫 / 蓝 / 绿 / 白`
- 键盘：**W/S（↑↓）切换、A/D（←→）跳 5 个、回车确认、Esc 关闭**（搜索框内打字不抢键）
- **右键收藏**：★ 金色角标 + 收藏项排最前 + 存 localStorage（`maapvz_plant_favs_v1`）
- **1~8 槽去重**：已被其它槽位占用的植物置灰 + 红标「槽N」+ 不可选，W/S 自动跳过

### 3.5 行为表（关卡线性推进）
- 表1 起始关固定 `1`（只读）；表N 起始关 = 表N-1 结束关
- **双向同步**：改结束关 → 下一张起始关跟着变；改起始关（表2+）→ 上一张结束关跟着变
- **上一张没设结束关 → 不允许新建下一张表**（弹提示）
- 每个 tab 自带 **✕ 删除**（数据删除 + UI 立即刷新 + 链条重连）
- 校验：结束关必须 > 起始关，违反则清空并提示

### 3.6 动效
- 弹层淡入 + 面板上滑；卡片错峰入场（`animationDelay = min(idx,20)*9ms`）
- 卡片 hover 上浮、当前项呼吸环、★ 收藏弹出、槽位选中脉冲
- 落子：格子闪光 + 植物/喂豆 chip 弹入（`jobDropPop`）；**只在真正落子那一次播**（`jobLastDrop` 标记）
- 支持 `prefers-reduced-motion`

### 3.7 多株同格 → 缩略图 + 悬停详情（最后一轮）
- 同格植物数 → 格子加 `job-n1..job-n9` 类，chip 自动缩到 **26 / 20 / 16 / 13 px**，格子不再被撑成长方形
- 实测：同格 5 株 → chip `16x16`，格子 `68x62` = 空格的 `68x62`（**不变形**）
- **鼠标悬停该格 3 秒** → 弹出 `#cellDetail` 浮层，列出该格部署（头像+名称+品质），移开即隐藏
- 有内容的格子不再挂旧 `data-tooltip`（避免和详情浮层打架）

### 3.8 本地缓存（刷新不丢）
- key `maapvz_jobset_v1`：元信息（code/name/version/最大关卡/兼容世界）+ 全部行为表（含槽位、普通关/boss关棋盘落子）+ 当前表 + 品质筛选
- 触发：面板内 input/change、落子、清空格子、选植物、清空槽位、增删表（300ms 防抖）
- ⚠️ **`jobInit()` 必须在页面 `loadDefaults()` 之后调用**（否则棋盘会被重置覆盖）

---

## 4. 关键技术约定（必读，都是踩过的坑）

| # | 约定 | 原因 |
|---|---|---|
| 1 | **`jobInit()` 放在 `window.onload` 内、`loadDefaults()` 之后** | loadDefaults 会 `initBoards()` 重置棋盘，放前面会把恢复的数据冲掉 |
| 2 | **删 DOM 元素后必须补 JS 空值保护** | 页面有大量 `getElementById(...).xxx`，元素没了会抛错，`onload` 一旦中断→**后面所有事件绑定全失效**（tab 点不动就是这么来的） |
| 3 | **级联/校验只在 `change` 做，不在 `input` 做** | 打字时逐键触发校验会把输入中的值判为非法并清空（结束关输不进去的 bug） |
| 4 | **`element.style.cssText = ...` 会整体覆盖 inline style** | 动画延迟等要在 `cssText` **之后**再设，否则被抹掉 |
| 5 | 函数改名要全局搜引用 | `jobCascadeLevels` 改名后删除逻辑还在调用旧名 → ReferenceError → 数据删了 UI 不刷新 |
| 6 | Flask static 挂在 `/static/...` | `plants.json` 里图片路径必须写 `static/plant/x.webp`，写 `plant/x.webp` 会 404 |
| 7 | `.venv` **没有 flask** | `pvz.bat` 已做多解释器探测（优先项目 venv，回退 `D:\ana\python.exe`）。用户在联网环境执行一次 `pip install -r requirements.txt` 即可补齐 |
| 8 | 只改 `static/index.html` + 图片资源 | 用户明确限定过改动范围；`pvz.py`/`agent`/`pipeline` 未动 |

---

## 5. 验证方法（强烈建议沿用，很好用）

**无头 Edge + 注入测试脚本 + dump DOM**，能在不实机的情况下验证真实浏览器行为：

```powershell
# 1) 起服务（注意用 D:\ana\python.exe，它有 flask）
Start-Job { & "D:\ana\python.exe" "D:\maapvz\MAAPVZ\game_assist_tools\endless_setup\pvz.py" }
Start-Sleep 5

# 2) 写一个测试页：复制 index.html，在 </body> 前注入 harness
#    （harness 里 stub 掉 alert/confirm，调用内部函数，把结果写进 document.title）

# 3) dump DOM 并读 title
cmd /c "`"$edge`" --headless=new --disable-gpu --user-data-dir=`"$env:TEMP\ep" --virtual-time-budget=14000 --dump-dom http://127.0.0.1:5000/static/_t.html > out.html 2>nul"

# 4) Python 正则取 <title>（中文用 unicode_escape 打印，避免 GBK 控制台报错）

# 5) 删除测试页
```

**注意事项**：
- `index.html` 里的 `let`/`const` 顶层变量（`jobTables`、`plantCache`、`boardEarly` 等）**可以从另一个 classic script 访问**，harness 能直接调内部函数
- 控制台是 **GBK**：Python 打印含 emoji/中文要用 `.encode("unicode_escape")`，或用纯 ASCII 输出
- **PowerShell 管道把中文传给 Python stdin 会乱码** → 路径走环境变量、脚本避免中文字面量
- `node --check` 校验提取出的 script 段（提取时写临时 .js）

---

## 6. 待办（明确的下一步）

### A. 网页端剩余清理（用户已授权重构）
1. **旧实例导出簇**：`buildFullInstance` / `exportJSON` / `exportSlotRemarks` / `showExportNoteModal` / `renderSlotRemarks` / `slotRemarksEarly/Late` / `importFromJSONText` / `rebuildBoardsFromValues`（约 300~400 行，全部失效）
2. **选项树簇**：`OPTION_DEFS` / `buildOptionUI` / `currentValues` / 隐藏的「⚙️ 无尽选项」面板（`#optionTree`）
3. 工具栏「配置名称/文件名」默认值还是 `无尽_前后期`，待定改成什么

### B. 用户待补提示词的设计（等用户）
- **循环补种** — 重新设计
- **每关只补一遍** — 重新设计
- **沿用上一张boss** — 重新设计
- **点波启用** — 重新设计（目前已从 DSL 文本框改成复选框，但用户说还要改）
- 喂豆位置相关选项

### C. 运行时（S2~S6，网页端之外）
1. **JobSetEngine**（agent 单个 CustomAction）：读 `jobs/current.json` → 世界校验 → 选表 → 逐条执行
2. plant/feed/wave 动作翻译成 **BatchSwipe** DSL 执行
3. 关卡计数融合（自适应识别+计数，分数阈值法；复用 `frame_wj_custom_识别天数` 节点）
4. lineup 换阵（SelectPlants 选卡 / 游戏内切编队）
5. pipeline 接线 + 用 `check_resource.py` 验证

---

## 7. 已知问题 / 注意

- 页面有**浏览器缓存**：改完让用户 `Ctrl+F5` 强刷
- `assets/interface.json` 在 git status 里显示 `M`，**不是本会话改的**（用户切过分支，当前分支 `ref_Endless`）
- 网页工具的**桌面副本** `C:\Users\z'j's\Desktop\苦手给的妙妙小工具\index.html` 是**旧版**（本会话改的是项目内 `game_assist_tools\endless_setup\static\index.html`）
- 作业集 JSON 结构（当前网页导出）：
```jsonc
{ "code","name","version","worlds":[],"max_level":149,
  "tables":[{
     "from_level","to_level",
     "lineup":{"plants":[],"deck":null},     // 选卡 or 编队号
     "slots":{"1":"仙人掌",...},
     "non_boss":{"plant":[{"slot":"1","cells":["格子1_1"]}],
                 "feed":["格子4_1"],          // 喂豆落子
                 "wave":true,                 // 点波启用
                 "loop":false,"once":false},
     "boss":{"plant":[],"feed":[],"wave":true}
  }]}
```

---

## 8. 环境与沙箱

- 本机沙箱 `workspace-write` 后端**起不来**（`windows-acl-run: --temp is not an existing directory`）→ 所有命令要带 `danger-full-access` 才跑得动
- 工作区：`D:\maapvz\MAAPVZ`；项目用 `.venv`（Python 3.12，**无 flask**）；模拟器相关用 `D:\ana\python.exe`（flask 1.1.1）
- 无头浏览器：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- 会话不稳：**524 status code (no body)** = Cloudflare 网关超时，通常因为会话太长/上下文过大。建议新会话开工，工具调用保持短小、输出精简

---

## 9. 最近一次验证结果（全绿，作为基线）

```
slots: 9        cells: 45       optItems: 17
tabAfter: "late"                 ← tab 切换正常
picker: 316     cardAnim: "jobCardIn"
placed: "card1" dropAnim: "jobDropPop"
t1to: "50"  tables: 2  t2from: 50   ← 行为表关卡联动
同一格 5 株: cellClass="cell has job-n5"  chip=16x16  cell=68x62 (=空格 68x62，不变形)
悬停详情: detailShown="block" rows=5 icons=5 names=[仙人掌,伏僵塔黄,保龄泡泡,僵尸豆荚,充能柚子]
errors: []                       ← 零 JS 运行时错误
```
`node --check` 对提取出的 script 段 exit=0。
