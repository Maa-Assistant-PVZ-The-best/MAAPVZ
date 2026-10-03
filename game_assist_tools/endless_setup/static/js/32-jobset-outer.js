
// ============================================================
// 32. 局外选卡（无尽局外「选择挑战植物」80 选）
// ------------------------------------------------------------
// 与「换阵」无关的独立功能，数据是**作业集级**字段 outer_pick：
//   outer_pick.plants: 有序中文名列表 —— 阵容表植物（锁定）排前，
//                      其余按用户在本面板的点击顺序排列；
//                      局内 custom（SelectPlants 无尽局外选卡模式）按此顺序选取。
//   outer_pick.mode:   'auto'     按列表自动选取（默认）
//                      'oneclick' 用游戏内的「一键选取」
//                      'confirm'  复用当前配置（局内已手动配好 80 个）
//
// 图片资源以 plant_ref_endless 为准（后端 /plants 注入 has_img_endless）：
//   无图 -> 灰化 + 左上角叉叉 + 禁选（叉叉复用 02-tooltip.js 的 jobCardXMark）。
//
// 扩展性：植物列表来自 plants.json —— 以后游戏出新植物，
//   往 plants.json 加一条 + 往 plant_ref_endless 丢截图即可，本面板零改动。
// ============================================================

let jobOuterPick = { plants: [], mode: 'auto' };   // 作业集级；存取链路见 27/28/29
let outerRarityFilter = '全部';
let outerSortMode = 'default';                     // 显示排序：default | rare_desc | rare_asc | selected
let outerReorder = { active: false, pool: [] };    // 调整排序模式：pool = 进入时的手动选择集合
const OUTER_RARITY_TABS = ['全部', '橙', '紫', '蓝', '绿', '白'];

// 两个「局内执行方式」的确认弹窗文案（用户要求的原文）
const OUTER_MODE_CONFIRM = {
    oneclick: '确定你已在游戏内收藏好要配置的植物',
    confirm: '确定当前在游戏内已经配置好80个植物，且严格对应作业集'
};

// ---- 模式门禁：一键选取/复用当前配置 时局内不读植物列表 -> 选择区封锁 ----
function jobOuterBlockedMode() {
    return jobOuterPick.mode !== 'auto';
}

// 封锁/解锁选择区（网格变灰禁点；搜索/清空/补齐/排序禁用。调整排序模式下也禁用控件）
function jobOuterApplyModeUI() {
    const blocked = jobOuterBlockedMode();
    const grid = document.getElementById('outerGrid');
    if (grid) {
        grid.style.pointerEvents = blocked ? 'none' : '';
        grid.style.opacity = blocked ? '0.45' : '';
        grid.style.filter = blocked ? 'grayscale(0.6)' : '';
    }
    const dis = blocked || outerReorder.active;
    ['outerSearch', 'outerClear', 'outerFillBtn', 'outerSortMode'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.disabled = dis;
    });
}

// ---- 调整排序模式：只显示已选植物，序号清零，重新点一遍定优先级 ----
// 进入：手动选择集合暂存进 pool（不丢），plants 清空 -> 已选植物全部显示但无序号；
// 点击 = 追加进 plants 拿新序号（再点取消，序号顺移）；
// 退出（完成排序 / 关面板）：没重新点的按原顺序接在最后，不丢任何选择。
function jobOuterToggleReorder() {
    if (jobOuterBlockedMode()) {
        setStatus('ℹ️ 当前执行方式不读取植物列表，无需排序');
        return;
    }
    if (!outerReorder.active) {
        outerReorder.pool = (jobOuterPick.plants || []).slice();
        jobOuterPick.plants = [];
        outerReorder.active = true;
        jobOuterApplyReorderUI();
        jobOuterRenderGrid();
        jobOuterRefreshBadge();
        setStatus('🔢 调整排序中：依次点击植物确定优先级（先点的先选），点「完成排序」退出');
    } else {
        const rest = outerReorder.pool.filter(function (n) { return jobOuterPick.plants.indexOf(n) === -1; });
        jobOuterPick.plants = jobOuterPick.plants.concat(rest);
        outerReorder.active = false;
        outerReorder.pool = [];
        jobOuterApplyReorderUI();
        jobSaveLocal();
        jobOuterRenderGrid();
        jobOuterRefreshBadge();
        setStatus('✅ 排序完成' + (rest.length ? '（' + rest.length + ' 个未重点的按原顺序接在最后）' : ''));
    }
}

