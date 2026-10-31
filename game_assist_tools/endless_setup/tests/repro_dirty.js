// ============================================================
// 回归测试：未保存改动防护（45-jobset-dirty.js）
//
// 背景：本地缓存 300ms 自动存，但**写回作业集文件必须手点 💾** ——
//   界面上原本完全看不出来，换作业集/关页面就把改动丢了。
//
// 这里盯的是**护栏行为**（胶囊长相靠肉眼）：
//   ① 干净时：不拦 beforeunload、胶囊不出现；
//   ② 改了数据：胶囊出现、jobIsDirty() = true；
//   ③ 脏的时候 beforeunload 会被拦（preventDefault + returnValue）；
//   ④ 载入别的作业集 / 新建 / 删除：confirm 拒绝 → **原函数一点都不调**、仍脏；
//      confirm 同意 → 原函数被调，之后变干净；
//   ⑤ jobSetCurrent（保存成功后紧跟它）→ 刷新基线 = 干净；
//   ⑥ 刷新/落子之类的重复调用不会把干净的又标脏（合并窗口 + 只看签名）。
//
// 运行：node tests\repro_dirty.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS_DIR = path.join(__dirname, '..', 'static', 'js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(a, b, msg) {
    ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际=' + JSON.stringify(a) + '，期望=' + JSON.stringify(b) + '）');
}

function mkEl(tag, reg) {
    let _id = '';
    const el = {
        tagName: tag, dataset: {}, style: {}, children: [], _text: '', _cls: {}, _h: {},
        // 极简 classList（toggle 支持第二参数）
        classList: {
            add: function (c) { el._cls[c] = true; },
            remove: function (c) { delete el._cls[c]; },
            contains: function (c) { return !!el._cls[c]; },
            toggle: function (c, f) {
                const on = (f === undefined) ? !el._cls[c] : !!f;
                if (on) el._cls[c] = true; else delete el._cls[c];
                return on;
            },
        },
        appendChild: function (c) { c.parentNode = el; el.children.push(c); return c; },
        addEventListener: function (t, fn) { (el._h[t] = el._h[t] || []).push(fn); },
        listeners: function (t) { return el._h[t] || []; },
        setAttribute: function () { }, getAttribute: function () { return null; },
        get textContent() { return el._text; },
        set textContent(v) { el._text = String(v); },
        get className() { return Object.keys(el._cls).join(' '); },
        set className(v) { el._cls = {}; String(v).split(/\s+/).forEach(function (c) { if (c) el._cls[c] = true; }); },
    };
    // id 一旦被赋值就登记进 registry（模块是先 createElement 再设 id 的）
    Object.defineProperty(el, 'id', {
        get: function () { return _id; },
        set: function (v) { _id = String(v || ''); if (_id && reg) reg[_id] = el; },
        configurable: true,
    });
    return el;
}

function mkSandbox() {
    const els = {};
    const body = mkEl('body', els, 'body');
    const winH = {};

    // 可变的数据 + 它的签名（= jobBuild 导出的那份）
    const state = { tables: [{ label: 'A' }], note: '' };
    const sigOf = function () { return JSON.stringify(state); };

    const sandbox = {
        console,
        document: {
            readyState: 'complete',
            body: body,
            documentElement: mkEl('div', els),
            addEventListener: function () { },
            getElementById: function (id) { return els[id] || null; },
            createElement: function (t) { return mkEl(t, els); },
        },
        setTimeout: function (fn) { fn(); return 1; },     // 立即执行，便于断言
        confirm: function () { return sandbox.__confirmAnswer; },
    };
    sandbox.__confirmAnswer = true;
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = function (t, fn) { (winH[t] = winH[t] || []).push(fn); };
    sandbox.removeEventListener = function () { };
    sandbox.__fire = function (t, ev) { (winH[t] || []).slice().forEach(function (fn) { fn(ev); }); };
    sandbox.__winCount = function (t) { return (winH[t] || []).length; };

    // 既有全局（45 会包它们）
    sandbox.jobBuild = function () { return state; };
    sandbox.jobSaveLocal = function () { sandbox.__saved = (sandbox.__saved || 0) + 1; };
    sandbox.jobSave = function () { sandbox.__saveCalled = true; };
    sandbox.jobApplyLoaded = function () { sandbox.__loaded = (sandbox.__loaded || 0) + 1; };
    sandbox.jobResetEditor = function () { sandbox.__reset = (sandbox.__reset || 0) + 1; };
    sandbox.jobDelete = function () { sandbox.__deleted = (sandbox.__deleted || 0) + 1; };
    sandbox.jobSetCurrent = function () { sandbox.__current = (sandbox.__current || 0) + 1; };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, '45-jobset-dirty.js'), 'utf8'),
        sandbox, { filename: '45-jobset-dirty.js' });

    sandbox.__state = state;
    sandbox.__badge = function () { return sandbox.document.getElementById('jobDirtyBadge'); };
    return sandbox;
}

