# JSONC 尾随逗号清除器（MAAPVZ）

一个极小的 VSCode 插件，用来删除这些目录下 JSON/JSONC 文件的**尾随逗号**：

- `assets/resource/pipeline/**`
- `assets/resource/task/**`

## 它做了什么

尾随逗号指「逗号后面（跳过空白和注释）紧跟 `}` 或 `]`」，例如：

```jsonc
{
    "option": {
        "选择植物碎片": {
            "type": "checkbox", // 紫卡
        },
    },
}
```

清理后：

```jsonc
{
    "option": {
        "选择植物碎片": {
            "type": "checkbox" // 紫卡
        }
    }
}
```

关键特性：

- **只删逗号这一个字符**，其它字节一律不动。
- **完整保留注释**（`//` 与 `/* */`）。
- **完整保留原有缩进、空行与 CRLF 换行**，不会重排文件、不会重新格式化。
- **不会误删字符串里的逗号**，例如 `"a,b"`、`"@0.1;multi:(1阳光起始,1阳光终点,100)"`。
- **不会误删对象/数组中间的逗号**，例如 `{"a": 1, /* 说明 */ "b": 2}`。
- 幂等：对已经干净的文件运行不会有任何改动。

## 三种用法

### 1. 保存时自动清理（默认开启）

只要插件处于启用状态，保存这两个目录里的 `.json` / `.jsonc` 文件时就会自动删掉尾随逗号。
不需要按任何快捷键，改完直接 `Ctrl+S` 即可。

### 2. 命令面板手动执行

按 `Ctrl+Shift+P` 打开命令面板，输入 `MAAPVZ`，有三个命令：

| 命令 | 作用 |
| --- | --- |
| `MAAPVZ: 清除尾随逗号：当前文件` | 只处理当前正在编辑的文件 |
| `MAAPVZ: 清除尾随逗号：工作区 pipeline / task 全部文件` | 批量处理全部目标文件（带进度条） |
| `MAAPVZ: 检查尾随逗号（只报告，不修改）` | 只列出问题位置，不写盘；结果显示在「输出」面板 |

### 3. 命令行（可选）

插件目录下还带了一个 CLI，和插件共用同一套判定逻辑：

```bash
cd vscode-extension

node bin/cli.js --check      # 只检查，有尾随逗号则退出码 1
node bin/cli.js --dry-run    # 预览会改哪些文件
node bin/cli.js --verbose    # 打印每个逗号的行号列号
node bin/cli.js              # 就地清理
node bin/cli.js <路径...>    # 处理指定文件/目录
```

## 配置项

在 `settings.json` 里（`Ctrl+,` 搜索 `maapvzJsonc`）：

```jsonc
{
    // 保存时自动清理，默认 true
    "maapvzJsonc.removeOnSave": true,

    // 生效目录，相对仓库根目录，默认就是这两个
    "maapvzJsonc.targetDirectories": ["assets/resource/pipeline", "assets/resource/task"]
}
```

## 安全说明

- 插件**只**对生效目录内的文件动作；打开别的 JSON 文件不会受影响。
- 批量命令会在动手前读取文件内容，只有确实命中尾随逗号才写盘。
- 建议先跑一次 `MAAPVZ: 检查尾随逗号` 或 `node bin/cli.js --dry-run` 看看范围。

## 安装 / 卸载

安装（把本目录复制到 VSCode 扩展目录）：

```powershell
Copy-Item -Recurse -Force . "$env:USERPROFILE\.vscode\extensions\maapvz.jsonc-trailing-comma-0.1.0"
```

然后**重启 VSCode**（或执行 `Developer: Reload Window`）。

卸载：直接删除 `%USERPROFILE%\.vscode\extensions\maapvz.jsonc-trailing-comma-0.1.0` 目录并重启。