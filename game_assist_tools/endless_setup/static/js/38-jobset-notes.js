
// ============================================================
// 备注配置弹窗（2026-10-13）—— 神器/植物总览 + 阶数/挂件标注
//
// 交互（用户定的流程）：
//   点「📝 配置」→ 弹窗列出本作业集用到的所有神器与植物（总览）。
//   「调配阶数」模式：先在阶数条里选 1-5 阶（或任意），再点植物 -> 落定。
//   「佩戴挂件」模式：先在挂件条里选挂件，再点植物 -> 佩戴（每株仅一个，
//                    再选即替换；选「卸下」再点植物 = 摘除）。
//   仅作展示与导出，不影响运行时逻辑。
//
// 数据：jobPlantNotes = { 植物名: { tier: 1-5, pendant: "挂件中文名" } }
//   tier 缺省 = 任意阶数可用；pendant 缺省 = 无挂件。
//   出口：jobGetPlantNotes()（剪掉空备注）/ jobSetPlantNotes(notes)。
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
let jobPlantNotes = {};          // { 植物名: {tier, pendant, costume:true} }
                                 // costume = 布尔：是否需要装扮（与阶数同款点选配置）
let npMode = 'view';             // view | tier | pendant | costume
let npArmTier = 0;               // 阶数条当前武装值（0 = 任意）
let npArmPendant = null;         // 挂件条当前武装（null = 未选；'' = 卸下）

// 出口：导出/缓存用（剪掉「任意阶 + 无挂件 + 无装扮」的空备注）
function jobGetPlantNotes() {
    const out = {};
    Object.keys(jobPlantNotes).forEach(function (name) {
        const n = jobPlantNotes[name] || {};
        const tier = parseInt(n.tier) || 0;
        const pendant = (typeof n.pendant === 'string' && n.pendant) ? n.pendant : '';
        const costume = !!n.costume;
        if (tier >= 1 && tier <= 5 || pendant || costume) {
            out[name] = {};
            if (tier >= 1 && tier <= 5) out[name].tier = tier;
            if (pendant) out[name].pendant = pendant;
            if (costume) out[name].costume = true;
        }
    });
    return out;
}
function jobSetPlantNotes(notes) {
    jobPlantNotes = {};
    if (notes && typeof notes === 'object') {
        Object.keys(notes).forEach(function (name) {
            const n = notes[name] || {};
            const tier = parseInt(n.tier) || 0;
            const pendant = (typeof n.pendant === 'string' && n.pendant) ? n.pendant : '';
            const costume = !!n.costume;   // 旧版字符串装扮名也视为「需要装扮」
            jobPlantNotes[name] = {};
            if (tier >= 1 && tier <= 5) jobPlantNotes[name].tier = tier;
            if (pendant) jobPlantNotes[name].pendant = pendant;
            if (costume) jobPlantNotes[name].costume = true;
        });
    }
    if (document.getElementById('notesPicker')) jobRenderNotesPicker();
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
        hint.textContent = mode === 'tier' ? '先在阶数条选阶数，再点植物落定；再点一次同阶数 = 取消回任意'
            : mode === 'pendant' ? '先在挂件条选挂件，再点植物佩戴（每株仅一个）；再点已佩戴的同款 = 摘下'
            : mode === 'costume' ? '点植物 = 标记需要装扮；再点一次 = 取消'
            : '总览本作业集用到的神器与植物';
    }
    jobRenderNpArmBar();
}

function jobRenderNpArmBar() {
    const bar = document.getElementById('npArmBar');
    if (!bar) return;
    if (npMode === 'view') { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '';

    if (npMode === 'tier') {
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
            bar.appendChild(b);
        };
        mk(0, '任意阶数可用（默认）');
        for (let i = 1; i <= 5; i++) mk(i, i + ' 阶启用');
    } else if (npMode === 'costume') {
        // 装扮 = 有/无两种状态，无需选择具体款式：直接点植物切换
        const b = document.createElement('span');
        b.className = 'np-arm-static';
        const im = document.createElement('img');
        im.src = '/static/costume.png';
        im.alt = '装扮';
        b.appendChild(im);
        b.appendChild(document.createTextNode('点植物 = 穿 / 再点 = 脱'));
        bar.appendChild(b);
    } else {
        // 挂件条：卸下 + 45 个挂件
        const off = document.createElement('button');
        off.type = 'button';
        off.className = 'np-arm-item' + (npArmPendant === '' ? ' np-armed' : '');
        off.textContent = '✕ 卸下';
        off.title = '选中后点植物 = 摘掉它的挂件';
        off.addEventListener('click', function () { npArmPendant = ''; jobRenderNpArmBar(); });
        bar.appendChild(off);
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
            bar.appendChild(b);
        });
    }
}

