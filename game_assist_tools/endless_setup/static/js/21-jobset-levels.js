
// ============================================================
// 关卡链：表1 从 1 开始；表N 从表N-1 的结束关开始（线性推进）
// ============================================================
// 阵容表：关卡区间由「相邻阵容之间的一个转阵容关」决定（像关键帧）
//   阵容1 = 1 → B1，阵容2 = B1 → B2，……，最后一个阵容 = B(n-1) → MAX
//   中间那个数字（B）同时是「上一阵容的结束关」和「下一阵容的起始关」，
//   所以改一处，两边同步变。
// ============================================================
const JOB_MAX_LEVEL = 149;

// 取某个阵容的区间 [from, to)
function jobRangeOfTable(i) {
    const n = jobTables.length;
    let from = 1;
    if (i > 0) {
        const p = Number(jobTables[i - 1].to_level);
        from = (p > 0) ? p : 1;
    }
    let to;
    if (i < n - 1) {
        const c = Number(jobTables[i].to_level);
        to = (c > 0) ? c : JOB_MAX_LEVEL;
    } else {
        to = JOB_MAX_LEVEL;      // 最后一个阵容一直到最大关卡
    }
    return { from: from, to: to };
}

// 删表/新增/改数字后统一重算所有区间，保证首尾相接、不越界
function jobRenumberTables() {
    if (!jobTables.length) return;
    for (let i = 0; i < jobTables.length; i++) {
        if (i === 0) {
            jobTables[i].from_level = 1;
        } else {
            const prevTo = Number(jobTables[i - 1].to_level);
            jobTables[i].from_level = (prevTo > 0) ? prevTo : 1;
        }
        if (i === jobTables.length - 1) {
            // 最后一个阵容没有「转阵容关」→ 一直到最后
            jobTables[i].to_level = '';
        } else {
            let v = Number(jobTables[i].to_level);
            const lo = Number(jobTables[i].from_level) + 1;          // 至少比起始关大 1
            if (!(v > 0)) v = Math.min(JOB_MAX_LEVEL, lo);           // 没设就用最小合法值
            if (v < lo) v = lo;
            if (v > JOB_MAX_LEVEL) v = JOB_MAX_LEVEL;
            jobTables[i].to_level = String(v);
        }
    }
}

function jobFillForm() {
    const t = jobTables[currentTable];
    if (!t) return;
    const r = jobRangeOfTable(currentTable);
    const isLast = (currentTable === jobTables.length - 1);

    // 补给选取是每个阵容独立的，切阵容时要重渲染
    try { jobRenderSupply(); } catch (e) {}

    const elFrom = document.getElementById('tfRangeFrom');
    const elTo = document.getElementById('tfRangeTo');
    if (elFrom) elFrom.textContent = r.from;
    if (elTo) elTo.textContent = isLast ? (r.to + '（到最后）') : r.to;

    // 中间那个「转阵容关」：最后一个阵容没有
    const bd = document.getElementById('tfBoundary');
    const hint = document.getElementById('tfBoundaryHint');
    if (bd) {
        bd.style.display = isLast ? 'none' : '';
        if (!isLast) {
            bd.value = Number(t.to_level) || '';
            bd.min = String(r.from + 1);
            bd.max = String(JOB_MAX_LEVEL);
        }
    }
    if (hint) {
        hint.textContent = isLast
            ? '（最后一个阵容，一直执行到最大关卡）'
            : ('改这个数字 → 阵容' + (currentTable + 1) + ' 的起始关同步变成它');
    }

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
//     · 一致   -> 只显示「沿用普通关」（mode 锁定 ''）；
//                悬停提示「槽位的设置沿用普通关」。
//     · 不一致 -> 自动出现切换阵容选项，且只提供「单独选卡 / 切换编队」
//                （没有「沿用」——数据已经不一样了）；mode 自动落到 plants。
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
        sel.innerHTML = differ
            ? '<option value="plants">单独选卡</option><option value="deck">切换编队</option>'
            : '<option value="">沿用普通关</option>';
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
            : '槽位的设置沿用普通关（到 boss 棋盘给某个槽换植物或点 ✕ 删除后，这里会自动出现换卡/编队选项）');
    }
    const bdbx = document.getElementById('tfBossDeckBox');
    if (bdbx) bdbx.style.display = (t.bossLineupMode === 'deck') ? 'inline-flex' : 'none';
}

