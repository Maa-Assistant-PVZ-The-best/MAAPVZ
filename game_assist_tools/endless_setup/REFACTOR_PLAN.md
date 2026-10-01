# 作业集重构 —— 方案（已定案 + 实施记录）

> 状态：**阶段 1–6 全部完成**（砍 OCR → 计数器 → compiled 预编译 → 运行时只吃
> compiled → 删回退路径 → 考古清理）。重构收官。
> 本文档取代早先的「待拍板」版本，四个决策点都已定案，见 §4。

---

## 0. 目标（用户原话）

> 「读取作业集的只负责 pipe 覆盖，html 负责产出需要覆盖的完整作业集 json」

即：**HTML 负责「算」，运行时负责「盖」。** 消灭现在的「第二次编译」。

---

## 1.0 ★ 先纠正一个前提：「pipe 字段」不存在

实测三份真实作业集 + 全部 JS：**作业集里没有任何叫 `pipe` 的字段。**

```
顶层键: code name version worlds max_level everyN tables
表内键: from_level to_level lineup slots squad slotModes slotOrder loopOrder
        endOrder waitAfter endPostDelay endLastPostDelay endAfterAction
        endSubAction bossSlotModes bossSlotOrder bossLoopOrder bossEndOrder
        bossWaitAfter supplyPicks innerWaits boardEarly boardLate non_boss boss
```

全局搜 `pipe` 只命中一个**注释**（`static/js/21-jobset-levels.js:100`），
指的是管道资源目录 `assets/resource/pipeline/`。

所以「pipe 字段要不要重构」应重新表述为：**运行时往管道注入这件事要不要重做**（答案：要，见 §4）。

---

## 1.1 现状数据流（重构前）

```
   ┌─ HTML 编辑器 ─────────────────────────────────┐
   │  真相: t.slotOrder/loopOrder/endOrder  段结构 │
   │        t.boardEarly / boardLate        棋盘   │
   └───────────────────────────────────────────────┘
                     │  jobBuild()  (27-jobset-board.js:2394)
                     ▼
   ┌─ 作业集 JSON ─────────────────────────────────┐
   │  boardEarly / boardLate   ← 真相（原样存）     │
   │  slotOrder/…              ← 真相（段结构）     │
   │  non_boss.sequence        ← 派生 ①            │
   │  non_boss.once_chain/…    ← 派生 ②            │
   │  non_boss.plant/feed/shd  ← 派生 ③            │
   └───────────────────────────────────────────────┘
                     │  engine.py Table._norm_rules()
                     ▼
   ┌─ 运行时 ──────────────────────────────────────┐
   │  dsl.py: chain_dsl()/generic_dsl()     【第二次编译】│
   │  runtime.py: _build_chain_nodes()      【第二次编译】│
   │  runtime.py: 9 个 override_pipeline 站点   │
   └───────────────────────────────────────────────┘
```

**实测印证"派生"关系**（`sequence` 条目数 == 棋盘格子数）：

```
code                      boardEarly items   sequence items
pvz_20260930_150606              49               49
pvz_20260926_235614              32               32
pvz_20260930_045245              23               23
（boardLate 同理：15/15、35/35、5/5）
```

> 三份视图全部可从 `board*` + `slotOrder` 重算，现在同时存在且可能不一致。

### 第二次编译其实有两份，其中一份是死代码

| 位置 | 函数 | 状态 |
| --- | --- | --- |
| `dsl.py:464` | `chain_dsl()` | **死代码**（只有 selfcheck 调） |
| `runtime.py:884` | `_build_chain_nodes()` | **唯一生产路径** |

两者有**完全相同的 if/elif**（`plant`/`feed`/`shovel` 起点选择）。
所以"消灭第二次编译"= 删掉 `dsl.py` 那份 + 让运行时不再拼。

---

## 2. `override_pipeline` 的语义陷阱（必须写进新设计）

| 字段 | 语义 | 后果 |
| --- | --- | --- |
| `next` | **整体替换** | 会顶掉 task option / 用户设置里的 `pipeline_override` |
| 其它字段 | **深合并** | 只改写的字段，其余保留 |

