// ============================================================
// 通用动作：不需要格子，直接插进顺序链
//
//   · 棋盘右侧的竖排按钮组（点波 / 捡豆 / 加速）+ 末端的「更多」。
//   · 点一下 -> 弹窗确认插入哪条链（默认单次链，弹窗内可切换）。
//   · 插进链里的是 key = 'ga:<id>' 的段，没有落点、没有格子。
//   · 「更多」弹窗（#morePicker）目前只有「切换形态」，它**带参数**：
//     槽位 1-8 + 点击次数，段形状 { key:'ga:form', ga:'form', slot:N, times:M }。
//
//   ★ 运行时由 agent/jobset/runtime.py 的 _build_chain_nodes 消费，
//     经 dsl.generic_dsl 编译成 BatchSwipe DSL。
// ============================================================

// 弹窗里「当前选中的目标链」（默认单次链）
let jobGenTarget = 'once';

// ============================================================
// 弹窗逻辑
// ============================================================

// 打开弹窗（gaId = 动作 id）
function jobOpenGenPicker(gaId) {
    const ga = jobGenericActionById(gaId);
    if (!ga) return;

    const modal = document.getElementById('genPicker');
    if (!modal) return;

    jobGenTarget = 'once';          // 每次打开都重置为单次链

    const ico = document.getElementById('gpIco');
    const nm = document.getElementById('gpName');
    const desc = document.getElementById('gpDesc');
    if (ico) jobAppendIconImg(ico, ga.img, { cls: 'ga-ico-img', size: 56, alt: ga.name, fallbackText: ga.icon || '⚡' });
    if (nm) nm.textContent = ga.name;
    if (desc) desc.textContent = ga.desc || '';

    jobRenderGenTarget();
    modal.dataset.ga = gaId;
    modal.classList.add('gp-open');

    // 回显「本次已插入 N 次」（优化2：弹窗不关，可以连点）
    const tip = document.getElementById('gpInserted');
    if (tip) {
        const t = jobTables[currentTable];
        const board = jobIsBossBoard() ? boardLate : boardEarly;
        const used = jobGenUsageIn(t, jobGenTarget, board, gaId);
        tip.textContent = used > 0 ? ('本次已插入 ' + used + ' 次') : '';
    }

    // 每次打开都把滚动条置顶，避免上次滚动位置残留
    const body = modal.querySelector('.gp-body');
    if (body) body.scrollTop = 0;
}

// 渲染「目标链」这一行（带左右箭头 + 可点击/右键切换）
function jobRenderGenTarget() {
    const el = document.getElementById('gpChain');
    if (!el) return;
    const meta = JOB_CHAIN_META[jobGenTarget] || JOB_CHAIN_META.once;
    el.textContent = meta.icon + ' ' + meta.label;
}

// 循环切换目标链
//   ★ boss 关没有收尾链，所以 boss 棋盘下只在 单次 ↔ 循环 之间切。
//   ★ 另外：如果当前目标在 boss 下不合法（比如切到 boss 时才残留着 'end'），
//     indexOf 会返回 -1，按下标算就会**停在原地**、把 'end' 留着 —— 于是
//     插入 boss 关的收尾链（它并不存在）。所以先规范化再切。
function jobCycleGenTarget(step) {
    const modes = jobIsBossBoard() ? ['once', 'loop'] : ['once', 'loop', 'end'];
    let i = modes.indexOf(jobGenTarget);
    if (i < 0) i = 0;                       // 非法残留 -> 从第一个合法项开始
    jobGenTarget = modes[(i + (step || 1) + modes.length) % modes.length];
    jobRenderGenTarget();
}

function jobCloseGenPicker() {
    const modal = document.getElementById('genPicker');
    if (modal) modal.classList.remove('gp-open');
}

