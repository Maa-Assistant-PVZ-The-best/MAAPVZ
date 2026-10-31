// ============================================================
// 链条拖拽模糊测试台 v2（Node + vm 加载真实编辑器代码）
//   模型 = 用户意图（token 序列）；每次操作后真实 jobResolveSteps
//   视图必须等于意图。操作池：放喂豆/加动作/同链拖/跨链搬/
//   多选跨链/保存重开(丢 ord)/删除/无间隔组。
//   运行：node _fuzz_drag.js [sessions] [ops]
// ============================================================
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
vm.runInContext(`
var boardEarly = null, boardLate = null;
var jobSaveCurrentBoard = function(){}, jobSaveLocal = function(){},
    jobRenderSeqChains = function(){}, jobRenderCurrentBoard = function(){},
    jobIsBossBoard = function(){ return false; }, setStatus = function(){};
`, sandbox);

vm.runInContext(`
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// token: {k:'F',r,c,q,s} 喂豆(q=seq,s=1表示synthesized) / {k:'C',from} /
//        {k:'A',body} / {k:'W',ms} / {k:'G',key}；noint 标记 tok.n=1
function fzNewState() {
    const board = [];
    for (let r = 0; r < 5; r++) { const row = []; for (let c = 0; c < 9; c++) row.push([]); board.push(row); }
    return { t: { slotModes: {}, slotOrder: [], loopOrder: [], endOrder: [], __b: board },
             board: board, model: { once: [], loop: [], end: [] } };
}

// 浮动重组：synthesized 喂豆按 seq 插到「最后一个喂豆之后」（无则链尾）
function fzFloat(tokens) {
    const stored = tokens.filter(function (x) { return !x.s; });
    const synths = tokens.filter(function (x) { return x.s; })
        .sort(function (a, b) { return (a.q || 0) - (b.q || 0); });
    const out = stored.slice();
    synths.forEach(function (tok) {
        let at = -1;
        for (let i = out.length - 1; i >= 0; i--) if (out[i].k === 'F') { at = i; break; }
        // 浮动落进「」组中段时顺延到组尾（镜像解析层的 N1b 规则）
        if (at !== -1 && out[at].n) { while (at + 1 < out.length && out[at + 1].n) at++; }
        out.splice(at === -1 ? out.length : at + 1, 0, tok);
    });
    return out;
}

function fzView(st, which) {
    return jobResolveSteps(st.t, which, st.board).map(function (s) {
        let tok;
        if (s.kind === 'plant') {
            const pl = jobPlacementsOf(st.board, s.key, which)[s.gidx];
            tok = { k: 'F', r: pl ? pl.item.row : -1, c: pl ? pl.item.col : -1,
                    q: pl ? pl.item.seq : -1, s: s.synthesized ? 1 : 0 };
        } else if (s.key === 'ga:wait') tok = { k: 'W', ms: s.ms, s: 0 };
        else if (s.key === 'ga:custom') tok = { k: 'C', from: s.from || '', s: 0 };
        else if (s.key === 'ga:artifact') tok = { k: 'A', body: s.artBody || '', s: 0 };
        else tok = { k: 'G', key: s.key, s: 0 };
        if (s.noint === true) tok.n = 1;
        return tok;
    });
}
function fzTokStr(t2) {
    let s = t2.k === 'F' ? ('喂豆' + t2.r + '-' + t2.c + '#' + t2.q + (t2.s ? '(浮)' : ''))
        : t2.k === 'W' ? ('等' + t2.ms)
        : t2.k === 'C' ? ('点·' + t2.from)
        : t2.k === 'A' ? ('神器·' + (t2.body || '?'))
        : t2.key;
    return (t2.n ? '「' : '') + s + (t2.n ? '」' : '');
}
// 真实函数需要的全局（jobToggleNointGroup 用 jobTables[currentTable]/jobCurrentBoard）
function fzWire(st) {
    jobTables.length = 0; jobTables.push(st.t);
    currentTable = 0; boardEarly = st.board;
}
function fzRender(st) {
    const out = {};
    ['once', 'loop', 'end'].forEach(function (w) { out[w] = jobResolveSteps(st.t, w, st.board); });
    return out;
}
// 镜像 jobNormalizeNoint：孤立（前后都没有 noint 邻居）的步骤退回普通
function fzNormalizeModel(chain) {
    chain.forEach(function (tok, i) {
        if (!tok.n) return;
        const L = i > 0 && !!chain[i - 1].n, R = i < chain.length - 1 && !!chain[i + 1].n;
        if (!L && !R) delete tok.n;
    });
}
function fzBoardFeed(st, tok) {
    for (let r = 0; r < st.board.length; r++) for (let c = 0; c < st.board[r].length; c++) {
        for (const it of st.board[r][c]) if (it.id === 'feed' && it.row === tok.r && it.col === tok.c) return it;
    }
    return null;
}

// ---------- 操作 ----------
function fzPlaceFeed(st, mode, r, c) {
    const act = jobBoardActionById('feed');
    const seq = jobNextSeq(st.board, 'feed', mode);
    st.board[r][c].push(jobBoardActionItem(act, mode, r, c, seq));
    st.model[mode].push({ k: 'F', r: r + 1, c: c + 1, q: seq, s: 1 });
    st.model[mode] = fzFloat(st.model[mode]);   // 放置意图 = 浮动位置
}

let _fzCk = 0;
function fzAddGeneric(st, which, rnd) {
    const pool = [
        function () { return { seg: { key: 'ga:custom', act: 'click', from: 'K' + (++_fzCk) }, tok: { k: 'C', from: 'K' + _fzCk, s: 0 } }; },
        function () { const b = ['small', 'mid', 'big'][(rnd() * 3) | 0];
            return { seg: { key: 'ga:artifact', artName: '葫芦神器', artType: 'special', artBody: b }, tok: { k: 'A', body: b, s: 0 } }; },
        function () { const ms = [500, 1000, 2000][(rnd() * 3) | 0];
            return { seg: { key: 'ga:wait', ms: ms }, tok: { k: 'W', ms: ms, s: 0 } }; },
        function () { return { seg: { key: 'ga:bean' }, tok: { k: 'G', key: 'ga:bean', s: 0 } }; },
    ];
    const x = pool[(rnd() * pool.length) | 0]();
    const field = jobChainField(which, st.board);
    if (!Array.isArray(st.t[field])) st.t[field] = [];
    st.t[field].push(x.seg);
    st.model[which].push(x.tok);
    st.model[which] = fzFloat(st.model[which]);
}

function fzSameDrag(st, which, i, j, after) {
    const rendered = fzRender(st)[which];
    if (!rendered.length || i >= rendered.length) return null;
    if (j !== null && j >= rendered.length) return null;
    const drag = { kind: 'step', which: which, key: rendered[i].key, step: rendered[i], gidx: rendered[i].gidx };
    jobApplyDrop(drag, { t: st.t, which: which, board: st.board,
        step: j === null ? null : rendered[j], after: !!after });
    // 意图：摘掉 i，插到 j 前/后（j===null -> 链尾）；存盘即所见 -> 全链固化
    const chain = st.model[which];
    const mv = chain.splice(i, 1)[0];
    if (j === null) chain.push(mv);
    else {
        if (i === j) chain.splice(i, 0, mv);    // 自落 = 不动
        else { const pos = j > i ? j - 1 : j; chain.splice(after ? pos + 1 : pos, 0, mv); }
    }
    chain.forEach(function (x) { x.s = 0; });
    fzNormalizeModel(chain);
    return '同链[' + which + '] 步' + i + '->' + (j === null ? '尾' : (j + (after ? '后' : '前')));
}

function fzCrossMove(st, from, to, i, j, after) {
    const renderedFrom = fzRender(st)[from];
    if (!renderedFrom.length || i >= renderedFrom.length) return null;
    if (j !== null) { const rt = fzRender(st)[to]; if (j >= rt.length) return null;
        var anchor = rt[j]; } else var anchor = null;
    const drag = { kind: 'step', which: from, key: renderedFrom[i].key, step: renderedFrom[i], gidx: renderedFrom[i].gidx };
    const ok = jobMoveStepsToChain(st.t, st.board, drag, to, anchor, !!after);
    const desc = '跨链[' + from + '->' + to + '] 步' + i + '->' + (j === null ? '尾' : (j + (after ? '后' : '前')));
    if (!ok) {
        // 真实函数拒绝（可能已半途改状态）：不同步意图，交给校验器抓漂移
        return desc + ' 【被jobMoveStepsToChain拒绝】';
    }
    const src = st.model[from], dst = st.model[to];
    const mv = src.splice(i, 1)[0];
    // seq 已被真实搬运按目标形态重编号（mode 也是真实代码翻的，别重复翻）
    if (mv.k === 'F') { const it = fzBoardFeed(st, mv); if (it) mv.q = it.seq; }
    // 跨链搬运会固化两条链（真实代码在 ③④ 里 delete synthesized）
    src.forEach(function (x) { x.s = 0; }); dst.forEach(function (x) { x.s = 0; });
    mv.s = 0;
    if (j === null) dst.push(mv); else dst.splice(after ? j + 1 : j, 0, mv);
    fzNormalizeModel(src); fzNormalizeModel(dst);
    return desc;
}

function fzGroupCross(st, from, to, idxs) {
    const rendered = fzRender(st)[from];
    idxs = idxs.filter(function (x) { return x < rendered.length; });
    if (idxs.length < 2) return null;
    fzWire(st);
    jobSeqSel = {};
    idxs.forEach(function (x) { jobSeqSel[jobPickId(from, rendered[x])] = { which: from, step: rendered[x] }; });
    const group = jobDragGroupFor(from, rendered[idxs[0]], st.board);
    if (!group) { jobSeqSel = {}; return null; }
    const ok = jobMoveStepsToChain(st.t, st.board, { kind: 'group', which: from, key: rendered[idxs[0]].key, step: rendered[idxs[0]], group: group }, to, null, true);
    jobSeqSel = {};
    const desc = '多选跨链[' + from + '->' + to + '] ' + idxs.slice().sort(function (a, b) { return a - b; }).join(',');
    if (!ok) return desc + ' 【被拒绝】';
    // 模型按「真实 group 的成员身份」搬（uid 碰撞时真实组可能≠我选的 idxs）：
    // 组员对象来自 jobSelectedInOrder 的重新解析，按 jobStepId 找回它们在
    // 渲染数组里的下标（= 模型下标，因为视图==模型是每个操作校验过的）。
    const realIdxs = group.map(function (g) {
        const id = jobStepId(g);
        return rendered.findIndex(function (r2) { return jobStepId(r2) === id; });
    }).filter(function (x) { return x !== -1; }).sort(function (a, b) { return a - b; });
    const src = st.model[from], dst = st.model[to];
    const mv = realIdxs.map(function (x, n) { return src.splice(x - n, 1)[0]; });
    src.forEach(function (x) { x.s = 0; }); dst.forEach(function (x) { x.s = 0; });
    mv.forEach(function (tok) {
        if (tok.k === 'F') { const it = fzBoardFeed(st, tok); if (it) tok.q = it.seq; }
        tok.s = 0; dst.push(tok);
    });
    fzNormalizeModel(src); fzNormalizeModel(dst);
    return desc + '（实际搬 ' + realIdxs.join(',') + '）';
}

function fzSaveReload(st) {
    const raw = JSON.parse(JSON.stringify({ slotModes: st.t.slotModes, slotOrder: st.t.slotOrder,
        loopOrder: st.t.loopOrder, endOrder: st.t.endOrder, board: st.board }));
    raw.board.forEach(function (row) { row.forEach(function (cell) { cell.forEach(function (it) { delete it.ord; }); }); });
    st.t.slotModes = raw.slotModes; st.t.slotOrder = raw.slotOrder;
    st.t.loopOrder = raw.loopOrder; st.t.endOrder = raw.endOrder;
    st.board = raw.board; st.t.__b = raw.board;
    jobEnsureSeq(st.board);
    return '保存重开';
}

function fzDelete(st, which, i) {
    const rendered = fzRender(st)[which];
    if (!rendered.length || i >= rendered.length) return null;
    jobDeleteStep(st.t, which, st.board, rendered[i]);
    const tok = st.model[which].splice(i, 1)[0];
    if (tok.k === 'F') {
        outer: for (let r = 0; r < st.board.length; r++) for (let c = 0; c < st.board[r].length; c++) {
            const cell = st.board[r][c];
            for (let n = 0; n < cell.length; n++) if (cell[n].id === 'feed' && cell[n].row === tok.r && cell[n].col === tok.c) { cell.splice(n, 1); break outer; }
        }
    }
    st.model[which].forEach(function (x) { x.s = 0; });   // 存盘即所见
    fzNormalizeModel(st.model[which]);
    return '删除[' + which + '] 步' + i;
}

function fzNoint(st, which, i) {
    const rendered = fzRender(st)[which];
    if (rendered.length < 2 || i >= rendered.length - 1) return null;
    // 调真实函数（勾选 i 与 i+1）
    fzWire(st);
    jobSeqSel = {};
    jobSeqSel[jobPickId(which, rendered[i])] = { which: which, step: rendered[i] };
    jobSeqSel[jobPickId(which, rendered[i + 1])] = { which: which, step: rendered[i + 1] };
    const dissolving = (rendered[i].noint === true) || (rendered[i + 1].noint === true);
    jobToggleNointGroup();
    // 模型镜像：解散 = 勾选触及的每个完整组向前后扩展到边界全清；
    //          成组 = 两步都标上（真实函数要求连续，i/i+1 天然连续）。
    const chain = st.model[which];
    if (dissolving) {
        [i, i + 1].forEach(function (x) {
            if (!chain[x] || !chain[x].n) return;
            let lo = x, hi = x;
            while (lo > 0 && chain[lo - 1].n) lo--;
            while (hi < chain.length - 1 && chain[hi + 1].n) hi++;
            for (let k = lo; k <= hi; k++) delete chain[k].n;
        });
        chain.forEach(function (x) { x.s = 0; });
        return '无间隔[' + which + '] 解散@' + i + ',' + (i + 1);
    }
    chain[i].n = 1; chain[i + 1].n = 1;
    chain.forEach(function (x) { x.s = 0; });
    return '无间隔[' + which + '] 成组@' + i + ',' + (i + 1);
}

// ---------- 校验 ----------
function fzCheck(st, opDesc, fails, opIndex, opLog) {
    let bad = null;
    ['once', 'loop', 'end'].forEach(function (w) {
        const vv = fzView(st, w);
        if (JSON.stringify(vv) !== JSON.stringify(st.model[w])) {
            bad = { which: w, view: vv.map(fzTokStr), model: st.model[w].map(fzTokStr),
                raw: JSON.stringify(st.t[jobChainField(w, st.board)]) };
        }
    });
    if (bad) {
        fails.push({ op: opDesc, opIndex: opIndex, fail: bad, history: opLog.slice(-6) });
        ['once', 'loop', 'end'].forEach(function (w) { st.model[w] = fzView(st, w); });  // 重同步
        return false;
    }
    return true;
}

globalThis.fzSession = function (seed, nOps) {
    const rnd = mulberry32(seed);
    const st = fzNewState();
    const fails = [], opLog = [];
    for (let k = 0; k < 6; k++) {
        const mode = ['once', 'loop', 'end'][(rnd() * 3) | 0];
        const r = (rnd() * 5) | 0, c = (rnd() * 9) | 0;
        if (!st.board[r][c].some(function (it) { return it.id === 'feed'; })) fzPlaceFeed(st, mode, r, c);
    }
    for (let k = 0; k < 4; k++) fzAddGeneric(st, ['once', 'loop', 'end'][(rnd() * 3) | 0], rnd);
    fzRender(st);
    fzCheck(st, '初始化', fails, -1, opLog);

    const CHAINS = ['once', 'loop', 'end'];
    for (let n = 0; n < nOps; n++) {
        // ★ 快照必须在操作之前抓（之前抓晚了，"事前"其实是事后）
        const pre = {
            model: JSON.parse(JSON.stringify(st.model)),
            raw: { once: JSON.stringify(st.t.slotOrder), loop: JSON.stringify(st.t.loopOrder),
                   end: JSON.stringify(st.t.endOrder) },
        };
        const roll = rnd();
        let desc = null;
        if (roll < 0.14) {
            const mode = CHAINS[(rnd() * 3) | 0], r = (rnd() * 5) | 0, c = (rnd() * 9) | 0;
            if (!st.board[r][c].some(function (it) { return it.id === 'feed'; })) {
                fzPlaceFeed(st, mode, r, c); desc = '放喂豆[' + mode + ']@' + (r + 1) + '-' + (c + 1);
            }
        } else if (roll < 0.20) {
            const w = CHAINS[(rnd() * 3) | 0]; fzAddGeneric(st, w, rnd); desc = '加动作[' + w + ']';
        } else if (roll < 0.42) {
            const w = CHAINS[(rnd() * 3) | 0], len = st.model[w].length;
            if (len >= 2) {
                const i = (rnd() * len) | 0;
                let j = (rnd() * (len + 1)) | 0; if (j >= len) j = null;
                desc = fzSameDrag(st, w, i, j, rnd() < 0.5);
            }
        } else if (roll < 0.68) {
            const from = CHAINS[(rnd() * 3) | 0];
            let to = CHAINS[(rnd() * 3) | 0];
            if (to === from) to = from === 'once' ? 'loop' : 'once';
            if (st.model[from].length >= 1) {
                const i = (rnd() * st.model[from].length) | 0;
                const tl = st.model[to].length;
                let j = tl ? ((rnd() * (tl + 1)) | 0) : null; if (j !== null && j >= tl) j = null;
                desc = fzCrossMove(st, from, to, i, j, rnd() < 0.5);
            }
        } else if (roll < 0.74) {
            const from = CHAINS[(rnd() * 3) | 0];
            let to = CHAINS[(rnd() * 3) | 0];
            if (to === from) to = from === 'once' ? 'loop' : 'once';
            const len = st.model[from].length;
            if (len >= 2) {
                const i = (rnd() * len) | 0; let j2 = (rnd() * len) | 0;
                if (j2 !== i) desc = fzGroupCross(st, from, to, [i, j2]);
            }
        } else if (roll < 0.82) {
            desc = fzSaveReload(st);
        } else if (roll < 0.90) {
            const w = CHAINS[(rnd() * 3) | 0];
            if (st.model[w].length >= 1) desc = fzDelete(st, w, (rnd() * st.model[w].length) | 0);
        } else {
            const w = CHAINS[(rnd() * 3) | 0];
            if (st.model[w].length >= 2) desc = fzNoint(st, w, (rnd() * (st.model[w].length - 1)) | 0);
        }
        if (desc) {
            opLog.push(desc);
            fzRender(st);
            const ok = fzCheck(st, desc, fails, n, opLog);
            if (!ok) {
                fails[fails.length - 1].pre = pre;
                fails[fails.length - 1].postRaw = {
                    once: JSON.stringify(st.t.slotOrder), loop: JSON.stringify(st.t.loopOrder),
                    end: JSON.stringify(st.t.endOrder) };
                break;   // 首错即停，避免级联噪声
            }
        }
    }
    return { seed: seed, fails: fails };
};
`, sandbox);

