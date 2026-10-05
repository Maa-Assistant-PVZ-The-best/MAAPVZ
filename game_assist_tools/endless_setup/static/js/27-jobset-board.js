
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
    return s.key + '#' + s.gidx + uid;
}

// 不含参数（ms）的「身份」：用于改毫秒数时定位自己。
// ★ 改 ms 会让 jobStepId 变化，所以定位时不能带 ms。
function jobStepIdentity(s) {
    if (!s) return '';
    const uid = (s.uid !== undefined && s.uid !== null) ? ('~' + s.uid) : '';
    if (s.kind === 'generic' || s.kind === 'wait') return s.key + uid;
    return s.key + '#' + s.gidx + uid;
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
            // ★ 自定义动作的 act/from/to/pairs —— 白名单拷贝，不带上就静默丢
            if (_gaId === 'custom') jobCopyCustomFields(seg, st);
            // ★ 无间隔组「」标记
            if (seg.noint === true) st.noint = true;
            out.push(st);
            return;
        }
        // 植物：展开成「一株一步」（无间隔组标记随步骤走）
        jobSegRealGidxs(board, seg, which).forEach(function (g) {
            const st = { kind: 'plant', key: seg.key, gidx: g };
            if (seg.noint === true) st.noint = true;
            // ★ 点击格子（tap）的连击次数 —— 不带上就静默丢
            if (seg.times !== undefined && seg.times !== null) st.times = Number(seg.times);
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
            // ★ 自定义动作的 act/from/to/pairs —— 必须写回，否则重载后参数丢失
            const _ga = jobGenericActionOfKey(st.key);
            if (_ga && _ga.id === 'custom') jobCopyCustomFields(st, o);
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
            && last.picked[last.picked.length - 1] === st.gidx - 1) {
            last.picked.push(st.gidx);          // 连续的继续接在后面
            return;
        }
        const o = { key: st.key, from: -1, to: -1, picked: [st.gidx] };
        if (st.noint === true) o.noint = true;
        if (st.times !== undefined && st.times !== null) o.times = Number(st.times);
        segs.push(o);
    });
    // picked 只有一项的还原成 from/to（更干净，也更接近旧数据的样子）
    segs.forEach(function (g) {
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
         + '|' + (s.noint === true ? 'N' : '');
    // ★ 自定义动作：参数不同就是不同动作，指纹必须带上（否则两个不同的自定义段撞成同一个）
    if (String(s.key || '') === JOB_GA_PREFIX + 'custom') fp += '|' + jobCustomIdentity(s);
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
        const add = missing.map(function (g) {
            // ★ 标成 synthesized：渲染时看得见（严格读取棋盘），
            //   但存盘时不会被写回去（否则会把空槽撑成一大堆段）
            return { kind: 'plant', key: k, gidx: g, synthesized: true };
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
    // ★ 视图级归一化：孤立的 noint 步不带「」标记渲染（组至少 2 步）。
    //   持久化出口（jobStoreSteps）里也有一份，这里是给「载入旧数据还没改动」兜底。
    jobNormalizeNoint(steps);
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

    // ① 植物：key#gidx 直接对应
    const byKeyG = {};
    oldSteps.forEach(function (s) {
        if (s && s.kind === 'plant' && s.uid !== undefined) {
            byKeyG[s.key + '#' + s.gidx] = s.uid;
        }
    });
    const used = {};
    newSteps.forEach(function (s) {
        if (!s || s.kind !== 'plant') return;
        const k = s.key + '#' + s.gidx;
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
// ★ 只存「链里真正记过的」内容：
//   jobResolveSteps 会为了「严格读取棋盘」自动补上棋盘上新增的落点，
//   那是**渲染用的视图**，不该原样写回 —— 否则每存一次盘，
//   槽 card2..card8/feed/shovel 这些空槽都会被写成 {from:0,to:null}，
//   把用户的链撑得又大又乱。
//   做法：把「自动补出来的步骤」标成 synthesized，存盘时跳过它们。
function jobStoreSteps(t, which, board, steps) {
    const field = jobChainField(which, board);
    const solid = (steps || []).filter(function (s) { return s && !s.synthesized; });
    jobNormalizeNoint(solid);   // ★ 孤立 noint 步退回普通动作（组至少 2 步）
    t[field] = jobStepsToSegs(solid);
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

    // 通用动作签名（相同动作在存储上不可区分，摘掉「第一个没摘过的」即等价）
    const genSig = function (s) {
        return s.kind + '|' + s.key
            + '#' + (s.ms === undefined || s.ms === null ? '' : s.ms)
            + '@' + (s.slot === undefined || s.slot === null ? '' : s.slot)
            + 'x' + (s.times === undefined || s.times === null ? '' : s.times)
            // ★ 自定义动作参数不同 = 不同动作，签名必须带上参数袋
            + '|' + (typeof jobCustomIdentity === 'function' ? jobCustomIdentity(s) : '');
    };

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
                payload.push({ kind: 'plant', key: st.key, item: p.item, r: p.r, c: p.c });
            }
        } else {
            const e = { kind: st.kind, key: st.key };
            if (st.ms !== undefined && st.ms !== null) e.ms = st.ms;
            if (st.slot !== undefined && st.slot !== null) e.slot = st.slot;
            if (st.times !== undefined && st.times !== null) e.times = st.times;
            // ★ 自定义动作的 act/from/to/pairs 必须跟着搬 —— 不搬就剥成空壳，
            //   跨链一拖整个动作失效（参数袋全丢）。
            const _ga = jobGenericActionOfKey(st.key);
            if (_ga && _ga.id === 'custom') jobCopyCustomFields(st, e);
            payload.push(e);
        }
    });
    if (!payload.length) return false;

    // ② 棋盘严格对应：植物落点的 mode 全部切到目标链；
    //    顺带迁移「动作后等待」的形态前缀（waitAfter 键 = 形态|槽|r,c|seq）
    let nPlant = 0;
    const wField = jobWaitField();
    const waits = (t && t[wField] && typeof t[wField] === 'object') ? t[wField] : null;
    payload.forEach(function (e) {
        if (e.kind !== 'plant') return;
        e.item.mode = toWhich;
        nPlant++;
        if (waits) {
            const pre = fromWhich + '|' + e.key + '|' + e.r + ',' + e.c + '|';
            Object.keys(waits).forEach(function (wk) {
                if (wk.indexOf(pre) !== 0) return;
                // 只换形态前缀（pre 已含结尾的 |，直接拼尾巴）
                waits[toWhich + wk.slice(fromWhich.length)] = waits[wk];
                delete waits[wk];
            });
        }
    });

    // ③ 源链收尾：重新解析（被搬走的植物已因 mode 变化自动消失），
    //    再把被搬走的通用动作从源链里摘掉（它们的顺序条目还在）
    const genPool = payload.filter(function (e) { return e.kind !== 'plant'; });
    const srcRest = jobResolveSteps(t, fromWhich, board).filter(function (s) {
        if (!s || s.kind === 'plant') return true;
        const sig = genSig(s);
        for (let i = 0; i < genPool.length; i++) {
            if (!genPool[i]._cut && genSig(genPool[i]) === sig) {
                genPool[i]._cut = true;
                return false;
            }
        }
        return true;
    });
    // ★ 存回前把 synthesized 全部固化（摘掉过滤标记）：
    //   否则只搬过段/从未导出过的链里，「棋盘上自动补出来的落点」会在
    //   存盘时被丢掉、重新解析时按「追加到末尾」重排 —— 用户看到的顺序
    //   和存下来的顺序就不一样了（拖放后顺序乱跳）。固化后所见即所得。
    srcRest.forEach(function (s) { if (s) delete s.synthesized; });
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
            inserts.push(st);
        } else {
            // ★ wait 只认 ga:wait —— 自定义动作也带 ms（滑动/长按时长），
            //   按 ms 判型会把自定义滑动错判成「等待」。
            const _ga2 = jobGenericActionOfKey(e.key);
            const st = { kind: (_ga2 && _ga2.id === 'wait') ? 'wait' : 'generic', key: e.key };
            if (e.ms !== undefined) st.ms = e.ms;
            if (e.slot !== undefined) st.slot = e.slot;
            if (e.times !== undefined) st.times = e.times;
            // ★ 自定义动作的参数袋跟着搬（act/from/to/pairs）
            if (_ga2 && _ga2.id === 'custom') jobCopyCustomFields(e, st);
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
let _stepCfgCtx = null;   // { which, st } —— 弹窗服务的那一步

function jobGetSwipeMs() {
    const v = +(jobMeta && jobMeta.swipeMs);
    return (Number.isFinite(v) && v >= 10) ? Math.floor(v) : 80;
}

// 这一步的「调配参数」该显示什么
//   form      = 切换形态 -> 槽位 + 次数
//   wait      = 等待节点 -> 等待毫秒（等待是时长不是动作，不给连击）
//   clickish  = 点击类（点波/捡豆/加速/自定义点击/点击格子）-> 连击次数
//   swipeable = 其余全部（植物/喂豆/铲子/自定义滑动/长按/多指）-> 连击次数 + 默认滑动时长
//   ★ 连击是所有动作通用的（×N = 这个动作连做 N 次）；动作间隔固定 0.1s，不开放调整。
function jobStepCfgKind(st) {
    if (!st) return 'swipeable';
    if (st.kind === 'wait') return 'wait';
    const ga = jobGenericActionOfKey(st.key);
    if (ga) {
        if (ga.id === 'form') return 'form';
        if (ga.id === 'custom') return 'custom';   // 自定义动作：专属参数编辑器（类型/坐标/时长）
        return 'clickish';    // 点波/捡豆/加速 都是单击
    }
    const act = (typeof jobBoardActionOfKey === 'function') ? jobBoardActionOfKey(st.key) : null;
    if (act && act.dslType === 'tap') return 'clickish';
    return 'swipeable';
}

// 把参数写回那一步（按身份定位，st 的引用可能已过期）
//   replaceKeys：先整袋删掉这些键再 assign —— 自定义动作换类型时
//   旧的 from/to/pairs/ms 不能残留（点击换滑动后 pairs 还在就出鬼了）。
function jobStepCfgSave(patch, replaceKeys) {
    const ctx = _stepCfgCtx;
    const t = jobTables[currentTable];
    if (!ctx || !t) return;
    const board = jobCurrentBoard();
    const steps = jobResolveSteps(t, ctx.which, board);
    let i = steps.indexOf(ctx.st);
    if (i === -1) i = jobFindStepByIdentity(steps, ctx.st);
    if (i === -1) return;
    if (Array.isArray(replaceKeys)) {
        replaceKeys.forEach(function (k) { delete steps[i][k]; });
    }
    Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; });
    Object.assign(steps[i], patch);
    _stepCfgCtx.st = steps[i];          // 换成新引用，连续调参不失效
    jobStoreSteps(t, ctx.which, board, steps);
    jobAfterChainChange(t, ctx.which, null);
}

// 二级「调配参数」按步骤类型渲染
function jobRenderStepCfgParams() {
    const box = document.getElementById('scParamsBody');
    if (!box || !_stepCfgCtx) return;
    box.innerHTML = '';
    const kind = jobStepCfgKind(_stepCfgCtx.st);

    const mkRow = function (label, unit) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const lb = document.createElement('span');
        lb.className = 'sc-row-label';
        lb.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'sc-input';
        const un = document.createElement('span');
        un.className = 'sc-unit';
        un.textContent = unit || '';
        row.appendChild(lb); row.appendChild(inp); row.appendChild(un);
        box.appendChild(row);
        return inp;
    };
    const mkTip = function (text) {
        const tip = document.createElement('div');
        tip.className = 'sc-tip';
        tip.textContent = text;
        box.appendChild(tip);
    };
    const bindInt = function (inp, min, max, def, apply, msg) {
        inp.min = String(min); inp.max = String(max); inp.step = '1';
        inp.value = def;
        inp.addEventListener('change', function () {
            let v = parseInt(this.value, 10);
            if (!Number.isFinite(v) || v < min) v = def;
            if (v > max) v = max;
            this.value = v;
            apply(v);
            if (msg) setStatus(msg(v));
        });
    };

    if (kind === 'custom') {
        // ★ 自定义动作：类型/坐标/时长/手指数 全部可改，改完即时覆盖写回这一步
        const host = document.createElement('div');
        box.appendChild(host);
        if (typeof jobRenderCustomCfgInto === 'function') {
            jobRenderCustomCfgInto(host, _stepCfgCtx.st, function (patch) {
                jobStepCfgSave(patch, ['act', 'from', 'to', 'pairs', 'ms']);
            });
        }
        // 连击（所有动作通用）
        const st = _stepCfgCtx.st;
        bindInt(mkRow('连击次数', '次（这个动作连做 N 次）'), 1, 20,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 连击次数 = ' + v; });
        mkTip('类型/坐标/时长改完即时生效（直接覆盖这一步的参数）；连击 1~20，块上显示 ×N。');
    } else if (kind === 'form') {
        const st = _stepCfgCtx.st;
        bindInt(mkRow('槽位', '1-8（点哪个槽的切换形态）'), 1, 8,
            Math.min(8, Math.max(1, Number(st.slot) || 1)),
            function (v) { jobStepCfgSave({ slot: v }); },
            function (v) { return '⚙ 切换形态槽位 = ' + v; });
        bindInt(mkRow('次数', '次（连点几下）'), 1, 20,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 切换形态次数 = ' + v; });
        mkTip('只作用于这一步；块上会显示「槽N 丨 N次」。');
    } else if (kind === 'wait') {
        const st = _stepCfgCtx.st;
        bindInt(mkRow('等待时长', 'ms'), 1, 600000,
            Math.max(1, Number(st.ms) || 1000),
            function (v) { jobStepCfgSave({ ms: v }); },
            function (v) { return '⚙ 等待 = ' + v + 'ms'; });
        mkTip('只作用于这一个等待节点。');
    } else {
        // ★ 连击是所有动作通用的（点击类/滑动类都有）：这个动作连做 N 次
        const st = _stepCfgCtx.st;
        bindInt(mkRow('连击次数', '次（这个动作连做 N 次）'), 1, 20,
            Math.min(20, Math.max(1, Number(st.times) || 1)),
            function (v) { jobStepCfgSave({ times: v }); },
            function (v) { return '⚙ 连击次数 = ' + v; });
        if (kind === 'swipeable') {
            bindInt(mkRow('滑动时长', 'ms（作业集级默认，所有滑动共用）'), 10, 5000, jobGetSwipeMs(),
                function (v) { jobMeta.swipeMs = v; jobSaveLocal(); },
                function (v) { return '⚙ 默认滑动时长 = ' + v + 'ms'; });
            mkTip('连击只作用于这一步，块上显示 ×N；滑动时长是作业集级默认参数；动作间隔固定 0.1s，不可调。');
        } else {
            mkTip('只作用于这一步；块上会显示 ×N。');
        }
    }
}

function jobOpenStepCfg(which, st) {
    const modal = document.getElementById('stepCfgModal');
    if (!modal) return;
    _stepCfgCtx = { which: which, st: st };
    // 回到一级
    const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
    const b = document.getElementById('scBack');
    if (c) c.style.display = '';
    if (p) p.style.display = 'none';
    if (b) b.style.display = 'none';
    modal.classList.add('sc-open');
}

function jobCloseStepCfg() {
    const modal = document.getElementById('stepCfgModal');
    if (modal) modal.classList.remove('sc-open');
    _stepCfgCtx = null;
}

function jobBindStepCfg() {
    const modal = document.getElementById('stepCfgModal');
    if (!modal) return;
    const bind = function (id, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    bind('scClose', jobCloseStepCfg);
    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseStepCfg();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('sc-open')) jobCloseStepCfg();
    });

    // ① 插入等待节点：立刻执行并关窗
    bind('scOptWait', function () {
        const ctx = _stepCfgCtx;
        const t = jobTables[currentTable];
        if (ctx && t) {
            jobInsertWaitAfter(t, ctx.which, jobCurrentBoard(), ctx.st);
        }
        jobCloseStepCfg();
    });

    // ② 调配参数：按步骤类型渲染后切到二级
    bind('scOptParams', function () {
        jobRenderStepCfgParams();
        const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
        const b = document.getElementById('scBack');
        if (c) c.style.display = 'none';
        if (p) p.style.display = '';
        if (b) b.style.display = '';
    });
    bind('scBack', function () {
        const c = document.getElementById('scChoices'), p = document.getElementById('scParams');
        const b = document.getElementById('scBack');
        if (c) c.style.display = '';
        if (p) p.style.display = 'none';
        if (b) b.style.display = 'none';
    });
}

