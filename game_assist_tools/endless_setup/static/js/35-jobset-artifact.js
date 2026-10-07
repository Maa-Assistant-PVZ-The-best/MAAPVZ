
// ============================================================
// 35. 神器选择（每张阵容表一件；局内动作类型后续接入，不碰 pipe）
// ------------------------------------------------------------
// 数据：t.artifact = 神器中文名（null = 不携带）；t.bossArtifact 预留给
//   boss 关独立神器（null = 沿用普通关），UI 暂只做普通关这一件。
// 列表来源：static/artifacts.json（name/en/desc/type/img/has_img）。
//   type: click=点图标 / swipe=滑到格子 / hold=长按 / special=点图标+点第二位置
//   has_img: 运行时识别图（god_vessel）暂空，一律 false —— 和植物一样
//   「没有图片资源」的神器将来局内选不了，现在只做选择与展示。
// 入口：通用动作行最右边的「神器」卡片（jobRenderGenActionsInto 尾部调用）。
// ============================================================

let artifactCache = null;        // /artifacts 缓存
let jobArtifactInsertBody = null; // 体型按钮 -> gen 弹窗的体型传递（30 读取快照进段）

function jobArtifactOf(name) {
    if (!name) return null;
    return (artifactCache || []).find(function (a) { return a && a.name === name; }) || null;
}

// 加载神器列表：优先 /artifacts（后端扫 god_vessel 实况注入 has_img / bodytypes），
// 失败退回静态 artifacts.json（此时全按无图封禁）。
function jobLoadArtifacts() {
    if (artifactCache) return Promise.resolve(artifactCache);
    return fetch('/artifacts')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            artifactCache = (data && Array.isArray(data.artifacts)) ? data.artifacts : [];
            return artifactCache;
        })
        .catch(function () {
            return fetch('/static/artifacts.json')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    artifactCache = Array.isArray(data) ? data : [];
                    return artifactCache;
                });
        })
        .catch(function (e) {
            console.warn('[artifact] 列表加载失败', e);
            artifactCache = [];
            return artifactCache;
        });
}

const ART_TYPE_CN = { click: '点击类', swipe: '滑动类', hold: '长按类', special: '特殊类' };
const ART_BODY_CN = { small: '小体型', mid: '中体型', big: '大体型' };

// ---- 独立「神器」板块（通用动作块的右边）：标题 + 一张神器卡片 ----
const ART_EMPTY_ICON = '/static/artifact/_empty.webp';

function jobRenderArtifactBlock() {
    const box = document.getElementById('artifactBlock');
    if (!box) return;
    box.innerHTML = '';
    const t = jobTables[currentTable];
    if (!t) return;

    const title = document.createElement('div');
    title.className = 'ga-title';
    title.textContent = '神器';
    box.appendChild(title);

    const btn = document.createElement('button');
    btn.className = 'gen-act gen-act-artifact';
    btn.type = 'button';

    const ico = document.createElement('span');
    ico.className = 'ga-ico';
    const cur = jobArtifactOf(t.artifact);
    // 已选但无局内识别资源（god_vessel 暂空 -> 全是）-> 卡片警告态 + 叉叉
    const curNoImg = !!(cur && !cur.has_img);
    if (curNoImg) btn.classList.add('artp-btn-noimg');
    const im = document.createElement('img');
    im.src = (cur && cur.img) ? ('/' + cur.img) : ART_EMPTY_ICON;
    im.className = 'ga-ico-img';
    im.alt = cur ? cur.name : '未选择神器';
    ico.appendChild(im);
    if (curNoImg) jobCardXMark(ico);
    btn.appendChild(ico);

    const nm = document.createElement('span');
    nm.className = 'ga-name';
    nm.textContent = cur ? cur.name : '神器';
    btn.appendChild(nm);

    btn.title = cur
        ? (cur.name + (curNoImg ? '（⚠️ 无局内识别图，局内切不了）' : '（' + (ART_TYPE_CN[cur.type] || cur.type || '类型待定') + '）') + '\n'
            + (cur.desc || '') + '\n点击更换')
        : '选择这张表携带的神器（每表一件；识别图配好前均不可选）';
    btn.addEventListener('click', jobOpenArtifactPicker);
    box.appendChild(btn);

    // ★ 特殊类神器的体型子图标（如葫芦神器：小/中/大体型），展示在神器卡片下方；
    //   点击 = 把「使用神器·该体型」插入链条（弹选链窗：单次/循环/收尾）。
    //   图 = static/artifact/<en>/bodytype/<k>.webp
    const bts = (cur && Array.isArray(cur.bodytypes)) ? cur.bodytypes : [];
    if (cur && bts.length) {
        if (!t.artifactBody || bts.indexOf(t.artifactBody) === -1) {
            t.artifactBody = (bts.indexOf('mid') !== -1) ? 'mid' : bts[0];
        }
        const sub = document.createElement('div');
        sub.className = 'art-subtypes';
        bts.forEach(function (k) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gen-act art-subtype' + (t.artifactBody === k ? ' art-subtype-cur' : '');
            const i2 = document.createElement('span');
            i2.className = 'ga-ico';
            const im2 = document.createElement('img');
            im2.src = '/static/artifact/' + cur.en + '/bodytype/' + k + '.webp';
            im2.className = 'ga-ico-img';
            im2.alt = ART_BODY_CN[k] || k;
            i2.appendChild(im2);
            b.appendChild(i2);
            const n2 = document.createElement('span');
            n2.className = 'ga-name';
            n2.textContent = ART_BODY_CN[k] || k;
            b.appendChild(n2);
            b.title = (ART_BODY_CN[k] || k) + '：点击把「使用神器·' + (ART_BODY_CN[k] || k)
                + '」插入链条（单次/循环/收尾任选）';
            b.addEventListener('click', function () {
                t.artifactBody = k;
                jobSaveLocal();
                jobRenderArtifactBlock();
                // 带着这个体型去开「插入通用动作」弹窗（选链：单次/循环/收尾）
                if (typeof jobArtifactInsertBody !== 'undefined') jobArtifactInsertBody = k;
                else window.jobArtifactInsertBody = k;
                if (typeof jobOpenGenPicker === 'function') jobOpenGenPicker('artifact');
            });
            sub.appendChild(b);
        });
        box.appendChild(sub);
    } else if (t && t.artifactBody) {
        t.artifactBody = null;   // 换成非特殊类神器 -> 清掉体型选择
    }
}

