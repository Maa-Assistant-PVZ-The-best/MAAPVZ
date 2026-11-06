
// ============================================================
// 43. 格内落子队列（右键一个格子 = 「方块」弹窗）
//
// 需求原话（2026-10-31）：
//   「直接右键点击这个多个格子覆盖的落子位置时，显示的是方块格式的样子，
//    （长得和棋盘差不多，角标保留，按照放置顺序排序，不同链不影响，
//     可以拖拽修改这个格子的放置顺序，最左上角就是最先放）
//    右键去除整个格子则是 ctrl+右键」
//
// 做什么：
//   · 右键一个**有 2 个以上落子**的格子 → 弹这个窗：把这一格的落子铺成「方块」
//     （品质底图 + 立绘/动作图标 + 角标），**按链条的执行顺序**排列，
//     最左上角 = 最先执行。
//   · 单落点格子右键仍然是「直接清空」（老行为，用户要求保留）。
//   · **Ctrl+右键 = 直接清空整格**（不再弹窗）。
//   · 拖拽方块 = 改这一格的执行顺序（跨植物 / 跨动作都行）。
//     只重排**这一格里那几个落点所在的步骤位置**，其它步骤的相对顺序一点都不动。
//   · 方块右上角 ✕ = 只删这一个落点；底部「☑ 多选删除」= 老的多选窗。
//
// ★ 不同链做区分（用户要求）：单次 / 循环 / 收尾 三条链**分组显示、各自排序**，
//   拖拽只允许在同一组内 —— 跨形态本来就是两条独立的链，先后没有可比性
//   （boss 关没有收尾，只有单次/循环两组）。
// ★ 角标保留：方块右下角的 #N 与棋盘上的角标**同源**（jobBuildGlobalSeq），
//   拖完两边一起重编号，链条面板立刻同步。
//
// ⚠️ 顺序到底存在哪：棋盘格子数组的先后只是「放置先后」，
//    **执行顺序由链条的步骤列表决定**（jobResolveSteps：一株一步）。
//    所以拖拽 = 把这一格的几个步骤在步骤列表里重排，再压回段格式
//    （jobStoreSteps）。相邻同槽会自动并回一段，中间插了别的槽就自动拆段 ——
//    这正是 §9.2「步骤是唯一真相」的用法，**不要自己去改 seq / picked**。
//
// ⚠️ 删落点必须「先钉引用再删」（jobPinSteps）：删掉落点会让同槽 gidx 整体前移，
//    事后按身份找回会删错下一步（§9.2 踩过的坑）。
// ============================================================

let _cqCtx = null;      // { r, c, board } —— 正在编辑的那一格
let _cqDrag = null;     // { which, item } —— 正在拖动的方块

// 弹窗的上下文还有效吗（换表 / 换棋盘之后棋盘数组换了对象 -> 失效）
function jobCellQueueAlive() {
    if (!_cqCtx) return false;
    if (typeof jobTables === 'undefined' || !jobTables[currentTable]) return false;
    const cur = (typeof jobCurrentBoard === 'function') ? jobCurrentBoard() : null;
    if (cur && _cqCtx.board && cur !== _cqCtx.board) return false;
    return true;
}

// 这一格现在的落子数组（没有返回 []）
function jobCellQueueCell() {
    if (!_cqCtx) return [];
    const b = _cqCtx.board;
    const cell = b && b[_cqCtx.r] && b[_cqCtx.r][_cqCtx.c];
    return Array.isArray(cell) ? cell : [];
}

// 这一格里属于某条链（形态）的落点，**按链条执行顺序**排好
//   → 与棋盘角标同源：jobBuildGlobalSeq 的全局序号就是排序依据。
function jobCellQueueItemsOf(which) {
    const cell = jobCellQueueCell();
    const t = jobTables[currentTable];
    if (!cell.length || !t) return { items: [], gseq: null };
    const items = cell.filter(function (it) { return jobItemMode(it) === which; });
    if (!items.length) return { items: [], gseq: null };
    let gseq = null;
    try { gseq = jobBuildGlobalSeq(_cqCtx.board, t, which); } catch (e) { gseq = null; }
    const keyOf = function (it) {
        return jobPlacementKey(which, it.id, _cqCtx.r, _cqCtx.c, it.seq);
    };
    items.sort(function (a, b) {
        const sa = gseq ? gseq.get(keyOf(a)) : 0;
        const sb = gseq ? gseq.get(keyOf(b)) : 0;
        if (sa && sb && sa !== sb) return sa - sb;
        if (sa && !sb) return -1;
        if (!sa && sb) return 1;
        const qa = (typeof a.seq === 'number') ? a.seq : 9999;
        const qb = (typeof b.seq === 'number') ? b.seq : 9999;
        return qa - qb;
    });
    return { items: items, gseq: gseq };
}

