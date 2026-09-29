
// ============================================================
// 补给选取（boss 关专属，每个阵容独立）
//
// 每张卡 = 一个补给选项，顺序即「优先拿哪个」。
// 拖拽调整顺序；数据存在 t.supplyPicks（每个阵容一份）。
// 导出 JSON 暂不接，先把 UI 做出来。
// ============================================================

// 默认补给项（与 static/supply/ 下的中文名图片一一对应）
const SUPPLY_DEFAULTS = [
    { id: 'all',      name: '全部植物', img: '全部植物.png' },
    { id: 'orange',   name: '橙色植物', img: '橙色植物.png' },
    { id: 'purple',   name: '紫色植物', img: '紫色植物.png' },
    { id: 'blue',     name: '蓝色植物', img: '蓝色植物.png' },
    { id: 'green',    name: '绿色植物', img: '绿色植物.png' },
    { id: 'white',    name: '白色植物', img: '白色植物.png' },
    { id: 'artifact', name: '神器',     img: '神器.png' },
    { id: 'sun',      name: '能量豆',   img: '能量豆.png' }
];

// 补给图片目录（Flask static 挂在 /static/...，见 HANDOFF 约定）
const SUPPLY_IMG_DIR = 'static/supply/';

// 候选补给项（「可选补给项」图库里能选的全部图片）
// ★「查看」是一个**普通可选项**：点击选中 / 再点取消，
//   但它不参与排序，也不会出现在上面的堆叠卡片区（见 jobRenderSupply）。
const SUPPLY_CANDIDATES = SUPPLY_DEFAULTS.concat([
    { id: 'cucumber', name: '黄瓜', img: 'bomb.png' },
    { id: 'view',     name: '查看', img: '查看.png', pinned: true }
]);

// 「查看」：不参与排序、不显示在排序区，状态在「已选择」那一栏体现
const SUPPLY_PINNED_ID = 'view';

// 取当前阵容的补给列表（没有就按默认初始化）
function jobSupplyList(t) {
    if (!t) return [];
    if (!Array.isArray(t.supplyPicks)) {
        // 默认给前 5 项（与参考实现的 5 张卡一致）
        t.supplyPicks = SUPPLY_DEFAULTS.slice(0, 5).map(function (d) {
            return { id: d.id, name: d.name, img: d.img };
        });
    }
    return t.supplyPicks;
}

function jobSupplyIsPinned(it) {
    return !!it && (it.id === SUPPLY_PINNED_ID || it.pinned === true);
}

// 点图库项：普通项 -> 添加／移除切换；「查看」-> 选中／取消（语义相同）
function jobToggleSupplyItem(cand) {
    const t = jobTables[currentTable];
    if (!t) return;
    const list = jobSupplyList(t);
    const key = jobSupplyItemKey(cand);
    const at = list.findIndex(function (x) { return jobSupplyItemKey(x) === key; });

    if (cand.pinned) {
        // ★「查看」不再是「固定到最前」，而是像普通项一样：
        //   点一下 = 选中；再点一下 = 取消。
        //   （用户要求：点击是已选择，再次点击取消选择）
        if (at >= 0) {
            list.splice(at, 1);
            setStatus('－ 已取消选择：' + cand.name);
        } else {
            // ★ 关键：**不要 unshift 到最前** —— 它不会再显示在排序区，
            //   放在最前只会无谓地改变其它项的序号。追加到末尾即可。
            list.push({ id: cand.id, name: cand.name, img: cand.img, pinned: true });
            setStatus('＋ 已选择：' + cand.name);
        }
    } else if (at >= 0) {
        list.splice(at, 1);
        setStatus('－ 已移除补给项：' + cand.name);
    } else {
        list.push({ id: cand.id, name: cand.name, img: cand.img });
        setStatus('＋ 已添加补给项：' + cand.name);
    }
    jobSaveLocal();
    jobRenderSupply();
    jobRenderSupplyPicker();
}

