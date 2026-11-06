// ============================================================
// 45-jobset-dirty.js —— 未保存改动防护（2026-11-02）
//
// ★ 要解决的问题
//   「本地缓存」是 300ms 自动存的（localStorage），**但写回作业集文件必须手点 💾**
//   —— 这两件事在界面上完全看不出来。于是：
//     · 改了半天，切到另一个作业集 → 改动没了（内存里那份被换掉）；
//     · 手机浏览器把标签页回收 / 误关 → 也一样；
//     · 桌面上连一个「有未保存改动」的提示都没有。
//
// ★ 做法（只加护栏，不改任何既有流程）
//   ① **脏标记 = 内容签名与「基线」不一致**：
//      基线在「载入磁盘内容」和「保存成功后」两处刷新；
//      比较走 `JSON.stringify(jobBuild())`（就是保存时导出的那份，口径完全一致），
//      由 `jobSaveLocal`（全仓唯一的改数据通道，见 §10.7-A）**延后 700ms 合并**触发，
//      避免每次落子都算一遍。
//   ② 左下角一个「● 有未保存改动」胶囊：**点它就是保存**（复用 jobSave）。
//   ③ `beforeunload`：脏的时候拦一下（浏览器自带的"确定离开吗"）。
//   ④ 三个真会丢东西的入口先 confirm：载入别的作业集 / 新建 / 删除当前作业集。
//
// ★ 为什么不把脏标记塞进 jobSaveLocal 里面
//   jobSaveLocal 也是「渲染副作用」的落点（§10.8-H：渲染会补 seq/ord、回写覆盖率段），
//   在里面直接置脏会把「只是渲染了一下」也当成改动 —— 所以这里**只比较签名**，
//   渲染来回补的字段最终值不变，签名就不会变，也就不会误报。
// ============================================================
(function () {
    'use strict';

    const TICK = 700;          // 合并窗口：连着改只算一次
    let baseSig = null;        // 基线签名（= 上次写盘/载入时的内容）
    let dirty = false;
    let pending = false;       // 已排了一次延后刷新（合并窗口）
    let badge = null;

    function currentSig() {
        try {
            if (typeof jobBuild !== 'function') return null;
            return JSON.stringify(jobBuild());
        } catch (e) { return null; }
    }

    function ensureBadge() {
        if (badge && badge.parentNode) return badge;
        badge = document.getElementById('jobDirtyBadge');
        if (badge) return badge;
        badge = document.createElement('button');
        badge.id = 'jobDirtyBadge';
        badge.type = 'button';
        badge.title = '作业集有改动还没写回文件（💾 才会写盘）；点这里直接保存';
        badge.textContent = '● 有未保存改动';
        badge.addEventListener('click', function () {
            if (typeof jobSave === 'function') jobSave();
        });
        (document.body || document.documentElement).appendChild(badge);
        return badge;
    }

    function paint() {
        const el = ensureBadge();
        if (el) el.classList.toggle('on', !!dirty);
    }

    function refresh() {
        const s = currentSig();
        if (s === null) return;                 // 还没初始化好 / 导出失败 -> 不动状态
        if (baseSig === null) { baseSig = s; }
        const d = (s !== baseSig);
        if (d !== dirty) { dirty = d; paint(); }
    }

    function scheduleRefresh() {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; refresh(); }, TICK);
    }

    function markClean() {
        const s = currentSig();
        if (s !== null) baseSig = s;
        dirty = false;
        paint();
    }

    function isDirty() { refresh(); return dirty; }

    // ---- ① 改数据的统一通道 → 延后比较 ----
    if (typeof window.jobSaveLocal === 'function') {
        const _save = window.jobSaveLocal;
        window.jobSaveLocal = function () {
            const r = _save.apply(null, arguments);
            try { scheduleRefresh(); } catch (e) { }
            return r;
        };
    }

    // ---- ② 保存成功后刷新基线 ----
    //   jobSave 成功后会 `await jobSetCurrent(code)`（见 27 的 jobSave），
    //   所以「设为当前」= 刚刚写盘完成 —— 在这里刷基线最省事，
    //   也顺带覆盖「在列表里换当前作业集」这种没有改动的情况（本来就是干净的）。
    if (typeof window.jobSetCurrent === 'function') {
        const _set = window.jobSetCurrent;
        window.jobSetCurrent = function () {
            const r = _set.apply(null, arguments);
            try { markClean(); } catch (e) { }
            return r;
        };
    }

    // ---- ③ 三个会丢改动的入口：先确认，用户不同意就**什么都不做** ----
    function guard(fnName, question) {
        if (typeof window[fnName] !== 'function') return;
        const _orig = window[fnName];
        window[fnName] = function () {
            if (isDirty()) {
                let go = true;
                try { go = window.confirm(question); } catch (e) { go = true; }
                if (!go) return false;          // ★ 原函数一点都不调
            }
            const r = _orig.apply(null, arguments);
            try { markClean(); } catch (e) { }   // 换掉内容 = 新的干净基线
            return r;
        };
    }
    guard('jobApplyLoaded',
        '⚠️ 当前作业集有改动还没保存（要手点 💾 才会写回文件）。\n'
        + '继续载入别的作业集，这些改动会丢掉。\n\n继续吗？');
    guard('jobResetEditor',
        '⚠️ 当前作业集有改动还没保存。\n'
        + '继续新建 / 重置会丢掉这些改动。\n\n继续吗？');
    guard('jobDelete',
        '⚠️ 这份作业集有改动还没保存。\n'
        + '继续删除会连改动一起删掉。\n\n继续吗？');

    // ---- ④ 关页面 / 刷新时拦一下 ----
    window.addEventListener('beforeunload', function (e) {
        if (!isDirty()) return;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e) e.returnValue = '';              // 老浏览器需要它才会弹原生确认
    });

    // 首次进页面：以当前内容为基线（干净）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { refresh(); paint(); });
    } else {
        refresh(); paint();
    }

    // 调试 / 将来的「强制标记」用
    window.jobIsDirty = isDirty;
    window.jobDirtyMarkClean = markClean;
    window.jobDirtyRefresh = refresh;
})();
