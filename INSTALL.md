# zhomp 安装与使用

## 支持范围

zhomp 2.1 起支持 **OMP >=18.3.2 <19**、**Bun >=1.4.2**；历史本机验证覆盖 OMP 18.3.2、18.4.12、18.8.4、18.11.1、18.11.2、18.11.3、18.12.0、18.12.1、18.12.3、18.12.6、18.14.0、18.18.2、18.18.8，当前适配宿主为 **18.20.0**。CI 从 `package.json` 的 peer 范围派生最低支持版，与当期最新版组成矩阵；本机结果不代表其他平台或远端 CI。安装、启动和翻译复用 `runtime/host.ts` 的宿主契约，检查具体 SemVer 版本、包身份、pi-tui 依赖及显示接口，并从选定宿主解析实际模块绝对路径。兼容版本升级可继续使用现有 zhomp；19.x 或内部接口变化需更新 zhomp。

还需满足所选 OMP 自身的 Bun 要求：OMP 18.20.0 声明 `Bun >=1.4.4`，当前 CI 使用 Bun 1.4.4。上述 zhomp 的最低 Bun 要求不覆盖宿主自己的运行要求。

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

授权 preload 在宿主初始化界面之前注册设置消费者、ModelHub 及已覆盖菜单模块的精确源码转换；async 扩展 factory 翻译 SettingsHost 元数据，斜杠命令说明在扩展中处理。所有转换仅修改内存显示。旧安装升级需重新运行安装脚本，部署扩展、运行模块和字典；只替换字典不足以启用新功能。

### 安装路径

安装根按顺序选择：`OMP_ZH_HOME` → Windows 的 `USERPROFILE` → `HOME` → 操作系统用户主目录。Bun 包的位置独立于安装根，改变安装根不要求把 OMP 再安装一遍。

| 相对于安装根的路径 | 用途 |
|---|---|
| `.omp/agent/extensions/zhomp.ts` | 汉化扩展 |
| `.omp/zh/dict.json` | 默认字典 |
| `.omp/zh/launch.ts` | 启动引导及 preload |
| `.omp/zh/host.ts` | 安装、启动及翻译共用的宿主身份、版本和模块路径契约 |
| `.omp/zh/model-ui.ts` | Model 页精确模块路径及固定文案白名单转换，不改写官方文件 |
| `.omp/zh/settings-ui.ts` | 真实设置消费者追加环境变量说明前的精确内存翻译；不改官方设置组件文件 |
| `.omp/zh/diagnostics.ts` | preload／扩展共同的故障通知队列，仅在 UI 可用后发送 |
| `.omp/zh/model-text.ts` | Model 固定显示文案白名单；与开发字典完整性检查共用 |
| `.omp/zh/menu-ui.ts` | 已覆盖菜单的精确路径、整模块校验和内存文案转换 |
| `.omp/zh/menu-catalog.ts` | 菜单显示表达式目录，不接收任意用户字符串 |
| `.omp/zh/menu-text.ts` | 菜单固定文案白名单，与开发字典完整性检查共用 |
| `.omp/zh/menu-management.ts` | MCP 管理、Agent Hub、会话信息及固定报告文案 |
| `.omp/zh/menu-agent-views.ts` | Agent Hub 转录子视图和活动回退文案 |
| `.omp/zh/menu-command-menus.ts` | 审查／批注的内建选择菜单与输入提示 |
| `.omp/zh/menu-workflow.ts` | 会话咨询、修复检查、粘贴与分支／会话确认文案 |
| `.omp/zh/menu-extensions.ts` | 扩展分类、详情和预览的固定外壳文案 |
| `.omp/zh/menu-setup.ts` | 首次设置向导的固定标题、步骤及导航文案 |
| `.omp/zh/menu-context.ts` | 只读上下文浏览器的固定概览、分类、条目外壳和操作文案 |
| `.omp/zh/menu-startup.ts` | 启动更新说明的固定标题，不翻译发布内容 |
| `.omp/zh/menu-welcome.ts` | 内建欢迎提示白名单，不转换调用方自定义文本 |
| `.omp/zh/menu-git.ts` | Git 主界面、暂存／提交编辑器与 diff 的固定显示文案 |
| `.omp/zh/menu-dashboards.ts` | 用量、顾问配置、后台任务、暂停与报告外壳文案 |
| `.omp/zh/menu-dialogs.ts` | Ask／审批／通用选择对话框的内建显示文案 |
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

版本应输出实际安装的 `omp/<版本>`（当前适配 `omp/18.20.0`）。在真实交互终端输入 `/settings`，检查 tab、分组、设置项、描述、选项和 warning 中已有字典覆盖的文本显示中文，例如“外观”“深色主题”。宿主提供原生设置页时，十个栏目的页面导语也显示中文；不支持导语的旧宿主继续使用原有设置翻译。默认符号主题会将说明中的快捷键格式化为 `⎋`、`⇥` 等字符；这些仅作为说明的显示提示，保持原有快捷键和编辑行为。配置的实际值不会翻译，单位、专有名词和未命中文本保留原文。

用官方 `omp` 再打开 `/settings`，应保持英文。日志和 `--version` 都不能单独证明汉化：必须检查实际设置表面。若 `/settings` 被当普通消息发出，说明没有进入斜杠命令处理，应先检查交互终端启动方式。

### Model 页面部分翻译

输入 `/model`（或 `/models`），检查“模型”“角色”“全部模型”等栏目标题、基础说明、操作提示、固定筛选／角色标签、通用空状态及固定 provider 认证／缓存状态说明显示中文；缓存更新时间显示为“不到一分钟前”或“{数量} 分钟前”，保留宿主原有的分钟四舍五入规则。内建及用户自定义角色的名称和标签一律作为专有名词保留原文，包括 DEFAULT、SMOL 等内建标签。OMP 18.8.4 的预设栏目及切换提示、18.11.1 的压缩限制标签和输入提示也属于基础文案，实际预设名称、限制值和输入语法保留原文。模型名、provider 名、模型 ID/selector、技术种类、价格、容量、环境变量名和思考参数保留原文；详细 provider 错误诊断、URL 和动态错误负载仍为英文。Alt+P 独立临时模型选择器的调用层文案见下节；共享 ModelBrowser 保持不变。
固定文案在所选宿主的 ModelHub 模块解析前做内存转换；角色数据从不参与转换，角色名称和标签不因其为默认角色或与内建值匹配而翻译。设置说明中的快捷键提示保留当前主题生成的原有显示字形；消费者追加的环境变量提示只翻译固定句式，变量名和值保持不变。源码锚点或出现次数不符时原文加载，并通过 `[zhomp]` 故障通知报告原因，不做模糊替换或配置改写。`zhomp --no-extensions` 和官方 `omp` 应保持英文。

