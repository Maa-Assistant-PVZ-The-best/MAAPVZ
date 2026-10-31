// ============================================================
// 44-jobset-mobile.js —— 手机端 App 壳（2026-11-02 · 手机 UI v2）
//
// ★ 为什么要有这个文件
//   之前两版都是「把桌面版压窄」：棋盘缩到 34~38px、按钮放大、弹窗贴底。
//   用户实测反馈：「没怎么改，不好适配」——**压扁桌面布局这条路本身就不对**：
//   手机屏一次只放得下一件事，而这个页面有「棋盘 / 槽位 / 顺序 / 作业集存档」
//   四件不同的事，硬塞进一条长页面 = 每次都要上下翻几百像素。
//
//   所以 v2 改成**四个屏**（底部导航切换，同一套 DOM，只做显示/隐藏）：
//     🎯 棋盘  → 表切换条 + 普通关/boss关 + 棋盘 + 动作条   （默认屏）
//     🪴 槽位  → 8 槽位配置
//     🔗 顺序  → 复用现有 #seqDrawer（手机上它本来就是整屏）
//     💾 作业集 → 选择/保存/删除/远程/世界/布局/复制/局外选卡/撤销重做
//
// ★ 设计原则（照着现成做法来的，见 HANDOFF §10.13 的参考链接）
//   1. **底部导航 = 一级导航**（Material 3 / iOS 都是这么干的），不超过 4 项；
//   2. **一屏一件事**，屏幕上不出现「要滚很久才能看到第二件事」；
//   3. **触屏没有右键**（长按 = contextmenu 由本文件补，见下）；
//   4. **桌面零影响**：所有改动都由 `body.m-app` 这个类门控，
//      而这个类只在 `matchMedia('(max-width:900px)')` 命中时才加；
//      桌面端连一行样式都不会变。
//
// ★ 铁律
//   · 不搬 DOM（`appendChild` 移动节点会让 `.getBoundingClientRect()`、
//     自动滚动、拖拽命中判定这些按视口算的东西一起抽风）——
//     这里只做 **display 开关**（挂 `.m-hide`），DOM 树保持原样；
//   · 不复制任何业务逻辑：开关屏、切表、开抽屉全部调已有函数。
// ============================================================
(function () {
    'use strict';

    const TAB_KEY = 'jobMobileTab';
    const TABS = ['board', 'slots', 'order', 'job'];
    const MOBILE_MQ = '(max-width: 900px)';
    const LONG_PRESS_MS = 480;

    let _tab = 'board';
    let _suppressClick = false;     // 长按之后吞掉那一次 click（否则又落一次子）
    let _lastNativeCtx = 0;         // 系统自己弹了 contextmenu 就别再补一次

    function isMobile() { return document.body.classList.contains('m-app'); }

    // ------------------------------------------------------------
    // 屏分组：屏名 -> 要显示/隐藏的现有 DOM 块
    //   ⚠️ 新增一块「属于某个屏」的界面时，**必须往这里登记**，
    //      否则它在手机上会一直挂着（或者永远看不到）。
    // ------------------------------------------------------------
    function screenGroups() {
        return {
            board: [
                document.getElementById('mTableBar'),
                document.getElementById('mSlotStrip'),
                document.getElementById('colBoard'),
            ],
            slots: [
                document.getElementById('colSlots'),
            ],
            // 顺序屏 = 抽屉本身（它是 position:fixed 的浮层，不参与显示开关）
            order: [],
            job: [
                document.getElementById('jobsetPanel'),
                document.querySelector('.toolbar'),
            ],
        };
    }

    // ------------------------------------------------------------
    // 顶部「表切换条」：手机上「现在是哪张表」必须一眼可见、一键能切
    //   （桌面版靠「布局配置」弹窗里的表列表切表，手机上太深）
    // ------------------------------------------------------------
    function ensureTableBar() {
        let bar = document.getElementById('mTableBar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'mTableBar';
        bar.className = 'm-tablebar';
        bar.innerHTML =
            '<div class="m-tb-row">'
            + '  <button type="button" class="m-tb-btn" data-dir="-1" title="上一张阵容表">◀</button>'
            + '  <span class="m-tb-txt">—</span>'
            + '  <button type="button" class="m-tb-btn" data-dir="1" title="下一张阵容表">▶</button>'
            + '  <button type="button" class="m-tb-btn" data-act="undo" title="撤销上一步（手机上没法按 Ctrl+Z）">↩</button>'
            + '  <button type="button" class="m-tb-btn" data-act="redo" title="重做">↪</button>'
            + '  <button type="button" class="m-tb-btn m-tb-more" title="布局配置：新建表 / 给表划分关卡">🧩</button>'
            + '</div>'
            + '<div class="m-tb-row2">'
            + '  <span class="m-tb-armed" id="mArmed">未选动作</span>'
            + '  <span class="m-tb-status" id="mStatus"></span>'
            + '</div>';
        bar.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!btn) return;
            if (btn.dataset && btn.dataset.dir) {
                const n = (typeof jobTables !== 'undefined' && jobTables) ? jobTables.length : 0;
                if (n < 2) return;
                const cur = (typeof currentTable === 'number') ? currentTable : 0;
                const next = (cur + Number(btn.dataset.dir) + n) % n;
                if (typeof jobLoadTable === 'function') jobLoadTable(next);
                renderTableBar();
                return;
            }
            // ★ 手机上按不了 Ctrl+Z，撤销/重做必须有个能点的入口（落错子没救 = 致命）
            if (btn.dataset && btn.dataset.act === 'undo') {
                if (typeof undoBoard === 'function') undoBoard();
                renderTableBar();
                return;
            }
            if (btn.dataset && btn.dataset.act === 'redo') {
                if (typeof redoBoard === 'function') redoBoard();
                renderTableBar();
                return;
            }
            if (btn.classList.contains('m-tb-more') && typeof jobOpenLayout === 'function') jobOpenLayout();
        });
        const board = document.getElementById('colBoard');
        if (board && board.parentNode) board.parentNode.insertBefore(bar, board);
        return bar;
    }

    function renderTableBar() {
        const bar = ensureTableBar();
        const txt = bar.querySelector('.m-tb-txt');
        if (txt) {
            const n = (typeof jobTables !== 'undefined' && jobTables) ? jobTables.length : 0;
            const cur = (typeof currentTable === 'number') ? currentTable : 0;
            const t = n ? jobTables[cur] : null;
            const name = (t && t.label) ? t.label : ('表' + (cur + 1));
            const lv = (t && t.levels && t.levels.length) ? (' · 覆盖 ' + t.levels.length + ' 关') : '';
            txt.textContent = name + '（' + (cur + 1) + '/' + (n || 1) + '）' + lv;
        }
        renderArmed();
        renderSlotStrip();
        showHint();
    }

    // 「当前拿着什么动作」—— 桌面版靠左侧槽位面板的高亮，手机棋盘屏上面板是藏起来的，
    // 所以这里必须单独显示，否则用户根本不知道自己点格子会放什么。
    function renderArmed() {
        const el = document.getElementById('mArmed');
        if (!el) return;
        const slot = (typeof jobArmedSlot === 'number') ? jobArmedSlot : 0;
        if (!slot) { el.textContent = '未选动作'; el.className = 'm-tb-armed'; return; }
        const key = (typeof jobSlotKeyOfArmed === 'function') ? jobSlotKeyOfArmed(slot) : '';
        const act = (typeof jobBoardActionOfKey === 'function' && key) ? jobBoardActionOfKey(key) : null;
        if (act) {
            el.textContent = (act.icon || '') + ' ' + (act.name || key);
            el.className = 'm-tb-armed m-tb-armed-act';
            return;
        }
        const t = (typeof jobTables !== 'undefined' && jobTables) ? jobTables[currentTable] : null;
        const nm = (typeof jobSlotDisplayName === 'function' && t) ? jobSlotDisplayName(t, slot) : '';
        el.textContent = '🌱 槽' + slot + ' · ' + (nm || '（空槽）');
        el.className = 'm-tb-armed';
    }

    // 手机棋盘屏把「状态提示」搬到了表条第二行 —— 不然 setStatus 的信息
    // （已清空 / 已调整顺序 / 已经是最前面…）在手机上一个字都看不到。
    // 没有提示的时候，这一行显示一句**用法提示**：长按=更多 这件事不讲没人会发现。
    const M_HINT = '点格子落子 · 长按格子 = 格内顺序 / 清空';

    function showHint() {
        const el = document.getElementById('mStatus');
        if (!el) return;
        if (el.classList.contains('m-tb-status-on')) return;   // 正在显示消息，别抢
        el.textContent = M_HINT;
        el.classList.add('m-tb-hint');
    }

    function bindStatusMirror() {
        if (typeof window.setStatus !== 'function') return;
        const _orig = window.setStatus;
        window.setStatus = function (msg) {
            const r = _orig.apply(null, arguments);
            const el = document.getElementById('mStatus');
            if (el && isMobile()) {
                el.textContent = String(msg == null ? '' : msg);
                el.classList.remove('m-tb-hint');
                el.classList.add('m-tb-status-on');
                if (el.__mTimer) clearTimeout(el.__mTimer);
                el.__mTimer = setTimeout(function () {
                    el.classList.remove('m-tb-status-on');
                    showHint();
                }, 6000);
            }
            return r;
        };
    }

    // ------------------------------------------------------------
    // 「槽位快选条」（棋盘屏）
    //   桌面上选植物靠左侧槽位面板；手机棋盘屏把那一栏藏起来了，
    //   于是「想落子」必须先跳去槽位屏再跳回来 —— 多两次点击。
    //   这条把 8 个槽缩成一行：**点已配好的槽 = 直接拿着它去落子**，
    //   点空槽 = 直接打开选植物（同一个 jobOpenPicker）。
    // ------------------------------------------------------------
    function ensureSlotStrip() {
        let el = document.getElementById('mSlotStrip');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'mSlotStrip';
        el.className = 'm-slotstrip';
        el.addEventListener('click', function (e) {
            const b = (e.target && e.target.closest) ? e.target.closest('.m-slot-btn') : null;
            if (!b) return;
            const i = Number(b.dataset.slot);
            if (b.dataset.has !== '1') {                    // 空槽：直接去选植物
                if (typeof jobOpenPicker === 'function') jobOpenPicker(i);
                return;
            }
            if (typeof jobArmedSlot !== 'undefined') jobArmedSlot = i;
            if (typeof jobRenderSlots === 'function') jobRenderSlots();
            if (typeof setStatus === 'function') setStatus('已选 槽' + i + ' → 点棋盘格子落子');
        });
        const bar = document.getElementById('mTableBar');
        if (bar && bar.parentNode) bar.parentNode.insertBefore(el, bar.nextSibling);
        return el;
    }

    function renderSlotStrip() {
        const el = ensureSlotStrip();
        const n = (typeof jobTables !== 'undefined' && jobTables) ? jobTables.length : 0;
        const t = n ? jobTables[currentTable] : null;
        if (!t) { el.innerHTML = ''; return; }
        const lateTab = document.getElementById('tabLate');
        const boss = !!(lateTab && lateTab.classList.contains('active'));
        let html = '';
        for (let i = 1; i <= 8; i++) {
            let name = '';
            try {
                name = (typeof jobSlotNameCtx === 'function')
                    ? jobSlotNameCtx(t, i, boss)
                    : ((t.slots && t.slots[i]) || '');
            } catch (e) { name = ''; }
            const p = (name && typeof jobFindPlant === 'function') ? jobFindPlant(name) : null;
            const img = (p && p.img) ? p.img : '';
            const armed = (typeof jobArmedSlot === 'number' && jobArmedSlot === i);
            // 形态角标（= 这一株属于哪条链）：没有它，切了形态也看不出来
            let mode = '';
            if (name && typeof jobSlotMode === 'function') {
                const key = (typeof jobSlotKeyOf === 'function') ? jobSlotKeyOf(i) : ('card' + i);
                try { mode = jobSlotMode(t, key) || ''; } catch (e) { mode = ''; }
            }
            const glyph = (mode === 'once') ? '1×' : (mode === 'end') ? '🚩' : (mode === 'loop') ? '⟳' : '';
            html += '<button type="button" class="m-slot-btn'
                + (armed ? ' m-slot-on' : '') + (name ? '' : ' m-slot-empty') + '"'
                + ' data-slot="' + i + '" data-has="' + (name ? '1' : '0') + '">'
                + (img ? '<img src="' + img + '" alt="">' : '<span class="m-slot-ph">' + (name ? '🌱' : '＋') + '</span>')
                + '<span class="m-slot-no">' + i + '</span>'
                + (glyph ? '<span class="m-slot-mode m-mode-' + mode + '">' + glyph + '</span>' : '')
                + '<span class="m-slot-nm">' + (name || '空') + '</span>'
                + '</button>';
        }
        el.innerHTML = html;
    }

    // ------------------------------------------------------------
    // ★ 重复点击同一个槽 = 切换链条（单次 → 循环 → 收尾 → 单次）
    //
    //   桌面上的入口是「右键点槽位」（以及 F 键），手机没有右键，
    //   而「这株放在单次链还是循环链」是最常调的东西之一。
    //   规则定成**无计时器的两态**，比双击检测稳（不会和双击缩放打架）：
    //     · 点「没选中」的槽  → 照旧：选中它（准备落子）；空槽 → 开选植物
    //     · 点「已选中」的槽  → **切一档形态**，再点继续切
    //   顺带在手机上关掉「再点一次取消选中」：取消选中对手机没用，
    //   留着只会让人以为自己在切链。
    // ------------------------------------------------------------
    function findActTarget(tgt) {
        let n = tgt;
        let guard = 0;
        while (n && guard++ < 8) {
            if (n.dataset && n.dataset.act) return true;   // ✎ / ✕ 这类控件，别接管
            n = n.parentNode;
        }
        return false;
    }

    function cycleSlotMode(slot) {
        const t = (typeof jobTables !== 'undefined' && jobTables) ? jobTables[currentTable] : null;
        if (!t || !slot) return;
        const name = slotNameOf(slot, isBossCtx());
        if (!name) {
            if (typeof setStatus === 'function') setStatus('槽' + slot + ' 还没有植物，先选植物再切链条');
            return;
        }
        const key = (typeof jobSlotKeyOf === 'function') ? jobSlotKeyOf(slot) : ('card' + slot);
        let m = null;
        try { m = (typeof jobToggleSlotMode === 'function') ? jobToggleSlotMode(t, key) : null; } catch (e) { return; }
        if (typeof jobArmedSlot !== 'undefined') jobArmedSlot = slot;   // 切完能直接往这条链落子
        try { if (typeof jobRenderSlots === 'function') jobRenderSlots(); } catch (e) { }
        try { if (typeof jobRenderSeqChains === 'function') jobRenderSeqChains(); } catch (e) { }
        try { if (typeof jobSaveLocal === 'function') jobSaveLocal(); } catch (e) { }
        if (typeof setStatus === 'function') {
            setStatus('🔄 槽' + slot + '（' + name + '）→ '
                + ((typeof jobModeLabel === 'function') ? jobModeLabel(m) : m)
                + ' · 再点一下继续切');
        }
    }

    function bindSlotTapCycle(container) {
        if (!container || container.__mTapCycle) return;
        container.__mTapCycle = true;
        // 捕获阶段：抢在「选中 / 打开选择器」之前判断
        container.addEventListener('click', function (e) {
            if (!isMobile()) return;
            if (findActTarget(e.target)) return;               // ✎ / ✕ 交回原逻辑
            const slot = slotOfTarget(e.target);
            if (!slot) return;
            const armed = (typeof jobArmedSlot === 'number') ? jobArmedSlot : 0;
            if (armed !== slot) return;                        // 没选中 -> 走原有「选中」逻辑
            if (!slotNameOf(slot, isBossCtx())) return;        // 空槽没有形态
            e.stopPropagation();
            e.preventDefault();
            cycleSlotMode(slot);
        }, true);
    }

    // ------------------------------------------------------------
    // 槽位长按 = 动作单「✎ 替换植物 / 🗑 删除这株」
    //   为什么：桌面上槽位胶囊的 ✎ 和 ✕ 是两个 6px 小字，手指根本戳不中；
    //   而「换一株 / 删掉这一株」是手机上最常干的两件事，必须有个能点的入口。
    //   ★ 两个动作**都转调已有入口**，这里一个字都不重写：
    //     · 替换 = jobOpenPicker(slot)                       （= 点 ✎）
    //     · 删除（普通关）= jobOpenPlantDelete(name,'normal',slot)
    //       （= 点 ✕ 弹的那个「只删本表 / 删所有表」二选一，见 HANDOFF §10.7-E ②）
    //     · 删除（boss 关）= jobDeleteSlotHere({name,side:'boss',slot})
    //       （= Ctrl+点 ✕ 的语义，只动 boss 这一槽）
    // ------------------------------------------------------------
    let _sheetSlot = 0;

    function ensureSlotSheet() {
        let el = document.getElementById('mSlotSheet');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'mSlotSheet';
        el.innerHTML = '<div class="mss-card">'
            + '<div class="mss-title" id="mssTitle">槽位</div>'
            + '<button type="button" class="mss-btn" data-act="pick">✎ 替换植物</button>'
            + '<button type="button" class="mss-btn mss-danger" data-act="del">🗑 删除这株</button>'
            + '<button type="button" class="mss-btn mss-cancel" data-act="cancel">取消</button>'
            + '</div>';
        el.addEventListener('click', function (e) {
            if (e.target === el) { closeSlotSheet(); return; }      // 点遮罩 = 取消
            const b = (e.target && e.target.closest) ? e.target.closest('.mss-btn') : null;
            if (!b) return;
            const act = b.dataset ? b.dataset.act : '';
            const slot = _sheetSlot;
            closeSlotSheet();
            if (!slot) return;
            if (act === 'pick') {
                if (typeof jobOpenPicker === 'function') jobOpenPicker(slot);
            } else if (act === 'del') {
                deleteSlotFromSheet(slot);
            }
        });
        document.body.appendChild(el);
        return el;
    }

    function slotNameOf(slot, boss) {
        const t = (typeof jobTables !== 'undefined' && jobTables) ? jobTables[currentTable] : null;
        if (!t) return '';
        try {
            if (typeof jobSlotNameCtx === 'function') return jobSlotNameCtx(t, slot, !!boss) || '';
            return (t.slots && t.slots[slot]) || '';
        } catch (e) { return ''; }
    }

    function openSlotSheet(slot) {
        slot = Number(slot) || 0;
        if (!slot) return;
        const boss = isBossCtx();
        const name = slotNameOf(slot, boss);
        // 空槽没有「替换 / 删除」可言 —— 长按 = 直接去选植物
        if (!name) {
            if (typeof jobOpenPicker === 'function') jobOpenPicker(slot);
            return;
        }
        const el = ensureSlotSheet();
        _sheetSlot = slot;
        const title = el.querySelector ? el.querySelector('.mss-title') : null;
        if (title) {
            title.textContent = '槽' + slot + ' · ' + name + (boss ? '（boss 关）' : '');
        }
        el.classList.add('m-open');
    }

    function closeSlotSheet() {
        const el = document.getElementById('mSlotSheet');
        if (el) el.classList.remove('m-open');
        _sheetSlot = 0;
    }

    function deleteSlotFromSheet(slot) {
        const boss = isBossCtx();
        const name = slotNameOf(slot, boss);
        if (!name) return;
        if (!boss && typeof jobOpenPlantDelete === 'function') {
            jobOpenPlantDelete(name, 'normal', slot);              // 二选一再删
            return;
        }
        if (boss && typeof jobDeleteSlotHere === 'function') {
            const rr = jobDeleteSlotHere({ name: name, side: 'boss', slot: slot }) || {};
            if (typeof jobAfterPlantChange === 'function') {
                jobAfterPlantChange('🗑️ 已删掉 boss 关 槽' + slot + '（' + name + '）'
                    + (rr.removed ? '，' + rr.removed + ' 个落点已移除' : '')
                    + '　（↩ 可撤销）');
            }
            return;
        }
        if (typeof setStatus === 'function') setStatus('⚠️ 这个槽暂时删不了（删除入口未加载）');
    }

    function isBossCtx() {
        const late = document.getElementById('tabLate');
        return !!(late && late.classList.contains('active'));
    }

    // 沿祖先找带 data-slot 的元素（快选条的按钮 / 槽位屏的胶囊都挂了 data-slot）
    function slotOfTarget(tgt) {
        let n = tgt;
        let guard = 0;
        while (n && guard++ < 8) {
            if (n.dataset && n.dataset.slot) return Number(n.dataset.slot) || 0;
            n = n.parentNode;
        }
        return 0;
    }

    // 通用「长按」绑定：resolve(target) 返回一个非空值才启动计时
    function bindLongPressOn(el, resolve, onLong) {
        if (!el || el.__mLP) return;
        el.__mLP = true;
        let timer = null, moved = false, sx = 0, sy = 0;
        const cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };

        el.addEventListener('touchstart', function (e) {
            if (!isMobile() || !e.touches || e.touches.length !== 1) { cancel(); return; }
            const got = resolve(e.target);
            if (!got) return;
            const t0 = e.touches[0];
            sx = t0.clientX; sy = t0.clientY;
            moved = false;
            cancel();
            timer = setTimeout(function () {
                timer = null;
                if (moved) return;
                _suppressClick = true;
                setTimeout(function () { _suppressClick = false; }, 600);
                onLong(got);
                if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) { } }
            }, LONG_PRESS_MS);
        }, { passive: true });

        el.addEventListener('touchmove', function (e) {
            if (!timer) return;
            const t1 = e.touches && e.touches[0];
            if (!t1) return;
            if (Math.abs(t1.clientX - sx) > 10 || Math.abs(t1.clientY - sy) > 10) {
                moved = true;
                cancel();
            }
        }, { passive: true });

        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
        // 长按之后补的那次 click 要吞掉（否则又会去「选中这个槽 / 打开选择器」）
        el.addEventListener('click', function (e) {
            if (!_suppressClick) return;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    // ------------------------------------------------------------
    // ★★ 手机端链条拖拽（Pointer Events，2026-11-02）
    //
    //   为什么必须自己实现：链条排序原本只有 HTML5 `draggable`，
    //   而**触屏浏览器根本不派发 dragstart** —— 手机上「拖不动」不是样式问题。
    //
    //   设计要点（都是踩过的点）：
    //   · **只有拖柄 `.seq-grip` 能发起拖拽**：CSS 里单独给它 `touch-action:none`，
    //     块体其它地方仍可滑动翻页 —— 否则链一长就翻不了页。
    //   · 落点判定**全部复用既有函数**：`jobNearestBlockInList`（就近插入，块缝里
    //     也接得住）、`jobMarkDropTarget` / `jobClearSeqOver`（蓝色落点线）。
    //   · 提交**只有两个出口**：同链 `jobApplyDrop`、跨链 `jobMoveStepsToChain`
    //     —— 和桌面拖拽同一套，绝不自己写排序（§9.2 那族 bug 的入口）。
    //   · 勾选多项时整组搬（`jobDragGroupFor`），与桌面「勾选后拖」同语义。
    // ------------------------------------------------------------
    function bindChainTouchDrag() {
        const box = document.getElementById('seqChains');
        if (!box || box.__mChainDrag) return;
        box.__mChainDrag = true;

        box.addEventListener('pointerdown', function (e) {
            if (!isMobile()) return;
            if (e.pointerType === 'mouse') return;              // 桌面交给 HTML5 拖拽
            const grip = (e.target && e.target.closest) ? e.target.closest('.seq-grip') : null;
            if (!grip) return;
            const el = (grip.closest && grip.closest('.seq-chain')) || null;
            const st = el && el.__seqStep;
            const which = (el && el.dataset) ? el.dataset.which : '';
            const t = (typeof jobTables !== 'undefined' && jobTables) ? jobTables[currentTable] : null;
            const board = (typeof jobCurrentBoard === 'function') ? jobCurrentBoard() : null;
            if (!st || !which || !t || !board) return;

            const group = (typeof jobDragGroupFor === 'function')
                ? jobDragGroupFor(which, st, board) : null;
            const drag = {
                kind: group ? 'group' : 'step',
                which: which, step: st,
                key: (el.dataset && el.dataset.key) || '', group: group,
            };

            let active = false;
            const startX = e.clientX, startY = e.clientY;
            let curY = startY;
            const drawerBody = document.querySelector('.seq-drawer-body');

            // 指针 Y -> 落点（哪条链 + 哪个块 + 在它前面还是后面）
            function tgtAt(y) {
                const lists = box.querySelectorAll('.seq-list');
                let hit = null;
                for (let i = 0; i < lists.length; i++) {
                    const r = lists[i].getBoundingClientRect();
                    if (y >= r.top - 8 && y <= r.bottom + 8) { hit = lists[i]; break; }
                }
                if (!hit) return null;
                const sec = (hit.closest && hit.closest('.seq-section')) || null;
                const w = (sec && sec.dataset && sec.dataset.which) ? sec.dataset.which : '';
                if (!w) return null;
                const near = (typeof jobNearestBlockInList === 'function')
                    ? jobNearestBlockInList(hit, y) : null;
                if (near && near.step) {
                    return { which: w, step: near.step, below: !!near.below, el: near.el };
                }
                return { which: w, step: null, below: true, el: null };   // 空链 / 链尾
            }

            function paint(tgt) {
                if (typeof jobClearSeqOver === 'function') jobClearSeqOver();
                if (tgt && tgt.el && typeof jobMarkDropTarget === 'function') {
                    jobMarkDropTarget(tgt.el, tgt.below);
                }
            }

            function onMove(ev) {
                curY = ev.clientY;
                if (!active) {
                    if (Math.abs(ev.clientY - startY) < 8 && Math.abs(ev.clientX - startX) < 8) return;
                    active = true;
                    el.classList.add('seq-dragging');
                    if (typeof jobMarkDragging === 'function') jobMarkDragging(true);
                }
                if (ev.cancelable) ev.preventDefault();
                // 拖到上下边缘自动滚抽屉（手机一屏只放得下几块）
                if (drawerBody) {
                    if (curY < 90) drawerBody.scrollTop -= 14;
                    else if (curY > window.innerHeight - 100) drawerBody.scrollTop += 14;
                }
                paint(tgtAt(curY));
            }

            function detach() {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                try { grip.releasePointerCapture(e.pointerId); } catch (x) { }
            }

            function finish() {
                detach();
                const wasActive = active;
                active = false;
                el.classList.remove('seq-dragging');
                if (typeof jobMarkDragging === 'function') jobMarkDragging(false);
                if (typeof jobClearSeqOver === 'function') jobClearSeqOver();
                if (!wasActive) return;                    // 只是戳了一下手柄，什么都没发生
                const tgt = tgtAt(curY);
                if (!tgt || !tgt.which) return;
                if (tgt.which !== which) {                  // 跨链（boss 不许进收尾由下层拦）
                    if (typeof jobMoveStepsToChain === 'function') {
                        jobMoveStepsToChain(t, board, drag, tgt.which, tgt.step, tgt.below);
                    }
                    return;
                }
                if (tgt.step === st) return;                // 原地放下 = 不动
                if (typeof jobApplyDrop === 'function') {
                    jobApplyDrop(drag, {
                        t: t, which: tgt.which, board: board, step: tgt.step, after: tgt.below,
                    });
                }
            }

            try { grip.setPointerCapture(e.pointerId); } catch (err) { }
            // 监听挂在 window 上：即使 setPointerCapture 不被支持（或手柄被重渲染），
            // 指针移动/抬起也一定能收到 —— 挂在手柄上会有「拖到一半丢事件」的风险。
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
            if (e.cancelable) e.preventDefault();          // 别让这次按下变成滚动/选中
        }, { passive: false });
    }

    // ------------------------------------------------------------
    // 切屏
    // ------------------------------------------------------------
    function setTab(tab) {
        if (!isMobile()) return;
        if (TABS.indexOf(tab) === -1) tab = 'board';
        _tab = tab;

        const g = screenGroups();
        Object.keys(g).forEach(function (k) {
            (g[k] || []).forEach(function (el) {
                if (el) el.classList.toggle('m-hide', k !== tab);
            });
        });
        Array.prototype.forEach.call(
            document.querySelectorAll('#mNav .m-nav-item'),
            function (b) { b.classList.toggle('m-on', b.dataset.mtab === tab); }
        );

        if (tab === 'board') renderTableBar();
        if (tab === 'order') {
            if (typeof jobOpenSeqDrawer === 'function') jobOpenSeqDrawer();
        } else {
            closeDrawerIfOpen();
        }
        try { window.scrollTo(0, 0); } catch (e) { }
        try { localStorage.setItem(TAB_KEY, tab); } catch (e) { }
    }

    function closeDrawerIfOpen() {
        const d = document.getElementById('seqDrawer');
        if (d && d.classList.contains('seq-open') && typeof jobCloseSeqDrawer === 'function') {
            jobCloseSeqDrawer();
        }
    }

    // ------------------------------------------------------------
    // 桌面 / 手机模式切换
    // ------------------------------------------------------------
    function applyMode() {
        const on = window.matchMedia(MOBILE_MQ).matches;
        document.body.classList.toggle('m-app', on);
        if (on) {
            let saved = 'board';
            try { saved = localStorage.getItem(TAB_KEY) || 'board'; } catch (e) { }
            // 「顺序」是个浮层抽屉，刷新后不要自动弹出来
            if (TABS.indexOf(saved) === -1 || saved === 'order') saved = 'board';
            setTab(saved);
        } else {
            Array.prototype.forEach.call(document.querySelectorAll('.m-hide'), function (el) {
                el.classList.remove('m-hide');
            });
            closeDrawerIfOpen();
        }
    }

    // ------------------------------------------------------------
    // 长按 = 右键（触屏没有右键键）
    //
    // ★ 实现方式是**给格子派发一个真的 `contextmenu` 事件** ——
    //   08-board-data.js 里那套右键分支（多落点 = 方块窗 / 单落点 = 清格 /
    //   Ctrl = 清空整格）一行都不用改，行为与桌面完全一致。
    //   这里绝不自己再写一套「长按该干什么」，否则又是两份逻辑。
    // ------------------------------------------------------------
    function bindLongPress(id) {
        const grid = document.getElementById(id);
        if (!grid || grid.__mLongPress) return;
        grid.__mLongPress = true;

        let timer = null, moved = false, sx = 0, sy = 0;
        const cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };

        // 系统自己弹的 contextmenu（部分安卓浏览器长按会弹）记一笔，避免我们重复补
        grid.addEventListener('contextmenu', function (e) {
            if (e && e.__mSynthetic) return;
            _lastNativeCtx = Date.now();
        }, true);

        grid.addEventListener('touchstart', function (e) {
            if (!isMobile()) return;
            if (!e.touches || e.touches.length !== 1) { cancel(); return; }
            const cell = (e.target && e.target.closest) ? e.target.closest('.cell') : null;
            if (!cell) return;
            // 空格子没有右键语义（08 里也是「空就 return」），省掉误触震一下
            if (!cell.querySelector('.tag')) return;
            const t0 = e.touches[0];
            sx = t0.clientX; sy = t0.clientY;
            moved = false;
            cancel();
            timer = setTimeout(function () {
                timer = null;
                if (moved) return;
                if (Date.now() - _lastNativeCtx < 700) return;   // 系统已经弹过了
                _suppressClick = true;
                setTimeout(function () { _suppressClick = false; }, 600);
                try {
                    const ev = new MouseEvent('contextmenu', {
                        bubbles: true, cancelable: true,
                        clientX: sx, clientY: sy, button: 2,
                    });
                    ev.__mSynthetic = true;
                    cell.dispatchEvent(ev);
                } catch (err) { /* 老浏览器没有 MouseEvent 构造器：放弃长按，别崩 */ }
                if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err2) { } }
            }, LONG_PRESS_MS);
        }, { passive: true });

        grid.addEventListener('touchmove', function (e) {
            if (!timer) return;
            const t1 = e.touches && e.touches[0];
            if (!t1) return;
            if (Math.abs(t1.clientX - sx) > 10 || Math.abs(t1.clientY - sy) > 10) {
                moved = true;          // 手指在滑动 = 滚动页面，不是在长按
                cancel();
            }
        }, { passive: true });

        grid.addEventListener('touchend', cancel);
        grid.addEventListener('touchcancel', cancel);

        // 长按之后浏览器还会补一个 click（会再落一次子）→ 在捕获阶段吞掉
        grid.addEventListener('click', function (e) {
            if (!_suppressClick) return;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    // ------------------------------------------------------------
    // 初始化
    // ------------------------------------------------------------
    function bindNav() {
        const nav = document.getElementById('mNav');
        if (!nav || nav.__mBound) return;
        nav.__mBound = true;
        nav.addEventListener('click', function (e) {
            const b = (e.target && e.target.closest) ? e.target.closest('.m-nav-item') : null;
            if (!b) return;
            if (b.dataset.mtab === _tab) {          // 再点一次当前屏 = 回到顶部
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (err) { }
                return;
            }
            setTab(b.dataset.mtab);
        });
    }

    function init() {
        if (document.body.__mInited) return;
        document.body.__mInited = true;

        // 「顺序」屏 = 现有抽屉。用户关抽屉的方式很多（头部 ✕ / 点遮罩 / Esc），
        // 而 ✕ 的事件是**绑定时就抓住了原函数值**的，包 jobCloseSeqDrawer 没用
        // → 直接监听抽屉的 class 变化：一关就把底部导航切回「棋盘」，
        //   否则会停在「什么都不显示」的空白屏（这是最容易漏的一个坑）。
        const drawer = document.getElementById('seqDrawer');
        if (drawer && window.MutationObserver) {
            new MutationObserver(function () {
                if (isMobile() && _tab === 'order' && !drawer.classList.contains('seq-open')) {
                    setTab('board');
                }
            }).observe(drawer, { attributes: true, attributeFilter: ['class'] });
        }

        bindNav();
        bindLongPress('gridEarly');
        bindLongPress('gridLate');
        bindStatusMirror();
        ensureTableBar();      // 先把两块「手机专用 UI」建出来，screenGroups 才拿得到
        ensureSlotStrip();
        // 槽位长按（两处：棋盘屏的快选条 + 槽位屏的胶囊）→ 「替换 / 删除」动作单
        bindLongPressOn(ensureSlotStrip(), slotOfTarget, openSlotSheet);
        bindLongPressOn(document.getElementById('jobSlots'), slotOfTarget, openSlotSheet);
        // 槽位重复点击 → 切换链条（= 桌面的右键点槽位 / F 键）
        bindSlotTapCycle(ensureSlotStrip());
        bindSlotTapCycle(document.getElementById('jobSlots'));
        // 链条块：触屏拖拽（HTML5 draggable 在触屏不工作）+ 抽屉里的吸附栏 ↑↓
        bindChainTouchDrag();

        applyMode();
        const mq = window.matchMedia(MOBILE_MQ);
        if (mq.addEventListener) mq.addEventListener('change', applyMode);
        else if (mq.addListener) mq.addListener(applyMode);

        // 换表 / 换作业集 / 选完动作后，表条上的「表名」与「当前拿着的动作」要跟着变
        ['jobLoadTable', 'jobApplyLoaded', 'jobRenderSlots'].forEach(function (fn) {
            if (typeof window[fn] !== 'function') return;
            const _o = window[fn];
            window[fn] = function () {
                const r = _o.apply(null, arguments);
                try { if (isMobile() && _tab === 'board') renderTableBar(); } catch (e) { }
                return r;
            };
        });

        // 选完植物后自动回「棋盘」屏 —— 手机上选植物的目的就是去棋盘上落子，
        // 选完还停在槽位屏等于让用户再点一次导航（而且他会以为没生效）。
        if (typeof window.jobConfirmPick === 'function') {
            const _op = window.jobConfirmPick;
            window.jobConfirmPick = function () {
                const r = _op.apply(null, arguments);
                try { if (isMobile() && _tab !== 'board') setTab('board'); } catch (e) { }
                return r;
            };
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 供调试 / 将来的「强制手机视图」按钮用
    window.jobMobileSetTab = setTab;
    window.jobMobileActive = isMobile;
})();