function jobOuterApplyReorderUI() {
    const btn = document.getElementById('outerReorderBtn');
    if (btn) {
        btn.textContent = outerReorder.active ? '完成排序' : '调整排序';
        btn.style.background = outerReorder.active ? '#2d7aff' : '';
        btn.style.color = outerReorder.active ? '#fff' : '';
    }
    jobOuterApplyModeUI();   // 控件禁用态跟着重排模式刷新
}

// ---- 补齐空选：自动把未选的植物补到 80 个（按当前排序，跳过无图；接在现有已选后面）----
function jobOuterFill80() {
    if (jobOuterBlockedMode()) {
        setStatus('ℹ️ 当前执行方式不读取植物列表，无需补齐');
        return;
    }
    if (outerReorder.active) {
        setStatus('🔢 正在调整排序，请先点「完成排序」');
        return;
    }
    const TARGET = 80;
    const eff = jobOuterEffective();
    const need = TARGET - eff.length;
    if (need <= 0) { setStatus('✅ 已有 ' + eff.length + ' 个，够 80 了'); return; }
    const locked = jobOuterLockedPlants();
    let rest = (plantCache || []).filter(function (p) {
        return locked.indexOf(p.name) === -1 && jobOuterPick.plants.indexOf(p.name) === -1;
    });
    rest = jobOuterSortList(rest, eff);          // 按当前排序方式补
    let added = 0;
    for (let i = 0; i < rest.length && added < need; i++) {
        if (!jobOuterAvail(rest[i])) continue;   // 无图植物局内选不到，跳过
        jobOuterPick.plants.push(rest[i].name);
        added++;
    }
    jobSaveLocal();
    jobOuterRenderGrid();
    jobOuterRefreshBadge();
    setStatus(added > 0
        ? ('🧩 已补齐 ' + added + ' 个（现在共 ' + jobOuterEffective().length + '/80 个）')
        : ('⚠️ 没有更多可补的植物了（还差 ' + need + ' 个，其余都没有局外图片资源）'));
}

// ---- 显示排序（只影响显示；选取优先级永远是点击先后）----
function jobOuterSortList(list, order) {
    if (outerSortMode === 'rare_desc' || outerSortMode === 'rare_asc') {
        const rv = function (p) { return (typeof p.rare === 'number') ? p.rare : (RARITY_TO_RARE[p.rarity] || 0); };
        const dir = (outerSortMode === 'rare_desc') ? -1 : 1;
        return list.slice().sort(function (a, b) { return (rv(a) - rv(b)) * dir; });   // 稳定，同品质保持图鉴序
    }
    if (outerSortMode === 'selected') {
        return list.slice().sort(function (a, b) {
            const sa = order.indexOf(a.name) !== -1, sb = order.indexOf(b.name) !== -1;
            if (sa !== sb) return sa ? -1 : 1;
            return 0;
        });
    }
    return list;
}

// ---- 无尽局外图片资源可用性（字段缺失 = 旧接口/异常 -> 当作有图，避免误伤全部）----
function jobOuterAvail(p) {
    if (!p || p.has_img_endless === undefined || p.has_img_endless === null) return true;
    return !!p.has_img_endless;
}

// 所有阵容表里配置的植物（有序：表1 槽1..8 -> 表2 ...），去重
function jobOuterLockedPlants() {
    const out = [];
    (jobTables || []).forEach(function (t) {
        for (let s = 1; s <= 8; s++) {
            const n = t && t.slots ? t.slots[s] : '';
            if (n && out.indexOf(n) === -1) out.push(n);
        }
    });
    return out;
}

