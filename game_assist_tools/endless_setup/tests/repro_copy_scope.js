// ============================================================
// 回归测试：复制阵容的范围（整表 / 只普通关 / 只 boss 关）
//   用户需求（2026-10-30）：
//     「复制阵容会直接复制一整个表，可以选择只复制 boss，或者只复制普通关」
//
// 运行：node tests\repro_copy_scope.js
// 退出码：0 = 全过；1 = 有断言失败
//
// 重点断言：
//   · 只普通关：普通关槽位/棋盘被换掉，boss 侧一个字都不能动；
//     目标表 boss 侧"还在沿用、但棋盘上已有落点"的槽要就地固化（不会变孤儿）
//   · 只 boss 关：boss 槽位/棋盘/补给被换掉，普通关槽位/棋盘一个字都不能动；
//     来源表 boss 侧是"沿用"时，必须用来源 boss 棋盘上的植物固化成覆盖
//   · 整表：老行为（内容全拷、表的身份字段不拷）
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
// 数组/对象用 JSON 比较（严格 === 比的是引用）
function eqj(actual, expect, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expect);
    ok(a === b, msg + '（实际=' + a + '，期望=' + b + '）');
}

function mkSandbox() {
    const sandbox = {
        console,
        document: {
            addEventListener() { }, getElementById() { return null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() {
                return { style: {}, appendChild() { }, addEventListener() { }, setAttribute() { },
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
  { name: '南瓜头',   img: 'd.png', rare: 0 }
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
// 造两张表：t0 = 当前编辑（目标），t1 = 来源
function setup(){
  jobTables.length = 0;
  jobNewTable();                    // t0
  jobNewTable();                    // t1
  var t0 = jobTables[0], t1 = jobTables[1];
  // 目标表：普通关用坚果墙；boss 侧是"沿用"，但 boss 棋盘上已经落了向日葵
  t0.slots[3] = '坚果墙';
  t0.boardEarly = blankBoard();
  t0.boardEarly[0][0].push(plantItem(3, '坚果墙', 0, 0, 'once', 1));
  t0.boardLate = blankBoard();
  t0.boardLate[1][1].push(plantItem(3, '向日葵', 1, 1, 'once', 1));
  t0.label = '目标表';
  t0.supplyPicks = [{ id: 'all', name: '全部植物', img: '全部植物.png' }];
  // 来源表：普通关用豌豆射手；boss 侧也是"沿用"，棋盘上落了南瓜头
  t1.slots[3] = '豌豆射手';
  t1.boardEarly = blankBoard();
  t1.boardEarly[0][0].push(plantItem(3, '豌豆射手', 0, 0, 'once', 1));
  t1.boardLate = blankBoard();
  t1.boardLate[2][2].push(plantItem(3, '南瓜头', 2, 2, 'once', 1));
  t1.supplyPicks = [{ id: 'all', name: '全部植物', img: 'a.png' }, { id: 'sun', name: '能量豆', img: 's.png' }];
  t1.label = '来源表';
  currentTable = 0;
  jobLoadTable(0, true);
}
function cellName(board, r, c){
  var it = (board[r] && board[r][c] && board[r][c][0]) || null;
  return it ? (it.plant && it.plant.name) || it.label : '';
}
`, sandbox);
    return sandbox;
}

// ============================================================
// 1）只普通关
// ============================================================
console.log('1. 只复制普通关');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
setup();
jobCopyTableFrom(1, 'normal');
var t0 = jobTables[0];
({ slots3: t0.slots[3], early: cellName(boardEarly, 0, 0),
   bossSlots3: t0.bossSlots[3], late: cellName(boardLate, 1, 1),
   bossEff: jobSlotNameCtx(t0, 3, true),
   supplyN: (t0.supplyPicks || []).length,
   label: t0.label });
`, s);
    eq(r.slots3, '豌豆射手', '普通关槽位 3 换成了来源表的豌豆射手');
    eq(r.early, '豌豆射手', '普通关棋盘跟着换成豌豆射手');
    eq(r.bossSlots3, '向日葵', 'boss 侧沿用被就地固化：bossSlots[3] = 向日葵');
    eq(r.late, '向日葵', 'boss 棋盘上的向日葵不受影响');
    eq(r.bossEff, '向日葵', 'boss 关有效植物仍是向日葵');
    eq(r.supplyN, 1, 'boss 专属的补给顺序不受影响');
    eq(r.label, '目标表', '表名（身份字段）不变');
}

// ============================================================
// 2）只 boss 关
// ============================================================
console.log('2. 只复制 boss 关');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
setup();
jobCopyTableFrom(1, 'boss');
var t0 = jobTables[0];
({ slots3: t0.slots[3], early: cellName(boardEarly, 0, 0),
   bossSlots3: t0.bossSlots[3], late: cellName(boardLate, 2, 2),
   bossEff: jobSlotNameCtx(t0, 3, true),
   supplyN: (t0.supplyPicks || []).length,
   label: t0.label });
`, s);
    eq(r.slots3, '坚果墙', '普通关槽位 3 保持坚果墙（没被 boss 复制带跑）');
    eq(r.early, '坚果墙', '普通关棋盘保持坚果墙');
    eq(r.late, '南瓜头', 'boss 棋盘换成了来源表的南瓜头');
    eq(r.bossSlots3, '南瓜头', '来源的"沿用"被固化成覆盖：bossSlots[3] = 南瓜头（否则会按目标普通关的坚果墙解释）');
    eq(r.bossEff, '南瓜头', 'boss 关有效植物是南瓜头');
    eq(r.supplyN, 2, '补给顺序跟着 boss 侧一起复制过来');
    eq(r.label, '目标表', '表名不变');
}

// ============================================================
// 3）整表（老行为不变）
// ============================================================
console.log('3. 整表复制（老行为）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
setup();
jobTables[1].label = '来源表';
jobCopyTableFrom(1, 'all');
var t0 = jobTables[0];
({ slots3: t0.slots[3], early: cellName(boardEarly, 0, 0),
   late: cellName(boardLate, 2, 2), label: t0.label,
   bossOverrideKey: Object.prototype.hasOwnProperty.call(t0.bossSlots || {}, '3') });
`, s);
    eq(r.slots3, '豌豆射手', '整表复制：普通关槽位来自来源表');
    eq(r.early, '豌豆射手', '整表复制：普通关棋盘来自来源表');
    eq(r.late, '南瓜头', '整表复制：boss 棋盘来自来源表');
    eq(r.label, '目标表', '整表复制：表名仍是目标表的');
}

// ============================================================
// 4）多选框口径（{normal, boss} 对象）—— 弹窗里每张表两个复选框
//    · 只勾普通关 / 只勾 boss 关 / 两个都勾（= 整表）
//    · 两个都不勾 -> 拒绝执行，什么都不改
// ============================================================
console.log('4. 复选框口径（每张表各自勾选）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
setup();
var t0 = jobTables[0];
// 默认状态是两个都勾
var def = jobCopySidesOf(1);
// 只勾普通关
jobCopyTableFrom(1, { normal: true, boss: false });
var onlyNormal = { slots3: t0.slots[3], early: cellName(boardEarly, 0, 0),
                   late: cellName(boardLate, 1, 1), bossSlots3: t0.bossSlots[3] };
// 复位后再测「两个都不勾」：必须什么都不改
setup();
var before = JSON.stringify(jobTables[0]);
jobCopyTableFrom(1, { normal: false, boss: false });
var untouched = (JSON.stringify(jobTables[0]) === before);
({ def: def, onlyNormal: onlyNormal, untouched: untouched });
`, s);
    eqj([r.def.normal, r.def.boss], [true, true], '默认两个都勾');
    eq(r.onlyNormal.slots3, '豌豆射手', '只勾普通关：槽位来自来源表');
    eq(r.onlyNormal.early, '豌豆射手', '只勾普通关：普通关棋盘来自来源表');
    eq(r.onlyNormal.late, '向日葵', '只勾普通关：boss 棋盘保持原样（向日葵）');
    eq(r.onlyNormal.bossSlots3, '向日葵', '只勾普通关：boss 侧沿用被固化，boss 不跟着变');
    ok(r.untouched, '两个都不勾：直接拒绝，一个字段都不改');
}

console.log('');
if (fails) {
    console.log('❌ 共 ' + fails + ' 条断言失败');
    process.exit(1);
}
console.log('✅ 全部通过（复制阵容：普通关 / boss 关 复选框，可单勾可双勾）');
