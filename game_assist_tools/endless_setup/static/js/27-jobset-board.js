
// ============================================================
// 取消格内项目（多选）弹窗
//
// 右键一个格子里有多个项目时弹出，勾选要取消的，确认后移除。
// 只取消勾选的，其余保持原顺序保留。
// ============================================================
let jobCancelCtx = null;   // { items, onDone }

function jobPickItemsToCancel(r, c, items, onDone) {
    const modal = document.getElementById('cellCancelPicker');
    const grid = document.getElementById('ccGrid');
    const sub = document.getElementById('ccSub');
    if (!modal || !grid) {
        onDone(items.slice());          // 弹窗元素缺失 -> 退化为全部清空
        return;
    }

    grid.innerHTML = '';
    const checks = [];
    items.forEach(function (it, i) {
        const lab = document.createElement('label');
        lab.className = 'cc-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.idx = String(i);
        checks.push(cb);
        lab.appendChild(cb);

        const ico = document.createElement('span');
        ico.className = 'cc-ico';
        if (it.type === 'feed') {
            jobAppendIconImg(ico, JOB_UI_IMG.feed, { cls: 'cc-ico-img', size: 40, alt: '喂豆', fallbackText: '🫘' });
        } else if (it.type === 'shovel') {
            jobAppendIconImg(ico, JOB_UI_IMG.shovel, { cls: 'cc-ico-img', size: 40, alt: '铲子', fallbackText: '🧹' });
        } else {
            ico.textContent = '🌿';
        }
        lab.appendChild(ico);

        const nm = document.createElement('span');
        nm.className = 'cc-name';
        nm.textContent = it.label || it.id || ('项目' + (i + 1));
        lab.appendChild(nm);

        const kind = document.createElement('span');
        const m = jobItemMode(it);
        kind.className = 'cc-kind' + (m === 'once' ? ' k-once' : (m === 'end' ? ' k-end' : ''));
        kind.textContent = jobModeLabel(m);
        lab.appendChild(kind);

        lab.addEventListener('click', function (e) {
            e.preventDefault();
            if (e.target !== cb) cb.checked = !cb.checked;
            jobSyncCancelAll(checks);
        });
        grid.appendChild(lab);
    });

    if (sub) sub.textContent = '第 (' + (c + 1) + ', ' + (r + 1) + ') 格 · 共 ' + items.length + ' 项';

    const allBox = document.getElementById('ccAll');
    if (allBox) {
        allBox.checked = false;
        // 用 change 而不是 click：click 会先翻转 checked，导致读取到的状态
        // 与用户看到的相反（实测坑）。change 在勾选状态稳定后才触发。
        allBox.onchange = function () {
            const v = this.checked;
            checks.forEach(function (cb) { cb.checked = v; });
        };
    }

    jobCancelCtx = { items: items, onDone: onDone };
    modal.classList.add('cc-open');
}

function jobSyncCancelAll(checks) {
    const allBox = document.getElementById('ccAll');
    if (!allBox) return;
    allBox.checked = checks.length > 0 && checks.every(function (cb) { return cb.checked; });
}

function jobCloseCancelPicker() {
    const modal = document.getElementById('cellCancelPicker');
    if (modal) modal.classList.remove('cc-open');
    jobCancelCtx = null;
}

function jobConfirmCancelPicker() {
    if (!jobCancelCtx) return;
    const chosen = [];
    document.querySelectorAll('#ccGrid input[type=checkbox]').forEach(function (cb) {
        if (cb.checked) {
            const i = parseInt(cb.dataset.idx, 10);
            if (!isNaN(i) && jobCancelCtx.items[i]) chosen.push(jobCancelCtx.items[i]);
        }
    });
    const done = jobCancelCtx.onDone;
    jobCloseCancelPicker();
    if (chosen.length && done) done(chosen);
}

function jobRenderSeqChains() {
    const box = document.getElementById('seqChains');
    if (!box) return;
    const t = jobTables[currentTable];
    box.innerHTML = '';
    if (!t) return;

    const isLate = (document.querySelector('.tab.active')?.dataset.tab === 'late');
    const board = isLate ? boardLate : boardEarly;
    jobEnsureSeq(board);

    // 三条链：单次 → 循环 → 收尾（按勾选显示）
    ['once', 'loop', 'end'].forEach(function (which) {
        if (jobChainVisible[which] === false) return;
        jobRenderOneChain(box, t, board, which);
    });
    // 同步下拉栏的勾选状态（首次渲染时把默认全勾画出来）
    jobRenderChainFilter();
}

// 链显示下拉栏：默认全勾，点一下取消/恢复
function jobRenderChainFilter() {
    const box = document.getElementById('seqChainFilter');
    if (!box) return;
    box.innerHTML = '';
    ['once', 'loop', 'end'].forEach(function (which) {
        const meta = JOB_CHAIN_META[which];
        const lab = document.createElement('label');
        lab.className = 'seq-filter-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = jobChainVisible[which] !== false;
        cb.addEventListener('change', function () {
            jobChainVisible[which] = this.checked;
            jobRenderSeqChains();
        });
        lab.appendChild(cb);
        const sp = document.createElement('span');
        sp.textContent = meta.icon + ' ' + meta.short;
        lab.appendChild(sp);
        box.appendChild(lab);
    });
}

// 渲染一条链（which = 'once' | 'loop' | 'end'）
function jobRenderOneChain(box, t, board, which) {
    const meta = JOB_CHAIN_META[which] || JOB_CHAIN_META.loop;
    const segs = jobGetChainOrder(t, which, board);

    // 每条链列出「在该形态下真正落过子」的段。
    // 同一个槽可以被拆成多段（例如 种槽1 → 喂豆 → 再种槽1），所以按段过滤而非按槽去重。
    // ★ 通用动作段（点波/捡豆/加速）没有格子，永远可见。
    const visible = segs.filter(function (seg) {
        if (jobIsGenericKey(seg.key)) return true;
        if (seg.key === 'feed' || seg.key === 'shovel') return jobSegPlacements(board, seg, which).length > 0;
        const s = Number(String(seg.key).replace('card', ''));
        return !!t.slots[s] && jobSegPlacements(board, seg, which).length > 0;
    });

    // 链头
    const sec = document.createElement('div');
    sec.className = 'seq-section'
        + (which === 'loop' ? ' seq-section-loop' : '')
        + (which === 'end' ? ' seq-section-end' : '');
    const hd = document.createElement('div');
    hd.className = 'seq-section-head';
    hd.textContent = meta.icon + ' ' + meta.label;
    sec.appendChild(hd);
    box.appendChild(sec);

    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'seq-empty';
        empty.textContent = '还没有「' + meta.short.replace('链', '')
            + '」落子。（右键左侧槽位切到该形态，再到棋盘落子）';
        sec.appendChild(empty);
    }

    const listBox = document.createElement('div');
    listBox.className = 'seq-list';
    sec.appendChild(listBox);

    // 全局种植序号（跨块连续 1..N），供每个槽块内的序号角标使用
    const gseq = jobBuildGlobalSeq(board, t, which);

    // 逐段渲染；同一槽的多段各自是独立块，可在链里任意穿插
    visible.forEach(function (seg, pos) {
        listBox.appendChild(jobBuildSlotBlock(t, board, seg, which, pos, visible, gseq));
    });
}

// 槽块「内部」的等待节点：[{gap, sec}, ...]，gap = 插在第几个植物之前
function jobGetInnerWaits(t, which, key) {
    if (!t.innerWaits || typeof t.innerWaits !== 'object') t.innerWaits = { once: {}, loop: {}, end: {} };
    if (!t.innerWaits[which] || typeof t.innerWaits[which] !== 'object') t.innerWaits[which] = {};
    const slot = t.innerWaits[which];
    if (!Array.isArray(slot[key])) slot[key] = [];
    slot[key] = slot[key].map(function (w, i) {
        if (typeof w === 'number') return { gap: w, sec: 3 };
        if (!w || typeof w !== 'object') return { gap: i, sec: 3 };
        return { gap: (w.gap | 0), sec: (typeof w.sec === 'number' ? w.sec : 3) };
    });
    return slot[key];
}

