// ============================================================
// ★★★ 作业集「预留接口」注册表 —— 只放接口，不放实现 ★★★
// ------------------------------------------------------------
//   背景（2026-11-01 用户需求）：
//     「作业集后续还能适配的选项……帮我做接口，不要写实际的功能，
//       做接口存留，给未来做适配。」
//
//   所以本文件的内容 = **数据结构 + 注册表 + 编译/运行时挂钩点**，
//   一行真正的执行逻辑都没有。凡是「以后要做」的功能，都按下面
//   同一个套路登记：
//
//     ┌──────────────────────────────────────────────────────────┐
//     │ 1. 注册表里加一条（本文件）                              │
//     │ 2. 数据字段（t.xxx）+ 导出/读回各一行（27 / 28）         │
//     │ 3. agent 侧同名镜像（agent/jobset/reserved.py）          │
//     │ 4. 真的要实现时：把 implemented 改 true + 补编译/注入    │
//     └──────────────────────────────────────────────────────────┘
//
//   ★ 本文件**不新增任何界面**（用户原话「不要写实际的功能」）：
//     所以下面的动作/选项全都进不了面板、点不出来，只是「存得住、
//     导出得出去、agent 认得」的空壳。要开界面时照 §10.10 的清单
//     补一行渲染即可。
//
//   ★ 加载顺序 = 16（在 15 落子动作注册表之后、20 数据模型之前），
//     因为 jobNewTable / jobBuild / jobApplyLoaded 都要调这里的函数。
//
// ============================================================

// 预留接口的版本号（将来字段形状改了 -> 加一，agent 侧按版本兼容）
const JOB_RESERVED_VERSION = 1;

// ============================================================
// 一、开局前额外动作（选完植物和神器 → 开始战斗之前）
// ------------------------------------------------------------
//   用户原话：「选完植物和神器，开始战斗前可以额外做什么，目前有的：
//     等待（等待指定时间再开）/ 刷僵尸（目前的技术力没法实现，但是可以
//     预留接口）/ 切换僵尸场外加速 / 自动刷新下一波」
//
//   数据字段：t.preBattle = [{ id, side, ...参数 }]
//     side = 'both'（默认，普通关+boss 关都执行）| 'normal' | 'boss'
//     ★ 为什么把 side 写进每一项而不是拆两条数组：
//       这四项里「等待」多半两侧一致，而「切换场外加速」可能只对
//       boss 关开 —— 拆成 preBattle / bossPreBattle 两条数组会让
//       90% 的项两边重复，且以后再加维度更难；一项一个 side 最省。
//
//   ★ 未来实现时唯一的挂钩点（agent 侧已留好常量）：
//       骨架固定为  选取植物 / 无尽_选择编队 → (选取神器?) → 开始战斗
//       开场前动作要插在**选卡终点与「开始战斗」之间**：
//       即把 `选取植物.next` / `无尽_选择编队.next` / `关闭神器界面.next`
//       从 [开始战斗] 改指到一条「开场前动作链」，链尾 next = [开始战斗]。
//       （与神器闸门同一个位置，所以实现时要和 _inject_artifact 一起算，
//         两者都写 next 会互相顶掉 —— 见 §10.5 的「字段分工」约定。）
//
//   参数声明（params）与通用动作同款（见 24-jobset-fields.js 的
//   JOB_PARAM_TYPES 注释）：key / type / label / min / max / def / suffix。
//     ⚠️ 现在 `jobBuildParamControl` 只渲染 type:'int'；'switch' / 'text'
//        是给未来 UI 声明的，**不要**直接把带 switch 参数的动作塞进
//        JOB_MORE_ACTIONS（会渲染成数字框）。本文件里的动作一个都没进
//        面板，所以安全。
// ============================================================
const JOB_PREBATTLE_ACTIONS = [
    {
        // 等待指定时间再开：唯一一个「现在也能算」的项（sleep 不需要坐标），
        // 但仍然**不执行** —— 用户要求这轮只留接口。
        id: 'wait', name: '等待', icon: '⏱', implemented: false, sideDef: 'both',
        desc: '开始战斗前先等指定时长（毫秒），用于等开场动画 / 等加载',
        params: [
            { key: 'ms', type: 'int', label: '等待', min: 0, max: 600000, def: 3000, suffix: 'ms' }
        ]
    },
    {
        // 刷僵尸：界面里没有坐标、也还没研究出「刷」的可靠手法，
        // 所以连 params 都先按「想刷几只」预留。
        id: 'spawn', name: '刷僵尸', icon: '🧟', implemented: false, sideDef: 'both',
        desc: '开局前刷一波僵尸（技术力未到，接口预留；坐标与手法待实测）',
        params: [
            { key: 'times', type: 'int', label: '次数', min: 1, max: 99, def: 1, suffix: '次' }
        ]
    },
    {
        // 僵尸场外加速：游戏设置/场外菜单里的开关，不是棋盘动作 ——
        // 以后实现要走「点坐标表里的开关」或「识别当前状态再点」。
        id: 'zombieSpeed', name: '切换僵尸场外加速', icon: '⏩', implemented: false, sideDef: 'both',
        desc: '开局前把「僵尸场外加速」打开/关闭（开关坐标待拆包）',
        params: [
            { key: 'on', type: 'switch', label: '开启', def: 1 }
        ]
    },
    {
        id: 'refreshWave', name: '自动刷新下一波', icon: '🌊', implemented: false, sideDef: 'both',
        desc: '开局前把「自动刷新下一波」打开/关闭（开关坐标待拆包）',
        params: [
            { key: 'on', type: 'switch', label: '开启', def: 1 }
        ]
    }
];

