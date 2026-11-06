
// ============================================================
// 作业集标签（2026-10-26；2026-10-27 加「条件与风险」「失败建议」两组）
//
// 标签 = 这份作业集的「适配条件」：打法开关 + 账号档位 + 条件与风险 + 失败建议。
// 纯标注，只是显示。
//
// 交互（用户定的流程，故意做得最简单）：
//   「📝 配置」弹窗顶部 = 「标签：」+ 已加的标签 + 「＋ 选择标签」按钮；
//   点按钮跳出**另一个弹窗**分组列出全部标签，点哪个就加进「标签」那一行
//   （再点一次摘掉），关掉弹窗即生效。只分组显示，不限个数。
//   ★ 标签不影响植物阶数/挂件标注 —— 标注只有一套（38-jobset-notes.js）。
//
// 数据出口：jobGetTags() / jobSetTags(list)
//   导出字段：tags = ["开僵尸场外加速", "氪佬", "需要月卡"]（作业集级，纯标注、运行时不消费）
//   数据仍是**平铺字符串数组**（不带分组信息）—— 分组只活在界面这一层，
//   老作业集读进来照样按 JOB_TAGS 顺序重排，改名才会影响存档。
// ============================================================

// 分组只影响「选择标签」弹窗的排版；顺序 = 界面顺序，也是导出/洗数据的白名单顺序
const JOB_TAG_GROUPS = [
    {
        title: '打法开关',
        tags: ['关僵尸场外加速', '开僵尸场外加速', '关刷新下一波', '开刷新下一波']
    },
    {
        title: '账号档位',
        tags: ['难民', '0氪', '微氪', '氪佬']
    },
    {
        // 跑之前要满足的条件 / 需要留心的风险
        title: '条件与风险',
        tags: ['需要重开', '需要月卡', '破阵风险高']
    },
    {
        // 打失败之后建议怎么做（带前缀，平铺时单看也明白是「失败建议」）
        title: '失败建议',
        tags: ['失败建议：停止任务', '失败建议：重置后继续打', '失败建议：继续挑战']
    }
];

// 全部标签（平铺白名单；由分组展开而来，别另手写一份）
const JOB_TAGS = JOB_TAG_GROUPS.reduce(function (acc, g) {
    return acc.concat(g.tags);
}, []);

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
    JOB_TAG_GROUPS.forEach(function (group) {
        const sec = document.createElement('div');
        sec.className = 'tp-group';

        const title = document.createElement('div');
        title.className = 'tp-group-title';
        title.textContent = group.title;
        sec.appendChild(title);

        const items = document.createElement('div');
        items.className = 'tp-items';
        group.tags.forEach(function (name) {
            const on = jobTags.indexOf(name) !== -1;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tp-item' + (on ? ' tp-item-on' : '');
            b.textContent = name;
            b.title = on ? '已加上，再点一次摘掉' : '点一下加进「标签」';
            b.addEventListener('click', function () { jobTagToggle(name); });
            items.appendChild(b);
        });
        sec.appendChild(items);
        grid.appendChild(sec);
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
