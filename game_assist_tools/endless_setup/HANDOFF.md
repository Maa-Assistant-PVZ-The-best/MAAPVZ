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

**2026-10-30 新增/改动（编辑器，见 §10.7）**：

| 功能 | 说明 |
| --- | --- |
| **撤销/重做重构** | 快照从「两块棋盘」升级成「棋盘 + 链条 + 槽位形态 + 等待 + 补给」整表快照，带上下文键（不跨表/不跨作业集）；记录点统一挂 `jobSaveLocal()` |
| **快捷键闸口** | `jobHotkeyBlocked()` + `JOB_MODAL_SELECTORS`，弹窗开着时 Ctrl+Z/Y、W/S/Q/E 一律让开（修「布局配置里 Ctrl+Z 同时撤销主棋盘」） |
| **boss 落子即固化** | boss 棋盘落子把该槽从「沿用」升级成「显式覆盖」；普通关改植物/清槽只动普通关棋盘 |
| **复制阵容** | **两步**：先点来源表 → 再勾「普通关 / boss 关」（两个复选框，可单勾可双勾）（§10.7-D） |
| **替换指定表** | 植物选择器右侧「替换指定表」：点表再点植物 = 把那张表（普通关/boss 关分开）的该植物换掉（§10.7-E） |
| **删除植物** | 槽位 ✕ 弹二选一：只删本表这一株 / 删掉所有表里的这一株（普通关 + boss 关，含棋盘落点）（§10.7-E） |
| **槽位自动左移** | 删中间槽不再报错，后面的槽顶上来；boss 覆盖层压实后显式封尾，不再出现中间空槽；**旧作业集载入时自动压实**（不留手动按钮）（§10.7-E） |

**2026-10-31 改动（编辑器）**：

| 功能 | 说明 |
| --- | --- |
| **替换指定表 → 多选** | 右栏 **一张表一个大块，里面普通关 / boss 关两个小块左右并排**（`_jobReplaceCard`）；可同时勾多张表 / 多个关别，点一株植物就把这些地方的 A 全部换掉（§10.7-E ①） |
| **正在编辑默认打勾** | 打开选择器时「正在编辑」那一小块默认勾上（`jobResetReplaceSel`）；只勾这一处时点植物 = 老选卡流程，勾了别的表就一并改当前槽 |
| **boss 关小块灰掉** | boss 侧没有**显式覆盖**这株（纯沿用）时，那个小块灰色不可点，写「没用·沿用」 |
| **boss 关追问** | 要改的普通关里，若同一张表 **boss 关也在用 A** 且没勾，面板停下问「一起替换 / boss 关不动」（`_jobReplacePending`）（§10.7-E ①） |
| **格内落子顺序（方块窗）** | 右键一个多落点的格子 → `#cellQueueModal`：按链条顺序铺成方块（角标 = 棋盘 `#N`），**跨植物/跨动作拖拽**可改本格执行顺序，单次/循环/收尾分组建模各自排序（§10.8） |
| **Ctrl+右键 = 清空整格** | 右键不再直接清多落点格；清空整格改成 Ctrl+右键（单落点格右键仍直接清空）（§10.8） |
| **Ctrl+左键 = 直接删槽** | 左侧槽位胶囊 ✕：直接点是「只删本表 / 删所有表」二选一，**Ctrl+点直接删本表这一槽**（§10.8） |

---

## 0.1 ★ 给下一个 AI 的开工清单（先读这一节，能省掉一半 token）

**改动前必读顺序**（只读这三处，别通读全仓）：

1. 本节 + **§10.7**（2026-10-30 那一轮的全部坑与约定）；
2. 要改的那个文件的**顶部注释块**（`42-jobset-batch.js` / `04-cards.js` 撤销段 /
   `27-jobset-board.js` 链条段 / `24-jobset-fields.js` 的 `jobSegPlacements` 都写了"为什么"）；
3. `AGENTS.md` 七条铁律 + 门禁表。

**编辑器高频定位（编辑器 = `static/js/*`，38 个文件、共享全局作用域、数字前缀=加载顺序）**：

| 想改什么 | 去哪 |
| --- | --- |
| 数据模型 / 表字段 / 关卡覆盖 | `20-jobset-core.js`（`jobNewTable` 是字段总表） |
| 槽位、棋盘落子、槽号搬迁 | `21-jobset-levels.js`（`placePlantOnBoard` / `jobSyncSlotPlantOnBoard` / `jobClearNormalSlot`） |
| 链条顺序、槽位键 | `22-jobset-chain.js` + `27-jobset-board.js`（`jobResolveSteps` / `jobStoreSteps`） |
| 撤销 / 重做 | `04-cards.js`（引擎）＋ 记录点挂 `29-jobset-init.js` 的 `jobSaveLocal()` |
| 快捷键 | `27-jobset-board.js` 的 `jobHotkeyBlocked` / `JOB_MODAL_SELECTORS` |
| 落子动作（喂豆/铲子/点击格子…） | `15-board-actions.js`（注册表，唯一入口，见 §10.3） |
| 棋盘右键 / Ctrl+右键 / 格内顺序方块窗 | `08-board-data.js`（右键分支）＋ `43-jobset-cell-queue.js`（§10.8） |
| 槽位 ✕（含 Ctrl+左键直接删） | `27-jobset-board.js` 的槽位胶囊 ＋ `42` 的 `jobDeleteSlotHere` |
| 通用动作（点波/捡豆/切换形态…） | `24-jobset-fields.js` 定义 + `agent/jobset/dsl.py` 编译（见 §10.2） |
| 槽位连续化 / 替换 / 删除植物 | `42-jobset-batch.js` |
| 布局（1-149 关图层） | `34-jobset-layout.js` |
| 存/取作业集、作业集列表 | `28-jobset-io.js` |

**门禁（编辑器改动只需要这两条，不需要跑 Python）**：

```powershell
cd game_assist_tools\endless_setup
node --check static\js\<改过的文件>.js          # 每个改过的文件都要
node tests\repro_undo_boss.js ; node tests\repro_copy_scope.js ;
node tests\repro_slot_compact.js ; node tests\repro_cell_queue.js ;
node tests\repro_shuipi.js ;
node tests\fuzz_drag.js 200 100                 # 链条相关必跑
```

**当前基线（2026-10-31，全绿）**：39 个 JS `node --check` 通过；上述 5 套回归全过；
`fuzz_drag 200×100 → 0 会话首错`；临时脚本（`zz*` / `_*`）为空。

**三条最容易踩的坑**（都踩过）：

1. **新弹窗必须两处登记**：`base.css` 那组 `#jobPickModal, #tableCopyModal {...}` 的
   id 选择器（样式是**按 id 逐条写的**，只加 HTML 会"点了没反应"）＋
   `27-jobset-board.js` 的 `JOB_MODAL_SELECTORS`（键盘闸口）。
2. **槽号被五处数据引用**（槽位表 / boss 覆盖层 / 形态 / 动作后等待 / 棋盘落点+链条段），
   任何"挪槽"必须走 `jobCompactSlots()`，禁止就地改号。
3. **boss 槽位是稀疏覆盖层**："没写键 = 沿用普通关同槽"。所以
   ① boss 落子即固化成显式覆盖；② 普通关改植物/清槽只动普通关棋盘；
   ③ 压实后尾部要显式置 `null`，否则删掉的槽会"自己长回来"。
4. **跑不了无头浏览器**（§7）：一切布局/CSS 类改动只能靠用户 Ctrl+F5 眼看，
   逻辑用 `node tests\*.js` 兜底。
5. **撤销记录点必须放在渲染之后**（§10.8-H，2026-10-31 用户实锤）：
   渲染会改数据（`jobEnsureSeq` 补 seq/ord、`jobGetChainOrder` 写回覆盖率段），
   先把 `jobSaveLocal()` 存了就等于记了个"渲染前"的旧快照 ——
   用户按 Ctrl+Z 第一下**看起来没反应**（状态栏还说已撤销），得按第二下。
   正确顺序永远是：**改数据 → 重绘 → 最后 `jobSaveLocal()`**。

---

