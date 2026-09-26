# zhomp 安装与使用

## 支持范围

zhomp 2.x 当前只支持 **OMP 18.3.2**，需要 **Bun >=1.4.2**。精确支持版本以 `package.json` 的 peerDependencies 为准；安装器和启动器拒绝其他 OMP 版本，包括 18.3.1、18.3.3。升级 OMP 前先确认新的 zhomp 版本已支持它。

```bash
bun --version
bun install -g @oh-my-pi/pi-coding-agent@18.3.2
omp --version
```

目标平台为 Windows PowerShell 5.1/cmd、Git Bash、Linux 和 macOS。原生平台验证由 CI 矩阵分别执行；某个平台的测试通过不能代替另一平台的实机证据。

## 安装

在下载或克隆的 zhomp 目录执行：

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

macOS、Linux、Git Bash：

```bash
bash scripts/install.sh
```

两种入口使用同一个 Bun 安装核心。它先检查 Bun、OMP 身份/精确版本、宿主源码接口和字典，再准备完整文件，最后替换安装产物。可捕获的替换失败会恢复原有文件；这不是跨目录的掉电事务保证。

安装命令会列出包路径和生成文件。看到“安装完成”只说明安装过程成功；还需执行下文的版本和设置界面验证。

### 安装路径

安装根按顺序选择：`OMP_ZH_HOME` → Windows 的 `USERPROFILE` → `HOME` → 操作系统用户主目录。Bun 包的位置独立于安装根，改变安装根不要求把 OMP 再安装一遍。

| 相对于安装根的路径 | 用途 |
|---|---|
| `.omp/agent/extensions/zhomp.ts` | 汉化扩展 |
| `.omp/zh/dict.json` | 默认字典 |
| `.omp/zh/launch.ts` | 启动引导及 preload |
| `.omp/zh/launch.json` | 已验证的 OMP/TUI 绝对路径、支持版本、扩展和字典路径 |
| `.omp/zh/zhomp.toml` | 独立 Bun 运行配置 |
| `.bun/bin/zhomp` | Bash 安装时生成的命令 |
| `.bun/bin/zhomp.cmd` | Windows 上生成的命令；Git Bash 安装也生成 |

安装器不自动改系统 PATH。默认 Bun 的 bin 通常已在 PATH；若使用自定义安装根，可以用命令的完整路径，或自行将该根的 `.bun/bin` 加入 PATH。

### 自定义路径

Windows：

```powershell
$env:OMP_ZH_HOME = 'D:\Tools\zhomp-home'
$env:OMP_ZH_PACKAGE_DIR = 'D:\Bun\install\global\node_modules\@oh-my-pi\pi-coding-agent'
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
& 'D:\Tools\zhomp-home\.bun\bin\zhomp.cmd' --version
```

Bash：

```bash
export OMP_ZH_HOME="$HOME/zhomp-home"
export OMP_ZH_PACKAGE_DIR="/path/to/node_modules/@oh-my-pi/pi-coding-agent"
bash scripts/install.sh
"$OMP_ZH_HOME/.bun/bin/zhomp" --version
```

`OMP_ZH_PACKAGE_DIR` 是可选的显式包目录。未设置时，安装器读取 `BUN_INSTALL_GLOBAL_DIR`、Bun 全局/当前项目 `bunfig.toml` 中的 `install.globalDir`，再检查默认安装位置。显式路径或配置指向错误版本时明确报错，不静默切换到另一个包。自定义 globalDir 与 globalBinDir 可以彼此独立。

安装与卸载使用同一个 `OMP_ZH_HOME`。启动配置保存的是安装时解析后的路径，运行不需要再次设置该变量；显式扩展路径使非默认根的汉化扩展仍可加载。

## 使用和验收

Windows：

```powershell
zhomp.cmd --version
zhomp.cmd
```

Bash：

```bash
zhomp --version
zhomp
```

版本应输出 `omp/18.3.2`。在真实交互终端输入 `/settings`，检查 tab、分组、设置项、描述、选项和 warning 中已有字典覆盖的文本显示中文，例如“外观”“深色主题”。配置的实际值不会翻译，单位、专有名词和未命中文本保留原文。

