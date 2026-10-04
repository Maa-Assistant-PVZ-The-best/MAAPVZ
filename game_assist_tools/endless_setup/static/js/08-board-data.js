
// ============================================================
// 8. 棋盘数据
// ============================================================
let cols = 9, rows = 5;
let boardEarly = [], boardLate = [];

// ★ 单格最多渲染多少个标记（植物 + 落子动作合计）。
//   CSS 只定义了 job-p1..job-p9 这 9 个坐标（3×3 摆满），第 10 个起没有定位，
//   硬渲染会全部堆在同一处。所以渲染封顶 9 个，多出来的用「+N」角标表示。
//   ⚠️ 改这个值必须同步改 CSS 里的 .job-pN 定位规则。
const JOB_CELL_MAX_MARKS = 9;

function initBoards() {
    boardEarly = Array.from({length: rows}, () => Array(cols).fill(null).map(() => []));
    boardLate = Array.from({length: rows}, () => Array(cols).fill(null).map(() => []));
}
initBoards();

function findOpInBoard(board, opId) {
    for (let r=0; r<board.length; r++) for (let c=0; c<board[r].length; c++) {
        const idx = board[r][c].findIndex(item => item.id === opId);
        if (idx !== -1) return { r, c, idx };
    }
    return null;
}
function countOpInBoard(board, opId) {
    let cnt = 0;
    for (let r=0; r<board.length; r++) for (let c=0; c<board[r].length; c++) cnt += board[r][c].filter(item => item.id === opId).length;
    return cnt;
}
function getUsedPositions(board, opId) {
    const positions = [];
    for (let r=0; r<board.length; r++) for (let c=0; c<board[r].length; c++) {
        board[r][c].forEach(item => { if (item.id === opId && item.slotPos) positions.push(item.slotPos); });
    }
    return positions;
}

function placeOp(board, opId, r, c) {
    const opItem = ALL_OPS.find(o => o.id === opId);
    if (!opItem) return false;

    if (opId === 'feed_ball_late') {
        let hasFeed = false;
        for (let rr = 0; rr < board.length; rr++) {
            for (let cc = 0; cc < board[rr].length; cc++) {
                if (board[rr][cc].some(item => item.id === 'feed' || item.id === 'feed_late')) {
                    hasFeed = true;
                    break;
                }
            }
            if (hasFeed) break;
        }
        if (!hasFeed) {
            alert('⚠️ 请先在小关喂豆位置布置一次“小关喂豆”，才能布置“喂豆球果”。');
            return false;
        }
    }

    // 记录修改前状态（在确定操作成功前）
    saveBoardState();

    if (opItem.single) {
        const existing = findOpInBoard(board, opId);
        if (existing) board[existing.r][existing.c].splice(existing.idx, 1);
    } else {
        if (countOpInBoard(board, opId) >= opItem.maxCount) {
            alert(`“${opItem.label}”已达最大次数 ${opItem.maxCount}`);
            // 撤销刚才保存的状态，因为操作未成功
            undoStack.pop();
            return false;
        }
    }
    const itemData = { id: opId, label: opItem.label, type: opItem.type, col: c+1, row: r+1, opData: opItem };
    if (!opItem.single) {
        const used = getUsedPositions(board, opId);
        let pos = 1;
        while (used.includes(pos)) pos++;
        if (pos > opItem.maxCount) {
            alert(`位置已满`);
            undoStack.pop();
            return false;
        }
        itemData.slotPos = pos;
        itemData.label = `${opItem.label}-${pos}`;
    }
    board[r][c].push(itemData);

    if (opId === 'feed_ball_late') {
        currentValues['小关是否喂豆'] = { index: 1 };
        currentValues['是否开局喂豆球果'] = { index: 1 };
        currentValues['喂豆球果'] = { data: { "列": String(c + 1), "行": String(r + 1) } };
        updatePreview();
    }

    return true;
}

