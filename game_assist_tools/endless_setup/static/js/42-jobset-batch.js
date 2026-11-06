
// ============================================================
// 42. 槽位连续化（压实）+ 指定表批量替换 / 删除植物（2026-10-30）
//
// ⚠️ 本文件**没有独立按钮**（用户要求撤掉"批量替换"按钮）：
//    · 「替换指定表」挂在**植物选择器**右侧（点槽位 ✎ 打开选择器时出现）；
//    · 「删除这个植物」挂在槽位胶囊的 ✕ 上，弹一个二选一的小窗。
//
// ★ 为什么"左移压实"必须集中在一个函数里：
//   槽号被**五处**数据引用 —— 槽位表 / boss 覆盖层 / 槽位形态 / 动作后等待 /
//   棋盘落点（`id:'cardN'`）+ 三条链的段（`key:'cardN'`，段里的 picked/order
//   是**该槽内部**的落点下标，整槽一起搬才不用改）。漏改任何一处就是
//   「棋盘上有植物但槽位没了」「链条指向不存在的槽」这类孤儿数据，
//   所以统一走 jobCompactSlots()，禁止各调用点自己挪槽号。
// ============================================================

// ---------- 槽位占用判定（普通关 / boss 关两套口径） ----------
function jobSlotOccupied(t, i, isBoss) {
    if (!t || !i || i < 1 || i > 8) return false;
    if (isBoss) {
        if (typeof jobBossSlotState === 'function' && jobBossSlotState(t, i) === 'blocked') return false;
        return !!(typeof jobSlotNameCtx === 'function' ? jobSlotNameCtx(t, i, true) : '');
    }
    return !!(t.slots && t.slots[i]);
}

// ---------- 把槽号映射搬到某块棋盘上（被删槽的落点直接消失） ----------
function jobRemapBoardSlots(board, map) {
    if (!board) return 0;
    let dropped = 0;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!Array.isArray(cell)) continue;
            const keep = [];
            cell.forEach(function (it) {
                if (!it) return;
                const m = /^card(\d+)$/.exec(String(it.id || ''));
                if (!m) { keep.push(it); return; }
                const old = +m[1];
                if (!map[old]) { dropped++; return; }      // 这个槽没了 -> 落点一起清
                it.id = 'card' + map[old];
                keep.push(it);
            });
            if (keep.length !== cell.length) board[r][c] = keep;
        }
    }
    return dropped;
}

// ---------- 链条段：改 seg.key；被删槽的段整段丢掉 ----------
function jobRemapChainSegs(t, field, map) {
    if (!t || !Array.isArray(t[field])) return 0;
    const out = [];
    let changed = 0;
    t[field].forEach(function (seg) {
        if (!seg) return;
        const m = /^card(\d+)$/.exec(String(seg.key || ''));
        if (!m) { out.push(seg); return; }
        const old = +m[1];
        if (!map[old]) { changed++; return; }
        if (map[old] !== old) { seg.key = 'card' + map[old]; changed++; }
        out.push(seg);
    });
    t[field] = out;
    return changed;
}

// ---------- 形态表 / 动作后等待 的键 ----------
function jobRemapSlotKeyedObject(obj, map, keyParser) {
    if (!obj || typeof obj !== 'object') return 0;
    const out = {};
    let changed = 0;
    Object.keys(obj).forEach(function (k) {
        const parsed = keyParser(k);              // -> {slot, rebuild(newSlot)}
        if (!parsed) { out[k] = obj[k]; return; }
        if (!map[parsed.slot]) { changed++; return; }
        const nk = parsed.rebuild(map[parsed.slot]);
        out[nk] = obj[k];
        if (nk !== k) changed++;
    });
    Object.keys(obj).forEach(function (k) { delete obj[k]; });
    Object.keys(out).forEach(function (k) { obj[k] = out[k]; });
    return changed;
}

// 'cardN' -> {slot:N}
function _jobParseModeKey(k) {
    const m = /^card(\d+)$/.exec(String(k));
    if (!m) return null;
    return { slot: +m[1], rebuild: function (s) { return 'card' + s; } };
}
// 'once|cardN|r,c|seq' -> {slot:N}（HANDOFF §5 的键格式）
function _jobParseWaitKey(k) {
    const parts = String(k).split('|');
    if (parts.length < 2) return null;
    const m = /^card(\d+)$/.exec(parts[1]);
    if (!m) return null;
    return {
        slot: +m[1],
        rebuild: function (s) {
            const p = parts.slice();
            p[1] = 'card' + s;
            return p.join('|');
        }
    };
}

