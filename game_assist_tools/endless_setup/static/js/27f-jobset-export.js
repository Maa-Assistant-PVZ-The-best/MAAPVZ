// 27f-jobset-export.js —— 原 27-jobset-board.js 第 3517~4026 行：导出 jobBuild / jobSave / 元信息
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。

function jobBuildChain(t, board, which, forceBoss) {
    const out = [];
    if (!t || !board) return out;
    jobEnsureSeq(board);
    // ★ 传入 board：让 jobGetChainOrder 的覆盖率修复用**正确的棋盘**
    //   （导出 boss 链时要用 bossBoard，不能靠 tab 猜）
    // ★ forceBoss：导出 boss 链必须显式传 true —— bossBoard 取的是
    //   t.boardLate（表自己的 boss 棋盘），它的引用不等于全局 boardLate
    //   （全局那份是当前编辑表的拷贝），靠 === 判断会误判成普通关，
    //   结果读了 t.loopOrder，把普通关的通用动作串进 boss 关。
    const segs = jobGetChainOrder(t, which, board, forceBoss);

    // ★ 防御：孤立 noint 段不进「」（无间隔组至少 2 步，相邻同标记才算同组）
    for (let _i = 0; _i < segs.length; _i++) {
        const _s = segs[_i];
        if (!_s || _s.noint !== true) continue;
        const _p = segs[_i - 1], _n = segs[_i + 1];
        if (!((_p && _p.noint === true) || (_n && _n.noint === true))) delete _s.noint;
    }

    segs.forEach(function (seg) {
        // ★ 通用动作段（点波/捡豆/加速/等待）：没有格子，直接按"动作"导出
        const ga = jobGenericActionOfKey(seg.key);
        if (ga) {
            const item = {
                key: seg.key,           // 'ga:wave' 等
                slot: null,
                type: 'action',         // 通用动作
                action: ga.id,          // wave | bean | speed | wait
                label: ga.name,         // 点波 / 捡豆 / 加速 / 等待
                mode: (which === 'loop') ? 'loop' : (which === 'end' ? 'end' : 'once'),
                cells: []               // 无落点
            };
            // ★ 等待必须带上毫秒数 —— agent 端用 generic_dsl(action, coords, ms)
            //   编译成 sleep:N，没有 ms 就退化成默认值，作者设的时长会丢。
            if (ga.hasMs) {
                item.ms = (seg.ms === undefined || seg.ms === null)
                    ? (ga.defaultMs || 1000) : Number(seg.ms);
            }
            // ★ 带参数的通用动作：把声明的参数逐个带上（声明式 ——
            //   动作定义里加一个参数，这里自动导出，不需要改这段）。
            //   agent 端 dsl.generic_dsl 用它们编译出实际的 DSL。
            jobActionParams(ga).forEach(function (p) {
                const v = jobParamValue(seg, p);
                if (v !== undefined && v !== null) item[p.key] = v;
            });
            // ★ 自定义动作：不走 params 声明，act/from/to/pairs/ms 整袋带上
            //   （agent 端 generic_dsl 的 'custom' 分支按 act 编译）。
            if (ga.id === 'custom') {
                jobCopyCustomFields(seg, item);
                if (seg.ms !== undefined && seg.ms !== null) item.ms = Number(seg.ms);
            }
            // ★ 使用神器：快照字段（artName/artType/artBody）整袋带上 ——
            //   丢了它们 agent 端会退化成纯 click:神器位置（不点体型）。
            if (ga.id === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                jobCopyArtifactFields(seg, item);
            }
            // ★ 无间隔组「」标记：compile.py 把连续 noint 段合进一个「」块
            if (seg.noint === true) item.noint = true;
            // ★ 点击类动作的连击次数（点波/捡豆/加速/自定义点击；切换形态走 params 已带）
            if (item.times === undefined && Number(seg.times) > 1) item.times = Number(seg.times);
            // ★ 连击间隔（ms，>0 才导出，默认 0）
            if (Number(seg.comboMs) > 0) item.comboMs = Number(seg.comboMs);
            // ★ 连击参与识别（默认开不导出；false = 原子连击）
            if (seg.comboWatch === false) item.comboWatch = false;
            out.push(item);
            return;
        }
        // 该段实际包含的落点（已按 seq 排序，且同一槽内保持落子先后）
        const places = jobSegPlacements(board, seg, which);
        if (!places.length) return;
        // 该段是「单次」还是「循环」或「收尾」形态的落子 —— 由 which 决定
        const mode = (which === 'loop') ? 'loop' : (which === 'end' ? 'end' : 'once');
        const m = /^card(\d+)$/.exec(seg.key);
        const slot = m ? Number(m[1]) : null;

        // 植物槽要带上「这一段用的是哪个植物」（槽位植物表 + 段所属形态）
        //   ★ boss 链按 boss 有效槽位取名（逐槽沿用普通关），agent 日志里看到的才是实际选的卡
        let label = seg.key;
        if (slot !== null) {
            label = (typeof jobSlotNameCtx === 'function')
                ? (jobSlotNameCtx(t, slot, forceBoss === true) || seg.key)
                : ((t.slots && t.slots[slot]) ? t.slots[slot] : seg.key);
        }

        // ★ type 决定 agent 端怎么编译这段。落子动作的 type 由注册表给
        //   （dslType）：tap -> click:格子 / feed、shovel -> swipe:起点,格子
        const _act = (typeof jobBoardActionOfKey === 'function')
            ? jobBoardActionOfKey(seg.key) : null;
        let type;
        if (_act) {
            type = _act.dslType || _act.id;
            if (!label || label === seg.key) label = _act.name;
        } else if (seg.key === 'feed') {
            type = 'feed'; label = '喂豆';       // 注册表未加载时的兼容兜底
        } else if (seg.key === 'shovel') {
            type = 'shovel'; label = '铲子';
        } else {
            type = 'plant';
        }

        const item = {
            key: seg.key,
            slot: slot,                 // 植物槽号；落子动作为 null
            type: type,                 // plant | feed | shovel | tap | ...
            label: label,
            mode: mode,                 // once | loop
            cells: places.map(function (p) { return '格子' + (p.c + 1) + '_' + (p.r + 1); })
        };
        // ★ 无间隔组「」标记：compile.py 把连续 noint 段合进一个「」块
        if (seg.noint === true) item.noint = true;
        // ★ 点击格子的连击次数 / 连击间隔 / 参与识别
        if (Number(seg.times) > 1) item.times = Number(seg.times);
        if (Number(seg.comboMs) > 0) item.comboMs = Number(seg.comboMs);
        if (seg.comboWatch === false) item.comboWatch = false;
        out.push(item);
    });

    return out;
}

