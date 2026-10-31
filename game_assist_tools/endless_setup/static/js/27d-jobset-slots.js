// 27d-jobset-slots.js —— 原 27-jobset-board.js 第 2236~2954 行：槽位面板 + 拖拽自动滚动 + 链条抽屉
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。

function jobSlotLabel(t, key) {
    // ★ 落子动作名由注册表给（喂豆/铲子/点击格子/未来扩展）
    if (typeof jobBoardActionOfKey === 'function') {
        const act = jobBoardActionOfKey(key);
        if (act) return act.name;
    }
    if (key === 'feed') return '喂豆';       // 注册表未加载时的兜底
    if (key === 'shovel') return '铲子';
    const s = Number(key.replace('card', ''));
    const _nm = (typeof jobSlotNameCtx === 'function')
        ? jobSlotNameCtx(t, s, (typeof jobIsBossBoard === 'function') && jobIsBossBoard())
        : t.slots[s];
    return '槽' + s + (_nm ? ('（' + _nm + '）') : '');
}

function jobClearSeqOver() {
    document.querySelectorAll('.seq-chain.seq-over-top, .seq-chain.seq-over-bottom').forEach(function (el) {
        el.classList.remove('seq-over-top', 'seq-over-bottom');
    });
}

// ============================================================
// ★ 拖动链条里的块时，靠近抽屉边缘自动滚动
//
// 关键发现（实测）：
//   原生 HTML5 拖拽（draggable=true）期间，浏览器把鼠标独占给拖拽会话 ——
//   wheel / mousemove / dragover **全都可能不派发**，所以「在 dragstart 之后
//   再开始监听鼠标」是拿不到坐标的。
//
//   但 **mousedown 在拖拽开始之前就会触发**。所以：
//     ① 页面级常驻监听 mousedown / mousemove，始终记住最后的鼠标 Y；
//     ② dragstart 只是「打开自动滚动开关」，坐标直接用①记着的值。
//
// ★ 但这样有个坑：拖拽期间收不到新坐标，就一直是「按下时的那个 Y」。
//   只要按下时鼠标恰好在顶部边缘附近，整段拖拽就会**一直向上滚**，
//   表现成「鼠标往上拖就上滑」。用户明确要求改掉这个行为。
//
//   修正：
//     · 边缘区收窄（90px -> 36px），只在真正贴近边缘时才滚；
//     · **必须先动一下**才允许滚（避免刚按下就开始滚）；
//     · 一旦收到过真实的新坐标，就用新坐标（不再用按下时的旧值）；
//     · 拖拽期间没有坐标更新且已经滚过一小段 -> 自动停下，
//       不让「一直滚」变成失控。
// ============================================================
let _dragMouseY = null;
let _autoScrollRAF = 0;
let _autoScrollOn = false;
let _autoScrollStartY = null;    // 拖拽开始时的 Y
let _autoScrollFresh = false;    // 是否收到过拖拽期间的真实坐标
let _autoScrollMoved = false;    // 是否已经滚过（用于「滚一下就好」的限流）
let _autoScrollBudget = 0;       // 还能滚多少帧（防止无坐标时一直滚）

const AUTO_SCROLL_EDGE = 36;     // 距边缘多少像素开始自动滚（原 90 太大，一点就滚）
const AUTO_SCROLL_MAX  = 18;     // 每帧最大滚动像素
const AUTO_SCROLL_STALE_FRAMES = 24;   // 无新坐标时最多滚多少帧（约 0.4 秒）就停

// ① 常驻追踪鼠标 Y（在任何拖拽开始之前就一直在记）
document.addEventListener('mousemove', function (e) {
    if (typeof e.clientY !== 'number') return;
    _dragMouseY = e.clientY;
    if (_autoScrollOn) {
        // 拖拽期间居然收到了 mousemove -> 这是真实坐标，可以放心用
        _autoScrollFresh = true;
        if (Math.abs(e.clientY - (_autoScrollStartY === null ? e.clientY : _autoScrollStartY)) > 6) {
            _autoScrollMoved = true;
        }
    }
}, true);
document.addEventListener('mousedown', function (e) {
    if (typeof e.clientY === 'number') _dragMouseY = e.clientY;
}, true);
// 拖拽期间若浏览器仍派发 dragover，用它刷新（这是最可靠的真实坐标来源）
document.addEventListener('dragover', function (e) {
    if (!_autoScrollOn || typeof e.clientY !== 'number') return;
    _dragMouseY = e.clientY;
    _autoScrollFresh = true;
    if (Math.abs(e.clientY - (_autoScrollStartY === null ? e.clientY : _autoScrollStartY)) > 6) {
        _autoScrollMoved = true;
    }
    _autoScrollBudget = AUTO_SCROLL_STALE_FRAMES;   // 有真实坐标 -> 重新给额度
}, true);

