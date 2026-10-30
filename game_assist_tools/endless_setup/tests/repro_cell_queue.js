// ============================================================
// 回归测试：格内落子队列（右键格子 = 方块弹窗）+ Ctrl+右键清空整格
//
// 用户需求（2026-10-31）：
//   「直接右键点击这个多个格子覆盖的落子位置时，显示的是方块格式的样子，
//    （长得和棋盘差不多，角标保留，按照放置顺序排序，不同链不影响，
//     可以拖拽修改这个格子的放置顺序，最左上角就是最先放）
//    右键去除整个格子则是 ctrl+右键」
//   「不同链条做区分，支持跨植物修改，右键点击清空的特性保留」
//
// 这里盯的是**数据**（弹窗长得对不对靠用户 Ctrl+F5 眼看，本环境跑不了浏览器）：
//   ① 拖拽重排 = 只重排「这一格那几个落点所在的步骤位置」，别的步骤顺序不变；
//   ② 跨植物/跨动作能排（会自动拆段/并段）；
//   ③ 单条链（单次/循环/收尾）各自独立，互不牵连；
//   ④ 删单个落点 / 清空整格之后，链条里的引用不跑偏（gidx 前移不会指向别的落点）。
//
// 运行：node tests\repro_cell_queue.js
// 退出码：0 = 全过；1 = 有断言失败
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

// 简易 DOM 元素：用来验证方块窗「画出来是什么结构」（挡不住样式，但能挡住
// 「元素没挂上 / 分组漏了 / 点 ✕ 没反应」这类逻辑错）
function mkEl(tag) {
    const el = {
        tagName: tag, style: {}, children: [], _text: '', _html: '', _a: {}, _h: {}, _cls: {},
        classList: {
            add(c) { el._cls[c] = true; },
            remove(c) { delete el._cls[c]; },
            contains(c) { return !!el._cls[c]; },
        },
        appendChild(c) { el.children.push(c); return c; },
        addEventListener(t, fn) { el._h[t] = fn; },
        setAttribute(k, v) { el._a[k] = v; },
        getAttribute(k) { return el._a[k]; },
        setAttributeNS() { },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 68, height: 44 }; },
        get textContent() { return el._text; },
        set textContent(v) { el._text = String(v); },
        get innerHTML() { return el._html; },
        set innerHTML(v) { el._html = String(v); if (!v) el.children = []; },
    };
    return el;
}

