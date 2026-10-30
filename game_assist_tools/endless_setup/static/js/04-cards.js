
// ============================================================
// 4. 操作项定义
// ============================================================
const EARLY_CARDS = [];
for (let i=1; i<=8; i++) {
    const maxCount = (i === 1 || i === 2) ? 25 : 10;
    EARLY_CARDS.push({ id: `card${i}`, label: `卡${i}`, type: 'card', phase: 'early', single: false, maxCount: maxCount });
}

const EARLY_GUARD = [ { id: 'guard', label: '守卫菇', type: 'guard', phase: 'early', single: false, maxCount: 5 } ];
const EARLY_SHOVEL_BEFORE = [ { id: 'shovel_before', label: '铲子(前5)', type: 'shovel', phase: 'early', single: false, maxCount: 5 } ];
const EARLY_SHOVEL_AFTER = [ { id: 'shovel_after', label: '铲子(后5)', type: 'shovel', phase: 'early', single: false, maxCount: 5 } ];
const EARLY_FEED = [ { id: 'feed', label: '小关喂豆', type: 'feed', phase: 'early', single: true } ];
const EARLY_BOSS_FEED = [ { id: 'bossfeed', label: 'Boss喂豆', type: 'bossfeed', phase: 'early', single: true } ];

// 补植物操作项：卡槽2~8
const LATE_PATCH = [];
for (let slot=2; slot<=8; slot++) {
    const maxCount = (slot === 2 || slot === 3) ? 15 : 5;
    LATE_PATCH.push({
        id: `patch_slot${slot}`,
        label: `补卡${slot}`,
        type: 'patch',
        phase: 'late',
        single: false,
        maxCount: maxCount,
        slot: slot
    });
}

const LATE_SHOVEL = [ { id: 'shovel_late', label: '铲除', type: 'shovel', phase: 'late', single: false, maxCount: 5 } ];
const LATE_FEED = [ { id: 'feed_late', label: '小关喂豆', type: 'feed', phase: 'late', single: true } ];
const LATE_FEED_BALL = [ { id: 'feed_ball_late', label: '喂豆球果', type: 'feed', phase: 'late', single: true } ];
const LATE_BOSS_FEED = [
    { id: 'bossfeed_late', label: 'Boss喂豆', type: 'bossfeed', phase: 'late', single: true },
    { id: 'bossfeed2_late', label: 'Boss喂豆2', type: 'bossfeed', phase: 'late', single: true }
];
const LATE_FLOWER = [ { id: 'flower', label: '小关抛花', type: 'flower', phase: 'late', single: false, maxCount: 2 } ];
const LATE_BOSS_FLOWER = [ { id: 'bossflower', label: 'Boss抛花', type: 'bossflower', phase: 'late', single: false, maxCount: 4 } ];
const LATE_MAGIC = [
    { id: 'sweet1', label: '甜薯1', type: 'sweet', phase: 'late', single: true },
    { id: 'sweet2', label: '甜薯2', type: 'sweet', phase: 'late', single: true },
    { id: 'ganlan1', label: '甘蓝1', type: 'ganlan', phase: 'late', single: true },
    { id: 'ganlan2', label: '甘蓝2', type: 'ganlan', phase: 'late', single: true },
    { id: 'magicfeed', label: '魔甘前喂豆', type: 'magicfeed', phase: 'late', single: true }
];

const ALL_OPS = [
    ...EARLY_CARDS, ...EARLY_GUARD, ...EARLY_SHOVEL_BEFORE, ...EARLY_SHOVEL_AFTER,
    ...EARLY_FEED, ...EARLY_BOSS_FEED,
    ...LATE_PATCH, ...LATE_SHOVEL, ...LATE_FEED, ...LATE_FEED_BALL,
    ...LATE_BOSS_FEED, ...LATE_FLOWER, ...LATE_BOSS_FLOWER, ...LATE_MAGIC
];

let selectedOp = null;
let isBatchMode = true;

let opItemsList = [];
let keyboardSelectedIndex = -1;

