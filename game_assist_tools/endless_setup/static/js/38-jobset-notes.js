
// ============================================================
// 备注配置弹窗（2026-10-13）—— 神器/植物总览 + 阶数/挂件标注
//                        （2026-10-26 起按「标签」分套）
//
// 交互（用户定的流程）：
//   点「📝 配置」→ 弹窗列出本作业集用到的所有神器与植物（总览）。
//   「调配阶数」模式：先在阶数条里选 1-5 阶（或任意），再点植物/神器 -> 落定。
//                    （2026-10-25 起神器也可调配阶数）
//   「佩戴挂件」模式：先在挂件条里选挂件，（可选）在挂件阶数条选阶数，
//                    再点植物 -> 佩戴（每株仅一个，再选即替换；选「卸下」
//                    再点植物 = 摘除）。挂件阶数 1-5 / 任意（2026-10-25）。
//   仅作展示与导出，不影响运行时逻辑。
//
// ★ 标签分套（2026-10-26，41-jobset-tags.js）：
//   作业集挂了标签（场外加速 / 刷新下一波 / 氪金档位）后，弹窗顶部出现标签条：
//   「通用」+ 本作业集挂上的标签。每个标签各存一套标注，切换即切换那一套。
//   某标签里**没标的植物/字段**自动回落到「通用」那一套（角标半透明显示），
//   所以只需要标「和通用不一样的部分」。
//
// 数据：jobNotesStore = { 标签: { plants: {植物名: {tier, pendant, pendantTier, costume}},
//                                  artifacts: {神器名: {tier}} } }
//       「通用」= 所有标签的回落基准（旧作业集/旧缓存直接落在这里）。
//   出口：jobGetPlantNotes() / jobSetPlantNotes(n)        —— 通用套（旧字段 plant_notes）
//         jobGetArtifactNotes() / jobSetArtifactNotes(n)  —— 通用套（旧字段 artifact_notes）
//         jobGetTagNotes() / jobSetTagNotes(n)            —— 非通用标签套（新字段 tag_notes）
//         jobGetNoteTag() / jobSetNoteTag(t)              —— 弹窗当前编辑的标签
//
// 素材：static/pendants/item_*.png（挂件，45 个，有中文名的全收录）
//       static/ranks/rank1..5.png（卡面阶数角标）
// ============================================================

const PENDANT_IMG_DIR = '/static/pendants/';
const RANK_IMG_DIR = '/static/ranks/';

// 挂件清单（对照表里有中文名的 45 个；item_hat/item_ring 无中文名未收录）
const JOB_PENDANTS = [
    { img: 'item_accelerate.png', name: '加速花盆' },
    { img: 'item_candy_basket.png', name: '糖果篮子' },
    { img: 'item_clock.png', name: '戴夫的闹钟' },
    { img: 'item_cost.png', name: '太阳能花盆' },
    { img: 'item_cost2.png', name: '节能罐' },
    { img: 'item_drum.png', name: '时空铁桶' },
    { img: 'item_duck.png', name: '小黄鸭游泳圈' },
    { img: 'item_explode.png', name: '超能火药桶' },
    { img: 'item_fertilizer.png', name: '珍稀的肥料' },
    { img: 'item_flying_saucer.png', name: '幽浮飞碟' },
    { img: 'item_heavy_shackles.png', name: '粗制抑能链' },
    { img: 'item_hero_cape_1.png', name: '降魔披风' },
    { img: 'item_hero_crown.png', name: '英雄王冠' },
    { img: 'item_magic_book_1.png', name: '高阶魔法书' },
    { img: 'item_magic_book_2.png', name: '学徒魔法书' },
    { img: 'item_mithril_shackles.png', name: '精制抑能链' },
    { img: 'item_painkiller_1.png', name: '止疼剂' },
    { img: 'item_painkiller_2.png', name: '止疼片' },
    { img: 'item_pole.png', name: '巨人的电线杆' },
    { img: 'item_regeneration.png', name: '万能医药箱' },
    { img: 'item_slingshot_1.png', name: '金属弹弓' },
    { img: 'item_slingshot_2.png', name: '木质弹弓' },
    { img: 'item_snowflake.png', name: '闪耀雪花挂坠' },
    { img: 'item_sun_gear_1.png', name: '阳光齿轮' },
    { img: 'item_sunmoney.png', name: '聚光花盆' },
    { img: 'item_super_clock.png', name: '紫色手套' },
    { img: 'item_super_clock_1.png', name: '红蜡烛' },
    { img: 'item_super_clock_2.png', name: '白蜡烛' },
    { img: 'item_super_clock_3.png', name: '太阳锅盔' },
    { img: 'item_super_clock_4.png', name: '月亮锅盔' },
    { img: 'item_super_clock_5.png', name: '公主冰冠' },
    { img: 'item_super_clock_6.png', name: '女王冰冠' },
    { img: 'item_super_clock_7.png', name: '牛仔手套' },
    { img: 'item_super_clock_8.png', name: '聚能电池' },
    { img: 'item_super_clock_9.png', name: '节能电池' },
    { img: 'item_super_clock_10.png', name: '强效杀虫剂' },
    { img: 'item_super_clock_11.png', name: '杀虫剂' },
    { img: 'item_super_clock_12.png', name: '大爆竹' },
    { img: 'item_super_clock_13.png', name: '爆竹' },
    { img: 'item_super_clock_14.png', name: '小时钟' },
    { img: 'item_super_clock_15.png', name: '加速时钟' },
    { img: 'item_super_clock_16.png', name: '警用电击棍' },
    { img: 'item_super_clock_17.png', name: '电击棍' },
    { img: 'item_torch.png', name: '精制的火把' },
    { img: 'item_travel_together_1.png', name: '时光胶囊' },
];
const JOB_PENDANT_IMG = {};   // 挂件中文名 -> 图标文件
JOB_PENDANTS.forEach(function (p) { JOB_PENDANT_IMG[p.name] = p.img; });

