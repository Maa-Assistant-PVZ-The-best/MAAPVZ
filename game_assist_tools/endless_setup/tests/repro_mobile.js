// ============================================================
// 回归测试：手机端 App 壳（四屏 + 底部导航 + 长按=右键）
//   被测：static/js/44-jobset-mobile.js
//
// 为什么要测这个文件：它一旦坏了，手机上表现是**白屏 / 点了没反应**，
// 而这在电脑上的桌面视图里完全看不出来（桌面刻意零影响）。
// 所以这里用一个「够用的假 DOM」把它的四件事全钉住：
//   ① 切屏：只显示当前屏的 DOM 块，底部导航高亮跟着走；
//   ② 顺序屏 = 打开抽屉；抽屉被任何方式关掉后要**自动回到棋盘屏**
//      （否则停在空白屏 —— 这是最容易漏的坑）；
//   ③ setStatus 要镜像到表条（手机上左侧状态栏是藏起来的）；
//   ④ 长按 480ms = 派发真的 contextmenu（= 桌面的右键语义），
//      并且手指滑动 / 系统自己弹过 contextmenu 时**不许**再补一次；
//   ⑤ 桌面（matchMedia 不命中）时一行都不能动。
//
// 运行：node tests\repro_mobile.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');   // 公共假 DOM（见 harness.js 头注释）
const JS_DIR = path.join(__dirname, '..', 'static', 'js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际=' + JSON.stringify(a) + '，期望=' + JSON.stringify(b) + '）'); }

// ---------------- 够用的假 DOM ----------------
function mkClassList(el) {
    const set = {};
    return {
        add(c) { set[c] = true; },
        remove(c) { delete set[c]; },
        contains(c) { return !!set[c]; },
        toggle(c, force) {
            const on = (force === undefined) ? !set[c] : !!force;
            if (on) set[c] = true; else delete set[c];
            return on;
        },
        _set: set,
    };
}