// 三条链（boss 只有两条）→ 只返回这一格真的用到的组
function jobCellQueueGroups() {
    if (!jobCellQueueAlive()) return [];
    const boss = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    const forms = boss ? ['once', 'loop'] : ['once', 'loop', 'end'];
    const out = [];
    forms.forEach(function (w) {
        const g = jobCellQueueItemsOf(w);
        if (!g.items.length) return;
        out.push({ which: w, items: g.items, gseq: g.gseq });
    });
    return out;
}

// ============================================================
// 打开 / 关闭 / 渲染
// ============================================================
function jobOpenCellQueue(r, c) {
    const board = (typeof jobCurrentBoard === 'function') ? jobCurrentBoard() : null;
    if (!board || !board[r] || !Array.isArray(board[r][c]) || !board[r][c].length) return false;
    _cqCtx = { r: r, c: c, board: board };
    _cqDrag = null;
    const m = document.getElementById('cellQueueModal');
    if (m) m.classList.add('cq-open');
    jobRenderCellQueue();
    return true;
}

function jobCloseCellQueue() {
    _cqCtx = null;
    _cqDrag = null;
    const m = document.getElementById('cellQueueModal');
    if (m) m.classList.remove('cq-open');
}

// 弹窗刷新（数据变了就重画；一格空了就直接关掉）
function jobRenderCellQueue() {
    const m = document.getElementById('cellQueueModal');
    if (!m) return;
    if (!m.classList.contains('cq-open')) return;
    if (!jobCellQueueAlive()) { jobCloseCellQueue(); return; }
    const cell = jobCellQueueCell();
    const sub = document.getElementById('cqSub');
    const body = document.getElementById('cqBody');
    if (!body) return;
    if (!cell.length) {
        jobCloseCellQueue();
        if (typeof setStatus === 'function') setStatus('这一格已经清空了');
        return;
    }
    if (sub) {
        sub.textContent = '第 (' + (_cqCtx.c + 1) + ', ' + (_cqCtx.r + 1) + ') 格 · 共 ' + cell.length + ' 项';
    }

    body.innerHTML = '';
    const groups = jobCellQueueGroups();
    if (!groups.length) {
        const em = document.createElement('div');
        em.className = 'cq-empty';
        em.textContent = '这一格没有可排序的落子。';
        body.appendChild(em);
        return;
    }
    groups.forEach(function (g) { body.appendChild(_cqBuildGroup(g)); });

    // 只有一条链、又只有 1 项 —— 没什么可排的，提示一句
    const total = groups.reduce(function (a, g) { return a + g.items.length; }, 0);
    const hint = document.getElementById('cqHint');
    if (hint) {
        hint.textContent = (groups.length === 1 && total === 2)
            ? '拖动方块（或点方块下面 ← →）= 换这两步的先后（只影响本格这一条链）'
            : '拖动方块或点 ← / → 调整顺序：左上角 = 最先执行；只能在同一形态内排（单次 / 循环 / 收尾各排各的）';
    }
}

