
// ============================================================
// 作业集标签（2026-10-26）
//
// 标签 = 这份作业集的「适配条件」：玩家打无尽时的开关与账号档位。
//   · 场外加速（僵尸是否场外加速）—— 关 / 开
//   · 刷新下一波 —— 关 / 开
//   · 氪金档位 —— 难民 / 0氪 / 微氪 / 氪佬
//
// 交互（用户定的流程）：
//   作业集栏「＋ 添加标签」→ 弹窗列出全部标签 → 点一个挂上（同一组单选），
//   再点一次摘掉；挂上的标签在作业集栏那行显示成 chip（带 ✕ 可直接移除）。
//   同一份作业集可挂多个标签，但**同一组只有一个**（不能同时「开加速 + 关加速」）。
//
// 与备注配置的关系（38-jobset-notes.js）：
//   每个标签各有一套「植物阶数 / 挂件 / 装扮」标注；没标的项回落「通用」套。
//   弹窗顶部标签条 = 「通用」+ 本作业集挂上的标签。
//
// 数据出口：jobGetTags() / jobSetTags(list)
//   导出字段：tags = ["开僵尸场外加速", "氪佬"]（作业集级，纯标注）
// ============================================================

// 标签分组（组内单选；顺序即界面顺序）
const JOB_TAG_GROUPS = [
    { title: '僵尸场外加速', tags: ['关僵尸场外加速', '开僵尸场外加速'] },
    { title: '刷新下一波', tags: ['关刷新下一波', '开刷新下一波'] },
    { title: '氪金档位', tags: ['难民', '0氪', '微氪', '氪佬'] }
];
// 全部标签（拍平，顺序 = 界面顺序；也是导出/洗数据的白名单）
const JOB_TAGS = JOB_TAG_GROUPS.reduce(function (acc, g) { return acc.concat(g.tags); }, []);

// 作业集级状态：已挂上的标签（按 JOB_TAGS 顺序，去重）
let jobTags = [];

function jobGetTags() { return jobTags.slice(); }

// 洗一遍：只收白名单里的名字、去重、同一组只留先出现的那个、按 JOB_TAGS 顺序
function jobTagNormalize(list) {
    const arr = Array.isArray(list) ? list : [];
    const chosen = [];
    const groups = {};
    arr.forEach(function (t) {
        if (typeof t !== 'string' || JOB_TAGS.indexOf(t) === -1) return;
        if (chosen.indexOf(t) !== -1) return;
        const gi = jobTagGroupOf(t);
        if (gi !== -1 && groups[gi]) return;   // 同组只能有一个
        if (gi !== -1) groups[gi] = 1;
        chosen.push(t);
    });
    return JOB_TAGS.filter(function (t) { return chosen.indexOf(t) !== -1; });
}

// 该标签属于哪一组（-1 = 不在白名单）
function jobTagGroupOf(name) {
    for (let i = 0; i < JOB_TAG_GROUPS.length; i++) {
        if (JOB_TAG_GROUPS[i].tags.indexOf(name) !== -1) return i;
    }
    return -1;
}

// 设置整份作业集的标签（载入作业集 / 清空时用）
function jobSetTags(list) {
    jobTags = jobTagNormalize(list);
    // 备注弹窗当前编辑的标签若被摘掉了 -> 回到「通用」
    if (typeof jobGetNoteTag === 'function' && typeof jobSetNoteTag === 'function') {
        const cur = jobGetNoteTag();
        if (cur && jobTags.indexOf(cur) === -1) jobSetNoteTag('');
    }
    jobRenderTagChips();
}