// 兼容保留：展平成 [{slot,order,type,label,cell}] 形式（旧字段 sequence 用）。
// 顺序 = 单次链在前、循环链在后，与运行时「先单次、再循环」一致。
function jobExtractSequence(board, slots, t) {
    const out = [];
    if (!board || !t) return out;
    const chains = [
        { which: 'once', list: jobBuildChain(t, board, 'once') },
        { which: 'loop', list: jobBuildChain(t, board, 'loop') }
    ];
    chains.forEach(function (ch) {
        ch.list.forEach(function (seg) {
            seg.cells.forEach(function (cell, i) {
                out.push({
                    slot: seg.slot,
                    order: i + 1,
                    type: seg.type,
                    label: seg.label,
                    cell: cell,
                    mode: seg.mode
                });
            });
        });
    });
    return out;
}

// ---- 导出 / 保存 ----
function jobExtractPlantOps(board, slots) {
    const bySlot = {};
    if (!board) return [];
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                const m = item.id && /^(card|patch_slot)(\d+)$/.exec(item.id);
                if (!m) return;
                const slot = m[2];
                const cell = `格子${c + 1}_${r + 1}`;
                if (!bySlot[slot]) bySlot[slot] = [];
                bySlot[slot].push(cell);
            });
        }
    }
    return Object.keys(bySlot).map(slot => ({ slot, cells: bySlot[slot] }));
}

