// ============================================================
// 自定义动作（「更多」-> 自定义动作）
//
//   从坐标表（agent/assets/resource/coords.json，经 GET /coords）挑键名，
//   自由组合四种动作：
//     点击  click:键名
//     滑动  swipe:起点,终点,ms
//     长按  swipe:键名,键名,ms   （滑自身，时长 = 长按时间）
//     多指  multi:(f1,t1,ms;f2,t2,ms;…)  （2~5 指，同时按下/移动/抬起）
//
//   段形状（白名单维护点见 24-jobset-fields.js 的 JOB_CUSTOM_ACTION 注释）：
//     { key:'ga:custom', ga:'custom', act, from, to, ms, pairs:[[f,t],…] }
//
//   运行时由 dsl.py generic_dsl 的 'custom' 分支编译成 BatchSwipe DSL。
// ============================================================

// 坐标表缓存（每次打开弹窗重新拉，用户可能刚改过 coords.json）
let _jobCoordsCache = null;
let _jobCoordsLoading = null;

function jobFetchCoords() {
    if (_jobCoordsCache) return Promise.resolve(_jobCoordsCache);
    if (_jobCoordsLoading) return _jobCoordsLoading;
    _jobCoordsLoading = fetch('/coords')
        .then(function (r) { return r.json(); })
        .then(function (d) {
            _jobCoordsCache = (d && d.coords) || {};
            return _jobCoordsCache;
        })
        .catch(function () { _jobCoordsCache = {}; return _jobCoordsCache; })
        .finally(function () { _jobCoordsLoading = null; });
    return _jobCoordsLoading;
}

// ---- 弹窗状态 ----
let jobCustomAct = 'click';        // click / swipe / hold / multi
let _cpFingerCount = 2;            // 多指手指数（2~5）

const JOB_CUSTOM_TYPES = [
    { id: 'click', name: '点击', tip: '' },
    { id: 'swipe', name: '滑动', tip: '' },
    { id: 'hold',  name: '长按', tip: '长按 = 坐标滑到自身，滑动时长即长按时间' },
    { id: 'multi', name: '多指', tip: '多根手指同时按下→滑动→抬起（2~5 指）' },
];

function jobOpenCustomPicker() {
    const modal = document.getElementById('customPicker');
    if (!modal) return;
    jobGenTarget = 'once';                       // 与通用动作弹窗共用目标链状态
    jobCustomAct = 'click';
    _cpFingerCount = 2;
    jobRenderCustomTypes();
    jobRenderCustomFields();
    jobRenderCustomTarget();
    const tip = document.getElementById('cpInserted');
    if (tip) tip.textContent = '';
    modal.classList.add('cp-open');
    // 拉坐标表（可能正在加载，加载完重画一次字段）
    jobFetchCoords().then(function () { jobRenderCustomFields(); });
}

function jobCloseCustomPicker() {
    const modal = document.getElementById('customPicker');
    if (modal) modal.classList.remove('cp-open');
}

function jobRenderCustomTarget() {
    const el = document.getElementById('cpChain');
    if (!el) return;
    const meta = JOB_CHAIN_META[jobGenTarget] || JOB_CHAIN_META.once;
    el.textContent = meta.icon + ' ' + meta.label;
}

function jobRenderCustomTypes() {
    const box = document.getElementById('cpTypes');
    if (!box) return;
    box.innerHTML = '';
    JOB_CUSTOM_TYPES.forEach(function (tp) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-type' + (tp.id === jobCustomAct ? ' on' : '');
        b.textContent = tp.name;
        b.addEventListener('click', function () {
            jobCustomAct = tp.id;
            jobRenderCustomTypes();
            jobRenderCustomFields();
        });
        box.appendChild(b);
    });
}

// 造一个「键名下拉 + 右侧 [x,y] 预览」的行
//   ★ 不分类：按 coords.json 原顺序平铺（用户要求直接提供坐标表内容）
function _cpCoordRow(labelText, coords) {
    const row = document.createElement('div');
    row.className = 'cp-row';
    const lb = document.createElement('span');
    lb.className = 'cp-row-label';
    lb.textContent = labelText;
    row.appendChild(lb);

    const sel = document.createElement('select');
    sel.className = 'cp-sel';
    Object.keys(coords || {}).forEach(function (k) {
        const op = document.createElement('option');
        op.value = k;
        op.textContent = k;
        sel.appendChild(op);
    });
    row.appendChild(sel);

    const xy = document.createElement('span');
    xy.className = 'cp-xy';
    const show = function () {
        const v = coords[sel.value];
        xy.textContent = (Array.isArray(v) && v.length >= 2) ? ('[' + v[0] + ',' + v[1] + ']') : '';
    };
    sel.addEventListener('change', show);
    row.appendChild(xy);
    show();
    row._sel = sel;
    return row;
}