// ============================================================
// 1）干净状态
// ============================================================
console.log('1. 刚打开：干净');
{
    const s = mkSandbox();
    eq(s.jobIsDirty(), false, '初始不脏');
    ok(!!s.__badge(), '胶囊元素已创建');
    ok(!s.__badge().classList.contains('on'), '干净时胶囊不显示');
    eq(s.__winCount('beforeunload'), 1, '挂了 beforeunload 监听');

    let prevented = false;
    s.__fire('beforeunload', { preventDefault: function () { prevented = true; } });
    ok(!prevented, '干净时关页面不拦');
}

// ============================================================
// 2）改了数据 → 胶囊出现
// ============================================================
console.log('2. 改数据 → 标脏');
{
    const s = mkSandbox();
    s.__state.note = '把槽2 改成坚果墙';
    s.jobSaveLocal();                       // = 全仓改数据的统一通道
    eq(s.jobIsDirty(), true, '改完数据后变脏');
    ok(s.__badge().classList.contains('on'), '胶囊出现「● 有未保存改动」');
    ok(s.__badge().textContent.indexOf('未保存') !== -1, '胶囊文案正确');

    // 反复触发（渲染也会走 jobSaveLocal）不应把状态搞乱
    s.jobSaveLocal(); s.jobSaveLocal();
    eq(s.jobIsDirty(), true, '连续多次改动仍是脏（幂等）');
}

// ============================================================
// 3）脏的时候关页面会被拦
// ============================================================
console.log('3. 脏 → beforeunload 拦一下');
{
    const s = mkSandbox();
    s.__state.note = 'x';
    s.jobSaveLocal();
    let prevented = false;
    const ev = { preventDefault: function () { prevented = true; }, returnValue: '' };
    s.__fire('beforeunload', ev);
    ok(prevented, '脏时 preventDefault 被调用');
    eq(ev.returnValue, '', '并设置了 returnValue（老浏览器靠它弹原生确认）');
}

// ============================================================
// 4）三个会丢改动的入口：拒绝 → 原函数不执行；同意 → 执行且变干净
// ============================================================
console.log('4. 换作业集 / 新建 / 删除：先确认');
{
    const s = mkSandbox();
    s.__state.note = 'y';
    s.jobSaveLocal();

    // ---- 拒绝 ----
    s.__confirmAnswer = false;
    s.jobApplyLoaded();
    eq(s.__loaded || 0, 0, '载入别的作业集：用户拒绝 → **原函数一个都不调**');
    eq(s.jobIsDirty(), true, '拒绝后仍然是脏的（改动还在）');
    s.jobResetEditor();
    eq(s.__reset || 0, 0, '新建：拒绝 → 不执行');
    s.jobDelete();
    eq(s.__deleted || 0, 0, '删除：拒绝 → 不执行');

    // ---- 同意 ----
    s.__confirmAnswer = true;
    s.jobApplyLoaded();
    eq(s.__loaded, 1, '载入别的作业集：同意 → 原函数执行');
    eq(s.jobIsDirty(), false, '换掉内容后变干净（新的基线）');
    ok(!s.__badge().classList.contains('on'), '胶囊收起');
}

// ============================================================
// 5）保存成功（jobSave 之后紧跟 jobSetCurrent）→ 基线刷新
// ============================================================
console.log('5. 保存成功 → 变干净');
{
    const s = mkSandbox();
    s.__state.note = 'z';
    s.jobSaveLocal();
    eq(s.jobIsDirty(), true, '改完是脏的');
    s.jobSetCurrent('pvz_x');                 // jobSave 成功后必调它（见 27 的 jobSave）
    eq(s.__current, 1, 'jobSetCurrent 被调用');
    eq(s.jobIsDirty(), false, '保存完成后基线刷新 = 干净');
    ok(!s.__badge().classList.contains('on'), '胶囊收起');
}

// ============================================================
// 6）「只是渲染了一下」不会被误判为改动
// ============================================================
console.log('6. 渲染副作用不误报（只看签名，不看调用次数）');
{
    const s = mkSandbox();
    // 模拟渲染：它也会走 jobSaveLocal，但内容没变
    s.jobSaveLocal();
    s.jobSaveLocal();
    eq(s.jobIsDirty(), false, '内容没变 → 不脏（不会因为渲染就冒红点）');
}

console.log(fails ? ('\n❌ 有 ' + fails + ' 条断言失败') : '\n✅ 全部通过（未保存改动防护）');
process.exit(fails ? 1 : 0);
