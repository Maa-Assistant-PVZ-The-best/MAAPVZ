// ============================================================
// tests/harness.js —— 测试公共脚手架（2026-11-02）
//
// ★ 为什么要它
//   之前每个测试都**各自手写一份假 DOM**（`mkEl` ≈ 30 行）和一份断言函数，
//   10 个测试就有 10 份略有差别的副本。后果：
//     · 假 DOM 的能力不一致 —— 有好几次是「测试桩本身缺功能」导致误判
//       （比如某个元素必须先 createElement 再设 id，本地桩不支持 id 登记）；
//     · 想给所有测试加一条新能力，得改 10 个地方。
//
// ★ 用法（只替换桩，不动断言逻辑）
//   ```js
//   const H = require('./harness');
//   const mkEl = H.mkEl;                 // 替掉各自的本地实现
//   ```
//   断言仍可用各文件自己的 `ok/eq`（小到不值得统一），也可以用这里的
//   `H.ok / H.eq / H.done()`（计数在 harness 内部）。
//
// ★ 约定：**只放「与业务无关」的东西**
//   这里绝不能出现 jobXxx 之类的业务函数桩 —— 各测试自己维护那些。
// ============================================================
'use strict';

// ---- 极简 classList（含 toggle(name, force)，与浏览器语义一致）----
function mkClassList(el) {
    const set = {};
    return {
        add: function (c) { set[c] = true; },
        remove: function (c) { delete set[c]; },
        contains: function (c) { return !!set[c]; },
        toggle: function (c, force) {
            const on = (force === undefined) ? !set[c] : !!force;
            if (on) set[c] = true; else delete set[c];
            return on;
        },
        _set: set,
        toString: function () { return Object.keys(set).join(' '); },
    };
}

// ---- 假元素 ----
//   reg：可选的「id -> 元素」注册表。**赋值 id 时自动登记**，
//        这样「先 createElement 再设 id」的代码在测试里也能被 getElementById 找到。
function mkEl(tag, reg) {
    let _id = '';
    const el = {
        tagName: tag,
        dataset: {}, style: {}, children: [],
        _text: '', _html: '', _a: {}, _h: {}, _cls: {},
        __tagChild: null,       // 元素级 querySelector('.tag') 的返回值（棋盘格用）
        __txt: null,            // 元素级 querySelector('.m-tb-txt') 的返回值（手机表条用）
        __qsa: null,            // 元素级 querySelectorAll 的白名单：{ 选择器: [元素...] }
        parentNode: null,
        offsetWidth: 100,

        listeners: function (type) { return el._h[type] || []; },
        addEventListener: function (t, fn) { (el._h[t] = el._h[t] || []).push(fn); },
        removeEventListener: function (t, fn) {
            const a = el._h[t] || [];
            const i = a.indexOf(fn);
            if (i !== -1) a.splice(i, 1);
        },
        dispatchEvent: function (ev) {
            (el._h[ev.type] || []).forEach(function (fn) { fn(ev); });
            return true;
        },
        // 沿祖先链找：支持 '.className' 和 'tag'
        closest: function (sel) {
            const want = String(sel).replace('.', '');
            let n = el;
            let guard = 0;
            while (n && guard++ < 12) {
                if (n.classList && n.classList.contains(want)) return n;
                if (n.tagName === want) return n;
                n = n.parentNode;
            }
            return null;
        },
        querySelector: function (sel) {
            if (sel === '.tag') return el.__tagChild;
            if (sel === '.m-tb-txt') return el.__txt;
            return null;
        },
        querySelectorAll: function (sel) { return (el.__qsa && el.__qsa[sel]) || []; },
        appendChild: function (c) { c.parentNode = el; el.children.push(c); return c; },
        insertBefore: function (c, ref) { c.parentNode = el; el.children.push(c); return c; },
        setAttribute: function (k, v) { el._a[k] = v; },
        getAttribute: function (k) { return el._a[k]; },
        setAttributeNS: function () { },
        removeAttribute: function (k) { delete el._a[k]; },
        getBoundingClientRect: function () {
            return { left: 0, top: 0, right: 68, bottom: 44, width: 68, height: 44 };
        },
        focus: function () { }, blur: function () { }, click: function () { },
        get textContent() { return el._text; },
        set textContent(v) { el._text = String(v); },
        get innerHTML() { return el._html; },
        set innerHTML(v) { el._html = String(v); if (!v) el.children = []; },
        get className() { return Object.keys(el._cls).join(' '); },
        set className(v) {
            el._cls = {};
            String(v).split(/\s+/).forEach(function (c) { if (c) el._cls[c] = true; });
        },
    };
    el.classList = mkClassList(el);
    // id 一赋值就登记（与浏览器一致：getElementById 能立刻找到）
    Object.defineProperty(el, 'id', {
        get: function () { return _id; },
        set: function (v) { _id = String(v || ''); if (_id && reg) reg[_id] = el; },
        configurable: true,
    });
    return el;
}

// ---- 断言（计数在 harness 内部，用 H.done() 收尾）----
const state = { fails: 0 };

function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    state.fails++;
    console.log('  ❌ ' + msg);
}
function eq(actual, expect, msg) {
    ok(JSON.stringify(actual) === JSON.stringify(expect),
        msg + '（实际=' + JSON.stringify(actual) + '，期望=' + JSON.stringify(expect) + '）');
}
function done(title) {
    console.log(state.fails
        ? ('\n❌ 有 ' + state.fails + ' 条断言失败')
        : ('\n✅ 全部通过' + (title ? ('（' + title + '）') : '')));
    process.exit(state.fails ? 1 : 0);
}

module.exports = { mkEl: mkEl, mkClassList: mkClassList, ok: ok, eq: eq, done: done, state: state };
