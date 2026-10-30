// ============================================================
// 回归测试：槽位连续化（删中间槽自动左移）+ 批量替换植物
//
// 用户需求（2026-10-30）：
//   「槽8有植物的时候不能把槽7的植物去掉，期望应该是7植物去掉后
//     槽8植物变成槽7植物」
//   「boss关的槽位配置还是有槽6到槽9中间会有空着的情况」
//   「批量替换：把一个表种植的植物批量替换成某个别的植物，或者不使用这个植物（清空）」
// 用户需求（2026-10-31）：
//   「替换指定表的操作应该是可以支持多选的选择植物」
//   「如果boss关有就询问boss关需不需要替换」
//   -> 第 7/8/9 节：多选目标 + boss 关追问 + 同一植物占用跳过
//
// 运行：node tests\repro_slot_compact.js
// 退出码：0 = 全过；1 = 有断言失败
//
// 这里要盯的核心是「槽号被五处数据引用」：
//   槽位表 / boss 覆盖层 / 槽位形态 / 动作后等待 / 棋盘落点(id:cardN) / 链条段(key:cardN)
//   漏搬任何一处都会变成孤儿数据，所以断言逐项检查。
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
    ok(JSON.stringify(actual) === JSON.stringify(expect),
        msg + '（实际=' + JSON.stringify(actual) + '，期望=' + JSON.stringify(expect) + '）');
}

// 简易 DOM 元素：只用来验证「右栏面板画出来长什么样」（children 可数、事件可触发）
function mkEl(tag) {
    const el = {
        tagName: tag, style: {}, children: [], _text: '', _html: '', _a: {}, _h: {},
        classList: { add() { }, remove() { }, contains() { return false; } },
        appendChild(c) { el.children.push(c); return c; },
        addEventListener(t, fn) { el._h[t] = fn; },
        setAttribute(k, v) { el._a[k] = v; },
        getAttribute(k) { return el._a[k]; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        get textContent() { return el._text; },
        set textContent(v) { el._text = String(v); },
        get innerHTML() { return el._html; },
        set innerHTML(v) { el._html = String(v); if (!v) el.children = []; },
    };
    return el;
}

function mkSandbox(opts) {
    const withDom = !!(opts && opts.dom);
    const panel = mkEl('div');
    const sandbox = {
        console,
        document: {
            addEventListener() { }, getElementById(id) {
                return (withDom && id === 'plantReplacePanel') ? panel : null;
            },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement: mkEl,
            head: { appendChild() { } },
        },
        localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
        alert() { }, setTimeout() { return 0; }, clearTimeout() { },
    };
    sandbox.__panel = panel;
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['04-cards.js', '08-board-data.js', '15-board-actions.js', '20-jobset-core.js',
        '21-jobset-levels.js', '22-jobset-chain.js', '24-jobset-fields.js', '27-jobset-board.js',
        '29-jobset-init.js', '42-jobset-batch.js']) {
        try {
            vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
        } catch (e) {
            console.log('LOAD ' + f + ': ' + e.message);
        }
    }
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
jobRenderPlantGrid = function(){};
jobOuterRefreshBadge = function(){};
jobRefreshBossLineupUI = function(){};
jobSaveLocal = function(){ jobUndoRecord(); };
plantCache = [
  { name: '豌豆射手', img: 'a.png', rare: 0 },
  { name: '坚果墙',   img: 'b.png', rare: 0 },
  { name: '向日葵',   img: 'c.png', rare: 0 },
  { name: '南瓜头',   img: 'd.png', rare: 0 },
  { name: '寒冰射手', img: 'e.png', rare: 0 }
];
function blankBoard(){
  var b = [];
  for (var r = 0; r < 5; r++) { var row = []; for (var c = 0; c < 9; c++) row.push([]); b.push(row); }
  return b;
}
function plantItem(slot, name, r, c, mode, seq){
  return { id: 'card' + slot, label: name, type: 'plant', mode: mode || 'once',
           col: c + 1, row: r + 1, seq: seq || 1,
           plant: { name: name, img: null, rare: 0 } };
}
function idsOn(board){
  var out = [];
  for (var r = 0; r < board.length; r++) for (var c = 0; c < board[r].length; c++) {
    (board[r][c] || []).forEach(function(it){ out.push((it.id||'') + '@' + (it.row||'') + ',' + (it.col||'') + ':' + (it.plant && it.plant.name || it.label || '')); });
  }
  return out.sort();
}
`, sandbox);
    return sandbox;
}

// ============================================================
// 1）普通关：删中间的槽 -> 后面的槽自动左移，且五处数据一起搬
// ============================================================
console.log('1. 普通关删中间槽 -> 自动左移补位');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
// 槽1..8 全部放植物（槽7=坚果墙，槽8=向日葵）
['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','坚果墙','向日葵']
  .forEach(function(n, i){ t.slots[i+1] = n; });
initBoards();
// 槽7、槽8 各落一株；槽3 也落一株（验证不受影响的槽不乱动）
boardEarly[0][0].push(plantItem(7, '坚果墙', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(8, '向日葵', 0, 1, 'once', 1));
boardEarly[0][2].push(plantItem(3, '南瓜头', 0, 2, 'once', 1));
// 链条：单次链顺序 = 槽3、槽7、槽8；循环链只有 槽8；收尾链只有 槽7
t.slotOrder = [{key:'card3', from:0, to:null}, {key:'card7', from:0, to:null}, {key:'card8', from:0, to:null}];
t.loopOrder = [{key:'card8', from:0, to:null}];
t.endOrder  = [{key:'card7', from:0, to:null}];
t.slotModes = { card7: 'loop', card8: 'end' };
t.waitAfter = { 'once|card8|0,1|1': 3, 'once|card3|0,2|1': 2 };
t.supplyPicks = [{ id: 'all', name: '全部植物', img: 'x.png' }];

// 用户操作：清空 槽7（以前会提示"不能卸"，现在应该成功并左移）
t.slots[7] = '';
jobClearNormalSlot(7);
var shifted = jobCompactSlots(t, false);
({ shifted: shifted,
   slots: [1,2,3,4,5,6,7,8].map(function(i){ return t.slots[i] || ''; }),
   board: idsOn(boardEarly),
   slotOrder: t.slotOrder.map(function(x){ return x.key; }),
   loopOrder: t.loopOrder.map(function(x){ return x.key; }),
   endOrder: t.endOrder.map(function(x){ return x.key; }),
   modes: t.slotModes,
   waits: Object.keys(t.waitAfter).sort(),
   supplyN: t.supplyPicks.length });
`, s);

    eq(r.shifted, 1, '只搬了 1 个槽（槽8 -> 槽7）');
    eq(r.slots, ['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','向日葵',''], '槽8 的向日葵左移到槽7，槽8 空出');
    eq(r.board, ['card3@1,3:南瓜头', 'card7@1,2:向日葵'], '棋盘落点：卡7的坚果墙被清掉，卡8的向日葵变成卡7；卡3 不动');
    eq(r.slotOrder, ['card3','card7'], '单次链：被删的 card7 段消失，card8 -> card7');
    eq(r.loopOrder, ['card7'], '循环链：card8 -> card7');
    eq(r.endOrder, [], '收尾链：card7 被删 -> 整段移除');
    eq(r.modes, { card7: 'end' }, '形态表：card8 的形态跟着搬到 card7（原来的 card7 形态随槽删除）');
    eq(r.waits, ['once|card3|0,2|1', 'once|card7|0,1|1'], '动作后等待的键一起改号');
    eq(r.supplyN, 1, '补给顺序不受影响');
}