// 一组（一条链）
function _cqBuildGroup(g) {
    const box = document.createElement('div');
    box.className = 'cq-group';

    const head = document.createElement('div');
    head.className = 'cq-ghead';
    const tag = document.createElement('span');
    tag.className = 'cq-gtag' + (g.which === 'once' ? ' k-once' : (g.which === 'end' ? ' k-end' : ''));
    tag.textContent = (typeof jobModeLabel === 'function') ? jobModeLabel(g.which) : g.which;
    head.appendChild(tag);
    const cnt = document.createElement('span');
    cnt.className = 'cq-gcount';
    cnt.textContent = g.items.length + ' 项';
    head.appendChild(cnt);
    const hint = document.createElement('span');
    hint.className = 'cq-ghint';
    hint.textContent = '← 左上最先';
    head.appendChild(hint);
    box.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cq-grid';
    g.items.forEach(function (it, i) {
        grid.appendChild(_cqBuildBlock(g, it, i));
    });
    // 空白处也能接住拖动（放到组尾）
    grid.addEventListener('dragover', function (e) {
        if (!_cqDrag || _cqDrag.which !== g.which) return;
        e.preventDefault();
    });
    grid.addEventListener('drop', function (e) {
        if (!_cqDrag || _cqDrag.which !== g.which) return;
        if (e.__cqHandled) return;
        e.__cqHandled = true;
        e.preventDefault();
        const drag = _cqDrag;
        _cqDrag = null;
        _cqClearOver();
        jobCellQueueMove(drag.which, drag.item, g.items[g.items.length - 1], true);
    });
    box.appendChild(grid);
    return box;
}

// 一个方块（长得和棋盘上的落子标记同源：品质底图 + 立绘 + 角标）
function _cqBuildBlock(g, it, idx) {
    const el = document.createElement('div');
    el.className = 'cq-block';
    el.draggable = true;
    el.setAttribute('data-tooltip', (_cqItemName(it) || '')
        + '（第 ' + (idx + 1) + ' 步）\n拖动换顺序 · 右上角 ✕ 只删这一个');
    el.setAttribute('data-tooltip-delay', '700');

    // 卡面（品质底图）
    const frame = document.createElement('div');
    frame.className = 'cq-frame';
    const rare = (it.plant && typeof it.plant.rare === 'number') ? it.plant.rare : 0;
    if (it.plant && it.plant.img) {
        frame.style.background = 'url(static/card_bg/rare_' + rare + '.webp) center/100% 100% no-repeat';
        const img = document.createElement('img');
        img.className = 'cq-img';
        img.src = it.plant.img;
        img.alt = _cqItemName(it) || '';
        img.draggable = false;
        img.onerror = function () { this.style.display = 'none'; };
        frame.appendChild(img);
    } else {
        // 落子动作（喂豆 / 铲子 / 点击格子 / 未来扩展）—— 图标由注册表给
        const act = (typeof jobBoardActionOfKey === 'function') ? jobBoardActionOfKey(it.id) : null;
        if (act) {
            const img = document.createElement('img');
            img.className = 'cq-img cq-img-act';
            img.src = (typeof jobBoardActionImg === 'function') ? jobBoardActionImg(act) : '';
            img.alt = act.name;
            img.draggable = false;
            img.onerror = function () { this.style.display = 'none'; };
            frame.appendChild(img);
        } else {
            const sp = document.createElement('span');
            sp.className = 'cq-fallback';
            sp.textContent = it.label || it.id || '?';
            frame.appendChild(sp);
        }
    }

    // 角标：#N（与棋盘角标同源）
    const key = jobPlacementKey(g.which, it.id, _cqCtx.r, _cqCtx.c, it.seq);
    const num = (g.gseq && g.gseq.get(key)) || it.seq || (idx + 1);
    const badge = document.createElement('span');
    badge.className = 'cq-seq' + (g.which === 'once' ? ' k-once' : (g.which === 'end' ? ' k-end' : ''));
    badge.textContent = num;
    frame.appendChild(badge);

    // ✕ 只删这一个
    const x = document.createElement('span');
    x.className = 'cq-x';
    x.textContent = '✕';
    x.title = '只删这一个落点（其它不动）';
    x.addEventListener('click', function (e) {
        e.stopPropagation();
        jobCellQueueDelete([it]);
    });
    frame.appendChild(x);

    el.appendChild(frame);

    const nm = document.createElement('div');
    nm.className = 'cq-name';
    nm.textContent = _cqItemName(it) || '';
    el.appendChild(nm);

    // ★ ← / → 移一位（2026-11-02）：**触屏浏览器不支持 HTML5 draggable**，
    //   这是本格内调顺序在手机上唯一的入口。完全复用拖拽的同一个出口
    //   jobCellQueueMove()，所以语义与拖动一致（别的格/别的链一概不动）。
    const nav = document.createElement('div');
    nav.className = 'cq-nav';
    [-1, 1].forEach(function (d) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cq-nav-btn';
        b.textContent = (d < 0) ? '←' : '→';
        b.title = (d < 0) ? '往前挪一位（先放）' : '往后挪一位（后放）';
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            const list = (jobCellQueueItemsOf(g.which).items) || [];
            const i0 = list.indexOf(it);
            if (i0 === -1) return;
            const j = i0 + d;
            if (j < 0 || j >= list.length) {
                if (typeof setStatus === 'function') {
                    setStatus(d < 0 ? '⚠️ 它已经是本格第一个了' : '⚠️ 它已经是本格最后一个了');
                }
                return;
            }
            jobCellQueueMove(g.which, it, list[j], d > 0);
        });
        nav.appendChild(b);
    });
    el.appendChild(nav);

    // ---- 拖放 ----
    el.addEventListener('dragstart', function (e) {
        _cqDrag = { which: g.which, item: it };
        el.classList.add('cq-dragging');
        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'cqmove');   // Firefox 需要
        } catch (err) { }
    });
    el.addEventListener('dragend', function () {
        el.classList.remove('cq-dragging');
        _cqDrag = null;
        _cqClearOver();
    });
    el.addEventListener('dragover', function (e) {
        if (!_cqDrag) return;
        if (_cqDrag.which !== g.which) return;      // 跨链不许拖（不同链没有可比性）
        if (_cqDrag.item === it) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        _cqMarkOver(el, _cqDropAfter(e, el));
    });
    el.addEventListener('dragleave', function (e) {
        if (el.contains(e.relatedTarget)) return;
        el.classList.remove('cq-over-before', 'cq-over-after');
    });
    el.addEventListener('drop', function (e) {
        if (!_cqDrag || _cqDrag.which !== g.which) return;
        if (e.__cqHandled) return;
        e.__cqHandled = true;
        e.preventDefault();
        const drag = _cqDrag;
        const after = _cqDropAfter(e, el);
        _cqDrag = null;
        _cqClearOver();
        jobCellQueueMove(drag.which, drag.item, it, after);
    });
    return el;
}

