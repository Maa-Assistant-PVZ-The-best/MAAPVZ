
// ============================================================
// 普通关 / boss 关 的配置字段映射
//
// ★ 需求：boss 关的组合动作配置（链条顺序、动作后等待、槽位形态）
//   必须与普通关**完全独立** —— 除了槽位植物（slots/lineup）共用。
//
//   普通关（boardEarly）用：slotOrder / loopOrder / endOrder / waitAfter / slotModes
//   boss 关（boardLate） 用：bossSlotOrder / bossLoopOrder / bossEndOrder /
//                            bossWaitAfter / bossSlotModes
//
//   旧数据没有 boss* 字段 —— 按用户要求**不自动拷贝**，boss 关直接等结算
//   （即 boss 链为空 -> 只跑「继续挑战」识别，不做任何种植）。
//
//   ★ 三条链：
//     once（单次链）—— 开局先执行一遍
//     loop（循环链）—— 之后反复执行
//     end （收尾链）—— 检测到最后一波时执行一次，然后等结算
// ============================================================
const JOB_FIELD_MAP = {
    once: { normal: 'slotOrder', boss: 'bossSlotOrder' },
    loop: { normal: 'loopOrder', boss: 'bossLoopOrder' },
    end:  { normal: 'endOrder',  boss: 'bossEndOrder' },
    wait: { normal: 'waitAfter', boss: 'bossWaitAfter' },
    modes: { normal: 'slotModes', boss: 'bossSlotModes' }
};

// 三条链的显示名与图标
const JOB_CHAIN_META = {
    once: { label: '单次链（先执行一遍）',      short: '单次链', icon: '1️⃣' },
    loop: { label: '循环链（反复执行）',        short: '循环链', icon: '🔁' },
    end:  { label: '收尾链（最后一波执行一次）', short: '收尾链', icon: '🚩' }
};

// 槽位形态：once（单次）/ loop（循环）/ end（收尾）
const JOB_SLOT_MODES = ['once', 'loop', 'end'];

// ============================================================
// UI 图标资源（原先用 emoji，现改为 button/ 下的 .webp 图片）
//   集中定义，避免到处写死路径。
// ============================================================
const JOB_UI_IMG = {
    feed:   'static/button/能量豆绿底.webp',   // 喂豆（绿底能量豆）
    bean:   'static/button/能量豆白色.webp',   // 捡豆（白色能量豆）
    wave:   'static/button/下一波.webp',       // 点波
    speed:  'static/button/二倍速.webp',       // 加速
    shovel: 'static/button/铲子.webp'          // 铲子
};

// ============================================================
// 通用动作（不需要格子，直接插进顺序链）
//
//   · 放在棋盘右侧的按钮组里，点一下弹窗确认插入哪条链。
//   · 存进链里的是 key = 'ga:<id>' 的段（没有格子、没有落点）。
//   · 点波 / 捡豆 / 加速。
//
// ★ 「等待」不在这个按钮组里 —— 用户要求把它从通用动作按钮里删掉。
//   等待改为：**任何一步（植物或通用动作）旁边的 ⏱ 按钮**，
//   点一下就在这一步**下面插入一个独立的等待块**。
//   所以等待仍然是合法的链段（见 JOB_WAIT_ACTION），只是不能从
//   通用动作按钮组直接插。
// ============================================================
const JOB_GENERIC_ACTIONS = [
    { id: 'wave',  name: '点波', icon: '🌊', img: JOB_UI_IMG.wave,  desc: '点一次波（催僵尸）' },
    { id: 'bean',  name: '捡豆', icon: '🫘', img: JOB_UI_IMG.bean,  desc: '捡一次能量豆' },
    { id: 'speed', name: '加速', icon: '⏩', img: JOB_UI_IMG.speed, desc: '切换加速' }
];

// ★ 「等待」：不再是可插入的通用动作，但依然是合法的链段。
//   seg.ms = 毫秒数，导出成 BatchSwipe 的 sleep（秒）。
//   插入入口只有「某一步旁边的 ⏱」。
const JOB_WAIT_ACTION = {
    id: 'wait', name: '等待', icon: '⏱', img: '',
    desc: '等待指定毫秒（可精细到 1ms）', hasMs: true, defaultMs: 1000
};

// 通用动作的段前缀
const JOB_GA_PREFIX = 'ga:';

