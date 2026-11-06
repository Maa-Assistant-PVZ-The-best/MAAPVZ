// 27a-jobset-steps.js —— 原 27-jobset-board.js 第 1~1103 行：步骤模型 / 链解析 / 唯一 drop 出口
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。


// ============================================================
// 取消格内项目（多选）弹窗
//
// 右键一个格子里有多个项目时弹出，勾选要取消的，确认后移除。
// 只取消勾选的，其余保持原顺序保留。
// ============================================================
let jobCancelCtx = null;   // { items, onDone }

function jobPickItemsToCancel(r, c, items, onDone) {
    const modal = document.getElementById('cellCancelPicker');
    const grid = document.getElementById('ccGrid');
    const sub = document.getElementById('ccSub');
    if (!modal || !grid) {
        onDone(items.slice());          // 弹窗元素缺失 -> 退化为全部清空
        return;
    }

    grid.innerHTML = '';
    const checks = [];
    items.forEach(function (it, i) {
        const lab = document.createElement('label');
        lab.className = 'cc-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.idx = String(i);
        checks.push(cb);
        lab.appendChild(cb);

        const ico = document.createElement('span');
        ico.className = 'cc-ico';
        // ★ 落子动作图标由注册表给（新增动作自动生效）
        const _ccAct = (typeof jobBoardActionOfKey === 'function') ? jobBoardActionOfKey(it.id) : null;
        if (_ccAct) {
            jobAppendIconImg(ico, jobBoardActionImg(_ccAct), {
                cls: 'cc-ico-img', size: 40, alt: _ccAct.name, fallbackText: _ccAct.icon || '⚡'
            });
        } else if (it.type === 'feed') {
            jobAppendIconImg(ico, JOB_UI_IMG.feed, { cls: 'cc-ico-img', size: 40, alt: '喂豆', fallbackText: '🫘' });
        } else if (it.type === 'shovel') {
            jobAppendIconImg(ico, JOB_UI_IMG.shovel, { cls: 'cc-ico-img', size: 40, alt: '铲子', fallbackText: '🧹' });
        } else {
            ico.textContent = '🌿';
        }
        lab.appendChild(ico);

        const nm = document.createElement('span');
        nm.className = 'cc-name';
        nm.textContent = it.label || it.id || ('项目' + (i + 1));
        lab.appendChild(nm);

        const kind = document.createElement('span');
        const m = jobItemMode(it);
        kind.className = 'cc-kind' + (m === 'once' ? ' k-once' : (m === 'end' ? ' k-end' : ''));
        kind.textContent = jobModeLabel(m);
        lab.appendChild(kind);

        lab.addEventListener('click', function (e) {
            e.preventDefault();
            if (e.target !== cb) cb.checked = !cb.checked;
            jobSyncCancelAll(checks);
        });
        grid.appendChild(lab);
    });

    if (sub) sub.textContent = '第 (' + (c + 1) + ', ' + (r + 1) + ') 格 · 共 ' + items.length + ' 项';

    const allBox = document.getElementById('ccAll');
    if (allBox) {
        allBox.checked = false;
        // 用 change 而不是 click：click 会先翻转 checked，导致读取到的状态
        // 与用户看到的相反（实测坑）。change 在勾选状态稳定后才触发。
        allBox.onchange = function () {
            const v = this.checked;
            checks.forEach(function (cb) { cb.checked = v; });
        };
    }

    jobCancelCtx = { items: items, onDone: onDone };
    modal.classList.add('cc-open');
}

function jobSyncCancelAll(checks) {
    const allBox = document.getElementById('ccAll');
    if (!allBox) return;
    allBox.checked = checks.length > 0 && checks.every(function (cb) { return cb.checked; });
}

function jobCloseCancelPicker() {
    const modal = document.getElementById('cellCancelPicker');
    if (modal) modal.classList.remove('cc-open');
    jobCancelCtx = null;
}

function jobConfirmCancelPicker() {
    if (!jobCancelCtx) return;
    const chosen = [];
    document.querySelectorAll('#ccGrid input[type=checkbox]').forEach(function (cb) {
        if (cb.checked) {
            const i = parseInt(cb.dataset.idx, 10);
            if (!isNaN(i) && jobCancelCtx.items[i]) chosen.push(jobCancelCtx.items[i]);
        }
    });
    const done = jobCancelCtx.onDone;
    jobCloseCancelPicker();
    if (chosen.length && done) done(chosen);
}

// ============================================================
// 链条拖放内核（统一实现）
//
// 设计原则：
//   1. **链条严格读取棋盘** —— 段只是「棋盘上某些落点的引用」，
//      任何时刻链条显示的落点集合 = 棋盘上真实存在的落点。
//      段里的 from/to/picked 会被规范化成「真实存在的 gidx 列表」，
//      棋盘上不存在的下标一律丢弃，避免幽灵落点拖不动/种不上。
//   2. **落点判定只有一处** —— 所有块共用 jobWireDropTarget，
//      「插入到哪」只由 jobApplyDrop 决定。
//   3. **段身份用引用 + 指纹**，绝不用 key 单独定位（key 不唯一）。
//   4. **移动下标用移除前的下标换算**（否则源在目标前时会原地不动）。
// ============================================================

// 当前编辑的是「前期棋盘」还是「后期棋盘」
function jobCurrentBoard() {
    const late = document.querySelector('.tab.active')?.dataset.tab === 'late';
    return late ? boardLate : boardEarly;
}

// ---- 段的规范化：把段翻译成「真实存在」的落点下标列表 ----
// 返回 [gidx...]，保证每个都在棋盘上真实存在（严格读取棋盘）。
// ★ 复用 jobSegPlacements，避免两处各算一遍导致不一致。
function jobSegRealGidxs(board, seg, which) {
    return jobSegPlacements(board, seg, which).map(function (p) { return p.gidx; });
}

// ============================================================
// ★ 新链模型：链 = 一串「步骤」（step）
//
// 旧模型把「同一个槽的连续若干株」压成一段 {key, from, to}，
// 于是一个段会渲染成一个**大块**（真实数据里有一块塞了 21 株），
// 拖动/勾选/删除都得在「段」和「块」之间来回换算，非常容易错。
//
// 新模型：把段**完全展开**成一株一步：
//   { kind:'plant',   key:'card2', gidx:3 }       —— 某个具体落点
//   { kind:'generic', key:'ga:bean' }             —— 通用动作（没有落点）
//   { kind:'wait',    key:'ga:wait', ms:1000 }    —— 等待（带毫秒）
//
// 好处：
//   · 一块 = 一株，所见即所得，没有「大块」；
//   · 拖动 = 在这个有序列表里挪一项，不需要任何下标换算；
//   · 删除 = 从列表删一项 **并且** 从棋盘删掉那个落点（用户要求）；
//   · 顺序天然就是链序，与棋盘 seq 一致（严格读取棋盘）。
// 持久化时再压回旧的 {key,from,to,picked} 格式，保证 agent 端不用改。
// ============================================================

// 把一个槽的落点按「棋盘上的落子先后」排好（jobPlacementsOf 已按 seq 排）
function jobBoardStepsOfSlot(board, key, which) {
    return jobPlacementsOf(board, key, which).map(function (p, i) {
        return { kind: 'plant', key: key, gidx: i };
    });
}