// 构建一个「槽块内部」的等待节点（插在两个植物之间）
function jobBuildInnerWait(t, which, key, wi) {
    const waits = jobGetInnerWaits(t, which, key);
    const node = document.createElement('div');
    node.className = 'seq-wait seq-wait-inner';
    node.draggable = true;
    node.dataset.gap = (waits[wi] ? waits[wi].gap : 0);

    const grip = document.createElement('span');
    grip.className = 'seq-grip';
    grip.textContent = '⠿';
    node.appendChild(grip);

    const ico = document.createElement('span');
    ico.textContent = '⏱';
    ico.style.cssText = 'font-size:13px;';
    node.appendChild(ico);

    const lbl = document.createElement('span');
    lbl.textContent = '等待';
    lbl.style.cssText = 'font-size:12px;';
    node.appendChild(lbl);

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = '0.5';
    inp.value = waits[wi] ? waits[wi].sec : 3;
    inp.style.cssText = 'width:56px;padding:2px 5px;border:1px solid #d0d7de;border-radius:5px;font-size:12px;';
    inp.addEventListener('input', function () {
        const v = Math.max(0, parseFloat(this.value) || 0);
        const arr = jobGetInnerWaits(t, which, key);
        if (arr[wi]) arr[wi].sec = v;
        jobSaveLocal();
    });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    node.appendChild(inp);

    const unit = document.createElement('span');
    unit.textContent = '秒';
    unit.style.cssText = 'font-size:11px;color:#64748b;';
    node.appendChild(unit);

    const del = document.createElement('button');
    del.className = 'seq-del';
    del.textContent = '✕';
    del.title = '删除该等待节点';
    del.addEventListener('click', function (e) {
        e.stopPropagation();
        jobGetInnerWaits(t, which, key).splice(wi, 1);
        jobSaveLocal();
        jobRenderSeqChains();
    });
    node.appendChild(del);

    // 拖动：在同一个槽块内部改位置
    node.addEventListener('dragstart', function (e) {
        seqDrag = { kind: 'innerwait', which: which, key: key, idx: wi };
        node.classList.add('seq-dragging');
        try { e.dataTransfer.setData('text/plain', 'innerwait'); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        e.stopPropagation();
    });
    node.addEventListener('dragend', function () {
        node.classList.remove('seq-dragging');
        seqDrag = null;
        jobClearSeqOver();
    });
    return node;
}

// 构建一个槽位块（可整块拖动排序）。seg = {key, from, to}
// 通用动作块（点波/捡豆/加速）：没有格子，只有一个整块
function jobBuildGenericBlock(t, board, seg, which, pos, visible) {
    const ga = jobGenericActionOfKey(seg.key) || { name: seg.key, icon: '⚡' };

    const wrap = document.createElement('div');
    wrap.className = 'seq-chain seq-chain-generic m-' + which;
    wrap.draggable = true;
    wrap.dataset.key = seg.key;
    wrap.dataset.which = which;
    wrap.dataset.ga = ga.id;

    const head = document.createElement('div');
    head.className = 'seq-chain-head';

    const grip = document.createElement('span');
    grip.className = 'seq-grip';
    grip.textContent = '⠿';
    head.appendChild(grip);

    const ord = document.createElement('span');
    ord.className = 'seq-order';
    ord.textContent = pos + 1;
    head.appendChild(ord);

    const ico = document.createElement('span');
    ico.className = 'seq-ico';
    jobAppendIconImg(ico, ga.img, { cls: 'seq-ico-img', size: 44, alt: ga.name, fallbackText: ga.icon || '⚡' });
    head.appendChild(ico);

    const hl = document.createElement('span');
    hl.className = 'seq-slot';
    hl.textContent = ga.name;
    head.appendChild(hl);

    const badge = document.createElement('span');
    badge.className = 'ga-badge';
    badge.textContent = '动作';
    head.appendChild(badge);

    // 删除按钮
    const del = document.createElement('button');
    del.className = 'seq-chain-del';
    del.textContent = '✕';
    del.title = '从这条链里移除此动作';
    del.addEventListener('click', function (e) {
        e.stopPropagation();
        jobRemoveGenericSeg(t, which, board, seg);
    });
    head.appendChild(del);

    wrap.appendChild(head);

    // 整块拖拽（与槽块同语义：拖到别的块之前/之后 = 调整链内顺序）
    wrap.addEventListener('dragstart', function (e) {
        seqDrag = { kind: 'generic', key: seg.key, which: which, ga: ga.id, seg: seg };
        wrap.classList.add('seq-dragging');
        try {
            e.dataTransfer.setData('text/plain', 'generic');
            e.dataTransfer.effectAllowed = 'move';
        } catch (err) { }
        e.stopPropagation();
    });
    wrap.addEventListener('dragend', function () {
        wrap.classList.remove('seq-dragging');
        seqDrag = null;
        jobClearSeqOver();
    });
    wrap.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        if (seqDrag.which !== which) return;   // 只在自己的链里排序
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = wrap.getBoundingClientRect();
        const below = (e.clientY - rect.top) > rect.height / 2;
        jobClearSeqOver();
        wrap.classList.add(below ? 'seq-over-bottom' : 'seq-over-top');
    });
    wrap.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!seqDrag) return;
        const drag = seqDrag;
        seqDrag = null;
        jobClearSeqOver();
        if (drag.kind === 'generic' && drag.which === which) {
            const rect = wrap.getBoundingClientRect();
            const below = (e.clientY - rect.top) > rect.height / 2;
            jobMoveGenericInOrder(t, which, drag.key, seg.key, below);
        }
    });

    return wrap;
}

// 把通用动作段移动到目标段之前/之后（限同一条链，按段 key 定位）
function jobMoveGenericInOrder(t, which, fromKey, targetKey, after) {
    which = which || 'once';
    const field = jobChainField(which);
    const order = jobGetChainOrder(t, which).slice();
    const src = order.findIndex(function (s) { return String(s.key) === fromKey; });
    const ti = order.findIndex(function (s) { return String(s.key) === targetKey; });
    if (src === -1 || ti === -1 || src === ti) return;
    const moved = order.splice(src, 1)[0];
    // 重排后重新定位目标（因为删除会改变下标）
    let t2 = order.findIndex(function (s) { return String(s.key) === targetKey; });
    if (t2 === -1) t2 = order.length - 1;
    order.splice(after ? t2 + 1 : t2, 0, moved);
    t[field] = order;
    jobSaveLocal();
    jobRenderSeqChains();
    const ga = jobGenericActionOfKey(fromKey);
    setStatus('🔗 已调整顺序：' + (ga ? ga.name : fromKey));
}

// 从链里移除某个通用动作段
function jobRemoveGenericSeg(t, which, board, seg) {
    const field = jobChainField(which, board);
    const arr = Array.isArray(t[field]) ? t[field] : null;
    if (arr) {
        const i = arr.findIndex(function (s) {
            return s && String(s.key) === seg.key;
        });
        if (i >= 0) arr.splice(i, 1);
    }
    jobSaveLocal();
    jobRenderSeqChains();
    const ga = jobGenericActionOfKey(seg.key);
    setStatus('🗑 已从链里移除：' + (ga ? ga.name : seg.key));
}