const mkEl = H.mkEl;   // 原来这里有一份本地假元素实现（30 行），改为共用 harness
function mkSandbox(opts) {
    const mobile = !(opts && opts.desktop);
    const els = {};
    const byId = function (id) { return els[id] || null; };
    const created = [];
    const make = function (tag, id) {
        const el = mkEl(tag, els);
        if (id) el.id = id;
        return el;
    };

    // 页面骨架（44 关心的那几个块）
    const body = make('body', 'body');
    ['colBoard', 'colSlots', 'jobsetPanel', 'seqDrawer', 'mArmed', 'mStatus', 'mNav',
        'gridEarly', 'gridLate', 'seqChains'].forEach(function (id) { make('div', id); });
    // #mTableBar / #mSlotStrip 故意**不预创建**：要验证 44 自己建出来并挂上事件
    // 真实环境里这块的父节点是 .flex-row
    byId('colBoard').parentNode = { insertBefore() { }, appendChild() { } };
    const toolbar = mkEl('div', els);
    toolbar.classList.add('toolbar');

    // 底部导航 4 项
    const navItems = ['board', 'slots', 'order', 'job'].map(function (t) {
        const b = mkEl('button', 'nav-' + t);
        b.dataset.mtab = t;
        return b;
    });

    // 计时器：测试自己决定什么时候触发
    const timers = [];
    const observers = [];
    let domReady = null;

    const sandbox = {
        console,
        document: {
            body,
            readyState: 'loading',
            addEventListener(t, fn) { if (t === 'DOMContentLoaded') domReady = fn; },
            getElementById: byId,
            createElement: function (tag) {
                const el = make(tag);
                created.push(el);
                return el;
            },
            querySelector(sel) { return sel === '.toolbar' ? toolbar : null; },
            querySelectorAll(sel) {
                if (sel === '#mNav .m-nav-item') return navItems;
                if (sel === '.m-hide') {
                    return Object.keys(els).map(function (k) { return els[k]; })
                        .filter(function (e) { return e.classList.contains('m-hide'); });
                }
                return [];
            },
        },
        localStorage: { _v: {}, getItem(k) { return this._v[k] || null; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
        navigator: {},
        setTimeout(fn) { timers.push(fn); return timers.length; },
        clearTimeout(id) { if (id) timers[id - 1] = null; },
        MutationObserver: function (cb) { this.cb = cb; this.observe = function () { }; observers.push(this); },
        MouseEvent: function (type, init) {
            this.type = type;
            this.clientX = init && init.clientX; this.clientY = init && init.clientY;
            this.button = init && init.button;
        },
        matchMedia() {
            return { matches: mobile, addEventListener() { }, addListener() { }, removeListener() { } };
        },
        scrollTo() { },
        innerHeight: 800,
        innerWidth: 390,
    };
    // window 级事件（触屏拖拽把 pointermove/up 挂在 window 上）
    const winH = {};
    sandbox.addEventListener = function (t, fn) { (winH[t] = winH[t] || []).push(fn); };
    sandbox.removeEventListener = function (t, fn) {
        const a = winH[t] || [];
        const i = a.indexOf(fn);
        if (i !== -1) a.splice(i, 1);
    };
    sandbox.__fire = function (t, ev) { (winH[t] || []).slice().forEach(function (fn) { fn(ev); }); };
    sandbox.__winHandlers = function (t) { return (winH[t] || []).length; };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    // 44 依赖的既有全局（真实环境里来自 20/27/29）
    sandbox.jobTables = [{ label: '表A', levels: [1, 2, 3] }, { label: '表B', levels: [4] }];
    sandbox.currentTable = 0;
    sandbox.jobArmedSlot = 2;
    sandbox.jobSlotKeyOfArmed = function (s) { return 'card' + s; };
    sandbox.jobBoardActionOfKey = function () { return null; };
    sandbox.jobSlotDisplayName = function () { return '豌豆射手'; };
    sandbox.jobLoadTable = function () { sandbox.__loadedTable = true; };
    sandbox.jobApplyLoaded = function () { };
    sandbox.jobRenderSlots = function () { };
    sandbox.jobOpenLayout = function () { sandbox.__layoutOpened = true; };
    sandbox.jobOpenSeqDrawer = function () { sandbox.__drawerOpened = true; byId('seqDrawer').classList.add('seq-open'); };
    sandbox.jobCloseSeqDrawer = function () { byId('seqDrawer').classList.remove('seq-open'); };
    sandbox.jobOpenPicker = function (i) { sandbox.__pickerFor = i; };
    sandbox.jobFindPlant = function (n) { return n ? { img: '/static/plant/' + n + '.png', rare: 0 } : null; };
    sandbox.jobSaveLocal = function () { sandbox.__saves = (sandbox.__saves || 0) + 1; };
    sandbox.__saves = 0;
    sandbox.undoBoard = function () { sandbox.__undo = (sandbox.__undo || 0) + 1; };
    sandbox.redoBoard = function () { sandbox.__redo = (sandbox.__redo || 0) + 1; };
    // 触屏链条拖拽用到的既有函数（这里只验「调对了谁、带对了参数」）
    sandbox.jobCurrentBoard = function () { return {}; };
    sandbox.jobDragGroupFor = function () { return null; };
    sandbox.jobNearestBlockInList = function () { return null; };
    sandbox.jobMarkDropTarget = function () { };
    sandbox.jobClearSeqOver = function () { };
    sandbox.jobMarkDragging = function () { };
    sandbox.jobApplyDrop = function (drag, target) {
        sandbox.__applied = { drag: drag, target: target };
    };
    sandbox.jobMoveStepsToChain = function (t, board, drag, toWhich, step, after) {
        sandbox.__moved = { which: drag.which, toWhich: toWhich, step: step, after: after };
    };
    sandbox.setStatus = function (m) { sandbox.__status = m; };
    sandbox.__status = '';

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, '44-jobset-mobile.js'), 'utf8'),
        sandbox, { filename: '44-jobset-mobile.js' });

    sandbox.__fireDomReady = function () { if (domReady) domReady(); };
    sandbox.__runTimers = function () { timers.slice().forEach(function (f, i) { if (f) { timers[i] = null; f(); } }); };
    sandbox.__observers = observers;
    sandbox.__els = els;
    sandbox.__created = created;
    sandbox.__navItems = navItems;
    sandbox.__body = body;
    sandbox.__mkEl = make;
    return sandbox;
}

