# zhomp 安装与使用

## 支持范围

zhomp 2.1 起支持 **OMP >=18.3.2 <19**、**Bun >=1.4.2**；历史本机验证覆盖 OMP 18.3.2、18.4.12、18.8.4、18.11.1、18.11.2、18.11.3、18.12.0、18.12.1，当前适配宿主为 **18.12.3**。CI 从 `package.json` 的 peer 范围派生最低支持版，与当期最新版组成矩阵；本机结果不代表其他平台或远端 CI。安装、启动和翻译复用 `runtime/host.ts` 的宿主契约，检查具体 SemVer 版本、包身份、pi-tui 依赖及显示接口，并从选定宿主解析实际模块绝对路径。兼容版本升级可继续使用现有 zhomp；19.x 或内部接口变化需更新 zhomp。

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

授权 preload 在宿主导入设置 UI 和 ModelHub 之前，分别注册设置消费者及 ModelHub 的精确源码转换；async 扩展 factory 翻译 SettingsHost 元数据，斜杠命令说明在扩展中处理。所有转换仅修改内存显示。旧安装升级需重新运行安装脚本，部署扩展、运行模块和字典（含共享 `diagnostics.ts` 与 Model 固定文案目录 `model-text.ts`）；只替换字典不足以启用新功能。

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

版本应输出实际安装的 `omp/<版本>`（当前适配 `omp/18.12.3`）。在真实交互终端输入 `/settings`，检查 tab、分组、设置项、描述、选项和 warning 中已有字典覆盖的文本显示中文，例如“外观”“深色主题”。宿主提供原生设置页时，十个栏目的页面导语也显示中文；不支持导语的旧宿主继续使用原有设置翻译。默认符号主题会将说明中的快捷键格式化为 `⎋`、`⇥` 等字符；这些仅作为说明的显示提示，保持原有快捷键和编辑行为。配置的实际值不会翻译，单位、专有名词和未命中文本保留原文。

用官方 `omp` 再打开 `/settings`，应保持英文。日志和 `--version` 都不能单独证明汉化：必须检查实际设置表面。若 `/settings` 被当普通消息发出，说明没有进入斜杠命令处理，应先检查交互终端启动方式。

### Model 页面部分翻译

输入 `/model`（或 `/models`），检查“模型”“角色”“全部模型”等栏目标题、基础说明、操作提示、固定筛选／角色标签、通用空状态及固定 provider 认证／缓存状态说明显示中文；缓存更新时间显示为“不到一分钟前”或“{数量} 分钟前”，保留宿主原有的分钟四舍五入规则。内建及用户自定义角色的名称和标签一律作为专有名词保留原文，包括 DEFAULT、SMOL 等内建标签。OMP 18.8.4 的预设栏目及切换提示、18.11.1 的压缩限制标签和输入提示也属于基础文案，实际预设名称、限制值和输入语法保留原文。模型名、provider 名、模型 ID/selector、技术种类、价格、容量、环境变量名和思考参数保留原文；详细 provider 错误诊断、URL 和动态错误负载仍为英文。这不是全界面汉化，也不改变 Alt+P 的独立临时模型选择器。
固定文案在所选宿主的 ModelHub 模块解析前做内存转换；角色数据从不参与转换，角色名称和标签不因其为默认角色或与内建值匹配而翻译。设置说明中的快捷键提示保留当前主题生成的原有显示字形；消费者追加的环境变量提示只翻译固定句式，变量名和值保持不变。源码锚点或出现次数不符时原文加载，并通过 `[zhomp]` 故障通知报告原因，不做模糊替换或配置改写。`zhomp --no-extensions` 和官方 `omp` 应保持英文。

### 斜杠命令说明

在交互终端输入 `/` 或 `/goal ` 查看命令及子命令补全；TUI autocomplete 显示层翻译核心内建命令、静态子命令，以及 OMP 附带的 `/init`、`/green`、`/review`、`/annotate`、`/autoresearch` 说明。canonical 英文 metadata 继续用于搜索与排序；命令名、别名、参数/选择值、处理器及 ACP/RPC 目录不变。运行时状态、动态快捷键说明及角色名称保留原文。

只翻译已知命令名与 canonical 静态说明的精确匹配。公开 autocomplete 项不提供完整来源信息，同名同文的 file/user/extension 覆写也可能跟随翻译（如 `/init`、`/autoresearch`）；其他未知命令名或文案保持原文。

`zhomp --no-extensions` 和官方 `omp` 的命令补全保持英文。该显示层转换不改写 registry metadata，也不改变搜索、排序或选择结果。

启动顺序：preload 在宿主导入真实设置 UI 和 ModelHub 之前注册两个精确源码转换；async 扩展 factory 翻译 SettingsHost 元数据并在 UI 可用时报告运行期故障；斜杠命令仅包装 TUI autocomplete provider 输出。各自遵循当前进程授权和宿主的禁用扩展参数语义。

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

验证入口按 V01–V11 输出 PASS/FAIL/SKIP，失败返回非零；`--require-all` 还拒绝 SKIP。V10 安装到临时根，通过已安装的 `host.ts`、`launch.json` 和扩展验证真实 SettingsHost/SettingsSelector、ModelHub 和 autocomplete 显示层。OMP 18.8.4 的 SettingsSelector entries=404；补全验证使用实际宿主 loader/factory，检查 `/set`、`/goal s`、英文描述查询 `/Generate`、附带命令与参数，以及用户项目命令来源排除。组件/provider 用例不执行模型请求或业务命令，也不冒充完整终端交互。


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


发布包必须包含本指南、README、许可证、`install-manifest.tsv`、字典、扩展、两个安装/卸载入口及安装核心，以及清单中列出的全部运行文件（包括 `host.ts`、`model-ui.ts`、`settings-ui.ts`、`diagnostics.ts` 与 `model-text.ts`）。新增运行文件在自有产物清单中登记，安装、无 Bun 卸载及发布完整性验收共同消费该清单。斜杠命令显示层仍嵌在现有扩展中。解包后需检查本地链接、安装命令及实际汉化消费链，不能以打包退出码或 `--version` 代替汉化证明。

历史本机验收（2.0.0）覆盖 OMP 18.3.2、Windows/PowerShell 5.1/cmd/Git Bash；2.1.0 本机 OMP 18.4.1 的 SettingsSelector 验证 entries=387 且动态描述中文可见。此前审查改进轮在 Windows 的 OMP 18.3.2、18.4.12 上通过 21 个行为测试及 V01–V11，SettingsSelector 分别渲染 entries=385 和 397。CI 覆盖 Windows/Linux/macOS 的最低版与当期最新版；本轮没有远端 CI 或其他 OS 验证结果，不应据此声称已通过。

## 已知限制

- 覆盖 `/settings` 元数据和 `/model` 的基础交互文案；主消息区、状态栏、独立临时模型选择器、详细诊断和设置组件硬编码的 `Settings`、`Preview:` 等仍可能为英文。
- 源码模式有即时编译开销，不承诺固定增加多少秒。
- 官方内部模块变更需要重新适配；范围校验通过不保证任意未来版本都可汉化，运行时形状检查失败会跳过翻译并报告原因。
- 普通写入错误能恢复安装前状态；进程强杀、断电或恢复步骤自身发生存储错误不具备跨目录事务保证。
