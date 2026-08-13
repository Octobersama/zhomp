# omp-zh — OMP 中文汉化插件

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

为 [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi) 提供**非破坏性、可插拔**的中文汉化。

- **可插拔**：安装后即汉化，卸载后完全恢复英文，官方 `omp` 命令始终不受影响
- **非破坏**：不修改任何官方文件（`dist/cli.js`、`node_modules` 均保持原样），官方更新后自动适配
- **覆盖范围**：设置界面（`/settings`）的 tab、分组、设置项名称、选项与描述

## 效果

| 项目 | 汉化前 | 汉化后 |
|------|--------|--------|
| Tab | Appearance / Model / Interaction… | 外观 / 模型 / 交互… |
| 分组 | Theme / Status Line / Display… | 主题 / 状态栏 / 显示… |
| 设置项 | Dark Theme / Symbol Preset… | 深色主题 / 符号预设… |

## 原理

omp 官方**没有 i18n 机制**，设置界面字符串硬编码在 `settings-schema` 模块中：

- 官方 `omp` 命令运行的是 **bundle**（`dist/cli.js`），schema 被内联，外部插件无法触及 → 无法汉化
- 本项目用 **源码模式**（`bun <pkg>/src/cli.ts`）启动，此时汉化扩展与主程序共享同一模块实例，扩展在加载阶段改写 schema 的 `label/description/group/options` 字符串

因此：
- `omp-zh` 命令 = 源码模式 + 汉化扩展 → 中文界面
- `omp` 命令 = 官方 bundle → 英文界面（互不干扰）

## 安装

要求：已通过 `bun install -g @oh-my-pi/pi-coding-agent` 安装 omp。

### Windows (PowerShell)

```powershell
cd omp-zh
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

### macOS / Linux

```bash
cd omp-zh
bash scripts/install.sh
```

## 使用

```bash
omp-zh          # 中文界面（源码模式，建议在 Windows Terminal 中使用）
omp             # 官方原版（英文，不受影响）
```

## 卸载

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

### macOS / Linux

```bash
bash scripts/uninstall.sh
```

卸载会删除扩展文件、字典与 `omp-zh` 启动命令，界面完全恢复英文。

## 文件结构

```
omp-zh/
├── extensions/omp-zh.ts   # 汉化扩展（设置界面 schema 改写）
├── dict/zh-CN.json        # en→zh 翻译字典（1878 条）
├── scripts/
│   ├── install.sh         # macOS/Linux 安装
│   ├── install.ps1        # Windows 安装
│   ├── uninstall.sh       # macOS/Linux 卸载
│   └── uninstall.ps1      # Windows 卸载
└── package.json           # 插件元数据（omp.extensions 声明）
```

## 兼容性

- 不修改任何官方文件，`bun install -g @oh-my-pi/pi-coding-agent` 更新后无需重装本插件
- 官方 schema 变更时：已覆盖的字符串自动适配新版本；未覆盖的新字符串保持英文（不会报错）
- 只翻译显示文本，绝不翻译配置项的 `value`（程序逻辑键），配置值不受影响

## 已知限制

- 仅设置界面汉化；主界面消息区、状态栏等其余 TUI 文案无官方挂载点（官方无 i18n API）
- 设置面板框架标题 `Settings`、底部提示行、`Preview:` 等为组件内硬编码字符串，无法经插件覆盖
- 源码模式启动比官方 bundle 稍慢（bun 即时编译 TS）

## 翻译字典维护

`dict/zh-CN.json` 为 `en → zh` 映射。新增翻译时：

```json
{
  "English Text": "中文文本"
}
```

字典支持通过环境变量 `OMP_ZH_DICT` 指向自定义路径，便于覆盖官方默认字典。

## 许可

[MIT](LICENSE)