**已踩过的坑**（`runtime.py:694-707` 有血泪注释）：曾经覆盖
`无尽局内_继续挑战.next`，把训练模式的 `["无尽训练_继续训练"]` 顶掉 →
训练模式永远走不到。

> ★ **设计红线：不要覆盖管道里已经正确的内容。**

---

## 3. ★ 阶段 1：砍掉 OCR 识别（已实施）

### 3.1 为什么砍

OCR 读**数字**不稳（实测 `81→21`、`87→89`），于是旧版写了极复杂的
「融合/计分/惩罚」去兜它（`penalty=30`、自洽判断、锚点重同步…）。

但**关卡号根本不需要读屏幕**——它可以由「起始关卡 + 过关次数」推出来：

```
用户在 MAA option 填「起始关卡」
      ↓
点「继续挑战/继续训练」-> 计数器 +1
      ↓
进 boss 关 -> 对齐到最近的 5 的倍数（自愈）
```

### 3.2 为什么这样就可靠

关键在于：**剩下的两个判断都不是「读一个数」**

| 判断 | 方式 | 误差模型 |
| --- | --- | --- |
| 「本关是不是 boss 关」 | **头像模板匹配**（僵王的头/功夫僵王） | 是/否，可靠 |
| 「这一局结束了吗」 | **结算按钮匹配**（继续挑战/继续训练） | 是/否，可靠 |
| ~~「现在第几关」~~ | ~~数字 OCR~~ | ~~不稳，已砍~~ |

### 3.3 为什么不再需要重开

```
旧：局内 OCR 才发现该换表 → 阵容已定 → 只能重开 → 回局外换卡
新：局外由计数器已知关卡 → 开局前就知道该用哪张表 → 直接在局外换卡
```

**「提前知道」是消掉重开的原因。** 用户确认：局外换卡是支持的。

### 3.4 计数器挂载点：点「继续挑战/继续训练」之后

用户原话：

> 「看点击继续战斗/继续训练那一个地方，只要点了就必定是下一关了，
>   所以可以在后面加计数器，刚好重开也不会去点这个地方」

**这解决了一个旧版必须用 `rollback_one()` 手动修补的问题**：

- 旧版：重开后管道会**再识别一次天数** → 计数多推一格 → 必须退一格抵消
- 新版：重开走 `通用_重开_暂停`，**不经过「点继续挑战」** → 天然不误加
- **所以 `rollback_one()` 在正常流程中不再被调用**（保留为兼容垫片）

### 3.5 boss 关对齐 = 唯一的自愈机制

boss 关恒定出现在 5 的倍数关 → 每次进 boss 关都是一次校准。

```
计数器 56，进 boss 关 -> 就近取 5 -> 55
```

- 偏差 ≤ 2 能纠回正确值（`round` 就近取整）
- 偏差更大属于「起始关卡填错」，**用户明确表示这是用户的问题**，只记日志

**用户可见日志**（每次进 boss 关都输出，便于核对）：

```
boss关，当前关卡数：60
```

发生偏移时多一行：

```
boss关，当前关卡数：55
检测到关卡数有误，已自动偏移（53 → 55），boss关，当前关卡数：55
```

### 3.6 状态行刷新时机：识别到「开始战斗」

用户要求：**在选卡界面点击开始的时候刷新**。

```
继续挑战 → 计数器+1 → 局外换卡 → 回到选卡界面
   → ★ 识别到「开始战斗」→ 打印状态行 → 进局内
```

**为什么选这个时机（而不是每次 +1 就刷）**：
点「开始战斗」= 这一局即将开打，此刻关卡/表/阵容**全都定下来了**。
而「+1 那一刻」还在结算画面，接下来还要换卡，刷出来马上过期。

**挂在「识别到」而不是「点击后」**：点击可能带重试/延迟，时机不稳。

状态行格式：

```
📋 当前关卡: 87    当前表: 表2 (50~100)    本关: 普通关
```

> 附带好处：它**天然覆盖「换卡」** —— 换错了在进局内**之前**就能发现，
> 正好补上砍掉 OCR 后失去的那部分自检能力。

### 3.7 实施清单（已完成）