## 1. 三层架构

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 网页（编辑器） | `game_assist_tools\endless_setup\static\` | 可视化配置，导出作业集 JSON |
| 数据（作业集） | 用户数据目录，口径见 `agent/jobset/engine.py` 的 `jobs_dir_for()`：开发仓库 `assets/resource/jobs/`、桌面发行包 `<包根>/jobs/`、安卓 `<pi>/../jobs/`（**必须在包外**，否则更新清空，见 §12.1「作业集目录」） | 每个阵容一张表 |
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
    └── 20-jobset-core.js … 41-jobset-tags.js     # 作业集编辑器
                                                  # （37 世界 / 38 备注 / 41 标签 …）
    └── 42-jobset-batch.js ★                      # 批量替换植物 + 槽位连续化（压实）
                                                  # 必须最后加载（Ctrl 不到的扩展点）
    └── 43-jobset-cell-queue.js ★                 # 格内落子顺序方块窗（右键棋盘格）+ Ctrl 右键清空
                                                  # 见 §10.8；排在 42 之后
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
| `无尽_选择编队`（custom 节点） | `custom_action_param` | `{"编队选择": true, "目标编队": N}`（默认目标 0=占位） |

> ⚠️ 2026-10-28 起 `无尽_选择编队.next` 也归运行时管（它是「编队模式下的选卡终点」，
> 神器链的唯一入口挂在这里 + `选取植物.next`，见 §10.5）。编队注入本身仍然只动上面两个字段。

注入点共 **4 处**：`JobSetLoad`（预计表预热）、`JobSetStage` 首次锁定、`JobSetStage` 换阵容、`_apply_table`（切表辅助）。

> ⚠️⚠️ **2026-10-23 重写：编队选择 = SelectPlants 的「编队选择」custom 模式！**
>
> 旧写法（`无尽_切换编队序号` Or 节点 + 具名分支 `识别编队1/2` 写 expected）
> 已退役。死穴：目标编队=当前编队时数字渲染变色，OCR 永认不出 -> 死循环。
>
> - 新链：`清空卡牌 -> 切换编队(点配队) -> 过滤编队颜色 -> 确认在编队界面
>   -> 无尽_选择编队(Custom) -> 选取植物_开始战斗`。
> - custom 内部闭环：整列 OCR（roi 沿用 `[132,125,77,566]`）找目标号 -> 点击
>   -> 等 500ms -> **白字核对**（白色集合 = {1,天生白} ∪ {当前选中}；
>   目标≠1 看目标变白，目标=1 看白色集合收窄为 {1}）-> 不对就反向滑回顶重选；
>   滑动带 `end_hold=1500` 防惯性过冲。
> - `squad=None` 回滚：next 还原成选卡 + 目标编队清 0（防残留）。
> - `selfcheck.py` 第 10 节会**自动对照真实 pipe 文件**（含新版结构断言），
>   pipe 结构变了会立刻报出来。

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
assets\resource\pipeline\Endless_ref/03_Endless_fight\03-1Endless_fight_end\03-1-01Endless_fight.json
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
  "code": "...", "name": "...", "max_level": 149,
  // 适配世界（2026-10-13 新增；37-jobset-world.js 弹窗编辑；运行时 JobSetPlan 首跑校验告警。
  //   ★ 当前世界注到 JobSetPlan 双节点 param —— 别注 JobSetLoad：option 会合是
  //     同节点同字段整体替换，会顶掉起始关卡 option 的 起始关卡/重置，2026-10-22 事故）
  "world": "冰河世界",              // 主适配世界（最佳适配）；"" / 缺省 = 未标注
  "sub_worlds": ["海盗港湾"],       // 副适配世界（候选，可多选，与主世界互斥）
  // 植物备注（2026-10-13 新增；38-jobset-notes.js 弹窗编辑；仅展示，运行时不消费）
  //   costume = 布尔：是否需要装扮（🎭 模式下点植物切换，与阶数同款交互）
  "plant_notes": { "冰西瓜": { "tier": 5, "pendant": "闪耀雪花挂坠", "costume": true } },
  "artifact_notes": { "风扇": { "tier": 2 } },   // 神器备注（同 plant_notes 口径）
  // 作业集标签（2026-10-26 新增；「📝 配置」弹窗顶部的「标签」行，41-jobset-tags.js）
  //   tags = 打法开关 + 账号档位 + 条件与风险 + 失败建议（见 §5.1）。
  //   点一下加上、再点一下摘掉，不限个数；数据层是**平铺字符串数组**，
  //   分组（「选择标签」弹窗的小标题）只活在网页端界面。
  //   ★ 纯标注：不参与运行时、也不给植物备注分套
  "tags": ["开僵尸场外加速", "氪佬", "需要月卡"],
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

### 5.1 作业集标签（2026-10-26；2026-10-27 加两组）

**标签**（`41-jobset-tags.js`）：入口在「📝 配置」弹窗顶部那一行 ——

```
标签：（未选择）  [已加的标签…]  ＋ 选择标签
```

- 点「＋ 选择标签」**跳出另一个弹窗**（`#tagPicker`，z-index 压在备注弹窗上面）分组列出全部标签，
  点哪个就加进「标签」那一行，再点一次摘掉；关掉弹窗即生效。不限个数（不做互斥校验）。
- 分组只是**界面层的排版**（`JOB_TAG_GROUPS`，展开成平铺白名单 `JOB_TAGS`）：
  | 分组 | 标签 |
  |---|---|
  | 打法开关 | `关僵尸场外加速` `开僵尸场外加速` `关刷新下一波` `开刷新下一波` |
  | 账号档位 | `难民` `0氪` `微氪` `氪佬` |
  | 条件与风险 | `需要重开` `需要月卡` `破阵风险高` |
  | 失败建议 | `失败建议：停止任务` `失败建议：重置后继续打` `失败建议：继续挑战` |
- 「失败建议」三条**故意带前缀**：导出后平铺在 JSON 里单看也知道是「打失败之后怎么处理」，
  不会和普通动作名混淆（改名前先问用户，改名 = 老作业集标签被洗掉）。
- 标签**只是作业集级标注**（导出 `tags`）：说明这份作业集适合什么开关/什么账号档位/有什么前置条件。
  ★ 它**不影响**植物阶数/挂件标注 —— 标注仍然只有一套（`plant_notes` / `artifact_notes`），
  点标签不会切换、也不会把角标变淡（早期做过的「按标签分套」已按用户要求撤掉）。
- 选择弹窗（`#jobPickModal`）里由 `/list_jobs` 带回显示成小 chip。
- agent 侧（`engine.py` JobSet）**不设白名单**，只收非空字符串、原样透传；
  唯一权威白名单是网页端 `41-jobset-tags.js` 的 `JOB_TAGS`。

**备注分套 —— 已撤掉（2026-10-27 核实）**：

- 早期做过「标签行下面再加一条『标注』行，按标签分套覆盖 `通用`」的方案，用户要求撤掉后
  代码里已经没有任何残留：`38-jobset-notes.js` 里没有分套逻辑，`engine.py` 也没有
  `tag_notes` 字段，全仓 grep `tag_notes` / `notes_sets` 均为空。
- 现状：标注**只有一套**（`plant_notes` / `artifact_notes`），标签就只是标签。
  别再照着旧记忆把它加回来；要加先问用户。

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
4. **改编辑器 JS 后**：每个改过的文件 `node --check`，再跑 `tests\*.js`（5 套，
   见 §11）；碰链条/拖拽/撤销/落点顺序必须加跑 `node tests\fuzz_drag.js 200 100`。
5. **交给你的是「用户实测过的编辑器」**：任何布局 / CSS / 弹窗改动都无法在本环境
   自动验证（§7 跑不了无头浏览器），改完必须让用户 Ctrl+F5 看一眼再说"完成"。
6. **新功能优先"长在现有交互上"**：用户明确讨厌多出来的独立按钮/独立弹窗
   （"批量替换"按钮就是被要求撤掉的）——替换挂植物选择器右栏、删除挂槽位 ✕ 上就是范例。

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

### 9.2 ★ 链条拖拽稳定性大修（2026-10-24，水皮报"喂豆互换"顺藤摸出 6 个结构性 bug）

**症状**（水皮原话）：循环链和单次链都有喂豆时，把一边的喂豆拖到另一边，
两条链里的同槽喂豆**位置互换**；同链拖拽也会错序；「不是关闭重开才触发」。

**根因是一个家族**：链是棋盘的派生视图，段存储用 **gidx（同槽第几个）** 指认落点，
而 gidx 由 (seq, ord/扫描序) 排序导出 —— 任何落点成员变动（mode 翻转/删除/重载）
都会让 gidx 重排，挂在 gidx 上的一切（picked/noint/times/uid）全部滑位。

**修复点**（全在 `static/js/27-jobset-board.js`，配套语义见代码注释）：

1. **`jobStoreSteps` 存盘即所见**：不再跳过 `synthesized` 步骤 —— 旧做法让
   同链拖拽/删除/成组/调参把所有"未固化落点"丢回浮动位按 seq 重排（= 同链拖完乱跳）。
2. **跨链翻转 mode 时 seq 按目标形态重编号**（`jobNextSeq`）—— 旧 seq 是源形态
   作用域的，带过去和目标已有落点**撞号**，撞号后靠 ord/扫描序兜底，
   保存重开后 ord 按行主序重建 → picked 指向另一个物理落点（= 水皮的"重开后互换"）。
   「动作后等待」的 waitAfter 键尾含旧 seq，迁移时用新 seq 重建。
3. **`jobPinSteps` 钉引用**：跨链搬运的源链重建、删除步骤，都在**变动前**给每个
   植物步骤钉上落点**对象引用**，变动后按引用刷回新 gidx、死者剔除。
   旧代码跨链源链靠"翻转后重新解析"（段上的 noint 滑到别的落点），
   删除靠"事后按 jobStepId 找回"（uid 按 key#gidx 继承 → 删错下一步）。
4. **通用动作摘除按 uid 精确命中**：同样的动作出现多次且中间隔着别的步骤时，
   按指纹摘第一个会把链序弄反（uid 兜底指纹）。
5. **`jobResolveSteps` 不再做 noint 归一化**（只留 `jobStoreSteps` 出口归一）——
   视图层归一化会直接改步骤对象，浮动补位落进「」组中段时组员被当孤立剥标记，
   后续存储把被剥对象写回 = 无间隔组静默解散。
6. **浮动补位跳过「」组**：落点补位若会插进无间隔组中段，顺延到组尾之后。
7. **跨链载荷补齐链侧字段**：植物带 times/comboMs/comboWatch/noint，
   通用带 noint + 自定义参数袋 + **神器快照**（旧版神器跨链后变裸「使用神器·?」）。

**回归测试台**（Node 直接跑，vm 沙箱加载真实编辑器 JS）：