// ============================================================
// 二、选卡相关（阵容变、真选卡那一次）
// ------------------------------------------------------------
//   用户原话：「选卡同时标收藏（加快选卡速度）」「选卡时自由切换阶数
//              （更加自由的配置）」
//
//   ★ 「标收藏」的落点 = SelectPlants 的 custom_action_param
//     （agent/select_plant/custom_select_plant.py 加一个开关，缺省 = 旧行为）。
//   ★ 「自由切换阶数」的落点 = 选卡前的阶数界面（每槽一档），
//     数据上就是 pickTiers {cardN: 0..5}（0 = 不指定/保持游戏现状）。
//     ⚠️ 不要和 38-jobset-notes.js 的 plant_notes.tier 混起来 ——
//        那个是**给人看的备注**（纯标注、运行时不消费）；
//        pickTiers 是**要真去点界面**的配置，语义不同，故意分开存。
// ============================================================
const JOB_PICK_FEATURES = [
    {
        id: 'favorite', name: '选卡同时标收藏', icon: '⭐', implemented: false,
        field: 'pickFavorite', exportKey: 'pick_favorite', shape: 'bool', def: false,
        desc: '选卡时顺手把用到的植物标成收藏（下次选卡列表里靠前，加快选卡）'
    },
    {
        id: 'tiers', name: '选卡时自由切换阶数', icon: '🎚', implemented: false,
        field: 'pickTiers', exportKey: 'pick_tiers', shape: 'map', def: {},
        desc: '按槽位指定阶数（{cardN: 0..5}，0 = 不指定），开局前逐槽切到指定阶数'
    }
];

