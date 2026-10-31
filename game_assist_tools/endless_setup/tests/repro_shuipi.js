// 水皮原始场景回归：单次[喂豆5-5, 喂豆5-3] -> 5-3 搬去循环 -> 保存重开 -> 搬回 -> 位置不得互换
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS_DIR = path.join(__dirname, '..', 'static', 'js');
const sandbox = {
    console,
    document: { addEventListener() { }, getElementById() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    alert() { },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['20-jobset-core.js', '15-board-actions.js', '22-jobset-chain.js',
    '24-jobset-fields.js', '21-jobset-levels.js', '27a-jobset-steps.js', '27b-jobset-stepcfg.js', '27c-jobset-chain-render.js', '27d-jobset-slots.js', '27e-jobset-hotkeys.js', '27f-jobset-export.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f }); }
    catch (e) { console.log(`LOAD ${f}: ${e.message}`); }
}
vm.runInContext(`var boardEarly=null, boardLate=null;
var jobSaveCurrentBoard=function(){}, jobSaveLocal=function(){},
    jobRenderSeqChains=function(){}, jobRenderCurrentBoard=function(){},
    jobIsBossBoard=function(){return false;}, setStatus=function(){};`, sandbox);

vm.runInContext(`
(function () {
    const board = [];
    for (let r = 0; r < 5; r++) { const row = []; for (let c = 0; c < 9; c++) row.push([]); board.push(row); }
    const act = jobBoardActionById('feed');
    // 喂豆5-5 先放（seq1），喂豆5-3 后放（seq2），都在单次
    board[4][4].push(jobBoardActionItem(act, 'once', 4, 4, 1));
    board[4][2].push(jobBoardActionItem(act, 'once', 4, 2, 2));
    const t = { slotModes: {}, slotOrder: [], loopOrder: [], endOrder: [], __b: board };
    jobTables.length = 0; jobTables.push(t); currentTable = 0;

    function view(w) {
        return jobResolveSteps(t, w, board).map(function (s) {
            const pl = jobPlacementsOf(board, s.key, w)[s.gidx];
            return pl ? (pl.item.row + '-' + pl.item.col) : '?';
        });
    }
    function saveReload() {
        const raw = JSON.parse(JSON.stringify({ s: t.slotOrder, l: t.loopOrder, e: t.endOrder, b: board }));
        raw.b.forEach(function (row) { row.forEach(function (cell) { cell.forEach(function (it) { delete it.ord; }); }); });
        t.slotOrder = raw.s; t.loopOrder = raw.l; t.endOrder = raw.e;
        for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) { board[r][c] = raw.b[r][c]; }
        jobEnsureSeq(board);
    }

    console.log('初始      单次:', view('once').join(' '), ' 循环:', view('loop').join(' '));

    // ① 把 喂豆5-3 从单次搬到循环（拖的是视图里 idx1）
    let st = jobResolveSteps(t, 'once', board)[1];
    jobMoveStepsToChain(t, board, { kind: 'step', which: 'once', key: 'feed', step: st }, 'loop', null, true);
    console.log('搬出后    单次:', view('once').join(' '), ' 循环:', view('loop').join(' '));

    // ② 保存重开
    saveReload();
    console.log('重开后    单次:', view('once').join(' '), ' 循环:', view('loop').join(' '));

    // ③ 把 喂豆5-3 从循环搬回单次
    st = jobResolveSteps(t, 'loop', board)[0];
    jobMoveStepsToChain(t, board, { kind: 'step', which: 'loop', key: 'feed', step: st }, 'once', null, true);
    const once1 = view('once'), loop1 = view('loop');
    console.log('搬回后    单次:', once1.join(' '), ' 循环:', loop1.join(' '));

    // ④ 再保存重开一次确认稳定
    saveReload();
    const once2 = view('once'), loop2 = view('loop');
    console.log('再重开    单次:', once2.join(' '), ' 循环:', loop2.join(' '));

    const ok = once1.join(',') === '5-5,5-3' && loop1.length === 0
        && once2.join(',') === '5-5,5-3' && loop2.length === 0;
    console.log(ok ? '\\n✅ 水皮场景通过：位置全程不互换' : '\\n❌ 仍有互换！');
})()
`, sandbox);
