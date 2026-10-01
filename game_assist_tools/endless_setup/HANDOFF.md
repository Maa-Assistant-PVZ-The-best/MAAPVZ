# MAAPVZ 作业集 / 无尽挑战 —— 交接文档

> 工作区：`D:\maapvz\MAAPVZ`
> 网页端（作业集编辑器）：`game_assist_tools\endless_setup\static\`
> 运行时：`agent\jobset\*`（Python，CustomAction）

---

## 0. 一句话现状

**网页端（作业集编辑器）已可用；运行时已跑通「选卡 / 切换编队 + 种植 + 换阵容 + 补给 + 收尾」。**

收尾链的运行时接线**已完成**（早期版本这里是缺口，现已补齐）：
收尾检测 → 收尾链 → 结算 → 收尾超时后动作。

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
├── index.html          # 仅 head + 资源引用 + body 结构（约 289 行）
├── plants.json
├── css/
│   ├── base.css            # 手写主样式
│   └── vendor-fluent.css   # 第三方 Fluent UI 样式
└── js/
    ├── 01-options.js … 14-onload.js     # 选项树编辑器（section 1–14）
    └── 20-jobset-core.js … 29-jobset-init.js  # 作业集编辑器
```

> ⚠️ **关键**：Flask 的静态目录挂载在 **`/static/`**（`Flask(static_folder=STATIC_DIR)`），
> 不是根路径。所以 `index.html` 里的引用必须是 `/static/css/...`、`/static/js/...`；
> 写成相对路径 `css/...` 会 404。
>
> 数字前缀表示加载顺序，`<script>` 为非 module 模式，所有文件共享全局作用域。

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
| `无尽_切换编队序号` | `expected` | `["3"]`（**字符串**；默认 `[]`） |

注入点共 **4 处**：`JobSetLoad`（预计表预热）、`JobSetStage` 首次锁定、`JobSetStage` 换阵容、`_apply_table`（切表辅助）。

- **未配置时会主动回滚**（把 `next` 还原成「选取植物」、`expected` 还原成 `[]`），
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

- Python：`.venv`（3.12，**无 flask**）；Flask 工具用 `D:\ana\python.exe`（flask 1.1.1）
- 启动网页：双击 `pvz.bat`（会自动挑带 flask 的解释器），端口 **5000**
- 无头浏览器：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- 补给图片素材：`game_assist_tools\endless_setup\static\supply\`

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
  - 截至最近一次运行：**37/37 全部通过，无失败项**

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

## 10. 未来要加的东西（占位，暂不实现）

> 以下为**已登记但未开工**的需求，只做占位记录，不要照此直接动手。

1. **HTML 适配无尽局外选择 80 个植物**
   —— 网页端支持在「无尽局外」（非局内）场景下从 80 个植物中选择。

2. **点击格子，使用神器**
   —— 棋盘格子支持配置「使用神器」这一动作类型（目前格子动作是种植 / 喂豆 / 铲子）。

3. **通用动作增加「滑飞弹」**
   —— `JOB_GENERIC_ACTIONS` 目前只有 `wave`（点波）/ `bean`（捡豆）/ `speed`（加速），
      需要新增「滑飞弹」。涉及网页端按钮组 + `dsl.py` 的通用动作翻译 + pipe 端执行。

---

## 10.1 已完成的：「切换形态」通用动作

> 入口是棋盘右侧通用动作按钮组**末端的「更多」按钮**（`#morePicker` 弹窗）。
> 弹窗内目前只有「切换形态」一项。

**交互**：选槽位 1-8 + 填点击次数 → 插入到指定链。

| 项 | 说明 |
| --- | --- |
| 坐标 | `coords.json` 顶层键 `槽1切换形态` … `槽8切换形态` |
| 动作语义 | **纯点击**，不做形态档位换算 —— 填几次就点几次 |
| 间隔 | **不加**。要控制节奏由用户在链里插「等待」段（等待仍是合法链段） |
| 上限 | 槽位 1-8；次数 1-20（`GENERIC_FORM_TIMES_MAX`） |

**段形状**：`{ key: 'ga:form', ga: 'form', slot: N, times: M }`

**DSL 编译**（`dsl.py` → `generic_dsl(action, coords, ms, slot, times)`）：

```
slot=3 times=2  ->  click:槽3切换形态;click:槽3切换形态
```

> ⚠️ **槽位越界不夹取**：`slot=9` 一律返回 `None` 并记 `missing`，
> **不能悄悄退化成槽 8** —— 那会点错槽位的按钮。次数越界才夹取（1..20）。

**网页端**：`JOB_FORM_ACTION`（`24-jobset-fields.js`）带 `hasSlot`/`hasTimes`；
`jobGenericActionById` 从 `JOB_ALL_GENERIC_ACTIONS` 取，**但按钮组仍只渲染
`JOB_GENERIC_ACTIONS` 的 3 项** —— 切换形态只从「更多」进。

**易丢字段的四处坑（都已接好，改动时务必留意）**：

| 位置 | 函数 | 不通会怎样 |
| --- | --- | --- |
| `23-jobset-end.js` | 重载映射 | 存盘后重载，`slot/times` 被静默丢掉 |
| `27-jobset-board.js` | `jobSegsToSteps` | 每次渲染重建对象，参数丢失 |
| `27-jobset-board.js` | `jobStepsToSegs` | 存盘写回时参数丢失 |
| `27-jobset-board.js` | `jobStepId`/`jobSegFingerprint`/`jobCarryUids` | 两个不同参数的 form 段撞成同一 id，勾选/拖动串位 |

> 「等待」的 `ms` 是同样性质的参数，上述四处都是照它的先例加的。

**boss 关防护**：boss 关没有收尾链。`jobCycleMoreTarget` / `jobCycleGenTarget`
在目标非法（残留 `'end'`）时先规范化再切；`jobConfirmMorePicker` /
`jobConfirmGenPicker` 另有兜底 —— boss 棋盘下 `'end'` 一律改走 `'loop'`，
**绝不往 boss 的 `end_chain` 写东西**。

**验证**：`selfcheck.py` 第 8 节共 17 条断言（坐标键齐全 / 次数展开 / 缺省回落 /
越界夹取 / 槽位越界判无效 / `ga:` 前缀等价）。

---

## 11. 最近验证结果（全绿基线）

```
selfcheck.py                       →  全部通过（含第 8 节「切换形态」17 条）
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

本轮（「切换形态」通用动作）改动文件：

```
agent/assets/resource/coords.json           槽1..槽8切换形态 坐标（用户提供）
agent/jobset/dsl.py                          GENERIC_FORM_* 常量 / form_point /
                                             generic_dsl 新增 slot,times 参数
agent/jobset/runtime.py                      _build_chain_nodes 透传 slot/times
agent/jobset/selfcheck.py                    第 8 节 17 条 form 断言
.../static/index.html                        #morePicker 弹窗 DOM
.../static/css/base.css                      #morePicker 样式 + .seq-form-slot/-times
.../static/js/23-jobset-end.js               重载时保留 slot/times
.../static/js/24-jobset-fields.js            JOB_FORM_ACTION / JOB_ALL_GENERIC_ACTIONS
.../static/js/27-jobset-board.js             段<->步骤 保留 slot/times；chip 内联编辑；
                                             导出带参数
.../static/js/30-jobset-generic.js           #morePicker 逻辑；「更多」按钮激活；
                                             boss 关收尾链兜底
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