function jobStopAutoScroll() {
    _autoScrollOn = false;
    _autoScrollFresh = false;
    _autoScrollMoved = false;
    _autoScrollStartY = null;
    _autoScrollBudget = 0;
    if (_autoScrollRAF) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = 0; }
}

function jobStartAutoScroll() {
    const drawer = document.getElementById('seqDrawer');
    if (!drawer) return;
    _autoScrollOn = true;
    _autoScrollStartY = _dragMouseY;      // 记住按下时的位置
    _autoScrollMoved = false;
    _autoScrollFresh = false;
    _autoScrollBudget = AUTO_SCROLL_STALE_FRAMES;
    if (_autoScrollRAF) return;              // 已在跑就别重复起循环

    function tick() {
        if (!_autoScrollOn || !seqDrag) { _autoScrollRAF = 0; return; }

        const y = _dragMouseY;
        const r = drawer.getBoundingClientRect();
        let dy = 0;

        // ★ 必须先动一下 —— 否则「刚按下就开始滚」会让人以为一点就滑
        if (y !== null && _autoScrollMoved) {
            if (y < r.top + AUTO_SCROLL_EDGE) {
                const k = Math.min(1, (r.top + AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE);
                dy = -Math.ceil(AUTO_SCROLL_MAX * Math.max(0, k));
            } else if (y > r.bottom - AUTO_SCROLL_EDGE) {
                const k = Math.min(1, (y - (r.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
                dy = Math.ceil(AUTO_SCROLL_MAX * Math.max(0, k));
            }
        }

        // ★ 没有真实新坐标时，最多滚「一小段」就停 —— 这正是
        //   「鼠标往上拖就一直上滑」的元凶：旧代码会拿按下时的旧 Y 无限滚下去。
        if (dy) {
            if (_autoScrollFresh) {
                drawer.scrollTop += dy;
            } else if (_autoScrollBudget > 0) {
                drawer.scrollTop += dy;
                _autoScrollBudget--;
            }
        }
        _autoScrollRAF = requestAnimationFrame(tick);
    }
    _autoScrollRAF = requestAnimationFrame(tick);
}

// 兜底：某些环境下 drag 期间仍会派发 wheel
document.addEventListener('wheel', function (e) {
    if (!seqDrag) return;
    const drawer = document.getElementById('seqDrawer');
    if (!drawer) return;
    const before = drawer.scrollTop;
    drawer.scrollTop = before + (e.deltaY || 0);
    if (drawer.scrollTop !== before) e.preventDefault();
}, { passive: false });

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
    // ★ flex-wrap + 显式 justify-content:flex-start（严格左对齐，防继承）。
    //   固定 4 列网格的方案试过了：列宽太窄、筹码被迫压缩，更怪 —— 已回滚。
    // ★ boss 棋盘 tab 下编辑的是 boss 槽位覆盖层（t.bossSlots，三态）：
    //   沿用（半透明）  -> ✕ = 删除（boss 关不用这个槽）
    //   覆盖（正常色）  -> ✕ = 取消覆盖、回到沿用
    //   已删除（半透明）-> ↩ = 恢复沿用；点槽体 = 选 boss 植物（变成覆盖）
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    // ★ 只循环 8 个植物槽；落子动作（喂豆/铲子/点击格子…）在下面由注册表渲染。
    //   以前这里是 `i <= 9`，第 9 轮拿 t.slots[9]（undefined）当植物渲染，
    //   会多出一个名字是 null 的空槽。
    for (let i = 1; i <= 8; i++) {
        const name = (typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, i, _bossCtx) : (t.slots[i] || '');
        const _st = (_bossCtx && typeof jobBossSlotState === 'function') ? jobBossSlotState(t, i) : null;
        const _inherited = _st === 'inherit';
        const _blocked = _st === 'blocked';
        const info = jobFindPlant(name);
        const chip = document.createElement('div');
        const armed = (jobArmedSlot === i);
        // ★ 一行一个（固定格式）：筹码保持内容自然宽度，每个筹码后面跟一个
        //   强制换行元素（见循环末尾的 brk）-> 永远竖排、靠左，
        //   任何槽删除/改名导致筹码变窄都不会再被 flex-wrap 塞进同一行。
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid '
            + (armed ? '#2d7aff' : '#d0d7de') + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
        if (armed) chip.className = 'job-slot-armed';
        // ★ 2026-11-02：槽号进 dataset —— 手机端「长按槽位 = 替换 / 删除」要按槽号
        //   转调已有入口（44-jobset-mobile.js），**不要去解析 label 文本**。
        chip.dataset.slot = String(i);
        chip.dataset.plant = name || '';

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
        label.style.cssText = 'font-size:12px;white-space:nowrap;';
        label.textContent = '槽' + i + ': ' + (_blocked ? '已删除' : (name || '未设置'));
        const edit = document.createElement('span');
        edit.textContent = '✎';
        edit.title = '更换植物';
        // ★ dataset.act 是给手机端用的标记（44-jobset-mobile.js 的「重复点击=切链条」
        //   要在捕获阶段放过 ✎ / ✕ 这类动作控件，只接管「点槽体」）。
        edit.dataset.act = 'pick';
        edit.style.cssText = 'font-size:12px;color:#2d7aff;padding:0 2px;flex:0 0 auto;';
        edit.addEventListener('click', (e) => { e.stopPropagation(); jobOpenPicker(i); });

        chip.appendChild(frame);
        chip.appendChild(label);
        chip.appendChild(edit);
        // 沿用 / 已删除槽：半透明显示（已删除再加一道红色虚线框区分）
        if (_inherited || _blocked) chip.style.opacity = '0.55';
        if (_blocked) chip.style.borderStyle = 'dashed';

        // 槽位操作按钮（原来右键清空，现在右键让位给「切换形态」）
        //   普通关语境：✕ = 清槽位 + 清两块棋盘该槽落点
        //   boss 语境：沿用槽 ✕ = 删除（不用这个槽）；覆盖槽 ✕ = 取消覆盖回沿用；
        //             已删除槽 ↩ = 恢复沿用
        const clr = document.createElement('span');
        clr.textContent = _blocked ? '↩' : '✕';
        clr.dataset.act = 'del';       // 手机端「重复点击=切链条」要放过它，见上
        clr.title = !_bossCtx ? '清空该槽位（同时清掉棋盘上该槽的落点；后面的槽会自动左移补位）'
                + '\n★ Ctrl+点击 = 不问「只删本表 / 删所有表」，直接删掉本表这一槽'
            : _inherited ? '删除沿用：boss 关不再使用这个槽（普通关不受影响；后面的槽会左移补位）'
            : _blocked ? '恢复沿用普通关该槽'
            : '取消 boss 覆盖，回到沿用普通关'
                + '\n★ Ctrl+点击 = 直接删掉本表 boss 关这一槽（不弹窗）';
        clr.style.cssText = 'font-size:11px;padding:0 2px;flex:0 0 auto;color:' + (_blocked ? '#2d7aff' : '#ef4444') + ';';
        clr.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_bossCtx) {
                t.bossSlots = t.bossSlots || {};
                if (_inherited) {
                    // 沿用 -> 删除：boss 关不再使用这个槽；boss 棋盘上的该槽落点清掉
                    // （只清 boss 棋盘 —— 普通关该槽的植物和落点都不动）
                    const hadB = name;
                    t.bossSlots[i] = null;
                    if (jobArmedSlot === i) jobArmedSlot = 0;
                    const removedB = jobPurgeSlotOnBoard(boardLate, i);
                    // ★ 删除后把 boss 侧压实（中间不能留空槽，2026-10-30）
                    let shiftB = 0;
                    if (typeof jobCompactSlots === 'function') {
                        try { shiftB = jobCompactSlots(t, true); } catch (err) { console.warn('[slot] compact boss', err); }
                    }
                    try { renderAllBoards(); } catch (err) { }
                    try { updatePreview(); } catch (err) { }
                    jobRenderSlots();
                    jobRenderSeqChains();
                    jobSaveLocal();
                    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                    setStatus('已在 boss 关删除 槽' + i + (hadB ? '（' + hadB + '）' : '')
                        + '，普通关不受影响（点 ↩ 可恢复沿用）'
                        + (removedB ? '；boss 棋盘 ' + removedB + ' 个落点已移除' : '')
                        + (shiftB ? '；后面 ' + shiftB + ' 个槽已左移补位' : ''));
                    return;
                }
                if (_blocked) {
                    // 已删除 -> 恢复沿用（删除标记去掉）
                    delete t.bossSlots[i];
                    // 恢复沿用后若该槽仍是空的（普通关该槽也没植物），同样压实
                    let shiftB = 0;
                    if (typeof jobCompactSlots === 'function') {
                        try { shiftB = jobCompactSlots(t, true); } catch (err) { }
                    }
                    jobRenderSlots();
                    jobRenderSeqChains();
                    jobSaveLocal();
                    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                    setStatus('槽' + i + ' 已恢复沿用普通关'
                        + (t.slots[i] ? '「' + t.slots[i] + '」' : '')
                        + (shiftB ? '；boss 侧已左移补位 ' + shiftB + ' 个槽' : ''));
                    return;
                }
                // 覆盖 -> 删除这一株：先弹「只删本表 boss 关 / 删所有表」（2026-10-30 用户要求）
                //   （老行为 = 只取消覆盖回沿用，现在归到"只删这张表"那一项里）
                // ★ Ctrl+左键 = 直接删掉本表这一槽（用户要求 2026-10-31：不想每次都点弹窗）
                if ((e.ctrlKey || e.metaKey) && typeof jobDeleteSlotHere === 'function') {
                    const rr = jobDeleteSlotHere({ name: name, side: 'boss', slot: i });
                    if (typeof jobAfterPlantChange === 'function') {
                        jobAfterPlantChange('🗑️ 已删掉 boss 关 槽' + i + '（' + name + '）'
                            + (rr.removed ? '，boss 棋盘 ' + rr.removed + ' 个落点已移除' : '')
                            + (rr.shifted ? '；后面 ' + rr.shifted + ' 个槽已左移补位' : '')
                            + '　（Ctrl+Z 可撤销）');
                    }
                    return;
                }
                if (typeof jobOpenPlantDelete === 'function') {
                    jobOpenPlantDelete(name, 'boss', i);
                    return;
                }
                const hadB = name;
                delete t.bossSlots[i];
                const inh = t.slots[i] || '';
                if (inh) {
                    try { jobSyncSlotPlantOnBoard(boardLate, i, inh); } catch (err) { }
                } else {
                    // 普通关该槽也是空 -> 清掉 boss 棋盘上的孤儿落点
                    jobPurgeSlotOnBoard(boardLate, i);
                }
                if (jobArmedSlot === i) jobArmedSlot = 0;
                let shiftB = 0;
                if (typeof jobCompactSlots === 'function') {
                    try { shiftB = jobCompactSlots(t, true); } catch (err) { }
                }
                try { renderAllBoards(); } catch (err) { }
                try { updatePreview(); } catch (err) { }
                jobRenderSlots();
                jobRenderSeqChains();
                jobSaveLocal();
                if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                setStatus('已取消 槽' + i + '（' + hadB + '）的 boss 覆盖'
                    + (inh ? '，回到沿用普通关「' + inh + '」' : '')
                    + (shiftB ? '；boss 侧已左移补位 ' + shiftB + ' 个槽' : ''));
                return;
            }
            const had = t.slots[i];
            // ★ 连续卡槽（2026-10-30 改为**自动左移压实**）：
            //   以前为了保持连续，禁止卸中间槽（"槽8 有植物时不能卸 槽7"）——
            //   用户明确要求反过来：卸掉 槽7 后，槽8 的植物应该变成 槽7。
            //   ★ 现在再加一层：先弹「只删本表 / 删所有表」二选一（42-jobset-batch.js），
            //     选完才真正删，删完 jobCompactSlots 自动左移补位。
            if (!had) {
                setStatus('槽' + i + ' 还没有植物，没什么可删的');
                return;
            }
            // ★ Ctrl+左键 = 直接删掉本表这一槽（= 删除窗里的「只删这张表的这一株」）
            //   用户要求 2026-10-31：常用操作别每次都点一遍弹窗。
            if ((e.ctrlKey || e.metaKey) && typeof jobDeleteSlotHere === 'function') {
                const rr = jobDeleteSlotHere({ name: had, side: 'normal', slot: i });
                if (typeof jobAfterPlantChange === 'function') {
                    jobAfterPlantChange('🗑️ 已删掉 槽' + i + '（' + had + '）'
                        + (rr.removed ? '，普通关棋盘 ' + rr.removed + ' 个落点已移除' : '')
                        + (rr.shifted ? '；后面 ' + rr.shifted + ' 个槽已左移补位' : '')
                        + '　（Ctrl+Z 可撤销）');
                }
                return;
            }
            if (typeof jobOpenPlantDelete === 'function') {
                jobOpenPlantDelete(had, 'normal', i);
                return;
            }
            // 兜底（42 未加载时）——老行为：清槽位 + 清普通关棋盘落点 + 压实
            t.slots[i] = '';
            if (jobArmedSlot === i) jobArmedSlot = 0;
            // ★ 槽位清空了，普通关棋盘上这个槽的落点也必须清掉 ——
            //   否则会留下「没有槽位却还在棋盘上」的孤儿植物
            //   （和「改槽位不同步」是同一类问题的另一面）。
            // ★ 只清普通关棋盘：boss 关是独立配置，普通关清槽不该带走它
            //   （boss 该槽若还在「沿用」，就地固化成显式覆盖，见 21 的注释）。
            const removed = (typeof jobClearNormalSlot === 'function')
                ? jobClearNormalSlot(i) : jobPurgeSlotFromBoard(i);
            // ★ 左移压实（把中间的空位顶掉，卡槽永远从槽1 起连续）
            let shifted = 0;
            if (typeof jobCompactSlots === 'function') {
                try { shifted = jobCompactSlots(t, false); } catch (err) { console.warn('[slot] compact', err); }
                // boss 侧顺手做一次"查漏"压实：纯沿用（没有覆盖）时它是恒等的，
                // 只有历史数据里已经留下空洞才会真的搬（这就是"槽6 到槽8 中间空着"的清理）
                try { jobCompactSlots(t, true); } catch (err) { }
            }
            try { renderAllBoards(); } catch (err) { }
            try { updatePreview(); } catch (err) { }
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();   // 局外选卡角标实时刷新
            if (had) setStatus('已清空 槽' + i + '（' + had + '）'
                + (removed ? '，普通关棋盘上 ' + removed + ' 个落点也已移除' : '')
                + (shifted ? '；后面 ' + shifted + ' 个槽已左移补位（卡槽保持连续）' : '')
                + '（boss 关配置不受影响）');
        });
        chip.appendChild(clr);

        // 形态角标：单次（灰）/ 循环（蓝）（已删除的槽没有形态，不显示）
        const _mode = jobSlotMode(t, jobSlotKeyOf(i));
        if (!_blocked) {
            const mb = document.createElement('span');
            mb.className = 'slot-mode-badge' + (_mode === 'once' ? ' is-once'
                : (_mode === 'end' ? ' is-end' : ' is-loop'));
            mb.style.flex = '0 0 auto';
            mb.textContent = (_mode === 'once') ? '1×' : (_mode === 'end' ? '🚩' : '⟳');
            mb.title = '放置形态：' + jobModeLabel(_mode) + '（右键切换）';
            chip.appendChild(mb);
        }

        chip.title = _blocked
            ? 'boss 关已删除该槽（不沿用普通关）　|　点击选择 boss 植物变成覆盖，或点 ↩ 恢复沿用'
            : name
                ? ('点击选中后在棋盘落子：' + name + (_inherited ? '（沿用普通关）' : '')
                    + '　|　右键切换单次/循环/收尾：' + jobModeLabel(_mode))
                : (_bossCtx ? '点击选择 boss 关植物（覆盖普通关该槽）' : '点击选择植物');
        chip.addEventListener('click', () => {
            if (!name) { jobOpenPicker(i); return; }
            jobArmedSlot = (jobArmedSlot === i) ? 0 : i;
            jobRenderSlots();
            const st = document.getElementById('jobStatus');
            if (st) st.textContent = jobArmedSlot ? ('已选中 槽' + i + '（' + name + '），点击棋盘格子落子') : '';
        });
        // 右键：切换单次 / 循环 / 单次+循环（已删除的槽没有形态可切）
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (_blocked) return;
            const m = jobToggleSlotMode(t, jobSlotKeyOf(i));
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            setStatus('🔄 槽' + i + '（' + (name || '未设置') + '）→ ' + jobModeLabel(m));
        });
        box.appendChild(chip);
        // 强制换行：一行一个槽位，永远竖排（内容再窄也不会两个挤一行）
        const rowBrk = document.createElement('span');
        rowBrk.style.cssText = 'flex-basis:100%;height:0;';
        box.appendChild(rowBrk);
    }

    // ---- ★ 落子动作（喂豆/铲子/点击格子/未来扩展）----
    //   全部由 15-board-actions.js 的注册表驱动：
    //     · builtin:true 的（喂豆/铲子）常驻显示
    //     · inMore:true 的（点击格子…）**在棋盘里**或**正被选中**时才显示
    //   新增一个落子动作**不需要改这段**。
    //
    //   ★ 这里的判定必须和 W/S 的循环判定同源（jobBoardActionCycleable），
    //     否则会出现「面板上看不见、却能按 W/S 选中」的错位。
    //     `isArmed` 单独放行：选中后要留着它，才能继续往棋盘落子。
    //   ★ 换行：与上面 8 个植物槽分开一行。
    const brk = document.createElement('span');
    brk.style.cssText = 'flex-basis:100%;height:0;';
    box.appendChild(brk);

    const _acts = (typeof JOB_BOARD_ACTIONS !== 'undefined') ? JOB_BOARD_ACTIONS : [];
    _acts.forEach(function (act) {
        const isArmed = (jobArmedSlot === act.armedNo);
        // 非内置动作：没落在棋盘上就不占地方（左侧更干净）
        // ★ 例外：拖拽类神器按钮（artifactSwipe）——当前表带了 swipe 类神器
        //   就常驻（和植物一排），哪怕棋盘上还没有落子。
        if (act.artifactSwipe) {
            const hasSwipeArt = (typeof jobSwipeArtifactOf === 'function') && !!jobSwipeArtifactOf();
            if (!hasSwipeArt && !isArmed && !jobBoardActionHasPlacement(act)) return;
        } else if (!act.builtin && !isArmed && !jobBoardActionHasPlacement(act)) return;

        const el = document.createElement('div');
        el.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;'
            + 'border:2px solid ' + (isArmed ? '#2d7aff' : (act.color || '#cbd5e1'))
            + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
        if (isArmed) el.className = 'job-slot-armed';

        const dot = document.createElement('span');
        dot.style.cssText = 'font-size:15px;';
        jobAppendIconImg(dot, jobBoardActionImg(act), {
            cls: 'slot-ico-img', size: 44, alt: act.name, fallbackText: act.icon || '⚡'
        });
        el.appendChild(dot);

        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:12px;';
        // ★ 拖拽类神器按钮的名字跟随当前选中的神器（如「魔豆神器」），兜底注册表名
        const _swArt = (act.artifactSwipe && typeof jobSwipeArtifactOf === 'function')
            ? jobSwipeArtifactOf() : null;
        lbl.textContent = (_swArt && _swArt.name) ? _swArt.name : act.name;
        el.appendChild(lbl);

        el.title = (act.desc || '') + '（右键切换单次/循环：'
            + jobModeLabel(jobSlotMode(t, act.id)) + '）';

        el.addEventListener('click', function () {
            jobArmedSlot = isArmed ? 0 : act.armedNo;
            jobRenderSlots();
            setStatus(jobArmedSlot ? ('已选中「' + act.name + '」，点击棋盘格子放置') : '');
        });
        el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            const m = jobToggleSlotMode(t, act.id);
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            setStatus('🔄 ' + act.name + ' → ' + jobModeLabel(m));
        });

        const _m = jobSlotMode(t, act.id);
        const badge = document.createElement('span');
        badge.className = 'slot-mode-badge' + (_m === 'once' ? ' is-once'
            : (_m === 'end' ? ' is-end' : ' is-loop'));
        badge.textContent = (_m === 'once') ? '1×' : (_m === 'end' ? '🚩' : '⟳');
        badge.title = '放置形态：' + jobModeLabel(_m) + '（右键切换）';
        el.appendChild(badge);

        box.appendChild(el);
    });

    // ---- ★「更多」：落子动作的扩展入口 ----
    //   点开弹窗选一个动作，选中后即可在棋盘落子。
    //   弹窗内容同样来自注册表，新增动作自动出现。
    const more = document.createElement('div');
    more.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fafbfc;'
        + 'border:2px dashed #94a3b8;border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
    const mDot = document.createElement('span');
    mDot.style.cssText = 'font-size:15px;color:#64748b;font-weight:700;';
    mDot.textContent = '＋';
    const mLbl = document.createElement('span');
    mLbl.style.cssText = 'font-size:12px;color:#475569;';
    mLbl.textContent = '更多';
    more.appendChild(mDot);
    more.appendChild(mLbl);
    more.title = '更多落子动作（点击选择）';
    more.addEventListener('click', function () {
        if (typeof jobOpenBoardMoreList === 'function') jobOpenBoardMoreList();
    });
    box.appendChild(more);

    // ★ 槽位一有增删覆盖，boss 阵容下拉（沿用/换卡/编队）跟着变 ——
    //   选项集合由「两个棋盘的槽位是否一致」驱动（见 21 的 jobRefreshBossLineupUI）。
    try { if (typeof jobRefreshBossLineupUI === 'function') jobRefreshBossLineupUI(); } catch (e) { }
}

