"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const { findTrailingCommas, removeTrailingCommas, lineColumnAt } = require("./lib/trailingComma");

const CONFIG_SECTION = "maapvzJsonc";
const DEFAULT_TARGET_DIRS = ["assets/resource/pipeline", "assets/resource/task"];

/** @type {vscode.OutputChannel} */
let output;

function toPosix(value) {
    return String(value).replace(/\\/g, "/");
}

function normalizeDir(dir) {
    return toPosix(dir).replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function log(message) {
    if (output) output.appendLine(message);
}

/* ------------------------------------------------------------------ *
 * 目标范围判定
 * ------------------------------------------------------------------ */

function getTargetDirs() {
    const configured = vscode.workspace.getConfiguration(CONFIG_SECTION).get("targetDirectories");
    const dirs = Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_TARGET_DIRS;
    return dirs.map(normalizeDir).filter(Boolean);
}

function isRemoveOnSaveEnabled() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get("removeOnSave", true) === true;
}

/** 该绝对路径是否位于配置的目标目录下。 */
function isTargetPath(fsPath) {
    const p = toPosix(fsPath);
    for (const dir of getTargetDirs()) {
        if (p === dir || p.includes("/" + dir + "/")) return true;
    }
    return false;
}

function isTargetDocument(document) {
    if (document.uri.scheme !== "file") return false;
    if (document.languageId !== "json" && document.languageId !== "jsonc") return false;
    return isTargetPath(document.uri.fsPath);
}

/** 把目标目录解析为绝对路径（基于工作区根目录，无工作区时退回 cwd）。 */
function resolveTargetDirs() {
    const roots = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
    if (roots.length === 0) roots.push(process.cwd());

    const resolved = new Set();
    for (const dir of getTargetDirs()) {
        for (const root of roots) {
            const abs = path.join(root, dir);
            if (fs.existsSync(abs)) resolved.add(abs);
        }
    }
    return [...resolved];
}

/** 递归收集目标目录下的 .json / .jsonc 文件。 */
function walkFiles(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            walkFiles(full, out);
        } else if (/\.(json|jsonc)$/i.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function collectTargetFiles() {
    const files = new Set();
    for (const dir of resolveTargetDirs()) {
        walkFiles(dir, []).forEach((file) => files.add(path.normalize(file)));
    }
    return [...files].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 * 实际清理
 * ------------------------------------------------------------------ */

function charRange(document, offset) {
    return new vscode.Range(document.positionAt(offset), document.positionAt(offset + 1));
}

/** 对“已打开的文档”用 WorkspaceEdit 清理，返回删除数量。 */
async function stripOpenDocument(document) {
    const offsets = findTrailingCommas(document.getText());
    if (offsets.length === 0) return 0;

    const edit = new vscode.WorkspaceEdit();
    for (let i = offsets.length - 1; i >= 0; i--) {
        edit.delete(document.uri, charRange(document, offsets[i]));
    }
    const applied = await vscode.workspace.applyEdit(edit);
    return applied ? offsets.length : 0;
}

function findOpenDocument(fsPath) {
    const target = path.normalize(fsPath).toLowerCase();
    return vscode.workspace.textDocuments.find(
        (doc) => doc.uri.scheme === "file" && path.normalize(doc.uri.fsPath).toLowerCase() === target,
    );
}

/* ------------------------------------------------------------------ *
 * 命令：清除当前文件
 * ------------------------------------------------------------------ */

async function commandRemoveInFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage("没有打开的文件。");
        return;
    }
    const document = editor.document;
    if (!isTargetDocument(document)) {
        vscode.window.showWarningMessage(
            `该文件不在生效目录内（当前生效目录：${getTargetDirs().join("、")}），未做修改。`,
        );
        return;
    }

    const removed = await stripOpenDocument(document);
    if (removed === 0) {
        vscode.window.showInformationMessage("未发现尾随逗号，文件已经很干净。");
        return;
    }
    await document.save();
    log(`[当前文件] ${vscode.workspace.asRelativePath(document.uri)}：删除 ${removed} 处尾随逗号`);
    vscode.window.showInformationMessage(`已清除 ${removed} 处尾随逗号。`);
}

/* ------------------------------------------------------------------ *
 * 命令：清除整个工作区（pipeline / task）
 * ------------------------------------------------------------------ */