// ============================================================
// 2）boss 关：删除中间的槽 -> 同样左移压实（不再留空槽）
// ============================================================
console.log('2. boss 关槽位不留空隙');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','坚果墙','向日葵']
  .forEach(function(n, i){ t.slots[i+1] = n; });
initBoards();
jobLoadTable(0, true);
// boss 侧：槽7、槽8 有独立覆盖，槽6 也有
t.bossSlots = { 6: '坚果墙', 7: '向日葵', 8: '寒冰射手' };
boardLate[1][1].push(plantItem(7, '向日葵', 1, 1, 'once', 1));
boardLate[1][2].push(plantItem(8, '寒冰射手', 1, 2, 'once', 1));
t.bossSlotOrder = [{key:'card7', from:0, to:null}, {key:'card8', from:0, to:null}];
t.bossSlotModes = { card8: 'loop' };
t.bossWaitAfter = { 'once|card8|1,2|1': 5 };

// 用户操作：在 boss 关删掉 槽7（沿用状态）
t.bossSlots[7] = null;
jobPurgeSlotOnBoard(boardLate, 7);
var shifted = jobCompactSlots(t, true);
var eff = [1,2,3,4,5,6,7,8].map(function(i){ return jobSlotNameCtx(t, i, true) || ''; });
({ shifted: shifted,
   bossSlots: t.bossSlots,
   eff: eff,
   board: idsOn(boardLate),
   order: (t.bossSlotOrder || []).map(function(x){ return x.key; }),
   modes: t.bossSlotModes,
   waits: Object.keys(t.bossWaitAfter || {}).sort() });
