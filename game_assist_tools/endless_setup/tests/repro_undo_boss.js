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
        '21-jobset-levels.js', '22-jobset-chain.js', '24-jobset-fields.js', '27a-jobset-steps.js', '27b-jobset-stepcfg.js', '27c-jobset-chain-render.js', '27d-jobset-slots.js', '27e-jobset-hotkeys.js', '27f-jobset-export.js',
        '29-jobset-init.js', '31-jobset-adv.js', '25-jobset-supply.js', '26-jobset-supply-pick.js',
        '47-jobset-overview.js']) {
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

// ============================================================
// D. 失败后行为：**每张表单独设**（2026-11-02）
//    缺省 '' = 跟随 MAA 全局选项（runtime 不注入 -> 旧作业集行为一字不差）
// ============================================================
console.log('D. 失败后行为（failAfter 每表独立）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
      jobTables.length = 0; jobNewTable(); jobNewTable();
      var dft = jobTables[0].failAfter;
      var norm = {
        empty: jobNormFailAfter(''),
        stop:  jobNormFailAfter('stop'),
        reset: jobNormFailAfter('reset'),
        cont:  jobNormFailAfter('continue'),
        bad:   jobNormFailAfter('乱写'),
        cn:    jobNormFailAfter('重置后继续打'),
        undef: jobNormFailAfter(undefined),
        nul:   jobNormFailAfter(null)
      };
      // 两张表互不影响
      jobTables[0].failAfter = 'reset';
      jobTables[1].failAfter = 'continue';
      ({ dft: dft, norm: norm,
         t0: jobTables[0].failAfter, t1: jobTables[1].failAfter });
`, s);
    ok(r.dft === 'stop', 'D1 新建表默认「停止任务」（MAA 那个 option 已删，默认由网页定）');
    ok(JSON.stringify([r.norm.stop, r.norm.reset, r.norm.cont])
        === JSON.stringify(['stop', 'reset', 'continue']),
        'D2 三个合法值原样保留（实际=' + JSON.stringify([r.norm.stop, r.norm.reset,
            r.norm.cont]) + '）');
    ok(r.norm.empty === 'stop' && r.norm.bad === 'stop' && r.norm.cn === 'stop',
        'D3 空串 / 非法值 / 中文显示名 -> 一律归一成 stop（绝不落非法值进 JSON）');
    ok(r.norm.undef === 'stop' && r.norm.nul === 'stop',
        'D4 undefined / null（旧作业集没这个字段）-> stop = 与旧行为一致');
    ok(r.t0 === 'reset' && r.t1 === 'continue',
        'D5 每张表各自独立，互不覆盖');
}

// ============================================================
// E. 表设置总览（47-jobset-overview.js）：数据层 + 写入口
//    jobOverviewTables() 读、jobOverviewApply() 写 —— 都不碰 DOM，所以能在这里测。
// ============================================================
console.log('E. 表设置总览（jobOverviewTables / jobOverviewApply）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
      jobTables.length = 0; jobNewTable(); jobNewTable();
      jobTables[0].failAfter = 'reset';
      jobTables[0].lineupMode = 'deck'; jobTables[0].deckNo = 3;
      jobTables[0].slots = { 1: '豌豆射手', 2: '向日葵' };
      jobTables[0].supplyPicks = [
        { id: 'all', name: '全部植物', img: '全部植物.png' },
        { id: 'orange', name: '橙色植物', img: '橙色植物.png' },
        { id: 'artifact', name: '神器', img: '神器.png' },
        { id: 'view', name: '查看', img: '查看.png', pinned: true }   // ★ 无顺序项
      ];
      jobTables[1].bossLineupMode = 'deck'; jobTables[1].bossDeckNo = 5;
      var ovRows = jobOverviewTables();
      // 写入口：改第 2 张表的 失败后 + boss 编队号（越界要夹住）
      var ok1 = jobOverviewApply(1, 'failAfter', 'continue');
      var ok2 = jobOverviewApply(1, 'bossDeckNo', 99);
      var ok3 = jobOverviewApply(1, 'bossDeckNo', 99);   // 第二次没变 -> false
      var ok4a = jobOverviewApply(1, 'lineupMode', 'deck'); // 先切成编队
      var ok4 = jobOverviewApply(1, 'lineupMode', '乱写');  // 再喂非法值 -> 归一成 plants
      var ok5 = jobOverviewApply(99, 'failAfter', 'stop'); // 越界表 -> false
      // 补给：按指定表 toggle（第 1 张表）
      var sup0 = jobSupplyList(jobTables[0]).length;
      var supAdd = jobOverviewToggleSupply(0, 'cucumber');       // 未选 -> 追加
      var sup1 = jobSupplyList(jobTables[0]).length;
      var supLast = jobSupplyList(jobTables[0])[sup1 - 1].id;    // 追加到末尾
      var supDel = jobOverviewToggleSupply(0, 'cucumber');       // 再点 -> 取消
      var sup2 = jobSupplyList(jobTables[0]).length;
      var supBad = jobOverviewToggleSupply(0, '不存在的补给');
      var ovRows2 = jobOverviewTables();
      ({ n: ovRows.length, row0: ovRows[0], row1: ovRows[1],
         ok1: ok1, ok2: ok2, ok3: ok3, ok4a: ok4a, ok4: ok4, ok5: ok5,
         sup0: sup0, supAdd: supAdd, sup1: sup1, supLast: supLast,
         supDel: supDel, sup2: sup2, supBad: supBad,
         after1: ovRows2[1] });
`, s);
    ok(r.n === 2, 'E1 每张表一条记录（2）');
    eq(r.row0.name, '表1', 'E2 记录带表名');
    ok(r.row0.plants === 2, 'E3 植物数只数有名字的槽');
    ok(r.row0.supplyOrdered.length === 3 && r.row0.supplyPinned.length === 1,
        'E4 补给分两类：3 项有序 + 1 项无顺序（查看）');
    ok(r.row0.lineupMode === 'deck' && r.row0.deckNo === 3,
        'E5 选卡方式 + 编队号');
    ok(r.row1.bossLineupMode === 'deck' && r.row1.bossDeckNo === 5,
        'E6 boss 关阵容方式 + boss 编队号');
    ok(r.ok1 === true && r.after1.failAfter === 'continue',
        'E7 写入口：改失败后 -> 真的写进表');
    ok(r.ok2 === true && r.after1.bossDeckNo === 6,
        'E8 写入口：编队号 99 夹到 6');
    ok(r.ok3 === false, 'E9 写入口：值没变返回 false（不产生无意义记录点）');
    ok(r.ok4a === true && r.ok4 === true && r.after1.lineupMode === 'plants',
        'E10 写入口：非法换阵方式归一成 plants（实际=' + r.after1.lineupMode + '）');
    ok(r.ok5 === false, 'E11 写入口：越界表号直接忽略');
    ok(r.sup0 === 4 && r.supAdd === true && r.sup1 === 5,
        'E12 补给：点未选 -> 追加一项（4 -> 5）');
    ok(r.supLast === 'cucumber', 'E13 补给：新加的排在最后（顺序 = 点击顺序）');
    ok(r.supDel === true && r.sup2 === 4,
        'E14 补给：再点一次 -> 取消（5 -> 4）');
    ok(r.supBad === false, 'E15 补给：不存在的项直接忽略');
}

console.log('');
if (fails) {
    console.log('❌ 共 ' + fails + ' 条断言失败');
    process.exit(1);
}
console.log('✅ 全部通过（撤销/链条一致性 + boss 关植物分离）');