// 有效选取顺序 = 阵容表锁定植物（表顺序，实时派生） + 手动选择（点击顺序）。
// ★ 锁定植物【不写入】jobOuterPick.plants：它们只从阵容表派生。否则从表里
//   移除后会残留成"手动已选"、且若无图还点不掉 —— 表现为"取消不掉的黑框"。
//   这样局外选卡就严格对应遍历的阵容表：表里有就有，移除即消失。
// ★ 封顶 80：80 选卡界面最多选 80 个，多出的从末尾砍（优先级最低的牺牲）。
function jobOuterEffective() {
    const locked = jobOuterLockedPlants();
    return locked.concat((jobOuterPick.plants || []).filter(function (n) { return locked.indexOf(n) === -1; }))
        .slice(0, 80);
}

// 打开面板时清理持久列表：只保留「名单里有、有局外图、且未被阵容表锁定」的手动选择。
// ★ 无图植物也要清掉：它局内永远选不到，留在列表里只会变成点不掉的"幽灵已选"
//   （早期版本把锁定植物烤进列表残留下来的脏数据，正好靠这条自愈）。
function jobOuterNormalize() {
    const locked = jobOuterLockedPlants();
    const rest = [];
    (jobOuterPick.plants || []).forEach(function (n) {
        if (locked.indexOf(n) !== -1) return;            // 锁定植物由阵容表派生，不存储
        const p = (typeof jobFindPlant === 'function') ? jobFindPlant(n) : null;
        if (!p) return;                                  // 名单里已经没有的，丢弃
        if (!jobOuterAvail(p)) return;                   // 没有局外图片资源的，丢弃
        if (rest.indexOf(n) === -1) rest.push(n);        // 去重
    });
    jobOuterPick.plants = rest;
}

// ---- 面板开关 ----
async function jobOpenOuterPicker() {
    const modal = document.getElementById('outerPicker');
    if (!modal) return;
    jobSaveCurrentBoard();            // 防御：确保阵容表槽位是最新的
    await jobLoadPlants();            // 复用槽位选择器的缓存（含 has_img_endless）
    jobOuterNormalize();
    jobOuterRefreshModeBtn();
    jobOuterCloseModeMenu();
    jobOuterApplyReorderUI();         // 先同步排序模式按钮/控件态（内部会调 ApplyModeUI）
    jobOuterRenderTabs();
    jobOuterRenderGrid();
    jobOuterRefreshBadge();
    modal.style.display = 'flex';
}

function jobCloseOuterPicker() {
    // 排序模式没退出就关面板 -> 自动完成排序（未重点的接在最后，不丢选择）
    if (outerReorder.active) jobOuterToggleReorder();
    jobOuterCloseModeMenu();
    const modal = document.getElementById('outerPicker');
    if (modal) modal.style.display = 'none';
}

// ---- 品质过滤行 ----
function jobOuterRenderTabs() {
    const box = document.getElementById('outerRarityFilter');
    if (!box) return;
    box.innerHTML = '';
    OUTER_RARITY_TABS.forEach(function (r) {
        const el = document.createElement('span');
        const active = (outerRarityFilter === r);
        el.textContent = r;
        el.style.cssText = 'padding:2px 12px;border-radius:999px;font-size:12px;cursor:pointer;user-select:none;'
            + 'border:1px solid ' + (active ? '#2d7aff' : '#d0d7de') + ';'
            + 'background:' + (active ? '#2d7aff' : '#fff') + ';'
            + 'color:' + (active ? '#fff' : '#333') + ';';
        el.addEventListener('click', function () {
            outerRarityFilter = r;
            jobOuterRenderTabs();
            jobOuterRenderGrid();
        });
        box.appendChild(el);
    });
}

