
// ============================================================
// 作业集下拉栏：列出本地作业集 / 载入某个作业集 / 下载远程作业集
// ============================================================

// ⚠️ 远程作业集来源（GitPages）。留空 = 未配置，点下载会提示。
const JOB_REMOTE_BASE = '';

async function jobLoadList(selectCode) {
    const sel = document.getElementById('jobSelect');
    if (!sel) return;
    // selectCode 明确给了什么就用什么（包括 '' = 请选择）；
    // 只有「完全没传参」时才沿用当前选中项 / 句柄里的 current。
    const hasArg = (selectCode !== undefined);
    const keep = hasArg ? String(selectCode || '') : (sel.value || '');
    let current = keep;
    try {
        const res = await fetch('/list_jobs');
        const data = await res.json();
        const jobs = (data && data.jobs) || [];
        // 仅在「没传参且下拉本来就是空的」时才回退到服务器 current，
        // 否则会把你手动选的「— 请选择 —」又弹回上一个作业集（残留 bug）
        if (!hasArg && !keep && data && data.current) current = data.current;

        sel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = jobs.length ? '— 请选择 —' : '（本地还没有作业集）';
        sel.appendChild(ph);

        jobs.forEach(function (j) {
            const op = document.createElement('option');
            op.value = j.code;
            op.textContent = (j.name || j.code) + (j.current ? ' ★当前' : '');
            sel.appendChild(op);
        });
        sel.value = (current && jobs.some(function (j) { return j.code === current; })) ? current : '';
    } catch (e) {
        console.warn('[jobset] 读取作业集列表失败', e);
    }
}

// 选中下拉项 → 载入该作业集到棋盘，并设为当前（供 Endless_ref.json 使用）
// 选中「— 请选择 —」（空值）→ 清空编辑器，避免上一个作业集残留在场上
async function jobOnSelect() {
    const sel = document.getElementById('jobSelect');
    const code = sel ? sel.value : '';
    const msg = document.getElementById('jobStatus');

    if (!code) {                       // ★ 切到「请选择」= 清空所有设置
        jobResetEditor();
        await jobSetCurrent('');
        if (msg) { msg.textContent = '已清空（未选择作业集）'; msg.style.color = '#94a3b8'; }
        return;
    }

    try {
        const res = await fetch('/load_job?code=' + encodeURIComponent(code));
        const data = await res.json();
        if (data.status !== 'success' || !data.job) {
            if (msg) { msg.textContent = '❌ ' + (data.msg || '载入失败'); msg.style.color = '#dc2626'; }
            return;
        }
        // 先整体清空，再装载 —— 避免新作业集没有的字段沿用上一个作业集的残留
        jobResetEditor(true);
        jobApplyLoaded(data.job, code);
        await jobSetCurrent(code);
        await jobLoadList(code);
        if (msg) { msg.textContent = '✅ 已载入「' + (jobMeta.name || code) + '」'; msg.style.color = '#22a65e'; }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 载入失败：' + e; msg.style.color = '#dc2626'; }
    }
}

// 清空编辑器到「空白作业集」状态（并写进本地缓存，刷新后依然是空白）
// quiet=true 时不清 localStorage（供「载入前先清空」用，随后会由 jobApplyLoaded 覆盖）
function jobResetEditor(quiet) {
    jobMeta.code = '';
    jobMeta.name = '';
    jobArmedSlot = 0;
    currentSlotEditing = -1;
    jobLastDrop = null;
    currentTable = 0;

    jobTables = [];
    jobNewTable();                     // 建一张干净的空白表
    jobRenumberTables();

    // 世界复选框全不勾
    document.querySelectorAll('#jobWorlds input').forEach(function (cb) { cb.checked = false; });
    // 阵容表表单恢复默认（关卡区间由 jobRenumberTables 统一算，不在表单里）
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    set('tfLineupMode', 'plants'); set('tfDeckNo', '1');
    const bd0 = document.getElementById('tfBoundary');
    if (bd0) bd0.value = '';

    boardEarly = jobBoardOrBlank([]);
    boardLate = jobBoardOrBlank([]);

    jobLoadTable(0, true);
    jobRenderTabs();
    jobRenderSlots();
    jobRenderSeqChains();
    jobHideCellDetail();

    if (!quiet) jobSaveLocal();        // 把「空白配置」写进缓存
}

