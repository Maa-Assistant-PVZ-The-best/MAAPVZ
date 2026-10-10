
// ============================================================
// 35. 神器选择（每张阵容表一件；boss 棋盘可另配，空 = 沿用普通关；不碰 pipe）
// ------------------------------------------------------------
// 数据：
//   t.artifact / t.bossArtifact  = 神器中文名（bossArtifact null = 沿用普通关）
//   t.artifactBody / t.bossArtifactBody = 特殊类体型（葫芦 small/mid/big；boss 空 = 沿用普通关）
// 列表来源：/artifacts（pvz.py 扫 god_vessel 实况注入 has_img / bodytypes）。
//   type: click=点图标 / swipe=滑到格子 / hold=长按 / special=点图标+点第二位置
//   has_img=false -> 弹窗打叉禁选（和植物同一套「没有图片资源」表现）。
// 入口：普通/boss 棋盘的通用动作块右边各一个「神器」板块（同名同样式）；
//   特殊类神器的体型图标 = 「使用神器·体型」的链条插入入口（弹选链窗）；
//   点击类神器的「点击神器」子按钮 = 「使用神器」的链条插入入口（点初始化位置）。
// ============================================================

let artifactCache = null;        // /artifacts 缓存
let jobArtifactInsertBody = null; // 体型按钮 -> gen 弹窗的体型传递（30 读取快照进段）
let jobArtifactPickTarget = 'normal'; // 弹窗目标：'normal' | 'boss'

function jobArtifactOf(name) {
    if (!name) return null;
    return (artifactCache || []).find(function (a) { return a && a.name === name; }) || null;
}

// 当前表携带的拖拽类神器（普通关/boss 任一命中即算）——
// 左侧「神器拖拽」落子按钮的显隐（27）与图标（15->jobBoardActionImg）都靠它。
function jobSwipeArtifactOf() {
    const t = (typeof jobTables !== 'undefined') ? jobTables[currentTable] : null;
    if (!t) return null;
    const a1 = jobArtifactOf(t.artifact);
    if (a1 && a1.type === 'swipe') return a1;
    const a2 = jobArtifactOf(t.bossArtifact);
    if (a2 && a2.type === 'swipe') return a2;
    return null;
}
function jobSwipeArtifactImg() {
    const a = jobSwipeArtifactOf();
    return (a && a.img) ? ('/' + a.img) : '';
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
const ART_EMPTY_ICON = '/static/artifact/_empty.webp';

// ---- 字段访问（target = 'normal' | 'boss'；boss 空 = 沿用普通关）----
function jobArtifactField(t, target) {
    return target === 'boss' ? (t.bossArtifact || null) : (t.artifact || null);
}
function jobArtifactEffName(t, target) {
    if (target === 'boss') return t.bossArtifact || t.artifact || null;
    return t.artifact || null;
}
function jobArtifactBodyField(t, target) {
    return target === 'boss' ? 'bossArtifactBody' : 'artifactBody';
}
function jobArtifactEffBody(t, target, bts) {
    const f = jobArtifactBodyField(t, target);
    let v = t[f];
    if (target === 'boss' && !v) v = t.artifactBody;   // boss 体型空 = 沿用普通关
    if (!v || (Array.isArray(bts) && bts.indexOf(v) === -1)) {
        v = (Array.isArray(bts) && bts.indexOf('mid') !== -1) ? 'mid' : (bts || [])[0] || 'mid';
    }
    return v;
}

// ---- 神器板块（普通/boss 各一个，同名「神器」）：卡片 + （特殊类）体型图标 ----
function jobRenderArtifactBlock() {
    _renderArtBlockInto('artifactBlock', 'normal');
    _renderArtBlockInto('artifactBlockBoss', 'boss');
    // ★ 拖拽类神器决定左侧「神器拖拽」落子按钮的显隐 —— 选完神器联动刷左栏
    if (typeof jobRenderSlots === 'function') jobRenderSlots();
}

function _renderArtBlockInto(boxId, target) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML = '';
    const t = jobTables[currentTable];
    if (!t) return;

    const title = document.createElement('div');
    title.className = 'ga-title';
    title.textContent = '神器';
    box.appendChild(title);

    const isBoss = target === 'boss';
    const inherit = isBoss && !t.bossArtifact;          // boss 未单配 -> 沿用普通关
    const effName = jobArtifactEffName(t, target);
    const cur = jobArtifactOf(effName);

    const btn = document.createElement('button');
    btn.className = 'gen-act gen-act-artifact';
    btn.type = 'button';

    const ico = document.createElement('span');
    ico.className = 'ga-ico';
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
    nm.textContent = cur ? (cur.name + (inherit ? '·沿用' : '')) : '神器';
    btn.appendChild(nm);

    btn.title = cur
        ? (cur.name + (curNoImg ? '（⚠️ 无局内识别图，局内切不了）' : '（' + (ART_TYPE_CN[cur.type] || cur.type || '类型待定') + '）')
            + (inherit ? '\nboss 关沿用普通关神器' : '')
            + '\n' + (cur.desc || '') + '\n点击更换')
        : (isBoss
            ? 'boss 关神器（默认沿用普通关；点击单独配置）'
            : '选择这张表携带的神器（每表一件；识别图配好前均不可选）');
    btn.addEventListener('click', function () { jobOpenArtifactPicker(target); });
    box.appendChild(btn);

    // ★ 特殊类神器的体型子图标（如葫芦神器：小/中/大体型）：
    //   点击 = 把「使用神器·该体型」插入当前棋盘的链条（弹选链窗）。
    const bts = (cur && Array.isArray(cur.bodytypes)) ? cur.bodytypes : [];
    if (cur && bts.length) {
        const bodyField = jobArtifactBodyField(t, target);
        const selBody = jobArtifactEffBody(t, target, bts);
        if (!isBoss && t[bodyField] !== selBody) t[bodyField] = selBody;
        const sub = document.createElement('div');
        sub.className = 'art-subtypes';
        bts.forEach(function (k) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gen-act art-subtype' + (selBody === k ? ' art-subtype-cur' : '');
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
                t[bodyField] = k;
                jobSaveLocal();
                jobRenderArtifactBlock();
                jobArtifactInsertBody = k;
                if (typeof jobOpenGenPicker === 'function') jobOpenGenPicker('artifact');
            });
            sub.appendChild(b);
        });
        box.appendChild(sub);
    } else if (t && t[jobArtifactBodyField(t, target)]) {
        t[jobArtifactBodyField(t, target)] = null;   // 换成非特殊类神器 -> 清掉体型选择
    }

    // ★ 点击类神器的「点击神器」子按钮（如棱镜塔）：
    //   点击 = 把「使用神器」插入当前棋盘的链条（弹选链窗）；
    //   运行时 dsl 编译为点一次「神器_初始化_神器位置」。
    if (cur && cur.type === 'click') {
        const sub = document.createElement('div');
        sub.className = 'art-subtypes';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gen-act art-subtype';
        const i2 = document.createElement('span');
        i2.className = 'ga-ico';
        const im2 = document.createElement('img');
        im2.src = '/' + cur.img;                // 用神器自己的展示图当按钮图标
        im2.className = 'ga-ico-img';
        im2.alt = '点击神器';
        i2.appendChild(im2);
        b.appendChild(i2);
        const n2 = document.createElement('span');
        n2.className = 'ga-name';
        n2.textContent = '点击神器';
        b.appendChild(n2);
        b.title = '点击类神器：点击把「使用神器」插入链条（单次/循环/收尾任选）\n'
            + '局内 = 点一次神器图标（初始化位置）';
        b.addEventListener('click', function () {
            jobArtifactInsertBody = null;       // 点击类无体型快照
            if (typeof jobOpenGenPicker === 'function') jobOpenGenPicker('artifact');
        });
        sub.appendChild(b);
        box.appendChild(sub);
    }
}