// 棋盘上「所有槽」的落点，按各自的 seq 展开（用于「严格读取棋盘」）
function jobBoardStepsFor(board, which, keys) {
    const out = [];
    (keys || jobAllSlotKeys()).forEach(function (k) {
        jobBoardStepsOfSlot(board, k, which).forEach(function (s) { out.push(s); });
    });
    return out;
}

// ★ 步骤 id：**必须唯一**，且**与位置无关**。
//
//   两条要求：
//     ① 唯一 —— 通用动作可以完全一样（真实数据里 loop 链有 11 个一模一样的捡豆），
//        只靠 key 会算出同一个 id -> 勾一个等于全勾、拖一个拖走全部。
//     ② 与位置无关 —— 否则拖动之后 id 变了，勾选就会「留在原位」而不是跟着走。
//        这正是「多选拖动后勾选还在原来的位置」的根因。
//
//   做法：
//     · 植物：key + 落点下标（落点是棋盘的固有属性，跟链内位置无关）✓
//     · 通用动作/等待：key + ms + occ，其中 occ 是「同 key 在第几个**落点组**里」
//       —— 但那样又依赖位置了。所以改为：**同一份链里，按出现次序一次性编号，
//       编号写进步骤对象（st.uid），拖动时连同对象一起搬走。**
// ★★ P0 第一步（2026-11-02）：给「植物步骤」一个**不随位置漂移的稳定身份**
//
//   背景：段里存的 `picked/from/to/order` 是「该槽在该链里的第 N 个落点」这种
//   **位置下标**，只要落点成员一变（删一个/翻形态/重载）下标就整体滑动，
//   挂在 steps 上的 `uid`（勾选/拖动配对）也跟着滑 —— 这是 §9.2 那族
//   「拖完互换 / 撤销错乱」的根。
//
//   落点的稳定身份项目里其实早就有：`jobPlacementKey(which, key, r, c, seq)`
//   （原来专门用来挂「动作后等待」的键，口径已过实测）。
//   这里把它盖到植物步骤上（`st.sid`），让 `jobStepId` / `jobCarryUids` 用它配对；
//   **段存储格式这一轮不动**（还是 picked 下标），所以老作业集不需要迁移。
function jobSidOfPlacement(which, key, pl) {
    if (!pl || !pl.item) return '';
    try {
        return jobPlacementKey(which, key, pl.r, pl.c, pl.item.seq);
    } catch (e) { return ''; }
}

// 给一个植物步骤算 sid（找不到落点 -> 返回空串，调用方自然退回旧口径）
function jobStepSid(which, st, board) {
    if (!st || st.kind !== 'plant') return '';
    try {
        const list = jobPlacementsOf(board, st.key, which);
        return jobSidOfPlacement(which, st.key, list[st.gidx]);
    } catch (e) { return ''; }
}

function jobStepId(s) {
    if (!s) return '';
    const uid = (s.uid !== undefined && s.uid !== null) ? ('~' + s.uid) : '';
    if (s.kind === 'generic' || s.kind === 'wait') {
        const ms = (s.ms === undefined || s.ms === null) ? '' : ('#' + s.ms);
        // ★ 带参数的动作：参数也要进 id —— 否则「槽1点1次」和「槽2点3次」
        //   会撞成同一个 id，勾选/拖动定位就会串位。
        //   参数部分由动作定义驱动（jobParamsIdentity），新增参数无需改这里。
        const ga = jobGenericActionOfKey(s.key);
        const pid = jobParamsIdentity(ga, s);
        return s.key + ms + pid + uid;
    }
    // ★ 植物：优先用稳定身份 sid（格子+seq）；拿不到才退回 key#gidx 老口径
    return (s.sid ? s.sid : (s.key + '#' + s.gidx)) + uid;
}

// 不含参数（ms）的「身份」：用于改毫秒数时定位自己。
// ★ 改 ms 会让 jobStepId 变化，所以定位时不能带 ms。
function jobStepIdentity(s) {
    if (!s) return '';
    const uid = (s.uid !== undefined && s.uid !== null) ? ('~' + s.uid) : '';
    if (s.kind === 'generic' || s.kind === 'wait') return s.key + uid;
    return (s.sid ? s.sid : (s.key + '#' + s.gidx)) + uid;
}

// 按「不含参数的身份」在列表里定位（改 ms 时用）
function jobFindStepByIdentity(list, st) {
    const idn = jobStepIdentity(st);
    return (list || []).findIndex(function (x) { return jobStepIdentity(x) === idn; });
}

// ★ 给没有 uid 的步骤分配一个稳定 uid。
//
//   uid 的作用是让「两个一模一样的通用动作」区分开，同时**不依赖链内位置**：
//   uid 一旦分配就跟着步骤对象走，拖动时对象一起被搬走 -> 勾选跟着走。
//
//   分配策略：**只给新解析出来、还没有 uid 的步骤分配**；
//   已经在列表里、带 uid 的一律保留（这正是拖动后 id 不变的关键）。
let _jobUidSeq = 0;
function jobAssignOcc(steps) {
    (steps || []).forEach(function (s) {
        if (!s) return;
        if (s.uid === undefined || s.uid === null) s.uid = ++_jobUidSeq;
    });
    return steps;
}

// 步骤在链里的位置（对象同一性优先，其次按 id）
function jobStepIndexIn(list, step) {
    if (!Array.isArray(list) || !step) return -1;
    const byRef = list.indexOf(step);
    if (byRef !== -1) return byRef;
    const id = jobStepId(step);
    return list.findIndex(function (s) { return jobStepId(s) === id; });
}

// ★ 把持久化的「段数组」展开成步骤数组（严格读取棋盘：棋盘上没有的落点直接不产生步骤）
function jobSegsToSteps(board, segs, which) {
    const out = [];
    (segs || []).forEach(function (seg) {
        if (!seg) return;
        // 通用动作 / 等待
        if (jobIsGenericKey(seg.key)) {
            const st = { kind: 'generic', key: seg.key };
            const _ga = jobGenericActionOfKey(seg.key);
            const _gaId = _ga ? _ga.id : '';
            if (seg.ms !== undefined && seg.ms !== null) {
                // ★ 只有「等待」的 ms 才升级成 wait 步骤；
                //   自定义动作的 ms 是动作参数（滑动/长按时长），不能变成等待。
                if (_gaId === 'wait') { st.kind = 'wait'; st.ms = Number(seg.ms); }
                else st.ms = Number(seg.ms);
            }
            // ★ 切换形态的参数（槽位 + 次数）—— 不带上就会在渲染/存盘时被丢掉
            if (seg.slot !== undefined && seg.slot !== null) st.slot = Number(seg.slot);
            if (seg.times !== undefined && seg.times !== null) st.times = Number(seg.times);
            // ★ 连击间隔（ms，默认 0）
            if (seg.comboMs !== undefined && seg.comboMs !== null) st.comboMs = Number(seg.comboMs);
            // ★ 连击参与识别（默认开；false = 原子连击，不被识别打断）
            if (seg.comboWatch === false) st.comboWatch = false;
            // ★ 自定义动作的 act/from/to/pairs —— 白名单拷贝，不带上就静默丢
            if (_gaId === 'custom') jobCopyCustomFields(seg, st);
            // ★ 使用神器快照（artName/artType/artBody）—— 同上
            if (_gaId === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                jobCopyArtifactFields(seg, st);
            }
            // ★ 无间隔组「」标记
            if (seg.noint === true) st.noint = true;
            out.push(st);
            return;
        }
        // 植物：展开成「一株一步」（无间隔组标记随步骤走）
        jobSegRealGidxs(board, seg, which).forEach(function (g) {
            const st = { kind: 'plant', key: seg.key, gidx: g };
            // ★ P0：盖稳定身份（格子 + seq）。后面的 uid 继承 / 勾选 / 拖动配对
            //   一律按它来，这样删掉别的落点、gidx 前移也不会换身份。
            st.sid = jobStepSid(which, st, board);
            if (seg.noint === true) st.noint = true;
            // ★ 点击格子（tap）的连击次数 —— 不带上就静默丢
            if (seg.times !== undefined && seg.times !== null) st.times = Number(seg.times);
            // ★ 连击间隔（ms，默认 0）
            if (seg.comboMs !== undefined && seg.comboMs !== null) st.comboMs = Number(seg.comboMs);
            if (seg.comboWatch === false) st.comboWatch = false;
            out.push(st);
        });
    });
    return out;
}

