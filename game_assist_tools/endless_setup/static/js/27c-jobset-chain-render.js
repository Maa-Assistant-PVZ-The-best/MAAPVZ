// 27c-jobset-chain-render.js —— 原 27-jobset-board.js 第 1625~2235 行：链条渲染（一株一块 / 无间隔组 / 通用动作块）
// ★ 拆分只搬代码、不改逻辑（2026-11-02）。所有文件共享全局作用域，
//   按数字前缀顺序加载；映射表见 HANDOFF §1「作业集编辑器文件结构」。

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

        // ★ ↑ / ↓ 移一位（2026-11-02）：**拖拽在触屏上不工作**，
        //   这是「调整种植顺序」在手机上唯一的入口；桌面同样可用。
        //   语义完全走 jobNudgeSelected -> jobApplyDrop（与拖拽同一条路）。
        const upBtn = document.createElement('button');
        upBtn.className = 'seq-selbar-move';
        upBtn.textContent = '↑';
        upBtn.title = '把勾选项在本链内上移一位（手机没有拖拽，用这个）';
        upBtn.addEventListener('click', function (e) { e.stopPropagation(); jobNudgeSelected(-1); });
        bar.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'seq-selbar-move';
        downBtn.textContent = '↓';
        downBtn.title = '把勾选项在本链内下移一位（手机没有拖拽，用这个）';
        downBtn.addEventListener('click', function (e) { e.stopPropagation(); jobNudgeSelected(1); });
        bar.appendChild(downBtn);

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
    // ★ 同步神器板块（切表 -> 神器可能变）
    if (typeof jobRenderArtifactBlock === 'function') jobRenderArtifactBlock();
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
    // ★ 2026-11-02：链路进 dataset —— 手机端「拖拽到哪条链」按它判定
    //   （44-jobset-mobile.js 的触屏拖拽），不要去解析 class 名。
    sec.dataset.which = which;
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
    // ★ 使用神器：图标用快照的体型图（特殊类）/ 神器图（其余），不用 emoji
    let _gaImg = ga.img, _gaIco = ga.icon || '⚡', _gaAlt = ga.name;
    if (ga.id === 'artifact' && typeof jobArtifactOf === 'function') {
        const _a = jobArtifactOf(st.artName);
        if (_a && _a.img) {
            _gaImg = (st.artType === 'special' && st.artBody)
                ? ('static/artifact/' + _a.en + '/bodytype/' + st.artBody + '.webp')
                : _a.img;
            _gaIco = '🏺';
            _gaAlt = (st.artName || '') + (st.artBody || '');
        }
    }
    jobAppendIconImg(ico, _gaImg, { cls: 'seq-ico-img', size: 28, alt: _gaAlt, fallbackText: _gaIco });
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
    // ★ 使用神器：名字后跟快照摘要（神器名·体型）
    if (ga.id === 'artifact' && typeof jobArtifactSummary === 'function') {
        const sum = document.createElement('span');
        sum.className = 'seq-custom-summary';
        sum.textContent = jobArtifactSummary(st);
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

