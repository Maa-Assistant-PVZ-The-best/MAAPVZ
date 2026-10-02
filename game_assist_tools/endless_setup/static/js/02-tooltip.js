
// ============================================================
// 2. Tooltip 系统
// ============================================================
const tooltipEl = document.getElementById('tooltip');
let tooltipTimer = null;
let tooltipTarget = null;

function showTooltip(text, x, y) {
    tooltipEl.textContent = text;
    tooltipEl.style.left = (x + 12) + 'px';
    tooltipEl.style.top = (y + 8) + 'px';
    tooltipEl.classList.add('visible');
}

function hideTooltip() {
    tooltipEl.classList.remove('visible');
}

function handleMouseEnter(e) {
    const target = e.currentTarget;
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    tooltipTarget = target;
    clearTimeout(tooltipTimer);
    const delay = parseInt(target.getAttribute('data-tooltip-delay')) || 500;
    tooltipTimer = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        showTooltip(text, rect.left, rect.top);
    }, delay);
}

function handleMouseLeave(e) {
    clearTimeout(tooltipTimer);
    hideTooltip();
    tooltipTarget = null;
}

function handleMouseMove(e) {
    if (tooltipTarget && tooltipEl.classList.contains('visible')) {
        tooltipEl.style.left = (e.clientX + 12) + 'px';
        tooltipEl.style.top = (e.clientY + 8) + 'px';
    }
}

function enableTooltip(el) {
    if (!el || el._tooltipEnabled) return;
    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('mousemove', handleMouseMove);
    el._tooltipEnabled = true;
}

function enableTooltips(selector) {
    document.querySelectorAll(selector).forEach(el => enableTooltip(el));
}

function observeNewElements() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.hasAttribute && node.hasAttribute('data-tooltip')) {
                        enableTooltip(node);
                    }
                    node.querySelectorAll && node.querySelectorAll('[data-tooltip]').forEach(el => enableTooltip(el));
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// 通用「叉叉」不可用标记（可扩展：任何卡片/条目都能用）
// ------------------------------------------------------------
// 用法：jobCardXMark(frameEl) —— frameEl 需要 position:relative。
//   返回叉叉元素（已存在则复用，不会重复添加）。
//   悬停文案挂在**卡片容器**的 data-tooltip 上（delay 用
//   data-tooltip-delay="1000"），由上面的 tooltip 系统自动接管。
// 后续别的内容需要叉叉（补给选择器、80 选卡…）：直接调本函数 +
// 设置容器 data-tooltip 即可，样式见 base.css 的 .job-x-mark。
// 当前消费方：27-jobset-board.js 的植物选择器（无图植物打叉禁选）。
// ============================================================
function jobCardXMark(frameEl) {
    if (!frameEl) return null;
    const old = frameEl.querySelector('.job-x-mark');
    if (old) return old;
    const x = document.createElement('span');
    x.className = 'job-x-mark';
    x.textContent = '✕';
    frameEl.appendChild(x);
    return x;
}
