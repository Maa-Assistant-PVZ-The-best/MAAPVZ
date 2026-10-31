// 27e-jobset-hotkeys.js —— 原 27-jobset-board.js 第 2955~3516 行：落子动作更多列表 + 快捷键 + 键盘闸口 + 植物选择器
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。

let jobBoardMoreBound = false;

function jobBindBoardMore() {
    if (jobBoardMoreBound) return;
    const modal = document.getElementById('boardMoreList');
    if (!modal) return;

    const close = document.getElementById('bmlClose');
    if (close) close.addEventListener('click', jobCloseBoardMoreList);

    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseBoardMoreList();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseBoardMoreList();
    });

    jobBoardMoreBound = true;
}

// 切换选中的槽位：dir = +1 下一个（S），-1 上一个（W）
//
//   ★ 循环列表每次现算（jobSlotCycleList），所以「棋盘上有没有落子」
//     的变化立刻生效 —— 扩展动作没落在棋盘上时**不会被循环到**。
function jobCycleSlot(dir) {
    const t = jobTables[currentTable];
    if (!t) return;

    const list = jobSlotCycleList(jobArmedSlot);
    const n = list.length;
    if (!n) return;

    let i = list.indexOf(jobArmedSlot);
    // 当前没选中（0）时给一个合理起点：
    //   按 S（下一个）→ 从槽1 开始；按 W（上一个）→ 从列表末位 开始
    if (i === -1) i = (dir > 0) ? -1 : 0;

    const next = list[((i + dir) % n + n) % n];
    jobArmedSlot = next;
    jobRenderSlots();

    const st = document.getElementById('jobStatus');
    if (st) {
        st.textContent = '已选中 ' + jobSlotDisplayName(t, next)
            + '　|　点击棋盘格子落子　|　F 切换形态：'
            + jobModeLabel(jobSlotMode(t, jobSlotKeyOfArmed(next)));
    }
}

// 切换当前选中槽位的形态（= 右键那个功能）
function jobCycleSlotOrChain() {
    const t = jobTables[currentTable];
    if (!t) return;

    if (!jobArmedSlot) {
        setStatus('先用 W / S 选一个槽位，再按 F 切换形态');
        return;
    }

    const key = jobSlotKeyOfArmed(jobArmedSlot);
    const m = jobToggleSlotMode(t, key);
    jobRenderSlots();
    jobRenderSeqChains();
    jobSaveLocal();

    const extra = jobIsBossBoard() ? '（boss 关没有收尾）' : '';
    setStatus('🔄 ' + jobSlotDisplayName(t, jobArmedSlot) + ' → ' + jobModeLabel(m) + extra);
}

// 判断事件是否发生在可输入元素里（那里不能抢键）
function jobIsTypingTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
}

// ★ 有没有「一层弹窗」开着（2026-10-30 抽出公共判据）
//   以前这份清单只写在 jobInstallSlotHotkeys 里，别的键盘处理（04-cards 的
//   Ctrl+Z 等）各写各的、大半没写 —— 于是在「布局配置」里按 Ctrl+Z 会
//   **同时**撤销布局和主棋盘。现在统一走这里。
//   ★ 新增弹窗时只改这一处（弹窗根元素 id + 打开时挂的 class，逐个核对过）
const JOB_MODAL_SELECTORS = [
    '#plantPicker.job-open',          // 植物选择器（27）
    '#supplyPicker.sp-open',          // 补给选取（26）
    '#genPicker.gp-open',             // 通用动作：选目标链（30）
    '#moreList.ml-open',              // 通用动作：一级「更多」列表（30）
    '#morePicker.mp-open',            // 通用动作：二级动作选择（30）
    '#customPicker.cp-open',          // 自定义动作（33）
    '#stepCfgModal.sc-open',          // 步骤设置（27）
    '#cellCancelPicker.cc-open',      // 取消格内项目（27）
    '#cellQueueModal.cq-open',        // 格内落子顺序方块窗（43）
    '#boardMoreList.bml-open',        // 落子动作「更多」（27）
    '#jobPickModal.jp-open',          // 作业集选择（28）
    '#tableCopyModal.jp-open',        // 复制阵容（21）
    '#plantDeleteModal.jp-open',      // 删除植物二选一（42）
    '#jobAdvModal.ja-open',           // 高级设置（31）
    '#mSlotSheet.m-open',             // 手机：槽位长按「替换 / 删除」动作单（44）
    '#mHelpSheet.m-open',             // 手机：操作速查 + 诊断信息（44）
    '#layoutModal.lz-open',           // 布局配置（34）
    '#lzFormulaModal.lz-open',        // 布局配置：指定覆盖公式（34）
    '#artifactPicker.artp-open',      // 神器选择（35）
    '#worldPicker.sp-open',           // 选择世界（37）
    '#notesPicker.sp-open',           // 植物/神器备注（38）
    '#refPicker.sp-open',             // 对照（39）
    '#tagPicker.sp-open'              // 标签（41）
];

