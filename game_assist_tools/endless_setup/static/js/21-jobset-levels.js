
// ============================================================
// 关卡覆盖：图层模型（详见 20-jobset-core.js）
//   旧的「区间关键帧」模式（jobRangeOfTable / jobRenumberTables /
//   jobSetBoundary）已撤掉 —— 覆盖关系改在「布局配置」弹窗里编辑
//   （34-jobset-layout.js），本文件只保留表单/标签/复制逻辑。
// ============================================================
const JOB_MAX_LEVEL = 149;

function jobFillForm() {
    const t = jobTables[currentTable];
    if (!t) return;

    // 补给选取是每个阵容独立的，切阵容时要重渲染
    try { jobRenderSupply(); } catch (e) {}

    const lm = document.getElementById('tfLineupMode');
    if (lm) lm.value = t.lineupMode;
    const dn = document.getElementById('tfDeckNo');
    if (dn) dn.value = t.deckNo;
    const dbx = document.getElementById('tfDeckBox');
    if (dbx) dbx.style.display = t.lineupMode === 'deck' ? 'inline-flex' : 'none';
    // boss 关阵容（沿用普通关 / 单独选卡 / 切换编队）—— 选项由槽位数据驱动
    const bdn = document.getElementById('tfBossDeckNo');
    if (bdn) bdn.value = t.bossDeckNo || 1;
    jobRefreshBossLineupUI();
}

// ============================================================
// ★「boss 关」阵容下拉：数据驱动重构（2026-10-03 第二轮）
//   读当前表两个棋盘的槽位植物数据（jobBossSlotsDiffer）：
//     · 一致   -> 显示「沿用普通关」+「切换编队」；
//     · 不一致 -> 显示「单独选卡」+「切换编队」（没有「沿用」——数据已经不一样了），
//                mode 自动落到 plants。
//   ★ 「切换编队」两种状态都给（2026-10-12）：换编队不需要改 boss 槽位 ——
//     同阵容（槽位完全一致）也要能选 boss 换编队，否则保存出来 mode=''
//     -> boss 关依旧走选卡。mode='deck' 本身也算「不一致」（见下）。
//   ★ 例外：mode='deck'（boss 切编队）本身就算「不一致」——
//     编队模式不需要槽位覆盖，若只按槽位判断会把已存的编队模式静默抹掉。
//     编队想退回沿用：先切「单独选卡」，槽位一致时会自动落回「沿用普通关」。
//   槽位每次增删覆盖都会经过 jobRenderSlots -> 这里，所以选项实时跟着变。
// ============================================================
function jobRefreshBossLineupUI() {
    const t = jobTables[currentTable];
    const sel = document.getElementById('tfBossLineupMode');
    if (!sel || !t) return;
    const differ = ((typeof jobBossSlotsDiffer === 'function') && jobBossSlotsDiffer(t))
        || t.bossLineupMode === 'deck';
    const state = differ ? 'differ' : 'same';
    // 选项集合只在状态变化时重建（不打断用户正在下拉的操作）
    if (sel.dataset.bossState !== state) {
        // ★ 「切换编队」两个状态都给：换编队不需要改 boss 槽位，
        //   同阵容（槽位完全一致）选 boss 换编队是合法需求。
        sel.innerHTML = differ
            ? '<option value="plants">单独选卡</option><option value="deck">切换编队</option>'
            : '<option value="">沿用普通关</option><option value="deck">切换编队</option>';
        sel.dataset.bossState = state;
    }
    if (!differ) {
        t.bossLineupMode = '';
    } else if (t.bossLineupMode !== 'deck') {
        t.bossLineupMode = 'plants';
    }
    sel.value = t.bossLineupMode;
    const lab = sel.closest('label');
    if (lab) {
        lab.setAttribute('data-tooltip', differ
            ? 'boss 关槽位与普通关不一致：单独选卡 = boss 关用自己的槽位重新选卡；切换编队 = boss 关切到指定编队（编队想退回沿用：先切「单独选卡」）'
            : '槽位沿用普通关（切换编队随时可选、不需要改槽位；到 boss 棋盘给某个槽换植物或点 ✕ 删除后，这里会多出「单独选卡」选项）');
    }
    const bdbx = document.getElementById('tfBossDeckBox');
    if (bdbx) bdbx.style.display = (t.bossLineupMode === 'deck') ? 'inline-flex' : 'none';
}