- `tests/fuzz_drag.js [会话数] [每会话操作数]` —— 随机操作序列
  （放喂豆/加通用/同链拖拽/跨链单步/多选组搬/保存重开/删除/无间隔），
  逐步校验"视图 == 用户意图模型"，首错即停打印事前模型+事前/事后 raw。
  当前 200 会话 × 100 操作 **0 失败**。
- `tests/repro_shuipi.js` —— 水皮原始场景确定性回归
  （单次[喂豆5-5,喂豆5-3] → 搬出 → 保存重开 → 搬回 → 位置不变）。

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

### ★ 骨架固定、只翻动作（2026-10-28 用户定稿）

**一条固定路线，永不拆节点、永不换识别：**

```
识别开始战斗(OCR) -> 清空卡牌(OCR) -> 选取植物 -> (选取神器?) -> 开始战斗
                                      └ 编队模式: 切换编队 -> 无尽_选择编队 ┘
```

运行时**只翻动作 + 只接一个 next**，其余全交给 pipe 静态值：

| 情形 | 清空卡牌 | 选取植物 / 选择编队 | next 接线 |
| --- | --- | --- | --- |
| 阵容变 | `action: Click` | `action: Custom` | 终点 `next → [开始战斗]` |
| 阵容不变 | `action: DoNothing`（只认不点） | `action: DoNothing`（不真选） | 同上 |
| 神器要换 | 按阵容（同上两行） | 按阵容（同上两行） | 终点 `next → [选取神器]` |

- **`recognition` 永不覆盖**：`清空卡牌` 的 OCR 就是「确实站在选卡界面」的闸口，
  认不到就超时 —— 不会瞎点。（旧版阵容不变时改成 `DirectHit`，等于把闸口拆了：
  任何画面都「识别成功」，然后带着 60s 超时去 OCR「开始战斗」，重开过渡态最易炸。）
- **神器唯一入口 = 选卡终点**（`选取植物.next` / `无尽_选择编队.next`）：
  神器不换 → `选取神器` 压根不在链上，节点保持 pipe 原样（OCR 认「神器」）；
  要换 → 终点接过去，装完靠 `关闭神器界面.next = [开始战斗]`（pipe 静态）开打
  —— 植物在进神器链**之前**就换完了，所以神器链终点固定回开始战斗。
- **补给确定/闸门/首关入口一律进骨架**，不再各自塞一条神器分支：
  `神器补给_确定.next` 永远 `[清空卡牌, 自己]`，`识别开始战斗.next` 永远
  `[清空卡牌]`，未变闸门平时直跳开始战斗、要换神器时换成 `_JUMP_SAME_ART`
  （多插一站 清空卡牌）。
- **为什么这样就「不冲突」**：字段分工 —— `next` 归 `_inject_artifact`
  （要不要接神器），`action` 归 `_inject_lineup`（要不要真做），两个函数各写
  各的字段，MAA 按字段合并，谁都不会把对方顶掉。

### agent 端（engine / runtime）

- `engine.Table`：`boss_plants` / `boss_squad` / `boss_artifact` / `artifact`；
  有效值访问器 `eff_plants(is_boss)` / `eff_squad(is_boss)` / `eff_artifact(is_boss)`；
  **`lineup_sig(is_boss)`** = `("deck", squad, artifact)` 或 `("plants", tuple(plants), artifact)`。
- **阵容相同 → 只认不做**：`_STATE["lineup_sig"]` 记录当前生效阵容。
  `_inject_lineup(context, table, is_boss)` 统一所有注入点
  （JobSetFight 首锁/换表、JobSetPlan 换阵）：
  签名相同 → `清空卡牌.action = DoNothing` + `选取植物.action = DoNothing`
  （不清卡、不选卡、不切编队），识别与 next 一概不动；
  不同 → 两个动作还原 `Click` / `Custom` + 正常注入。首次进关（签名 None）必真选。
- **⚠️ 快照原则（2026-10-24 定稿）**：「还原用快照」**只收 runtime 自己会改的
  字段**。MAA override 按字段合并，没写的字段永远保持 pipe 现值 ——
  expected/roi/template 故意不收，pipe 改了也不会被还原顶掉（实锤过：pipe 给
  「选取神器」加 OCR 单字兜底「神」「器」，全量快照恢复时把兜底顶掉）。
  2026-10-28 起进一步收紧：
  · `_CLEAR_CARDS_ORIG` = `{action, next}`（**recognition 不在里面**，永不写）；
  · `_ARTIFACT_PICK_ORIG` **整份删除**（选取神器彻底退出 runtime 管辖）；
  · 新增 `_CHOOSE_PLANTS_ACTION_ORIG`（action）/ `_CHOOSE_PLANTS_NEXT_ORIG`（next）
    / `_SQUAD_PICK_NEXT_ORIG`（next）—— 动作与 next 分家，各归各的注入函数；
  · `关闭神器界面.next`、`识别开始战斗.next` 变成 pipe 静态值，runtime 不再碰。
  selfcheck §13 断言：字段集恰好是上面这些 + 值与 pipe 逐项一致 + 选取神器无快照。
  （闸门 next 清单 `_JUMP_*_ORIG` / `_SUPPLY_CONFIRM_ORIG` 仍是全量照抄 ——
  next 本来就是整表替换、runtime 全权负责，pipe 改了必须同步，同样有断言。）
- **闸门阵容维度修正**（`lineup_gate_adjust`，纯函数）：表没变但形态阵容不同
  → 翻「变化」重选；表变了但阵容相同 → 翻「未变」跳过。训练模式不修正
  （每关必重选是用户设定）。boss 预判用计数器 `lv % 5 == 0`（与补给预告同口径）。
- **★ 训练模式双层豁免**（踩过的坑）：闸门修正挡训练只翻了 next 分支，
  但 `_inject_lineup` 的签名相同分支会把节点**本身**的动作翻成空动作
  —— 分支走对了、节点被废了。所以 `_inject_lineup` 里还有第二道：
  `_STATE["training"]` 为真时永不 neuter（`JobSetPlan` 每关写入该标记，
  Fight/Stage 的节点参数里没有「训练模式」键，只能走状态；
  `JobSetLoad` 重置/新开局时清空）。
- 预热（`_prewarm_for_level`）：首关是 5 的倍数时用 boss 阵容预热；
  预热**不写** `lineup_sig`（首关必须真选）。

### 验证

selfcheck §13 全覆盖（解析/签名/快照一致性/只认不做/神器终点接线/闸门修正/补给），
全部通过。

### 补给屏旁路 bug（2026-10-24 水皮实锤 → 2026-10-28 结构性消失）

**症状**：boss 关槽位覆盖的植物永远不进卡组（"不会去修改卡槽"），
换到哪个槽都一样 —— 与槽位无关。

**当时的机制**：boss 关开局前必弹补给屏；闸门「变化」的 next 里
`无尽局内_补给` 排第一，流程被补给接管；补给终点 `神器补给_确定`
的 pipe 原值 next = `[开始战斗]`，被无条件还原 → 选卡整段旁路。

**现在为什么不会再犯**：`神器补给_确定.next` 是**常量** `[清空卡牌, 自己]`，
不存在「按 lineup_changed 分流」的分支可漏；清不清卡/选不选植物由骨架的
`action` 决定 —— 图上「补给→开始战斗」的旁路路径已经不存在
（`check_supply_bypass.py` 场景 A/B/C 的 bypass 计数恒为 0）。

**回归**：selfcheck §13「补给」2 条断言 + `agent/jobset/check_supply_bypass.py`
（真实 pipe + 真实 override 序列，枚举「闸门→开始战斗」全路径；阵容变的场景
每条都过 清空卡牌+选取植物，阵容不变时「未变闸门→开始战斗」的合法直跳保留）。

**教训**：决策层（闸门/注入/sig）全对不代表流程对 —— pipe 里任何
**终点节点的静态 next**（补给确定、神器界面关闭）都是选卡入口的同层节点。
后来干脆把所有分支收成一条骨架（只翻动作），这类「漏还原」问题从根上没了。

### ⚠️ 计数器落后 1 格（2026-10-29 追查中；一次错误修复已回退）

**现象**：某一局 bot 说自己在 107 关，游戏里实际是 108 关；真 boss 关（104）被按
105 处理并出现「已自动偏移」。

**已确认**：
- 主界面「第 X 关」**就是本关要打的关卡**（2026-10-29 实跑：识别到「第111关」
  时游戏里确实是 111 关）。❌ 曾经据此加过 `+1` 偏移（以为显示的是「已通过」
  那一关），实跑立刻多算 1 关，**已回退**，别再给计数器加偏移。
- `snap_boss()` 的静默对齐是「掩盖现场」的元凶：±2 偏差内它直接把计数器改掉、
  只写一行「已自动偏移」，于是「104 关被当成 boss 关」看不出根因。
  **已改**：偏差对齐时额外打一行 `⚠️ 计数器与 boss 关不符（偏差 +1）…`，
  `selfcheck` 有断言盯着（不许再静默）。

**待查（下次复现看这两行）**：
1. `📟 自动计数：识别到「第X关」` —— 用户观测「第一关不报数，第二关才报，且报的是
   上一关的号」＝ **自动计数的触发时机/取帧偏晚**，不是换算口径。
2. `过关计数：A -> B` 之间有没有缺一次（换了阵容重开 / 收尾重开 / 手动重开任务
   都可能是漏 tick 的点）。

