
// ============================================================
// 布局配置弹窗（34）—— 1-149 关的图层覆盖编辑
//
//   · 表列表 = 图层栈：上面的表优先盖住下面的表（先盖先赢）。
//   · 每张表的覆盖 = (区间 ∪ 相位 ∪ 散点) \ 排除，物化成 levels
//     （见 20-jobset-core.js 的 jobNormalizeCover）。
//   · 宫格点一下 = 当前表加这关；再点 = 去掉（从 picks 移除）。
//   · 5 的倍数 = BOSS 关：覆盖它 = 用这张表的 boss 配置；普通关照常。
//   · 某关没有任何表覆盖 = 不合法（保存时拦截，这里实时红字提示）。
// ============================================================

function jobLayoutModal() { return document.getElementById('layoutModal'); }

// ---------------- Ctrl+Z 撤回 ----------------
//   快照 = 整个 jobTables 深拷贝 + currentTable（覆盖/表名/层序/增删都能撤）。
//   只在弹窗打开期间累积，开弹窗时清空；上限 50 步。
let _lzUndo = [];

function jobLayoutSnap() {
    try {
        _lzUndo.push({
            cur: currentTable,
            tables: JSON.parse(JSON.stringify(jobTables))
        });
        if (_lzUndo.length > 50) _lzUndo.shift();
    } catch (e) { /* 快照失败就不撤，别打断操作 */ }
}

function jobLayoutUndo() {
    const s = _lzUndo.pop();
    if (!s) { setStatus('↩ 没有可撤回的布局操作'); return; }
    jobTables = s.tables;
    jobTables.forEach(function (t) { jobNormalizeCover(t); });
    currentTable = Math.min(s.cur, jobTables.length - 1);
    jobLoadTable(currentTable, true);      // skipSave：快照里的棋盘就是最新的
    jobSaveLocal();
    jobRenderLayout();
    setStatus('↩ 已撤回（还剩 ' + _lzUndo.length + ' 步可撤）');
}

function jobOpenLayout() {
    const m = jobLayoutModal();
    if (!m) return;
    _lzUndo = [];                // 撤回栈只在本次弹窗会话内有效
    _lzLastClick = 0;
    // ★ 旧档可能带叠加声称（早期图层版存的）：开弹窗时做一次全局去重，
    //   上面的表赢，下面的表把撞关让出来。
    jobTables.forEach(function (t) { jobNormalizeCover(t); });
    for (let i = 0; i < jobTables.length; i++) {
        const t2 = jobTables[i];
        const higher = {};
        for (let j = 0; j < i; j++) jobTables[j].levels.forEach(function (lv) { higher[lv] = 1; });
        const before = t2.cover.picks.length;
        t2.cover.picks = t2.cover.picks.filter(function (v) { return !higher[v]; });
        if (t2.cover.picks.length !== before) jobNormalizeCover(t2);
    }
    jobRenderLayout();
    m.classList.add('lz-open');
}
function jobCloseLayout() {
    const m = jobLayoutModal();
    if (m) m.classList.remove('lz-open');
    jobRenderTabs();            // 主界面的「当前表」标签跟着刷新
}

// ---------------- 列表（左栏：图层栈） ----------------