function jobSyncForm() {
    const t = jobTables[currentTable];
    if (!t) return;
    const lm = document.getElementById('tfLineupMode');
    if (lm) t.lineupMode = lm.value;
    const dn = document.getElementById('tfDeckNo');
    // ★ 编队号强制 1-6：pipe 那边的「切换编队序号」只认 1-6，
    //   越界的值会让 OCR 的 expected 永远匹配不上。
    if (dn) t.deckNo = Math.min(6, Math.max(1, parseInt(dn.value) || 1));
    // boss 关阵容（'' = 沿用普通关；选项集合由 jobRefreshBossLineupUI 按槽位数据驱动）
    const bm = document.getElementById('tfBossLineupMode');
    if (bm) t.bossLineupMode = (bm.value === 'plants' || bm.value === 'deck') ? bm.value : '';
    const bdn = document.getElementById('tfBossDeckNo');
    if (bdn) t.bossDeckNo = Math.min(6, Math.max(1, parseInt(bdn.value) || 1));
    jobRefreshBossLineupUI();   // 顺带校正 mode 合法性 + 编队号显隐
    jobRenderTabs();
}

// ============================================================
// ★ 图层模型下的「交换」= 两张表连同覆盖关系整体互换位置（层序对调）。
//   层序 = 优先级，覆盖是表自身的属性，随表走。
// ============================================================
function jobSwapTables(i, j) {
    if (i === j || !jobTables[i] || !jobTables[j]) return;
    jobSaveCurrentBoard();                       // 防御：当前编辑先落回表对象
    const tmp = jobTables[i];
    jobTables[i] = jobTables[j];
    jobTables[j] = tmp;
    jobLoadTable(currentTable, true);            // 当前位置内容变了，整页重载
    jobSaveLocal();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
    setStatus('🔀 已交换 ' + jobTableName(i) + ' ↔ ' + jobTableName(j) + '（含覆盖关系）');
}

// Q/E 循环切换阵容（在 jobInstallSlotHotkeys 里挂了按键，那里已做输入框/弹层守卫）
function jobCycleTable(dir) {
    const n = jobTables.length;
    if (n <= 1) return;
    const nxt = ((currentTable + dir) % n + n) % n;    // 首尾循环
    jobLoadTable(nxt);
    jobSaveLocal();
    setStatus('📑 ' + jobTableName(nxt));
}

// ★ 原来的 tab 条已撤掉，改成「当前表」文字标签（布局配置弹窗里切表）
function jobRenderTabs() {
    const box = document.getElementById('jobTableLabel');
    if (!box) return;
    const t = jobTables[currentTable];
    box.textContent = t ? (jobTableName(currentTable) + ' · ' + jobCoverText(t)) : '';
}

function jobFindPlant(name) {
    if (!name || !plantCache) return null;
    return plantCache.find(p => p.name === name) || null;
}

function placePlantOnBoard(board, slot, r, c) {
    const cellArr = board[r] && board[r][c];
    if (!cellArr) return false;
    const t0 = jobTables[currentTable];
    // ★ 落子动作（喂豆/铲子/点击格子/未来扩展）统一走注册表；
    //   不在注册表里的就是植物槽 cardN。
    const act = (typeof jobBoardActionByArmedNo === 'function')
        ? jobBoardActionByArmedNo(slot) : null;
    const key = act ? act.id : 'card' + slot;
    const mode = jobSlotMode(t0, key);          // 当前形态：单次 / 循环

    // ★★ 同格可以重复放 —— 所有动作、所有链都放开（用户明确要求）。
    //   以前这里有「循环形态同格限 1 个 / 单次形态限 12 个」的限制，
    //   导致喂豆和铲子无法像植物那样在同一格叠加。
    //   现在完全不去重、不设上限：放几个就几个，写进链里就是几个动作。
    //   ★ 唯一的例外：植物槽必须先在槽位面板里配了植物名才能落子。
    if (act) {
        saveBoardState();
        cellArr.push(jobBoardActionItem(act, mode, r, c, jobNextSeq(board, act.id, mode)));
        return true;
    }

    // ★ 按目标棋盘语境取植物名：落在 boss 棋盘（boardLate）用 boss 有效槽位
    //   （bossSlots 覆盖层，空槽沿用普通关），普通棋盘用普通关槽位。
    const _bossCtx = (typeof boardLate !== 'undefined' && board === boardLate);
    const name = t0 && ((typeof jobSlotNameCtx === 'function')
        ? jobSlotNameCtx(t0, slot, _bossCtx) : t0.slots[slot]);
    if (!name) return false;

    // ★★ boss 关「落子即固化」（2026-10-30 用户要求）：
    //   boss 棋盘上用植物 A 落了子之后，普通关把槽位换成 B，
    //   boss 关**必须仍然是 A** —— 不能被普通关带着变。
    //
    //   做法：落子这一刻把「沿用」升级成「显式覆盖」（值就是当下这株植物）。
    //   覆盖层的值先于普通关槽位，所以之后普通关怎么改都不影响这里。
    //   同一个槽后续再落子不会重复升级（已经是 override 就跳过）。
    if (_bossCtx && t0 && typeof jobBossSlotState === 'function'
            && jobBossSlotState(t0, slot) === 'inherit') {
        t0.bossSlots = t0.bossSlots || {};
        t0.bossSlots[slot] = name;
        // 语义变了要让人看得见（否则用户会以为还是"跟着普通关"）
        if (typeof setStatus === 'function') {
            setStatus('🔒 boss 关 槽' + slot + ' 已固化为「' + name + '」'
                + '：以后普通关换植物，boss 关不受影响');
        }
    }

    const info = jobFindPlant(name) || {};
    saveBoardState();
    cellArr.push({
        id: 'card' + slot,
        label: name,
        type: 'plant',
        mode: mode,                              // 落点形态：决定棋盘标记颜色与所属分区
        col: c + 1,
        row: r + 1,
        seq: jobNextSeq(board, 'card' + slot, mode),   // 单次/循环各自从 1 开始
        plant: { name: name, img: info.img || null, rare: (typeof info.rare === 'number' ? info.rare : 0) }
    });
    return true;
}

