"use strict";

/**
 * JSONC 尾随逗号清除核心逻辑。
 *
 * 设计目标：只删除“尾随逗号”这一个字符，其它任何字节都不动。
 * 因此注释、缩进、空行、CRLF 换行、以及字符串里的逗号都会被完整保留。
 *
 * 判定规则：一个位于字符串之外的逗号，如果它后面（跳过空白与注释）紧跟的
 * 第一个有效字符是 `}` 或 `]`，那它就是尾随逗号。
 */

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v", "\u00a0", "\ufeff"]);

function isWhitespace(ch) {
    return WHITESPACE.has(ch);
}

/** 从 `"` 开始跳过整个字符串字面量，正确处理反斜杠转义。返回下一个字符的下标。 */
function skipString(text, start) {
    const n = text.length;
    let i = start + 1;
    while (i < n) {
        const c = text[i];
        if (c === "\\") {
            i += 2;
            continue;
        }
        if (c === '"') return i + 1;
        i++;
    }
    return n;
}

/** 跳过 `//` 行注释，返回行尾（不含换行符）下标。 */
function skipLineComment(text, start) {
    const n = text.length;
    let i = start + 2;
    while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
    return i;
}

/** 跳过块注释，返回注释结束后的下标。 */
function skipBlockComment(text, start) {
    const n = text.length;
    let i = start + 2;
    while (i < n) {
        if (text[i] === "*" && text[i + 1] === "/") return i + 2;
        i++;
    }
    return n;
}

/** 跳过空白与注释，返回第一个“有效字符”的下标。 */
function skipTrivia(text, start) {
    const n = text.length;
    let i = start;
    for (;;) {
        while (i < n && isWhitespace(text[i])) i++;
        if (text[i] === "/" && text[i + 1] === "/") {
            i = skipLineComment(text, i);
            continue;
        }
        if (text[i] === "/" && text[i + 1] === "*") {
            i = skipBlockComment(text, i);
            continue;
        }
        return i;
    }
}

/**
 * 找出全部尾随逗号的字符下标（升序）。
 * @param {string} text
 * @returns {number[]}
 */
function findTrailingCommas(text) {
    const offsets = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
        const c = text[i];

        if (c === '"') {
            i = skipString(text, i);
            continue;
        }
        if (c === "/" && text[i + 1] === "/") {
            i = skipLineComment(text, i);
            continue;
        }
        if (c === "/" && text[i + 1] === "*") {
            i = skipBlockComment(text, i);
            continue;
        }
        if (c === ",") {
            const j = skipTrivia(text, i + 1);
            if (j < n && (text[j] === "}" || text[j] === "]")) {
                offsets.push(i);
            }
            i++;
            continue;
        }
        i++;
    }

    return offsets;
}

/**
 * 计算某个下标对应的行号与列号（均为 1 起始），用于输出报告。
 * @param {string} text
 * @param {number} offset
 */
function lineColumnAt(text, offset) {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, column: offset - lineStart + 1 };
}

/**
 * 删除全部尾随逗号。
 * @param {string} text
 * @returns {{text: string, removed: number, offsets: number[]}}
 */
function removeTrailingCommas(text) {
    const offsets = findTrailingCommas(text);
    if (offsets.length === 0) {
        return { text, removed: 0, offsets };
    }

    let out = "";
    let prev = 0;
    for (const offset of offsets) {
        out += text.slice(prev, offset);
        prev = offset + 1;
    }
    out += text.slice(prev);

    return { text: out, removed: offsets.length, offsets };
}

module.exports = {
    findTrailingCommas,
    removeTrailingCommas,
    lineColumnAt,
    skipTrivia,
};
