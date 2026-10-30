// ============================================================
// 回归测试：撤销与链条的一致性 + boss 关与普通关的植物分离
//   （2026-10-30 那两个用户实报 bug 的确定性回归）
//
// 运行：node tests\repro_undo_boss.js
// 退出码：0 = 全过；1 = 有断言失败
//
// 要点（为什么这些断言必须存在）：
//   · 撤销以前只回滚两块棋盘数组，链条顺序（slotOrder/loopOrder/…）不回滚
//     -> 拖过 chip 再 Ctrl+Z，链被拆成两段、顺序乱掉（用户："落子撤销后
//        重新落子，顺序链结构会不一致"）。
//   · 撤销栈以前不认表/作业集，切表后 Ctrl+Z 会把上一张表的棋盘灌进当前表。
//   · boss 关槽位以前是「沿用」时跟着普通关走，普通关换植物会把 boss 关
//     棋盘上已经落好的植物一起改掉（用户："boss 关植物和普通关分离不彻底"）。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS_DIR = path.join(__dirname, '..', 'static', 'js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(actual, expect, msg) {
    ok(actual === expect, msg + '（实际=' + JSON.stringify(actual) + '，期望=' + JSON.stringify(expect) + '）');
}

// 加载真实编辑器 JS（Node + vm，DOM 全部打桩）
function mkSandbox() {
    const sandbox = {
        console,
        document: {
            addEventListener() { }, getElementById() { return null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() {
                return { style: {}, appendChild() { }, addEventListener() { },
                    classList: { add() { }, remove() { }, contains() { return false; } } };
            },
            head: { appendChild() { } },
        },
        localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
        alert() { }, setTimeout() { return 0; }, clearTimeout() { },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['04-cards.js', '08-board-data.js', '15-board-actions.js', '20-jobset-core.js',
        '21-jobset-levels.js', '22-jobset-chain.js', '24-jobset-fields.js', '27-jobset-board.js',
        '29-jobset-init.js']) {
        try {
            vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
        } catch (e) {
            console.log('LOAD ' + f + ': ' + e.message);
        }
    }
    // 渲染相关全部打桩；jobSaveLocal 保留真身（撤销记录挂在它上面）
    vm.runInContext(`
renderAllBoards = function(){};
updatePreview = function(){};
setStatus = function(){};
jobRenderSeqChains = function(){};
jobRenderSlots = function(){};
jobFillForm = function(){};
jobRenderTabs = function(){};
jobRenderEndParams = function(){};
jobRenderMech = function(){};
jobRenderRefGhosts = function(){};
jobRefreshBossLineupUI = function(){};
jobTables.length = 0;
jobNewTable();
var T = jobTables[0];
plantCache = [
  { name: '豌豆射手', img: 'a.png', rare: 0 },
  { name: '坚果墙',   img: 'b.png', rare: 0 }
];
function cnt(board){ var n=0; board.forEach(function(row){ row.forEach(function(c){ n+=c.length; }); }); return n; }
// 用喂豆当落子动作（不依赖槽位植物），落在指定形态链里
function dropFeed(board, r, c, mode){
  var act = jobBoardActionByArmedNo(9);
  board[r][c].push(jobBoardActionItem(act, mode || 'loop', r, c,
      jobNextSeq(board, 'feed', mode || 'loop')));
  jobSaveLocal();
}
function store(which){ jobStoreSteps(T, which, boardEarly, jobResolveSteps(T, which, boardEarly)); jobSaveLocal(); }
function cellsOf(which){
  return jobResolveSteps(T, which, boardEarly).map(function(s){
    var pl = jobPlacementsOf(boardEarly, s.key, which)[s.gidx];
    return pl ? (pl.item.row + '-' + pl.item.col) : '??';
  }).join(',');
}
function feedSegCount(which){
  return (T[which + 'Order'] || []).filter(function(s){ return s.key === 'feed'; }).length;
}
`, sandbox);
    return sandbox;
}

// ============================================================
// A. 落子 -> 拖动重排 -> 撤销 -> 重新落子：链结构必须保持"一段、按序"
// ============================================================
console.log('A. 撤销与链条一致性');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
dropFeed(boardEarly, 0, 0);           // 喂豆 1-1
dropFeed(boardEarly, 1, 1);           // 喂豆 2-2
store('loop');
var before = { cells: cellsOf('loop'), segs: feedSegCount('loop') };
T.loopOrder = [{ key: 'feed', picked: [1, 0] }];     // 拖 chip：块内顺序反转
jobSaveLocal();
var afterDrag = cellsOf('loop');
undoBoard();                                          // 撤销这一次拖拽
var afterUndo = { cells: cellsOf('loop'), segs: feedSegCount('loop'), n: cnt(boardEarly) };
dropFeed(boardEarly, 2, 2);                           // 重新落子
store('loop');
({ before: before, afterDrag: afterDrag, afterUndo: afterUndo,
   final: { cells: cellsOf('loop'), segs: feedSegCount('loop'), n: cnt(boardEarly) } });
`, s);

    eq(r.before.cells, '1-1,2-2', '两个喂豆按落子顺序进链');
    eq(r.afterDrag, '2-2,1-1', '拖动后块内顺序反转（链跟随）');
    eq(r.afterUndo.cells, '1-1,2-2', 'Ctrl+Z 撤销的是"拖动"，链顺序回到拖动前');
    eq(r.afterUndo.n, 2, '撤销拖动不会吃掉落点（仍是 2 个）');
    eq(r.final.n, 3, '重新落子后棋盘 3 个落点');
    eq(r.final.cells, '1-1,2-2,3-3', '重新落子接在链尾，顺序与落子一致');
    eq(r.final.segs, 1, '同槽落点仍是**一段**（不会被拆成两段）');
}

// ============================================================
// A2. 用户原话的最短路径：落子 -> 撤销 -> 重新落子
//     （中间没有拖拽，链也必须仍然是"一段、按序"）
// ============================================================
console.log('A2. 落子 -> 撤销 -> 重新落子（最短路径）');
{
    const s = mkSandbox();
    // ★ 这里**不**手动 store()：真实用户只落子、不动链条时，链是由棋盘派生的
    //   （jobResolveSteps 的"补位"分支），segs 还是 null。所以撤销一步就该
    //   撤掉最后一个落子。
    const r = vm.runInContext(`
dropFeed(boardEarly, 0, 0);
dropFeed(boardEarly, 1, 1);
var full = { cells: cellsOf('loop'), n: cnt(boardEarly) };
undoBoard();                          // 撤销掉第二个落子
var mid = { cells: cellsOf('loop'), n: cnt(boardEarly), segs: feedSegCount('loop') };
dropFeed(boardEarly, 0, 2);           // 重新落子（换一格）
({ full: full, mid: mid, final: { cells: cellsOf('loop'), n: cnt(boardEarly), segs: feedSegCount('loop') } });
`, s);
    eq(r.full.n, 2, '落子后 2 个落点');
    eq(r.mid.n, 1, '撤销后只剩 1 个落点');
    eq(r.mid.cells, '1-1', '撤销后链只剩第 1 个落点');
    eq(r.final.n, 2, '重新落子后 2 个落点');
    eq(r.final.cells, '1-1,1-3', '重新落子接在链尾（顺序 = 落子先后）');
    eq(r.final.segs, 0, '同槽落点仍是一段（派生视图不会把同槽拆开）');
}

// ============================================================
// A3. 撤销 -> 重做：必须完全回到撤销前
// ============================================================
console.log('A3. 撤销 -> 重做');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
dropFeed(boardEarly, 2, 2);
store('loop');
var before = { cells: cellsOf('loop'), n: cnt(boardEarly) };
T.loopOrder = [{ key: 'feed', picked: [] }];      // 造一个明显的改动（清空链）
jobSaveLocal();
undoBoard();
redoBoard();
({ before: before, after: { cells: cellsOf('loop'), n: cnt(boardEarly) } });
`, s);
    eq(r.after.n, r.before.n, '重做后落点数与撤销前一致');
    eq(r.after.cells, r.before.cells, '重做后链与撤销前一致');
}