function jobRenderLayoutList() {
    const box = document.getElementById('lzList');
    if (!box) return;
    box.innerHTML = '';
    jobTables.forEach(function (t, i) {
        jobNormalizeCover(t);
        const row = document.createElement('div');
        row.className = 'lz-row' + (i === currentTable ? ' lz-row-active' : '');

        const name = document.createElement('span');
        name.className = 'lz-row-name';
        // 色块（与宫格同色）+ 画笔标记（当前表 = 手里的笔）
        name.innerHTML = '<span class="lz-chip" style="background:' + jobTableColor(i) + '"></span>'
            + (i === currentTable ? '🖌 ' : '') + jobTableName(i);
        name.title = '点击拿起这支笔（主界面跟着切过去）；双击改名';
        row.appendChild(name);

        const sub = document.createElement('span');
        sub.className = 'lz-row-sub';
        sub.textContent = jobCoverText(t);
        row.appendChild(sub);

        const ops = document.createElement('span');
        ops.className = 'lz-row-ops';
        const mk = function (txt, title, fn, danger) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lz-op' + (danger ? ' lz-op-danger' : '');
            b.textContent = txt;
            b.title = title;
            b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
            ops.appendChild(b);
        };
        mk('↑', '上移一层（更优先）', function () { jobLayoutMove(i, -1); });
        mk('↓', '下移一层（更靠后）', function () { jobLayoutMove(i, 1); });
        mk('✏️', '重命名', function () { jobLayoutRenameInline(i, row); });
        mk('✕', '删除这张表（Ctrl+Z 可撤回）', function () { jobLayoutDel(i); }, true);
        row.appendChild(ops);

        row.addEventListener('click', function () {
            if (i === currentTable) return;
            jobLoadTable(i);                 // 切表（含保存当前棋盘）
            jobSaveLocal();
            jobRenderLayout();
        });
        row.addEventListener('dblclick', function () { jobLayoutRenameInline(i, row); });
        box.appendChild(row);
    });
}

// 上移/下移一层（图层对调，覆盖关系随表走）
function jobLayoutMove(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= jobTables.length) return;
    jobLayoutSnap();
    jobSaveCurrentBoard();
    const tmp = jobTables[i];
    jobTables[i] = jobTables[j];
    jobTables[j] = tmp;
    if (currentTable === i) currentTable = j;
    else if (currentTable === j) currentTable = i;
    jobLoadTable(currentTable, true);
    jobSaveLocal();
    jobRenderLayout();
}

function jobLayoutDel(i) {
    if (jobTables.length <= 1) { setStatus('⚠ 至少保留一张表'); return; }
    // 不弹确认：删错了 Ctrl+Z 一步撤回
    jobLayoutSnap();
    jobSaveCurrentBoard();
    const nm = jobTableName(i);
    jobTables.splice(i, 1);
    currentTable = Math.min(currentTable, jobTables.length - 1);
    jobLoadTable(currentTable, true);
    jobSaveLocal();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
    jobRenderLayout();
    setStatus('🗑 已删除 ' + nm + '（Ctrl+Z 可撤回）');
}

function jobLayoutAdd() {
    jobLayoutSnap();
    jobSaveCurrentBoard();
    const t = jobNewTable();                 // 已把 currentTable 切到新表（新表默认空覆盖）
    jobLoadTable(jobTables.length - 1, true);   // skipSave：新表棋盘是空的
    jobSaveLocal();
    jobRenderLayout();
    // ★ 创建即命名：直接给新表弹出行内改名框（留空提交 = 默认「表N」）
    const rows = document.querySelectorAll('#lzList .lz-row');
    const row = rows[rows.length - 1];
    if (row) jobLayoutRenameInline(jobTables.length - 1, row);
    setStatus('✅ 已新建一张表（输入名字或留空用默认「表' + jobTables.length + '」），然后在右侧圈关');
}

// ---------------- 独占覆盖：当前表盖到的关，直接从其它表抢过来 ----------------
//   用户语义：「选中这个表，盖到谁就覆盖谁」—— 不允许两张表声称同一关，
//   所以当前表每次变更后，把它的 levels 从其它所有表的 picks 里抠掉。
function jobLayoutSteal() {
    const cur = jobTables[currentTable];
    if (!cur) return;
    jobNormalizeCover(cur);
    if (!cur.levels.length) return;
    const mine = {};
    cur.levels.forEach(function (lv) { mine[lv] = 1; });
    jobTables.forEach(function (t2, i) {
        if (i === currentTable || !t2) return;
        const before = t2.cover.picks.length;
        t2.cover.picks = t2.cover.picks.filter(function (v) { return !mine[v]; });
        if (t2.cover.picks.length !== before) jobNormalizeCover(t2);
    });
}