function _cqItemName(it) {
    if (!it) return '';
    return it.label || (it.plant && it.plant.name) || it.id || '';
}

function _cqDropAfter(e, el) {
    const r = el.getBoundingClientRect();
    // 方块是横向排的：以中线分左右
    return (e.clientX - r.left) > (r.width / 2);
}

function _cqMarkOver(el, after) {
    _cqClearOver();
    el.classList.add(after ? 'cq-over-after' : 'cq-over-before');
}

function _cqClearOver() {
    document.querySelectorAll('.cq-block.cq-over-before, .cq-block.cq-over-after').forEach(function (b) {
        b.classList.remove('cq-over-before', 'cq-over-after');
    });
}

// ============================================================
// 拖拽落点：把 dragItem 挪到 targetItem 前面/后面，然后重排链条
// ============================================================
function jobCellQueueMove(which, dragItem, targetItem, after) {
    if (!jobCellQueueAlive() || !dragItem || !targetItem || dragItem === targetItem) return false;
    const g = jobCellQueueItemsOf(which);
    const order = g.items.slice();
    const from = order.indexOf(dragItem);
    if (from === -1) return false;
    order.splice(from, 1);
    let to = order.indexOf(targetItem);
    if (to === -1) return false;
    if (after) to++;
    order.splice(to, 0, dragItem);
    const n = jobCellQueueReorder(which, order);
    if (!n) return false;
    jobAfterCellQueueChange('🔀 已调整本格「' + (typeof jobModeLabel === 'function' ? jobModeLabel(which) : which)
        + '」的执行顺序（Ctrl+Z 可撤销）');
    return true;
}