// ============================================================
// 键盘快捷键：W / S 切换槽位，F 切换该槽位的「形态」（也就是所属的链）
//
//   W = 上一个槽，S = 下一个槽
//     顺序：槽1..槽8 → 喂豆 → 铲子 → 回到槽1（循环）
//     ★ 未选中任何槽时，W/S 从「槽1」开始（第一次按 S 选槽1，按 W 选铲子）。
//
//   F = 把当前选中槽位的形态在「单次 → 循环 → 收尾」之间切换。
//     ★ 这和右键点槽位是同一个功能（jobToggleSlotMode）。
//     ★ boss 关**不能**切到收尾 —— 这一点 jobToggleSlotMode 内部已经处理
//       （boss 下只在 once ↔ loop 之间转，end 会归一化回 loop），
//       所以这里不用再判断，直接调用即可。
//
//   注意：在输入框里打字时不响应（否则改毫秒数会误触）。
// ============================================================

// W/S 的循环顺序：1..8（植物）→ 当前**允许循环**的落子动作。
//
//   ★ 由注册表驱动，新增动作自动进循环，本函数不需要改。
//
//   ★★ 关键：扩展动作（inMore）**必须已落在当前关的棋盘上**才进循环
//      （见 jobBoardActionCycleable）。内置动作（喂豆/铲子）永远可循环。
//
//   为什么必须是**函数**而不是常量：棋盘上的落子在编辑过程中随时增减，
//   常量只在脚本加载时算一次，用户「选完更多动作 → 落子」后循环列表不会更新，
//   于是选完之后按 W/S 仍然找不到它（或反过来，把棋盘上的子清掉后仍能循环到）。
//   所以每次按 W/S 都重新计算。
//
//   ★ cur：当前已选中的 armedNo。即使它此刻在棋盘上没有落子，
//     也**必须**留在列表里 —— 否则按 W/S 会「跳过自己」，无法从它切走。
function jobSlotCycleList(cur) {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    if (typeof JOB_BOARD_ACTIONS !== 'undefined') {
        JOB_BOARD_ACTIONS.forEach(function (act) {
            if (!act || typeof act.armedNo !== 'number') return;
            // 内置的（喂豆/铲子）常驻；扩展的只有「在棋盘里」或「正被选中」才进
            if (jobBoardActionCycleable(act) || act.armedNo === cur) a.push(act.armedNo);
        });
    } else {
        a.push(9, 10);   // 注册表没加载时的兜底：喂豆 / 铲子
    }
    a.sort(function (x, y) { return x - y; });
    return a;
}