`, s);

    eq(r.shifted, 1, 'boss 侧搬了 1 个槽（原槽8 -> 槽7）');
    eq(r.eff, ['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','坚果墙','寒冰射手',''], 'boss 有效槽位从槽1 起连续，中间没有空槽');
    eq(r.board, ['card7@2,3:寒冰射手'], 'boss 棋盘：原卡8 的寒冰射手变成卡7');
    eq(r.order, ['card7'], 'boss 单次链：card8 -> card7');
    eq(r.modes, { card7: 'loop' }, 'boss 形态表跟着搬号');
    eq(r.waits, ['once|card7|1,2|1'], 'boss 动作后等待跟着改号');
}

// ============================================================
// 3）「替换指定表」：把某张表 / 某一侧的植物换成另一个
//    （新入口在植物选择器右侧；核心 = jobReplacePlantInTable + jobListPlantLocations）
// ============================================================
console.log('3. 替换指定表（普通关 / boss 关分开）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
currentTable = 0;
// 表1：槽1 豌豆 / 槽2 坚果墙；boss 覆盖 槽3 = 豌豆
t0.slots[1] = '豌豆射手'; t0.slots[2] = '坚果墙';
t0.boardEarly = blankBoard();
t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t0.boardLate = blankBoard();
t0.bossSlots = { 3: '豌豆射手' };
t0.boardLate[1][1].push(plantItem(3, '豌豆射手', 1, 1, 'once', 1));
// 表2：槽1 也是豌豆（用来验证跨表替换）
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard();
t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
// 表2 的当前棋盘引用（非当前表，必须走 t.boardEarly）
initBoards();
jobLoadTable(0, true);

var locs = jobListPlantLocations('豌豆射手').map(function(l){
  return jobTableName(l.table) + '|' + l.side + '|' + l.slots.join(',');
}).sort();
// ① 表2 普通关：豌豆 -> 寒冰射手
var n2 = jobReplacePlantInTable(t1, 'normal', '豌豆射手', '寒冰射手');
// ② 表1 boss 关：豌豆 -> 南瓜头（普通关那张表里的豌豆不动）
var nB = jobReplacePlantInTable(t0, 'boss', '豌豆射手', '南瓜头');
({ locs: locs, n2: n2, nB: nB,
   t0slots: [1,2,3].map(function(i){ return t0.slots[i]; }),
   t0boss: t0.bossSlots,
   t0board: idsOn(boardEarly),
   t0boardLate: idsOn(boardLate),
   t1slots: [1,2].map(function(i){ return t1.slots[i]; }),
   t1board: idsOn(t1.boardEarly),
   dup: jobSideUsesPlant(t0, 'normal', '坚果墙'),
   dup2: jobSideUsesPlant(t0, 'normal', '向日葵') });
`, s);
    eq(r.locs, ['表1|boss|3', '表1|normal|1', '表2|normal|1'], '分布清单：表1 普通关槽1 + 表1 boss槽3 + 表2 普通关槽1');
    eq(r.n2, 1, '表2 普通关命中 1 个槽');
    eq(r.t1slots, ['寒冰射手',''], '表2 槽1 换成寒冰射手');
    eq(r.t1board, ['card1@1,1:寒冰射手'], '表2 棋盘落点同步换成寒冰射手（非当前表也要改对棋盘）');
    eq(r.nB, 1, '表1 boss 覆盖槽命中 1 个');
    eq(r.t0boss, { 3: '南瓜头' }, '表1 boss 覆盖槽换成南瓜头');
    eq(r.t0slots, ['豌豆射手','坚果墙',''], '表1 普通关的豌豆射手没有被 boss 侧的替换影响');
    eq(r.t0board, ['card1@1,1:豌豆射手'], '表1 普通关棋盘不动');
    eq(r.t0boardLate, ['card3@2,2:南瓜头'], '表1 boss 棋盘落点换成南瓜头');
    ok(r.dup, '重复检测：坚果墙已在该表普通关使用');
    ok(!r.dup2, '重复检测：向日葵没用过');
}

// ============================================================
// 4）一键删除所有表里的这株（普通关 + boss 关），各表各自压实
// ============================================================
console.log('4. 删除所有表里的这一株');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
currentTable = 0;
t0.slots[1] = '豌豆射手'; t0.slots[2] = '坚果墙'; t0.slots[3] = '豌豆射手'; t0.slots[4] = '向日葵';
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][2].push(plantItem(3, '豌豆射手', 0, 2, 'once', 1));
boardEarly[0][3].push(plantItem(4, '向日葵', 0, 3, 'once', 1));
boardLate[1][1].push(plantItem(1, '豌豆射手', 1, 1, 'once', 1));
// 表2：也有豌豆
t1.slots[1] = '豌豆射手'; t1.slots[2] = '寒冰射手';
t1.boardEarly = blankBoard();
t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t1.boardEarly[0][1].push(plantItem(2, '寒冰射手', 0, 1, 'once', 1));