// ---- 选择弹窗 ----
function jobOpenArtifactPicker() {
    const m = document.getElementById('artifactPicker');
    if (!m) return;
    jobLoadArtifacts().then(function () {
        jobRenderArtifactGrid('');
        m.classList.add('artp-open');
        const s = document.getElementById('artSearch');
        if (s) { s.value = ''; s.focus(); }
    });
}
function jobCloseArtifactPicker() {
    const m = document.getElementById('artifactPicker');
    if (m) m.classList.remove('artp-open');
}

function jobRenderArtifactGrid(kw) {
    const grid = document.getElementById('artGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const t = jobTables[currentTable];
    const list = artifactCache || [];
    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'artp-empty';
        empty.textContent = '（神器列表未加载——确认 static/artifacts.json 存在后刷新）';
        grid.appendChild(empty);
        return;
    }
    list.forEach(function (a) {
        if (!a) return;
        if (kw && String(a.name || '').indexOf(kw) === -1
            && String(a.en || '').toLowerCase().indexOf(kw.toLowerCase()) === -1) return;
        // ★ 运行时识别图（god_vessel）暂空 -> has_img 全 false -> 全部封禁：
        //   灰化 + 叉叉 + 禁选（和植物的「没有图片资源」同一套表现）
        const avail = !!a.has_img;
        const cell = document.createElement('button');
        cell.type = 'button';
        const isCur = t && t.artifact === a.name;
        cell.className = 'artp-cell' + (isCur ? ' artp-cur' : '') + (avail ? '' : ' artp-noimg');
        const imWrap = document.createElement('span');
        imWrap.className = 'artp-imgwrap';
        const im = document.createElement('img');
        im.src = '/' + a.img;
        im.alt = a.name;
        imWrap.appendChild(im);
        if (!avail) jobCardXMark(imWrap);
        cell.appendChild(imWrap);
        const nm = document.createElement('span');
        nm.className = 'artp-name';
        nm.textContent = a.name;
        cell.appendChild(nm);
        const tp = document.createElement('span');
        tp.className = 'artp-type';
        // 没有图片资源 -> 类型只是占位，不显示（显示「占位」）
        tp.textContent = avail ? (ART_TYPE_CN[a.type] || '类型待定') : '占位';
        cell.appendChild(tp);
        cell.title = avail
            ? (a.name + '\n' + (a.desc || ''))
            : ('⛔ ' + a.name + '：还没有局内识别图片资源（god_vessel 为空），选了局内也切不了\n' + (a.desc || ''));
        cell.addEventListener('click', function () {
            if (!t) return;
            if (!avail) {
                setStatus('⛔「' + a.name + '」还没有局内识别图片资源，暂不可选');
                return;
            }
            t.artifact = a.name;
            jobSaveLocal();
            jobCloseArtifactPicker();
            jobRenderArtifactBlock();
            setStatus('🏺 当前阵容携带神器：' + a.name + '（' + (ART_TYPE_CN[a.type] || '类型待定') + '）');
        });
        grid.appendChild(cell);
    });
}

// ---- 绑定 ----
(function () {
    function bind() {
        const close = document.getElementById('artClose');
        if (close) close.addEventListener('click', jobCloseArtifactPicker);
        const clear = document.getElementById('artClear');
        if (clear) clear.addEventListener('click', function () {
            const t = jobTables[currentTable];
            if (!t) return;
            t.artifact = null;
            jobSaveLocal();
            jobCloseArtifactPicker();
            jobRenderArtifactBlock();
            setStatus('🚫 当前阵容不再携带神器');
        });
        const search = document.getElementById('artSearch');
        if (search) search.addEventListener('input', function () {
            jobRenderArtifactGrid(search.value.trim());
        });
        const modal = document.getElementById('artifactPicker');
        if (modal) modal.addEventListener('click', function (e) {
            if (e.target === modal) jobCloseArtifactPicker();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            const m = document.getElementById('artifactPicker');
            if (m && m.classList.contains('artp-open')) jobCloseArtifactPicker();
        });
        jobLoadArtifacts().then(jobRenderArtifactBlock);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