function jobBuildSlotBlock(t, board, seg, which, pos, visible, gseq) {
    // ★ 通用动作走单独的分支（没有格子、没有落点）
    if (jobIsGenericKey(seg.key)) {
        return jobBuildGenericBlock(t, board, seg, which, pos, visible);
    }
    const key = seg.key;
    const isFeed = (key === 'feed');
    const isShovel = (key === 'shovel');
    const slotNo = isFeed || isShovel ? null : Number(String(key).replace('card', ''));
    const plantName = slotNo ? t.slots[slotNo] : null;
    const allOfSlot = jobPlacementsOf(board, key, which);       // 该槽本形态的全部落点
    const list = jobSegPlacements(board, seg, which);           // 本段包含的落点
    const segCount = jobSegCountFor(t, which, key);             // 该槽被拆成了几段
    const mode = which;                                         // 块显示的是本条链的形态
    const modeCls = ' m-' + mode;      // m-once / m-loop / m-end

    const wrap = document.createElement('div');
    wrap.className = 'seq-chain' + modeCls;
    wrap.draggable = true;
    wrap.dataset.key = key;
    wrap.dataset.which = which;
    wrap.dataset.segFrom = seg.from;
    wrap.dataset.segTo = (seg.to === null || seg.to === undefined) ? '' : seg.to;

    // ---- 头部 ----
    const head = document.createElement('div');
    head.className = 'seq-chain-head';

    const grip = document.createElement('span');
    grip.className = 'seq-grip';
    grip.textContent = '⠿';
    head.appendChild(grip);

    const ord = document.createElement('span');
    ord.className = 'seq-order';
    ord.textContent = pos + 1;
    head.appendChild(ord);

    const ico = document.createElement('span');
    ico.className = 'seq-ico';
    if (isFeed) {
        jobAppendIconImg(ico, JOB_UI_IMG.feed, { cls: 'seq-ico-img', size: 44, alt: '喂豆', fallbackText: '🫘' });
    } else if (isShovel) {
        jobAppendIconImg(ico, JOB_UI_IMG.shovel, { cls: 'seq-ico-img', size: 44, alt: '铲子', fallbackText: '🧤' });
    } else {
        ico.textContent = '🪴';
    }
    head.appendChild(ico);

    const hl = document.createElement('span');
    let title = isFeed ? '喂豆' : (isShovel ? '铲子' : ('槽' + slotNo + '：' + plantName));
    if (segCount > 1) title += ' (第' + (seg.from + 1) + '~' + (seg.from + list.length) + '株)';
    hl.textContent = title;
    head.appendChild(hl);

    // 形态标记
    const badge = document.createElement('span');
    badge.className = 'seq-mode';
    badge.textContent = jobModeLabel(mode);
    head.appendChild(badge);

    const cnt = document.createElement('span');
    cnt.className = 'seq-count';
    cnt.textContent = list.length + ' 个';
    head.appendChild(cnt);

    // 勾选本槽若干株后：拖到同槽其它块 = 融合；拖到其它槽 = 变成独立块（不融合）
    const selPrefix = which + ':' + key + '#';
    const selHere = Object.keys(jobSeqSel || {}).filter(function (k) {
        return k.indexOf(selPrefix) === 0;
    });
    if (selHere.length >= 1) {
        const out = document.createElement('button');
        out.className = 'seq-split';
        out.textContent = '⇱ 拖出 ' + selHere.length;
        out.title = '把这 ' + selHere.length + ' 株变成独立块（然后拖到链里任意位置）';
        out.addEventListener('click', function (e) {
            e.stopPropagation();
            jobPullPicked(t, which, key);
        });
        head.appendChild(out);
    }
    wrap.appendChild(head);

    // ---- 主体：植物节点 + 可插在它们之间的等待节点 ----
    const body = document.createElement('div');
    body.className = 'seq-chain-body';

    // 等待槽内的 gap 是「段内」的下标；同一槽被拆成多段时用 key@from 区分，
    // 否则两块会共用同一组等待位置而互相干扰。
    const _wkey = key + '@' + (seg.from | 0);
    const innerWaits = jobGetInnerWaits(t, which, _wkey);   // [{gap, sec}, ...] gap=插在第几个植物之前
    // 按 gap 分组，便于在每个位置前插入等待
    const waitsAt = {};
    innerWaits.forEach(function (w, wi) {
        const g = Math.max(0, Math.min(w.gap | 0, list.length));
        if (!waitsAt[g]) waitsAt[g] = [];
        waitsAt[g].push(wi);
    });

    function emitWaitsFor(gap) {
        (waitsAt[gap] || []).forEach(function (wi) {
            body.appendChild(jobBuildInnerWait(t, which, _wkey, wi));
        });
    }

    list.forEach(function (entry, i) {
        emitWaitsFor(i);          // 先放该位置前的等待节点

        const node = document.createElement('div');
        node.className = 'seq-node';
        // ★ 用落点自带的真实下标（seg.from + i 在融合块里会重复 → 勾选会串号）
        const gIdx = (typeof entry.gidx === 'number') ? entry.gidx : (seg.from + i);
        node.dataset.gidx = gIdx;

        // 勾选框：勾选同一个槽的若干株后，点块头「⇲ 融合」并成一块
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'seq-pick';
        cb.checked = !!(jobSeqSel && jobSeqSel[which + ':' + key + '#' + gIdx]);
        cb.title = '勾选本槽的若干株后，点块头「⇲ 融合」可并成同一个块';
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function (e) {
            e.stopPropagation();
            if (!jobSeqSel) jobSeqSel = {};
            const k = which + ':' + key + '#' + gIdx;
            if (this.checked) jobSeqSel[k] = { key: key, gidx: gIdx, which: which };
            else delete jobSeqSel[k];
            jobRenderSeqChains();
        });
        node.appendChild(cb);

        const num = document.createElement('span');
        num.className = 'seq-idx'
            + (which === 'once' ? ' seq-idx-once' : '')
            + (which === 'end' ? ' seq-idx-end' : '');
        // 全局种植序号：按整条链连续编号（跨块不重号），与棋盘角标一一对应
        const _gk = jobPlacementKey(which, key, entry.r, entry.c, entry.item.seq);
        num.textContent = (gseq && gseq.get(_gk)) || (i + 1);
        node.appendChild(num);

        if (plantName) {
            const info = jobFindPlant(plantName) || {};
            const th = document.createElement('span');
            th.className = 'seq-thumb';
            th.style.backgroundImage = 'url(static/card_bg/rare_' + (info.rare || 0) + '.webp)';
            if (info.img) {
                const im = document.createElement('img');
                im.src = info.img;
                im.alt = plantName;
                im.onerror = function () { this.style.display = 'none'; };
                th.appendChild(im);
            }
            node.appendChild(th);
        }

        const nm = document.createElement('span');
        nm.className = 'seq-name';
        nm.textContent = plantName || (isFeed ? '喂豆' : '铲子');
        node.appendChild(nm);

        const cellLbl = document.createElement('span');
        cellLbl.className = 'seq-cell';
        cellLbl.textContent = '(' + (entry.c + 1) + ',' + (entry.r + 1) + ')';
        node.appendChild(cellLbl);

        // 该动作后的等待（挂在动作上）
        // ★ 普通关与 boss 关各自独立的等待表
        const _wf = jobWaitField();
        const wk = jobPlacementKey(which, key, entry.r, entry.c, entry.item.seq);
        const wv = (t[_wf] && t[_wf][wk]) || null;
        const wbtn = document.createElement('button');
        wbtn.className = 'seq-wbtn' + (wv ? ' on' : '');
        wbtn.textContent = wv ? ('⏱' + wv + 's') : '⏱';
        wbtn.title = '这个动作之后等待几秒';
        wbtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const cur = (t[_wf] && t[_wf][wk]) || 0;
            const nv = window.prompt('这个动作之后等待几秒？（0 = 不等待）', String(cur));
            if (nv === null) return;
            const sec = Math.max(0, parseFloat(nv) || 0);
            if (!t[_wf]) t[_wf] = {};
            if (sec > 0) t[_wf][wk] = sec;
            else delete t[_wf][wk];
            jobSaveLocal();
            jobRenderSeqChains();
        });
        node.appendChild(wbtn);

        // 在这个植物之后插入等待节点的快捷按钮
        const addw = document.createElement('button');
        addw.className = 'seq-wbtn';
        addw.textContent = '＋⏱';
        addw.title = '在这之后插入一个等待节点';
        addw.addEventListener('click', function (e) {
            e.stopPropagation();
            const arr = jobGetInnerWaits(t, which, _wkey);
            arr.push({ gap: i + 1, sec: 3 });
            jobSaveLocal();
            jobRenderSeqChains();
        });
        node.appendChild(addw);

        // 整株拖拽：拖到别的块上 → 把它（或所有勾选的）变独立块插到那里
        node.draggable = true;
        node.addEventListener('dragstart', function (e) {
            const picked = Object.keys(jobSeqSel || {})
                .filter(function (k) { return k.indexOf(which + ':' + key + '#') === 0; })
                .map(function (k) { return parseInt(k.split('#')[1], 10); })
                .filter(function (n) { return !isNaN(n); });
            seqDrag = {
                kind: 'plant', key: key, which: which,
                gidxs: picked.length ? picked : [gIdx]
            };
            node.classList.add('seq-dragging');
            try { e.dataTransfer.setData('text/plain', 'plant'); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
            e.stopPropagation();
        });
        node.addEventListener('dragend', function () {
            node.classList.remove('seq-dragging');
            seqDrag = null;
            jobClearSeqOver();
        });

        // ★ 块内重排：把 chip 拖到**同一个块里**的另一个 chip 上 -> 交换先后。
        //   拖到别的块上仍然是「拖出成独立块」（由外面的 drop 处理）。
        node.addEventListener('dragover', function (e) {
            if (!seqDrag || seqDrag.kind !== 'plant') return;
            if (seqDrag.which !== which || seqDrag.key !== key) return;   // 只认同槽同链
            e.preventDefault();
            e.stopPropagation();
            node.classList.add('seq-over-inside');
        });
        node.addEventListener('dragleave', function () {
            node.classList.remove('seq-over-inside');
        });
        node.addEventListener('drop', function (e) {
            if (!seqDrag || seqDrag.kind !== 'plant') return;
            if (seqDrag.which !== which || seqDrag.key !== key) return;
            e.preventDefault();
            e.stopPropagation();
            node.classList.remove('seq-over-inside');
            // 把被拖的那一株移到当前这一株的位置
            jobReorderInSeg(t, which, key, seg, seqDrag.gidxs, gIdx);
        });

        body.appendChild(node);
    });
    emitWaitsFor(list.length);   // 末尾位置的等待
    wrap.appendChild(body);

    // ---- 整块拖拽 ----
    wrap.addEventListener('dragstart', function (e) {
        seqDrag = { kind: 'slot', key: key, which: which, seg: seg };   // 记录是哪一段（整段对象）
        wrap.classList.add('seq-dragging');
        try { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        e.stopPropagation();
    });
    wrap.addEventListener('dragend', function () {
        wrap.classList.remove('seq-dragging');
        seqDrag = null;
        jobClearSeqOver();
    });
    wrap.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        if (seqDrag.kind === 'slot' && seqDrag.which !== which) return;   // 只在自己的链里排序
        if (seqDrag.kind === 'plant' && seqDrag.which !== which) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = wrap.getBoundingClientRect();
        const below = (e.clientY - rect.top) > rect.height / 2;
        jobClearSeqOver();
        wrap.classList.add(below ? 'seq-over-bottom' : 'seq-over-top');
    });
    wrap.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!seqDrag) return;
        const rect = wrap.getBoundingClientRect();
        const below = (e.clientY - rect.top) > rect.height / 2;
        const drag = seqDrag;
        seqDrag = null;
        jobClearSeqOver();
        if (drag.kind === 'innerwait') {
            // 槽块内部的等待节点：换到别的槽就移过去，同槽则保持
            if (drag.key !== key) {
                const from = jobGetInnerWaits(t, drag.which, drag.key);
                const moved = from.splice(drag.idx, 1)[0];
                if (moved) {
                    moved.gap = 0;
                    jobGetInnerWaits(t, which, key).push(moved);
                }
                jobSaveLocal();
                jobRenderSeqChains();
            }
        } else if (drag.kind === 'plant') {
            // 拖出的植物 → 变成独立块，插到目标块之前/之后
            jobDropPlantsAsBlock(t, which, drag, seg, below);
        } else if (drag.which === which) {
            // 整块拖动：若拖的是「拆出来的块」且目标块是同槽的 → 融合；否则仅排序
            if (drag.seg && seg && drag.seg.key === seg.key &&
                !jobSameSeg(drag.seg, seg)) {
                jobMergeSegs(t, which, drag.seg, seg);
            } else {
                jobMoveSegInOrder(t, drag.seg, seg, below, which);
            }
        }
    });

    // 右键：切换该槽的放置形态（单次 ↔ 循环）
    wrap.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const nm2 = jobToggleSlotMode(t, key);
        jobRenderSlots();
        jobRenderSeqChains();
        jobSaveLocal();
        setStatus('🔄 ' + jobSlotLabel(t, key) + ' → ' + jobModeLabel(nm2));
    });

    return wrap;
}

