// ============================================================
// 静态登记检查（repro_registry.js）—— 不开浏览器，只扫源码
//
// ★ 这个文件解决的是「**必须手工同步的几张表**」：
//   项目里有几处约定，漏一处就**静默失效**（不报错、界面看起来正常）：
//
//   ① 新弹窗必须登记两处：
//      · `base.css` 里写样式（本仓弹窗样式**按 id 逐条写**，没有公共类）
//        —— 漏了就是「点了没反应」（`#batchReplaceModal` 漏过一次）；
//      · `27` 的 `JOB_MODAL_SELECTORS`（键盘闸口）—— 漏了弹窗里按 W/S/Ctrl+Z
//        会漏到主界面。
//   ② 手机壳（`44`）的 `screenGroups()` 必须登记每个「屏块」——
//      漏了那个块在手机上**永远看不见**，或者切屏时一直挂在屏幕上。
//   ③ `dataset` 契约：`27` 写 `chip.dataset.slot / act`、`sec.dataset.which`，
//      `44` 读它们 —— 一边改名另一边就**静默不工作**（桌面还完全看不出来）。
//   ④ `44` 会**包一层**既有全局函数（setStatus / jobLoadTable / …）。
//      被包的那个函数一旦改名，包了个 null，手机端功能静默消失。
//   ⑤ 棋盘同格缩略图：`JOB_CELL_MAX_MARKS`（08）必须等于 CSS 里 `.job-pN` 的最大 N
//      —— 改一个不改另一个，角标数和实际能摆的位置就对不上。
//
// 运行：node tests\repro_registry.js
// 退出码：0 = 全过；1 = 有断言失败
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'static', 'js');
const readF = function (p) { return fs.readFileSync(p, 'utf8'); };

const html = readF(path.join(ROOT, 'static', 'index.html'));
const css = readF(path.join(ROOT, 'static', 'css', 'base.css'));

const jsFiles = fs.readdirSync(JS_DIR).filter(function (f) { return f.endsWith('.js'); });
const js = {};
jsFiles.forEach(function (f) { js[f] = readF(path.join(JS_DIR, f)); });
const J = function (f) { return js[f] || ''; };
// 拆分后同一个契约可能落在任意一个 27x 文件里 —— 一律按「全仓拼接」来查
const ALL_JS = jsFiles.map(function (f) { return js[f]; }).join('\n');
// 手机壳的源码（第 1 节就要用，所以提到最前面声明）
const M44 = J('44-jobset-mobile.js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(a, b, msg) {
    ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际=' + JSON.stringify(a) + '，期望=' + JSON.stringify(b) + '）');
}
function section(t) { console.log('\n' + t); }

// ============================================================
// 1）弹窗三处登记
// ============================================================
section('1. 弹窗：index.html ⟷ base.css ⟷ JOB_MODAL_SELECTORS');

// 面板型弹窗 = `<div id="X">` 紧跟 `<div class="Y-panel">`
// （`#plantPicker` / `#outerPicker` 是行内样式 + display 控制，不走这套）
const panels = [];
const panelRe = /<div id="([A-Za-z]+)">\s*<div class="[a-z]+-panel"/g;
let m;
while ((m = panelRe.exec(html))) panels.push(m[1]);
ok(panels.length >= 15, '扫到面板型弹窗 ' + panels.length + ' 个');

const selBlock = (ALL_JS.match(/const JOB_MODAL_SELECTORS = \[([\s\S]*?)\];/) || [])[1] || '';
const selIds = [];
const selRe = /'#([A-Za-z]+)\./g;
while ((m = selRe.exec(selBlock))) selIds.push(m[1]);
ok(selIds.length >= 15, 'JOB_MODAL_SELECTORS 扫到 ' + selIds.length + ' 条');

panels.forEach(function (id) {
    ok(selIds.indexOf(id) !== -1,
        '弹窗 #' + id + ' 已登记 JOB_MODAL_SELECTORS（否则键盘会漏到主界面）');
});
panels.forEach(function (id) {
    ok(css.indexOf('#' + id) !== -1,
        '弹窗 #' + id + ' 在 base.css 里有样式（漏了就是「点了没反应」）');
});
selIds.forEach(function (id) {
    const inHtml = html.indexOf('id="' + id + '"') !== -1;
    // 手机壳里用 createElement 动态建的弹窗（#mSlotSheet / #mHelpSheet …）——
    // 只要 `44` 里出现这个 id 字面量就算「真实存在」，不必进 index.html。
    const byJs = M44.indexOf("'" + id + "'") !== -1 || M44.indexOf('"' + id + '"') !== -1;
    ok(inHtml || byJs, '登记项 #' + id + ' 在页面里真实存在（index.html 或 JS 动态创建）');
});

// ============================================================
// 2）手机壳：screenGroups 必须登记每个屏块
// ============================================================
section('2. 手机壳：screenGroups() 必须登记所有屏块');