async function commandRemoveInWorkspace() {
    const files = collectTargetFiles();
    if (files.length === 0) {
        vscode.window.showWarningMessage(
            `未找到目标文件。请确认已打开仓库根目录，且存在：${getTargetDirs().join("、")}`,
        );
        return;
    }

    let changedFiles = 0;
    let removedTotal = 0;
    const failures = [];

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "清除尾随逗号", cancellable: false },
        async (progress) => {
            const step = 100 / files.length;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                progress.report({
                    message: `${i + 1}/${files.length} ${path.basename(file)}`,
                    increment: step,
                });
                try {
                    const open = findOpenDocument(file);
                    if (open) {
                        const removed = await stripOpenDocument(open);
                        if (removed > 0) {
                            await open.save();
                            changedFiles++;
                            removedTotal += removed;
                            log(`[工作区] ${vscode.workspace.asRelativePath(open.uri)}：删除 ${removed} 处`);
                        }
                        continue;
                    }

                    const original = fs.readFileSync(file, "utf8");
                    const result = removeTrailingCommas(original);
                    if (result.removed === 0) continue;
                    fs.writeFileSync(file, result.text, "utf8");
                    changedFiles++;
                    removedTotal += result.removed;
                    log(
                        `[工作区] ${vscode.workspace.asRelativePath(vscode.Uri.file(file))}：删除 ${result.removed} 处`,
                    );
                } catch (error) {
                    failures.push(`${file}: ${error && error.message ? error.message : error}`);
                }
            }
        },
    );

    const summary = `扫描 ${files.length} 个文件，修改 ${changedFiles} 个，共删除 ${removedTotal} 处尾随逗号。`;
    log(summary);
    if (failures.length > 0) {
        log(`失败 ${failures.length} 个：`);
        failures.forEach((item) => log(`  ${item}`));
        vscode.window.showWarningMessage(`${summary} 其中 ${failures.length} 个文件失败，详见输出面板。`);
        output.show(true);
        return;
    }
    vscode.window.showInformationMessage(summary);
}

/* ------------------------------------------------------------------ *
 * 命令：只检查不修改
 * ------------------------------------------------------------------ */

async function commandCheckWorkspace() {
    const files = collectTargetFiles();
    if (files.length === 0) {
        vscode.window.showWarningMessage("未找到目标文件。");
        return;
    }

    let total = 0;
    let offenders = 0;
    const lines = [];

    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch (error) {
            lines.push(`! 无法读取 ${file}: ${error.message}`);
            continue;
        }
        const offsets = findTrailingCommas(text);
        if (offsets.length === 0) continue;

        offenders++;
        total += offsets.length;
        const rel = vscode.workspace.asRelativePath(vscode.Uri.file(file));
        lines.push(`${rel}  (${offsets.length} 处)`);
        for (const offset of offsets) {
            const { line, column } = lineColumnAt(text, offset);
            lines.push(`    ${line}:${column}`);
        }
    }

    log("");
    log(`===== 检查结果 ${new Date().toLocaleString()} =====`);
    if (total === 0) {
        log(`扫描 ${files.length} 个文件，未发现尾随逗号。`);
        vscode.window.showInformationMessage(`扫描 ${files.length} 个文件，未发现尾随逗号。`);
    } else {
        lines.forEach((line) => log(line));
        log(`扫描 ${files.length} 个文件，${offenders} 个文件存在尾随逗号，共 ${total} 处。`);
        vscode.window.showWarningMessage(`${offenders} 个文件存在尾随逗号，共 ${total} 处，详见输出面板。`);
    }
    output.show(true);
}

/* ------------------------------------------------------------------ *
 * 保存时自动清理
 * ------------------------------------------------------------------ */

const onWillSave = vscode.workspace.onWillSaveTextDocument((event) => {
    if (!isRemoveOnSaveEnabled()) return;
    if (!isTargetDocument(event.document)) return;

    const document = event.document;
    const offsets = findTrailingCommas(document.getText());
    if (offsets.length === 0) return;

    const edits = offsets.map((offset) => vscode.TextEdit.delete(charRange(document, offset)));
    event.waitUntil(Promise.resolve(edits));
    log(`[保存时] ${vscode.workspace.asRelativePath(document.uri)}：删除 ${offsets.length} 处尾随逗号`);
});

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

function activate(context) {
    output = vscode.window.createOutputChannel("MAAPVZ 尾随逗号");

    context.subscriptions.push(
        output,
        onWillSave,
        vscode.commands.registerCommand("maapvzJsonc.removeInFile", commandRemoveInFile),
        vscode.commands.registerCommand("maapvzJsonc.removeInWorkspace", commandRemoveInWorkspace),
        vscode.commands.registerCommand("maapvzJsonc.checkWorkspace", commandCheckWorkspace),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                log(
                    `配置已更新。生效目录：${getTargetDirs().join("、")}；保存时自动清理：${isRemoveOnSaveEnabled()}`,
                );
            }
        }),
    );

    log("MAAPVZ 尾随逗号插件已激活。");
    log(`生效目录：${getTargetDirs().join("、")}`);
    log(`保存时自动清理：${isRemoveOnSaveEnabled() ? "开" : "关"}`);
}

function deactivate() {
    /* 无需清理 */
}

module.exports = { activate, deactivate };