// ============================================================
// ★ 槽位连续化主入口
//   把「占用中的槽」按原顺序压到 1..n，中间的空槽 / boss 已删除槽被顶掉，
//   并把槽位表 / 覆盖层 / 落点 / 链条 / 形态 / 等待 一起搬到新槽号。
//
//   isBoss=false：动 t.slots + boardEarly + slotOrder/loopOrder/endOrder
//                 + slotModes + waitAfter
//   isBoss=true ：动 t.bossSlots + boardLate + bossSlotOrder/bossLoopOrder
//                 + bossSlotModes + bossWaitAfter
//                 （压实后的 boss 槽位一律写成**显式覆盖**，
//                   否则"沿用"会指向已经改过号的普通关槽位）
//
//   boardArg：显式指定要搬的棋盘。缺省 = 当前编辑那块（boardEarly/boardLate）。
//   ★ 载入时 jobCompactAllTables() 要压**所有表**，那时全局棋盘只是当前表的拷贝，
//     所以必须能把各表自己的 t.boardEarly / t.boardLate 传进来。
//
//   返回被搬动的槽数（0 = 本来就连续，什么都没做）。
// ============================================================
function jobCompactSlots(t, isBoss, boardArg) {
    if (!t) return 0;
    const map = {};                 // oldSlot -> newSlot
    const names = {};               // newSlot -> 植物名
    let next = 1, moved = 0;
    for (let i = 1; i <= 8; i++) {
        if (!jobSlotOccupied(t, i, isBoss)) continue;
        map[i] = next;
        names[next] = typeof jobSlotNameCtx === 'function'
            ? (jobSlotNameCtx(t, i, !!isBoss) || '') : '';
        if (map[i] !== i) moved++;
        next++;
    }
    if (!moved) return 0;           // 本来就连续 -> 不动（保住"没改就别写盘"）

    // ① 槽位表 / 覆盖层
    if (isBoss) {
        t.bossSlots = {};
        for (let i = 1; i <= 8; i++) {
            if (!map[i]) continue;
            t.bossSlots[map[i]] = names[map[i]];      // 显式覆盖，语义不再依赖普通关
        }
        // ★ 压实后**尾部多出来的槽必须显式封掉**：
        //   boss 槽位是"覆盖层"，没写键 = 沿用普通关同槽。若只搬前面不管尾巴，
        //   第 n+1 号槽会重新"沿用"普通关那一槽的植物 —— 等于用户删掉的槽又自己长回来
        //   （"槽6 到槽8 中间空着/乱长"就是这么来的）。所以普通关有植物的位置一律置 null。
        for (let k = next; k <= 8; k++) {
            if (t.slots && t.slots[k]) t.bossSlots[k] = null;
            else delete t.bossSlots[k];
        }
    } else {
        const ns = {};
        for (let i = 1; i <= 8; i++) ns[i] = '';
        for (let i = 1; i <= 8; i++) {
            if (!map[i]) continue;
            ns[map[i]] = names[map[i]];
        }
        t.slots = ns;
    }

    // ② 棋盘落点
    const board = (boardArg !== undefined && boardArg !== null) ? boardArg
        : (isBoss
            ? ((typeof boardLate !== 'undefined') ? boardLate : null)
            : ((typeof boardEarly !== 'undefined') ? boardEarly : null));
    jobRemapBoardSlots(board, map);
    if (isBoss) {
        // 压实时已经写成显式覆盖 —— 顺带把棋盘上的植物名对齐一遍
        for (let i = 1; i <= 8; i++) {
            if (map[i] && names[map[i]]) {
                try { jobSyncSlotPlantOnBoard(board, map[i], names[map[i]]); } catch (e) { }
            }
        }
    }

    // ③ 链条 / 形态 / 等待
    if (isBoss) {
        jobRemapChainSegs(t, 'bossSlotOrder', map);
        jobRemapChainSegs(t, 'bossLoopOrder', map);
        jobRemapSlotKeyedObject(t.bossSlotModes, map, _jobParseModeKey);
        jobRemapSlotKeyedObject(t.bossWaitAfter, map, _jobParseWaitKey);
    } else {
        jobRemapChainSegs(t, 'slotOrder', map);
        jobRemapChainSegs(t, 'loopOrder', map);
        jobRemapChainSegs(t, 'endOrder', map);
        jobRemapSlotKeyedObject(t.slotModes, map, _jobParseModeKey);
        jobRemapSlotKeyedObject(t.waitAfter, map, _jobParseWaitKey);
    }

    // ④ 选中态/勾选/uid 缓存都指向旧槽号 -> 全清
    if (typeof jobArmedSlot !== 'undefined') jobArmedSlot = 0;
    if (typeof jobSeqSel !== 'undefined') jobSeqSel = {};
    if (typeof _jobLastSteps !== 'undefined' && _jobLastSteps) {
        _jobLastSteps.once = null; _jobLastSteps.loop = null; _jobLastSteps.end = null;
    }
    return moved;
}

// ============================================================
// 载入时统一压实（用户要求：**不留按钮**，旧作业集加载时直接压实）
// ============================================================
function jobCompactAllTables() {
    const res = { normal: 0, boss: 0, tables: 0 };
    (jobTables || []).forEach(function (t) {
        if (!t) return;
        let n0 = 0, b0 = 0;
        try { n0 = jobCompactSlots(t, false, t.boardEarly); } catch (e) { console.warn('[compact] normal', e); }
        try { b0 = jobCompactSlots(t, true, t.boardLate); } catch (e) { console.warn('[compact] boss', e); }
        if (n0 || b0) res.tables++;
        res.normal += n0;
        res.boss += b0;
    });
    return res;
}

// ============================================================
// 通用小工具：拿某张表某一侧的棋盘（当前编辑表用全局那份活的棋盘）
// ============================================================
function jobSideBoardOf(t, side) {
    const isCur = (typeof currentTable === 'number' && jobTables.indexOf(t) === currentTable);
    if (side === 'boss') return isCur ? boardLate : t.boardLate;
    return isCur ? boardEarly : t.boardEarly;
}

// 按植物名清掉某块棋盘上的落点（普通关/boss 关都可用；也能清历史孤儿落点）
function jobPurgePlantOnBoard(board, name) {
    if (!board || !name) return 0;
    let n = 0;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!Array.isArray(cell)) continue;
            const keep = cell.filter(function (it) {
                if (!it) return false;
                const nm = (it.plant && it.plant.name) || it.label || '';
                if (nm === name) { n++; return false; }
                return true;
            });
            if (keep.length !== cell.length) board[r][c] = keep;
        }
    }
    return n;
}

// 某张表某一侧有没有用着这个植物（用于"同一植物不能占两个槽"）
function jobSideUsesPlant(t, side, name) {
    if (!t || !name) return false;
    if (side === 'normal') {
        for (let i = 1; i <= 8; i++) if (((t.slots && t.slots[i]) || '') === name) return true;
        return false;
    }
    if (typeof jobBossSlotState !== 'function') return false;
    for (let i = 1; i <= 8; i++) {
        if (jobBossSlotState(t, i) === 'override' && t.bossSlots[i] === name) return true;
    }
    return false;
}