// (形态, 槽) 内下一个序号：单次与循环各自独立从 1 开始
function jobNextSeq(board, scopeId, mode) {
    let max = 0;
    if (!board) return 1;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(it => {
                if (it.id !== scopeId) return;
                if (jobItemMode(it) !== mode) return;   // 只看同形态
                if (typeof it.seq === 'number' && it.seq > max) max = it.seq;
            });
        }
    }
    return max + 1;
}

// ============================================================
// ★★ 改槽位植物后，把棋盘上该槽已有的落点**同步**成新植物。
//
//   为什么必须做：
//     落点对象里存的是「下子那一刻的植物快照」——
//       { id:'card3', label:'豌豆射手', plant:{ name:'豌豆射手', img:'..', rare:0 } }
//     其中 id（card3）只标明「属于哪个槽」，label / plant 才是显示出来的植物。
//
//     所以把槽3 从「豌豆射手」改成「坚果墙」时，棋盘上那些 card3 落点
//     仍然带着旧的 label/plant —— 界面上就表现为「改了槽位但棋盘没变」，
//     而且能同时看到好几种植物挤在同一个槽里（看起来像能放好几个植物）。
//
//   做法：遍历棋盘，把所有 id === 'card<N>' 的落点重写成新植物的名字/图片/稀有度。
//        喂豆(feed) / 铲子(shovel) 没有植物属性，跳过。
//        名字没变就什么都不写（返回 false），避免无谓的存档与重渲染。
//
//   返回 true = 确实改了内容（调用方需要保存并重渲染）。
// ============================================================
function jobSyncSlotPlantOnBoard(board, slot, name) {
    if (!board || !slot || slot === 9 || slot === 10) return false;
    if (!name) return false;

    const scopeId = 'card' + slot;
    const info = jobFindPlant(name) || {};
    const plant = {
        name: name,
        img: info.img || null,
        rare: (typeof info.rare === 'number' ? info.rare : 0)
    };

    let changed = false;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!Array.isArray(cell)) continue;
            cell.forEach(function (it) {
                if (!it || it.id !== scopeId) return;
                if (it.label === name
                    && it.plant
                    && it.plant.name === name
                    && it.plant.img === plant.img) return;   // 已经是新植物，不用动
                it.label = name;
                it.plant = { name: plant.name, img: plant.img, rare: plant.rare };
                changed = true;
            });
        }
    }
    return changed;
}

