// 27b-jobset-stepcfg.js —— 原 27-jobset-board.js 第 1104~1624 行：步骤参数弹窗 + 拖拽接线 + ↑↓移一位 + 棋盘缩放
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。

let _stepCfgCtx = null;   // { which, st } —— 弹窗服务的那一步

function jobGetSwipeMs() {
    const v = +(jobMeta && jobMeta.swipeMs);
    return (Number.isFinite(v) && v >= 0) ? Math.floor(v) : 80;
}

// 这一步的「调配参数」该显示什么
//   form      = 切换形态 -> 槽位 + 次数
//   wait      = 等待节点 -> 等待毫秒（等待是时长不是动作，不给连击）
//   clickish  = 点击类（点波/捡豆/加速/自定义点击/点击格子）-> 连击次数
//   swipeable = 其余全部（植物/喂豆/铲子/自定义滑动/长按/多指）-> 连击次数 + 默认滑动时长
//   ★ 连击是所有动作通用的（×N = 这个动作连做 N 次）；动作间隔固定 0.1s，不开放调整。
function jobStepCfgKind(st) {
    if (!st) return 'swipeable';
    if (st.kind === 'wait') return 'wait';
    const ga = jobGenericActionOfKey(st.key);
    if (ga) {
        if (ga.id === 'form') return 'form';
        if (ga.id === 'custom') return 'custom';   // 自定义动作：专属参数编辑器（类型/坐标/时长）
        if (ga.id === 'missile') return 'missile'; // 滑飞弹：连击 + 独立滑动时长（默认 10ms）
        return 'clickish';    // 点波/捡豆/加速 都是单击
    }
    const act = (typeof jobBoardActionOfKey === 'function') ? jobBoardActionOfKey(st.key) : null;
    if (act && act.dslType === 'tap') return 'clickish';
    return 'swipeable';
}

// 把参数写回那一步（按身份定位，st 的引用可能已过期）
//   replaceKeys：先整袋删掉这些键再 assign —— 自定义动作换类型时
//   旧的 from/to/pairs/ms 不能残留（点击换滑动后 pairs 还在就出鬼了）。
function jobStepCfgSave(patch, replaceKeys) {
    const ctx = _stepCfgCtx;
    const t = jobTables[currentTable];
    if (!ctx || !t) return;
    const board = jobCurrentBoard();
    const steps = jobResolveSteps(t, ctx.which, board);
    let i = steps.indexOf(ctx.st);
    if (i === -1) i = jobFindStepByIdentity(steps, ctx.st);
    if (i === -1) return;
    if (Array.isArray(replaceKeys)) {
        replaceKeys.forEach(function (k) { delete steps[i][k]; });
    }
    Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; });
    Object.assign(steps[i], patch);
    _stepCfgCtx.st = steps[i];          // 换成新引用，连续调参不失效
    jobStoreSteps(t, ctx.which, board, steps);
    jobAfterChainChange(t, ctx.which, null);
}