// ---- 状态（作业集级）----
// ★ 2026-10-26 起按标签分套：jobNotesStore[标签].plants / .artifacts
//   「通用」= 回落基准（旧数据都落这里）
const JOB_NOTE_TAG = '通用';
let jobNotesStore = { '通用': { plants: {}, artifacts: {} } };
let jobNoteTag = JOB_NOTE_TAG;   // 弹窗当前编辑的标签（'' -> 视作通用）
let npMode = 'view';             // view | tier | pendant | costume
let npArmTier = 0;               // 阶数条当前武装值（0 = 任意）
let npArmPendant = null;         // 挂件条当前武装（null = 未选；'' = 卸下）
let npArmPendantTier = 0;        // 挂件阶数条当前武装（0 = 任意阶）

// ---- 备注清洗（空字段剪掉；全空 = null）----
//   allowNeutral = 该套是「标签套」：允许显式取消值并存盘，用来盖掉通用套 ——
//     tier: 0  = 本标签任意阶（通用标了 5 阶也盖掉）
//     pendant: "" = 本标签不带挂件
//     costume: false = 本标签不需要装扮
function _npTier(v) {
    const t = parseInt(v);
    return (t >= 1 && t <= 5) ? t : 0;
}
function _npCleanPlant(n, allowNeutral) {
    if (!n || typeof n !== 'object') return null;
    const out = {};
    const tier = _npTier(n.tier);
    const pendant = (typeof n.pendant === 'string') ? n.pendant : undefined;
    const ptier = _npTier(n.pendantTier);
    if (tier >= 1) out.tier = tier;
    else if (allowNeutral && n.tier !== undefined && parseInt(n.tier) === 0) out.tier = 0;
    if (pendant) {
        out.pendant = pendant;
        if (ptier >= 1) out.pendantTier = ptier;
    } else if (allowNeutral && pendant === '') {
        out.pendant = '';
    }
    if (n.costume === false && allowNeutral) out.costume = false;
    else if (n.costume === true || (typeof n.costume === 'string' && n.costume.trim())) out.costume = true;   // 旧版字符串装扮名也视为「需要装扮」
    return Object.keys(out).length ? out : null;
}
function _npCleanArt(n, allowNeutral) {
    if (!n || typeof n !== 'object') return null;
    const tier = _npTier(n.tier);
    if (tier >= 1) return { tier: tier };
    if (allowNeutral && n.tier !== undefined && parseInt(n.tier) === 0) return { tier: 0 };
    return null;
}
function _npCleanMap(src, cleaner) {
    const out = {};
    Object.keys(src || {}).forEach(function (name) {
        const c = cleaner(src[name]);
        if (c) out[name] = c;
    });
    return out;
}
function _npCleanPlantTag(n) { return _npCleanPlant(n, true); }
function _npCleanArtTag(n) { return _npCleanArt(n, true); }