// ★ 删除一步：从链里去掉 **并且** 从棋盘上删掉那一株（用户要求的联动）
function jobDeleteStep(t, which, board, st) {
    if (!st) return;

    if (st.kind === 'plant') {
        const places = jobPlacementsOf(board, st.key, which);
        const p = places[st.gidx];
        if (p) {
            const cell = board[p.r] && board[p.r][p.c];
            if (Array.isArray(cell)) {
                const i = cell.indexOf(p.item);
                if (i !== -1) cell.splice(i, 1);
            }
        }
    }

    // 链里同样去掉这一项：先定位到「刚解析出来的那个步骤」，再按引用删，
    // 这样 11 个一样的捡豆也能只删掉被点的那个。
    const steps = jobResolveSteps(t, which, board);
    let idx = steps.indexOf(st);
    if (idx === -1) {
        const id = jobStepId(st);
        idx = steps.findIndex(function (x) { return jobStepId(x) === id; });
    }
    if (idx !== -1) steps.splice(idx, 1);
    jobStoreSteps(t, which, board, steps);

    jobAfterChainChange(t, which, st.kind === 'plant'
        ? '🗑️ 已从链条和棋盘上移除这一株'
        : '🗑️ 已从链里移除这个动作');
}

// 给一个块接上拖放落点。getTarget() 返回 jobApplyDrop 需要的 target（除 after）
function jobWireDropTarget(el, getTarget) {
    // ★ 把「这个块代表哪一步」钉在元素上：容器级落点（缝里/块外）
    //   需要按指针位置找到最近的块，再拿它的步骤做落点。
    const probe = getTarget();
    if (probe) {
        el.__seqStep = probe.step || null;
        if (probe.key !== undefined) el.dataset.key = probe.key;
        if (probe.which !== undefined) el.dataset.which = probe.which;
    }

    el.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        // ★ 跨链拖拽也放行（boss 棋盘禁止拖入收尾链 —— boss 关没有收尾）
        if (seqDrag.which !== el.dataset.which
            && el.dataset.which === 'end' && jobIsBossBoard()) return;
        // 一律 preventDefault：即使只是擦到块边缘，也别让光标闪成禁止
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        jobMarkDropTarget(el, jobDropBelow(e, el));
        // 不 stopPropagation：让容器层能按「缝里的中线」纠正落点
    });
    el.addEventListener('dragleave', function (e) {
        if (!seqDrag) return;
        if (el.contains(e.relatedTarget)) return;
        el.classList.remove('seq-over-top', 'seq-over-bottom');
    });
    el.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!seqDrag) return;
        if (e.__seqHandled) return;         // 容器层已处理
        e.__seqHandled = true;
        const below = jobDropBelow(e, el);
        const drag = seqDrag;
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();
        const target = getTarget();
        if (!target) return;
        target.after = below;
        // ★ 跨链：改落点形态（棋盘联动）+ 搬顺序条目；同链：原来的排序逻辑
        if (drag.which !== target.which) {
            jobMoveStepsToChain(target.t, target.board, drag,
                target.which, target.step, below);
            return;
        }
        jobApplyDrop(drag, target);
    });
}

// ★ 链容器落点：按指针位置「就近插入」，绝不无脑丢链尾。
//   块之间的缝、块左右没铺满的地方、链尾空白都能正确落点。
function jobWireChainDropZone(listBox, t, board, which) {
    listBox.addEventListener('dragover', function (e) {
        if (!seqDrag) return;
        // ★ 跨链拖拽放行（boss 棋盘禁止拖入收尾链）
        if (seqDrag.which !== which && which === 'end' && jobIsBossBoard()) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        // 指针在某块内部时，块的 dragover 已经画好线了，别覆盖
        if (jobBlockUnderPointer(listBox, e.clientY)) return;
        const near = jobNearestBlockInList(listBox, e.clientY);
        // 空链：整条链高亮「落到底部」（CSS 只给 seq-over-bottom 画了线）
        if (!near) { jobMarkDropTarget(listBox, true); return; }
        jobMarkDropTarget(near.el, near.below);
    });
    listBox.addEventListener('dragleave', function (e) {
        if (!seqDrag) return;
        if (listBox.contains(e.relatedTarget)) return;
        jobClearSeqOver();
    });
    listBox.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!seqDrag) return;
        if (e.__seqHandled) return;
        e.__seqHandled = true;
        const drag = seqDrag;
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();

        // ★ 跨链拖放：改落点形态（棋盘联动）+ 搬顺序条目
        if (drag.which !== which) {
            const xBlock = jobBlockUnderPointer(listBox, e.clientY);
            if (xBlock) {
                jobMoveStepsToChain(t, board, drag, which,
                    xBlock.__seqStep || null, jobDropBelow(e, xBlock));
                return;
            }
            const xNear = jobNearestBlockInList(listBox, e.clientY);
            jobMoveStepsToChain(t, board, drag, which,
                (xNear && xNear.step) || null, !!(xNear && xNear.below));
            return;
        }

        const inBlock = jobBlockUnderPointer(listBox, e.clientY);
        if (inBlock) {
            jobApplyDrop(drag, {
                t: t, which: which, board: board,
                step: inBlock.__seqStep || null,
                after: jobDropBelow(e, inBlock)
            });
            return;
        }
        const near = jobNearestBlockInList(listBox, e.clientY);
        if (near && near.step) {
            jobApplyDrop(drag, {
                t: t, which: which, board: board,
                step: near.step, after: near.below
            });
            return;
        }
        // 真没有块（空链）-> 落到链尾
        jobDropAtChainEnd(t, which, board, drag);
    });
}

// 落到链尾（空链时才用得到）
function jobDropAtChainEnd(t, which, board, drag) {
    jobApplyDrop(drag, { t: t, which: which, board: board, step: null, after: true });
}

function jobRenderSeqChains() {
    const box = document.getElementById('seqChains');
    if (!box) return;
    const t = jobTables[currentTable];
    box.innerHTML = '';
    if (!t) return;

    const board = jobCurrentBoard();
    jobEnsureSeq(board);

    // ★ 全局「已勾选」工具栏：吸附在抽屉视口顶部（不是挂在某条链的最上面），
    //   滚到哪儿都看得见、够得着。含：计数 / 「」无间隔组 / 清空已勾选。
    const selTotal = ['once', 'loop', 'end'].reduce(function (n, w) {
        return n + jobSelectedCount(w);
    }, 0);
    if (selTotal > 0) {
        const bar = document.createElement('div');
        bar.className = 'seq-selbar seq-selbar-sticky';

        const tip = document.createElement('span');
        tip.className = 'seq-selbar-tip';
        tip.textContent = '已勾选 ' + selTotal + ' 项';
        bar.appendChild(tip);

        // 「」无间隔动作组：把勾选的连续步骤组成无间隔组（再点一次解散）
        const nointBtn = document.createElement('button');
        nointBtn.className = 'seq-selbar-noint';
        nointBtn.textContent = '「」 无间隔组';
        nointBtn.title = '勾选 ≥2 个连续普通步骤 -> 成组；勾选组里任意成员 -> 解散该组（其它组不受影响）';
        nointBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            jobToggleNointGroup();
        });
        bar.appendChild(nointBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'seq-selbar-clear';
        clearBtn.textContent = '✕ 清空已勾选';
        clearBtn.title = '取消所有勾选';
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            jobSeqSel = {};
            jobRenderSeqChains();
        });
        bar.appendChild(clearBtn);

        box.appendChild(bar);
    }

    // 三条链：单次 → 循环 → 收尾（按勾选显示）
    ['once', 'loop', 'end'].forEach(function (which) {
        if (jobChainVisible[which] === false) return;
        jobRenderOneChain(box, t, board, which);
    });
    // 同步下拉栏的勾选状态（首次渲染时把默认全勾画出来）
    jobRenderChainFilter();
    // ★ 同步通用动作按钮上的次数角标（链条变了 -> 次数可能变）
    if (typeof jobRefreshGenCounts === 'function') jobRefreshGenCounts();
}

// ★ 把勾选的连续步骤组成「无间隔动作组」（「」块）；已全部成组则解散。
//   数据层：步骤 st.noint = true -> 段 seg.noint = true；
//   compile.py 把**连续** noint 段的动作合进一个「a;b;c」块（BatchSwipe 内部不加间隔）。
function jobToggleNointGroup() {
    const t = jobTables[currentTable];
    if (!t) return;
    const board = jobCurrentBoard();

    // 勾选必须落在**同一条链**
    const hit = ['once', 'loop', 'end'].filter(function (w) { return jobSelectedCount(w) > 0; });
    if (hit.length === 0) { setStatus('⚠️ 先勾选要成组的步骤'); return; }
    if (hit.length > 1) { setStatus('⚠️ 无间隔组只能在一条链内组（勾选跨链了）'); return; }
    const which = hit[0];

    const steps = jobResolveSteps(t, which, board);
    const selIdx = [];
    steps.forEach(function (st, i) { if (jobIsPicked(which, st)) selIdx.push(i); });
    if (!selIdx.length) { setStatus('⚠️ 先勾选要成组/解散的步骤'); return; }

    // ★ 解散模式（勾选里**有**组员就进）：把勾选触及到的每个**完整组**解散 ——
    //   自动向前后扩展到组边界，只清这些组的标记，其它组纹丝不动。
    //   所以「勾组里任意一个成员 -> 点按钮」就能解散那一个组；勾两个组就解散两个。
    if (selIdx.some(function (i) { return steps[i].noint === true; })) {
        selIdx.forEach(function (i) {
            if (steps[i].noint !== true) return;
            let lo = i, hi = i;
            while (lo > 0 && steps[lo - 1].noint === true) lo--;
            while (hi < steps.length - 1 && steps[hi + 1].noint === true) hi++;
            for (let k = lo; k <= hi; k++) delete steps[k].noint;
        });
        jobStoreSteps(t, which, board, steps);
        jobSeqSel = {};
        jobAfterChainChange(t, which, '已解散触及的无间隔组（其余组不受影响）');
        return;
    }

    // —— 成组模式：勾选必须 >=2 且连续 ——
    if (selIdx.length < 2) { setStatus('⚠️ 至少勾选 2 个连续步骤才能成组'); return; }
    // 「」块在 DSL 里必须连续 —— 勾选的步骤必须相邻
    for (let i = 1; i < selIdx.length; i++) {
        if (selIdx[i] !== selIdx[i - 1] + 1) {
            setStatus('⚠️ 只能把**连续**的步骤组成无间隔组（中间有空档）');
            return;
        }
    }

    selIdx.forEach(function (i) { steps[i].noint = true; });
    jobStoreSteps(t, which, board, steps);
    jobSeqSel = {};
    jobAfterChainChange(t, which, '「」已把 ' + selIdx.length + ' 步组成无间隔动作组');
}

// 链显示下拉栏：默认全勾，点一下取消/恢复
function jobRenderChainFilter() {
    const box = document.getElementById('seqChainFilter');
    if (!box) return;
    box.innerHTML = '';
    ['once', 'loop', 'end'].forEach(function (which) {
        const meta = JOB_CHAIN_META[which];
        const lab = document.createElement('label');
        lab.className = 'seq-filter-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = jobChainVisible[which] !== false;
        cb.addEventListener('change', function () {
            jobChainVisible[which] = this.checked;
            jobRenderSeqChains();
        });
        lab.appendChild(cb);
        const sp = document.createElement('span');
        sp.textContent = meta.icon + ' ' + meta.short;
        lab.appendChild(sp);
        box.appendChild(lab);
    });
}

// 渲染一条链（which = 'once' | 'loop' | 'end'）
function jobRenderOneChain(box, t, board, which) {
    const meta = JOB_CHAIN_META[which] || JOB_CHAIN_META.loop;

    // ★★ 唯一真相来源：把「棋盘 + 持久化段」解析成有序步骤列表。
    //    一株一步，严格读取棋盘（棋盘上删掉的落点这里自动消失）。
    const steps = jobResolveSteps(t, which, board);

    // 链头
    const sec = document.createElement('div');
    sec.className = 'seq-section'
        + (which === 'loop' ? ' seq-section-loop' : '')
        + (which === 'end' ? ' seq-section-end' : '');
    const hd = document.createElement('div');
    hd.className = 'seq-section-head';
    hd.textContent = meta.icon + ' ' + meta.label;
    sec.appendChild(hd);

    // （「已勾选 N 项 / 清空」工具栏已上移为抽屉级吸附栏，见 jobRenderSeqChains）
    box.appendChild(sec);

    const listBox = document.createElement('div');
    listBox.className = 'seq-list';
    if (!steps.length) listBox.classList.add('seq-list-empty');
    sec.appendChild(listBox);

    if (!steps.length) {
        // ★ 空链提示放在链容器**里面**：这样整个空链区域（含提示文字）
        //   都是容器级落点 —— 空链也能接住跨链拖过来的块。
        //   （提示在容器外面时，34px 的 min-height 细条才是落点，等于没有。）
        const empty = document.createElement('div');
        empty.className = 'seq-empty';
        empty.textContent = '还没有「' + meta.short.replace('链', '')
            + '」落子。（右键左侧槽位切到该形态，再到棋盘落子；或从别的链拖过来）';
        listBox.appendChild(empty);
    }

    // ★ 容器级落点：缝里 / 块外 / 链尾 / 空链都能正确落点（就近插入）
    jobWireChainDropZone(listBox, t, board, which);

    // 全局种植序号（跨块连续 1..N），供每株的序号角标使用
    const gseq = jobBuildGlobalSeq(board, t, which);

    // ★★ 逐「步骤」渲染 —— 一株一个块，不再有把 21 株塞一起的大块
    steps.forEach(function (st, pos) {
        listBox.appendChild(jobBuildStepBlock(t, board, st, which, pos, steps, gseq));
    });
}