// 二级「调配参数」按步骤类型渲染
function jobRenderStepCfgParams() {
    const box = document.getElementById('scParamsBody');
    if (!box || !_stepCfgCtx) return;
    box.innerHTML = '';
    const kind = jobStepCfgKind(_stepCfgCtx.st);

    const mkRow = function (label, unit) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const lb = document.createElement('span');
        lb.className = 'sc-row-label';
        lb.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'sc-input';
        const un = document.createElement('span');
        un.className = 'sc-unit';
        un.textContent = unit || '';
        row.appendChild(lb); row.appendChild(inp); row.appendChild(un);
        box.appendChild(row);
        return inp;
    };
    const mkTip = function (text) {
        const tip = document.createElement('div');
        tip.className = 'sc-tip';
        tip.textContent = text;
        box.appendChild(tip);
    };
    const bindInt = function (inp, min, max, def, apply, msg) {
        inp.min = String(min); inp.max = String(max); inp.step = '1';
        inp.value = def;
        inp.addEventListener('change', function () {
            let v = parseInt(this.value, 10);
            if (!Number.isFinite(v) || v < min) v = def;
            if (v > max) v = max;
            this.value = v;
            apply(v);
            if (msg) setStatus(msg(v));
        });
    };
    // ★ 「连击参与识别」勾选项：默认勾（展开式连击，每个动作都计入识别节奏）；
    //   取消勾 = 原子连击（DSL 原生 *n，整体 1 个动作，中途不被识别打断）。
    //   行尾的 ? 点击展开说明。
    const mkComboWatch = function (st) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const lb = document.createElement('span');
        lb.className = 'sc-row-label';
        lb.textContent = '连击参与识别';
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = st.comboWatch !== false;
        const q = document.createElement('span');
        q.className = 'sc-help';
        q.textContent = '？';
        q.title = '点我看说明';
        row.appendChild(lb); row.appendChild(inp); row.appendChild(q);
        box.appendChild(row);
        const tip = document.createElement('div');
        tip.className = 'sc-tip';
        tip.style.display = 'none';
        tip.textContent = '启用该选项，连击默认参与识别，防止结算时一直卡住，但是执行动作速度会变慢';
        box.appendChild(tip);
        q.addEventListener('click', function () {
            tip.style.display = (tip.style.display === 'none') ? '' : 'none';
        });
        inp.addEventListener('change', function () {
            jobStepCfgSave({ comboWatch: this.checked ? undefined : false }, ['comboWatch']);
            setStatus(this.checked
                ? '⚙ 连击参与识别 = 开（可被结算/失败识别打断）'
                : '⚙ 连击参与识别 = 关（原子连击，中途不识别）');
        });
    };

    if (kind === 'custom') {
        // ★ 自定义动作：类型/坐标/时长/手指数 全部可改，改完即时覆盖写回这一步
        const host = document.createElement('div');
        box.appendChild(host);
        if (typeof jobRenderCustomCfgInto === 'function') {
            jobRenderCustomCfgInto(host, _stepCfgCtx.st, function (patch) {
                jobStepCfgSave(patch, ['act', 'from', 'to', 'pairs', 'ms']);
            });
        }
        // 连击（所有动作通用）
        const st = _stepCfgCtx.st;
        bindInt(mkRow('连击次数', '次（这个动作连做 N 次）'), 1, 9999,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 连击次数 = ' + v; });
        bindInt(mkRow('连击间隔', 'ms（默认 0 = 紧挨着连做）'), 0, 10000,
            Math.min(10000, Math.max(0, Number(st.comboMs) || 0)),
            function (v) { jobStepCfgSave({ comboMs: v }); },
            function (v) { return '⚙ 连击间隔 = ' + v + 'ms'; });
        mkComboWatch(st);
        mkTip('类型/坐标/时长改完即时生效（直接覆盖这一步的参数）；连击 1~9999，块上显示 ×N。');
    } else if (kind === 'form') {
        const st = _stepCfgCtx.st;
        bindInt(mkRow('槽位', '1-8（点哪个槽的切换形态）'), 1, 8,
            Math.min(8, Math.max(1, Number(st.slot) || 1)),
            function (v) { jobStepCfgSave({ slot: v }); },
            function (v) { return '⚙ 切换形态槽位 = ' + v; });
        bindInt(mkRow('次数', '次（连点几下）'), 1, 9999,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 切换形态次数 = ' + v; });
        bindInt(mkRow('连击间隔', 'ms（默认 0 = 紧挨着连点）'), 0, 10000,
            Math.min(10000, Math.max(0, Number(st.comboMs) || 0)),
            function (v) { jobStepCfgSave({ comboMs: v }); },
            function (v) { return '⚙ 连击间隔 = ' + v + 'ms'; });
        mkComboWatch(st);
        mkTip('只作用于这一步；块上会显示「槽N 丨 N次」。');
    } else if (kind === 'missile') {
        // ★ 滑飞弹：连击三件套 + 独立滑动时长（默认 10ms，0 = 瞬滑）。
        //   ★ st.ms 缺省要回落 10，但 0 是合法值（瞬滑）——不能用 || 10 兜底。
        const st = _stepCfgCtx.st;
        bindInt(mkRow('连击次数', '次（这个动作连做 N 次）'), 1, 9999,
            Math.min(9999, Math.max(1, Number(st.times) || 20)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 连击次数 = ' + v; });
        bindInt(mkRow('连击间隔', 'ms（默认 0 = 紧挨着连做）'), 0, 10000,
            Math.min(10000, Math.max(0, Number(st.comboMs) || 0)),
            function (v) { jobStepCfgSave({ comboMs: v }); },
            function (v) { return '⚙ 连击间隔 = ' + v + 'ms'; });
        mkComboWatch(st);
        bindInt(mkRow('滑动时长', 'ms（滑飞弹专用；0 = 瞬滑）'), 0, 5000,
            Math.min(5000, Math.max(0,
                (st.ms === undefined || st.ms === null) ? 10 : Number(st.ms))),
            function (v) { jobStepCfgSave({ ms: v }); },
            function (v) { return '⚙ 滑飞弹滑动时长 = ' + v + 'ms'; });
        mkTip('只作用于这一步；时长独立于作业集级默认滑动时长。');
    } else if (kind === 'wait') {
        const st = _stepCfgCtx.st;
        bindInt(mkRow('等待时长', 'ms'), 1, 600000,
            Math.max(1, Number(st.ms) || 1000),
            function (v) { jobStepCfgSave({ ms: v }); },
            function (v) { return '⚙ 等待 = ' + v + 'ms'; });
        mkTip('只作用于这一个等待节点。');
    } else {
        // ★ 连击是所有动作通用的（点击类/滑动类都有）：这个动作连做 N 次
        const st = _stepCfgCtx.st;
        bindInt(mkRow('连击次数', '次（这个动作连做 N 次）'), 1, 9999,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 连击次数 = ' + v; });
        bindInt(mkRow('连击间隔', 'ms（默认 0 = 紧挨着连做）'), 0, 10000,
            Math.min(10000, Math.max(0, Number(st.comboMs) || 0)),
            function (v) { jobStepCfgSave({ comboMs: v }); },
            function (v) { return '⚙ 连击间隔 = ' + v + 'ms'; });
        mkComboWatch(st);
        if (kind === 'swipeable') {
            bindInt(mkRow('滑动时长', 'ms（作业集级默认，所有滑动共用；0 = 瞬滑）'), 0, 5000, jobGetSwipeMs(),
                function (v) { jobMeta.swipeMs = v; jobSaveLocal(); },
                function (v) { return '⚙ 默认滑动时长 = ' + v + 'ms'; });
            mkTip('连击只作用于这一步，块上显示 ×N；滑动时长是作业集级默认参数；动作间隔固定 0.1s，不可调。');
        } else {
            mkTip('只作用于这一步；块上会显示 ×N。');
        }
    }
}

function jobOpenStepCfg(which, st) {
    const modal = document.getElementById('stepCfgModal');
    if (!modal) return;
    _stepCfgCtx = { which: which, st: st };
    // 回到一级
    const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
    const b = document.getElementById('scBack');
    if (c) c.style.display = '';
    if (p) p.style.display = 'none';
    if (b) b.style.display = 'none';
    modal.classList.add('sc-open');
}

function jobCloseStepCfg() {
    const modal = document.getElementById('stepCfgModal');
    if (modal) modal.classList.remove('sc-open');
    _stepCfgCtx = null;
}

function jobBindStepCfg() {
    const modal = document.getElementById('stepCfgModal');
    if (!modal) return;
    const bind = function (id, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    bind('scClose', jobCloseStepCfg);
    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseStepCfg();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('sc-open')) jobCloseStepCfg();
    });

    // ① 插入等待节点：立刻执行并关窗
    bind('scOptWait', function () {
        const ctx = _stepCfgCtx;
        const t = jobTables[currentTable];
        if (ctx && t) {
            jobInsertWaitAfter(t, ctx.which, jobCurrentBoard(), ctx.st);
        }
        jobCloseStepCfg();
    });

    // ② 调配参数：按步骤类型渲染后切到二级
    bind('scOptParams', function () {
        jobRenderStepCfgParams();
        const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
        const b = document.getElementById('scBack');
        if (c) c.style.display = 'none';
        if (p) p.style.display = '';
        if (b) b.style.display = '';
    });
    bind('scBack', function () {
        const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
        const b = document.getElementById('scBack');
        if (c) c.style.display = '';
        if (p) p.style.display = 'none';
        if (b) b.style.display = 'none';
    });
}

// ★ 删除一步：从链里去掉 **并且** 从棋盘上删掉那一株（用户要求的联动）
function jobDeleteStep(t, which, board, st) {
    if (!st) return;

    // ★ 顺序极其重要：先在「删前」解析并钉住落点引用，再动棋盘。
    //   删掉棋盘落点会重排同槽 gidx，事后才解析/按身份查找会撞车 ——
    //   被删落点的 uid 按 key#gidx 继承到「后一位」落点头上，
    //   结果链里删掉的是下一步（fuzz 实锤：删 2-4 实际把 3-4 挤成浮动）。
    const steps = jobResolveSteps(t, which, board);
    let idx = steps.indexOf(st);
    if (idx === -1) {
        const id = jobStepId(st);
        idx = steps.findIndex(function (x) { return jobStepId(x) === id; });
    }
    if (idx === -1) return;
    const unpin = jobPinSteps(steps, board, which);

    // 链里去掉这一步；植物同时从棋盘移除
    const victim = steps[idx];
    if (victim.kind === 'plant') {
        const places = jobPlacementsOf(board, victim.key, which);
        const p = places[victim.gidx];
        if (p) {
            const cell = board[p.r] && board[p.r][p.c];
            if (Array.isArray(cell)) {
                const i2 = cell.indexOf(p.item);
                if (i2 !== -1) cell.splice(i2, 1);
            }
        }
    }

    // 解钉：gidx 刷成删后编号；被删落点引用找不到 -> 剔除
    const alive = unpin();
    const rest = steps.filter(function (s, i) { return alive[i] && i !== idx; });
    jobStoreSteps(t, which, board, rest);

    jobAfterChainChange(t, which, st.kind === 'plant'
        ? '🗑️ 已从链条和棋盘上移除这一株'
        : '🗑️ 已从链里移除这个动作');
}

// 给一个块接上拖放落点。getTarget() 返回 jobApplyDrop 需要的 target（除 after）
function jobWireDropTarget(el, getTarget) {
    // ★ 把「这个块代表哪一步」钉在元素上：容器级落点（缝里/块外）
    //   需要按指针位置找到最近的块，再拿它的步骤做落点。
    const probe = getTarget();
    if (probe) {
        el.__seqStep = probe.step || null;
        if (probe.key !== undefined) el.dataset.key = probe.key;
        if (probe.which !== undefined) el.dataset.which = probe.which;
    }

    el.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        // ★ 跨链拖拽也放行（boss 棋盘禁止拖入收尾链 —— boss 关没有收尾）
        if (seqDrag.which !== el.dataset.which
            && el.dataset.which === 'end' && jobIsBossBoard()) return;
        // 一律 preventDefault：即使只是擦到块边缘，也别让光标闪成禁止
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        jobMarkDropTarget(el, jobDropBelow(e, el));
        // 不 stopPropagation：让容器层能按「缝里的中线」纠正落点
    });
    el.addEventListener('dragleave', function (e) {
        if (!seqDrag) return;
        if (el.contains(e.relatedTarget)) return;
        el.classList.remove('seq-over-top', 'seq-over-bottom');
    });
    el.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!seqDrag) return;
        if (e.__seqHandled) return;         // 容器层已处理
        e.__seqHandled = true;
        const below = jobDropBelow(e, el);
        const drag = seqDrag;
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();
        const target = getTarget();
        if (!target) return;
        target.after = below;
        // ★ 跨链：改落点形态（棋盘联动）+ 搬顺序条目；同链：原来的排序逻辑
        if (drag.which !== target.which) {
            jobMoveStepsToChain(target.t, target.board, drag,
                target.which, target.step, below);
            return;
        }
        jobApplyDrop(drag, target);
    });
}