// ---- 标签套存取 ----
function _npEnsureSet(tag) {
    const t = tag || JOB_NOTE_TAG;
    if (!jobNotesStore[t] || typeof jobNotesStore[t] !== 'object') {
        jobNotesStore[t] = { plants: {}, artifacts: {} };
    }
    if (!jobNotesStore[t].plants || typeof jobNotesStore[t].plants !== 'object') jobNotesStore[t].plants = {};
    if (!jobNotesStore[t].artifacts || typeof jobNotesStore[t].artifacts !== 'object') jobNotesStore[t].artifacts = {};
    return jobNotesStore[t];
}
// 当前编辑标签（自愈：不在本作业集标签里 / 空 -> 通用）
function _npCurTag() {
    if (!jobNoteTag || jobNoteTag === JOB_NOTE_TAG) {
        jobNoteTag = JOB_NOTE_TAG;
        return JOB_NOTE_TAG;
    }
    const tags = (typeof jobGetTags === 'function') ? jobGetTags() : [];
    if (tags.indexOf(jobNoteTag) === -1) jobNoteTag = JOB_NOTE_TAG;
    return jobNoteTag;
}
function _npCurSet() { return _npEnsureSet(_npCurTag()); }
function _npGeneralSet() { return _npEnsureSet(JOB_NOTE_TAG); }

// 当前标签自己的备注（不含回落；create=true 时顺手建空条目）
function _npPlantOwn(name, create) {
    const set = _npCurSet();
    if (!set.plants[name] && create) set.plants[name] = {};
    return set.plants[name] || null;
}
function _npArtOwn(name, create) {
    const set = _npCurSet();
    if (!set.artifacts[name] && create) set.artifacts[name] = {};
    return set.artifacts[name] || null;
}

// 有效备注 = 「通用」← 当前标签 逐字段覆盖
//   标签套里的显式取消值（tier:0 / pendant:"" / costume:false）会盖掉通用套的值；
//   挂件那对字段成对取值：只在「同款挂件」时才继承通用的挂件阶数
function _npPlantEff(name) {
    const g = _npGeneralSet().plants[name] || {};
    const o = _npCurSet().plants[name] || {};
    const eff = {};
    ['tier', 'costume'].forEach(function (k) {
        if (o[k] !== undefined) eff[k] = o[k];
        else if (g[k] !== undefined) eff[k] = g[k];
    });
    if (o.pendant !== undefined) {
        // 标签自己说了算（'' = 本标签不带挂件）
        if (o.pendant) {
            eff.pendant = o.pendant;
            const ptier = (o.pendantTier !== undefined) ? o.pendantTier
                : (g.pendant === o.pendant ? g.pendantTier : undefined);
            if (ptier !== undefined) eff.pendantTier = ptier;
        }
    } else if (g.pendant) {
        eff.pendant = g.pendant;
        if (g.pendantTier !== undefined) eff.pendantTier = g.pendantTier;
    }
    return eff;
}
function _npArtEff(name) {
    const g = _npGeneralSet().artifacts[name] || {};
    const o = _npCurSet().artifacts[name] || {};
    return { tier: (o.tier !== undefined) ? o.tier : g.tier };
}
// 该字段是不是「沿用通用」（当前标签没覆盖）；通用套本身永远不算继承
function _npInherited(name, field, isArt) {
    if (_npCurTag() === JOB_NOTE_TAG) return false;
    const own = isArt ? _npArtOwn(name) : _npPlantOwn(name);
    if (!own) return true;
    return own[field] === undefined;
}

// ---- 备注文本（状态栏/提示用）----
function _npTierText(t) { return t >= 1 ? (t + ' 阶') : '任意阶数'; }
function _npPlantText(name) {
    const e = _npPlantEff(name);
    const tier = _npTier(e.tier);
    return (tier >= 1 ? tier + '阶启用' : '任意阶数')
        + (e.pendant ? ' · 挂件：' + e.pendant + (_npTier(e.pendantTier) >= 1 ? _npTier(e.pendantTier) + '阶' : '') : '')
        + (e.costume ? ' · 需要装扮' : '');
}

// ---- 出口：导出 / 本地缓存 ----
function jobGetPlantNotes() { return _npCleanMap(_npGeneralSet().plants, _npCleanPlant); }
function jobGetArtifactNotes() { return _npCleanMap(_npGeneralSet().artifacts, _npCleanArt); }

// 非通用标签的备注套：{ 标签: { plant_notes: {...}, artifact_notes: {...} } }
//   ★ 只导出「作业集上挂着的标签」，摘掉的标签数据留在内存里但不会写进 JSON
function jobGetTagNotes() {
    const out = {};
    const tags = (typeof jobGetTags === 'function') ? jobGetTags() : [];
    tags.forEach(function (tag) {
        if (tag === JOB_NOTE_TAG) return;
        const set = _npEnsureSet(tag);
        const p = _npCleanMap(set.plants, _npCleanPlantTag);
        const a = _npCleanMap(set.artifacts, _npCleanArtTag);
        if (!Object.keys(p).length && !Object.keys(a).length) return;   // 空套不导出
        const entry = {};
        if (Object.keys(p).length) entry.plant_notes = p;
        if (Object.keys(a).length) entry.artifact_notes = a;
        out[tag] = entry;
    });
    return out;
}