function mkSandbox(opts) {
    const withDom = !!(opts && opts.dom);
    const els = {};
    const getEl = function (id) {
        if (!els[id]) els[id] = mkEl('div');
        return els[id];
    };
    const sandbox = {
        console,
        document: {
            addEventListener() { },
            getElementById(id) { return withDom ? getEl(id) : null; },
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
        '27-jobset-board.js', '29-jobset-init.js', '42-jobset-batch.js',
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
function actItem(id, name, r, c, mode, seq){
  return { id: id, label: name, type: id, mode: mode || 'once',
           col: c + 1, row: r + 1, seq: seq || 1 };
}
// 链条「一株一步」的形状，方便断言
function stepShape(t, which, board){
  return jobResolveSteps(t, which, board).map(function(s){
    return (s.kind === 'plant') ? (s.key + '#' + s.gidx) : (s.kind + ':' + s.key);
  });
}
function cellNames(board, r, c){
  return (board[r][c] || []).map(function(it){ return it.label || it.id; });
}
`, sandbox);
    return sandbox;
}

// ============================================================
// 1）右键方块窗：拖拽重排（跨植物 / 跨动作），别的格不受牵连
// ============================================================
console.log('1. 本格重排：跨植物 / 跨动作，其它步骤顺序不变');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
// (0,0)：喂豆 + 种槽1；(1,1)：同样两步（用来验证「别的格」不受影响）
var feedA = actItem('feed', '喂豆', 0, 0, 'once', 1);
var cardA = plantItem(1, '豌豆射手', 0, 0, 'once', 1);
var feedB = actItem('feed', '喂豆', 1, 1, 'once', 2);
var cardB = plantItem(1, '豌豆射手', 1, 1, 'once', 2);
boardEarly[0][0].push(feedA, cardA);
boardEarly[1][1].push(feedB, cardB);

var before = stepShape(t, 'once', boardEarly);
// 打开方块窗的上下文（真实入口是 08 的右键 -> jobOpenCellQueue）
_cqCtx = { r: 0, c: 0, board: boardEarly };
var groups0 = jobCellQueueGroups().map(function(g){ return g.which + ':' + g.items.length; });
var items0 = jobCellQueueItemsOf('once').items.map(function(it){ return it.label; });
// 拖拽：把「喂豆」拖到「豌豆射手」前面
var moved = jobCellQueueMove('once', feedA, cardA, false);
var after = stepShape(t, 'once', boardEarly);
var items1 = jobCellQueueItemsOf('once').items.map(function(it){ return it.label; });
var badges = jobCellQueueItemsOf('once').items.map(function(it){
  var k = jobPlacementKey('once', it.id, 0, 0, it.seq);
  return jobCellQueueItemsOf('once').gseq.get(k);
});
({ before: before, after: after, moved: moved,
   groups0: groups0, items0: items0, items1: items1, badges: badges,
   saved: __saves, segs: (t.slotOrder || []).length });
`, s);
    eq(r.groups0, ['once:2'], '分组：这一格只有「单次」一条链，2 项');
    eq(r.before, ['card1#0', 'card1#1', 'feed#0', 'feed#1'], '默认链序：先是所有种植物，再是喂豆');
    eq(r.moved, true, '拖拽被接受');
    eq(r.after, ['feed#0', 'card1#1', 'card1#0', 'feed#1'],
        '只交换了「本格那两个步骤占的位置」，别的步骤（card1#1 / feed#1）原地不动');
    eq(r.items0, ['豌豆射手', '喂豆'], '重排前：这一格按链序是 先种 后喂');
    eq(r.items1, ['喂豆', '豌豆射手'], '重排后：这一格按链序变成 先喂 后种（左上角 = 最先）');
    eq(r.badges, [1, 3], '角标跟着链序重编号（喂豆=1、种=3），与棋盘角标同源');
    eq(r.segs, 4, '存回段格式后自动拆成 4 段（相邻同槽才并段）');
    ok(r.saved > 0, '改动走了 jobSaveLocal（撤销记录点）');
}

// ============================================================
// 2）删单个落点：链条同步收缩，别的落点 gidx 不跑偏
// ============================================================
console.log('2. ✕ 只删一个落点：链条同步，其它落点不跑偏');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
var feedA = actItem('feed', '喂豆', 0, 0, 'once', 1);
var cardA = plantItem(1, '豌豆射手', 0, 0, 'once', 1);
var cardB = plantItem(1, '豌豆射手', 2, 2, 'once', 2);   // 同槽、另一格
boardEarly[0][0].push(feedA, cardA);
boardEarly[2][2].push(cardB);
_cqCtx = { r: 0, c: 0, board: boardEarly };
var before = stepShape(t, 'once', boardEarly);
jobCellQueueDelete([feedA]);
var after = stepShape(t, 'once', boardEarly);
// 被删的是喂豆；两颗豌豆必须还在、且 gidx 重排成 0/1 后仍指向原来那两个落点
var places = jobPlacementsOf(boardEarly, 'card1', 'once');
({ before: before, after: after,
   cellA: cellNames(boardEarly, 0, 0), cellB: cellNames(boardEarly, 2, 2),
   sameItem0: places[0] && places[0].item === cardA,
   sameItem1: places[1] && places[1].item === cardB,
   gidxInChain: jobResolveSteps(t, 'once', boardEarly).map(function(x){ return x.gidx; }),
   status: __status });
`, s);
    eq(r.before, ['card1#0', 'card1#1', 'feed#0'], '删前：两颗豌豆 + 一个喂豆');
    eq(r.cellA, ['豌豆射手'], '这一格只剩豌豆（喂豆被删）');
    eq(r.cellB, ['豌豆射手'], '另一格原样');
    eq(r.after, ['card1#0', 'card1#1'], '链条里那一步也同步消失');
    ok(r.sameItem0 && r.sameItem1, '两颗豌豆的落点对象没串位（gidx 0/1 仍指向原来那两个）');
    eq(r.gidxInChain, [0, 1], '链条里的 gidx 跟着重编号');
    ok(/已删掉 1 个落点/.test(r.status), '状态提示播报了删除（' + r.status + '）');
}

// ============================================================
// 3）Ctrl+右键 = 清空整格：只清那一格，其它格与链条都干净
// ============================================================
console.log('3. Ctrl+右键清空整格：只清那一格');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(actItem('feed', '喂豆', 0, 0, 'once', 1));
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
boardEarly[1][1].push(actItem('feed', '喂豆', 1, 1, 'once', 2));
boardEarly[1][1].push(plantItem(1, '豌豆射手', 1, 1, 'once', 2));
var n = jobCellQueueClear(0, 0);
var emptyHit = jobCellQueueClear(0, 0);        // 再清一次：空格不该报错
({ n: n, emptyHit: emptyHit,
   cellA: cellNames(boardEarly, 0, 0), cellB: cellNames(boardEarly, 1, 1),
   steps: stepShape(t, 'once', boardEarly),
   cqCtx: _cqCtx, status: __status });
`, s);
    eq(r.n, 2, '清掉了这一格的 2 个落子');
    eq(r.cellA, [], '这一格空了');
    eq(r.cellB, ['喂豆', '豌豆射手'], '另一格原样（喂豆 + 豌豆都还在）');
    eq(r.steps, ['card1#0', 'feed#0'], '链条只剩另一格那两步，gidx 重新编号');
    eq(r.emptyHit, 0, '空格再清一次：返回 0，不炸');
    eq(r.cqCtx, null, '没有借来的上下文残留（棋盘直接调用时原样还回去）');
}