// 按 id 取动作定义（含「等待」——它仍是合法链段，只是不在按钮组里）
function jobGenericActionById(id) {
    if (id === JOB_WAIT_ACTION.id) return JOB_WAIT_ACTION;
    return JOB_GENERIC_ACTIONS.filter(function (a) { return a.id === id; })[0] || null;
}

// 可在「通用动作按钮组」里直接插入的动作（不含等待）
function jobInsertableActions() {
    return JOB_GENERIC_ACTIONS;
}

// 判断某个 key 是不是通用动作段，是则返回动作定义
function jobGenericActionOfKey(key) {
    const k = String(key || '');
    if (k.indexOf(JOB_GA_PREFIX) !== 0) return null;
    return jobGenericActionById(k.slice(JOB_GA_PREFIX.length));
}

// ============================================================
// 图标渲染辅助：把 emoji 图标统一改成 .webp 图片
//
//   jobAppendIconImg(container, imgPath, opts)
//     container: 要挂图片的父元素（span / div）
//     imgPath:   图片路径（JOB_UI_IMG.* / ga.img），空则用 fallbackText
//     opts: { cls, size, alt, fallbackText }
//        - cls          图片的 class（如 'ga-ico-img' / 'seq-ico-img'）
//        - size         边长 px（默认 18）
//        - alt          alt 文案
//        - fallbackText 图片加载失败时兜底显示的 emoji / 文字
//
//   图片失败自动回退到 fallbackText，保证不出现破图。
// ============================================================
function jobAppendIconImg(container, imgPath, opts) {
    if (!container) return;
    opts = opts || {};
    const cls = opts.cls || 'job-ui-img';
    const size = opts.size || 18;
    const fallbackText = opts.fallbackText || '';
    const alt = opts.alt || '';

    // 没有图片（旧数据 / 未定义）→ 直接用兜底文字，保持原样
    if (!imgPath) {
        container.textContent = fallbackText;
        return;
    }

    const img = document.createElement('img');
    img.className = cls;
    img.src = imgPath;
    img.alt = alt;
    img.draggable = false;
    img.style.width = size + 'px';
    img.style.height = size + 'px';
    img.onerror = function () { container.textContent = fallbackText; };
    container.textContent = '';
    container.appendChild(img);
}

// 通用动作段没有棋盘落点，永远算「可见」
function jobIsGenericKey(key) {
    return !!jobGenericActionOfKey(key);
}

// 当前编辑的是不是 boss 棋盘（'late' tab = boss）
function jobIsBossBoard() {
    try {
        return (document.querySelector('.tab.active')?.dataset.tab === 'late');
    } catch (e) { return false; }
}

// 取某条链在指定 board 上对应的字段名
//
// ★ forceBoss：显式指定「这次按 boss 处理」，优先于引用判断。
//   为什么需要它：导出 boss 链时传进来的棋盘可能是**上一张表的 boardLate**
//   （t.inheritBoss && prev ? prev.boardLate : t.boardLate），
//   那个对象的引用不等于全局 boardLate，靠 === 判断会误判成普通关 ——
//   结果 boss 链读了 t.loopOrder（把普通关的通用动作串进 boss 关）。
function jobChainField(which, board, forceBoss) {
    const isBoss = (forceBoss === true)
        || (board === boardLate)
        || (board === undefined && jobIsBossBoard());
    return isBoss ? JOB_FIELD_MAP[which].boss : JOB_FIELD_MAP[which].normal;
}

// 「动作后等待」的字段名（跟当前编辑的 tab 走）
function jobWaitField() {
    return jobIsBossBoard() ? JOB_FIELD_MAP.wait.boss : JOB_FIELD_MAP.wait.normal;
}

// 「槽位形态」的字段名（跟当前编辑的 tab 走）
function jobModesField() {
    return jobIsBossBoard() ? JOB_FIELD_MAP.modes.boss : JOB_FIELD_MAP.modes.normal;
}