// ★ 把步骤数组压回持久化格式（相邻且同槽连续的合并成一个段，保留旧格式兼容 agent）
//   通用动作保持独立段；ms 一并写回。
function jobStepsToSegs(steps) {
    const segs = [];
    (steps || []).forEach(function (st) {
        if (!st) return;
        if (st.kind === 'generic' || st.kind === 'wait') {
            const o = { key: st.key };
            if (st.ms !== undefined && st.ms !== null) o.ms = Number(st.ms);
            // ★ 切换形态的参数（槽位 + 次数）—— 必须写回，否则重载后参数丢失
            if (st.slot !== undefined && st.slot !== null) o.slot = Number(st.slot);
            if (st.times !== undefined && st.times !== null) o.times = Number(st.times);
            // ★ 连击间隔（ms，默认 0）—— 必须写回，否则重载后丢失
            if (st.comboMs !== undefined && st.comboMs !== null) o.comboMs = Number(st.comboMs);
            // ★ 连击参与识别（默认开不落盘；false 必须写回，否则重载后丢失）
            if (st.comboWatch === false) o.comboWatch = false;
            // ★ 自定义动作的 act/from/to/pairs —— 必须写回，否则重载后参数丢失
            const _ga = jobGenericActionOfKey(st.key);
            if (_ga && _ga.id === 'custom') jobCopyCustomFields(st, o);
            // ★ 使用神器快照（artName/artType/artBody）—— 同上
            if (_ga && _ga.id === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                jobCopyArtifactFields(st, o);
            }
            // ★ 无间隔组「」标记
            if (st.noint === true) o.noint = true;
            segs.push(o);
            return;
        }
        const last = segs[segs.length - 1];
        // ★ 合并条件加「同 noint、同 times」：组内/组外、连击数不同的
        //   同槽连续落子**不许合并**，否则无间隔组边界/连击数会被吃掉。
        if (last && last.key === st.key && Array.isArray(last.picked)
            && !!last.noint === !!st.noint
            && (Number(last.times) || 0) === (Number(st.times) || 0)
            && (Number(last.comboMs) || 0) === (Number(st.comboMs) || 0)
            && (last.comboWatch === false) === (st.comboWatch === false)
            && last.picked[last.picked.length - 1] === st.gidx - 1) {
            last.picked.push(st.gidx);          // 连续的继续接在后面
            if (last.sids) last.sids.push(st.sid || '');
            return;
        }
        const o = { key: st.key, from: -1, to: -1, picked: [st.gidx] };
        // ★ P0 第二步（2026-11-02）：段里额外写 `sids`（与 picked **一一对应**的稳定身份）。
        //   旧字段 picked/from/to **照旧写**，所以：
        //     · agent 侧（读 non_boss.*_chain 的 cells）完全不受影响；
        //     · 老作业集没有 sids -> 读的时候按 picked 下标走，行为一字不改；
        //     · 新存的文件带 sids -> 同格多株时不再因为「删掉一株」而丢步骤/换人。
        if (st.sid) o.sids = [st.sid];
        if (st.noint === true) o.noint = true;
        if (st.times !== undefined && st.times !== null) o.times = Number(st.times);
        if (st.comboMs !== undefined && st.comboMs !== null) o.comboMs = Number(st.comboMs);
        if (st.comboWatch === false) o.comboWatch = false;
        segs.push(o);
    });
    // picked 只有一项的还原成 from/to（更干净，也更接近旧数据的样子）
    segs.forEach(function (g) {
        // ★ 只要有一个空 sid 就把 sids 整个丢掉：宁可不写，也不要写半截错数据
        if (Array.isArray(g.sids)) {
            const bad = g.sids.some(function (x) { return !x; });
            const align = Array.isArray(g.picked) && g.sids.length === g.picked.length;
            if (bad || !align) delete g.sids;
        }
        if (Array.isArray(g.picked) && g.picked.length === 1) {
            g.from = g.picked[0];
            g.to = g.picked[0] + 1;
            delete g.picked;
        }
    });
    return segs;
}

// 段身份指纹（含 ms，用于区分两个同内容的「等待」）
function jobSegFingerprint(s) {
    if (!s) return '';
    let fp = s.key + '|' + (s.from | 0) + '|' + (s.to === null || s.to === undefined ? '*' : s.to)
         + '|' + (Array.isArray(s.picked) ? s.picked.join(',') : '')
         + '|' + (s.ms === undefined || s.ms === null ? '' : s.ms)
         + '|' + (s.slot === undefined || s.slot === null ? '' : s.slot)
         + '|' + (s.times === undefined || s.times === null ? '' : s.times)
         + '|' + (s.comboMs === undefined || s.comboMs === null ? '' : s.comboMs)
         + '|' + (s.comboWatch === false ? 'W0' : '')
         + '|' + (s.noint === true ? 'N' : '');
    // ★ 自定义动作：参数不同就是不同动作，指纹必须带上（否则两个不同的自定义段撞成同一个）
    if (String(s.key || '') === JOB_GA_PREFIX + 'custom') fp += '|' + jobCustomIdentity(s);
    // ★ 使用神器：快照的神器/体型不同 = 不同动作
    if (String(s.key || '') === JOB_GA_PREFIX + 'artifact') {
        fp += '|' + (s.artName || '') + '|' + (s.artType || '') + '|' + (s.artBody || '');
    }
    return fp;
}
function jobSameSeg(a, b) {
    return a === b || (!!a && !!b && jobSegFingerprint(a) === jobSegFingerprint(b));
}

// ★ 「把 src 段移到 target 段的前/后」→ 最终插入下标（用移除前的下标换算）
//   源在目标之前时，移除源段会让目标左移一位，
//   若还按「插到目标前面」算，正好插回原地 —— 表现成「拖了没反应」。
function jobMoveIndexFor(src, ti, after) {
    if (after) return (src < ti) ? ti : (ti + 1);
    return (src < ti) ? (ti - 1) : ti;
}

// ============================================================
// ★★ 链的解析：把「棋盘 + 持久化段」解析成**有序步骤列表**
//
// 这是整个链逻辑的唯一真相来源。规则：
//   1. 链条里记录的段，展开成步骤（一株一步）；
//   2. **严格读取棋盘**：棋盘上已经删掉的落点，步骤也一并消失；
//   3. 棋盘上新增的落点（作者又种了一株），只要没被链显式排过，
//      就按 seq 追加到「该槽最后一步之后」，不会丢；
//   4. 返回的数组顺序 = 执行顺序。
// ============================================================
// 上一次解析出来的步骤（每条链各存一份），用于把 uid 传下去
const _jobLastSteps = { once: null, loop: null, end: null };

