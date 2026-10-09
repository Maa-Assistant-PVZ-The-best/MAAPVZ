
// ============================================================
// 种植顺序链条：拖动整块，决定「先种哪个槽」
// 顺序存放在 t.slotOrder（该表专属），运行时按此顺序执行
// ============================================================
let seqDrag = null;   // { kind, key, which, ... } 正在拖动的槽 / 等待 / 单株
let jobSeqSel = {};   // 顺序链里勾选的落点：{ 'once:card1#3': {key,gidx,which}, ... }（用于批量拖出）

// 一个槽的稳定标识：植物槽是 'card<N>'，落子动作（喂豆/铲子/点击格子…）
// 直接用它的 id。
//   ★ 由注册表驱动：新增落子动作自动被认出来，不需要在这里加分支。
//     （以前写死 feed|shovel，新动作会被错认成 'card<数字>'。）
function jobSlotKeyOf(s) {
    if (typeof jobBoardActionById === 'function' && jobBoardActionById(s)) return String(s);
    if (typeof jobBoardActionByArmedNo === 'function') {
        const act = jobBoardActionByArmedNo(s);
        if (act) return act.id;
    }
    return 'card' + s;
}

// 该槽在棋盘上是否落了子
function jobSlotHasPlacement(board, key) {
    return jobCollectSlot(board, key).length > 0;
}

// 某槽已落点数量
function jobSlotCount(board, key) { return jobCollectSlot(board, key).length; }

// 收集某槽在棋盘上的全部落点（按当前 seq 排序）
function jobCollectSlot(board, scopeId) {
    const out = [];
    if (!board) return out;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach((it, i) => {
                if (it.id === scopeId) out.push({ r: r, c: c, idx: i, item: it });
            });
        }
    }
    out.sort(function (a, b) {
        const qa = (typeof a.item.seq === 'number') ? a.item.seq : 9999;
        const qb = (typeof b.item.seq === 'number') ? b.item.seq : 9999;
        return qa - qb;
    });
    return out;
}

// 全部槽位键：槽1~8 + 所有注册的落子动作（喂豆/铲子/点击格子/未来扩展）
//   ★ 落子动作来自 JOB_BOARD_ACTIONS 注册表（15-board-actions.js）——
//     新增一个动作会自动出现在这里，本函数不需要改。
function jobAllSlotKeys() {
    const a = [];
    for (let s = 1; s <= 8; s++) a.push('card' + s);
    if (typeof JOB_BOARD_ACTIONS !== 'undefined') {
        JOB_BOARD_ACTIONS.forEach(function (act) {
            if (act && act.id) a.push(act.id);
        });
    } else {
        a.push('feed');       // 注册表没加载时的兜底
        a.push('shovel');
    }
    return a;
}

// 该槽位键是不是「落子动作」（喂豆/铲子/点击格子…），是则返回定义
function jobBoardActionOfKey(key) {
    if (typeof jobBoardActionById !== 'function') return null;
    return jobBoardActionById(key);
}

// 该槽位键是不是「点一下格子」类的动作（不需要卡槽起点）
function jobIsTapKey(key) {
    const act = jobBoardActionOfKey(key);
    return !!act && act.dslType === 'tap';
}

// 该槽位键在「所有形态」下的落点总数（用于判断要不要显示它的 chip）
//   boss 关没有收尾，所以那里只数 once/loop。
function jobPlacementCountAllModes(key, boss) {
    const modes = boss ? ['once', 'loop'] : JOB_SLOT_MODES;
    const board = boss ? boardLate : boardEarly;
    let n = 0;
    modes.forEach(function (m) {
        n += jobPlacementsOf(board, key, m).length;
    });
    return n;
}