// 拖出：把勾选的若干株变成独立块（插在本槽现有块的后面），之后可拖到链里任意位置
function jobPullPicked(t, which, key) {
    const board = (document.querySelector('.tab.active')?.dataset.tab === 'late') ? boardLate : boardEarly;
    const total = jobPlacementsOf(board, key, which).length;

    const picked = Object.keys(jobSeqSel || {})
        .filter(function (k) { return k.indexOf(which + ':' + key + '#') === 0; })
        .map(function (k) { return parseInt(k.split('#')[1], 10); })
        .filter(function (n) { return !isNaN(n) && n >= 0 && n < total; })
        .sort(function (a, b) { return a - b; });
    if (!picked.length) return;

    const take = {};
    picked.forEach(function (g) { take[g] = true; });

    const order = jobGetChainOrder(t, which);

    // 找出包含被勾选株的段
    const affected = [];
    order.forEach(function (s, i) {
        if (s.key !== key) return;
        const sf = s.from | 0;
        const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
        const mine = Array.isArray(s.picked) ? s.picked : null;
        const hits = mine
            ? mine.filter(function (g) { return take[g]; }).length
            : picked.filter(function (g) { return g >= sf && g < st; }).length;
        if (hits) affected.push({ i: i, seg: s, mine: mine });
    });
    if (!affected.length) return;

    // 每个受影响段里「没被拖出的株」保持成一个块（中间被抽走不要裂成多块）
    const repl = {};
    affected.forEach(function (a) {
        const s = a.seg;
        const sf = s.from | 0;
        const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
        const keep = [];
        if (a.mine) {
            a.mine.forEach(function (g) { if (!take[g]) keep.push(g); });
        } else {
            for (let g = sf; g < st; g++) if (!take[g]) keep.push(g);
        }
        keep.sort(function (x, y) { return x - y; });
        if (!keep.length) { repl[a.i] = []; return; }
        let contiguous = true;
        for (let k = 1; k < keep.length; k++) {
            if (keep[k] !== keep[k - 1] + 1) { contiguous = false; break; }
        }
        if (contiguous) {
            repl[a.i] = [{ key: key, from: keep[0], to: keep[keep.length - 1] + 1 }];
        } else {
            repl[a.i] = [{ key: key, from: -1, to: -1, picked: keep.slice() }];
        }
    });

    // 重建链：受影响段换成剩余段，拖出的株作为新块插在最后一个受影响段之后
    const lastAffected = affected[affected.length - 1].i;
    const rebuilt = [];
    order.forEach(function (s, i) {
        if (i in repl) {
            repl[i].forEach(function (r) { rebuilt.push(r); });
            if (i === lastAffected) rebuilt.push({ key: key, from: -1, to: -1, picked: picked.slice() });
            return;
        }
        rebuilt.push(s);
    });

    t[jobChainField(which)] = rebuilt;

    jobSeqSel = {};
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('⇱ 已拖出 ' + picked.length + ' 株成为独立块（可拖到链里其他位置）');
}

// 把拖出的植物作为一个新块插到目标段之前/之后（拖出 = 变成独立块）
function jobDropPlantsAsBlock(t, which, drag, targetSeg, after) {
    const picked = (drag.gidxs || []).slice().sort(function (a, b) { return a - b; });
    if (!picked.length) return;

    const board = (document.querySelector('.tab.active')?.dataset.tab === 'late') ? boardLate : boardEarly;
    const total = jobPlacementsOf(board, drag.key, which).length;
    const take = {};
    picked.forEach(function (g) { if (g >= 0 && g < total) take[g] = true; });
    const taken = Object.keys(take).map(Number).sort(function (a, b) { return a - b; });
    if (!taken.length) return;

    const order = jobGetChainOrder(t, which).slice();

    // 找出包含被拖株的段
    const affected = [];
    order.forEach(function (s, i) {
        if (s.key !== drag.key) return;
        const sf = s.from | 0;
        const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
        const mine = Array.isArray(s.picked) ? s.picked : null;
        const hits = mine
            ? mine.filter(function (g) { return take[g]; }).length
            : taken.filter(function (g) { return g >= sf && g < st; }).length;
        if (hits) affected.push({ i: i, seg: s, mine: mine });
    });
    if (!affected.length) return;

    // 剩余株（受影响段里没被拖走的）—— 保持成「一个块」，不要因中间被抽走而裂成多块
    const repl = {};
    affected.forEach(function (a) {
        const s = a.seg;
        const sf = s.from | 0;
        const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
        const keep = [];
        if (a.mine) a.mine.forEach(function (g) { if (!take[g]) keep.push(g); });
        else for (let g = sf; g < st; g++) if (!take[g]) keep.push(g);
        keep.sort(function (x, y) { return x - y; });
        if (!keep.length) { repl[a.i] = []; return; }
        // 判断是否连续：连续就保留 from/to；有空洞就用 picked 合并成一个块
        let contiguous = true;
        for (let k = 1; k < keep.length; k++) {
            if (keep[k] !== keep[k - 1] + 1) { contiguous = false; break; }
        }
        if (contiguous) {
            repl[a.i] = [{ key: drag.key, from: keep[0], to: keep[keep.length - 1] + 1 }];
        } else {
            repl[a.i] = [{ key: drag.key, from: -1, to: -1, picked: keep.slice() }];
        }
    });

    // 先重建（受影响段换成剩余段）
    const mid = [];
    order.forEach(function (s, i) {
        if (i in repl) { repl[i].forEach(function (r) { mid.push(r); }); return; }
        mid.push(s);
    });
    // 再把新块插到目标段附近
    let ti = mid.findIndex(function (s) { return jobSameSeg(s, targetSeg); });
    if (ti === -1) ti = mid.length - 1;
    mid.splice(after ? ti + 1 : ti, 0, { key: drag.key, from: -1, to: -1, picked: taken });

    t[jobChainField(which)] = mid;

    jobSeqSel = {};
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('⇱ 已把 ' + taken.length + ' 株变成独立块并插入到指定位置');
}

// 把某一段移动到目标段之前/之后（限同一条链）
// 段身份用 key + picked/from 指纹判断：融合块的 from 是 -1、不唯一，不能只靠 from
function jobSegFingerprint(s) {
    if (!s) return '';
    return s.key + '|' + (s.from | 0) + '|' + (s.to === null || s.to === undefined ? '*' : s.to)
         + '|' + (Array.isArray(s.picked) ? s.picked.join(',') : '');
}
function jobSameSeg(a, b) { return a === b || (!!a && !!b && jobSegFingerprint(a) === jobSegFingerprint(b)); }

