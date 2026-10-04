
// ============================================================
// 作业集（JobSet）编辑器 —— 新增（S1）
// ============================================================
const JOB_WORLDS = ['神秘埃及','海盗港湾','狂野西部','功夫世界','未来世界','黑暗时代','巨浪沙滩','冰河世界','天空之城','失落之城','摇滚年代','恐龙危机','摩登世界','蒸汽时代','复兴时代','童话世界'];

let jobTables = [];          // 行为表数组
let currentTable = 0;        // 当前编辑的表索引
let plantCache = null;       // /plants 缓存
let currentSlotEditing = -1; // 正在编辑的槽位号
let jobArmedSlot = 0;        // 已选中待落子的槽位（0=未选中）
let jobLastDrop = null;      // 最近一次落子位置 {r,c,id}：用于只播一次入场动画

function jobNewTable() {
    // ★ 新建之前先把「当前正在编辑的棋盘」存回它所属的表。
    //   否则新表会把全局 boardEarly 覆盖，上一个阵容的布阵就丢了。
    //   （jobSaveCurrentBoard 依赖 currentTable，所以必须在切 before 表之前调）
    if (jobTables.length > 0) jobSaveCurrentBoard();

    const last = jobTables.length > 0 ? jobTables[jobTables.length - 1] : null;
    const t = {
        from_level: last ? (Number(last.to_level) || 0) + 1 : 1,
        to_level: '',
        lineupMode: 'plants',
        deckNo: 1,
        loopPlant: false,
        oncePlant: false,
        // （inheritBoss 已移除：boss 链永远用本表自己的 boardLate，
        //   见 27-jobset-board.js 的 jobBuild）
        waveEnabled: false,
        slots: {},
        // ---- boss 关阵容（与普通关独立；bossLineupMode='' = 完全沿用普通关）----
        bossLineupMode: '',       // '' = 沿用普通关 | 'plants' = 单独选卡 | 'deck' = 切换编队
        bossDeckNo: 1,            // boss 关编队号（bossLineupMode='deck' 时生效）
        bossSlots: {},            // boss 关槽位覆盖层，三态：key 不存在=沿用普通关同槽 / null=已删除（boss 不用这个槽）/ '植物名'=覆盖
        // ---- 神器（占位：暂无图片资源，暂无 UI；参与导出与运行时阵容签名）----
        artifact: null,           // 普通关神器
        bossArtifact: null,       // boss 关神器（null = 沿用普通关）
        // ---- 普通关配置 ----
        slotOrder: null,          // 单次链的槽位顺序（拖动链条调整）
        loopOrder: null,          // 循环链的槽位顺序
        endOrder: null,           // 收尾链的槽位顺序（最后一波执行一次；仅普通关）
        slotModes: {},            // 槽的放置形态：{ card1:'once'|'loop', feed:..., shovel:... }
        waitAfter: {},            // 动作后的等待秒数：{ 'once|card2|r,c|seq': 3, ... }
        endPostDelay: 15000,      // 收尾前等待 = 收尾检测节点 post_delay（ms）
        endLastPostDelay: 6000,   // 收尾超时时间 = 收尾链最后一个动作 post_delay（ms）
        endAfterAction: 'sub',    // 收尾超时后动作：sub=执行子动作 / restart=重开
        endSubAction: 'loop',     // 子动作：once=单次动作 / loop=循环动作 / end=收尾动作
        // ---- boss 关配置（与普通关完全独立；null = 未配置 -> boss 关只等结算）----
        bossSlotOrder: null,      // boss 关单次链顺序
        bossLoopOrder: null,      // boss 关循环链顺序
        // （bossEndOrder 已移除：boss 关永不执行收尾链，字段不再导出）
        bossSlotModes: {},        // boss 关槽位形态
        bossWaitAfter: {},        // boss 关动作后等待
        supplyPicks: null,        // 补给选取顺序（每个阵容独立；null -> 首次渲染时填默认）
        // （innerWaits 已移除：从未有过消费者，纯遗留字段）
        boardEarly: Array.from({ length: rows }, () => Array(cols).fill(null).map(() => [])),
        boardLate: Array.from({ length: rows }, () => Array(cols).fill(null).map(() => []))
    };
    for (let i = 1; i <= 8; i++) t.slots[i] = '';
    // 默认形态：循环
    jobAllSlotKeys().forEach(function (k) { t.slotModes[k] = 'loop'; });
    if (last) {
        // 新表默认复制上一张的 boss 棋盘（boardLate）
        // ★ boardLate 统一用 rows×cols 的二维数组，避免 length 判断在
        //   空数组（[]）和完整空棋盘之间反复横跳。
        t.boardLate = JSON.parse(JSON.stringify(
            jobBoardOrBlank(last.boardLate)));
        // 沿用上一张表的普通关种植顺序与形态
        if (Array.isArray(last.slotOrder)) t.slotOrder = last.slotOrder.slice();
        if (Array.isArray(last.loopOrder)) t.loopOrder = last.loopOrder.slice();
        if (Array.isArray(last.endOrder)) t.endOrder = last.endOrder.slice();
        if (last.slotModes) t.slotModes = JSON.parse(JSON.stringify(last.slotModes));
        // 收尾参数沿用上一张表（用户可能调过 post_delay / 超时后动作）
        if (typeof last.endPostDelay === 'number') t.endPostDelay = last.endPostDelay;
        if (typeof last.endLastPostDelay === 'number') t.endLastPostDelay = last.endLastPostDelay;
        if (last.endAfterAction === 'restart') t.endAfterAction = 'restart';
        if (last.endSubAction === 'once' || last.endSubAction === 'end') t.endSubAction = last.endSubAction;
        // boss 关配置：上一张表配过才沿用（没配就保持 null -> boss 关只等结算）
        if (Array.isArray(last.bossSlotOrder)) t.bossSlotOrder = last.bossSlotOrder.slice();
        if (Array.isArray(last.bossLoopOrder)) t.bossLoopOrder = last.bossLoopOrder.slice();
        if (last.bossSlotModes) t.bossSlotModes = JSON.parse(JSON.stringify(last.bossSlotModes));
        if (last.bossWaitAfter) t.bossWaitAfter = JSON.parse(JSON.stringify(last.bossWaitAfter));
    }
    jobTables.push(t);
    // ★ 新表成为当前编辑对象 —— 否则后续 jobSaveCurrentBoard 会写错表
    currentTable = jobTables.length - 1;
    return t;
}

function jobSaveCurrentBoard() {
    const t = jobTables[currentTable];
    if (!t) return;
    t.boardEarly = JSON.parse(JSON.stringify(boardEarly));
    t.boardLate = JSON.parse(JSON.stringify(boardLate));
}

function jobLoadTable(idx, skipSave) {
    if (!skipSave) jobSaveCurrentBoard();        // 先把旧表棋盘存回去
    currentTable = idx;
    const t = jobTables[idx];
    boardEarly = jobBoardOrBlank(t.boardEarly);
    boardLate = jobBoardOrBlank(t.boardLate);
    renderAllBoards();
    jobFillForm();
    jobRenderTabs();
    jobRenderSlots();
}

// 用存档棋盘，结构不对时退化为空白棋盘（不能只看 .length：空棋盘也是合法数据）
function jobBoardOrBlank(saved) {
    const blank = function () {
        return Array.from({ length: rows }, function () {
            return Array.from({ length: cols }, function () { return []; });
        });
    };
    if (!Array.isArray(saved) || saved.length !== rows) return blank();
    for (let r = 0; r < rows; r++) {
        if (!Array.isArray(saved[r]) || saved[r].length !== cols) return blank();
    }
    return JSON.parse(JSON.stringify(saved));
}
