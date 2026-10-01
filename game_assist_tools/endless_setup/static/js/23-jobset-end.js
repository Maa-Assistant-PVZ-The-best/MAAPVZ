
// ============================================================
// 收尾参数（棋盘下侧面板）
//
//   · 只有当棋盘上放了「收尾」（end 形态）的落子时，该棋盘下侧才显示面板。
//   · ⚠️ 收尾仅对普通关生效（boss 关不能有收尾），所以只在普通关棋盘下侧显示。
//   · 可调项（都在普通关表 t 上）：
//       endPostDelay     = 「收尾前等待」   = 「无尽挑战_收尾」检测节点的 post_delay（默认 15000ms）
//       endLastPostDelay = 「收尾超时时间」 = 收尾链最后一个动作节点的 post_delay（默认 6000ms）
//       endAfterAction   = 「收尾超时后动作」= sub（执行子动作）/ restart（重开）
//       endSubAction     = 「子动作」       = once（单次动作）/ loop（循环动作）/ end（收尾动作）
// ============================================================

// 棋盘上是否存在「收尾」形态的落子
function jobBoardHasEnd(board) {
    if (!Array.isArray(board)) return false;
    for (let r = 0; r < board.length; r++) {
        const rowArr = board[r] || [];
        for (let c = 0; c < rowArr.length; c++) {
            const items = rowArr[c] || [];
            for (let i = 0; i < items.length; i++) {
                if (jobItemMode(items[i]) === 'end') return true;
            }
        }
    }
    return false;
}

// 取收尾参数（缺省用默认值；只普通关有）
function jobEndParams(t) {
    const post = +(t.endPostDelay);
    const last = +(t.endLastPostDelay);
    const after = (t.endAfterAction === 'restart') ? 'restart' : 'sub';
    const sub = (t.endSubAction === 'once' || t.endSubAction === 'end')
        ? t.endSubAction : 'loop';
    return {
        post: Number.isFinite(post) ? post : 15000,
        last: Number.isFinite(last) ? last : 6000,
        after: after,
        sub: sub
    };
}

// 渲染普通关棋盘下侧的收尾参数面板（显示/隐藏 + 回填值）
function jobRenderEndParams() {
    const panel = document.getElementById('earlyEndParams');
    if (!panel) return;

    // boss 关没有收尾 -> 直接隐藏
    if (jobIsBossBoard()) {
        panel.style.display = 'none';
        return;
    }

    const t = jobTables[currentTable];
    const hasEnd = t && jobBoardHasEnd(boardEarly);

    panel.style.display = hasEnd ? 'block' : 'none';
    if (!hasEnd || !t) return;

    const p = jobEndParams(t);
    const postInput = document.getElementById('earlyEndPostDelay');
    const lastInput = document.getElementById('earlyEndLastPostDelay');
    const afterSel = document.getElementById('earlyEndAfterAction');
    const subSel = document.getElementById('earlyEndSubAction');
    const subRow = document.getElementById('earlyEndSubRow');
    if (postInput) postInput.value = p.post;
    if (lastInput) lastInput.value = p.last;
    if (afterSel) afterSel.value = p.after;
    if (subSel) subSel.value = p.sub;
    // 「子动作」只在「执行子动作」时显示
    if (subRow) subRow.style.display = (p.after === 'sub') ? 'flex' : 'none';
}

// 输入 panel（post/last 两个 number）时写回当前表并本地保存
function jobOnEndParamInput(which) {
    const t = jobTables[currentTable];
    if (!t) return;
    const f = { post: 'endPostDelay', last: 'endLastPostDelay' };
    const input = document.getElementById(
        (which === 'post' ? 'earlyEndPostDelay' : 'earlyEndLastPostDelay')
    );
    if (!input) return;
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = (which === 'post' ? 15000 : 6000);
    if (v < 0) v = 0;
    t[f[which]] = v;
    jobSaveLocal();
}