// ★ 把 jobArmedSlot 的数字编号转成「槽位 key」。
//   注意 jobSlotKeyOf 认的是字符串，而 jobArmedSlot 用 9/10/11 表示落子动作 ——
//   直接传数字会得到 'card9'/'card10'（错的）。所以先查注册表。
function jobSlotKeyOfArmed(s) {
    if (typeof jobBoardActionByArmedNo === 'function') {
        const act = jobBoardActionByArmedNo(s);
        if (act) return act.id;
    }
    return jobSlotKeyOf(s);
}

// 该槽位在界面上显示的名字（用于状态提示）—— 按当前编辑 tab 语境取有效植物
function jobSlotDisplayName(t, s) {
    if (typeof jobBoardActionByArmedNo === 'function') {
        const act = jobBoardActionByArmedNo(s);
        if (act) return act.name;
    }
    const nm = t ? ((typeof jobSlotNameCtx === 'function')
        ? jobSlotNameCtx(t, s, (typeof jobIsBossBoard === 'function') && jobIsBossBoard())
        : (t.slots ? (t.slots[s] || '') : '')) : '';
    return '槽' + s + (nm ? '（' + nm + '）' : '（未设置）');
}

// ============================================================
// ★ 棋盘落子区的「更多」—— 动作列表弹窗
//
//   与右侧通用动作的「更多」(#moreList) 是**两套**：
//     · 右侧 #moreList     -> 往**链上**插通用动作（无格子）
//     · 这里 #boardMoreList -> 选一个**落子动作**，选中后在棋盘上摆
//
//   ★ 列表内容来自 15-board-actions.js 的注册表（JOB_BOARD_ACTIONS 里
//     inMore:true 的那些）—— 新增落子动作**不需要改本文件**。
// ============================================================

