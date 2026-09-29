
// ============================================================
// 补给项选择弹窗
//
// 点图片 = 添加；再点同张 = 移除（来回切换）。
// 相比原来的「输入序号」prompt，这里能直接看到图，不用记数字。
// ============================================================
function jobSupplyItemKey(it) {
    return String(it && (it.id || it.img || it.name) || '');
}

function jobRenderSupplyPicker() {
    const grid = document.getElementById('supplyPickerGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const t = jobTables[currentTable];
    const list = jobSupplyList(t);
    const picked = {};
    list.forEach(function (it) { picked[jobSupplyItemKey(it)] = true; });

    SUPPLY_CANDIDATES.forEach(function (cand) {
        const item = document.createElement('div');
        const isPicked = !!picked[jobSupplyItemKey(cand)];
        item.className = 'sp-item'
            + (isPicked ? ' sp-picked' : '')
            + (cand.pinned ? ' sp-pinned' : '');
        item.title = cand.pinned
            ? (cand.name + (isPicked ? '（点击取消选择）' : '（点击选择）'))
            : cand.name;

        const img = document.createElement('img');
        img.src = SUPPLY_IMG_DIR + encodeURIComponent(cand.img);
        img.alt = cand.name;
        img.onerror = function () { this.style.visibility = 'hidden'; };
        item.appendChild(img);

        const nm = document.createElement('div');
        nm.className = 'sp-name';
        nm.textContent = cand.name;
        item.appendChild(nm);

        // 选中项补一个角标，说明它的状态
        if (cand.pinned && isPicked) {
            const tag = document.createElement('span');
            tag.className = 'sp-pin-tag';
            tag.textContent = '✓ 已选择';
            item.appendChild(tag);
        }

        item.addEventListener('click', function () {
            jobToggleSupplyItem(cand);
        });

        grid.appendChild(item);
    });

    const tip = document.getElementById('supplyPickerTip');
    if (tip) tip.textContent = '已选 ' + list.length + ' 项';
}

// 打开弹窗（同时渲染堆叠卡片与图库）
function jobOpenSupplyPicker() {
    const p = document.getElementById('supplyPicker');
    if (!p) return;
    jobRenderSupply();
    jobRenderSupplyPicker();
    p.classList.add('sp-open');
    const btn = document.getElementById('supplyToggle');
    if (btn) btn.classList.add('sc-on');
}

function jobCloseSupplyPicker() {
    const p = document.getElementById('supplyPicker');
    if (p) p.classList.remove('sp-open');
    const btn = document.getElementById('supplyToggle');
    if (btn) btn.classList.remove('sc-on');
}

// 兼容旧调用：现在「补给选取」按钮直接弹窗，不再有内联折叠面板
function jobToggleSupply(force) {
    if (force === false) jobCloseSupplyPicker();
    else jobOpenSupplyPicker();
}

// 只在 boss tab 显示入口（补给是 boss 关专属）
function jobSyncSupplyVisibility() {
    const entry = document.querySelector('.supply-entry');
    if (!entry) return;
    entry.style.display = jobIsBossBoard() ? '' : 'none';
    if (!jobIsBossBoard()) jobCloseSupplyPicker();   // 切回普通关就关掉弹窗
}

// ============================================================
// 段内重排：把某个落点拖到同段另一个落点的位置
//
// 默认块内顺序 = 棋盘上的 seq（格子1_1 → 1_2 → 1_3 …）。
// 拖拽后把「自定义顺序」写进 seg.order（存的是落点下标 gidx 的数组）。
//
// 参数：
//   seg     —— 该段的规范化对象（jobGetChainOrder 已写回 t[field]，改它即生效）
//   dragGidxs —— 被拖的落点下标（可能多个，取第一个参与换位）
//   targetGidx —— 落到的那个落点下标
// ============================================================
function jobReorderInSeg(t, which, key, seg, dragGidxs, targetGidx) {
    const board = jobIsBossBoard() ? boardLate : boardEarly;
    const all = jobPlacementsOf(board, key, which);
    const total = all.length;
    if (!total) return;

    // 当前段包含哪些落点（按现有顺序）
    const current = jobSegPlacements(board, seg, which).map(function (p) { return p.gidx; });
    if (current.length < 2) return;                 // 只有一个落点，排不了

    const from = (dragGidxs && dragGidxs.length) ? dragGidxs[0] : null;
    if (from === null || current.indexOf(from) === -1) return;
    const to = targetGidx;
    if (to === null || current.indexOf(to) === -1 || from === to) return;

    // 在 current 里把 from 挪到 to 的位置
    const next = current.slice();
    const fi = next.indexOf(from);
    const ti = next.indexOf(to);
    next.splice(fi, 1);
    next.splice(ti, 0, from);

    // ★ 写回自定义顺序
    seg.order = next.slice();

    // 也把「段本身」写回存储数组，保证刷新/导出不丢
    const field = jobChainField(which, board);
    const arr = Array.isArray(t[field]) ? t[field] : null;
    if (arr) {
        // 找到与 seg 对应的那一项（key + picked/from 指纹）
        const hit = arr.find(function (s) {
            if (!s || s.key !== key) return false;
            if (Array.isArray(seg.picked) && seg.picked.length) {
                return Array.isArray(s.picked)
                    && s.picked.join(',') === seg.picked.join(',');
            }
            return (!Array.isArray(s.picked) || !s.picked.length)
                && (s.from | 0) === (seg.from | 0);
        });
        if (hit) hit.order = next.slice();
    }

    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    setStatus('↔ 已调整块内顺序：第 ' + (fi + 1) + ' 株 → 第 ' + (ti + 1) + ' 位');
}

// 渲染种植顺序链条
// 当前显示哪些链（下拉栏里的勾选状态；默认全选）
let jobChainVisible = { once: true, loop: true, end: true };
