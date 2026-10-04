# MAAPVZ 作业集 / 无尽挑战 —— 交接文档

> 工作区：`D:\maapvz\MAAPVZ`
> 网页端（作业集编辑器）：`game_assist_tools\endless_setup\static\`
> 运行时：`agent\jobset\*`（Python，CustomAction）

---

## 0. 一句话现状

**网页端（作业集编辑器）已可用；运行时已跑通「选卡 / 切换编队 + 种植 + 换阵容 + 补给 + 收尾」。**

收尾链的运行时接线**已完成**（早期版本这里是缺口，现已补齐）：
收尾检测 → 收尾链 → 结算 → 收尾超时后动作。

**2026-10-01 新增/改动（本轮）**：

| 功能 | 说明 | 文档 |
| --- | --- | --- |
| 通用动作「切换形态」 | 棋盘右侧「通用动作」→ 更多 → 切换形态 | §10.1 |
| 落子动作「点击格子」 | 左侧落子区 → 更多 → 点击格子 | §10.2 |
| **落子动作注册表** | 新增落子动作只改一个文件 | §10.3 |
| 通用动作参数系统 | 声明式参数（弹窗/chip/导出全自动） | §10.2 |
| **同格可重复落子** | 所有动作、所有形态都放开上限 | §10.4 |
| maafw 降到 5.13.0 | 与 VS Code 插件对齐（协议错配修复） | §12 |

> ⚠️ **环境版本约束**：`requirements.txt` 的 `maafw` 必须与 VS Code 插件
> 「Maa Pipeline Support」的预期版本一致，否则报
> `Protocol version mismatch`。详见 §12。

---

## 1. 三层架构

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 网页（编辑器） | `game_assist_tools\endless_setup\static\` | 可视化配置，导出作业集 JSON |
| 数据（作业集） | `assets/resource/jobs/<code>.json` + `current.json` | 每个阵容一张表 |
| 运行时（执行） | `agent/jobset/*` + pipeline → 驱动 BatchSwipe | 解析作业集并注入管道 |

执行层**复用两个成熟动作，不重写**：

- `agent/actions/batch_swipe.py` → `BatchSwipe`（组合动作 DSL）
- `agent/select_plant/custom_select_plant.py` → `SelectPlants`（选卡）

### 网页端文件结构（已拆分）

`index.html` 原本是 7995 行的单文件，现已拆分为多文件：

```
static/
├── index.html          # 仅 head + 资源引用 + body 结构
├── plants.json
├── button/             # 通用动作 / 落子动作的图标（webp）
├── card_bg/            # 卡槽品质底图 rare_0..4
├── plant/              # 植物立绘
├── supply/             # 补给图标
├── css/
│   ├── base.css            # 手写主样式
│   └── vendor-fluent.css   # 第三方 Fluent UI 样式
└── js/
    ├── 01-options.js … 14-onload.js              # 选项树编辑器（section 1–14）
    ├── 15-board-actions.js ★                     # 落子动作注册表（扩展入口）
    └── 20-jobset-core.js … 31-jobset-adv.js      # 作业集编辑器
```

> ⚠️ **关键**：Flask 的静态目录挂载在 **`/static/`**（`Flask(static_folder=STATIC_DIR)`），
> 不是根路径。所以 `index.html` 里的引用必须是 `/static/css/...`、`/static/js/...`；
> 写成相对路径 `css/...` 会 404。
>
> 数字前缀表示加载顺序，`<script>` 为非 module 模式，所有文件共享全局作用域。
>
> ★ `15-board-actions.js` **必须排在 `08-board-data.js` 之前**加载
> （棋盘渲染要用注册表判定动作）。

---

## 2. 作业集运行时（`agent/jobset/`）

| 文件 | 职责 |
| --- | --- |
| `engine.py` | 载入作业集，`pick_table(level)` 选表 |
| `level_tracker.py` | 关卡计数器 + 得分期望 |
| `dsl.py` | 格子名 → BatchSwipe DSL |
| `runtime.py` | 全部 CustomAction / CustomRecognition |
| `report.py` | 打印作业集解析结果（调试） |
| `selfcheck.py` | 离线自测（无设备） |
| `check_graph.py` | 检查管道断路 / 悬挂引用 |

**CustomAction 清单（10 个）**：
`JobSetLoad` `JobSetFight` `JobSetLevel` `JobSetSlot` `JobSetInfo`
`JobSetReset` `JobSetRollback` `JobSetStage` `JobSetFightPlan` `JobSetEndRestart`

**CustomRecognition**：`JobSetStageChanged`

### 关键机制

- **每段一个节点**：链里第 i 段 → 独立节点（名字带段号），顺序严格跟链走。
- **关卡融合**：首帧采信 OCR；后续与「上次识别值 +1」比对；连续自洽则重同步；
  分数满 100 转纯计数。
  - 参数：`init_score=50` / `score_max=100` / **`penalty=30`** / `gain=30` / `tolerance=2`
  - **`penalty=30` 的由来**：基准帧读错一次（如 `81→21`）后，比对基准被钉在错值上，
    之后每帧**正确的** OCR 都被算成「偏差过大」，只能靠「分数触底 → 回头信 OCR」爬出来。
    - `penalty=10`：要扣 **5 次**才触底 → 太慢（实测锁在错值上好几关）
    - `penalty=50`：扣 **1 次**就触底 → 太快，任何**单帧** OCR 误读（如 `87→89`）
      都会被直接采信，把错误固化
    - `penalty=30`：**第 2 次**触底 → 计数器持续跑偏能较快纠正，
      同时给单帧误读留一次容错（见 §9 观察项）
- **换阵容**：`JobSetStage` 锁表 → `JobSetRollback`（count-1，分数不变）→
  调用 `通用_重开_暂停` → 跳回 `无尽挑战_识别开始战斗_清空卡牌` 重新走选卡流程。
- **三条链**：`once_chain` / `loop_chain` / `end_chain`。
  单次链为空时 fallback 到 `无尽局内_循环种植`。
- **节点覆盖**：`next` 覆盖成
  「`无尽局内_继续挑战`（固定首位）+ 中间按链顺序 + 链尾」。
- **滑动时长**：管道里连续滑动会「第二个滑不出来」，所以用 `"滑动时长": 100` 之类调参。
- **换阵 = 选卡 或 切换编队**：见 §2.1，编队模式会跳过整套选卡流程。

### 2.1 切换编队（用编队代替选卡）

> 需求原话：「换阵使用换编队的话就不需要选卡逻辑了」「需要重开的，也需要确认自己在选卡界面」

**作业集字段**：每张表一个 `squad`（1-6），跟着 `from_level` 走。缺省/越界/`squadEnabled:false` → `None`（走选卡）。

```jsonc
{ "from_level": 50, "lineup": {"plants": []}, "squad": 2 }
```

**运行时只改两个字段**（`runtime.py` 的 `_squad_param` / `_inject_squad`）：

| pipe 节点 | 字段 | 值 |
| --- | --- | --- |
| `无尽挑战_识别开始战斗_清空卡牌` | `next` | `["无尽挑战_切换编队"]`（默认 `["无尽挑战_选取植物"]`） |
| `无尽_切换编队序号` | `any_of[i].expected`（**每一项**） | `["3"]`（**字符串**；默认 `[]`） |

注入点共 **4 处**：`JobSetLoad`（预计表预热）、`JobSetStage` 首次锁定、`JobSetStage` 换阵容、`_apply_table`（切表辅助）。

> ⚠️⚠️ **`无尽_切换编队序号` 是 Or 节点 —— 顶层 `expected` 无效！**
>
> **2026-10 该节点由「1 个 any_of」改成「2 个 any_of」**，覆盖方式必须跟着改：
>
> - **Or 的命中由各 `any_of[i]` 自己的 `expected` 决定**，节点顶层的 `expected`
>   **对 Or 节点不起作用**。
> - 原来只往顶层写 `expected` —— 对 Or 等于**没写**，编队号永远匹配不上，
>   `无尽_切换编队序号` 永不点火，**切编队功能整体静默失效**。
> - 现在两个 any_of（roi `135,129,57,167` 与 `132,125,77,566`，
>   覆盖编队列表的**不同显示区域**，同一语义）**都写入同一个编队号**。
> - `squad=None` 回滚时**同样要走 any_of 清空**，只清顶层是清不掉的。
>
> **实现方式**：`runtime.py` 用 `_SQUAD_ANY_OF` 骨架 + `_squad_any_of(expected)`
> **重建整个 any_of 数组**，而不是只盖 `any_of[i].expected` ——
> 不依赖 MAA 对「any_of 子项能否被 override 合并」的实现细节。
>
> 🚨 **`_SQUAD_ANY_OF` 必须与 pipe 的 `any_of` 保持同步**（项数 / roi / recognition）。
> 改了 pipe 不同步，注入就会把 pipe 的改动**盖回去**。
> `selfcheck.py` 第 10 节会**自动对照真实 pipe 文件**并把不一致报出来。
>
> 另外 pipe 文件是 **JSONC**（带 `//` 注释），用标准 `json` 读会炸，
> 自测里先按行剥掉注释再解析。

- **未配置时会主动回滚**（把 `next` 还原成「选取植物」、`expected` 清空），
  否则从编队表切回选卡表会残留上次设置。
- **`expected` 必须是字符串列表** —— 写数字 MAA 会当非法 expected，识别永不命中。
- **「确认在选卡界面」不用额外加节点**：就靠「清空卡牌」那个 OCR ——
  它认到「清空卡牌」才 Click 并走 `next`。认不到就超时，**不会误点编队**。

**网页端**：「换阵」下拉框（`tfLineupMode` = `plants`/`deck`）+ 编队号下拉（`tfDeckNo`，1-6）。
`jobBuild` 导出 `squad`；`jobApplyLoaded` 反向同步回 `lineupMode`/`deckNo`。
`jobSyncForm` 把编队号夹在 1-6。

---

## 3. 收尾链（已接通）

### 目标 pipeline 节点

```
assets\resource\pipeline\Endless_ref.json\03_Endless_fight\03-1Endless_fight_end\03-1-01Endless_fight.json
```

包含两个**空壳节点**（`enabled: false`，由运行时按作业集注入）：

```jsonc
{
    // 收尾检测：僵尸头像出现在右上角 = 最后一波
    "无尽挑战_收尾": {
        "recognition": "TemplateMatch",
        "template": ["Endless/frame/僵尸头像.png"],
        "green_mask": true,
        "roi": [586, 15, 54, 57],
        "enabled": false,
        "action": "DoNothing",
        "pre_delay": 0,
        "post_delay": 15000,
        "next": []
    },
    // 收尾超时后动作 = 「重开」时的落点
    "无尽挑战_收尾重开": {
        "action": "Custom",
        "custom_action": "JobSetEndRestart",
        "enabled": false,
        "pre_delay": 0,
        "post_delay": 0,
        "next": []
    }
}
```

### 语义

**检测到最后一波 → 执行一次收尾链 → 等结算 → 若超时则按配置执行后续动作。**

### 运行时注入

`JobSetFight` 会把收尾链按「每段一个节点」生成（同 `_build_seg_nodes`），
链尾节点的 `next` 结构为：

```
["无尽局内_继续挑战", <收尾超时后动作>]
```

先识别「继续挑战」（结算画面）点它过关；识别不到（收尾超时）时，
落到「收尾超时后动作」：

| 配置 | 链尾 `next` 第二项 | 行为 |
| --- | --- | --- |
| `sub` + `once` | `无尽局内_单次种植` | 执行一轮单次动作 |
| `sub` + `loop` | `无尽局内_循环种植` | 继续循环种植（默认） |
| `sub` + `end` | `无尽挑战_收尾` | 重新执行收尾动作 |
| `restart` | `无尽挑战_收尾重开` | 重开当前关卡 |

> ⚠️ `无尽挑战_收尾重开` 的壳节点是 `enabled: false`，
> 运行时注入时**必须显式置 `enabled: True`**，否则节点不会执行。

### `JobSetEndRestart`（收尾超时 = 重开）

- **不增加计数器**：重开打的还是同一关，重开后重新识别天数会得到同一关 →
  计数器判「抖动」不推进，因此**不需要**显式 `rollback_one`。
- 调用 `通用_重开_暂停` 重开。
- 重开后跳回 **`无尽挑战_选取植物_开始战斗`**（直接开局，**不重新选卡**）。

---

## 4. 收尾参数（网页端「棋盘下侧」面板）

仅当**普通关棋盘上放了「收尾」形态的落子**时才显示。
**收尾仅对普通关生效 —— boss 关不能有收尾。**

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `endPostDelay` | 「收尾前等待」= `无尽挑战_收尾` 检测节点 `post_delay` | 15000 |
| `endLastPostDelay` | 「收尾超时时间」= 收尾链最后一个动作 `post_delay` | 6000 |
| `endAfterAction` | 「收尾超时后动作」= `sub` / `restart` | `sub` |
| `endSubAction` | 「子动作」= `once` / `loop` / `end` | `loop` |

### boss 关禁掉收尾（三重防护）

1. `jobSlotMode()`：boss 棋盘下 `end` 读取时归一化为 `loop`。
2. `jobToggleSlotMode()`：boss 棋盘下只在 `单次 ↔ 循环` 之间切换。
3. `jobNormalizeBossEndModes()`：**切到 boss 关 tab 时立即把残留的 `end` 改回 `loop`** 并保存。

---

## 5. 作业集 JSON 结构（当前网页导出）

```jsonc
{
  "code": "...", "name": "...", "worlds": [], "max_level": 149,
  "tables": [{
    "from_level": 1, "to_level": ...,
    "lineup": { "plants": [...], "mode": ..., "deck_no": ... },
    "slots": { "1": "粉丝心...", ... },
    // 三条链的顺序（拖动 chip 调整）
    "slotOrder": [{key, from, to, picked?, order?}],
    "loopOrder": [...], "endOrder": [...],
    "waitAfter": { "once|card2|2,1|2": 3 },
    "slotModes": { "card1": "once|loop|end", ... },
    // 收尾参数（仅普通关）
    "endPostDelay": 15000, "endLastPostDelay": 6000,
    "endAfterAction": "sub", "endSubAction": "loop",
    // boss 关同构（前缀 boss）
    "bossSlotOrder": [...], "bossLoopOrder": [...], "bossEndOrder": [...],
    "bossWaitAfter": {}, "bossSlotModes": {},
    // 补给（每个阵容独立）
    "supplyPicks": [{"id": "all", "name": "全...", "img": "..."}],
    "non_boss": {
       "once_chain": [{"key","slot","type","label",...}],
       "loop_chain": [...], "end_chain": [...],
       "sequence": [...]        // 兼容旧字段
    },
    "boss": { "once_chain": [...], "loop_chain": [...], "end_chain": [...] }
  }]
}
```

**`waitAfter` 键格式**：`{模式}|{槽位key}|{r},{c}|{seq}`
——注意是 **(r, c) 行在前列在后**（网页端 `jobPlacementKey(mode,scopeId,r,c,seq)`）。
例：`once|card2|2,1|2` = 单次链 / 槽2 / 行2列1 = **格子2_3**。

**`slotOrder` 段格式**：`{key, from, to, picked?, order?}`

- `from:0, to:null` = 该槽全部落点（按 seq）
- `picked:[0,2]` = 指定下标（不连续时用）
- `order:[2,0,1]` = **块内自定义顺序**（拖动 chip 后写入）

---

## 6. 验证方法

```powershell
cd D:\maapvz\MAAPVZ
.venv\Scripts\python.exe check_resource.py assets/resource     # pipeline 校验
.venv\Scripts\python.exe agent\jobset\selfcheck.py             # 引擎离线自测
.venv\Scripts\python.exe agent\jobset\check_graph.py           # 断路检查
.venv\Scripts\python.exe agent\jobset\report.py                # 打印作业集解析
```

**网页端验证**：改完 JS 后对每个文件跑 `node --check`；
启动服务后确认所有 `/static/...` 资源返回 200。

---

## 7. 环境

> 版本对齐、插件下载源等**踩坑记录**见 **§12**，这里只列日常使用的路径。

- Python：`.venv`（3.12，**无 flask**）；Flask 工具用 `D:\ana\python.exe`（flask 1.1.1）
- 启动网页：双击 `pvz.bat`（会自动挑带 flask 的解释器），端口 **5000**
- 无头浏览器：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- 补给图片素材：`game_assist_tools\endless_setup\static\supply\`

> ⚠️ **本环境无法跑无头浏览器**：Edge 在受限沙箱下启动即崩
> （`mojo platform_channel: 拒绝访问 0x5`，IPC 被禁）。
> 所以**改 CSS / 布局后无法自动验证**，必须人工在浏览器里看（Ctrl+F5 强刷）。
> 见 §10.3「踩过的坑」里的教训 2。

---

## 8. 🚨 交接给下一个 AI 的硬性要求

1. **写完后必须删除所有测试脚本。**
   本项目约定：临时脚本用 `_` 或 `zz` 前缀，用完立刻删。
   收工前跑一次：

   ```powershell
   Get-ChildItem -File | Where-Object { $_.Name -like "zz*" -or $_.Name -like "_*" }
   Get-ChildItem game_assist_tools\endless_setup\static -File |
       Where-Object { $_.Name -like "zz*" -or $_.Name -like "_*" }
   ```

   两个都应为空。

2. **不要动 `tools\` 目录**（`tools\AGENTS.md` 明令禁止，那是构建产物）。

3. 改 pipeline 后跑 `check_resource.py`；改 Python 后跑 `selfcheck.py`。

---

## 9. 已知问题 / 注意

- **浏览器缓存**：改完网页端必须 `Ctrl+F5` 强刷（不用重启 Flask）。
- **Python 改动**：需**完全重启 MAA/Agent 进程**（模块只在启动时 import 一次）。
- **Pipeline JSON 改动**：重启 MAA 或重载资源。
- **`_apply_supply` 不覆盖 `无尽局内_补给` 的 `enabled`** —— 用户明确要求 custom 不抢这个字段。
- `check_graph.py` 会报 **3 个「空 next」**，均为**有意保留的空壳节点**，
  且都是 `enabled: false`，属正常：
  - `01_Endless_plant_ref.json 无尽挑战_检查是否需要选植物`
  - `01_Endless_plant_ref.json 无尽挑战_选植物`
  - `Endless_html_ref.json 无尽挑战_编辑作业集`
- `selfcheck.py` 的断言**已改成从常量/实际数据推导**，不再硬编码：
  - 扣分额用 `DEFAULT_INIT_SCORE - DEFAULT_PENALTY` 算，改 `penalty` 不会再假失败
  - 「至少一张表有植物列表」放宽为「**有植物 或 有编队号**」——
    编队模式的表 `plants` 本来就是空的，属正常
  - 截至最近一次运行：**全部通过，无失败项**

### 9.1 观察项（暂不改，先攒数据）

- **`_ocr_self_consistent()` 的判据是「严格 +1」**，所以同一帧内连续读到同一个值
  （`samples = [82, 82, 82]`）反而被判为**不自洽**。反直觉，但目前影响不大
  （`penalty=30` 后的「触底重信 OCR」更可靠），先观察。
- **`locked`（纯计数器）模式跑偏后无法自愈**：它只判断「天数变没变」。
  实测在**锁定那刻基数正确**时能一路跟住，所以暂不动；
  但若发现锁定后长跑偏，需要在这里加保险。
- **OCR 本身的误读**（`81→21`、`87→89`）：这是识别精度问题，**不是 replace 表能解决的**
  （那两条现有规则 `g→9`/`G→6`/`《→8` 都是「非数字→数字」，
  而这两次是**数字变数字**；加 `2→8` 会误伤真正的第 2 关/第 20 关）。
  真要修得动 `roi` / `threshold` 或改数字模板匹配，**需要实际截图才能判断**。

---

## 10. 未来要加的东西

> 以下为**已登记但未开工**的需求。2026-10-01 之后，其中两条**已经有了现成的扩展通道**
> （见 §10.2 通用动作 / §10.3 落子动作），实现成本大幅降低。

1. **HTML 适配无尽局外选择 80 个植物**
   —— 网页端支持在「无尽局外」（非局内）场景下从 80 个植物中选择。

2. **使用神器**
   —— 支持「使用神器」这一动作。
   ★ **归类取决于交互**：
   - 若是「点击某个固定坐标/格子」→ 走 **落子动作**（§10.3），加注册表一条即可
   - 若是「按槽位点 N 次」→ 走 **通用动作**（§10.2 A），加 `GENERIC_SLOT_CLICK` 一行
   - 坐标表里已有 `神器_初始化_神器位置` / `神器_初始化_葫芦小体型`，可能可复用

3. **通用动作增加「滑飞弹」**
   —— `JOB_GENERIC_ACTIONS` 目前只有 `wave`（点波）/ `bean`（捡豆）/ `speed`（加速）。
   ★ 照 §10.2 的流程加：坐标表 + `GENERIC_SLOT_CLICK`（若按槽位）或
   `generic_dsl` 新分支 + `JOB_MORE_ACTIONS` 一个定义。

4. **两个坐标之间的动作**（用户提出，尚未细化）
   —— 例如「点 A 再点 B」「从 A 滑到 B」。
   ★ 已有预留：`15-board-actions.js` 的注释里给了 `pairMode` 的写法示例，
     但**一次落两个格子**的交互（怎么选起点/终点）还没设计。
     若要做，需要先定：
     - 落子交互（点两次？还是拖拽？）
     - 段的 `cells` 语义（`[起点, 终点]` 还是新增 `cells2`）
     - agent 端编译（`tap` 是单点，双点/滑动要新的 `dslType`，见 §10.3 约束 2）

---

## 10.1 已完成的：「切换形态」通用动作

> 入口是棋盘右侧通用动作按钮组**末端的「更多」按钮**（`#moreList` → `#morePicker`）。

**交互**：选槽位 1-8 + 填点击次数 → 插入到指定链。

| 项 | 说明 |
| --- | --- |
| 坐标 | `coords.json` 顶层键 `槽1切换形态` … `槽8切换形态` |
| 动作语义 | **纯点击**，不做形态档位换算 —— 填几次就点几次 |
| 间隔 | **不加**。要控制节奏由用户在链里插「等待」段（等待仍是合法链段） |
| 上限 | 槽位 1-8；次数 1-20（`GENERIC_FORM_TIMES_MAX`） |

**段形状**：`{ key: 'ga:form', ga: 'form', slot: N, times: M }`

**DSL 编译**（`dsl.py` → `generic_dsl(action, coords, ms, slot, times, params)`）：

```
slot=3 times=2  ->  click:槽3切换形态;click:槽3切换形态
```

> ★ 新增的通用动作请**统一走 `params` 参数袋**（把整个段传进去），
> 不要再往函数签名里加位置参数。`slot`/`times` 两个位置参数只为向后兼容保留。

> ⚠️ **槽位越界不夹取**：`slot=9` 一律返回 `None` 并记 `missing`，
> **不能悄悄退化成槽 8** —— 那会点错槽位的按钮。次数越界才夹取（1..20）。

**网页端**：`JOB_FORM_ACTION`（`24-jobset-fields.js`）用 **`params` 声明**参数
（见 §10.2 C）；`jobGenericActionById` 从 `JOB_ALL_GENERIC_ACTIONS` 取，
**但按钮组仍只渲染 `JOB_GENERIC_ACTIONS` 的 3 项** —— 扩展动作只从「更多」进。

**易丢字段的四处坑（都已接好，改动时务必留意）**：

| 位置 | 函数 | 不通会怎样 |
| --- | --- | --- |
| `23-jobset-end.js` | 重载映射 | 存盘后重载，参数被静默丢掉 |
| `27-jobset-board.js` | `jobSegsToSteps` | 每次渲染重建对象，参数丢失 |
| `27-jobset-board.js` | `jobStepsToSegs` | 存盘写回时参数丢失 |
| `27-jobset-board.js` | `jobStepId`/`jobSegFingerprint`/`jobCarryUids` | 参数不同的段撞成同一 id，勾选/拖动串位 |

> ★ 这四处**已改成由 `jobActionParams(ga)` 驱动**（`jobParamsIdentity` /
> `jobParamsGroupKey`）—— 只要 `params` 声明写对就自动覆盖。
> 「等待」的 `ms` 是同样性质的参数，当初就是照它先例加的。

**boss 关防护**：boss 关没有收尾链。`jobCycleMoreTarget` / `jobCycleGenTarget`
在目标非法（残留 `'end'`）时先规范化再切；`jobConfirmMorePicker` /
`jobConfirmGenPicker` 另有兜底 —— boss 棋盘下 `'end'` 一律改走 `'loop'`，
**绝不往 boss 的 `end_chain` 写东西**。

**验证**：`selfcheck.py` 第 8 节共 21 条断言（坐标键齐全 / 次数展开 / 缺省回落 /
越界夹取 / 槽位越界判无效 / `ga:` 前缀等价 / **参数袋形式** / **驱动表坐标齐全**）。

---

## 10.2 ★ 如何新增一个通用动作（可扩展性指南）

> 这一节是本项目**最该先读**的部分。2026-10-01 做了一次重构，
> 把「带参数的通用动作」做成了**声明式**：加动作只改**一张表 + 一个定义**，
> 弹窗 UI、chip 内联编辑、段存盘、导出 JSON、DSL 编译**全部自动跟随**。

### A. 如果是「按槽位点 N 次」这一族（最省事）

例如要做「滑飞弹」「使用神器（按槽位）」：

**① 坐标表** `agent/assets/resource/coords.json` 加键，模板必须形如 `槽N<后缀>`：
```jsonc
"槽1滑飞弹": [x, y], ... "槽8滑飞弹": [x, y]
```

**② 后端一张表** `agent/jobset/dsl.py` → `GENERIC_SLOT_CLICK` 加一行：
```python
GENERIC_SLOT_CLICK = {
    "form":  {"coord": "槽{n}切换形态", "slot_max": 8, "times_max": 20},
    "fling": {"coord": "槽{n}滑飞弹",   "slot_max": 8, "times_max": 20},  # ← 新增
}
```
`generic_dsl` **不用改** —— 它靠这张表驱动。

**③ 前端一个定义** `static/js/24-jobset-fields.js`：
```js
const JOB_FLING_ACTION = {
    id: 'fling', name: '滑飞弹', icon: '🚀', img: '',
    desc: '从指定槽位滑出飞弹',
    params: [
        { key: 'slot',  type: 'int', label: '槽位', min: 1, max: 8, def: 1, prefix: '槽' },
        { key: 'times', type: 'int', label: '次数', min: 1, max: 20, def: 1, suffix: '次' }
    ]
};
// 挂到「更多」列表里
const JOB_MORE_ACTIONS = [JOB_FORM_ACTION, JOB_FLING_ACTION];
```
**弹窗、chip、导出、存盘都不用改。**

做完跑：`selfcheck.py`（第 8i 条会自动检查新动作的坐标是否齐全）。

### B. 如果是「任意形态」的新动作

1. `dsl.py` → `generic_dsl` 里加一个 `elif aid == "xxx":` 分支，
   参数**一律从 `merged`（也就是整个段）里取**，不要新增位置参数。
2. `24-jobset-fields.js` → 加定义（`params` 写你需要的字段）+ 挂进 `JOB_MORE_ACTIONS`。
3. 其余自动。

### C. 参数声明（`params`）字段说明

| 字段 | 含义 |
| --- | --- |
| `key` | 段上的字段名，也是导出 JSON 的键 |
| `type` | 目前只有 `'int'` |
| `label` | 弹窗里的标签 |
| `min`/`max` | 取值范围（UI 与导出都按它夹取） |
| `def` | 默认值（缺省/非法时回落） |
| `prefix`/`suffix` | 显示单位（如 `槽` / `次`），chip 上会渲染成两侧小字 |
| `width` | chip 里控件宽度 px（默认 34，**不建议低于 34**） |

### D. ⚠️ 布局红线（踩过三次坑，务必先读）

**背景**：链条侧栏 `#seqDrawer` 是**固定 360px**（`.seq-drawer-body` 再各扣 12px padding、
`.seq-chain` 扣边框），**块头可用宽度只有约 334px**。而块头里还要放
拖柄 / 序号 / 图标 / 名字 / 勾选框 / ⏱ / ✕ —— 留给参数控件的空间很有限。

1. **不要「常显」多个输入框**。「切换形态」最初把槽位+次数两个 `input` 一直显示，
   结果**数字被压得看不见**（视觉上像「被遮住」）。
   现在改成 **摘要态 + 点击展开**：
   - 默认只渲染一个纯文本 chip（`jobParamsSummary`，如 `槽3 丨 2次`），
     **纯文本宽度自适应，永远不会被压没**；
   - 点它才换成输入框，`focusout` 自动收回。
   - 摘要态实测占用 257px（余量 77px），编辑态才短暂变宽。
2. **`type="number"` 的 spinner 必须关掉**。上下箭头占约 16px，
   窄框里会把数字挤没。`jobBuildParamControl` 里用内联样式关
   （`appearance:textfield` + `::-webkit-*-spin-button`），
   CSS 类里也写了 `::-webkit-inner-spin-button` 兜底。
   用户明确要求「删掉槽位的上下选择」。
3. **宽度必须用内联样式锁死四件套**（`width`/`minWidth`/`maxWidth`/`flexBasis`）。
   全局规则 `select, input { width:100% }` 在 flex 行里会撑满整行，
   把后面的勾选框 / ✕ **挤出 `.seq-chain`（`overflow:hidden`）的可视区** ——
   表现为「按钮不见了」，但 DOM 里其实存在（我第一次就是这么被骗的）。
4. `.seq-chain-head` 已加 `flex-wrap: wrap` 作为兜底：最差掉到第二行，不会再被裁掉。
   **但不要依赖它** —— 换行会让块头变高，看起来很难看。

> **教训**：这个项目的布局问题**无法靠读 CSS 推算出来**（我算过两次预算都说"放得下"，
> 实际都被裁了）。改动块头/弹窗布局后，**必须在浏览器里实际看一眼**（Ctrl+F5 强刷）。

### E. 参数丢失的四处（新增参数时逐一确认）

| 位置 | 函数 | 不通会怎样 |
| --- | --- | --- |
| `23-jobset-end.js` | 重载映射 | 存盘后重载，参数被静默丢掉 |
| `27-jobset-board.js` | `jobSegsToSteps` | 每次渲染重建对象，参数丢失 |
| `27-jobset-board.js` | `jobStepsToSegs` | 存盘写回时参数丢失 |
| `27-jobset-board.js` | `jobStepId` / `jobSegFingerprint` / `jobCarryUids` | 参数不同的段撞成同一 id，勾选/拖动串位 |

> ★ 这四处**已经改成由 `jobActionParams(ga)` 驱动**（`jobParamsIdentity` /
> `jobParamsGroupKey`）。只要新动作的 `params` 声明写对，它们会自动覆盖；
> 但请**务必实测一次「插入 → 保存 → 重载」**确认参数还在。

---

## 10.3 ★★ 如何新增一个「落子动作」（注册表驱动）

> **落子动作** = 摆在棋盘上的动作（喂豆 / 铲子 / 点击格子），
> 与「链上的通用动作」（点波 / 捡豆 / 切换形态）是**两套不同的东西**。

### 唯一入口：`static/js/15-board-actions.js`

以前新增一个落子动作要在 **6 个文件**里各改一处（左侧按钮 / 弹窗 /
棋盘渲染 / 链渲染 / 落子 / 导出），极容易漏。现在**只改这一个文件**：

```js
// 15-board-actions.js
const JOB_BOARD_ACTIONS = [
    { id: 'feed',   name: '喂豆', icon: '🫘', imgKey: 'feed',   armedNo: 9,  dslType: 'feed',   builtin: true },
    { id: 'shovel', name: '铲子', icon: '🧤', imgKey: 'shovel', armedNo: 10, dslType: 'shovel', builtin: true },
    { id: 'tapcell', name: '点击格子', icon: '👆', imgKey: 'tapcell', armedNo: 11, dslType: 'tap', inMore: true,
      desc: '选中后在棋盘落子，执行时点一下那个格子' },

    // ★★★ 新增动作就加在这里 ★★★
    // { id: 'dragcell', name: '格子间滑动', icon: '↔️', armedNo: 12, dslType: 'drag',
    //   desc: '从起点滑到终点', inMore: true }
];
```

**图标**：在 `24-jobset-fields.js` 的 `JOB_UI_IMG` 里加一行
（图片放 `static/button/<名字>.webp`），然后注册表的 `imgKey` 指向它：

```js
// 24-jobset-fields.js
const JOB_UI_IMG = {
    ...
    tapcell: 'static/button/点击格子.webp'
};
```

> 没配 `imgKey` 时 `jobBoardActionImg()` 会**回退到铲子占位**
> （方便先把功能跑通、后补图）。

加完之后**自动生效**的部分：
左侧按钮、左侧「更多」弹窗、棋盘落子、棋盘标记渲染、链上的块、
链段导出、存盘重载、W/S 键盘循环、状态提示、取消选择弹窗图标、
同格缩略图计数、`jobSlotKeyOf` / `jobSlotLabel`。

> ★ 但**「常驻显示 / W/S 可达」是有条件的** —— 新动作落子之前，
> 左侧不显示、W/S 也循环不到它。见 **§10.3.2**。

### ⚠️ 三个必须注意的约束

1. **`armedNo` 必须唯一，且 ≥ 9**（1-8 是植物槽）。
   建议从 11 往后递增。重复会导致选错动作。
2. **`dslType` 决定 agent 怎么编译**。目前 agent 端（`dsl.py` / `runtime.py`）
   只认这几种，**新增 dslType 需要同步改 agent**：

   | dslType | 编译结果 | 说明 |
   | --- | --- | --- |
   | `plant` | `swipe:种植物_初始化_第N个槽位,种植物_初始化_格子C_R,80` | 从卡槽滑到格子 |
   | `feed` | `swipe:种植物_初始化_能量豆位置,种植物_初始化_格子C_R,80` | 从能量豆滑到格子 |
   | `shovel` | `swipe:种植物_初始化_铲子位置,种植物_初始化_格子C_R,80` | 从铲子滑到格子 |
   | `tap` | `click:种植物_初始化_格子C_R` | **纯点击**，无起点 |

   > ★ **坐标键名一律是完整形式** `种植物_初始化_格子<列>_<行>`，
   > 由 `find_grass_point()` 从作业集里的短名 `格子C_R` 解析出来。
   > 上面表格里的 `格子C_R` 只是简写，**实际 DSL 里绝不会是裸 `格子1_1`**
   > （coords.json 里根本没有裸键，实测只有 `种植物_初始化_格子1_1` 这种）。

   > 起点逻辑在 `dsl.py:chain_dsl` 与 `runtime.py:_build_chain_nodes` 两处，
   > **两边都要改**（它们各有一份同样的 if/elif）。

3. **`item.type` 用动作自己的 `id`**（见 `jobBoardActionItem`）。
   棋盘样式靠**统一类**选中，不再按 type 逐个列举：
   - 标记容器挂 `job-mark`（`.cell .tag.job-mark` 负责定位/尺寸/透明底）
   - 标记图片挂 `job-mark-img`（`.cell .tag .job-mark-img` 负责 100% 撑满）
   - `type` 只用于附加语义，CSS 不依赖它与子类名配对

   > ⚠️ **不要**再写 `.tag.feed .tag-feed-img` 这种「父 type + 子类名」配对选择器。
   > 两者一旦对不上（比如新动作复用了 feed 的 type 却用别的图片类），
   > 选择器就不命中，图片退回**原始尺寸**（如 500×500），
   > 被 `.cell{overflow:hidden}` 裁成「只剩中心一小块」——
   > 这正是「喂豆/铲子/点击格子只显示图片正中心」那个 bug 的成因。

### 10.3.1 单格数量上限与「+N」角标

- **落子不再去重**：同一格可以放任意多个（植物 / 喂豆 / 铲子 / 点击格子
  / 未来扩展），单次与循环形态都放开。见 `21-jobset-levels.js` 的
  `placePlantOnBoard`。
- **渲染封顶 9 个**：CSS 只定义了 `job-p1`..`job-p9` 这 9 个坐标（3×3 摆满），
  第 10 个起没有定位，硬渲染会全堆在一起。
  所以渲染时 `_pIdx >= JOB_CELL_MAX_MARKS` 直接跳过，多出来的在
  **右下角显示红底「+N」角标**（`.cell .job-overflow`）。
- 常量 `JOB_CELL_MAX_MARKS = 9` 在 `08-board-data.js` 顶部。
  **改它必须同步改 CSS 里的 `.job-pN` 定位规则**，否则角标数和实际位置会对不上。

### 🚨 踩过的坑（都已在代码里修好，列出来避免重犯）

| 坑 | 症状 | 说明 |
| --- | --- | --- |
| `runtime.py` 白名单一刀切 | **静默不执行** | `if key not in _SLOT_NODE_NAME: continue` 把新动作丢了 |
| `jobSlotKeyOf` 写死 feed/shovel | 新动作被当成 `card11` | 已改成先查注册表 |
| slotModes 初始化写死 | 新动作拿不到默认形态 | `29-jobset-init.js` / `28-jobset-io.js` 两处 |
| `jobSlotLabel` 写死 | 显示 `槽null` | 已改成先查注册表 |
| **CSS 父子配对选择器脱钩** | 标记**只剩图片正中心** | 见 §3 的警告；已改统一类 `job-mark` / `job-mark-img` |
| 同格数量限制写死 | 喂豆/铲子**不能叠放** | 旧代码注释说"单次允许重复"但代码无条件拦截；已全部放开 |
| 新增渲染**忘了删旧的** | 喂豆显示**两个** | 重构时只加不删的典型事故 |

> **教训 1**：改这类「多处联动」的代码，测试要断言**「恰好 N 个」**而不是
> **「至少有」** —— 「两个喂豆」那条就是只断言"存在"才漏掉的。
>
> **教训 2**：**CSS 类名契约要单独测**。纯逻辑测试（元素创建了、文字对了）
> 查不出「JS 挂的类名和 CSS 选择器对不上」这类问题，
> 而它恰恰表现为「东西在 DOM 里但看不见 / 显示错位」。
> 改 CSS 后请务必在浏览器实际看一眼（Ctrl+F5 强刷）。
>
> **教训 3**：**别用「父元素 type + 子元素类名」的配对选择器**做样式。
> 两个维度要同时正确才生效，太脆。用**一个统一类**表达「这是一类东西」，
> 用**另一个类**表达「具体是哪一种」。

### 验证清单（新增落子动作后逐项过）

```
.venv\Scripts\python.exe agent\jobset\selfcheck.py     # 第 8/9 节：form + tap 端到端
node --check <改过的每个 js>
```
外加**手工确认**：左侧出现按钮 / 「更多」里有条目 / 能往棋盘落子 /
链上出现块（名字不是 null）/ 导出 JSON 里 type 正确 /
**真机跑一次确实执行了**。

新增动作后建议全局搜一遍，确认没有写死旧动作名的地方：
```powershell
Select-String -Path game_assist_tools\endless_setup\static\js\*.js `
  -Pattern "key === 'feed'|type === 'feed'|'shovel'" -Encoding UTF8
```
剩下的大多应是「注册表未加载时的兜底」，属正常。

---

## 10.3.2 ★「更多」落子动作的常驻规则 + W/S 可达性（2026-10-01 第二轮）

> 需求原话：「ws 可以呼出左边面板的更多动作，这很不合理，应该是，
> 选择完（注意是左侧）更多动作后，那个动作只要有一个在棋盘里就常驻显示，
> 这个时候才能 ws 呼出，其余时间则不可以，boss 和普通关要单独设置」

### 规则

| 项 | 规则 |
| --- | --- |
| 常驻条件 | 该动作**在对应关卡的棋盘上还留着落子**（任意形态：单次/循环/收尾） |
| 内置动作 | 喂豆 / 铲子 —— `builtin:true`，**永远**常驻、永远可 W/S |
| 扩展动作 | `inMore:true`（点击格子…）—— **没落在棋盘上就不显示、W/S 也不可达** |
| 关别隔离 | **普通关与 boss 关各自独立统计**，各读各的 `boardEarly` / `boardLate` |
| 选中放行 | 已 arm 的动作**即使棋盘上没有落子**也留在面板与循环表里（否则落不了子 / 切不走） |

### 实现（三处，必须同源）

```js
// 22-jobset-chain.js —— 唯一判据，面板与 W/S 共用
function jobBoardActionHasPlacement(act)      // 该关棋盘上有落子？
function jobBoardActionCycleable(act)         // builtin || hasPlacement

// 27-jobset-board.js —— jobSlotCycleList(cur) 每次现算，不再是常量
// 08-board-data.js  —— renderAllBoards() 里补 jobRenderSlots()
```

> ⚠️ **`JOB_SLOT_CYCLE` 常量已删除，改成 `jobSlotCycleList(cur)` 函数。**
> 原因：常量只在脚本加载时算一次；用户「选更多动作 → 落子」之后循环列表不更新，
> 于是落完子按 W/S 仍然找不到它（反之清掉棋子后仍能循环到）。
> **每次按 W/S 都重新计算**才是正确语义。
>
> ⚠️ **`renderAllBoards()` 现在会调 `jobRenderSlots()`** ——
> 否则落下第一个 / 清掉最后一个落子时，左侧按钮不会立即出现/消失，
> 与 W/S 的可达性错位（面板看不见却能按 W/S 选中）。
>
> ⚠️ **切 tab 时清掉「扩展动作」的选中态**（`08-board-data.js` 的 `initTabs`）：
> 否则在普通关 arm 了「点击格子」再切到 boss 关，
> 它会因为 `isArmed` 而在 boss 关凭空常驻 / 被 W/S 循环到。
> 内置的喂豆/铲子不受影响。

### 验证

临时脚本断言过 16 条（已删除）：空盘不可达 / 有落子可达 / **boss 与普通关双向隔离** /
形态无关 / boss 不数收尾 / **清掉落子后立即退出循环表** / 已 arm 时留在表内。
`selfcheck.py` 与 `check_resource.py` 保持全绿，27 个 JS 文件 `node --check` 通过。

---

## 10.4 同格重复落子（已放开）
**现状：同一格可以放任意多个落子**（植物 / 喂豆 / 铲子 / 点击格子 / 未来扩展），
单次与循环形态都放开，不再去重、不设上限。

改的是 `21-jobset-levels.js` 的 `placePlantOnBoard`，删掉了三道限制：

```js
// 删掉的
if (cellArr.some(it => it.id === act.id && jobItemMode(it) === mode)) return false;
if (mode === 'loop' && _same >= 1) return false;
if (mode === 'once' && _same >= 12) return false;
```

> **这原本就是个 bug**：旧代码注释写着「同一格：同形态只允许一个；
> **单次允许重复**（但喂豆通常一格一个）」，但代码是无条件 `return false` ——
> 注释和实现矛盾，喂豆/铲子因此无法像植物那样叠放。
> 换句话说「植物能叠」是意外（走的是另一条 `_same >= 12` 分支），
> 「喂豆不能叠」才是那个写漏的拦截。

**唯一保留的限制**：植物槽必须先在槽位面板配了植物名才能落子
（否则 `jobFindPlant` 拿不到图，放上去也没意义）。

### 渲染侧的配套：9 个封顶 + 「+N」角标

CSS 只定义了 `job-p1`..`job-p9`（3×3 摆满）九个坐标，第 10 个起没有定位。
所以渲染时最多画 9 个，多出来的在**右下角显示红底「+N」**：

- 常量 `JOB_CELL_MAX_MARKS = 9` 在 `08-board-data.js` 顶部
- 角标类 `.cell .job-overflow`（`base.css`）
- 悬停提示「本格还有 N 个未显示（共 M 个）」

> ⚠️ **改 `JOB_CELL_MAX_MARKS` 必须同步改 CSS 的 `.job-pN` 定位规则**，
> 否则角标数和实际能摆的位置会对不上。

### 确认没有环节会合并重复

实测过（同格 3 次点击格子 + 3 株植物）：

```
jobPlacementsOf()  → 原样返回，不去重，按 seq 稳定排序
chain_dsl()        → click:...格子4_3 ×3 + swipe:...格子4_3 ×3，count=6
```

**没有**任何 `Set` / `dedup` 会吃掉重复（`10-export.js` 的 `deduplicateNodes`
只作用于旧的选项树节点，与棋盘无关）。

---

## 10.5 ★ boss 关独立阵容 + 神器占位 + 阵容相同跳过选卡（2026-10-03）

一张阵容表现在有**两套选卡阵容**：普通关（`lineup`）+ boss 关（`boss_lineup`），
外加**神器占位字段**（`artifact`，暂无图片资源、网页端暂无 UI，pipe 端用户自己写）。

### 网页端模型（20/24/27/28/29/32 + index.html）

- 表新增字段：`bossLineupMode`（`''`=沿用普通关 | `'plants'` | `'deck'`）、
  `bossDeckNo`、`bossSlots`（boss 槽位**三态覆盖层**：key 不存在 = 沿用普通关同槽；
  `null` = 已删除（boss 关不用这个槽）；字符串 = 覆盖）、
  `artifact` / `bossArtifact`（占位，null）。
- **语境助手**（`24-jobset-fields.js`）：`jobBossSlotState(t, i)` 三态判定 /
  `jobSlotNameCtx(t, i, bossCtx)`（blocked → ''）/ `jobSlotInherited` /
  `jobEffSlots(t, bossCtx)` / **`jobBossSlotsDiffer(t)`**（有任何删除或值不同的
  覆盖 = 不一致；覆盖成同名植物算一致）。
  凡是「显示/编辑槽位植物名」的地方一律走这里，**不要再直接读 `t.slots[i]`**
  （boss 语境下那是错的）。
- **「boss 关」阵容下拉是数据驱动的**（`21` 的 `jobRefreshBossLineupUI`，
  由 `jobRenderSlots` 在每次槽位增删后调用）：
  槽位一致 → 只显示「沿用普通关」（mode 锁定 `''`，悬停提示沿用）；
  不一致 → 只提供「单独选卡 / 切换编队」（没有沿用项），mode 自动落到 `plants`。
  例外：`mode='deck'` 本身算「不一致」（编队不需要槽位覆盖，否则会被静默抹掉）；
  编队退回沿用的路径 = 先切「单独选卡」。
- boss 棋盘 tab（'late'）下槽位栏编辑的是 `bossSlots` 覆盖层，三态 UI：
  沿用槽半透明（✕ = **删除沿用**，只清 boss 棋盘的该槽落点）；
  覆盖槽正常色（✕ = 取消覆盖回沿用）；
  已删除槽半透明 + 红色虚线框（↩ = 恢复沿用，点槽体 = 选植物变成覆盖）。
  `placePlantOnBoard` 按目标棋盘取有效植物名，boss 覆盖改动只同步 `boardLate`。
- 导出（`jobBuild`）：`lineup`/`boss_lineup` 都带 `artifact`；
  `boss_lineup` 永远是**有效值**（逐槽沿用后的完整 8 槽 / 编队号），
  `boss_squad` 是运行时读的权威字段；`bossSlots`/`bossLineupMode` 等编辑器
  状态字段一并导出（读回用）。导入（28）有反向推导：
  手写 JSON 只给 `boss_squad` → 反推 `bossLineupMode='deck'`。
- 局外选卡锁定集合（32 `jobOuterLockedPlants`）= 普通槽位 ∪ boss 有效槽位。

### agent 端（engine / runtime）

- `engine.Table`：`boss_plants` / `boss_squad` / `boss_artifact` / `artifact`；
  有效值访问器 `eff_plants(is_boss)` / `eff_squad(is_boss)` / `eff_artifact(is_boss)`；
  **`lineup_sig(is_boss)`** = `("deck", squad, artifact)` 或 `("plants", tuple(plants), artifact)`。
- **阵容相同跳过**：`_STATE["lineup_sig"]` 记录当前生效阵容。
  `_inject_lineup(context, table, is_boss)` 统一所有注入点
  （JobSetFight 首锁/换表、JobSetPlan 换阵）：
  签名相同 → `无尽挑战_识别开始战斗_清空卡牌` 改 `DirectHit + DoNothing`
  直跳 `无尽挑战_选取植物_开始战斗`（不清空、不选卡、不切编队）；
  不同 → 还原清空卡牌节点 + 正常注入。首次进关（签名 None）必走完整选卡。
- **⚠️ `_CLEAR_CARDS_ORIG`（runtime.py）是清空卡牌节点 pipe 原值的照抄快照
  —— 改 pipe 里这个节点必须同步它**（selfcheck §13 有一致性断言）。
- **闸门阵容维度修正**（`lineup_gate_adjust`，纯函数）：表没变但形态阵容不同
  → 翻「变化」重选；表变了但阵容相同 → 翻「未变」跳过。训练模式不修正
  （每关必重选是用户设定）。boss 预判用计数器 `lv % 5 == 0`（与补给预告同口径）。
- **★ 训练模式双层豁免**（踩过的坑）：闸门修正挡训练只翻了 next 分支，
  但 `_inject_lineup` 的签名跳过会把「清空卡牌」节点**本身**改成 DirectHit 空跳
  —— 分支走对了、节点被废了。所以 `_inject_lineup` 里还有第二道：
  `_STATE["training"]` 为真时永不跳过（`JobSetPlan` 每关写入该标记，
  Fight/Stage 的节点参数里没有「训练模式」键，只能走状态；
  `JobSetLoad` 重置/新开局时清空）。
- 预热（`_prewarm_for_level`）：首关是 5 的倍数时用 boss 阵容预热；
  预热**不写** `lineup_sig`（首关必须真选）。

### 验证

selfcheck §13 全覆盖（解析/签名/快照一致性/跳过行为/闸门修正），全部通过。

## 11. 最近验证结果（全绿基线）


```
selfcheck.py                       →  全部通过
                                     第 8 节 form 21 条 / 第 9 节 tap 8 条
                                     第 10 节 squad 14 条（含与真实 pipe 对照）
check_resource.py assets/resource  →  All directories checked
check_graph.py                     →  仅预存在空壳告警，无悬挂引用（见下方更正）
JS 语法                            →  27 个拆分文件 node --check 全部通过
```

> **更正**：§9 曾写 `check_graph.py` 报「3 个空 next」。**实测是 6 个**，
> 且全部为预存在、非本轮引入（`git diff --name-only | grep pipeline` 为空）：
> `01_Endless_plant_ref.json` 的 `无尽挑战_检查是否需要选植物` / `无尽挑战_选植物`；
> `0300Endless_fight.json` 的 `无尽局内_单次种植` / `无尽局内_循环种植` /
> `无尽挑战_训练完成`；`Endless_html_ref.json` 的 `无尽挑战_编辑作业集`。
> 其中 `无尽挑战_训练完成` 是 `StopTask`（本就该终止），其余是运行时注入的空壳。
> 另注：`check_graph.py` 退出码为 **1**（`sys.exit` 在有问题时），属预期。

本轮（2026-10-01：切换形态 + 点击格子 + 落子动作注册表 + 重复落子）改动文件：

```
agent/assets/resource/coords.json           槽1..槽8切换形态 坐标（用户提供）
agent/jobset/dsl.py                          GENERIC_FORM_* / GENERIC_SLOT_CLICK（驱动表）
                                             generic_dsl 新增 params 参数袋 + slot/times
                                             chain_dsl 对 tap 类不设起点
agent/jobset/runtime.py                      _build_chain_nodes 透传 params；
                                             ★ 植物槽白名单不再一刀切（否则新动作静默丢弃）
agent/jobset/selfcheck.py                    第 8 节 form 21 条 + 第 9 节 tap 8 条断言
.../static/index.html                        #moreList/#morePicker/#boardMoreList 三个弹窗；
                                             引入 15-board-actions.js
.../static/js/15-board-actions.js   ★新增   落子动作注册表（唯一扩展入口）
.../static/js/08-board-data.js               标记渲染走注册表；统一类 job-mark/-img；
                                             JOB_CELL_MAX_MARKS + 「+N」角标
.../static/js/21-jobset-levels.js            placePlantOnBoard 走注册表；★ 放开同格重复
.../static/js/22-jobset-chain.js             jobAllSlotKeys / jobSlotKeyOf 走注册表
.../static/js/23-jobset-end.js               重载时保留 slot/times
.../static/js/24-jobset-fields.js            JOB_FORM_ACTION / 参数声明系统 /
                                             jobBuildParamControl / JOB_UI_IMG.tapcell
.../static/js/27-jobset-board.js             段<->步骤 保留参数；chip 摘要+展开；
                                             导出带参数；左侧落子区注册表渲染
.../static/js/28-jobset-io.js                slotModes 默认值走注册表
.../static/js/29-jobset-init.js              slotModes 默认值走注册表；绑定棋盘「更多」
.../static/js/30-jobset-generic.js           #moreList/#morePicker 两级弹窗；chip 兜底
.../static/css/base.css                      #morePicker/#moreList/#boardMoreList 样式；
                                             统一 job-mark/-img；.job-overflow 角标
```

本轮（编队注入适配 Or 节点，见 §2.1）改动文件：

```
agent/jobset/runtime.py     _SQUAD_ANY_OF 骨架 + _squad_any_of()；
                            _squad_param 改走 any_of（顶层 expected 对 Or 无效）
                            typing 补 List
agent/jobset/selfcheck.py   第 10 节 squad 14 条（含与真实 pipe 对照的漂移检测）
assets/resource/pipeline/Endless_ref.json/02_Endless_plant_Choose_ref.json
                            （用户改动：切换编队序号 1 个 any_of -> 2 个）
```

本轮（编队 + 槽位同步 + 补给 + 快捷键 + 关卡融合）改动文件：

```
agent/jobset/engine.py            Table.squad / lineup_at 暴露 squad
agent/jobset/runtime.py            _squad_param / _inject_squad（4 处注入）
agent/jobset/level_tracker.py     DEFAULT_PENALTY 10 -> 30
agent/jobset/selfcheck.py         断言改为常量推导
game_assist_tools/endless_setup/static/index.html         换阵下拉 + 编队号 + 去掉 #supplyPinned
game_assist_tools/endless_setup/static/css/base.css       删掉固定项样式
.../static/js/21-jobset-levels.js  编队号夹在 1-6
.../static/js/25-jobset-supply.js  「查看」不进补给顺序区
.../static/js/26-jobset-supply-pick.js  「✓ 已选择」角标
.../static/js/27-jobset-board.js   W/S/F 快捷键、槽位植物同步、squad 导出
.../static/js/28-jobset-io.js      squad -> lineupMode/deckNo 反向同步
```

本轮（「更多」动作常驻 + W/S 可达性，见 §10.3.2）改动文件：

```
.../static/js/22-jobset-chain.js   ★新增 jobBoardActionHasPlacement / jobBoardActionCycleable
.../static/js/27-jobset-board.js   ★删 JOB_SLOT_CYCLE 常量 -> jobSlotCycleList(cur) 函数
                                   jobRenderSlots 常驻判定改走 jobBoardActionHasPlacement
.../static/js/08-board-data.js     renderAllBoards() 补 jobRenderSlots()；
                                   initTabs 切关时清掉扩展动作的选中态
```

---

## 12. 环境版本约束（踩过一次坑）

### maafw 版本必须与 VS Code 插件对齐

```
requirements.txt :  maafw==5.13.0
.venv 实际       :  5.13.0
插件预期         :  5.13.0   （Maa Pipeline Support / nekosu.maa-support 513.0.0）
```

**不对齐的后果**（实测报错）：

```
[ERR][AgentClient.cpp][L179] Protocol version mismatch
  client: ["v5.12.2"=v5.12.2] [kProtocolVersion=7]
  server: [resp.version=v5.14.2] [resp.protocol=8]
[ERR][AgentClient.cpp][L181] Please update AgentClient
→ AgentClient connect failed → agentStopped
```

**成因**：提交 `675675b`（"perf:更新maafw和mfa版本"）把 `maafw` 从 `5.10.4`
升到了 `5.14.2`，而插件当时只到 `5.12.2`（protocol 7），项目侧是 protocol 8。

**修法**：`6e4ae13`（"将仓库的maafw版本降到与插件对齐的版本"）降到 `5.13.0`。

> ⚠️ **以后再升级 `maafw`，先确认插件支持到哪个版本**。
> 插件内置的预期版本可以从它的 `out/extension.mjs` 里查到：
> `@maaxyz/maa-node` 的 `devDependencies` 值。

### VS Code 插件下载 framework 卡住

插件下载源**不读** `~/.npmrc`，它有自己的内置表：

```js
static registries = {
    npm:  "https://registry.npmjs.org",     // 默认，国内常超时
    cnpm: "https://registry.npmmirror.com"  // 淘宝源
};
```

切换方式：`Ctrl+Shift+P` → **`Maa: 选择下载源`** → 选 `cnpm`。

下载卡死时会在
`%APPDATA%\Code\User\globalStorage\nekosu.maa-support\native\install\`
留下空的 `.prepare-*` 暂存目录和 `native.lock` 锁，
**需要完全退出 VS Code** 再重试。

### 其他环境事实

| 项 | 值 |
| --- | --- |
| Python | `.venv`（3.12，**无 flask**）；Flask 工具用 `D:\ana\python.exe`（flask 1.1.1） |
| 启动网页 | 双击 `pvz.bat`（自动挑带 flask 的解释器），端口 **5000** |
| 无头浏览器 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| 补给图片素材 | `game_assist_tools\endless_setup\static\supply\` |
| 退出看门狗 | `agent/exit_watchdog.py`：关闭宿主（MFA/VSCode）时 `AgentServer.join()` 不返回，python.exe 残留。基础路径=**祖先进程监控**（toolhelp32 快照记录父+祖父的 PID 与 exe 名，1.5s 轮询，消失或 PID 被复用即判宿主已关 → 2s 后 `os._exit`）。**VSCode 扩展宿主（祖先含 Code.exe）额外武装停止即退出**，双保险：① `Tasker.Task` 终态事件 sink（客户端是否转发没保证）；② 长动作循环里的协作检查 `_stopped()`（custom_select_plant）观测到停止即 `on_task_stopped()`——**action 运行期间是唯一可靠观测点**（句柄有效；action 外即被回收）。扩展每次 startTask 会 agent start race 重拉死进程 → 停=自杀=下次跑新代码（dev 循环刚需；扩展复用进程导致旧代码驻留，容易误判"改动没生效"）。**桌面端 MFAAvalonia 绝不停止即退**：它停任务后不重拉只复用，自杀后第二次任务 custom 全废（2026-10-04 打包版实测）。轮询 `tasker.running` 路线废弃（句柄 action 结束即回收，报 `tasker not found`/误自杀）。⚠️ `_stopped` 必须查 `stopping` 而不只 `running`——停止期间 running 要等当前 action 返回才变 False（鸡生蛋），SelectPlants 曾因此停任务后还多滑 20s |

---

## 13. 归档：历史设计文档（2026-10-03 并入本节，原独立文件已删除）

> 三份文档的**有效信息全部压在这里**，实施过程细节（阶段勾选清单等）去 git 历史里找。
> 运行时会被代码读取的 md 只有 `agent/select_plant/植物中英文对照表.md`（数据表，不在此列）。

### 13.1 作业集数据流重构定案（原 `REFACTOR_PLAN.md`，阶段 1–6 已于 2026-10-02 收官）

- **总原则**：HTML 负责「算」，运行时负责「盖」。作业集 JSON 里**没有** pipe 字段；
  `compiled` 预编译块（`format:2`）在编辑器保存时生成，运行时 `override_pipeline(compiled)` 零翻译。
- **覆盖顺序钉死**：compiled 先盖，编队/补给/选卡后盖（后盖赢）；
  永不覆盖 `无尽局内_继续挑战.next`（顶掉训练模式的血泪）。
- **关卡判断三件套**：boss = 头像模板匹配；结束 = 结算按钮匹配；
  关卡号 = 起始关卡 + 过关计数器（数字 OCR 不稳已砍，实测 81→21、87→89）。
  计数器挂在「点继续挑战/继续训练」之后——重开不经过该点，天然不误加；
  boss 关对齐 5 的倍数自愈。状态行刷新时机 = 识别到「开始战斗」。
- **everyN 读作业集顶层**（历史上误读表级字段恒为 None → 恒为 10）。
- **端口僵尸事故**：Werkzeug 的 SO_REUSEADDR 在 Windows 允许多进程绑同一端口
  → 旧进程吃掉所有请求、日志被截断成只有启动行。`pvz.py` 启动前裸 bind 试占；
  排查用 `netstat -ano`（`Get-NetTCPConnection` 会漏报监听 socket）。
  **2026-10-04 起改为挤占接管**：端口被占时读共享 PID 文件
  `~/.maapvz_pvz_editor.pid`（格式 `pid|实例根目录`；不用 %TEMP%——会被运行环境
  重定向；不用 CIM/WMI——部分环境拒绝访问，exe 名用 toolhelp32 快照查）。
  规则：记录在案且**同根目录** + `--reuse`（OpenJobEditor 呼出）→ 复用退出；
  其余（pvz.bat 手动重启 / 外来检出 / 未登记的 python 残留）→ taskkill 接管；
  非 python 占用 → 报错退出不抢。⚠️ OpenJobEditor（agent/my_action.py）
  必须总是 `Popen pvz.py --reuse` 而不是"端口通了就直接用"——
  否则旧代码实例一直吃请求，接管逻辑永远不会执行（踩过）。

### 13.2 SelectPlants 局外 80 选卡 SPEC（原 `agent/select_plant/SPEC_endless_select.md`）

- **背景**：局外 80 选卡界面卡片**没有文字** → OCR 核对不可用；漏选必须报错而非默默跳过。
  模板在 `plant_ref_endless`（手动截图，目录结构同 `plant_ref_card`，`resolve_templates` 复用）。
- **设计**：不新建 custom，`SelectPlants` 全部开关化，**缺省值 = 旧行为**：
  `无尽局外选卡`（80 模式，隐含不做核对/槽位检查/占位填充）、`核对`、`占位填充`、
  `槽位上限`（仅单目标）、`尺度`（局外缺省 `[1.0]`，手截图同尺度）、`局外点击间隔`、
  `模板目录`（按模式自动选，`__file__` 相对推算，pipeline 不写绝对路径）。
- **严格顺序 + 当前帧优先**（两种模式共有）：放完一个**不回顶**，下一个先看当前帧；
  当前帧没有就**顺势往下滑**（2026-10-03 改，不再直接回顶），滑到底才反弹回顶；
  **触底反弹不算失败次数**——选中/点到任何东西就清零，连续 `最多重试`（默认 6）次
  触底都没进展才放弃。80 卡位顺序 = 优先级。
  旧「一帧多目标」模式**已废弃**（点击顺序由界面布局决定 ≠ 列表顺序）。
- **防呆**：按名除名——点过的植物移出待选集（重复点 = 取消选中）。
- **性能**：`_TPL_CACHE` 模板磁盘缓存（84 模板×多尺度每帧太贵）。
- **接线**：闸口节点 `无尽挑战_检查是否需要选植物` 的 `next` 留空，由 runtime
  `_apply_outer_pick`（挂在 JobSetLoad）按作业集 `outer_pick.mode` 覆盖分流：
  `auto` → 清空→自动选→确定；`oneclick` → 一键选择→确定；`confirm` → 直接确定。
  注入前先读 pipe 节点现有参数合并（`custom_action_param` 整体替换）。
  auto 但 plants 为空 → 退化为「复用当前配置」+ 告警，不卡界面。

### 13.3 SelectPlants 动态回顶 SPEC（原 `agent/select_plant/SPEC_backtop.md`）

- **回顶次数 = 本轮实际下滑次数 + 3**（每轮回顶后 `slide_count` 清零，+3 永远贴合列表真实长度）。
- ❗ **回顶坐标固定** `(381,401) → (381,611)`（往下刷 = 列表往上翻），
  **不能**复用滑动坐标的反向（实测有 bug）。
- **解耦**：`最多滑动步数`=40（单轮下扫上限）与 `最多重试`=6（回顶重扫上限）是两个计数器
  ——旧版混用导致最多只扫 6 屏，靠写死的 `repeat=30` 硬顶。
- `回顶.duration` 缺省 600（旧的 80 是配 30 连刷用的）；显式传 `回顶.repeat` 仍走旧固定次数。
- 验收 selfcheck：`agent\select_plant\selfcheck_backtop.py`。