// 通用套写入（旧字段 plant_notes / artifact_notes；旧作业集/旧缓存都走这里）
function jobSetPlantNotes(notes) {
    _npGeneralSet().plants = _npCleanMap(notes, _npCleanPlant);
    if (document.getElementById('notesPicker')) jobRenderNotesPicker();
}
function jobSetArtifactNotes(notes) {
    _npGeneralSet().artifacts = _npCleanMap(notes, _npCleanArt);
    if (document.getElementById('notesPicker')) jobRenderNotesPicker();
}
// 标签套写入（新字段 tag_notes）：整份替换非通用套，通用套不动
function jobSetTagNotes(obj) {
    Object.keys(jobNotesStore).forEach(function (t) {
        if (t !== JOB_NOTE_TAG) delete jobNotesStore[t];
    });
    if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach(function (tag) {
            if (!tag || tag === JOB_NOTE_TAG) return;
            const e = obj[tag];
            if (!e || typeof e !== 'object') return;
            const set = _npEnsureSet(tag);
            set.plants = _npCleanMap(e.plant_notes, _npCleanPlantTag);
            set.artifacts = _npCleanMap(e.artifact_notes, _npCleanArtTag);
            if (!Object.keys(set.plants).length && !Object.keys(set.artifacts).length) delete jobNotesStore[tag];
        });
    }
    if (document.getElementById('notesPicker')) {
        if (typeof jobRenderNpTagBar === 'function') jobRenderNpTagBar();
        jobRenderNotesPicker();
    }
}
// 弹窗当前编辑的标签（'' = 通用；不在本作业集标签里也回落到通用）
function jobGetNoteTag() { return _npCurTag(); }
function jobSetNoteTag(tag) {
    const tags = (typeof jobGetTags === 'function') ? jobGetTags() : [];
    jobNoteTag = (typeof tag === 'string' && tag && tag !== JOB_NOTE_TAG && tags.indexOf(tag) !== -1)
        ? tag : JOB_NOTE_TAG;
}

// ---- 聚合：本作业集用到的植物与神器 ----
// 植物来源 = 各表槽位（普通+boss 覆盖）+ 局外 80 选卡；神器 = 各表普通/boss 神器。
function jobCollectUsed() {
    const plants = new Set(), artifacts = new Set();
    (jobTables || []).forEach(function (t) {
        if (!t) return;
        Object.keys(t.slots || {}).forEach(function (k) { const v = t.slots[k]; if (v) plants.add(v); });
        Object.keys(t.bossSlots || {}).forEach(function (k) { const v = t.bossSlots[k]; if (v) plants.add(v); });
        if (t.artifact) artifacts.add(t.artifact);
        if (t.bossArtifact) artifacts.add(t.bossArtifact);
    });
    if (typeof jobOuterPick !== 'undefined' && jobOuterPick) {
        (jobOuterPick.plants || []).forEach(function (p) { if (p) plants.add(p); });
    }
    return { plants: [...plants], artifacts: [...artifacts] };
}

function _npPlantImg(name) {
    const p = (plantCache || []).find(function (x) { return x && x.name === name; });
    return (p && p.img) ? p.img : '';
}
function _npArtifactImg(name) {
    if (typeof jobArtifactOf !== 'function') return '';
    const a = jobArtifactOf(name);
    if (!a) return '';
    let img = a.img || (a.en ? ('static/artifact/artifact_' + a.en + '.webp') : '');
    if (img && img[0] !== '/') img = '/' + img;
    return img;
}

// ---- 模式与武装条 ----
function jobNpSetMode(mode) {
    npMode = mode;
    document.querySelectorAll('#notesPicker .np-mode').forEach(function (b) {
        b.classList.toggle('np-mode-on', b.dataset.mode === mode);
    });
    const hint = document.getElementById('npModeHint');
    if (hint) {
        hint.textContent = mode === 'tier' ? '先在阶数条选阶数，再点植物或神器落定；再点一次同阶数 = 取消回任意'
            : mode === 'pendant' ? '先在挂件条选挂件（可在阶数条指定挂件阶数），再点植物佩戴（每株仅一个）；点已佩戴的同款 = 摘下，同款不同阶 = 改阶数'
            : mode === 'costume' ? '点植物 = 标记需要装扮；再点一次 = 取消'
            : '总览本作业集用到的神器与植物';
    }
    jobRenderNpArmBar();
}

// 武装条滚轮：纵向滚轮 -> 横向滚动（行容器逐个绑）
function _npBindWheel(row) {
    row.addEventListener('wheel', function (e) {
        if (!e.deltaY) return;
        e.preventDefault();
        row.scrollLeft += e.deltaY;
    }, { passive: false });
}