const SESSIONS = parseInt(process.argv[2] || '50', 10);
const OPS = parseInt(process.argv[3] || '60', 10);
function fzTokStrHost(t2) {
    const s = t2.k === 'F' ? ('喂豆' + t2.r + '-' + t2.c + '#' + t2.q + (t2.s ? '(浮)' : ''))
        : t2.k === 'W' ? ('等' + t2.ms)
        : t2.k === 'C' ? ('点·' + t2.from)
        : t2.k === 'A' ? ('神器·' + (t2.body || '?'))
        : t2.key;
    return (t2.n ? '「' : '') + s + (t2.n ? '」' : '');
}
let totalFails = 0, badSessions = 0;
for (let s = 1; s <= SESSIONS; s++) {
    const r = vm.runInContext(`fzSession(${1000 + s}, ${OPS})`, sandbox);
    if (r.fails.length) {
        badSessions++;
        totalFails += r.fails.length;
        const f = r.fails[0];
        console.log(`会话 seed=${r.seed} 首错 op#${f.opIndex}: ${f.op}`);
        console.log(`  [${f.fail.which}] 视图: ${f.fail.view.join(' | ')}`);
        console.log(`  [${f.fail.which}] 意图: ${f.fail.model.join(' | ')}`);
        console.log(`  历史: ${(f.history || []).join(' -> ')}`);
        if (f.pre) {
            console.log(`  事前模型: once=[${f.pre.model.once.map(fzTokStrHost).join(' | ')}] loop=[${f.pre.model.loop.map(fzTokStrHost).join(' | ')}] end=[${f.pre.model.end.map(fzTokStrHost).join(' | ')}]`);
            console.log(`  事前raw: ${f.pre.raw[f.fail.which]}`);
            console.log(`  事后raw: ${f.postRaw[f.fail.which]}`);
        }
    }
}
console.log(`\n==== 汇总: ${SESSIONS} 会话 × ${OPS} 操作 -> ${badSessions} 个会话有首错 ====`);