// 把某张表某一侧的植物 src 换成 dst（槽位 + 该侧棋盘落点一起换）
function jobReplacePlantInTable(t, side, src, dst) {
    if (!t || !src || !dst || src === dst) return 0;
    const board = jobSideBoardOf(t, side);
    let n = 0;
    if (side === 'normal') {
        // ★ 先固化 boss 侧「沿用 + 已有落点」的槽（§10.7-C 那类 bug）：
        //   普通关槽位一变，纯沿用的 boss 槽会跟着变 → boss 关静默丢自己的植物。
        //   当前表走 jobSyncNormalSlotPlant 也会固化，这里是给**别的表**兜的底。
        try { jobFreezeBossInheritedSlots(t, jobSideBoardOf(t, 'boss')); } catch (e) { }
        for (let s = 1; s <= 8; s++) {
            if (((t.slots && t.slots[s]) || '') !== src) continue;
            t.slots[s] = dst;
            try { jobSyncSlotPlantOnBoard(board, s, dst); } catch (e) { }
            n++;
        }
    } else if (typeof jobBossSlotState === 'function') {
        for (let s = 1; s <= 8; s++) {
            if (jobBossSlotState(t, s) !== 'override') continue;
            if (t.bossSlots[s] !== src) continue;
            t.bossSlots[s] = dst;
            try { jobSyncSlotPlantOnBoard(board, s, dst); } catch (e) { }
            n++;
        }
    }
    return n;
}

// 该植物在各表 / 各侧的分布（"替换指定表"列表的数据源）
//   → [{ table:i, side:'normal'|'boss', slots:[...], placements:n }]
function jobListPlantLocations(name) {
    const out = [];
    if (!name) return out;
    (jobTables || []).forEach(function (t, i) {
        if (!t) return;
        // 普通关
        const nSlots = [];
        for (let s = 1; s <= 8; s++) if (((t.slots && t.slots[s]) || '') === name) nSlots.push(s);
        if (nSlots.length) {
            out.push({ table: i, side: 'normal', slots: nSlots,
                placements: jobCountPlantOnBoard(jobSideBoardOf(t, 'normal'), name) });
        }
        // boss 关（只有「显式覆盖」才算"这张表的 boss 用了它"）
        if (typeof jobBossSlotState === 'function') {
            const bSlots = [];
            for (let s = 1; s <= 8; s++) {
                if (jobBossSlotState(t, s) !== 'override') continue;
                if (t.bossSlots[s] === name) bSlots.push(s);
            }
            if (bSlots.length) {
                out.push({ table: i, side: 'boss', slots: bSlots,
                    placements: jobCountPlantOnBoard(jobSideBoardOf(t, 'boss'), name) });
            }
        }
    });
    return out;
}

// 统计某块棋盘上某植物的落点数
function jobCountPlantOnBoard(board, name) {
    let n = 0;
    (board || []).forEach(function (row) {
        (row || []).forEach(function (cell) {
            (cell || []).forEach(function (it) {
                if (!it) return;
                const nm = (it.plant && it.plant.name) || it.label || '';
                if (nm === name) n++;
            });
        });
    });
    return n;
}

// ============================================================
// 全表刷新（替换/删除之后统一走这里，保证视图 == 数据 == 缓存）
// ============================================================
function jobAfterPlantChange(msg) {
    if (typeof renderAllBoards === 'function') { try { renderAllBoards(); } catch (e) { } }
    if (typeof updatePreview === 'function') { try { updatePreview(); } catch (e) { } }
    if (typeof jobFillForm === 'function') { try { jobFillForm(); } catch (e) { } }
    if (typeof jobRenderSlots === 'function') { try { jobRenderSlots(); } catch (e) { } }
    if (typeof jobRenderSeqChains === 'function') { try { jobRenderSeqChains(); } catch (e) { } }
    if (typeof jobRefreshBossLineupUI === 'function') { try { jobRefreshBossLineupUI(); } catch (e) { } }
    if (typeof jobOuterRefreshBadge === 'function') { try { jobOuterRefreshBadge(); } catch (e) { } }
    if (typeof jobSaveLocal === 'function') { try { jobSaveLocal(); } catch (e) { } }
    if (msg && typeof setStatus === 'function') setStatus(msg);
}

// ============================================================
// 一、「替换指定表」：挂在植物选择器右侧
//
//   交互（用户定的流程，2026-10-31 起支持**多选**）：
//     点槽位 ✎ 打开植物选择器（左边是植物网格，右边是本面板）
//     → 想把这个槽现在用的植物 A 在别的表里也换掉
//     → 面板列出**用了 A 的表**：一张表 = 一个大块，里面装
//       「普通关 / boss 关」两个小块（勾选框 + 槽号 + 落点数）
//     → **可以勾多张表 / 多个关别**，再点左边任意植物
//       = 把这些地方里的 A 全部换成它（点一次搞定，不用一张表来一遍）
//
//   ★ 「正在编辑」那一处**默认打勾**（用户要求）：点植物本来就该改这一槽，
//     所以它永远包含在操作里；把它取消勾选，就只改别的表、这一槽不动。
//   ★ boss 关小块**有没有这个植物**决定能不能勾（用户要求）：
//     boss 侧是「没写键 = 沿用普通关同槽」的覆盖层，所以只有**显式覆盖**
//     才算「boss 关自己用了它」—— 没有就灰掉不可勾（换了也没地方可换），
//     有才可勾。纯沿用的不用勾：改普通关它自己会跟着变。
//   ★ boss 关追问（用户要求：「如果 boss 关有就询问 boss 关需不需要替换」）：
//     要改的普通关里，若同一张表的 **boss 关也在用 A**（显式覆盖）且没被勾，
//     不闷头只改普通关 —— 面板停下来问一句「boss 关要不要一起替换？」，
//     选「一起」才连 boss 侧一起换。反方向不问（勾 boss 关不动普通关）。
//   ★ 只有「改当前槽」这一件事时**不抢**正常选卡流程：
//     别的表一处都没勾 = 直接返回 false，让 jobConfirmPick 照老样子跑
//     （去重 / 卡条连排 / 落子态 / 关选择器 全在它里面）。
//     一旦有别的目标，先把当前槽交给 jobConfirmPick（同样的老流程），
//     再批量替换其它表 —— 两边都不丢语义。
// ============================================================

