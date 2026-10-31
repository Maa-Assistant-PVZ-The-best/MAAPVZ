// ============================================================
// 回归测试：链条步骤的**稳定身份 sid**（P0 第一步，2026-11-02）
//
// 治的是什么病：段里存的落点指认是「该槽在该链里的第 N 个落点」这种**位置下标**。
//   只要同一槽的落点成员一变（删掉一个/翻转形态/重载），下标就整体滑动，
//   挂在步骤上的 `uid`（勾选 / 拖动配对）也跟着滑 → §9.2 那族
//   「拖完互换 / 撤销错乱」。
//
// 本文件只钉住 P0 第一步（段存储**没改**，老作业集不需要迁移）：
//   ① 步骤带上 sid = 落点的稳定身份（`jobPlacementKey`：链|槽|行,列|seq）；
//   ② 删掉**别的**落点后，剩下步骤的 sid / stepId **不变**（旧实现会变）；
//   ③ 新加落点也不改变已有步骤的 sid；
//   ④ `jobCarryUids` 走 sid 配对 —— 删中间那株后，两边剩下步骤的 uid 仍一一对上。
//
// 运行：node tests\repro_sid.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');   // 公共假 DOM
const JS_DIR = path.join(__dirname, '..', 'static', 'js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(a, b, msg) {
    ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际=' + JSON.stringify(a) + '，期望=' + JSON.stringify(b) + '）');
}

function mkSandbox() {
    const els = {};
    const mkEl = H.mkEl;
    const sandbox = {
        console,
        document: {
            addEventListener: function () { },
            getElementById: function (id) { return els[id] || null; },
            querySelector: function () { return null; },
            querySelectorAll: function () { return []; },
            createElement: function (t) { return mkEl(t, els); },
            head: { appendChild: function () { } },
        },
        localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
        alert: function () { }, setTimeout: function () { return 0; }, clearTimeout: function () { },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const files = ['04-cards.js', '08-board-data.js', '15-board-actions.js', '20-jobset-core.js',
        '21-jobset-levels.js', '22-jobset-chain.js', '23-jobset-end.js', '24-jobset-fields.js',
        '27a-jobset-steps.js', '27b-jobset-stepcfg.js', '27c-jobset-chain-render.js', '27d-jobset-slots.js',
        '27e-jobset-hotkeys.js', '27f-jobset-export.js', '29-jobset-init.js', '42-jobset-batch.js',
        '43-jobset-cell-queue.js'];
    files.forEach(function (f) {
        try {
            vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
        } catch (e) {
            console.log('LOAD ' + f + ': ' + e.message);
        }
    });

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
// 摘要：每一步的 sid 与 stepId（含 uid 后缀）
function snap(t, which, board){
  return jobResolveSteps(t, which, board).map(function(s){
    return { sid: s.sid || '', id: jobStepId(s), uid: s.uid };
  });
}
`, sandbox);
    return sandbox;
}

// ============================================================
// 1）步骤带上了稳定身份 sid
// ============================================================
console.log('1. 植物步骤带 sid（链|槽|行,列|seq）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[2][1].push(plantItem(1, '豌豆射手', 2, 1, 'once', 1));
boardEarly[2][4].push(plantItem(1, '豌豆射手', 2, 4, 'once', 2));
var sp = snap(t, 'once', boardEarly);
({ sp: sp, sids: sp.map(function(x){ return x.sid; }) });
`, s);
    eq(r.sp.length, 2, '两个落点 → 两步');
    ok(r.sp.every(function (x) { return !!x.sid; }), '每一步都有 sid');
    ok(r.sids[0].indexOf('once|card1|') === 0, 'sid 形如 once|card1|行,列|seq（复用 jobPlacementKey 口径）');
}

// ============================================================
// 2）删掉「别的」落点 → 剩下的身份不变（这就是旧实现会漂的地方）
// ============================================================
console.log('2. 删中间那株：剩下两步的 sid / stepId 不变');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][3].push(plantItem(1, '豌豆射手', 0, 3, 'once', 2));
boardEarly[0][6].push(plantItem(1, '豌豆射手', 0, 6, 'once', 3));

var before = snap(t, 'once', boardEarly);

// 删掉中间那格（gidx 会从 [0,1,2] 变成 [0,1]）
boardEarly[0][3] = [];
var after = snap(t, 'once', boardEarly);