// ---------------- 多选模式（开启后拖动 = 拖两端选中整段） ----------------

let _lzMulti = false;
let _lzErase = false;    // 橡皮擦模式：涂到谁就把谁（归属表）的那关擦掉
let _lzSpan = null;      // 拖动多选状态 {a: 起笔关, b: 当前关}，null=没在拖；松手整段反选

function jobRenderLayoutMulti() {
    const b = document.getElementById('lzMulti');
    if (!b) return;
    b.classList.toggle('lz-multi-on', _lzMulti);
    b.textContent = _lzMulti
        ? (_lzErase ? '🔢 多选模式：开（拖动 = 整段擦除）' : '🔢 多选模式：开（拖动 = 整段反选）')
        : '🔢 多选模式：关';
}

function jobRenderLayoutErase() {
    const b = document.getElementById('lzErase');
    if (!b) return;
    b.classList.toggle('lz-erase-on', _lzErase);
    b.textContent = _lzErase ? '🧽 橡皮擦：开（涂到谁擦谁）' : '🧽 橡皮擦：关';
    const g = document.getElementById('lzGrid');
    if (g) g.classList.toggle('lz-erase-mode', _lzErase);
}

// 擦掉第 n 关的覆盖（从归属表的 picks 里抠；没人覆盖就无事发生）
function jobLayoutEraseCell(n) {
    const owner = jobLevelOwner(n);
    if (owner === -1) return;
    const t2 = jobTables[owner];
    t2.cover.picks = t2.cover.picks.filter(function (v) { return v !== n; });
    jobNormalizeCover(t2);
}

// 拖动多选的即时高亮：[a,b] 整段打预览框（松手后统一重绘成正式色）
function jobLayoutSpanTick(n) {
    if (!_lzSpan) return;
    _lzSpan.b = n;
    const box = document.getElementById('lzGrid');
    if (!box) return;
    const lo = Math.min(_lzSpan.a, _lzSpan.b), hi = Math.max(_lzSpan.a, _lzSpan.b);
    const cells = box.children;
    for (let i = 0; i < cells.length; i++) {
        const lv = i + 1;
        cells[i].classList.remove('lz-span');
        if (lv >= lo && lv <= hi) cells[i].classList.add('lz-span');
    }
}

// 松手：把拖出的整段处理掉（橡皮擦开着 = 整段擦除，否则 = 整段反选）
function jobLayoutSpanEnd() {
    if (!_lzSpan) return;
    const s = _lzSpan;
    _lzSpan = null;
    jobLayoutSnap();
    const lo = Math.min(s.a, s.b || s.a), hi = Math.max(s.a, s.b || s.a);
    for (let i = lo; i <= hi; i++) {
        if (_lzErase) jobLayoutEraseCell(i);
        else jobLayoutInvertCell(i);
    }
    _lzLastClick = hi;
    jobLayoutChanged();
}

// ---------------- 指定覆盖（公式选关） ----------------
//   规则：关卡 L 被选中 ⟺ 存在正整数 x（1,2,3…）使 f(x)=L。
//   例：5x=BOSS关，5x-1=BOSS前一关，5x+1=BOSS后一关，2x=偶数关，x^2=平方关，x=全部。

