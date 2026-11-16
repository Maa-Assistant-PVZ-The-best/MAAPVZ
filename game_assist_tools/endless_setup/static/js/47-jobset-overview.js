
// ============================================================
// 47. 表设置总览（按表分组，**可编辑**）
// ------------------------------------------------------------
//   用户需求（2026-11-02）：
//     「点击后显示各个表的 option 设置就行，比如补给、失败后选项、
//       还没有做的开始前动作、每个表的选卡；局外选卡是全局设置，不用管，
//       而且点击设置后可以设置这个表的单独 option」
//
//   ★ 所以这里**不是只读汇总**，而是「按表分组的设置中心」：
//     每张表一块，列出它的 option，并且**直接在这里改**。
//   ★ 作业集级的全局项（局外选卡 / 识别速率 / 滑动时长 / 世界 / 标签）**不放进来** ——
//     用户明确说「局外选卡是全局设置，不用管」。
//   ★ 改完必须两步收尾（顺序不能反）：
//       ① 如果改的是「当前正在编辑的表」-> 调 jobFillForm() 把主表单同步过去
//          （否则下一次 jobSyncForm 会拿旧控件值把改动盖回去）
//       ② 改数据 -> 重绘 -> 最后 jobSaveLocal（§10.7-A）
//
//   ★ 纯逻辑抽成 jobOverviewTables() / jobOverviewApply()（node 可测）；
//     渲染 jobRenderOverview() 才碰 DOM。
//   ★ 新弹窗三处登记：index.html + base.css(#jobOverviewModal) + 27e 的 JOB_MODAL_SELECTORS。
// ============================================================

// ------------------------------------------------------------
// 数据层（纯函数）
// ------------------------------------------------------------

// 每张表当前的全部 option 值（渲染与断言都用它）
function jobOverviewTables() {
    const tables = (typeof jobTables !== 'undefined' && Array.isArray(jobTables)) ? jobTables : [];
    return tables.map(function (t, i) {
        const slots = t.slots || {};
        let nPlants = 0;
        for (let s = 1; s <= 8; s++) {
            if (slots[s] && String(slots[s]).trim()) nPlants++;
        }
        // ★ 补给分两类（25-jobset-supply.js 的约定）：
        //   ordered = 参与排序的项（顺序 = 优先拿哪个，带 ①②③）
        //   pinned  = 「查看」这类**开关型**选项（`pinned: true` / id === 'view'），
        //             **没有顺序**，不能给它编号 —— 用户明确提过这点。
        const supList = (t && typeof jobSupplyList === 'function') ? jobSupplyList(t) : ((t && t.supplyPicks) || []);
        const ordered = [];
        const pinned = [];
        supList.forEach(function (it) {
            const isPinned = (typeof jobSupplyIsPinned === 'function')
                ? jobSupplyIsPinned(it)
                : !!(it && (it.pinned === true || it.id === 'view'));
            (isPinned ? pinned : ordered).push(it);
        });
        return {
            idx: i,
            name: '表' + (i + 1),
            range: (function () {
                if (Array.isArray(t.levels) && t.levels.length) return '图层（' + t.levels.length + ' 关）';
                const from = (t.from_level === undefined || t.from_level === null) ? '?' : t.from_level;
                const to = (t.to_level === undefined || t.to_level === null) ? '末' : t.to_level;
                return from + '~' + to;
            })(),
            isCurrent: (typeof currentTable === 'number' && i === currentTable),
            lineupMode: (t.lineupMode === 'deck') ? 'deck' : 'plants',
            deckNo: Math.min(6, Math.max(1, parseInt(t.deckNo) || 1)),
            bossLineupMode: (['plants', 'deck'].indexOf(t.bossLineupMode) !== -1) ? t.bossLineupMode : '',
            bossDeckNo: Math.min(6, Math.max(1, parseInt(t.bossDeckNo) || 1)),
            failAfter: (typeof jobNormFailAfter === 'function')
                ? jobNormFailAfter(t.failAfter) : 'stop',
            supplyOrdered: ordered,       // 有顺序
            supplyPinned: pinned,         // 无顺序（查看…）
            plants: nPlants,
            preBattleCount: Array.isArray(t.preBattle) ? t.preBattle.length : 0
        };
    });
}