function jobAnyModalOpen() {
    for (let i = 0; i < JOB_MODAL_SELECTORS.length; i++) {
        try {
            if (document.querySelector(JOB_MODAL_SELECTORS[i])) return true;
        } catch (e) { }
    }
    // 局外选卡弹窗是内联 display 控制的（没有 class），单独判
    try {
        const op = document.getElementById('outerPicker');
        if (op && op.style && op.style.display && op.style.display !== 'none') return true;
    } catch (e) { }
    return false;
}

// 全局快捷键的统一闸口：打字中 / 弹窗开着 -> 一律不抢键
function jobHotkeyBlocked(e) {
    if (e && jobIsTypingTarget(e.target)) return true;
    return jobAnyModalOpen();
}

function jobInstallSlotHotkeys() {
    document.addEventListener('keydown', function (e) {
        // 带修饰键的不抢（Ctrl+F 之类留给浏览器）
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // 打字中 / 有弹层打开时 -> 不响应（统一判据，见 jobHotkeyBlocked）
        if (jobHotkeyBlocked(e)) return;

        const k = String(e.key || '').toLowerCase();
        if (k === 'w') { e.preventDefault(); jobCycleSlot(-1); }
        else if (k === 's') { e.preventDefault(); jobCycleSlot(1); }
        else if (k === 'f') { e.preventDefault(); jobCycleSlotOrChain(); }
        // Q/E 循环切换阵容表（上面的守卫已挡掉输入框/弹层场景）
        else if (k === 'q') { e.preventDefault(); jobCycleTable(-1); }
        else if (k === 'e') { e.preventDefault(); jobCycleTable(1); }
    });
}

// ---- 植物选择器 ----
async function jobLoadPlants() {
    if (plantCache) return plantCache;
    try {
        const res = await fetch('/plants');
        const data = await res.json();
        plantCache = Array.isArray(data.plants) ? data.plants : [];
    } catch (e) {
        plantCache = [];
    }
    return plantCache;
}

// ---- 植物图片资源可用性（字段由后端 /plants 扫 plant_ref_card 实况注入）----
//   p.has_img: bool                        p.super: 'none' | 'missing' | 'collected'
//   p.super_count: 超装资源个数（皮肤夹 png 数 - 1，第 1 张是基础卡）
// 字段缺失（旧缓存 / 接口异常）时当作「有图」，避免误伤全部植物。
function jobPlantAvail(p) {
    if (!p || p.has_img === undefined || p.has_img === null) return { hasImg: true, sup: 'none', supCount: 0 };
    // super_count 是后加的字段，旧缓存没有 -> collected 至少算 1 个
    const cnt = (typeof p.super_count === 'number') ? p.super_count
        : (p.super === 'collected' ? 1 : 0);
    return { hasImg: !!p.has_img, sup: p.super || 'none', supCount: cnt };
}