// ★ 链容器落点：按指针位置「就近插入」，绝不无脑丢链尾。
//   块之间的缝、块左右没铺满的地方、链尾空白都能正确落点。
function jobWireChainDropZone(listBox, t, board, which) {
    listBox.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        // ★ 跨链拖拽放行（boss 棋盘禁止拖入收尾链）
        if (seqDrag.which !== which && which === 'end' && jobIsBossBoard()) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        // 指针在某块内部时，块的 dragover 已经画好线了，别覆盖
        if (jobBlockUnderPointer(listBox, e.clientY)) return;
        const near = jobNearestBlockInList(listBox, e.clientY);
        // 空链：整条链高亮「落到底部」（CSS 只给 seq-over-bottom 画了线）
        if (!near) { jobMarkDropTarget(listBox, true); return; }
        jobMarkDropTarget(near.el, near.below);
    });
    listBox.addEventListener('dragleave', function (e) {
        if (!seqDrag) return;
        if (listBox.contains(e.relatedTarget)) return;
        jobClearSeqOver();
    });
    listBox.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!seqDrag) return;
        if (e.__seqHandled) return;
        e.__seqHandled = true;
        const drag = seqDrag;
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();

        // ★ 跨链拖放：改落点形态（棋盘联动）+ 搬顺序条目
        if (drag.which !== which) {
            const xBlock = jobBlockUnderPointer(listBox, e.clientY);
            if (xBlock) {
                jobMoveStepsToChain(t, board, drag, which,
                    xBlock.__seqStep || null, jobDropBelow(e, xBlock));
                return;
            }
            const xNear = jobNearestBlockInList(listBox, e.clientY);
            jobMoveStepsToChain(t, board, drag, which,
                (xNear && xNear.step) || null, !!(xNear && xNear.below));
            return;
        }

        const inBlock = jobBlockUnderPointer(listBox, e.clientY);
        if (inBlock) {
            jobApplyDrop(drag, {
                t: t, which: which, board: board,
                step: inBlock.__seqStep || null,
                after: jobDropBelow(e, inBlock)
            });
            return;
        }
        const near = jobNearestBlockInList(listBox, e.clientY);
        if (near && near.step) {
            jobApplyDrop(drag, {
                t: t, which: which, board: board,
                step: near.step, after: near.below
            });
            return;
        }
        // 真没有块（空链）-> 落到链尾
        jobDropAtChainEnd(t, which, board, drag);
    });
}