// 该槽在这一段里包含哪些落点。每项带 gidx = 它在「本槽全部落点」里的真实下标。
// picked 存在时用它（融合/拆出的块可能是若干不连续的株），否则用 [from, to) 区间。
//
// ★ 段内顺序（seg.order）：
//   默认按棋盘上的 seq（= 格子1_1 → 1_2 → 1_3 …）。
//   作者可以在链条里拖动 chip 打乱块内顺序，此时 seg.order 记录「落点下标」的
//   自定义先后（如 [2,0,1]）。order 的长度与 picked/区间展开的落点一致；
//   对不上的部分（增删落点后）按 seq 追加到末尾，保证不丢落点。
function jobSegPlacements(board, seg, which) {
    // ★ 通用动作段没有落点，直接返回空
    if (!seg || jobIsGenericKey(seg.key)) return [];
    const all = jobPlacementsOf(board, seg.key, which);
    const total = all.length;
    let idxs;
    if (Array.isArray(seg.picked) && seg.picked.length) {
        idxs = seg.picked.slice();
    } else if (seg.from === 0 && (seg.to === null || seg.to === undefined)) {
        idxs = all.map(function (_, i) { return i; });
    } else {
        const to = (seg.to === null || seg.to === undefined) ? total : seg.to;
        idxs = [];
        for (let g = (seg.from | 0); g < to; g++) idxs.push(g);
    }

    // ★ 严格读取棋盘：丢掉棋盘上不存在的下标（植物被删掉后，
    //   picked/from-to 里会留下越界值；不清理的话段会「看起来还在」，
    //   但实际渲染为空，拖动时又拿不到落点 → 幽灵段）。
    const seen = {};
    idxs = idxs.filter(function (g) {
        g = Number(g);
        if (!Number.isFinite(g) || g < 0 || g >= total) return false;
        if (seen[g]) return false;
        seen[g] = true;
        return true;
    });

    // ★ 应用自定义块内顺序
    if (Array.isArray(seg.order) && seg.order.length) {
        const want = seg.order.map(Number).filter(function (g) {
            return idxs.indexOf(g) !== -1;
        });
        const rest = idxs.filter(function (g) { return want.indexOf(g) === -1; });
        idxs = want.concat(rest);      // 自定义在前，新增的落点按 seq 追加
    }

    return idxs.map(function (g) {
        const e = all[g];
        if (!e) return null;
        // 把真实下标挂在返回项上：调用方不必再靠 seg.from + i 去猜（融合后下标不连续）
        return { r: e.r, c: e.c, item: e.item, gidx: g };
    }).filter(Boolean);
}

// 某槽在链里分成了几段（用于判断是否已被拆开）
function jobSegCountFor(t, which, key) {
    return jobGetChainOrder(t, which).filter(function (s) { return s.key === key; }).length;
}

// 兼容旧调用
function jobGetSlotOrder(t) { return jobGetChainOrder(t, 'once'); }

// 某槽在指定形态下的落点（按 seq 排序）—— 单次与循环各自独立
function jobPlacementsOf(board, scopeId, selMode) {
    const out = [];
    if (!board) return out;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(function (it) {
                if (it.id !== scopeId) return;
                if (jobItemMode(it) !== selMode) return;
                out.push({ r: r, c: c, item: it });
            });
        }
    }
    out.sort(function (a, b) {
        const qa = (typeof a.item.seq === 'number') ? a.item.seq : 9999;
        const qb = (typeof b.item.seq === 'number') ? b.item.seq : 9999;
        if (qa !== qb) return qa - qb;
        // seq 相同/缺失时用全局落子序号兜底，保证顺序稳定
        const oa = (typeof a.item.ord === 'number') ? a.item.ord : 999999;
        const ob = (typeof b.item.ord === 'number') ? b.item.ord : 999999;
        return oa - ob;
    });
    return out;
}

// 某落点的稳定键（用于挂「动作后等待」）
function jobPlacementKey(mode, scopeId, r, c, seq) {
    return mode + '|' + scopeId + '|' + r + ',' + c + '|' + (seq || 0);
}

// 计算某条链的「全局种植序号」：按链条里段的先后、段内落点的先后，
// 给每个落点一个从 1 开始的**连续**序号（跨槽 / 跨块永不重号）。
// 这样顺序链里的编号是一整段 1..N，而不是每个块各自 1..N，
// 同时棋盘格子上同形态的角标也用它，保证链与棋盘一一对应。
// 返回 Map：键 = jobPlacementKey(which, key, r, c, seq) → 全局序号（1 起）。
function jobBuildGlobalSeq(board, t, which) {
    const map = new Map();
    if (!board || !t) return map;
    const seen = {};
    let idx = 0;
    const segs = jobGetChainOrder(t, which, board);
    segs.forEach(function (seg) {
        jobSegPlacements(board, seg, which).forEach(function (p) {
            if (!p || !p.item) return;
            const k = jobPlacementKey(which, seg.key, p.r, p.c, p.item.seq);
            if (seen[k]) return;      // 数据异常导致段重叠时，去重避免重号
            seen[k] = true;
            idx++;
            map.set(k, idx);
        });
    });
    return map;
}