// ============================================================
// 三、局内相关
// ------------------------------------------------------------
//   用户原话：「可以用植物的主动技能（就是从切换槽位的位置拖动过去），
//     切换形态更加智能，选择可以切换形态的植物通用动作会跳出切换形态，
//     然后选择植物，再选择点几下切换形态」
//
//   ① 植物主动技能 = **落子动作**族（和喂豆/铲子/点击格子同一套）：
//      「从槽位按钮拖到格子」= 起点是「槽N切换形态」那一组坐标，
//      所以它需要一个 per-段 的 slot 字段（见下方 boardAction 定义）。
//      实现时要补：15 注册表的 dslType:'skill' + compile.py 里
//      `src = dsl.form_point(coords, seg['slot'])`（坐标现成）。
//   ② 切换形态·智能 = 现有通用动作 ga:form 的**扩展形态**：
//      现在只能「选槽位 + 点几次」；以后要能「选植物 -> 再点几次」，
//      即段上多一个 plant 字段（植物名），编译时先按植物名定位它是第几槽。
//      ⚠️ 不要直接把 plant 塞进 JOB_FORM_ACTION.params —— 参数系统的
//        渲染器只支持 int（会渲染成数字框）。要等新的控件类型
//        一起做（本文件 params 里声明的 type:'plant' 就是这个意思）。
// ============================================================
const JOB_INBATTLE_RESERVED = [
    {
        id: 'skill', name: '植物主动技能', icon: '✨', kind: 'boardAction',
        implemented: false, dslType: 'skill',
        desc: '选中后在棋盘落子：执行时从「槽N切换形态」位置拖到该格（触发主动技能）',
        // 落子动作的段上字段（实现时挂在 seg.slot 上，不是 params 系统）
        segFields: [{ key: 'slot', type: 'int', label: '槽位', min: 1, max: 8, def: 1 }]
    },
    {
        id: 'formSmart', name: '切换形态·智能', icon: '🔄', kind: 'genericAction',
        implemented: false, genericId: 'form',
        desc: '切换形态时先选植物、再选点几下（而不是只认槽位号）',
        // 未来要塞进 ga:form 段、并让参数系统渲染的字段
        extraParams: [{ key: 'plant', type: 'plant', label: '植物', def: '' }]
    }
];

// ============================================================
// 四、局外相关
// ------------------------------------------------------------
//   用户原话：「配置作业链，每个世界都导入一次，然后智能识别当前的世界，
//     去替换对应作业链的阵容，选择正赛会检查正赛有没有开」
//
//   ① 世界作业链（world_chains）：作业集级。
//      「每个世界都导入一次」= 一份作业集里给每个世界存一套阵容替换方案；
//      「智能识别当前世界」= 运行时读 GUI 选项「选择世界」的注入值
//      （JobSetLoad 已经在读，_check_world 拿它做告警），命中就替换。
//      数据形状（预留，未消费）：
//        world_chains = {
//          enable: false,
//          items: [{
//            world: '海盗港湾',        // 世界名，取值同 JOB_WORLDS
//            table: 1,                 // 替换第几张表（1 起；0/缺省 = 全部表）
//            side: 'both',             // 'both' | 'normal' | 'boss'
//            slots: { 1: '植物名', … }, // 该表的槽位阵容
//            lineup: ['…'],            // 或者直接给植物列表（slots 为空时用）
//            squad: null,              // 或者切编队（1..6）
//            artifact: null            // 神器
//          }]
//        }
//   ② 正赛检查（mode_check）：作业集级。
//      「选择正赛会检查正赛有没有开」= 开局前确认当前是不是正赛模式；
//      数据形状（预留，未消费）：
//        mode_check = { enable: false, expect: 'ranked' | 'training' | 'any',
//                       on_missing: 'warn' | 'abort' }
//      ★ 判据从哪来：task/Endless_ref.json 的「正赛 / 训练」两个 case
//        （GUI 选项「无尽挑战模式」），运行时能读到注入值 ——
//        但**别在 pipe 里加节点**，用 JobSetLoad 的 early-return 就够了。
// ============================================================
const JOB_OUTER_RESERVED = [
    {
        id: 'worldChains', name: '世界作业链', icon: '🌍', kind: 'jobset', implemented: false,
        field: 'worldChains', exportKey: 'world_chains',
        desc: '按当前世界替换对应阵容（每个世界一套，运行时识别当前世界后套用）'
    },
    {
        id: 'modeCheck', name: '正赛模式检查', icon: '🏆', kind: 'jobset', implemented: false,
        field: 'modeCheck', exportKey: 'mode_check',
        desc: '开局前检查当前是不是正赛（不是就按配置告警/中止）'
    }
];

// ------------------------------------------------------------
// 预留补位的落子动作（塞进 15 的注册表，但**不可达**）
//
//   为什么塞进 JOB_BOARD_ACTIONS 而不是只在文档里写一行：
//     `jobSlotKeyOf` / `jobAllSlotKeys` / `slotModes` 默认值 / 链段识别
//     全都只认注册表里的动作 —— 提前登记好，将来实现时**不用再动**
//     这些联动点（§10.3 的「只改一个文件」就是靠这个）。
//   为什么不会污染界面：
//     `builtin:false` + `inMore:false` -> 左侧不显示、「更多」里也没有；
//     §10.3.2 的常驻规则还要求「棋盘上已有落子」才出现 ——
//     而它落不了子（没有入口），所以永远看不见、W/S 也循环不到。
// ------------------------------------------------------------
const JOB_RESERVED_BOARD_ACTIONS = [
    {
        id: 'skill', name: '植物主动技能', icon: '✨',
        color: '#fcd34d', armedNo: 13, dslType: 'skill',
        desc: '拖拽触发植物主动技能（预留：执行时从槽位按钮拖到格子）',
        builtin: false, inMore: false, reserved: true, implemented: false
    }
];