var res = jobDeletePlantEverywhere('豌豆射手');
({ res: res,
   t0slots: [1,2,3,4].map(function(i){ return t0.slots[i] || ''; }),
   t0board: idsOn(boardEarly),
   t1slots: [1,2].map(function(i){ return t1.slots[i] || ''; }),
   t1board: idsOn(t1.boardEarly) });
`, s);
    eq(r.res.tables, 2, '两张表都命中');
    eq(r.res.normal, 3, '普通关共清掉 3 个槽（表1 两个 + 表2 一个）');
    eq(r.t0slots, ['坚果墙','向日葵','',''], '表1 普通关压实：坚果墙->槽1、向日葵->槽2');
    eq(r.t0board, ['card2@1,4:向日葵'], '表1 棋盘：豌豆的落点清掉，向日葵跟着搬到卡2');
    eq(r.t1slots, ['寒冰射手',''], '表2 普通关压实：寒冰射手->槽1');
    eq(r.t1board, ['card1@1,2:寒冰射手'], '表2 棋盘同步改号');
}

// ============================================================
// 5）普通关清中间槽 + boss 侧纯沿用：boss 关一株都不能少
//    （boss 槽位是"覆盖层"，没写键 = 沿用普通关同槽；槽号一搬就必须全部固化）
// ============================================================
console.log('5. 普通关清槽后 boss 关不丢植物');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','坚果墙','向日葵']
  .forEach(function(n, i){ t.slots[i+1] = n; });
initBoards();
// boss 侧完全沿用（bossSlots 为空），但棋盘上 槽7/槽8 已经落了子
t.bossSlots = {};
boardLate[1][1].push(plantItem(7, '坚果墙', 1, 1, 'once', 1));
boardLate[1][2].push(plantItem(8, '向日葵', 1, 2, 'once', 1));

// 用户操作：清空普通关 槽7（走与 UI 相同的三步）
t.slots[7] = '';
jobClearNormalSlot(7);
jobCompactSlots(t, false);
jobCompactSlots(t, true);
({ eff: [1,2,3,4,5,6,7,8].map(function(i){ return jobSlotNameCtx(t, i, true) || ''; }),
   bossBoard: idsOn(boardLate),
   normal: [1,2,3,4,5,6,7,8].map(function(i){ return t.slots[i] || ''; }) });
`, s);
    eq(r.normal, ['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','向日葵',''], '普通关：槽8 左移到槽7');
    eq(r.eff, ['豌豆射手','寒冰射手','南瓜头','豌豆射手','寒冰射手','南瓜头','坚果墙','向日葵'], 'boss 关 8 个槽的植物一个没少（槽7/槽8 固化成覆盖）');
    eq(r.bossBoard.length, 2, 'boss 棋盘落点没被普通关的操作带走');
}