// ============================================================
// 4）不同链做区分：单次 / 循环 各自排序，互不牵连
// ============================================================
console.log('4. 单次 / 循环分组各自排序');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
var cOnce = plantItem(1, '豌豆射手', 0, 0, 'once', 1);
var fOnce = actItem('feed', '喂豆', 0, 0, 'once', 1);
var fLoop = actItem('feed', '喂豆', 0, 0, 'loop', 1);
boardEarly[0][0].push(cOnce, fOnce, fLoop);
_cqCtx = { r: 0, c: 0, board: boardEarly };
var groups = jobCellQueueGroups().map(function(g){ return g.which + ':' + g.items.length; });
var loopBefore = stepShape(t, 'loop', boardEarly);
// 只排「单次」：把喂豆拖到豌豆前面
var moved = jobCellQueueMove('once', fOnce, cOnce, false);
var onceAfter = stepShape(t, 'once', boardEarly);
var loopAfter = stepShape(t, 'loop', boardEarly);
// 跨链拖拽必须被拒绝（不同链没有可比性）
var crossTry = jobCellQueueMove('loop', fLoop, cOnce, false);
({ groups: groups, moved: moved, onceAfter: onceAfter,
   loopBefore: loopBefore, loopAfter: loopAfter, crossTry: crossTry });