function renderBoard(gridId, boardData, isLate) {
    const gridEl = document.getElementById(gridId);
    jobEnsureSeq(boardData);   // 旧数据/本地缓存恢复时补齐种植序号
    // 全局种植序号表：链与棋盘角标共用同一套连续编号，保证一一对应
    const _tbl = jobTables[currentTable];
    const _gseq = {
        once: jobBuildGlobalSeq(boardData, _tbl, 'once'),
        loop: jobBuildGlobalSeq(boardData, _tbl, 'loop'),
        end:  jobBuildGlobalSeq(boardData, _tbl, 'end')
    };
    gridEl.style.gridTemplateColumns = `repeat(${cols}, 68px)`;
    gridEl.innerHTML = '';
    for (let r=0; r<rows; r++) for (let c=0; c<cols; c++) {
        const cellItems = boardData[r][c] || [];
        const d = document.createElement('div');
        d.className = 'cell' + (cellItems.length ? ' has' : '');
        d.dataset.r = r; d.dataset.c = c;
        d.setAttribute('data-tooltip', '点击放置选中的操作，右键清空该格');
        d.setAttribute('data-tooltip-delay', '1000');

        // 同格图标总数（植物 + 所有落子动作标记）→ 决定缩略图分档
        //   ★ 落子动作由注册表判定，新增动作自动计入。
        //   ★ 放开重复落子后可能超过 9 个：CSS 只有 3×3（job-n9）这一档最满，
        //     所以**最多只渲染 9 个**，多出来的在右下角显示「+N」角标。
        //     （9 个封顶 = JOB_CELL_MAX_MARKS，别和 CSS 的 job-p9 搞混）
        const _pc = cellItems.filter(function (it) {
            if (it.plant) return true;
            if (typeof jobBoardActionOfKey === 'function' && jobBoardActionOfKey(it.id)) return true;
            return it.type === 'feed' || it.type === 'shovel';   // 兜底
        }).length;
        if (_pc > 0) d.classList.add('job-n' + Math.min(_pc, JOB_CELL_MAX_MARKS));

        let _pIdx = 0;   // 植物序号：决定缩略图落在 2×2 / 3×3 网格的第几格
        // 渲染顺序：先按形态（单次在前）、再按槽号、再按槽内序号
        const _slotOf = function (it) {
            const m = /^(?:card|patch_slot)(\d+)$/.exec(it.id || '');
            return m ? Number(m[1]) : 99;   // feed / shovel 排最后
        };
        const _ordered = cellItems.slice().sort(function (a, b) {
            const ma = (jobItemMode(a) === 'once') ? 0 : 1;
            const mb = (jobItemMode(b) === 'once') ? 0 : 1;
            if (ma !== mb) return ma - mb;
            const sa = _slotOf(a), sb = _slotOf(b);
            if (sa !== sb) return sa - sb;
            const qa = (typeof a.seq === 'number') ? a.seq : 9999;
            const qb = (typeof b.seq === 'number') ? b.seq : 9999;
            return qa - qb;
        });
        _ordered.forEach(item => {
            // ★ 同格最多渲染 9 个（3×3 摆满），多余的只在末尾显示「+N」角标。
            //   CSS 的 job-p1..job-p9 只定义了 9 个坐标，第 10 个起没有定位，
            //   渲染出来会全堆在一起 —— 不如直接不渲染，用角标表达。
            if (_pIdx >= JOB_CELL_MAX_MARKS) return;
            const _im = jobItemMode(item);
            const _mcls = (_im === 'once') ? ' is-once' : ' is-loop';
            if (item.plant) {
                const pt = document.createElement('span');
                _pIdx++;
                pt.className = 'tag plant job-p' + _pIdx + _mcls;   // 显式序号，避免 nth-of-type 被标签 span 算错
                pt.title = item.label + '（' + jobModeLabel(_im) + (typeof item.seq === 'number' ? (' · 第 ' + item.seq + ' 个') : '') + '）';
                // 只在「刚刚真正落子」的那一次播放入场动画
                if (jobLastDrop && jobLastDrop.r === r && jobLastDrop.c === c && jobLastDrop.id === item.id) {
                    pt.classList.add('job-pop');
                }
                pt.style.backgroundImage = 'url(static/card_bg/rare_' + (item.plant.rare || 0) + '.webp)';
                if (item.plant.img) {
                    const pi = document.createElement('img');
                    pi.src = item.plant.img;
                    pi.alt = item.label;
                    pi.onerror = function () { this.style.display = 'none'; };
                    pt.appendChild(pi);
                } else {
                    pt.textContent = item.label;
                }
                // 种植序号角标（单次=灰底，循环=深底，收尾=红底）
                // 数字用「全局种植序号」，与顺序链里的编号一一对应
                if (typeof item.seq === 'number') {
                    const sn = document.createElement('span');
                    sn.className = 'job-seq' + (_im === 'once' ? ' job-seq-once' : (_im === 'end' ? ' job-seq-end' : ''));
                    const _gk = jobPlacementKey(_im, item.id, r, c, item.seq);
                    sn.textContent = (_gseq[_im] && _gseq[_im].get(_gk)) || item.seq;
                    pt.appendChild(sn);
                }
                d.appendChild(pt);
                return;
            }
            const tag = document.createElement('span');
            // ★ 落子动作（喂豆/铲子/点击格子/未来扩展）统一按「图片标记」渲染。
            //   判定与图标都来自 15-board-actions.js 的注册表 ——
            //   新增动作不需要改这里。
            const _act = (typeof jobBoardActionOfKey === 'function')
                ? jobBoardActionOfKey(item.id) : null;
            if (_act) {
                _pIdx++;
                // ★ 加统一的 job-mark 类：CSS 靠它给所有落子动作标记
                //   统一的「绝对定位 + 透明底 + 按 job-n 分档尺寸」，
                //   这样新增动作不需要再回 CSS 里补一条规则。
                tag.className = 'tag job-mark ' + item.type + ' job-p' + _pIdx + _mcls;
                const ai = document.createElement('img');
                ai.src = jobBoardActionImg(_act);
                // ★ 用**统一类名** job-mark-img：CSS 靠它给 width/height。
                //   不要再按动作分 tag-feed-img / tag-shovel-img ——
                //   那种「父 .tag.<type> + 子 .tag-*-img」配对选择器很容易脱钩，
                //   一旦不命中，图片就退回原始尺寸（如 500×500），
                //   被 .cell{overflow:hidden} 裁成「只剩中心一小块」。
                ai.className = 'job-mark-img';
                ai.alt = _act.name;
                ai.draggable = false;
                ai.onerror = function () { tag.textContent = item.label || item.id; };
                tag.appendChild(ai);
            } else if (item.type === 'feed') {
                // 兼容旧数据里没有注册表定义的情况
                const fi = document.createElement('img');
                fi.src = (typeof JOB_UI_IMG !== 'undefined' && JOB_UI_IMG.feed) ? JOB_UI_IMG.feed : '';
                fi.className = 'job-mark-img';
                fi.alt = '喂豆';
                fi.draggable = false;
                fi.onerror = function () { tag.textContent = item.label || item.id; };
                tag.appendChild(fi);
            } else if (item.type === 'shovel') {
                const si = document.createElement('img');
                si.src = (typeof JOB_UI_IMG !== 'undefined' && JOB_UI_IMG.shovel) ? JOB_UI_IMG.shovel : '';
                si.className = 'job-mark-img';
                si.alt = '铲子';
                si.draggable = false;
                si.onerror = function () { tag.textContent = item.label || item.id; };
                tag.appendChild(si);
            } else {
                tag.textContent = item.label || item.id;
            }
            // 喂豆 / 铲子等标记也标序号
            if (typeof item.seq === 'number') {
                const sn = document.createElement('span');
                sn.className = 'job-seq job-seq-mark' + (_im === 'once' ? ' job-seq-once' : (_im === 'end' ? ' job-seq-end' : ''));
                const _gk = jobPlacementKey(_im, item.id, r, c, item.seq);
                sn.textContent = (_gseq[_im] && _gseq[_im].get(_gk)) || item.seq;
                tag.appendChild(sn);
            }
            d.appendChild(tag);
        });

        // ★ 超过 9 个的溢出提示：右下角红底「+N」
        if (_pc > JOB_CELL_MAX_MARKS) {
            const ov = document.createElement('span');
            ov.className = 'job-overflow';
            ov.textContent = '+' + (_pc - JOB_CELL_MAX_MARKS);
            ov.title = '本格还有 ' + (_pc - JOB_CELL_MAX_MARKS) + ' 个未显示（共 ' + _pc + ' 个）';
            d.appendChild(ov);
        }

        // 落子高亮闪光（同样只在落子那一次）
        if (jobLastDrop && jobLastDrop.r === r && jobLastDrop.c === c) {
            d.classList.add('job-flash');
        }
        // 有内容的格子改挂悬停详情（2 秒），避免与旧 tooltip 打架
        if (cellItems.length > 0) {
            d.removeAttribute('data-tooltip');
            d.addEventListener('mouseenter', function () { jobScheduleCellDetail(d, cellItems); });
            d.addEventListener('mouseleave', jobHideCellDetailSoon);
        } else {
            d.setAttribute('data-tooltip', '点击放置选中的操作，右键清空该格');
            d.setAttribute('data-tooltip-delay', '1000');
        }
        const cl = document.createElement('span');
        cl.className = 'col-label';
        cl.textContent = 'C'+(c+1);
        const rl = document.createElement('span');
        rl.className = 'row-label';
        rl.textContent = 'R'+(r+1);
        d.appendChild(cl); d.appendChild(rl);

        d.addEventListener('dragover', function(e) { e.preventDefault(); });
        d.addEventListener('drop', function(e) {
            e.preventDefault();
            const data = e.dataTransfer.getData('text/plain');
            if (!data || !data.startsWith('op_')) return;
            const opId = data.substring(3);
            const tr = parseInt(d.dataset.r);
            const tc = parseInt(d.dataset.c);
            if (placeOp(boardData, opId, tr, tc)) { renderAllBoards(); updatePreview(); }
        });
        d.addEventListener('click', function() {
            const tr = parseInt(d.dataset.r);
            const tc = parseInt(d.dataset.c);
            if (typeof jobArmedSlot === 'number' && jobArmedSlot > 0) {
                if (placePlantOnBoard(boardData, jobArmedSlot, tr, tc)) {
                    // ★ 落子动作的 id 由注册表决定（喂豆/铲子/点击格子/扩展…）
                    const _actDrop = (typeof jobBoardActionByArmedNo === 'function')
                        ? jobBoardActionByArmedNo(jobArmedSlot) : null;
                    const _dropId = _actDrop ? _actDrop.id : 'card' + jobArmedSlot;
                    jobLastDrop = { r: tr, c: tc, id: _dropId };
                    renderAllBoards();
                    updatePreview();
                    jobSaveLocal();
                    jobLastDrop = null;   // 播完即清，避免后续重渲染重复播放
                }
                return;
            }
            if (!selectedOp) return;
            if (placeOp(boardData, selectedOp.id, tr, tc)) {
                renderAllBoards();
                updatePreview();
                if (!isBatchMode) { clearSelected(); updateSelectedUI(); }
            }
        });
        d.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            const tr = parseInt(d.dataset.r);
            const tc = parseInt(d.dataset.c);
            const cellItems = (boardData[tr] && boardData[tr][tc]) || [];
            if (!cellItems.length) return;

            // ★ 一格只有 1 个 -> 直接清掉
            if (cellItems.length === 1) {
                saveBoardState();
                boardData[tr][tc] = [];
                renderAllBoards();
                updatePreview();
                jobSaveLocal();
                setStatus(`🗑️ 已清空 (${tc+1}, ${tr+1})：${cellItems[0].label || cellItems[0].id}`);
                return;
            }

            // ★ 一格有多个 -> 弹窗让用户勾选要取消哪几个
            jobPickItemsToCancel(tr, tc, cellItems, function (chosen) {
                if (!chosen.length) return;
                saveBoardState();
                // 保留没被勾选的那些（保持原有先后）
                boardData[tr][tc] = cellItems.filter(function (it) {
                    return chosen.indexOf(it) === -1;
                });
                renderAllBoards();
                updatePreview();
                jobSaveLocal();
                setStatus(`🗑️ 已从 (${tc+1}, ${tr+1}) 移除 ${chosen.length} 项`);
            });
        });
        gridEl.appendChild(d);
        enableTooltip(d);
    }
}