// ============================================================
// 6）载入时统一压实（jobCompactAllTables）
//    用户要求：不留「压实」按钮，旧作业集加载时直接压实。
//    要点：压的是**每一张表**（不只当前表），并用各表自己的棋盘。
// ============================================================
console.log('6. 载入时压实所有表（含非当前表）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();     // 表1（当前）
jobNewTable();     // 表2（历史数据，带空洞）
var t0 = jobTables[0], t1 = jobTables[1];
currentTable = 0;
jobLoadTable(0, true);
// 表2：槽位 1,2,4 有植物（3 空着 = 历史空洞）；棋盘上卡4 有落点；链条指向 card4
t1.slots = { 1: '豌豆射手', 2: '坚果墙', 3: '', 4: '向日葵' };
t1.boardEarly = blankBoard();
t1.boardEarly[0][3].push(plantItem(4, '向日葵', 0, 3, 'once', 1));
t1.slotOrder = [{ key: 'card4', from: 0, to: null }];
t1.slotModes = { card4: 'loop' };
t1.waitAfter = { 'once|card4|0,3|1': 4 };
// 表2 的 boss 侧也有一个人为空洞：槽6 删除，槽7 有覆盖
t1.slots[5] = '寒冰射手'; t1.slots[6] = '南瓜头'; t1.slots[7] = '豌豆射手';
t1.boardLate = blankBoard();
t1.bossSlots = { 6: null, 7: '坚果墙' };
t1.boardLate[1][1].push(plantItem(7, '坚果墙', 1, 1, 'once', 1));

var res = jobCompactAllTables();
({ res: res,
   slots: [1,2,3,4,5,6,7].map(function(i){ return t1.slots[i] || ''; }),
   board: idsOn(t1.boardEarly),
   order: (t1.slotOrder || []).map(function(x){ return x.key; }),
   modes: t1.slotModes,
   waits: Object.keys(t1.waitAfter || {}).sort(),
   bossEff: [1,2,3,4,5,6,7,8].map(function(i){ return jobSlotNameCtx(t1, i, true) || ''; }),
   bossBoard: idsOn(t1.boardLate),
   curSlots: [1,2,3].map(function(i){ return t0.slots[i] || ''; }) });
`, s);
    eq(r.slots, ['豌豆射手','坚果墙','向日葵','寒冰射手','南瓜头','豌豆射手',''], '表2 普通关槽位压实：卡4 顶到卡3，后面依次前移');
    eq(r.board, ['card3@1,4:向日葵'], '表2 棋盘落点跟着改号 card4 -> card3');
    eq(r.order, ['card3'], '表2 单次链 key 跟着改号');
    eq(r.modes, { card3: 'loop' }, '表2 形态表改号');
    eq(r.waits, ['once|card3|0,3|1'], '表2 动作后等待改号');
    eq(r.bossEff.slice(0, 7), ['豌豆射手','坚果墙','向日葵','寒冰射手','南瓜头','坚果墙',''], '表2 boss 侧压实后从槽1 起连续（无空洞）');
    eq(r.bossBoard, ['card6@2,2:坚果墙'], '表2 boss 棋盘卡7 -> 卡6');
    eq(r.curSlots, ['','',''], '当前表没被牵连');
}

// ============================================================
// 7）「替换指定表」支持多选：一次把多处（不同表 / 不同关别）一起换掉
//    （2026-10-31 用户要求：「替换指定表的操作应该是可以支持多选的选择植物」）
// ============================================================
console.log('7. 替换指定表 = 多选（一次换多处）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable(); jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1], t2 = jobTables[2];
currentTable = 0;
// 表1：普通关槽1 豌豆（= 当前正在编辑的槽，"要被替换的植物"取自它）
t0.slots[1] = '豌豆射手';
t0.boardEarly = blankBoard(); t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
// 表2 / 表3：普通关槽1 也都是豌豆；boss 侧没写覆盖（纯沿用 -> 不该追问）
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard(); t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t2.slots[1] = '豌豆射手';
t2.boardEarly = blankBoard(); t2.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
initBoards(); jobLoadTable(0, true);
var __msg = '';
jobAfterPlantChange = function (m) { __msg = m; };
currentSlotEditing = 1;
jobCancelReplaceArm();                       // 全部取消勾选（连"正在编辑"那处也取消）
jobToggleReplaceTarget(1, 'normal');         // 勾 表2 普通关
jobToggleReplaceTarget(2, 'normal');         // 勾 表3 普通关
var selAfterToggle = jobReplaceSelCount();
// 卡片结构要在执行前看（换完表2/表3 就不含这株了）
var cardsBefore = jobReplaceCards('豌豆射手').map(function (c) {
    return c.table + ':' + (c.normal.uses ? 'n' : '-') + (c.boss.uses ? 'b' : '-');
});
var eaten = jobTryApplyReplaceFlow({ name: '寒冰射手' });
({ selAfterToggle: selAfterToggle, eaten: eaten, msg: __msg,
   pending: _jobReplacePending,
   selAfterRun: jobReplaceSelCount(),
   t0slots: [1,2].map(function(i){ return t0.slots[i] || ''; }),
   t1slots: [t1.slots[1] || ''],
   t2slots: [t2.slots[1] || ''],
   t1board: idsOn(t1.boardEarly),
   t2board: idsOn(t2.boardEarly),
   t0board: idsOn(boardEarly),
   cards: cardsBefore });
`, s);
    eq(r.cards, ['0:n-', '1:n-', '2:n-'], '卡片：3 张表，每张都有普通关小块、boss 小块没在用');
    eq(r.selAfterToggle, 2, '右栏可以同时勾 2 处目标');
    eq(r.eaten, true, '点植物被替换流程吃掉');
    eq(r.pending, null, 'boss 侧纯沿用（没有显式覆盖）-> 不追问，直接执行');
    eq(r.t1slots, ['寒冰射手'], '表2 普通关：豌豆 -> 寒冰射手');
    eq(r.t2slots, ['寒冰射手'], '表3 普通关：同一次点击一起换掉');
    eq(r.t1board, ['card1@1,1:寒冰射手'], '表2 棋盘（非当前表）同步');
    eq(r.t2board, ['card1@1,1:寒冰射手'], '表3 棋盘（非当前表）同步');
    eq(r.t0slots, ['豌豆射手',''], '「正在编辑」那一处被取消勾选 -> 当前槽不动');
    ok(/表2/.test(r.msg) && /表3/.test(r.msg), '状态提示列出了两张表（' + r.msg + '）');
    eq(r.selAfterRun, 1, '执行完勾选回到默认态（只剩"正在编辑"那一处）');
}