// ---- 多选目标 ----------------------------------------------------------
//   key = '表序号|normal' / '表序号|boss'
//   用对象不用数组：toggle 是 O(1)，天然去重（同一处点两次 = 取消）。
let _jobReplaceSel = {};
// boss 关待确认：点了植物、但同一张表的 boss 关也在用 A 时挂在这里，
// 面板上停一步问「boss 关要不要一起替换？」。null = 没有待确认。
//   { src, dst, targets:[{table,side}], bossExtra:[{table,side}], blocked:[...],
//     pickCurrent:bool }
let _jobReplacePending = null;

function jobReplaceKey(table, side) {
    return String(table) + '|' + (side === 'boss' ? 'boss' : 'normal');
}
function jobReplaceKeyParts(k) {
    const p = String(k).split('|');
    return { table: +p[0], side: (p[1] === 'boss') ? 'boss' : 'normal' };
}
function jobReplaceSideLabel(side) { return side === 'boss' ? 'boss 关' : '普通关'; }

// 已选的（表 + 关别）清单；排序稳定 = 先表序号、同一张表普通关在前
function jobReplaceSelList() {
    return Object.keys(_jobReplaceSel)
        .filter(function (k) { return !!_jobReplaceSel[k]; })
        .map(jobReplaceKeyParts)
        .sort(function (a, b) {
            if (a.table !== b.table) return a.table - b.table;
            if (a.side === b.side) return 0;
            return a.side === 'normal' ? -1 : 1;
        });
}
function jobReplaceSelCount() { return jobReplaceSelList().length; }

// 「正在编辑」那一处 = 当前表 + 当前 tab 的关别（它就是 A 的来源）
function jobReplaceCurrentLoc() {
    const bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    return {
        table: (typeof currentTable === 'number' && currentTable >= 0) ? currentTable : 0,
        side: bossCtx ? 'boss' : 'normal'
    };
}
function jobReplaceIsCurrent(loc) {
    if (!loc) return false;
    const cur = jobReplaceCurrentLoc();
    return loc.table === cur.table && loc.side === cur.side;
}

// 某一侧用没用这株植物 —— 槽号 / 落点数 / uses
//   ★ boss 侧只认**显式覆盖**：沿用不算「boss 关自己用了它」。
function jobReplaceSideInfo(t, side, name) {
    const info = { uses: false, slots: [], placements: 0 };
    if (!t || !name) return info;
    if (side === 'normal') {
        for (let s = 1; s <= 8; s++) if (((t.slots && t.slots[s]) || '') === name) info.slots.push(s);
        info.uses = info.slots.length > 0;
    } else if (typeof jobBossSlotState === 'function') {
        for (let s = 1; s <= 8; s++) {
            if (jobBossSlotState(t, s) !== 'override') continue;
            if (t.bossSlots[s] === name) info.slots.push(s);
        }
        info.uses = info.slots.length > 0;
    }
    info.placements = jobCountPlantOnBoard(jobSideBoardOf(t, side), name);
    return info;
}

// 面板数据：只用「至少一侧用到这株植物」的表出卡片（一张表一个大块）
function jobReplaceCards(name) {
    const out = [];
    if (!name) return out;
    (jobTables || []).forEach(function (t, i) {
        if (!t) return;
        const normal = jobReplaceSideInfo(t, 'normal', name);
        const boss = jobReplaceSideInfo(t, 'boss', name);
        if (!normal.uses && !boss.uses) return;
        out.push({ table: i, normal: normal, boss: boss });
    });
    return out;
}

// 正在编辑的槽位现在用的植物名（= 要被替换的那个 A）
function jobReplaceSrcName() {
    const t = jobTables[currentTable];
    const slot = (typeof currentSlotEditing === 'number') ? currentSlotEditing : 0;
    if (!t || !slot) return '';
    const bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    return (typeof jobSlotNameCtx === 'function')
        ? (jobSlotNameCtx(t, slot, bossCtx) || '') : '';
}

// 把「正在编辑」那一处勾上（默认态；执行完也回到这个态）
function jobSeedCurrentSel() {
    const cur = jobReplaceCurrentLoc();
    _jobReplaceSel[jobReplaceKey(cur.table, cur.side)] = true;
}

// 打开选择器时用：清空 + 重新种上「正在编辑」的默认勾选
function jobResetReplaceSel() {
    _jobReplaceSel = {};
    _jobReplacePending = null;
    if (jobReplaceSrcName()) jobSeedCurrentSel();
    jobRenderReplacePanel();
}

// 清空全部勾选（面板底部按钮）
function jobCancelReplaceArm() {
    _jobReplaceSel = {};
    _jobReplacePending = null;
    jobRenderReplacePanel();
}

// 只选一处（老的单选语义；面板走 jobToggleReplaceTarget，这里留给内部/回归用）
function jobArmReplaceTarget(tableIdx, side) {
    _jobReplaceSel = {};
    _jobReplaceSel[jobReplaceKey(tableIdx, side)] = true;
    _jobReplacePending = null;
    jobRenderReplacePanel();
}

// 点一个小块 = 勾上 / 取消（多选；同一个地方再点一次就是取消）
function jobToggleReplaceTarget(tableIdx, side) {
    const k = jobReplaceKey(tableIdx, side);
    if (_jobReplaceSel[k]) delete _jobReplaceSel[k];
    else _jobReplaceSel[k] = true;
    _jobReplacePending = null;      // 目标变了，之前那句「boss 要不要一起换」作废
    jobRenderReplacePanel();
}

