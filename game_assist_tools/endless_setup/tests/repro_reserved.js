// ============================================================
// 回归测试：作业集「预留接口」（16-jobset-reserved.js）
//
// 用户需求（2026-11-01）：
//   「作业集后续还能适配的选项……帮我做接口，不要写实际的功能，
//     做接口存留，给未来做适配」
//
// 运行：node tests\repro_reserved.js
// 退出码：0 = 全过；1 = 有断言失败
//
// 这一套只盯「接口」本身，不测任何游戏行为：
//   1. 注册表齐全（开局前动作 4 / 选卡 2 / 局内 2 / 局外 2），且全部 implemented=false；
//   2. 新表自动带上预留字段（jobNewTable -> jobReservedDefaults）；
//   3. ★ 导出（jobBuild）真的带 pre_battle / pick_favorite / pick_tiers
//      + 作业集级 reserved_version / world_chains / mode_check；
//   4. ★ 读回（jobReservedImport）能把导出原样吃回去，且**丢了脏数据**
//      （未知 id / 非法 side / 越界阶数）；
//   5. 旧作业集（没有这些字段）导出的必须是默认值 —— 行为与旧版一字不差；
//   6. 预留的落子动作「植物主动技能」不可达（不在更多、不在内置、W/S 循环不到）；
//   7. 编译入口 jobPreBattleCompile 恒空（有人悄悄实现 -> 本套必红）。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS_DIR = path.join(__dirname, '..', 'static', 'js');

let fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  ✅ ' + msg); return; }
    fails++;
    console.log('  ❌ ' + msg);
}
function eq(actual, expect, msg) {
    ok(JSON.stringify(actual) === JSON.stringify(expect),
        msg + '（实际=' + JSON.stringify(actual) + '，期望=' + JSON.stringify(expect) + '）');
}