// 安全的表达式解析（递归下降；支持 + - * / ^ ( ) x、数字、隐式乘法如 5x / 2(x+1)）
function jobParseFx(src) {
    const s = String(src || '').replace(/\s+/g, '');
    if (!s) return null;
    let pos = 0;
    function peek() { return s[pos]; }
    function eat(ch) { if (s[pos] === ch) { pos++; return true; } return false; }
    // 判断当前位置是否能开始一个 primary（用于隐式乘法）
    function startsPrimary() {
        const c = s[pos];
        return c === 'x' || c === '(' || (c >= '0' && c <= '9') || c === '.';
    }
    function parseExpr() {          // expr := term (('+'|'-') term)*
        let v = parseTerm();
        if (v === null) return null;
        while (peek() === '+' || peek() === '-') {
            const op = s[pos++];
            const r = parseTerm();
            if (r === null) return null;
            v = (op === '+') ? v + r : v - r;
        }
        return v;
    }
    function parseTerm() {          // term := factor (( '*'|'/'|隐式 ) factor)*
        let v = parseFactor();
        if (v === null) return null;
        for (;;) {
            if (eat('*')) { const r = parseFactor(); if (r === null) return null; v *= r; }
            else if (eat('/')) { const r = parseFactor(); if (r === null || r === 0) return null; v /= r; }
            else if (startsPrimary()) { const r = parseFactor(); if (r === null) return null; v *= r; }  // 5x
            else break;
        }
        return v;
    }
    function parseFactor() {        // factor := primary ('^' factor)?   （右结合）
        const base = parsePrimary();
        if (base === null) return null;
        if (eat('^')) {
            const ex = parseFactor();
            if (ex === null) return null;
            return Math.pow(base, ex);
        }
        return base;
    }
    function parsePrimary() {       // primary := 数 | x | '(' expr ')' | '-' primary | '+' primary
        if (eat('-')) { const v = parsePrimary(); return v === null ? null : -v; }
        if (eat('+')) return parsePrimary();
        if (eat('x')) return _fx;
        if (eat('(')) {
            const v = parseExpr();
            if (v === null || !eat(')')) return null;
            return v;
        }
        let m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(pos));
        if (!m) return null;
        pos += m[0].length;
        return parseFloat(m[0]);
    }
    let _fx = 0;
    const f = function (x) { _fx = x; pos = 0; const v = parseExpr(); return (pos === s.length) ? v : null; };
    // 试算一次确认能跑通
    const t0 = f(1);
    return (t0 === null || typeof t0 !== 'number' || !isFinite(t0)) ? null : f;
}

// 公式 -> 1..149 中被覆盖的关卡列表；解析失败返回 null
function jobFxLevels(expr) {
    const f = jobParseFx(expr);
    if (!f) return null;
    const out = [];
    for (let x = 1; x <= JOB_MAX_LV; x++) {
        const v = f(x);
        if (v === null || !isFinite(v)) continue;
        if (Math.abs(v - Math.round(v)) > 1e-9) continue;   // 非整数不算关
        const L = Math.round(v);
        if (L >= 1 && L <= JOB_MAX_LV && out.indexOf(L) === -1) out.push(L);
    }
    return out.sort(function (a, b) { return a - b; });
}

// 应用公式：把命中的关加入当前表（抢夺语义照旧走 jobLayoutChanged）
function jobLayoutApplyFx(expr, fromLabel) {
    const lv = jobFxLevels(expr);
    if (lv === null) { setStatus('⚠ 表达式看不懂：' + expr); return; }
    if (!lv.length) { setStatus('⚠ 「' + expr + '」在 1-149 里没有命中任何关'); return; }
    jobLayoutSnap();
    const t = jobTables[currentTable];
    lv.forEach(function (n) { if (t.cover.picks.indexOf(n) === -1) t.cover.picks.push(n); });
    jobLayoutChanged();
    setStatus('🎯 ' + (fromLabel || expr) + ' → ' + jobTableName(currentTable) + ' 覆盖 ' + lv.length + ' 关（Ctrl+Z 可撤回）');
}