// ============================================================
// ★★ 改【普通关】槽位植物后的同步（2026-10-30 修正：只同步普通关棋盘）
//
//   旧做法把 boardEarly / boardLate **两块棋盘都改**，于是：
//     普通关槽3 用「豌豆」→ boss 关也用「豌豆」落了子
//     → 普通关把槽3 换成「坚果」→ **boss 关棋盘上的豌豆也被改成坚果**
//   这就是用户反馈的「boss 关植物和普通关分离不彻底」。
//
//   现在：
//     · boardEarly：正常同步（普通关就该跟着槽位走）；
//     · boardLate：**不动落点**。如果该槽在 boss 关还是「沿用」状态
//       且 boss 棋盘上已经有这个槽的落点，就把当下那株植物**固化成显式覆盖**，
//       这样 boss 关保持自己的植物，普通关怎么改都不影响它。
//       （已删除的槽 blocked 本来就没有落点，覆盖槽有自己的植物，都不用管。）
// ============================================================
function jobSyncNormalSlotPlant(slot, name) {
    let changed = false;
    try {
        if (typeof boardEarly !== 'undefined' && jobSyncSlotPlantOnBoard(boardEarly, slot, name)) changed = true;
    } catch (e) { }
    // boss 侧：固化成显式覆盖（值 = boss 棋盘上真正用的那株）
    try {
        const t = jobTables[currentTable];
        if (t && typeof jobBossSlotState === 'function' && jobBossSlotState(t, slot) === 'inherit'
                && typeof boardLate !== 'undefined' && boardLate) {
            const used = jobBossBoardPlantName(slot);
            if (used) {
                t.bossSlots = t.bossSlots || {};
                t.bossSlots[slot] = used;
                changed = true;
            }
        }
    } catch (e) { }
    return changed;
}

// boss 棋盘上某槽真正落着的植物名（取第一个落点的快照；没有落点返回 ''）
//   board 缺省 = 当前编辑的 boss 棋盘。复制阵容读的是「来源表的 boardLate」，
//   所以必须能显式传盘进来。
function jobBossBoardPlantName(slot, board) {
    const b = (board !== undefined && board !== null) ? board
        : ((typeof boardLate !== 'undefined') ? boardLate : null);
    if (!b) return '';
    const key = 'card' + slot;
    const modes = (typeof JOB_SLOT_MODES !== 'undefined') ? JOB_SLOT_MODES : ['once', 'loop', 'end'];
    for (let i = 0; i < modes.length; i++) {
        const list = jobPlacementsOf(b, key, modes[i]);
        for (let j = 0; j < list.length; j++) {
            const it = list[j].item;
            const n = (it && it.plant && it.plant.name) || (it && it.label) || '';
            if (n) return n;
        }
    }
    return '';
}

// ★ 把 boss 侧还处于「沿用」、但棋盘上已经有落点的槽，固化成显式覆盖。
//   用途：任何会让"普通关槽位"和"boss 棋盘落点"脱钩的操作（复制阵容 / 改名 / 清槽），
//   都先固化一下，boss 关就不会因为普通关变化而变成孤儿植物。
function jobFreezeBossInheritedSlots(t, board) {
    if (!t || typeof jobBossSlotState !== 'function') return 0;
    const b = (board !== undefined && board !== null) ? board
        : ((typeof boardLate !== 'undefined') ? boardLate : null);
    if (!b) return 0;
    let n = 0;
    for (let i = 1; i <= 8; i++) {
        if (jobBossSlotState(t, i) !== 'inherit') continue;
        const used = jobBossBoardPlantName(i, b);
        if (!used) continue;
        t.bossSlots = t.bossSlots || {};
        t.bossSlots[i] = used;
        n++;
    }
    return n;
}

// 兼容旧名（其它地方可能还会调）：语义已改成「普通关槽位改名」
function jobSyncSlotPlantEverywhere(slot, name) {
    return jobSyncNormalSlotPlant(slot, name);
}

// ============================================================
// 清空槽位时，把棋盘上该槽的落点一并删掉（两块棋盘都删）。
// 返回删除的落点总数。
// ============================================================

// 只清**指定一块**棋盘上某槽的落点 —— boss 槽位「删除沿用」时用，
// 不能动另一块棋盘（普通关该槽的植物还在）。
function jobPurgeSlotOnBoard(board, slot) {
    if (!board || !slot || slot === 9 || slot === 10) return 0;
    const scopeId = 'card' + slot;
    let removed = 0;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!Array.isArray(cell)) continue;
            const keep = cell.filter(function (it) {
                if (it && it.id === scopeId) { removed++; return false; }
                return true;
            });
            if (keep.length !== cell.length) board[r][c] = keep;
        }
    }
    return removed;
}

function jobPurgeSlotFromBoard(slot) {
    let removed = 0;
    try { removed += jobPurgeSlotOnBoard(typeof boardEarly !== 'undefined' ? boardEarly : null, slot); } catch (e) { }
    try { removed += jobPurgeSlotOnBoard(typeof boardLate !== 'undefined' ? boardLate : null, slot); } catch (e) { }
    return removed;
}

