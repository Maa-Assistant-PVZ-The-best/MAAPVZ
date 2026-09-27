
// ============================================================
// 作业集本地缓存（刷新网页不丢配置）
// ============================================================
const JOBSET_LS_KEY = 'maapvz_jobset_v1';
let _jobSaveTimer = null;

function jobSaveLocal() {
    if (_jobSaveTimer) clearTimeout(_jobSaveTimer);
    _jobSaveTimer = setTimeout(function () {
        try {
            jobSyncForm();
            jobSaveCurrentBoard();
            const data = {
                meta: {
                    code: jobMeta.code || '',
                    name: jobMeta.name || '',
                    version: '1.0',
                    maxLevel: '149',
                    worlds: Array.from(document.querySelectorAll('#jobWorlds input:checked')).map(cb => cb.value)
                },
                currentTable: currentTable,
                tables: jobTables,
                rarityFilter: plantRarityFilter
            };
            localStorage.setItem(JOBSET_LS_KEY, JSON.stringify(data));
        } catch (e) { console.warn('[jobset] 本地保存失败', e); }
    }, 300);
}

function jobLoadLocal() {
    try {
        const raw = localStorage.getItem(JOBSET_LS_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.tables) || !data.tables.length) return false;
        jobTables = data.tables;
        jobTables.forEach(t => {
            if (!t.slots) t.slots = {};
            for (let i = 1; i <= 8; i++) if (t.slots[i] === undefined) t.slots[i] = '';
            if (!Array.isArray(t.boardEarly)) t.boardEarly = [];
            if (!Array.isArray(t.boardLate)) t.boardLate = [];
            if (!Array.isArray(t.slotOrder)) t.slotOrder = null;   // 旧数据：用默认槽号顺序
            if (!Array.isArray(t.loopOrder)) t.loopOrder = null;
            if (!t.slotModes || typeof t.slotModes !== 'object') t.slotModes = {};
            // 缺失的槽一律按默认「循环」
            for (let s = 1; s <= 8; s++) {
                const k = 'card' + s;
                if (!t.slotModes[k]) t.slotModes[k] = 'loop';
            }
            if (!t.slotModes['feed']) t.slotModes['feed'] = 'loop';
            if (!t.slotModes['shovel']) t.slotModes['shovel'] = 'loop';
            if (!t.waitAfter || typeof t.waitAfter !== 'object') t.waitAfter = {};
            // boss 关独立配置（旧缓存没有 -> 保持 null，boss 关只等结算）
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
            if (!Array.isArray(t.endOrder)) t.endOrder = null;
            if (!t.innerWaits || typeof t.innerWaits !== 'object') t.innerWaits = { once: {}, loop: {}, end: {} };
            if (!t.innerWaits.once || typeof t.innerWaits.once !== 'object') t.innerWaits.once = {};
            if (!t.innerWaits.loop || typeof t.innerWaits.loop !== 'object') t.innerWaits.loop = {};
            if (!t.innerWaits.end || typeof t.innerWaits.end !== 'object') t.innerWaits.end = {};
        });
        const m = data.meta || {};
        // 元信息只有「名字 + 代码」（代码/版本/最大关卡输入框已移除）
        jobMeta.name = m.name || '';
        jobMeta.code = m.code || '';
        // 识别结算速率（高级设置）；旧数据没有 -> 用默认 10
        jobMeta.everyN = (Number.isFinite(+m.everyN) && +m.everyN >= 1)
            ? Math.floor(+m.everyN) : JOB_EVERY_DEFAULT;
        if (Array.isArray(m.worlds)) {
            document.querySelectorAll('#jobWorlds input').forEach(cb => { cb.checked = m.worlds.includes(cb.value); });
        }
        if (typeof data.rarityFilter === 'string') plantRarityFilter = data.rarityFilter;
        currentTable = Math.min(Math.max(0, parseInt(data.currentTable) || 0), jobTables.length - 1);
        return true;
    } catch (e) { console.warn('[jobset] 本地恢复失败', e); return false; }
}