// ============================================================
// ★ 渲染「一个步骤」= 一个块
//   plant   -> 一株（缩略图 + 序号 + 格子坐标 + 勾选 + 删除）
//   generic -> 通用动作（点波/捡豆/加速）
//   wait    -> 等待（可改毫秒）
// 每个块只代表链里的**一项**，拖动/删除都是对着一项操作。
// ============================================================

// 无间隔组「」的首尾判定：组首挂「、组尾挂」，中间成员只留色条
function jobNointMarks(steps, pos) {
    const st = steps && steps[pos];
    if (!st || st.noint !== true) return { first: false, last: false };
    return {
        first: !(pos > 0 && steps[pos - 1] && steps[pos - 1].noint === true),
        last: !(pos < steps.length - 1 && steps[pos + 1] && steps[pos + 1].noint === true),
    };
}

// 把「」角标挂到块头（first -> 最左一个「；last -> 最右一个」）
function jobAppendNointTags(head, nm) {
    if (!nm || (!nm.first && !nm.last)) return;
    if (nm.first) {
        const tag = document.createElement('span');
        tag.className = 'seq-noint-tag';
        tag.textContent = '「';
        tag.title = '无间隔动作组 起点（「」内动作间不加间隔）';
        head.insertBefore(tag, head.firstChild);
    }
    if (nm.last) {
        const tag = document.createElement('span');
        tag.className = 'seq-noint-tag';
        tag.textContent = '」';
        tag.title = '无间隔动作组 终点';
        head.appendChild(tag);
    }
}

function jobBuildStepBlock(t, board, st, which, pos, steps, gseq) {
    if (st.kind === 'generic' || st.kind === 'wait') {
        return jobBuildGenericBlock(t, board, st, which, pos, steps);
    }

    const key = st.key;
    const gIdx = st.gidx;
    // ★ 落子动作（喂豆/铲子/点击格子/扩展…）统一由注册表判定 + 取图标
    const act = (typeof jobBoardActionOfKey === 'function') ? jobBoardActionOfKey(key) : null;
    const isFeed = (key === 'feed');                 // 兼容注册表未加载
    const isShovel = (key === 'shovel');
    const isAction = !!act || isFeed || isShovel;
    const slotNo = isAction ? null : Number(String(key).replace('card', ''));
    // ★ 链芯片上的植物名按链所属棋盘语境取：boss 链显示 boss 有效槽位（逐槽沿用普通关）
    const plantName = slotNo
        ? ((typeof jobSlotNameCtx === 'function')
            ? jobSlotNameCtx(t, slotNo, typeof boardLate !== 'undefined' && board === boardLate)
            : t.slots[slotNo])
        : null;
    const place = jobPlacementsOf(board, key, which)[gIdx];

    const wrap = document.createElement('div');
    const _nm = jobNointMarks(steps, pos);
    wrap.className = 'seq-chain' + ' m-' + which
        + (isAction ? ' seq-chain-compact' : '')
        + (st.noint === true ? ' seq-noint' : '')
        + (_nm.first ? ' seq-noint-first' : '')
        + (_nm.last ? ' seq-noint-last' : '');
    wrap.draggable = true;
    wrap.dataset.key = key;
    wrap.dataset.which = which;
    wrap.dataset.gidx = gIdx;
    wrap.__seqStep = st;

    const head = document.createElement('div');
    head.className = 'seq-chain-head';

    const grip = document.createElement('span');
    grip.className = 'seq-grip';
    grip.textContent = '⠿';
    head.appendChild(grip);

    const ord = document.createElement('span');
    ord.className = 'seq-order';
    ord.textContent = pos + 1;
    head.appendChild(ord);

    // ★ 植物缩略图（保留并放大一点）：用棋盘上那一株自带的 plant.img
    const ico = document.createElement('span');
    ico.className = 'seq-ico';
    if (act) {
        // ★ 落子动作：图标由注册表给（新增动作自动生效）
        jobAppendIconImg(ico, jobBoardActionImg(act), {
            cls: 'seq-ico-img', size: 30, alt: act.name, fallbackText: act.icon || '⚡'
        });
    } else if (isFeed) {
        jobAppendIconImg(ico, JOB_UI_IMG.feed, { cls: 'seq-ico-img', size: 30, alt: '喂豆', fallbackText: '🫘' });
    } else if (isShovel) {
        jobAppendIconImg(ico, JOB_UI_IMG.shovel, { cls: 'seq-ico-img', size: 30, alt: '铲子', fallbackText: '🧤' });
    } else {
        const img = place && place.item && place.item.plant && place.item.plant.img;
        if (img) {
            const im = document.createElement('img');
            im.className = 'seq-thumb-img';
            im.src = img;
            im.alt = plantName || '';
            im.draggable = false;
            im.onerror = function () { this.style.display = 'none'; };
            ico.appendChild(im);
        } else {
            ico.textContent = '🪴';
        }
    }
    head.appendChild(ico);

    const hl = document.createElement('span');
    hl.className = 'seq-slot';
    // ★ 落子动作（喂豆/铲子/点击格子…）直接用注册表里的名字。
    //   以前这里只判 feed/shovel，新动作会掉进 '槽null：null' 分支。
    if (act) {
        hl.textContent = act.name;
    } else if (isFeed) {
        hl.textContent = '喂豆';
    } else if (isShovel) {
        hl.textContent = '铲子';
    } else {
        hl.textContent = '槽' + slotNo + '：' + plantName;
    }
    head.appendChild(hl);

    // ★ 连击标记（所有动作都可以连击：×N，在这块的 ⚙ 步骤设置里调）
    if (Number(st.times) > 1) {
        const badge = document.createElement('span');
        badge.className = 'seq-param-chip seq-param-chip-ro';
        badge.textContent = '×' + st.times;
        badge.title = '连击次数（在这块的 ⚙ 步骤设置里调）';
        head.appendChild(badge);
    }

    // 该株在棋盘上的格子坐标
    if (place) {
        const cellLbl = document.createElement('span');
        cellLbl.className = 'seq-cell';
        cellLbl.textContent = '(' + (place.c + 1) + ',' + (place.r + 1) + ')';
        head.appendChild(cellLbl);
    }

    // 全局种植序号（与棋盘角标一一对应）
    if (place) {
        const _gk = jobPlacementKey(which, key, place.r, place.c, place.item.seq);
        const num = document.createElement('span');
        num.className = 'seq-idx'
            + (which === 'once' ? ' seq-idx-once' : '')
            + (which === 'end' ? ' seq-idx-end' : '');
        num.textContent = (gseq && gseq.get(_gk)) || (pos + 1);
        head.appendChild(num);
    }

    // 勾选框
    head.appendChild(jobBuildPickBox(which, st));

    // ★ 步骤设置（⚙）：弹窗里两个选项 —— 插入等待节点 / 调配参数
    const wbtn = document.createElement('button');
    wbtn.className = 'seq-wbtn';
    wbtn.textContent = '⚙';
    wbtn.title = '步骤设置（插入等待节点 / 调配参数）';
    wbtn.addEventListener('click', function (e) {
        e.stopPropagation();
        jobOpenStepCfg(which, st);
    });
    head.appendChild(wbtn);

    // 删除：从链里去掉这一株 **并且** 从棋盘上删掉它（用户要求同步）
    const del = document.createElement('button');
    del.className = 'seq-chain-del';
    del.textContent = '✕';
    del.title = '从链条和棋盘上都删掉这一株';
    del.addEventListener('click', function (e) {
        e.stopPropagation();
        jobDeleteStep(t, which, board, st);
    });
    head.appendChild(del);

    // 无间隔组「」角标（组首「/组尾」）
    jobAppendNointTags(head, _nm);

    wrap.appendChild(head);

    // 整株拖拽：单拖 = 自己；勾选后拖 = 整组（按链内原顺序）
    wrap.addEventListener('dragstart', function (e) {
        const group = jobDragGroupFor(which, st, board);
        seqDrag = {
            kind: group ? 'group' : 'step',
            which: which, step: st, gidx: gIdx, key: key,
            group: group
        };
        wrap.classList.add('seq-dragging');
        jobMarkDragging(true);
        jobStartAutoScroll();
        try {
            e.dataTransfer.setData('text/plain', group ? 'group' : 'step');
            e.dataTransfer.effectAllowed = 'move';
        } catch (err) { }
        e.stopPropagation();
    });
    wrap.addEventListener('dragend', function () {
        wrap.classList.remove('seq-dragging');
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();
    });
    jobWireDropTarget(wrap, function () {
        return { t: t, which: which, board: board, step: st, after: false };
    });

    return wrap;
}

// 构建一个槽位块（可整块拖动排序）。seg = {key, from, to}
// 通用动作 / 等待块（点波/捡豆/加速/等待）：没有格子，只有一个块
function jobBuildGenericBlock(t, board, st, which, pos, steps) {
    const ga = jobGenericActionOfKey(st.key) || { name: st.key, icon: '⚡' };
    const isWait = (st.kind === 'wait') || (ga.id === 'wait');

    const wrap = document.createElement('div');
    // ★ 通用动作是「一个动作」不是「一组植物」，用紧凑样式，别占整块高度
    const _nm = jobNointMarks(steps, pos);
    wrap.className = 'seq-chain seq-chain-generic seq-chain-compact m-' + which
        + (st.noint === true ? ' seq-noint' : '')
        + (_nm.first ? ' seq-noint-first' : '')
        + (_nm.last ? ' seq-noint-last' : '');
    wrap.draggable = true;
    wrap.dataset.key = st.key;
    wrap.dataset.which = which;
    wrap.dataset.ga = ga.id;
    wrap.__seqStep = st;

    const head = document.createElement('div');
    head.className = 'seq-chain-head';

    const grip = document.createElement('span');
    grip.className = 'seq-grip';
    grip.textContent = '⠿';
    head.appendChild(grip);

    const ord = document.createElement('span');
    ord.className = 'seq-order';
    ord.textContent = pos + 1;
    head.appendChild(ord);

    const ico = document.createElement('span');
    ico.className = 'seq-ico';
    jobAppendIconImg(ico, ga.img, { cls: 'seq-ico-img', size: 28, alt: ga.name, fallbackText: ga.icon || '⚡' });
    head.appendChild(ico);

    const hl = document.createElement('span');
    hl.className = 'seq-slot';
    hl.textContent = ga.name;
    head.appendChild(hl);

    // ★ 自定义动作：名字后面跟一段只读摘要（类型 + 键名 + 时长），
    //   不进 params 内联编辑系统（它是专属弹窗配置的复合参数）。
    if (ga.id === 'custom') {
        const sum = document.createElement('span');
        sum.className = 'seq-custom-summary';
        sum.textContent = jobCustomSummary(st);
        sum.title = sum.textContent;
        head.appendChild(sum);
    }

    // ★ 等待的毫秒数就地可改（这是「等待」这个动作唯一的参数）
    if (isWait) {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'seq-ms';
        inp.min = '1';
        inp.step = '100';
        inp.value = (st.ms === undefined || st.ms === null) ? 1000 : st.ms;
        inp.title = '等待毫秒数';
        inp.draggable = false;
        inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        inp.addEventListener('click', function (e) { e.stopPropagation(); });
        inp.addEventListener('change', function (e) {
            e.stopPropagation();
            const v = parseInt(inp.value, 10);
            const ms = (isFinite(v) && v > 0) ? v : 1000;
            // ★ 必须用「不含参数的身份」定位，不能先改 st.ms 再按 jobStepId 找 ——
            //   因为 jobStepId 含 ms，改了之后 id 就变了，肯定找不到自己。
            const steps = jobResolveSteps(t, which, board);
            const i = jobFindStepByIdentity(steps, st);
            if (i !== -1) {
                steps[i].ms = ms;
                st.ms = ms;
                jobStoreSteps(t, which, board, steps);
                jobSaveLocal();
            }
            jobRenderSeqChains();
        });
        head.appendChild(inp);
        const unit = document.createElement('span');
        unit.className = 'seq-ms-unit';
        unit.textContent = 'ms';
        head.appendChild(unit);
    }

    // ★ 带参数的通用动作（切换形态）：块上只显示一行**可读摘要**（如「槽3 丨 2次」）。
    //   参数统一在块的 ⚙ 弹窗里调 —— 不再内联输入框（块头宽度不够，会挤掉勾选/删除）。
    if (ga && jobActionHasParams(ga)) {
        const chip = document.createElement('span');
        chip.className = 'seq-param-chip seq-param-chip-ro';
        chip.textContent = jobParamsSummary(ga, st);
        chip.title = '参数在这块的 ⚙ 步骤设置里调';
        head.appendChild(chip);
    }

    // ★ 点击类动作的连击标记（点波/捡豆/加速/自定义点击）：times>1 时显示 ×N
    if (ga && !jobActionHasParams(ga) && Number(st.times) > 1) {
        const badge = document.createElement('span');
        badge.className = 'seq-param-chip seq-param-chip-ro';
        badge.textContent = '×' + st.times;
        badge.title = '连击次数（在这块的 ⚙ 步骤设置里调）';
        head.appendChild(badge);
    }

    // 勾选框
    head.appendChild(jobBuildPickBox(which, st));

    // ★ 步骤设置（⚙）：弹窗里两个选项 —— 插入等待节点 / 调配参数
    //   （等待本身是独立的块，可以单独拖走/删掉，不是挂在动作上的属性。）
    const wbtn = document.createElement('button');
    wbtn.className = 'seq-wbtn';
    wbtn.textContent = '⚙';
    wbtn.title = '步骤设置（插入等待节点 / 调配参数）';
    wbtn.addEventListener('click', function (e) {
        e.stopPropagation();
        jobOpenStepCfg(which, st);
    });
    head.appendChild(wbtn);

    // 删除按钮（从链里移除这个动作）
    const del = document.createElement('button');
    del.className = 'seq-chain-del';
    del.textContent = '✕';
    del.title = '从这条链里移除此动作';
    del.addEventListener('click', function (e) {
        e.stopPropagation();
        jobDeleteStep(t, which, board, st);
    });
    head.appendChild(del);

    // 无间隔组「」角标（组首「/组尾」）
    jobAppendNointTags(head, _nm);

    wrap.appendChild(head);

    // 整块拖拽：单拖 = 自己；勾选后拖 = 整组（按链内原顺序）
    wrap.addEventListener('dragstart', function (e) {
        const group = jobDragGroupFor(which, st, board);
        seqDrag = {
            kind: group ? 'group' : 'step',
            which: which, step: st, key: st.key, gidx: -1,
            group: group
        };
        wrap.classList.add('seq-dragging');
        jobMarkDragging(true);
        jobStartAutoScroll();
        try {
            e.dataTransfer.setData('text/plain', group ? 'group' : 'step');
            e.dataTransfer.effectAllowed = 'move';
        } catch (err) { }
        e.stopPropagation();
    });
    wrap.addEventListener('dragend', function () {
        wrap.classList.remove('seq-dragging');
        seqDrag = null;
        jobStopAutoScroll();
        jobMarkDragging(false);
        jobClearSeqOver();
    });
    jobWireDropTarget(wrap, function () {
        return { t: t, which: which, board: board, step: st, key: st.key, after: false };
    });

    return wrap;
}

