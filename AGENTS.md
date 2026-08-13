# AGENTS.md

本文件为在 zhomp 仓库中工作的 AI 编码代理（及人类协作者）提供项目上下文、架构决策与工作约定。

## 项目是什么

zhomp 为 [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi) 提供**非破坏性、可插拔**的中文汉化：安装后以 `zhomp` 命令启动即为中文设置界面，卸载后完全恢复英文；官方 `omp` 命令始终不受影响。

## 核心事实（必须理解，避免重复踩坑）

1. **omp 官方没有 i18n 机制**。设置界面字符串（`Appearance`、`Dark Theme` 等）硬编码在 `packages/coding-agent/src/config/settings-schema.ts` 的 `SETTINGS_SCHEMA` / `TAB_METADATA` / `TAB_GROUPS` 常量中，无 `t()` / locale 文件 / 翻译资源。
2. **官方 `omp` 命令运行的是 bundle**（`dist/cli.js`，schema 已内联混淆）。任何扩展/插件在该模式下都拿不到 schema 对象——扩展 import 磁盘源码 `src/config/settings-schema.ts` 得到的是**第二份模块实例**，mutate 无效（设置界面仍是英文，但也不报错）。
3. **本项目用源码模式启动**：`bun <pkg>/src/cli.ts`。此时主程序与扩展共享同一磁盘模块实例（Bun 模块缓存按路径共享），扩展在加载阶段（早于设置面板首次打开与 `cachedDefs` 构建）改写 schema 字符串即生效。
4. **可插拔的边界**：安装脚本把扩展复制到 `~/.omp/agent/extensions/zhomp.ts`（omp native 自动发现路径，无需注册配置），生成 `zhomp` 启动命令；卸载脚本删除两者即完全恢复。
5. **只翻译显示文本**：`ui.label` / `ui.description` / `ui.group` / `options[].label` / `options[].description`。**绝不翻译 `value`**（`value` 是程序逻辑键，翻译会破坏配置读写）。

## 架构与文件

```
zhomp/
├── extensions/zhomp.ts    # 汉化扩展：加载时改写 settings-schema 显示文本
├── dict/zh-CN.json        # en→zh 字典（键 = 英文原文，值 = 中文译文）
├── scripts/
│   ├── install.sh         # macOS/Linux/Git Bash 安装
│   ├── install.ps1        # Windows 安装（输出纯英文，避免代码页问题）
│   ├── uninstall.sh       # macOS/Linux/Git Bash 卸载
│   └── uninstall.ps1      # Windows 卸载
└── package.json           # npm 元数据；`omp.extensions` 声明扩展入口
```

## 工作约定

### 字典维护（dict/zh-CN.json）

- JSON 格式，键为英文原文、值为中文译文，UTF-8 编码。
- 新增条目示例：
  ```json
  { "English Text": "中文文本" }
  ```
- 词典中已有 `zhomp` 扩展在运行时通过 `OMP_ZH_DICT` 环境变量指向自定义路径（默认 `~/.omp/zh/dict.json`）。
- **不要翻译**：专有名词（OpenAI、Gemini、DeepSeek、Nerd Font、ASCII 等）、单位（KB、tokens）、数字（0.01、1024）、文件名（AGENTS.md、api.kimi.com）。这些在界面中保留英文是正确行为。
- 长度 <4 的字符串除非确有必要，一般不入字典（避免误替换）。
- 字典变更后需重新运行安装脚本（或手动复制到 `~/.omp/zh/dict.json`）才能生效。

### 扩展代码约定（extensions/zhomp.ts）

- 用最小接口视图（`UiMeta` / `SchemaDef` / `UiOption`）描述 schema 结构，**不要** import 完整类型（避免与官方模块实例产生类型耦合，且保持与官方更新兼容）。
- 动态 import：`await import("@oh-my-pi/pi-coding-agent/config/settings-schema")`，保证与主程序共享同一实例。
- 就地改写数组（`TAB_GROUPS`）保持引用不变，避免其他模块持有旧数组。
- 工厂函数为 `async`（官方 loader 会 `await factory(api)`）。
- 日志前缀统一 `[zhomp]`。
- **禁止** `any` / `as any`：用 `unknown` + 类型守卫（`typeof` / `in` 窄化）或最小类型断言。

### 安装/卸载脚本约定

- `install.ps1` / `uninstall.ps1` 的**输出文案用英文**：Windows PowerShell 5.1 默认按 ANSI/GBK 读取无 BOM 的 UTF-8 脚本，中文输出会解析报错。
- `install.sh` / `uninstall.sh` 输出用中文（POSIX shell 环境为 UTF-8）。
- 用户主目录解析顺序：`OMP_ZH_HOME`（显式覆盖，Git Bash 下 `HOME=/root` 为虚拟路径时需要）→ `USERPROFILE`（Windows）→ `HOME`（POSIX）→ `eval echo ~`。
- 卸载脚本只删除自己的文件；删除 `~/.omp/zh` 目录前检查其中是否只剩 `dict.json`，避免误删用户其他文件。
- 安装脚本自动检测 `@oh-my-pi/pi-coding-agent` 全局包位置（`~/.bun/install/global/node_modules/...`），检测不到时给出安装提示。

## 验证

在改动后必须验证：

1. **安装**：`powershell -ExecutionPolicy Bypass -File scripts/install.ps1`（Windows）或 `bash scripts/install.sh`（macOS/Linux）。
2. **冒烟**：`zhomp.cmd --version` 应输出 `omp/<版本>`。
3. **汉化生效**：启动 `zhomp`（建议 `chcp 65001` 或 Windows Terminal 保证 UTF-8 渲染），输入 `/settings`，确认 tab / 分组 / 设置项 / 描述为中文。日志应出现 `[zhomp] 汉化完成: ...`。
4. **英文不受影响**：用官方 `omp` 打开 `/settings`，确认仍为英文。
5. **卸载恢复**：运行卸载脚本后确认 `~/.omp/agent/extensions/zhomp.ts`、`~/.bun/bin/zhomp*`、`~/.omp/zh` 均已删除，`omp` 界面英文。

> 注意：`/settings` 是 omp 内置斜杠命令；在 PTY 测试中若其被当作消息发给模型，说明未进入命令解析，需确认启动方式。

## 已知限制（勿承诺做不到的）

- 仅设置界面汉化。主界面消息区、状态栏等其余 TUI 文案无官方挂载点（官方无 i18n API），无法经插件覆盖。
- 设置面板框架标题 `Settings`、底部提示行（`Enter/Space to change ...`）、`Preview:`、`Plugins` tab 等为组件内硬编码字符串，不经 schema，扩展无法触及。
- 源码模式启动比官方 bundle 稍慢（bun 即时编译 TS）。
- 官方更新后：已覆盖的字符串自动适配新版本；新版本新增的字符串保持英文（不会报错）。若 schema 结构发生破坏性变更（如模块路径变化），扩展会加载失败并输出 `[zhomp] 汉化失败`，官方界面不受影响。

## 发布

- 修改 `package.json` 的 `version` 后提交。
- `repository.url` 已指向 `https://github.com/vanness30214/zhomp.git`。
- 推送：`git push origin main`。