function jobRenderNpArmBar() {
    const bar = document.getElementById('npArmBar');
    if (!bar) return;
    if (npMode === 'view') { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '';

    if (npMode === 'tier') {
        const row = document.createElement('div');
        row.className = 'np-arm-row';
        const mk = function (tier, label) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'np-arm-item' + (npArmTier === tier ? ' np-armed' : '');
            b.title = label;
            if (tier >= 1) {
                const im = document.createElement('img');
                im.src = RANK_IMG_DIR + 'rank' + tier + '.png';
                im.alt = label;
                b.appendChild(im);
            } else {
                b.textContent = '任意';
            }
            b.addEventListener('click', function () { npArmTier = tier; jobRenderNpArmBar(); });
            row.appendChild(b);
        };
        mk(0, '任意阶数可用（默认）');
        for (let i = 1; i <= 5; i++) mk(i, i + ' 阶启用');
        bar.appendChild(row);
        _npBindWheel(row);
    } else if (npMode === 'costume') {
        // 装扮 = 有/无两种状态，无需选择具体款式：直接点植物切换
        const row = document.createElement('div');
        row.className = 'np-arm-row';
        const b = document.createElement('span');
        b.className = 'np-arm-static';
        const im = document.createElement('img');
        im.src = '/static/costume.png';
        im.alt = '装扮';
        b.appendChild(im);
        b.appendChild(document.createTextNode('点植物 = 穿 / 再点 = 脱'));
        row.appendChild(b);
        bar.appendChild(row);
    } else {
        // 挂件模式 = 两行（2026-10-25）：挂件行 + 挂件阶数行
        // 行1：卸下 + 45 个挂件
        const row1 = document.createElement('div');
        row1.className = 'np-arm-row';
        const off = document.createElement('button');
        off.type = 'button';
        off.className = 'np-arm-item' + (npArmPendant === '' ? ' np-armed' : '');
        off.textContent = '✕ 卸下';
        off.title = '选中后点植物 = 摘掉它的挂件';
        off.addEventListener('click', function () { npArmPendant = ''; jobRenderNpArmBar(); });
        row1.appendChild(off);
        JOB_PENDANTS.forEach(function (pd) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'np-arm-item' + (npArmPendant === pd.name ? ' np-armed' : '');
            b.title = pd.name;
            const im = document.createElement('img');
            im.src = PENDANT_IMG_DIR + pd.img;
            im.alt = pd.name;
            b.appendChild(im);
            b.addEventListener('click', function () { npArmPendant = pd.name; jobRenderNpArmBar(); });
            row1.appendChild(b);
        });
        // 行2：挂件阶数（任意 + 1-5 阶）
        const row2 = document.createElement('div');
        row2.className = 'np-arm-row';
        const lbl = document.createElement('span');
        lbl.className = 'np-arm-row-label';
        lbl.textContent = '挂件阶数：';
        row2.appendChild(lbl);
        const mkT = function (tier, label) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'np-arm-item' + (npArmPendantTier === tier ? ' np-armed' : '');
            b.title = label;
            if (tier >= 1) {
                const im = document.createElement('img');
                im.src = RANK_IMG_DIR + 'rank' + tier + '.png';
                im.alt = label;
                b.appendChild(im);
            } else {
                b.textContent = '任意';
            }
            b.addEventListener('click', function () { npArmPendantTier = tier; jobRenderNpArmBar(); });
            row2.appendChild(b);
        };
        mkT(0, '挂件任意阶（默认）');
        for (let i = 1; i <= 5; i++) mkT(i, '挂件 ' + i + ' 阶');
        bar.appendChild(row1);
        bar.appendChild(row2);
        _npBindWheel(row1);
        _npBindWheel(row2);
    }
}