ok(!!M44, '44-jobset-mobile.js 存在（手机壳）');
['colBoard', 'colSlots', 'jobsetPanel'].forEach(function (id) {
    ok(M44.indexOf("'" + id + "'") !== -1 || M44.indexOf(id) !== -1,
        '屏块 #' + id + ' 已在 screenGroups() 里登记');
});
// 反查：index.html 里每个 id="colXxx" 的列都必须被登记
const cols = [];
const colRe = /id="(col[A-Za-z]+)"/g;
while ((m = colRe.exec(html))) cols.push(m[1]);
ok(cols.length >= 2, 'index.html 扫到列容器 ' + cols.length + ' 个：' + cols.join(', '));
cols.forEach(function (id) {
    ok(M44.indexOf(id) !== -1, '列 #' + id + ' 已在 screenGroups() 里登记（漏了手机上永远看不到）');
});
// 底部导航与屏名一一对应
const tabsInJs = (M44.match(/const TABS = \[([^\]]*)\]/) || [])[1] || '';
const tabNames = tabsInJs.split(',').map(function (s) { return s.trim().replace(/^'|'$/g, ''); }).filter(Boolean);
ok(tabNames.length >= 3, '44 里声明了 ' + tabNames.length + ' 个屏：' + tabNames.join(','));
tabNames.forEach(function (t) {
    ok(html.indexOf('data-mtab="' + t + '"') !== -1,
        '底部导航里有 data-mtab="' + t + '" 的按钮（否则那个屏永远进不去）');
});

// ============================================================
// 3）dataset 契约（27 写 ⟷ 44 读）
// ============================================================
section('3. dataset 契约：27 写 ⟷ 44 读（缺一边就静默不工作）');

const pairs = [
    { key: 'slot', why: '槽位长按 / 连点切链条' },
    { key: 'act', why: '✎ / ✕ 不被长按接管' },
    { key: 'which', why: '拖拽判断落在哪条链' },
];
pairs.forEach(function (p) {
    ok(ALL_JS.indexOf('dataset.' + p.key) !== -1,
        '写方（27x 任一文件）写了 dataset.' + p.key + '（' + p.why + ' 的数据来源）');
    ok(M44.indexOf('dataset.' + p.key) !== -1,
        '44 读了 dataset.' + p.key + '（' + p.why + '）');
});

// ============================================================
// 4）44 包装的全局函数必须真有定义
// ============================================================
section('4. 44 包了一层的全局函数都必须有定义（改名 = 静默失效）');