// ★ 落子动作是否「在棋盘里」——决定它要不要**常驻**在左侧面板。
//
//   规则（用户要求）：
//     · 「更多」里选过的动作，只要**该关棋盘上还留着它的落子**，就常驻显示；
//     · 否则不显示（左侧保持干净），W/S 也**不能**循环到它。
//     · 普通关与 boss 关**各自独立**统计 —— 各自读自己的那张 board，
//       所以在普通关放了「点击格子」不会让 boss 关也常驻，反之亦然。
//     · 与形态无关：单次 / 循环 / 收尾 任意一种形态下落了子都算
//       （boss 关没有收尾，只数 once/loop）。
//
//   注意 boardEarly / boardLate 是全局棋盘引用，跟当前 tab 无关 ——
//   所以必须显式传 boss，不能依赖 jobIsBossBoard()（那只反映当前 tab）。
function jobBoardActionHasPlacement(act) {
    if (!act) return false;
    const key = act.id || act;
    return jobPlacementCountAllModes(key, jobIsBossBoard()) > 0;
}

// W/S 可否循环到某个落子动作 —— 内置动作（喂豆/铲子）永远可以；
// 扩展动作必须已落在当前关的棋盘上。
function jobBoardActionCycleable(act) {
    if (!act) return false;
    if (act.builtin) return true;
    return jobBoardActionHasPlacement(act);
}

// 该槽当前的放置形态：'once'（单次，默认）| 'loop'（循环）| 'end'（收尾）
// ★ 普通关与 boss 关各自独立的形态表（跟当前编辑的 tab 走）
// ★ boss 关不能有收尾：boss 棋盘下 end 一律归一化回 loop。
function jobSlotMode(t, key) {
    const f = jobModesField();
    const m = (t && t[f]) ? t[f][key] : null;
    const modes = jobIsBossBoard() ? ['once', 'loop'] : JOB_SLOT_MODES;
    if (jobIsBossBoard() && m === 'end') return 'loop';   // boss 无收尾 -> 归循环
    return modes.indexOf(m) === -1 ? 'once' : m;
}
// 三个形态是各自独立的摆放；形态决定棋盘标记颜色与所属链
function jobInOnce(t, key) { return jobSlotMode(t, key) === 'once'; }
function jobInLoop(t, key) { return jobSlotMode(t, key) === 'loop'; }
function jobInEnd(t, key)  { return jobSlotMode(t, key) === 'end'; }

// 右键：切换放置形态。
// 普通关在「单次 → 循环 → 收尾」之间循环；
// boss 关**没有收尾**，只在「单次 ↔ 循环」之间切换（end 会先归一化回 loop）。
function jobToggleSlotMode(t, key) {
    const f = jobModesField();
    if (!t[f]) t[f] = {};
    const modes = jobIsBossBoard() ? ['once', 'loop'] : JOB_SLOT_MODES;
    const cur = jobSlotMode(t, key);          // 已经归一化（boss 下 end→loop）
    const i = modes.indexOf(cur);
    const next = modes[(i + 1) % modes.length];
    t[f][key] = next;
    return next;
}

// 归一化 boss 关槽位形态：把残留的「收尾」形态改回「循环」（上一个合法形态）。
// 切换到 boss 关 tab 时立即调用，确保 boss 关槽位不再有收尾形态。
// 返回是否有改动（true = 改了，调用方需要 saveLocal 重存）。
function jobNormalizeBossEndModes() {
    const t = jobTables[currentTable];
    if (!t) return false;
    const modes = t.bossSlotModes;
    if (!modes || typeof modes !== 'object') return false;
    const keys = jobAllSlotKeys();
    let any = false;
    keys.forEach(function (key) {
        if (modes[key] === 'end') {
            modes[key] = 'loop';   // 回到上一个（循环）
            any = true;
        }
    });
    return any;
}

function jobModeLabel(m) {
    if (m === 'once') return '单次';
    if (m === 'end') return '收尾';
    return '循环';
}

// 棋盘落点的形态：item.mode（'once' | 'loop' | 'end'）
function jobItemMode(it) {
    const m = it && it.mode;
    return JOB_SLOT_MODES.indexOf(m) !== -1 ? m : 'loop';
}