// 把预留动作登记进 15 的注册表（15 一定先加载；万一没有就跳过，别炸）
(function jobReservedRegisterBoardActions() {
    if (typeof JOB_BOARD_ACTIONS === 'undefined' || !Array.isArray(JOB_BOARD_ACTIONS)) return;
    JOB_RESERVED_BOARD_ACTIONS.forEach(function (act) {
        const exists = JOB_BOARD_ACTIONS.some(function (a) { return a && a.id === act.id; });
        if (!exists) JOB_BOARD_ACTIONS.push(act);
    });
})();

// ============================================================
// 五、查询 / 判定辅助
// ============================================================

// 某类预留项的「是不是真做了」判据（现在恒 false；实现后改注册表）
function jobReservedImplemented(def) {
    return !!(def && def.implemented === true);
}

// 未实现的说明文案（状态栏 / 日志用）
function jobReservedReason(def) {
    const nm = (def && def.name) || '预留功能';
    return nm + '：接口已预留，当前版本未实现（改了也不会执行）';
}

// 按 id 找开局前动作定义
function jobPreBattleById(id) {
    const k = String(id || '');
    return JOB_PREBATTLE_ACTIONS.filter(function (a) { return a.id === k; })[0] || null;
}

// 段上的参数声明（与 24 的 jobActionParams 同构，独立命名避免混用）
function jobPreBattleParams(def) {
    if (!def || !Array.isArray(def.params)) return [];
    return def.params.filter(function (p) { return p && p.key; });
}

// side 归一化：'both' | 'normal' | 'boss'（非法/缺省 -> 'both'）
function jobReservedSide(v) {
    const s = String(v || '');
    return (s === 'normal' || s === 'boss') ? s : 'both';
}

// 该项在这一关别下要不要执行（现在只是数据层判定，没人消费）
function jobPreBattleAppliesTo(item, isBoss) {
    const s = jobReservedSide(item && item.side);
    if (s === 'both') return true;
    return isBoss ? s === 'boss' : s === 'normal';
}

// 取某表的开场前动作列表（永远返回数组，调用方不必判空）
function jobPreBattleList(t) {
    if (!t || !Array.isArray(t.preBattle)) return [];
    return t.preBattle.filter(function (it) {
        return it && it.id && jobPreBattleById(it.id);
    });
}

// 某一关别下真正会跑的那些项（顺序 = 用户插入顺序）
function jobPreBattleFor(t, isBoss) {
    return jobPreBattleList(t).filter(function (it) {
        return jobPreBattleAppliesTo(it, isBoss);
    });
}

// 一项的可读摘要（chip / 状态栏 / 播报用），如「等待 3000ms」
function jobPreBattleSummary(item) {
    const def = jobPreBattleById(item && item.id);
    if (!def) return '';
    const ps = jobPreBattleParams(def);
    if (!ps.length) return def.name;
    const vals = ps.map(function (p) {
        const raw = item[p.key];
        const v = (raw === undefined || raw === null || raw === '') ? p.def : raw;
        return (p.prefix || '') + v + (p.suffix || '');
    }).filter(function (s) { return s !== ''; });
    return def.name + (vals.length ? ' ' + vals.join(' 丨 ') : '');
}

// ============================================================
// 六、默认值 / 导出 / 读回（三处唯一入口）
//
//   ★ 为什么集中在这里：新字段最容易死在「漏了导出」或「漏了读回」
//     （§10.2 E 的四处坑）。留接口时就把三条路径一次接好，
//     将来实现功能只需要动注册表的 implemented 标记 + 编译/注入。
// ============================================================