### 其他菜单的固定文案

菜单翻译扩展到已覆盖的设置外壳、独立模型切换器调用层、思考级别选择器、会话列表和树、历史／回退／复制选择器、登录／退出及会话账户选择器、主题、插件与扩展、代理面板、队列与图片显示菜单，以及快捷键帮助。Debug 菜单只翻译标题，不改参与英文模糊搜索的条目文字。翻译固定标题、搜索提示、操作说明和空状态，不翻译菜单项携带的模型、provider、角色、账户、主题、插件、会话名称或用户正文。

独立模型切换器只转换它自己的标题和提示，不改共享 ModelBrowser、prototype 或模型行数据。思考选择器的 `min`、`low`、`medium`、`high`、`xhigh`、`max` 等级别文字保持原样。表单只翻译未指定标题或预览标签时的内建默认文案；调用方显式提供的标题、标签、说明和预览内容保留原文。

`/mcp` 的管理帮助、`/hub` 列表／活动页、`/session` 信息，以及 Git 主界面分别使用独立文案目录。Session Info 保留供宿主解析的英文报告键，只在最终显示层转换字段和区块，ID、路径、模型、provider、服务器名及状态值不变。Git 覆盖主界面、暂存区、提交编辑器和 diff 控件；`zhomp git` 在进入官方 Git CLI 前注册显示转换，但不向该子命令注入仅 launch 支持的扩展参数。官方 `omp git` 保持英文。

用量、顾问配置、后台任务、暂停、报告／统计提示及 Ask／审批／通用选择框只翻译内建标题、说明和操作提示。问题、选项、授权数据、顾问指令、命令输出、URL 和用户内容不按字典逐词转换，选择／审批回调仍使用原始逻辑值。

OMP 18.14.0 的 `/context` 翻译概览、分类、条目外壳、只读导航和固定用量说明；模型名、分类／条目 ID、原始搜索标签、系统提示词、工具 schema、用户／助手／工具正文及数值不变。会话列表的重命名和固定操作只改显示标签；批注草稿保留原选择值和原文内容，`/local` 文件选择器保留原始 URL、文件名及外部编辑器行为。调用方显式提供的 OAuth sheet 标题／副标题和自定义设置步骤标签不转换。

这些菜单分别按选定宿主的绝对模块路径转换；注册前先验证该模块全部精确表达式及出现次数，匹配才启用，加载时再整模块应用。需要兼容多个宿主源码版本时，共用锚点必须全部匹配，并且恰好一个完整版本组匹配；缺失、歧义和补丁重叠均保持整模块原文。旧版缺少该模块或其源码形状不匹配时，这项可选菜单能力保持原文，不注册转换；已注册的模块在加载时出现意外变化仍报告诊断。某个菜单不可用不影响其他已覆盖界面。官方 `omp`、禁用扩展启动及继承了父进程标记但 PID 不符的进程不启用翻译。范围是固定界面文案，不是所有消息、错误和动态内容的全量汉化。

### 斜杠命令说明

在交互终端输入 `/` 或 `/goal ` 查看命令及子命令补全；TUI autocomplete 显示层翻译核心内建命令、静态子命令，以及 OMP 附带的 `/init`、`/green`、`/review`、`/annotate`、`/autoresearch` 说明。canonical 英文 metadata 继续用于搜索与排序；命令名、别名、参数/选择值、处理器及 ACP/RPC 目录不变。运行时状态、动态快捷键说明及角色名称保留原文。

只翻译已知命令名与 canonical 静态说明的精确匹配。公开 autocomplete 项不提供完整来源信息，同名同文的 file/user/extension 覆写也可能跟随翻译（如 `/init`、`/autoresearch`）；其他未知命令名或文案保持原文。

`zhomp --no-extensions` 和官方 `omp` 的命令补全保持英文。该显示层转换不改写 registry metadata，也不改变搜索、排序或选择结果。

启动顺序：preload 在宿主导入界面之前注册设置消费者、ModelHub 及菜单显示转换；async 扩展 factory 翻译 SettingsHost 元数据并在 UI 可用时报告运行期故障；斜杠命令仅包装 TUI autocomplete provider 输出。每个源码模块只交给一个转换器；各自遵循当前进程授权和宿主的禁用扩展参数语义。

正常启动和补全注册不向终端写入成功日志或翻译计数，避免打断宿主底栏重绘。扩展与 ModelHub 的运行期故障在 UI 就绪后通过宿主通知显示，保留 `[zhomp]` 前缀；启动引导在进入 TUI 前的失败仍直接报错。不能将 stdout 简单换成 stderr：两者在交互终端中都可能破坏布局。


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

顶层 null、数组、标量或 JSON 语法错误会跳过汉化并给出诊断；混合对象中的非字符串值和空翻译忽略。缺失键保留原文。不翻译程序配置键、选项 value、数字、文件名、单位和专有名词。设置选项的 label 与 value 完全相同时，它直接展示的是原始枚举或标识值，保留原文；独立的说明文字仍可翻译。因此 `high`、`xhigh` 等思考强度不会显示成“高”“极高”。菜单标题、解释和操作提示属于新增翻译的目标，用户输入和自定义名称不按字典逐词替换。

## 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

macOS、Linux、Git Bash：

```bash
bash scripts/uninstall.sh
```

卸载无需 Bun。安装器与两个卸载入口共同读取发布目录根的 `install-manifest.tsv`，请保留卸载脚本与该清单的相对位置。它删除上表的自有文件，仅当 `.omp/zh` 为空才删除目录；旁文件、隐藏文件、子目录、用户配置和会话保留。目录有其他文件也会删除自己的 `dict.json`。重复卸载不会删除额外内容。

自定义安装根时先设置与安装时相同的 `OMP_ZH_HOME`。Windows 路径按字面值处理，带方括号不作为通配符。

## 开发验证与发布

以下命令从源码仓库运行；开发测试不随用户安装包发布。