// ---- 主网格：方形小卡，一行 6 个 ----
// 注意：所有布局/定位样式全部【内联】（与槽位选择器同一套路，见 27 号 jobRenderPlantGrid），
// 不依赖 base.css 的类——避免任何 CSS 加载/缓存差异导致卡片排版崩坏。
function jobOuterRenderGrid() {
    const grid = document.getElementById('outerGrid');
    if (!grid) return;
    const st = grid.scrollTop;      // 记下滚动位置，重绘后恢复（修：点击卡片后滚动条瞬间跳顶）
    grid.innerHTML = '';
    const kwEl = document.getElementById('outerSearch');
    const kw = (kwEl ? kwEl.value : '').trim().toLowerCase();
    const locked = jobOuterLockedPlants();
    const order = jobOuterEffective();   // 有效选取顺序 = 锁定（表顺序）+ 手动（点击顺序）
    // 显示顺序：黄框锁定植物永远最顶上（按阵容表顺序），其余按排序方式；
    // 调整排序模式下只显示已选集合（锁定 + 手动池），便于专注重排
    const lockedObjs = locked.map(function (n) { return jobFindPlant(n); }).filter(Boolean);
    let rest;
    if (outerReorder.active) {
        rest = outerReorder.pool.map(function (n) { return jobFindPlant(n); }).filter(Boolean);
    } else {
        rest = (plantCache || []).filter(function (p) { return locked.indexOf(p.name) === -1; });
        rest = jobOuterSortList(rest, order);
    }
    const list = lockedObjs.concat(rest).filter(function (p) {
        if (outerRarityFilter !== '全部' && p.rarity !== outerRarityFilter) return false;
        if (kw && !((p.name || '').toLowerCase().includes(kw))
               && !((p.en || '').toLowerCase().includes(kw))) return false;
        return true;
    });
    let noImgCnt = 0;
    list.forEach(function (p) {
        const hasImg = jobOuterAvail(p);
        const isLocked = locked.indexOf(p.name) !== -1;
        const selIdx = order.indexOf(p.name);
        const selected = isLocked || selIdx !== -1;
        if (!hasImg) noImgCnt++;

        // 单元格（文档流占位：卡片 + 名字）——三层结构，与槽位选择器
        // (27 号 jobRenderPlantGrid) 完全一致：aspect-ratio 只挂在内部卡片上，
        // grid item 是普通块、由内容自然撑高，避免 aspect-ratio 直接作用于
        // grid item 在某些浏览器里行高算不准、卡片垂直重叠的 bug。
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex;flex-direction:column;gap:2px;'
            + 'cursor:' + (hasImg ? 'pointer' : 'not-allowed') + ';user-select:none;';

        // 方形卡片：relative 容器（叉叉/勾勾/序号的定位父级），品质底图做背景。
        // 框色优先级：红框 = 在阵容表但局外无图（警告：局内选不到它）；
        //             黄框 = 阵容表锁定；绿框 = 手动已选。
        // 灰化只打【头像】不打卡片——否则滤镜会把黄/红框滤成黑框，看不清状态。
        let borderColor = '#e2e8f0', frameShadow = '';
        if (isLocked && !hasImg)      { borderColor = '#dc2626'; frameShadow = 'box-shadow:0 0 0 2px #dc2626;'; }
        else if (isLocked)            { borderColor = '#f5b40a'; frameShadow = 'box-shadow:0 0 0 2px #f5b40a;'; }
        else if (selected)            { borderColor = '#22a65e'; frameShadow = 'box-shadow:0 0 0 1px #22a65e;'; }
        const rare = (typeof p.rare === 'number') ? p.rare : (RARITY_TO_RARE[p.rarity] || 0);
        const card = document.createElement('div');
        card.style.cssText = 'position:relative;width:100%;aspect-ratio:1/1;border-radius:8px;overflow:hidden;flex:none;'
            + 'border:2px solid ' + borderColor + ';'
            + frameShadow
            + 'background:#fff url(static/card_bg/rare_' + rare + '.webp) center/100% 100% no-repeat;'
            + ((!hasImg && !isLocked) ? 'filter:grayscale(1);opacity:.55;' : '');

        // 植物头像：绝对定位居中
        const img = document.createElement('img');
        img.src = p.img || '';
        img.alt = p.name;
        img.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:82%;height:82%;object-fit:contain;'
            + ((!hasImg && isLocked) ? 'filter:grayscale(1);opacity:.6;' : '');
        img.onerror = function () { this.style.display = 'none'; };
        card.appendChild(img);

        // 角标：无图 -> 左上叉叉（复用通用叉叉）；已选 -> 左上序号 + 右上勾勾
        if (!hasImg) {
            jobCardXMark(card);
        } else if (selected) {
            if (selIdx !== -1) {
                const ord = document.createElement('span');
                ord.style.cssText = 'position:absolute;left:2px;top:2px;z-index:3;min-width:16px;height:16px;'
                    + 'border-radius:8px;background:#2d7aff;color:#fff;font-size:10px;line-height:16px;'
                    + 'text-align:center;font-weight:700;padding:0 3px;'
                    + 'box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;';
                ord.textContent = selIdx + 1;      // 选取顺序 = 点击先后（锁定植物排最前）
                card.appendChild(ord);
            }
            const ck = document.createElement('span');
            ck.style.cssText = 'position:absolute;right:2px;top:2px;z-index:3;width:16px;height:16px;'
                + 'border-radius:50%;background:#22a65e;color:#fff;font-size:11px;line-height:16px;'
                + 'text-align:center;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;';
            ck.textContent = '✓';
            card.appendChild(ck);
        }

        // 名字：卡片下方、文档流内（撑开 grid 行高的关键，勿改成绝对定位）
        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:10px;line-height:1.25;text-align:center;color:#444;'
            + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        nm.textContent = p.name;

        cell.appendChild(card);
        cell.appendChild(nm);

        // 悬停提示（1 秒，多行；由 02-tooltip.js 的 MutationObserver 自动接管）
        const lines = [p.name + '（' + (p.rarity || '?') + '卡）'];
        if (!hasImg && isLocked) {
            lines.push('⚠️ 在阵容表中，但没有无尽局外的图片资源');
            lines.push('局内选不到它：请从阵容表移除，或去 plant_ref_endless 补截图');
        } else if (!hasImg) {
            lines.push('⛔ 没有这个植物的无尽局外图片资源');
        } else if (isLocked) {
            lines.push('🔒 阵容表植物：优先选取，不能取消');
            if (selIdx !== -1) lines.push('选取顺序：第 ' + (selIdx + 1) + ' 个');
        } else if (selected) {
            lines.push('✅ 已选（第 ' + (selIdx + 1) + ' 个），点击取消');
        } else {
            lines.push('点击选择（选取顺序 = 点击先后）');
        }
        cell.setAttribute('data-tooltip', lines.join('\n'));
        cell.setAttribute('data-tooltip-delay', '1000');

        cell.addEventListener('click', function () { jobOuterToggle(p); });
        grid.appendChild(cell);
    });

    if (!list.length) {
        grid.innerHTML = '<span style="grid-column:1/-1;color:#888;padding:20px;">没有匹配的植物</span>';
    }

    // 计数行（封锁模式 / 调整排序模式下显示对应提示）
    const cnt = document.getElementById('outerPickCountText');
    if (cnt) {
        if (jobOuterBlockedMode()) {
            cnt.textContent = '当前执行方式不读取植物列表，无需选择';
            cnt.style.color = '#b45309';
        } else if (outerReorder.active) {
            cnt.textContent = '调整排序中：已重排 ' + order.length
                + ' / ' + (locked.length + outerReorder.pool.length) + ' 个（依次点击定优先级）';
            cnt.style.color = '#b45309';
        } else {
            const n = order.length;
            cnt.textContent = '已选 ' + n + ' 个（锁定 ' + locked.length + ' 个）'
                + (noImgCnt ? '，' + noImgCnt + ' 种无图不可选' : '')
                + (n > 80 ? '，⚠️ 局内只取前 80 个' : '');
            cnt.style.color = (n > 80) ? '#dc2626' : '#94a3b8';
        }
    }

    grid.scrollTop = st;            // 恢复滚动位置
}