function jobMoveSegInOrder(t, fromSeg, targetSeg, after, which) {
    which = which || 'once';
    const order = jobGetChainOrder(t, which).slice();
    const src = order.findIndex(function (s) { return jobSameSeg(s, fromSeg); });
    const ti = order.findIndex(function (s) { return jobSameSeg(s, targetSeg); });
    if (src === -1 || ti === -1 || src === ti) return;
    const moved = order.splice(src, 1)[0];
    let t2 = order.findIndex(function (s) { return jobSameSeg(s, targetSeg); });
    if (t2 === -1) t2 = order.length - 1;
    order.splice(after ? t2 + 1 : t2, 0, moved);
    t[jobChainField(which)] = order;
    jobSaveCurrentBoard();
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('🔗 已调整顺序');
}

// 把两个同槽的段并成一个块（拖整块「拖回」= 融合）
function jobMergeSegs(t, which, fromSeg, targetSeg) {
    const order = jobGetChainOrder(t, which).slice();
    const board = (document.querySelector('.tab.active')?.dataset.tab === 'late') ? boardLate : boardEarly;
    const key = fromSeg.key;

    function segGidxs(s) {
        const total = jobPlacementsOf(board, key, which).length;
        const out = [];
        if (Array.isArray(s.picked) && s.picked.length) return s.picked.slice();
        const sf = s.from | 0;
        const st = (s.to === null || s.to === undefined) ? total : (s.to | 0);
        for (let g = sf; g < st; g++) out.push(g);
        return out;
    }

    const srcIdx = order.findIndex(function (s) { return jobSameSeg(s, fromSeg); });
    const tgtIdx = order.findIndex(function (s) { return jobSameSeg(s, targetSeg); });
    if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;

    const union = {};
    segGidxs(order[srcIdx]).forEach(function (g) { union[g] = true; });
    segGidxs(order[tgtIdx]).forEach(function (g) { union[g] = true; });
    const merged = Object.keys(union).map(Number).sort(function (a, b) { return a - b; });
    if (!merged.length) return;

    const mergedSeg = { key: key, from: -1, to: -1, picked: merged };

    // 用融合块替换「靠前」那个段，删掉另一个段
    const lo = Math.min(srcIdx, tgtIdx);
    const hi = Math.max(srcIdx, tgtIdx);
    order.splice(lo, 1, mergedSeg);
    order.splice(hi, 1);

    t[jobChainField(which)] = order;
    jobSaveCurrentBoard();
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('🔗 已把两块融合成一个块');
}

// 旧接口保留（按槽名移动，取该槽第一段）
function jobMoveSlotInOrder(t, fromKey, targetKey, after, which) {
    which = which || 'once';
    const order = jobGetChainOrder(t, which).slice();
    const fi = order.findIndex(function (s) { return s.key === fromKey; });
    const ti = order.findIndex(function (s) { return s.key === targetKey; });
    if (fi === -1 || ti === -1 || fi === ti) return;
    const moved = order.splice(fi, 1)[0];
    let t2 = order.findIndex(function (s) { return s.key === targetKey; });
    order.splice(after ? t2 + 1 : t2, 0, moved);
    t[jobChainField(which)] = order;
    jobSaveCurrentBoard();
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('🔗 已调整顺序：' + jobSlotLabel(t, fromKey) + (after ? ' 排到 ' : ' 排到 ') + jobSlotLabel(t, targetKey) + (after ? ' 之后' : ' 之前'));
}

function jobSlotLabel(t, key) {
    if (key === 'feed') return '喂豆';
    if (key === 'shovel') return '铲子';
    const s = Number(key.replace('card', ''));
    return '槽' + s + (t.slots[s] ? ('（' + t.slots[s] + '）') : '');
}

function jobClearSeqOver() {
    document.querySelectorAll('.seq-chain.seq-over-top, .seq-chain.seq-over-bottom').forEach(function (el) {
        el.classList.remove('seq-over-top', 'seq-over-bottom');
    });
}

// ---- 右侧抽屉开关 ----
function jobOpenSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    const b = document.getElementById('seqBackdrop');
    const t = document.getElementById('seqToggle');
    if (!d) return;
    jobRenderSeqChains();          // 打开时刷新一次，确保内容最新
    d.classList.add('seq-open');
    if (b) b.classList.add('seq-open');
    if (t) t.classList.add('seq-toggle-hidden');
    d.setAttribute('aria-hidden', 'false');
}

function jobCloseSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    const b = document.getElementById('seqBackdrop');
    const t = document.getElementById('seqToggle');
    if (!d) return;
    d.classList.remove('seq-open');
    if (b) b.classList.remove('seq-open');
    if (t) t.classList.remove('seq-toggle-hidden');
    d.setAttribute('aria-hidden', 'true');
}

function jobToggleSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    if (!d) return;
    if (d.classList.contains('seq-open')) jobCloseSeqDrawer();
    else jobOpenSeqDrawer();
}

function jobInitSeqDrawer() {
    const t = document.getElementById('seqToggle');
    const c = document.getElementById('seqClose');
    const b = document.getElementById('seqBackdrop');
    if (t) t.addEventListener('click', jobOpenSeqDrawer);
    if (c) c.addEventListener('click', jobCloseSeqDrawer);
    if (b) b.addEventListener('click', jobCloseSeqDrawer);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const d = document.getElementById('seqDrawer');
        if (d && d.classList.contains('seq-open')) jobCloseSeqDrawer();
    });
}