// ---- 标签条（通用 + 本作业集挂上的标签）----
//   标签本身在作业集栏「＋ 添加标签」里增删（41-jobset-tags.js），这里只负责切换。
function jobRenderNpTagBar() {
    const bar = document.getElementById('npTagBar');
    if (!bar) return;
    const tags = (typeof jobGetTags === 'function') ? jobGetTags() : [];
    // 标签被摘掉 / 换了作业集 -> 当前编辑标签回落到通用
    if (jobNoteTag !== JOB_NOTE_TAG && tags.indexOf(jobNoteTag) === -1) jobNoteTag = JOB_NOTE_TAG;

    bar.innerHTML = '';
    const lbl = document.createElement('span');
    lbl.className = 'np-tag-label';
    lbl.textContent = '标签：';
    bar.appendChild(lbl);

    const mk = function (tag, tip) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'np-tag' + (jobNoteTag === tag ? ' np-tag-on' : '');
        b.textContent = tag;
        b.title = tip;
        b.addEventListener('click', function () {
            if (jobNoteTag === tag) return;
            jobNoteTag = tag;
            jobRenderNpTagBar();
            jobRenderNotesPicker();
            if (typeof jobSaveLocal === 'function') jobSaveLocal();
        });
        bar.appendChild(b);
    };
    mk(JOB_NOTE_TAG, '所有标签的公共标注（某个标签没单独标的项回落到这里）');
    tags.forEach(function (t) {
        if (t === JOB_NOTE_TAG) return;
        mk(t, '标签「' + t + '」单独的标注；没标的项回落通用');
    });
    if (!tags.length) {
        const hint = document.createElement('span');
        hint.className = 'np-tag-hint';
        hint.textContent = '（本作业集还没加标签 —— 回作业集栏点「＋ 添加标签」）';
        bar.appendChild(hint);
    }
}

