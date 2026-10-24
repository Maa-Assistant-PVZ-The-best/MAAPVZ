
// ============================================================
// 选择世界弹窗（2026-10-13）
//
// 主世界：立绘轮播（◀ ▶ 轮换，「设为主世界」落定，点大图也行）。
// 副世界：下方图库多选，与主世界互斥。
// 数据出口（供 27 导出 / 29 缓存恢复调用）：
//   jobGetWorld() / jobGetSubWorlds() / jobSetWorldUI(world, subs)
// 立绘素材：static/worlds/（游戏拆包「选择世界图」，透明底立绘）。
// ============================================================

// 世界名 -> 立绘文件。与 task/Endless_ref「选择世界」选项的注入值同名对齐。
const JOB_WORLD_IMG = {
    '神秘埃及': 'egypt.png',   '海盗港湾': 'pirate.png', '狂野西部': 'cowboy.png',
    '功夫世界': 'kongfu.png',  '未来世界': 'future.png', '黑暗时代': 'dark.png',
    '巨浪沙滩': 'beach.png',   '冰河世界': 'iceage.png', '天空之城': 'skycity.png',
    '失落之城': 'lostcity.png', '摇滚年代': 'eighties.png', '恐龙危机': 'dino.png',
    '摩登世界': 'modern.png',  '蒸汽时代': 'steam.png',  '复兴时代': 'renai.png',
    '童话世界': 'tale.png',
};
const WORLD_IMG_DIR = '/static/worlds/';

// 选择状态（作业集级）：主世界 + 副世界列表
let jobWorldSel = { main: '', subs: [] };
let jobWorldCarousel = 0;   // 轮播当前下标

function jobGetWorld() { return jobWorldSel.main || ''; }
function jobGetSubWorlds() {
    return jobWorldSel.subs.filter(w => w && w !== jobWorldSel.main);
}
function jobSetWorldUI(world, subs) {
    jobWorldSel.main = (typeof world === 'string') ? world : '';
    jobWorldSel.subs = (Array.isArray(subs) ? subs : [])
        .filter(w => typeof w === 'string' && w && w !== jobWorldSel.main);
    jobWorldSyncLabel();
}

// 入口按钮文字：「🌍 冰河世界（副×2）」/「🌍 未选择」
function jobWorldSyncLabel() {
    const lab = document.getElementById('worldLabel');
    if (!lab) return;
    const m = jobGetWorld();
    const n = jobGetSubWorlds().length;
    lab.textContent = m ? (m + (n ? `（副×${n}）` : '')) : '未选择';
    // 主世界变化 -> 地图机制层重绘（40-jobset-mech.js）
    if (typeof jobRenderCurrentBoard === 'function' && document.getElementById('gridEarly')) {
        jobRenderCurrentBoard();
    }
}