function jobRenderSlots() {
    const t = jobTables[currentTable];
    if (!t) return;
    const box = document.getElementById('jobSlots');
    box.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
        const isFeed = (i === 9);
        const name = isFeed ? '' : (t.slots[i] || '');
        const info = isFeed ? null : jobFindPlant(name);
        const chip = document.createElement('div');
        const armed = (jobArmedSlot === i);
        if (isFeed) {
            // 喂豆位置：独立于 8 个植物槽位的操作，选中后在棋盘落子标记
            const brk = document.createElement('span');
            brk.style.cssText = 'flex-basis:100%;height:0;';   // 换行，与植物槽位分开
            box.appendChild(brk);
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid '
                + (armed ? '#2d7aff' : '#fca5a5') + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
            if (armed) chip.className = 'job-slot-armed';
            const dot = document.createElement('span');
            dot.style.cssText = 'font-size:15px;';
            jobAppendIconImg(dot, JOB_UI_IMG.feed, { cls: 'slot-ico-img', size: 44, alt: '喂豆', fallbackText: '🫘' });
            const lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:12px;';
            lbl.textContent = '喂豆';
            chip.appendChild(dot);
            chip.appendChild(lbl);
            chip.title = '点击选中后在棋盘落子（右键切换单次/循环：' + jobModeLabel(jobSlotMode(t, 'feed')) + '）';
            chip.addEventListener('click', () => {
                jobArmedSlot = (jobArmedSlot === 9) ? 0 : 9;
                jobRenderSlots();
                setStatus(jobArmedSlot ? '已选中「喂豆」，点击棋盘格子标记喂豆位置' : '');
            });
            chip.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const m = jobToggleSlotMode(t, 'feed');
                jobRenderSlots();
                jobRenderSeqChains();
                jobSaveLocal();
                setStatus('🔄 喂豆 → ' + jobModeLabel(m));
            });
            {
                const _fm = jobSlotMode(t, 'feed');
                {
                    const fb = document.createElement('span');
                    fb.className = 'slot-mode-badge' + (_fm === 'once' ? ' is-once'
                        : (_fm === 'end' ? ' is-end' : ' is-loop'));
                    fb.textContent = (_fm === 'once') ? '1×' : (_fm === 'end' ? '🚩' : '⟳');
                    fb.title = '放置形态：' + jobModeLabel(_fm) + '（右键切换）';
                    chip.appendChild(fb);
                }
            }
            box.appendChild(chip);

            // ---- 铲子：与喂豆同一行，选中后在棋盘落子作为标记 ----
            const shovel = document.createElement('div');
            const sArmed = (jobArmedSlot === 10);
            shovel.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid '
                + (sArmed ? '#2d7aff' : '#c4b5fd') + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
            if (sArmed) shovel.className = 'job-slot-armed';
            const sDot = document.createElement('span');
            sDot.style.cssText = 'font-size:15px;';
            jobAppendIconImg(sDot, JOB_UI_IMG.shovel, { cls: 'slot-ico-img', size: 44, alt: '铲子', fallbackText: '🧤' });
            const sLbl = document.createElement('span');
            sLbl.style.cssText = 'font-size:12px;';
            sLbl.textContent = '铲子';
            shovel.appendChild(sDot);
            shovel.appendChild(sLbl);
            shovel.title = '点击选中后在棋盘落子（右键切换单次/循环：' + jobModeLabel(jobSlotMode(t, 'shovel')) + '）';
            shovel.addEventListener('click', () => {
                jobArmedSlot = (jobArmedSlot === 10) ? 0 : 10;
                jobRenderSlots();
                setStatus(jobArmedSlot ? '已选中「铲子」，点击棋盘格子标记铲除位置' : '');
            });
            shovel.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const m = jobToggleSlotMode(t, 'shovel');
                jobRenderSlots();
                jobRenderSeqChains();
                jobSaveLocal();
                setStatus('🔄 铲子 → ' + jobModeLabel(m));
            });
            {
                const _sm = jobSlotMode(t, 'shovel');
                {
                    const sb = document.createElement('span');
                    sb.className = 'slot-mode-badge' + (_sm === 'once' ? ' is-once'
                        : (_sm === 'end' ? ' is-end' : ' is-loop'));
                    sb.textContent = (_sm === 'once') ? '1×' : (_sm === 'end' ? '🚩' : '⟳');
                    sb.title = '放置形态：' + jobModeLabel(_sm) + '（右键切换）';
                    shovel.appendChild(sb);
                }
            }
            box.appendChild(shovel);
            continue;
        }
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid '
            + (armed ? '#2d7aff' : '#d0d7de') + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
        if (armed) chip.className = 'job-slot-armed';

        const frame = document.createElement('span');
        frame.style.cssText = 'position:relative;width:30px;height:30px;flex:0 0 30px;background-size:100% 100%;background-repeat:no-repeat;'
            + 'background-image:url(static/card_bg/rare_' + (info ? (info.rare || 0) : 0) + '.webp);';
        if (info && info.img) {
            const im = document.createElement('img');
            im.src = info.img;
            im.alt = name;
            im.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:72%;height:72%;object-fit:contain;';
            im.onerror = function () { this.style.display = 'none'; };
            frame.appendChild(im);
        }
        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px;';
        label.textContent = '槽' + i + ': ' + (name || '未设置');
        const edit = document.createElement('span');
        edit.textContent = '✎';
        edit.title = '更换植物';
        edit.style.cssText = 'font-size:12px;color:#2d7aff;padding:0 2px;';
        edit.addEventListener('click', (e) => { e.stopPropagation(); jobOpenPicker(i); });

        chip.appendChild(frame);
        chip.appendChild(label);
        chip.appendChild(edit);

        // 清空按钮（原来右键清空，现在右键让位给「切换形态」）
        const clr = document.createElement('span');
        clr.textContent = '✕';
        clr.title = '清空该槽位';
        clr.style.cssText = 'font-size:11px;color:#ef4444;padding:0 2px;';
        clr.addEventListener('click', (e) => {
            e.stopPropagation();
            t.slots[i] = '';
            if (jobArmedSlot === i) jobArmedSlot = 0;
            jobRenderSlots();
            jobSaveLocal();
        });
        chip.appendChild(clr);

        // 形态角标：单次（灰）/ 循环（蓝）
        const _mode = jobSlotMode(t, jobSlotKeyOf(i));
        {
            const mb = document.createElement('span');
            mb.className = 'slot-mode-badge' + (_mode === 'once' ? ' is-once'
                : (_mode === 'end' ? ' is-end' : ' is-loop'));
            mb.textContent = (_mode === 'once') ? '1×' : (_mode === 'end' ? '🚩' : '⟳');
            mb.title = '放置形态：' + jobModeLabel(_mode) + '（右键切换）';
            chip.appendChild(mb);
        }

        chip.title = name ? ('点击选中后在棋盘落子：' + name + '　|　右键切换单次/循环/收尾：' + jobModeLabel(_mode)) : '点击选择植物';
        chip.addEventListener('click', () => {
            if (!name) { jobOpenPicker(i); return; }
            jobArmedSlot = (jobArmedSlot === i) ? 0 : i;
            jobRenderSlots();
            const st = document.getElementById('jobStatus');
            if (st) st.textContent = jobArmedSlot ? ('已选中 槽' + i + '（' + name + '），点击棋盘格子落子') : '';
        });
        // 右键：切换单次 / 循环 / 单次+循环
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const m = jobToggleSlotMode(t, jobSlotKeyOf(i));
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            setStatus('🔄 槽' + i + '（' + (name || '未设置') + '）→ ' + jobModeLabel(m));
        });
        box.appendChild(chip);
    }
}

// ---- 植物选择器 ----
async function jobLoadPlants() {
    if (plantCache) return plantCache;
    try {
        const res = await fetch('/plants');
        const data = await res.json();
        plantCache = Array.isArray(data.plants) ? data.plants : [];
    } catch (e) {
        plantCache = [];
    }
    return plantCache;
}

function jobOpenPicker(slot) {
    currentSlotEditing = slot;
    const modal = document.getElementById('plantPicker');
    document.getElementById('plantSearch').value = '';
    plantPickIndex = 0;
    jobRenderRarityFilter();
    jobRenderPlantGrid();
    // 入场动画：先加类再显示（重排一次确保动画重新触发）
    modal.classList.remove('job-open');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('job-open');
}

function jobClosePicker() {
    const modal = document.getElementById('plantPicker');
    modal.classList.remove('job-open');
    modal.style.display = 'none';
    jobHideCellDetail();
}

// ---- 卡槽品质过滤（rare_0=白 1=绿 2=蓝 3=紫 4=橙）----
const PLANT_RARITY_TABS = ['全部', '收藏', '橙', '紫', '蓝', '绿', '白'];
const RARITY_TO_RARE = { '橙': 4, '紫': 3, '蓝': 2, '绿': 1, '白': 0 };
let plantRarityFilter = '全部';
let plantPickList = [];     // 当前筛选后的植物列表（供 W/S 切换）
let plantPickIndex = 0;    // 当前高亮项
let plantPickAvailable = [];   // 当前可选项索引（排除已被其它槽位占用的植物）

// ---- 右键收藏（存 localStorage，刷新不丢）----
const PLANT_FAV_KEY = 'maapvz_plant_favs_v1';
let plantFavs = new Set();

function jobLoadFavs() {
    try {
        const raw = localStorage.getItem(PLANT_FAV_KEY);
        if (raw) plantFavs = new Set(JSON.parse(raw));
    } catch (e) { plantFavs = new Set(); }
}

function jobSaveFavs() {
    try { localStorage.setItem(PLANT_FAV_KEY, JSON.stringify(Array.from(plantFavs))); } catch (e) {}
}

// 以英文名为主键（中文名可能重名/改写），无英文名时退回中文名
function jobFavKey(p) { return p.en || p.name; }
function jobIsFav(p) { return plantFavs.has(jobFavKey(p)); }

function jobToggleFav(p) {
    const k = jobFavKey(p);
    const nowFav = !plantFavs.has(k);
    if (nowFav) plantFavs.add(k);
    else plantFavs.delete(k);
    jobSaveFavs();
    setStatus(nowFav ? ('♥ 已收藏「' + p.name + '」') : ('已取消收藏「' + p.name + '」'));
    // 只更新这一张卡的心形，不整页重渲染（避免闪一下 + 入场动画重播）
    jobRefreshFavMark(p, nowFav);
    return nowFav;
}

// 就地切换某张卡的收藏标记：不动其它 DOM，无闪烁
function jobRefreshFavMark(p, isFav) {
    const grid = document.getElementById('plantGrid');
    if (!grid) return;
    const idx = (plantPickList || []).indexOf(p);
    if (idx < 0) return;
    const card = grid.children[idx];
    if (!card) return;
    const frame = card.firstElementChild;
    if (!frame) return;
    const old = frame.querySelector('.job-fav-heart');
    if (isFav && !old) {
        frame.appendChild(jobBuildHeart());
    } else if (!isFav && old) {
        old.remove();
    }
    card.title = (p.name + '（' + (p.rarity || '?') + '卡）')
        + '\u2003右键' + (isFav ? '取消收藏' : '收藏');
}

// 卡槽下边框中央的心形（宽度约占卡片 1/4，压在下边框上）
function jobBuildHeart() {
    const heart = document.createElement('span');
    heart.className = 'job-fav-heart';
    heart.textContent = '♥';
    return heart;
}


function jobRenderRarityFilter() {
    const box = document.getElementById('plantRarityFilter');
    if (!box) return;
    box.innerHTML = '';
    PLANT_RARITY_TABS.forEach(r => {
        const el = document.createElement('span');
        const active = (plantRarityFilter === r);
        el.textContent = r;
        el.style.cssText = 'padding:2px 12px;border-radius:999px;font-size:12px;cursor:pointer;user-select:none;'
            + 'border:1px solid ' + (active ? '#2d7aff' : '#d0d7de') + ';'
            + 'background:' + (active ? '#2d7aff' : '#fff') + ';'
            + 'color:' + (active ? '#fff' : '#333') + ';';
        el.addEventListener('click', () => {
            plantRarityFilter = r;
            jobRenderRarityFilter();
            jobRenderPlantGrid();
        });
        box.appendChild(el);
    });
}