// 新表默认值（jobNewTable 调）
function jobReservedDefaults(t) {
    if (!t) return t;
    if (!Array.isArray(t.preBattle)) t.preBattle = [];
    if (typeof t.pickFavorite !== 'boolean') t.pickFavorite = false;
    if (!t.pickTiers || typeof t.pickTiers !== 'object' || Array.isArray(t.pickTiers)) t.pickTiers = {};
    return t;
}

// 作业集级默认值（jobResetEditor / 首次载入调）
let jobReservedTop = { worldChains: null, modeCheck: null };

function jobReservedTopDefaults() {
    jobReservedTop = {
        // 世界作业链（预留，未消费）
        worldChains: { enable: false, items: [] },
        // 正赛模式检查（预留，未消费）
        modeCheck: { enable: false, expect: 'ranked', onMissing: 'warn' }
    };
    return jobReservedTop;
}

// ★ 加载即初始化：别让「reset / import 之前就读它」的代码拿到 null
//   （函数声明会提升，所以这里直接调是安全的）。
jobReservedTopDefaults();

// 作业集级：读回（jobApplyLoaded 调）
function jobReservedTopImport(job) {
    jobReservedTopDefaults();
    const j = (job && typeof job === 'object') ? job : {};
    // ---- world_chains ----
    const wc = j.world_chains;
    if (wc && typeof wc === 'object') {
        jobReservedTop.worldChains.enable = (wc.enable === true);
        const items = Array.isArray(wc.items) ? wc.items : [];
        jobReservedTop.worldChains.items = items.filter(function (it) {
            return it && typeof it === 'object' && typeof it.world === 'string' && it.world;
        }).map(function (it) {
            return {
                world: String(it.world),
                table: Number.isFinite(Number(it.table)) ? Number(it.table) : 0,
                side: jobReservedSide(it.side),
                slots: (it.slots && typeof it.slots === 'object') ? Object.assign({}, it.slots) : {},
                lineup: Array.isArray(it.lineup) ? it.lineup.slice() : [],
                squad: (Number.isFinite(Number(it.squad)) && Number(it.squad) >= 1 && Number(it.squad) <= 6)
                    ? Number(it.squad) : null,
                artifact: (it.artifact === undefined ? null : it.artifact)
            };
        });
    }
    // ---- mode_check ----
    const mc = j.mode_check;
    if (mc && typeof mc === 'object') {
        jobReservedTop.modeCheck.enable = (mc.enable === true);
        const ex = String(mc.expect || 'ranked');
        jobReservedTop.modeCheck.expect = (['ranked', 'training', 'any'].indexOf(ex) !== -1) ? ex : 'ranked';
        const om = String(mc.on_missing || mc.onMissing || 'warn');
        jobReservedTop.modeCheck.onMissing = (om === 'abort') ? 'abort' : 'warn';
    }
    return jobReservedTop;
}

// 作业集级：导出（jobBuild 调）
function jobReservedTopExport() {
    const wc = jobReservedTop.worldChains || { enable: false, items: [] };
    const mc = jobReservedTop.modeCheck || { enable: false, expect: 'ranked', onMissing: 'warn' };
    return {
        // 预留接口版本（agent 侧 reserved.py 按它做兼容）
        reserved_version: JOB_RESERVED_VERSION,
        world_chains: {
            enable: wc.enable === true,
            items: JSON.parse(JSON.stringify(wc.items || []))
        },
        mode_check: {
            enable: mc.enable === true,
            expect: mc.expect || 'ranked',
            on_missing: mc.onMissing || 'warn'
        }
    };
}