// 在植物网格被点击/回车时先走这里；返回 true = 这次点击被"替换"吃掉了
//
//   ★ 两种"不接管"（返回 false，交回正常选卡流程）：
//     · 没有任何勾选（理论上不会：正在编辑那处默认勾着）；
//     · 除了「正在编辑」那一处，别的表一处都没勾、也没有要追问的 boss 关
//       —— 这就是普通的"给这一槽选植物"。
function jobTryApplyReplaceFlow(p) {
    if (!p) return false;
    if (_jobReplacePending) _jobReplacePending = null;    // 换一个植物 = 重新算
    const src = jobReplaceSrcName();
    if (!src) { _jobReplaceSel = {}; jobRenderReplacePanel(); return false; }
    if (p.name === src) {
        if (typeof setStatus === 'function') setStatus('⚠️ 换成的植物和原来一样，没意义');
        return true;
    }

    const sel = jobReplaceSelList();
    const curLoc = jobReplaceCurrentLoc();
    const pickCurrent = sel.some(jobReplaceIsCurrent);
    const others = sel.filter(function (loc) { return !jobReplaceIsCurrent(loc); });

    // 逐个勾选的目标：已经用着新植物的跳过（同一植物不能占两个槽），
    // 已经不含 src 的也跳过（比如别处的改动把那个槽换掉了）。
    const targets = [], blocked = [];
    others.forEach(function (loc) {
        const t = jobTables[loc.table];
        if (!t) return;
        if (!jobSideUsesPlant(t, loc.side, src)) return;            // 那处已经没有 A 了
        if (jobSideUsesPlant(t, loc.side, p.name)) { blocked.push(loc); return; }
        targets.push(loc);
    });

    // ★ boss 关追问：会被改动的普通关（含「正在编辑」那一处）里，
    //   同一张表 boss 侧（显式覆盖）也在用 A 且没被勾 -> 先问一句
    const askTables = {};
    if (pickCurrent && curLoc.side === 'normal') askTables[curLoc.table] = true;
    targets.forEach(function (loc) { if (loc.side === 'normal') askTables[loc.table] = true; });
    const bossExtra = [];
    Object.keys(askTables).forEach(function (k) {
        const ti = +k;
        const t = jobTables[ti];
        if (!t || typeof jobBossSlotState !== 'function') return;
        if (_jobReplaceSel[jobReplaceKey(ti, 'boss')]) return;            // 已经勾了 boss
        if (!jobSideUsesPlant(t, 'boss', src)) return;                    // boss 关没用它
        if (jobSideUsesPlant(t, 'boss', p.name)) return;                  // boss 关已在用新植物
        bossExtra.push({ table: ti, side: 'boss' });
    });

    // 只有「改当前槽」这一件事 -> 不接管，走正常选卡
    if (!targets.length && !bossExtra.length) return false;

    if (bossExtra.length) {
        _jobReplacePending = { src: src, dst: p.name, targets: targets,
            bossExtra: bossExtra, blocked: blocked, pickCurrent: pickCurrent };
        jobRenderReplacePanel();
        if (typeof setStatus === 'function') {
            setStatus('❓「' + src + '」在 boss 关也用着 —— 右侧面板选「一起替换」还是「boss 关不动」');
        }
        return true;
    }

    if (pickCurrent) jobTryPickCurrentSlot(p.name);      // 当前槽仍走老流程
    jobApplyReplaceNow(src, p.name, targets, blocked, pickCurrent);
    return true;                      // 吃掉点击：不当作"给当前槽选植物"
}

// 用**正常选卡流程**改「正在编辑」那一槽
//   （去重 / 卡条连排 / 落子态 / 关选择器 / boss 固化 全在 jobConfirmPick 里）
//   返回 false = 网格里找不到这株（比如搜索过滤掉了）或已经被别的槽占了。
function jobTryPickCurrentSlot(dst) {
    if (!dst || typeof jobConfirmPick !== 'function') return false;
    const list = (typeof plantPickList !== 'undefined' && plantPickList) ? plantPickList : null;
    if (!list || !list.length) return false;
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].name === dst) { idx = i; break; }
    }
    if (idx < 0) return false;
    plantPickIndex = idx;              // jobConfirmPick 取的是 plantPickList[plantPickIndex]
    jobConfirmPick();
    return true;
}

// 真正落地替换（多选批量）+ 统一收尾
function jobApplyReplaceNow(src, dst, list, blocked, pickedCurrent) {
    let n = 0;
    const done = [];
    (list || []).forEach(function (loc) {
        const t = jobTables[loc.table];
        if (!t) return;
        const c = jobReplacePlantInTable(t, loc.side, src, dst);
        if (!c) return;
        n += c;
        done.push(jobTableName(loc.table) + ' · ' + jobReplaceSideLabel(loc.side));
    });
    _jobReplaceSel = {};
    jobSeedCurrentSel();               // 「正在编辑」那一处默认还是勾着
    _jobReplacePending = null;

    const parts = [];
    if (pickedCurrent) parts.push('✅ 当前槽已改为「' + dst + '」');
    if (n) {
        parts.push('🔄 已把「' + done.join('」「') + '」里的「' + src + '」换成「' + dst
            + '」（' + n + ' 个槽）');
    } else if (!pickedCurrent) {
        parts.push('⚠️ 那些地方里已经没有「' + src + '」了');
    }
    let msg = parts.join('；');
    if (blocked && blocked.length) {
        msg += '；跳过 ' + blocked.map(function (l) {
            return jobTableName(l.table) + '·' + jobReplaceSideLabel(l.side);
        }).join('、') + '（已经在用「' + dst + '」）';
    }
    if (n || pickedCurrent) msg += '　（Ctrl+Z 可撤销）';
    jobAfterPlantChange(msg);
    jobRenderReplacePanel();
    return n;
}

// 面板上「boss 关要不要一起替换」的两个按钮
function jobConfirmPendingBoss(includeBoss) {
    const pd = _jobReplacePending;
    if (!pd) return;
    const list = pd.targets.slice();
    if (includeBoss) Array.prototype.push.apply(list, pd.bossExtra);
    if (pd.pickCurrent) jobTryPickCurrentSlot(pd.dst);
    jobApplyReplaceNow(pd.src, pd.dst, list, pd.blocked, pd.pickCurrent);
}