function renderAllBoards() {
    renderBoard('gridEarly', boardEarly, false);
    renderBoard('gridLate', boardLate, true);
    jobRenderSeqChains();   // 棋盘变化后同步刷新顺序链条
    // ★ 左侧槽位区也要跟着刷新：扩展落子动作（点击格子…）的「常驻」
    //   取决于**棋盘上还有没有它的落子** —— 刚落下第一个 / 刚清掉最后一个时，
    //   按钮要立刻出现 / 消失，否则它和 W-S 的可达性会对不上。
    try { jobRenderSlots(); } catch (e) { console.warn('[board] jobRenderSlots', e); }
    jobRenderEndParams();
}

// 只重绘「当前编辑中的那块棋盘」。
// 链条顺序（拖块/融合/拆分/块内重排）会改变棋盘角标的全局种植序号，
// 因此改链后除了刷新链条，还要同步重绘棋盘，否则角标要等手动刷新才对得上。
function jobRenderCurrentBoard() {
    if (jobIsBossBoard()) renderBoard('gridLate', boardLate, true);
    else renderBoard('gridEarly', boardEarly, false);
    jobRenderEndParams();
}

// ============================================================
// 悬停 1.5 秒 → 该格部署详情浮层（可把鼠标移进浮层，不消失）
// ============================================================
let jobCellDetailTimer = null;
let jobCellDetailHideTimer = null;
let jobCellDetailPinned = false;   // 鼠标在浮层里时固定住

