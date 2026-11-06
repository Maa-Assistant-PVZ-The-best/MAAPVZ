// ============================================================
// 回归测试：链条顺序「↑ / ↓ 移一位」（手机拖拽替代，2026-11-02）
//
// 背景：排序原本只有 HTML5 `draggable` 一条路，而**触屏浏览器不支持 draggable**
//   —— 手机上种植顺序根本改不了（用户实测反馈「有些拖拽相关的用不了」）。
//   于是加了「勾选 → 点 ↑ / ↓」，内部**复用拖拽的同一条出口 jobApplyDrop()**，
//   所以语义必须与拖拽完全一致（摘出 → 重新插入 / 整组搬 / 无间隔组跟随）。
//
// 这里盯的是**数据**（按钮长什么样、在哪儿，只能靠用户 Ctrl+F5 / 手机眼看）：
//   ① 单块下移 / 上移一位，且只动它自己的位置；
//   ② 到顶 / 到底：不动 + 给提示（不许悄悄错位）；
//   ③ 勾选多块 = 整组一起挪一位，组内相对顺序不变；
//   ④ 跨链勾选 = 每条链各自在自己链内挪（绝不跨链混排）；
//   ⑤ 没勾选 = 什么都不做（不许有副作用）。
//
// 运行：node tests\repro_nudge.js
// 退出码：0 = 全过；1 = 有断言失败
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');   // 公共假 DOM（见 harness.js 头注释）
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

// 简易 DOM（这里只需要「元素挂得上、事件能绑」；样式/尺寸靠肉眼）
const mkEl = H.mkEl;   // 原来这里有一份本地假元素实现（30 行），改为共用 harness
function mkSandbox() {
    const els = {};
    const sandbox = {
        console,
        document: {
            addEventListener() { },
            getElementById(id) { if (!els[id]) els[id] = mkEl('div'); return els[id]; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement: mkEl,
            head: { appendChild() { } },
        },
        localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
        alert() { }, setTimeout() { return 0; }, clearTimeout() { },
    };
    sandbox.__els = els;
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['04-cards.js', '08-board-data.js', '15-board-actions.js', '20-jobset-core.js',
        '21-jobset-levels.js', '22-jobset-chain.js', '23-jobset-end.js', '24-jobset-fields.js',
        '27a-jobset-steps.js', '27b-jobset-stepcfg.js', '27c-jobset-chain-render.js', '27d-jobset-slots.js', '27e-jobset-hotkeys.js', '27f-jobset-export.js', '29-jobset-init.js', '42-jobset-batch.js',
        '43-jobset-cell-queue.js']) {
        try {
            vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
        } catch (e) {
            console.log('LOAD ' + f + ': ' + e.message);
        }
    }
    vm.runInContext(`
renderAllBoards = function(){};
updatePreview = function(){};
setStatus = function(m){ __status = m; };
jobRenderSeqChains = function(){};
jobRenderSlots = function(){};
jobFillForm = function(){};
jobRenderTabs = function(){};
jobRenderEndParams = function(){};
jobRenderMech = function(){};
jobRenderRefGhosts = function(){};
jobRenderPlantGrid = function(){};
jobRenderCurrentBoard = function(){};
jobOuterRefreshBadge = function(){};
jobRefreshBossLineupUI = function(){};
jobSaveCurrentBoard = function(){};
jobSaveLocal = function(){ __saves = (__saves||0) + 1; };
var __status = '', __saves = 0;
plantCache = [
  { name: '豌豆射手', img: 'a.png', rare: 0 },
  { name: '坚果墙',   img: 'b.png', rare: 0 },
  { name: '向日葵',   img: 'c.png', rare: 0 }
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
// 链条「一株一步」的形状，方便断言
function stepShape(t, which, board){
  return jobResolveSteps(t, which, board).map(function(s){
    return (s.kind === 'plant') ? (s.key + '#' + s.gidx) : (s.kind + ':' + s.key);
  });
}
// 按「链内下标」勾选（真实入口是块头那个复选框，走的也是 jobSeqSel + jobPickId）
function selectIdx(which, idxs){
  var tt = jobTables[currentTable], bb = jobCurrentBoard();
  var steps = jobResolveSteps(tt, which, bb);
  jobSeqSel = {};
  (idxs || []).forEach(function(i){ if (steps[i]) jobSeqSel[jobPickId(which, steps[i])] = true; });
}
`, sandbox);
    return sandbox;
}

// ============================================================
// 1）单块：↓ 下移一位 / ↑ 上移回来，其它步骤一个都不动
// ============================================================
console.log('1. 单块 ↓ / ↑：只挪它的位置');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(2, '坚果墙',   0, 1, 'once', 1));
boardEarly[0][2].push(plantItem(3, '向日葵',   0, 2, 'once', 1));
var before = stepShape(t, 'once', boardEarly);

selectIdx('once', [0]);
jobNudgeSelected(1);                       // 第 1 块下移一位
var down = stepShape(t, 'once', boardEarly);

selectIdx('once', [1]);                    // 刚才那块现在在第 2 位
jobNudgeSelected(-1);                      // 上移回去
var up = stepShape(t, 'once', boardEarly);

var expDown = before.slice();
expDown[0] = before[1]; expDown[1] = before[0];