// 把某条链里**这一格的那几步**按 orderedItems 的顺序重排
//   返回被重排的步骤数（0 = 没变 / 做不到）
function jobCellQueueReorder(which, orderedItems) {
    if (!jobCellQueueAlive()) return 0;
    const t = jobTables[currentTable];
    const board = _cqCtx.board;
    const steps = jobResolveSteps(t, which, board);
    // ① 每项 -> 它在那块棋盘上的 gidx -> 它在步骤列表里的位置
    const infos = [];
    (orderedItems || []).forEach(function (it) {
        const places = jobPlacementsOf(board, it.id, which);
        let g = -1;
        for (let k = 0; k < places.length; k++) {
            if (places[k].item === it) { g = k; break; }
        }
        if (g === -1) return;
        let si = -1;
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            if (s && s.kind === 'plant' && s.key === it.id && s.gidx === g) { si = i; break; }
        }
        if (si === -1) return;
        infos.push({ it: it, si: si });
    });
    if (infos.length < 2) return 0;
    // ② 这些步骤**占据的位置**（升序）不变，只换里面的内容
    const positions = infos.map(function (x) { return x.si; }).sort(function (a, b) { return a - b; });
    const want = infos.map(function (x) { return steps[x.si]; });    // 期望顺序
    let same = true;
    for (let i = 0; i < positions.length; i++) {
        if (steps[positions[i]] !== want[i]) { same = false; break; }
    }
    if (same) return 0;
    const out = steps.slice();
    for (let i = 0; i < positions.length; i++) out[positions[i]] = want[i];
    jobStoreSteps(t, which, board, out);
    return positions.length;
}

// ============================================================
// 删落点（单个 ✕ / 清空整格 / 多选删除 都走这里）
//   ★ 先给每条链的步骤钉上「落点对象引用」，再从棋盘删，最后解钉刷 gidx
//     （顺序反了会删错下一步，见文件头）
// ============================================================
function jobCellQueueDeleteItems(items) {
    if (!jobCellQueueAlive() || !items || !items.length) return 0;
    const t = jobTables[currentTable];
    const board = _cqCtx.board;
    if (!t || !board) return 0;

    // ★ 动手前先记一笔（与 placeOp / placePlantOnBoard 里的 saveBoardState() 同款）：
    //   内容没变时 jobUndoRecord 会自动去重，等于零成本；
    //   收尾那条 post 记录万一被打断，用户至少还能 Ctrl+Z 撤回这一步。
    if (typeof jobUndoRecord === 'function') { try { jobUndoRecord(); } catch (e) { } }

    const forms = ['once', 'loop', 'end'];
    const ctxs = forms.map(function (w) {
        const steps = jobResolveSteps(t, w, board);
        const unpin = jobPinSteps(steps, board, w);
        const victims = {};
        items.forEach(function (it) {
            if (jobItemMode(it) !== w) return;
            const places = jobPlacementsOf(board, it.id, w);
            let g = -1;
            for (let k = 0; k < places.length; k++) {
                if (places[k].item === it) { g = k; break; }
            }
            if (g === -1) return;
            for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                if (s && s.kind === 'plant' && s.key === it.id && s.gidx === g) { victims[i] = true; break; }
            }
        });
        return { w: w, steps: steps, unpin: unpin, victims: victims };
    });

    // 从棋盘上删（按对象身份，不按 gidx）
    let n = 0;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!Array.isArray(cell)) continue;
            for (let i = cell.length - 1; i >= 0; i--) {
                if (items.indexOf(cell[i]) !== -1) { cell.splice(i, 1); n++; }
            }
        }
    }
    if (!n) return 0;

    // 解钉 + 剔除被删的步 + 存回
    ctxs.forEach(function (o) {
        const alive = o.unpin();
        const rest = o.steps.filter(function (s, i) { return alive[i] && !o.victims[i]; });
        jobStoreSteps(t, o.w, board, rest);
    });
    return n;
}

function jobCellQueueDelete(items) {
    if (!items || !items.length) return;
    const n = jobCellQueueDeleteItems(items);
    if (!n) return;
    const left = jobCellQueueCell().length;
    jobAfterCellQueueChange('🗑 已删掉 ' + n + ' 个落点'
        + (left ? '（本格还剩 ' + left + ' 个）' : '（这一格空了）') + '，Ctrl+Z 可撤销');
}

