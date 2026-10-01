
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
    shovel: 'static/button/铲子.webp',         // 铲子
    tapcell:'static/button/点击格子.webp'      // 点击格子（落子动作）
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

// ★ 「切换形态」：不在棋盘右侧按钮组里，而是从末端「更多」按钮的弹窗插入。
//   它是一个**带参数**的通用动作（槽位 1-8 + 点击次数）。
//   放在这里是为了让 jobGenericActionById / jobGenericActionOfKey 认它，
//   导出（27-jobset-board.js）和 chip 渲染才能正确识别为通用动作段。
const JOB_FORM_ACTION = {
    id: 'form', name: '切换形态', icon: '🔄', img: '',
    desc: '切换指定槽位植物的形态（可设点击次数）',
    // ★ 参数声明（见下方 JOB_PARAM_TYPES）—— UI / 导出 / 存盘 全部由它驱动，
    //   不再散落一堆 hasXxx / defaultXxx / xxxMax 字段。
    params: [
        { key: 'slot',  type: 'int', label: '槽位', min: 1, max: 8,  def: 1, prefix: '槽' },
        { key: 'times', type: 'int', label: '次数', min: 1, max: 20, def: 1, suffix: '次' }
    ]
};

// 可按 id 取到的全部通用动作（含不在按钮组里的「切换形态」）
const JOB_ALL_GENERIC_ACTIONS = JOB_GENERIC_ACTIONS.concat([JOB_FORM_ACTION]);

// ★ 「更多」列表里的动作 —— 即「不在按钮组、但可从更多进入」的动作。
//   新增一个就从这里加，列表 UI 自动渲染（无需改 HTML/弹窗代码）。
const JOB_MORE_ACTIONS = [JOB_FORM_ACTION];

// ============================================================
// ★ 「点击格子」—— 摆在棋盘上的落子动作（不是链上的通用动作）
//
//   与「切换形态」的区别：
//     · 切换形态 = 链上的通用动作（ga:form），没有格子
//     · 点击格子 = **棋盘落子**（key='tapcell'），落在哪个格子就点哪个格子
//
//   所以它需要：
//     · jobAllSlotKeys() 里有 'tapcell'（22-jobset-chain.js）
//     · 棋盘渲染认识它（27-jobset-board.js / 08-board-data.js）
//     · 链段导出时翻成 click:格子N_M（27-jobset-board.js）
//     · agent 端 dsl.py 的 chain_dsl 按 click 编译
//
//   ★ 它的定义（名称/图标/armedNo/dslType）**全部在 15-board-actions.js 的
//     注册表里** —— 本文件不再重复定义，避免两处不一致。
//     要改「点击格子」的任何展示信息，请去 15-board-actions.js。
// ============================================================

// ============================================================
// ★ 通用动作「参数」声明系统
// ------------------------------------------------------------
//   目的：新增一个带参数的通用动作时，**只改动作定义**即可 ——
//   弹窗 UI、chip 内联编辑、段字段存盘、导出 JSON 全部自动跟随。
//
//   参数项字段：
//     key     段上的字段名（如 'slot'），也是导出 JSON 的键
//     type    控件类型：'int'（数字框，默认）
//     label   弹窗里的标签文案
//     min/max 取值范围（UI 夹取 + 导出夹取都用它）
//     def     默认值（缺省/非法时回落）
//     prefix  显示在数值前的字（可选，如 '槽'）
//     suffix  显示在数值后的字（可选，如 '次'）
//     width   chip 里控件的宽度 px（可选，默认 34）
//
//   ★ 约定：**槽位类的参数请把 min 设成 1**（不要用夹取把越界退化成相邻值），
//     agent 端 dsl.py 对越界一律判无效，宁可不执行也不点错位置。
// ============================================================

// 取某个动作的参数声明（没有则返回空数组，调用方无需判空）
function jobActionParams(ga) {
    if (!ga || !Array.isArray(ga.params)) return [];
    return ga.params.filter(function (p) { return p && p.key; });
}

// 动作是否有参数
function jobActionHasParams(ga) {
    return jobActionParams(ga).length > 0;
}

// 把某个参数值夹到 [min, max]；非法/缺失时回落 def。
//   ★ 只在「有明确上限」时夹取（如次数）；槽位越界由 agent 端判无效。
function jobClampParam(p, v) {
    const def = (p.def === undefined || p.def === null) ? 0 : p.def;
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) n = def;
    if (p.min !== undefined && p.min !== null && n < p.min) n = p.min;
    if (p.max !== undefined && p.max !== null && n > p.max) n = p.max;
    return n;
}

// 从段上读出一个参数的当前值（缺失/非法 -> def）
function jobParamValue(seg, p) {
    if (!seg || !p) return p ? p.def : undefined;
    const raw = seg[p.key];
    if (raw === undefined || raw === null || raw === '') {
        return (p.def === undefined) ? null : p.def;
    }
    return jobClampParam(p, raw);
}

// 把一组参数值写成段字段（只写该动作声明的参数，不会塞进无关字段）
function jobApplyParamsToSeg(seg, ga, values) {
    if (!seg) return seg;
    jobActionParams(ga).forEach(function (p) {
        const v = (values && values[p.key] !== undefined) ? values[p.key] : jobParamValue(seg, p);
        if (v !== undefined && v !== null) seg[p.key] = jobClampParam(p, v);
    });
    return seg;
}