全量行为测试包含真实 SettingsHost 字典覆盖及真实 CombinedAutocompleteProvider 消费链。斜杠用例覆盖核心和附带命令、同步/异步补全、宿主提供的 native 静态详情与动态状态、原始 item 的选择应用、冻结 provider 的安全跳过，以及原始英文描述/搜索/排序不变。宿主冷导入在有独立时限的初始化阶段完成，不占用单条行为测试的默认时限。测试与验证沿用安装器的包发现规则（含自定义 globalDir），显式路径或配置错误会失败。字典门禁在原始 JSON 层检查重复键，并检查 Model 固定文案目录完整性；生产环境使用自定义字典时缺键仍保留原文。

```bash
bun install --frozen-lockfile
bun run typecheck
bun test tests
bun run verify
bun run verify -- --case V10
bun run verify -- --require-all
bun pm pack --dry-run --ignore-scripts
```

验证入口按 V01–V11 输出 PASS/FAIL/SKIP，失败返回非零；`--require-all` 还拒绝 SKIP。V10 安装到临时根，通过已安装的 `host.ts`、`launch.json` 和扩展验证真实 SettingsHost/SettingsSelector、ModelHub、autocomplete 及菜单显示层；具体宿主版本和条目数以本次结果为准。补全验证使用实际宿主 loader/factory，检查 `/set`、`/goal s`、英文描述查询 `/Generate`、附带命令与参数，以及用户项目命令来源排除。界面探针使用隔离数据和受控回调，验证显示与规范选择值，不执行真实模型请求、登录授权、会话删除等业务操作，也不冒充完整终端逐项交互。


此前在 OMP 18.4.12 的隔离原生终端中打开了实际 `/settings`：zhomp 的 tab、分组、设置名称及描述显示中文；官方 omp 即使显式加载同一扩展并继承启用标记，在授权 PID 不匹配时仍保持英文。该 smoke 使用临时 startup 配置关闭首次启动向导，没有配置模型或进行模型对话；它是界面抽查，不是所有条目逐项视觉验收。

Model 功能及角色名称保留修正在 Windows/Bun 1.4.2 上针对 OMP 18.3.2、18.4.12 分别通过 24 个行为测试及 V01–V11。当前版覆盖 ANSI、generic native 和 native picker；18.3.2 无 native 描述能力，仅报告 ANSI 与键盘消费链通过。修正后在 OMP 18.4.12 的原生 Windows Terminal 中再次打开 Model 面板，观察到中文栏目标题、说明和底部操作提示，DEFAULT、SMOL、SLOW、PLAN 等角色标签以及模型/provider/ID 全部保留原文。此前同一功能的官方命令（错误授权 PID）和 `zhomp --no-extensions` 原生隔离对照保持英文。原生抽查没有发送模型对话或执行模型赋值，不代表逐项视觉验收或其他平台通过。

OMP 18.8.4 适配轮在 Windows/Bun 1.4.2 上通过类型检查、24 个行为测试（含真实设置字典覆盖）及 V01–V11，无 SKIP。SettingsSelector 输出 entries=404，ModelHub ANSI/native、内建及自定义角色、预设名称身份和配置隔离断言通过。18.3.2、18.4.12 的缓存源码通过转换及语法检查，本轮未重跑这两个旧版本的完整运行时矩阵。已重新部署日常安装，并核对已安装字典和 Model runtime 的 SHA-256 与源码一致。助手尝试原生终端验收，但实时桌面控制授权两次超时，未打开实际面板。随后用户亲自检查 `/settings` 和 `/model`，确认页面正常；本轮真实交互验收依据为用户确认，不是助手截图，也不代表逐项视觉验收或其他平台通过。

此前元数据翻译实现的 `slash 文本=221` 与 ConPTY 记录保留为历史结果，不代表当前显示层。当前输出层实现已在 Windows/Bun 1.4.2、OMP 18.8.4 上通过类型检查、32 个行为测试及 V01–V11（无 SKIP），并重新部署到默认 Windows 用户安装根（`%USERPROFILE%`）；已安装扩展、字典和运行模块的 SHA-256 与源码一致。真实 Windows ConPTY 交互确认五个附带命令说明、`/annotate` 的五条参数说明、`/autoresearch off/clear` 和 `/goal s` 均为中文；英文 `/Generate` 仍可检索相关命令。再次通过 `/set` 打开 `/settings`，并打开 `/model` 查看角色列表，中文显示正常，DEFAULT、SMOL 及模型 ID 保持原文。测试只查看补全和两个面板，没有执行附带业务命令、发送模型消息、修改设置或角色赋值；使用隔离配置及进程级 fetch/TCP 阻断。最终 CLI 正常退出（exitCode=0），临时资产已清理。这是实际 CLI 的 ANSI 屏幕捕获，不是桌面截图或逐项视觉验收。

OMP 18.11.1 本轮通过后台 Windows ConPTY 验收，使用宿主 `pi-utils/vterm` 解码普通／alternate screen 两个缓冲区：zhomp 的 `/model`、角色列表、`/settings` 和斜杠说明显示中文，DEFAULT／SMOL 保留原文，英文 `/Generate` 仍可检索补全；`zhomp --no-extensions` 对照保持英文。修复后的启动和补全原始输出不再包含 `[zhomp]` 日志。官方 omp 的英文对照也已检查；单缓冲捕获器曾产生的设置面板残影在同一 ANSI 流的双缓冲回放中消失，不能用它作为宿主重绘故障的证据。本轮未逐项验收真实运行子代理时的所有底栏布局。

V10 的真实 SettingsSelector 渲染 entries=412；安装后的 ModelHub 在 ordinary／translated／hostile 三种模式下通过 ANSI、native tree、native picker、角色／模型身份和配置零写入断言。压缩输入条打开时，ANSI footer 由输入条替代操作提示，因此验收检查输入条的标签与输入说明；独立 action 提示在 native tree 中检查，不要求两者同时出现在 ANSI footer。交互 smoke 使用临时配置、移除凭据环境变量并阻断进程级网络入口，没有发送模型消息、修改设置或分配角色；只关闭自行创建的测试进程，不重启或终止已有 omp 实例。

Windows／Bun 1.4.2／OMP 18.11.1 的最终行为测试为 **34 PASS、0 FAIL**，类型检查通过。V01–V09 与 V11 通过；V10 在修正上述 ANSI footer 验收前提、并补齐最后 25 个设置词条后，针对最终源码再次执行 `bun run verify -- --case V10 --require-all` 通过，矩阵没有 SKIP。下述生产 ConPTY smoke 也使用这批词条已部署后的产物。18.3.2、18.4.12、18.8.4 仅使用既有缓存源码重验 ModelHub 转换与语法，未重跑旧版本完整运行时或其他 OS 矩阵。