// ---- 点击卡片：复选切换 ----
function jobOuterToggle(p) {
    if (jobOuterBlockedMode()) {
        setStatus('ℹ️ 当前执行方式不读取植物列表，无需选择（切回「按列表自动选取」才能改）');
        return;
    }
    const isLocked = jobOuterLockedPlants().indexOf(p.name) !== -1;
    if (isLocked) {
        // 锁定植物不可点：有图 -> 提示不能取消；无图 -> 警告局内选不到
        if (!jobOuterAvail(p)) setStatus('⚠️「' + p.name + '」在阵容表中，但没有局外图片资源，局内选不到它（请改阵容表槽位）');
        else setStatus('🔒「' + p.name + '」在阵容表中，不能取消（要改请改阵容表的槽位）');
        return;
    }
    if (!jobOuterAvail(p)) {
        setStatus('⛔「' + p.name + '」没有无尽局外的图片资源，无法选择');
        return;
    }
    const i = jobOuterPick.plants.indexOf(p.name);
    if (i === -1) jobOuterPick.plants.push(p.name);
    else jobOuterPick.plants.splice(i, 1);
    jobSaveLocal();
    jobOuterRenderGrid();
    jobOuterRefreshBadge();
}

// ---- 清空：清掉所有手动选择（锁定植物由阵容表派生，天然保留） ----
function jobOuterClear() {
    if (jobOuterBlockedMode()) {
        setStatus('ℹ️ 当前执行方式不读取植物列表，无需清空');
        return;
    }
    jobOuterPick.plants = [];
    jobSaveLocal();
    jobOuterRenderGrid();
    jobOuterRefreshBadge();
    setStatus('🧹 已清空手动选择的植物（阵容表植物保留）');
}