// ---- 总览渲染 ----
function jobRenderNotesPicker() {
    jobRenderNpTagBar();
    const used = jobCollectUsed();
    const tagNow = _npCurTag();
    const inheritOn = (tagNow !== JOB_NOTE_TAG);

    // 神器行（2026-10-25 起神器可调配阶数：tier 模式下可点，带阶数角标）
    const artRow = document.getElementById('npArtRow');
    if (artRow) {
        artRow.innerHTML = '';
        if (!used.artifacts.length) {
            artRow.innerHTML = '<span class="np-empty">（本作业集未使用神器）</span>';
        }
        used.artifacts.forEach(function (name) {
            const aTier = _npTier(_npArtEff(name).tier);
            const card = document.createElement('div');
            card.className = 'np-art' + (npMode === 'tier' ? ' np-clickable' : '');
            card.title = name + ' · ' + _npTierText(aTier);
            const im = document.createElement('img');
            im.src = _npArtifactImg(name);
            im.alt = name;
            im.onerror = function () { this.style.visibility = 'hidden'; };
            card.appendChild(im);
            const nd = document.createElement('div');
            nd.className = 'np-name';
            nd.textContent = name;
            card.appendChild(nd);
            if (aTier >= 1 && aTier <= 5) {
                const tg = document.createElement('img');
                tg.className = 'np-badge np-badge-tier'
                    + (_npInherited(name, 'tier', true) ? ' np-inherited' : '');
                tg.src = RANK_IMG_DIR + 'rank' + aTier + '.png';
                tg.title = aTier + ' 阶' + (_npInherited(name, 'tier', true) ? '（沿用通用）' : '');
                card.appendChild(tg);
            }
            card.addEventListener('click', function () {
                if (npMode !== 'tier') return;
                const effTier = _npTier(_npArtEff(name).tier);
                const own = _npArtOwn(name, true);
                if (npArmTier >= 1 && effTier !== npArmTier) {
                    own.tier = npArmTier;
                } else {
                    // 再点同阶数 / 武装「任意」= 取消本标签的标注（回落到通用）
                    _npClearField('artifacts', name, 'tier');
                }
                setStatus(`🔢 神器 ${name} → ${_npTierText(_npTier(_npArtEff(name).tier))}`);
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            });
            artRow.appendChild(card);
        });
    }

    // 植物网格
    const grid = document.getElementById('npGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!used.plants.length) {
        grid.innerHTML = '<span class="np-empty">（本作业集未使用植物）</span>';
    }
    used.plants.forEach(function (name) {
        const eff = _npPlantEff(name);
        const tier = _npTier(eff.tier);
        const pendant = eff.pendant || '';
        const ptier = _npTier(eff.pendantTier);
        const costume = !!eff.costume;
        const inhTier = _npInherited(name, 'tier');
        const inhPendant = _npInherited(name, 'pendant');
        const inhPtier = _npInherited(name, 'pendantTier');
        const inhCostume = _npInherited(name, 'costume');

        const card = document.createElement('div');
        card.className = 'np-item' + (npMode !== 'view' ? ' np-clickable' : '');
        card.title = name
            + (tier >= 1 ? ` · ${tier}阶启用` : ' · 任意阶数')
            + (pendant ? ` · 挂件：${pendant}` + (ptier >= 1 ? `${ptier}阶` : '') : '')
            + (costume ? ' · 需要装扮' : '')
            + (inheritOn && (inhTier || inhPendant || inhCostume) ? '\n（半透明角标 = 这项沿用「通用」）' : '');

        const im = document.createElement('img');
        im.className = 'np-plant-img';
        im.src = _npPlantImg(name);
        im.alt = name;
        im.onerror = function () { this.style.visibility = 'hidden'; };
        card.appendChild(im);

        const nd = document.createElement('div');
        nd.className = 'np-name';
        nd.textContent = name;
        card.appendChild(nd);

        if (pendant && JOB_PENDANT_IMG[pendant]) {
            const tg = document.createElement('img');
            tg.className = 'np-badge np-badge-pendant' + (inhPendant ? ' np-inherited' : '');
            tg.src = PENDANT_IMG_DIR + JOB_PENDANT_IMG[pendant];
            tg.title = '挂件：' + pendant + (ptier >= 1 ? `（${ptier}阶）` : '') + (inhPendant ? '（沿用通用）' : '');
            card.appendChild(tg);
            // 挂件阶数迷你角标：挂在挂件徽章正下方（与植物自身阶数角标区分）
            if (ptier >= 1 && ptier <= 5) {
                const pt = document.createElement('img');
                pt.className = 'np-badge np-badge-ptier' + (inhPtier ? ' np-inherited' : '');
                pt.src = RANK_IMG_DIR + 'rank' + ptier + '.png';
                pt.title = `挂件 ${ptier} 阶` + (inhPtier ? '（沿用通用）' : '');
                card.appendChild(pt);
            }
        }
        // 底栏右下那一栏：[装扮][阶数] 并排 —— 只有标记了才显示
        if (costume) {
            const tg = document.createElement('img');
            tg.className = 'np-badge np-badge-costume' + (inhCostume ? ' np-inherited' : '');
            tg.src = '/static/costume.png';
            tg.alt = '装扮';
            tg.title = '需要装扮' + (inhCostume ? '（沿用通用）' : '');
            tg.onerror = function () { this.style.visibility = 'hidden'; };
            card.appendChild(tg);
        }
        if (tier >= 1 && tier <= 5) {
            const tg = document.createElement('img');
            tg.className = 'np-badge np-badge-tier' + (inhTier ? ' np-inherited' : '');
            tg.src = RANK_IMG_DIR + 'rank' + tier + '.png';
            tg.title = tier + ' 阶启用' + (inhTier ? '（沿用通用）' : '');
            card.appendChild(tg);
        }

        card.addEventListener('click', function () {
            if (npMode === 'tier') {
                const effTier = _npTier(_npPlantEff(name).tier);
                const own = _npPlantOwn(name, true);
                if (npArmTier >= 1 && effTier !== npArmTier) {
                    own.tier = npArmTier;
                } else {
                    // 再点同名阶数 / 武装「任意」= 取消标注（回落到通用）
                    _npClearField('plants', name, 'tier');
                }
                setStatus(`🔢 ${name} → ${_npPlantText(name)}`);
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            } else if (npMode === 'pendant') {
                if (npArmPendant === null) { setStatus('💎 先在挂件条里选一个挂件'); return; }
                const eff = _npPlantEff(name);
                const effPendant = eff.pendant || '';
                const effPtier = _npTier(eff.pendantTier);
                const own = _npPlantOwn(name, true);
                if (npArmPendant === '' || (effPendant === npArmPendant && effPtier === npArmPendantTier)) {
                    // 「卸下」或再点已佩戴的同款同阶 = 摘除本标签的标注（通用里有就盖掉）
                    _npClearField('plants', name, 'pendant');
                } else if (effPendant === npArmPendant) {
                    // 同款不同阶 = 只改挂件阶数
                    own.pendant = npArmPendant;
                    if (npArmPendantTier >= 1) own.pendantTier = npArmPendantTier;
                    else delete own.pendantTier;
                } else {
                    own.pendant = npArmPendant;
                    if (npArmPendantTier >= 1) own.pendantTier = npArmPendantTier;
                    else delete own.pendantTier;
                }
                setStatus(`💎 ${name} → ${_npPlantText(name)}`);
                _npPruneSet(jobNotesStore[_npCurTag()], 'plants', name);
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            } else if (npMode === 'costume') {
                // 与阶数同款点选：点 = 穿上，再点 = 脱下
                const own = _npPlantOwn(name, true);
                const genC = !!(_npGeneralSet().plants[name] || {}).costume;
                if (own.costume === false && genC) {
                    delete own.costume;          // 取消「显式不需要」-> 回到沿用通用
                } else if (_npPlantEff(name).costume) {
                    _npClearField('plants', name, 'costume');
                } else {
                    own.costume = true;
                }
                setStatus(`🎭 ${name} → ${_npPlantText(name)}`);
                _npPruneSet(jobNotesStore[_npCurTag()], 'plants', name);
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            }
        });
        grid.appendChild(card);
    });

    const tip = document.getElementById('npTip');
    if (tip) {
        const noted = Object.keys(jobGetPlantNotes()).length;
        const artNoted = Object.keys(jobGetArtifactNotes()).length;
        const tagExtra = (tagNow === JOB_NOTE_TAG) ? '' : (' · 当前标签：' + tagNow
            + '（' + Object.keys(_npCleanMap(_npCurSet().plants, _npCleanPlantTag)).length + ' 株单独标注）');
        tip.textContent = `神器 ${used.artifacts.length} · 植物 ${used.plants.length} · 通用已标注 ${noted + artNoted}${tagExtra}`;
    }
}