修复已重新部署到默认用户安装根，并用生产目录中的启动器、扩展、字典和运行模块再次完成上述隔离 ConPTY 检查：`/model`、角色、`/settings`、补全及英文描述搜索正常，原始输出无 `[zhomp]` 日志。部署只替换 zhomp 自有文件，没有重启或终止已有 omp 实例；已有进程继续使用其已加载代码，新启动的 zhomp 使用本次修复。

OMP 18.11.2 的后台 ConPTY 消费链已实际打开 `/model`、角色列表和 `/settings`：模型筛选显示“类型：／全部”，DEFAULT／SMOL 与 chat、tiny 等技术值保持原文；搜索 Vim 后，初始化 Unicode 主题的说明显示“模态提示词编辑。⎋ 退出插入模式”，并保留其余 Vim 按键。以临时 `SEARXNG_ENDPOINT=https://searxng-fixture.invalid` 启动时，说明显示“未设置时回退到 $SEARXNG_ENDPOINT。”。英文 `/Generate` 检索和中文斜杠说明正常，`--no-extensions` 对照保持英文。所有交互在隔离目录和过滤凭据的后台终端中完成，经 Ctrl+D 正常退出；未修改用户设置或触碰已有 omp 实例。

OMP 18.11.2／Windows／Bun 1.4.2 的类型检查与 34 个行为测试通过。V01–V09、V11 通过；V10 在对齐真实 preload 导入顺序及原生控件／模态状态前提后定向重验通过，无 SKIP，SettingsSelector entries=413。真实设置消费者覆盖 ASCII、Unicode、Nerd 三种预设和两类环境变量说明；ModelHub 覆盖 ANSI、native tree、native picker、provider 通用状态及角色／模型／动作逻辑值不变。完整旧版宿主矩阵和其他 OS 本轮未重跑。

本轮 18.11.2 产物已更新到默认用户的生产安装（包含新增 `settings-ui.ts`），并直接使用生产路径再做隔离 ConPTY 验收：模型类型筛选、角色、Unicode Vim 说明、环境变量提示、设置及补全均通过，正常输出无原始 `[zhomp]` 日志。已有 omp 实例未重启、未终止；新开 zhomp 生效。

本轮可维护性整改使用独立安装目录验证 OMP 18.3.2 与 18.11.3，各 38 个行为测试通过；V01–V09 通过，最终 V10／V11 定向重验通过。SettingsSelector entries 分别为 385／415；V11 对真实解包安装运行 SettingsHost／ModelHub 消费探针，并确认缺少已安装的 `model-text.ts` 时实际消费失败。OMP 18.4.12 的 V10 另行通过（entries=397）：native 描述可用，压缩限制能力不存在，二者分开报告。旧 native 回退赋值文案的精确补丁已从预设专属层移到公共 native 层。

本轮后台 ConPTY 也实际打开 18.11.3 的 `/settings`、`/model` 和 `/Generate` 补全：启用时中文，`--no-extensions` 对照英文，两次 CLI 均退出 0，原始输出无 `[zhomp]`。终端使用过滤凭据的临时 home／agent，隔离安装的 launcher 与宿主均加载网络阻断，不发送模型消息或修改用户设置。本轮未更新默认用户生产安装，也未重启／终止已有 omp。远端跨 OS 结果以相应提交的 Actions run 为准，不能由本机 Windows 结果推定。

上述运行代码完成全部修正后，再次串行执行 OMP 18.11.3 和 18.3.2 的完整行为测试及 `bun run verify -- --require-all`：两版均为 38 PASS、V01–V11 全部 PASS、退出 0、无 SKIP。18.4.12 保留独立 native V10 通过证据，不将该定向检查称为完整旧版／跨 OS 矩阵。

后续真实 Actions #4 中 Linux／macOS 两个版本均通过，Windows 两个版本仅因 Bun `realpathSync()` 仍保留 8.3 短路径而在 cwd 断言失败。测试／验收已改为比较实际文件系统对象身份（bigint dev／ino），生产 cwd 不变；本机真实 8.3 TEMP／TMP 下 10 个安装测试通过，并新增目录别名与不同目录的区分回归，总行为用例数为 39。该记录不将 #4 的失败任务写成成功，修正后的远端状态以新提交的 Actions 为准。

OMP 18.12.0／Windows／Bun 1.4.2 的本轮文案补齐通过类型检查、42 个行为测试及 V01–V11（全部 PASS，无 SKIP）。真实 SettingsSelector（entries=415）的 native prefs 描述逐一验证十个栏目导语及不变的 page id；ModelHub 在 ordinary／translated／hostile 三种模式下验证 ANSI/native 缓存时间，覆盖一分钟边界、分钟四舍五入、未来时间及缺少时间戳，角色／模型／provider 逻辑值和配置零写入不变。独立安装的最低支持版 OMP 18.3.2 另行通过 V10（entries=385），不要求其不存在的原生描述或页面导语能力；该定向检查不代表旧版完整矩阵。

本轮已通过官方安装入口更新默认用户的生产 zhomp，并直接使用生产安装文件复验 SettingsSelector／autocomplete 与 ModelHub 消费探针，两者退出 0。探针使用过滤凭据的临时配置及只读设置，没有模型请求或用户配置写入；这些是实际宿主组件消费验收，不是完整终端交互或其他 OS 验收。部署及验收没有执行重启或终止已有 omp 进程的操作；新开 zhomp 使用更新后的文件。

OMP 18.12.1 新增 `advisor.continueSeverity` 设置，仅在启用顾问时可见。本轮仅补齐其名称、描述、三档严重程度标签和三条选项说明，共八条字典文本；`nit`／`concern`／`blocker` 逻辑值及默认值不变。此前检查的类型验证通过，字典补齐后 42 个行为测试与 V10 全部通过（SettingsSelector entries=416）；真实设置页导语、ModelHub 的 ordinary／translated／hostile ANSI/native 路径及 autocomplete 消费链未发现新的接口适配需求。本轮没有重跑 V01–V09／V11 或跨 OS 矩阵。已通过官方安装入口更新本机生产文件，并用生产路径复验 SettingsSelector／autocomplete 和 ModelHub，均退出 0；额外在隔离、只读、内存配置中启用顾问，实际搜索渲染出中文设置名称，核对八条显示文本、三档逻辑值和默认值。未修改用户设置或执行重启／终止已有 OMP 的操作。