function mkSandbox() {
    const sandbox = {
        console,
        document: {
            addEventListener() { }, getElementById() { return null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() {
                return { style: {}, appendChild() { }, addEventListener() { }, setAttribute() { },
                    classList: { add() { }, remove() { }, contains() { return false; } } };
            },
            head: { appendChild() { } },
        },
        localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
        alert() { }, setTimeout() { return 0; }, clearTimeout() { },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // ★ 16 必须在 15 之后、20 之前（与 index.html 的加载顺序一致）
    for (const f of ['04-cards.js', '08-board-data.js', '15-board-actions.js',
        '16-jobset-reserved.js', '20-jobset-core.js', '21-jobset-levels.js',
        '22-jobset-chain.js', '23-jobset-end.js', '24-jobset-fields.js',
        '27-jobset-board.js', '29-jobset-init.js']) {
        try {
            vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
        } catch (e) {
            console.log('LOAD ' + f + ': ' + e.message);
        }
    }
    // jobBuild 会调一批「作业集级」取值函数（散在 31/32/37/38/41 里，
    // 本套不加载它们，直接给等价的桩 —— 这里测的是预留接口的导出/读回）。
    vm.runInContext(`
renderAllBoards = function(){};
updatePreview = function(){};
setStatus = function(){};
jobRenderSeqChains = function(){};
jobRenderSlots = function(){};
jobFillForm = function(){};
jobRenderTabs = function(){};
jobRenderEndParams = function(){};
jobRenderMech = function(){};
jobRenderRefGhosts = function(){};
jobRenderPlantGrid = function(){};
jobOuterRefreshBadge = function(){};
jobRefreshBossLineupUI = function(){};
jobSaveLocal = function(){ jobUndoRecord(); };
jobGetWorld = function(){ return ''; };
jobGetSubWorlds = function(){ return []; };
jobGetPlantNotes = function(){ return {}; };
jobGetArtifactNotes = function(){ return {}; };
jobGetTags = function(){ return []; };
jobGetEveryN = function(){ return 10; };
jobGetSwipeMs = function(){ return 80; };
jobArtifactOf = function(){ return null; };
plantCache = [{ name: '豌豆射手', img: 'a.png', rare: 0 }];
function blankBoard(){
  var b = [];
  for (var r = 0; r < 5; r++) { var row = []; for (var c = 0; c < 9; c++) row.push([]); b.push(row); }
  return b;
}
`, sandbox);
    return sandbox;
}

const S = mkSandbox();
const G = (name) => vm.runInContext(name, S);

// ---------------------------------------------------------------------------
console.log('\n=== 1. 注册表齐全 + 全部未实现 ===');
const pb = G('JOB_PREBATTLE_ACTIONS');
eq(pb.map(a => a.id), ['wait', 'spawn', 'zombieSpeed', 'refreshWave'],
    '开局前动作 4 项、顺序固定（等待/刷僵尸/切换场外加速/自动刷新下一波）');
ok(pb.every(a => a.implemented === false), '开局前动作全部 implemented=false（只留接口）');
ok(pb.every(a => a.name && a.desc && Array.isArray(a.params)), '每项都有 name/desc/params');
G('JOB_PICK_FEATURES').length === 2
    ? ok(true, '选卡预留 2 项')
    : ok(false, '选卡预留 2 项');
eq(G('JOB_PICK_FEATURES').map(a => a.exportKey), ['pick_favorite', 'pick_tiers'],
    '选卡预留的导出字段名 = pick_favorite / pick_tiers');
eq(G('JOB_INBATTLE_RESERVED').map(a => a.id), ['skill', 'formSmart'],
    '局内预留 2 项（植物主动技能 / 智能切换形态）');
eq(G('JOB_OUTER_RESERVED').map(a => a.exportKey), ['world_chains', 'mode_check'],
    '局外预留的导出字段名 = world_chains / mode_check');
ok(G('JOB_RESERVED_VERSION') === 1, '预留接口版本号 = 1（与 agent 侧同值）');
ok(G('jobReservedCatalog()').length === 10, '总表 10 项（4+2+2+2）');

// ---------------------------------------------------------------------------
console.log('\n=== 2. 新表自动带预留字段默认值 ===');
G('jobTables.length = 0; jobNewTable(); currentTable = 0; jobLoadTable(0, true);');
const t0 = G('jobTables[0]');
eq(t0.preBattle, [], 'preBattle 默认是空数组');
ok(t0.pickFavorite === false, 'pickFavorite 默认 false');
eq(t0.pickTiers, {}, 'pickTiers 默认空表');

// ---------------------------------------------------------------------------
console.log('\n=== 3. 导出：默认值（没配也必须把字段写出去）===');
let job = G('jobBuild()');
const jt0 = job.tables[0];
eq(jt0.pre_battle, [], '表级 pre_battle 导出为空数组');
ok(jt0.pick_favorite === false, '表级 pick_favorite 导出 false');
eq(jt0.pick_tiers, {}, '表级 pick_tiers 导出空对象');
ok(job.reserved_version === 1, '作业集级 reserved_version 导出 1');
eq(job.world_chains, { enable: false, items: [] }, '作业集级 world_chains 默认未启用');
eq(job.mode_check, { enable: false, expect: 'ranked', on_missing: 'warn' },
    '作业集级 mode_check 默认未启用 / expect=ranked / on_missing=warn');

// ---------------------------------------------------------------------------
console.log('\n=== 4. 导出：配了值就原样写出去 ===');
G(`
jobTables[0].preBattle = [
  { id: 'wait',  side: 'both', ms: 2500 },
  { id: 'spawn', side: 'boss', times: 3 }
];
jobTables[0].pickFavorite = true;
jobTables[0].pickTiers = { 1: 5, 3: 2 };
jobReservedTop.worldChains.enable = true;
jobReservedTop.worldChains.items = [{ world: '海盗港湾', table: 1, side: 'both',
  slots: { 1: '豌豆射手' }, lineup: [], squad: null, artifact: null }];
jobReservedTop.modeCheck.enable = true;
jobReservedTop.modeCheck.onMissing = 'abort';
`);
job = G('jobBuild()');
const jt1 = job.tables[0];
eq(jt1.pre_battle, [{ id: 'wait', side: 'both', ms: 2500 },
                    { id: 'spawn', side: 'boss', times: 3 }],
    'pre_battle 按插入顺序导出（含 side 与参数）');
ok(jt1.pick_favorite === true, 'pick_favorite 导出 true');
eq(jt1.pick_tiers, { 1: 5, 3: 2 }, 'pick_tiers 导出 {槽号: 阶数}');
ok(job.world_chains.enable === true && job.world_chains.items[0].world === '海盗港湾',
    'world_chains 导出启用 + 条目');
ok(job.mode_check.enable === true && job.mode_check.on_missing === 'abort',
    'mode_check 导出启用 + on_missing=abort');

// ---------------------------------------------------------------------------
console.log('\n=== 5. 读回：导出原样吃回去 + 丢掉脏数据 ===');
const back = G('(function(){ var t = {}; jobReservedImport(t, ' + JSON.stringify(jt1) + '); return t; })()');
eq(back.preBattle, jt1.pre_battle, '读回后 preBattle 与导出一致（存得住）');
ok(back.pickFavorite === true, '读回后 pickFavorite = true');
eq(back.pickTiers, { 1: 5, 3: 2 }, '读回后 pickTiers 一致');
const dirty = G(`(function(){
  var t = {};
  jobReservedImport(t, {
    pre_battle: [
      { id: 'wait', side: '不是关别', ms: 1000, 垃圾: 1 },
      { id: '根本没这个动作', ms: 5 },
      '不是对象'
    ],
    pick_favorite: 'yes',
    pick_tiers: { 1: 9, 2: 0, 99: 3, x: 2, 4: 3 }
  });
  return t;
})()`);
eq(dirty.preBattle, [{ id: 'wait', side: 'both', ms: 1000 }],
    '读回丢掉未知 id / 非对象 / 未声明字段；非法 side 回落 both');
ok(dirty.pickFavorite === false, 'pick_favorite 非布尔（字符串）-> 保持 false');
eq(dirty.pickTiers, { 4: 3 }, 'pick_tiers 丢掉越界阶数 9 / 0 / 非法槽 99 / 非数字键');
const old = G(`(function(){ var t = {}; jobReservedImport(t, {}); return t; })()`);
eq(old.preBattle, [], '旧作业集（无字段）读回 -> preBattle 空');
ok(old.pickFavorite === false && JSON.stringify(old.pickTiers) === '{}',
    '旧作业集（无字段）读回 -> pickFavorite false / pickTiers 空');

// ---------------------------------------------------------------------------
console.log('\n=== 6. 摘要 / 关别过滤 / 编译入口 ===');
ok(G("jobPreBattleSummary({ id: 'wait', ms: 1500 })") === '等待 1500ms',
    '摘要文案 = 「等待 1500ms」');
ok(G("jobPreBattleSummary({ id: 'spawn', times: 3 })") === '刷僵尸 3次',
    '摘要文案 = 「刷僵尸 3次」');
eq(G("jobPreBattleFor({ preBattle: [{ id:'wait', side:'both' }, { id:'spawn', side:'boss' }] }, false).length"), 1,
    '普通关只拿到 side=both（boss 专属项被过滤）');
eq(G("jobPreBattleFor({ preBattle: [{ id:'wait', side:'both' }, { id:'spawn', side:'boss' }] }, true).length"), 2,
    'boss 关拿到 both + boss 两项');
const cmp = G('jobPreBattleCompile({ preBattle: [{ id: "wait", ms: 1000 }] }, false)');
ok(cmp.dsl === '' && cmp.count === 0, 'jobPreBattleCompile 现在恒返回空 DSL（不执行）');
ok(cmp.missing.length === 1 && cmp.missing[0].indexOf('未实现') >= 0,
    '空理由里写明「未实现」');
const sum = G('jobReservedSummary({ preBattle: [{ id: "wait" }], pickFavorite: true, pickTiers: { 1: 3 } })');
ok(sum.indexOf('未实现') >= 0 && sum.indexOf('开场前 1 项') >= 0,
    '状态栏摘要带上「未实现」，不会让人以为已经生效');

// ---------------------------------------------------------------------------
console.log('\n=== 7. 预留的落子动作「植物主动技能」不可达 ===');
const skill = G("jobBoardActionById('skill')");
ok(!!skill && skill.reserved === true && skill.implemented === false,
    '注册表里确实有 skill（将来实现时不用再动联动点）');
ok(G('jobBoardMoreActions().map(a => a.id)').indexOf('skill') === -1,
    '不在「更多」弹窗里（没有入口 -> 落不了子）');
ok(G('jobBoardBuiltinActions().map(a => a.id)').indexOf('skill') === -1,
    '不是内置常驻动作（左侧面板看不见）');
G('jobArmedSlot = 0; jobTables[0].boardEarly = blankBoard(); jobTables[0].boardLate = blankBoard();');
ok(G('jobBoardActionCycleable(jobBoardActionById("skill"))') === false,
    'W/S 循环不到它（棋盘上没有落子 = 不可达）');
ok(G('jobIsBoardActionKey("skill")') === true,
    '但 jobIsBoardActionKey 认它（手写 JSON 撞上时不会当植物槽处理）');

// ---------------------------------------------------------------------------
console.log('\n=== 8. 预留字段不污染已有机制 ===');
ok(Object.keys(G('jobTables[0].slotModes')).indexOf('card1') >= 0,
    'slotModes 仍有植物槽（预留动作只是多一个键）');
ok(G('jobAllSlotKeys()').indexOf('skill') >= 0,
    'jobAllSlotKeys 里带 skill（注册表驱动，符合 §10.3）');
const chainKeys = G("JSON.stringify(Object.keys(jobTables[0].preBattle[0] || {}))");
ok(chainKeys === '["id","side"]' || chainKeys === '["id","side","ms"]',
    'preBattle 项只有 id/side/参数，没有夹带别的字段');

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(52));
if (fails) {
    console.log('FAILED ' + fails + ' 条断言');
    process.exit(1);
}
console.log('全部通过（预留接口：接口在、功能不在）');