// ---- 一张表 = 一个大块，里面「普通关 / boss 关」两个小块（**左右并排**）----
//   用户要求：两个小块左右摆，"方便点击"（上下两行太窄、还要点两次才点到）。
//   每个小块两行：① ☑ + 关别  ② 槽号 · 落点数；右上角小字标「编辑 / 也在用」。
function _jobReplaceSubRow(card, side, src) {
    const info = card[side];
    const key = jobReplaceKey(card.table, side);
    const isCur = jobReplaceIsCurrent({ table: card.table, side: side });
    const checked = !!_jobReplaceSel[key];
    // 可勾条件：这一侧真的在用这株；或者它就是「正在编辑」那一处（默认勾上）
    const usable = info.uses || isCur;
    const inPending = !!(_jobReplacePending && _jobReplacePending.bossExtra &&
        _jobReplacePending.bossExtra.some(function (x) {
            return x.table === card.table && x.side === side;
        }));

    const on = checked && usable;
    const block = document.createElement('div');
    // 给回归测试留的结构标记（tests/repro_slot_compact.js 第 10 节按它数块）
    block._jobSide = side;
    block._jobUsable = usable;
    block.style.cssText = 'position:relative;flex:1 1 0;min-width:0;box-sizing:border-box;'
        + 'padding:5px 5px 4px;border-radius:7px;border:1px solid '
        + (on ? '#93c5fd' : '#e5e7eb') + ';'
        + 'background:' + (on ? '#eff6ff' : (inPending ? '#fffbeb' : '#f8fafc')) + ';'
        + (usable ? 'cursor:pointer;' : 'opacity:0.45;cursor:not-allowed;');

    const badge = side === 'boss' ? 'boss 关' : '普通关';
    // 窄块里放不下长句，具体含义走悬停提示
    const meta = info.uses
        ? ('槽 ' + info.slots.join('/') + ' · ' + info.placements + ' 株')
        : (side === 'boss' ? '没用·沿用' : '没用');
    const tip = info.uses
        ? (badge + '用了这株：槽 ' + info.slots.join('/') + '，棋盘上 ' + info.placements + ' 个落点')
        : (side === 'boss'
            ? 'boss 关没有单独用这株（沿用普通关同槽）—— 换普通关它自己会跟着变，不用勾'
            : '这一侧没用这株');

    block.setAttribute('data-tooltip', tip);
    block.setAttribute('data-tooltip-delay', '700');
    block.innerHTML = '<div style="display:flex;align-items:center;gap:3px;min-width:0;">'
        + '<span style="font-size:12px;line-height:1;flex:0 0 auto;color:'
        + (on ? '#2d7aff' : '#cbd5e1') + ';">' + (on ? '☑' : '☐') + '</span>'
        + '<span style="font-size:10px;font-weight:700;flex:0 0 auto;'
        + (side === 'boss' ? 'color:#b45309;' : 'color:#0369a1;') + '">' + badge + '</span>'
        + '</div>'
        + '<div style="font-size:9.5px;color:#64748b;line-height:1.25;margin-top:3px;'
        + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + meta + '</div>'
        + (isCur ? '<span style="position:absolute;right:2px;top:1px;font-size:8px;'
            + 'line-height:1.2;color:#2d7aff;">编辑</span>' : '')
        + (inPending ? '<span style="position:absolute;right:2px;top:' + (isCur ? '10px' : '1px')
            + ';font-size:8px;line-height:1.2;color:#b45309;">也在用</span>' : '');

    if (usable) {
        block.addEventListener('click', function () {
            jobToggleReplaceTarget(card.table, side);
            if (typeof setStatus === 'function') {
                const n = jobReplaceSelCount();
                const curKey = jobReplaceKey(jobReplaceCurrentLoc().table, jobReplaceCurrentLoc().side);
                setStatus(n
                    ? '🔄 已勾 ' + n + ' 处' + (_jobReplaceSel[curKey] ? '（含正在编辑这一处）' : '')
                        + ' —— 点左边的植物，把这些地方里的「' + src + '」一起换掉'
                    : '🔄 一处都没勾：点植物就只改正在编辑的这一槽');
            }
        });
    }
    return block;
}

// 一张表的大块：表名 + 左右两个小块
function _jobReplaceCard(card, src) {
    const wrap = document.createElement('div');
    wrap._jobCard = card.table;          // 回归测试用的结构标记
    wrap.style.cssText = 'border:1px solid #e2e8f0;background:#fff;border-radius:9px;'
        + 'padding:6px 7px 7px;margin-bottom:7px;';
    const ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:11px;font-weight:700;color:#1e293b;line-height:1.4;'
        + 'margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    ttl.textContent = jobTableName(card.table);
    wrap.appendChild(ttl);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:stretch;gap:5px;margin-top:3px;';
    row.appendChild(_jobReplaceSubRow(card, 'normal', src));
    row.appendChild(_jobReplaceSubRow(card, 'boss', src));
    wrap.appendChild(row);
    return wrap;
}

// ★「boss 关要不要一起替换」的追问块（面板顶部，避免被长列表挤到看不见）
function _jobReplacePendingBlock() {
    const pd = _jobReplacePending;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border:1px solid #f59e0b;background:#fffbeb;border-radius:9px;'
        + 'padding:8px 9px;margin-bottom:8px;';
    const names = pd.bossExtra.map(function (x) {
        return jobTableName(x.table) + ' · boss 关';
    });
    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:700;color:#b45309;line-height:1.5;margin-bottom:4px;';
    title.textContent = '❓ boss 关也在用「' + pd.src + '」';
    wrap.appendChild(title);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:10px;color:#92400e;line-height:1.6;margin-bottom:7px;';
    desc.innerHTML = '要换成「<b>' + pd.dst + '</b>」的普通关里，<b>' + names.join('、')
        + '</b> 也在用它。<br>boss 关要不要一起替换？';
    wrap.appendChild(desc);

    const mkBtn = function (text, primary, danger, onclick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = 'display:block;width:100%;font-size:11px;padding:5px 0;margin-bottom:5px;'
            + 'border-radius:7px;cursor:pointer;border:1px solid '
            + (primary ? '#2d7aff' : (danger ? '#fecaca' : '#cbd5e1')) + ';'
            + 'background:' + (primary ? '#2d7aff' : (danger ? '#fef2f2' : '#fff')) + ';'
            + 'color:' + (primary ? '#fff' : (danger ? '#b91c1c' : '#475569')) + ';'
            + 'font-weight:' + (primary ? '700' : '400') + ';';
        b.addEventListener('click', onclick);
        return b;
    };
    // 一起替换：已勾的 + boss 关这几处
    wrap.appendChild(mkBtn('✅ 一起替换（含 boss 关 ' + pd.bossExtra.length + ' 处）', true, false,
        function () { jobConfirmPendingBoss(true); }));
    wrap.appendChild(mkBtn('➡️ boss 关不动（只换普通关）', false, false,
        function () { jobConfirmPendingBoss(false); }));
    wrap.appendChild(mkBtn('✕ 取消', false, true, function () {
        _jobReplacePending = null;
        jobRenderReplacePanel();
        if (typeof setStatus === 'function') setStatus('🔄 已取消，替换目标还在（可以重新点植物）');
    }));
    return wrap;
}