// 落到链尾（空链时才用得到）
function jobDropAtChainEnd(t, which, board, drag) {
    jobApplyDrop(drag, { t: t, which: which, board: board, step: null, after: true });
}

// ============================================================
// ★★ 链条顺序「↑ / ↓ 移一位」（2026-11-02，手机上没有拖拽）
//
//   为什么要有它：排序原本只有 HTML5 `draggable` 一条路，
//   而**触屏浏览器不支持 draggable** —— 手机上种植顺序根本改不了。
//   这里**复用同一条 drop 出口 `jobApplyDrop()`**，所以语义
//   （摘出→重新插入、勾选多项整组搬、无间隔组跟随）与拖拽**完全一致**，
//   绝不出现第二套排序逻辑（§9.2 那一族 bug 的入口就在这附近，别自己另写一套）。
//
//   作用对象 = 当前勾选项（没勾就不动）：
//     同一条链勾了 N 项 → 整组一起挪一位（与「勾选后拖拽」同语义）；
//     跨链勾选 → 每条链各自在自己链内挪一位（链之间不能混排）。
// ============================================================
function jobNudgeSelected(dir) {
    const t = jobTables[currentTable];
    if (!t) return;
    const board = jobCurrentBoard();
    let moved = 0, edge = 0;
    ['once', 'loop', 'end'].forEach(function (which) {
        const picked = jobSelectedInOrder(which, board);
        if (!picked.length) return;
        const steps = jobResolveSteps(t, which, board);
        // 渲染时的步骤对象 ↔ 刚解析出来的对象：先按引用，再按步骤 id 兜底
        const idxs = [];
        picked.forEach(function (st) {
            let i = steps.indexOf(st);
            if (i === -1) {
                const id = jobStepId(st);
                i = steps.findIndex(function (x) { return jobStepId(x) === id; });
            }
            if (i !== -1 && idxs.indexOf(i) === -1) idxs.push(i);
        });
        if (!idxs.length) return;
        idxs.sort(function (a, b) { return a - b; });
        const first = idxs[0], last = idxs[idxs.length - 1];

        let target;
        if (dir < 0) {
            if (first === 0) { edge++; return; }                  // 已经在最前
            target = { t: t, which: which, board: board, step: steps[first - 1], after: false };
        } else {
            if (last === steps.length - 1) { edge++; return; }     // 已经在最后
            target = { t: t, which: which, board: board, step: steps[last + 1], after: true };
        }
        const drag = (picked.length > 1)
            ? { which: which, kind: 'group', group: picked }
            : { which: which, kind: 'step', step: picked[0] };
        if (jobApplyDrop(drag, target)) moved++;
    });
    if (moved) return;          // jobApplyDrop → jobAfterChainChange 内部已重绘并给提示
    if (edge) setStatus(dir < 0 ? '⚠️ 已经是最前面了' : '⚠️ 已经是最后面了');
}