function jobRenderFxPreview() {
    const inp = document.getElementById('lzFxInput');
    const pv = document.getElementById('lzFxPreview');
    if (!inp || !pv) return;
    const expr = inp.value.trim();
    if (!expr) { pv.textContent = '输入表达式，例如 5x+1'; pv.className = 'lz-fx-preview'; return; }
    const lv = jobFxLevels(expr);
    if (lv === null) { pv.textContent = '✗ 表达式看不懂'; pv.className = 'lz-fx-preview lz-fx-bad'; return; }
    if (!lv.length) { pv.textContent = '✗ 没有命中任何关'; pv.className = 'lz-fx-preview lz-fx-bad'; return; }
    const head = lv.slice(0, 20).join(', ');
    pv.textContent = '✓ 命中 ' + lv.length + ' 关：' + head + (lv.length > 20 ? ' …' : '');
    pv.className = 'lz-fx-preview lz-fx-ok';
}

// 公式弹窗三级视图切换：choices（选模式）/ baby / pro
function jobFxShow(view) {
    const map = { choices: 'lzFxChoices', baby: 'lzFxBaby', pro: 'lzFxPro' };
    Object.keys(map).forEach(function (k) {
        const el = document.getElementById(map[k]);
        if (el) el.style.display = (k === view) ? '' : 'none';
    });
    if (view === 'pro') {
        const inp = document.getElementById('lzFxInput');
        if (inp) { jobRenderFxPreview(); inp.focus(); }
    }
}

function jobOpenFormula() {
    const m = document.getElementById('lzFormulaModal');
    if (!m) return;
    jobFxShow('choices');
    m.classList.add('lz-open');
}
function jobCloseFormula() {
    const m = document.getElementById('lzFormulaModal');
    if (m) m.classList.remove('lz-open');
}

function jobBindFormula() {
    const open = document.getElementById('lzFormulaBtn');
    if (open) open.addEventListener('click', jobOpenFormula);
    const m = document.getElementById('lzFormulaModal');
    if (!m) return;
    const done = document.getElementById('lzFxClose');
    if (done) done.addEventListener('click', jobCloseFormula);
    m.addEventListener('click', function (e) { if (e.target === m) jobCloseFormula(); });
    // 一级：选模式；二级：返回
    const pickBaby = document.getElementById('lzFxPickBaby');
    if (pickBaby) pickBaby.addEventListener('click', function () { jobFxShow('baby'); });
    const pickPro = document.getElementById('lzFxPickPro');
    if (pickPro) pickPro.addEventListener('click', function () { jobFxShow('pro'); });
    m.querySelectorAll('[data-fxback]').forEach(function (b) {
        b.addEventListener('click', function () { jobFxShow('choices'); });
    });
    // 宝宝模式三个快捷项
    const baby = [
        ['lzFxBoss', '5x', '覆盖 BOSS 关'],
        ['lzFxBossPre', '5x-1', '覆盖 BOSS 前一关'],
        ['lzFxBossPost', '5x+1', '覆盖 BOSS 后一关']
    ];
    baby.forEach(function (cfg) {
        const b = document.getElementById(cfg[0]);
        if (!b) return;
        b.addEventListener('click', function () {
            const inp = document.getElementById('lzFxInput');
            if (inp) { inp.value = cfg[1]; jobRenderFxPreview(); }
            jobLayoutApplyFx(cfg[1], cfg[2]);
        });
    });
    // 大佬模式：输入预览 + 应用
    const inp = document.getElementById('lzFxInput');
    if (inp) {
        inp.addEventListener('input', jobRenderFxPreview);
        inp.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') jobLayoutApplyFx(inp.value.trim());
            if (e.key === 'Escape') jobCloseFormula();
        });
    }
    const apply = document.getElementById('lzFxApply');
    if (apply) apply.addEventListener('click', function () {
        const v = document.getElementById('lzFxInput');
        if (v) jobLayoutApplyFx(v.value.trim());
    });
}

// ---------------- 宫格（画笔模式：点表=拿笔，按住拖动=涂色/擦除） ----------------



// 每表一个固定色（colorIdx 随表走：删表不复位、调层不变色、新建复用最小空位）
const LZ_PALETTE = ['#2d7aff', '#16a34a', '#ea580c', '#9333ea', '#0891b2',
                    '#dc2626', '#ca8a04', '#db2777', '#4f46e5', '#65a30d'];