function jobRenderReplacePanel() {
    const box = document.getElementById('plantReplacePanel');
    if (!box) return;
    box.innerHTML = '';

    const head = document.createElement('div');
    head.style.cssText = 'font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:6px;';
    head.textContent = '🔄 替换指定表';
    box.appendChild(head);

    const src = jobReplaceSrcName();
    if (!src) {
        // 槽位空了 = 没有"要被替换的植物"，勾选和追问一起作废
        _jobReplaceSel = {};
        _jobReplacePending = null;
        const em = document.createElement('div');
        em.style.cssText = 'font-size:11px;color:#94a3b8;line-height:1.6;';
        em.textContent = '这个槽位还没有植物。先在左边选一株，"替换指定表"才能用。';
        box.appendChild(em);
        return;
    }

    const cards = jobReplaceCards(src);
    // 勾选集合跟着数据走：只保留「还在这份清单里、且那一侧确实在用」的地方
    // 例外：「正在编辑」那一处永远留着 —— 它是默认勾选，也是 A 的来源。
    const curKey = jobReplaceKey(jobReplaceCurrentLoc().table, jobReplaceCurrentLoc().side);
    const alive = {};
    if (_jobReplaceSel[curKey]) alive[curKey] = true;
    cards.forEach(function (c) {
        ['normal', 'boss'].forEach(function (side) {
            if (!c[side].uses) return;
            const k = jobReplaceKey(c.table, side);
            if (_jobReplaceSel[k]) alive[k] = true;
        });
    });
    _jobReplaceSel = alive;
    if (!jobReplaceSelCount()) _jobReplacePending = null;

    // ★ 追问块放最上面
    if (_jobReplacePending) box.appendChild(_jobReplacePendingBlock());

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:#475569;line-height:1.6;margin-bottom:8px;';
    const nSel = jobReplaceSelCount();
    sub.innerHTML = '正在改：<b>' + src + '</b>'
        + (nSel ? '　<span style="color:#2d7aff;font-weight:700;">已勾 ' + nSel + ' 处</span>' : '')
        + '<br><span style="color:#94a3b8;">每张表一个大块，里面「普通关 / boss 关」分开勾；'
        + '正在编辑那一处默认勾上 → 点左边植物 = 把这些地方的「' + src + '」一起换掉</span>';
    box.appendChild(sub);

    if (!cards.length) {
        const em = document.createElement('div');
        em.style.cssText = 'font-size:11px;color:#94a3b8;';
        em.textContent = '（其它表里没有用到这株植物）';
        box.appendChild(em);
        return;
    }
    cards.forEach(function (c) { box.appendChild(_jobReplaceCard(c, src)); });

    // 底部按钮：勾着「正在编辑」时 = 只保留这一处；没勾它时 = 全部取消
    const keepCur = !!_jobReplaceSel[curKey];
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = keepCur ? '✕ 只保留正在编辑这一处' : '✕ 全部取消勾选';
    cancel.style.cssText = 'width:100%;font-size:11px;padding:4px 0;margin-top:2px;'
        + 'border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#475569;cursor:pointer;';
    cancel.addEventListener('click', keepCur ? jobResetReplaceSel : jobCancelReplaceArm);
    box.appendChild(cancel);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#94a3b8;line-height:1.6;margin-top:6px;';
    tip.textContent = '勾几处就换几处；一处都不勾 = 点植物只改正在编辑的这一槽（老行为）。';
    box.appendChild(tip);
}

// ============================================================
// 二、「删除这个植物」：槽位胶囊 ✕ 弹出的二选一
//   ① 只删这张表（当前关别）的这一株  ← 老行为
//   ② 删掉所有表里的这一株（普通关 + boss 关）
// ============================================================
let _jobDeleteCtx = null;       // { name, side:'normal'|'boss', slot:int }

function jobOpenPlantDelete(name, side, slot) {
    _jobDeleteCtx = { name: name, side: (side === 'boss' ? 'boss' : 'normal'), slot: slot | 0 };
    const m = document.getElementById('plantDeleteModal');
    if (!m) return;
    jobRenderPlantDelete();
    m.classList.add('jp-open');
}

function jobClosePlantDelete() {
    const m = document.getElementById('plantDeleteModal');
    if (m) m.classList.remove('jp-open');
}

// 只删本表这一槽（老行为：清槽位 + 清该侧落点 + 压实）
function jobDeleteSlotHere(ctx) {
    const t = jobTables[currentTable];
    if (!t || !ctx) return { removed: 0, shifted: 0 };
    const slot = ctx.slot;
    let removed = 0, shifted = 0;
    if (typeof jobArmedSlot !== 'undefined' && jobArmedSlot === slot) jobArmedSlot = 0;
    if (ctx.side === 'boss') {
        t.bossSlots = t.bossSlots || {};
        t.bossSlots[slot] = null;
        removed = jobPurgeSlotOnBoard(boardLate, slot);
        if (typeof jobCompactSlots === 'function') shifted = jobCompactSlots(t, true);
    } else {
        t.slots[slot] = '';
        removed = (typeof jobClearNormalSlot === 'function')
            ? jobClearNormalSlot(slot) : jobPurgeSlotOnBoard(boardEarly, slot);
        if (typeof jobCompactSlots === 'function') {
            shifted = jobCompactSlots(t, false);
            try { jobCompactSlots(t, true); } catch (e) { }     // boss 侧查漏
        }
    }
    return { removed: removed, shifted: shifted };
}