// 确认插入：把通用动作段追加到目标链的末尾
//
// ★ 优化2：**不关闭弹窗**，可以反复点击「确认插入」连续添加同一个动作。
//   只有「取消 / ✕ / 点遮罩 / Esc」才关闭。所以状态栏也要提示当前累计次数。
function jobConfirmGenPicker() {
    const modal = document.getElementById('genPicker');
    if (!modal) return;
    const gaId = modal.dataset.ga;
    const ga = jobGenericActionById(gaId);
    if (!ga) { jobCloseGenPicker(); return; }

    const t = jobTables[currentTable];
    if (!t) { jobCloseGenPicker(); return; }

    const board = jobIsBossBoard() ? boardLate : boardEarly;
    // ★ 兜底：boss 关没有收尾链，残留的 'end' 一律改走循环链。
    let which = jobGenTarget;
    if (jobIsBossBoard() && which === 'end') which = 'loop';
    jobGenTarget = which;

    const field = jobChainField(which, board);
    if (!Array.isArray(t[field])) t[field] = [];

    t[field].push({ key: JOB_GA_PREFIX + ga.id, ga: ga.id });

    jobSaveLocal();
    // ★ 不关闭弹窗；刷新链条 + 按钮上的次数
    jobRenderSeqChains();
    jobRefreshGenCounts();

    const meta = JOB_CHAIN_META[which] || JOB_CHAIN_META.once;
    const used = jobGenUsageIn(t, which, board, ga.id);
    setStatus('＋ 已把「' + ga.name + '」插入 ' + meta.short
        + ' 末尾（该链已用 ' + used + ' 次）');

    // 弹窗里也回显一下「已插入 N 次」，给用户即时反馈
    const tip = document.getElementById('gpInserted');
    if (tip) tip.textContent = '本次已插入 ' + used + ' 次';
}

// 统计某个通用动作在指定链里出现了几次
function jobGenUsageIn(t, which, board, gaId) {
    if (!t) return 0;
    const field = jobChainField(which, board);
    const arr = Array.isArray(t[field]) ? t[field] : [];
    return arr.filter(function (s) {
        return s && String(s.key) === (JOB_GA_PREFIX + gaId);
    }).length;
}

// 统计某个通用动作在**所有链**（单次/循环/收尾）里的总次数
function jobGenUsageTotal(t, gaId) {
    if (!t) return 0;
    const board = jobIsBossBoard() ? boardLate : boardEarly;
    let n = 0;
    ['once', 'loop', 'end'].forEach(function (which) {
        n += jobGenUsageIn(t, which, board, gaId);
    });
    return n;
}

// 只刷新按钮上的三条链次数角标（不重建按钮，避免闪烁）
//   ★ 不再是「一个总数」，而是 收尾 / 单次 / 循环 三个小图标 + 各自次数
function jobRefreshGenCounts() {
    ['genActions', 'genActionsBoss'].forEach(function (hostId) {
        const box = document.getElementById(hostId);
        if (!box) return;
        const t = jobTables[currentTable];
        const board = jobIsBossBoard() ? boardLate : boardEarly;

        Array.from(box.querySelectorAll('.gen-act')).forEach(function (btn) {
            const gaId = btn.dataset.ga;
            if (!gaId) return;
            const wrap = btn.querySelector('.ga-counts');
            if (!wrap) return;
            wrap.innerHTML = '';
            let total = 0;

            ['end', 'once', 'loop'].forEach(function (which) {
                const n = jobGenUsageIn(t, which, board, gaId);
                total += n;
                const meta = JOB_CHAIN_META[which] || {};
                const chip = document.createElement('span');
                chip.className = 'ga-chip ga-chip-' + which;
                chip.title = (meta.short || which) + '：' + n + ' 次';
                chip.textContent = (meta.icon || '') + (n > 0 ? n : '');
                if (n === 0) chip.classList.add('ga-chip-zero');
                wrap.appendChild(chip);
            });

            // 三条链都没用到 -> 整行藏起来，按钮更干净
            wrap.style.display = total > 0 ? '' : 'none';
        });
    });
}