function jobTableColor(i) {
    const t = jobTables[i];
    const idx = (t && Number.isInteger(t.colorIdx)) ? t.colorIdx : i;
    return LZ_PALETTE[idx % LZ_PALETTE.length];
}

let _lzLastClick = 0;      // shift 连选的锚点（上次点击的关卡）
let _lzPaint = null;       // 涂抹状态 {done:{}}，null=没在涂；反选语义：每格一次手势只翻一次

// 把第 n 关设为「当前表覆盖 / 不覆盖」（picks 语义收口在这里）
function jobLayoutSetCell(n, wantOn) {
    const t = jobTables[currentTable];
    if (!t) return;
    const covered = t.levels.indexOf(n) !== -1;
    if (wantOn === covered) return;                 // 没变化
    if (covered) {
        t.cover.picks = t.cover.picks.filter(function (v) { return v !== n; });
    } else {
        if (t.cover.picks.indexOf(n) === -1) t.cover.picks.push(n);
    }
    jobNormalizeCover(t);
}

// ★ 反选第 n 关：有 = 去掉，没有 = 加上
function jobLayoutInvertCell(n) {
    const t = jobTables[currentTable];
    if (!t) return;
    jobLayoutSetCell(n, t.levels.indexOf(n) === -1);
}

// 拖动涂抹中的即时视觉反馈（数据已改，样式先临时刻上去，松手后统一重绘）
function jobLayoutPaintTick(cell, n) {
    if (_lzPaint.done[n]) return;                   // 同一笔里来回拖不反复翻
    _lzPaint.done[n] = 1;
    if (_lzPaint.erase) {
        // 橡皮擦：擦掉归属表的这关
        jobLayoutEraseCell(n);
        cell.classList.remove('lz-paint-on', 'lz-paint-off');
        cell.classList.add('lz-paint-off');
        return;
    }
    jobLayoutInvertCell(n);
    const nowOn = jobTables[currentTable].levels.indexOf(n) !== -1;
    cell.classList.remove('lz-paint-on', 'lz-paint-off');
    cell.classList.add(nowOn ? 'lz-paint-on' : 'lz-paint-off');
}

function jobRenderLayoutGrid() {
    const box = document.getElementById('lzGrid');
    if (!box) return;
    box.innerHTML = '';
    const t = jobTables[currentTable];
    if (t) jobNormalizeCover(t);
    for (let lv = 1; lv <= 149; lv++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        const isBoss = lv % 5 === 0;
        const owner = jobLevelOwner(lv);
        let cls = 'lz-cell';
        let tip = '第 ' + lv + ' 关';
        if (isBoss) { cls += ' lz-cell-boss'; tip += '（BOSS，走该表 boss 配置）'; }
        if (owner !== -1) {
            // ★ 全图着色：谁的就是谁的颜色；当前表的格子加亮边
            cell.style.background = jobTableColor(owner);
            if (!isBoss) cell.style.borderColor = jobTableColor(owner);   // BOSS 格保留金框
            cell.style.color = '#fff';
            cls += (owner === currentTable) ? ' lz-cell-cur' : ' lz-cell-other';
            tip += '｜' + jobTableName(owner) + ' 覆盖中';
            // 角标：属于第几张表
            const badge = document.createElement('span');
            badge.className = 'lz-badge';
            badge.textContent = owner + 1;
            badge.style.background = jobTableColor(owner);
            cell.textContent = lv;
            cell.appendChild(badge);
        } else {
            cls += ' lz-cell-free';
            tip += '｜无人覆盖';
            cell.textContent = lv;
        }
        cell.className = cls;
        cell.title = tip;
        cell.addEventListener('mousedown', (function (n, el) {
            return function (ev) {
                ev.preventDefault();
                const tt = jobTables[currentTable];
                if (!tt) return;
                // shift+点 = 从锚点连选一段（橡皮擦开着 = 整段擦除，否则整段反选）
                if (ev.shiftKey && _lzLastClick >= 1) {
                    jobLayoutSnap();
                    const a = Math.min(_lzLastClick, n), b = Math.max(_lzLastClick, n);
                    for (let i = a; i <= b; i++) {
                        if (_lzErase) jobLayoutEraseCell(i);
                        else jobLayoutInvertCell(i);
                    }
                    _lzLastClick = n;
                    jobLayoutChanged();
                    return;
                }
                // ★ 多选模式：起笔 = 拖段选择（松手才整段反选）
                if (_lzMulti) {
                    _lzSpan = { a: n, b: n };
                    jobLayoutSpanTick(n);
                    return;
                }
                // ★ 普通涂抹：起笔反选这一格，拖到哪儿反选到哪儿
                //   （橡皮擦模式下 = 擦掉归属表的覆盖）
                jobLayoutSnap();
                _lzPaint = { done: {}, erase: _lzErase };
                _lzLastClick = n;
                jobLayoutPaintTick(el, n);
            };
        })(lv, cell));
        cell.addEventListener('mouseenter', (function (n, el) {
            return function () {
                if (_lzSpan) jobLayoutSpanTick(n);
                else if (_lzPaint) jobLayoutPaintTick(el, n);
            };
        })(lv, cell));
        box.appendChild(cell);
    }
}