function jobSyncForm() {
    const t = jobTables[currentTable];
    if (!t) return;
    // 关卡不在表单里直接改（由 jobRenumberTables + 转阵容关输入框负责）
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

// 改「转阵容关」：像关键帧一样，只改这一个数，两边同时生效
function jobSetBoundary(v) {
    const t = jobTables[currentTable];
    if (!t) return;
    if (currentTable >= jobTables.length - 1) return;   // 最后一个阵容没有转阵容关

    const r = jobRangeOfTable(currentTable);
    let n = parseInt(v);
    const lo = r.from + 1;
    if (!(n > 0)) { jobFillForm(); return; }             // 空值 → 还原显示，不写入
    if (n < lo) n = lo;
    if (n > JOB_MAX_LEVEL) n = JOB_MAX_LEVEL;

    t.to_level = String(n);
    jobRenumberTables();          // 重算全部区间（本阵容结束关 = 下一阵容起始关）
    jobRenderTabs();
    jobFillForm();
    jobSaveLocal();
    setStatus('🔀 阵容' + (currentTable + 1) + ' 结束关 = 阵容' + (currentTable + 2) + ' 起始关 = ' + n);
}

// ============================================================
// 拖拽换序：把 阵容A 拖到 阵容B 上 -> **交换**两个阵容的内容。
//   ★ 交换的是「内容」（槽位/棋盘/链/补给…），关卡区间（from/to_level）
//     是**位置属性**（关键帧），不随内容走 —— 拖完区间不变，只是
//     这个区间里跑的阵容换了。
// ============================================================
function jobSwapTables(i, j) {
    if (i === j || !jobTables[i] || !jobTables[j]) return;
    jobSaveCurrentBoard();                       // 防御：当前编辑先落回表对象
    const iFrom = jobTables[i].from_level, iTo = jobTables[i].to_level;
    const jFrom = jobTables[j].from_level, jTo = jobTables[j].to_level;
    const tmp = jobTables[i];
    jobTables[i] = jobTables[j];
    jobTables[j] = tmp;
    jobTables[i].from_level = iFrom; jobTables[i].to_level = iTo;
    jobTables[j].from_level = jFrom; jobTables[j].to_level = jTo;
    jobRenumberTables();                         // 保险：重接关卡链
    jobLoadTable(currentTable, true);            // 当前位置内容变了，整页重载
    jobSaveLocal();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
    setStatus('🔀 已交换 阵容' + (i + 1) + ' ↔ 阵容' + (j + 1) + ' 的内容（关卡区间不动）');
}

// Q/E 循环切换阵容（在 jobInstallSlotHotkeys 里挂了按键，那里已做输入框/弹层守卫）
function jobCycleTable(dir) {
    const n = jobTables.length;
    if (n <= 1) return;
    const nxt = ((currentTable + dir) % n + n) % n;    // 首尾循环
    jobLoadTable(nxt);
    jobSaveLocal();
    setStatus('📑 阵容' + (nxt + 1));
}

function jobRenderTabs() {
    const box = document.getElementById('jobTableTabs');
    if (!box) return;
    box.innerHTML = '';
    jobTables.forEach(function (t, i) {
        const r = jobRangeOfTable(i);
        const el = document.createElement('span');
        el.style.cssText = 'padding:3px 12px;border-radius:6px;font-size:12px;cursor:pointer;user-select:none;'
            + (i === currentTable ? 'background:#2d7aff;color:#fff;' : 'background:#e9ecf0;color:#333;');
        el.textContent = '阵容' + (i + 1) + '（' + r.from + '-' + r.to + '）';
        el.title = '关卡 ' + r.from + ' ~ ' + r.to + '\n拖到另一个阵容上 = 交换两者内容（关卡区间不动）\nQ/E = 切换阵容';
        el.addEventListener('click', function () { jobLoadTable(i); });
        // ---- 拖拽交换 ----
        el.draggable = true;
        el.addEventListener('dragstart', function (ev) {
            ev.dataTransfer.setData('text/plain', String(i));
            ev.dataTransfer.effectAllowed = 'move';
            el.style.opacity = '0.45';
        });
        el.addEventListener('dragend', function () {
            el.style.opacity = '';
            box.querySelectorAll('span').forEach(function (s) { s.style.outline = ''; });
        });
        el.addEventListener('dragover', function (ev) {
            ev.preventDefault();                     // 不拦就 drop 不了
            ev.dataTransfer.dropEffect = 'move';
            el.style.outline = '2px dashed #2d7aff';
        });
        el.addEventListener('dragleave', function () { el.style.outline = ''; });
        el.addEventListener('drop', function (ev) {
            ev.preventDefault();
            el.style.outline = '';
            const from = parseInt(ev.dataTransfer.getData('text/plain'));
            if (Number.isFinite(from)) jobSwapTables(from, i);
        });
        box.appendChild(el);
    });
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

// 把「当前正在编辑的关卡」和 boss 关两块棋盘一起同步。
// 返回是否有改动。
function jobSyncSlotPlantEverywhere(slot, name) {
    let changed = false;
    try {
        if (typeof boardEarly !== 'undefined' && jobSyncSlotPlantOnBoard(boardEarly, slot, name)) changed = true;
    } catch (e) { }
    try {
        if (typeof boardLate !== 'undefined' && jobSyncSlotPlantOnBoard(boardLate, slot, name)) changed = true;
    } catch (e) { }
    return changed;
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