// ============================================================
// 渲染棋盘右侧的动作按钮组
//   · 拆成 Into(hostId)，普通关 / boss 关两个容器都能渲染
// ============================================================
function jobRenderGenActionsInto(hostId) {
    const box = document.getElementById(hostId);
    if (!box) return;
    box.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ga-title';
    title.textContent = '通用动作';
    box.appendChild(title);

    // 防御：万一 JOB_GENERIC_ACTIONS 未定义 / 为空，显式提示，别静默失败
    const list = (typeof JOB_GENERIC_ACTIONS !== 'undefined' && Array.isArray(JOB_GENERIC_ACTIONS))
        ? JOB_GENERIC_ACTIONS : [];
    if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'ga-empty';
        hint.textContent = '（无通用动作定义）';
        box.appendChild(hint);
        return;
    }

    const t = jobTables[currentTable];

    list.forEach(function (ga) {
        const btn = document.createElement('button');
        btn.className = 'gen-act';
        btn.type = 'button';
        btn.dataset.ga = ga.id;                 // 供 jobRefreshGenCounts 定位
        btn.title = (ga.desc || ga.name) + '（点击插入顺序链）';

        const ico = document.createElement('span');
        ico.className = 'ga-ico';
        jobAppendIconImg(ico, ga.img, { cls: 'ga-ico-img', size: 56, alt: ga.name, fallbackText: ga.icon || '⚡' });
        btn.appendChild(ico);

        const nm = document.createElement('span');
        nm.className = 'ga-name';
        nm.textContent = ga.name || ga.id;
        btn.appendChild(nm);

        // ★ 三条链各自的小图标 + 次数（收尾 / 单次 / 循环），由 jobRefreshGenCounts 填充
        const counts = document.createElement('span');
        counts.className = 'ga-counts';
        counts.style.display = 'none';
        btn.appendChild(counts);

        btn.addEventListener('click', function () { jobOpenGenPicker(ga.id); });
        box.appendChild(btn);
    });

    // 首次填充次数角标
    jobRefreshGenCounts();

    // ★ 「更多动作」按钮 -> 先打开动作列表（#moreList），选完再进参数弹窗
    const more = document.createElement('button');
    more.className = 'gen-act gen-act-more';
    more.type = 'button';
    more.title = '更多动作（点击选择要插入的动作）';
    const mIco = document.createElement('span');
    mIco.className = 'ga-ico';
    mIco.textContent = '＋';
    more.appendChild(mIco);
    const mNm = document.createElement('span');
    mNm.className = 'ga-name';
    mNm.textContent = '更多';
    more.appendChild(mNm);
    more.addEventListener('click', function () { jobOpenMoreList(); });
    box.appendChild(more);
}

// 对外入口：一次把两个棋盘都渲染
function jobRenderGenActions() {
    jobRenderGenActionsInto('genActions');      // 普通关
    jobRenderGenActionsInto('genActionsBoss');  // boss 关
}

// ============================================================
// 绑定弹窗内的事件（初始化时调一次）
//   · 用 flag 防止重复绑定（29 里可能也会调）
// ============================================================
let jobGenPickerBound = false;

function jobBindGenPicker() {
    if (jobGenPickerBound) return;
    const modal = document.getElementById('genPicker');
    if (!modal) return;

    const close = document.getElementById('gpClose');
    if (close) close.addEventListener('click', jobCloseGenPicker);

    const cancel = document.getElementById('gpCancel');
    if (cancel) cancel.addEventListener('click', jobCloseGenPicker);

    const ok = document.getElementById('gpOk');
    if (ok) ok.addEventListener('click', jobConfirmGenPicker);

    // 点击遮罩关闭
    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseGenPicker();
    });

    // 目标链：左右箭头 / 点击整行 / 右键，都能循环切换
    const prev = document.getElementById('gpPrev');
    const next = document.getElementById('gpNext');
    const row  = document.getElementById('gpTargetRow');
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); jobCycleGenTarget(-1); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); jobCycleGenTarget(1); });
    if (row) {
        row.addEventListener('click', function () { jobCycleGenTarget(1); });
        row.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            jobCycleGenTarget(-1);
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseGenPicker();
    });

    jobGenPickerBound = true;
}