// ============================================================
// B. 撤销栈不跨表：切表后 Ctrl+Z 绝不把上一张表的棋盘灌进来
// ============================================================
console.log('B. 撤销栈不跨表 / 不跨作业集');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
dropFeed(boardEarly, 4, 8);           // 表1 落子
store('loop');
var t1 = cnt(boardEarly);
jobNewTable();                        // 新建表2
jobLoadTable(1, true);
var t2Before = { n: cnt(boardEarly), cells: cellsOf('loop'), depth: undoStack.length };
undoBoard();                          // 表2 上按 Ctrl+Z
var t2After = { n: cnt(boardEarly), cells: cellsOf('loop') };
({ t1: t1, t2Before: t2Before, t2After: t2After });
`, s);
    eq(r.t1, 1, '表1 有 1 个落点');
    eq(r.t2Before.n, 0, '切到表2 后棋盘是空的');
    eq(r.t2After.n, 0, '表2 上 Ctrl+Z 不会把表1 的落点灌进来');
    eq(r.t2After.cells, '', '表2 的链仍然是空的');
}

// ============================================================
// C. boss 关与普通关植物分离
//    C1 boss 落子 = 固化成显式覆盖
//    C2 普通关换植物不动 boss 棋盘
//    C3 普通关清槽不动 boss 棋盘
// ============================================================
console.log('C. boss 关 / 普通关植物分离');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
T.slots[3] = '豌豆射手';
jobLoadTable(0, true);
placePlantOnBoard(boardEarly, 3, 0, 0);      // 普通关落一株
jobSaveLocal();
var inheritBefore = (T.bossSlots || {})[3] === undefined;
placePlantOnBoard(boardLate, 3, 1, 1);       // boss 关落一株（此刻还是"沿用"）
jobSaveLocal();
var frozen = {
  override: T.bossSlots[3],
  bossBoard: (boardLate[1][1][0] || {}).label,
  bossName: jobSlotNameCtx(T, 3, true)
};
// 普通关把槽3 换成坚果墙（走 jobConfirmPick 的同一条同步路径）
T.slots[3] = '坚果墙';
jobSyncNormalSlotPlant(3, '坚果墙');
jobSaveLocal();
var afterChange = {
  bossBoard: (boardLate[1][1][0] || {}).label,
  bossName: jobSlotNameCtx(T, 3, true),
  normalBoard: (boardEarly[0][0][0] || {}).label,
  normalName: jobSlotNameCtx(T, 3, false),
  differ: jobBossSlotsDiffer(T)
};
// 普通关清空槽3：boss 关棋盘不受影响
T.slots[3] = '';
jobClearNormalSlot(3);
jobSaveLocal();
var afterClear = {
  bossBoard: (boardLate[1][1][0] || {}).label,
  bossName: jobSlotNameCtx(T, 3, true),
  normalBoardCount: cnt(boardEarly)
};
({ inheritBefore: inheritBefore, frozen: frozen, afterChange: afterChange, afterClear: afterClear });
`, s);

    ok(r.inheritBefore, 'C1 落子前 boss 槽3 是「沿用」状态');
    eq(r.frozen.override, '豌豆射手', 'C1 boss 落子后固化成显式覆盖（值=那一刻的植物）');
    eq(r.frozen.bossBoard, '豌豆射手', 'C1 boss 棋盘显示这株植物');
    eq(r.afterChange.bossBoard, '豌豆射手', 'C2 普通关换成坚果墙后，boss 棋盘仍是豌豆射手');
    eq(r.afterChange.bossName, '豌豆射手', 'C2 boss 有效植物名仍是豌豆射手');
    eq(r.afterChange.normalBoard, '坚果墙', 'C2 普通关棋盘跟着槽位变坚果墙');
    eq(r.afterChange.normalName, '坚果墙', 'C2 普通关有效植物名是坚果墙');
    ok(r.afterChange.differ, 'C2 此时 boss 与普通关不一致 -> 应走 boss 独立阵容');
    eq(r.afterClear.bossBoard, '豌豆射手', 'C3 普通关清空槽3 后，boss 关棋盘仍是豌豆射手');
    eq(r.afterClear.bossName, '豌豆射手', 'C3 boss 有效植物名仍是豌豆射手');
    eq(r.afterClear.normalBoardCount, 0, 'C3 普通关棋盘已清空');
}

console.log('');
if (fails) {
    console.log('❌ 共 ' + fails + ' 条断言失败');
    process.exit(1);
}
console.log('✅ 全部通过（撤销/链条一致性 + boss 关植物分离）');
