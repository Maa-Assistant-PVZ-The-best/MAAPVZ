
// ============================================================
// 收尾参数（棋盘下侧面板）
//
//   · 显示条件：收尾**链**里有任何段（棋盘落子的 end 形态，或直接插进
//     endOrder 的通用动作段 —— 通用动作不落棋盘，只看棋盘会把
//     「收尾链只放通用动作」的配置误判成没有收尾）。
//   · ⚠️ 收尾仅对普通关生效（boss 关不能有收尾），所以只在普通关棋盘下侧显示。
//   · 可调项（都在普通关表 t 上）：
//       endType       = 「收尾类型」= detect（识别僵尸头像，默认）/ loops（循环链重复次数）
//       endPostDelay  = 「收尾前等待」= 「无尽挑战_收尾」检测节点的 post_delay（默认 15000ms，仅 detect）
//       endLoopCount  = 「循环链重复次数」（默认 3，仅 loops：循环 N 次后直接进收尾链，期间不识别收尾）
//       endAfterAction= 「收尾超时后动作」= sub（执行子动作）/ restart（重开）/ settle（等待结算）
//       endSettleMs   = 「等待结算时长」（默认 15000ms，仅 settle；超时识别不到结算会结束任务）
//       endSubAction  = 「子动作」= once（单次动作）/ loop（循环动作）/ end（收尾动作）
//   （endLastPostDelay 已删除：post_delay 做不到边等边识别，等待结算改用节点 timeout）
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
    const loopN = parseInt(t.endLoopCount, 10);
    const settleMs = +(t.endSettleMs);
    const type = (t.endType === 'loops') ? 'loops' : 'detect';
    const after = (t.endAfterAction === 'restart' || t.endAfterAction === 'settle')
        ? t.endAfterAction : 'sub';
    const sub = (t.endSubAction === 'once' || t.endSubAction === 'end')
        ? t.endSubAction : 'loop';
    return {
        type: type,
        post: Number.isFinite(post) ? post : 15000,
        loopN: (Number.isFinite(loopN) && loopN >= 1) ? loopN : 3,
        settleMs: Number.isFinite(settleMs) ? settleMs : 15000,
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
    // ★ 严格对应「顺序链里有没有收尾段」：棋盘 end 落子 或 endOrder 链里有段
    //   （通用动作段只进 endOrder 不进棋盘，单看棋盘会漏）。
    const hasEnd = !!t && (jobBoardHasEnd(boardEarly)
        || (Array.isArray(t.endOrder) && t.endOrder.length > 0));

    panel.style.display = hasEnd ? 'block' : 'none';
    if (!hasEnd || !t) return;

    const p = jobEndParams(t);
    const setV = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    setV('earlyEndType', p.type);
    setV('earlyEndPostDelay', p.post);
    setV('earlyEndLoopCount', p.loopN);
    setV('earlyEndAfterAction', p.after);
    setV('earlyEndSettleMs', p.settleMs);
    setV('earlyEndSubAction', p.sub);
    jobEndParamsVisibility(p);
}

// 收尾面板的行显隐（类型/超时后动作 联动）
function jobEndParamsVisibility(p) {
    const show = function (id, on) { const el = document.getElementById(id); if (el) el.style.display = on ? 'flex' : 'none'; };
    show('earlyEndPostRow', p.type === 'detect');     // 收尾前等待 = 僵尸头像检测节点 post_delay
    show('earlyEndLoopsRow', p.type === 'loops');     // 循环次数
    show('earlyEndSettleRow', p.after === 'settle');  // 等待结算时长
    show('earlyEndSubRow', p.after === 'sub');        // 子动作
}

// 数字输入写回当前表并本地保存
function jobOnEndParamInput(which) {
    const t = jobTables[currentTable];
    if (!t) return;
    const map = {
        post:   ['earlyEndPostDelay', 'endPostDelay', 15000, 0],
        loops:  ['earlyEndLoopCount', 'endLoopCount', 3, 1],
        settle: ['earlyEndSettleMs', 'endSettleMs', 15000, 0],
    };
    const m = map[which];
    if (!m) return;
    const input = document.getElementById(m[0]);
    if (!input) return;
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = m[2];
    if (v < m[3]) v = m[3];
    t[m[1]] = v;
    jobSaveLocal();
}

// 下拉栏「收尾类型」变化
function jobOnEndTypeChange() {
    const t = jobTables[currentTable];
    if (!t) return;
    const sel = document.getElementById('earlyEndType');
    if (!sel) return;
    t.endType = (sel.value === 'loops') ? 'loops' : 'detect';
    jobEndParamsVisibility(jobEndParams(t));
    jobSaveLocal();
}

// 下拉栏「收尾超时后动作」变化时写回，并刷新行显隐
function jobOnEndAfterChange() {
    const t = jobTables[currentTable];
    if (!t) return;
    const sel = document.getElementById('earlyEndAfterAction');
    if (!sel) return;
    t.endAfterAction = (sel.value === 'restart' || sel.value === 'settle') ? sel.value : 'sub';
    jobEndParamsVisibility(jobEndParams(t));
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
    const bindInput = function (id, which) {
        const el = document.getElementById(id);
        if (el && !el._endBound) {
            el._endBound = true;
            el.addEventListener('input', function () { jobOnEndParamInput(which); });
        }
    };
    bindInput('earlyEndPostDelay', 'post');
    bindInput('earlyEndLoopCount', 'loops');
    bindInput('earlyEndSettleMs', 'settle');
    const ts = document.getElementById('earlyEndType');
    if (ts && !ts._endBound) {
        ts._endBound = true;
        ts.addEventListener('change', jobOnEndTypeChange);
    }
    const as = document.getElementById('earlyEndAfterAction');
    if (as && !as._endBound) {
        as._endBound = true;
        as.addEventListener('change', jobOnEndAfterChange);
    }
    const ss = document.getElementById('earlyEndSubAction');
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
                // ★ 连击间隔（ms，默认 0）
                if (e.comboMs !== undefined && Number.isFinite(Number(e.comboMs))) o2.comboMs = Number(e.comboMs);
                // ★ 连击参与识别（默认开不落盘；false 必须保留）
                if (e.comboWatch === false) o2.comboWatch = false;
                // ★ 自定义动作的 act/from/to/pairs —— 不保留就被静默丢成空段
                if (o2.ga === 'custom') jobCopyCustomFields(e, o2);
                // ★ 使用神器快照（artName/artType/artBody）—— 同上
                if (o2.ga === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                    jobCopyArtifactFields(e, o2);
                }
                // ★ 无间隔组「」标记
                if (e.noint === true) o2.noint = true;
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
            // ★ 无间隔组「」标记 / 点击格子的连击次数 / 连击间隔
            if (e.noint === true) o.noint = true;
            if (e.times !== undefined && Number.isFinite(Number(e.times))) o.times = Number(e.times);
            if (e.comboMs !== undefined && Number.isFinite(Number(e.comboMs))) o.comboMs = Number(e.comboMs);
            if (e.comboWatch === false) o.comboWatch = false;
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