// 找 44 自己 createElement 出来的那块 UI（它没走 getElementById 注册）
const findCreated = function (s, id) {
    return s.__created.filter(function (e) { return e.id === id; }).pop() || null;
};
// 造一个能骗过 closest() 的假按钮
const fakeBtn = function (dataset, isMore) {
    return {
        dataset: dataset || {},
        classList: { contains: function (c) { return !!isMore && c === 'm-tb-more'; } },
    };
};
const clickBar = function (bar, btn) {
    const h = bar.listeners('click');
    if (!h.length) return false;
    h.forEach(function (fn) { fn({ target: { closest: function () { return btn; } } }); });
    return true;
};
const clickStrip = clickBar;      // 同一个套路：事件对象只用到 target.closest

const isOn = function (s, id) { return !s.__els[id].classList.contains('m-hide'); };
const navOn = function (s) { return s.__navItems.filter(function (b) { return b.classList.contains('m-on'); }).map(function (b) { return b.dataset.mtab; }); };

// ============================================================
// 0）桌面模式：一行都不能动
// ============================================================
console.log('0. 桌面（matchMedia 不命中）零影响');
{
    const s = mkSandbox({ desktop: true });
    s.__fireDomReady();
    ok(!s.__body.classList.contains('m-app'), '桌面不加 body.m-app');
    ok(isOn(s, 'colBoard') && isOn(s, 'colSlots') && isOn(s, 'jobsetPanel'),
        '桌面三块都照常显示（没被藏起来）');
    s.jobMobileSetTab('slots');
    ok(isOn(s, 'colBoard'), '桌面调 setTab 不生效（仍然是显示状态）');
}

// ============================================================
// 1）切屏：只显示当前屏
// ============================================================
console.log('1. 切屏：只显示当前屏 + 导航高亮跟随');
{
    const s = mkSandbox();
    s.__fireDomReady();
    ok(s.__body.classList.contains('m-app'), '手机模式加了 body.m-app');
    eq(navOn(s), ['board'], '默认停在「棋盘」屏');
    ok(isOn(s, 'colBoard'), '棋盘屏：棋盘可见');
    ok(!isOn(s, 'colSlots'), '棋盘屏：槽位块藏起来');
    ok(!isOn(s, 'jobsetPanel'), '棋盘屏：作业集面板藏起来');
    ok(isOn(s, 'mTableBar'), '棋盘屏：表条可见');

    s.jobMobileSetTab('slots');
    ok(!isOn(s, 'colBoard'), '槽位屏：棋盘藏起来');
    ok(isOn(s, 'colSlots'), '槽位屏：槽位块可见');
    ok(!isOn(s, 'mTableBar'), '槽位屏：表条藏起来（它只属于棋盘屏）');
    eq(navOn(s), ['slots'], '导航高亮移到「槽位」');

    s.jobMobileSetTab('job');
    ok(isOn(s, 'jobsetPanel'), '作业集屏：作业集面板可见');
    ok(!isOn(s, 'colBoard') && !isOn(s, 'colSlots'), '作业集屏：棋盘与槽位都藏起来');
    eq(navOn(s), ['job'], '导航高亮移到「作业集」');
}

// ============================================================
// 2）顺序屏 = 抽屉；抽屉关掉要自动回棋盘（否则白屏）
// ============================================================
console.log('2. 顺序屏：关抽屉自动回棋盘屏');
{
    const s = mkSandbox();
    s.__fireDomReady();
    s.jobMobileSetTab('order');
    ok(s.__drawerOpened === true, '进「顺序」屏会打开链条抽屉');
    eq(navOn(s), ['order'], '导航高亮在「顺序」');
    ok(!isOn(s, 'colBoard') && !isOn(s, 'colSlots'), '顺序屏背后不显示其它屏');

    // 模拟用户点 ✕ / 遮罩：抽屉去掉 seq-open，触发 MutationObserver
    s.__els.seqDrawer.classList.remove('seq-open');
    s.__observers.forEach(function (o) { o.cb([]); });
    eq(navOn(s), ['board'], '抽屉一关，底部导航自动切回「棋盘」');
    ok(isOn(s, 'colBoard'), '棋盘屏恢复显示（而不是白屏）');
}