// ---- 弹窗渲染 ----
function jobRenderWorldPicker() {
    // 轮播区
    const w = JOB_WORLDS[jobWorldCarousel];
    const img = document.getElementById('wpStageImg');
    const nm = document.getElementById('wpStageName');
    if (img) { img.src = WORLD_IMG_DIR + JOB_WORLD_IMG[w]; img.alt = w; }
    if (nm) nm.textContent = w;
    const setBtn = document.getElementById('wpSetMain');
    if (setBtn) {
        const isMain = jobWorldSel.main === w;
        setBtn.textContent = isMain ? '✓ 当前主世界' : '设为主世界';
        setBtn.classList.toggle('wp-is-main', isMain);
    }

    // 副世界图库（16 张全列；主世界项锁定标「主」）
    const grid = document.getElementById('wpSubGrid');
    if (grid) {
        grid.innerHTML = '';
        JOB_WORLDS.forEach(function (name) {
            const isMain = jobWorldSel.main === name;
            const isSub = jobWorldSel.subs.indexOf(name) !== -1;
            const item = document.createElement('div');
            item.className = 'wp-item' + (isMain ? ' wp-main' : '') + (isSub ? ' wp-sub' : '');
            item.title = isMain ? '已是主世界' : (isSub ? '点击取消副世界' : '点击设为副世界');

            const im = document.createElement('img');
            im.src = WORLD_IMG_DIR + JOB_WORLD_IMG[name];
            im.alt = name;
            im.onerror = function () { this.style.visibility = 'hidden'; };
            item.appendChild(im);

            const nd = document.createElement('div');
            nd.className = 'wp-name';
            nd.textContent = name;
            item.appendChild(nd);

            if (isMain) {
                const tag = document.createElement('span');
                tag.className = 'wp-tag wp-tag-main';
                tag.textContent = '主';
                item.appendChild(tag);
            } else if (isSub) {
                const tag = document.createElement('span');
                tag.className = 'wp-tag wp-tag-sub';
                tag.textContent = '✓ 副';
                item.appendChild(tag);
            }

            item.addEventListener('click', function () {
                if (isMain) return;                       // 主世界项不响应副选
                const i = jobWorldSel.subs.indexOf(name);
                if (i === -1) jobWorldSel.subs.push(name);
                else jobWorldSel.subs.splice(i, 1);
                jobRenderWorldPicker();
                jobWorldSyncLabel();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            });
            grid.appendChild(item);
        });
    }

    const tip = document.getElementById('wpTip');
    if (tip) tip.textContent = '主：' + (jobWorldSel.main || '未选') + ' · 副 × ' + jobGetSubWorlds().length;
}

// 轮播步进（环绕）
function jobWorldStep(d) {
    jobWorldCarousel = (jobWorldCarousel + d + JOB_WORLDS.length) % JOB_WORLDS.length;
    jobRenderWorldPicker();
}

function jobOpenWorldPicker() {
    const p = document.getElementById('worldPicker');
    if (!p) return;
    const mi = JOB_WORLDS.indexOf(jobWorldSel.main);
    if (mi !== -1) jobWorldCarousel = mi;               // 打开时轮播停在当前主世界
    jobRenderWorldPicker();
    p.classList.add('sp-open');
}
function jobCloseWorldPicker() {
    const p = document.getElementById('worldPicker');
    if (p) p.classList.remove('sp-open');
}

function jobWorldInit() {
    const btn = document.getElementById('worldToggle');
    if (btn) btn.addEventListener('click', jobOpenWorldPicker);

    const close = document.getElementById('worldPickerClose');
    if (close) close.addEventListener('click', jobCloseWorldPicker);
    const done = document.getElementById('worldPickerDone');
    if (done) done.addEventListener('click', jobCloseWorldPicker);

    const prev = document.getElementById('wpPrev');
    if (prev) prev.addEventListener('click', function () { jobWorldStep(-1); });
    const next = document.getElementById('wpNext');
    if (next) next.addEventListener('click', function () { jobWorldStep(1); });

    // 点大图 = 快速设为主世界（与按钮同效）
    const stageImg = document.getElementById('wpStageImg');
    const setMain = document.getElementById('wpSetMain');
    const pickMain = function () {
        const w = JOB_WORLDS[jobWorldCarousel];
        jobWorldSel.main = w;
        jobWorldSel.subs = jobWorldSel.subs.filter(x => x !== w);   // 主副互斥
        jobRenderWorldPicker();
        jobWorldSyncLabel();
        if (typeof jobSaveLocal === 'function') jobSaveLocal();
    };
    if (setMain) setMain.addEventListener('click', pickMain);
    if (stageImg) { stageImg.addEventListener('click', pickMain); stageImg.style.cursor = 'pointer'; }

    const clear = document.getElementById('wpClear');
    if (clear) clear.addEventListener('click', function () {
        jobWorldSel = { main: '', subs: [] };
        jobRenderWorldPicker();
        jobWorldSyncLabel();
        if (typeof jobSaveLocal === 'function') jobSaveLocal();
    });

    jobWorldSyncLabel();
}