// 松手：结束涂抹/拖段，统一落盘 + 重绘
function jobLayoutPaintEnd() {
    if (_lzSpan) { jobLayoutSpanEnd(); return; }
    if (!_lzPaint) return;
    _lzPaint = null;
    jobLayoutChanged();
}

// 一键补齐：未覆盖的关全给当前表
function jobLayoutFillRest() {
    const t = jobTables[currentTable];
    if (!t) return;
    const rest = jobUncoveredLevels();
    if (!rest.length) { setStatus('✅ 已经全部覆盖，没有要补的'); return; }
    jobLayoutSnap();
    rest.forEach(function (lv) {
        if (t.cover.picks.indexOf(lv) === -1) t.cover.picks.push(lv);
    });
    jobLayoutChanged();
    setStatus('🧹 已把 ' + rest.length + ' 个未覆盖关补给 ' + jobTableName(currentTable));
}

// 清空当前表的覆盖（空出来的关会标红，可用旁边的「未覆盖的全给当前表」补给别人）
function jobLayoutClearCur() {
    const t = jobTables[currentTable];
    if (!t) return;
    if (!t.levels.length) { setStatus('当前表本来就没有覆盖任何关'); return; }
    // 不弹确认：Ctrl+Z 一步撤回
    jobLayoutSnap();
    t.cover.picks = [];
    jobLayoutChanged();
    setStatus('🧽 已清空 ' + jobTableName(currentTable) + ' 的覆盖（Ctrl+Z 可撤回）');
}