// 把一份作业集数据装进编辑器
function jobApplyLoaded(job, code) {
    jobMeta.code = code || job.code || '';
    jobMeta.name = job.name || '';
    jobTables = Array.isArray(job.tables) ? job.tables : [];
    jobTables.forEach(function (t) {
        if (!t.slots) t.slots = {};
        for (let i = 1; i <= 8; i++) if (t.slots[i] === undefined) t.slots[i] = '';
        if (!Array.isArray(t.boardEarly)) t.boardEarly = [];
        if (!Array.isArray(t.boardLate)) t.boardLate = [];
        if (!t.slotModes || typeof t.slotModes !== 'object') t.slotModes = {};
        for (let s = 1; s <= 8; s++) { const k = 'card' + s; if (!t.slotModes[k]) t.slotModes[k] = 'loop'; }
        if (!t.slotModes['feed']) t.slotModes['feed'] = 'loop';
        if (!t.slotModes['shovel']) t.slotModes['shovel'] = 'loop';
        if (!t.waitAfter || typeof t.waitAfter !== 'object') t.waitAfter = {};
        // ---- boss 关独立配置 ----
        // ★ 旧作业集没有 boss* 字段 -> **保持 null**，boss 关只会等结算、不做种植。
        //   不自动从普通关拷贝（用户明确要求）。
        if (t.bossSlotModes === undefined) t.bossSlotModes = {};
        if (!Array.isArray(t.bossSlotOrder)) t.bossSlotOrder = null;
        if (!Array.isArray(t.bossLoopOrder)) t.bossLoopOrder = null;
        if (!Array.isArray(t.bossEndOrder)) t.bossEndOrder = null;
        if (!t.bossWaitAfter || typeof t.bossWaitAfter !== 'object') t.bossWaitAfter = {};
        // 收尾参数（缺省默认 15000 / 6000；仅普通关）
        if (typeof t.endPostDelay !== 'number') t.endPostDelay = 15000;
        if (typeof t.endLastPostDelay !== 'number') t.endLastPostDelay = 6000;
        if (t.endAfterAction !== 'restart') t.endAfterAction = 'sub';
        if (t.endSubAction !== 'once' && t.endSubAction !== 'end') t.endSubAction = 'loop';
        // 补给选取：数组（null/缺失都留空，由 jobSupplyList 填默认）
        if (!Array.isArray(t.supplyPicks)) t.supplyPicks = null;

        // ★ 编队切换：squad（1..6）是运行时读的权威字段。
        //   读回来时同步成编辑器的 lineupMode / deckNo，
        //   这样「换阵」下拉框和编队号输入框能正确显示。
        //   · squad 是合法 1..6 -> lineupMode='deck', deckNo=它
        //   · 否则                -> 'plants'，编队号给个默认 1（但不生效）
        const _sq = Number(t.squad);
        if (Number.isFinite(_sq) && _sq >= 1 && _sq <= 6) {
            t.lineupMode = 'deck';
            t.deckNo = _sq;
        } else {
            t.lineupMode = 'plants';
            if (!t.deckNo) t.deckNo = 1;
        }
        delete t.squad;   // 编辑器内部只留 lineupMode/deckNo，导出时再由 jobBuild 生成
        if (!t.innerWaits || typeof t.innerWaits !== 'object') t.innerWaits = { once: {}, loop: {}, end: {} };
        if (!t.innerWaits.once || typeof t.innerWaits.once !== 'object') t.innerWaits.once = {};
        if (!t.innerWaits.loop || typeof t.innerWaits.loop !== 'object') t.innerWaits.loop = {};
        if (!t.innerWaits.end || typeof t.innerWaits.end !== 'object') t.innerWaits.end = {};
        // 三条链的顺序（缺了会让链条顺序错乱 / 收尾链看起来是空的）
        if (!Array.isArray(t.slotOrder)) t.slotOrder = null;
        if (!Array.isArray(t.loopOrder)) t.loopOrder = null;
        if (!Array.isArray(t.endOrder)) t.endOrder = null;
        if (!Array.isArray(t.bossEndOrder)) t.bossEndOrder = null;
        // 棋盘落点补齐 mode/seq（旧数据没有这两个字段）
        ['boardEarly', 'boardLate'].forEach(function (bk) {
            (t[bk] || []).forEach(function (rowArr) {
                (rowArr || []).forEach(function (cellItems) {
                    (cellItems || []).forEach(function (it) {
                        if (it && typeof it.mode !== 'string') it.mode = 'loop';
                    });
                });
            });
        });
    });
    if (!jobTables.length) jobNewTable();
    jobRenumberTables();          // 载入后重算关卡区间，保证首尾相接
    currentTable = 0;
    const worlds = Array.isArray(job.worlds) ? job.worlds : [];
    document.querySelectorAll('#jobWorlds input').forEach(function (cb) { cb.checked = worlds.includes(cb.value); });
    jobLoadTable(0, true);
    jobRenderTabs();
    jobFillForm();
    jobRenderSlots();
    jobRenderSeqChains();
    jobSaveLocal();
}