// ============================================================
// 3）setStatus 镜像到表条
// ============================================================
console.log('3. setStatus 镜像到表条第二行');
{
    const s = mkSandbox();
    s.__fireDomReady();
    s.setStatus('🗑️ 已清空 (3, 2)：喂豆');
    eq(s.__els.mStatus.textContent, '🗑️ 已清空 (3, 2)：喂豆', '提示文字镜像到了手机上的表条');
    ok(s.__els.mStatus.classList.contains('m-tb-status-on'), '镜像后加了可见状态类');
    ok(s.__status === '🗑️ 已清空 (3, 2)：喂豆', '原 setStatus 依然被调用（桌面状态栏不受影响）');

    // 没有消息时这一行要显示用法提示（长按=更多 不讲没人会发现）
    s.__els.mStatus.textContent = '';
    s.__els.mStatus.classList.remove('m-tb-status-on');
    s.jobMobileSetTab('board');
    ok(/长按/.test(s.__els.mStatus.textContent), '空态显示用法提示「长按格子 = 格内顺序 / 清空」');
}

// ============================================================
// 4）长按 = 右键（派发真的 contextmenu）
// ============================================================
console.log('4. 长按 480ms = 右键');
{
    const s = mkSandbox();
    s.__fireDomReady();
    const grid = s.__els.gridEarly || s.__mkEl('div', 'gridEarly');

    // 造一个「有落子」的格子
    const cell = s.__mkEl('div');
    cell.classList.add('cell');
    cell.__tagChild = s.__mkEl('span');          // 有 .tag 才算「有落子」
    let ctx = 0, clicks = 0;
    cell.addEventListener('contextmenu', function () { ctx++; });
    cell.addEventListener('click', function () { clicks++; });

    const touch = { touches: [{ clientX: 100, clientY: 200 }] };
    touch.target = cell;
    grid.dispatchEvent(Object.assign({ type: 'touchstart' }, touch));
    eq(ctx, 0, '按下瞬间不弹右键菜单');
    s.__runTimers();
    eq(ctx, 1, '480ms 后派发了 contextmenu（= 桌面右键语义）');

    // 长按之后浏览器补的那次 click 必须被吞掉（否则又落一次子）
    const capFn = grid.listeners('click')[0];      // 捕获阶段那个
    let stopped = false;
    capFn({ stopPropagation() { stopped = true; }, preventDefault() { } });
    ok(stopped, '长按后紧跟的 click 被拦掉（不会重复落子）');
}

// ============================================================
// 5）长按的两个「不许触发」场景
// ============================================================
console.log('5. 长按不误触发：空格子 / 手指在滑动');
{
    const s = mkSandbox();
    s.__fireDomReady();
    const grid = s.__els.gridLate || s.__mkEl('div', 'gridLate');

    const emptyCell = s.__mkEl('div');
    emptyCell.classList.add('cell');            // 没有 .tag = 空格子
    let ctx = 0;
    emptyCell.addEventListener('contextmenu', function () { ctx++; });
    grid.dispatchEvent(Object.assign({ type: 'touchstart', target: emptyCell, touches: [{ clientX: 1, clientY: 1 }] }));
    s.__runTimers();
    eq(ctx, 0, '空格子长按不弹菜单（08 里空格的右键本来就是 return）');

    const cell2 = s.__mkEl('div');
    cell2.classList.add('cell');
    cell2.__tagChild = s.__mkEl('span');
    let ctx2 = 0;
    cell2.addEventListener('contextmenu', function () { ctx2++; });
    grid.dispatchEvent(Object.assign({ type: 'touchstart', target: cell2, touches: [{ clientX: 10, clientY: 10 }] }));
    grid.dispatchEvent({ type: 'touchmove', touches: [{ clientX: 40, clientY: 10 }] });   // 手指滑了 30px
    s.__runTimers();
    eq(ctx2, 0, '手指滑动（滚动页面）时长按被取消');
}