**2026-10-29 21:58 那次日志（起始关卡=110）**：计数器全程正确 —— 预热按
`110 % 5 == 0` 判 boss、头像命中 `boss关，当前关卡数：110`、`过关计数：110 -> 111`
都对得上，**没有偏移行**。所以「落后 1 格」在那一局没有复现。
同一份日志暴露了另一件事：**`📟 自动计数` 一次都没出现**（节点没被触发，OCR 没认到
「第」），计数器全程等于 option「起始关卡」，而日志一个字都不提 —— 已于 2026-10-29 补：
`JobSetAutoCount` 成功时置 `_STATE["autocount_seen"]`，`JobSetPlan` 发现没置位就
**只提醒一次** `⚠️ 本次任务「自动计数」没跑成…关卡号完全来自 option「起始关卡」= N`。

### ⚠️ 覆盖 action 把自定义动作名冲掉 → `Action is null` → 整局 Task.Failed（2026-10-29 实锤）

**症状**：跑到某关选卡时任务直接失败，agent 侧只看到 `Tasker.Task.Failed`（很像"莫名其妙"）。

**MAA 侧证据**（`agent/debug/maafw.log` / `assets/debug/maafw.log`）：
```
22:24:18 Node.Action.Starting   无尽挑战_选取植物
22:24:18 [WRN] custom action target rect is empty ... [param.name=]
22:24:18 [ERR] Action is null [node_name=无尽挑战_选取植物] [param.name=]
22:24:18 Node.Action.Failed → 22:24:19 Tasker.Task.Failed
```
即：节点 `action` 还是 `Custom`，但**自定义动作名是空的**，MAA 找不到动作 → 动作失败 → 整局挂。

**根因**：骨架里「阵容不变 -> 只认不做」要翻动作，旧写法只覆盖 `action`
（`{"action": "DoNothing"}` / `{"action": "Custom"}`）——一旦 MaaFW 把这次覆盖
当成**整套动作**重建，`custom_action` 就丢成空串，留下「action=Custom + 空动作名」的半截状态。

**修复**：覆盖动作时**永远把 `custom_action` 一起写全**
（`_CHOOSE_PLANTS_ACTION_ORIG = {"action": "Custom", "custom_action": "SelectPlants"}`，
关动作时写 `{"action": "DoNothing", "custom_action": "SelectPlants"}`）。
selfcheck 加 2 条断言：快照必须带 custom_action、关动作时也必须带。
**规矩**：以后凡是要 override 一个 Custom 节点的 `action`，必须同时写 `custom_action`；
只覆盖 `custom_action_param` 才是安全的（「无尽_选择编队」就是这种，不动动作）。

### ⚠️ boss 关误用普通关卡组（2026-10-29 用户日志实锤，已修）

**症状**：第一次进 boss 关（计数 5/50/105…）走普通关路线：卡组还是上一关的普通关植物，
到了局内才靠头像认出「这是 boss 关」，然后才回头换卡。

**日志证据（两条独立 bug，同一个现象）**：

1. 局外闸门判成「未变」——日志里 `📋 当前关卡: 50 本关: boss关`、`⚔️ 第 50 关是 boss 关`
   后面**没有** `★ 阵容维度修正` 那一行。
   原因：任务刚起手时 `lineup_sig` 恒为 `None`，`lineup_gate_adjust` 的
   「签名未知 -> 保守不修正」这条规则对 boss 关是**反的**。
2. 局内阶段确认注入了普通关——日志里 `boss关，当前关卡数：105` 紧跟
   `已注入选卡植物（普通关）：[…杜英投手, 复活萝卜]`。
   原因：`JobSetStage` 调 `JobSetStage._apply_table(context, js, table)` **没传 `is_boss`**，
   里面回退读 `_STATE["is_boss"]`，而那个 state 只有 `JobSetFight` 写 ——
   阶段确认先跑（或那关 Fight 走普通关变体）时读到 False，boss 关被按普通关注入+锁定。

**修复**：
- `lineup_gate_adjust` 加两条规则：`cur_sig is None` + 本关 boss -> **一律重选**；
  新增 `cur_is_boss`（当前生效卡组的形态，`_STATE["lineup_is_boss"]`）与本关形态
  不同 -> **一律重选**。`_inject_lineup` 两个分支都记形态，
  `JobSetLoad` 重置 / `关卡回落` 时清空。
- `JobSetStage` 的两处 `_apply_table` 改成显式传 `is_boss`；
  `_apply_table` 回退读 state 时打警告（这坑不许再静默）。

**验证**：selfcheck §13 新增 4 条闸门断言 + 形态记录断言；用真实作业集
`assets/resource/jobs/pvz_20261029_003417.json` 跑状态机：起始关卡=103 时
第 105 关现在是 `★ 阵容维度修正：本关形态与当前生效卡组不同（boss 关配置）-> 重新选卡`
+ `清空卡牌 Click` + boss 卡组；`JobSetStage(是boss关=True)` 直接注入 boss 卡组。

**教训**：「签名未知」在普通关是安全方向（沿用），在 boss 关是**危险方向**
（拿错卡组打 boss）；凡是「保守」分支都要问一句：对另一种形态也保守吗？

## 10.6 相机神器（特殊类第二种，2026-10-25）

相机神器与葫芦同为 `special` 类，子模式走 `artBody` 通道（与葫芦体型共用
全部链路：编辑器体型子图标 / 段快照 / 导出 / dsl 编译）：

- **子模式**：`capture`（拍照）/ `print`（打印）。
  拍照 = 点神器位置 → 点「神器_初始化_相机复制」[707,570]；
  打印 = 点神器位置 → 点「神器_初始化_相机粘贴」[794,570] → sleep0.5 → 再点粘贴。
  （dsl.py `artifact` special 分支按 artBody 分流；连击展开重复，与葫芦同款。）
- **资源**：识别模板 `god_vessel/artifact_camera/{capture,print}.png`
  （在 bodytype/ 下 —— `/artifacts` 扫它得出 bodytypes 列表）；
  编辑器图标 `static/artifact/artifact_camera/bodytype/{capture,print}.webp`；
  主图 `god_vessel/artifact_camera/artifact_camera{,_1}.png`。
- **artifacts.json**：相机 type = `special`（编辑器按 bodytypes 自动出
  「拍照/打印」子按钮；中文名映射在 35 的 `ART_BODY_CN` 与 24 的摘要里）。
- **坐标**：`神器_初始化_相机复制/粘贴` 与 pipe 初始化节点都是现成的。
- selfcheck §8k 有编译断言（拍照/打印/连击展开/葫芦回归）。

**加下一种特殊类神器的流程**：拆包按钮图 → god_vessel/<en>/bodytype/<key>.png
+ static/artifact/<en>/bodytype/<key>.webp → artifacts.json type=special →
35/24 加中文名 → dsl.py special 分支加点击序列 → selfcheck 断言。

## 10.7 ★★ 撤销重构 + boss 关 / 普通关植物彻底分离（2026-10-30，用户实报）

> 用户原话：「落子撤销后重新落子，顺序链结构会不一致」「boss 关植物和普通关分离不彻底：
> boss 关选取了植物 a 落子后，普通关换植物 b，那 boss 关也不会把植物 a 变成植物 b」

### A. 撤销不可靠（两个独立根因）

| # | 根因 | 现象 |
| --- | --- | --- |
| 1 | 撤销快照**只存 boardEarly/boardLate 两块棋盘数组**，而链条顺序活在表的 `slotOrder/loopOrder/endOrder/boss*Order` 上 | 拖 chip 后 Ctrl+Z：撤掉的是**上一次落子**，链顺序没回退 → 链段里的 `picked` 下标按落点位置算，落点少一个就整体滑位 → **同一条链被拆成两段、顺序乱掉** |
| 2 | 快照**不认上下文**（不存表号/作业集），`jobLoadTable()` 换掉全局棋盘却不做任何处理 | 切表/换作业集后 Ctrl+Z → **上一张表的棋盘被灌进当前表** |

**现在的模型**（`04-cards.js` 顶部已写清楚，改代码前必读）：

- 快照 = `{ ctx, boardEarly, boardLate, t }`；`t` 是当前表除「身份字段」外的全部内容
  （`JOB_UNDO_TABLE_IDENTITY`：表名/覆盖关系/色块/头像 —— 它们归布局配置弹窗自己的 Ctrl+Z）。
- **栈顶 == 当前状态**（记录即所见）：`jobUndoRecord()` 内容不变就自动去重；
  撤销 = 回退到「上一份快照」，重做 = 反向。
- 快照带 `ctx = 作业集 code + 表序号`，**上下文一变就清栈**（`jobUndoReset()`：
  `jobLoadTable` / `jobApplyLoaded` / `jobResetEditor` 三处）；撤销时若上下文对不上
  直接拒绝并提示，绝不撤错表。
- **统一记录点 = `jobSaveLocal()`**（29-jobset-init.js 顶部）。全仓所有改数据的入口
  都会调它，所以落子 / 拖链条 / 切形态 / 改等待 / 补给 / 收尾参数一次全覆盖。
  老的 `saveBoardState()` 保留成 `jobUndoRecord()` 的同义别名（老调用点不用改）。
- 还原走 `jobUndoApply()`：棋盘 + 表字段**一起**换，然后统一重绘
  （`renderAllBoards / jobRenderTabs / jobFillForm / jobRenderSlots /
  jobRenderSeqChains / updatePreview`），最后 `jobSaveLocal()` 保证
  **视图 == 引擎导出 == 本地缓存**。
- 还原时清 `_jobLastSteps`（uid 配对缓存）、`jobSeqSel`（勾选）、`jobLastDrop`，
  否则勾选/uid 会指向旧对象。