// 选择器卡片的悬停提示（走 02-tooltip.js 的 data-tooltip，1 秒延迟，支持多行）
function jobPlantCardTip(p, dupSlot, selSlot) {
    const av = jobPlantAvail(p);
    const lines = [];
    if (dupSlot) {
        lines.push(p.name + '（已被 槽' + dupSlot + ' 使用，不能重复选择）');
    } else if (selSlot) {
        // 正在编辑的槽自己选中的植物（可重选，等于不换）
        lines.push(p.name + '（当前 槽' + selSlot + ' 已选）');
    } else {
        lines.push(p.name + '（' + (p.rarity || '?') + '卡）');
    }
    if (!av.hasImg) lines.push('⛔ 没有这个植物的图片资源');
    else if (av.sup === 'collected') lines.push('✅ 有 ' + av.supCount + ' 个超装资源');
    else if (av.sup === 'missing') lines.push('⚠️ 该植物有超装但未收集（皮肤夹里只有基础卡）');
    else lines.push('（该植物无超装）');
    lines.push('右键' + (jobIsFav(p) ? '取消收藏' : '收藏'));
    return lines.join('\n');
}

function jobOpenPicker(slot) {
    currentSlotEditing = slot;
    const modal = document.getElementById('plantPicker');
    document.getElementById('plantSearch').value = '';
    plantPickIndex = 0;
    // 每次打开都重置「替换指定表」：清掉上次的目标 + boss 追问，
    // 并把「正在编辑」这一处重新默认勾上（42-jobset-batch.js）
    if (typeof jobResetReplaceSel === 'function') { try { jobResetReplaceSel(); } catch (e) { } }
    jobRenderRarityFilter();
    jobRenderPlantGrid();
    // 入场动画：先加类再显示（重排一次确保动画重新触发）
    modal.classList.remove('job-open');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('job-open');
}

function jobClosePicker() {
    const modal = document.getElementById('plantPicker');
    modal.classList.remove('job-open');
    modal.style.display = 'none';
    jobHideCellDetail();
}

// ---- 卡槽品质过滤（rare_0=白 1=绿 2=蓝 3=紫 4=橙）----
const PLANT_RARITY_TABS = ['全部', '收藏', '橙', '紫', '蓝', '绿', '白'];
const RARITY_TO_RARE = { '橙': 4, '紫': 3, '蓝': 2, '绿': 1, '白': 0 };
let plantRarityFilter = '全部';
let plantPickList = [];     // 当前筛选后的植物列表（供 W/S 切换）
let plantPickIndex = 0;    // 当前高亮项
let plantPickAvailable = [];   // 当前可选项索引（排除已被其它槽位占用的植物）

// ---- 右键收藏（存 localStorage，刷新不丢）----
const PLANT_FAV_KEY = 'maapvz_plant_favs_v1';
let plantFavs = new Set();

function jobLoadFavs() {
    try {
        const raw = localStorage.getItem(PLANT_FAV_KEY);
        if (raw) plantFavs = new Set(JSON.parse(raw));
    } catch (e) { plantFavs = new Set(); }
}

function jobSaveFavs() {
    try { localStorage.setItem(PLANT_FAV_KEY, JSON.stringify(Array.from(plantFavs))); } catch (e) {}
}

// 以英文名为主键（中文名可能重名/改写），无英文名时退回中文名
function jobFavKey(p) { return p.en || p.name; }
function jobIsFav(p) { return plantFavs.has(jobFavKey(p)); }

function jobToggleFav(p) {
    const k = jobFavKey(p);
    const nowFav = !plantFavs.has(k);
    if (nowFav) plantFavs.add(k);
    else plantFavs.delete(k);
    jobSaveFavs();
    setStatus(nowFav ? ('♥ 已收藏「' + p.name + '」') : ('已取消收藏「' + p.name + '」'));
    // 只更新这一张卡的心形，不整页重渲染（避免闪一下 + 入场动画重播）
    jobRefreshFavMark(p, nowFav);
    return nowFav;
}