function jobResolveSteps(t, which, board) {
    const field = jobChainField(which, board);
    const raw = Array.isArray(t[field]) ? t[field] : [];
    const steps = jobSegsToSteps(board, raw, which);
    // ③ 补上「棋盘上有、链里没有」的落点（新增的株不能丢）
    const inChain = {};
    steps.forEach(function (s) {
        if (s.kind === 'plant') inChain[s.key + '#' + s.gidx] = true;
    });
    jobAllSlotKeys().forEach(function (k) {
        const missing = [];
        jobPlacementsOf(board, k, which).forEach(function (_, i) {
            if (!inChain[k + '#' + i]) missing.push(i);
        });
        if (!missing.length) return;
        // 追加到「该槽最后一步」之后；该槽还没有步骤就放到末尾
        let at = -1;
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].kind === 'plant' && steps[i].key === k) { at = i; break; }
        }
        // ★ 若落点会插进「」无间隔组的中段，顺延到组尾之后 —— 浮动补位
        //   不该把组成撑散（成组是显式语义，浮动是隐式补位，隐式让路）。
        if (at !== -1 && steps[at].noint === true) {
            while (at + 1 < steps.length && steps[at + 1].noint === true) at++;
        }
        const add = missing.map(function (g) {
            // ★ 标成 synthesized：表示「棋盘上有、链存储里还没有」，
            //   仅用于展示来源；存盘时由 jobStoreSteps 统一固化（存盘即所见）。
            const st = { kind: 'plant', key: k, gidx: g, synthesized: true };
            // ★ P0：补位出来的步骤同样要带稳定身份（否则它每次 gidx 前移都会换身份）
            st.sid = jobStepSid(which, st, board);
            return st;
        });
        if (at === -1) steps.push.apply(steps, add);
        else steps.splice.apply(steps, [at + 1, 0].concat(add));
    });

    // ④ 编上稳定 uid（区分「一模一样的通用动作」，且拖动后不改变）
    //    ★ 关键：把上一次解析出来的 uid 传下来，这样「同一个捡豆」在多次
    //      解析之间拿到同一个 uid —— 勾选（用 uid 做 id）才能跟着它走。
    jobAssignOcc(steps);
    const prev = _jobLastSteps[which];
    if (prev) jobCarryUids(steps, prev);
    _jobLastSteps[which] = steps;
    // ★ 视图层**不做** noint 归一化（2026-10-24 修正）：
    //   旧版在这里 jobNormalizeNoint(steps) 会直接改步骤对象 —— 浮动补位
    //   落进「」组中段时，组员在视图里被当成「孤立」而被剥标记，搬运/存储
    //   再把这些被剥过的对象写回去，无间隔组就被静默解散了。
    //   归一化只留在持久化出口 jobStoreSteps（那里才是真改动）。
    return steps;
}


// ★★ 把旧步骤列表里的 uid 转移到新解析出来的步骤上。
//
//   为什么需要：jobResolveSteps 每次都会**新建对象**，而 uid 挂在对象上。
//   如果每次解析都重新编号，那么「同一个捡豆」在两次解析里会拿到不同的 uid，
//   勾选（用 uid 做 id）就会失效 / 串位。
//
//   匹配规则（按稳定性从高到低）：
//     ① 植物：key + gidx —— 落点是棋盘固有属性，跟链内位置无关，最可靠；
//     ② 通用动作/等待：key + ms，按**出现次序**逐个配对（有多个相同的时候）。
//   这样「第 3 个捡豆」拖到最前，它在同类里的次序变了，但我们可以按次序重新配对 ——
//   ★ 不行，那还是位置相关。所以对通用动作改用**按出现次序配对**，
//     且只在「新旧列表里同类数量相同」时才配对；数量变了就保持新 uid
//     （宁可丢勾选也不要串到别的项上）。
function jobCarryUids(newSteps, oldSteps) {
    if (!Array.isArray(newSteps) || !oldSteps || !oldSteps.length) return newSteps;

    // ① 植物：按**稳定身份 sid**（格子+seq）对应；没有 sid 的老步骤退回 key#gidx
    const stepKey = function (s) { return s.sid ? s.sid : (s.key + '#' + s.gidx); };
    const byKeyG = {};
    oldSteps.forEach(function (s) {
        if (s && s.kind === 'plant' && s.uid !== undefined) {
            byKeyG[stepKey(s)] = s.uid;
        }
    });
    const used = {};
    newSteps.forEach(function (s) {
        if (!s || s.kind !== 'plant') return;
        const k = stepKey(s);
        if (byKeyG[k] !== undefined && !used[k]) { s.uid = byKeyG[k]; used[k] = true; }
    });

    // ② 通用动作/等待：按「key+ms」分组，组内按出现次序一一配对。
    //    只有在两边数量相同时才配对 —— 否则说明链内容变了，配对会串位。
    //    ★ 切换形态还要带上 slot/times：参数不同就是不同的动作，不能配对到一起。
    const grp = function (list) {
        const m = {};
        list.forEach(function (s) {
            if (!s || (s.kind !== 'generic' && s.kind !== 'wait')) return;
            let gk = s.key
                + '#' + (s.ms === undefined || s.ms === null ? '' : s.ms)
                + '@' + (s.slot === undefined || s.slot === null ? '' : s.slot)
                + 'x' + (s.times === undefined || s.times === null ? '' : s.times);
            // ★ 自定义动作：参数不同 = 不同动作，组键必须带上（否则配对串位）
            if (String(s.key || '') === JOB_GA_PREFIX + 'custom') gk += '|' + jobCustomIdentity(s);
            (m[gk] = m[gk] || []).push(s);
        });
        return m;
    };
    const om = grp(oldSteps), nm = grp(newSteps);
    Object.keys(nm).forEach(function (gk) {
        const o = om[gk], n = nm[gk];
        if (!o || o.length !== n.length) return;   // 数量不同 -> 不配对，避免串位
        for (let i = 0; i < n.length; i++) {
            if (o[i] && o[i].uid !== undefined) n[i].uid = o[i].uid;
        }
    });

    return newSteps;
}

// ★ 无间隔组不变量：孤立的 noint 步（前后都不是组员）自动退回普通动作。
//   组至少要 2 步才有意义 —— 比如 1-5 成组后把 234 解散/删掉/拖走，
//   剩下的 1 和 5 各自孤零零还带着「」标记，必须在这里清掉。
//   所有会让链发生变化的出口最终都会走 jobStoreSteps，所以在这归一化。
function jobNormalizeNoint(steps) {
    (steps || []).forEach(function (st, i, arr) {
        if (!st || st.noint !== true) return;
        const prev = arr[i - 1], next = arr[i + 1];
        const hasMate = (prev && prev.noint === true) || (next && next.noint === true);
        if (!hasMate) delete st.noint;
    });
}

