
// ============================================================
// 作业集下拉栏：列出本地作业集 / 载入某个作业集 / 下载远程作业集
// ============================================================

// ⚠️ 远程作业集来源（GitPages）。留空 = 未配置，点下载会提示。
const JOB_REMOTE_BASE = '';

// ★ 作业集列表缓存：选择弹窗（#jobPickModal）从这份缓存渲染
let _jobListCache = [];

// 同步「📂 选择作业集」按钮上的文字（与隐藏的 #jobSelect 选中项一致）
function jobSyncPickLabel() {
    const sel = document.getElementById('jobSelect');
    const lab = document.getElementById('jobPickLabel');
    if (!sel || !lab) return;
    const op = sel.options[sel.selectedIndex];
    lab.textContent = (sel.value && op) ? op.textContent.replace(' ★当前', '') : '— 请选择 —';
}

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
        _jobListCache = jobs;
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
        jobSyncPickLabel();
    } catch (e) {
        console.warn('[jobset] 读取作业集列表失败', e);
    }
}

// ============================================================
// 作业集选择弹窗（#jobPickModal，替代原下拉栏）
//   列表 = 空白模板（永远在最上面）+ 本地作业集（从 /list_jobs 缓存渲染）。
//   选中后写回隐藏的 #jobSelect 再走 jobOnSelect（原有载入/清空逻辑不动）。
// ============================================================
function jobOpenJobPicker() {
    const modal = document.getElementById('jobPickModal');
    if (!modal) return;
    jobRenderJobPicker();
    modal.classList.add('jp-open');
    // 每次打开都重新拉一遍列表（别的窗口可能刚保存/删过）
    jobLoadList().then(jobRenderJobPicker);
}

function jobCloseJobPicker() {
    const modal = document.getElementById('jobPickModal');
    if (modal) modal.classList.remove('jp-open');
}

function jobRenderJobPicker() {
    const body = document.getElementById('jpBody');
    if (!body) return;
    body.innerHTML = '';
    const sel = document.getElementById('jobSelect');
    const curCode = sel ? sel.value : '';

    const pick = function (code) {
        if (sel) sel.value = code;
        jobCloseJobPicker();
        jobOnSelect();      // code='' 走「清空编辑器」，非空走「载入」
    };

    // ★ 空白模板：永远在最上面
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'jp-item jp-blank' + (curCode ? '' : ' jp-item-on');
    blank.innerHTML = '<span class="jp-item-ico">✨</span><span>'
        + '<div class="jp-item-name">空白模板</div>'
        + '<div class="jp-item-code">从零开始（清空当前编辑器）</div></span>'
        + (curCode ? '' : '<span class="jp-item-cur">当前</span>');
    blank.addEventListener('click', function () { pick(''); });
    body.appendChild(blank);

    // 本地作业集
    (_jobListCache || []).forEach(function (j) {
        const item = document.createElement('button');
        item.type = 'button';
        const on = (j.code === curCode);
        item.className = 'jp-item' + (on ? ' jp-item-on' : '');
        item.innerHTML = '<span class="jp-item-ico">📚</span><span>'
            + '<div class="jp-item-name">' + (j.name || j.code) + '</div>'
            + '<div class="jp-item-code">' + j.code + '</div></span>'
            + (on ? '<span class="jp-item-cur">当前</span>' : '');
        item.addEventListener('click', function () { pick(j.code); });
        body.appendChild(item);
    });

    if (!(_jobListCache || []).length) {
        const empty = document.createElement('div');
        empty.className = 'jp-empty';
        empty.textContent = '（本地还没有作业集 —— 配好后点「💾 保存此作业集」）';
        body.appendChild(empty);
    }
}

// ★ 导出当前显示的作业集：浏览器直接下载 JSON（导出的是编辑器里的最新状态，
//   不依赖有没有保存过 —— 走 jobBuild() 现算）。
function jobExportJobset() {
    const msg = document.getElementById('jobStatus');
    let data;
    try {
        data = jobBuild();
    } catch (e) {
        if (msg) { msg.textContent = '❌ 导出失败：' + e; msg.style.color = '#dc2626'; }
        return;
    }
    const fname = (jobMeta.name || jobMeta.code || '作业集').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    if (msg) { msg.textContent = '📤 已导出「' + fname + '」'; msg.style.color = '#22a65e'; }
}