// 渲染卡片堆叠
function jobRenderSupply() {
    const stage = document.getElementById('supplyStage');
    const badge = document.getElementById('supplyCount');
    if (!stage) return;

    const t = jobTables[currentTable];
    stage.innerHTML = '';
    if (!t) return;

    const list = jobSupplyList(t);
    if (badge) badge.textContent = String(list.length);

    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'supply-empty';
        empty.textContent = '还没有补给项，点下面的图库添加';
        stage.appendChild(empty);
        return;
    }

    // ★「查看」是一个**开关**，不是补给项 —— 它**完全不显示在补给顺序区**。
    //   用户明确要求：即使选中了「查看」，它也不该出现在补给顺序里。
    //   · 排序区只画普通补给项；
    //   · 「查看」的选中状态记在 supplyPicks 里（导出要用），
    //     但界面上只在**下方图库**用「✓ 已选择」角标体现。
    const sortable = list.filter(function (it) { return !jobSupplyIsPinned(it); });

    sortable.forEach(function (item, i) {
        const card = document.createElement('div');
        // ★ 这里的 item 一定不是「查看」（sortable 已把它滤掉），
        //   所以不再需要 sp-pinned / 不可拖拽那些分支。
        card.className = 'supply-card';
        card.draggable = true;
        card.dataset.idx = String(i);
        // ★ 关键：把序号写进 CSS 变量，位移由 CSS 一次算出
        card.style.setProperty('--i', String(i));
        card.title = item.name + '（拖拽调整顺序）';

        const img = document.createElement('div');
        img.className = 'sc-img';
        if (item.img) {
            const el = document.createElement('img');
            el.src = SUPPLY_IMG_DIR + encodeURIComponent(item.img);
            el.alt = item.name || '';
            el.draggable = false;          // 让拖拽事件落在卡片上，不是图片上
            el.onerror = function () {
                // 图片缺失时退化成 emoji，不显示破图
                this.style.display = 'none';
                img.textContent = item.icon || '📦';
            };
            img.appendChild(el);
        } else {
            img.textContent = item.icon || '📦';
        }
        card.appendChild(img);

        const ord = document.createElement('span');
        ord.className = 'sc-order';
        ord.textContent = String(i + 1);
        card.appendChild(ord);

        // 删除按钮：从补给列表里去掉这一项
        const del = document.createElement('button');
        del.className = 'sc-del';
        del.textContent = '×';
        del.title = '删除这一项';
        del.addEventListener('click', function (e) {
            e.stopPropagation();
            list.splice(list.indexOf(item), 1);
            jobSaveLocal();
            jobRenderSupply();
            jobRenderSupplyPicker();
        });
        card.appendChild(del);

        const nm = document.createElement('div');
        nm.className = 'sc-name';
        nm.textContent = item.name;
        card.appendChild(nm);

        // ---- 拖拽排序 ----
        card.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', String(i));
            e.dataTransfer.effectAllowed = 'move';
            card.style.opacity = '0.4';
        });
        card.addEventListener('dragend', function () { card.style.opacity = ''; });
        card.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        card.addEventListener('drop', function (e) {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const to = i;
            if (isNaN(from) || from === to) return;
            // ★ 注意：这里操作的是 sortable（已剔除「查看」），
            //   但真正要改的是 list —— 先按 sortable 算好新顺序，再写回 list。
            const moved = sortable.splice(from, 1)[0];
            sortable.splice(to, 0, moved);
            jobCommitSupplyOrder(list, sortable);
            setStatus('↔ 已调整补给顺序：' + moved.name + ' → 第 ' + (to + 1) + ' 位');
        });

        // 悬停时按「距离」给所有卡下发位移：离得越远退得越多（扇子张开）
        // 被悬停那张单独加 .sc-lifted（上浮 + 微旋 + 放大）
        card.addEventListener('mouseenter', function () { jobSupplyHover(i, true); });
        card.addEventListener('mouseleave', function () { jobSupplyHover(i, false); });

        // 点卡片 -> 打开选择弹窗（便于换掉这一项）
        card.addEventListener('click', function () {
            jobOpenSupplyPicker();
        });

        stage.appendChild(card);
    });

    // 空白区提示
    const hint = document.getElementById('supplyHint');
    if (hint) hint.textContent = list.length ? '拖拽卡片可调整顺序' : '';
}

// 把排序结果写回列表：「查看」保持原位，其余按 sortable 的新顺序铺进去
function jobCommitSupplyOrder(list, sortable) {
    let k = 0;
    for (let i = 0; i < list.length; i++) {
        if (jobSupplyIsPinned(list[i])) continue;      // 「查看」不动
        list[i] = sortable[k++];
    }
    jobSaveLocal();
    jobRenderSupply();
}

// ★ 原先这里有个 jobRenderSupplyPinned()：把「查看」单独画在堆叠区旁边。
//   用户要求「即使选中了查看，它也不该在补给顺序中显示」——
//   所以这个函数连同 HTML 里的 #supplyPinned 容器一起删掉了。
//   「查看」的选中状态现在只在下半图库里用「✓ 已选择」角标体现。

// 悬停/离开时重算所有卡片的让位
//   hoverIdx 那张：加 .sc-lifted（CSS 负责上浮+旋转+放大）
//   其余：shift = (自己的序号 - hoverIdx) * 基准位移
//         负数往左退、正数往右退，越远退越多 -> 整叠像扇子张开
//
// ⚠️ 为什么用 left 而不是 transform：
//   实测 `transition: transform` + JS 写 transform 时，inline 值虽然对了，
//   但卡片在屏幕上的渲染位置完全不变（Chromium 的合成层问题）。
//   改成过渡 `left`（布局属性）实测可靠，且视觉上同样是平滑位移。
function jobSupplyHover(hoverIdx, on) {
    const stage = document.getElementById('supplyStage');
    if (!stage) return;
    const sec = document.getElementById('supplySection');
    let shiftBase = 34;
    if (sec) {
        const parsed = parseFloat(getComputedStyle(sec).getPropertyValue('--sc-shift'));
        if (!isNaN(parsed)) shiftBase = parsed;
    }

    Array.from(stage.querySelectorAll('.supply-card')).forEach(function (c) {
        const i = parseInt(c.style.getPropertyValue('--i'), 10) || 0;
        if (!on || i === hoverIdx) {
            // 复位；抽出那张的位移交给 .sc-lifted
            if (on && i === hoverIdx) c.classList.add('sc-lifted');
            else c.classList.remove('sc-lifted');
            c.style.setProperty('--shift-x', '0px');
        } else {
            c.classList.remove('sc-lifted');
            c.style.setProperty('--shift-x', ((i - hoverIdx) * shiftBase) + 'px');
        }
    });
}
