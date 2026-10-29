
// ============================================================
// 作业集标签（2026-10-26）
//
// 标签 = 这份作业集的「适配条件」：打法开关 + 账号档位。纯标注，只是显示。
//
// 交互（用户定的流程，故意做得最简单）：
//   「📝 配置」弹窗顶部 = 「标签：」+ 已加的标签 + 「＋ 选择标签」按钮；
//   点按钮跳出**另一个弹窗**列出 8 个标签，点哪个就加进「标签」那一行
//   （再点一次摘掉），关掉弹窗即生效。不分类、不限个数。
//   ★ 标签不影响植物阶数/挂件标注 —— 标注只有一套（38-jobset-notes.js）。
//
// 数据出口：jobGetTags() / jobSetTags(list)
//   导出字段：tags = ["开僵尸场外加速", "氪佬"]（作业集级，纯标注、运行时不消费）
// ============================================================

// 全部标签（顺序 = 界面顺序；也是导出/洗数据的白名单）
const JOB_TAGS = [
    '关僵尸场外加速', '开僵尸场外加速',
    '关刷新下一波', '开刷新下一波',
    '难民', '0氪', '微氪', '氪佬'
];

// 作业集级状态：已挂上的标签（按 JOB_TAGS 顺序，去重）
let jobTags = [];

function jobGetTags() { return jobTags.slice(); }

// 洗一遍：只收白名单里的名字、去重、按 JOB_TAGS 顺序
function jobTagNormalize(list) {
    const set = {};
    (Array.isArray(list) ? list : []).forEach(function (t) {
        if (typeof t === 'string' && JOB_TAGS.indexOf(t) !== -1) set[t] = 1;
    });
    return JOB_TAGS.filter(function (t) { return set[t]; });
}

// 设置整份作业集的标签（载入作业集 / 清空时用）
function jobSetTags(list) {
    jobTags = jobTagNormalize(list);
    jobRenderTags();
}

// 点一下 = 加上，再点一下 = 摘掉
function jobTagToggle(name) {
    if (JOB_TAGS.indexOf(name) === -1) return false;
    const at = jobTags.indexOf(name);
    if (at !== -1) {
        jobTags.splice(at, 1);
        setStatus('🏷 已移除标签「' + name + '」');
    } else {
        jobTags.push(name);
        jobTags = jobTagNormalize(jobTags);
        setStatus('🏷 已添加标签「' + name + '」');
    }
    jobRenderTags();
    jobRenderTagPicker();
    if (typeof jobSaveLocal === 'function') jobSaveLocal();
    return true;
}

// ---- 「标签：」那一行（已加的标签 + ＋ 选择标签）----
function jobRenderTags() {
    const bar = document.getElementById('npTagPickBar');
    if (bar) {
        bar.innerHTML = '';
        const lbl = document.createElement('span');
        lbl.className = 'np-tag-label';
        lbl.textContent = '标签：';
        bar.appendChild(lbl);

        if (!jobTags.length) {
            const none = document.createElement('span');
            none.className = 'np-tag-hint';
            none.textContent = '（未选择）';
            bar.appendChild(none);
        }
        jobTags.forEach(function (name) {
            const chip = document.createElement('span');
            chip.className = 'np-tag np-tag-on';
            chip.textContent = name;
            chip.title = '已加上的标签（在「＋ 选择标签」里再点一次可摘掉）';
            bar.appendChild(chip);
        });

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'np-tag np-tag-add';
        add.textContent = '＋ 选择标签';
        add.title = '打开标签列表，点哪个就加进这一行';
        add.addEventListener('click', jobOpenTagPicker);
        bar.appendChild(add);
    }
}

// ---- 标签选择弹窗（点「＋ 选择标签」跳出，压在上面）----
function jobRenderTagPicker() {
    const grid = document.getElementById('tpGrid');
    if (!grid) return;
    grid.innerHTML = '';
    JOB_TAGS.forEach(function (name) {
        const on = jobTags.indexOf(name) !== -1;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tp-item' + (on ? ' tp-item-on' : '');
        b.textContent = name;
        b.title = on ? '已加上，再点一次摘掉' : '点一下加进「标签」';
        b.addEventListener('click', function () { jobTagToggle(name); });
        grid.appendChild(b);
    });
    const tip = document.getElementById('tpTip');
    if (tip) {
        tip.textContent = jobTags.length ? ('已加 ' + jobTags.length + ' 个：' + jobTags.join(' · ')) : '已加：无';
    }
}

function jobOpenTagPicker() {
    const p = document.getElementById('tagPicker');
    if (!p) return;
    jobRenderTagPicker();
    p.classList.add('sp-open');
}
function jobCloseTagPicker() {
    const p = document.getElementById('tagPicker');
    if (p) p.classList.remove('sp-open');
}

function jobTagInit() {
    const close = document.getElementById('tagPickerClose');
    if (close) close.addEventListener('click', jobCloseTagPicker);
    const done = document.getElementById('tagPickerDone');
    if (done) done.addEventListener('click', jobCloseTagPicker);
    const modal = document.getElementById('tagPicker');
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) jobCloseTagPicker();   // 点遮罩关闭
        });
    }
    jobRenderTags();
}
