// ============================================================
// 通用动作：不需要格子，直接插进顺序链
//
//   · 棋盘右侧的竖排按钮组（点波 / 捡豆 / 加速）。
//   · 点一下 -> 弹窗确认插入哪条链（默认单次链，弹窗内可切换）。
//   · 插进链里的是 key = 'ga:<id>' 的段，没有落点、没有格子。
//
//   ⚠️ 目前只做网页端（用户要求先不动作业集）。
//      运行时 agent/jobset 还没消费这些段，导出后暂不生效。
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
function jobCycleGenTarget(step) {
    const modes = jobIsBossBoard() ? ['once', 'loop'] : ['once', 'loop', 'end'];
    const i = modes.indexOf(jobGenTarget);
    const next = modes[((i < 0 ? 0 : i) + (step || 1) + modes.length) % modes.length];
    jobGenTarget = next;
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
    const which = jobGenTarget;
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

    // ★ 优化5：末尾加一个「更多动作」占位（尚未开放的扩展位）
    const more = document.createElement('button');
    more.className = 'gen-act gen-act-more';
    more.type = 'button';
    more.title = '更多动作（预留位，后续扩展）';
    more.disabled = true;
    const mIco = document.createElement('span');
    mIco.className = 'ga-ico';
    mIco.textContent = '＋';
    more.appendChild(mIco);
    const mNm = document.createElement('span');
    mNm.className = 'ga-name';
    mNm.textContent = '更多';
    more.appendChild(mNm);
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