// ============================================================
// ★ 清空【普通关】槽位时该做什么（2026-10-30 分离修正 + 压实）
//   · 普通关棋盘上该槽的落点：删掉（槽位空了，孤儿落点没有意义）；
//   · boss 关棋盘：**不删**。boss 是独立配置，普通关清空不该带走它。
//     boss 侧凡是「沿用」且有落点的槽，一律就地固化成显式覆盖 ——
//     注意是**所有**这种槽，不只是被清的那个：清空会让后面的槽左移（压实），
//     槽号一变，"沿用"就会指到别的植物上，只有全部固化才能保证 boss 关一株不少。
//   返回普通关棋盘上删除的落点数。
// ============================================================
function jobClearNormalSlot(slot) {
    let removed = 0;
    try {
        removed = jobPurgeSlotOnBoard(typeof boardEarly !== 'undefined' ? boardEarly : null, slot);
    } catch (e) { }
    try {
        const t = jobTables[currentTable];
        if (t && typeof jobFreezeBossInheritedSlots === 'function') jobFreezeBossInheritedSlots(t);
    } catch (e) { }
    return removed;
}


// 保证棋盘上每个带内容项都有 seq（旧数据 / 本地缓存恢复时补齐），并返回“id@r,c -> seq”映射
function jobEnsureSeq(board) {
    if (!board) return;
    // 逐槽补齐：每个槽（card1..card8 / feed / shovel）各自从 1 开始编号
    const maxBy = {};
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(it => {
                if (typeof it.seq === 'number') {
                    maxBy[it.id] = Math.max(maxBy[it.id] || 0, it.seq);
                }
            });
        }
    }
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(it => {
                if (typeof it.seq !== 'number') {
                    maxBy[it.id] = (maxBy[it.id] || 0) + 1;
                    it.seq = maxBy[it.id];
                }
            });
        }
    }
    // 全局落子序号 ord：只用于「同一槽内 seq 相同时」的稳定排序兜底，
    // **不写进 JSON**（见 jobBuild）。跨槽的真实先后由 slotOrder/loopOrder 表达。
    jobEnsureOrd(board);
}

// 给棋盘上每个 chip 补一个全局递增的 ord（内存态，不持久化）。
// 目的：jobPlacementsOf 的排序在 seq 相同/缺失时仍能保持稳定。
function jobEnsureOrd(board) {
    if (!board) return;
    let next = 0;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(function (it) {
                if (typeof it.ord === 'number' && it.ord >= 0) {
                    next = Math.max(next, it.ord + 1);
                }
            });
        }
    }
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(function (it) {
                if (typeof it.ord !== 'number') { it.ord = next++; }
            });
        }
    }
}

// ============================================================
// 复制阵容：把另一张阵容表的**内容**深拷贝到当前表
//   拷贝：槽位/boss槽位/棋盘(普通+boss)/三条链/形态/等待/收尾参数/补给顺序/神器…
//   不拷：覆盖关系（cover/levels）与表名 —— 它们是「这张表自己的身份」
// ============================================================

// 阵容表摘要 —— 现在按「侧」分别显示，见下面的 jobCopySideSummary()。

// ============================================================
// 复制阵容：每张来源表两个复选框（普通关 / boss 关），可单勾可双勾
//
//   「普通关」= 槽位 / 三条链 / 普通关棋盘 / 收尾参数那一套
//   「boss 关」= boss 槽位覆盖层 / boss 两条链 / boss 棋盘 / 补给顺序
//   两个都勾 = 整表（内容全拷，表身份字段不拷）。
//   只勾一个 = 只拷该侧自己的字段，另一侧原样保留。
//
//   字段怎么切的（对着 jobNewTable 的字段表逐个归类）：
//     普通关：槽位/阵容下拉/编队号/普通关神器/三条链顺序/形态/动作后等待/
//             收尾参数/普通关棋盘/点波·单次·循环开关
//     boss 关：boss 槽位覆盖层/boss 阵容下拉/boss 编队号/boss 神器/
//             boss 两条链顺序/boss 形态/boss 等待/boss 棋盘/补给顺序
//
//   ★ 两个细节（不处理就会出"孤儿植物"）：
//     ① 只拷普通关：拷之前先把"boss 侧仍沿用、但棋盘上已有落点"的槽固化成覆盖，
//        否则目标表 boss 关的植物会跟着普通关槽位一起变。
//     ② 只拷 boss 关：来源表的 boss 侧可能是"沿用"（bossSlots 里没键），
//        拷完必须用**来源 boss 棋盘上的植物**把它固化成覆盖，
//        否则会按目标表的普通关槽位去解释这些落点（植物名对不上）。
// ============================================================
const JOB_COPY_NORMAL_FIELDS = [
    'lineupMode', 'deckNo', 'slots', 'artifact',
    'slotOrder', 'loopOrder', 'endOrder', 'slotModes', 'waitAfter',
    'endType', 'endPostDelay', 'endLoopCount', 'endAfterAction', 'endSettleMs', 'endSubAction',
    'boardEarly',
    'waveEnabled', 'loopPlant', 'oncePlant'
];
const JOB_COPY_BOSS_FIELDS = [
    'bossLineupMode', 'bossDeckNo', 'bossSlots', 'bossArtifact',
    'bossSlotOrder', 'bossLoopOrder', 'bossSlotModes', 'bossWaitAfter',
    'boardLate', 'supplyPicks'
];