function jobSlotLabel(t, key) {
    // ★ 落子动作名由注册表给（喂豆/铲子/点击格子/未来扩展）
    if (typeof jobBoardActionOfKey === 'function') {
        const act = jobBoardActionOfKey(key);
        if (act) return act.name;
    }
    if (key === 'feed') return '喂豆';       // 注册表未加载时的兜底
    if (key === 'shovel') return '铲子';
    const s = Number(key.replace('card', ''));
    const _nm = (typeof jobSlotNameCtx === 'function')
        ? jobSlotNameCtx(t, s, (typeof jobIsBossBoard === 'function') && jobIsBossBoard())
        : t.slots[s];
    return '槽' + s + (_nm ? ('（' + _nm + '）') : '');
}

function jobClearSeqOver() {
    document.querySelectorAll('.seq-chain.seq-over-top, .seq-chain.seq-over-bottom').forEach(function (el) {
        el.classList.remove('seq-over-top', 'seq-over-bottom');
    });
}

// ============================================================
// ★ 拖动链条里的块时，靠近抽屉边缘自动滚动
//
// 关键发现（实测）：
//   原生 HTML5 拖拽（draggable=true）期间，浏览器把鼠标独占给拖拽会话 ——
//   wheel / mousemove / dragover **全都可能不派发**，所以「在 dragstart 之后
//   再开始监听鼠标」是拿不到坐标的。
//
//   但 **mousedown 在拖拽开始之前就会触发**。所以：
//     ① 页面级常驻监听 mousedown / mousemove，始终记住最后的鼠标 Y；
//     ② dragstart 只是「打开自动滚动开关」，坐标直接用①记着的值。
//
// ★ 但这样有个坑：拖拽期间收不到新坐标，就一直是「按下时的那个 Y」。
//   只要按下时鼠标恰好在顶部边缘附近，整段拖拽就会**一直向上滚**，
//   表现成「鼠标往上拖就上滑」。用户明确要求改掉这个行为。
//
//   修正：
//     · 边缘区收窄（90px -> 36px），只在真正贴近边缘时才滚；
//     · **必须先动一下**才允许滚（避免刚按下就开始滚）；
//     · 一旦收到过真实的新坐标，就用新坐标（不再用按下时的旧值）；
//     · 拖拽期间没有坐标更新且已经滚过一小段 -> 自动停下，
//       不让「一直滚」变成失控。
// ============================================================
let _dragMouseY = null;
let _autoScrollRAF = 0;
let _autoScrollOn = false;
let _autoScrollStartY = null;    // 拖拽开始时的 Y
let _autoScrollFresh = false;    // 是否收到过拖拽期间的真实坐标
let _autoScrollMoved = false;    // 是否已经滚过（用于「滚一下就好」的限流）
let _autoScrollBudget = 0;       // 还能滚多少帧（防止无坐标时一直滚）

const AUTO_SCROLL_EDGE = 36;     // 距边缘多少像素开始自动滚（原 90 太大，一点就滚）
const AUTO_SCROLL_MAX  = 18;     // 每帧最大滚动像素
const AUTO_SCROLL_STALE_FRAMES = 24;   // 无新坐标时最多滚多少帧（约 0.4 秒）就停

// ① 常驻追踪鼠标 Y（在任何拖拽开始之前就一直在记）
document.addEventListener('mousemove', function (e) {
    if (typeof e.clientY !== 'number') return;
    _dragMouseY = e.clientY;
    if (_autoScrollOn) {
        // 拖拽期间居然收到了 mousemove -> 这是真实坐标，可以放心用
        _autoScrollFresh = true;
        if (Math.abs(e.clientY - (_autoScrollStartY === null ? e.clientY : _autoScrollStartY)) > 6) {
            _autoScrollMoved = true;
        }
    }
}, true);
document.addEventListener('mousedown', function (e) {
    if (typeof e.clientY === 'number') _dragMouseY = e.clientY;
}, true);
// 拖拽期间若浏览器仍派发 dragover，用它刷新（这是最可靠的真实坐标来源）
document.addEventListener('dragover', function (e) {
    if (!_autoScrollOn || typeof e.clientY !== 'number') return;
    _dragMouseY = e.clientY;
    _autoScrollFresh = true;
    if (Math.abs(e.clientY - (_autoScrollStartY === null ? e.clientY : _autoScrollStartY)) > 6) {
        _autoScrollMoved = true;
    }
    _autoScrollBudget = AUTO_SCROLL_STALE_FRAMES;   // 有真实坐标 -> 重新给额度
}, true);

function jobStopAutoScroll() {
    _autoScrollOn = false;
    _autoScrollFresh = false;
    _autoScrollMoved = false;
    _autoScrollStartY = null;
    _autoScrollBudget = 0;
    if (_autoScrollRAF) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = 0; }
}

function jobStartAutoScroll() {
    const drawer = document.getElementById('seqDrawer');
    if (!drawer) return;
    _autoScrollOn = true;
    _autoScrollStartY = _dragMouseY;      // 记住按下时的位置
    _autoScrollMoved = false;
    _autoScrollFresh = false;
    _autoScrollBudget = AUTO_SCROLL_STALE_FRAMES;
    if (_autoScrollRAF) return;              // 已在跑就别重复起循环

    function tick() {
        if (!_autoScrollOn || !seqDrag) { _autoScrollRAF = 0; return; }

        const y = _dragMouseY;
        const r = drawer.getBoundingClientRect();
        let dy = 0;

        // ★ 必须先动一下 —— 否则「刚按下就开始滚」会让人以为一点就滑
        if (y !== null && _autoScrollMoved) {
            if (y < r.top + AUTO_SCROLL_EDGE) {
                const k = Math.min(1, (r.top + AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE);
                dy = -Math.ceil(AUTO_SCROLL_MAX * Math.max(0, k));
            } else if (y > r.bottom - AUTO_SCROLL_EDGE) {
                const k = Math.min(1, (y - (r.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
                dy = Math.ceil(AUTO_SCROLL_MAX * Math.max(0, k));
            }
        }

        // ★ 没有真实新坐标时，最多滚「一小段」就停 —— 这正是
        //   「鼠标往上拖就一直上滑」的元凶：旧代码会拿按下时的旧 Y 无限滚下去。
        if (dy) {
            if (_autoScrollFresh) {
                drawer.scrollTop += dy;
            } else if (_autoScrollBudget > 0) {
                drawer.scrollTop += dy;
                _autoScrollBudget--;
            }
        }
        _autoScrollRAF = requestAnimationFrame(tick);
    }
    _autoScrollRAF = requestAnimationFrame(tick);
}

// 兜底：某些环境下 drag 期间仍会派发 wheel
document.addEventListener('wheel', function (e) {
    if (!seqDrag) return;
    const drawer = document.getElementById('seqDrawer');
    if (!drawer) return;
    const before = drawer.scrollTop;
    drawer.scrollTop = before + (e.deltaY || 0);
    if (drawer.scrollTop !== before) e.preventDefault();
}, { passive: false });

// ---- 右侧抽屉开关 ----
function jobOpenSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    const b = document.getElementById('seqBackdrop');
    const t = document.getElementById('seqToggle');
    if (!d) return;
    jobRenderSeqChains();          // 打开时刷新一次，确保内容最新
    d.classList.add('seq-open');
    if (b) b.classList.add('seq-open');
    if (t) t.classList.add('seq-toggle-hidden');
    d.setAttribute('aria-hidden', 'false');
}

function jobCloseSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    const b = document.getElementById('seqBackdrop');
    const t = document.getElementById('seqToggle');
    if (!d) return;
    d.classList.remove('seq-open');
    if (b) b.classList.remove('seq-open');
    if (t) t.classList.remove('seq-toggle-hidden');
    d.setAttribute('aria-hidden', 'true');
}

function jobToggleSeqDrawer() {
    const d = document.getElementById('seqDrawer');
    if (!d) return;
    if (d.classList.contains('seq-open')) jobCloseSeqDrawer();
    else jobOpenSeqDrawer();
}

function jobInitSeqDrawer() {
    const t = document.getElementById('seqToggle');
    const c = document.getElementById('seqClose');
    const b = document.getElementById('seqBackdrop');
    if (t) t.addEventListener('click', jobOpenSeqDrawer);
    if (c) c.addEventListener('click', jobCloseSeqDrawer);
    if (b) b.addEventListener('click', jobCloseSeqDrawer);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const d = document.getElementById('seqDrawer');
        if (d && d.classList.contains('seq-open')) jobCloseSeqDrawer();
    });
}