// 就地切换某张卡的收藏标记：不动其它 DOM，无闪烁
function jobRefreshFavMark(p, isFav) {
    const grid = document.getElementById('plantGrid');
    if (!grid) return;
    const idx = (plantPickList || []).indexOf(p);
    if (idx < 0) return;
    const card = grid.children[idx];
    if (!card) return;
    const frame = card.firstElementChild;
    if (!frame) return;
    const old = frame.querySelector('.job-fav-heart');
    if (isFav && !old) {
        frame.appendChild(jobBuildHeart());
    } else if (!isFav && old) {
        old.remove();
    }
    card.setAttribute('data-tooltip', jobPlantCardTip(p, 0));
}

// 卡槽下边框中央的心形（宽度约占卡片 1/4，压在下边框上）
function jobBuildHeart() {
    const heart = document.createElement('span');
    heart.className = 'job-fav-heart';
    heart.textContent = '♥';
    return heart;
}


function jobRenderRarityFilter() {
    const box = document.getElementById('plantRarityFilter');
    if (!box) return;
    box.innerHTML = '';
    PLANT_RARITY_TABS.forEach(r => {
        const el = document.createElement('span');
        const active = (plantRarityFilter === r);
        el.textContent = r;
        el.style.cssText = 'padding:2px 12px;border-radius:999px;font-size:12px;cursor:pointer;user-select:none;'
            + 'border:1px solid ' + (active ? '#2d7aff' : '#d0d7de') + ';'
            + 'background:' + (active ? '#2d7aff' : '#fff') + ';'
            + 'color:' + (active ? '#fff' : '#333') + ';';
        el.addEventListener('click', () => {
            plantRarityFilter = r;
            jobRenderRarityFilter();
            jobRenderPlantGrid();
        });
        box.appendChild(el);
    });
}