function jobHideCellDetail() {
    clearTimeout(jobCellDetailTimer);
    clearTimeout(jobCellDetailHideTimer);
    jobCellDetailPinned = false;
    const el = document.getElementById('cellDetail');
    if (el) el.style.display = 'none';
}

// 延迟关闭：留出「从格子移到浮层」这段空隙的时间
function jobHideCellDetailSoon() {
    clearTimeout(jobCellDetailTimer);
    clearTimeout(jobCellDetailHideTimer);
    jobCellDetailHideTimer = setTimeout(function () {
        if (jobCellDetailPinned) return;   // 鼠标已经进到浮层里了
        const el = document.getElementById('cellDetail');
        if (el) el.style.display = 'none';
    }, 220);
}

function jobScheduleCellDetail(cellEl, items) {
    clearTimeout(jobCellDetailTimer);
    clearTimeout(jobCellDetailHideTimer);
    jobCellDetailTimer = setTimeout(function () {
        jobShowCellDetail(cellEl, items);
    }, 1500);   // 悬停 1.5 秒才弹出
}

function jobShowCellDetail(cellEl, items) {
    let el = document.getElementById('cellDetail');
    if (!el) {
        el = document.createElement('div');
        el.id = 'cellDetail';
        document.body.appendChild(el);
        // 鼠标进入浮层 → 固定不关；离开 → 收起
        el.addEventListener('mouseenter', function () {
            jobCellDetailPinned = true;
            clearTimeout(jobCellDetailHideTimer);
        });
        el.addEventListener('mouseleave', function () {
            jobCellDetailPinned = false;
            jobHideCellDetail();
        });
    }
    const modeOrder = { once: 0, loop: 1, end: 2 };
    const plants = items.filter(function (it) { return it.plant; })
        .sort(function (a, b) {
            const ma = modeOrder[jobItemMode(a)], mb = modeOrder[jobItemMode(b)];
            if (ma !== mb) return ma - mb;
            const qa = (typeof a.seq === 'number') ? a.seq : 9999;
            const qb = (typeof b.seq === 'number') ? b.seq : 9999;
            return qa - qb;
        });
    const others = items.filter(function (it) { return !it.plant; });

    const nOnce = plants.filter(function (it) { return jobItemMode(it) === 'once'; }).length;
    const nEnd = plants.filter(function (it) { return jobItemMode(it) === 'end'; }).length;
    const nLoop = plants.length - nOnce - nEnd;
    let html = '<div class="cd-title">该格部署（' + items.length + '）'
        + (nOnce ? '<span class="cd-tag cd-tag-once">单次 ' + nOnce + '</span>' : '')
        + (nLoop ? '<span class="cd-tag cd-tag-loop">循环 ' + nLoop + '</span>' : '')
        + (nEnd ? '<span class="cd-tag cd-tag-end">收尾 ' + nEnd + '</span>' : '')
        + '</div>';

    plants.forEach(function (it) {
        const rare = it.plant.rare || 0;
        const m = jobItemMode(it);
        html += '<div class="cd-row' + (m === 'once' ? ' cd-row-once' : '') + '">'
            + '<span class="cd-ico" style="background-image:url(static/card_bg/rare_' + rare + '.webp)">'
            + (it.plant.img ? '<img src="' + it.plant.img + '" alt="">' : '')
            + '</span>'
            + '<span class="cd-name">' + (it.label || '') + '</span>'
            + '<span class="cd-mode' + (m === 'once' ? ' cd-mode-once' : (m === 'end' ? ' cd-mode-end' : '')) + '">'
            + (m === 'once' ? '1×' : (m === 'end' ? '收尾' : '⟳')) + '</span>'
            + '<span class="cd-meta">' + (typeof it.seq === 'number' ? ('#' + it.seq + ' ') : '')
            + '(' + (it.col) + ',' + (it.row) + ')</span>'
            + '</div>';
    });
    others.forEach(function (it) {
        const m = jobItemMode(it);
        html += '<div class="cd-row' + (m === 'once' ? ' cd-row-once' : '') + '">'
            + '<span class="cd-name">' + (it.label || it.id) + '</span>'
            + '<span class="cd-mode' + (m === 'once' ? ' cd-mode-once' : (m === 'end' ? ' cd-mode-end' : '')) + '">'
            + (m === 'once' ? '1×' : (m === 'end' ? '收尾' : '⟳')) + '</span>'
            + '<span class="cd-meta">(' + (it.col) + ',' + (it.row) + ')</span></div>';
    });
    el.innerHTML = html;
    el.style.display = 'block';
    // 定位：默认贴格子右侧，越界则翻到左侧 / 上移
    const r = cellEl.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = r.right + 10, y = r.top;
    if (x + w > window.innerWidth - 8) x = r.left - w - 10;
    if (x < 8) x = 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
}