// 改一张表的一个 option（**唯一写入口**；返回是否真的改了）
//   field: lineupMode | deckNo | bossLineupMode | bossDeckNo | failAfter
function jobOverviewApply(idx, field, value) {
    const tables = (typeof jobTables !== 'undefined' && Array.isArray(jobTables)) ? jobTables : [];
    const t = tables[idx];
    if (!t) return false;
    let changed = false;
    if (field === 'lineupMode') {
        const m = (value === 'deck') ? 'deck' : 'plants';
        if (t.lineupMode !== m) { t.lineupMode = m; changed = true; }
    } else if (field === 'deckNo') {
        const n = Math.min(6, Math.max(1, parseInt(value) || 1));
        if (t.deckNo !== n) { t.deckNo = n; changed = true; }
    } else if (field === 'bossLineupMode') {
        const m = (value === 'plants' || value === 'deck') ? value : '';
        if (t.bossLineupMode !== m) { t.bossLineupMode = m; changed = true; }
    } else if (field === 'bossDeckNo') {
        const n = Math.min(6, Math.max(1, parseInt(value) || 1));
        if (t.bossDeckNo !== n) { t.bossDeckNo = n; changed = true; }
    } else if (field === 'failAfter') {
        const v = (typeof jobNormFailAfter === 'function')
            ? jobNormFailAfter(value) : 'stop';
        if (t.failAfter !== v) { t.failAfter = v; changed = true; }
    }
    if (!changed) return false;
    // ① 改的是当前编辑表 -> 把主表单同步过去（否则 jobSyncForm 会用旧控件值盖回）
    if (idx === currentTable && typeof jobFillForm === 'function') {
        try { jobFillForm(); } catch (e) { /* 表单同步失败不该拖累保存 */ }
    }
    return true;
}

// ------------------------------------------------------------
// 补给：**按指定表** 选/取消一个补给项（25 的 jobToggleSupplyItem 只认 currentTable，
// 这里不能直接复用，否则改的永远是「正在编辑的那张表」）
//   ★ 顺序 = 点击顺序（追加到末尾）；要调顺序仍去棋盘下侧的补给区拖拽。
//   ★ 复用 25 的 SUPPLY_CANDIDATES / jobSupplyList，不另造候选表。
// ------------------------------------------------------------
function _ovSupplyKey(it) {
    if (typeof jobSupplyItemKey === 'function') return jobSupplyItemKey(it);
    return (it && it.id) ? String(it.id) : '';
}

function jobOverviewToggleSupply(idx, candId) {
    const tables = (typeof jobTables !== 'undefined' && Array.isArray(jobTables)) ? jobTables : [];
    const t = tables[idx];
    if (!t || typeof jobSupplyList !== 'function'
        || typeof SUPPLY_CANDIDATES === 'undefined') return false;
    const key = String(candId || '');
    const cand = SUPPLY_CANDIDATES.filter(function (c) { return _ovSupplyKey(c) === key; })[0];
    if (!cand) return false;
    const list = jobSupplyList(t);            // 25 的：没配过会先补默认 5 项
    const at = list.findIndex(function (x) { return _ovSupplyKey(x) === key; });
    if (at >= 0) {
        list.splice(at, 1);
    } else {
        list.push(cand.pinned
            ? { id: cand.id, name: cand.name, img: cand.img, pinned: true }
            : { id: cand.id, name: cand.name, img: cand.img });
    }
    // 改的是当前表 -> 主界面的补给堆叠也跟着刷新
    if (idx === currentTable && typeof jobRenderSupply === 'function') {
        try { jobRenderSupply(); } catch (e) { /* 渲染失败不该拖累保存 */ }
    }
    return true;
}