// 勾选/取消一个标签：同组互斥（挂新的时候把同组的旧标签摘掉）
function jobTagToggle(name) {
    if (JOB_TAGS.indexOf(name) === -1) return false;
    const at = jobTags.indexOf(name);
    if (at !== -1) {
        jobTags.splice(at, 1);
        if (typeof jobGetNoteTag === 'function' && jobGetNoteTag() === name
                && typeof jobSetNoteTag === 'function') {
            jobSetNoteTag('');       // 摘掉的正好是当前编辑标签 -> 回通用
        }
        setStatus('🏷 已移除标签「' + name + '」');
    } else {
        const gi = jobTagGroupOf(name);
        if (gi !== -1) {
            // 同一组只能有一个：先摘掉同组的其它标签（其标注数据留着，摘不了再点回来就有）
            jobTags = jobTags.filter(function (t) { return jobTagGroupOf(t) !== gi; });
        }
        jobTags.push(name);
        jobTags = jobTagNormalize(jobTags);
        setStatus('🏷 已添加标签「' + name + '」');
    }
    jobRenderTagChips();
    jobRenderTagPicker();
    if (typeof jobSaveLocal === 'function') jobSaveLocal();
    return true;
}

// ---- 作业集栏那一行的 chip ----
function jobRenderTagChips() {
    const box = document.getElementById('jobTagChips');
    if (box) {
        box.innerHTML = '';
        if (!jobTags.length) {
            const none = document.createElement('span');
            none.className = 'job-tag-none';
            none.textContent = '（未标注）';
            box.appendChild(none);
        }
        jobTags.forEach(function (name) {
            const chip = document.createElement('span');
            chip.className = 'job-tag-chip';
            chip.title = '点击 ✕ 移除这个标签（它的备注标注会保留，加回来还在）';
            const tx = document.createElement('span');
            tx.className = 'job-tag-chip-name';
            tx.textContent = name;
            chip.appendChild(tx);
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'job-tag-x';
            x.textContent = '✕';
            x.title = '移除标签「' + name + '」';
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                jobTagToggle(name);
                jobRenderTagPicker();
            });
            chip.appendChild(x);
            box.appendChild(chip);
        });
    }
    // 备注弹窗顶部的标签条跟着刷新（38-jobset-notes.js）
    if (typeof jobRenderNpTagBar === 'function') jobRenderNpTagBar();
    if (typeof jobRenderNotesPicker === 'function' && document.getElementById('notesPicker')
            && document.getElementById('notesPicker').classList.contains('sp-open')) {
        jobRenderNotesPicker();
    }
}

// ---- 「＋ 添加标签」弹窗 ----
function jobRenderTagPicker() {
    const grid = document.getElementById('tpGrid');
    if (!grid) return;
    grid.innerHTML = '';
    JOB_TAG_GROUPS.forEach(function (g) {
        const grp = document.createElement('div');
        grp.className = 'tp-group';
        const title = document.createElement('div');
        title.className = 'tp-group-title';
        title.textContent = g.title + '（单选）';
        grp.appendChild(title);

        const row = document.createElement('div');
        row.className = 'tp-group-row';
        g.tags.forEach(function (name) {
            const on = jobTags.indexOf(name) !== -1;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tp-item' + (on ? ' tp-item-on' : '');
            b.textContent = name;
            b.title = on ? '已挂上，再点一次摘掉' : '点一下挂到这份作业集上';
            b.addEventListener('click', function () {
                jobTagToggle(name);
            });
            row.appendChild(b);
        });
        grp.appendChild(row);
        grid.appendChild(grp);
    });

    const tip = document.getElementById('tpTip');
    if (tip) {
        tip.textContent = jobTags.length ? ('已挂 ' + jobTags.length + ' 个：' + jobTags.join(' · ')) : '已挂：无';
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
    const btn = document.getElementById('jobTagAddBtn');
    if (btn) btn.addEventListener('click', jobOpenTagPicker);
    const close = document.getElementById('tagPickerClose');
    if (close) close.addEventListener('click', jobCloseTagPicker);
    const done = document.getElementById('tagPickerDone');
    if (done) done.addEventListener('click', jobCloseTagPicker);
    const clear = document.getElementById('tpClear');
    if (clear) clear.addEventListener('click', function () {
        if (!jobTags.length) return;
        if (!window.confirm('清空标签？各标签的植物阶数/挂件标注会保留，重新加上标签就还在。')) return;
        jobTags = [];
        if (typeof jobSetNoteTag === 'function') jobSetNoteTag('');
        jobRenderTagChips();
        jobRenderTagPicker();
        if (typeof jobSaveLocal === 'function') jobSaveLocal();
        setStatus('🏷 已清空标签');
    });
    jobRenderTagChips();
}