// 行内重命名：把表名换成输入框，Enter/失焦提交，Esc 取消
function jobLayoutRenameInline(i, row) {
    const t = jobTables[i];
    if (!t) return;
    const nameEl = row.querySelector('.lz-row-name');
    if (!nameEl || nameEl.querySelector('input')) return;
    const chipHtml = '<span class="lz-chip" style="background:' + jobTableColor(i) + '"></span>';
    nameEl.innerHTML = chipHtml;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'lz-rename-input';
    inp.value = t.label || '';
    inp.placeholder = '表' + (i + 1);
    inp.maxLength = 20;
    nameEl.appendChild(inp);
    inp.focus();
    inp.select();
    let done = false;
    const commit = function (save) {
        if (done) return;
        done = true;
        if (save) {
            jobLayoutSnap();
            t.label = inp.value.trim();
            jobSaveLocal();
        }
        jobRenderLayout();
    };
    inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
    });
    inp.addEventListener('blur', function () { commit(true); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
}

// ---------------- 统计 / 警告 ----------------

function jobRenderLayoutStat() {
    const stat = document.getElementById('lzStat');
    const warn = document.getElementById('lzWarn');
    const t = jobTables[currentTable];
    const uncovered = jobUncoveredLevels();
    if (stat) {
        stat.textContent = (t ? ('当前表覆盖 ' + t.levels.length + ' 关 · ') : '')
            + (uncovered.length ? ('⚠ 未覆盖 ' + uncovered.length + ' 关') : '✅ 1-149 已全部覆盖');
        stat.className = 'lz-stat' + (uncovered.length ? ' lz-stat-bad' : ' lz-stat-ok');
    }
    if (warn) {
        warn.textContent = uncovered.length
            ? ('未覆盖：' + uncovered.slice(0, 20).join('、') + (uncovered.length > 20 ? ' …' : '') + ' —— 保存前必须铺满')
            : '';
    }
}

// ---------------- 总渲染 / 变更 ----------------

function jobRenderLayout() {
    jobRenderLayoutList();
    jobRenderLayoutMulti();
    jobRenderLayoutErase();
    jobRenderLayoutGrid();
    jobRenderLayoutStat();
}

// 覆盖变了：物化 → 从其它表把撞关抢过来（独占覆盖）→ 重绘 → 存本地
function jobLayoutChanged() {
    jobLayoutSteal();
    jobSaveLocal();
    jobRenderLayout();
}

// ---------------- 绑定 ----------------

function jobBindLayout() {
    const m = jobLayoutModal();
    if (!m) return;
    const open = document.getElementById('jobLayoutBtn');
    if (open) open.addEventListener('click', jobOpenLayout);
    const close = document.getElementById('lzClose');
    if (close) close.addEventListener('click', jobCloseLayout);
    const done = document.getElementById('lzDone');
    if (done) done.addEventListener('click', jobCloseLayout);
    m.addEventListener('click', function (e) { if (e.target === m) jobCloseLayout(); });
    document.addEventListener('keydown', function (e) {
        if (!m.classList.contains('lz-open')) return;
        if (e.key === 'Escape') {
            // 公式弹窗开着：二级界面先退回选模式，一级才关弹窗
            const fx = document.getElementById('lzFormulaModal');
            if (fx && fx.classList.contains('lz-open')) {
                const ch = document.getElementById('lzFxChoices');
                if (ch && ch.style.display === 'none') jobFxShow('choices');
                else jobCloseFormula();
                return;
            }
            jobCloseLayout();
            return;
        }
        // ★ Ctrl+Z 撤回（输入框里的 Ctrl+Z 还给浏览器自己）
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            jobLayoutUndo();
        }
    });

    const add = document.getElementById('lzAddTable');
    if (add) add.addEventListener('click', jobLayoutAdd);

    // 多选模式开关（可与橡皮擦复合：多选+橡皮 = 拖段擦除）
    const multi = document.getElementById('lzMulti');
    if (multi) multi.addEventListener('click', function () {
        _lzMulti = !_lzMulti;
        jobRenderLayoutMulti();
    });

    // 橡皮擦开关（可与多选复合）
    const er = document.getElementById('lzErase');
    if (er) er.addEventListener('click', function () {
        _lzErase = !_lzErase;
        jobRenderLayoutErase();
        jobRenderLayoutMulti();      // 多选按钮文案跟着组合状态变
    });

    // 涂抹：松手收尾（在弹窗任何位置/弹窗外松手都算）
    document.addEventListener('mouseup', jobLayoutPaintEnd);

    // 一键补齐 / 清空当前
    const fill = document.getElementById('lzFillRest');
    if (fill) fill.addEventListener('click', jobLayoutFillRest);
    const clr = document.getElementById('lzClearCur');
    if (clr) clr.addEventListener('click', jobLayoutClearCur);

    // 指定覆盖（公式选关）弹窗
    jobBindFormula();
}