// ============================================================
// 「更多」动作 —— 两级弹窗
//
//   第一级 #moreList   ：列出 JOB_MORE_ACTIONS 里的动作，选一个
//   第二级 #morePicker ：按该动作的 params 声明自动渲染参数，再选链并插入
//
//   ★ 扩展方式：往 JOB_MORE_ACTIONS 里加一个动作定义（含 params）即可，
//     列表和参数 UI 都会自动出来，**本文件的弹窗代码不需要改**。
//
//   段形状示例（切换形态）：{ key: 'ga:form', ga: 'form', slot: N, times: M }
// ============================================================

let jobMoreTarget = 'once';      // 目标链（默认单次链）
let jobMoreAction = null;        // 当前在第二级里编辑的动作定义
let jobMoreValues = {};          // 当前参数值 { slot: 1, times: 2 }

// ---- 第一级：动作列表 ----

function jobOpenMoreList() {
    const modal = document.getElementById('moreList');
    if (!modal) return;
    jobRenderMoreList();
    modal.classList.add('ml-open');
}

function jobRenderMoreList() {
    const box = document.getElementById('mlBody');
    if (!box) return;
    box.innerHTML = '';

    const list = (typeof JOB_MORE_ACTIONS !== 'undefined' && Array.isArray(JOB_MORE_ACTIONS))
        ? JOB_MORE_ACTIONS : [];

    if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'ml-empty';
        hint.textContent = '（暂无更多动作）';
        box.appendChild(hint);
        return;
    }

    list.forEach(function (ga) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ml-item';
        btn.title = '插入「' + (ga.name || ga.id) + '」';

        const ico = document.createElement('span');
        ico.className = 'ml-ico';
        jobAppendIconImg(ico, ga.img, {
            cls: 'ga-ico-img', size: 24, alt: ga.name,
            fallbackText: ga.icon || '⚡'
        });
        btn.appendChild(ico);

        const txt = document.createElement('div');
        txt.className = 'ml-txt';
        const nm = document.createElement('div');
        nm.className = 'ml-name';
        nm.textContent = ga.name || ga.id;
        txt.appendChild(nm);
        if (ga.desc) {
            const ds = document.createElement('div');
            ds.className = 'ml-desc';
            ds.textContent = ga.desc;
            txt.appendChild(ds);
        }
        btn.appendChild(txt);

        const go = document.createElement('span');
        go.className = 'ml-go';
        go.textContent = '›';
        btn.appendChild(go);

        btn.addEventListener('click', function () {
            jobCloseMoreList();
            jobOpenMorePicker(ga.id);
        });
        box.appendChild(btn);
    });
}

function jobCloseMoreList() {
    const modal = document.getElementById('moreList');
    if (modal) modal.classList.remove('ml-open');
}

// ---- 第二级：参数 + 选链 ----

function jobOpenMorePicker(gaId) {
    const modal = document.getElementById('morePicker');
    if (!modal) return;

    const ga = gaId ? jobGenericActionById(gaId) : null;
    if (!ga) return;
    jobMoreAction = ga;

    // 参数初值：取各参数的 def
    jobMoreValues = {};
    jobActionParams(ga).forEach(function (p) {
        jobMoreValues[p.key] = (p.def === undefined || p.def === null) ? 0 : p.def;
    });
    jobMoreTarget = 'once';

    const nm = document.getElementById('mpName');
    const desc = document.getElementById('mpDesc');
    const ico = document.getElementById('mpIco');
    if (ico) jobAppendIconImg(ico, ga.img, {
        cls: 'ga-ico-img', size: 28, alt: ga.name, fallbackText: ga.icon || '⚡'
    });
    if (nm) nm.textContent = ga.name || ga.id;
    if (desc) desc.textContent = ga.desc || '';

    jobRenderMoreParams();
    jobRenderMoreTarget();

    modal.classList.add('mp-open');
    jobRefreshMoreInserted();
}