- `08-board-data.js` 里旧的两处 `undoStack.pop()`（"操作失败就撤销刚记的那笔"）
  改成 `jobUndoDiscard()` —— 新模型是「记录当前状态 + 去重」，
  直接 pop 会误删一笔合法历史。

### B. Ctrl+Z 跨面板串扰（同族）

`04-cards.js` 的 document 级 keydown 以前只挡 `INPUT/TEXTAREA`，
所以在「🧩 布局配置」里按 Ctrl+Z 会**同时**撤销布局和主棋盘。

修法：把「打字中 / 有没有弹层开着」抽成**唯一判据**
`jobHotkeyBlocked(e)` + `JOB_MODAL_SELECTORS`（都在 `27-jobset-board.js`），
`jobInstallSlotHotkeys` 与 `04-cards.js` 的快捷键共用它；弹窗开着时
Ctrl+Z/Y 和 W/S/A/D 一律让开，弹窗自己的撤销（`34` 的 `jobLayoutUndo`）照常工作。

> ⚠️ **新增弹窗必须往 `JOB_MODAL_SELECTORS` 加一行**（根元素 id + 打开时挂的
> class），否则那个弹窗里按 W/S/Q/E/Ctrl+Z 会漏到主界面。

### C. boss 关 / 普通关植物分离（三处）

模型没变（`bossSlots` 三态：不存在=沿用 / `null`=已删除 / 名字=覆盖），
**变的是"什么时候从沿用变成覆盖"**：

1. **boss 棋盘落子 = 立即固化为显式覆盖**（`21-jobset-levels.js` 的 `placePlantOnBoard`）。
   在 boss 棋盘上放植物 a 的那一刻，若该槽还是「沿用」，就写
   `t.bossSlots[slot] = a`（值相同、语义变成"独立"），并给一行状态提示。
   之后普通关怎么改都不影响 boss。
2. **改普通关槽位植物只同步普通关棋盘**（`jobSyncNormalSlotPlant`）。
   旧 `jobSyncSlotPlantEverywhere` 把 boardEarly / boardLate **两块都改**，
   这正是"普通关换 b，boss 关的 a 跟着变 b"的直接原因。
   现在 boardLate 不动；若该槽仍「沿用」且 boss 棋盘上有落点，就地固化成覆盖
   （`jobBossBoardPlantName()` 取那株植物）。
3. **清空普通关槽位只清普通关棋盘**（`jobClearNormalSlot`）。
   旧 `jobPurgeSlotFromBoard` 两块都清。现在 boss 侧同理先固化再保留。

配套语义：一旦 boss 与普通关真的不一致，`jobBossSlotsDiffer()` 自然为真 →
「boss 关阵容」下拉自动变成「单独选卡」（原逻辑，未改）。
如果 boss 落的是**同一株**植物，覆盖值相同 → 仍算一致 → 继续「沿用普通关」，
不会平白给用户多出一套阵容配置。

> boss 关的植物选择器本来就是全植物列表（普通关在用的植物当然也在候选里），
> 这一点没动；改的只是"选中之后会不会被普通关带着走"。

### D. 复制阵容支持「勾选复制哪一侧」（2026-10-30，用户要求）

> 用户原话：「复制阵容会直接复制一整个表，可以选择只复制 boss，或者只复制普通关」
> 后续：「选择表后再选择复制 boss 关 / 普通关，或者都复制，你改成多选框好了」

`#tableCopyModal` 现在是**两步**（用户要求「点击那个表后再选择复制哪个阵容」）：

1. **第 1 步：选表** —— 每张来源表一行卡片，点一下选中（`_jobCopyTarget = i`）。
   卡片上已经写着两侧各会搬什么（`jobCopySideSummary`），但**还没有复选框**。
2. **第 2 步：选复制哪一侧** —— 两个复选框 `☑ 普通关` `☑ boss 关`（可只勾一个、可都勾），
   下面是「取消 / 📋 复制到当前表」，左上角「↩ 重选表」退回第 1 步。
   勾选状态**按来源表序号分别记**（`_jobCopySidesByTable` + `jobCopySidesOf(i)`），默认两个都勾。
   Esc 在第二步先退回选表，再按一次才关弹窗。

两个都勾 = 整表（走老的全量拷贝分支）；只勾一个 = 只搬那一侧；
两个都不勾 = 直接拒绝并提示，一个字段都不改。
- 老的那行「整表 / 只普通关 / 只 boss 关」胶囊按钮已删除（`jobBuildCopyScopeRow` /
  `jobCopyScope` 都没了）。`jobCopyTableFrom(srcIdx, sides)` 现在接受
  `{normal,boss}` 对象，同时**保留** `'normal' | 'boss' | 'all'` 字符串写法（回归测试在用）。
- 卡片比原来的列表宽，`#tableCopyModal .jp-panel` 在 `base.css` 里单独放宽到 460px。

字段切分（`JOB_COPY_NORMAL_FIELDS` / `JOB_COPY_BOSS_FIELDS`，对着 `jobNewTable` 逐个归类）：

| 范围 | 拷什么 |
| --- | --- |
| 只普通关 | `lineupMode/deckNo/slots/artifact`、三条链（`slotOrder/loopOrder/endOrder`）、`slotModes/waitAfter`、收尾参数（`end*`）、`boardEarly`、`waveEnabled/loopPlant/oncePlant` |
| 只 boss 关 | `bossLineupMode/bossDeckNo/bossSlots/bossArtifact`、`bossSlotOrder/bossLoopOrder/bossSlotModes/bossWaitAfter`、`boardLate`、`supplyPicks`（补给是 boss 专属） |
| 整表 | 老行为：内容全拷，表的身份字段（表名/覆盖/levels/色块/头像）不拷 |

**两个必须的固化步骤**（不做就会出现"孤儿植物"，写在这里防回退）：

1. **只拷普通关**：拷之前先 `jobFreezeBossInheritedSlots(cur)` —— 目标表 boss 侧
   "还在沿用、但棋盘上已有落点"的槽就地固化成显式覆盖。否则 boss 关的植物会跟着
   新槽位一起变（就是 §10.7-C 那个"分离不彻底"的翻版，只是入口换了）。
2. **只拷 boss 关**：拷完用 `jobFreezeBossInheritedSlots(cur, cur.boardLate)` ——
   来源表 boss 侧可能整片是"沿用"（`bossSlots` 里没键），拷过来后若保持沿用，
   这些落点会被**目标表的普通关槽位**解释 → 植物名对不上。必须用来源 boss 棋盘上
   的植物固化成覆盖。

> 复制后统一走 `jobAfterCopyRender()`（重绘 + 刷新 boss 阵容下拉 + 存本地缓存 + 状态提示）；
> 状态提示里会带「已固化 N 个」。
> 现在有撤销兜底（§10.7-A），复制错了可以直接 Ctrl+Z。

### E. 指定表替换 / 删除植物 + 槽位连续化（2026-10-30，`42-jobset-batch.js`）

> 用户原话：「槽8有植物的时候不能把槽7的植物去掉，期望应该是7植物去掉后
> 槽8植物变成槽7植物」「boss关的槽位配置还是有槽6到槽9中间会有空着的情况」
> 「点击编辑替换这个植物的时候，右边有一个替换指定表，然后点击后跳出包含有
> 这个植物的表（boss和普通关分离），点击后可以进行替换」
> 「点击删除也是同理，会跳出删除所有表的这个植物还是删除这个表普通关的植物」

> ⚠️ **没有独立按钮**：先做过一版"🔄 批量替换"按钮 + 独立弹窗，用户要求撤掉
> —— 功能要长在**原本就在用的交互**上：替换挂在植物选择器右侧，删除挂在槽位 ✕ 上。

**① 「替换指定表」= 植物选择器的右栏（`#plantReplacePanel`）**

- 点槽位胶囊的 ✎ 打开选择器，**右栏**列出"这个槽现在用的植物 A"在**所有表**里的分布。
- **版式（2026-10-31 用户定稿）**：**一张表 = 一个大块，里面「普通关 / boss 关」两个小块左右并排**
  （早期是"每处一行"的竖向列表，用户明确要求改成左右，理由「方便点击」）。
  每个小块两行：`☑/☐ + 关别` / `槽 1/3 · 5 株`；右上角 8px 小字标 `编辑`（正在编辑）/ `也在用`（boss 追问候选）。
  面板 `#plantReplacePanel` 宽度相应从 236px 放宽到 **256px**（`index.html`）。
  - **boss 小块有没有这株决定能不能勾**（用户要求）：boss 侧只认**显式覆盖**
    （`jobReplaceSideInfo` / `jobSideUsesPlant(t,'boss',A)`），没有就 `opacity:.45` **灰掉且不挂点击事件**，
    副标题写「没用·沿用」；有才可勾。纯沿用的不用勾：改普通关它自己会跟着变。
  - **「正在编辑」那一处默认打勾**（用户要求）：打开选择器 `jobResetReplaceSel()` 就种上这个勾
    （执行完 `jobApplyReplaceNow` 也会回到这个默认态）。它是 A 的来源，永远**可以**取消勾选。