// ★ 复制哪一侧 = **每张来源表各自两个复选框**（2026-10-30 用户要求改成多选框：
//   「选择表后再选择复制 boss 关 / 普通关，或者都复制」）。
//   两步走：① 点一张来源表（_jobCopyTarget）→ ② 勾选普通关 / boss 关 → 复制。
//   勾选状态按「来源表序号」分别记，互不影响；默认两个都勾。
const _jobCopySidesByTable = {};
let _jobCopyTarget = null;      // 第一步选中的来源表序号（null = 还在第一步）
function jobCopySidesOf(i) {
    if (!_jobCopySidesByTable[i]) _jobCopySidesByTable[i] = { normal: true, boss: true };
    return _jobCopySidesByTable[i];
}

// 复制过去：先深拷贝，再把 undefined 的键丢掉（保持"字段不存在"的语义）
function jobCopyFields(dst, src, fields) {
    (fields || []).forEach(function (k) {
        if (src[k] === undefined) { delete dst[k]; return; }
        dst[k] = JSON.parse(JSON.stringify(src[k]));
    });
}

// sides 支持三种写法：
//   {normal:true,boss:false} / 'normal' | 'boss' | 'all' / 不传（= 两侧都复制）
function jobCopyTableFrom(srcIdx, sides) {
    const cur = jobTables[currentTable];
    const src = jobTables[srcIdx];
    if (!cur || !src || srcIdx === currentTable) return;
    let sn = true, sb = true;
    if (sides === 'normal') { sn = true; sb = false; }
    else if (sides === 'boss') { sn = false; sb = true; }
    else if (sides === 'all') { sn = true; sb = true; }
    else if (sides && typeof sides === 'object') {
        sn = sides.normal !== false;
        sb = sides.boss !== false;
    }
    if (!sn && !sb) {
        setStatus('⚠️ 没有勾选要复制的内容（普通关 / boss 关 至少勾一个）');
        return;
    }
    // 当前棋盘正在编辑，先存回它所属的表（马上就要动它，只是保持数据惯例干净）
    jobSaveCurrentBoard();

    if (sn && sb) {
        // ---- 两侧都勾 = 整表（老行为）：内容全拷，表身份字段保留 ----
        const keepLabel = cur.label, keepCover = cur.cover, keepLevels = cur.levels;
        const keepColor = cur.colorIdx;          // ★ 颜色是表的身份，复制内容不复制色
        const keepColorHex = cur.color;          //   自定义调色盘颜色同理
        const keepIconP = cur.iconPlant, keepIconM = cur.iconMode;  // 头像同理
        const copy = JSON.parse(JSON.stringify(src));
        copy.label = keepLabel;
        copy.cover = keepCover;
        copy.levels = keepLevels;
        copy.colorIdx = keepColor;
        copy.color = keepColorHex;
        copy.iconPlant = keepIconP;
        copy.iconMode = keepIconM;
        jobTables[currentTable] = copy;
        jobLoadTable(currentTable, true);      // currentTable 没变但内容换了，skipSave 重载
        jobAfterCopyRender('📋 已把 ' + jobTableName(srcIdx) + ' 整表内容复制到当前表（覆盖关系与表名不变）');
        return;
    }

    let frozen = 0;
    if (sn) {
        // ① 先把目标表 boss 侧"沿用中的落点"固化（boss 不该被普通关带着变）
        frozen += jobFreezeBossInheritedSlots(cur);
        jobCopyFields(cur, src, JOB_COPY_NORMAL_FIELDS);
        if (!cur.slots) cur.slots = {};
        for (let i = 1; i <= 8; i++) if (cur.slots[i] === undefined) cur.slots[i] = '';
    }
    if (sb) {
        jobCopyFields(cur, src, JOB_COPY_BOSS_FIELDS);
        if (!cur.bossSlots || typeof cur.bossSlots !== 'object') cur.bossSlots = {};
        // ② 来源的"沿用"没有名字信息 —— 用来源 boss 棋盘上的植物固化
        frozen += jobFreezeBossInheritedSlots(cur, cur.boardLate);
    }

    jobLoadTable(currentTable, true);
    jobAfterCopyRender('📋 已把 ' + jobTableName(srcIdx) + ' 的「'
        + (sn && sb ? '普通关 + boss 关' : (sn ? '普通关' : 'boss 关')) + '」复制到当前表'
        + (frozen ? '（boss 槽位已独立固化 ' + frozen + ' 个，不会被另一侧带走）' : ''));
}