// ============================================================
// 7b）「正在编辑」那一处默认打勾：勾了别的表时，当前槽也一并改掉
// ============================================================
console.log('7b. 正在编辑默认打勾 -> 当前槽一并改');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
currentTable = 0;
t0.slots[1] = '豌豆射手';
t0.boardEarly = blankBoard(); t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard(); t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
initBoards(); jobLoadTable(0, true);
var __msg = '';
jobAfterPlantChange = function (m) { __msg = m; };
currentSlotEditing = 1;
// 打开选择器：清空 + 默认勾上「正在编辑」那一处
jobResetReplaceSel();
var defSel = jobReplaceSelList().map(function (l) { return l.table + '|' + l.side; });
// 只勾了"正在编辑"一处时，点植物 = 老行为（交给 jobConfirmPick，流程不接管）
var onlyCur = jobTryApplyReplaceFlow({ name: '寒冰射手' });
// 再勾上表2 -> 两边一起改
jobToggleReplaceTarget(1, 'normal');
plantPickList = plantCache.slice();          // 让 jobConfirmPick 能按名字找到植物
plantPickIndex = 0;
var closed = 0;
jobClosePicker = function () { closed++; };
var eaten = jobTryApplyReplaceFlow({ name: '寒冰射手' });
({ defSel: defSel, onlyCur: onlyCur, eaten: eaten, closed: closed, msg: __msg,
   t0slots: [t0.slots[1] || ''], t1slots: [t1.slots[1] || ''],
   t0board: idsOn(boardEarly), t1board: idsOn(t1.boardEarly) });
`, s);
    eq(r.defSel, ['0|normal'], '打开选择器时「正在编辑」那一处默认勾上');
    eq(r.onlyCur, false, '只勾这一处时替换流程不接管（点植物 = 正常选卡）');
    eq(r.eaten, true, '勾了别的表 -> 替换流程接管');
    eq(r.t0slots, ['寒冰射手'], '当前槽也改成寒冰射手（走的是 jobConfirmPick 老流程）');
    eq(r.t1slots, ['寒冰射手'], '表2 一并换掉');
    eq(r.t0board, ['card1@1,1:寒冰射手'], '当前表棋盘同步');
    eq(r.t1board, ['card1@1,1:寒冰射手'], '表2 棋盘同步');
    eq(r.closed, 1, '当前槽走的是正常选卡 -> 选完按老规矩关掉选择器');
    ok(/当前槽/.test(r.msg) && /表2/.test(r.msg), '状态提示同时播报当前槽和表2（' + r.msg + '）');
}

// ============================================================
// 8）boss 关也在用同一株 -> 先追问，不闷头只改普通关
//    （2026-10-31 用户要求：「如果boss关有就询问boss关需不需要替换」）
// ============================================================
console.log('8. boss 关也在用 -> 挂起追问，先不改任何字段');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
// 表2（当前）：普通关槽1 豌豆 —— 来源
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard(); t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
// 表1：普通关槽1 豌豆 + **boss 关显式覆盖 槽3 豌豆**
t0.slots[1] = '豌豆射手';
t0.boardEarly = blankBoard(); t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t0.boardLate = blankBoard();
t0.bossSlots = { 3: '豌豆射手' };
t0.boardLate[1][1].push(plantItem(3, '豌豆射手', 1, 1, 'once', 1));
initBoards(); jobLoadTable(1, true);
currentTable = 1;
var __msg = '';
jobAfterPlantChange = function (m) { __msg = m; };
currentSlotEditing = 1;
jobCancelReplaceArm();
jobToggleReplaceTarget(0, 'normal');          // 只勾了表1 的普通关
var eaten = jobTryApplyReplaceFlow({ name: '南瓜头' });
var pd = _jobReplacePending && {
    src: _jobReplacePending.src, dst: _jobReplacePending.dst,
    targets: _jobReplacePending.targets.length,
    bossExtra: _jobReplacePending.bossExtra.map(function (x) { return x.table + '|' + x.side; })
};
({ eaten: eaten, pd: pd, msg: __msg,
   slotsBefore: [1,2].map(function(i){ return t0.slots[i] || ''; }),
   bossBefore: t0.bossSlots,
   bossBoardBefore: idsOn(t0.boardLate) });
`, s);
    eq(r.eaten, true, '点植物被吃掉（停一步追问，不立刻执行）');
    ok(!!r.pd, '挂起了 boss 追问');
    eq(r.pd && r.pd.bossExtra, ['0|boss'], '追问里点名「表1 · boss 关」');
    eq(r.pd && r.pd.targets, 1, '已勾的普通关 1 处');
    eq(r.slotsBefore, ['豌豆射手',''], '追问阶段普通关一个字段都没改');
    eq(r.bossBefore, { 3: '豌豆射手' }, 'boss 覆盖层也没动');
    eq(r.bossBoardBefore, ['card3@2,2:豌豆射手'], 'boss 棋盘也没动');
}