- 交互（2026-10-31 起**多选**）：**勾若干处 → 再点左边的植物 = 把这些地方的 A 一起换成它**
  （勾几处就换几处，不用一张表来一遍）。点小块只 toggle 勾选（`jobToggleReplaceTarget`）。
  - 状态：`_jobReplaceSel = { '表序号|normal'|'表序号|boss': true }`（对象而非数组，toggle 是 O(1) 且天然去重）。
    底部按钮 `✕ 只保留正在编辑这一处 / ✕ 全部取消勾选` = `jobCancelReplaceArm()`（一键清空）。
  - **勾选集合跟着数据走**：`jobRenderReplacePanel` 每次渲染都拿 `jobReplaceCards(A)` 做一次交集，
    换完/删掉/切槽位之后已经不含 A 的地方自动退出勾选（不会留下指向空处的幽灵目标）；
    「正在编辑」那一个键永远保留。
  - 老的单选入口 `jobArmReplaceTarget(table, side)` 保留（只选一处），内部/回归在用。
- ★ **谁改当前槽**：只勾「正在编辑」这一处时 `jobTryApplyReplaceFlow` **直接返回 false**，
  点植物照老样子走 `jobConfirmPick`（去重 / 卡条连排 / 落子态 / 关选择器 / boss 固化全在它里面）。
  一旦还勾了别的表，就先 `jobTryPickCurrentSlot(dst)`（内部再调 `jobConfirmPick`，同样的老流程）
  再批量替换其它表 —— **两边都不丢语义**。换句话说：勾着它就是"连当前槽一起换"。
- ★ **boss 关追问**（用户要求「如果 boss 关有就询问 boss 关需不需要替换」）：
  会被改动的普通关（**含「正在编辑」那一处**）里，同一张表的 boss 关**也在用 A**（显式覆盖）
  且没被勾时，**不立刻执行**，而是把这次操作挂进 `_jobReplacePending`
  （`{src, dst, targets, bossExtra, blocked, pickCurrent}`），面板顶部弹一块黄色追问：
  `✅ 一起替换（含 boss 关 N 处）` / `➡️ boss 关不动（只换普通关）` / `✕ 取消`。
  - 追问阶段**一个字段都不改**（回归断言盯着），点按钮才落 `jobApplyReplaceNow`。
  - **只有显式覆盖才算"boss 关自己用了它"**：纯沿用的不用问 —— 换普通关它自动跟着变（问了反而是噪音）。
  - **反方向不问**（勾 boss 关不动普通关）：用户只要求 boss 侧这一句。
  - 追问期间点植物 = 重新算一遍（先清 pending）；点任意小块 toggle 也会清 pending。
- 执行 `jobApplyReplaceNow(src, dst, list, blocked, pickedCurrent)` → 逐处 `jobReplacePlantInTable(t, side, src, dst)`：
  改该侧槽位 + 同步该侧棋盘落点（非当前表用它自己的 `t.boardEarly/t.boardLate`，见 `jobSideBoardOf`）；
  汇总成一条状态提示（列出换了哪几处、共几个槽），然后统一走 `jobAfterPlantChange`（重绘 + 存本地 + Ctrl+Z 可撤销）。
  - ★ 普通关分支会先 `jobFreezeBossInheritedSlots(t, 该表 boss 棋盘)`：普通关槽位一变，
    纯沿用的 boss 槽会跟着变（§10.7-C 同族），必须先把"沿用 + 已有落点"的槽固化成覆盖。
- **同一植物不能占两个槽**：`jobSideUsesPlant` 命中的**那一处**跳过（进 `blocked`），其余照换，
  状态提示里写明「跳过 X（已经在用 Y）」—— 早期是整次拒绝，多选下那样会让人以为全没生效。
- 数据源：`jobReplaceCards(name)` → `[{table, normal:{uses,slots,placements}, boss:{...}}]`；
  某类落点计数 `jobCountPlantOnBoard`。（老的 `jobListPlantLocations` 还在，删除弹窗在用。）

**② 「删除这个植物」= 槽位胶囊 ✕ 的二选一（`#plantDeleteModal`）**

- 弹窗里固定两项：
  1. **只删这张表的这一株（当前关别）** → `jobDeleteSlotHere(ctx)`：
     清槽位 + 清**该侧**落点 + 压实（普通关清完还会给 boss 侧做一次查漏压实）。
  2. **删掉所有表里的这一株** → `jobDeletePlantEverywhere(name)`：
     所有表的普通关槽位 + boss 覆盖槽全清，两侧棋盘按**植物名**清落点
     （`jobPurgePlantOnBoard`，能顺带清历史孤儿），各表各自压实。
- 弹窗顶部会列出"这株植物在全部表里的分布"，让用户看清影响面。
- boss 胶囊的三种状态里，只有**覆盖槽**的 ✕ 走这个弹窗（"删除沿用 / 恢复沿用"
  是槽位配置操作，不是删植物，保持原样）。

> 🚨 **弹窗必须有 CSS**：本项目的弹窗样式是**按 id 逐条写的**
> （`#jobPickModal, #tableCopyModal { ... }` 那一大段），新建弹窗只加 HTML
> 不会自动套上遮罩/面板 —— 表现是"点了没反应"（内容其实渲染在页面最底部）。
> 新增弹窗时**必须把 id 追加到 `base.css` 那组选择器**里，
> 并加进 `27-jobset-board.js` 的 `JOB_MODAL_SELECTORS`（键盘闸口）。
> `#batchReplaceModal` 就是这么漏过一次的（2026-10-30 实锤，现已撤掉）。

**③ 槽位连续化 `jobCompactSlots(t, isBoss, boardArg)`（本文件最重要的函数）**

把"占用中的槽"按原顺序压到 1..n，中间的空槽 / boss 已删除槽被顶掉。
**槽号被五处数据引用，必须一起搬，漏一处就是孤儿数据**：

| 处 | 普通关 | boss 关 |
| --- | --- | --- |
| 槽位 | `t.slots` | `t.bossSlots`（压实后**一律写成显式覆盖**） |
| 棋盘 | `boardEarly` 里 `it.id='cardN'` | `boardLate` 同理 |
| 三条链 | `slotOrder/loopOrder/endOrder` 的 `seg.key` | `bossSlotOrder/bossLoopOrder` |
| 形态 | `slotModes` 的键 `cardN` | `bossSlotModes` |
| 动作后等待 | `waitAfter` 的键 `once\|cardN\|r,c\|seq` | `bossWaitAfter` |

> 链条段里的 `picked/from,to/order` 是**该槽内部**的落点下标 —— 整槽一起搬，
> 所以这些下标不用改。被删除槽的段整段丢弃。
> 压实后清 `jobArmedSlot / jobSeqSel / _jobLastSteps`（都指向旧槽号）。

**④ 四处调用点**

1. 普通关槽位 ✕ → 弹「只删本表 / 删所有表」（见 ②）→ 选"只删本表"时走
   `清空 → jobClearNormalSlot → 压实`，也就是**槽8 的植物会顶到槽7**（用户要求的行为）。
   之后顺手给 boss 侧做一次查漏压实（纯沿用时恒等，只有历史空洞会被清理）。
2. boss 槽位 ✕ 的"覆盖"分支改为弹同一个删除弹窗；"删除沿用 / 恢复沿用"两个分支
   仍各自补了 `jobCompactSlots(t,true)`。
3. 删除所有表里的这株（`jobDeletePlantEverywhere`）。
4. **载入即压实（用户明确要求：不留"压实"按钮）** —— `jobCompactAllTables()`：
   - `28-jobset-io.js` 的 `jobApplyLoaded`（服务端载入作业集）在 `jobLoadTable(0,true)`
     **之前**调一次；
   - `29-jobset-init.js` 的 `jobInit`（刷新恢复本地缓存）在 `jobLoadTable` **之前**调一次。
   - 它压**所有表**，并显式传各表自己的 `t.boardEarly / t.boardLate`
     （此刻全局棋盘只是当前表的拷贝，所以 `jobCompactSlots` 才有 `boardArg` 这个参数）。
   - 旧数据里"中间空槽"因此再也不会进到界面上。

> ⚠️ **boss 覆盖层的坑**：boss 槽位"没写键 = 沿用普通关同槽"。所以压实后
> **尾部多出来的槽必须显式置 `null`（已删除）**，否则第 n+1 号槽会重新沿用普通关
> 那一槽的植物 —— 等于删掉的槽自己长回来。这就是"boss 槽位中间空着/乱长"的根因之一。
>
> ⚠️ **普通关清槽会牵动 boss**：`jobClearNormalSlot` 会把 boss 侧**所有**
> "沿用 + 有落点"的槽一次性固化（不只是被清的那一槽）。因为普通关压实时槽号会变，
> 只固化一槽会让其它沿用槽指到别的植物上 → boss 关静默丢株。

### F. 回归测试（新增，别再删）

```powershell
node game_assist_tools\endless_setup\tests\repro_undo_boss.js     # 撤销/链条 + boss 分离
node game_assist_tools\endless_setup\tests\repro_copy_scope.js    # 复制阵容的三种范围
node game_assist_tools\endless_setup\tests\repro_slot_compact.js  # 槽位压实 + 替换指定表（多选/boss 追问/面板结构） + 删除这株
```

另外三套回归（`tests/fuzz_drag.js`、`tests/repro_shuipi.js`、`tests/repro_cell_queue.js`）必须一起保持全绿。

### G. 已和用户对齐、但**尚未开工**的优化（下一轮挑着做）

> 2026-10-30 审计结论，按「风险 / 价值」排的，用户已认可这个顺序。
> ⚠️ 动手前先问一句用户现在要做哪个，别自己全做。