function _cpMsRow(labelText, def) {
    const row = document.createElement('div');
    row.className = 'cp-row';
    const lb = document.createElement('span');
    lb.className = 'cp-row-label';
    lb.textContent = labelText;
    row.appendChild(lb);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'cp-ms';
    inp.min = '50'; inp.step = '50';
    inp.value = String(def || 600);
    row.appendChild(inp);
    const unit = document.createElement('span');
    unit.className = 'cp-xy';
    unit.textContent = 'ms';
    row.appendChild(unit);
    row._inp = inp;
    return row;
}

function jobRenderCustomFields() {
    const box = document.getElementById('cpFields');
    if (!box) return;
    box.innerHTML = '';
    const coords = _jobCoordsCache || {};
    if (!Object.keys(coords).length) {
        const tip = document.createElement('div');
        tip.className = 'cp-tip';
        tip.textContent = '坐标表加载中（或为空）… 若一直空白请检查 agent/assets/resource/coords.json';
        box.appendChild(tip);
        box._rows = [];
        return;
    }

    const rows = [];
    const tp = JOB_CUSTOM_TYPES.filter(function (t) { return t.id === jobCustomAct; })[0];
    if (tp && tp.tip) {
        const tip = document.createElement('div');
        tip.className = 'cp-tip';
        tip.textContent = tp.tip;
        box.appendChild(tip);
    }

    if (jobCustomAct === 'click' || jobCustomAct === 'hold') {
        const r = _cpCoordRow('坐标', coords);
        box.appendChild(r);
        rows.push({ role: 'from', row: r });
        if (jobCustomAct === 'hold') {
            const mr = _cpMsRow('长按时间', 800);
            box.appendChild(mr);
            rows.push({ role: 'ms', row: mr });
        }
    } else if (jobCustomAct === 'swipe') {
        const r1 = _cpCoordRow('起点', coords);
        const r2 = _cpCoordRow('终点', coords);
        box.appendChild(r1); box.appendChild(r2);
        rows.push({ role: 'from', row: r1 }, { role: 'to', row: r2 });
        const mr = _cpMsRow('滑动时长', 600);
        box.appendChild(mr);
        rows.push({ role: 'ms', row: mr });
    } else if (jobCustomAct === 'multi') {
        // 手指数控制（2~5）
        const ctl = document.createElement('div');
        ctl.className = 'cp-finger-ctl';
        const minus = document.createElement('button');
        minus.type = 'button'; minus.className = 'cp-finger-btn'; minus.textContent = '−';
        const num = document.createElement('span');
        num.className = 'cp-finger-n';
        num.textContent = _cpFingerCount + ' 指';
        const plus = document.createElement('button');
        plus.type = 'button'; plus.className = 'cp-finger-btn'; plus.textContent = '＋';
        minus.addEventListener('click', function () {
            if (_cpFingerCount > 2) { _cpFingerCount--; jobRenderCustomFields(); }
        });
        plus.addEventListener('click', function () {
            if (_cpFingerCount < 5) { _cpFingerCount++; jobRenderCustomFields(); }
        });
        const lb = document.createElement('span');
        lb.className = 'cp-row-label';
        lb.textContent = '手指数';
        ctl.appendChild(lb); ctl.appendChild(minus); ctl.appendChild(num); ctl.appendChild(plus);
        box.appendChild(ctl);

        for (let i = 0; i < _cpFingerCount; i++) {
            const r1 = _cpCoordRow('指' + (i + 1) + '起', coords);
            const r2 = _cpCoordRow('指' + (i + 1) + '终', coords);
            box.appendChild(r1); box.appendChild(r2);
            rows.push({ role: 'pair' + i + 'a', row: r1 }, { role: 'pair' + i + 'b', row: r2 });
        }
        const mr = _cpMsRow('滑动时长', 300);
        box.appendChild(mr);
        rows.push({ role: 'ms', row: mr });
    }
    box._rows = rows;
}