// ★ 导入作业集：读 JSON 文件 -> 装进编辑器（不自动保存，看完满意再点💾）
function jobImportJobset(file) {
    const msg = document.getElementById('jobStatus');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
        try {
            const job = JSON.parse(String(reader.result || ''));
            if (!job || typeof job !== 'object' || !Array.isArray(job.tables) || !job.tables.length) {
                throw new Error('不是有效的作业集文件（缺 tables）');
            }
            // 先整体清空再装载（与载入本地作业集同一口径，避免字段残留）
            jobResetEditor(true);
            jobApplyLoaded(job, job.code || '');
            jobSyncPickLabel();
            jobCloseJobPicker();
            if (msg) {
                msg.textContent = '📥 已导入「' + (jobMeta.name || jobMeta.code || file.name) + '」（未保存，确认后点💾）';
                msg.style.color = '#d97706';
            }
        } catch (e) {
            if (msg) { msg.textContent = '❌ 导入失败：' + e.message; msg.style.color = '#dc2626'; }
        }
    };
    reader.onerror = function () {
        if (msg) { msg.textContent = '❌ 读文件失败'; msg.style.color = '#dc2626'; }
    };
    reader.readAsText(file, 'utf-8');
}

function jobBindJobPicker() {
    const modal = document.getElementById('jobPickModal');
    if (!modal) return;
    const open = document.getElementById('jobPickBtn');
    if (open) open.addEventListener('click', jobOpenJobPicker);
    const close = document.getElementById('jpClose');
    if (close) close.addEventListener('click', jobCloseJobPicker);
    // 底部：导出当前 / 导入文件
    const exp = document.getElementById('jpExport');
    if (exp) exp.addEventListener('click', jobExportJobset);
    const impBtn = document.getElementById('jpImport');
    const impFile = document.getElementById('jpImportFile');
    if (impBtn && impFile) {
        impBtn.addEventListener('click', function () { impFile.click(); });
        impFile.addEventListener('change', function () {
            const f = this.files && this.files[0];
            this.value = '';                 // 允许重复选同一个文件
            jobImportJobset(f);
        });
    }
    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseJobPicker();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('jp-open')) jobCloseJobPicker();
    });
}

