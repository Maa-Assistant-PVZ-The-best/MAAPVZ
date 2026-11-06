
// ============================================================
// 选择世界弹窗（2026-10-13 初版；2026-10-24 简化）
//
// ★ 简化定稿（用户要求）：
//   · 主世界直接用图库点选（原来的轮播 + 「设为主世界」按钮移除）；
//   · 副世界不再有网页端 UI —— 默认「除主世界外的所有世界」都是副世界，
//     不在页面显示（运行时 _check_world 只拿它做告警级校验）。
// 数据出口（供 27 导出 / 29 缓存恢复调用）：
//   jobGetWorld() / jobGetSubWorlds() / jobSetWorldUI(world, subs)
// 立绘素材：static/worlds/（游戏拆包「选择世界图」，透明底立绘）。
// ============================================================

// 世界名 -> 立绘文件。与 task/Endless_ref「选择世界」选项的注入值同名对齐。
// 「地宫无尽」= 无尽专用地图（不是 16 个常规世界之一），立绘取自拆包
// 「选择世界图」的 mausoleum.png；排最后（童话世界之后）。
const JOB_WORLD_IMG = {
    '神秘埃及': 'egypt.png',   '海盗港湾': 'pirate.png', '狂野西部': 'cowboy.png',
    '功夫世界': 'kongfu.png',  '未来世界': 'future.png', '黑暗时代': 'dark.png',
    '巨浪沙滩': 'beach.png',   '冰河世界': 'iceage.png', '天空之城': 'skycity.png',
    '失落之城': 'lostcity.png', '摇滚年代': 'eighties.png', '恐龙危机': 'dino.png',
    '摩登世界': 'modern.png',  '蒸汽时代': 'steam.png',  '复兴时代': 'renai.png',
    '童话世界': 'tale.png',    '地宫无尽': 'mausoleum.png',
};
const WORLD_IMG_DIR = '/static/worlds/';

// 选择状态（作业集级）：只存主世界；副世界 = 派生（见 jobGetSubWorlds）
let jobWorldSel = { main: '' };

function jobGetWorld() { return jobWorldSel.main || ''; }
// ★ 副世界派生：默认「除主世界外的所有世界」（用户定稿：不再手选、不再显示）。
//   没选主世界时没有副世界概念，返回空。
function jobGetSubWorlds() {
    const m = jobGetWorld();
    if (!m) return [];
    return JOB_WORLDS.filter(w => w && w !== m);
}
// subs 参数保留只为兼容旧调用（29 缓存恢复 / 28 读回），值不再使用 ——
// 副世界一律派生。
function jobSetWorldUI(world, subs) {   // eslint-disable-line no-unused-vars
    jobWorldSel.main = (typeof world === 'string') ? world : '';
    jobWorldSyncLabel();
}

// 入口按钮文字：「🌍 冰河世界」/「🌍 未选择」
function jobWorldSyncLabel() {
    const lab = document.getElementById('worldLabel');
    if (!lab) return;
    lab.textContent = jobGetWorld() || '未选择';
    // 主世界变化 -> 地图机制层重绘（40-jobset-mech.js）
    if (typeof jobRenderCurrentBoard === 'function' && document.getElementById('gridEarly')) {
        jobRenderCurrentBoard();
    }
}

// ---- 弹窗渲染：17 世界图库（16 常规世界 + 地宫无尽），点击即设为主世界 ----
function jobRenderWorldPicker() {
    const grid = document.getElementById('wpSubGrid');
    if (!grid) return;
    grid.innerHTML = '';
    JOB_WORLDS.forEach(function (name) {
        const isMain = jobWorldSel.main === name;
        const item = document.createElement('div');
        item.className = 'wp-item' + (isMain ? ' wp-main' : '');
        item.title = isMain ? '当前主世界' : '点击设为主世界';

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
            tag.textContent = '✓ 主';
            item.appendChild(tag);
        }

        item.addEventListener('click', function () {
            jobWorldSel.main = name;
            jobRenderWorldPicker();
            jobWorldSyncLabel();
            if (typeof jobSaveLocal === 'function') jobSaveLocal();
        });
        grid.appendChild(item);
    });

    const tip = document.getElementById('wpTip');
    if (tip) tip.textContent = '主世界：' + (jobWorldSel.main || '未选');
}

function jobOpenWorldPicker() {
    const p = document.getElementById('worldPicker');
    if (!p) return;
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

    const clear = document.getElementById('wpClear');
    if (clear) clear.addEventListener('click', function () {
        jobWorldSel = { main: '' };
        jobRenderWorldPicker();
        jobWorldSyncLabel();
        if (typeof jobSaveLocal === 'function') jobSaveLocal();
    });

    jobWorldSyncLabel();
}