| 文件 | 改动 |
| --- | --- |
| `agent/jobset/level_tracker.py` | **重写**：只留计数器 + boss 对齐 + 日志。删 `_ocr_self_consistent` / `DEFAULT_INIT_SCORE` / `DEFAULT_PENALTY` / 全部得分期望；`observe()` 降级为兼容垫片（忽略 raw）|
| `agent/jobset/runtime.py` | 新增 `JobSetTick`（计数器 +1）、`JobSetStatus`（状态行）；`JobSetStage` **去掉 OCR**（`_recognize` 不再被调用）、去掉换阵容时的 `rollback_one`、去掉「重开」调用；`JobSetLoad` 起始关卡不再走 `observe` |
| `03_Endless_fight/0300Endless_fight.json` | 新增 `无尽局内_过关计数` 节点；`无尽局内_继续挑战` / `无尽训练_继续训练` 的 `next` 改为先过计数节点 |
| `02_Endless_plant_Choose_ref.json` | 新增 `无尽挑战_状态刷新` 节点；`无尽挑战_识别开始战斗.next` 指向它 |
| `agent/jobset/selfcheck.py` | 第 4–7 节**重写**为计数器语义（起始关卡/tick/boss 对齐/日志/状态行/参数解析）|
| `assets/resource/task/Endless/framework/frame/option.json` | 新增 option「无尽_起始关卡」 |

### 3.7.1 MAA option：起始关卡（用户已配好输入框，我补上接线）

用户给的 option 骨架**缺 `pipeline_override`** —— 没有它，值不会流到任何地方。
另外 `verify: "^.{1,149}$"` 是**任意字符**匹配（1~149 个字符），不是数字范围。

已改为：

```jsonc
"无尽_起始关卡": {
    "type": "input",
    "label": "起始关卡（当前正在打的这一关）",
    "inputs": [{
        "name": "起始关卡",
        "pipeline_type": "int",
        "default": "",
        "verify": "^([1-9]|[1-9][0-9]|1[0-4][0-9])$",   // ★ 真正的 1-149
        "pattern_msg": "请输入 1-149 之间的整数"
    }],
    "pipeline_override": {                              // ★ 缺这个就白配
        "无尽挑战_加载作业集代码": {
            "custom_action_param": {
                "重置": true,
                "起始关卡": "{起始关卡}"
            }
        }
    }
}
```

**不要搭哪里**：`JobSetLoad`（`01_Endless_plant_ref.json:7`）本来就已存在，
option 只是把值填进它的 `custom_action_param`，**不需要新增节点**。

**运行时的防御**（`from_params`）：三种「没填」都会安全回落到 0（计数器从 0 起）
而不是崩 —— 缺键 / 空串 / **占位符 `{起始关卡}` 没被替换**（option 未应用时
MAA 会原样传进来）。越界（0 / 负数 / >149 / 非数字）也一律当没填。

### 3.8 阶段 1 验证结果

```
selfcheck.py                       →  全部通过（含新增计数器 20+ 条断言）
check_resource.py assets/resource  →  All directories checked
check_graph.py                     →  仅 6 个预存在空壳告警，**无新增悬挂引用**
```

---

## 4. ★ 决策点（已定案）

### 决策点 1：新作业集存什么 —— **保留段结构，另加 compiled 块**

- **段结构 / 棋盘仍是真相**（作业集必须保持可编辑，HTML 要能读旧格式并提示转换）
- **`compiled` 是额外的、可选的编译产物**
- **不采用「只存 DSL」**：DSL 有损（`click:格子2_3` 无法反推是「点击格子」还是
  「喂豆缺起点」，也丢了 `seq`/`mode`），会导致作业集不可再编辑

### 决策点 2：「pipe」= 运行时注入 —— **保留但收敛**

9 个注入站点收敛为「一张声明式覆盖表」。管道文件本身（`assets/resource/pipeline/`）**不动**。

### 决策点 3：编译粒度 —— **B（编译到节点）**

`compiled` 存**节点名 → 要盖的字段**，运行时 `override_pipeline(compiled)` 零翻译。

**排除 `无尽局内_继续挑战`**（用户已同意）—— 避免顶掉训练模式设置。

**留在运行时的**（跨表/跨任务，编译不了）：