OMP 18.12.3 本轮补齐滚动历史、工具审批“询问并记住”、空闲压缩、实时任务组件、Computer 后台回退和 `/forget-approvals` 的显示文案；原生导语和 ModelHub 精确源码转换无需改动。类型检查、42 个行为测试及 V01–V11 全部通过，无 SKIP（SettingsSelector entries=419）。斜杠测试夹具以同一 live session 满足旧宿主 `ctx.session` 和新宿主 `ctx.viewSession` 的读取契约，验证模型切换后补全状态仍实时更新；未知 ModelHub 子进程验收改用独立有界冷导入时限。最低支持版 18.3.2 另行通过 13 个受影响的 slash／Model 测试，不将该定向检查称为完整旧版矩阵。

本轮已更新默认用户生产安装，并直接使用生产文件复验 SettingsSelector／autocomplete、ModelHub，均退出 0；额外的只读临时配置探针实际搜索渲染五个新增／更新设置，核对中文名称、说明、选项、原逻辑值及默认值，确认 `/forget-approvals` 显示中文说明而选中结果仍为原命令。没有执行该命令的 handler、模型请求、用户配置变更，或重启／终止已有 OMP 的操作。本轮是 Windows／Bun 1.4.2 的实际组件消费验收，不代表完整终端交互或其他 OS 矩阵。

### 首轮菜单扩展验收（历史记录）

菜单扩展轮在 Windows／Bun 1.4.2／OMP 18.12.3 上，对最终运行代码及探针重新完整执行类型检查、`bun test tests` 和 `bun run verify -- --require-all`：46 个行为测试通过、零失败，V01–V11 全部 PASS，无 SKIP（SettingsSelector entries=419）。

仓库保留 `tests/menu-translation.test.ts` 的整模块回退消费者回归，使用代表性的双补丁菜单夹具：实际导入并运行生成模块，先确认正常匹配能完整显示中文，再验证后部锚点缺失、重复及追加重叠补丁时，标题和正文全部保留原文，不留下部分翻译。

首轮菜单扩展的临时隔离安装 smoke 覆盖当时的 27 个目录模块，验证源码匹配、转换后语法和 preload 导入，零失败、零跳过诊断；该历史扫描与当时的代表性永久回归、V10／V11 实际消费验收分别记录。

V10 的 ordinary／translated／hostile 模式实际构造模型、思考级别、会话、会话树、OAuth 和会话账户菜单，覆盖 ANSI／native 标题、搜索输入和键盘／原生选择回调；思考设置的原始 `high`／`xhigh` 标签、值和默认值保持不变，独立说明仍中文。恶意字典的引号、插值和 `$&` 按字面显示，未执行注入内容。表单另行验证内建默认标题／预览标签中文，而显式调用方标题、说明、标签和预览正文不变。Debug 条目、主题的 `(current)` 和账户的 `active for this session` 原始搜索文本保留英文。

已通过 PowerShell 官方安装入口更新默认用户生产文件，并直接使用生产安装在过滤凭据、临时目录和只读内存设置下复验七类菜单／设置消费（ordinary／translated／hostile），均退出 0。没有执行模型请求、真实登录／退出、会话恢复、账户操作或用户配置写入，也没有重启／终止已有 OMP；新开 zhomp 生效。本轮证据是实际组件渲染和交互消费，不代表完整终端逐项视觉验收、其他 OS 或远端 Actions 通过。

### 管理界面查漏验收（18.12.3）

管理界面查漏轮在 Windows／Bun 1.4.2 上分别对 OMP 18.12.3 和 18.3.2 完整运行类型检查、46 个行为测试及 `bun run verify -- --require-all`；两版均为零失败，V01–V11 全部 PASS，无 SKIP。当前版另以 `MENU_CATALOG_REQUIRE_ALL=1` 要求全部 44 个目录模块匹配，逐模块先编译生成源码，再通过真实已安装 preload 导入，未出现缺失、不支持或语法错误。

18.12.3 的管理／Git／辅助面板／对话框探针在 ordinary、translated、hostile 三种模式下实际构造并渲染宿主组件，覆盖 MCP 帮助的 17 条命令说明、Agent Hub 列表／详情／活动、Session Info 字段与内部原文解析语义，以及 Git 暂存／提交编辑器、干净／脏状态、diff、媒体／空状态和导航。Ask 保留用户选项及规范回调值，译后“其他…”碰撞仅在显示层去歧义；审批只触发隔离的拒绝回调，不执行实际授权。

18.3.2 的未匹配新目录不再以未执行的能力记录代替渲染验收：`integration-legacy-management-surface.ts` 调用真实 MCP controller／TranscriptBlock，并实际渲染 Agent Hub、Session Info 与 Agents Hub；`integration-legacy-additional-surface.ts` 验证旧用量、顾问模型／思考级别、任务报告、会话报告、暂停及统计参数错误界面；`integration-legacy-dialog-surface.ts` 验证旧 Ask／HookSelector 的键盘选择和 `ExtensionUiController.showHookConfirm` 的 No→false 回调。该宿主没有新版专用审批组件，验收使用其真实通用确认路径；不声称旧版获得全部新版菜单汉化。

两版的真实 Git CLI 均在独立后台 PTY 与临时仓库中运行，检查分支、文件、diff 和索引状态不变，并通过 `q` 正常退出。18.12.3 的 `zhomp git` 显示中文，官方 Git CLI 对照英文；18.3.2 保留其不匹配模块的原文界面并验证可交互退出。

默认用户生产安装已更新，并直接使用生产目录完成全部 44 模块的严格编译／导入、真实 Git CLI，以及四组界面在三种语言模式下的消费复验，14 次探针调用全部退出 0。其后仅补充旧版验收代码，未再修改部署的运行文件；无需重复安装。没有重启／终止已有 OMP，后续新开的 zhomp 加载更新。本轮是本机 Windows 证据，不代表远端 Actions 或 Linux／macOS 已完成新一轮验收。

### 18.12.6 更新适配与 Agent Hub 查漏（历史记录）