// ===== 撤销/重做（2026-10-30 重构：整表状态快照）=====
//
// ★ 旧实现只存 { early, late } 两块棋盘数组，坑了两次：
//
//   ① **链条顺序不在棋盘数组里** —— 三条链的顺序存在表的
//      slotOrder / loopOrder / endOrder / boss*Order 上（见 jobStoreSteps）。
//      于是「拖动 chip 改顺序 → Ctrl+Z」撤掉的是**上一次落子**，
//      链顺序原封不动，而链段里记的 picked 下标是按落点位置算的 →
//      落点少一个、下标全部滑位 → 同一条链被拆成两段（用户反馈的
//      「落子撤销后重新落子，顺序链结构不一致」）。
//
//   ② **快照不认上下文** —— jobLoadTable() 会把 boardEarly/boardLate
//      整个换成新表的深拷贝，但撤销栈没清。切表/换作业集之后按 Ctrl+Z，
//      上一张表的棋盘就被灌进当前表（数据静默串表）。
//
// ★ 现在的模型：
//   · 快照 = { 两块棋盘 + 当前表的可编辑字段（去掉表身份字段） }，
//     表身份（表名/覆盖关系/色块/头像）归「布局配置」弹窗自己的撤销管，不进来；
//   · 栈顶 == 当前状态（「记录即所见」）：任何改动后调 jobUndoRecord()，
//     内容没变就自动去重（同一个 sig 不会压两条）；
//   · 快照带 `ctx`（作业集 code + 表序号）。上下文一变就**清栈**，
//     宁可不让撤，也绝不撤错表；
//   · 撤销/重做都走 jobUndoApply()，把棋盘和链条**同时**还原再统一重绘，
//     并且顺手 jobSaveLocal()，保证「视图 == 引擎读到的 == 本地缓存」。
const JOB_UNDO_MAX = 60;
// 表的「身份字段」：不进撤销快照（布局配置弹窗有它自己的 Ctrl+Z）
const JOB_UNDO_TABLE_IDENTITY = ['label', 'cover', 'levels', 'colorIdx', 'color', 'iconPlant', 'iconMode'];

let undoStack = [];
let redoStack = [];
let _jobUndoLock = false;      // 还原期间禁止记录（防止还原动作自己入栈）

function jobUndoCtx() {
    const code = (typeof jobMeta !== 'undefined' && jobMeta) ? String(jobMeta.code || '') : '';
    return code + '#' + String(currentTable);
}

// 拍一张当前状态快照（没有表/棋盘时返回 null）
function jobUndoSnapshot() {
    if (typeof jobTables === 'undefined' || !jobTables || !jobTables[currentTable]) return null;
    if (typeof boardEarly === 'undefined' || !boardEarly) return null;
    const t = jobTables[currentTable];
    const copy = JSON.parse(JSON.stringify(t));
    // 棋盘单独拍（t.boardEarly/boardLate 是 300ms 防抖后才落的旧拷贝，不能当真值）
    delete copy.boardEarly;
    delete copy.boardLate;
    JOB_UNDO_TABLE_IDENTITY.forEach(function (k) { delete copy[k]; });
    const early = JSON.parse(JSON.stringify(boardEarly));
    const late = (typeof boardLate !== 'undefined' && boardLate)
        ? JSON.parse(JSON.stringify(boardLate)) : null;
    return {
        ctx: jobUndoCtx(),
        boardEarly: early,
        boardLate: late,
        t: copy,
        sig: JSON.stringify([early, late, copy])
    };
}

// 记录「当前状态」。内容与栈顶相同 -> 直接跳过（去重）。
// ★ 所有会改数据的入口最终都会走 jobSaveLocal()，那里统一记录；
//   saveBoardState() 保留为同名别名，老的落子/清盘调用点不用改。
function jobUndoRecord() {
    if (_jobUndoLock) return;
    const snap = jobUndoSnapshot();
    if (!snap) return;
    const top = undoStack[undoStack.length - 1];
    if (top && top.ctx === snap.ctx && top.sig === snap.sig) return;     // 没有新改动
    if (top && top.ctx !== snap.ctx) { undoStack = []; redoStack = []; } // 换了表/作业集 -> 旧栈作废
    undoStack.push(snap);
    if (undoStack.length > JOB_UNDO_MAX) undoStack.shift();
    redoStack = [];                                                     // 有新改动 -> 重做作废
}

// 落子失败等「白记了一笔」的场景：栈顶若就是当前状态，撤掉它
function jobUndoDiscard() {
    const snap = jobUndoSnapshot();
    const top = undoStack[undoStack.length - 1];
    if (snap && top && top.ctx === snap.ctx && top.sig === snap.sig) undoStack.pop();
}

// 换表 / 换作业集 / 清空编辑器后重置撤销栈（并记录新基线）
function jobUndoReset() {
    undoStack = [];
    redoStack = [];
    jobUndoRecord();
}