// 删除当前选中的作业集
async function jobDelete() {
    const sel = document.getElementById('jobSelect');
    const msg = document.getElementById('jobStatus');
    const code = sel ? sel.value : '';
    if (!code) { window.alert('请先在下拉栏选择一个作业集'); return; }
    const label = jobMeta.name || code;
    if (!window.confirm('确定删除作业集「' + label + '」？\n此操作不可恢复。')) return;
    try {
        const res = await fetch('/delete_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code })
        });
        const data = await res.json();
        if (data.status !== 'success') {
            if (msg) { msg.textContent = '❌ ' + (data.msg || '删除失败'); msg.style.color = '#dc2626'; }
            return;
        }
        // 清空编辑器，避免还显示着已删除作业集的内容
        jobMeta.code = '';
        jobMeta.name = '';
        jobTables = [];
        jobNewTable();
        currentTable = 0;
        jobLoadTable(0, true);
        jobRenderTabs();
        jobRenderSlots();
        jobRenderSeqChains();
        jobClearLocal();
        await jobLoadList('');
        if (msg) { msg.textContent = '✅ 已删除「' + label + '」'; msg.style.color = '#22a65e'; }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 删除失败：' + e; msg.style.color = '#dc2626'; }
    }
}

// 下载远程作业集：提示输入代码 → 从 GitPages 取 → 载入棋盘
async function jobDownloadRemote() {
    const msg = document.getElementById('jobStatus');
    if (!JOB_REMOTE_BASE) {
        window.alert('远程作业集来源还没配置（JOB_REMOTE_BASE 为空）。\n等 GitPages 建好后把地址填上即可。');
        return;
    }
    const input = window.prompt('请输入远程作业集代码');
    if (input === null) return;
    const code = String(input).trim();
    if (!code) return;
    try {
        const url = JOB_REMOTE_BASE.replace(/\/+$/, '') + '/' + encodeURIComponent(code) + '.json';
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const job = await res.json();
        if (!job || !Array.isArray(job.tables)) throw new Error('内容不是有效的作业集');
        // 落地到本地 jobs/，这样「使用本地作业集」也能读到
        await fetch('/save_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({}, job, { code: code }))
        });
        jobApplyLoaded(job, code);
        await jobSetCurrent(code);
        await jobLoadList(code);
        if (msg) { msg.textContent = '✅ 已下载并载入「' + (jobMeta.name || code) + '」'; msg.style.color = '#22a65e'; }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 下载失败：' + e; msg.style.color = '#dc2626'; }
    }
}