function jobClearLocal() {
    try { localStorage.removeItem(JOBSET_LS_KEY); } catch (e) {}
}


function jobInit() {
    // 世界复选框
    const wBox = document.getElementById('jobWorlds');
    wBox.innerHTML = '';
    JOB_WORLDS.forEach(w => {
        const lab = document.createElement('label');
        lab.style.cssText = 'font-size:12px;display:inline-flex;align-items:center;gap:3px;background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:2px 8px;cursor:pointer;';
        lab.innerHTML = `<input type="checkbox" value="${w}" style="width:14px;height:14px;margin:0;cursor:pointer;"> ${w}`;
        wBox.appendChild(lab);
    });

    // 优先恢复本地缓存（刷新网页不丢配置），否则新建一张表
    const restored = jobLoadLocal();
    if (!restored) jobNewTable();
    jobLoadTable(currentTable, true);   // skipSave：避免用空棋盘覆盖已恢复的数据
    jobLoadFavs();                      // 恢复右键收藏（localStorage）
    jobBindEndParams();                 // 收尾参数面板的输入监听
    jobRenderEndParams();               // 初始显隐（按当前棋盘是否有收尾落子）
    jobRenderSlots();
    // ⚠️ 必须带 catch：jobLoadPlants 内部是 fetch('/plants')，一旦失败 Promise 会静默 reject，
    //    .then 永不执行 → 槽位面板就一直是空的（不报错，只是没内容）。
    jobLoadPlants().then(function () {
        jobRenderSlots();                 // 头像需要 plantCache，加载完成后再渲染一次
        if (restored) jobRenderPlantGrid();
    }).catch(function (e) {
        console.warn('[jobset] 植物列表加载失败', e);
        jobRenderSlots();                 // 至少把槽位框架渲染出来（没有头像也要能选中/落子）
        setStatus('⚠️ 植物列表加载失败（仅缺头像）—— 请确认 Flask 在运行，然后 Ctrl+F5');
    });
    jobLoadList(jobMeta.code || '');    // 下拉栏与「恢复出来的配置」保持一致（不传 current，避免弹回旧作业集）
    if (restored) setStatus('已恢复上次编辑的配置（本地缓存）');

    // 事件绑定：新建阵容 → 先问「转阵容关卡」，再建
    document.getElementById('jobAddTable').addEventListener('click', function () {
        const last = jobTables[jobTables.length - 1];
        if (last) jobSaveCurrentBoard();
        // 提示输入「转阵容关」——这就是新阵容的起点 = 上一阵容的终点
        const curTo = Number(last && last.to_level) || JOB_MAX_LEVEL;
        const tip = (jobTables.length + 1) + '：请输入转阵容关卡\n'
                  + '（关卡 1~? 用阵容1，?~149 用阵容' + (jobTables.length + 1) + '）';
        const ans = window.prompt(tip, String(Math.min(JOB_MAX_LEVEL, curTo)));
        if (ans === null) return;                       // 取消 → 不新建
        let b = parseInt(ans);
        // ★ 新区间的起点必须**严格大于**上一阵容的起始关，
        //   否则会输入一个落在前面阵容区间里的数，导致区间重叠/冲突。
        //   lo = 上一阵容的起始关 + 1（不是「上一阵容结束关 + 1」，
        //   因为「上一阵容结束关」正是这次要设置的那个数）。
        const prevRange = jobRangeOfTable(jobTables.length - 1);
        const lo = prevRange.from + 1;
        if (!(b > 0)) {
            alert('请输入合法关卡数字');
            return;
        }
        if (b < lo) {
            alert('转阵容关必须大于 ' + prevRange.from + '（阵容' + jobTables.length
                + ' 占用了 ' + prevRange.from + ' ~ ' + prevRange.to + '）。\n'
                + '请输入 ' + lo + ' ~ ' + JOB_MAX_LEVEL + ' 之间的数。');
            return;
        }
        if (b > JOB_MAX_LEVEL) {
            alert('转阵容关不能超过最大关卡 ' + JOB_MAX_LEVEL);
            return;
        }

        // 上一阵容的结束关 = 新阵容的起始关 = b
        if (last) last.to_level = String(b);
        // ★ 关键：新建之前必须先把「当前正在编辑的棋盘」存回它所属的表。
        //   否则 jobLoadTable 会用新表的空棋盘覆盖全局 boardEarly，
        //   上一个阵容的布阵数据就永久丢了（踩过的坑）。
        jobSaveCurrentBoard();
        const nt = jobNewTable();
        nt.from_level = b;
        nt.to_level = '';                               // 新阵容默认到最大关卡
        jobRenumberTables();
        jobLoadTable(jobTables.length - 1);
        jobRenderTabs();
        jobFillForm();
        jobSaveLocal();
        setStatus('✅ 已新建阵容' + jobTables.length + '：' + b + ' ~ 149');
    });

    document.getElementById('jobDelTable').addEventListener('click', () => {
        if (jobTables.length <= 1) { alert('至少保留一个阵容'); return; }
        if (!confirm('删除当前阵容？')) return;

        // ★ 关键：删之前必须先把「当前正在编辑的棋盘」存回它所属的表。
        //   否则 splice 之后 currentTable 变了，jobLoadTable 内部的
        //   jobSaveCurrentBoard() 会把旧棋盘写进**另一张表**，
        //   把那边的布阵覆盖掉（踩过的坑：删阵容1 毁掉阵容2）。
        jobSaveCurrentBoard();

        jobTables.splice(currentTable, 1);
        currentTable = Math.min(currentTable, jobTables.length - 1);
        jobRenumberTables();          // ★ 删表后重接关卡链条
        // currentTable 已指向正确的表，且棋盘刚刚存过，用 skipSave 避免再存一次
        jobLoadTable(currentTable, true);
        jobRenderTabs();
        jobFillForm();
        jobSaveLocal();
        setStatus('🗑 已删除阵容，剩余 ' + jobTables.length + ' 个');
    });

    // ============ 补给选取（boss 关专属）============
    const spToggle = document.getElementById('supplyToggle');
    if (spToggle) {
        // 点「补给选取」直接弹窗（与「可选补给项」同一个窗）
        spToggle.addEventListener('click', function () { jobOpenSupplyPicker(); });
    }
    // 弹窗：关闭 / 完成 / 点遮罩关闭 / Esc 关闭
    const spClose = document.getElementById('supplyPickerClose');
    if (spClose) spClose.addEventListener('click', jobCloseSupplyPicker);
    const spDone = document.getElementById('supplyPickerDone');
    if (spDone) spDone.addEventListener('click', jobCloseSupplyPicker);
    const spModal = document.getElementById('supplyPicker');
    if (spModal) {
        spModal.addEventListener('click', function (e) {
            if (e.target === spModal) jobCloseSupplyPicker();   // 点遮罩关闭
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseSupplyPicker();
    });

    // ============ 取消格内项目（多选）弹窗 ============
    const ccClose = document.getElementById('ccClose');
    if (ccClose) ccClose.addEventListener('click', jobCloseCancelPicker);
    const ccOk = document.getElementById('ccOk');
    if (ccOk) ccOk.addEventListener('click', jobConfirmCancelPicker);
    const ccModal = document.getElementById('cellCancelPicker');
    if (ccModal) {
        ccModal.addEventListener('click', function (e) {
            if (e.target === ccModal) jobCloseCancelPicker();
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseCancelPicker();
    });
    const spReset = document.getElementById('supplyReset');
    if (spReset) {
        spReset.addEventListener('click', function () {
            const t = jobTables[currentTable];
            if (!t) return;
            if (!window.confirm('恢复默认补给顺序？当前设置会丢失。')) return;
            t.supplyPicks = SUPPLY_DEFAULTS.slice(0, 5).map(function (d) {
                return { id: d.id, name: d.name, img: d.img };
            });
            jobSaveLocal();
            jobRenderSupply();
            setStatus('↺ 已恢复默认补给顺序');
        });
    }
    jobSyncSupplyVisibility();

    // 高级设置（识别结算速率）
    jobBindAdv();

    // 「转阵容关」输入框：改一个数，两边同步（像关键帧）
    const bdEl = document.getElementById('tfBoundary');
    if (bdEl) {
        bdEl.addEventListener('change', function () { jobSetBoundary(this.value); });
        bdEl.addEventListener('input', function () { /* 打字中不校验，避免打断输入 */ });
    }
    ['tfLineupMode','tfDeckNo'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', jobSyncForm);
        el.addEventListener('change', jobSyncForm);
    });
    document.getElementById('tfLineupMode').addEventListener('change', () => {
        document.getElementById('tfDeckBox').style.display = document.getElementById('tfLineupMode').value === 'deck' ? 'inline-flex' : 'none';
    });
    const _jp = document.getElementById('jobsetPanel');
    if (_jp) {
        // 注意：#jobSelect 也在这个面板里，它的 change 会冒泡到这里。
        // 若不过滤，「切换作业集」会先触发 jobSaveLocal → 把当前(?旧)棋盘写回 → 覆盖刚载入的数据。
        const _panelGuard = function (e) {
            const t = e.target;
            if (t && (t.id === 'jobSelect' || t.id === 'jobSaveBtn' || t.id === 'jobDeleteBtn' || t.id === 'jobDownloadBtn' || t.id === 'jobRefreshBtn')) return;
            jobSaveLocal();
        };
        _jp.addEventListener('input', _panelGuard);
        _jp.addEventListener('change', _panelGuard);
    }
    document.getElementById('jobSaveBtn').addEventListener('click', jobSave);
    const _sel = document.getElementById('jobSelect');
    if (_sel) _sel.addEventListener('change', jobOnSelect);
    const _del = document.getElementById('jobDeleteBtn');
    if (_del) _del.addEventListener('click', jobDelete);
    const _dl = document.getElementById('jobDownloadBtn');
    if (_dl) _dl.addEventListener('click', jobDownloadRemote);
    const _rf = document.getElementById('jobRefreshBtn');
    if (_rf) _rf.addEventListener('click', function () { jobLoadList(); });
    jobLoadList();        // 载入本地作业集列表到下拉栏
    jobInitSeqDrawer();   // 右侧「种植顺序」抽屉
    jobRenderSeqChains();
    document.getElementById('plantPickerClose').addEventListener('click', jobClosePicker);
    document.getElementById('plantSearch').addEventListener('input', jobRenderPlantGrid);
    document.getElementById('plantPicker').addEventListener('click', (e) => {
        if (e.target === document.getElementById('plantPicker')) jobClosePicker();
    });
    document.addEventListener('keydown', (e) => {
        const picker = document.getElementById('plantPicker');
        if (!picker || picker.style.display === 'none') return;
        if (e.key === 'Escape') { jobClosePicker(); return; }
        // 在搜索框里打字时不抢按键
        const inSearch = e.target && e.target.id === 'plantSearch';
        if (e.key === 'Enter') { e.preventDefault(); jobConfirmPick(); return; }
        if (inSearch) return;
        const k = (e.key || '').toLowerCase();
        if (k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); jobMovePick(-1); }
        else if (k === 's' || e.key === 'ArrowDown') { e.preventDefault(); jobMovePick(1); }
        else if (k === 'a' || e.key === 'ArrowLeft') { e.preventDefault(); jobMovePick(-5); }
        else if (k === 'd' || e.key === 'ArrowRight') { e.preventDefault(); jobMovePick(5); }
    });
}