function jobRenderSlots() {
    const t = jobTables[currentTable];
    if (!t) return;
    const box = document.getElementById('jobSlots');
    box.innerHTML = '';
    // ★ flex-wrap + 显式 justify-content:flex-start（严格左对齐，防继承）。
    //   固定 4 列网格的方案试过了：列宽太窄、筹码被迫压缩，更怪 —— 已回滚。
    // ★ boss 棋盘 tab 下编辑的是 boss 槽位覆盖层（t.bossSlots，三态）：
    //   沿用（半透明）  -> ✕ = 删除（boss 关不用这个槽）
    //   覆盖（正常色）  -> ✕ = 取消覆盖、回到沿用
    //   已删除（半透明）-> ↩ = 恢复沿用；点槽体 = 选 boss 植物（变成覆盖）
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    // ★ 只循环 8 个植物槽；落子动作（喂豆/铲子/点击格子…）在下面由注册表渲染。
    //   以前这里是 `i <= 9`，第 9 轮拿 t.slots[9]（undefined）当植物渲染，
    //   会多出一个名字是 null 的空槽。
    for (let i = 1; i <= 8; i++) {
        const name = (typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, i, _bossCtx) : (t.slots[i] || '');
        const _st = (_bossCtx && typeof jobBossSlotState === 'function') ? jobBossSlotState(t, i) : null;
        const _inherited = _st === 'inherit';
        const _blocked = _st === 'blocked';
        const info = jobFindPlant(name);
        const chip = document.createElement('div');
        const armed = (jobArmedSlot === i);
        // ★ 一行一个（固定格式）：筹码保持内容自然宽度，每个筹码后面跟一个
        //   强制换行元素（见循环末尾的 brk）-> 永远竖排、靠左，
        //   任何槽删除/改名导致筹码变窄都不会再被 flex-wrap 塞进同一行。
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid '
            + (armed ? '#2d7aff' : '#d0d7de') + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
        if (armed) chip.className = 'job-slot-armed';

        const frame = document.createElement('span');
        frame.style.cssText = 'position:relative;width:30px;height:30px;flex:0 0 30px;background-size:100% 100%;background-repeat:no-repeat;'
            + 'background-image:url(static/card_bg/rare_' + (info ? (info.rare || 0) : 0) + '.webp);';
        if (info && info.img) {
            const im = document.createElement('img');
            im.src = info.img;
            im.alt = name;
            im.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:72%;height:72%;object-fit:contain;';
            im.onerror = function () { this.style.display = 'none'; };
            frame.appendChild(im);
        }
        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px;white-space:nowrap;';
        label.textContent = '槽' + i + ': ' + (_blocked ? '已删除' : (name || '未设置'));
        const edit = document.createElement('span');
        edit.textContent = '✎';
        edit.title = '更换植物';
        edit.style.cssText = 'font-size:12px;color:#2d7aff;padding:0 2px;flex:0 0 auto;';
        edit.addEventListener('click', (e) => { e.stopPropagation(); jobOpenPicker(i); });

        chip.appendChild(frame);
        chip.appendChild(label);
        chip.appendChild(edit);
        // 沿用 / 已删除槽：半透明显示（已删除再加一道红色虚线框区分）
        if (_inherited || _blocked) chip.style.opacity = '0.55';
        if (_blocked) chip.style.borderStyle = 'dashed';

        // 槽位操作按钮（原来右键清空，现在右键让位给「切换形态」）
        //   普通关语境：✕ = 清槽位 + 清两块棋盘该槽落点
        //   boss 语境：沿用槽 ✕ = 删除（不用这个槽）；覆盖槽 ✕ = 取消覆盖回沿用；
        //             已删除槽 ↩ = 恢复沿用
        const clr = document.createElement('span');
        clr.textContent = _blocked ? '↩' : '✕';
        clr.title = !_bossCtx ? '清空该槽位（同时清掉棋盘上该槽的落点）'
            : _inherited ? '删除沿用：boss 关不再使用这个槽（普通关不受影响）'
            : _blocked ? '恢复沿用普通关该槽'
            : '取消 boss 覆盖，回到沿用普通关';
        clr.style.cssText = 'font-size:11px;padding:0 2px;flex:0 0 auto;color:' + (_blocked ? '#2d7aff' : '#ef4444') + ';';
        clr.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_bossCtx) {
                t.bossSlots = t.bossSlots || {};
                if (_inherited) {
                    // 沿用 -> 删除：boss 关不再使用这个槽；boss 棋盘上的该槽落点清掉
                    // （只清 boss 棋盘 —— 普通关该槽的植物和落点都不动）
                    const hadB = name;
                    t.bossSlots[i] = null;
                    if (jobArmedSlot === i) jobArmedSlot = 0;
                    const removedB = jobPurgeSlotOnBoard(boardLate, i);
                    if (removedB) {
                        try { renderAllBoards(); } catch (err) { }
                        try { updatePreview(); } catch (err) { }
                    }
                    jobRenderSlots();
                    jobRenderSeqChains();
                    jobSaveLocal();
                    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                    setStatus('已在 boss 关删除 槽' + i + (hadB ? '（' + hadB + '）' : '')
                        + '，普通关不受影响（点 ↩ 可恢复沿用）'
                        + (removedB ? '；boss 棋盘 ' + removedB + ' 个落点已移除' : ''));
                    return;
                }
                if (_blocked) {
                    // 已删除 -> 恢复沿用（删除标记去掉）
                    delete t.bossSlots[i];
                    jobRenderSlots();
                    jobRenderSeqChains();
                    jobSaveLocal();
                    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                    setStatus('槽' + i + ' 已恢复沿用普通关'
                        + (t.slots[i] ? '「' + t.slots[i] + '」' : ''));
                    return;
                }
                // 覆盖 -> 取消覆盖回沿用；boss 棋盘落点同步回普通关植物
                const hadB = name;
                delete t.bossSlots[i];
                const inh = t.slots[i] || '';
                if (inh) {
                    try { jobSyncSlotPlantOnBoard(boardLate, i, inh); } catch (err) { }
                } else {
                    // 普通关该槽也是空 -> 清掉 boss 棋盘上的孤儿落点
                    jobPurgeSlotOnBoard(boardLate, i);
                }
                if (jobArmedSlot === i) jobArmedSlot = 0;
                try { renderAllBoards(); } catch (err) { }
                try { updatePreview(); } catch (err) { }
                jobRenderSlots();
                jobRenderSeqChains();
                jobSaveLocal();
                if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();
                setStatus('已取消 槽' + i + '（' + hadB + '）的 boss 覆盖'
                    + (inh ? '，回到沿用普通关「' + inh + '」' : ''));
                return;
            }
            const had = t.slots[i];
            t.slots[i] = '';
            if (jobArmedSlot === i) jobArmedSlot = 0;
            // ★ 槽位清空了，棋盘上这个槽的落点也必须清掉 ——
            //   否则会留下「没有槽位却还在棋盘上」的孤儿植物
            //   （和「改槽位不同步」是同一类问题的另一面）。
            const removed = jobPurgeSlotFromBoard(i);
            if (removed) {
                try { renderAllBoards(); } catch (err) { }
                try { updatePreview(); } catch (err) { }
            }
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();   // 局外选卡角标实时刷新
            if (had) setStatus('已清空 槽' + i + '（' + had + '）'
                + (removed ? '，棋盘上 ' + removed + ' 个落点也已移除' : ''));
        });
        chip.appendChild(clr);

        // 形态角标：单次（灰）/ 循环（蓝）（已删除的槽没有形态，不显示）
        const _mode = jobSlotMode(t, jobSlotKeyOf(i));
        if (!_blocked) {
            const mb = document.createElement('span');
            mb.className = 'slot-mode-badge' + (_mode === 'once' ? ' is-once'
                : (_mode === 'end' ? ' is-end' : ' is-loop'));
            mb.style.flex = '0 0 auto';
            mb.textContent = (_mode === 'once') ? '1×' : (_mode === 'end' ? '🚩' : '⟳');
            mb.title = '放置形态：' + jobModeLabel(_mode) + '（右键切换）';
            chip.appendChild(mb);
        }

        chip.title = _blocked
            ? 'boss 关已删除该槽（不沿用普通关）　|　点击选择 boss 植物变成覆盖，或点 ↩ 恢复沿用'
            : name
                ? ('点击选中后在棋盘落子：' + name + (_inherited ? '（沿用普通关）' : '')
                    + '　|　右键切换单次/循环/收尾：' + jobModeLabel(_mode))
                : (_bossCtx ? '点击选择 boss 关植物（覆盖普通关该槽）' : '点击选择植物');
        chip.addEventListener('click', () => {
            if (!name) { jobOpenPicker(i); return; }
            jobArmedSlot = (jobArmedSlot === i) ? 0 : i;
            jobRenderSlots();
            const st = document.getElementById('jobStatus');
            if (st) st.textContent = jobArmedSlot ? ('已选中 槽' + i + '（' + name + '），点击棋盘格子落子') : '';
        });
        // 右键：切换单次 / 循环 / 单次+循环（已删除的槽没有形态可切）
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (_blocked) return;
            const m = jobToggleSlotMode(t, jobSlotKeyOf(i));
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            setStatus('🔄 槽' + i + '（' + (name || '未设置') + '）→ ' + jobModeLabel(m));
        });
        box.appendChild(chip);
        // 强制换行：一行一个槽位，永远竖排（内容再窄也不会两个挤一行）
        const rowBrk = document.createElement('span');
        rowBrk.style.cssText = 'flex-basis:100%;height:0;';
        box.appendChild(rowBrk);
    }

    // ---- ★ 落子动作（喂豆/铲子/点击格子/未来扩展）----
    //   全部由 15-board-actions.js 的注册表驱动：
    //     · builtin:true 的（喂豆/铲子）常驻显示
    //     · inMore:true 的（点击格子…）**在棋盘里**或**正被选中**时才显示
    //   新增一个落子动作**不需要改这段**。
    //
    //   ★ 这里的判定必须和 W/S 的循环判定同源（jobBoardActionCycleable），
    //     否则会出现「面板上看不见、却能按 W/S 选中」的错位。
    //     `isArmed` 单独放行：选中后要留着它，才能继续往棋盘落子。
    //   ★ 换行：与上面 8 个植物槽分开一行。
    const brk = document.createElement('span');
    brk.style.cssText = 'flex-basis:100%;height:0;';
    box.appendChild(brk);

    const _acts = (typeof JOB_BOARD_ACTIONS !== 'undefined') ? JOB_BOARD_ACTIONS : [];
    _acts.forEach(function (act) {
        const isArmed = (jobArmedSlot === act.armedNo);
        // 非内置动作：没落在棋盘上就不占地方（左侧更干净）
        if (!act.builtin && !isArmed && !jobBoardActionHasPlacement(act)) return;

        const el = document.createElement('div');
        el.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff;'
            + 'border:2px solid ' + (isArmed ? '#2d7aff' : (act.color || '#cbd5e1'))
            + ';border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
        if (isArmed) el.className = 'job-slot-armed';

        const dot = document.createElement('span');
        dot.style.cssText = 'font-size:15px;';
        jobAppendIconImg(dot, jobBoardActionImg(act), {
            cls: 'slot-ico-img', size: 44, alt: act.name, fallbackText: act.icon || '⚡'
        });
        el.appendChild(dot);

        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:12px;';
        lbl.textContent = act.name;
        el.appendChild(lbl);

        el.title = (act.desc || '') + '（右键切换单次/循环：'
            + jobModeLabel(jobSlotMode(t, act.id)) + '）';

        el.addEventListener('click', function () {
            jobArmedSlot = isArmed ? 0 : act.armedNo;
            jobRenderSlots();
            setStatus(jobArmedSlot ? ('已选中「' + act.name + '」，点击棋盘格子放置') : '');
        });
        el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            const m = jobToggleSlotMode(t, act.id);
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            setStatus('🔄 ' + act.name + ' → ' + jobModeLabel(m));
        });

        const _m = jobSlotMode(t, act.id);
        const badge = document.createElement('span');
        badge.className = 'slot-mode-badge' + (_m === 'once' ? ' is-once'
            : (_m === 'end' ? ' is-end' : ' is-loop'));
        badge.textContent = (_m === 'once') ? '1×' : (_m === 'end' ? '🚩' : '⟳');
        badge.title = '放置形态：' + jobModeLabel(_m) + '（右键切换）';
        el.appendChild(badge);

        box.appendChild(el);
    });

    // ---- ★「更多」：落子动作的扩展入口 ----
    //   点开弹窗选一个动作，选中后即可在棋盘落子。
    //   弹窗内容同样来自注册表，新增动作自动出现。
    const more = document.createElement('div');
    more.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fafbfc;'
        + 'border:2px dashed #94a3b8;border-radius:8px;padding:3px 7px;cursor:pointer;user-select:none;';
    const mDot = document.createElement('span');
    mDot.style.cssText = 'font-size:15px;color:#64748b;font-weight:700;';
    mDot.textContent = '＋';
    const mLbl = document.createElement('span');
    mLbl.style.cssText = 'font-size:12px;color:#475569;';
    mLbl.textContent = '更多';
    more.appendChild(mDot);
    more.appendChild(mLbl);
    more.title = '更多落子动作（点击选择）';
    more.addEventListener('click', function () {
        if (typeof jobOpenBoardMoreList === 'function') jobOpenBoardMoreList();
    });
    box.appendChild(more);

    // ★ 槽位一有增删覆盖，boss 阵容下拉（沿用/换卡/编队）跟着变 ——
    //   选项集合由「两个棋盘的槽位是否一致」驱动（见 21 的 jobRefreshBossLineupUI）。
    try { if (typeof jobRefreshBossLineupUI === 'function') jobRefreshBossLineupUI(); } catch (e) { }
}

// ============================================================
// 键盘快捷键：W / S 切换槽位，F 切换该槽位的「形态」（也就是所属的链）
//
//   W = 上一个槽，S = 下一个槽
//     顺序：槽1..槽8 → 喂豆 → 铲子 → 回到槽1（循环）
//     ★ 未选中任何槽时，W/S 从「槽1」开始（第一次按 S 选槽1，按 W 选铲子）。
//
//   F = 把当前选中槽位的形态在「单次 → 循环 → 收尾」之间切换。
//     ★ 这和右键点槽位是同一个功能（jobToggleSlotMode）。
//     ★ boss 关**不能**切到收尾 —— 这一点 jobToggleSlotMode 内部已经处理
//       （boss 下只在 once ↔ loop 之间转，end 会归一化回 loop），
//       所以这里不用再判断，直接调用即可。
//
//   注意：在输入框里打字时不响应（否则改毫秒数会误触）。
// ============================================================

// W/S 的循环顺序：1..8（植物）→ 当前**允许循环**的落子动作。
//
//   ★ 由注册表驱动，新增动作自动进循环，本函数不需要改。
//
//   ★★ 关键：扩展动作（inMore）**必须已落在当前关的棋盘上**才进循环
//      （见 jobBoardActionCycleable）。内置动作（喂豆/铲子）永远可循环。
//
//   为什么必须是**函数**而不是常量：棋盘上的落子在编辑过程中随时增减，
//   常量只在脚本加载时算一次，用户「选完更多动作 → 落子」后循环列表不会更新，
//   于是选完之后按 W/S 仍然找不到它（或反过来，把棋盘上的子清掉后仍能循环到）。
//   所以每次按 W/S 都重新计算。
//
//   ★ cur：当前已选中的 armedNo。即使它此刻在棋盘上没有落子，
//     也**必须**留在列表里 —— 否则按 W/S 会「跳过自己」，无法从它切走。
function jobSlotCycleList(cur) {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    if (typeof JOB_BOARD_ACTIONS !== 'undefined') {
        JOB_BOARD_ACTIONS.forEach(function (act) {
            if (!act || typeof act.armedNo !== 'number') return;
            // 内置的（喂豆/铲子）常驻；扩展的只有「在棋盘里」或「正被选中」才进
            if (jobBoardActionCycleable(act) || act.armedNo === cur) a.push(act.armedNo);
        });
    } else {
        a.push(9, 10);   // 注册表没加载时的兜底：喂豆 / 铲子
    }
    a.sort(function (x, y) { return x - y; });
    return a;
}

// ★ 把 jobArmedSlot 的数字编号转成「槽位 key」。
//   注意 jobSlotKeyOf 认的是字符串，而 jobArmedSlot 用 9/10/11 表示落子动作 ——
//   直接传数字会得到 'card9'/'card10'（错的）。所以先查注册表。
function jobSlotKeyOfArmed(s) {
    if (typeof jobBoardActionByArmedNo === 'function') {
        const act = jobBoardActionByArmedNo(s);
        if (act) return act.id;
    }
    return jobSlotKeyOf(s);
}

// 该槽位在界面上显示的名字（用于状态提示）—— 按当前编辑 tab 语境取有效植物
function jobSlotDisplayName(t, s) {
    if (typeof jobBoardActionByArmedNo === 'function') {
        const act = jobBoardActionByArmedNo(s);
        if (act) return act.name;
    }
    const nm = t ? ((typeof jobSlotNameCtx === 'function')
        ? jobSlotNameCtx(t, s, (typeof jobIsBossBoard === 'function') && jobIsBossBoard())
        : (t.slots ? (t.slots[s] || '') : '')) : '';
    return '槽' + s + (nm ? '（' + nm + '）' : '（未设置）');
}

// ============================================================
// ★ 棋盘落子区的「更多」—— 动作列表弹窗
//
//   与右侧通用动作的「更多」(#moreList) 是**两套**：
//     · 右侧 #moreList     -> 往**链上**插通用动作（无格子）
//     · 这里 #boardMoreList -> 选一个**落子动作**，选中后在棋盘上摆
//
//   ★ 列表内容来自 15-board-actions.js 的注册表（JOB_BOARD_ACTIONS 里
//     inMore:true 的那些）—— 新增落子动作**不需要改本文件**。
// ============================================================

function jobOpenBoardMoreList() {
    const modal = document.getElementById('boardMoreList');
    if (!modal) return;
    jobRenderBoardMoreList();
    modal.classList.add('bml-open');
}

function jobCloseBoardMoreList() {
    const modal = document.getElementById('boardMoreList');
    if (modal) modal.classList.remove('bml-open');
}

function jobRenderBoardMoreList() {
    const box = document.getElementById('bmlBody');
    if (!box) return;
    box.innerHTML = '';

    const list = (typeof jobBoardMoreActions === 'function')
        ? jobBoardMoreActions() : [];

    if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'bml-empty';
        hint.textContent = '（暂无更多落子动作）';
        box.appendChild(hint);
        return;
    }

    const t = jobTables[currentTable];
    const boss = jobIsBossBoard();

    list.forEach(function (act) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bml-item';

        const ico = document.createElement('span');
        ico.className = 'bml-ico';
        jobAppendIconImg(ico, jobBoardActionImg(act), {
            cls: 'bml-ico-img', size: 24, alt: act.name, fallbackText: act.icon || '⚡'
        });
        btn.appendChild(ico);

        const txt = document.createElement('div');
        txt.className = 'bml-txt';
        const nm = document.createElement('div');
        nm.className = 'bml-name';
        nm.textContent = act.name;
        txt.appendChild(nm);
        if (act.desc) {
            const ds = document.createElement('div');
            ds.className = 'bml-desc';
            ds.textContent = act.desc;
            txt.appendChild(ds);
        }
        btn.appendChild(txt);

        // 角标：当前形态 + 已落几个
        if (t) {
            const badge = document.createElement('span');
            badge.className = 'bml-badge';
            const m = jobSlotMode(t, act.id);
            const n = jobPlacementCountAllModes(act.id, boss);
            badge.textContent = jobModeLabel(m) + (n ? ' · ' + n + ' 个' : '');
            btn.appendChild(badge);
        }

        btn.addEventListener('click', function () {
            jobCloseBoardMoreList();
            jobArmedSlot = act.armedNo;
            jobRenderSlots();
            setStatus('已选中「' + act.name + '」，点击棋盘格子放置');
        });

        btn.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            const m = jobToggleSlotMode(t, act.id);
            jobRenderSlots();
            jobRenderSeqChains();
            jobSaveLocal();
            jobRenderBoardMoreList();
            setStatus('🔄 ' + act.name + ' → ' + jobModeLabel(m));
        });

        box.appendChild(btn);
    });
}