function jobMovePick(delta) {
    const pool = (plantPickAvailable && plantPickAvailable.length) ? plantPickAvailable : null;
    if (pool) {
        let pos = pool.indexOf(plantPickIndex);
        if (pos === -1) pos = 0;
        pos = ((pos + delta) % pool.length + pool.length) % pool.length;
        plantPickIndex = pool[pos];
    } else {
        if (!plantPickList || !plantPickList.length) return;
        plantPickIndex = (plantPickIndex + delta % plantPickList.length + plantPickList.length) % plantPickList.length;
    }
    jobRenderPlantGrid();
    const grid = document.getElementById('plantGrid');
    const el = grid && grid.children[plantPickIndex];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function jobSlotOfPlant(name, excludeSlot) {
    const t = jobTables[currentTable];
    if (!t || !name) return 0;
    // ★ 查重按当前语境（普通/boss）的有效槽位：boss 覆盖槽与普通槽是两份独立配置
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    for (let s = 1; s <= 8; s++) {
        if (s === excludeSlot) continue;
        const nm = (typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, s, _bossCtx) : t.slots[s];
        if (nm === name) return s;
    }
    return 0;
}

function jobConfirmPick() {
    const p = plantPickList && plantPickList[plantPickIndex];
    if (!p) return;
    // 无图植物禁选（键盘回车路径也走这里）
    if (!jobPlantAvail(p).hasImg) {
        setStatus('⛔「' + p.name + '」没有图片资源，无法选择');
        return;
    }
    const dup = jobSlotOfPlant(p.name, currentSlotEditing);
    if (dup) {
        setStatus('⚠️「' + p.name + '」已被 槽' + dup + ' 使用，同一植物不能重复选择');
        return;
    }
    const t = jobTables[currentTable];
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    // ★ 连续卡槽规则（2026-10-25，用户实测游戏机制）：卡条不允许中间空着一格
    //   （槽6 有植物、槽7 空、槽8 再选 = 非法）。点空槽时若左边还有空槽，
    //   自动落到第一个空槽 —— 和游戏内卡条的紧排行为一致；
    //   点已占用槽 = 换植物，不重定向。
    let targetSlot = currentSlotEditing;
    let redirected = false;
    if (t) {
        const effName = function (i) {
            return (typeof jobSlotNameCtx === 'function') ? (jobSlotNameCtx(t, i, _bossCtx) || '') : (t.slots[i] || '');
        };
        if (!effName(targetSlot)) {
            for (let i = 1; i < targetSlot; i++) {
                if (!effName(i)) { targetSlot = i; redirected = true; break; }
            }
        }
    }
    const oldName = t ? ((typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, targetSlot, _bossCtx) : t.slots[targetSlot]) : '';
    if (t) {
        if (_bossCtx) {
            // ★ boss 语境：写的是 boss 槽位覆盖层（不动普通关槽位）
            t.bossSlots = t.bossSlots || {};
            t.bossSlots[targetSlot] = p.name;
        } else {
            t.slots[targetSlot] = p.name;
        }
    }

    // ★ 关键：把棋盘上该槽已有的落点同步成新植物。
    //   落点里存的是「下子那一刻的植物快照」，不跟着槽位走 ——
    //   不同步的话，改了槽位棋盘却还是旧植物（看起来像能放好几种植物）。
    //   boss 语境只同步 boss 棋盘（boardLate）；
    //   普通关语境**也只同步普通关棋盘** —— boss 关要独立（2026-10-30 修正，
    //   旧版连 boss 棋盘一起改，普通关换植物会把 boss 关的植物一起换掉）。
    const synced = _bossCtx
        ? (function () { try { return jobSyncSlotPlantOnBoard(boardLate, targetSlot, p.name); } catch (e) { return false; } })()
        : ((typeof jobSyncNormalSlotPlant === 'function')
            ? jobSyncNormalSlotPlant(targetSlot, p.name)
            : jobSyncSlotPlantEverywhere(targetSlot, p.name));
    if (synced) {
        try { renderAllBoards(); } catch (e) { }
        try { updatePreview(); } catch (e) { }
    }

    jobArmedSlot = targetSlot;   // 选完自动进入落子状态
    jobClosePicker();
    jobRenderSlots();
    jobRenderSeqChains();
    jobSaveLocal();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();   // 局外选卡角标实时刷新（锁定集合变了）
    const st = document.getElementById('jobStatus');
    if (st) {
        st.textContent = '已选中 槽' + targetSlot + '（' + p.name + '）'
            + (_bossCtx ? '（boss 关覆盖）' : '') + '，点击棋盘格子落子'
            + (redirected ? '　|　⚠️ 卡条不允许中间空槽，已自动前移到 槽' + targetSlot : '')
            + (synced && oldName ? '　|　棋盘上的该槽已同步改为「' + p.name + '」' : '');
    }
}

function jobRenderPlantGrid() {
    const kw = document.getElementById('plantSearch').value.trim().toLowerCase();
    const grid = document.getElementById('plantGrid');
    const countEl = document.getElementById('plantPickerCount');
    grid.innerHTML = '';
    const plantList = plantCache || [];
    const list = plantList.filter(p => {
        const hitKw = !kw
            || (p.name || '').toLowerCase().includes(kw)
            || (p.en || '').toLowerCase().includes(kw);
        const hitRarity = (plantRarityFilter === '全部') || (p.rarity === plantRarityFilter)
            || (plantRarityFilter === '收藏' && jobIsFav(p));
        return hitKw && hitRarity;
    });
    // 收藏项排最前（同组内保持原顺序）
    list.sort(function (a, b) {
        const fa = jobIsFav(a) ? 0 : 1, fb = jobIsFav(b) ? 0 : 1;
        return fa - fb;
    });
    plantPickList = list;
    // 1~8 槽不允许重复：算出已被其它槽位占用的植物（按当前语境的有效槽位）
    const _t = jobTables[currentTable];
    const _pkBossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    const usedBy = {};
    // ★ 已选集合（含正在编辑的槽位）：用于蓝框标注「这个植物已在槽位里」，
    //   与 usedBy 的区别是 usedBy 排除了正在编辑的槽（那个允许重选）。
    const selectedBy = {};
    for (let s = 1; s <= 8; s++) {
        const nm0 = _t && ((typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(_t, s, _pkBossCtx) : _t.slots[s]);
        if (nm0 && !selectedBy[nm0]) selectedBy[nm0] = s;
        if (s === currentSlotEditing) continue;
        if (nm0) usedBy[nm0] = s;
    }
    plantPickAvailable = [];
    let _noImgCnt = 0;
    list.forEach((pl, i) => {
        const av = jobPlantAvail(pl);
        if (!av.hasImg) _noImgCnt++;
        if (!usedBy[pl.name] && av.hasImg) plantPickAvailable.push(i);
    });
    if (plantPickAvailable.length && plantPickAvailable.indexOf(plantPickIndex) === -1) {
        plantPickIndex = plantPickAvailable[0];
    } else if (!plantPickAvailable.length && list.length) {
        plantPickIndex = 0;
    }
    const _usedCnt = list.length - plantPickAvailable.length - _noImgCnt;
    if (countEl) countEl.textContent = '共 ' + list.length + ' 种'
        + (_usedCnt ? '（' + _usedCnt + ' 种已被其它槽位占用）' : '')
        + (_noImgCnt ? '（' + _noImgCnt + ' 种无图不可选）' : '')
        + (plantPickAvailable.length ? '（W/S 或 ↑↓ 切换，A/D 跳 5 个，回车确认）' : '');
    if (!list.length) {
        grid.innerHTML = '<span style="grid-column:1/-1;color:#888;padding:20px;">没有匹配的植物</span>';
        if (typeof jobRenderReplacePanel === 'function') {
            try { jobRenderReplacePanel(); } catch (e) { }
        }
        return;
    }
    list.forEach((p, idx) => {
        const dupSlot = usedBy[p.name] || 0;        // 被【其它】槽占用 -> 禁选
        const selSlot = selectedBy[p.name] || 0;    // 已被某槽选用（含正在编辑的槽）-> 蓝框
        const av = jobPlantAvail(p);
        const noImg = !av.hasImg;
        const blocked = dupSlot || noImg;
        const cell = document.createElement('div');
        cell.className = 'job-card';
        cell.style.animationDelay = Math.min(idx, 20) * 9 + 'ms';   // 错峰入场（不超过 20 项）
        // ★ 三种视觉状态要一眼分清：
        //   无图不可选 = 灰化 + 左上角 ✕（opacity 0.38）
        //   已被槽位选用 = 蓝框 + 蓝色「槽N」角标（不灰化！被其它槽占用的仍禁选但保持彩色）
        //   键盘焦点 = 蓝色外描边（outline）
        cell.style.cssText += 'display:flex;flex-direction:column;align-items:center;gap:3px;border-radius:10px;'
            + (noImg ? 'cursor:not-allowed;opacity:0.38;'
                : dupSlot ? 'cursor:not-allowed;' : 'cursor:pointer;')
            + (selSlot && !noImg ? 'box-shadow:inset 0 0 0 3px #2d7aff;background:#eff6ff;' : '')
            + (!blocked && idx === plantPickIndex ? 'outline:3px solid #2d7aff;outline-offset:2px;' : '');
        // 悬停提示走自定义 tooltip 系统（1 秒延迟），不用原生 title（会双层提示）
        cell.setAttribute('data-tooltip', jobPlantCardTip(p, dupSlot, selSlot));
        cell.setAttribute('data-tooltip-delay', '1000');

        // 品质底图铺底（网页端铺，不改图）
        const rare = (typeof p.rare === 'number') ? p.rare : (RARITY_TO_RARE[p.rarity] || 0);
        const frame = document.createElement('div');
        frame.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;'   // PVZ2 卡槽比例
            + 'background:url(static/card_bg/rare_' + rare + '.webp) center/100% 100% no-repeat;';

        const img = document.createElement('img');
        img.src = p.img || '';
        img.alt = p.name;
        img.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:86%;width:86%;object-fit:contain;';
        img.onerror = function () { this.style.display = 'none'; };
        frame.appendChild(img);
        if (noImg) {
            // 无图植物：灰化 + 左上角叉叉（通用标记，见 02-tooltip.js），禁选
            frame.style.filter = 'grayscale(1)';
            jobCardXMark(frame);
        } else if (selSlot) {
            // 已被槽位选用：蓝框（在 cell 上）+ 右上角蓝色「槽N」角标，不灰化
            const badge = document.createElement('span');
            badge.textContent = '槽' + selSlot;
            badge.style.cssText = 'position:absolute;right:2px;top:2px;background:#2d7aff;color:#fff;font-size:9px;line-height:14px;border-radius:4px;padding:0 4px;z-index:2;';
            frame.appendChild(badge);
        }
        // ⚠️ 只有 missing 才警告：有皮肤夹但里面只有 1 张基础卡
        //   = 游戏内该植物带超装、但超装图没收集，戴超装上场会识别不到。
        //   none（无皮肤夹、单张平铺 png）= 本身就不带超装的植物，不警告。
        if (!noImg && av.sup === 'missing') {
            const warn = document.createElement('span');
            warn.textContent = '⚠️';
            warn.style.cssText = 'position:absolute;left:2px;top:2px;font-size:22px;line-height:24px;z-index:2;'
                + 'filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));';
            frame.appendChild(warn);
        }
        // ♥ 收藏标记（下边框中央，被边框"咬断"）
        if (jobIsFav(p)) {
            frame.appendChild(jobBuildHeart());
        }

        const nm = document.createElement('span');
        nm.textContent = p.name;
        nm.style.cssText = 'font-size:12px;text-align:center;line-height:1.2;';

        cell.appendChild(frame);
        cell.appendChild(nm);
        cell.addEventListener('click', () => {
            if (noImg) {
                setStatus('⛔「' + p.name + '」没有图片资源，无法选择');
                return;
            }
            plantPickIndex = idx;
            // ★ 右侧「替换指定表」里已经选中目标表时，这次点击 = 把那张表的植物换成它
            //   （42-jobset-batch.js；返回 true 表示这次点击被替换流程吃掉了）
            if (typeof jobTryApplyReplaceFlow === 'function' && jobTryApplyReplaceFlow(p)) return;
            jobConfirmPick();
        });
        // 右键收藏 / 取消收藏
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            jobToggleFav(p);
        });
        grid.appendChild(cell);
    });
    // ★ 右侧「替换指定表」面板（42-jobset-batch.js）：跟着选择器一起刷新
    if (typeof jobRenderReplacePanel === 'function') {
        try { jobRenderReplacePanel(); } catch (e) { console.warn('[replace] panel', e); }
    }
}

// 导出种植顺序：**以链条（slotOrder / loopOrder）为唯一权威**。
//
// 旧版实现（已废弃）按「槽号 + 槽内 seq」排序，会把物理落子顺序彻底打乱：
// 它先排槽1 全部、再排槽2 全部、最后把 feed/shovel 扔到末尾，
// 于是「铲→种菇→喂豆」会被导成「种菇×N → 铲×N → 喂豆×N」。
// 而 item.seq 只是**槽内**序号，跨槽没有可比性。
//
// 正确做法：复用链解析（jobGetChainOrder + jobSegPlacements）——链条里段的先后
// 就是执行先后，同一槽可被拆成多段穿插（种槽1 → 喂豆 → 再种槽1）。