// ============================================================
// 9）追问的两个分支 + 「同一植物不能占两个槽」在多选下的跳过
// ============================================================
function mkBossPromptSandbox() {
    const s = mkSandbox();
    vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable();
var __t0 = jobTables[0], __t1 = jobTables[1];
__t1.slots[1] = '豌豆射手';
__t1.boardEarly = blankBoard(); __t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
__t0.slots[1] = '豌豆射手';
__t0.boardEarly = blankBoard(); __t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
__t0.boardLate = blankBoard();
__t0.bossSlots = { 3: '豌豆射手' };
__t0.boardLate[1][1].push(plantItem(3, '豌豆射手', 1, 1, 'once', 1));
initBoards(); jobLoadTable(1, true);
currentTable = 1;
var __msg = '';
jobAfterPlantChange = function (m) { __msg = m; };
currentSlotEditing = 1;
jobResetReplaceSel();                 // 默认勾上「正在编辑」（表2 普通关）
jobToggleReplaceTarget(0, 'normal');  // 再勾表1 普通关（它的 boss 关也在用 -> 要追问）
plantPickList = plantCache.slice();   // 让 jobConfirmPick 能按名字找到植物
plantPickIndex = 3;                   // 南瓜头
jobClosePicker = function () { };
jobTryApplyReplaceFlow({ name: '南瓜头' });
`, s);
    return s;
}

console.log('9a. 追问 -> boss 关不动（只换普通关）');
{
    const s = mkBossPromptSandbox();
    const r = vm.runInContext(`
jobConfirmPendingBoss(false);
var t0 = jobTables[0], t1 = jobTables[1];
({ slots: [t0.slots[1] || ''], boss: t0.bossSlots,
   boardEarly: idsOn(t0.boardEarly), boardLate: idsOn(t0.boardLate),
   curSlot: [t1.slots[1] || ''],
   pending: _jobReplacePending, sel: jobReplaceSelCount(), msg: __msg });
`, s);
    eq(r.slots, ['南瓜头'], '普通关换成南瓜头');
    eq(r.boss, { 3: '豌豆射手' }, 'boss 关保持不变（用户选了"boss 关不动"）');
    eq(r.boardEarly, ['card1@1,1:南瓜头'], '普通关棋盘同步');
    eq(r.boardLate, ['card3@2,2:豌豆射手'], 'boss 棋盘不动');
    eq(r.curSlot, ['南瓜头'], '「正在编辑」那一槽也换了（追问的两个分支都会改它）');
    eq(r.pending, null, '追问已消费掉');
    eq(r.sel, 1, '执行完勾选回到默认态（只剩"正在编辑"那一处）');
    ok(/当前槽/.test(r.msg) && /表1/.test(r.msg), '状态提示同时报当前槽和表1（' + r.msg + '）');
}

console.log('9b. 追问 -> 一起替换（boss 关跟着换）');
{
    const s = mkBossPromptSandbox();
    const r = vm.runInContext(`
jobConfirmPendingBoss(true);
var t0 = jobTables[0], t1 = jobTables[1];
({ slots: [t0.slots[1] || ''], boss: t0.bossSlots,
   boardEarly: idsOn(t0.boardEarly), boardLate: idsOn(t0.boardLate),
   curSlot: [t1.slots[1] || ''],
   pending: _jobReplacePending, sel: jobReplaceSelCount() });
`, s);
    eq(r.slots, ['南瓜头'], '普通关换成南瓜头');
    eq(r.boss, { 3: '南瓜头' }, 'boss 覆盖槽一起换成南瓜头');
    eq(r.boardLate, ['card3@2,2:南瓜头'], 'boss 棋盘落点也同步');
    eq(r.curSlot, ['南瓜头'], '「正在编辑」那一槽也换了');
    eq(r.pending, null, '追问已消费掉');
    eq(r.sel, 1, '执行完勾选回到默认态');
}

console.log('9c. 多选下「同一植物不能占两个槽」只跳过那一处');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
// 表2（当前）：普通关槽1 豌豆 = 来源
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard(); t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
// 表1：普通关槽1 豌豆 + 槽2 已经是寒冰射手（= 要换成的植物）；boss 覆盖槽3 豌豆
t0.slots[1] = '豌豆射手'; t0.slots[2] = '寒冰射手';
t0.boardEarly = blankBoard(); t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t0.boardLate = blankBoard();
t0.bossSlots = { 3: '豌豆射手' };
t0.boardLate[1][1].push(plantItem(3, '豌豆射手', 1, 1, 'once', 1));
initBoards(); jobLoadTable(1, true);
currentTable = 1;
var __msg = '';
jobAfterPlantChange = function (m) { __msg = m; };
currentSlotEditing = 1;
jobCancelReplaceArm();
jobToggleReplaceTarget(0, 'normal');
jobToggleReplaceTarget(0, 'boss');            // 两个关别都勾了 -> 不再追问
var eaten = jobTryApplyReplaceFlow({ name: '寒冰射手' });
({ eaten: eaten, pending: _jobReplacePending, msg: __msg,
   slots: [t0.slots[1] || '', t0.slots[2] || ''],
   boss: t0.bossSlots,
   boardLate: idsOn(t0.boardLate) });
`, s);
    eq(r.pending, null, 'boss 关已经被勾上 -> 不再追问');
    eq(r.slots, ['豌豆射手','寒冰射手'], '普通关被跳过（寒冰射手已经占着槽2），一个字段都不改');
    eq(r.boss, { 3: '寒冰射手' }, 'boss 关照常替换');
    eq(r.boardLate, ['card3@2,2:寒冰射手'], 'boss 棋盘同步');
    ok(/跳过/.test(r.msg), '状态提示说明了跳过哪一处（' + r.msg + '）');
}