// 把步骤列表存回 t[field]（压缩成旧的段格式）
//
// ★ 存盘即所见（2026-10-24 修正）：
//   旧做法把「自动补出来的落点步骤」（synthesized）在存盘时**跳过**，
//   只有跨链搬运 ③④ 两处手动固化。结果同链拖拽/删除/成组/调参等
//   所有其它存储路径都会把未固化落点丢回浮动位（按 seq 重排）——
//   表现为「同链拖完顺序乱跳/拖了没反应」（水皮反馈）。
//   现在统一在存盘前固化：链 = 棋盘的派生视图，用户在链里看到什么，
//   存下来就是什么。（删落点走 jobDeleteStep —— 它连棋盘落点一起删，
//   不存在「想留在棋盘但不进链」的合法状态。）
// ★★ 清理「动作后等待」里**指向已不存在落点**的悬空键（2026-11-02）
//
//   背景：`waitAfter` 的键是 `jobPlacementKey(mode, 槽, r, c, seq)`
//   （例 `once|card1|2,1|3`）。删掉落点 / 清空格子 / 删掉槽位时，
//   **没有任何地方清理它** —— 于是文件里会一直攒着指向“不存在的落点”的键。
//   现在无害（读的时候按落点找，找不到自然不生效），但会让作业集越存越胖、
//   而且以后真要按 key 做统计/校验时就是脏数据。
//
//   清理时机：`jobStoreSteps`（链条唯一的写盘出口）之后 —— 那儿正好有棋盘和链名，
//   不用去改动 08 / 42 / 43 那些散落的删除入口。
//
//   ★ 认不出来的键**一律保留**（不认识的形态不敢删，宁可留着）。
function jobPruneWaitAfter(t, board, which) {
    const isBoss = (typeof jobIsBossBoard === 'function') ? jobIsBossBoard() : false;
    const obj = isBoss ? t.bossWaitAfter : t.waitAfter;
    if (!obj || typeof obj !== 'object') return 0;
    // 两种语境都要看：普通关棋盘删落点不该影响 boss 侧，反之亦然
    const boards = [];
    if (typeof boardEarly !== 'undefined' && boardEarly) boards.push(boardEarly);
    if (typeof boardLate !== 'undefined' && boardLate) boards.push(boardLate);
    if (board && boards.indexOf(board) === -1) boards.push(board);

    let removed = 0;
    Object.keys(obj).forEach(function (k) {
        const parts = String(k).split('|');
        if (parts.length !== 4) return;                 // 认不出来 -> 留着
        const mode = parts[0];
        const scope = parts[1];
        const rc = String(parts[2]).split(',');
        if (rc.length !== 2) return;
        const r = Number(rc[0]);
        const c = Number(rc[1]);
        const seq = Number(parts[3]);
        // 在两块棋盘上都找不到这个落点 -> 悬空
        let alive = false;
        for (let i = 0; i < boards.length && !alive; i++) {
            const list = jobPlacementsOf(boards[i], scope, mode);
            for (let j = 0; j < list.length; j++) {
                const pl = list[j];
                if (pl.r === r && pl.c === c && Number(pl.item.seq) === seq) { alive = true; break; }
            }
        }
        if (!alive) { delete obj[k]; removed++; }
    });
    return removed;
}

function jobStoreSteps(t, which, board, steps) {
    const field = jobChainField(which, board);
    const solid = (steps || []).filter(function (s) { return !!s; });
    solid.forEach(function (s) { if (s.synthesized) delete s.synthesized; });
    jobNormalizeNoint(solid);   // ★ 孤立 noint 步退回普通动作（组至少 2 步）
    t[field] = jobStepsToSegs(solid);
    // ★ 顺手清掉「动作后等待」里指向已不存在落点的键（见上面的说明）
    try { jobPruneWaitAfter(t, board, which); } catch (e) { }
    return t[field];
}

// ============================================================
// 多选状态
//
// 勾选表只是一个 **id -> true 的集合**；id 由「段」推导，
// 保证：重渲染后仍对得上、通用动作也能勾、两个一样的段不会串。
// ============================================================

// 步骤的勾选 id。
// ★ 新模型里每一步都有天然稳定的身份（植物=key#gidx，动作=key[#ms]），
//   不需要再看链内下标，也就不会出现「重渲染后对不上」的问题。
function jobPickId(which, st) {
    return which + '|' + jobStepId(st);
}

function jobIsPicked(which, st) {
    if (!jobSeqSel) return false;
    return !!jobSeqSel[jobPickId(which, st)];
}

// ★ Shift+点击范围多选：记录「上一次勾的是哪一步」
let _jobLastPick = null;   // { which, id }

// 一个勾选框
function jobBuildPickBox(which, st) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'seq-pick';
    const id = jobPickId(which, st);
    cb.checked = !!(jobSeqSel && jobSeqSel[id]);
    cb.title = '勾选后可和其它勾选项一起拖动；Shift+点击 = 范围多选';
    cb.draggable = false;
    cb.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    cb.addEventListener('click', function (e) {
        e.stopPropagation();
        cb._shift = e.shiftKey;      // change 事件拿不到 shiftKey，先存下来
    });
    cb.addEventListener('change', function (e) {
        e.stopPropagation();
        if (!jobSeqSel) jobSeqSel = {};
        const applyOne = function (pid, on) {
            if (on) jobSeqSel[pid] = true; else delete jobSeqSel[pid];
        };
        // ★ Shift 范围：上次勾的步 ~ 这步之间，全部设成这次的勾选状态
        let ranged = false;
        if (cb._shift && _jobLastPick && _jobLastPick.which === which) {
            const t = jobTables[currentTable];
            const steps = t ? jobResolveSteps(t, which, jobCurrentBoard()) : [];
            const ids = steps.map(function (s) { return jobPickId(which, s); });
            const a = ids.indexOf(_jobLastPick.id), b = ids.indexOf(id);
            if (a >= 0 && b >= 0) {
                const lo = Math.min(a, b), hi = Math.max(a, b);
                for (let i = lo; i <= hi; i++) applyOne(ids[i], cb.checked);
                ranged = true;
            }
        }
        if (!ranged) applyOne(id, cb.checked);
        _jobLastPick = { which: which, id: id };
        cb._shift = false;
        jobRenderSeqChains();
    });
    return cb;
}

// ★ 已勾选项，**严格按链内先后**返回（顺序直接来自步骤列表，天然保序）
//   board 可选：拖动时传渲染时用的那块棋盘，避免和 jobCurrentBoard() 不一致。
function jobSelectedInOrder(which, board) {
    const out = [];
    if (!jobSeqSel) return out;
    const t = jobTables[currentTable];
    if (!t) return out;
    const b = board || jobCurrentBoard();
    jobResolveSteps(t, which, b).forEach(function (st) {
        if (jobSeqSel[jobPickId(which, st)]) out.push(st);
    });
    return out;
}

// 当前这条链勾了几项（用于决定要不要显示「清空已勾选」）
function jobSelectedCount(which) {
    if (!jobSeqSel) return 0;
    const t = jobTables[currentTable];
    if (!t) return 0;
    const board = jobCurrentBoard();
    let n = 0;
    jobResolveSteps(t, which, board).forEach(function (st) {
        if (jobSeqSel[jobPickId(which, st)]) n++;
    });
    return n;
}

// 拖动时要一起搬的东西。被拖的块若已勾选 -> 搬「所有勾选项」；否则搬它自己。
function jobDragGroupFor(which, st, board) {
    if (!jobIsPicked(which, st)) return null;
    const list = jobSelectedInOrder(which, board);
    return list.length > 1 ? list : null;
}

function jobMarkDragging(on) {
    try { document.body.classList.toggle('seq-dragging-on', !!on); } catch (e) { }
}

// ============================================================
// 落点判定（宽容版，无死区）
// ============================================================

