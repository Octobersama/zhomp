# zhomp 安装与使用

## 支持范围

zhomp 2.1 起支持 **OMP >=18.3.2 <19**、**Bun >=1.4.2**；历史本机验证覆盖 OMP 18.3.2、18.4.12，本轮验证宿主为 18.8.4。CI 从 `package.json` 的 peer 范围派生最低支持版，与当期最新版组成矩阵；本机结果不代表其他平台或远端 CI。安装、启动和翻译复用 `runtime/host.ts` 的宿主契约，检查具体 SemVer 版本、包身份、pi-tui 依赖及显示接口，并从选定宿主解析实际模块绝对路径。兼容版本升级可继续使用现有 zhomp；19.x 或内部接口变化需更新 zhomp。

```bash
bun --version
bun install -g @oh-my-pi/pi-coding-agent
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

两种入口使用同一个 Bun 安装核心。它先检查 Bun、OMP 兼容范围、实际宿主源码接口和字典，再准备完整文件，最后替换安装产物。产物目标为普通目录、有效符号链接或悬空符号链接时，在任何发布前拒绝覆盖。可捕获的替换失败会恢复原有文件；这不是跨目录的掉电事务保证。

安装命令会列出包路径和生成文件。看到“安装完成”只说明安装过程成功；还需执行下文的版本和设置界面验证。

本轮新增 `/model` 基础文案翻译及运行文件 `model-ui.ts`，并在启动 preload 阶段注册转换。从旧安装升级时需重新运行安装脚本，部署完整扩展、字典、启动器和运行模块；只替换字典不足以启用新功能。

### 安装路径

安装根按顺序选择：`OMP_ZH_HOME` → Windows 的 `USERPROFILE` → `HOME` → 操作系统用户主目录。Bun 包的位置独立于安装根，改变安装根不要求把 OMP 再安装一遍。

| 相对于安装根的路径 | 用途 |
|---|---|
| `.omp/agent/extensions/zhomp.ts` | 汉化扩展 |
| `.omp/zh/dict.json` | 默认字典 |
| `.omp/zh/launch.ts` | 启动引导及 preload |
| `.omp/zh/host.ts` | 安装、启动及翻译共用的宿主身份、版本和模块路径契约 |
| `.omp/zh/model-ui.ts` | Model 页精确模块路径及固定文案白名单转换，不改写官方文件 |
| `.omp/zh/launch.json` | 宿主绝对目录、兼容范围、扩展和字典绝对路径；实际模块路径在启动时重新解析 |
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

`OMP_ZH_PACKAGE_DIR` 是可选的显式包目录。未设置时，安装器读取 `BUN_INSTALL_GLOBAL_DIR`、Bun 全局/当前项目 `bunfig.toml` 中的 `install.globalDir`，再检查默认安装位置。显式路径或配置指向不兼容版本时明确报错，不静默切换到另一个包。自定义 globalDir 与 globalBinDir 可以彼此独立。

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

版本应输出当前实际安装的 `omp/<版本>`（本轮验证为 `omp/18.8.4`）。在真实交互终端输入 `/settings`，检查 tab、分组、设置项、描述、选项和 warning 中已有字典覆盖的文本显示中文，例如“外观”“深色主题”。配置的实际值不会翻译，单位、专有名词和未命中文本保留原文。

用官方 `omp` 再打开 `/settings`，应保持英文。日志和 `--version` 都不能单独证明汉化：必须检查实际设置表面。若 `/settings` 被当普通消息发出，说明没有进入斜杠命令处理，应先检查交互终端启动方式。

### Model 页面部分翻译

输入 `/model`（或 `/models`），检查“模型”“角色”“全部模型”等栏目标题、基础说明、操作提示和通用空状态提示显示中文；内建及用户自定义角色的名称和标签一律作为专有名词保留原文，包括 DEFAULT、SMOL 等内建标签。OMP 18.8.4 的预设栏目及切换提示也属于基础文案，实际预设名称保留原文。模型名、provider 名、模型 ID/selector、快捷键、技术种类、价格、容量和思考参数保留原文；详细 provider 诊断等未覆盖文本仍为英文。这不是全界面汉化，也不改变 Alt+P 的独立临时模型选择器。

固定文案在所选宿主的 ModelHub 模块解析前做内存转换；角色数据从不参与转换，角色名称和标签不因其为默认角色或与内建值匹配而翻译。源码锚点或出现次数不符时整页保留原文并记录 `[zhomp]` 诊断，不做模糊替换或配置改写。`zhomp --no-extensions` 和官方 `omp` 应保持英文。

启动顺序：Model hook 由 preload 在宿主扩展加载器之前注册；设置元数据仍由 async 扩展 factory 翻译。两者遵循当前进程授权和宿主的禁用扩展参数语义。


启动引导从宿主目录启动真实 `src/cli.ts`，preload 在宿主初始化前恢复调用者目录；不把源码 CLI 当库包装成另一主入口，因此保留宿主 worker 的主入口行为。对正常启动显式传入安装根的扩展，禁用扩展选项由宿主参数解析器解释。两个 Bun 启动边界各自提供分隔符，保留用户自己的 `--`；参数值中的 `--no-extensions` 不会被误当作选项，等号形式也遵循宿主语义。

扩展要求 `OMP_ZH_ENABLED=1` 且授权 PID 等于当前进程。普通官方命令以及仅继承父进程标记的其他进程不会启用。启动器通过内部的绝对 `OMP_ZH_CONFIG` 指定 `launch.json`；扩展从其同目录加载安装随附的 `host.ts` 并重新校验宿主。`OMP_ZH_CONFIG`、`OMP_ZH_PROCESS_ID` 和 bootstrap 变量由启动器管理，不应手工设置；`OMP_ZH_PACKAGE_DIR` 仍是安装时的包选择选项，不再作为运行期转发协议。

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

全量行为测试包含真实宿主的字典覆盖检查，必须先安装兼容 OMP。测试与验证沿用安装器的包发现规则（含自定义 globalDir），显式路径或配置错误会失败，不会换用默认副本或静默跳过覆盖检查。字典门禁在原始 JSON 层检查重复键，并按明确的技术文本和数值单位保留规则检查显示字段，不以单词数量或整个设置类别豁免翻译。

```bash
bun install --frozen-lockfile
bun run typecheck
bun test tests
bun run verify
bun run verify -- --case V10
bun run verify -- --require-all
bun pm pack --dry-run --ignore-scripts
```

验证入口按 V01–V11 输出 PASS/FAIL/SKIP，失败返回非零；`--require-all` 还拒绝 SKIP。V10 先安装到临时目录，再通过已安装的 `host.ts`、`launch.json` 和扩展，验证真实 SettingsHost 与 SettingsSelector 组件；此前 OMP 18.4.12 验收输出 entries=397、loader=true、component=SettingsSelectorComponent，并检查动态 getter、配置 id/default/enum、共享 group 和普通 PID 隔离。组件渲染不冒充完整 `/settings` 交互；最终发布仍要求在真实终端打开该面板。

V10 另以独立进程检查真实 ModelHub：普通 PID 隔离、正常字典及含引号/模板符号/替换符号的自定义字典；覆盖 ANSI 渲染、宿主提供的 native 描述、内建/自定义角色名称及标签保留原文、键盘选择的 role/provider/model/selector 不变、80/160 列宽度和独立 ModelBrowser 仍为英文。数据是隔离的显示夹具，无远程模型调用或配置持久化；缺少 native 描述能力时明确打印 `unavailable@<版本>`，不冒充该渲染路径通过。最终仍需真实终端 `/model` 验收。


此前在 OMP 18.4.12 的隔离原生终端中打开了实际 `/settings`：zhomp 的 tab、分组、设置名称及描述显示中文；官方 omp 即使显式加载同一扩展并继承启用标记，在授权 PID 不匹配时仍保持英文。该 smoke 使用临时 startup 配置关闭首次启动向导，没有配置模型或进行模型对话；它是界面抽查，不是所有条目逐项视觉验收。

Model 功能及角色名称保留修正在 Windows/Bun 1.4.2 上针对 OMP 18.3.2、18.4.12 分别通过 24 个行为测试及 V01–V11。当前版覆盖 ANSI、generic native 和 native picker；18.3.2 无 native 描述能力，仅报告 ANSI 与键盘消费链通过。修正后在 OMP 18.4.12 的原生 Windows Terminal 中再次打开 Model 面板，观察到中文栏目标题、说明和底部操作提示，DEFAULT、SMOL、SLOW、PLAN 等角色标签以及模型/provider/ID 全部保留原文。此前同一功能的官方命令（错误授权 PID）和 `zhomp --no-extensions` 原生隔离对照保持英文。原生抽查没有发送模型对话或执行模型赋值，不代表逐项视觉验收或其他平台通过。

OMP 18.8.4 适配轮在 Windows/Bun 1.4.2 上通过类型检查、24 个行为测试（含真实设置字典覆盖）及 V01–V11，无 SKIP。SettingsSelector 输出 entries=404，ModelHub ANSI/native、内建及自定义角色、预设名称身份和配置隔离断言通过。18.3.2、18.4.12 的缓存源码通过转换及语法检查，本轮未重跑这两个旧版本的完整运行时矩阵。已重新部署日常安装，并核对已安装字典和 Model runtime 的 SHA-256 与源码一致。助手尝试原生终端验收，但实时桌面控制授权两次超时，未打开实际面板。随后用户亲自检查 `/settings` 和 `/model`，确认页面正常；本轮真实交互验收依据为用户确认，不是助手截图，也不代表逐项视觉验收或其他平台通过。


发布包必须包含本指南、README、许可证、字典、扩展、两个安装/卸载入口及安装核心、启动引导、共享 `runtime/host.ts` 和 `runtime/model-ui.ts`。解包后需检查本地链接并运行安装命令，不能只凭打包退出码判断完整性。卸载清单包含两个安装后的运行模块，仍无需 Bun。

历史本机验收（2.0.0）覆盖 OMP 18.3.2、Windows/PowerShell 5.1/cmd/Git Bash；2.1.0 本机 OMP 18.4.1 的 SettingsSelector 验证 entries=387 且动态描述中文可见。此前审查改进轮在 Windows 的 OMP 18.3.2、18.4.12 上通过 21 个行为测试及 V01–V11，SettingsSelector 分别渲染 entries=385 和 397。CI 覆盖 Windows/Linux/macOS 的最低版与当期最新版；本轮没有远端 CI 或其他 OS 验证结果，不应据此声称已通过。

## 已知限制

- 覆盖 `/settings` 元数据和 `/model` 的基础交互文案；主消息区、状态栏、独立临时模型选择器、详细诊断和设置组件硬编码的 `Settings`、`Preview:` 等仍可能为英文。
- 源码模式有即时编译开销，不承诺固定增加多少秒。
- 官方内部模块变更需要重新适配；范围校验通过不保证任意未来版本都可汉化，运行时形状检查失败会跳过翻译并报告原因。
- 普通写入错误能恢复安装前状态；进程强杀、断电或恢复步骤自身发生存储错误不具备跨目录事务保证。
