
// ============================================================
// 表格映射对照（2026-10-13）
//
// 把本地另一个作业集的某张表（普通关 / boss 关棋盘）叠加到当前棋盘上做对照：
//   · 来源：/list_jobs 选作业集 → /load_job 读它的 boardEarly / boardLate
//   · 模式：under = 底层透明（淡，垫在本表内容下） / over = 覆盖显示（浓）
//   · 纯显示层：不进作业集数据、不参与导出、刷新页面即失效
//   · 幽灵图挂在格子 DOM 里（pointer-events:none，不影响落子/右键清空）
// ============================================================

let jobRef = null;   // { code, name, table, board:'early'|'late', mode:'under'|'over', grid }

// ---- 弹窗开关 ----
async function jobOpenRefPicker() {
    const p = document.getElementById('refPicker');
    if (!p) return;
    const sel = document.getElementById('refJobSel');
    sel.innerHTML = '<option value="">载入中…</option>';
    document.getElementById('refTableSel').innerHTML = '';
    try {
        const res = await fetch('/list_jobs');
        const data = await res.json();
        const jobs = (data && data.jobs) || [];
        sel.innerHTML = jobs.length
            ? jobs.map(j => `<option value="${j.code}" data-tables="${j.tables || 0}">${j.name || j.code}</option>`).join('')
            : '<option value="">（没有本地作业集）</option>';
        jobRefSyncTableOptions();
    } catch (e) {
        sel.innerHTML = '<option value="">（列表载入失败）</option>';
    }
    // 回显当前对照状态
    if (jobRef) {
        sel.value = jobRef.code;
        jobRefSyncTableOptions();
        document.getElementById('refTableSel').value = String(jobRef.table);
        document.getElementById('refBoardSel').value = jobRef.board;
        document.getElementById('refModeSel').value = jobRef.mode;
    }
    p.classList.add('sp-open');
}
function jobCloseRefPicker() {
    const p = document.getElementById('refPicker');
    if (p) p.classList.remove('sp-open');
}

// 表序号下拉跟随作业集（tables 数量来自 /list_jobs 的列表项）
function jobRefSyncTableOptions() {
    const sel = document.getElementById('refJobSel');
    const tsel = document.getElementById('refTableSel');
    const opt = sel.options[sel.selectedIndex];
    const n = opt ? (parseInt(opt.dataset.tables) || 0) : 0;
    tsel.innerHTML = n > 0
        ? Array.from({ length: n }, (_, i) => `<option value="${i}">表${i + 1}</option>`).join('')
        : '<option value="">（无表）</option>';
}

// ---- 应用 / 清除 ----
async function jobRefApply() {
    const code = document.getElementById('refJobSel').value;
    const ti = parseInt(document.getElementById('refTableSel').value);
    const board = document.getElementById('refBoardSel').value;
    const mode = document.getElementById('refModeSel').value;
    if (!code || !Number.isFinite(ti)) { setStatus('🔍 先选作业集和表'); return; }
    try {
        const res = await fetch('/load_job?code=' + encodeURIComponent(code));
        const data = await res.json();
        if (data.status !== 'success') { setStatus('🔍 对照载入失败：' + (data.msg || '')); return; }
        const t = ((data.job || {}).tables || [])[ti];
        const grid = t ? (board === 'late' ? t.boardLate : t.boardEarly) : null;
        if (!Array.isArray(grid) || !grid.length) { setStatus('🔍 那张表的棋盘是空的'); return; }
        jobRef = { code, name: data.job.name || code, table: ti, board, mode, grid };
        jobRenderRefGhosts();
        jobRefSyncBadge();
        jobCloseRefPicker();
        setStatus(`🔍 对照：${jobRef.name} 表${ti + 1}（${board === 'late' ? 'boss关' : '普通关'}，${mode === 'over' ? '覆盖' : '底层透明'}）`);
    } catch (e) {
        setStatus('🔍 对照载入异常：' + e.message);
    }
}

function jobRefClear() {
    jobRef = null;
    jobRenderRefGhosts();
    jobRefSyncBadge();
    setStatus('🔍 已清除对照');
}

// ---- 幽灵渲染（每次棋盘重绘后由 jobRenderCurrentBoard 调用）----
function jobRenderRefGhosts() {
    document.querySelectorAll('.ref-ghost-wrap').forEach(function (e) { e.remove(); });
    if (!jobRef || !Array.isArray(jobRef.grid)) return;
    const gridId = (typeof jobIsBossBoard === 'function' && jobIsBossBoard()) ? 'gridLate' : 'gridEarly';
    const gridEl = document.getElementById(gridId);
    if (!gridEl) return;
    gridEl.querySelectorAll('.cell').forEach(function (cellEl) {
        const r = parseInt(cellEl.dataset.r), c = parseInt(cellEl.dataset.c);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;
        const row = jobRef.grid[r];
        const items = (row && row[c]) || [];
        // 同格可能多株（藤蔓叠种等）：套一个迷你网格容器，镜像本体的
        // job-n 分档（ref-n1..9），各就各位，不全尺寸叠成一团。
        const plants = items.filter(function (it) {
            return it && it.type === 'plant' && it.plant && it.plant.img;
        }).slice(0, 9);   // 对齐本体 JOB_CELL_MAX_MARKS 上限
        if (!plants.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'ref-ghost-wrap ref-' + jobRef.mode + ' ref-n' + plants.length;
        plants.forEach(function (it, i) {
            const g = document.createElement('img');
            g.className = 'ref-ghost ref-p' + (i + 1);
            g.src = it.plant.img;
            g.alt = it.plant.name || '';
            g.title = '对照：' + (it.plant.name || '');
            g.onerror = function () { this.remove(); };
            wrap.appendChild(g);
        });
        // 层序语义：under = 插到格子最前（垫在本表内容下）；over = 追加（压在上层）
        if (jobRef.mode === 'under') cellEl.insertBefore(wrap, cellEl.firstChild);
        else cellEl.appendChild(wrap);
    });
}

// ---- 「对照中」徽标（阵容表行） ----
function jobRefSyncBadge() {
    const badge = document.getElementById('refBadge');
    if (!badge) return;
    if (!jobRef) { badge.style.display = 'none'; badge.textContent = ''; return; }
    badge.style.display = '';
    badge.textContent = `🔍 对照中：${jobRef.name} 表${jobRef.table + 1}（${jobRef.board === 'late' ? 'boss' : '普通'}·${jobRef.mode === 'over' ? '覆盖' : '底层'}）`;
    badge.title = '点击清除对照';
}

function jobRefInit() {
    const btn = document.getElementById('refToggle');
    if (btn) btn.addEventListener('click', jobOpenRefPicker);
    const badge = document.getElementById('refBadge');
    if (badge) badge.addEventListener('click', jobRefClear);
    const close = document.getElementById('refPickerClose');
    if (close) close.addEventListener('click', jobCloseRefPicker);
    const apply = document.getElementById('refApply');
    if (apply) apply.addEventListener('click', jobRefApply);
    const clear = document.getElementById('refClear');
    if (clear) clear.addEventListener('click', function () { jobRefClear(); jobCloseRefPicker(); });
    const jobSel = document.getElementById('refJobSel');
    if (jobSel) jobSel.addEventListener('change', jobRefSyncTableOptions);
}