function jobMovePick(delta) {
    const pool = (plantPickAvailable && plantPickAvailable.length) ? plantPickAvailable : null;
    if (pool) {
        let pos = pool.indexOf(plantPickIndex);
        if (pos === -1) pos = 0;
        pos = ((pos + delta) % pool.length + pool.length) % pool.length;
        plantPickIndex = pool[pos];
    } else {
        if (!plantPickList || !plantPickList.length) return;
        plantPickIndex = (plantPickIndex + delta % plantPickList.length + plantPickList.length) % plantPickList.length;
    }
    jobRenderPlantGrid();
    const grid = document.getElementById('plantGrid');
    const el = grid && grid.children[plantPickIndex];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function jobSlotOfPlant(name, excludeSlot) {
    const t = jobTables[currentTable];
    if (!t || !name) return 0;
    for (let s = 1; s <= 8; s++) {
        if (s === excludeSlot) continue;
        if (t.slots[s] === name) return s;
    }
    return 0;
}

function jobConfirmPick() {
    const p = plantPickList && plantPickList[plantPickIndex];
    if (!p) return;
    const dup = jobSlotOfPlant(p.name, currentSlotEditing);
    if (dup) {
        setStatus('⚠️「' + p.name + '」已被 槽' + dup + ' 使用，同一植物不能重复选择');
        return;
    }
    const t = jobTables[currentTable];
    if (t) t.slots[currentSlotEditing] = p.name;
    jobArmedSlot = currentSlotEditing;   // 选完自动进入落子状态
    jobClosePicker();
    jobRenderSlots();
    jobSaveLocal();
    const st = document.getElementById('jobStatus');
    if (st) st.textContent = '已选中 槽' + currentSlotEditing + '（' + p.name + '），点击棋盘格子落子';
}

function jobRenderPlantGrid() {
    const kw = document.getElementById('plantSearch').value.trim().toLowerCase();
    const grid = document.getElementById('plantGrid');
    const countEl = document.getElementById('plantPickerCount');
    grid.innerHTML = '';
    const plantList = plantCache || [];
    const list = plantList.filter(p => {
        const hitKw = !kw
            || (p.name || '').toLowerCase().includes(kw)
            || (p.en || '').toLowerCase().includes(kw);
        const hitRarity = (plantRarityFilter === '全部') || (p.rarity === plantRarityFilter)
            || (plantRarityFilter === '收藏' && jobIsFav(p));
        return hitKw && hitRarity;
    });
    // 收藏项排最前（同组内保持原顺序）
    list.sort(function (a, b) {
        const fa = jobIsFav(a) ? 0 : 1, fb = jobIsFav(b) ? 0 : 1;
        return fa - fb;
    });
    plantPickList = list;
    // 1~8 槽不允许重复：算出已被其它槽位占用的植物
    const _t = jobTables[currentTable];
    const usedBy = {};
    for (let s = 1; s <= 8; s++) {
        if (s === currentSlotEditing) continue;
        const nm = _t && _t.slots[s];
        if (nm) usedBy[nm] = s;
    }
    plantPickAvailable = [];
    list.forEach((pl, i) => { if (!usedBy[pl.name]) plantPickAvailable.push(i); });
    if (plantPickAvailable.length && plantPickAvailable.indexOf(plantPickIndex) === -1) {
        plantPickIndex = plantPickAvailable[0];
    } else if (!plantPickAvailable.length && list.length) {
        plantPickIndex = 0;
    }
    const _usedCnt = list.length - plantPickAvailable.length;
    if (countEl) countEl.textContent = '共 ' + list.length + ' 种'
        + (_usedCnt ? '（' + _usedCnt + ' 种已被其它槽位占用）' : '')
        + (plantPickAvailable.length ? '（W/S 或 ↑↓ 切换，A/D 跳 5 个，回车确认）' : '');
    if (!list.length) {
        grid.innerHTML = '<span style="grid-column:1/-1;color:#888;padding:20px;">没有匹配的植物</span>';
        return;
    }
    list.forEach((p, idx) => {
        const dupSlot = usedBy[p.name] || 0;
        const cell = document.createElement('div');
        cell.className = 'job-card';
        cell.style.animationDelay = Math.min(idx, 20) * 9 + 'ms';   // 错峰入场（不超过 20 项）
        cell.style.cssText += 'display:flex;flex-direction:column;align-items:center;gap:3px;border-radius:10px;'
            + (dupSlot ? 'cursor:not-allowed;opacity:0.38;' : 'cursor:pointer;')
            + (!dupSlot && idx === plantPickIndex ? 'outline:3px solid #2d7aff;outline-offset:2px;background:#eff6ff;' : '');
        cell.title = (dupSlot
            ? (p.name + '（已被 槽' + dupSlot + ' 使用，不能重复选择）')
            : (p.name + '（' + (p.rarity || '?') + '卡）'))
            + '\u2003右键' + (jobIsFav(p) ? '取消收藏' : '收藏');

        // 品质底图铺底（网页端铺，不改图）
        const rare = (typeof p.rare === 'number') ? p.rare : (RARITY_TO_RARE[p.rarity] || 0);
        const frame = document.createElement('div');
        frame.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;'   // PVZ2 卡槽比例
            + 'background:url(static/card_bg/rare_' + rare + '.webp) center/100% 100% no-repeat;';

        const img = document.createElement('img');
        img.src = p.img || '';
        img.alt = p.name;
        img.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:86%;width:86%;object-fit:contain;';
        img.onerror = function () { this.style.display = 'none'; };
        frame.appendChild(img);
        if (dupSlot) {
            frame.style.filter = 'grayscale(1)';
            const badge = document.createElement('span');
            badge.textContent = '槽' + dupSlot;
            badge.style.cssText = 'position:absolute;right:2px;top:2px;background:#ef4444;color:#fff;font-size:9px;line-height:14px;border-radius:4px;padding:0 4px;z-index:2;';
            frame.appendChild(badge);
        }
        // ♥ 收藏标记（下边框中央，被边框"咬断"）
        if (jobIsFav(p)) {
            frame.appendChild(jobBuildHeart());
        }

        const nm = document.createElement('span');
        nm.textContent = p.name;
        nm.style.cssText = 'font-size:12px;text-align:center;line-height:1.2;';

        cell.appendChild(frame);
        cell.appendChild(nm);
        cell.addEventListener('click', () => {
            plantPickIndex = idx;
            jobConfirmPick();
        });
        // 右键收藏 / 取消收藏
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            jobToggleFav(p);
        });
        grid.appendChild(cell);
    });
}

// 导出种植顺序：**以链条（slotOrder / loopOrder）为唯一权威**。
//
// 旧版实现（已废弃）按「槽号 + 槽内 seq」排序，会把物理落子顺序彻底打乱：
// 它先排槽1 全部、再排槽2 全部、最后把 feed/shovel 扔到末尾，
// 于是「铲→种菇→喂豆」会被导成「种菇×N → 铲×N → 喂豆×N」。
// 而 item.seq 只是**槽内**序号，跨槽没有可比性。
//
// 正确做法：复用链解析（jobGetChainOrder + jobSegPlacements）——链条里段的先后
// 就是执行先后，同一槽可被拆成多段穿插（种槽1 → 喂豆 → 再种槽1）。
function jobBuildChain(t, board, which) {
    const out = [];
    if (!t || !board) return out;
    jobEnsureSeq(board);
    // ★ 传入 board：让 jobGetChainOrder 的覆盖率修复用**正确的棋盘**
    //   （导出 boss 链时要用 bossBoard，不能靠 tab 猜）
    const segs = jobGetChainOrder(t, which, board);

    segs.forEach(function (seg) {
        // 该段实际包含的落点（已按 seq 排序，且同一槽内保持落子先后）
        const places = jobSegPlacements(board, seg, which);
        if (!places.length) return;
        // 该段是「单次」还是「循环」或「收尾」形态的落子 —— 由 which 决定
        const mode = (which === 'loop') ? 'loop' : (which === 'end' ? 'end' : 'once');
        const m = /^card(\d+)$/.exec(seg.key);
        const slot = m ? Number(m[1]) : null;

        // 植物槽要带上「这一段用的是哪个植物」（槽位植物表 + 段所属形态）
        let label = seg.key;
        if (slot !== null) {
            label = (t.slots && t.slots[slot]) ? t.slots[slot] : seg.key;
        } else if (seg.key === 'feed') {
            label = '喂豆';
        } else if (seg.key === 'shovel') {
            label = '铲子';
        }

        const type = (seg.key === 'feed') ? 'feed'
            : (seg.key === 'shovel') ? 'shovel'
                : 'plant';

        out.push({
            key: seg.key,
            slot: slot,                 // 植物槽号；feed/shovel 为 null
            type: type,                 // plant | feed | shovel
            label: label,               // 植物名 / 喂豆 / 铲子
            mode: mode,                 // once | loop
            cells: places.map(function (p) { return '格子' + (p.c + 1) + '_' + (p.r + 1); })
        });
    });

    return out;
}