const wrapped = [];
const arrRe = /\[((?:\s*'[A-Za-z_]\w*'\s*,?)+)\]\.forEach\(function\s*\(\s*fn\s*\)/g;
while ((m = arrRe.exec(M44))) {
    m[1].split(',').map(function (s) { return s.trim().replace(/^'|'$/g, ''); })
        .filter(Boolean)
        .forEach(function (n) { if (wrapped.indexOf(n) === -1) wrapped.push(n); });
}
const winRe = /window\.([A-Za-z_]\w*)\s*=\s*function/g;
while ((m = winRe.exec(M44))) {
    if (wrapped.indexOf(m[1]) === -1) wrapped.push(m[1]);
}
ok(wrapped.length >= 4, '扫到被包装函数 ' + wrapped.length + ' 个：' + wrapped.join(', '));

wrapped.forEach(function (n) {
    const re = new RegExp('function\\s+' + n + '\\s*\\(|\\b' + n + '\\s*=\\s*function'
        + '|(?:var|let|const)\\s+' + n + '\\b');
    const found = jsFiles.filter(function (f) {
        return f !== '44-jobset-mobile.js' && re.test(js[f]);
    });
    ok(found.length > 0,
        n + ' 在 ' + (found.join(', ') || '（无！改名了？）') + ' 里有定义');
});

// ============================================================
// 5）棋盘同格缩略图：JOB_CELL_MAX_MARKS ⟷ CSS .job-pN
// ============================================================
section('5. JOB_CELL_MAX_MARKS ⟷ CSS 的 .job-pN 条数');

const maxMarks = Number((J('08-board-data.js').match(/JOB_CELL_MAX_MARKS\s*=\s*(\d+)/) || [])[1]);
ok(!!maxMarks, '08 里扫到 JOB_CELL_MAX_MARKS = ' + maxMarks);

const pNums = [];
const pRe = /\.job-p(\d+)\b/g;
while ((m = pRe.exec(css))) {
    const n = Number(m[1]);
    if (pNums.indexOf(n) === -1) pNums.push(n);
}
const maxP = pNums.length ? Math.max.apply(null, pNums) : 0;
eq(maxMarks, maxP, 'JOB_CELL_MAX_MARKS 必须等于 CSS 里最大的 .job-pN（否则「+N」角标数和实际摆位对不上）');

// ============================================================
// 6）唯一入口：关键函数全仓只能有一处定义
//    ★ 这一节就是「防止以后另起一套」的门禁 —— 谁要是复制粘贴出一个
//      jobApplyDrop2 / 自己写个新的段写回函数，这里当场红。
//      真需要新入口时：**改这个已有函数**，不要在旁边再长一个。
// ============================================================
section('6. 唯一入口：关键函数全仓只能有一处定义');

const UNIQUE = [
    ['jobStoreSteps', '链条段写回（唯一写盘口）'],
    ['jobApplyDrop', '同链排序（唯一 drop 出口）'],
    ['jobMoveStepsToChain', '跨链搬运（唯一出口）'],
    ['jobCellQueueMove', '格内方块排序（唯一出口）'],
    ['jobCommitSupplyOrder', '补给顺序写回（唯一出口）'],
    ['jobSaveLocal', '撤销记录点 + 本地缓存（唯一通道）'],
    ['jobResolveSteps', '链 → 步骤解析（唯一真相来源）'],
    ['jobSegsToSteps', '段 → 步骤'],
    ['jobStepsToSegs', '步骤 → 段'],
    ['jobPinSteps', '落点引用钉住（P0 根治后可退役）'],
    ['jobBuild', '导出 JSON（唯一真源）'],
    ['setStatus', '状态提示（唯一通道）'],
];
UNIQUE.forEach(function (pr) {
    const re = new RegExp('function\\s+' + pr[0] + '\\s*\\(');
    const hits = jsFiles.filter(function (f) { return re.test(js[f]); });
    ok(hits.length === 1,
        pr[0] + '（' + pr[1] + '）全仓恰好 1 处：' + (hits.join(', ') || '（无！）'));
});

// ============================================================
// 7）预算式门禁：行内样式 / !important / 原生弹窗「只能降不能升」
//    ★ 写手机断点、加覆盖样式时，最省事的做法就是再来一条 !important 或
//      往 HTML 塞行内 style —— 那正是让样式越来越脆的原因。
//      这里给硬上限：**新增代码不许把数字推高**（要加就先把旧的清掉）。
// ============================================================
section('7. 预算门禁：行内样式 / !important / 原生弹窗只能变少');

const inlineCnt = (html.match(/style="/g) || []).length;
const impCnt = (css.match(/!important/g) || []).length;
const nativeCnt = (function () {
    let n = 0;
    jsFiles.forEach(function (f) {
        n += (js[f].match(/(window\.)?(alert|confirm|prompt)\(/g) || []).length;
    });
    return n;
})();

const BUDGET = [
    ['index.html 行内 style', inlineCnt, 66,
        '新增样式请写进 base.css；行内样式会让后面的覆盖只能靠 !important'],
    ['base.css 里 !important', impCnt, 46,
        '!important 变多 = 又有行内样式在挡路，先把它搬进 CSS'],
    ['原生 alert/confirm/prompt', nativeCnt, 16,
        '新代码请用 setStatus / 项目自己的面板，不要弹系统窗'],
];
BUDGET.forEach(function (b) {
    ok(b[1] <= b[2],
        b[0] + ' = ' + b[1] + '（上限 ' + b[2] + '，只能降不能升）' + (b[1] > b[2] ? ' —— ' + b[3] : ''));
});

// ============================================================
// 8）落子动作注册表 ↔ 图标表 / 编号唯一性
//    新加落子动作最容易漏两处：图标没配（悄悄回退成铲子占位）、
//    armedNo 撞号（按 W/S 选到的不是你以为的那个动作）。
// ============================================================
section('8. 落子动作：imgKey 必须有图、armedNo 唯一且 ≥9');

const ACT_SRC = J('15-board-actions.js');
// 去掉整行注释，免得把文件头注释里的示例条目也扫进来
const ACT_NC = ACT_SRC.split('\n')
    .filter(function (l) { return l.trim().indexOf('//') !== 0; })
    .join('\n');
const FIELD_SRC = J('24-jobset-fields.js');

const imgKeys = [];
let m8;
const ikRe = /imgKey:\s*'([A-Za-z0-9_]+)'/g;
while ((m8 = ikRe.exec(ACT_NC))) imgKeys.push(m8[1]);
ok(imgKeys.length >= 3, '扫到落子动作 imgKey ' + imgKeys.length + ' 个：' + imgKeys.join(', '));
imgKeys.forEach(function (k) {
    ok(new RegExp('\\b' + k + '\\s*:').test(FIELD_SRC),
        'imgKey「' + k + '」在 24-jobset-fields.js 的 JOB_UI_IMG 里有对应图');
});

const armNos = [];
const anRe = /armedNo:\s*(\d+)/g;
while ((m8 = anRe.exec(ACT_NC))) armNos.push(Number(m8[1]));
ok(armNos.length >= 3, '扫到 armedNo ' + armNos.length + ' 个：' + armNos.join(', '));
const dupA = armNos.filter(function (v, i) { return armNos.indexOf(v) !== i; });
ok(dupA.length === 0, 'armedNo 不重复（重复的：' + (dupA.join(', ') || '无') + '）');
armNos.forEach(function (n) {
    ok(n >= 9, 'armedNo ' + n + ' ≥ 9（1-8 是植物槽，被占用会选错动作）');
});

console.log(fails ? ('\n❌ 有 ' + fails + ' 条断言失败') : '\n✅ 全部通过（静态登记检查）');
process.exit(fails ? 1 : 0);