// ============================================================
// 6）槽位快选条：点已配好的槽 = 拿它落子；点空槽 = 直接选植物
// ============================================================
console.log('6. 槽位快选条（棋盘屏）');
{
    const s = mkSandbox();
    s.jobSlotNameCtx = function (t, i) {
        return (i === 1) ? '豌豆射手' : (i === 2 ? '坚果墙' : '');
    };
    s.__fireDomReady();
    const strip = findCreated(s, 'mSlotStrip');
    ok(!!strip, '槽位条被创建了');
    ok(/data-slot="1"/.test(strip.innerHTML) && /data-slot="8"/.test(strip.innerHTML), '渲染出 8 个槽按钮');
    ok(/m-slot-on/.test(strip.innerHTML), '当前拿着的槽（默认 槽2）高亮');
    ok(/m-slot-empty/.test(strip.innerHTML), '空槽画成虚线态（引导用户去配植物）');

    s.jobArmedSlot = 2;
    clickStrip(strip, fakeBtn({ slot: '1', has: '1' }));
    eq(s.jobArmedSlot, 1, '点已配好的槽1 → 变成「拿着槽1」');
    clickStrip(strip, fakeBtn({ slot: '5', has: '0' }));
    eq(s.__pickerFor, 5, '点空槽5 → 直接打开选植物');
    eq(s.jobArmedSlot, 1, '点空槽不会改掉当前拿着的槽');
}

// ============================================================
// 7）表条上的 ↩ / ↪（手机上按不了 Ctrl+Z，没有这个入口落错子就没救）
// ============================================================
console.log('7. 表条：撤销 / 重做 / 切表');
{
    const s = mkSandbox();
    s.__fireDomReady();
    const bar = findCreated(s, 'mTableBar');
    ok(!!bar, '表条被创建了');

    clickBar(bar, fakeBtn({ act: 'undo' }));
    eq(s.__undo, 1, '点 ↩ 调用了 undoBoard()');
    clickBar(bar, fakeBtn({ act: 'redo' }));
    eq(s.__redo, 1, '点 ↪ 调用了 redoBoard()');
    clickBar(bar, fakeBtn({ dir: '-1' }));
    ok(s.__loadedTable === true, '点 ◀ 走 jobLoadTable（切到上一张表）');
}

// ============================================================
// 8）槽位长按 → 「✎ 替换植物 / 🗑 删除这株」动作单
//    两个动作都必须**转调已有入口**（替换=jobOpenPicker，删除=jobOpenPlantDelete），
//    这里断言的就是「调对了函数、带对了参数」，不重写删除逻辑。
// ============================================================
console.log('8. 槽位长按 = 替换 / 删除 动作单');
{
    const s = mkSandbox();
    s.jobSlotNameCtx = function (t, i) { return (i === 2) ? '坚果墙' : ''; };
    s.jobOpenPlantDelete = function (name, side, slot) { s.__del = [name, side, slot]; };
    s.__fireDomReady();
    const strip = findCreated(s, 'mSlotStrip');
    ok(!!strip, '快选条已创建（长按绑定在它上面）');

    // 长按「槽2」（有植物）
    const btn = s.__mkEl('button');
    btn.dataset.slot = '2';
    strip.dispatchEvent({ type: 'touchstart', target: btn, touches: [{ clientX: 5, clientY: 5 }] });
    s.__runTimers();
    const sheet = s.__els.mSlotSheet;
    ok(!!sheet, '动作单被创建了');
    ok(sheet.classList.contains('m-open'), '长按有植物的槽 → 动作单弹出');

    // 点「替换植物」
    sheet.listeners('click')[0]({ target: { closest: function () { return { dataset: { act: 'pick' } }; } } });
    eq(s.__pickerFor, 2, '「✎ 替换植物」→ 调 jobOpenPicker(2)（= 桌面的 ✎）');
    ok(!sheet.classList.contains('m-open'), '选完动作单自动收起');

    // 再长按一次，点「删除这株」
    strip.dispatchEvent({ type: 'touchstart', target: btn, touches: [{ clientX: 5, clientY: 5 }] });
    s.__runTimers();
    ok(sheet.classList.contains('m-open'), '再次长按又能弹出');
    sheet.listeners('click')[0]({ target: { closest: function () { return { dataset: { act: 'del' } }; } } });
    eq(s.__del, ['坚果墙', 'normal', 2],
        '「🗑 删除这株」→ 调 jobOpenPlantDelete(名字, normal, 槽号)（= 桌面的 ✕ 二选一）');

    // 空槽：长按 = 直接去选植物，不弹动作单
    const emptyBtn = s.__mkEl('button');
    emptyBtn.dataset.slot = '5';
    strip.dispatchEvent({ type: 'touchstart', target: emptyBtn, touches: [{ clientX: 5, clientY: 5 }] });
    s.__runTimers();
    eq(s.__pickerFor, 5, '长按空槽 → 直接打开选植物');
    ok(!sheet.classList.contains('m-open'), '空槽不长出「替换/删除」动作单');
}