// 从字段区读出当前配置 -> 段对象（无效返回 null 并提示）
function _cpBuildSeg() {
    const box = document.getElementById('cpFields');
    const rows = (box && box._rows) || [];
    const val = function (role) {
        const r = rows.filter(function (x) { return x.role === role; })[0];
        return r ? (r.row._sel ? r.row._sel.value : (r.row._inp ? r.row._inp.value : '')) : '';
    };
    const seg = { key: 'ga:custom', ga: 'custom', act: jobCustomAct };
    const ms = parseInt(val('ms'), 10);

    if (jobCustomAct === 'click') {
        seg.from = val('from');
        if (!seg.from) { setStatus('⚠️ 请选择一个坐标键'); return null; }
    } else if (jobCustomAct === 'hold') {
        seg.from = val('from');
        seg.ms = (isFinite(ms) && ms > 0) ? ms : 800;
        if (!seg.from) { setStatus('⚠️ 请选择一个坐标键'); return null; }
    } else if (jobCustomAct === 'swipe') {
        seg.from = val('from'); seg.to = val('to');
        seg.ms = (isFinite(ms) && ms > 0) ? ms : 600;
        if (!seg.from || !seg.to) { setStatus('⚠️ 请选择起点和终点'); return null; }
    } else if (jobCustomAct === 'multi') {
        seg.pairs = [];
        for (let i = 0; i < _cpFingerCount; i++) {
            const a = val('pair' + i + 'a'), b = val('pair' + i + 'b');
            if (a && b) seg.pairs.push([a, b]);
        }
        if (seg.pairs.length < 2) { setStatus('⚠️ 多指至少需要 2 组有效坐标对'); return null; }
        seg.ms = (isFinite(ms) && ms > 0) ? ms : 300;
    }
    return seg;
}

function jobConfirmCustomPicker() {
    const t = jobTables[currentTable];
    if (!t) return;
    const seg = _cpBuildSeg();
    if (!seg) return;

    const board = jobIsBossBoard() ? boardLate : boardEarly;
    let which = jobGenTarget;
    if (jobIsBossBoard() && which === 'end') which = 'loop';
    jobGenTarget = which;
    const field = jobChainField(which, board);
    if (!Array.isArray(t[field])) t[field] = [];

    t[field].push(seg);
    jobSaveLocal();
    if (typeof jobRenderSeqChains === 'function') jobRenderSeqChains();

    // 弹窗不关，可连续插入（与通用动作弹窗一致）
    const meta = JOB_CHAIN_META[which] || JOB_CHAIN_META.once;
    const used = t[field].filter(function (s) { return s && s.key === 'ga:custom'; }).length;
    const tip = document.getElementById('cpInserted');
    if (tip) tip.textContent = '✅ 已插入到「' + meta.label + '」（该链现有自定义动作 ' + used + ' 个）';
    setStatus('✅ 已插入「自定义动作·' + jobCustomSummary(seg) + '」-> ' + meta.label);
}

// ---- 事件绑定 ----
document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'customPicker') jobCloseCustomPicker();   // 点遮罩关
});
document.addEventListener('keydown', function (e) {
    const m = document.getElementById('customPicker');
    if (m && m.classList.contains('cp-open') && e.key === 'Escape') jobCloseCustomPicker();
});
document.addEventListener('DOMContentLoaded', function () {
    const bind = function (id, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    bind('cpClose', jobCloseCustomPicker);
    bind('cpCancel', jobCloseCustomPicker);
    bind('cpBack', function () {
        jobCloseCustomPicker();
        if (typeof jobOpenMoreList === 'function') jobOpenMoreList();
    });
    bind('cpOk', jobConfirmCustomPicker);
    bind('cpPrev', function () { jobCycleGenTarget(-1); jobRenderCustomTarget(); });
    bind('cpNext', function () { jobCycleGenTarget(1); jobRenderCustomTarget(); });
    const chain = document.getElementById('cpChain');
    if (chain) {
        chain.addEventListener('click', function () { jobCycleGenTarget(1); jobRenderCustomTarget(); });
        chain.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            jobCycleGenTarget(-1); jobRenderCustomTarget();
        });
    }
});