// ------------------------------------------------------------
// 渲染（这里才碰 DOM）
// ------------------------------------------------------------
function jobRenderOverview() {
    const box = document.getElementById('ovBody');
    if (!box) return;
    const rows = jobOverviewTables();
    box.innerHTML = '';

    const mk = function (tag, cls, txt) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt !== undefined) el.textContent = txt;
        return el;
    };
    const mkSel = function (idx, field, opts, cur, titleTxt) {
        const s = document.createElement('select');
        s.className = 'ov-sel';
        s.dataset.tbl = String(idx);
        s.dataset.field = field;
        if (titleTxt) s.title = titleTxt;
        opts.forEach(function (pair) {
            const o = document.createElement('option');
            o.value = pair[0];
            o.textContent = pair[1];
            s.appendChild(o);
        });
        s.value = cur;
        s.addEventListener('change', function () {
            if (jobOverviewApply(idx, field, this.value)) {
                jobRenderOverview();                 // 重绘
                if (typeof jobSaveLocal === 'function') jobSaveLocal();   // 最后记录
            }
        });
        return s;
    };
    const mkRow = function (labelTxt, node) {
        const r = mk('div', 'ov-row');
        r.appendChild(mk('span', 'ov-k', labelTxt));
        const v = mk('span', 'ov-v');
        if (Array.isArray(node)) node.forEach(function (n) { v.appendChild(n); });
        else if (node) v.appendChild(node);
        r.appendChild(v);
        return r;
    };
    const mkNumSel = function (idx, field, cur, titleTxt) {
        const opts = [];
        for (let n = 1; n <= 6; n++) opts.push([String(n), String(n)]);
        return mkSel(idx, field, opts, String(cur), titleTxt);
    };

    if (!rows.length) {
        box.appendChild(mk('div', 'ov-hint', '（还没有阵容表）'));
        return;
    }

    const hint = document.getElementById('ovHint');
    if (hint) hint.textContent = '共 ' + rows.length + ' 张表 · 改完自动存缓存，记得点「💾 保存此作业集」写进文件';

    rows.forEach(function (r) {
        const card = mk('div', 'ov-card' + (r.isCurrent ? ' ov-cur' : ''));
        // 卡头：表N（区间） + 当前标记 + 切过去
        const head = mk('div', 'ov-card-head');
        head.appendChild(mk('span', 'ov-card-title', r.name));
        head.appendChild(mk('span', 'ov-card-range', r.range));
        if (r.isCurrent) head.appendChild(mk('span', 'ov-cur-badge', '正在编辑'));
        const go = mk('button', 'ov-go', '切到这张表');
        go.type = 'button';
        go.title = '切到这张表（棋盘/槽位/补给都会跟着切过去）';
        go.addEventListener('click', function () {
            if (typeof jobLoadTable === 'function') {
                jobLoadTable(r.idx, true);
                if (typeof jobRenderTabs === 'function') jobRenderTabs();
                if (typeof jobFillForm === 'function') jobFillForm();
                if (typeof jobRenderSlots === 'function') jobRenderSlots();
                if (typeof jobRenderSeqChains === 'function') jobRenderSeqChains();
            }
            jobOverviewClose();
        });
        head.appendChild(go);
        card.appendChild(head);

        // ① 选卡 / 编队
        const lineupNodes = [
            mkSel(r.idx, 'lineupMode',
                  [['plants', '选卡'], ['deck', '切换编队']], r.lineupMode,
                  '这张表的换阵方式：选卡 = 走选卡流程；切换到编队 = 直接切编队、跳过选卡')
        ];
        if (r.lineupMode === 'deck') {
            lineupNodes.push(mk('span', 'ov-sub-lbl', '编队号'));
            lineupNodes.push(mkNumSel(r.idx, 'deckNo', r.deckNo, '切换到第几个编队（1-6）'));
        }
        card.appendChild(mkRow('选卡', lineupNodes));

        // ② boss 关阵容
        card.appendChild(mkRow('boss 关',
            mkSel(r.idx, 'bossLineupMode',
                  [['', '沿用普通关'], ['plants', '单独选卡'], ['deck', '切换编队']],
                  r.bossLineupMode,
                  'boss 关自己的阵容方式；「沿用普通关」= boss 关不重新选卡')));
        if (r.bossLineupMode === 'deck') {
            card.appendChild(mkRow('　└ 编队号',
                mkNumSel(r.idx, 'bossDeckNo', r.bossDeckNo, 'boss 关切到第几个编队（1-6）')));
        }

        // ③ 失败后
        card.appendChild(mkRow('失败后',
            mkSel(r.idx, 'failAfter',
                  [['stop', '停止任务'], ['reset', '重置后继续打'], ['continue', '继续挑战']],
                  r.failAfter,
                  '这张表在「无尽坠机」之后怎么做（覆盖 MAA 那边的同名设置）')));

        // ④ 补给 —— ★ 单独一块，不再挤在「标签|值」一行里：
        //    · 有顺序的项带 ①②③（顺序 = 优先拿哪个）
        //    · 「查看」这类 pinned 项**没有顺序**，单独一行，只显示 选中/未选
        const t = (typeof jobTables !== 'undefined' && jobTables[r.idx]) ? jobTables[r.idx] : null;
        const cands = (typeof SUPPLY_CANDIDATES !== 'undefined') ? SUPPLY_CANDIDATES : [];
        const supAll = [];
        r.supplyOrdered.forEach(function (x) { supAll.push(_ovSupplyKey(x)); });
        r.supplyPinned.forEach(function (x) { supAll.push(_ovSupplyKey(x)); });

        const sup = mk('div', 'ov-supply');
        sup.appendChild(mk('div', 'ov-supply-title',
            '补给顺序（点击顺序 = 优先拿哪个；左右顺序仍去棋盘下侧拖）'));

        // 4.1 已选（有顺序）
        const lineOrd = mk('div', 'ov-chips');
        r.supplyOrdered.forEach(function (it, k) {
            const key = _ovSupplyKey(it);
            const chip = mk('button', 'ov-chip ov-chip-on', (k + 1) + '  ' + (it.name || key));
            chip.type = 'button';
            chip.title = '点一下取消（后面的自动前移）';
            chip.addEventListener('click', function () {
                if (jobOverviewToggleSupply(r.idx, key)) {
                    jobRenderOverview();
                    if (typeof jobSaveLocal === 'function') jobSaveLocal();
                }
            });
            lineOrd.appendChild(chip);
        });
        if (!r.supplyOrdered.length) lineOrd.appendChild(mk('span', 'ov-ro', '（还没选补给）'));
        sup.appendChild(lineOrd);

        // 4.2 可添加（只列普通项，pinned 项归到 4.3）
        const lineAdd = mk('div', 'ov-chips ov-chips-add');
        lineAdd.appendChild(mk('span', 'ov-line-lbl', '可添加'));
        let nAdd = 0;
        cands.forEach(function (c) {
            const key = _ovSupplyKey(c);
            const isPinned = (typeof jobSupplyIsPinned === 'function')
                ? jobSupplyIsPinned(c) : !!(c && c.pinned);
            if (isPinned || supAll.indexOf(key) !== -1) return;
            nAdd++;
            const chip = mk('button', 'ov-chip ov-chip-add', '＋ ' + (c.name || key));
            chip.type = 'button';
            chip.title = '加进补给，排在最后';
            chip.addEventListener('click', function () {
                if (jobOverviewToggleSupply(r.idx, key)) {
                    jobRenderOverview();
                    if (typeof jobSaveLocal === 'function') jobSaveLocal();
                }
            });
            lineAdd.appendChild(chip);
        });
        if (!nAdd) lineAdd.appendChild(mk('span', 'ov-ro', '（都加过了）'));
        sup.appendChild(lineAdd);

        // 4.3 无顺序的开关项（查看…）
        const linePin = mk('div', 'ov-chips ov-chips-pin');
        linePin.appendChild(mk('span', 'ov-line-lbl', '无顺序'));
        let nPin = 0;
        cands.forEach(function (c) {
            const key = _ovSupplyKey(c);
            const isPinned = (typeof jobSupplyIsPinned === 'function')
                ? jobSupplyIsPinned(c) : !!(c && c.pinned);
            if (!isPinned) return;
            nPin++;
            const on = supAll.indexOf(key) !== -1;
            const chip = mk('button', 'ov-chip' + (on ? ' ov-chip-on' : ''), (on ? '✓ ' : '＋ ') + (c.name || key));
            chip.type = 'button';
            chip.title = on ? '点一下取消' : '点一下选中（它不参与顺序）';
            chip.addEventListener('click', function () {
                if (jobOverviewToggleSupply(r.idx, key)) {
                    jobRenderOverview();
                    if (typeof jobSaveLocal === 'function') jobSaveLocal();
                }
            });
            linePin.appendChild(chip);
        });
        if (nPin) sup.appendChild(linePin);
        if (!t) sup.appendChild(mk('span', 'ov-ro', '—'));
        card.appendChild(sup);

        // ⑤ 开局前动作（还没实现 -> 只显示现状，别给假控件）
        card.appendChild(mkRow('开局前动作',
            mk('span', 'ov-ro',
               r.preBattleCount
                   ? (r.preBattleCount + ' 项已配（接口已预留，**当前版本不执行**）')
                   : '未配置（接口已预留，当前版本不执行）')));

        box.appendChild(card);
    });
}

// ------------------------------------------------------------
// 开关
// ------------------------------------------------------------
function jobOverviewOpen() {
    const p = document.getElementById('jobOverviewModal');
    if (!p) return;
    jobRenderOverview();
    p.classList.add('ov-open');
}
function jobOverviewClose() {
    const p = document.getElementById('jobOverviewModal');
    if (p) p.classList.remove('ov-open');
}
function jobOverviewInit() {
    const btn = document.getElementById('jobOverviewBtn');
    if (btn) btn.addEventListener('click', jobOverviewOpen);
    const close = document.getElementById('ovClose');
    if (close) close.addEventListener('click', jobOverviewClose);
    const done = document.getElementById('ovDone');
    if (done) done.addEventListener('click', jobOverviewClose);
    const modal = document.getElementById('jobOverviewModal');
    if (modal) {
        modal.addEventListener('click', function (ev) {
            if (ev.target === modal) jobOverviewClose();
        });
    }
}