Windows／Bun 1.4.2／OMP 18.12.6：类型检查和 47 个行为测试通过。完整验证中的 V01–V09 通过；修正新增探针的主题初始化、native JSON 文本及宿主可输入状态前提后，V10／V11 定向复验通过，无 SKIP。`MENU_CATALOG_REQUIRE_ALL=1` 要求全部 47 个菜单模块匹配、编译并通过真实已安装 preload 导入，未出现缺失、不支持或诊断。新版原生压缩／长缓存文案已补齐；`/annotate code-review` 按实际命中的旧／新英文分别查字典，旧版不会显示新增 GitLab 能力，只有旧键的自定义字典仍可翻译旧文案。

Agent Hub 验收覆盖共用渲染器的回退及耗时标签、转录子视图的标题／操作／空状态、活动回退标题。ordinary／translated 使用 180 列，hostile 使用 800 列验证完整恶意字典的字面安全，不冒充窄屏布局验收。转录正文原文通过实际 ANSI 渲染验证；native 只验证已展开的卡片外壳，未将嵌套 transcript 组件的浅层 JSON 当作已验证正文。原始状态枚举、模型 ID、任务／逐字记录、工具名、按键和单位保持不变，未调用真实代理消息或恢复接口。OMP 18.3.2 另行通过 10 个斜杠行为测试和 V10，未匹配的转录外壳保留英文，活动固定回退按其真实接口翻译；该定向验证不是旧版完整矩阵。

已通过 PowerShell 官方安装入口更新默认用户生产文件，并直接使用生产路径完成 47 模块严格编译／导入、SettingsSelector／autocomplete，以及管理／Agent Hub 子视图的三种语言模式，8 次探针调用全部退出 0。没有重启或终止已有 OMP；新启动的 zhomp 使用更新文件。本轮证据为本机真实组件消费及隔离 Git PTY，不代表全部界面的逐项视觉、远端 Actions 或其他 OS 验收。

### 固定界面扩展验收（18.12.6 历史记录）

Windows／Bun 1.4.2／OMP 18.12.6：类型检查、47 个行为测试及 V01–V11 全部通过，无 SKIP。严格目录门禁验证 69 个模块全部匹配、编译并通过真实安装的 preload 导入，未出现缺失、不支持或诊断。本轮增加审查／批注、会话咨询／修复检查／粘贴、分支摘要／删除和通用确认、MCP OAuth 提示、扩展分类／详情、首次设置向导、启动更新标题及 34 条已知欢迎提示的固定显示转换。

V10 的 ordinary／translated／hostile 实际消费验证英文搜索、原始选项及返回值、译文碰撞回退、模型／provider／角色／ID、URL／href、用户内容和自定义同 ID 布局文案不变；设置向导没有保存配置或发起登录。真实 CLI 的官方对照保留 “What's New”，zhomp 显示“更新说明”，发布摘要仍为原文。启动探针使用临时 home／agent／cwd，预加载阻断 fetch／TCP／TLS 并保留宿主所需本地 IPC；被拦截的启动 fetch 尝试单独记录，不宣称“没有网络尝试”。自有测试 CLI 均正常退出。真实最低版 OMP 18.3.2 另行通过 V10（SettingsSelector entries=385），按实际源码和 native 能力验证翻译或原文回退，不声称获得全部新版菜单或新版 native 界面；本轮未重跑旧版完整矩阵和其他 OS。

已通过 PowerShell 官方安装入口部署到默认用户生产目录。直接使用生产文件完成严格 69 模块导入、SettingsSelector／autocomplete、六组新增／扩展界面的三模式消费及启动 CLI smoke，21 个探针子进程全部退出 0；没有执行真实业务命令、登录授权、模型请求或用户设置写入。部署没有重启或终止已有 OMP；新开 zhomp 加载更新。远端 Actions 和跨 OS 状态仍以各自实际运行结果为准。

后续审查复核收紧了启动探针的分平台 IPC 识别：Windows 只接受明确的本机命名管道前缀，POSIX 才接受本地 Unix socket 路径。12 个策略输入用例通过；这是平台参数模拟，不作为 Linux／macOS 实机证据。Windows 上 OMP 18.12.6 和 18.3.2 的真实 StartupUI 对照均重新通过。另补齐扩展详情的折叠参数数量及展开提示，实际 ANSI／native 消费验证中文数量、原参数名／描述和展开后内容不变。此次定向类型检查、5 个菜单／字典测试及严格 69 模块检查通过，重新部署后生产参数界面和目录导入复验也通过；没有重跑未受影响的完整矩阵。

### 18.14.0／Bun 1.4.4 首轮本机适配验收（历史阶段）

本节记录首次本机验证当时的结果；后续终端探针修正、跨平台 Actions 和最终部署结果见下一节“GitHub Actions 与隔离部署验收（18.14.0 历史记录）”。

Windows／Bun 1.4.4／OMP 18.14.0：类型检查及 48 个行为测试通过，真实 SettingsHost 的 431 个条目完成语义字典覆盖。V01–V09 通过，修复后 V10 定向复验通过，无 SKIP；覆盖真实 SettingsSelector／ModelHub、斜杠补全、Git 和启动 CLI，以及菜单的 ordinary／translated／hostile 消费。严格目录验证 73 个模块全部匹配、编译并经已安装 preload 导入，缺失、不支持和诊断均为空。

新增 `/context` 探针实际执行概览→分类→条目的 ANSI／native 浏览，核对分类／条目 ID、英文搜索标签、原始正文、来源路径、调用 ID、token 数值和只读状态；恶意字典不执行注入。会话重命名取消不触发持久化，固定操作返回原会话及布尔值；批注草稿从真实来源菜单进入，选择器返回原始 `labels[]` 字符串，恢复原草稿且不改正文；`/local` 文件菜单取消不启动编辑器。新版 native 设置启动提示单独验证 `Press`／原生 `enter`／`to begin`，不套用 ANSI 的跳过提示。向导验收没有配置写入、登录或偏好保存。

OMP 18.12.6 缓存中的 11 个受影响旧模块另外通过精确转换和编译检查；这是源码兼容检查，不是旧版完整运行时矩阵。此次首次本机验证不代表 Linux／macOS 或远端 Actions。

V11 的真实解包安装消费门禁通过；移除已安装 `model-text.ts` 会使 ModelHub 探针失败。启动验收曾因重复回答 ConPTY 的首次光标查询而向输入框插入字符，已改用宿主 `TerminalQueryResponder`；Windows 仅跳过宿主已回答的首次查询，其他平台继续响应，旧宿主没有该导出时保留原响应路径。最终官方／汉化启动探针在确认输入框为空后仅发送 Ctrl+D，正常退出；网络阻断仍开启，官方启动自身被拦截的 fetch 尝试另行计数，不作为无网络尝试的证据。