// ============================================================
// ★ 内嵌版自定义动作编辑器（步骤设置 ⚙「调配参数」用）
//
//   jobRenderCustomCfgInto(box, st, onChange)
//     box      容器（#scParamsBody 里的一个 div）
//     st       链上那一步（初始值从它读：act/from/to/ms/pairs）
//     onChange 任何字段变化 -> onChange(patch)，patch = {act,from,to,ms,pairs}
//              （调用方负责整袋覆盖写回那一步 —— 直接改作业集，改完即生效）
//
//   样式全部内联（与 32 号局外选卡同一套路），不依赖 #customPicker 的 cp-* 类。
// ============================================================
function jobRenderCustomCfgInto(box, st, onChange) {
    if (!box) return;
    box.innerHTML = '';
    const coords = _jobCoordsCache || {};
    if (!Object.keys(coords).length) {
        box.textContent = '坐标表加载中…';
        jobFetchCoords().then(function () { jobRenderCustomCfgInto(box, st, onChange); });
        return;
    }

    const state = {
        act: (st && st.act) || 'click',
        fingers: (st && Array.isArray(st.pairs) && st.pairs.length >= 2)
            ? Math.min(5, st.pairs.length) : 2,
    };

    // ---- 类型按钮行 ----
    const typeBar = document.createElement('div');
    typeBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
    JOB_CUSTOM_TYPES.forEach(function (tp) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = tp.name;
        const paint = function () {
            const on = (tp.id === state.act);
            b.style.cssText = 'padding:4px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;'
                + 'border:1px solid ' + (on ? '#7c3aed' : '#e2e8f0') + ';'
                + 'background:' + (on ? '#7c3aed' : '#fff') + ';'
                + 'color:' + (on ? '#fff' : '#475569') + ';';
        };
        paint();
        b.addEventListener('click', function () {
            state.act = tp.id;
            Array.prototype.forEach.call(typeBar.children, function (c) { c._repaint && c._repaint(); });
            renderFields();
            emit();
        });
        b._repaint = paint;
        typeBar.appendChild(b);
    });
    box.appendChild(typeBar);

    const fields = document.createElement('div');
    box.appendChild(fields);

    // ---- 行构建器（内联样式）----
    function coordRow(labelText, initVal) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        const lb = document.createElement('span');
        lb.style.cssText = 'font-size:11px;color:#64748b;width:52px;flex:none;';
        lb.textContent = labelText;
        const sel = document.createElement('select');
        sel.style.cssText = 'flex:1;padding:4px 6px;border:1px solid #e2e8f0;border-radius:7px;font-size:12px;';
        Object.keys(coords).forEach(function (k) {
            const op = document.createElement('option');
            op.value = k; op.textContent = k;
            sel.appendChild(op);
        });
        if (initVal && coords[initVal] !== undefined) sel.value = initVal;
        const xy = document.createElement('span');
        xy.style.cssText = 'font-size:10px;color:#94a3b8;flex:none;min-width:62px;text-align:right;';
        const show = function () {
            const v = coords[sel.value];
            xy.textContent = (Array.isArray(v) && v.length >= 2) ? ('[' + v[0] + ',' + v[1] + ']') : '';
        };
        sel.addEventListener('change', function () { show(); emit(); });
        row.appendChild(lb); row.appendChild(sel); row.appendChild(xy);
        show();
        row._sel = sel;
        return row;
    }
    function msRow(labelText, initVal) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        const lb = document.createElement('span');
        lb.style.cssText = 'font-size:11px;color:#64748b;width:52px;flex:none;';
        lb.textContent = labelText;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '50'; inp.step = '50';
        inp.style.cssText = 'width:90px;padding:4px 6px;border:1px solid #e2e8f0;border-radius:7px;font-size:12px;';
        inp.value = String(initVal || 600);
        inp.addEventListener('change', emit);
        const un = document.createElement('span');
        un.style.cssText = 'font-size:10px;color:#94a3b8;';
        un.textContent = 'ms';
        row.appendChild(lb); row.appendChild(inp); row.appendChild(un);
        row._inp = inp;
        return row;
    }
    function tipRow(text) {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:10px;color:#94a3b8;margin:2px 0 8px;';
        d.textContent = text;
        return d;
    }

    let rows = [];
    function renderFields() {
        fields.innerHTML = '';
        rows = [];
        const tp = JOB_CUSTOM_TYPES.filter(function (t) { return t.id === state.act; })[0];
        if (tp && tp.tip) fields.appendChild(tipRow(tp.tip));

        if (state.act === 'click' || state.act === 'hold') {
            const r = coordRow('坐标', st && st.from);
            fields.appendChild(r);
            rows.push({ role: 'from', row: r });
            if (state.act === 'hold') {
                const mr = msRow('长按时间', (st && st.ms) || 800);
                fields.appendChild(mr);
                rows.push({ role: 'ms', row: mr });
            }
        } else if (state.act === 'swipe') {
            const r1 = coordRow('起点', st && st.from);
            const r2 = coordRow('终点', st && st.to);
            fields.appendChild(r1); fields.appendChild(r2);
            rows.push({ role: 'from', row: r1 }, { role: 'to', row: r2 });
            const mr = msRow('滑动时长', (st && st.ms) || 600);
            fields.appendChild(mr);
            rows.push({ role: 'ms', row: mr });
        } else if (state.act === 'multi') {
            const ctl = document.createElement('div');
            ctl.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
            const lb = document.createElement('span');
            lb.style.cssText = 'font-size:11px;color:#64748b;width:52px;flex:none;';
            lb.textContent = '手指数';
            const minus = document.createElement('button');
            minus.type = 'button'; minus.textContent = '−';
            const num = document.createElement('span');
            num.style.cssText = 'font-size:13px;font-weight:700;color:#7c3aed;min-width:40px;text-align:center;';
            const plus = document.createElement('button');
            plus.type = 'button'; plus.textContent = '＋';
            [minus, plus].forEach(function (b) {
                b.style.cssText = 'width:24px;height:24px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;';
            });
            const paintN = function () { num.textContent = state.fingers + ' 指'; };
            minus.addEventListener('click', function () {
                if (state.fingers > 2) { state.fingers--; paintN(); renderFields(); emit(); }
            });
            plus.addEventListener('click', function () {
                if (state.fingers < 5) { state.fingers++; paintN(); renderFields(); emit(); }
            });
            ctl.appendChild(lb); ctl.appendChild(minus); ctl.appendChild(num); ctl.appendChild(plus);
            fields.appendChild(ctl);

            for (let i = 0; i < state.fingers; i++) {
                const initP = (st && Array.isArray(st.pairs) && st.pairs[i]) || [];
                const r1 = coordRow('指' + (i + 1) + '起', initP[0]);
                const r2 = coordRow('指' + (i + 1) + '终', initP[1]);
                fields.appendChild(r1); fields.appendChild(r2);
                rows.push({ role: 'pair' + i + 'a', row: r1 }, { role: 'pair' + i + 'b', row: r2 });
            }
            const mr = msRow('滑动时长', (st && st.ms) || 300);
            fields.appendChild(mr);
            rows.push({ role: 'ms', row: mr });
        }
    }

    // 读出当前字段 -> patch；无效（缺坐标）返回 null，不覆盖写回
    function emit() {
        const val = function (role) {
            const r = rows.filter(function (x) { return x.role === role; })[0];
            return r ? (r.row._sel ? r.row._sel.value : (r.row._inp ? r.row._inp.value : '')) : '';
        };
        const patch = { act: state.act };
        const ms = parseInt(val('ms'), 10);
        if (state.act === 'click') {
            patch.from = val('from');
            if (!patch.from) return;
        } else if (state.act === 'hold') {
            patch.from = val('from');
            patch.ms = (isFinite(ms) && ms > 0) ? ms : 800;
            if (!patch.from) return;
        } else if (state.act === 'swipe') {
            patch.from = val('from'); patch.to = val('to');
            patch.ms = (isFinite(ms) && ms > 0) ? ms : 600;
            if (!patch.from || !patch.to) return;
        } else if (state.act === 'multi') {
            patch.pairs = [];
            for (let i = 0; i < state.fingers; i++) {
                const a = val('pair' + i + 'a'), b = val('pair' + i + 'b');
                if (a && b) patch.pairs.push([a, b]);
            }
            if (patch.pairs.length < 2) return;
            patch.ms = (isFinite(ms) && ms > 0) ? ms : 300;
        }
        if (typeof onChange === 'function') onChange(patch);
    }

    renderFields();
}