function jobExtractCells(board, itemId) {
    const out = [];
    if (!board) return out;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                if (item.id === itemId) out.push(`格子${c + 1}_${r + 1}`);
            });
        }
    }
    return out;
}

function jobSlotPlants(slots) {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(i => slots[i]).filter(Boolean);
}

function jobBuild() {
    jobSaveCurrentBoard();
    const tables = jobTables.map((t, ti) => {
        // ★ boss 链永远用**本表自己的** boardLate 构建。
        //   以前有 inheritBoss：为 true 时拿上一张表的棋盘来建链 ——
        //   但它在编辑器里没有任何开关、也不随 JSON 持久化，
        //   导致「表2 的 boss 落子改了却按表1 导出」（静默丢配置）。
        const bossBoard = t.boardLate;
        const plants = jobSlotPlants(t.slots);
        // ---- boss 关阵容（有效值导出）--------------------------------------
        // bossLineupMode=''（沿用普通关）-> boss_lineup 与普通关完全一致，
        //   运行时签名相同 -> boss 关跳过清空/选卡直接开打；
        // 'plants' -> 逐槽求值后的完整槽位（bossSlots 三态覆盖层：覆盖用覆盖值、
        //   已删除的槽直接不进列表、其余沿用普通关）；
        // 'deck'   -> boss 关切到指定编队。
        const _bMode = t.bossLineupMode || '';
        const _bArt = (t.bossArtifact !== undefined && t.bossArtifact !== null) ? t.bossArtifact : (t.artifact || null);
        let bossLineup, bossSquad;
        if (_bMode === 'deck') {
            bossLineup = { plants: [], deck: String(t.bossDeckNo || 1), artifact: _bArt };
            bossSquad = Math.min(6, Math.max(1, Number(t.bossDeckNo) || 1));
        } else if (_bMode === 'plants') {
            const bp = [1, 2, 3, 4, 5, 6, 7, 8]
                .map(i => jobSlotNameCtx(t, i, true))   // 三态求值：已删除 -> '' -> 被过滤
                .filter(Boolean);
            bossLineup = { plants: bp, deck: null, artifact: _bArt };
            bossSquad = null;
        } else {
            // 沿用普通关
            bossLineup = (t.lineupMode === 'deck')
                ? { plants: [], deck: String(t.deckNo), artifact: _bArt }
                : { plants: plants.slice(), deck: null, artifact: _bArt };
            bossSquad = (t.lineupMode === 'deck' && t.deckNo) ? Number(t.deckNo) : null;
        }
        jobNormalizeCover(t);
        // from_level/to_level 退化为「仅供参考」的派生值（最小关/最大关+1）：
        //   运行时的权威覆盖字段是 levels（图层模型，见 20/34）。
        const _lv0 = t.levels.length ? t.levels[0] : 1;
        const _lv1 = t.levels.length ? (t.levels[t.levels.length - 1] + 1) : null;
        return {
            from_level: _lv0,
            to_level: _lv1,
            label: String(t.label || ''),
            // ★ 关卡覆盖（图层模型）：levels 是权威字段；cover 是编辑器状态（读回用）
            levels: t.levels.slice(),
            cover: JSON.parse(JSON.stringify(t.cover)),
            lineup: t.lineupMode === 'deck'
                ? { plants: [], deck: String(t.deckNo), artifact: (t.artifact || null) }
                : { plants, deck: null, artifact: (t.artifact || null) },
            boss_lineup: bossLineup,
            slots: { ...t.slots },

            // ★ 编队切换：lineupMode='deck' 时把编队号写进 squad（1..6）。
            //   运行时（agent/jobset/runtime.py 的 _inject_squad）读到后：
            //     · 「清空卡牌」的 next 改成「无尽挑战_切换编队」
            //     · custom 节点「无尽_选择编队」的 custom_action_param.目标编队
            //       改成这个数字（2026-10-23 起：SelectPlants 编队选择闭环模式）
            //   于是「选卡」整段被跳过，直接切编队开打。
            //   'plants' 模式写 null，让运行时把上面两个字段还原（避免残留）。
            squad: (t.lineupMode === 'deck' && t.deckNo) ? Number(t.deckNo) : null,
            // boss 关编队（bossLineupMode='deck' 时为 1..6；否则 null = 跟随普通关）
            boss_squad: bossSquad,

            // ---- boss 关阵容的编辑器状态（读回用；boss_lineup 是运行时的有效值）----
            bossLineupMode: _bMode,
            bossDeckNo: (typeof t.bossDeckNo === 'number' ? t.bossDeckNo : 1),
            bossSlots: Object.assign({}, t.bossSlots || {}),
            // 神器：zh 名 + 英文名（运行时据此覆盖「无尽挑战_神器」的 template）+
            //   特殊类体型（葫芦：small/mid/big）。
            //   en 在导出时从神器列表现查 —— 改名/加新神器不用动 agent。
            artifact: (t.artifact || null),
            artifact_en: (function () {
                if (!t.artifact || typeof jobArtifactOf !== 'function') return null;
                const _a = jobArtifactOf(t.artifact);
                return _a ? (_a.en || null) : null;
            })(),
            artifact_body: (t.artifactBody || null),
            bossArtifact: (t.bossArtifact !== undefined ? t.bossArtifact : null),
            boss_artifact_en: (function () {
                // ★ 与 boss_lineup.artifact 同源（有效值）：沿用普通关时
                //   也要解析出普通关神器的 en，否则 engine 走 boss 分支拿到空 en
                //   -> 报「没有英文名」选神器整段跳过。
                const _ba = _bArt;
                if (!_ba || typeof jobArtifactOf !== 'function') return null;
                const _a = jobArtifactOf(_ba);
                return _a ? (_a.en || null) : null;
            })(),
            boss_artifact_body: (t.bossArtifactBody || null),

            // ---- 编辑器状态（新版）：形态 / 两条链顺序 / 等待节点 ----
            // 这些字段以前没导出，导致保存后再载入「槽位形态、循环链、延迟设置」全丢
            // ★ 普通关与 boss 关**各自独立**（除槽位植物外）
            slotModes: Object.assign({}, t.slotModes || {}),
            slotOrder: Array.isArray(t.slotOrder) ? t.slotOrder.slice() : null,
            loopOrder: Array.isArray(t.loopOrder) ? t.loopOrder.slice() : null,
            endOrder: Array.isArray(t.endOrder) ? t.endOrder.slice() : null,
            waitAfter: Object.assign({}, t.waitAfter || {}),
            // 收尾参数（收尾链的可调项，网页端棋盘下侧可编辑；仅普通关有）
            endType: (t.endType === 'loops' ? 'loops' : 'detect'),
            endPostDelay: (typeof t.endPostDelay === 'number' ? t.endPostDelay : 15000),
            endLoopCount: (typeof t.endLoopCount === 'number' && t.endLoopCount >= 0 ? t.endLoopCount : 3),
            endAfterAction: ((t.endAfterAction === 'restart' || t.endAfterAction === 'settle') ? t.endAfterAction : 'sub'),
            endSettleMs: (typeof t.endSettleMs === 'number' ? t.endSettleMs : 15000),
            endSubAction: (t.endSubAction === 'once' || t.endSubAction === 'end' ? t.endSubAction : 'loop'),
            // boss 关配置：null = 未配置 -> 运行时 boss 关不做种植，只等结算
            // ★ bossEndOrder 不再导出：boss 关永不执行收尾链（运行时会忽略）。
            bossSlotModes: Object.assign({}, t.bossSlotModes || {}),
            bossSlotOrder: Array.isArray(t.bossSlotOrder) ? t.bossSlotOrder.slice() : null,
            bossLoopOrder: Array.isArray(t.bossLoopOrder) ? t.bossLoopOrder.slice() : null,
            bossWaitAfter: Object.assign({}, t.bossWaitAfter || {}),
            // 补给选取顺序（boss 关专属，每个阵容独立）
            supplyPicks: Array.isArray(t.supplyPicks)
                ? JSON.parse(JSON.stringify(t.supplyPicks)) : null,
            // （innerWaits 已移除：从未有过消费者，纯遗留字段）

            // ---- 棋盘本体（必须导出！否则保存后载入/切换作业集时阵容全丢）----
            boardEarly: JSON.parse(JSON.stringify(t.boardEarly || [])),
            boardLate: JSON.parse(JSON.stringify(t.boardLate || [])),

            // ---- ★ 预留接口字段（16-jobset-reserved.js，见 HANDOFF §10.10）----
            //   pre_battle   : 开局前额外动作 [{id, side, …参数}]（未消费）
            //   pick_favorite: 选卡同时标收藏（未消费）
            //   pick_tiers   : 选卡时自由切换阶数 {卡片号: 0..5}（未消费）
            //   ★ 现在导出**恒为默认值**（空/假/空表），因为还没有界面能改它们；
            //     先把「存得住 + 读得回」接好，将来实现功能时不用再动导出。
            ...(typeof jobReservedExport === 'function' ? jobReservedExport(t) : {}),

            non_boss: {
                plant: jobExtractPlantOps(t.boardEarly, t.slots),
                feed: jobExtractCells(t.boardEarly, 'feed'),
                shovel: jobExtractCells(t.boardEarly, 'shovel'),
                wave: t.waveEnabled === true,
                loop: t.loopPlant,
                once: t.oncePlant,
                // ★ 权威的三条链（顺序由 slotOrder / loopOrder / endOrder 决定）
                once_chain: jobBuildChain(t, t.boardEarly, 'once'),
                loop_chain: jobBuildChain(t, t.boardEarly, 'loop'),
                end_chain: jobBuildChain(t, t.boardEarly, 'end'),
                // 兼容旧字段：展平视图（单次链在前、循环链在后）
                sequence: jobExtractSequence(t.boardEarly, t.slots, t)
            },
            boss: {
                // ★ boss 的植物名映射用「boss 有效槽位表」（bossSlots 覆盖 + 普通关兜底）
                plant: jobExtractPlantOps(bossBoard, (typeof jobEffSlots === 'function') ? jobEffSlots(t, true) : t.slots),
                feed: jobExtractCells(bossBoard, 'feed'),
                shovel: jobExtractCells(bossBoard, 'shovel'),
                wave: t.waveEnabled === true,
                once_chain: jobBuildChain(t, bossBoard, 'once', true),
                loop_chain: jobBuildChain(t, bossBoard, 'loop', true),
                // ★ 不导出 end_chain：boss 关永不执行收尾链（运行时强制忽略）
                sequence: jobExtractSequence(bossBoard, (typeof jobEffSlots === 'function') ? jobEffSlots(t, true) : t.slots, t)
            }
        };
    });
    return {
        code: jobCurrentCode(),
        name: jobCurrentName(),
        version: '1.0',            // 版本不再让用户填，固定 1.0
        max_level: 149,            // 最大关卡固定 149
        // 选择世界：主适配世界 + 副世界（运行时 JobSetLoad 与 GUI「选择世界」比对告警）
        world: jobGetWorld(),
        sub_worlds: jobGetSubWorlds(),
        // 植物备注（阶数/挂件标注，仅展示；38-jobset-notes.js）
        plant_notes: (typeof jobGetPlantNotes === 'function') ? jobGetPlantNotes() : {},
        // 神器备注（阶数标注，2026-10-25；38-jobset-notes.js）
        artifact_notes: (typeof jobGetArtifactNotes === 'function') ? jobGetArtifactNotes() : {},
        // 标签（2026-10-26；41-jobset-tags.js）：本作业集适合的打法开关 / 账号档位，纯标注
        tags: (typeof jobGetTags === 'function') ? jobGetTags() : [],
        everyN: jobGetEveryN(),    // 识别结算速率（高级设置，作用于所有组合动作）
        // 调配参数（步骤 ⚙ 弹窗）：compile.py 的 swipe_ms。
        // （动作间隔固定 0.1s = BatchSwipe 默认，不导出、不可调）
        swipeMs: jobGetSwipeMs(),
        // 局外选卡（无尽局外 80 选，32-jobset-outer.js）：作业集级，与换阵无关
        //   plants = 有效选取顺序（阵容表锁定植物实时派生排前 + 手动点击顺序）；
        //   mode = auto/oneclick/confirm；一键选取/直接点确定 时局内不读列表 -> 导出空 plants
        outer_pick: (function () {
            if (typeof jobOuterPick === 'undefined') return { plants: [], mode: 'auto', order: [] };
            const m = jobOuterPick.mode || 'auto';
            const ps = (m === 'auto' && typeof jobOuterEffective === 'function')
                ? jobOuterEffective() : [];
            // order = 用户排过的完整序列（锁定/手动混排），重载后据此恢复位置
            return { plants: ps, mode: m, order: (m === 'auto') ? (jobOuterPick.order || []).slice() : [] };
        })(),
        // ★ 预留接口（作业集级，16-jobset-reserved.js / HANDOFF §10.10）：
        //   reserved_version / world_chains（按世界换阵容）/ mode_check（正赛检查）。
        //   现在恒为「未启用」；实现时才第一次真正写值。
        ...(typeof jobReservedTopExport === 'function' ? jobReservedTopExport() : {}),
        tables
    };
}

