
// ============================================================
// 地图机制层（2026-10-13）—— 选定主世界后，棋盘上叠加该世界的无尽地图机制
//
// ★★ 数据为草稿，待人工校对 ★★
//   无尽挑战的棋盘机制与正常关卡不一致（用户确认）。下列坐标按 1-5 行 × 1-9 列
//   标记（与编辑器棋盘同口径），逐世界校对后再改为正式值。
//
// 机制类型（MECH_TYPES）渲染为格子左上角小标记 + 底色 + 悬停说明；
// 纯显示层：不参与导出、不影响落子、不进作业集数据。
// ============================================================

const MECH_TYPES = {
    water: { icon: '💧', label: '水面（非水生植物需睡莲）' },
    gap: { icon: '🕳', label: '缺口/海沟（不可种植）' },
    sky: { icon: '☁️', label: '天空（仅飞行植物可种）' },
    tomb: { icon: '🪦', label: '墓碑（占位，打碎后可种）' },
    cart: { icon: '🛒', label: '矿车轨道（矿车可上下滑动）' },
    power: { icon: '🔋', label: '能量砖（联动大招）' },
    gold: { icon: '🪙', label: '黄金砖（产阳光）' },
    ice: { icon: '🧊', label: '浮冰（会上下漂移；仍可种植）' },
    sewer: { icon: '⚙️', label: '井盖（不可种植）' },
    arrow: { icon: '➡️', label: '箭头机关格' },
    fungus: { icon: '🍄', label: '菌毯格' },
};

// cells: [行(1-5), 列(1-9), 类型]
// ⚠️ 全部待校对；note 会显示在棋盘角标悬停里
const WORLD_MECHANICS = {
    '神秘埃及': { note: '草稿待校对：墓碑占位格', cells: [
        [2, 4, 'tomb'], [4, 4, 'tomb'], [1, 6, 'tomb'], [3, 6, 'tomb'], [5, 6, 'tomb'],
    ] },
    '海盗港湾': { note: '草稿待校对：2/4 行右侧海沟', cells: [
        [2, 7, 'gap'], [2, 8, 'gap'], [2, 9, 'gap'],
        [4, 7, 'gap'], [4, 8, 'gap'], [4, 9, 'gap'],
    ] },
    '狂野西部': { note: '草稿待校对：矿车轨道列', cells: [
        [1, 2, 'cart'], [2, 2, 'cart'], [3, 2, 'cart'], [4, 2, 'cart'], [5, 2, 'cart'],
        [1, 7, 'cart'], [2, 7, 'cart'], [3, 7, 'cart'], [4, 7, 'cart'], [5, 7, 'cart'],
    ] },
    '功夫世界': { note: '待校对：机制格未填', cells: [] },
    '未来世界': { note: '草稿待校对：能量砖', cells: [
        [2, 3, 'power'], [4, 3, 'power'], [3, 5, 'power'],
    ] },
    '黑暗时代': { note: '草稿待校对：墓碑占位格', cells: [
        [1, 5, 'tomb'], [3, 5, 'tomb'], [5, 5, 'tomb'], [2, 7, 'tomb'], [4, 7, 'tomb'],
    ] },
    '巨浪沙滩': { note: '草稿待校对：右侧水面', cells: [
        [1, 7, 'water'], [1, 8, 'water'], [1, 9, 'water'],
        [2, 7, 'water'], [2, 8, 'water'], [2, 9, 'water'],
        [3, 7, 'water'], [3, 8, 'water'], [3, 9, 'water'],
        [4, 7, 'water'], [4, 8, 'water'], [4, 9, 'water'],
        [5, 7, 'water'], [5, 8, 'water'], [5, 9, 'water'],
    ] },
    '冰河世界': { note: '草稿待校对：浮冰（可种植，仅显示）', cells: [
        [2, 3, 'ice'], [4, 3, 'ice'], [2, 7, 'ice'], [4, 7, 'ice'],
    ] },
    '天空之城': { note: '草稿待校对：4-9 列为天空，仅飞行植物', cells: (function () {
        const a = [];
        for (let r = 1; r <= 5; r++) for (let c = 4; c <= 9; c++) a.push([r, c, 'sky']);
        return a;
    })() },
    '失落之城': { note: '草稿待校对：黄金砖', cells: [
        [2, 2, 'gold'], [4, 2, 'gold'], [3, 4, 'gold'],
    ] },
    '摇滚年代': { note: '无固定格机制（音浪阶段为动态机制）', cells: [] },
    '恐龙危机': { note: '无固定格机制（恐龙为动态机制）', cells: [] },
    '摩登世界': { note: '无固定格机制（传送门动态出现）', cells: [] },
    '蒸汽时代': { note: '待校对：机制格未填', cells: [] },
    '复兴时代': { note: '待校对：机制格未填', cells: [] },
    '童话世界': { note: '待校对：机制格未填', cells: [] },
};

// ---- 渲染（每次棋盘重绘后由 jobRenderCurrentBoard 调用，先于对照幽灵层）----
function jobRenderMech() {
    document.querySelectorAll('.mech-mark').forEach(function (e) { e.remove(); });
    document.querySelectorAll('.cell[class*="mech-"]').forEach(function (e) {
        e.className = e.className.replace(/\s*mech-bg-\S+/g, '');
    });
    const w = (typeof jobGetWorld === 'function') ? jobGetWorld() : '';
    const m = w && WORLD_MECHANICS[w];
    if (!m || !m.cells || !m.cells.length) return;
    const gridId = (typeof jobIsBossBoard === 'function' && jobIsBossBoard()) ? 'gridLate' : 'gridEarly';
    const gridEl = document.getElementById(gridId);
    if (!gridEl) return;
    m.cells.forEach(function (cell) {
        const r = cell[0] - 1, c = cell[1] - 1, type = cell[2];
        const tp = MECH_TYPES[type];
        if (!tp) return;
        const cellEl = gridEl.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
        if (!cellEl) return;
        cellEl.classList.add('mech-bg-' + type);
        const mk = document.createElement('span');
        mk.className = 'mech-mark';
        mk.textContent = tp.icon;
        mk.setAttribute('data-tooltip', w + ' · ' + tp.label + (m.note ? '（' + m.note + '）' : ''));
        mk.setAttribute('data-tooltip-delay', '300');
        cellEl.insertBefore(mk, cellEl.firstChild);   // 机制层垫在最底
    });
}
