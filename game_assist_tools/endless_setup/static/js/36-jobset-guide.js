
// ============================================================
// 新手引导（首次打开弹窗 + 新手教学）
//
//   · 第一次打开编辑器时弹出「第一次使用？」：
//       我是小登…  -> 记录 newbie，进入新手教学（多步弹窗）
//       我是老手！ -> 记录 veteran，以后不再弹
//   · 选择存 localStorage（maapvz_guide_choice），不清缓存就只问一次。
//   · 点 ✕ 关闭 = 不记录，下次打开还会再问。
//   · jobGuideOpen() = 标题右侧「🌱 新手教程」按钮的重开入口。
//
//   ★ 教学步骤内容全在 JOB_GUIDE_STEPS 里：改文案 / 加步骤只动这个数组。
// ============================================================

const JOB_GUIDE_KEY = 'maapvz_guide_choice';

// ---- 教学课题（「你需要了解的……」系列，小登按需点选）----------------------
//   普通课题：{title, html} 静态图文；
//   交互课题：{title, interactive:{stages:[...]}} 在真实界面上按阶段指：
//     每阶段 {targetSel, html, next}：
//       next='click'  -> 等用户亲手点 targetSel 才进下一阶段
//       next='button' -> 气泡上给「下一步」按钮
//       next='done'   -> 最后阶段，给「完成」
const JOB_GUIDE_STEPS = [
    {
        title: '📂 作业集选择',
        interactive: {
            stages: [
                {
                    targetSel: '#jobPickBtn',
                    html:
                        '所有打法配置都装在「作业集」里——这是全局最重要的按钮。<br>' +
                        '<b>👉 点它试试</b>，打开作业集列表。',
                    next: 'click'
                },
                {
                    targetSel: '#jobPickModal .jp-panel',
                    html:
                        '这就是作业集列表：<br>' +
                        '· 点作业集名字 = 载入它（可以随便点，不会丢东西）<br>' +
                        '· 「+ 新建」= 从空白模板白手起家<br>' +
                        '· 底部还能 📤 导出 / 📥 导入 JSON，群友分享就是这么传的<br><br>' +
                        '改完记得回主界面点 <b>💾 保存此作业集</b>——maapvz 运行的是保存后的版本。',
                    next: 'done'
                },
            ]
        }
    },
    {
        title: '🔗 链条规则',
        interactive: {
            stages: [
                {
                    targetSel: '#slotPlantPanel',
                    html:
                        '落子分三条链：<b>单次</b>（开局一遍）→ <b>循环</b>（反复执行）→ <b>收尾</b>（最后一波）。<br>' +
                        '选中植物槽位后，用 <b>右键</b> 或按 <b>F</b> 可以切换它的链条。',
                    next: 'button'
                },
                {
                    targetSel: '#seqToggle',
                    html: '<b>👉 点右边这个「🔗 种植顺序」</b>，展开顺序链面板。',
                    next: 'click'
                },
                {
                    targetSel: '#seqDrawer',
                    html:
                        '这里就是三条顺序链。<br>' +
                        '点击/拖动它们可以调整运行顺序；块内也能拖，⏱ 等待节点也能拖。',
                    next: 'done'
                },
            ]
        }
    },
    {
        title: '🧩 布局配置',
        interactive: {
            stages: [
                {
                    targetSel: '#jobLayoutBtn',
                    html:
                        '149 关不需要 149 套阵容——「布局配置」决定<b>每张阵容表管哪些关</b>。<br>' +
                        '<b>👉 点它</b>打开布局面板。',
                    next: 'click'
                },
                {
                    targetSel: '#layoutModal .lz-side',
                    html:
                        '左边是<b>阵容表图层</b>：点表名选中 = 拿笔；上面的表优先盖住下面的表。<br>' +
                        '「＋ 新建表格」加表，✏️/双击改名。',
                    next: 'button'
                },
                {
                    targetSel: '#layoutModal .lz-body',
                    html:
                        '右边是 1~149 关的格子：<b>点/拖动 = 把圈到的关划给当前表</b>。<br>' +
                        '玩到某关就自动切到对应的表，换阵容、换链条全自动；' +
                        '没圈的关沿用上一张表，不用担心漏配。',
                    next: 'done'
                },
            ]
        }
    },
];