// 当前作业集的名字：输入框已移除，改由下拉里选中的项 / 本地缓存记录
let jobMeta = { code: '', name: '', everyN: 10 };

function jobCurrentName() { return (jobMeta.name || '').trim(); }

// 由名字推导一个「文件系统安全」的 code（后端要求仅字母数字_-）
// 中文名无法直接做文件名，所以：有中文/符号时用时间戳兜底，纯英文名则清洗后直接用
function jobCodeFromName(name) {
    const raw = (name || '').trim();
    if (!raw) return '';
    const ascii = raw.replace(/[^A-Za-z0-9_-]/g, '');
    if (ascii && /^[A-Za-z0-9_-]+$/.test(ascii) && ascii.length >= 2) return ascii;
    // 含中文等非 ASCII：用 pvz_ + 时间戳，保证唯一且合法
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return 'pvz_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
         + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function jobCurrentCode() {
    if (jobMeta.code) return jobMeta.code;
    return jobCodeFromName(jobMeta.name);
}

async function jobSave() {
    const msg = document.getElementById('jobStatus');
    // ★ 关卡覆盖校验（图层模型）：1-149 必须被铺满，没铺满不让保存
    {
        (jobTables || []).forEach(function (t) { jobNormalizeCover(t); });
        const uncovered = jobUncoveredLevels();
        if (uncovered.length) {
            window.alert(
                '⚠️ 关卡没有铺满：\n\n第 '
                + uncovered.slice(0, 30).join('、')
                + (uncovered.length > 30 ? ' …' : '')
                + ' 关（共 ' + uncovered.length + ' 关）没有任何阵容表覆盖。\n\n'
                + '请到「🗺 布局配置」里补齐后再保存。');
            jobOpenLayout();
            return;
        }
    }
    // 无尽局外选卡校验：「按列表自动选取」必须选够 80 个；
    // 不够就提示改用「一键选取」/「复用当前配置」（确认后仍可强制保存）
    if (typeof jobOuterPick !== 'undefined' && jobOuterPick.mode === 'auto') {
        const n = (typeof jobOuterEffective === 'function')
            ? jobOuterEffective().length : (jobOuterPick.plants || []).length;
        if (n < 80) {
            const go = window.confirm(
                '⚠️ 无尽局外选卡还没有选够 80 个（当前 ' + n + ' 个）。\n\n'
                + '局外 80 选卡是必配项：\n'
                + '· 在「局外选卡」里选够 80 个（可用「补齐空选」一键补满）\n'
                + '· 或把局内执行方式改成「一键选取」/「复用当前配置」\n\n'
                + '仍要保存吗？');
            if (!go) return;
        }
    }
    // 图片资源检查：阵容表植物缺局内图 / 局外已选植物缺局外图 —— 局内将永远选不到它
    {
        await jobLoadPlants();
        const missIn = [], missOut = [];
        (jobTables || []).forEach(function (t) {
            for (let s = 1; s <= 8; s++) {
                // 普通关槽位 + boss 关有效槽位（覆盖层逐槽沿用普通关）都要查
                const names = [t && t.slots ? t.slots[s] : ''];
                if (typeof jobSlotNameCtx === 'function') names.push(jobSlotNameCtx(t, s, true));
                names.forEach(function (n) {
                    if (!n) return;
                    const p = (typeof jobFindPlant === 'function') ? jobFindPlant(n) : null;
                    if ((!p || p.has_img === false) && missIn.indexOf(n) === -1) missIn.push(n);
                });
            }
        });
        if (typeof jobOuterPick !== 'undefined' && jobOuterPick.mode === 'auto'
                && typeof jobOuterEffective === 'function') {
            jobOuterEffective().forEach(function (n) {
                const p = (typeof jobFindPlant === 'function') ? jobFindPlant(n) : null;
                if ((!p || p.has_img_endless === false) && missOut.indexOf(n) === -1) missOut.push(n);
            });
        }
        if (missIn.length || missOut.length) {
            const lines = [];
            missIn.forEach(function (n) { lines.push('· ' + n + ' —— 缺少局内图片资源'); });
            missOut.forEach(function (n) { lines.push('· ' + n + ' —— 缺少局外图片资源'); });
            const go = window.confirm(
                '⚠️ 以下植物缺少图片资源，局内将无法识别选取：\n\n'
                + lines.join('\n')
                + '\n\n确定保存？');
            if (!go) return;
        }
    }
    // 名字必填：保存前问用户
    let name = jobCurrentName();
    const input = window.prompt('为这个作业集取一个名字吧', name || '');
    if (input === null) return;               // 取消
    name = String(input).trim();
    if (!name) { if (msg) { msg.textContent = '❌ 名字不能为空'; msg.style.color = '#dc2626'; } return; }

    // 名字变了 → code 要跟着变（除非是已下载的远程作业集，它有自己的 code）
    if (name !== jobMeta.name) {
        jobMeta.name = name;
        jobMeta.code = jobCodeFromName(name);
    }
    const job = jobBuild();
    if (!job.code) { if (msg) { msg.textContent = '❌ 无法生成作业集代码'; msg.style.color = '#dc2626'; } return; }
    try {
        const res = await fetch('/save_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job)
        });
        const data = await res.json();
        if (msg) {
            msg.textContent = data.status === 'success' ? ('✅ 已保存「' + name + '」') : ('❌ ' + (data.msg || '保存失败'));
            msg.style.color = data.status === 'success' ? '#22a65e' : '#dc2626';
        }
        if (data.status === 'success') {
            await jobLoadList(job.code);          // 保存后加入下拉栏并选中
            await jobSetCurrent(job.code);        // 同时设为当前（供 agent 使用）
            jobSaveLocal();
        }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 保存失败：' + e; msg.style.color = '#dc2626'; }
    }
}

// 设为当前作业集（Endless_ref.json 的「使用本地作业集」据此读取）
async function jobSetCurrent(code) {
    try {
        await fetch('/set_current_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code || '' })
        });
    } catch (e) { console.warn('[jobset] 设为当前失败', e); }
}