| 项 | 为什么编译不了 |
| --- | --- |
| 编队注入（4 处时机） | 依赖 `Table.squad`，且**切表时要重注入** |
| 补给注入 | 同上；且用户明确要求「custom 不抢 `enabled`」 |
| 关卡计数 / 换阵判定 | 依赖运行时状态 |
| 选卡植物注入 | 与 4 个写入者的冲突要一并治理 |

### 决策点 4：新旧共存 —— **顶层 `format` 字段 + 提示转换**

- 判据：顶层 `format: 2`（老作业集没有此字段 → v1）
- **提示用户确认后才转换**，另存为新文件，保留原件
- 转换器**复用现有编译逻辑**（不第三次重写）

---

## 5. ★ 盖的顺序（用户已同意）

```
1) compiled      先盖（HTML 算好的静态部分）
2) 编队 / 补给 / 选卡   后盖（动态部分，后盖的赢）
```

**为什么顺序重要**：`无尽挑战_选取植物.custom_action_param` 现在有
**4 个写入者**（B=JobSetLoad 预测表 / D=首次锁表 / E=换阵容 / I=_apply_table），
「最后写的赢」。顺序不钉死会出现「HTML 算的植物列表被运行时的预测表盖掉」。

---

## 6. 已知问题清单（重构时一并处理）

### 6.1 数据丢失 bug（现存，真实）

| # | 字段 | 现象 |
| --- | --- | --- |
| 1 | `non_boss.loop` / `.once` | 导出但**加载时从不还原** → 重载变回 `false` |
| 2 | `non_boss.wave` / `boss.wave` | 同上 → 点波开关重载后丢失 |
| 3 | `innerWaits` | 导出但**全 UI 无处可写** |
| 4 | `waitAfter` / `bossWaitAfter` | UI 无入口写 key → 运行时 `waits[]` 恒为 0<br>（`engine.py:334-381` 那 50 行「动作后等待」**从未被执行过**）|

### 6.2 多人抢同一字段（现存）

| 字段 | 写入者 | 风险 |
| --- | --- | --- |
| `无尽挑战_选取植物.custom_action_param` | B/D/E/I（4 个）| 最后写的赢；重开时 B 用预测表覆盖 |
| `无尽局内_单次/循环种植.custom_action_param` | H 写 `关卡`，F 随后写 `{}` | **H 的写入被当场抹掉** |
| `无尽局内_单次/循环种植`（6 字段） | C（boss 短路）与 F 各硬编码一遍 | 字段漂移→boss 路径静默行为不同 |

### 6.3 死代码

| 位置 | 东西 | 状态 |
| --- | --- | --- |
| ~~`runtime.py`~~ | ~~`FIGHT_NODE_TPL` / `GA_NODE_TPL` 定义未用~~ | ✅ 已删（阶段 3） |
| ~~`runtime.py`~~ | ~~`_STATE["skip_detect"]` 声明未读写~~ | ✅ 已删（阶段 6） |
| ~~`runtime.py` 尾部~~ | ~~`JobSetArmSkip` / `JobSetSkipCheck` 注释残留~~ | ✅ 已删（阶段 6） |
| ~~`runtime.py` JobSetStage~~ | ~~`_recognize`/`_parse_day`/`_extract_text`/`DEFAULT_ROI`（OCR 死代码）~~ | ✅ 已删（阶段 6） |
| ~~`dsl.py:383-632`~~ | ~~`plant_dsl`/`simple_dsl`/`chain_dsl`/`rules_dsl`/`sequence_dsl` 生产路径不用~~ | ✅ 已删（阶段 6）；`report.py` 改走 `compile.build_fight_override`（打的是真编译产物），feed/shovel 缺起点告警并入真编译器 |
| ~~`engine.py`~~ | ~~`plant`/`feed`/`shovel`/`wave`/`once`/`loop` 未使用~~ | ✅ 已删（阶段 6）：`_norm_rules` 只留 `sequence`（report.py 用）+ 三条链 |
| ~~作业集~~ | ~~`innerWaits`、`bossEndOrder`、`boss.end_chain` 无消费者~~ | ✅ 已删（阶段 6）：HTML 不再导出（innerWaits 全删；boss 收尾链永不执行故不导出），载入侧兼容旧文件 |
| ~~pipeline~~ | ~~`确认阶段_*` 节点里的 `识别roi`/`识别节点` 死参数~~ | ✅ 已删（阶段 6）；`局内识别天数`/`局内过滤文字颜色` 节点已不存在 |