// ============================================================
// 9）手机端链条拖拽（拖柄 + Pointer Events）
//    HTML5 draggable 在触屏不派发 dragstart —— 所以必须自己用 pointer 事件。
//    这里盯的是**分派决策**：同链 → jobApplyDrop、跨链 → jobMoveStepsToChain、
//    原地 → 什么都不做（排序本身由 27 的那两个函数负责，已被其它回归覆盖）。
// ============================================================
console.log('9. 手机端链条拖拽（拖柄 → 拖到别的链）');
{
    const s = mkSandbox();
    s.__fireDomReady();
    const box = s.__els.seqChains;
    ok(box.listeners('pointerdown').length === 1, '在 #seqChains 上委托绑定了 pointerdown');

    // 造「循环」链的容器（指针会落在它上面）
    const sec = s.__mkEl('div');
    sec.classList.add('seq-section');
    sec.dataset.which = 'loop';
    sec.parentNode = box;
    const list = s.__mkEl('div');
    list.classList.add('seq-list');
    list.parentNode = sec;
    list.getBoundingClientRect = function () {
        return { left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600 };
    };
    box.__qsa = { '.seq-list': [list] };

    // 被拖的块：属于「单次」链，手柄在块头
    const block = s.__mkEl('div');
    block.classList.add('seq-chain');
    block.dataset.which = 'once';
    block.dataset.key = 'card1';
    block.__seqStep = { kind: 'plant', key: 'card1', gidx: 0 };
    const grip = s.__mkEl('span');
    grip.classList.add('seq-grip');
    grip.parentNode = block;

    const down = box.listeners('pointerdown')[0];
    down({
        pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 100, cancelable: true,
        target: grip, preventDefault: function () { },
    });
    eq(s.__winHandlers('pointermove'), 1, '按住拖柄后开始监听 window 的 pointermove');

    s.__fire('pointermove', { clientY: 300, clientX: 12, cancelable: true, preventDefault: function () { } });
    s.__fire('pointerup', {});
    ok(!!s.__moved, '拖到「循环」链上松手 → 走 jobMoveStepsToChain（跨链）');
    eq(s.__moved && s.__moved.toWhich, 'loop', '跨链目标 = 循环链');
    ok(!s.__applied, '没有误走同链的 jobApplyDrop');
    eq(s.__winHandlers('pointermove'), 0, '松手后 window 监听已移除（不会泄漏）');
}