// 表级：读回（jobApplyLoaded 每张表调）
function jobReservedImport(t, raw) {
    if (!t) return t;
    jobReservedDefaults(t);
    const src = (raw && typeof raw === 'object') ? raw : {};
    // ---- 开局前动作 ----
    const pb = src.pre_battle !== undefined ? src.pre_battle : src.preBattle;
    if (Array.isArray(pb)) {
        t.preBattle = pb.filter(function (it) {
            return it && typeof it === 'object' && it.id && jobPreBattleById(it.id);
        }).map(function (it) {
            const def = jobPreBattleById(it.id);
            const out = { id: String(it.id), side: jobReservedSide(it.side) };
            // 只收该动作声明过的参数，别把杂字段带进来
            jobPreBattleParams(def).forEach(function (p) {
                if (it[p.key] !== undefined && it[p.key] !== null && it[p.key] !== '') {
                    out[p.key] = it[p.key];
                }
            });
            return out;
        });
    }
    // ---- 选卡：标收藏 ----
    const fav = (src.pick_favorite !== undefined) ? src.pick_favorite : src.pickFavorite;
    if (typeof fav === 'boolean') t.pickFavorite = fav;
    // ---- 选卡：阶数 ----
    const tiers = (src.pick_tiers !== undefined) ? src.pick_tiers : src.pickTiers;
    if (tiers && typeof tiers === 'object' && !Array.isArray(tiers)) {
        const out = {};
        Object.keys(tiers).forEach(function (k) {
            const slot = parseInt(k, 10);
            const v = parseInt(tiers[k], 10);
            if (!Number.isFinite(slot) || slot < 1 || slot > 8) return;
            if (!Number.isFinite(v) || v < 0 || v > 5) return;
            if (v === 0) return;               // 0 = 不指定，不落盘
            out[slot] = v;
        });
        t.pickTiers = out;
    }
    return t;
}

// 表级：导出（jobBuild 每张表调）
function jobReservedExport(t) {
    const d = jobReservedDefaults(t ? t : {});
    return {
        // 开局前额外动作（预留，未消费）：[{id, side, …参数}]
        pre_battle: jobPreBattleList(d).map(function (it) {
            const def = jobPreBattleById(it.id);
            const out = { id: it.id, side: jobReservedSide(it.side) };
            jobPreBattleParams(def).forEach(function (p) {
                const raw = it[p.key];
                if (raw !== undefined && raw !== null && raw !== '') out[p.key] = raw;
            });
            return out;
        }),
        // 选卡同时标收藏（预留，未消费）
        pick_favorite: (d.pickFavorite === true),
        // 选卡时自由切换阶数（预留，未消费）：{ "1": 3, … }（0 不写）
        pick_tiers: Object.assign({}, d.pickTiers || {})
    };
}

// ============================================================
// 七、编译挂钩点（现在恒「空」）
// ------------------------------------------------------------
//   与 agent 侧 agent/jobset/reserved.py 的 premake_dsl / pre_battle_dsl 一一对应。
//   将来实现时**只改这里**，网页端预览 / 校验都走同一个入口。
//
//   返回 { dsl:'', missing:[…] } —— 形状与 agent 的 generic_dsl 一致，
//   所以调用方（导出预览、未来的校验器）可以无脑拼。
// ============================================================
function jobPreBattleCompile(t, isBoss) {
    const items = jobPreBattleFor(t, isBoss);
    if (!items.length) return { dsl: '', missing: [], count: 0 };
    return {
        dsl: '',
        missing: items.map(function (it) { return jobReservedReason(jobPreBattleById(it.id)); }),
        count: 0
    };
}

// 预留功能全表（给文档 / 自测 / 将来的「⚙ 高级设置」用）
function jobReservedCatalog() {
    const out = [];
    JOB_PREBATTLE_ACTIONS.forEach(function (a) { out.push(Object.assign({ group: 'preBattle' }, a)); });
    JOB_PICK_FEATURES.forEach(function (a) { out.push(Object.assign({ group: 'pick' }, a)); });
    JOB_INBATTLE_RESERVED.forEach(function (a) { out.push(Object.assign({ group: 'inBattle' }, a)); });
    JOB_OUTER_RESERVED.forEach(function (a) { out.push(Object.assign({ group: 'outer' }, a)); });
    return out;
}

// 一行摘要（将来状态栏/工具提示用）；没有预留项时返回空串
function jobReservedSummary(t) {
    const parts = [];
    const pb = jobPreBattleList(t);
    if (pb.length) parts.push('开场前 ' + pb.length + ' 项（未实现）');
    if (t && t.pickFavorite === true) parts.push('选卡标收藏（未实现）');
    const tiers = (t && t.pickTiers) ? Object.keys(t.pickTiers).length : 0;
    if (tiers) parts.push('选卡阶数 ' + tiers + ' 槽（未实现）');
    return parts.join(' 丨 ');
}