// ============================================================
// ★ 棋盘缩放「⤢ 放大 / 适应」（2026-11-02，手机专用）
//   手机上 9 列一屏最多 ~38px/格；嫌小就切放大 = 58px/格 + 棋盘自己横滑。
//   按钮只在手机断点里显示（`#boardZoomBtn{display:none}` 桌面不占位），
//   所以这段对桌面行为零影响。选择存 localStorage，刷新后保持。
// ============================================================
const JOB_BOARD_ZOOM_KEY = 'jobBoardZoom';

function jobApplyBoardZoom(on) {
    const btn = document.getElementById('boardZoomBtn');
    document.body.classList.toggle('board-zoom', !!on);
    if (btn) {
        btn.classList.toggle('on', !!on);
        btn.textContent = on ? '⤢ 适应' : '⤢ 放大';
        btn.title = on ? '回到「一屏看全棋盘」' : '放大到 58px/格（放大后左右滑动看整盘）';
    }
}

function jobToggleBoardZoom() {
    const on = !document.body.classList.contains('board-zoom');
    jobApplyBoardZoom(on);
    try { localStorage.setItem(JOB_BOARD_ZOOM_KEY, on ? '1' : '0'); } catch (e) { }
}

function jobRestoreBoardZoom() {
    let on = false;
    try { on = localStorage.getItem(JOB_BOARD_ZOOM_KEY) === '1'; } catch (e) { }
    jobApplyBoardZoom(on);
}