function jobOpenBoardMoreList() {
    const modal = document.getElementById('boardMoreList');
    if (!modal) return;
    jobRenderBoardMoreList();
    modal.classList.add('bml-open');
}

function jobCloseBoardMoreList() {
    const modal = document.getElementById('boardMoreList');
    if (modal) modal.classList.remove('bml-open');
}

function jobRenderBoardMoreList() {
    const box = document.getElementById('bmlBody');
    if (!box) return;
    box.innerHTML = '';

    const list = (typeof jobBoardMoreActions === 'function')
        ? jobBoardMoreActions() : [];

    if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'bml-empty';
        hint.textContent = '（暂无更多落子动作）';
        box.appendChild(hint);
        return;
    }

    const t = jobTables[currentTable];
    const boss = jobIsBossBoard();

    list.forEach(function (act) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bml-item';

        const ico = document.createElement('span');
        ico.className = 'bml-ico';
        jobAppendIconImg(ico, jobBoardActionImg(act), {
            cls: 'bml-ico-img', size: 24, alt: act.name, fallbackText: act.icon || '⚡'
        });
        btn.appendChild(ico);

        const txt = document.createElement('div');
        txt.className = 'bml-txt';
        const nm = document.createElement('div');
        nm.className = 'bml-name';
        nm.textContent = act.name;
        txt.appendChild(nm);
        if (act.desc) {
            const ds = document.createElement('div');
            ds.className = 'bml-desc';
            ds.textContent = act.desc;
            txt.appendChild(ds);
        }
        btn.appendChild(txt);

        // 角标：当前形态 + 已落几个
        if (t) {
            const badge = document.createElement('span');
            badge.className = 'bml-badge';
            const m = jobSlotMode(t, act.id);
            const n = jobPlacementCountAllModes(act.id, boss);
            badge.textContent = jobModeLabel(m) + (n ? ' · ' + n + ' 个' : '');
            btn.appendChild(badge);
        }

        btn.addEventListener('click', function () {
            jobCloseBoardMoreList();
            jobArmedSlot = act.armedNo;
            jobRenderSlots();
            setStatus('已选中「' + act.name + '」，点击棋盘格子放置');
        });

        btn.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            const m = jobToggleSlotMode(t, act.id);
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            jobRenderBoardMoreList();
            setStatus('🔄 ' + act.name + ' → ' + jobModeLabel(m));
        });

        box.appendChild(btn);
    });
}