// 兼容保留：展平成 [{slot,order,type,label,cell}] 形式（旧字段 sequence 用）。
// 顺序 = 单次链在前、循环链在后，与运行时「先单次、再循环」一致。
function jobExtractSequence(board, slots, t) {
    const out = [];
    if (!board || !t) return out;
    const chains = [
        { which: 'once', list: jobBuildChain(t, board, 'once') },
        { which: 'loop', list: jobBuildChain(t, board, 'loop') }
    ];
    chains.forEach(function (ch) {
        ch.list.forEach(function (seg) {
            seg.cells.forEach(function (cell, i) {
                out.push({
                    slot: seg.slot,
                    order: i + 1,
                    type: seg.type,
                    label: seg.label,
                    cell: cell,
                    mode: seg.mode
                });
            });
        });
    });
    return out;
}

// ---- 导出 / 保存 ----
function jobExtractPlantOps(board, slots) {
    const bySlot = {};
    if (!board) return [];
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                const m = item.id && /^(card|patch_slot)(\d+)$/.exec(item.id);
                if (!m) return;
                const slot = m[2];
                const cell = `格子${c + 1}_${r + 1}`;
                if (!bySlot[slot]) bySlot[slot] = [];
                bySlot[slot].push(cell);
            });
        }
    }
    return Object.keys(bySlot).map(slot => ({ slot, cells: bySlot[slot] }));
}

function jobExtractCells(board, itemId) {
    const out = [];
    if (!board) return out;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                if (item.id === itemId) out.push(`格子${c + 1}_${r + 1}`);
            });
        }
    }
    return out;
}

function jobSlotPlants(slots) {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(i => slots[i]).filter(Boolean);
}

function jobBuild() {
    jobSaveCurrentBoard();
    const worlds = [...document.querySelectorAll('#jobWorlds input:checked')].map(cb => cb.value);
    const tables = jobTables.map((t, ti) => {
        const prev = ti > 0 ? jobTables[ti - 1] : null;
        const bossBoard = t.inheritBoss && prev ? prev.boardLate : t.boardLate;
        const plants = jobSlotPlants(t.slots);
        return {
            from_level: t.from_level,
            to_level: t.to_level === '' ? null : Number(t.to_level),
            lineup: t.lineupMode === 'deck' ? { plants: [], deck: String(t.deckNo) } : { plants, deck: null },
            slots: { ...t.slots },

            // ---- 编辑器状态（新版）：形态 / 两条链顺序 / 等待节点 ----
            // 这些字段以前没导出，导致保存后再载入「槽位形态、循环链、延迟设置」全丢
            // ★ 普通关与 boss 关**各自独立**（除槽位植物外）
            slotModes: Object.assign({}, t.slotModes || {}),
            slotOrder: Array.isArray(t.slotOrder) ? t.slotOrder.slice() : null,
            loopOrder: Array.isArray(t.loopOrder) ? t.loopOrder.slice() : null,
            endOrder: Array.isArray(t.endOrder) ? t.endOrder.slice() : null,
            waitAfter: Object.assign({}, t.waitAfter || {}),
            // 收尾参数（收尾链的可调项，网页端棋盘下侧可编辑；仅普通关有）
            endPostDelay: (typeof t.endPostDelay === 'number' ? t.endPostDelay : 15000),
            endLastPostDelay: (typeof t.endLastPostDelay === 'number' ? t.endLastPostDelay : 6000),
            endAfterAction: (t.endAfterAction === 'restart' ? 'restart' : 'sub'),
            endSubAction: (t.endSubAction === 'once' || t.endSubAction === 'end' ? t.endSubAction : 'loop'),
            // boss 关配置：null = 未配置 -> 运行时 boss 关不做种植，只等结算
            bossSlotModes: Object.assign({}, t.bossSlotModes || {}),
            bossSlotOrder: Array.isArray(t.bossSlotOrder) ? t.bossSlotOrder.slice() : null,
            bossLoopOrder: Array.isArray(t.bossLoopOrder) ? t.bossLoopOrder.slice() : null,
            bossEndOrder: Array.isArray(t.bossEndOrder) ? t.bossEndOrder.slice() : null,
            bossWaitAfter: Object.assign({}, t.bossWaitAfter || {}),
            // 补给选取顺序（boss 关专属，每个阵容独立）
            supplyPicks: Array.isArray(t.supplyPicks)
                ? JSON.parse(JSON.stringify(t.supplyPicks)) : null,
            innerWaits: JSON.parse(JSON.stringify(t.innerWaits || { once: {}, loop: {} })),

            // ---- 棋盘本体（必须导出！否则保存后载入/切换作业集时阵容全丢）----
            boardEarly: JSON.parse(JSON.stringify(t.boardEarly || [])),
            boardLate: JSON.parse(JSON.stringify(t.boardLate || [])),

            non_boss: {
                plant: jobExtractPlantOps(t.boardEarly, t.slots),
                feed: jobExtractCells(t.boardEarly, 'feed'),
                shovel: jobExtractCells(t.boardEarly, 'shovel'),
                wave: t.waveEnabled === true,
                loop: t.loopPlant,
                once: t.oncePlant,
                // ★ 权威的三条链（顺序由 slotOrder / loopOrder / endOrder 决定）
                once_chain: jobBuildChain(t, t.boardEarly, 'once'),
                loop_chain: jobBuildChain(t, t.boardEarly, 'loop'),
                end_chain: jobBuildChain(t, t.boardEarly, 'end'),
                // 兼容旧字段：展平视图（单次链在前、循环链在后）
                sequence: jobExtractSequence(t.boardEarly, t.slots, t)
            },
            boss: {
                plant: jobExtractPlantOps(bossBoard, t.slots),
                feed: jobExtractCells(bossBoard, 'feed'),
                shovel: jobExtractCells(bossBoard, 'shovel'),
                wave: t.waveEnabled === true,
                once_chain: jobBuildChain(t, bossBoard, 'once'),
                loop_chain: jobBuildChain(t, bossBoard, 'loop'),
                end_chain: jobBuildChain(t, bossBoard, 'end'),
                sequence: jobExtractSequence(bossBoard, t.slots, t)
            }
        };
    });
    return {
        code: jobCurrentCode(),
        name: jobCurrentName(),
        version: '1.0',            // 版本不再让用户填，固定 1.0
        worlds,
        max_level: 149,            // 最大关卡固定 149
        tables
    };
}

// 当前作业集的名字：输入框已移除，改由下拉里选中的项 / 本地缓存记录
let jobMeta = { code: '', name: '' };

function jobCurrentName() { return (jobMeta.name || '').trim(); }

// 由名字推导一个「文件系统安全」的 code（后端要求仅字母数字_-）
// 中文名无法直接做文件名，所以：有中文/符号时用时间戳兜底，纯英文名则清洗后直接用
function jobCodeFromName(name) {
    const raw = (name || '').trim();
    if (!raw) return '';
    const ascii = raw.replace(/[^A-Za-z0-9_-]/g, '');
    if (ascii && /^[A-Za-z0-9_-]+$/.test(ascii) && ascii.length >= 2) return ascii;
    // 含中文等非 ASCII：用 pvz_ + 时间戳，保证唯一且合法
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return 'pvz_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
         + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function jobCurrentCode() {
    if (jobMeta.code) return jobMeta.code;
    return jobCodeFromName(jobMeta.name);
}

async function jobSave() {
    const msg = document.getElementById('jobStatus');
    // 名字必填：保存前问用户
    let name = jobCurrentName();
    const input = window.prompt('为这个作业集取一个名字吧', name || '');
    if (input === null) return;               // 取消
    name = String(input).trim();
    if (!name) { if (msg) { msg.textContent = '❌ 名字不能为空'; msg.style.color = '#dc2626'; } return; }

    // 名字变了 → code 要跟着变（除非是已下载的远程作业集，它有自己的 code）
    if (name !== jobMeta.name) {
        jobMeta.name = name;
        jobMeta.code = jobCodeFromName(name);
    }
    const job = jobBuild();
    if (!job.code) { if (msg) { msg.textContent = '❌ 无法生成作业集代码'; msg.style.color = '#dc2626'; } return; }
    try {
        const res = await fetch('/save_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job)
        });
        const data = await res.json();
        if (msg) {
            msg.textContent = data.status === 'success' ? ('✅ 已保存「' + name + '」') : ('❌ ' + (data.msg || '保存失败'));
            msg.style.color = data.status === 'success' ? '#22a65e' : '#dc2626';
        }
        if (data.status === 'success') {
            await jobLoadList(job.code);          // 保存后加入下拉栏并选中
            await jobSetCurrent(job.code);        // 同时设为当前（供 agent 使用）
            jobSaveLocal();
        }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 保存失败：' + e; msg.style.color = '#dc2626'; }
    }
}

// 设为当前作业集（Endless_ref.json 的「使用本地作业集」据此读取）
async function jobSetCurrent(code) {
    try {
        await fetch('/set_current_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code || '' })
        });
    } catch (e) { console.warn('[jobset] 设为当前失败', e); }
}