// ---- 选择弹窗 ----
function jobOpenArtifactPicker(target) {
    jobArtifactPickTarget = (target === 'boss') ? 'boss' : 'normal';
    const m = document.getElementById('artifactPicker');
    if (!m) return;
    // 「清空」按钮文案随目标变：普通关 = 不带神器；boss = 沿用普通关
    const clear = document.getElementById('artClear');
    if (clear) clear.textContent = (jobArtifactPickTarget === 'boss') ? '↩ 沿用普通关' : '🚫 不携带神器';
    const ttl = m.querySelector('.artp-title');
    if (ttl) ttl.textContent = (jobArtifactPickTarget === 'boss') ? '选择神器（boss 棋盘）' : '选择神器';
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
    const curName = t ? jobArtifactField(t, jobArtifactPickTarget) : null;
    list.forEach(function (a) {
        if (!a) return;
        if (kw && String(a.name || '').indexOf(kw) === -1
            && String(a.en || '').toLowerCase().indexOf(kw.toLowerCase()) === -1) return;
        // ★ 运行时识别图（god_vessel）实况：has_img=false -> 灰化 + 叉叉 + 禁选
        const avail = !!a.has_img;
        const cell = document.createElement('button');
        cell.type = 'button';
        const isCur = curName === a.name;
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
            if (jobArtifactPickTarget === 'boss') t.bossArtifact = a.name;
            else t.artifact = a.name;
            jobSaveLocal();
            jobCloseArtifactPicker();
            jobRenderArtifactBlock();
            setStatus('🏺 ' + (jobArtifactPickTarget === 'boss' ? 'boss 关' : '当前阵容')
                + '携带神器：' + a.name + '（' + (ART_TYPE_CN[a.type] || '类型待定') + '）');
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
            if (jobArtifactPickTarget === 'boss') {
                t.bossArtifact = null;                 // boss：清空 = 沿用普通关
                t.bossArtifactBody = null;
            } else {
                t.artifact = null;
                t.artifactBody = null;
            }
            jobSaveLocal();
            jobCloseArtifactPicker();
            jobRenderArtifactBlock();
            setStatus(jobArtifactPickTarget === 'boss'
                ? '↩ boss 关改为沿用普通关神器'
                : '🚫 当前阵容不再携带神器');
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