| 级别 | 事项 | 关键位置 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| P0 | **链条段身份从"位置下标"改成"稳定 id"** | `24-jobset-fields.js` 的 `jobSegPlacements`、`27` 的 `jobStepsToSegs/jobSegsToSteps` | **高**（§9.2 修过 6 个同族 bug） | `picked/gidx` 是**该槽内部**的位置下标，任何落点增减都会滑位；这是"拖拽串位/撤销错乱"整族的根。必须用 `tests/fuzz_drag.js` 兜 |
| P1 | **触摸端可用**（安卓 Web 已适配，但拖拽全废） | 链条块 / 补给卡 / 布局涂抹走 HTML5 `draggable`；全仓零 pointer 事件 | 中 | 轻量版：链条 chip 与补给卡加「↑/↓ 移一位、移到首/尾」（约 80 行，手机立刻能用）。彻底版：改 Pointer Events（约 300 行，跑 fuzz） |
| P2 | **未保存改动防护** | 全仓无 dirty 标记、无 `beforeunload` | 低 | 本地缓存 300ms 自动存，但**写回作业集文件必须手点 💾**；切作业集/新建/删除前该做 confirm，顶部该显示「● 有未保存改动」 |
| P3 | **拆分 `27-jobset-board.js`**（183KB / 3800+ 行） | 链条 / 落子 / 快捷键 / 自动滚动 / 植物选择器全在一个文件 | 中 | 纯搬移，只减未来 bug；放 P0 之后做，避免在巨型文件里二次改结构 |
| P4 | boss 关交互小优化 | `27` 的槽位胶囊 | 低 | 给"已独立化的 boss 槽"加个 🔒 角标，让「落子即固化」这件事看得见 |

---

## 10.8 ★★ 格内落子顺序方块窗 + 右键/ Ctrl 键语义（2026-10-31，`43-jobset-cell-queue.js`）

> 用户原话：
> 「ctrl+左键点击 x 可以直接去除整个多个植物挤占的槽位」
> 「直接右键点击这个多个格子覆盖的落子位置时，显示的是方块格式的样子，
> （长得和棋盘差不多，角标保留，按照放置顺序排序，不同链不影响，
>  可以拖拽修改这个格子的放置顺序，最左上角就是最先放）
>  **右键去除整个格子则是 ctrl+右键**」
> 追问后补充：「不同链条做区分，支持跨植物修改，右键点击清空的特性保留」；
> Ctrl+左键那条是**左侧槽位胶囊的 ✕**（不是棋盘格子）。

### A. 三个新手势（都在现有交互上长出来，没有新增独立按钮）

| 手势 | 位置 | 行为 |
| --- | --- | --- |
| **右键**（格内 ≥2 个落子） | 棋盘格子 | 打开「格内落子顺序」方块窗（`#cellQueueModal`） |
| **右键**（格内 1 个落子） | 棋盘格子 | 直接清空这一格（老行为保留；内部改走安全删除） |
| **Ctrl+右键** | 棋盘格子 | **直接清空整格**（不弹窗） |
| **Ctrl+左键** | 左侧槽位胶囊 ✕ | 不问「只删本表 / 删所有表」，**直接删掉本表这一槽**（= 弹窗第一项） |

- 棋盘右键分支在 `08-board-data.js` 的 `contextmenu` 里，改完的判定顺序：
  `Ctrl → 清空` / `多落点 → 方块窗` / `其余 → 直接清空`。
- 槽位 ✕ 的 Ctrl 分支在 `27-jobset-board.js`（普通关一处 + boss 覆盖一处），
  走 `jobDeleteSlotHere({name, side, slot})` + `jobAfterPlantChange()`（42），
  语义与删除弹窗里的「只删这张表的这一株」完全一致。

### B. 方块窗长什么样（`43-jobset-cell-queue.js` 渲染）

```
┌ 格内落子顺序   第 (3, 4) 格 · 共 5 项                     ✕ ┐
│ ［单次］2 项                                        ← 左上最先 │
│  ┌──────┐ ┌──────┐                                          │
│  │🫘 ①✕ │ │🌱 ③✕ │   ← 拖拽换顺序；右上角 ✕ 只删这一个        │
│  └──────┘ └──────┘                                          │
│ ［循环］1 项                                                 │
│  ┌──────┐                                                   │
│  │🌱 ④✕ │                                                   │
│  └──────┘                                                   │
│ [☑ 多选删除] [🗑 清空整格]              拖动方块调整顺序…    │
└──────────────────────────────────────────────────────────────┘
```

- **按链条顺序排**（不是按棋盘格子数组的"放置先后"）：排序键 = `jobBuildGlobalSeq`
  的全局序号，跟棋盘上的 `#N` 角标**同源**，所以两边永远一致；拖完一起重编号。
- **不同链做区分**：单次 / 循环 / 收尾分组（boss 关只有前两组），
  **拖拽只允许同组内**（跨形态是两条独立的链，先后没有可比性）。
- 方块样式复用棋盘那套味道：品质底图 `card_bg/rare_N.webp` + 立绘/动作图标 + 角标，
  动作图标走 `15-board-actions.js` 注册表（`jobBoardActionImg`），新动作自动支持。

### C. 拖拽到底改了什么（★ 最容易搞错的一点）

**执行顺序不存在棋盘格子的数组顺序里**，而在**链条的步骤列表**里
（`jobResolveSteps`：一株一步，`{kind:'plant', key, gidx}`）。
所以重排 = 把「本格那几个落点对应的步骤」在步骤列表里换位，再 `jobStoreSteps` 压回段格式：

```js
// jobCellQueueReorder(which, orderedItems)
positions = 本格这些步骤在 steps 里的下标（升序，**位置集合不变**）
want      = 期望顺序对应的步骤对象
out[positions[i]] = want[i]        // 只换内容，不挪位置
jobStoreSteps(t, which, board, out)
```

这样保证：**别的步骤的相对顺序一个都不动**（回归第 1 节断言了
`['card1#0','card1#1','feed#0','feed#1']` → `['feed#0','card1#1','card1#0','feed#1']`）。
相邻同槽会自动并回一段，中间被别的槽插开就自动拆段 —— 完全交给 `jobStepsToSegs`，
**不要去改 `seq` / `picked`**（那是 §9.2 那一族 bug 的入口）。

### D. 删除必须「先钉引用再删」

`jobCellQueueDeleteItems(items)`（单个 ✕ / 多选删除 / 清空整格 都走它）：

1. 三条链各自 `jobResolveSteps` + `jobPinSteps`（把每个步骤钉到**落点对象引用**上）；
2. 用**删除前**的 `jobPlacementsOf` 把「要删的 item」翻译成 `key#gidx`，标成 victims；
3. 从棋盘删（按对象身份 `indexOf(item)`，不按 gidx）；
4. `unpin()` 把 gidx 按引用刷成删除后的编号，恰好 `alive && !victims` 的留下 → `jobStoreSteps`。

顺序反了就会删错下一步（§9.2 fuzz 实锤过），回归第 2 节专门断言
「两颗豌豆的落点对象没串位、gidx 重排后仍指向原来那两个」。

### E. 上下文失效保护

`_cqCtx = { r, c, board }` 存的是**当时那块棋盘的数组引用**。`jobLoadTable`
（换表）和 `initTabs`（切普通关/boss 关）都会把全局棋盘换成新数组，所以两处都补了
`jobCloseCellQueue()`；`jobCellQueueAlive()` 还会现算一次
`jobCurrentBoard() === _cqCtx.board`，对不上就拒绝一切拖拽（回归第 5 节）。

> ★ 例外：`jobCellQueueClear(r, c)` 是给**棋盘右键**用的，它**不看**弹窗上下文，
> 按当前棋盘来（临时借一个上下文，做完原样还回去）。

### F. 弹窗登记（踩过的坑，别漏）

新弹窗两处必登记 —— 都做了：
`base.css` 里独立一块 `#cellQueueModal` 样式（本仓弹窗样式**按 id 逐条写**，没有公共类）＋
`27-jobset-board.js` 的 `JOB_MODAL_SELECTORS` 补一行 `#cellQueueModal.cq-open`（键盘闸口，
否则在方块窗里按 W/S/Ctrl+Z 会漏到主界面）。按钮绑定在 `29-jobset-init.js` 的 `jobInit`（`jobBindCellQueue`）。

### G. 回归

```powershell
node game_assist_tools\endless_setup\tests\repro_cell_queue.js
```

7 节 51 条断言：本格重排（跨植物/跨动作、别的步骤不动、角标同源、自动拆并段）
/ 单个删除（gidx 不串位）/ Ctrl+右键清空整格 / 单次循环分组隔离 + 跨链拖拽拒绝 /
上下文失效保护 / **弹窗 DOM 结构**（分组、方块数、角标、✕ 只删一个、删完自动刷新）/
**Ctrl+Z 一次就能撤回**（见下面的 H）。

### H. ⚠️ 踩坑实录：Ctrl+右键清空后 Ctrl+Z「按一下没反应」（2026-10-31 用户实锤）

**症状**：Ctrl+右键清空一格 → 按一次 Ctrl+Z，状态栏照常报「↩ 已撤销」，
**但格子还是空的**；再按一次才真的回来。

**根因**：`jobAfterCellQueueChange` 里把 `jobSaveLocal()`（撤销记录点）写在了
**渲染之前**。而**渲染不是只读的**：

| 渲染函数 | 它干了什么（会改数据） |
| --- | --- |
| `renderBoard`（08） | `jobEnsureSeq` / `jobEnsureOrd` 给落点补 `seq` / `ord` |
| `jobRenderSeqChains` / `jobBuildGlobalSeq` | `jobGetChainOrder`（23 末尾）会把「覆盖率修复」补出来的段**写回** `t[field]` |

