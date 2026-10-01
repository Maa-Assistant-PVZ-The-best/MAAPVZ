// ============================================================
// ★★★ 棋盘落子动作「注册表」—— 唯一的扩展入口 ★★★
// ------------------------------------------------------------
//   背景：以前新增一个落子动作（喂豆/铲子/点击格子）要在
//   6 个文件里各改一处，极容易漏。现在**只改这一个文件**。
//
//   本文件在 static/js/ 里的加载顺序是 15（早于所有 jobset 脚本），
//   所以下面所有函数在别处调用时都已存在。
//
//   ┌─────────────────────────────────────────────────────────┐
//   │ 新增一个落子动作 = 在 JOB_BOARD_ACTIONS 里加一条        │
//   │ 需要的话再在 JOB_BOARD_ACTION_DSL 里给 agent 加编译规则 │
//   │ 其余（左侧按钮 / 弹窗 / 棋盘渲染 / 链段导出 / 存盘）    │
//   │ 全部自动跟随。                                          │
//   └─────────────────────────────────────────────────────────┘
//
//   每条动作定义（全部字段都有合理默认值，只需 id/name）：
//
//     id        槽位键（存进作业集的 key），如 'tapcell'
//     name      显示名，如 '点击格子'
//     desc      弹窗里的一句话说明
//     icon      emoji 兜底（图片加载失败时用）
//     imgKey    JOB_UI_IMG 里的键（图标）；缺省用 icon
//     img       直接给图片路径（优先于 imgKey）；缺省回退 shovel 占位
//     color     左侧 chip 边框色（选中时统一蓝色）
//     armedNo   选中后的 jobArmedSlot 取值（必须唯一，见下方分配表）
//     dslType   导出给 agent 的 type：'tap' | 'swipe' | 'plant'
//     placements 该动作在棋盘上的落子（默认同 feed：单次可重复、循环唯一）
//     inMore    是否出现在「更多」弹窗里（true=是扩展动作）
//     params    可选，链上的额外参数声明（一般落子动作不需要）
//
//   ★ armedNo 分配表（不要重复！）：
//       1-8  植物槽 card1..card8
//       9    喂豆 feed
//       10   铲子 shovel
//       11+  扩展动作（从 11 开始往上加）
// ============================================================

const JOB_BOARD_ACTIONS = [
    // ---- 内置三个（左侧常驻显示，不走「更多」弹窗）----
    {
        id: 'feed', name: '喂豆', icon: '🫘', imgKey: 'feed',
        color: '#fca5a5', armedNo: 9, dslType: 'feed',
        desc: '在棋盘标记喂豆位置', inMore: false, builtin: true
    },
    {
        id: 'shovel', name: '铲子', icon: '🧤', imgKey: 'shovel',
        color: '#c4b5fd', armedNo: 10, dslType: 'shovel',
        desc: '在棋盘标记铲除位置', inMore: false, builtin: true
    },

    // ---- ★ 扩展动作（出现在左侧「更多」弹窗里）----
    {
        id: 'tapcell', name: '点击格子', icon: '👆',
        imgKey: 'tapcell',          // JOB_UI_IMG.tapcell -> static/button/点击格子.webp
        color: '#fdba74', armedNo: 11, dslType: 'tap',
        desc: '选中后在棋盘落子，执行时点一下那个格子',
        inMore: true
    }

    // ---- 未来需求的参考写法（照着抄即可，记得换唯一 armedNo）----
    //
    // // 「点A再点B」：两个坐标依次点
    // {
    //     id: 'tappair', name: '连点两下', icon: '👆👆',
    //     color: '#fdba74', armedNo: 12, dslType: 'tap',
    //     desc: '选中后在棋盘依次落两个格子，执行时按顺序各点一下',
    //     inMore: true, pairMode: true      // pairMode: 一次落两格
    // },
    //
    // // 「从A滑到B」：模拟滑动
    // {
    //     id: 'dragcell', name: '格子间滑动', icon: '↔️',
    //     color: '#a5b4fc', armedNo: 13, dslType: 'drag',
    //     desc: '选中后在棋盘落起点与终点，执行时从起点滑到终点',
    //     inMore: true, pairMode: true      // pairMode: 一次落两格
    // }
];

// ------------------------------------------------------------
// 查询辅助（其余模块只用这些，不直接读数组）
// ------------------------------------------------------------

function jobBoardActionById(id) {
    const k = String(id || '');
    return JOB_BOARD_ACTIONS.filter(function (a) { return a.id === k; })[0] || null;
}

function jobBoardActionByArmedNo(no) {
    return JOB_BOARD_ACTIONS.filter(function (a) { return a.armedNo === no; })[0] || null;
}

// 左侧常驻显示的（喂豆/铲子）
function jobBoardBuiltinActions() {
    return JOB_BOARD_ACTIONS.filter(function (a) { return a.builtin; });
}

// 「更多」弹窗里的
function jobBoardMoreActions() {
    return JOB_BOARD_ACTIONS.filter(function (a) { return a.inMore; });
}

// 这个槽位键是不是「落子动作」（非植物槽）
function jobIsBoardActionKey(key) {
    return !!jobBoardActionById(key);
}

// 该动作的图标路径（未配置 -> 回退到铲子占位，再回退空串）
function jobBoardActionImg(act) {
    if (!act) return '';
    if (act.img) return act.img;
    const imgs = (typeof JOB_UI_IMG !== 'undefined') ? JOB_UI_IMG : {};
    if (act.imgKey && imgs[act.imgKey]) return imgs[act.imgKey];
    // ★ 图标暂缺时的占位策略（用户要求：先用铲子）
    if (act.placeholder !== false && imgs.shovel) return imgs.shovel;
    return '';
}

// 该动作在棋盘上落子的 item 形状（给 placePlantOnBoard 用）
//
//   ★ 关于 type：它同时决定两件事
//     ① 棋盘/链上选哪套 CSS（.cell .tag.<type>）
//     ② 图片类名（见 08-board-data.js：feed->tag-feed-img，其余->tag-shovel-img）
//
//   而 CSS 里有 `父 .tag.feed + 子 .tag-feed-img` 这种**配对选择器**，
//   两者必须一致，否则图片拿不到 width/height，会退回原始尺寸
//   （例如 500×500）被 .cell{overflow:hidden} 裁成「只剩中心一块」。
//
//   ★ 所以 type 必须用**动作自己的 id**（feed/shovel/tapcell…），
//     CSS 用统配的 `.cell .tag .job-mark-img` 兜底，不再依赖配对。
function jobBoardActionItem(act, mode, r, c, seq) {
    return {
        id: act.id,
        label: act.name,
        type: act.id,          // ★ 用 id 当 type（feed / shovel / tapcell / …）
        mode: mode,
        col: c + 1,
        row: r + 1,
        seq: seq
    };
}