用官方 `omp` 再打开 `/settings`，应保持英文。日志和 `--version` 都不能单独证明汉化：必须检查实际设置表面。若 `/settings` 被当普通消息发出，说明没有进入斜杠命令处理，应先检查交互终端启动方式。

启动引导从宿主目录启动真实 `src/cli.ts`，preload 在宿主初始化前恢复调用者目录；不把源码 CLI 当库包装成另一主入口，因此保留宿主 worker 的主入口行为。对正常启动显式传入安装根的扩展，子命令参数保持由宿主路由处理。

扩展要求 `OMP_ZH_ENABLED=1` 且授权 PID 等于当前进程。普通官方命令以及仅继承父进程标记的其他进程不会启用。内部的 `OMP_ZH_PROCESS_ID`、`OMP_ZH_SUPPORTED_VERSION`、`OMP_ZH_TUI_PACKAGE_DIR` 和 bootstrap 变量由启动器管理，不应手工设置。

## 字典

`dict/zh-CN.json` 是英文原文到中文的 JSON 对象，数量由文件计算，不在文档中手工维护。

```json
{
  "English Text": "中文文本"
}
```

修改仓库字典后重新安装，或自行更新安装目录的 `dict.json`。设置 `OMP_ZH_DICT` 可以使用自己的完整字典；显式值优先于默认路径，相对路径以启动命令的调用目录解析。

```powershell
$env:OMP_ZH_DICT = 'D:\translations\custom.json'
```

```bash
export OMP_ZH_DICT=/path/to/custom.json
```

顶层 null、数组、标量或 JSON 语法错误会跳过汉化并给出诊断；混合对象中的非字符串值和空翻译忽略。缺失键保留原文。不翻译程序配置键、选项 value、数字、文件名、单位和专有名词。

## 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

macOS、Linux、Git Bash：

```bash
bash scripts/uninstall.sh
```

卸载无需 Bun。它删除上表的自有文件，仅当 `.omp/zh` 为空才删除目录；旁文件、隐藏文件、子目录、用户配置和会话保留。目录有其他文件也会删除自己的 `dict.json`。重复卸载不会删除额外内容。

自定义安装根时先设置与安装时相同的 `OMP_ZH_HOME`。Windows 路径按字面值处理，带方括号不作为通配符。

## 开发验证与发布

以下命令从源码仓库运行；开发测试不随用户安装包发布。

```bash
bun install --frozen-lockfile
bun run typecheck
bun test tests
bun run verify
bun run verify -- --case V10
bun run verify -- --require-all
bun pm pack --dry-run --ignore-scripts
```

验证入口按 V01–V11 输出 PASS/FAIL/SKIP，失败返回非零；`--require-all` 还拒绝 SKIP。V10 使用真实宿主 SettingsHost 与 SettingsSelector 组件渲染，保护共享对象、显示文本和配置值；它不冒充完整模型会话交互。最终发布还应在真实终端打开 `/settings`。

发布包必须包含本指南、README、许可证、字典、扩展、两个安装/卸载入口及其安装核心、启动引导。解包后需检查本地链接并运行安装命令，不能只凭打包退出码判断完整性。

本次本地证据覆盖 Windows、PowerShell 5.1、cmd 与 Git Bash：V01–V11 的 `--require-all` 验证、真实 PTY 中文 `/settings`、官方英文对照已分别执行。Linux/macOS 的原生安装证据由 `.github/workflows/verify.yml` 矩阵提供；工作流尚未成功执行时，不将配置了 CI 写成该平台已经验证。

## 已知限制

- 仅覆盖设置元数据；主消息区、状态栏和组件硬编码的 `Settings`、底部提示、`Preview:` 等仍可能为英文。
- 源码模式有即时编译开销，不承诺固定增加多少秒。
- 官方内部模块变更需要重新适配；当前不会对未支持版本声称自动兼容。
- 普通写入错误能恢复安装前状态；进程强杀、断电或恢复步骤自身发生存储错误不具备跨目录事务保证。