// 复制后的统一重绘 + 状态提示
function jobAfterCopyRender(msg) {
    jobRenderTabs();
    jobFillForm();
    jobRenderSlots();
    if (typeof jobRenderSeqChains === 'function') jobRenderSeqChains();
    if (typeof jobRenderEndParams === 'function') jobRenderEndParams();
    if (typeof jobRefreshBossLineupUI === 'function') jobRefreshBossLineupUI();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
    jobSaveLocal();
    if (msg) setStatus(msg);
}

function jobOpenTableCopy() {
    const modal = document.getElementById('tableCopyModal');
    if (!modal) return;
    _jobCopyTarget = null;          // 每次打开都从「第 1 步：选表」开始
    jobRenderTableCopy();
    modal.classList.add('jp-open');
}
function jobCloseTableCopy() {
    const modal = document.getElementById('tableCopyModal');
    if (modal) modal.classList.remove('jp-open');
}

// 某一侧的摘要（复选框中显示，让用户看清会搬什么）
function jobCopySideSummary(t, side) {
    const cnt = function (b) {
        let n = 0;
        (b || []).forEach(function (row) {
            (row || []).forEach(function (cell) { if (Array.isArray(cell)) n += cell.length; });
        });
        return n;
    };
    if (side === 'boss') {
        let bSlotN = 0;
        if (t && typeof jobBossSlotState === 'function') {
            for (let s = 1; s <= 8; s++) if (jobBossSlotState(t, s) === 'override') bSlotN++;
        }
        const supplyN = (t && Array.isArray(t.supplyPicks)) ? t.supplyPicks.length : 0;
        return '独立槽位 ' + bSlotN + ' 个 · 棋盘 ' + cnt(t && t.boardLate) + ' 株 · 补给 '
            + supplyN + ' 项 · 神器 ' + ((t && t.bossArtifact) || '无');
    }
    let slotN = 0;
    for (let s = 1; s <= 8; s++) if (t && t.slots && t.slots[s]) slotN++;
    return '槽位 ' + slotN + '/8 · 棋盘 ' + cnt(t && t.boardEarly) + ' 株 · 神器 '
        + ((t && t.artifact) || '无');
}

// 一张来源表的卡片（第一步：只负责"选中这张表"，点了才进第二步）
function jobBuildCopyCard(i) {
    const t = jobTables[i];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'jp-item';
    card.style.cssText = 'width:100%;display:block;text-align:left;cursor:pointer;'
        + 'border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;margin-bottom:8px;background:#fff;';
    card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
        + '<span style="font-size:13px;font-weight:700;color:#1e293b;">🌿 ' + jobTableName(i) + '</span>'
        + '<span style="font-size:10px;color:#94a3b8;">' + jobCoverText(t) + '</span>'
        + '<span style="margin-left:auto;font-size:11px;color:#2d7aff;">选这张 →</span>'
        + '</div>'
        + '<div style="font-size:10px;color:#64748b;margin-top:3px;line-height:1.5;">'
        + '普通关：' + jobCopySideSummary(t, 'normal')
        + '<br>boss 关：' + jobCopySideSummary(t, 'boss')
        + '</div>';
    card.addEventListener('click', function () {
        _jobCopyTarget = i;
        jobRenderTableCopy();          // 进第二步：选复制哪一侧
    });
    return card;
}