let jobBoardMoreBound = false;

function jobBindBoardMore() {
    if (jobBoardMoreBound) return;
    const modal = document.getElementById('boardMoreList');
    if (!modal) return;

    const close = document.getElementById('bmlClose');
    if (close) close.addEventListener('click', jobCloseBoardMoreList);

    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseBoardMoreList();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseBoardMoreList();
    });

    jobBoardMoreBound = true;
}

// 切换选中的槽位：dir = +1 下一个（S），-1 上一个（W）
//
//   ★ 循环列表每次现算（jobSlotCycleList），所以「棋盘上有没有落子」
//     的变化立刻生效 —— 扩展动作没落在棋盘上时**不会被循环到**。
function jobCycleSlot(dir) {
    const t = jobTables[currentTable];
    if (!t) return;

    const list = jobSlotCycleList(jobArmedSlot);
    const n = list.length;
    if (!n) return;

    let i = list.indexOf(jobArmedSlot);
    // 当前没选中（0）时给一个合理起点：
    //   按 S（下一个）→ 从槽1 开始；按 W（上一个）→ 从列表末位 开始
    if (i === -1) i = (dir > 0) ? -1 : 0;

    const next = list[((i + dir) % n + n) % n];
    jobArmedSlot = next;
    jobRenderSlots();

    const st = document.getElementById('jobStatus');
    if (st) {
        st.textContent = '已选中 ' + jobSlotDisplayName(t, next)
            + '　|　点击棋盘格子落子　|　F 切换形态：'
            + jobModeLabel(jobSlotMode(t, jobSlotKeyOfArmed(next)));
    }
}

// 切换当前选中槽位的形态（= 右键那个功能）
function jobCycleSlotOrChain() {
    const t = jobTables[currentTable];
    if (!t) return;

    if (!jobArmedSlot) {
        setStatus('先用 W / S 选一个槽位，再按 F 切换形态');
        return;
    }

    const key = jobSlotKeyOfArmed(jobArmedSlot);
    const m = jobToggleSlotMode(t, key);
    jobRenderSlots();
    jobRenderSeqChains();
    jobSaveLocal();

    const extra = jobIsBossBoard() ? '（boss 关没有收尾）' : '';
    setStatus('🔄 ' + jobSlotDisplayName(t, jobArmedSlot) + ' → ' + jobModeLabel(m) + extra);
}

// 判断事件是否发生在可输入元素里（那里不能抢键）
function jobIsTypingTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
}

function jobInstallSlotHotkeys() {
    document.addEventListener('keydown', function (e) {
        // 带修饰键的不抢（Ctrl+F 之类留给浏览器）
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // 正在输入框里打字 -> 不响应
        if (jobIsTypingTarget(e.target)) return;
        // 有弹层打开时 -> 不响应，避免和弹窗里的操作冲突
        try {
            const open = document.querySelector('#plantPicker.job-open')
                || document.querySelector('#supplyPicker.sp-open')
                || document.querySelector('#genPicker.gp-open')
                || document.querySelector('#customPicker.cp-open')
                || document.querySelector('#stepCfgModal.sc-open')
                || document.querySelector('#jobPickModal.jp-open')
                || document.querySelector('#tableCopyModal.jp-open');
            if (open) return;
        } catch (err) { }

        const k = String(e.key || '').toLowerCase();
        if (k === 'w') { e.preventDefault(); jobCycleSlot(-1); }
        else if (k === 's') { e.preventDefault(); jobCycleSlot(1); }
        else if (k === 'f') { e.preventDefault(); jobCycleSlotOrChain(); }
        // Q/E 循环切换阵容表（上面的守卫已挡掉输入框/弹层场景）
        else if (k === 'q') { e.preventDefault(); jobCycleTable(-1); }
        else if (k === 'e') { e.preventDefault(); jobCycleTable(1); }
    });
}

// ---- 植物选择器 ----
async function jobLoadPlants() {
    if (plantCache) return plantCache;
    try {
        const res = await fetch('/plants');
        const data = await res.json();
        plantCache = Array.isArray(data.plants) ? data.plants : [];
    } catch (e) {
        plantCache = [];
    }
    return plantCache;
}

// ---- 植物图片资源可用性（字段由后端 /plants 扫 plant_ref_card 实况注入）----
//   p.has_img: bool                        p.super: 'none' | 'missing' | 'collected'
//   p.super_count: 超装资源个数（皮肤夹 png 数 - 1，第 1 张是基础卡）
// 字段缺失（旧缓存 / 接口异常）时当作「有图」，避免误伤全部植物。
function jobPlantAvail(p) {
    if (!p || p.has_img === undefined || p.has_img === null) return { hasImg: true, sup: 'none', supCount: 0 };
    // super_count 是后加的字段，旧缓存没有 -> collected 至少算 1 个
    const cnt = (typeof p.super_count === 'number') ? p.super_count
        : (p.super === 'collected' ? 1 : 0);
    return { hasImg: !!p.has_img, sup: p.super || 'none', supCount: cnt };
}

// 选择器卡片的悬停提示（走 02-tooltip.js 的 data-tooltip，1 秒延迟，支持多行）
function jobPlantCardTip(p, dupSlot, selSlot) {
    const av = jobPlantAvail(p);
    const lines = [];
    if (dupSlot) {
        lines.push(p.name + '（已被 槽' + dupSlot + ' 使用，不能重复选择）');
    } else if (selSlot) {
        // 正在编辑的槽自己选中的植物（可重选，等于不换）
        lines.push(p.name + '（当前 槽' + selSlot + ' 已选）');
    } else {
        lines.push(p.name + '（' + (p.rarity || '?') + '卡）');
    }
    if (!av.hasImg) lines.push('⛔ 没有这个植物的图片资源');
    else if (av.sup === 'collected') lines.push('✅ 有 ' + av.supCount + ' 个超装资源');
    else if (av.sup === 'missing') lines.push('⚠️ 该植物有超装但未收集（皮肤夹里只有基础卡）');
    else lines.push('（该植物无超装）');
    lines.push('右键' + (jobIsFav(p) ? '取消收藏' : '收藏'));
    return lines.join('\n');
}

function jobOpenPicker(slot) {
    currentSlotEditing = slot;
    const modal = document.getElementById('plantPicker');
    document.getElementById('plantSearch').value = '';
    plantPickIndex = 0;
    jobRenderRarityFilter();
    jobRenderPlantGrid();
    // 入场动画：先加类再显示（重排一次确保动画重新触发）
    modal.classList.remove('job-open');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('job-open');
}

function jobClosePicker() {
    const modal = document.getElementById('plantPicker');
    modal.classList.remove('job-open');
    modal.style.display = 'none';
    jobHideCellDetail();
}

// ---- 卡槽品质过滤（rare_0=白 1=绿 2=蓝 3=紫 4=橙）----
const PLANT_RARITY_TABS = ['全部', '收藏', '橙', '紫', '蓝', '绿', '白'];
const RARITY_TO_RARE = { '橙': 4, '紫': 3, '蓝': 2, '绿': 1, '白': 0 };
let plantRarityFilter = '全部';
let plantPickList = [];     // 当前筛选后的植物列表（供 W/S 切换）
let plantPickIndex = 0;    // 当前高亮项
let plantPickAvailable = [];   // 当前可选项索引（排除已被其它槽位占用的植物）

// ---- 右键收藏（存 localStorage，刷新不丢）----
const PLANT_FAV_KEY = 'maapvz_plant_favs_v1';
let plantFavs = new Set();

function jobLoadFavs() {
    try {
        const raw = localStorage.getItem(PLANT_FAV_KEY);
        if (raw) plantFavs = new Set(JSON.parse(raw));
    } catch (e) { plantFavs = new Set(); }
}

function jobSaveFavs() {
    try { localStorage.setItem(PLANT_FAV_KEY, JSON.stringify(Array.from(plantFavs))); } catch (e) {}
}

// 以英文名为主键（中文名可能重名/改写），无英文名时退回中文名
function jobFavKey(p) { return p.en || p.name; }
function jobIsFav(p) { return plantFavs.has(jobFavKey(p)); }

function jobToggleFav(p) {
    const k = jobFavKey(p);
    const nowFav = !plantFavs.has(k);
    if (nowFav) plantFavs.add(k);
    else plantFavs.delete(k);
    jobSaveFavs();
    setStatus(nowFav ? ('♥ 已收藏「' + p.name + '」') : ('已取消收藏「' + p.name + '」'));
    // 只更新这一张卡的心形，不整页重渲染（避免闪一下 + 入场动画重播）
    jobRefreshFavMark(p, nowFav);
    return nowFav;
}

// 就地切换某张卡的收藏标记：不动其它 DOM，无闪烁
function jobRefreshFavMark(p, isFav) {
    const grid = document.getElementById('plantGrid');
    if (!grid) return;
    const idx = (plantPickList || []).indexOf(p);
    if (idx < 0) return;
    const card = grid.children[idx];
    if (!card) return;
    const frame = card.firstElementChild;
    if (!frame) return;
    const old = frame.querySelector('.job-fav-heart');
    if (isFav && !old) {
        frame.appendChild(jobBuildHeart());
    } else if (!isFav && old) {
        old.remove();
    }
    card.setAttribute('data-tooltip', jobPlantCardTip(p, 0));
}

// 卡槽下边框中央的心形（宽度约占卡片 1/4，压在下边框上）
function jobBuildHeart() {
    const heart = document.createElement('span');
    heart.className = 'job-fav-heart';
    heart.textContent = '♥';
    return heart;
}


function jobRenderRarityFilter() {
    const box = document.getElementById('plantRarityFilter');
    if (!box) return;
    box.innerHTML = '';
    PLANT_RARITY_TABS.forEach(r => {
        const el = document.createElement('span');
        const active = (plantRarityFilter === r);
        el.textContent = r;
        el.style.cssText = 'padding:2px 12px;border-radius:999px;font-size:12px;cursor:pointer;user-select:none;'
            + 'border:1px solid ' + (active ? '#2d7aff' : '#d0d7de') + ';'
            + 'background:' + (active ? '#2d7aff' : '#fff') + ';'
            + 'color:' + (active ? '#fff' : '#333') + ';';
        el.addEventListener('click', () => {
            plantRarityFilter = r;
            jobRenderRarityFilter();
            jobRenderPlantGrid();
        });
        box.appendChild(el);
    });
}

