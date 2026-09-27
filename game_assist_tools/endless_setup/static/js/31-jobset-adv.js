
// ============================================================
// 高级设置（作业集级）
//
//   · 入口：作业集工具栏右侧的「⚙ 高级设置」按钮。
//   · 「识别结算速率」= BatchSwipe 的 every:N
//       每执行 N 次动作识别一遍「有没有结算」，命中即停本批、跟随 next。
//       识别本身耗时，N 太小（如 1）会让动作明显变慢。
//       默认 10。链跑完后会直接进 next，那里还会识别一次，所以不必在链尾补查。
//   · 存进作业集顶层字段 everyN，跟随作业集保存 / 导出。
// ============================================================

const JOB_EVERY_DEFAULT = 10;

// 取当前作业集的识别结算速率（读 jobMeta，缺省 10）
function jobGetEveryN() {
    const v = +(jobMeta && jobMeta.everyN);
    if (!Number.isFinite(v) || v < 1) return JOB_EVERY_DEFAULT;
    return Math.floor(v);
}

// 打开高级设置弹窗（回填当前值）
function jobOpenAdv() {
    const modal = document.getElementById('jobAdvModal');
    if (!modal) return;
    const input = document.getElementById('jobAdvEvery');
    if (input) input.value = jobGetEveryN();
    modal.classList.add('ja-open');
}

function jobCloseAdv() {
    const modal = document.getElementById('jobAdvModal');
    if (modal) modal.classList.remove('ja-open');
}

// 写回识别结算速率
function jobSetEveryN(v) {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) n = JOB_EVERY_DEFAULT;
    jobMeta.everyN = n;
    jobSaveLocal();
}

// 绑定（初始化时调一次）
function jobBindAdv() {
    const modal = document.getElementById('jobAdvModal');
    if (!modal) return;

    const open = document.getElementById('jobAdvBtn');
    if (open) open.addEventListener('click', jobOpenAdv);

    const close = document.getElementById('jobAdvClose');
    if (close) close.addEventListener('click', jobCloseAdv);

    modal.addEventListener('click', function (e) {
        if (e.target === modal) jobCloseAdv();
    });

    const input = document.getElementById('jobAdvEvery');
    if (input) {
        // change 而不是 input：避免打字中途（如删空）被强行改成默认值
        input.addEventListener('change', function () {
            jobSetEveryN(this.value);
            this.value = jobGetEveryN();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') jobCloseAdv();
    });
}