// ---- 局内执行方式（auto / oneclick / confirm）：单按钮显示当前模式 + 弹层选择 ----
// 模式元数据表：label = 按钮/菜单显示名；desc = 菜单项副标题 + 按钮旁描述
const OUTER_MODES = [
    { v: 'auto',     label: '按列表自动选取', desc: '按上面的列表顺序自动选取（表内植物优先）' },
    { v: 'oneclick', label: '一键选取',       desc: '用游戏自带的「一键选取」，优先选择的是你游戏内收藏的植物，不再按列表自动选' },
    { v: 'confirm',  label: '复用当前配置',   desc: '局内不再选卡，直接复用你在游戏内已经配置好的 80 个植物' },
];

function jobOuterModeMeta(v) {
    for (let i = 0; i < OUTER_MODES.length; i++) if (OUTER_MODES[i].v === v) return OUTER_MODES[i];
    return OUTER_MODES[0];
}

// 按钮文字 + 旁侧描述跟着当前模式走
function jobOuterRefreshModeBtn() {
    const meta = jobOuterModeMeta(jobOuterPick.mode);
    const btn = document.getElementById('outerModeBtn');
    if (btn) btn.textContent = meta.label + ' ▾';
    const desc = document.getElementById('outerModeDesc');
    if (desc) desc.textContent = meta.desc;
}

function jobOuterCloseModeMenu() {
    const m = document.getElementById('outerModeMenu');
    if (m) m.style.display = 'none';
}