function jobMovePick(delta) {
    const pool = (plantPickAvailable && plantPickAvailable.length) ? plantPickAvailable : null;
    if (pool) {
        let pos = pool.indexOf(plantPickIndex);
        if (pos === -1) pos = 0;
        pos = ((pos + delta) % pool.length + pool.length) % pool.length;
        plantPickIndex = pool[pos];
    } else {
        if (!plantPickList || !plantPickList.length) return;
        plantPickIndex = (plantPickIndex + delta % plantPickList.length + plantPickList.length) % plantPickList.length;
    }
    jobRenderPlantGrid();
    const grid = document.getElementById('plantGrid');
    const el = grid && grid.children[plantPickIndex];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function jobSlotOfPlant(name, excludeSlot) {
    const t = jobTables[currentTable];
    if (!t || !name) return 0;
    // ★ 查重按当前语境（普通/boss）的有效槽位：boss 覆盖槽与普通槽是两份独立配置
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    for (let s = 1; s <= 8; s++) {
        if (s === excludeSlot) continue;
        const nm = (typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, s, _bossCtx) : t.slots[s];
        if (nm === name) return s;
    }
    return 0;
}

function jobConfirmPick() {
    const p = plantPickList && plantPickList[plantPickIndex];
    if (!p) return;
    // 无图植物禁选（键盘回车路径也走这里）
    if (!jobPlantAvail(p).hasImg) {
        setStatus('⛔「' + p.name + '」没有图片资源，无法选择');
        return;
    }
    const dup = jobSlotOfPlant(p.name, currentSlotEditing);
    if (dup) {
        setStatus('⚠️「' + p.name + '」已被 槽' + dup + ' 使用，同一植物不能重复选择');
        return;
    }
    const t = jobTables[currentTable];
    const _bossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    const oldName = t ? ((typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(t, currentSlotEditing, _bossCtx) : t.slots[currentSlotEditing]) : '';
    if (t) {
        if (_bossCtx) {
            // ★ boss 语境：写的是 boss 槽位覆盖层（不动普通关槽位）
            t.bossSlots = t.bossSlots || {};
            t.bossSlots[currentSlotEditing] = p.name;
        } else {
            t.slots[currentSlotEditing] = p.name;
        }
    }

    // ★ 关键：把棋盘上该槽已有的落点同步成新植物。
    //   落点里存的是「下子那一刻的植物快照」，不跟着槽位走 ——
    //   不同步的话，改了槽位棋盘却还是旧植物（看起来像能放好几种植物）。
    //   boss 语境只同步 boss 棋盘（boardLate）—— 普通棋盘的该槽仍用普通关植物。
    const synced = _bossCtx
        ? (function () { try { return jobSyncSlotPlantOnBoard(boardLate, currentSlotEditing, p.name); } catch (e) { return false; } })()
        : jobSyncSlotPlantEverywhere(currentSlotEditing, p.name);
    if (synced) {
        try { renderAllBoards(); } catch (e) { }
        try { updatePreview(); } catch (e) { }
    }

    jobArmedSlot = currentSlotEditing;   // 选完自动进入落子状态
    jobClosePicker();
    jobRenderSlots();
    jobRenderSeqChains();
    jobSaveLocal();
    if (typeof jobOuterRefreshBadge === 'function') jobOuterRefreshBadge();   // 局外选卡角标实时刷新（锁定集合变了）
    const st = document.getElementById('jobStatus');
    if (st) {
        st.textContent = '已选中 槽' + currentSlotEditing + '（' + p.name + '）'
            + (_bossCtx ? '（boss 关覆盖）' : '') + '，点击棋盘格子落子'
            + (synced && oldName ? '　|　棋盘上的该槽已同步改为「' + p.name + '」' : '');
    }
}

function jobRenderPlantGrid() {
    const kw = document.getElementById('plantSearch').value.trim().toLowerCase();
    const grid = document.getElementById('plantGrid');
    const countEl = document.getElementById('plantPickerCount');
    grid.innerHTML = '';
    const plantList = plantCache || [];
    const list = plantList.filter(p => {
        const hitKw = !kw
            || (p.name || '').toLowerCase().includes(kw)
            || (p.en || '').toLowerCase().includes(kw);
        const hitRarity = (plantRarityFilter === '全部') || (p.rarity === plantRarityFilter)
            || (plantRarityFilter === '收藏' && jobIsFav(p));
        return hitKw && hitRarity;
    });
    // 收藏项排最前（同组内保持原顺序）
    list.sort(function (a, b) {
        const fa = jobIsFav(a) ? 0 : 1, fb = jobIsFav(b) ? 0 : 1;
        return fa - fb;
    });
    plantPickList = list;
    // 1~8 槽不允许重复：算出已被其它槽位占用的植物（按当前语境的有效槽位）
    const _t = jobTables[currentTable];
    const _pkBossCtx = (typeof jobIsBossBoard === 'function') && jobIsBossBoard();
    const usedBy = {};
    // ★ 已选集合（含正在编辑的槽位）：用于蓝框标注「这个植物已在槽位里」，
    //   与 usedBy 的区别是 usedBy 排除了正在编辑的槽（那个允许重选）。
    const selectedBy = {};
    for (let s = 1; s <= 8; s++) {
        const nm0 = _t && ((typeof jobSlotNameCtx === 'function') ? jobSlotNameCtx(_t, s, _pkBossCtx) : _t.slots[s]);
        if (nm0 && !selectedBy[nm0]) selectedBy[nm0] = s;
        if (s === currentSlotEditing) continue;
        if (nm0) usedBy[nm0] = s;
    }
    plantPickAvailable = [];
    let _noImgCnt = 0;
    list.forEach((pl, i) => {
        const av = jobPlantAvail(pl);
        if (!av.hasImg) _noImgCnt++;
        if (!usedBy[pl.name] && av.hasImg) plantPickAvailable.push(i);
    });
    if (plantPickAvailable.length && plantPickAvailable.indexOf(plantPickIndex) === -1) {
        plantPickIndex = plantPickAvailable[0];
    } else if (!plantPickAvailable.length && list.length) {
        plantPickIndex = 0;
    }
    const _usedCnt = list.length - plantPickAvailable.length - _noImgCnt;
    if (countEl) countEl.textContent = '共 ' + list.length + ' 种'
        + (_usedCnt ? '（' + _usedCnt + ' 种已被其它槽位占用）' : '')
        + (_noImgCnt ? '（' + _noImgCnt + ' 种无图不可选）' : '')
        + (plantPickAvailable.length ? '（W/S 或 ↑↓ 切换，A/D 跳 5 个，回车确认）' : '');
    if (!list.length) {
        grid.innerHTML = '<span style="grid-column:1/-1;color:#888;padding:20px;">没有匹配的植物</span>';
        return;
    }
    list.forEach((p, idx) => {
        const dupSlot = usedBy[p.name] || 0;        // 被【其它】槽占用 -> 禁选
        const selSlot = selectedBy[p.name] || 0;    // 已被某槽选用（含正在编辑的槽）-> 蓝框
        const av = jobPlantAvail(p);
        const noImg = !av.hasImg;
        const blocked = dupSlot || noImg;
        const cell = document.createElement('div');
        cell.className = 'job-card';
        cell.style.animationDelay = Math.min(idx, 20) * 9 + 'ms';   // 错峰入场（不超过 20 项）
        // ★ 三种视觉状态要一眼分清：
        //   无图不可选 = 灰化 + 左上角 ✕（opacity 0.38）
        //   已被槽位选用 = 蓝框 + 蓝色「槽N」角标（不灰化！被其它槽占用的仍禁选但保持彩色）
        //   键盘焦点 = 蓝色外描边（outline）
        cell.style.cssText += 'display:flex;flex-direction:column;align-items:center;gap:3px;border-radius:10px;'
            + (noImg ? 'cursor:not-allowed;opacity:0.38;'
                : dupSlot ? 'cursor:not-allowed;' : 'cursor:pointer;')
            + (selSlot && !noImg ? 'box-shadow:inset 0 0 0 3px #2d7aff;background:#eff6ff;' : '')
            + (!blocked && idx === plantPickIndex ? 'outline:3px solid #2d7aff;outline-offset:2px;' : '');
        // 悬停提示走自定义 tooltip 系统（1 秒延迟），不用原生 title（会双层提示）
        cell.setAttribute('data-tooltip', jobPlantCardTip(p, dupSlot, selSlot));
        cell.setAttribute('data-tooltip-delay', '1000');

        // 品质底图铺底（网页端铺，不改图）
        const rare = (typeof p.rare === 'number') ? p.rare : (RARITY_TO_RARE[p.rarity] || 0);
        const frame = document.createElement('div');
        frame.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;'   // PVZ2 卡槽比例
            + 'background:url(static/card_bg/rare_' + rare + '.webp) center/100% 100% no-repeat;';

        const img = document.createElement('img');
        img.src = p.img || '';
        img.alt = p.name;
        img.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:86%;width:86%;object-fit:contain;';
        img.onerror = function () { this.style.display = 'none'; };
        frame.appendChild(img);
        if (noImg) {
            // 无图植物：灰化 + 左上角叉叉（通用标记，见 02-tooltip.js），禁选
            frame.style.filter = 'grayscale(1)';
            jobCardXMark(frame);
        } else if (selSlot) {
            // 已被槽位选用：蓝框（在 cell 上）+ 右上角蓝色「槽N」角标，不灰化
            const badge = document.createElement('span');
            badge.textContent = '槽' + selSlot;
            badge.style.cssText = 'position:absolute;right:2px;top:2px;background:#2d7aff;color:#fff;font-size:9px;line-height:14px;border-radius:4px;padding:0 4px;z-index:2;';
            frame.appendChild(badge);
        }
        // ⚠️ 只有 missing 才警告：有皮肤夹但里面只有 1 张基础卡
        //   = 游戏内该植物带超装、但超装图没收集，戴超装上场会识别不到。
        //   none（无皮肤夹、单张平铺 png）= 本身就不带超装的植物，不警告。
        if (!noImg && av.sup === 'missing') {
            const warn = document.createElement('span');
            warn.textContent = '⚠️';
            warn.style.cssText = 'position:absolute;left:2px;top:2px;font-size:22px;line-height:24px;z-index:2;'
                + 'filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));';
            frame.appendChild(warn);
        }
        // ♥ 收藏标记（下边框中央，被边框"咬断"）
        if (jobIsFav(p)) {
            frame.appendChild(jobBuildHeart());
        }

        const nm = document.createElement('span');
        nm.textContent = p.name;
        nm.style.cssText = 'font-size:12px;text-align:center;line-height:1.2;';

        cell.appendChild(frame);
        cell.appendChild(nm);
        cell.addEventListener('click', () => {
            if (noImg) {
                setStatus('⛔「' + p.name + '」没有图片资源，无法选择');
                return;
            }
            plantPickIndex = idx;
            jobConfirmPick();
        });
        // 右键收藏 / 取消收藏
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            jobToggleFav(p);
        });
        grid.appendChild(cell);
    });
}

// 导出种植顺序：**以链条（slotOrder / loopOrder）为唯一权威**。
//
// 旧版实现（已废弃）按「槽号 + 槽内 seq」排序，会把物理落子顺序彻底打乱：
// 它先排槽1 全部、再排槽2 全部、最后把 feed/shovel 扔到末尾，
// 于是「铲→种菇→喂豆」会被导成「种菇×N → 铲×N → 喂豆×N」。
// 而 item.seq 只是**槽内**序号，跨槽没有可比性。
//
// 正确做法：复用链解析（jobGetChainOrder + jobSegPlacements）——链条里段的先后
// 就是执行先后，同一槽可被拆成多段穿插（种槽1 → 喂豆 → 再种槽1）。
function jobBuildChain(t, board, which, forceBoss) {
    const out = [];
    if (!t || !board) return out;
    jobEnsureSeq(board);
    // ★ 传入 board：让 jobGetChainOrder 的覆盖率修复用**正确的棋盘**
    //   （导出 boss 链时要用 bossBoard，不能靠 tab 猜）
    // ★ forceBoss：导出 boss 链必须显式传 true —— bossBoard 取的是
    //   t.boardLate（表自己的 boss 棋盘），它的引用不等于全局 boardLate
    //   （全局那份是当前编辑表的拷贝），靠 === 判断会误判成普通关，
    //   结果读了 t.loopOrder，把普通关的通用动作串进 boss 关。
    const segs = jobGetChainOrder(t, which, board, forceBoss);

    // ★ 防御：孤立 noint 段不进「」（无间隔组至少 2 步，相邻同标记才算同组）
    for (let _i = 0; _i < segs.length; _i++) {
        const _s = segs[_i];
        if (!_s || _s.noint !== true) continue;
        const _p = segs[_i - 1], _n = segs[_i + 1];
        if (!((_p && _p.noint === true) || (_n && _n.noint === true))) delete _s.noint;
    }

    segs.forEach(function (seg) {
        // ★ 通用动作段（点波/捡豆/加速/等待）：没有格子，直接按"动作"导出
        const ga = jobGenericActionOfKey(seg.key);
        if (ga) {
            const item = {
                key: seg.key,           // 'ga:wave' 等
                slot: null,
                type: 'action',         // 通用动作
                action: ga.id,          // wave | bean | speed | wait
                label: ga.name,         // 点波 / 捡豆 / 加速 / 等待
                mode: (which === 'loop') ? 'loop' : (which === 'end' ? 'end' : 'once'),
                cells: []               // 无落点
            };
            // ★ 等待必须带上毫秒数 —— agent 端用 generic_dsl(action, coords, ms)
            //   编译成 sleep:N，没有 ms 就退化成默认值，作者设的时长会丢。
            if (ga.hasMs) {
                item.ms = (seg.ms === undefined || seg.ms === null)
                    ? (ga.defaultMs || 1000) : Number(seg.ms);
            }
            // ★ 带参数的通用动作：把声明的参数逐个带上（声明式 ——
            //   动作定义里加一个参数，这里自动导出，不需要改这段）。
            //   agent 端 dsl.generic_dsl 用它们编译出实际的 DSL。
            jobActionParams(ga).forEach(function (p) {
                const v = jobParamValue(seg, p);
                if (v !== undefined && v !== null) item[p.key] = v;
            });
            // ★ 自定义动作：不走 params 声明，act/from/to/pairs/ms 整袋带上
            //   （agent 端 generic_dsl 的 'custom' 分支按 act 编译）。
            if (ga.id === 'custom') {
                jobCopyCustomFields(seg, item);
                if (seg.ms !== undefined && seg.ms !== null) item.ms = Number(seg.ms);
            }
            // ★ 无间隔组「」标记：compile.py 把连续 noint 段合进一个「」块
            if (seg.noint === true) item.noint = true;
            // ★ 点击类动作的连击次数（点波/捡豆/加速/自定义点击；切换形态走 params 已带）
            if (item.times === undefined && Number(seg.times) > 1) item.times = Number(seg.times);
            out.push(item);
            return;
        }
        // 该段实际包含的落点（已按 seq 排序，且同一槽内保持落子先后）
        const places = jobSegPlacements(board, seg, which);
        if (!places.length) return;
        // 该段是「单次」还是「循环」或「收尾」形态的落子 —— 由 which 决定
        const mode = (which === 'loop') ? 'loop' : (which === 'end' ? 'end' : 'once');
        const m = /^card(\d+)$/.exec(seg.key);
        const slot = m ? Number(m[1]) : null;

        // 植物槽要带上「这一段用的是哪个植物」（槽位植物表 + 段所属形态）
        //   ★ boss 链按 boss 有效槽位取名（逐槽沿用普通关），agent 日志里看到的才是实际选的卡
        let label = seg.key;
        if (slot !== null) {
            label = (typeof jobSlotNameCtx === 'function')
                ? (jobSlotNameCtx(t, slot, forceBoss === true) || seg.key)
                : ((t.slots && t.slots[slot]) ? t.slots[slot] : seg.key);
        }

        // ★ type 决定 agent 端怎么编译这段。落子动作的 type 由注册表给
        //   （dslType）：tap -> click:格子 / feed、shovel -> swipe:起点,格子
        const _act = (typeof jobBoardActionOfKey === 'function')
            ? jobBoardActionOfKey(seg.key) : null;
        let type;
        if (_act) {
            type = _act.dslType || _act.id;
            if (!label || label === seg.key) label = _act.name;
        } else if (seg.key === 'feed') {
            type = 'feed'; label = '喂豆';       // 注册表未加载时的兼容兜底
        } else if (seg.key === 'shovel') {
            type = 'shovel'; label = '铲子';
        } else {
            type = 'plant';
        }

        const item = {
            key: seg.key,
            slot: slot,                 // 植物槽号；落子动作为 null
            type: type,                 // plant | feed | shovel | tap | ...
            label: label,
            mode: mode,                 // once | loop
            cells: places.map(function (p) { return '格子' + (p.c + 1) + '_' + (p.r + 1); })
        };
        // ★ 无间隔组「」标记：compile.py 把连续 noint 段合进一个「」块
        if (seg.noint === true) item.noint = true;
        // ★ 点击格子的连击次数
        if (Number(seg.times) > 1) item.times = Number(seg.times);
        out.push(item);
    });

    return out;
}

// 兼容保留：展平成 [{slot,order,type,label,cell}] 形式（旧字段 sequence 用）。
// 顺序 = 单次链在前、循环链在后，与运行时「先单次、再循环」一致。
function jobExtractSequence(board, slots, t) {
    const out = [];
    if (!board || !t) return out;
    const chains = [
        { which: 'once', list: jobBuildChain(t, board, 'once') },
        { which: 'loop', list: jobBuildChain(t, board, 'loop') }
    ];
    chains.forEach(function (ch) {
        ch.list.forEach(function (seg) {
            seg.cells.forEach(function (cell, i) {
                out.push({
                    slot: seg.slot,
                    order: i + 1,
                    type: seg.type,
                    label: seg.label,
                    cell: cell,
                    mode: seg.mode
                });
            });
        });
    });
    return out;
}

// ---- 导出 / 保存 ----
function jobExtractPlantOps(board, slots) {
    const bySlot = {};
    if (!board) return [];
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                const m = item.id && /^(card|patch_slot)(\d+)$/.exec(item.id);
                if (!m) return;
                const slot = m[2];
                const cell = `格子${c + 1}_${r + 1}`;
                if (!bySlot[slot]) bySlot[slot] = [];
                bySlot[slot].push(cell);
            });
        }
    }
    return Object.keys(bySlot).map(slot => ({ slot, cells: bySlot[slot] }));
}