撤销快照（`04-cards.js` 的 `jobUndoSnapshot`）的 sig 是「棋盘 + 整表」算的，
所以「先存快照 → 再渲染」记下的是**渲染前**的旧状态；等用户按 Ctrl+Z，
`undoBoard()` 开头那次 `jobUndoRecord()` 发现 sig 变了、又压一条 ——
于是第一次撤销只是回到"看起来一模一样"的那份旧状态，白按一下。

**规矩（全仓通用，别再犯）**：
> **改数据 → 重绘 → 最后再 `jobSaveLocal()`。**
> 撤销记录点必须排在所有「会写盘/写表/写棋盘」的动作**之后**。
> 参考既有路径：`renderAllBoards(); updatePreview(); jobSaveLocal();`（落子/清盘）、
> `jobAfterChainChange()`（拖链/删步）、`jobAfterPlantChange()`（替换/删植物）。

**现在**：`jobAfterCellQueueChange()` 的顺序是
`jobSaveCurrentBoard() → 渲染(jobRenderSeqChains/CurrentBoard/updatePreview/弹窗) → jobSaveLocal()`；
另外 `jobCellQueueDeleteItems()` 动手**前**还会记一笔（同 `placeOp` 里的 `saveBoardState()`，
内容没变会被 `jobUndoRecord` 去重，零成本）当保险。

**回归**：`repro_cell_queue.js` 第 7 节用「渲染桩会补 `ord`」模拟这个副作用，
断言「撤销栈只长一条 + 按一次 Ctrl+Z 就撤回」。
反向验证过：把记录点挪回渲染之前，这两条立刻红（栈变成 3、格子仍是 0）。

---

## 11. 最近验证结果（全绿基线）

**编辑器（2026-10-31 收工时实测）**：

```
node --check static\js\*.js            → 39 个文件，0 失败
node tests\repro_undo_boss.js          → 撤销/链条一致性 + boss 分离（25 条）
node tests\repro_copy_scope.js         → 复制阵容两侧复选框（含"都不勾=拒绝"）
node tests\repro_slot_compact.js       → 槽位压实 + 替换指定表 + 删除这株 + 载入压实
                                          （第 7/7b/8/9a/9b/9c/10 节 = 多选目标 / 正在编辑默认勾
                                           / boss 追问两分支 / 同植物跳过 / 面板左右并排结构）
node tests\repro_cell_queue.js         → 格内落子方块窗（§10.8）：本格重排 / 单个删除 /
                                          Ctrl+右键清空整格 / 单次循环分组隔离 / 上下文失效保护
                                          / 弹窗 DOM 结构（46 条）
node tests\repro_shuipi.js             → 水皮场景回归
node tests\fuzz_drag.js 200 100        → 200 会话 × 100 操作，0 个会话有首错
Get-ChildItem -File . -Filter zz*      → 空（临时脚本必须删干净，见 §8）
```

**运行时（Python，编辑器改动不影响，此处为历史基线）**：

```
selfcheck.py                       →  全部通过
                                     第 8 节 form 21 条 / 第 9 节 tap 8 条
                                     第 10 节 squad 14 条（含与真实 pipe 对照）
check_resource.py assets/resource  →  All directories checked
check_graph.py                     →  仅预存在空壳告警，无悬挂引用（见下方更正）
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
agent/jobset/runtime.py     具名分支 expected 注入（识别编队1/2）；
                            _squad_param 改走 any_of（顶层 expected 对 Or 无效）
                            typing 补 List
agent/jobset/selfcheck.py   第 10 节 squad 14 条（含与真实 pipe 对照的漂移检测）
assets/resource/pipeline/Endless_ref/02_Endless_plant_Choose_ref.json
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
| 退出看门狗 | `agent/exit_watchdog.py`：关闭宿主（MFA/VSCode）时 `AgentServer.join()` 不返回，python.exe 残留。基础路径=**祖先进程监控**（toolhelp32 快照记录祖先链 **最多 6 层** 的 PID 与 exe 名，1.5s 轮询，消失或 PID 被复用即判宿主已关 → 2s 后 `os._exit`；2026-10-07 从 2 层放宽——扩展链路变成 `python <- powershell <- Code.exe`，Code 在第 3 层，2 层够不到导致 dev 模式失效、"停任务即退"不武装）。**VSCode 扩展宿主（祖先含 Code.exe）额外武装停止即退出**，双保险：① `Tasker.Task` 终态事件 sink（客户端是否转发没保证）；② 长动作循环里的协作检查 `_stopped()`（custom_select_plant）观测到停止即 `on_task_stopped()`——**action 运行期间是唯一可靠观测点**（句柄有效；action 外即被回收）。扩展每次 startTask 会 agent start race 重拉死进程 → 停=自杀=下次跑新代码（dev 循环刚需；扩展复用进程导致旧代码驻留，容易误判"改动没生效"）。**桌面端 MFAAvalonia 绝不停止即退**：它停任务后不重拉只复用，自杀后第二次任务 custom 全废（2026-10-04 打包版实测）。轮询 `tasker.running` 路线废弃（句柄 action 结束即回收，报 `tasker not found`/误自杀）。⚠️ `_stopped` 必须查 `stopping` 而不只 `running`——停止期间 running 要等当前 action 返回才变 False（鸡生蛋），SelectPlants 曾因此停任务后还多滑 20s |

---

## 12.1 ★ 作业集目录必须在「包外」（2026-10-30 踩坑）

**现象**：用户更新一版就发现本地作业集全没了。

**成因**：2026-09-30 的 `perf:更换打包目录地址` 把作业集从
`<根>/assets/resource/jobs` 挪进了 MaaFramework 的资源目录
`<根>/resource/jobs`。安卓端 `<根>` 是 MaaFwApp 的 **pi 解包树**，而
`resource/` 是包里带的**根级条目**：

- App 升级时 `versionCode` 与 `pi/pi.version` 标记对不上 →
  `PiInstaller.install(wipe=false)` 先按上一份包的清单把
  `resource/`、`agent/`… 整棵 `deleteRecursively()` 再重解；
- 设置页「重新解压资源」走 `reinstall()`，`wipe=true` 直接把整棵 pi 删掉；
- 包里又没有作业集（`prepare_android_pi.py` 明确清掉），重解后就是**空白**，不可恢复。

MaaFwApp 自己的契约写在 `Android/MaaFwApp/INTEGRATION.md`：
> 更新只整体替换新包根目录下有的条目（`resource/`、`tasks/`、`agent/` 这些），
> 其余不动。所以记录、缓存放 `debug/`、`config/` 这类包里没有的目录。

**现在的位置**（唯一口径：`agent/jobset/engine.py` 的 `jobs_dir_for()`，
`pvz.py` / `pvz_android.py` 各留一份同口径实现，selfcheck §21 断言不漂移）：

| 布局 | 作业集目录 | 为什么安全 |
| --- | --- | --- |
| 安卓（`<根>` = pi 解包树） | `<根>/../jobs` | 与 `pi` 同级；升级只替换包内根级条目，重解资源也不会删它 |
| 桌面发行包 | `<根>/jobs` | 包里没有 `jobs/` 这一项，差分更新/解压覆盖都不碰 |
| 开发仓库 | `<根>/assets/resource/jobs` | `.gitignore` 已排除，测试夹具也用它 |

**迁移**：`migrate_legacy_jobs()` 会把历史位置（`<根>/resource/jobs`、
`<根>/assets/resource/jobs`）里的 `*.json` 搬到新位置，同名不覆盖；
agent 在 `load_jobset()` 前搬一次，网页端在启动时搬一次。

**以后再加新功能**：**任何用户数据都不要写进 `resource/`、`agent/`、
`game_assist_tools/` 这三个根级条目**，否则下次更新一起没（`debug/`、
`config/` 是包外安全区的惯用名）。

---

## 13. 归档：历史设计文档（2026-10-03 并入本节，原独立文件已删除）

> 三份文档的**有效信息全部压在这里**，实施过程细节（阶段勾选清单等）去 git 历史里找。
> 运行时会被代码读取的 md 只有 `agent/select_plant/植物中英文对照表.md`（数据表，不在此列）。

### 13.1 作业集数据流重构定案（原 `REFACTOR_PLAN.md`，阶段 1–6 已于 2026-10-02 收官）

- **总原则**：HTML 负责「算」，运行时负责「盖」。作业集 JSON 里**没有** pipe 字段；
  `compiled` 预编译块（`format:2`）在编辑器保存时生成，运行时 `override_pipeline(compiled)` 零翻译。
  ⚠️ **改了 `agent/jobset/compile.py` 必须重启编辑器再重存作业集**：编辑器是常驻进程，
  Python 模块缓存不更新，重存烘焙的还是旧 override（2026-10-04 踩过：加了
  `无尽挑战_失败` 进链 next，重存三次都还是旧的——杀编辑器进程重开才好）。
- **覆盖顺序钉死**：compiled 先盖，编队/补给/选卡后盖（后盖赢）；
  永不覆盖 `无尽局内_继续挑战.next`（顶掉训练模式的血泪）。
  三链 next = `[继续挑战 → 收尾(有收尾链时) → 无尽挑战_失败 → 落点]`，顺序=优先级；
  `无尽挑战_失败` 节点在 `Endless_ref/Endless_out.json`，失败后行为由
  interface 选项「无尽挑战_失败后选项」over（停止/重置/继续）。
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