`, s);
    eq(r.groups, ['once:2', 'loop:1'], '分组：单次 2 项 + 循环 1 项（收尾没有就不显示）');
    eq(r.moved, true, '单次链内重排成功');
    eq(r.onceAfter, ['feed#0', 'card1#0'], '单次链：喂豆跑到豌豆前面');
    eq(r.loopBefore, ['feed#0'], '循环链本来只有一步');
    eq(r.loopAfter, ['feed#0'], '循环链一点没动（不同链互不影响）');
    eq(r.crossTry, false, '跨链拖拽被拒绝');
}

// ============================================================
// 5）角标与棋盘同源 + 上下文失效保护
// ============================================================
console.log('5. 角标同源 / 上下文失效保护');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(actItem('feed', '喂豆', 0, 0, 'once', 1));
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
_cqCtx = { r: 0, c: 0, board: boardEarly };
var alive1 = jobCellQueueAlive();
var gseq = jobCellQueueItemsOf('once').gseq;
var kFeed = jobPlacementKey('once', 'feed', 0, 0, 1);
var kCard = jobPlacementKey('once', 'card1', 0, 0, 1);
// 换棋盘（模拟换表 / 切 tab）：上下文立刻失效
var deadBoard = blankBoard();
_cqCtx = { r: 0, c: 0, board: deadBoard };
var alive2 = jobCellQueueAlive();
var movedDead = jobCellQueueMove('once', {id:'feed'}, {id:'card1'}, false);
// ★ 清空是给「棋盘右键」用的，不看弹窗上下文 —— 按**当前棋盘**来
var clearedLive = jobCellQueueClear(0, 0);
var ctxRestored = (_cqCtx === null || _cqCtx.board === deadBoard);
({ alive1: alive1, alive2: alive2, movedDead: movedDead, clearedLive: clearedLive,
   ctxRestored: ctxRestored,
   cellA: (boardEarly[0][0] || []).length,
   badgeFeed: gseq && gseq.get(kFeed), badgeCard: gseq && gseq.get(kCard) });
`, s);
    ok(r.alive1, '上下文有效时可用');
    ok(!r.alive2, '棋盘换了对象（换表/切 tab）-> 上下文失效');
    eq(r.movedDead, false, '失效后拖拽直接拒绝');
    eq(r.clearedLive, 2, '失效后「清空」照样能用：它按当前棋盘来（Ctrl+右键就这么调）');
    eq(r.cellA, 0, '确实清空了那一格');
    ok(r.ctxRestored, '借来的上下文原样还回去（不会把弹窗上下文搞乱）');
    eq([r.badgeFeed, r.badgeCard], [2, 1], '角标 = 链条全局序号（默认链序先植物后喂豆，与棋盘角标同源）');
}