function jobExtractCells(board, itemId) {
    const out = [];
    if (!board) return out;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            (board[r][c] || []).forEach(item => {
                if (item.id === itemId) out.push(`格子${c + 1}_${r + 1}`);
            });
        }
    }
    return out;
}

function jobSlotPlants(slots) {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(i => slots[i]).filter(Boolean);
}

function jobBuild() {
    jobSaveCurrentBoard();
    const worlds = [...document.querySelectorAll('#jobWorlds input:checked')].map(cb => cb.value);
    const tables = jobTables.map((t, ti) => {
        // ★ boss 链永远用**本表自己的** boardLate 构建。
        //   以前有 inheritBoss：为 true 时拿上一张表的棋盘来建链 ——
        //   但它在编辑器里没有任何开关、也不随 JSON 持久化，
        //   导致「表2 的 boss 落子改了却按表1 导出」（静默丢配置）。
        const bossBoard = t.boardLate;
        const plants = jobSlotPlants(t.slots);
        // ---- boss 关阵容（有效值导出）--------------------------------------
        // bossLineupMode=''（沿用普通关）-> boss_lineup 与普通关完全一致，
        //   运行时签名相同 -> boss 关跳过清空/选卡直接开打；
        // 'plants' -> 逐槽求值后的完整槽位（bossSlots 三态覆盖层：覆盖用覆盖值、
        //   已删除的槽直接不进列表、其余沿用普通关）；
        // 'deck'   -> boss 关切到指定编队。
        const _bMode = t.bossLineupMode || '';
        const _bArt = (t.bossArtifact !== undefined && t.bossArtifact !== null) ? t.bossArtifact : (t.artifact || null);
        let bossLineup, bossSquad;
        if (_bMode === 'deck') {
            bossLineup = { plants: [], deck: String(t.bossDeckNo || 1), artifact: _bArt };
            bossSquad = Math.min(6, Math.max(1, Number(t.bossDeckNo) || 1));
        } else if (_bMode === 'plants') {
            const bp = [1, 2, 3, 4, 5, 6, 7, 8]
                .map(i => jobSlotNameCtx(t, i, true))   // 三态求值：已删除 -> '' -> 被过滤
                .filter(Boolean);
            bossLineup = { plants: bp, deck: null, artifact: _bArt };
            bossSquad = null;
        } else {
            // 沿用普通关
            bossLineup = (t.lineupMode === 'deck')
                ? { plants: [], deck: String(t.deckNo), artifact: _bArt }
                : { plants: plants.slice(), deck: null, artifact: _bArt };
            bossSquad = (t.lineupMode === 'deck' && t.deckNo) ? Number(t.deckNo) : null;
        }
        return {
            from_level: t.from_level,
            to_level: t.to_level === '' ? null : Number(t.to_level),
            lineup: t.lineupMode === 'deck'
                ? { plants: [], deck: String(t.deckNo), artifact: (t.artifact || null) }
                : { plants, deck: null, artifact: (t.artifact || null) },
            boss_lineup: bossLineup,
            slots: { ...t.slots },

            // ★ 编队切换：lineupMode='deck' 时把编队号写进 squad（1..6）。
            //   运行时（agent/jobset/runtime.py 的 _inject_squad）读到后：
            //     · 「清空卡牌」的 next 改成「无尽挑战_切换编队」
            //     · 「无尽_切换编队序号」的 expected 改成这个数字
            //   于是「选卡」整段被跳过，直接切编队开打。
            //   'plants' 模式写 null，让运行时把上面两个字段还原（避免残留）。
            squad: (t.lineupMode === 'deck' && t.deckNo) ? Number(t.deckNo) : null,
            // boss 关编队（bossLineupMode='deck' 时为 1..6；否则 null = 跟随普通关）
            boss_squad: bossSquad,

            // ---- boss 关阵容的编辑器状态（读回用；boss_lineup 是运行时的有效值）----
            bossLineupMode: _bMode,
            bossDeckNo: (typeof t.bossDeckNo === 'number' ? t.bossDeckNo : 1),
            bossSlots: Object.assign({}, t.bossSlots || {}),
            // 神器占位（暂无图片资源与 UI；运行时阵容签名已含此字段）
            artifact: (t.artifact || null),
            bossArtifact: (t.bossArtifact !== undefined ? t.bossArtifact : null),

            // ---- 编辑器状态（新版）：形态 / 两条链顺序 / 等待节点 ----
            // 这些字段以前没导出，导致保存后再载入「槽位形态、循环链、延迟设置」全丢
            // ★ 普通关与 boss 关**各自独立**（除槽位植物外）
            slotModes: Object.assign({}, t.slotModes || {}),
            slotOrder: Array.isArray(t.slotOrder) ? t.slotOrder.slice() : null,
            loopOrder: Array.isArray(t.loopOrder) ? t.loopOrder.slice() : null,
            endOrder: Array.isArray(t.endOrder) ? t.endOrder.slice() : null,
            waitAfter: Object.assign({}, t.waitAfter || {}),
            // 收尾参数（收尾链的可调项，网页端棋盘下侧可编辑；仅普通关有）
            endPostDelay: (typeof t.endPostDelay === 'number' ? t.endPostDelay : 15000),
            endLastPostDelay: (typeof t.endLastPostDelay === 'number' ? t.endLastPostDelay : 6000),
            endAfterAction: (t.endAfterAction === 'restart' ? 'restart' : 'sub'),
            endSubAction: (t.endSubAction === 'once' || t.endSubAction === 'end' ? t.endSubAction : 'loop'),
            // boss 关配置：null = 未配置 -> 运行时 boss 关不做种植，只等结算
            // ★ bossEndOrder 不再导出：boss 关永不执行收尾链（运行时会忽略）。
            bossSlotModes: Object.assign({}, t.bossSlotModes || {}),
            bossSlotOrder: Array.isArray(t.bossSlotOrder) ? t.bossSlotOrder.slice() : null,
            bossLoopOrder: Array.isArray(t.bossLoopOrder) ? t.bossLoopOrder.slice() : null,
            bossWaitAfter: Object.assign({}, t.bossWaitAfter || {}),
            // 补给选取顺序（boss 关专属，每个阵容独立）
            supplyPicks: Array.isArray(t.supplyPicks)
                ? JSON.parse(JSON.stringify(t.supplyPicks)) : null,
            // （innerWaits 已移除：从未有过消费者，纯遗留字段）

            // ---- 棋盘本体（必须导出！否则保存后载入/切换作业集时阵容全丢）----
            boardEarly: JSON.parse(JSON.stringify(t.boardEarly || [])),
            boardLate: JSON.parse(JSON.stringify(t.boardLate || [])),

            non_boss: {
                plant: jobExtractPlantOps(t.boardEarly, t.slots),
                feed: jobExtractCells(t.boardEarly, 'feed'),
                shovel: jobExtractCells(t.boardEarly, 'shovel'),
                wave: t.waveEnabled === true,
                loop: t.loopPlant,
                once: t.oncePlant,
                // ★ 权威的三条链（顺序由 slotOrder / loopOrder / endOrder 决定）
                once_chain: jobBuildChain(t, t.boardEarly, 'once'),
                loop_chain: jobBuildChain(t, t.boardEarly, 'loop'),
                end_chain: jobBuildChain(t, t.boardEarly, 'end'),
                // 兼容旧字段：展平视图（单次链在前、循环链在后）
                sequence: jobExtractSequence(t.boardEarly, t.slots, t)
            },
            boss: {
                // ★ boss 的植物名映射用「boss 有效槽位表」（bossSlots 覆盖 + 普通关兜底）
                plant: jobExtractPlantOps(bossBoard, (typeof jobEffSlots === 'function') ? jobEffSlots(t, true) : t.slots),
                feed: jobExtractCells(bossBoard, 'feed'),
                shovel: jobExtractCells(bossBoard, 'shovel'),
                wave: t.waveEnabled === true,
                once_chain: jobBuildChain(t, bossBoard, 'once', true),
                loop_chain: jobBuildChain(t, bossBoard, 'loop', true),
                // ★ 不导出 end_chain：boss 关永不执行收尾链（运行时强制忽略）
                sequence: jobExtractSequence(bossBoard, (typeof jobEffSlots === 'function') ? jobEffSlots(t, true) : t.slots, t)
            }
        };
    });
    return {
        code: jobCurrentCode(),
        name: jobCurrentName(),
        version: '1.0',            // 版本不再让用户填，固定 1.0
        worlds,
        max_level: 149,            // 最大关卡固定 149
        everyN: jobGetEveryN(),    // 识别结算速率（高级设置，作用于所有组合动作）
        // 调配参数（步骤 ⚙ 弹窗）：compile.py 的 swipe_ms。
        // （动作间隔固定 0.1s = BatchSwipe 默认，不导出、不可调）
        swipeMs: jobGetSwipeMs(),
        // 局外选卡（无尽局外 80 选，32-jobset-outer.js）：作业集级，与换阵无关
        //   plants = 有效选取顺序（阵容表锁定植物实时派生排前 + 手动点击顺序）；
        //   mode = auto/oneclick/confirm；一键选取/直接点确定 时局内不读列表 -> 导出空 plants
        outer_pick: (function () {
            if (typeof jobOuterPick === 'undefined') return { plants: [], mode: 'auto' };
            const m = jobOuterPick.mode || 'auto';
            const ps = (m === 'auto' && typeof jobOuterEffective === 'function')
                ? jobOuterEffective() : [];
            return { plants: ps, mode: m };
        })(),
        tables
    };
}

// 当前作业集的名字：输入框已移除，改由下拉里选中的项 / 本地缓存记录
let jobMeta = { code: '', name: '', everyN: 10 };

function jobCurrentName() { return (jobMeta.name || '').trim(); }

// 由名字推导一个「文件系统安全」的 code（后端要求仅字母数字_-）
// 中文名无法直接做文件名，所以：有中文/符号时用时间戳兜底，纯英文名则清洗后直接用
function jobCodeFromName(name) {
    const raw = (name || '').trim();
    if (!raw) return '';
    const ascii = raw.replace(/[^A-Za-z0-9_-]/g, '');
    if (ascii && /^[A-Za-z0-9_-]+$/.test(ascii) && ascii.length >= 2) return ascii;
    // 含中文等非 ASCII：用 pvz_ + 时间戳，保证唯一且合法
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return 'pvz_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
         + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function jobCurrentCode() {
    if (jobMeta.code) return jobMeta.code;
    return jobCodeFromName(jobMeta.name);
}

async function jobSave() {
    const msg = document.getElementById('jobStatus');
    // 无尽局外选卡校验：「按列表自动选取」必须选够 80 个；
    // 不够就提示改用「一键选取」/「复用当前配置」（确认后仍可强制保存）
    if (typeof jobOuterPick !== 'undefined' && jobOuterPick.mode === 'auto') {
        const n = (typeof jobOuterEffective === 'function')
            ? jobOuterEffective().length : (jobOuterPick.plants || []).length;
        if (n < 80) {
            const go = window.confirm(
                '⚠️ 无尽局外选卡还没有选够 80 个（当前 ' + n + ' 个）。\n\n'
                + '局外 80 选卡是必配项：\n'
                + '· 在「局外选卡」里选够 80 个（可用「补齐空选」一键补满）\n'
                + '· 或把局内执行方式改成「一键选取」/「复用当前配置」\n\n'
                + '仍要保存吗？');
            if (!go) return;
        }
    }
    // 图片资源检查：阵容表植物缺局内图 / 局外已选植物缺局外图 —— 局内将永远选不到它
    {
        await jobLoadPlants();
        const missIn = [], missOut = [];
        (jobTables || []).forEach(function (t) {
            for (let s = 1; s <= 8; s++) {
                // 普通关槽位 + boss 关有效槽位（覆盖层逐槽沿用普通关）都要查
                const names = [t && t.slots ? t.slots[s] : ''];
                if (typeof jobSlotNameCtx === 'function') names.push(jobSlotNameCtx(t, s, true));
                names.forEach(function (n) {
                    if (!n) return;
                    const p = (typeof jobFindPlant === 'function') ? jobFindPlant(n) : null;
                    if ((!p || p.has_img === false) && missIn.indexOf(n) === -1) missIn.push(n);
                });
            }
        });
        if (typeof jobOuterPick !== 'undefined' && jobOuterPick.mode === 'auto'
                && typeof jobOuterEffective === 'function') {
            jobOuterEffective().forEach(function (n) {
                const p = (typeof jobFindPlant === 'function') ? jobFindPlant(n) : null;
                if ((!p || p.has_img_endless === false) && missOut.indexOf(n) === -1) missOut.push(n);
            });
        }
        if (missIn.length || missOut.length) {
            const lines = [];
            missIn.forEach(function (n) { lines.push('· ' + n + ' —— 缺少局内图片资源'); });
            missOut.forEach(function (n) { lines.push('· ' + n + ' —— 缺少局外图片资源'); });
            const go = window.confirm(
                '⚠️ 以下植物缺少图片资源，局内将无法识别选取：\n\n'
                + lines.join('\n')
                + '\n\n确定保存？');
            if (!go) return;
        }
    }
    // 名字必填：保存前问用户
    let name = jobCurrentName();
    const input = window.prompt('为这个作业集取一个名字吧', name || '');
    if (input === null) return;               // 取消
    name = String(input).trim();
    if (!name) { if (msg) { msg.textContent = '❌ 名字不能为空'; msg.style.color = '#dc2626'; } return; }

    // 名字变了 → code 要跟着变（除非是已下载的远程作业集，它有自己的 code）
    if (name !== jobMeta.name) {
        jobMeta.name = name;
        jobMeta.code = jobCodeFromName(name);
    }
    const job = jobBuild();
    if (!job.code) { if (msg) { msg.textContent = '❌ 无法生成作业集代码'; msg.style.color = '#dc2626'; } return; }
    try {
        const res = await fetch('/save_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job)
        });
        const data = await res.json();
        if (msg) {
            msg.textContent = data.status === 'success' ? ('✅ 已保存「' + name + '」') : ('❌ ' + (data.msg || '保存失败'));
            msg.style.color = data.status === 'success' ? '#22a65e' : '#dc2626';
        }
        if (data.status === 'success') {
            await jobLoadList(job.code);          // 保存后加入下拉栏并选中
            await jobSetCurrent(job.code);        // 同时设为当前（供 agent 使用）
            jobSaveLocal();
        }
    } catch (e) {
        if (msg) { msg.textContent = '❌ 保存失败：' + e; msg.style.color = '#dc2626'; }
    }
}

// 设为当前作业集（Endless_ref.json 的「使用本地作业集」据此读取）
async function jobSetCurrent(code) {
    try {
        await fetch('/set_current_job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code || '' })
        });
    } catch (e) { console.warn('[jobset] 设为当前失败', e); }
}