// ============================================================
// 首次询问弹窗（第一次使用？）
// ============================================================

function jobGuideEnsureModal() {
    let modal = document.getElementById('jobGuideModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'jobGuideModal';
    modal.style.cssText =
        'display:none; position:fixed; top:0; left:0; width:100%; height:100%;' +
        'background:rgba(0,0,0,0.5); z-index:10050; justify-content:center; align-items:center;';
    modal.innerHTML =
        '<div style="background:#fff; padding:24px 28px; border-radius:12px; max-width:380px;' +
        ' box-shadow:0 4px 12px rgba(0,0,0,0.3); position:relative; text-align:center;">' +
        '  <button id="jobGuideClose" title="下次再问" style="position:absolute; top:8px; right:10px;' +
        '   border:none; background:none; font-size:16px; cursor:pointer; color:#94a3b8;">✕</button>' +
        '  <div style="font-size:20px; font-weight:700; margin-bottom:6px;">🌱 第一次使用？</div>' +
        '  <div style="font-size:13px; color:#64748b; margin-bottom:18px;">这个工具是「无尽挑战」作业集编辑器</div>' +
        '  <div style="display:flex; justify-content:center; gap:14px;">' +
        '    <button id="jobGuideNewbie" class="btn btn-primary" style="font-size:15px; padding:10px 18px;">我是小登…</button>' +
        '    <button id="jobGuideVeteran" class="btn" style="font-size:15px; padding:10px 18px;">我是老手！</button>' +
        '  </div>' +
        '</div>';
    document.body.appendChild(modal);

    document.getElementById('jobGuideClose').onclick = function () {
        modal.style.display = 'none';           // 不记录，下次再问
    };
    document.getElementById('jobGuideNewbie').onclick = function () {
        jobGuideChoose('newbie');
    };
    document.getElementById('jobGuideVeteran').onclick = function () {
        jobGuideChoose('veteran');
    };
    return modal;
}

// 记录选择：老手直接收摊；小登进教学课题菜单
function jobGuideChoose(choice) {
    try { localStorage.setItem(JOB_GUIDE_KEY, choice); } catch (e) { /* 无痕模式等，忽略 */ }
    const modal = document.getElementById('jobGuideModal');
    if (modal) modal.style.display = 'none';
    if (choice === 'newbie') jobGuideMenuOpen();
}

// 打开首次询问弹窗（标题按钮入口）
function jobGuideOpen() {
    const modal = jobGuideEnsureModal();
    modal.style.display = 'flex';
}

// ============================================================
// 新手教学：课题菜单 + 单课题弹窗（「你需要了解的……」）
//
//   小登进来先看到课题菜单（JOB_GUIDE_STEPS 每项一个按钮），
//   点哪个看哪个；单课题弹窗里「返回列表」回菜单。
// ============================================================

let _jobGuideStepIdx = 0;

// ---- 课题菜单 ----
function jobGuideEnsureMenuModal() {
    let modal = document.getElementById('jobGuideMenuModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'jobGuideMenuModal';
    modal.style.cssText =
        'display:none; position:fixed; top:0; left:0; width:100%; height:100%;' +
        'background:rgba(0,0,0,0.5); z-index:10051; justify-content:center; align-items:center;';

    let btns = '';
    JOB_GUIDE_STEPS.forEach(function (s, i) {
        btns += '<button class="btn job-guide-topic" data-i="' + i + '" style="' +
            'display:block; width:100%; margin:8px 0; padding:12px; font-size:15px; text-align:left;">' +
            s.title + '</button>';
    });

    modal.innerHTML =
        '<div style="background:#fff; padding:22px 26px; border-radius:12px; max-width:380px; width:90%;' +
        ' box-shadow:0 4px 12px rgba(0,0,0,0.3); position:relative;">' +
        '  <button id="jobGuideMenuClose" style="position:absolute; top:8px; right:10px;' +
        '   border:none; background:none; font-size:16px; cursor:pointer; color:#94a3b8;">✕</button>' +
        '  <div style="font-size:12px; color:#94a3b8; margin-bottom:4px;">你需要了解的……</div>' +
        '  <div style="font-size:18px; font-weight:700; margin-bottom:10px;">挑一个看看：</div>' +
        btns +
        '</div>';
    document.body.appendChild(modal);

    Array.prototype.forEach.call(
        modal.querySelectorAll('.job-guide-topic'), function (btn) {
            btn.onclick = function () {
                modal.style.display = 'none';
                const i = Number(btn.getAttribute('data-i'));
                // 「作业集选择」走交互式指引（指着真实界面让用户点），其余先静态图文
                if (JOB_GUIDE_STEPS[i] && JOB_GUIDE_STEPS[i].interactive) {
                    jobGuideSpotStart(JOB_GUIDE_STEPS[i].interactive);
                } else {
                    jobGuideStepOpen(i);
                }
            };
        });
    document.getElementById('jobGuideMenuClose').onclick = function () {
        modal.style.display = 'none';
    };
    return modal;
}

function jobGuideMenuOpen() {
    jobGuideEnsureMenuModal().style.display = 'flex';
}

// ---- 单课题弹窗 ----
function jobGuideEnsureStepModal() {
    let modal = document.getElementById('jobGuideStepModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'jobGuideStepModal';
    modal.style.cssText =
        'display:none; position:fixed; top:0; left:0; width:100%; height:100%;' +
        'background:rgba(0,0,0,0.5); z-index:10052; justify-content:center; align-items:center;';
    modal.innerHTML =
        '<div style="background:#fff; padding:22px 26px; border-radius:12px; max-width:440px; width:90%;' +
        ' box-shadow:0 4px 12px rgba(0,0,0,0.3); position:relative;">' +
        '  <div style="font-size:12px; color:#94a3b8; margin-bottom:4px;">你需要了解的……</div>' +
        '  <div id="jobGuideStepTitle" style="font-size:18px; font-weight:700; margin-bottom:10px;"></div>' +
        '  <div id="jobGuideStepBody" style="font-size:13px; color:#334155; line-height:1.7; min-height:120px;"></div>' +
        '  <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">' +
        '    <button id="jobGuideStepBack" class="btn">返回列表</button>' +
        '    <button id="jobGuideStepDone" class="btn btn-primary">看完了</button>' +
        '  </div>' +
        '</div>';
    document.body.appendChild(modal);

    document.getElementById('jobGuideStepBack').onclick = function () {
        modal.style.display = 'none';
        jobGuideMenuOpen();
    };
    document.getElementById('jobGuideStepDone').onclick = function () {
        modal.style.display = 'none';
    };
    return modal;
}

// 打开第 i 个课题
function jobGuideStepOpen(i) {
    const s = JOB_GUIDE_STEPS[i];
    if (!s) return;
    _jobGuideStepIdx = i;
    const modal = jobGuideEnsureStepModal();
    document.getElementById('jobGuideStepTitle').innerHTML = s.title;
    document.getElementById('jobGuideStepBody').innerHTML = s.html;
    modal.style.display = 'flex';
}

// 首次打开自动弹（没选过才弹）
window.addEventListener('load', function () {
    let choice = null;
    try { choice = localStorage.getItem(JOB_GUIDE_KEY); } catch (e) { /* ignore */ }
    if (!choice) jobGuideOpen();
});

// ============================================================
// 交互式指引（聚光灯）：高亮真实界面元素 + 气泡箭头，引导用户亲手点
//
//   jobGuideSpotStart(cfg) 按 cfg.stages 逐阶段走：
//     next='click'  等用户亲手点目标 -> 350ms 后（等弹窗开出来）进下一阶段
//     next='button' 气泡给「下一步」
//     next='done'   气泡给「完成」
//   不用全屏遮罩 —— 用户要能直接点真实界面。
// ============================================================

let _spot = null;   // {ring, bubble, target, onScroll, onTarget}

function jobGuideSpotStop(backToMenu) {
    if (_spot) {
        if (_spot.ring) _spot.ring.remove();
        if (_spot.bubble) _spot.bubble.remove();
        if (_spot.target && _spot.onTarget) {
            _spot.target.removeEventListener('click', _spot.onTarget);
        }
        window.removeEventListener('resize', _spot.onScroll);
        window.removeEventListener('scroll', _spot.onScroll, true);
        _spot = null;
    }
    if (backToMenu) jobGuideMenuOpen();
}

// 把聚光灯挪到 elem 上（环形高亮 + 气泡 + 箭头方向自动算）
function _spotLayout(elem, bubble, ring) {
    const r = elem.getBoundingClientRect();
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';

    // 气泡优先放目标下方；放不下了放上方
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
    let top, arrowUp;
    if (r.bottom + 14 + bh < window.innerHeight) {
        top = r.bottom + 14; arrowUp = true;        // 气泡在下，箭头朝上指目标
    } else {
        top = Math.max(8, r.top - 14 - bh); arrowUp = false;
    }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    const arrow = bubble.querySelector('.guide-spot-arrow');
    if (arrow) {
        arrow.style.top = arrowUp ? '-6px' : 'auto';
        arrow.style.bottom = arrowUp ? 'auto' : '-6px';
        arrow.style.left = Math.max(12, Math.min(bw - 24, r.left + r.width / 2 - left - 6)) + 'px';
    }
}

function _spotShow(targetSel, bodyHtml, footerHtml, onTargetClick) {
    jobGuideSpotStop(false);
    const target = document.querySelector(targetSel);
    if (!target) {                       // 目标不在（界面状态变了）-> 回菜单
        jobGuideMenuOpen();
        return;
    }

    const ring = document.createElement('div');
    ring.style.cssText =
        'position:fixed; z-index:10110; pointer-events:none; border-radius:8px;' +
        'box-shadow:0 0 0 3px #3b82f6, 0 0 18px 4px rgba(59,130,246,0.55);';

    const bubble = document.createElement('div');
    bubble.style.cssText =
        'position:fixed; z-index:10111; max-width:320px; background:#fff; border-radius:10px;' +
        'padding:12px 14px; font-size:13px; color:#334155; line-height:1.7;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.35);';
    bubble.innerHTML =
        '<div class="guide-spot-arrow" style="position:absolute; width:12px; height:12px;' +
        ' background:#fff; transform:rotate(45deg);"></div>' +
        '<div>' + bodyHtml + '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">' +
        (footerHtml || '') + '</div>';
    document.body.appendChild(ring);
    document.body.appendChild(bubble);

    _spot = { ring: ring, bubble: bubble, target: target, onTarget: null, onScroll: null };
    const layout = function () { _spotLayout(target, bubble, ring); };
    _spot.onScroll = layout;
    window.addEventListener('resize', layout);
    window.addEventListener('scroll', layout, true);
    layout();

    if (onTargetClick) {
        const h = function () { setTimeout(onTargetClick, 350); };   // 等目标动作（弹窗）出来
        _spot.onTarget = h;
        target.addEventListener('click', h);
    }
}

function jobGuideSpotStart(cfg) {
    const stages = cfg.stages || [];
    let idx = 0;

    const showStage = function () {
        const s = stages[idx];
        if (!s) { jobGuideSpotStop(false); return; }

        const isLast = (idx === stages.length - 1);
        let footer = '<button class="btn" id="guideSpotBack">返回列表</button>';
        if (s.next === 'button') footer += '<button class="btn btn-primary" id="guideSpotNext">下一步</button>';
        if (s.next === 'done' || isLast) footer += '<button class="btn btn-primary" id="guideSpotDone">完成</button>';

        _spotShow(s.targetSel, s.html, footer,
            (s.next === 'click') ? function () { idx++; showStage(); } : null);

        const back = document.getElementById('guideSpotBack');
        if (back) back.onclick = function () { jobGuideSpotStop(true); };
        const nextBtn = document.getElementById('guideSpotNext');
        if (nextBtn) nextBtn.onclick = function () { idx++; showStage(); };
        const doneBtn = document.getElementById('guideSpotDone');
        if (doneBtn) doneBtn.onclick = function () { jobGuideSpotStop(false); };
    };

    showStage();
}