// 把一份快照还原到编辑器（棋盘 + 表字段一起换，再统一重绘）
function jobUndoApply(snap) {
    if (!snap || snap.ctx !== jobUndoCtx()) return false;
    const t = jobTables[currentTable];
    if (!t) return false;
    _jobUndoLock = true;
    try {
        // 表：保留身份字段，其余整体换成快照内容
        const keep = {};
        JOB_UNDO_TABLE_IDENTITY.forEach(function (k) { if (t[k] !== undefined) keep[k] = t[k]; });
        Object.keys(t).forEach(function (k) { delete t[k]; });
        Object.assign(t, JSON.parse(JSON.stringify(snap.t)));
        JOB_UNDO_TABLE_IDENTITY.forEach(function (k) { if (keep[k] !== undefined) t[k] = keep[k]; });
        // 棋盘
        boardEarly = JSON.parse(JSON.stringify(snap.boardEarly));
        if (snap.boardLate) boardLate = JSON.parse(JSON.stringify(snap.boardLate));
        // 表里那份棋盘拷贝也同步成还原后的真值（导出/存盘不经过渲染，会直接读它）
        t.boardEarly = JSON.parse(JSON.stringify(boardEarly));
        t.boardLate = JSON.parse(JSON.stringify(boardLate));
        if (typeof jobEnsureSeq === 'function') {
            try { jobEnsureSeq(boardEarly); } catch (e) { }
            try { jobEnsureSeq(boardLate); } catch (e) { }
        }
        // 视图层缓存必须清掉：uid 配对缓存 / 勾选集合 / 落子闪光都指向旧对象
        if (typeof _jobLastSteps !== 'undefined' && _jobLastSteps) {
            _jobLastSteps.once = null;
            _jobLastSteps.loop = null;
            _jobLastSteps.end = null;
        }
        if (typeof jobSeqSel !== 'undefined') jobSeqSel = {};
        if (typeof jobLastDrop !== 'undefined') jobLastDrop = null;
        // 重绘（逐项 try：任何一块失败都不能让撤销整体报废）
        try { renderAllBoards(); } catch (e) { console.warn('[undo] renderAllBoards', e); }
        try { jobRenderTabs(); } catch (e) { }
        try { jobFillForm(); } catch (e) { }
        try { jobRenderSlots(); } catch (e) { }
        try { jobRenderSeqChains(); } catch (e) { }
        try { updatePreview(); } catch (e) { }
        try { jobSaveLocal(); } catch (e) { }       // 视图 == 本地缓存
    } finally {
        _jobUndoLock = false;
    }
    return true;
}

// 兼容老调用点（落子/清盘前拍快照）
function saveBoardState() { jobUndoRecord(); }

function undoBoard() {
    if (_jobUndoLock) return;
    jobUndoRecord();                                   // 让栈顶变成当前状态
    const cur = undoStack[undoStack.length - 1];
    if (!cur || cur.ctx !== jobUndoCtx()) {
        jobUndoReset();
        setStatus('↩ 撤销栈已随「换表 / 换作业集」重置（不会跨表撤销）');
        return;
    }
    if (undoStack.length < 2) { setStatus('↩ 没有可撤销的操作了'); return; }
    const prev = undoStack[undoStack.length - 2];
    if (!jobUndoApply(prev)) { setStatus('⚠️ 撤销失败（状态对不上）'); return; }
    undoStack.pop();                                   // 还原成功才真的出栈
    redoStack.push(cur);
    setStatus('↩ 已撤销');
}

function redoBoard() {
    if (_jobUndoLock) return;
    if (!redoStack.length) { setStatus('↪ 没有可重做的操作了'); return; }
    const next = redoStack[redoStack.length - 1];
    if (next.ctx !== jobUndoCtx()) {
        jobUndoReset();
        setStatus('↪ 重做栈已随「换表 / 换作业集」重置');
        return;
    }
    jobUndoRecord();                                   // 让栈顶变成当前状态
    if (!jobUndoApply(next)) { setStatus('⚠️ 重做失败（状态对不上）'); return; }
    redoStack.pop();
    undoStack.push(next);
    setStatus('↪ 已重做');
}

