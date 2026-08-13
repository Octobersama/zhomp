# zhomp 安装与使用教程

本教程面向最终用户：从零安装 zhomp、验证汉化、日常使用与卸载。

---

## 1. 前置要求

| 要求 | 说明 |
|------|------|
| **bun** | 运行时。安装：[https://bun.sh](https://bun.sh) |
| **omp (oh-my-pi)** | 必须通过 bun 全局安装：`bun install -g @oh-my-pi/pi-coding-agent` |
| **终端** | 推荐 Windows Terminal（默认 UTF-8）；用传统 cmd/PowerShell 请先 `chcp 65001` |

检查是否满足：

```bash
bun --version          # 应输出版本号
omp --version          # 应输出 omp/<版本>
```

> 国内网络若安装 omp 缓慢，可设置镜像：`bun install -g @oh-my-pi/pi-coding-agent --registry https://registry.npmmirror.com`

---

## 2. 安装

### Windows（PowerShell）

```powershell
cd zhomp
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

### macOS / Linux

```bash
cd zhomp
bash scripts/install.sh
```

安装脚本会：
1. 自动检测 `@oh-my-pi/pi-coding-agent` 全局包位置
2. 复制汉化扩展到 `~/.omp/agent/extensions/zhomp.ts`
3. 复制翻译字典到 `~/.omp/zh/dict.json`
4. 生成 `zhomp` 启动命令（源码模式）

看到 `OK: zhomp installed`（或 `✅ zhomp 安装完成`）即安装成功。

---

## 3. 验证汉化

```bash
zhomp --version        # 冒烟：应输出 omp/<版本>
```

启动并进入设置界面：

```bash
zhomp
# 在输入框输入: /settings
```

预期看到中文界面：

```
🎨 外观    🤖 模型    ⌨ 交互    📋 上下文    🧠 记忆    📁 文件    💻 终端    🔧 工具    📦 任务
主题 / 状态栏 / 显示 / 图像
深色主题 / 浅色主题 / 符号预设 / 色盲友好模式 ...
```

启动日志中应出现：

```
[zhomp] 汉化完成: label 41, description 37, group 9, option 文本 132（字典 1878 条）
```

> 数字会随 omp 版本变化，只要出现 `[zhomp] 汉化完成` 即说明生效。

---

## 4. 日常使用

| 命令 | 效果 |
|------|------|
| `zhomp` | 中文界面（源码模式 + 汉化扩展） |
| `omp` | 官方原版英文界面（不受影响） |

- 两个命令共用同一份配置、会话与数据，随时可切换。
- 日常建议固定使用 `zhomp`。
- 官方更新后无需重装 zhomp：`bun install -g @oh-my-pi/pi-coding-agent` 更新 omp 即可，汉化自动适配新版本。

---

## 5. 卸载

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

### macOS / Linux

```bash
bash scripts/uninstall.sh
```

卸载会删除：扩展文件、翻译字典、`zhomp` 启动命令。之后：

- `omp` 恢复英文界面
- `zhomp` 命令不再存在

> 卸载不会删除你的任何配置、会话或数据，只移除汉化组件。

---

## 6. 常见问题

### 6.1 官方 `omp` 界面是英文，正常吗？

正常。官方 `omp` 运行的是 bundle（`dist/cli.js`），schema 已内联，插件无法触及。这是设计使然：**保证官方命令零影响**。请使用 `zhomp` 命令获得中文界面。

### 6.2 打开 `/settings` 后界面乱码（如 `è®¾ç½®`）

终端未按 UTF-8 渲染。解决：

- **推荐**：使用 Windows Terminal
- 或在 cmd/PowerShell 中先执行：`chcp 65001`

### 6.3 输入 `/settings` 没反应，像是发给模型了

确认你是用 `zhomp` 启动的（而非 `omp`），且 `/settings` 是 omp 内置命令。若在非交互 PTY 中测试，`/settings` 可能被当作消息——请直接在交互终端中使用。

### 6.4 `[zhomp] dict.json 不存在`

安装脚本未成功复制字典。重新运行安装脚本；或手动确认 `~/.omp/zh/dict.json` 存在。

### 6.5 官方更新后某些新设置是英文

预期行为。字典按英文原文匹配，新增的未翻译字符串保持英文，不影响功能。可自行补充翻译（见下节）。

### 6.6 想自定义翻译？

设置环境变量 `OMP_ZH_DICT` 指向自己的字典文件（en→zh JSON），覆盖默认字典：

```bash
export OMP_ZH_DICT=/path/to/my-dict.json   # macOS/Linux
set OMP_ZH_DICT=C:\path\to\my-dict.json    # Windows cmd
$env:OMP_ZH_DICT = "C:\path\to\my-dict.json"  # Windows PowerShell
```

### 6.7 为什么 `zhomp` 启动比 `omp` 慢一点？

源码模式需要 bun 即时编译 TypeScript，比官方预构建 bundle 慢一两秒，属正常现象。

---

## 7. 翻译字典（可选）

`dict/zh-CN.json` 是 en→zh 映射，当前 1878 条。格式：

```json
{
  "English Text": "中文文本"
}
```

想贡献翻译：在字典中新增条目，保持 UTF-8 编码，提交 PR 即可。

---

## 8. 相关链接

- 项目仓库：[https://github.com/vanness30214/zhomp](https://github.com/vanness30214/zhomp)
- omp 官方：[https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
- 许可证：MIT