// 旧实现：剩下两步的下标前移，身份跟着变；新实现：sid 不变
function byId(list, id){ return list.filter(function(x){ return x.id === id; })[0] || null; }
({
  beforeIds: before.map(function(x){ return x.id; }),
  afterIds: after.map(function(x){ return x.id; }),
  beforeSids: before.map(function(x){ return x.sid; }),
  afterSids: after.map(function(x){ return x.sid; }),
  keptUidOk: !!(byId(after, before[0].id) && byId(after, before[0].id).uid === before[0].uid)
});
`, s);
    eq(r.beforeSids.length, 3, '删之前 3 步');
    eq(r.afterSids.length, 2, '删之后 2 步');
    // 剩下的是第 1、3 株：它们的 sid 必须与删除前一致
    eq(r.afterSids, [r.beforeSids[0], r.beforeSids[2]],
        '剩下的两步 sid 与删除前完全相同（不再随 gidx 前移而变）');
    ok(r.afterIds.indexOf(r.beforeIds[0]) !== -1, '第 1 株的 stepId 不变');
    ok(r.keptUidOk, '第 1 株的 uid 也没变（jobCarryUids 按 sid 配对成功）');
}

// ============================================================
// 3）新加落点也不改变已有步骤的身份
// ============================================================
console.log('3. 新加一株：已有步骤的 sid 不变');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[1][1].push(plantItem(1, '豌豆射手', 1, 1, 'once', 1));
boardEarly[1][5].push(plantItem(1, '豌豆射手', 1, 5, 'once', 2));
var before = snap(t, 'once', boardEarly);
// 在前面插一个 seq 更小的落点（会改变排序，但身份不该变）
boardEarly[1][0].push(plantItem(1, '豌豆射手', 1, 0, 'once', 0));
var after = snap(t, 'once', boardEarly);
({
  before: before.map(function(x){ return x.sid; }),
  after: after.map(function(x){ return x.sid; })
});
`, s);
    eq(r.after.length, 3, '加完 3 步');
    r.before.forEach(function (sid) {
        ok(r.after.indexOf(sid) !== -1, '老落点的 sid「' + sid + '」仍然在链里（没被改掉）');
    });
}

// ============================================================
// 4）没有 sid 的老步骤仍然能工作（旧口径兜底，段存储没变）
// ============================================================
console.log('4. 兜底：没有 sid 的步骤仍按 key#gidx（老作业集不受影响）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
var legacy = { kind: 'plant', key: 'card3', gidx: 2 };
({ id: jobStepId(legacy), idn: jobStepIdentity(legacy) });
`, s);
    eq(r.id, 'card3#2', '没 sid 的植物步骤 id 仍是 key#gidx（不会因为改造而抛错）');
}

// ============================================================
// 5）**存盘 → 载入**：链里只挑了「同格里的第 2 株」，把第 1 株删掉
//    ★ 这是真正会出事的场景（旧实现：picked=[1] 越界被丢 → **这一步从链里消失**）
// ============================================================
console.log('5. 同格两株，链里只挑了第 2 株 → 删掉第 1 株后它仍在链里');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 2));
var sid2 = jobStepSid('once', { kind: 'plant', key: 'card1', gidx: 1 }, boardEarly);

// 链 = [这株植物, 等待] —— 植物的**位置**是有意义的（后面跟着等待）
t.slotOrder = [
  { key: 'card1', from: -1, to: -1, picked: [1], sids: [sid2] },
  { key: 'ga:wait', ga: 'wait', ms: 500 }
];

// 删掉同格的第 1 株 -> 剩下的第 2 株变成 gidx 0
boardEarly[0][0].splice(0, 1);

var shape = function (list) {
  return list.map(function (s) {
    return (s.kind === 'plant') ? (s.key + '#' + s.gidx) : (s.kind + ':' + s.key);
  });
};
var withSids = shape(jobResolveSteps(t, 'once', boardEarly));

// 同一条链去掉 sids（= 老作业集的样子）
t.slotOrder = [
  { key: 'card1', from: -1, to: -1, picked: [1] },
  { key: 'ga:wait', ga: 'wait', ms: 500 }
];
var withoutSids = shape(jobResolveSteps(t, 'once', boardEarly));

({ withSids: withSids, withoutSids: withoutSids, sid2: sid2 });
`, s);
    eq(r.withSids, ['card1#0', 'wait:ga:wait'],
        '新格式（带 sids）：那一株**还在原位**（植物 → 等待 的顺序没变）');
    eq(r.withoutSids, ['wait:ga:wait', 'card1#0'],
        '老格式（只有 picked 下标）：这一株被当"新落点"补到链尾了 —— 顺序错，这就是要治的病');
}

// ============================================================
// 6）「动作后等待」悬空键清理（jobPruneWaitAfter）
//    waitAfter 的键是 `mode|槽|行,列|seq`。落点删掉后原本**没人清理**，
//    文件里会一直攒着指向“不存在的落点”的键。
// ============================================================
console.log('6. 清理 waitAfter 里指向已删落点的悬空键');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));

// 三个键：① 有效（正好指向那一株）② 悬空（棋盘上没这个落点）③ 认不出来的形态
t.waitAfter = {
  'once|card1|0,0|1': 3000,
  'once|card1|4,8|9': 5000,
  'not-a-key': 800
};

// 走一次链条写盘（= 任何改链条的操作都会经过这里）
jobStoreSteps(t, 'once', boardEarly, jobResolveSteps(t, 'once', boardEarly));

({ keys: Object.keys(t.waitAfter).sort() });
`, s);
    eq(r.keys, ['not-a-key', 'once|card1|0,0|1'],
        '悬空键被清掉；有效键和「认不出来的键」都保留（不认识的不敢删）');
}

console.log(fails ? ('\n❌ 有 ' + fails + ' 条断言失败') : '\n✅ 全部通过（步骤稳定身份 sid）');
process.exit(fails ? 1 : 0);