function jobDropBelow(e, el) {
    const r = el.getBoundingClientRect();
    return (e.clientY - r.top) > r.height / 2;
}

function jobMarkDropTarget(el, below) {
    jobClearSeqOver();
    if (!el) return;
    el.classList.add(below ? 'seq-over-bottom' : 'seq-over-top');
}

// 指针是否正落在某个块的矩形内
function jobBlockUnderPointer(listBox, clientY) {
    const els = listBox.querySelectorAll('.seq-chain');
    for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return els[i];
    }
    return null;
}

// ★ 按指针 Y 找最近的块，用「相邻块中线」分界 —— 每个像素都归属某个块，
//   块之间的 gap:8px 缝里也不会出现「谁都接不住」的死区。
function jobNearestBlockInList(listBox, clientY) {
    const els = listBox.querySelectorAll('.seq-chain');
    if (!els.length) return null;
    const rects = [];
    for (let i = 0; i < els.length; i++) rects.push(els[i].getBoundingClientRect());

    function info(i, below) {
        const el = els[i];
        return {
            el: el,
            step: el.__seqStep || null,
            isGeneric: el.classList.contains('seq-chain-generic'),
            gidx: (el.dataset.gidx === undefined || el.dataset.gidx === '')
                ? -1 : Number(el.dataset.gidx),
            below: !!below
        };
    }

    for (let i = 0; i < els.length; i++) {
        const r = rects[i];
        if (clientY >= r.top && clientY <= r.bottom) {
            return info(i, (clientY - r.top) > r.height / 2);
        }
    }
    if (clientY < rects[0].top) return info(0, false);
    const last = els.length - 1;
    if (clientY > rects[last].bottom) return info(last, true);
    for (let i = 0; i < els.length - 1; i++) {
        const a = rects[i], b = rects[i + 1];
        if (clientY >= a.bottom && clientY <= b.top) {
            const mid = (a.bottom + b.top) / 2;
            return clientY < mid ? info(i, true) : info(i + 1, false);
        }
    }
    return info(last, true);
}

// ============================================================
// 唯一的 drop 出口（新模型）
// drag   描述：{ which, kind:'step'|'group', step, group }
// target 描述：{ t, which, board, step, after }
//
// ★ 新模型下这里极简：把步骤从列表里摘出来、插到目标位置，存回去。
//   没有「段/块/落点」三层的下标换算，也就没有那类 bug。
// ============================================================
function jobApplyDrop(drag, target) {
    if (!drag || !target) return false;
    if (drag.which !== target.which) return false;
    const t = target.t;
    const which = target.which;
    const board = target.board;
    const after = !!target.after;

    const steps = jobResolveSteps(t, which, board);

    // 要搬走的步骤（多选整组，或单个）
    const moving = (drag.kind === 'group' && drag.group && drag.group.length)
        ? drag.group.slice()
        : (drag.step ? [drag.step] : []);
    if (!moving.length) return false;

    // ★ 把「渲染时的步骤对象」映射到「刚解析出来的步骤对象」。
    //   两层匹配：(1) 对象引用（没重渲染时直接命中）；
    //             (2) 步骤 id（含 occ，能区分 11 个一样的捡豆）。
    const resolveIdx = function (st) {
        if (!st) return -1;
        const byRef = steps.indexOf(st);
        if (byRef !== -1) return byRef;
        const id = jobStepId(st);
        return steps.findIndex(function (x) { return jobStepId(x) === id; });
    };

    const cut = {};
    const movingReal = [];
    moving.forEach(function (s) {
        const i = resolveIdx(s);
        if (i === -1 || cut[i]) return;
        cut[i] = true;
        movingReal.push(steps[i]);
    });
    if (!movingReal.length) return false;                 // 一个都没定位到 -> 无效拖动

    // ① 摘出
    const rest = steps.filter(function (_, i) { return !cut[i]; });

    // ② 定位插入点（在「摘除后」的列表里）
    let insertAt;
    const anchorIdx = resolveIdx(target.step);
    if (!target.step || anchorIdx === -1) {
        insertAt = rest.length;                          // 拖到链尾
    } else if (cut[anchorIdx]) {
        // ★ 目标自己也在被搬的组里 -> 用「目标原来前面还剩几项」定位，
        //   否则会插错位置（旧实现这里会整组掉链尾）。
        let n = 0;
        for (let i = 0; i < anchorIdx; i++) if (!cut[i]) n++;
        insertAt = n;
    } else {
        // 在 rest 里重新定位锚点（rest 的元素是 steps 的子集，按引用找）
        insertAt = rest.indexOf(steps[anchorIdx]);
        if (insertAt === -1) insertAt = rest.length;
        else if (after) insertAt += 1;
    }

    // ③ 插回去（movingReal 已按链内先后排好，顺序原样保留）
    rest.splice.apply(rest, [insertAt, 0].concat(movingReal));

    // ④ 存回（压缩成兼容格式）
    jobStoreSteps(t, which, board, rest);

    const nP = movingReal.filter(function (s) { return s.kind === 'plant'; }).length;
    const nG = movingReal.length - nP;
    if (drag.kind === 'group') {
        jobAfterChainChange(t, which,
            '📦 已把 ' + nP + ' 株' + (nG ? ' + ' + nG + ' 个动作' : '') + '一起搬到指定位置');
    } else {
        jobAfterChainChange(t, which, '🔗 已调整顺序');
    }
    return true;
}

// ============================================================
// ★★ 跨链移动：把步骤从一条链搬到另一条链（单次 ↔ 循环 ↔ 收尾）
//
// 链是棋盘的**派生视图**：落点属于哪条链 = 它的 item.mode。
// 所以「植物跨链」= 改棋盘上那株的 mode（链侧自动跟着变，
// 顺带把它的「动作后等待」waitAfter 键的形态前缀一起改写）；
// 「通用动作/等待」没有落点，链成员 = 它在哪个顺序数组里，
// 直接搬顺序条目即可。
//
// ★ boss 关没有收尾链（运行时永不执行），boss 棋盘上禁止搬入 end。
// ============================================================

// 棋盘成员变动（mode 翻转 / 落点删除）会让同槽落点重排，所有 gidx 全漂。
// 这个助手在**变动前**给每个植物步骤钉上落点的**对象引用**，
// 变动后按引用刷回新 gidx —— 引用找不到的步骤（已搬走/已删除）
// alive=false，由调用方剔除。
//   为什么必须这么做：段存储里的 picked/noint/times 全靠 gidx 指认落点，
//   变动后若按新 gidx 重排旧段，标记会「滑」到别的落点上
//   （2026-10-24 fuzz 实锤：跨链搬走一株后，无间隔组标记滑到下一株头上）。
function jobPinSteps(steps, board, which) {
    const pins = (steps || []).map(function (s) {
        if (!s || s.kind !== 'plant') return null;
        const p = jobPlacementsOf(board, s.key, which)[s.gidx];
        return p ? p.item : null;
    });
    return function () {
        const alive = [];
        (steps || []).forEach(function (s, i) {
            if (!s || s.kind !== 'plant') { alive.push(true); return; }
            const list = jobPlacementsOf(board, s.key, which);
            let g = -1;
            for (let k = 0; k < list.length; k++) {
                if (list[k].item === pins[i]) { g = k; break; }
            }
            if (g === -1) alive.push(false);
            else { s.gidx = g; alive.push(true); }
        });
        return alive;
    };
}

