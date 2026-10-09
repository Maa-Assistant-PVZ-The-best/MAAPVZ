
// ============================================================
// 10. 核心导出（只保留无尽挑战任务）
// ============================================================
function buildOptionNode(name) {
    const def = OPTION_DEFS[name];
    if (!def) return { name };
    const node = { name };
    const val = currentValues[name];
    if (def.type === 'select' || def.type === 'switch') {
        node.index = val?.index ?? 0;
        const cases = def.cases || [];
        const idx = node.index;
        if (idx < cases.length && cases[idx].option) {
            const children = cases[idx].option.map(child => buildOptionNode(child));
            if (children.length) node.sub_options = children;
        }
    } else if (def.type === 'input') {
        node.data = val?.data || {};
    } else if (def.type === 'checkbox') {
        node.selected_cases = val?.selected_cases || [];
    }
    return node;
}

function buildFullInstance() {
    // ===== 1. 备份用户手动控制的开关 =====
    const userControlledKeys = [
        '是否抛花', '小关是否抛花', 'boss关是否抛花',
        '是否魔甘收尾(牢玩家专属)', '使用三叶草', '魔甘高级选项',
        '小关是否加速', 'fw_boss关是否加速',
        'fw_boss_补给智能选取', 'fw_boss_是否开相机神器',
        '小关是否喂豆', 
        '无尽全自动循环', '刷掉僵尸',
        '自定义布阵'
    ];
    const backup = {};
    userControlledKeys.forEach(key => {
        backup[key] = currentValues[key] ? JSON.parse(JSON.stringify(currentValues[key])) : { index: 0 };
    });

    // ===== 2. 从棋盘提取操作 =====
    const rawOps = [];
    const boards = [
        { name: 'early', data: boardEarly },
        { name: 'late', data: boardLate }
    ];
    boards.forEach(board => {
        for (let r = 0; r < board.data.length; r++) {
            for (let c = 0; c < board.data[r].length; c++) {
                board.data[r][c].forEach(item => {
                    if (item.col && item.row) {
                        rawOps.push({
                            id: item.id,
                            col: item.col,
                            row: item.row,
                            board: board.name,
                            opData: item.opData || ALL_OPS.find(o => o.id === item.id),
                            slotPos: item.slotPos || null,
                            label: item.label
                        });
                    }
                });
            }
        }
    });

    // ===== 3. 重置所有棋盘驱动的开关 =====
    for (let s = 1; s <= 8; s++) {
        const p = `卡${s}`;
        const maxTimes = (s === 1 || s === 2) ? 25 : 10;
        currentValues[`${p}种植`] = { index: 0 };
        for (let i = 1; i <= maxTimes; i++) {
            currentValues[`${p}种第${i}次`] = { index: 0 };
            currentValues[`${p}种第${i}次坐标`] = { data: {} };
        }
    }
    currentValues['frame_wj_custom_是否种守卫菇'] = { index: 0 };
    for (let i = 1; i <= 5; i++) {
        currentValues[`frame_wj_custom_种守卫菇位置${i}`] = { index: 0 };
        currentValues[`frame_wj_custom_种守卫菇位置${i}坐标`] = { data: {} };
    }
    currentValues['frame_wj_custom_是否使用铲子1'] = { index: 0 };
    currentValues['frame_wj_custom_是否使用铲子2'] = { index: 0 };
    for (let i = 1; i <= 10; i++) {
        currentValues[`frame_wj_custom_使用铲子${i}`] = { index: 0 };
        currentValues[`frame_wj_custom_使用铲子${i}坐标`] = { data: {} };
    }
    currentValues['是否需要补植物'] = { index: 0 };
    for (let slot = 2; slot <= 8; slot++) {
        currentValues[`frame_卡槽${slot}_补植物`] = { index: 0 };
        const childPrefix = (slot >= 7) ? `frame_卡槽${slot}_` : `卡槽${slot}_`;
        const maxPos = (slot === 2 || slot === 3) ? 15 : 5;
        for (let pos = 1; pos <= maxPos; pos++) {
            const name = `${childPrefix}${pos}`;
            currentValues[name] = { index: 0 };
            currentValues[`${name}坐标`] = { data: {} };
        }
    }
    currentValues['铲除植物'] = { index: 0 };
    for (let i = 1; i <= 5; i++) {
        currentValues[`铲除植物${i}`] = { index: 0 };
        currentValues[`铲除植物${i}坐标`] = { data: {} };
    }
    currentValues['小关是否抛花'] = { index: 0 };
    currentValues['boss关是否抛花'] = { index: 0 };
    currentValues['1花位置'] = { data: {} };
    currentValues['2花位置'] = { data: {} };
    for (let i = 1; i <= 4; i++) {
        currentValues[`boss关_${i}花位置`] = { data: {} };
    }
    currentValues['魔甘前使用能量豆'] = { index: 0 };
    currentValues['魔甘前喂豆位置'] = { data: {} };
    currentValues['甜薯1种植位置'] = { data: {} };
    currentValues['甜薯2种植位置'] = { data: {} };
    currentValues['飓风甘蓝1种植位置'] = { data: {} };
    currentValues['飓风甘蓝2种植位置'] = { data: {} };
    currentValues['魔甘失败后是否重开'] = { index: 0 };
    currentValues['frame_wj_custom_布完阵是否喂豆'] = { index: 0 };
    currentValues['frame_wj_custom_喂豆位置'] = { index: 0 };
    currentValues['frame_wj_custom_喂豆位置坐标'] = { data: {} };
    currentValues['frame_wj_custom_boss关是否喂豆'] = { index: 0 };
    currentValues['frame_wj_boss_custom_喂豆位置'] = { index: 0 };
    currentValues['frame_wj_boss_custom_喂豆位置坐标'] = { data: {} };
    currentValues['小关喂豆位置'] = { data: {} };
    currentValues['fw_boss关喂豆位置'] = { data: {} };
    currentValues['fw_boss关额外喂豆位置'] = { index: 0 };
    currentValues['fw_boss关喂豆2间隔'] = { data: {} };
    currentValues['fw_boss关喂豆2位置'] = { data: {} };

    // ===== 4. 根据 rawOps 填充数据 =====
    // 4.1 卡槽种植
    for (let s = 1; s <= 8; s++) {
        const id = `card${s}`;
        const prefix = `卡${s}`;
        const maxTimes = (s === 1 || s === 2) ? 25 : 10;
        const positions = rawOps.filter(op => op.id === id).slice(0, maxTimes);
        if (positions.length > 0) {
            currentValues[`${prefix}种植`] = { index: 1 };
            positions.forEach((op, idx) => {
                const order = idx + 1;
                currentValues[`${prefix}种第${order}次`] = { index: 1 };
                currentValues[`${prefix}种第${order}次坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
            });
        }
    }

    // 4.2 守卫菇
    const guardOps = rawOps.filter(op => op.id === 'guard');
    if (guardOps.length > 0) {
        currentValues['frame_wj_custom_是否种守卫菇'] = { index: 1 };
        guardOps.forEach(op => {
            const pos = op.slotPos;
            if (pos >= 1 && pos <= 5) {
                currentValues[`frame_wj_custom_种守卫菇位置${pos}`] = { index: 1 };
                currentValues[`frame_wj_custom_种守卫菇位置${pos}坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        });
    }

    // 4.3 铲子
    const shovelBefore = rawOps.filter(op => op.id === 'shovel_before');
    if (shovelBefore.length > 0) {
        currentValues['frame_wj_custom_是否使用铲子1'] = { index: 1 };
        shovelBefore.forEach(op => {
            const pos = op.slotPos;
            if (pos >= 1 && pos <= 5) {
                currentValues[`frame_wj_custom_使用铲子${pos}`] = { index: 1 };
                currentValues[`frame_wj_custom_使用铲子${pos}坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        });
    }
    const shovelAfter = rawOps.filter(op => op.id === 'shovel_after');
    if (shovelAfter.length > 0) {
        currentValues['frame_wj_custom_是否使用铲子2'] = { index: 1 };
        shovelAfter.forEach(op => {
            const pos = op.slotPos;
            if (pos >= 1 && pos <= 5) {
                const idx = pos + 5;
                currentValues[`frame_wj_custom_使用铲子${idx}`] = { index: 1 };
                currentValues[`frame_wj_custom_使用铲子${idx}坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        });
    }

    // 4.4 补植物
    const patchOps = rawOps.filter(op => op.id.startsWith('patch_slot'));
    if (patchOps.length > 0) {
        currentValues['是否需要补植物'] = { index: 1 };
        const grouped = {};
        patchOps.forEach(op => {
            const slotMatch = op.id.match(/patch_slot(\d+)/);
            if (slotMatch) {
                const slot = parseInt(slotMatch[1]);
                if (!grouped[slot]) grouped[slot] = [];
                grouped[slot].push(op);
            }
        });
        for (const [slot, ops] of Object.entries(grouped)) {
            const slotNum = parseInt(slot);
            const maxPos = (slotNum === 2 || slotNum === 3) ? 15 : 5;
            const switchName = `frame_卡槽${slotNum}_补植物`;
            currentValues[switchName] = { index: 1 };
            const childPrefix = (slotNum >= 7) ? `frame_卡槽${slotNum}_` : `卡槽${slotNum}_`;
            ops.forEach(op => {
                const pos = op.slotPos;
                if (pos >= 1 && pos <= maxPos) {
                    const name = `${childPrefix}${pos}`;
                    currentValues[name] = { index: 1 };
                    currentValues[`${name}坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
                }
            });
        }
    }

    // 4.5 铲除
    const shovelLate = rawOps.filter(op => op.id === 'shovel_late');
    if (shovelLate.length > 0) {
        currentValues['铲除植物'] = { index: 1 };
        shovelLate.forEach(op => {
            const pos = op.slotPos;
            if (pos >= 1 && pos <= 5) {
                currentValues[`铲除植物${pos}`] = { index: 1 };
                currentValues[`铲除植物${pos}坐标`] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        });
    }

    // ===== 4.6 喂豆 =====
// 后期小关喂豆 (feed_late) → 控制 小关是否喂豆
const lateFeedNormal = rawOps.filter(op => op.id === 'feed_late');
if (lateFeedNormal.length > 0) {
    const last = lateFeedNormal[lateFeedNormal.length - 1];
    currentValues['小关是否喂豆'] = { index: 1 };
    currentValues['小关喂豆位置'] = { data: { "列": String(last.col), "行": String(last.row) } };
}

// 后期Boss喂豆 (bossfeed_late) → 控制 fw_boss关是否需要喂豆
const lateBossFeedNormal = rawOps.filter(op => op.id === 'bossfeed_late');
if (lateBossFeedNormal.length > 0) {
    const last = lateBossFeedNormal[lateBossFeedNormal.length - 1];
    currentValues['fw_boss关是否需要喂豆'] = { index: 1 };
    currentValues['fw_boss关喂豆位置'] = { data: { "列": String(last.col), "行": String(last.row) } };
}

// 后期Boss喂豆2 (bossfeed2_late) → 控制 fw_boss关额外喂豆位置
const lateBossFeed2 = rawOps.filter(op => op.id === 'bossfeed2_late');
if (lateBossFeed2.length > 0) {
    const last = lateBossFeed2[lateBossFeed2.length - 1];
    currentValues['fw_boss关是否需要喂豆'] = { index: 1 }; // 强制主开关开启
    currentValues['fw_boss关额外喂豆位置'] = { index: 1 };
    currentValues['fw_boss关喂豆2位置'] = { data: { "列": String(last.col), "行": String(last.row) } };
    // 如果间隔未手动设置，使用默认值
    if (!currentValues['fw_boss关喂豆2间隔']?.data?.毫秒) {
        currentValues['fw_boss关喂豆2间隔'] = { data: { "毫秒": "4000" } };
    }
}
// 前期小关喂豆 (feed, board === 'early') → 控制 frame_wj_custom_布完阵是否喂豆
const earlyFeedSmall = rawOps.filter(op => op.id === 'feed' && op.board === 'early');
if (earlyFeedSmall.length > 0) {
    const last = earlyFeedSmall[earlyFeedSmall.length - 1];
    currentValues['frame_wj_custom_布完阵是否喂豆'] = { index: 1 };
    currentValues['frame_wj_custom_喂豆位置'] = { index: 1 };
    currentValues['frame_wj_custom_喂豆位置坐标'] = { data: { "列": String(last.col), "行": String(last.row) } };
}

// 前期Boss喂豆 (bossfeed, board === 'early') → 控制 frame_wj_custom_boss关是否喂豆
const earlyBossFeed = rawOps.filter(op => op.id === 'bossfeed' && op.board === 'early');
if (earlyBossFeed.length > 0) {
    const last = earlyBossFeed[earlyBossFeed.length - 1];
    currentValues['frame_wj_custom_boss关是否喂豆'] = { index: 1 };
    currentValues['frame_wj_boss_custom_喂豆位置'] = { index: 1 };
    currentValues['frame_wj_boss_custom_喂豆位置坐标'] = { data: { "列": String(last.col), "行": String(last.row) } };
}

    // 4.6.1 后期喂豆球果
    let feedBallExists = false;
    for (let r = 0; r < boardLate.length; r++) {
        for (let c = 0; c < boardLate[r].length; c++) {
            const cell = boardLate[r][c];
            for (let item of cell) {
                if (item.id === 'feed_ball_late') {
                    feedBallExists = true;
                    break;
                }
            }
            if (feedBallExists) break;
        }
        if (feedBallExists) break;
    }
    if (feedBallExists) {
        currentValues['是否开局喂豆球果'] = { index: 1 };
    } else {
        currentValues['是否开局喂豆球果'] = { index: 0 };
    }

    // 4.7 抛花
    const flowerOps = rawOps.filter(op => op.id === 'flower');
    if (flowerOps.length > 0 && backup['是否抛花']?.index === 1) {
        currentValues['小关是否抛花'] = { index: 1 };
        flowerOps.forEach(op => {
            const pos = op.slotPos;
            if (pos === 1) currentValues['1花位置'] = { data: { "列": String(op.col), "行": String(op.row) } };
            else if (pos === 2) currentValues['2花位置'] = { data: { "列": String(op.col), "行": String(op.row) } };
        });
    }
    const bossFlowerOps = rawOps.filter(op => op.id === 'bossflower');
    if (bossFlowerOps.length > 0 && backup['是否抛花']?.index === 1) {
        currentValues['boss关是否抛花'] = { index: 1 };
        bossFlowerOps.forEach(op => {
            const pos = op.slotPos;
            if (pos >= 1 && pos <= 4) {
                currentValues[`boss关_${pos}花位置`] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        });
    }

    // 4.8 魔甘
    const magicOps = rawOps.filter(op => ['sweet1', 'sweet2', 'ganlan1', 'ganlan2', 'magicfeed'].includes(op.id));
    if (magicOps.length > 0 && backup['是否魔甘收尾(牢玩家专属)']?.index === 1) {
        const magicMap = {
            'sweet1': '甜薯1种植位置',
            'sweet2': '甜薯2种植位置',
            'ganlan1': '飓风甘蓝1种植位置',
            'ganlan2': '飓风甘蓝2种植位置',
            'magicfeed': '魔甘前喂豆位置'
        };
        if (rawOps.some(op => op.id === 'magicfeed')) {
            currentValues['魔甘前使用能量豆'] = { index: 1 };
        }
        for (const [id, optName] of Object.entries(magicMap)) {
            const op = rawOps.find(o => o.id === id);
            if (op) {
                currentValues[optName] = { data: { "列": String(op.col), "行": String(op.row) } };
            }
        }
    }

    // 4.9 自定义布阵
// 检查前期棋盘是否有任何操作
let hasEarlyOps = false;
for (let r = 0; r < boardEarly.length; r++) {
    for (let c = 0; c < boardEarly[r].length; c++) {
        if (boardEarly[r][c].length > 0) {
            hasEarlyOps = true;
            break;
        }
    }
    if (hasEarlyOps) break;
}

// 只有前期有操作，或者手动输入了回到后期关卡时，才开启自定义布阵
let shouldEnableCustom = hasEarlyOps;
const returnLateVal = currentValues['frame_wj_custom_回到后期']?.data?.关卡;
if (returnLateVal && returnLateVal.trim() !== '') {
    shouldEnableCustom = true;
}
currentValues['自定义布阵'] = shouldEnableCustom ? { index: 1 } : { index: 0 };

    // ===== 5. 恢复用户控制的开关 =====
    const userOnlyKeys = [
        '是否抛花', '是否魔甘收尾(牢玩家专属)', '使用三叶草', '魔甘高级选项',
        '小关是否加速', 'fw_boss关是否加速',
        'fw_boss_补给智能选取', 'fw_boss_是否开相机神器',
        '无尽全自动循环', '刷掉僵尸',
        
    ];
    userOnlyKeys.forEach(key => {
        currentValues[key] = backup[key] || { index: 0 };
    });

    if (currentValues['识别能量花卡槽位置']?.index === 1) {
        currentValues['是否抛花'] = { index: 1 };
    }
    if (currentValues['识别魔甘卡槽位置']?.index === 1) {
        currentValues['魔甘高级选项'] = { index: 1 };
        currentValues['是否魔甘收尾(牢玩家专属)'] = { index: 1 };
    }
    if (currentValues['识别三叶草卡槽位置']?.index === 1) {
        currentValues['使用三叶草'] = { index: 1 };
        currentValues['是否魔甘收尾(牢玩家专属)'] = { index: 1 };
    }

    // ===== 6. 构建 option 树（过滤 index:0 的普通开关） =====
    function buildCleanNode(name) {
        const def = OPTION_DEFS[name];
        if (!def) return null;
        const val = currentValues[name];
        const node = { name };

        if (def.type === 'select' || def.type === 'switch') {
            let idx = val?.index ?? 0;
            const isRecog = name === '识别能量花卡槽位置' || name === '识别魔甘卡槽位置' || name === '识别三叶草卡槽位置' || name === '是否开局喂豆球果';
            if (isRecog) {
                idx = idx === 0 ? 1 : 0;
            }

            // 普通 switch（非识别开关）且 index 为 0 → 不导出
            if (!isRecog && idx === 0) {
                return null;
            }

            node.index = idx;
            const cases = def.cases || [];
            let children = [];

            if (name === '是否开局喂豆球果') {
                const coordData = currentValues['喂豆球果']?.data;
                if (coordData && (coordData['列'] || coordData['行'])) {
                    children.push({ name: '喂豆球果', data: coordData });
                }
            } else {
                if (idx < cases.length && cases[idx].option) {
                    children = cases[idx].option
                        .map(child => buildCleanNode(child))
                        .filter(child => child !== null);
                }
            }

            if (children.length > 0) {
                node.sub_options = children;
            }
            return node;
        } else if (def.type === 'input') {
            const data = val?.data || {};
            const hasData = Object.values(data).some(v => v !== '' && v !== undefined && v !== null);
            if (!hasData) return null;
            node.data = data;
            return node;
        } else if (def.type === 'checkbox') {
            const selected = val?.selected_cases || [];
            if (selected.length === 0) return null;
            node.selected_cases = selected;
            return node;
        }
        return null;
    }

    const rootNames = getRootOptionNames();
    let subOptions = rootNames
        .map(name => buildCleanNode(name))
        .filter(n => n !== null);

    // 强制修复自定义布阵子节点
    const customNode = subOptions.find(n => n.name === '自定义布阵');
    if (customNode && customNode.sub_options) {
        function deduplicateNodes(arr) {
            const seen = new Set();
            return arr.filter(node => {
                const key = node.name;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        const feedSwitch = customNode.sub_options.find(n => n.name === 'frame_wj_custom_布完阵是否喂豆');
        if (feedSwitch) {
            if (currentValues['frame_wj_custom_布完阵是否喂豆']?.index === 1) {
                if (!feedSwitch.sub_options) feedSwitch.sub_options = [];
                feedSwitch.sub_options = deduplicateNodes(feedSwitch.sub_options);
                if (!feedSwitch.sub_options.find(n => n.name === 'frame_wj_custom_喂豆位置')) {
                    feedSwitch.sub_options.push({
                        name: 'frame_wj_custom_喂豆位置',
                        index: currentValues['frame_wj_custom_喂豆位置']?.index ?? 1,
                        sub_options: []
                    });
                }
                const feedPosNode = feedSwitch.sub_options.find(n => n.name === 'frame_wj_custom_喂豆位置');
                if (feedPosNode) {
                    if (!feedPosNode.sub_options) feedPosNode.sub_options = [];
                    feedPosNode.sub_options = deduplicateNodes(feedPosNode.sub_options);
                    if (!feedPosNode.sub_options.find(n => n.name === 'frame_wj_custom_喂豆位置坐标')) {
                        const coord = currentValues['frame_wj_custom_喂豆位置坐标']?.data || { "列": "1", "行": "1" };
                        feedPosNode.sub_options.push({
                            name: 'frame_wj_custom_喂豆位置坐标',
                            data: coord
                        });
                    }
                }
            } else {
                feedSwitch.sub_options = [];
            }
        }

        const bossFeedSwitch = customNode.sub_options.find(n => n.name === 'frame_wj_custom_boss关是否喂豆');
        if (bossFeedSwitch) {
            if (currentValues['frame_wj_custom_boss关是否喂豆']?.index === 1) {
                if (!bossFeedSwitch.sub_options) bossFeedSwitch.sub_options = [];
                bossFeedSwitch.sub_options = deduplicateNodes(bossFeedSwitch.sub_options);
                if (!bossFeedSwitch.sub_options.find(n => n.name === 'frame_wj_boss_custom_喂豆位置')) {
                    bossFeedSwitch.sub_options.push({
                        name: 'frame_wj_boss_custom_喂豆位置',
                        index: currentValues['frame_wj_boss_custom_喂豆位置']?.index ?? 1,
                        sub_options: []
                    });
                }
                const bossPosNode = bossFeedSwitch.sub_options.find(n => n.name === 'frame_wj_boss_custom_喂豆位置');
                if (bossPosNode) {
                    if (!bossPosNode.sub_options) bossPosNode.sub_options = [];
                    bossPosNode.sub_options = deduplicateNodes(bossPosNode.sub_options);
                    if (!bossPosNode.sub_options.find(n => n.name === 'frame_wj_boss_custom_喂豆位置坐标')) {
                        const coord = currentValues['frame_wj_boss_custom_喂豆位置坐标']?.data || { "列": "1", "行": "1" };
                        bossPosNode.sub_options.push({
                            name: 'frame_wj_boss_custom_喂豆位置坐标',
                            data: coord
                        });
                    }
                }
                if (currentValues['frame_wj_boss_custom_喂豆间隔']?.data?.秒数) {
                    if (!bossFeedSwitch.sub_options.find(n => n.name === 'frame_wj_boss_custom_喂豆间隔')) {
                        bossFeedSwitch.sub_options.push({
                            name: 'frame_wj_boss_custom_喂豆间隔',
                            data: currentValues['frame_wj_boss_custom_喂豆间隔'].data
                        });
                    }
                }
            } else {
                bossFeedSwitch.sub_options = [];
            }
        }
    }

    const optionTree = {
        name: "无尽模式",
        index: 1,
        sub_options: subOptions.length > 0 ? subOptions : []
    };

    // ===== 7. 构建最终实例 =====
    // 旧的「配置名称/控制器/入口」输入框已随旧工具栏移除 → 必须做空值保护，
    // 否则 buildFullInstance 会在 updatePreview 里抛错，中断整个 onload（后面所有绑定失效）
    const _val = function (id, dflt) {
        const el = document.getElementById(id);
        return (el && typeof el.value === 'string') ? (el.value.trim() || dflt) : dflt;
    };
    const instanceName = _val('configName', "无尽_前后期");
    const controller = _val('controllerName', "安卓端");
    // ★ 默认入口指向重构版任务（旧「无尽挑战（测试）/无尽挑战_前置检查」已随重构删除）
    const entry = _val('taskEntry', "无尽挑战_前置检查_ref");

    return {
        "CurrentControllerName": controller,
        "Resource": "",
        "CurrentTasks": [`无尽挑战（重构）<|||>${entry}`],
        "TaskItems": [{
            "name": "无尽挑战（重构）",
            "entry": entry,
            "default_check": true,
            "option": [optionTree]
        }],
        "AdbDevice": {
            "InfoHandle": { "value": 0 },
            "Name": "模拟器",
            "AdbPath": "adb",
            "AdbSerial": "127.0.0.1:5555",
            "ScreencapMethods": 64,
            "InputMethods": 18446744073709551615,
            "Config": "{}",
            "AgentPath": "./MaaAgentBinary"
        },
        "CurrentController": 2,
        "RetryOnDisconnected": true,
        "AllowAdbRestart": false,
        "InstanceName": instanceName,
        "ContinueRunningWhenError": true,
        "BeforeTask": "None"
    };
}