// 取消某个字段的标注（标签套里要能「盖掉」通用套的值）：
//   · 本标签里已经写着「显式取消值」 -> 删掉它，回到继承通用
//   · 通用套有这个值               -> 写显式取消值（tier:0 / pendant:"" / costume:false）
//   · 都没有                       -> 直接删掉本标签字段
const _NP_NEUTRAL = { tier: 0, pendant: '', costume: false };
function _npClearField(kind, name, field) {
    const isArt = (kind === 'artifacts');
    const set = _npCurSet();
    const own = isArt ? _npArtOwn(name, true) : _npPlantOwn(name, true);
    if (own[field] !== undefined && own[field] === _NP_NEUTRAL[field]) {
        // 已经在「显式取消」状态：再点一次回到继承
        delete own[field];
        if (field === 'pendant') delete own.pendantTier;
        _npPruneSet(set, kind, name);
        return;
    }
    const genMap = isArt ? _npGeneralSet().artifacts : _npGeneralSet().plants;
    const gen = genMap[name] || {};
    const generalHas = (field === 'tier') ? (_npTier(gen.tier) >= 1)
        : (field === 'pendant') ? !!gen.pendant
        : !!gen.costume;
    if (field === 'pendant') delete own.pendantTier;
    if (_npCurTag() !== JOB_NOTE_TAG && generalHas) own[field] = _NP_NEUTRAL[field];
    else delete own[field];
    _npPruneSet(set, kind, name);
}

// 剪掉某个标签套里的空条目（全空 = 没标注，别在 JSON 里留空壳）
function _npPruneSet(set, kind, name) {
    if (!set || !set[kind]) return;
    const n = set[kind][name];
    if (n && !Object.keys(n).length) delete set[kind][name];
}

// ---- 开关 ----
function jobOpenNotesPicker() {
    const p = document.getElementById('notesPicker');
    if (!p) return;
    jobNpSetMode(npMode === 'view' ? 'view' : npMode);   // 刷新武装条可见性
    jobRenderNotesPicker();
    p.classList.add('sp-open');
}
function jobCloseNotesPicker() {
    const p = document.getElementById('notesPicker');
    if (p) p.classList.remove('sp-open');
}

// ---- 「是否查看配置」提示条（载入作业集后由 jobApplyLoaded 调用）----
let _nprTimer = null;
function jobPromptViewNotes(label) {
    const bar = document.getElementById('notesPrompt');
    if (!bar) return;
    const txt = document.getElementById('nprText');
    const tags = (typeof jobGetTags === 'function') ? jobGetTags() : [];
    if (txt) {
        txt.textContent = `已载入「${label || '作业集'}」`
            + (tags.length ? `（标签：${tags.join(' / ')}）` : '')
            + '，是否查看配置（植物阶数/挂件/装扮需求）？';
    }
    bar.style.display = 'flex';
    clearTimeout(_nprTimer);
    _nprTimer = setTimeout(function () { bar.style.display = 'none'; }, 10000);
}
function _jobHideNotesPrompt() {
    clearTimeout(_nprTimer);
    const bar = document.getElementById('notesPrompt');
    if (bar) bar.style.display = 'none';
}

function jobNotesInit() {
    const btn = document.getElementById('notesToggle');
    if (btn) btn.addEventListener('click', jobOpenNotesPicker);
    const close = document.getElementById('notesPickerClose');
    if (close) close.addEventListener('click', jobCloseNotesPicker);
    const done = document.getElementById('notesPickerDone');
    if (done) done.addEventListener('click', jobCloseNotesPicker);
    document.querySelectorAll('#notesPicker .np-mode').forEach(function (b) {
        b.addEventListener('click', function () { jobNpSetMode(b.dataset.mode); });
    });
    // 武装条滚轮：各行容器的滚轮绑定在 jobRenderNpArmBar 里（挂件模式两行）
    // 「是否查看配置」提示条
    const view = document.getElementById('nprView');
    if (view) view.addEventListener('click', function () { _jobHideNotesPrompt(); jobOpenNotesPicker(); });
    const skip = document.getElementById('nprSkip');
    if (skip) skip.addEventListener('click', _jobHideNotesPrompt);
    jobNpSetMode('view');
    jobRenderNpTagBar();
}