// 参数值的「身份串」—— 用于 jobStepId / 指纹 / uid 分组。
//   ★ 必须让「参数不同的两个段」得到不同的串，否则会撞成同一步。
function jobParamsIdentity(ga, seg) {
    const ps = jobActionParams(ga);
    if (!ps.length) return '';
    return ps.map(function (p) {
        const v = jobParamValue(seg, p);
        return (v === undefined || v === null) ? '' : (p.key.charAt(0) + v);
    }).join('');
}

// 参数的稳定键（用于 uid 分组配对：参数一样才算「同类动作」）
function jobParamsGroupKey(ga, seg) {
    const ps = jobActionParams(ga);
    if (!ps.length) return '';
    return ps.map(function (p) {
        const v = jobParamValue(seg, p);
        return p.key + '=' + ((v === undefined || v === null) ? '' : v);
    }).join('&');
}

// 参数的可读摘要（状态栏 / chip 用），如「槽3 丨 2次」
//   ★ 分隔符用「丨」（U+4E28，汉字竖笔）而不是「×」—— 用户要求的样式。
function jobParamsSummary(ga, seg) {
    const ps = jobActionParams(ga);
    if (!ps.length) return '';
    return ps.map(function (p) {
        const v = jobParamValue(seg, p);
        if (v === undefined || v === null) return '';
        return (p.prefix || '') + v + (p.suffix || '');
    }).filter(Boolean).join(' 丨 ');
}

// ============================================================
// ★ 参数控件工厂 —— 弹窗 与 chip 内联编辑 **共用同一套**。
//
//   jobBuildParamControl(p, value, opts)
//     p      参数声明（见 JOB_PARAM_TYPES 注释）
//     value  当前值
//     opts   { className, width, onChange(newValue), onEnter() }
//   返回一个 <input type="number">（当前只支持 int 型）。
//
//   ★ 两个必须记住的坑：
//     1) 全局 `input { width:100% }` 在 flex 行里会撑满整行，
//        把后面的勾选框 / ✕ 挤出 .seq-chain(overflow:hidden) 的可视区 ——
//        所以这里用内联样式锁死 width/min/max/flex-basis 四件套。
//     2) `type=number` 默认带上下箭头（spinner，约 16px）。用户要求删掉，
//        这里统一用内联样式关掉，避免哪天 CSS 类没加载上又冒出来。
// ============================================================
const JOB_PARAM_MIN_WIDTH = 26;

function jobBuildParamControl(p, value, opts) {
    opts = opts || {};
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = opts.className || 'seq-param-input';
    inp.min = String(p.min !== undefined && p.min !== null ? p.min : 0);
    if (p.max !== undefined && p.max !== null) inp.max = String(p.max);
    inp.step = '1';
    inp.value = String(jobParamValue({ [p.key]: value }, p));
    inp.title = (p.label || p.key)
        + (p.max !== undefined && p.max !== null ? '（' + p.min + '-' + p.max + '）' : '');
    inp.draggable = false;

    // ★ 宽度四件套 + 关掉 spinner（内联，优先级最高，不依赖外部 CSS）
    const w = Math.max(JOB_PARAM_MIN_WIDTH, opts.width || p.width || JOB_PARAM_MIN_WIDTH);
    inp.style.width = w + 'px';
    inp.style.minWidth = w + 'px';
    inp.style.maxWidth = w + 'px';
    inp.style.flex = '0 0 ' + w + 'px';
    inp.style.textAlign = 'center';
    inp.style.appearance = 'textfield';
    inp.style.MozAppearance = 'textfield';
    inp.style.WebkitAppearance = 'none';

    // 阻止拖动/勾选被输入框吃掉
    inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('change', function (e) {
        e.stopPropagation();
        const v = jobClampParam(p, inp.value);
        inp.value = String(v);
        if (opts.onChange) opts.onChange(v);
    });
    if (opts.onEnter) {
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.stopPropagation(); opts.onEnter(); }
        });
    }
    return inp;
}

// ★ 「等待」：不再是可插入的通用动作，但依然是合法的链段。
//   seg.ms = 毫秒数，导出成 BatchSwipe 的 sleep（秒）。
//   插入入口只有「某一步旁边的 ⏱」。
const JOB_WAIT_ACTION = {
    id: 'wait', name: '等待', icon: '⏱', img: '',
    desc: '等待指定毫秒（可精细到 1ms）', hasMs: true, defaultMs: 1000
};

// 通用动作的段前缀
const JOB_GA_PREFIX = 'ga:';

// 按 id 取动作定义（含「等待」和「切换形态」——它们仍是合法链段，只是不在按钮组里）
function jobGenericActionById(id) {
    if (id === JOB_WAIT_ACTION.id) return JOB_WAIT_ACTION;
    return JOB_ALL_GENERIC_ACTIONS.filter(function (a) { return a.id === id; })[0] || null;
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
//   为什么需要它：导出时 jobBuild 会把 t.boardLate 作为参数传进来建 boss 链，
//   而调用 jobGetChainOrder 的入口不只导出一条路径 ——
//   如果那块棋盘恰好不是当前正在编辑的全局 boardLate，靠 === 判断会误判成普通关，
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