function getVisibleOpItems() {
    const container = document.getElementById('opPanel');
    // opPanel 已在早期 UI 清理中移除 —— 这里返回空数组而不是抛错，
    // 避免调用方（键盘导航等）中断 window.onload 后续的事件绑定。
    if (!container) return [];
    const items = container.querySelectorAll('.op-item');
    const visible = [];
    items.forEach(el => {
        let parent = el.closest('.op-section');
        if (parent && parent.style.display !== 'none') {
            visible.push(el);
        }
    });
    return visible;
}

function updateKeyboardSelection() {
    document.querySelectorAll('.op-item').forEach(el => {
        el.classList.remove('keyboard-selected');
    });
    if (keyboardSelectedIndex >= 0 && keyboardSelectedIndex < opItemsList.length) {
        const el = opItemsList[keyboardSelectedIndex];
        el.classList.add('keyboard-selected');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const opId = el.dataset.id;
        const op = ALL_OPS.find(o => o.id === opId);
        if (op) {
            if (!selectedOp || selectedOp.id !== opId) {
                setSelected(op);
                updateSelectedUI();
            }
        }
    }
}

function moveKeyboardSelection(delta) {
    opItemsList = getVisibleOpItems();
    if (opItemsList.length === 0) {
        keyboardSelectedIndex = -1;
        updateKeyboardSelection();
        return;
    }
    if (keyboardSelectedIndex < 0 || keyboardSelectedIndex >= opItemsList.length) {
        keyboardSelectedIndex = delta > 0 ? 0 : opItemsList.length - 1;
    } else {
        keyboardSelectedIndex += delta;
        if (keyboardSelectedIndex < 0) keyboardSelectedIndex = opItemsList.length - 1;
        if (keyboardSelectedIndex >= opItemsList.length) keyboardSelectedIndex = 0;
    }
    updateKeyboardSelection();
}

function resetKeyboardNavigation() {
    opItemsList = getVisibleOpItems();
    if (selectedOp) {
        const foundIdx = opItemsList.findIndex(el => el.dataset.id === selectedOp.id);
        if (foundIdx >= 0) keyboardSelectedIndex = foundIdx;
        else keyboardSelectedIndex = opItemsList.length > 0 ? 0 : -1;
    } else {
        keyboardSelectedIndex = opItemsList.length > 0 ? 0 : -1;
    }
    updateKeyboardSelection();
}

document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const key = (e.key || '').toLowerCase();

    // ★ 撤销/重做快捷键（2026-10-30）：
    //   弹窗开着时**不抢** —— 例如「布局配置」里有它自己的 Ctrl+Z，
    //   以前两边的 document 级监听会同时触发，一次 Ctrl+Z 既撤销布局
    //   又撤销主棋盘（撤销"串面板"）。弹窗未接管时（没有自己的撤销）
    //   照旧走这里。
    const hotkeyBlocked = (typeof jobHotkeyBlocked === 'function') && jobHotkeyBlocked(e);

    // 撤销/重做快捷键
    if (e.ctrlKey && key === 'z' && !e.shiftKey) {
        if (hotkeyBlocked) return;
        e.preventDefault();
        undoBoard();
        return;
    }
    if (e.ctrlKey && (key === 'y' || (key === 'z' && e.shiftKey))) {
        if (hotkeyBlocked) return;
        e.preventDefault();
        redoBoard();
        return;
    }

    // 下面这套是旧选项树的键盘导航（opPanel 已移除，实际是空操作）——
    // 弹窗开着时一并让开，别再抢方向键。
    if (hotkeyBlocked) return;

    if (key === 'w' || key === 'arrowup') {
        e.preventDefault();
        moveKeyboardSelection(-1);
        return;
    }
    if (key === 's' || key === 'arrowdown') {
        e.preventDefault();
        moveKeyboardSelection(1);
        return;
    }
    if (key === 'a' || key === 'arrowleft') {
        e.preventDefault();
        const tabEarly = document.querySelector('.tab[data-tab="early"]');
        if (tabEarly && !tabEarly.classList.contains('active')) {
            tabEarly.click();
            setTimeout(() => resetKeyboardNavigation(), 50);
        }
        return;
    }
    if (key === 'd' || key === 'arrowright') {
        e.preventDefault();
        const tabLate = document.querySelector('.tab[data-tab="late"]');
        if (tabLate && !tabLate.classList.contains('active')) {
            tabLate.click();
            setTimeout(() => resetKeyboardNavigation(), 50);
        }
        return;
    }
    if (key === 'enter' || key === ' ') {
        e.preventDefault();
        if (selectedOp) {
            clearSelected();
            updateSelectedUI();
        }
        return;
    }
});