function jobMoveStepsToChain(t, board, drag, toWhich, targetStep, after) {
    if (!drag || !t || !board) return false;
    const fromWhich = drag.which;
    if (!fromWhich || fromWhich === toWhich) return false;
    // boss 关没有收尾链：boss 棋盘上禁止把任何东西搬进收尾
    if (toWhich === 'end' && jobIsBossBoard()) {
        setStatus('🚫 boss 关没有收尾链（boss 关只有单次/循环）');
        return false;
    }

    const moving = (drag.kind === 'group' && drag.group && drag.group.length)
        ? drag.group.slice() : (drag.step ? [drag.step] : []);
    if (!moving.length) return false;

    // 通用动作签名（相同动作在存储上不可区分，摘掉「第一个没摘过的」即等价）。
    // ★ 统一用 jobSegFingerprint：ms/slot/times/comboMs/comboWatch/noint 之外，
    //   自定义动作参数（jobCustomIdentity）与神器快照（artName/artType/artBody）
    //   都在指纹里。旧版本地 genSig 只认 custom —— 神器快照不进签名时，
    //   源链有多个神器步骤「摘掉第一个匹配」必摘错（同类型互换顺序事故，
    //   2026-10-24 水皮反馈：双点火拖完变成点同一个位置）。
    const genSig = jobSegFingerprint;

    // ⓪ 预解析目标链，把落点锚翻译成「搬动后仍能找回」的形式：
    //    植物 -> 落点对象引用（mode 翻转后 gidx 会漂，引用不会）；
    //    动作 -> 签名 + 它在同签名里的第几号。
    let anchorItem = null, anchorKey = null, anchorGen = null;
    if (targetStep) {
        const preDst = jobResolveSteps(t, toWhich, board);
        let ai = jobStepIndexIn(preDst, targetStep);
        if (ai !== -1) {
            const a = preDst[ai];
            if (a.kind === 'plant') {
                const pl = jobPlacementsOf(board, a.key, toWhich)[a.gidx];
                if (pl) { anchorItem = pl.item; anchorKey = a.key; }
            } else {
                const sig = genSig(a);
                let rank = 0;
                for (let i = 0; i < ai; i++) {
                    if (preDst[i].kind !== 'plant' && genSig(preDst[i]) === sig) rank++;
                }
                anchorGen = { sig: sig, rank: rank };
            }
        }
    }

    // ① 收集载荷：先拿落点**对象引用**，再动棋盘 —— mode 一改 gidx 就漂
    const payload = [];
    moving.forEach(function (st) {
        if (!st) return;
        if (st.kind === 'plant') {
            const p = jobPlacementsOf(board, st.key, fromWhich)[st.gidx];
            if (p && p.item) {
                const pe = { kind: 'plant', key: st.key, item: p.item, r: p.r, c: p.c };
                // ★ 链侧参数跟着搬（连击次数/连击间隔/原子连击/无间隔组）：
                //   它们只存在链的段上，棋盘 mode 翻转后重新解析拿不到。
                if (st.times !== undefined && st.times !== null) pe.times = st.times;
                if (st.comboMs !== undefined && st.comboMs !== null) pe.comboMs = st.comboMs;
                if (st.comboWatch === false) pe.comboWatch = false;
                if (st.noint === true) pe.noint = true;
                payload.push(pe);
            }
        } else {
            const e = { kind: st.kind, key: st.key };
            if (st.ms !== undefined && st.ms !== null) e.ms = st.ms;
            if (st.slot !== undefined && st.slot !== null) e.slot = st.slot;
            if (st.times !== undefined && st.times !== null) e.times = st.times;
            if (st.comboMs !== undefined && st.comboMs !== null) e.comboMs = st.comboMs;
            if (st.comboWatch === false) e.comboWatch = false;
            if (st.noint === true) e.noint = true;
            // ★ 自定义动作的 act/from/to/pairs 必须跟着搬 —— 不搬就剥成空壳，
            //   跨链一拖整个动作失效（参数袋全丢）。
            const _ga = jobGenericActionOfKey(st.key);
            if (_ga && _ga.id === 'custom') jobCopyCustomFields(st, e);
            // ★ 使用神器同款：artName/artType/artBody 快照跟着搬，
            //   否则搬过去变裸「使用神器」（2026-10-24 复现实锤）。
            if (_ga && _ga.id === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                jobCopyArtifactFields(st, e);
            }
            // ★ uid 跟着走：同样的动作出现多次时，源链摘除按 uid 精确命中
            //   「被拖的那一次」（按指纹摘第一个会把隔在中间的其它步骤顺序
            //   弄反 —— fuzz 实锤：两个等1000中间夹个等500，拖后面那个
            //   等1000，结果前面那个被摘了）。
            if (st.uid !== undefined) e.uid = st.uid;
            payload.push(e);
        }
    });
    if (!payload.length) return false;

    // ② 棋盘严格对应：植物落点的 mode 全部切到目标链；
    //    顺带迁移「动作后等待」的形态前缀（waitAfter 键 = 形态|槽|r,c|seq）
    //
    // ★ 翻转前先把源链解析出来并钉住落点引用（gidx 马上全漂，段上的
    //   noint/times 若按新 gidx 重排会滑到别的落点上 —— fuzz 实锤）。
    const srcSteps0 = jobResolveSteps(t, fromWhich, board);
    const unpinSrc = jobPinSteps(srcSteps0, board, fromWhich);

    let nPlant = 0;
    const wField = jobWaitField();
    const waits = (t && t[wField] && typeof t[wField] === 'object') ? t[wField] : null;
    payload.forEach(function (e) {
        if (e.kind !== 'plant') return;
        e.item.mode = toWhich;
        nPlant++;
        // ★ seq 必须按目标形态重编号：旧 seq 是「源形态」作用域的，带过去会
        //   和目标形态里已有的落点撞号；撞号后同 seq 的先后只能靠 ord/扫描序
        //   兜底，保存重开后 ord 按棋盘扫描序重建，段里的 picked 就指向了
        //   另一个物理落点（fuzz 实锤：喂豆位置在重开后互换）。
        //   目标形态内追加编号也正好匹配「新搬来的默认排在链尾」的语义。
        e.item.seq = jobNextSeq(board, e.key, toWhich);
        if (waits) {
            const pre = fromWhich + '|' + e.key + '|' + e.r + ',' + e.c + '|';
            Object.keys(waits).forEach(function (wk) {
                if (wk.indexOf(pre) !== 0) return;
                const v = waits[wk];
                delete waits[wk];
                // ★ 键尾是旧 seq，必须换新 seq 重建，否则等待永远挂不上
                waits[jobPlacementKey(toWhich, e.key, e.r, e.c, e.item.seq)] = v;
            });
        }
    });

    // ③ 源链收尾：用「翻转前钉好引用」的步骤列表重建 —— 被搬走的落点
    //    解钉时找不到引用（mode 已翻走）自动出局；noint/times 等段字段
    //    跟着步骤对象走，不会滑位。
    const genPool = payload.filter(function (e) { return e.kind !== 'plant'; });
    const srcAlive = unpinSrc();
    const srcRest = srcSteps0.filter(function (s, si) {
        if (!s) return false;
        if (s.kind === 'plant') return srcAlive[si];
        // 通用动作摘除：① 优先按 uid 精确命中「被拖的那一次出现」
        //   （同样动作出现多次且中间隔着别的步骤时，按指纹摘第一个会
        //   把链序弄反 —— fuzz 实锤）；② uid 缺失的兜底才按指纹。
        let i, e;
        for (i = 0; i < genPool.length; i++) {
            e = genPool[i];
            if (e._cut || e.uid === undefined) continue;
            if (s.uid === e.uid) { e._cut = true; return false; }
        }
        const sig = genSig(s);
        for (i = 0; i < genPool.length; i++) {
            e = genPool[i];
            if (e._cut || e.uid !== undefined) continue;
            if (genSig(e) === sig) { e._cut = true; return false; }
        }
        return true;
    });
    jobStoreSteps(t, fromWhich, board, srcRest);

    // ④ 目标链：重新解析（搬过来的植物以 synthesized 步骤出现），
    //    挑出来按载荷顺序插到锚点位置，再固化存回
    const dstSteps = jobResolveSteps(t, toWhich, board);
    const inserts = [];
    payload.forEach(function (e) {
        if (e.kind === 'plant') {
            const list = jobPlacementsOf(board, e.key, toWhich);
            let g = -1;
            for (let i = 0; i < list.length; i++) {
                if (list[i].item === e.item) { g = i; break; }
            }
            if (g === -1) return;
            let at = -1;
            for (let i = 0; i < dstSteps.length; i++) {
                const s = dstSteps[i];
                if (s && s.kind === 'plant' && s.key === e.key && s.gidx === g) { at = i; break; }
            }
            if (at === -1) return;
            const st = dstSteps.splice(at, 1)[0];
            // ★ 链侧参数回填（这些只活在段上，synthesized 步骤从棋盘解析不出来）
            if (e.times !== undefined) st.times = e.times;
            if (e.comboMs !== undefined) st.comboMs = e.comboMs;
            if (e.comboWatch === false) st.comboWatch = false;
            if (e.noint === true) st.noint = true;
            inserts.push(st);
        } else {
            // ★ wait 只认 ga:wait —— 自定义动作也带 ms（滑动/长按时长），
            //   按 ms 判型会把自定义滑动错判成「等待」。
            const _ga2 = jobGenericActionOfKey(e.key);
            const st = { kind: (_ga2 && _ga2.id === 'wait') ? 'wait' : 'generic', key: e.key };
            if (e.ms !== undefined) st.ms = e.ms;
            if (e.slot !== undefined) st.slot = e.slot;
            if (e.times !== undefined) st.times = e.times;
            if (e.comboMs !== undefined) st.comboMs = e.comboMs;
            if (e.comboWatch === false) st.comboWatch = false;
            if (e.noint === true) st.noint = true;
            // ★ 自定义动作的参数袋跟着搬（act/from/to/pairs）
            if (_ga2 && _ga2.id === 'custom') jobCopyCustomFields(e, st);
            // ★ 使用神器同款：快照三字段（artName/artType/artBody）跟着搬，
            //   否则跨链一拖变裸「使用神器」（2026-10-24 复现实锤：
            //   神器·small 搬完变 神器·?）。
            if (_ga2 && _ga2.id === 'artifact' && typeof jobCopyArtifactFields === 'function') {
                jobCopyArtifactFields(e, st);
            }
            inserts.push(st);
        }
    });
    if (!inserts.length) return false;

    // 定位插入点（在已摘除搬入项后的目标步骤列表里）
    let insertAt = dstSteps.length;
    if (anchorItem && anchorKey) {
        const list = jobPlacementsOf(board, anchorKey, toWhich);
        let g = -1;
        for (let i = 0; i < list.length; i++) {
            if (list[i].item === anchorItem) { g = i; break; }
        }
        if (g !== -1) {
            for (let i = 0; i < dstSteps.length; i++) {
                const s = dstSteps[i];
                if (s && s.kind === 'plant' && s.key === anchorKey && s.gidx === g) {
                    insertAt = after ? i + 1 : i;
                    break;
                }
            }
        }
    } else if (anchorGen) {
        let rank = 0;
        for (let i = 0; i < dstSteps.length; i++) {
            const s = dstSteps[i];
            if (!s || s.kind === 'plant') continue;
            if (genSig(s) !== anchorGen.sig) continue;
            if (rank === anchorGen.rank) { insertAt = after ? i + 1 : i; break; }
            rank++;
        }
    }
    dstSteps.splice.apply(dstSteps, [insertAt, 0].concat(inserts));
    // ★ 存回前固化全部 synthesized（理由同源链③：所见即所得，
    //   否则未显式存储的落点会在存盘后重排到链尾）
    dstSteps.forEach(function (s) { if (s) delete s.synthesized; });
    jobStoreSteps(t, toWhich, board, dstSteps);

    // ⑤ 收尾：保存 + 重渲染（两条链都会重画）
    const meta = JOB_CHAIN_META[toWhich] || { short: toWhich };
    const nGen = inserts.length - nPlant;
    jobAfterChainChange(t, toWhich,
        '🔀 已把 ' + (nPlant ? nPlant + ' 株' : '')
        + (nPlant && nGen ? ' + ' : '')
        + (nGen ? nGen + ' 个动作' : '')
        + ' 搬到「' + (meta.short || toWhich) + '」（棋盘形态已同步）');
    return true;
}