// ★ 参数区：完全按 ga.params 渲染 —— 这是「可扩展」的核心。
function jobRenderMoreParams() {
    const box = document.getElementById('mpParams');
    if (!box) return;
    box.innerHTML = '';

    const ga = jobMoreAction;
    const ps = jobActionParams(ga);
    if (!ps.length) return;

    ps.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'mp-param';

        const lab = document.createElement('span');
        lab.className = 'mp-param-label';
        lab.textContent = (p.label || p.key) + '：';
        row.appendChild(lab);

        const ctrl = jobBuildParamControl(p, jobMoreValues[p.key], {
            className: 'mp-param-inp',
            width: 68,
            onChange: function (v) { jobMoreValues[p.key] = v; jobRefreshMoreInserted(); },
            onEnter: function () { jobConfirmMorePicker(); }
        });
        row.appendChild(ctrl);

        // 范围提示（只在有上限时显示，避免噪音）
        if (p.max !== undefined && p.max !== null) {
            const hint = document.createElement('span');
            hint.className = 'mp-param-hint';
            hint.textContent = (p.min !== undefined ? p.min : 0) + ' - ' + p.max;
            row.appendChild(hint);
        }

        box.appendChild(row);
    });
}

function jobRenderMoreTarget() {
    const el = document.getElementById('mpChain');
    if (!el) return;
    const meta = JOB_CHAIN_META[jobMoreTarget] || JOB_CHAIN_META.once;
    el.textContent = meta.icon + ' ' + meta.label;
}

// boss 关没有收尾链 —— 与 #genPicker 同样只在 单次 ↔ 循环 之间切。
//   ★ 与 jobCycleGenTarget 同理：先把非法残留（'end'）规范化，
//     否则 indexOf 返回 -1 会让它原地不动，把 'end' 带进 boss 关。
function jobCycleMoreTarget(step) {
    const modes = jobIsBossBoard() ? ['once', 'loop'] : ['once', 'loop', 'end'];
    let i = modes.indexOf(jobMoreTarget);
    if (i < 0) i = 0;
    jobMoreTarget = modes[(i + (step || 1) + modes.length) % modes.length];
    jobRenderMoreTarget();
}

function jobCloseMorePicker() {
    const modal = document.getElementById('morePicker');
    if (modal) modal.classList.remove('mp-open');
}

// 回显「该链已插入 N 次」
function jobRefreshMoreInserted() {
    const tip = document.getElementById('mpInserted');
    if (!tip) return;
    const ga = jobMoreAction;
    if (!ga) { tip.textContent = ''; return; }
    const t = jobTables[currentTable];
    const board = jobIsBossBoard() ? boardLate : boardEarly;
    const used = jobGenUsageIn(t, jobMoreTarget, board, ga.id);
    tip.textContent = used > 0 ? ('该链已插入 ' + used + ' 次') : '';
}

// 确认插入：把段追加到目标链末尾
//   ★ 与 #genPicker 一致：不关弹窗，可连续插入。
function jobConfirmMorePicker() {
    const modal = document.getElementById('morePicker');
    if (!modal) return;

    const ga = jobMoreAction;
    if (!ga) { jobCloseMorePicker(); return; }

    const t = jobTables[currentTable];
    if (!t) { jobCloseMorePicker(); return; }

    const board = jobIsBossBoard() ? boardLate : boardEarly;
    // ★ 兜底：boss 关没有收尾链。即使 jobMoreTarget 因为某些竞态残留成 'end'，
    //   也绝不能往 boss 的 end_chain 里写东西 —— 那会生成一条永远不执行的链。
    let which = jobMoreTarget;
    if (jobIsBossBoard() && which === 'end') which = 'loop';
    jobMoreTarget = which;

    const field = jobChainField(which, board);
    if (!Array.isArray(t[field])) t[field] = [];

    // ★ 必须带 ga:<id> —— 运行时靠 key 的 'ga:' 前缀（或 type:'action'）
    //   判定这是通用动作段，否则会被当成植物段丢弃。
    const seg = { key: JOB_GA_PREFIX + ga.id, ga: ga.id };
    jobApplyParamsToSeg(seg, ga, jobMoreValues);
    t[field].push(seg);

    jobSaveLocal();
    jobRenderSeqChains();
    jobRefreshGenCounts();

    const meta = JOB_CHAIN_META[which] || JOB_CHAIN_META.once;
    const used = jobGenUsageIn(t, which, board, ga.id);
    const summary = jobParamsSummary(ga, seg);
    setStatus('＋ 已插入「' + (ga.name || ga.id) + (summary ? '（' + summary + '）' : '')
        + '」到' + meta.short + '末尾（该链已用 ' + used + ' 次）');

    jobRefreshMoreInserted();
}