// ============================================================
// 6）方块窗真的画得出来：一张表一条链一组、方块数对得上、✕ 能删
// ============================================================
console.log('6. 方块窗结构（DOM）：分组 / 方块数 / 角标 / ✕');
{
    const s = mkSandbox({ dom: true });
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
var fOnce = actItem('feed', '喂豆', 0, 0, 'once', 1);
var cOnce = plantItem(1, '豌豆射手', 0, 0, 'once', 1);
var fLoop = actItem('feed', '喂豆', 0, 0, 'loop', 1);
boardEarly[0][0].push(fOnce, cOnce, fLoop);

var opened = jobOpenCellQueue(0, 0);
var modal = document.getElementById('cellQueueModal');
var body = document.getElementById('cqBody');
var sub = document.getElementById('cqSub');
var openCls = modal.classList.contains('cq-open');
var subAtOpen = sub.textContent;
var groups = (body.children || []).map(function (g) {
    var grid = g.children[1];
    return g.children[0].children[0].textContent + ':' + (grid ? grid.children.length : -1);
});
// 取第一个方块：可拖拽 + 角标（cq-seq…）+ ✕
var firstBlock = (body.children[0] && body.children[0].children[1])
    ? body.children[0].children[1].children[0] : null;
var kids = firstBlock ? firstBlock.children[0].children : [];
var firstBadge = kids.filter(function (c) { return String(c.className || '').indexOf('cq-seq') === 0; })[0];
var firstX = kids.filter(function (c) { return c.className === 'cq-x'; })[0];
var draggable = !!firstBlock && firstBlock.draggable === true;
var badgeText = firstBadge ? firstBadge.textContent : '';
// 点 ✕ 只删这一个（弹窗要自己刷新）
if (firstX) firstX._h.click({ stopPropagation: function () { } });
var afterX = (boardEarly[0][0] || []).length;
var subAfterX = sub.textContent;
var opensOnEmpty = jobOpenCellQueue(4, 4);      // 空格不该弹窗
jobCloseCellQueue();
var closedOk = !modal.classList.contains('cq-open');
var afterX = (boardEarly[0][0] || []).length;
var subAfterX = sub.textContent;
var opensOnEmpty = jobOpenCellQueue(4, 4);      // 空格不该弹窗
jobCloseCellQueue();
var closedOk = !modal.classList.contains('cq-open');
({ opened: opened, openCls: openCls, subAtOpen: subAtOpen, subAfterX: subAfterX,
   groups: groups, badge: badgeText, draggable: draggable,
   afterX: afterX, closedOk: closedOk, opensOnEmpty: opensOnEmpty });
`, s);
    eq(r.opened, true, '右键多落点格 -> 弹窗打开');
    ok(r.openCls, '弹窗挂上 cq-open（CSS 靠它显示）');
    eq(r.subAtOpen, '第 (1, 1) 格 · 共 3 项', '副标题 = 坐标 + 总项数');
    eq(r.groups, ['单次:2', '循环:1'], '单次 / 循环各一组，组内方块数正确');
    eq(r.badge, '1', '第一个方块的角标 = 链条全局序号（与棋盘 #N 同源）');
    eq(r.draggable, true, '方块可拖拽');
    eq(r.afterX, 2, '点 ✕ 只删掉那一个落点（3 -> 2）');
    eq(r.subAfterX, '第 (1, 1) 格 · 共 2 项', '删完弹窗自己刷新（副标题跟着变）');
    ok(r.closedOk, '关掉弹窗后 cq-open 被摘掉');
    eq(r.opensOnEmpty, false, '空格子右键不弹窗');
}

// ============================================================
// 7）★ Ctrl+右键清空之后，**按一次** Ctrl+Z 就要撤回（用户实锤过的 bug）
//
//    根因：渲染不是只读的 —— renderBoard 的 jobEnsureSeq 会补 seq/ord，
//    jobGetChainOrder 会把「覆盖率修复」的段写回 t[field]。
//    所以收尾必须「先渲染、最后 jobSaveLocal()」；反过来先把快照存了，
//    等按 Ctrl+Z 时 undoBoard 开头那次 jobUndoRecord() 会发现 sig 变了、
//    又压一条 —— 第一下只是回到"看起来一模一样"的旧状态（白按一下）。
//    这里用「渲染桩会改数据」来模拟真实渲染的副作用，把顺序钉死。
// ============================================================
console.log('7. 清空后按一次 Ctrl+Z 就撤回（渲染会改数据也不能白按）');
{
    const s = mkSandbox();
    const r = vm.runInContext(`
jobTables.length = 0;
jobNewTable();
var t = jobTables[0];
currentTable = 0;
initBoards();
boardEarly[0][0].push(actItem('feed', '喂豆', 0, 0, 'once', 1));
boardEarly[0][0].push(plantItem(1, '豌豆射手', 0, 0, 'once', 1));
// 另一格放一株**没有 ord** 的：模拟"渲染会给它补 ord"的副作用
boardEarly[1][1].push(plantItem(2, '坚果墙', 1, 1, 'once', 1));

// ★ 模拟真实渲染的副作用：renderBoard 会给落点补 ord（jobEnsureOrd）
var __ordSeq = 0;
jobRenderCurrentBoard = function () {
  (boardEarly || []).forEach(function (row) {
    (row || []).forEach(function (cell) {
      (cell || []).forEach(function (it) {
        if (typeof it.ord !== 'number') it.ord = ++__ordSeq;
      });
    });
  });
};
// 用真 jobSaveLocal（撤销记录点）—— 别用测试桩
jobSaveLocal = function () { jobUndoRecord(); };
jobUndoReset();
var stack0 = undoStack.length;
jobCellQueueClear(0, 0);
var cellAfterClear = (boardEarly[0][0] || []).length;
var stackAfterClear = undoStack.length;
var otherHasOrd = typeof boardEarly[1][1][0].ord === 'number';
undoBoard();                       // ← 只按一次
({ stack0: stack0, stackAfterClear: stackAfterClear,
   cellAfterClear: cellAfterClear, otherHasOrd: otherHasOrd,
   cellAfterUndo1: (boardEarly[0][0] || []).length,
   status: __status });
`, s);
    eq(r.cellAfterClear, 0, 'Ctrl+右键清空生效');
    ok(r.otherHasOrd, '渲染的副作用确实发生了（别的格被补了 ord）');
    eq(r.stackAfterClear, r.stack0 + 1, '撤销栈只长一条（渲染完数据定型了才记录）');
    eq(r.cellAfterUndo1, 2, '按一次 Ctrl+Z 就把这一格撤回来了');
    ok(/已撤销/.test(r.status), '状态提示：' + r.status);
}

console.log('');
if (fails) {
    console.log('❌ 共 ' + fails + ' 条断言失败');
    process.exit(1);
}
console.log('✅ 全部通过（格内落子队列：重排 / 单个删除 / 清空整格 / 不同链分组 / 弹窗结构）');