// ---- 总览渲染 ----
function jobRenderNotesPicker() {
    const used = jobCollectUsed();

    // 神器行
    const artRow = document.getElementById('npArtRow');
    if (artRow) {
        artRow.innerHTML = '';
        if (!used.artifacts.length) {
            artRow.innerHTML = '<span class="np-empty">（本作业集未使用神器）</span>';
        }
        used.artifacts.forEach(function (name) {
            const card = document.createElement('div');
            card.className = 'np-art';
            const im = document.createElement('img');
            im.src = _npArtifactImg(name);
            im.alt = name;
            im.onerror = function () { this.style.visibility = 'hidden'; };
            card.appendChild(im);
            const nd = document.createElement('div');
            nd.className = 'np-name';
            nd.textContent = name;
            card.appendChild(nd);
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
        const note = jobPlantNotes[name] || {};
        const tier = parseInt(note.tier) || 0;
        const pendant = note.pendant || '';
        const costume = !!note.costume;

        const card = document.createElement('div');
        card.className = 'np-item' + (npMode !== 'view' ? ' np-clickable' : '');
        card.title = name
            + (tier >= 1 ? ` · ${tier}阶启用` : ' · 任意阶数')
            + (pendant ? ` · 挂件：${pendant}` : '')
            + (costume ? ' · 需要装扮' : '');

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
            tg.className = 'np-badge np-badge-pendant';
            tg.src = PENDANT_IMG_DIR + JOB_PENDANT_IMG[pendant];
            tg.title = '挂件：' + pendant;
            card.appendChild(tg);
        }
        // 底栏右下那一栏：[装扮][阶数] 并排 —— 只有标记了才显示
        if (costume) {
            const tg = document.createElement('img');
            tg.className = 'np-badge np-badge-costume';
            tg.src = '/static/costume.png';
            tg.alt = '装扮';
            tg.title = '需要装扮';
            tg.onerror = function () { this.style.visibility = 'hidden'; };
            card.appendChild(tg);
        }
        if (tier >= 1 && tier <= 5) {
            const tg = document.createElement('img');
            tg.className = 'np-badge np-badge-tier';
            tg.src = RANK_IMG_DIR + 'rank' + tier + '.png';
            tg.title = tier + ' 阶启用';
            card.appendChild(tg);
        }

        card.addEventListener('click', function () {
            if (npMode === 'tier') {
                const cur = parseInt((jobPlantNotes[name] || {}).tier) || 0;
                if (npArmTier >= 1 && cur === npArmTier) {
                    // 再点同名阶数 = 取消，回到任意
                    if (jobPlantNotes[name]) delete jobPlantNotes[name].tier;
                    setStatus(`🔢 ${name} → 任意阶数（已取消标注）`);
                } else if (npArmTier >= 1) {
                    jobPlantNotes[name] = jobPlantNotes[name] || {};
                    jobPlantNotes[name].tier = npArmTier;
                    setStatus(`🔢 ${name} → ${npArmTier} 阶启用`);
                } else {
                    if (jobPlantNotes[name]) delete jobPlantNotes[name].tier;
                    setStatus(`🔢 ${name} → 任意阶数`);
                }
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            } else if (npMode === 'pendant') {
                const cur = (jobPlantNotes[name] || {}).pendant || '';
                if (npArmPendant === null) { setStatus('💎 先在挂件条里选一个挂件'); return; }
                if (npArmPendant === '' || cur === npArmPendant) {
                    // 「卸下」或再点已佩戴的同款挂件 = 摘除
                    if (jobPlantNotes[name]) delete jobPlantNotes[name].pendant;
                    setStatus(`💎 已摘下 ${name} 的挂件`);
                } else {
                    jobPlantNotes[name] = jobPlantNotes[name] || {};
                    jobPlantNotes[name].pendant = npArmPendant;
                    setStatus(`💎 ${name} 佩戴 ${npArmPendant}`);
                }
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            } else if (npMode === 'costume') {
                // 与阶数同款点选：点 = 穿上，再点 = 脱下
                if (jobPlantNotes[name] && jobPlantNotes[name].costume) {
                    delete jobPlantNotes[name].costume;
                    setStatus(`🎭 ${name} → 脱下装扮`);
                } else {
                    jobPlantNotes[name] = jobPlantNotes[name] || {};
                    jobPlantNotes[name].costume = true;
                    setStatus(`🎭 ${name} → 需要装扮`);
                }
                jobRenderNotesPicker();
                if (typeof jobSaveLocal === 'function') jobSaveLocal();
            }
        });
        grid.appendChild(card);
    });

    const tip = document.getElementById('npTip');
    if (tip) {
        const noted = Object.keys(jobGetPlantNotes()).length;
        tip.textContent = `神器 ${used.artifacts.length} · 植物 ${used.plants.length} · 已标注 ${noted}`;
    }
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
    if (txt) txt.textContent = `已载入「${label || '作业集'}」，是否查看配置（植物阶数/挂件/装扮需求）？`;
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
    // 武装条（挂件条一行 45 个）：滚轮上下 -> 横向滚动
    const arm = document.getElementById('npArmBar');
    if (arm) arm.addEventListener('wheel', function (e) {
        if (!e.deltaY) return;
        e.preventDefault();
        arm.scrollLeft += e.deltaY;
    }, { passive: false });
    // 「是否查看配置」提示条
    const view = document.getElementById('nprView');
    if (view) view.addEventListener('click', function () { _jobHideNotesPrompt(); jobOpenNotesPicker(); });
    const skip = document.getElementById('nprSkip');
    if (skip) skip.addEventListener('click', _jobHideNotesPrompt);
    jobNpSetMode('view');
}