function clearBoard(isLate) {
    saveBoardState();
    const board = isLate ? boardLate : boardEarly;
    for (let r=0; r<board.length; r++) for (let c=0; c<board[r].length; c++) board[r][c] = [];
    renderAllBoards(); updatePreview();
}

// 「🧹 清空棋盘」按钮（棋盘下方）：清掉当前这块棋盘的全部落子。
//   只动棋盘落子 —— 槽位配置（普通关 slots / boss 覆盖层）不受影响。
//   clearBoard 内部已 saveBoardState，Ctrl+Z 可撤销。
function jobClearBoardUI(isLate) {
    const board = isLate ? boardLate : boardEarly;
    let n = 0;
    (board || []).forEach(function (row) {
        (row || []).forEach(function (cell) { n += (cell || []).length; });
    });
    const which = isLate ? 'boss 关' : '普通关';
    if (!n) { setStatus(which + '棋盘本来就是空的'); return; }
    if (!window.confirm('确定清空' + which + '棋盘的全部 ' + n + ' 个落子吗？\n'
        + '（槽位配置不受影响；可 Ctrl+Z 撤销）')) return;
    clearBoard(isLate);
    // 链面板按棋盘落子渲染，清完要跟着刷；改动也要落本地缓存
    try { if (typeof jobRenderSeqChains === 'function') jobRenderSeqChains(); } catch (e) { }
    try { if (typeof jobSaveLocal === 'function') jobSaveLocal(); } catch (e) { }
    setStatus('已清空' + which + '棋盘的 ' + n + ' 个落子（槽位配置保留，可 Ctrl+Z 撤销）');
}
function resizeBoards() {
    if (!document.getElementById('colN') || !document.getElementById('rowN')) return;   // 棋盘尺寸控件已移除
    saveBoardState();
    const _cn = document.getElementById('colN'), _rn = document.getElementById('rowN');
    const nc = Math.max(1, Math.min(9, parseInt((_cn && _cn.value) || '') || 9));
    const nr = Math.max(1, Math.min(5, parseInt((_rn && _rn.value) || '') || 5));
    const oldEarly = boardEarly, oldLate = boardLate;
    const newEarly = [], newLate = [];
    for (let r=0; r<nr; r++) {
        newEarly.push(Array(nc).fill(null).map(() => []));
        newLate.push(Array(nc).fill(null).map(() => []));
        for (let c=0; c<nc; c++) {
            if (r < oldEarly.length && c < oldEarly[0].length) {
                newEarly[r][c] = oldEarly[r][c] || [];
                newLate[r][c] = oldLate[r][c] || [];
            }
        }
    }
    boardEarly = newEarly; boardLate = newLate;
    cols = nc; rows = nr;
    renderAllBoards(); updatePreview();
}
function initTabs() {
    const tabs = Array.from(document.querySelectorAll('#tabHeaders .tab'));
    const contents = { early: document.getElementById('tabEarly'), late: document.getElementById('tabLate') };
    const safe = (fn, ...args) => { try { if (typeof fn === 'function') fn(...args); } catch (e) { console.warn('[tab]', e); } };
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const target = this.dataset.tab;
            tabs.forEach(t => t.classList.toggle('active', t === this));
            Object.keys(contents).forEach(key => {
                if (contents[key]) contents[key].classList.toggle('active', key === target);
            });
            // ★ 切到 boss 关 tab 时，立即归一化 boss 槽位形态：
            //   残留的「收尾」形态改回「循环」（boss 关不能有收尾）。
            if (target === 'late') {
                try {
                    if (jobNormalizeBossEndModes()) {
                        jobSaveLocal();
                    }
                } catch (e) { console.warn('[tab] 归一化 boss 收尾形态失败', e); }
            }
            // ★ 普通关 / boss 关的落子动作**各自独立**：
            //   扩展动作（点击格子…）的「常驻」看的是各自棋盘的落子。
            //   若切换 tab 时仍arm着上一关的扩展动作，它会因为 isArmed 而
            //   在新关上「凭空常驻 / 被 W-S 循环到」——所以在切 tab 时清掉选中。
            //   （内置的喂豆/铲子不受影响：它们本来就常驻。）
            try {
                if (typeof jobBoardActionByArmedNo === 'function') {
                    const _a = jobBoardActionByArmedNo(jobArmedSlot);
                    if (_a && !_a.builtin) jobArmedSlot = 0;
                }
            } catch (e) { console.warn('[tab] 清理跨关选中失败', e); }
            safe(renderOps, target);
            safe(renderQuickSwitches, target);
            safe(renderSlotRemarks);
            safe(updateRightPanelSwitches);
            safe(clearSelected);
            safe(updateSelectedUI);
            safe(renderAllBoards);
            // ★ 槽位栏/链标签随语境切换：boss tab 显示 boss 有效槽位（覆盖层 + 沿用）
            safe(jobRenderSlots);
            safe(jobRenderSeqChains);
            setTimeout(() => safe(resetKeyboardNavigation), 50);
        });
    });
}