console.log('10. 手机端链条拖拽（同一链内 → jobApplyDrop）');
{
    const s = mkSandbox();
    s.__fireDomReady();
    const box = s.__els.seqChains;

    const sec = s.__mkEl('div');
    sec.classList.add('seq-section');
    sec.dataset.which = 'once';
    sec.parentNode = box;
    const list = s.__mkEl('div');
    list.classList.add('seq-list');
    list.parentNode = sec;
    list.getBoundingClientRect = function () {
        return { left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600 };
    };
    box.__qsa = { '.seq-list': [list] };

    const block = s.__mkEl('div');
    block.classList.add('seq-chain');
    block.dataset.which = 'once';
    block.dataset.key = 'card1';
    const me = { kind: 'plant', key: 'card1', gidx: 0 };
    block.__seqStep = me;
    const grip = s.__mkEl('span');
    grip.classList.add('seq-grip');
    grip.parentNode = block;

    const other = { kind: 'plant', key: 'card2', gidx: 0 };
    s.jobNearestBlockInList = function () { return { el: s.__mkEl('div'), step: other, below: true }; };

    const down = box.listeners('pointerdown')[0];
    down({ pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 100, cancelable: true, target: grip, preventDefault: function () { } });
    s.__fire('pointermove', { clientY: 260, clientX: 10, cancelable: true, preventDefault: function () { } });
    s.__fire('pointerup', {});
    ok(!!s.__applied, '同链松手 → 走 jobApplyDrop');
    ok(s.__applied && s.__applied.target.step === other, '落点那一步被正确传进去');
    ok(s.__applied && s.__applied.target.after === true, '落在目标块下半区 → after=true');
    ok(s.__applied && s.__applied.drag.kind === 'step', '没勾选时按单块搬');
    ok(!s.__moved, '同链没有误走跨链函数');

    // 原地放下 = 不动
    s.__applied = null;
    s.jobNearestBlockInList = function () { return { el: s.__mkEl('div'), step: me, below: false }; };
    down({ pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 100, cancelable: true, target: grip, preventDefault: function () { } });
    s.__fire('pointermove', { clientY: 200, clientX: 10, cancelable: true, preventDefault: function () { } });
    s.__fire('pointerup', {});
    ok(!s.__applied, '落点就是自己被拖的那一步 → 什么都不做（不产生无意义撤销点）');
}

// ============================================================
// 11）「?」操作速查 + 自检（jobMobileDiag）
//    自检是**只读**的：只报数字，不改作业集、不写 localStorage。
// ============================================================
console.log('11. 「?」速查卡片 + 诊断信息（只读）');
{
    const s = mkSandbox();
    s.__fireDomReady();

    ok(typeof s.jobMobileDiag === 'function', '暴露了 window.jobMobileDiag（控制台可直接调）');
    const saves0 = s.__saves;
    const diag = s.jobMobileDiag();
    ok(diag && typeof diag === 'object' && !Array.isArray(diag), '诊断返回对象');
    ['视口', '手机模式', '当前屏', '屏可见', 'cell变量', '整页横向溢出'].forEach(function (k) {
        ok(k in diag, '诊断里有「' + k + '」字段');
    });
    eq(diag['手机模式'], true, '手机模式下「手机模式」= true');
    ok(diag['屏可见'] && typeof diag['屏可见'].board === 'string',
        '「屏可见」里带每屏状态（board/slots/order/job）');
    eq(s.__saves, saves0, '诊断不写盘（只读，没有撤销记录点被触发）');

    const bar = findCreated(s, 'mTableBar');
    clickBar(bar, fakeBtn({ act: 'help' }));
    const sheet = s.__els.mHelpSheet;
    ok(!!sheet, '速查卡片被创建（动态 DOM）');
    ok(sheet.classList.contains('m-open'), '点表条上的「?」→ 速查卡片弹出');

    // 点「🩺 诊断信息」：假 DOM 里没有 <pre>，走的是容错分支，只要不抛错即可
    sheet.listeners('click')[0]({ target: { closest: function () { return { dataset: { act: 'diag' } }; } } });
    ok(typeof s.jobMobileDiag === 'function', '点「诊断信息」后仍可用（没有崩）');

    sheet.listeners('click')[0]({ target: { closest: function () { return { dataset: { act: 'close' } }; } } });
    ok(!sheet.classList.contains('m-open'), '点「关闭」→ 卡片收起');
}

console.log(fails ? ('\n❌ 有 ' + fails + ' 条断言失败') : '\n✅ 全部通过（手机端 App 壳）');
process.exit(fails ? 1 : 0);