终端协商修正后的最终工作区再次执行 `MENU_CATALOG_REQUIRE_ALL=1` 的 V10：73 模块严格目录、普通／中文／恶意字典三模式及实际 Git／Startup CLI 全部通过，无 SKIP；V11 解包消费也通过。最终类型检查通过，48 个行为测试为零失败。生产部署后的六个轻量消费检查使用生产 `launch.json`，没有以仓库副本代替部署副本。

首次本机验证后已通过 PowerShell 官方入口部署到 `%USERPROFILE%\.omp\zh` 及对应扩展目录。直接指定生产 `launch.json`，用临时目录复验严格 73 模块导入、SettingsSelector／autocomplete、会话／OAuth 选择器、ContextViewer、批注草稿／local 文件选择及 SetupWizard，六个消费探针全部退出 0。未重启或终止已有 OMP；新启动的 zhomp 使用当次产物。该历史阶段尚未执行旧版完整运行时及跨平台 Actions，后续完成记录见下一节。

### GitHub Actions 与隔离部署验收（18.14.0 历史记录）

临时 CI 分支 `ci/omp-18.14.0-validation-20261031` 的候选 `40e8460` 通过 [Verify #11](https://github.com/Octobersama/zhomp/actions/runs/41125283113)：Windows／Linux／macOS × OMP 18.3.2／latest，六个矩阵任务全部成功。各任务均执行类型检查、50 个行为测试、完整 V01–V11 和空白检查；Bun 固定为 1.4.4。首次 #9 暴露的最低宿主 Git 未跟踪文件断言、欢迎框边框误识别，以及旧终端响应器不支持构造选项的问题均已修复；#10 和补齐子进程守卫校验后的 #11 先后全绿。

StartupUI 的守卫现在同时覆盖真实 launcher 和 OMP 子进程，并校验实际入口身份。Windows 首次标准光标回复过滤由测试共用 helper 负责，不依赖宿主响应器接受新构造选项；POSIX 及后续回复不变。启动探针只发送 Ctrl+D，退出前必须确认真正的输入框为空，宿主后台网络尝试保持单独记录，不再以父进程零日志推断子进程没有请求。

CI 通过后，用 PowerShell 官方入口安装到本机独立临时根，在过滤凭据且阻断网络的后台子进程运行八个探针：严格 73 模块导入、SettingsSelector／autocomplete（431 条目）、ModelHub、会话／OAuth 选择器、ContextViewer、批注／local 文件菜单、SetupWizard，以及真实官方／汉化 Git CLI。八个探针均退出 0，本轮网络尝试为零；Git 的 launcher 与 OMP 子进程均验证守卫已加载，两个 CLI 均正常退出且文件和索引不变。这是实际组件消费及独立 Git PTY 验收，不冒充完整主会话终端的逐项菜单交互。此前临时主会话脚本捕获的后台 POST 已阻断，该次失败没有记为通过。

随后重新部署到本机生产目录，并直接以生产 `launch.json` 复验目录、SettingsSelector／autocomplete、ModelHub、ContextViewer 四个隔离消费探针，全部退出 0、网络尝试为零。没有重启／终止已有 OMP，也没有在当前终端启动交互界面。远端仅推送已授权的 CI 分支，`main` 保留为本地提交，不推送。




发布包必须包含本指南、README、许可证、`install-manifest.tsv`、字典、扩展、两个安装/卸载入口及安装核心，以及清单中列出的全部运行文件。安装路径表列明各显示目录的用途；新增运行文件必须登记到自有产物清单，安装、无 Bun 卸载及发布完整性验收共同消费它。斜杠补全显示层仍嵌在现有扩展中。解包后需检查本地链接、安装命令及实际汉化消费链，不能以打包退出码或 `--version` 代替汉化证明。

历史本机验收（2.0.0）覆盖 OMP 18.3.2、Windows/PowerShell 5.1/cmd/Git Bash；2.1.0 本机 OMP 18.4.1 的 SettingsSelector 验证 entries=387 且动态描述中文可见。此前审查改进轮在 Windows 的 OMP 18.3.2、18.4.12 上通过 21 个行为测试及 V01–V11，SettingsSelector 分别渲染 entries=385 和 397。当前跨平台验收以本节链接的实际 Actions 运行及对应提交为准。

### 18.18.2 轻量适配（历史记录）

本轮针对 Windows／Bun 1.4.4／OMP 18.18.2 检查实际宿主源码与显示契约。真实设置语义字段覆盖及字典校验的 6 个定向用例通过；实际命令路由、`--no-extensions` 和将该字串用作参数值时的隔离检查通过。设置数值／单位标签（如 `80 ms`、`30 fps`、`12.5 frames/s`）保留原文，只翻译周边语义说明。

最终类型检查通过。轻量 smoke 确认当前 74 个菜单模块及 ModelHub 全部精确匹配并通过转换后语法检查，菜单／Model 固定文案目录无缺词；两种鼠标说明分支的动态 getter 在 `Shift`／`⇧` 字形下均输出对应中文并保留配置值。唯一完整源码 variant 的 1 个定向回归用例通过。字典新增 91 项，共 4128 项；本轮源码检查不等同于实际界面渲染或旧版运行时验收。

补充执行 `bun test tests/slash-description-translation.test.ts`：10 个用例全部通过，覆盖真实宿主静态说明的字典完整性、补全显示转换、原始选择行为、搜索／排序边界、异步参数补全及实时模型状态。本轮定向测试合计 17 PASS、0 FAIL。

按本轮要求不执行完整行为测试、V01–V11、原生交互、旧宿主或跨平台矩阵。旧安装需重新运行安装入口部署新版运行模块和字典；以上历史完整验收与生产部署记录不代表 18.18.2 本轮结果。

随后通过 PowerShell 官方安装入口更新本机默认生产安装（`%USERPROFILE%\.omp\zh`、对应扩展及 `.bun\bin\zhomp.cmd`）。已安装启动器输出 `omp/18.18.2`；直接加载生产目录中的模块和 4128 项字典，六个修复菜单及 ModelHub 的精确转换／语法检查、两个鼠标动态说明分支均通过。没有重启或终止任何已有 OMP 进程；已有进程继续使用已加载代码，新启动的 zhomp 加载本次更新。

### 18.18.8 极简静态适配（历史记录）

本轮在 Windows／Bun 1.4.4 上按本机实际解析到的 OMP 18.18.8 源码适配。补齐 15 条设置文案，恢复 Ask 备注按钮的新源码形状，并覆盖新 HTML 表单的固定界面／校验提示与 LiteLLM 预算标签；新增字典项合计 50 条，共 4178 项。旧 Ask 源码组保留，表单正文、选项与答案、配置值及统计分组键不改。

极简验证：类型检查和 `git diff --check` 通过；76 个目录模块及 ModelHub 的精确转换／转换后语法检查通过，菜单／Model 文案目录无缺词，设置消费者的环境变量说明锚点唯一匹配。真实宿主的设置语义字段覆盖与斜杠静态说明覆盖分别通过。仅检查源码和元数据，没有执行完整行为测试、V01–V11、UI 交互或旧版／跨平台矩阵；未重启已有 OMP。

随后按用户要求通过 PowerShell 官方安装入口更新默认生产环境（`%USERPROFILE%\.omp\zh`、对应扩展及启动器）。直接使用生产 `launch.json` 和已安装运行模块，确认宿主为 18.18.8、字典为 4178 项，76 个菜单模块及 ModelHub 的转换／语法检查通过；已安装扩展对新增设置输出中文，同时保留 `unset`／`yes`／`no` 及配置值。未启动完整交互界面，未重启或终止现有 OMP；新开的 zhomp 加载本次产物。

### 18.20.0 适配与生产部署（当前）

Windows／Bun 1.4.4／OMP 18.20.0：新增 23 条设置文案及“指令文件”分类，共 24 条字典项，字典合计 4202 项。修复移除 Smithery 帮助、通用确认的 permission 参数、HTML 表单问题标题和会话动态删除键造成的四个源码模块失配；旧源码组保留，选择／确认值、用户正文、快捷键绑定及上下文统计逻辑不变。

轻量验证：类型检查、`git diff --check` 通过；8 个设置／字典／菜单定向用例通过，斜杠静态说明覆盖另行通过。当前 76 个目录模块及 ModelHub 全部匹配并通过转换后语法检查，固定文案目录无缺项。未运行完整行为矩阵、V01–V11、旧宿主或跨平台验收。

通过 PowerShell 官方入口更新默认生产环境，并直接读取生产 `launch.json`、已安装字典及运行模块复验：宿主 18.20.0、4202 项字典、76 个菜单模块及 ModelHub 转换／语法全部通过。隔离只读、内存设置的实际 SettingsSelector 渲染通过（458 条目），5 个新增设置的名称和说明为中文；实际 HTML 表单渲染保留原问题／值并显示中文提交标签，通用确认的 Yes／No 仍返回原布尔结果且 permission 类型不变，诊断为空。这是组件消费抽查，不是完整终端逐项交互。

部署和探针未结束或重启任何已有 OMP 进程，也没有写入用户设置。已有进程继续使用已加载代码，新开的 zhomp 加载本次产物。

### GitHub Actions 故障排查（18.20.0）

[Verify 43400802628](https://github.com/Octobersama/zhomp/actions/runs/43400802628) 的 Windows／Linux／macOS latest jobs 安装 OMP 18.20.0，类型检查、50 个行为测试及 V01–V09 通过；V10／V11 起初因测试期待旧版 `tui.mouse` 动态说明而失败。三个 OS 的 OMP 18.3.2 job 全部通过。

此前 [43003801929](https://github.com/Octobersama/zhomp/actions/runs/43003801929) 与 [42541043670](https://github.com/Octobersama/zhomp/actions/runs/42541043670) 的注解显示账户计费锁使 runner 未启动；这是 GitHub 账户状态，不是仓库步骤。后续运行已能启动完整矩阵。

候选 [43433951635](https://github.com/Octobersama/zhomp/actions/runs/43433951635) 在首次 probe 修正后暴露剩余的真实消费契约差异：`/review` 要求选定 checkout 且返回 `{ choice, cwd }`；18.20.0 Context Viewer 用新的系统提示分类标签；确认组件调用 `closeLinkBrowser`；新版 MCP 帮助不再展示 Smithery 条目。夹具现在用隔离临时 Git 仓库并实现宿主的通知／关闭浏览器接口；Context Viewer 从所选宿主 API 读取合法分类标签；MCP 仅断言实际源码仍提供的可选帮助行和语法。

Prediction Alternatives 同样使用与主题绑定的精确 `{tab}` 动态模板；旧的固定 `Tab` 字典项保留。鼠标动态说明已保留独立、完整的当前与旧版形状及未知形状失败检查。

定向验证：Windows／Bun 1.4.4／OMP 18.20.0 上，类型检查通过，SettingsSelector（458 条目）、Context Viewer 三种语言模式、MCP／管理界面三种语言模式及 `/review` 实际组件消费通过；完整 V10 `--require-all` 与解包安装 V11 `--require-all` 均 PASS。随后最终提交 `322037a` 的 [Verify 43445529262](https://github.com/Octobersama/zhomp/actions/runs/43445529262) 在 Windows／Linux／macOS × OMP 18.3.2／18.20.0 六个矩阵任务全部成功。此次只使用隔离临时安装，不部署生产，也未结束或重启已有 OMP 进程。


## 已知限制

- 覆盖 `/settings`、`/model` 及上述菜单、向导和欢迎提示中的已知固定文案；主消息区、状态栏、详细诊断、共享 ModelBrowser 内部空状态仍可能为英文。发布说明正文、外部统计 Web 页面、工具／扩展提供的提问、选项、授权说明及动态记录不自动翻译。
- 翻译范围按文本用途区分，不按菜单由哪个命令打开区分：内建固定标题、选项、帮助、确认和空状态可纳入精确显示转换；用户／扩展内容、模型提示词、URL／href、ID、技术枚举（如 `high`）、模型／角色名和单位保留原文。字符串选择器把显示选择映回原始值，命令执行、授权流程及英文搜索元数据不变。
- 源码模式有即时编译开销，不承诺固定增加多少秒。
- 官方内部模块变更需要重新适配；范围校验通过不保证任意未来版本都可汉化。可选菜单在注册前发现形状不支持时保留原文；已启用转换的模块在加载时发现意外形状变化则跳过并报告原因。
- 普通写入错误能恢复安装前状态；进程强杀、断电或恢复步骤自身发生存储错误不具备跨目录事务保证。