({ before: before, down: down, up: up, expDown: expDown, saved: __saves });
`, s);
    eq(r.before.length, 3, '起手：链里 3 块');
    eq(r.down, r.expDown, '↓ 之后：第 1、2 块互换，第 3 块原地不动');
    eq(r.up, r.before, '↑ 之后：顺序回到原样（可逆）');
    ok(r.saved > 0, '每次挪动都走了 jobSaveLocal（撤销记录点）');
}

// ============================================================
// 2）到顶 / 到底：不动 + 提示，不许悄悄错位
// ============================================================
console.log('2. 边界：到顶到底不动');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(2, '坚果墙',   0, 1, 'once', 1));
var before = stepShape(t, 'once', boardEarly);

__status = '';
selectIdx('once', [0]);
jobNudgeSelected(-1);                      // 第一个还想上移
var topShape = stepShape(t, 'once', boardEarly);
var topMsg = __status;

__status = '';
selectIdx('once', [1]);
jobNudgeSelected(1);                       // 最后一个还想下移
var botShape = stepShape(t, 'once', boardEarly);
var botMsg = __status;

({ before: before, topShape: topShape, botShape: botShape, topMsg: topMsg, botMsg: botMsg });
`, s);
    eq(r.topShape, r.before, '第一个上移：数据不变');
    eq(r.botShape, r.before, '最后一个下移：数据不变');
    ok(/最前面/.test(r.topMsg), '给了「已经是最前面」提示（实际="' + r.topMsg + '"）');
    ok(/最后面/.test(r.botMsg), '给了「已经是最后面」提示（实际="' + r.botMsg + '"）');
}

// ============================================================
// 3）勾选多块 = 整组一起挪一位，组内相对顺序不变
// ============================================================
console.log('3. 整组：勾 2 块一起挪，组内顺序不变');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(2, '坚果墙',   0, 1, 'once', 1));
boardEarly[0][2].push(plantItem(3, '向日葵',   0, 2, 'once', 1));
var before = stepShape(t, 'once', boardEarly);

selectIdx('once', [0, 1]);                 // 勾前两块
jobNudgeSelected(1);                       // 整组下移一位
var after = stepShape(t, 'once', boardEarly);

var exp = [before[2], before[0], before[1]];

selectIdx('once', [1, 2]);                 // 下移后这组跑到了第 2-3 位
jobNudgeSelected(-1);
var back = stepShape(t, 'once', boardEarly);

({ before: before, after: after, exp: exp, back: back });
`, s);
    eq(r.after, r.exp, '整组下移：两块一起跨过第 3 块，组内先后不变');
    eq(r.before.slice(0, 2), r.after.slice(1, 3), '组内相对顺序没变（A 仍在 B 前面）');
    eq(r.back, r.before, '再整组上移一位：回到原样');
}

// ============================================================
// 4）跨链勾选：每条链各自在自己链内挪，绝不跨链混排
// ============================================================
console.log('4. 跨链勾选：各链各挪各的');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(2, '坚果墙',   0, 1, 'once', 1));
boardEarly[1][0].push(plantItem(3, '向日葵',   1, 0, 'loop', 1));
boardEarly[1][1].push(plantItem(1, '豌豆射手', 1, 1, 'loop', 1));

var once0 = stepShape(t, 'once', boardEarly);
var loop0 = stepShape(t, 'loop', boardEarly);

selectIdx('once', [0]);
var s1 = jobResolveSteps(t, 'once', boardEarly)[0];
selectIdx('loop', [0]);
var l1 = jobResolveSteps(t, 'loop', boardEarly)[0];
jobSeqSel = {};
jobSeqSel[jobPickId('once', s1)] = true;
jobSeqSel[jobPickId('loop', l1)] = true;

jobNudgeSelected(1);

var once1 = stepShape(t, 'once', boardEarly);
var loop1 = stepShape(t, 'loop', boardEarly);

({ once0: once0, loop0: loop0, once1: once1, loop1: loop1 });
`, s);
    eq(r.once1, [r.once0[1], r.once0[0]], '单次链：两块互换');
    eq(r.loop1, [r.loop0[1], r.loop0[0]], '循环链：同样互换（两条链各挪各的，没有混链）');
    eq(r.once1.length, r.once0.length, '单次链长度不变（没被塞进去别的东西）');
    eq(r.loop1.length, r.loop0.length, '循环链长度不变');
}

// ============================================================
// 5）没勾选：什么都不做（不许有副作用）
// ============================================================
console.log('5. 没勾选 = 空操作');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][1].push(plantItem(2, '坚果墙',   0, 1, 'once', 1));
var before = stepShape(t, 'once', boardEarly);

jobSeqSel = {};
var saves0 = __saves;
jobNudgeSelected(1);
jobNudgeSelected(-1);

({ before: before, after: stepShape(t, 'once', boardEarly), saves0: saves0, saves1: __saves });
`, s);
    eq(r.after, r.before, '顺序不变');
    eq(r.saves1, r.saves0, '没有写盘 / 没有记录撤销点（无副作用）');
}

console.log(fails ? ('\n❌ 有 ' + fails + ' 条断言失败') : '\n✅ 全部通过（链条 ↑/↓ 移一位）');
process.exit(fails ? 1 : 0);