// 选中下拉项 → 载入该作业集到棋盘，并设为当前（供 Endless_ref.json 使用）
// 选中「— 请选择 —」（空值）→ 清空编辑器，避免上一个作业集残留在场上
async function jobOnSelect() {
    const sel = document.getElementById('jobSelect');
    const code = sel ? sel.value : '';
    const msg = document.getElementById('jobStatus');

    if (!code) {                       // ★ 切到「空白模板」= 清空所有设置
        jobResetEditor();
        await jobSetCurrent('');
        jobSyncPickLabel();
        if (msg) { msg.textContent = '已清空（空白模板）'; msg.style.color = '#94a3b8'; }
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
    jobNewTable();                     // 建一张干净的空白表（默认覆盖 1-149）

    // 局外选卡（作业集级）一并清空
    if (typeof jobOuterPick !== 'undefined') {
        jobOuterPick.plants = [];
        jobOuterPick.order = [];
        jobOuterPick.mode = 'auto';
        if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
    }

    // 世界复选框全不勾
    document.querySelectorAll('#jobWorlds input').forEach(function (cb) { cb.checked = false; });
    // 阵容表表单恢复默认
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    set('tfLineupMode', 'plants'); set('tfDeckNo', '1');

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
    // 作业集级参数：识别速率 / 调配参数（缺省回落默认值）
    jobMeta.everyN = (Number.isFinite(+job.everyN) && +job.everyN >= 1)
        ? Math.floor(+job.everyN) : JOB_EVERY_DEFAULT;
    jobMeta.swipeMs = (Number.isFinite(+job.swipeMs) && +job.swipeMs >= 10)
        ? Math.floor(+job.swipeMs) : 80;
    jobTables = Array.isArray(job.tables) ? job.tables : [];
    jobTables.forEach(function (t) {
        if (!t.slots) t.slots = {};
        for (let i = 1; i <= 8; i++) if (t.slots[i] === undefined) t.slots[i] = '';
        if (!Array.isArray(t.boardEarly)) t.boardEarly = [];
        if (!Array.isArray(t.boardLate)) t.boardLate = [];
        if (!t.slotModes || typeof t.slotModes !== 'object') t.slotModes = {};
        for (let s = 1; s <= 8; s++) { const k = 'card' + s; if (!t.slotModes[k]) t.slotModes[k] = 'loop'; }
        // ★ 落子动作（喂豆/铲子/点击格子/未来扩展）由注册表驱动补默认值
        if (typeof JOB_BOARD_ACTIONS !== 'undefined') {
            JOB_BOARD_ACTIONS.forEach(function (act) {
                if (act && act.id && !t.slotModes[act.id]) t.slotModes[act.id] = 'loop';
            });
        } else {
            if (!t.slotModes['feed']) t.slotModes['feed'] = 'loop';
            if (!t.slotModes['shovel']) t.slotModes['shovel'] = 'loop';
        }
        if (!t.waitAfter || typeof t.waitAfter !== 'object') t.waitAfter = {};
        // ---- boss 关独立配置 ----
        // ★ 旧作业集没有 boss* 字段 -> **保持 null**，boss 关只会等结算、不做种植。
        //   不自动从普通关拷贝（用户明确要求）。
        // ★ bossEndOrder 已从导出中移除（boss 关永不执行收尾链），
        //   旧文件里残留的该字段会被无视。
        if (t.bossSlotModes === undefined) t.bossSlotModes = {};
        if (!Array.isArray(t.bossSlotOrder)) t.bossSlotOrder = null;
        if (!Array.isArray(t.bossLoopOrder)) t.bossLoopOrder = null;
        if (!t.bossWaitAfter || typeof t.bossWaitAfter !== 'object') t.bossWaitAfter = {};
        // 收尾参数（仅普通关；endLastPostDelay 已删除，等待结算改用节点 timeout）
        if (t.endType !== 'loops') t.endType = 'detect';
        if (typeof t.endPostDelay !== 'number') t.endPostDelay = 15000;
        if (!(typeof t.endLoopCount === 'number' && t.endLoopCount >= 1)) t.endLoopCount = 3;
        if (t.endAfterAction !== 'restart' && t.endAfterAction !== 'settle') t.endAfterAction = 'sub';
        if (typeof t.endSettleMs !== 'number') t.endSettleMs = 15000;
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

        // ---- boss 关阵容（boss_lineup 是运行时有效值；编辑器状态字段优先）----
        //   bossLineupMode: '' = 沿用普通关 | 'plants' | 'deck'
        //   bossSlots: boss 关槽位覆盖层，三态 —— key 不存在=沿用 / null=已删除 / 字符串=覆盖
        //   旧作业集没有这些字段 -> '' + {} = boss 完全沿用普通关（行为与旧版一致）
        const _rawBossMode = (t.bossLineupMode === 'plants' || t.bossLineupMode === 'deck') ? t.bossLineupMode : '';
        const _bsq = Number(t.boss_squad);
        const _bsqValid = Number.isFinite(_bsq) && _bsq >= 1 && _bsq <= 6;
        // 手写 JSON 只给了 boss_squad 没给 bossLineupMode -> 反推为 deck
        t.bossLineupMode = _rawBossMode || (_bsqValid ? 'deck' : '');
        if (t.bossLineupMode === 'deck' && _bsqValid) {
            t.bossDeckNo = _bsq;
        } else if (!t.bossDeckNo || !Number.isFinite(Number(t.bossDeckNo))) {
            t.bossDeckNo = 1;
        }
        delete t.boss_squad;
        if (!t.bossSlots || typeof t.bossSlots !== 'object') t.bossSlots = {};
        // 编辑器状态缺失但 boss_lineup 带选卡植物（比如手写的 JSON）-> 反推覆盖层
        //   ★ 「空」的判定：null（已删除标记）也算有内容，不能被反推覆盖掉；
        //     只有 undefined / ''（旧数据）才算空。
        const _bsHasContent = Object.keys(t.bossSlots).some(function (k) {
            const v = t.bossSlots[k];
            return v !== undefined && v !== '';
        });
        if (t.bossLineupMode === 'plants'
                && !_bsHasContent
                && t.boss_lineup && Array.isArray(t.boss_lineup.plants) && t.boss_lineup.plants.length) {
            t.boss_lineup.plants.forEach(function (n, i) {
                if (n && (t.slots[i + 1] || '') !== n) t.bossSlots[i + 1] = n;
            });
        }
        delete t.boss_lineup;   // 导出时由 jobBuild 重新生成有效值
        // 神器占位（暂无 UI；读回来只是为了保存/导出时不丢）
        if (t.artifact === undefined) t.artifact = null;
        if (t.bossArtifact === undefined) t.bossArtifact = null;
        if (t.artifactBody === undefined) t.artifactBody = null;   // 特殊类体型（葫芦 small/mid/big）
        // （innerWaits 已移除：从未有过消费者，纯遗留字段）
        // 三条链的顺序（缺了会让链条顺序错乱 / 收尾链看起来是空的）
        if (!Array.isArray(t.slotOrder)) t.slotOrder = null;
        if (!Array.isArray(t.loopOrder)) t.loopOrder = null;
        if (!Array.isArray(t.endOrder)) t.endOrder = null;
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

        // ---- ★ 关卡覆盖迁移 ----
        //   有 levels（物化结果）-> 直接当 picks 用（相位/区间/排除都已被它吸收）；
        //   旧作业集（无 levels）：把 from_level/to_level 区间（旧语义：上半开区间）
        //   折成 [from, to-1] 物化成 picks，行为与旧版逐关等价。
        if (typeof t.label !== 'string') t.label = '';
        if (Array.isArray(t.levels)) {
            t.cover = { picks: t.levels.slice() };
        } else {
            const a = Math.max(1, Math.min(149, Number(t.from_level) || 1));
            const b = (t.to_level === '' || t.to_level === null || t.to_level === undefined)
                ? 149
                : Math.max(a, Math.min(149, Number(t.to_level) - 1));
            t.cover = { picks: [] };
            for (let i = a; i <= b; i++) t.cover.picks.push(i);
        }
        jobNormalizeCover(t);
    });
    if (!jobTables.length) jobNewTable();
    currentTable = 0;
    const worlds = Array.isArray(job.worlds) ? job.worlds : [];
    document.querySelectorAll('#jobWorlds input').forEach(function (cb) { cb.checked = worlds.includes(cb.value); });
    // 局外选卡（作业集级）：旧作业集没有该字段 -> 空列表 + auto；
    // mode 为 oneclick/confirm 时 JSON 本就不存 plants，读进来也置空
    const _op = (job.outer_pick && typeof job.outer_pick === 'object') ? job.outer_pick : {};
    const _opm = (['auto', 'oneclick', 'confirm'].indexOf(_op.mode) !== -1) ? _op.mode : 'auto';
    jobOuterPick.mode = _opm;
    jobOuterPick.plants = (_opm === 'auto' && Array.isArray(_op.plants))
        ? _op.plants.filter(function (x) { return typeof x === 'string' && x; }) : [];
    jobOuterPick.order = (_opm === 'auto' && Array.isArray(_op.order))
        ? _op.order.filter(function (x) { return typeof x === 'string' && x; }) : [];
    jobOuterRefreshBadge();
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
        // 局外选卡（作业集级）一并清空
        if (typeof jobOuterPick !== 'undefined') {
            jobOuterPick.plants = [];
            jobOuterPick.mode = 'auto';
            if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
        }
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