---

## 7. 阶段 2–5 实施记录（已完成，2026-10-02）

### 阶段 2：compiled 格式草稿

用真实作业集（`pvz_20260930_150606`）手工推演了 compiled 该长什么样。
格式定案（粒度 B）：

```jsonc
{
  "format": 2,
  "tables": [{
    // ……现有字段原样保留（权威源，编辑器载入用）
    "compiled": {
      "normal": { /* 完整 override 字典：节点名 -> 要盖的字段 */ },
      "boss":   { /* 同上；未配置 boss 时是短路形态（等结算） */ }
    }
  }]
}
```

### 阶段 3：保存时预编译

| 文件 | 改动 |
| --- | --- |
| `agent/jobset/compile.py` | **新建**。纯函数编译器（无 maa 依赖）：`build_chain_nodes`（链->DSL）+ `build_fight_override`（表×变体 -> 完整 override 字典）+ `compile_jobset`（整份作业集 -> format:2）。链节点名/ref 触发/槽位白名单等常量全部搬入 |
| `game_assist_tools/endless_setup/pvz.py` | `/save_job` 落盘前调 `compile_jobset`；编译失败报错且不保存。另加：静态资源禁缓存头 + 端口占用守卫（见 §9） |
| `agent/jobset/runtime.py` | `JobSetFight.run` 改为优先 `compiled`，旧格式回退共享编译器；删 ~240 行装配代码 |

**为什么编译在 pvz.py 而不是浏览器 JS**：DSL 语法（swipe/click/sleep/every/ref/@）
的规则全在 Python `dsl.py`，移植 JS 必然漂移。「HTML 一次编译好」=
存进文件的 JSON 一次到位，不要求在浏览器里算。

### 阶段 4：等价比对 + 实跑验证

- **静态等价**：`compile_jobset` 输出与运行时旧装配逻辑**逐字节一致**（真实作业集，4 个变体全对）
- **实跑验证**：日志出现 `使用预编译 compiled（normal 变体，6 个节点）`，普通关 + boss 关行为正常

### 阶段 5：删回退路径

`JobSetFight` 不再现编译：没有 `compiled` 块的作业集**明确报错**
（"请用编辑器重新保存一次"），不再静默回退。
顺手修的潜伏 bug：`everyN` 原来误读表级字段（恒为 None -> 恒为 10），
HTML 导出在作业集顶层，现在编译器按顶层读，「高级设置-识别结算速率」真正生效。

---

## 8. 环境提醒

- 改 Python 后**必须完全重启 MAA/Agent 进程**（模块只在启动时 import 一次）
- 改 pipeline 后用 `check_resource.py` / `reload`
- `check_graph.py` 退出码为 1（有问题时 `sys.exit`），属预期
- 用户会**自己在 MAA option 界面**加「起始关卡」输入框（运行时不关心它从哪来）

---

## 9. ★ 端口僵尸事故（2026-10-02，值得记录）

**症状**：改了 pvz.py 后用户反复"重启"pvz.bat、反复保存，作业集始终没有 compiled 块。

**根因**：Werkzeug 开发服务器默认 SO_REUSEADDR，**Windows 上这允许多进程绑同一端口**。
一个昨天启动的旧服务器进程一直占着 5000；之后每次启动的新实例都显示
"Running on http://127.0.0.1:5000"，但**请求全被旧进程吃掉**（路由给最先绑定者）。
flask.log 每次被新实例截断，所以日志里永远只有启动行、没有请求行。

**修复**：
1. `pvz.py` 启动前 `_ensure_port_free()`：用**不带** SO_REUSEADDR 的裸 bind 试占，
   失败就打印排查方法并 `sys.exit(2)` —— 假启动从此不可能。
2. 排查命令：`netstat -ano | findstr :5000`（看是否有多个 PID 绑同一端口）。

**教训**：`Get-NetTCPConnection` 在某些沙箱/权限下会**漏报**监听 socket；
`netstat -ano` 才是可靠来源。