// 第二步：对选中的表勾选「普通关 / boss 关」（多选框），再点复制
function jobBuildCopySidesStep(i) {
    const t = jobTables[i];
    const st = jobCopySidesOf(i);
    const box = document.createElement('div');

    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '↩ 重选表';
    back.style.cssText = 'font-size:11px;padding:3px 10px;border:1px solid #cbd5e1;border-radius:7px;'
        + 'background:#fff;color:#475569;cursor:pointer;margin-bottom:8px;';
    back.addEventListener('click', function () {
        _jobCopyTarget = null;
        jobRenderTableCopy();
    });
    box.appendChild(back);

    const ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:13px;font-weight:700;color:#1e293b;margin-bottom:2px;';
    ttl.textContent = '从「' + jobTableName(i) + '」复制什么到当前表';
    box.appendChild(ttl);

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.5;';
    sub.textContent = '表的身份（覆盖关系、表名、色块、头像）永远不复制。';
    box.appendChild(sub);

    const mkRow = function (side, label, text) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;font-size:11px;color:#334155;'
            + 'line-height:1.55;cursor:pointer;margin-bottom:5px;border:1px solid '
            + (st[side] ? '#2d7aff' : '#e2e8f0') + ';border-radius:8px;padding:7px 9px;'
            + 'background:' + (st[side] ? '#eff6ff' : '#fff') + ';';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!st[side];
        cb.style.cssText = 'margin:2px 0 0 0;flex:0 0 auto;';
        cb.addEventListener('change', function () {
            st[side] = cb.checked;
            jobRenderTableCopy();      // 重画：勾选框边框/底色跟着变
        });
        const span = document.createElement('span');
        span.innerHTML = '<b>' + label + '</b>　' + text;
        row.appendChild(cb);
        row.appendChild(span);
        return row;
    };
    box.appendChild(mkRow('normal', '普通关', jobCopySideSummary(t, 'normal')));
    box.appendChild(mkRow('boss', 'boss 关', jobCopySideSummary(t, 'boss')));

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:10px;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.style.cssText = 'font-size:12px;padding:6px 14px;border:1px solid #cbd5e1;border-radius:8px;'
        + 'background:#fff;color:#475569;cursor:pointer;';
    cancel.addEventListener('click', jobCloseTableCopy);
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = '📋 复制到当前表';
    go.style.cssText = 'font-size:12px;padding:6px 16px;border:none;border-radius:8px;'
        + 'background:#1d4ed8;color:#fff;cursor:pointer;font-weight:600;';
    go.addEventListener('click', function () {
        const sides = { normal: !!st.normal, boss: !!st.boss };
        if (!sides.normal && !sides.boss) {
            setStatus('⚠️ 两样都没勾 —— 先勾「普通关」或「boss 关」');
            return;
        }
        jobCloseTableCopy();
        jobCopyTableFrom(i, sides);
    });
    foot.appendChild(cancel);
    foot.appendChild(go);
    box.appendChild(foot);
    return box;
}

function jobRenderTableCopy() {
    const body = document.getElementById('tcBody');
    if (!body) return;
    body.innerHTML = '';

    // ---- 第二步：已经选好表 -> 选复制哪一侧 ----
    if (typeof _jobCopyTarget === 'number' && jobTables[_jobCopyTarget]
            && _jobCopyTarget !== currentTable) {
        body.appendChild(jobBuildCopySidesStep(_jobCopyTarget));
        return;
    }
    _jobCopyTarget = null;

    // ---- 第一步：选一张来源表 ----
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:#475569;line-height:1.6;background:#f8fafc;'
        + 'border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:8px;';
    hint.innerHTML = '第 1 步：<b>选一张要复制的表</b> → 第 2 步再勾选复制<b>普通关</b>还是<b>boss 关</b>（可都勾）。';
    body.appendChild(hint);

    let n = 0;
    (jobTables || []).forEach(function (t, i) {
        if (i === currentTable) return;      // 自己拷自己没意义
        n++;
        body.appendChild(jobBuildCopyCard(i));
    });
    if (!n) {
        const empty = document.createElement('div');
        empty.className = 'jp-empty';
        empty.textContent = '（只有当前一张阵容表，没有可复制的来源）';
        body.appendChild(empty);
    }
}

function jobBindTableCopy() {
    const modal = document.getElementById('tableCopyModal');
    if (!modal) return;
    const open = document.getElementById('jobCopyTable');
    if (open) open.addEventListener('click', jobOpenTableCopy);
    const close = document.getElementById('tcClose');
    if (close) close.addEventListener('click', jobCloseTableCopy);
    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseTableCopy();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!modal.classList.contains('jp-open')) return;
        // 第二步（选复制哪一侧）按 Esc 先退回选表，再按一次才关弹窗
        if (typeof _jobCopyTarget === 'number' && _jobCopyTarget !== null) {
            _jobCopyTarget = null;
            jobRenderTableCopy();
            return;
        }
        jobCloseTableCopy();
    });
}