// Ctrl+右键 / 「清空整格」按钮
//   ★ 也支持从棋盘直接调（那时弹窗没开）：临时借一下上下文，做完**原样还回去**，
//     否则会把正在编辑的那一格上下文搞乱。
function jobCellQueueClear(r, c) {
    const board = (typeof jobCurrentBoard === 'function') ? jobCurrentBoard() : null;
    if (!board || !board[r] || !Array.isArray(board[r][c])) return 0;
    const keep = _cqCtx;
    _cqCtx = { r: r, c: c, board: board };
    const items = jobCellQueueCell().slice();
    const n = jobCellQueueDeleteItems(items);
    _cqCtx = keep;                       // 还原上下文（弹窗开着时它要靠这个重画）
    if (n) jobAfterCellQueueChange('🗑️ 已清空第 (' + (c + 1) + ', ' + (r + 1) + ') 格的 '
        + n + ' 个落子（Ctrl+Z 可撤销）');
    return n;
}

// 改完统一收尾：**先渲染、最后存**（顺序不能反！）+ 状态提示
//
// ⚠️ 为什么 jobSaveLocal() 必须放最后（2026-10-31 用户实锤「Ctrl+右键清空不能
//    Ctrl+Z 撤回」）：
//    渲染不是只读的 ——
//      · jobRenderCurrentBoard → renderBoard → jobEnsureSeq/jobEnsureOrd
//        会给落点补 seq / ord；
//      · jobRenderSeqChains / jobBuildGlobalSeq → jobGetChainOrder 会把
//        「覆盖率修复」补出来的段**写回** t[field]（见 23-jobset-end.js 末尾）。
//    撤销快照（04-cards.js 的 jobUndoSnapshot）是用「棋盘 + 整表」算 sig 的，
//    所以「先存快照 → 再渲染」等于记了一个**渲染前**的旧状态；等用户按 Ctrl+Z，
//    undoBoard 开头那次 jobUndoRecord() 发现 sig 变了，又压一条新的 ——
//    于是第一下 Ctrl+Z 只是回到"看起来一模一样"的旧状态（白按一下）。
//    全仓其它改动点（落子 / 拖链 / 删除）都是 render… → jobSaveLocal() 收尾，
//    这里必须一致。
function jobAfterCellQueueChange(msg) {
    const t = jobTables[currentTable];
    // ① 表里那份棋盘拷贝先同步（updatePreview / 导出读的是它）
    if (t) { try { jobSaveCurrentBoard(); } catch (e) { } }
    // ② 渲染（★ 会改数据的都在这里：补 seq/ord、链条覆盖率段写回）
    try { jobRenderSeqChains(); } catch (e) { }
    try { jobRenderCurrentBoard(); } catch (e) { }
    try { if (typeof updatePreview === 'function') updatePreview(); } catch (e) { }
    try { jobRenderCellQueue(); } catch (e) { }
    // ③ ★ 撤销记录点必须最后：数据已经定型，快照才等于用户看到的状态
    if (t) { try { jobSaveLocal(); } catch (e) { } }
    if (msg && typeof setStatus === 'function') setStatus(msg);
}

// ============================================================
// 「☑ 多选删除」= 复用原有的多选窗（27 的 jobPickItemsToCancel）
// ============================================================
function jobCellQueueMultiDelete() {
    if (!jobCellQueueAlive()) return;
    if (typeof jobPickItemsToCancel !== 'function') return;
    const items = jobCellQueueCell().slice();
    if (!items.length) return;
    jobPickItemsToCancel(_cqCtx.r, _cqCtx.c, items, function (chosen) {
        if (!chosen || !chosen.length) return;
        jobCellQueueDelete(chosen);
    });
}

// ============================================================
// 绑定（29 的 jobInit 里调；DOM 不在就沉默跳过）
// ============================================================
function jobBindCellQueue() {
    const m = document.getElementById('cellQueueModal');
    if (!m) return;
    m.addEventListener('click', function (e) { if (e.target === m) jobCloseCellQueue(); });
    const close = document.getElementById('cqClose');
    if (close) close.addEventListener('click', jobCloseCellQueue);
    const multi = document.getElementById('cqMulti');
    if (multi) multi.addEventListener('click', jobCellQueueMultiDelete);
    const clr = document.getElementById('cqClear');
    if (clr) clr.addEventListener('click', function () {
        if (!jobCellQueueAlive()) { jobCloseCellQueue(); return; }
        jobCellQueueClear(_cqCtx.r, _cqCtx.c);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (m.classList.contains('cq-open')) jobCloseCellQueue();
    });
}