// 删掉所有表里的这一株（普通关槽位 + boss 覆盖槽 + 两侧落点），然后各自压实
function jobDeletePlantEverywhere(name) {
    const res = { tables: 0, normal: 0, boss: 0, placements: 0 };
    if (!name) return res;
    (jobTables || []).forEach(function (t) {
        if (!t) return;
        const bE = jobSideBoardOf(t, 'normal');
        const bL = jobSideBoardOf(t, 'boss');
        let hit = false;
        for (let s = 1; s <= 8; s++) {
            if (((t.slots && t.slots[s]) || '') !== name) continue;
            t.slots[s] = '';
            res.normal++;
            hit = true;
        }
        if (typeof jobBossSlotState === 'function') {
            for (let s = 1; s <= 8; s++) {
                if (jobBossSlotState(t, s) !== 'override') continue;
                if (t.bossSlots[s] !== name) continue;
                t.bossSlots[s] = null;
                res.boss++;
                hit = true;
            }
        }
        res.placements += jobPurgePlantOnBoard(bE, name);
        res.placements += jobPurgePlantOnBoard(bL, name);
        try { jobCompactSlots(t, false, bE); } catch (e) { }
        try { jobCompactSlots(t, true, bL); } catch (e) { }
        if (hit) res.tables++;
    });
    return res;
}

function _jobDeleteOption(icon, title, desc, onClick, danger) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px;padding:9px 12px;'
        + 'border:1px solid ' + (danger ? '#fecaca' : '#cbd5e1') + ';border-radius:9px;'
        + 'background:' + (danger ? '#fef2f2' : '#fff') + ';cursor:pointer;line-height:1.5;';
    b.innerHTML = '<div style="font-size:13px;font-weight:700;color:' + (danger ? '#b91c1c' : '#1e293b') + ';">'
        + icon + ' ' + title + '</div>'
        + '<div style="font-size:11px;color:#64748b;margin-top:2px;">' + desc + '</div>';
    b.addEventListener('click', onClick);
    return b;
}

function jobRenderPlantDelete() {
    const body = document.getElementById('pdBody');
    if (!body) return;
    body.innerHTML = '';
    const ctx = _jobDeleteCtx;
    if (!ctx || !ctx.name) return;
    const sideLbl = ctx.side === 'boss' ? 'boss 关' : '普通关';

    // 统计"所有表"里这一株的分布
    const locs = jobListPlantLocations(ctx.name);
    const otherTables = locs.filter(function (l) {
        return !(l.table === currentTable && (l.side === 'boss') === (ctx.side === 'boss'));
    });
    const totalSlots = locs.reduce(function (a, l) { return a + l.slots.length; }, 0);
    const totalPlant = locs.reduce(function (a, l) { return a + l.placements; }, 0);
    const whereText = locs.map(function (l) {
        return jobTableName(l.table) + '·' + (l.side === 'boss' ? 'boss关' : '普通关')
            + '（' + l.slots.length + ' 槽/' + l.placements + ' 株）';
    }).join('、') || '（没有找到）';

    const ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:12px;color:#334155;line-height:1.7;margin-bottom:10px;';
    ttl.innerHTML = '要删除 <b style="color:#b91c1c;">' + ctx.name + '</b>（当前在 '
        + jobTableName(currentTable) + ' · ' + sideLbl + ' 槽' + ctx.slot + '）：'
        + '<div style="font-size:11px;color:#64748b;margin-top:4px;">这张植物在全部表里的分布：'
        + whereText + '</div>';
    body.appendChild(ttl);

    body.appendChild(_jobDeleteOption('🗑', '只删这张表的这一株（' + sideLbl + '）',
        '只清掉 槽' + ctx.slot + '，后面的槽自动左移补位；其它表和另一侧都不受影响。',
        function () {
            const r = jobDeleteSlotHere(ctx);
            jobClosePlantDelete();
            jobAfterPlantChange('🗑️ 已删除「' + ctx.name + '」（' + jobTableName(currentTable) + ' · ' + sideLbl + ' 槽' + ctx.slot + '）'
                + (r.removed ? '，该侧棋盘 ' + r.removed + ' 个落点已移除' : '')
                + (r.shifted ? '；' + r.shifted + ' 个槽已左移补位' : '')
                + '　（Ctrl+Z 可撤销）');
        }, false));

    body.appendChild(_jobDeleteOption('🧨', '删掉所有表里的这一株',
        '共 ' + totalSlots + ' 个槽位、' + totalPlant + ' 个棋盘落点会被清掉（普通关 + boss 关），'
        + '涉及 ' + locs.length + ' 处；每个表各自压实。',
        function () {
            const r = jobDeletePlantEverywhere(ctx.name);
            jobClosePlantDelete();
            jobAfterPlantChange('🧨 已删除所有表里的「' + ctx.name + '」：'
                + r.tables + ' 张表 / 普通关 ' + r.normal + ' 槽 / boss 关 ' + r.boss + ' 槽 / '
                + r.placements + ' 个落点　（Ctrl+Z 可撤销）');
        }, true));

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#94a3b8;line-height:1.6;margin-top:2px;';
    tip.textContent = '提示：只删本表 = 只动当前关别；另一个关别（' + (ctx.side === 'boss' ? '普通关' : 'boss 关') + '）的配置不受影响。';
    body.appendChild(tip);
}

function jobBindPlantDelete() {
    const m = document.getElementById('plantDeleteModal');
    if (m) m.addEventListener('click', function (e) { if (e.target === m) jobClosePlantDelete(); });
    const close = document.getElementById('pdClose');
    if (close) close.addEventListener('click', jobClosePlantDelete);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (m && m.classList.contains('jp-open')) jobClosePlantDelete();
    });
}