// 弹层内容每次打开重渲染：当前模式高亮 + ✓
function jobOuterRenderModeMenu() {
    const m = document.getElementById('outerModeMenu');
    if (!m) return;
    m.innerHTML = OUTER_MODES.map(function (o, i) {
        const sel = o.v === jobOuterPick.mode;
        return '<button type="button" data-mode="' + o.v + '" style="display:block;width:100%;text-align:left;padding:8px 12px;border:0;'
            + (i < OUTER_MODES.length - 1 ? 'border-bottom:1px solid #f1f5f9;' : '')
            + 'background:' + (sel ? '#eff6ff' : '#fff') + ';cursor:pointer;font-size:13px;">'
            + '<b style="color:' + (sel ? '#2d7aff' : '#1f2937') + ';">' + (sel ? '✓ ' : '') + o.label + '</b><br>'
            + '<span style="font-size:11px;color:#94a3b8;">' + o.desc + '</span></button>';
    }).join('');
    m.querySelectorAll('button[data-mode]').forEach(function (b) {
        b.addEventListener('click', function () { jobOuterSetMode(b.getAttribute('data-mode')); });
    });
}

function jobOuterToggleModeMenu() {
    const m = document.getElementById('outerModeMenu');
    if (!m) return;
    if (m.style.display === 'none') { jobOuterRenderModeMenu(); m.style.display = 'block'; }
    else m.style.display = 'none';
}

function jobOuterSetMode(v) {
    jobOuterCloseModeMenu();
    if (v === jobOuterPick.mode) return;
    const tip = OUTER_MODE_CONFIRM[v];
    if (tip && !window.confirm(tip)) return;    // 用户取消 -> 保持原模式（按钮文字没动过）
    jobOuterPick.mode = v;
    jobSaveLocal();
    jobOuterApplyModeUI();               // 一键选取/复用当前配置 -> 封锁选择区
    jobOuterRenderGrid();                // 刷新计数行提示（保留滚动位置）
    jobOuterRefreshBadge();
    jobOuterRefreshModeBtn();
    setStatus('✅ 局内执行方式：' + jobOuterModeMeta(v).label);
}

// ---- 入口按钮上的已选数角标 ----
function jobOuterRefreshBadge() {
    const el = document.getElementById('outerPickCount');
    if (!el) return;
    // 封锁模式不读列表，角标显示 — 避免误导；
    // 排序模式中 plants 被清零重排，集合还在 pool 里 -> 角标保持显示完整集合数
    if (jobOuterBlockedMode()) { el.textContent = '—'; return; }
    const n = outerReorder.active
        ? jobOuterLockedPlants().length + outerReorder.pool.length
        : jobOuterEffective().length;
    el.textContent = String(n);
}

// ---- 事件绑定（自包含，不动 29 号的初始化）----
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('outerPickBtn');
    if (btn) btn.addEventListener('click', jobOpenOuterPicker);
    const close = document.getElementById('outerPickerClose');
    if (close) close.addEventListener('click', jobCloseOuterPicker);
    const clear = document.getElementById('outerClear');
    if (clear) clear.addEventListener('click', jobOuterClear);
    const fill = document.getElementById('outerFillBtn');
    if (fill) fill.addEventListener('click', jobOuterFill80);
    const reorder = document.getElementById('outerReorderBtn');
    if (reorder) reorder.addEventListener('click', jobOuterToggleReorder);
    const search = document.getElementById('outerSearch');
    if (search) search.addEventListener('input', jobOuterRenderGrid);
    const sortSel = document.getElementById('outerSortMode');
    if (sortSel) sortSel.addEventListener('change', function () {
        outerSortMode = sortSel.value;
        jobOuterRenderGrid();
    });
    // 局内执行方式：按钮开/关弹层；点别处或 Esc 收弹层
    const modeBtn = document.getElementById('outerModeBtn');
    if (modeBtn) modeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        jobOuterToggleModeMenu();
    });
    const modeMenu = document.getElementById('outerModeMenu');
    if (modeMenu) modeMenu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', jobOuterCloseModeMenu);
    const modal = document.getElementById('outerPicker');
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) jobCloseOuterPicker();
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        jobOuterCloseModeMenu();
        const m = document.getElementById('outerPicker');
        if (m && m.style.display !== 'none') jobCloseOuterPicker();
    });
    jobOuterRefreshBadge();
});