// ============================================================
// 10）右栏面板画出来长什么样：一张表一个大块 + **左右两个小块**
//     （用户要求：「不是上下的，是左右的板块，方便点击」）
// ============================================================
console.log('10. 右栏结构：一张表一个大块，普通关 / boss 关左右并排');
{
    const s = mkSandbox({ dom: true });
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable(); jobNewTable();
var t0 = jobTables[0], t1 = jobTables[1];
currentTable = 0;
// 表1：普通关槽1 豌豆 + boss 关显式覆盖 槽3 豌豆（=> 两个小块都能勾）
t0.slots[1] = '豌豆射手';
t0.boardEarly = blankBoard(); t0.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
t0.boardLate = blankBoard();
t0.bossSlots = { 3: '豌豆射手' };
t0.boardLate[1][1].push(plantItem(3, '豌豆射手', 1, 1, 'once', 1));
// 表2：只有普通关用（=> boss 小块该灰掉、不可点）
t1.slots[1] = '豌豆射手';
t1.boardEarly = blankBoard(); t1.boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
initBoards(); jobLoadTable(0, true);
currentSlotEditing = 1;
jobResetReplaceSel();
jobRenderReplacePanel();
var panel = document.getElementById('plantReplacePanel');
var cards = (panel.children || []).filter(function (c) { return c._jobCard !== undefined; });
function blocksOf(card) {
  // 大块的 children = [表名, 左右两个小块的容器]
  var row = card.children[1];
  return (row && row.children) ? row.children : [];
}
var shapes = cards.map(function (c) {
  var bs = blocksOf(c);
  return c._jobCard + ':' + bs.map(function (b) {
    return b._jobSide + (b._jobUsable ? '' : '(灰)') + (b._h && b._h.click ? '' : '(不可点)');
  }).join('|');
});
var normalChecked = (blocksOf(cards[0])[0]._html || '').indexOf('☑') >= 0;
var bossGreyed = blocksOf(cards[1])[1]._jobUsable === false
                 && !(blocksOf(cards[1])[1]._h || {}).click;
var curBadge = (blocksOf(cards[0])[0]._html || '').indexOf('编辑') >= 0;
({ nCards: cards.length, nBlocksAll: cards.map(function (c) { return blocksOf(c).length; }),
   shapes: shapes, normalChecked: normalChecked, bossGreyed: bossGreyed,
   curBadge: curBadge, sel: jobReplaceSelCount() });
`, s);
    eq(r.nCards, 2, '两张表 => 两个大块');
    eq(r.nBlocksAll, [2, 2], '每个大块里恰好两个小块（左右并排，不是上下堆）');
    eq(r.shapes, ['0:normal|boss', '1:normal|boss(灰)(不可点)'],
        '表1 普通关 / boss 关都能勾；表2 的 boss 关没用这株 -> 灰色不可点');
    ok(r.normalChecked, '「正在编辑」那一块默认打勾');
    ok(r.curBadge, '「正在编辑」那一块右上角有「编辑」小字');
    ok(r.bossGreyed, 'boss 小块灰掉后没有点击事件');
    eq(r.sel, 1, '默认只勾「正在编辑」这一处');
}

console.log('');
if (fails) {
    console.log('❌ 共 ' + fails + ' 条断言失败');
    process.exit(1);
}
console.log('✅ 全部通过（槽位连续化 + 批量替换植物）');