// 下拉栏「收尾超时后动作」变化时写回，并刷新「子动作」的显示
function jobOnEndAfterChange() {
    const t = jobTables[currentTable];
    if (!t) return;
    const sel = document.getElementById('earlyEndAfterAction');
    if (!sel) return;
    t.endAfterAction = (sel.value === 'restart') ? 'restart' : 'sub';
    const subRow = document.getElementById('earlyEndSubRow');
    if (subRow) subRow.style.display = (sel.value === 'sub') ? 'flex' : 'none';
    jobSaveLocal();
}

// 下拉栏「子动作」变化时写回
function jobOnEndSubChange() {
    const t = jobTables[currentTable];
    if (!t) return;
    const sel = document.getElementById('earlyEndSubAction');
    if (!sel) return;
    t.endSubAction = (sel.value === 'once' || sel.value === 'end') ? sel.value : 'loop';
    jobSaveLocal();
}

function jobBindEndParams() {
    const pi = document.getElementById('earlyEndPostDelay');
    const li = document.getElementById('earlyEndLastPostDelay');
    const as = document.getElementById('earlyEndAfterAction');
    const ss = document.getElementById('earlyEndSubAction');
    if (pi && !pi._endBound) {
        pi._endBound = true;
        pi.addEventListener('input', function () { jobOnEndParamInput('post'); });
    }
    if (li && !li._endBound) {
        li._endBound = true;
        li.addEventListener('input', function () { jobOnEndParamInput('last'); });
    }
    if (as && !as._endBound) {
        as._endBound = true;
        as.addEventListener('change', jobOnEndAfterChange);
    }
    if (ss && !ss._endBound) {
        ss._endBound = true;
        ss.addEventListener('change', jobOnEndSubChange);
    }
}


// 取得某条链的顺序。每一段是 {key, from, to}：
//   key  = 槽位键（card1 / feed / shovel）
//   from = 从该槽的第几个落点开始（0 起算）
//   to   = 到第几个落点为止（不含）；null = 到最后
// 支持同一个槽在链里出现多次 —— 这样才能把「槽1 的 2 株」拆成两块，
// 中间插进别的槽（例如：种槽1 → 喂豆 → 再种槽1）。
function jobGetChainOrder(t, which, board, forceBoss) {
    // ★ 普通关与 boss 关各自独立的链条字段
    //   forceBoss：导出 boss 链时显式声明（board 可能是上一张表的棋盘，
    //   引用判断会失效 —— 见 jobChainField 注释）
    const field = jobChainField(which, board, forceBoss);
    const all = jobAllSlotKeys();
    let raw = Array.isArray(t[field]) ? t[field] : [];

    // 当前正在编辑的棋盘（按 tab 推断）。后面「补空槽」「覆盖率修复」「写回」
    // 都要用它，所以提到最前面算一次。
    let _editingBoard = null;
    try {
        const _tab = document.querySelector('.tab.active')?.dataset.tab;
        _editingBoard = (_tab === 'late') ? boardLate : boardEarly;
    } catch (e) { _editingBoard = null; }

    // 本次调用该用哪块棋盘：优先调用方传入的，否则用当前编辑的那块
    const _useBoard = board || _editingBoard;

    // 兼容旧数据：以前存的是裸键名字符串数组 → 转成 {key, from:0, to:null}
    // ★ 通用动作段（key = 'ga:<id>'）没有格子，用 ga 字段标记，不走 from/to
    let segs = raw.map(function (e) {
        if (typeof e === 'string') {
            return jobGenericActionById(e) ? { key: JOB_GA_PREFIX + e, ga: e }
                                           : { key: e, from: 0, to: null };
        }
        if (e && typeof e === 'object' && e.key) {
            const k = String(e.key);
            if (jobIsGenericKey(k)) {
                const o2 = { key: k, ga: k.slice(JOB_GA_PREFIX.length) };
                // ★ 等待动作的毫秒数（其它通用动作没有这个字段）
                if (e.ms !== undefined && Number.isFinite(Number(e.ms))) o2.ms = Number(e.ms);
                // ★ 切换形态动作的槽位与次数
                //   —— 必须在这里显式保留，否则「保存后重载」会被静默丢掉，
                //      段变成没有 slot 的 form，运行时判越界直接不执行。
                if (e.slot !== undefined && Number.isFinite(Number(e.slot))) o2.slot = Number(e.slot);
                if (e.times !== undefined && Number.isFinite(Number(e.times))) o2.times = Number(e.times);
                return o2;
            }
            const o = {
                key: k,
                from: e.from | 0,
                to: (e.to === null || e.to === undefined) ? null : (e.to | 0)
            };
            if (Array.isArray(e.picked) && e.picked.length) o.picked = e.picked.map(Number);
            // ★ 段内自定义顺序（拖动 chip 打乱块内先后时写入）
            if (Array.isArray(e.order) && e.order.length) o.order = e.order.map(Number);
            return o;
        }
        return null;
    }).filter(function (e) {
        if (!e) return false;
        return jobIsGenericKey(e.key) || all.indexOf(e.key) !== -1;
    });

    // 补齐：每个槽至少要有一段；没有任何段的槽补到末尾。
    //
    // ★ 但只在**有落点**的槽上补 —— 空槽补出来的 {from:0,to:null} 是纯噪音：
    //   渲染时 jobResolveSteps 已经会「严格按棋盘」展示该显示的落点，
    //   这里再补一遍只会在每次渲染时把 card2..card8/feed/shovel 全写进 slotOrder，
    //   把用户的链撑得又大又乱（存盘也一起变大）。
    //   导出时也由 jobResolveSteps/jobSegPlacements 保证覆盖，不需要这些空段。
    all.forEach(function (k) {
        if (segs.some(function (s) { return s.key === k; })) return;
        // 该槽在这个形态下棋盘上确实有落点才补
        if (_useBoard && jobPlacementsOf(_useBoard, k, which).length > 0) {
            segs.push({ key: k, from: 0, to: null });
        }
    });

    // ★ 覆盖率修复：链条里若有落点没被任何段覆盖（常见于「拖出成独立块」
    //   之后那个块又被删掉/拖走），这些植物就永远不会被种 ->
    //   游戏里表现成「某一格种不上」。
    //   这里把「没被覆盖的下标」补成一个附加段，保证链路与棋盘一致。
    segs = jobRepairChainCoverage(segs, _useBoard, which, all);

    // 只有传进来的 board 就是「当前编辑棋盘」时才写回
    // ★ 但 forceBoss=true（导出 boss 链）时**绝不写回** ——
    //   否则会把 boss 段覆盖到普通关链条上。
    if (forceBoss !== true && (!board || board === _editingBoard)) {
        t[field] = segs;
    }
    return segs;
}