// 链条变动后的统一收尾
// ★ 注意：**不清空勾选**。用户要求「多选拖动后勾选保留」——
//   因为 step id 由 (key + gidx/occ) 决定，与链内位置无关，
//   拖动后 id 依然对得上，勾选状态天然能保留。
function jobAfterChainChange(t, which, msg) {
    jobSaveCurrentBoard();
    jobSaveLocal();
    jobRenderSeqChains();
    jobRenderCurrentBoard();
    if (msg) setStatus(msg);
}

// ★ 在某一步后面插入一个「等待」通用动作。
//   它是一个**独立的步骤**（可以在链里单独拖动/删除/改毫秒），
//   而不是挂在植物身上的属性。
function jobInsertWaitAfter(t, which, board, st, ms) {
    const steps = jobResolveSteps(t, which, board);
    // ★ 定位：先按对象引用，再按「稳定身份」。
    //   jobResolveSteps 每次都新建对象，但 uid 会被 jobCarryUids 传下去，
    //   所以身份匹配在重渲染之后依然成立。
    let idx = steps.indexOf(st);
    if (idx === -1) idx = jobFindStepByIdentity(steps, st);
    if (idx === -1) idx = steps.length - 1;      // 兜底：插到末尾

    steps.splice(idx + 1, 0, { kind: 'wait', key: 'ga:wait', ms: ms || 1000 });
    jobStoreSteps(t, which, board, steps);

    jobAfterChainChange(t, which, '⏱ 已在下面插入一个「等待」');
}

// ============================================================
// 步骤设置弹窗（#stepCfgModal）——每步块上的 ⚙
//
//   一级：两个选项 —— ① 插入等待节点  ② 调配参数
//   二级（调配参数）：按步骤类型显示
//       点击类（点波/捡豆/加速/自定义点击/点击格子）-> 连击次数（块上显示 ×N）
//       切换形态 -> 槽位 + 次数
//       等待节点 -> 等待毫秒
//       其余（植物/喂豆/铲子/滑动类自定义）-> 默认滑动时长（作业集级 jobMeta.swipeMs）
//   ★ 动作间隔固定 0.1s（BatchSwipe 默认），不开放调整。
// ============================================================