let jobMorePickerBound = false;

function jobBindMorePicker() {
    if (jobMorePickerBound) return;
    const modal = document.getElementById('morePicker');
    const list = document.getElementById('moreList');
    if (!modal && !list) return;

    // ---- 第一级 ----
    const mlClose = document.getElementById('mlClose');
    if (mlClose) mlClose.addEventListener('click', jobCloseMoreList);
    if (list) {
        list.addEventListener('click', function (e) {
            if (e.target === list) jobCloseMoreList();
        });
    }

    // ---- 第二级 ----
    const close = document.getElementById('mpClose');
    if (close) close.addEventListener('click', jobCloseMorePicker);

    const cancel = document.getElementById('mpCancel');
    if (cancel) cancel.addEventListener('click', jobCloseMorePicker);

    const back = document.getElementById('mpBack');
    if (back) back.addEventListener('click', function () {
        jobCloseMorePicker();
        jobOpenMoreList();
    });

    const ok = document.getElementById('mpOk');
    if (ok) ok.addEventListener('click', jobConfirmMorePicker);

    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseMorePicker();
    });

    // 目标链：左右箭头 / 点击整行 / 右键，都能循环切换
    const prev = document.getElementById('mpPrev');
    const next = document.getElementById('mpNext');
    const row  = document.getElementById('mpTargetRow');
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); jobCycleMoreTarget(-1); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); jobCycleMoreTarget(1); });
    if (row) {
        row.addEventListener('click', function () { jobCycleMoreTarget(1); jobRefreshMoreInserted(); });
        row.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            jobCycleMoreTarget(-1);
            jobRefreshMoreInserted();
        });
    }

    // Esc：第二级开着就退回第一级，否则关掉列表
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (modal.classList.contains('mp-open')) {
            jobCloseMorePicker();
            jobOpenMoreList();
        } else {
            jobCloseMoreList();
        }
    });

    jobMorePickerBound = true;
}

// ============================================================
// 自调用 + 自愈：任何时机被清空都能重新补上
// ============================================================
(function bootGenActions() {
    const HOSTS = ['genActions', 'genActionsBoss'];

    function tryRender(tag) {
        console.log('[gen-actions] render @', tag,
                    'readyState=', document.readyState,
                    'GA=', typeof window.JOB_GENERIC_ACTIONS);
        try { jobRenderGenActions(); }
        catch (e) { console.error('[gen-actions] 渲染失败:', e); }
        try { jobBindGenPicker(); }
        catch (e) { console.error('[gen-picker] 绑定失败:', e); }
        try { jobBindMorePicker(); }
        catch (e) { console.error('[more-picker] 绑定失败:', e); }
    }

    // ① 立即跑一次（脚本在 body 末尾，DOM 已就绪）
    tryRender('immediate');

    // ② DOMContentLoaded / load 各补一次（防止 29 稍后才初始化）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => tryRender('DOMContentLoaded'));
    }
    window.addEventListener('load', () => tryRender('load'));

    // ③ 兜底延时，覆盖异步初始化
    setTimeout(() => tryRender('t+300ms'), 300);
    setTimeout(() => tryRender('t+1500ms'), 1500);

    // ④ ★关键：监听两个容器，一旦被清空（innerHTML='' 或子节点被删）
    //     就自动重画。防止 29 在晚些时候重建面板把按钮冲掉。
    HOSTS.forEach(function (id) {
        const box = document.getElementById(id);
        if (!box) { console.warn('[gen-actions] 容器不存在:', id); return; }

        const obs = new MutationObserver(function () {
            // 只关心"里面没有 .gen-act 按钮"的情况，避免自己重画时死循环
            if (!box.querySelector('.gen-act')) {
                console.warn('[gen-actions] 检测到', id, '被清空，自动重绘');
                try { jobRenderGenActionsInto(id); }
                catch (e) { console.error('[gen-actions] 重绘失败:', e); }
            }
        });
        obs.observe(box, { childList: true, subtree: false });
    });
})();