// 找出「棋盘上有、但链里没覆盖」的落点下标，补成一个附加段加在末尾。
// 返回（可能被修正过的）段数组；调用方负责写回 t[field]。
function jobRepairChainCoverage(segs, board, which, allKeys) {
    if (!board) return segs;
    (allKeys || jobAllSlotKeys()).forEach(function (key) {
        const total = jobPlacementsOf(board, key, which).length;
        if (!total) return;

        // 统计该槽已被覆盖的下标
        const covered = {};
        segs.forEach(function (s) {
            if (s.key !== key) return;
            if (Array.isArray(s.picked) && s.picked.length) {
                s.picked.forEach(function (g) { if (g >= 0 && g < total) covered[g] = true; });
                return;
            }
            const sf = s.from | 0;
            const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
            for (let g = sf; g < st; g++) if (g >= 0 && g < total) covered[g] = true;
        });

        // 收集漏掉的下标
        const miss = [];
        for (let g = 0; g < total; g++) if (!covered[g]) miss.push(g);
        if (!miss.length) return;

        // 补一段：连续的用 from/to，离散的用 picked
        let contiguous = true;
        for (let k = 1; k < miss.length; k++) {
            if (miss[k] !== miss[k - 1] + 1) { contiguous = false; break; }
        }
        if (contiguous) {
            segs.push({ key: key, from: miss[0], to: miss[miss.length - 1] + 1 });
        } else {
            segs.push({ key: key, from: -1, to: -1, picked: miss.slice() });
        }
        if (window.console && console.warn) {
            console.warn('[jobset] 链条补全：槽 ' + key + ' 有 ' + miss.length
                + ' 个落点未被任何段覆盖，已补为附加段 -> ' + JSON.stringify(miss));
        }
    });
    return segs;
}
