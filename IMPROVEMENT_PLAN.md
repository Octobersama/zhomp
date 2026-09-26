# zhomp main 全库审查与分阶段改进计划

## 1. 结论与边界

**结论：当前实现存在宿主适配阻断，当前工作区修改也不应按现有兼容承诺直接发布。** 首先应修复设置数据的实际消费入口，再处理启动语义、安装生命周期和验证缺口；继续增加字典条目不能解决这些问题。

本次交付是审查及实施计划，没有修改产品代码、安装用户环境、卸载组件或发布版本。实施步骤全部尚未执行。下文明确区分源码事实、已运行的探针、静态推断和未完成的端到端验证。

### 1.1 固定审查基线

| 项目 | 本次范围 |
|---|---|
| 分支与提交 | `main`，`85e7264`，提交标题 `feat: translate 18.0.9 new settings to Chinese (126 entries)` |
| 已跟踪文件 | HEAD 全部 12 个文件，不限于最近一次 diff |
| 原有工作区修改 | `README.md`、`dict/zh-CN.json`、`extensions/zhomp.ts`、`scripts/install.ps1`、`scripts/install.sh`，共 5 个 |
| 原有未跟踪文件 | `.gitattributes`，内容为 `*.sh text eol=lf` |
| 本次新增交付 | 本文 `IMPROVEMENT_PLAN.md` |
| 可用宿主 | Windows，Bun `1.4.2`；本机全局 coding-agent 与 pi-tui 均为 `18.3.2` |

“基线问题”表示 HEAD 已有该设计；“工作区新增”表示尚未提交的修改引入；“检出状态”表示当前磁盘内容问题，不能归因为 HEAD 的源码缺陷。

### 1.2 全文件覆盖与规模

| 文件 | 当前行数 | 审查重点与结论 |
|---|---:|---|
| `extensions/zhomp.ts` | 184 | 上游对象来源、启用门控、类型边界、原地改写、翻译范围；见 R01、R02、R05、R09 |
| `dict/zh-CN.json` | 2156 | 2154 个唯一键；无重复键、非字符串值或空值；数据文件无需为 1000 行门槛机械拆分 |
| `scripts/install.sh` | 87 | 定位、模板、失败状态、目标路径；见 R03–R06 |
| `scripts/install.ps1` | 57 | cwd、ASCII 路径损失、home、失败回滚；见 R03–R06 |
| `scripts/uninstall.sh` | 52 | 自有文件清理、行尾；见 R07、R08 |
| `scripts/uninstall.ps1` | 43 | home、字典残留、精确路径删除；见 R05、R08 |
| `package.json` | 25 | 无验证入口、过宽 peer 范围、发布文件遗漏；见 R01、R02、R10、R11 |
| `README.md` | 117 | 支持承诺、机制说明、包内链接、固定数量；见 R11 |
| `INSTALL.md` | 178 | 安装闭环、验收依据、旧机制说明；见 R11 |
| `AGENTS.md` | 85 | 模块归属、变量契约、跨平台命令和卸载规则；见 R05、R11 |
| `.gitignore` | 15 | 依赖、构建、日志忽略；未发现需要单列的问题 |
| `LICENSE` | 21 | MIT 与包元数据一致，发布包含许可证；历史署名不作为缺陷 |
| `.gitattributes` | 1 | 正确声明 shell 使用 LF，但尚未纠正当前 `uninstall.sh` 的 CRLF；见 R07 |

HEAD 扩展为 172 行，当前为 184 行，没有执行代码从不足 1000 行跨越到超过 1000 行。真正需要压缩的是重复的路径、宿主结构和 launcher 知识，不是增加文件数量。词典计数 HEAD 已为 2004，工作区新增 150 条至 2154；文档中的 1878 是既有漂移。

词典审查覆盖全量结构和运行时使用边界；不将结构检查等同于每条译文的人工语言质量认证，也不把词典条目数等同于界面覆盖率。

## 2. 证据与验证记录

### 2.1 已执行

| 编号 | 命令或探针 | 实际结果与能证明的范围 |
|---|---|---|
| E01 | `git diff --check` | 通过；仅证明变更的空白格式检查通过 |
| E02 | JSON 全量解析，保留原始键对检查重复 | 工作区 2154 个唯一键，无重复键、非字符串值、空值；HEAD 2004 个键 |
| E03 | `bun pm pack --dry-run` | 命令成功，9 个文件；包含 LICENSE，不包含 INSTALL.md。打包命令成功不代表发布内容验收通过 |
| E04 | `bun --version`、`bun pm root -g` | Bun 1.4.2；后者退出 1，`error: "root" unknown command`。不得把它推荐为替代定位命令 |
| E05 | 在实际宿主包目录执行 `bun --no-install --no-env-file src/cli.ts --version` | 退出 0，输出 `omp/18.3.2`；未加载并验证完整汉化界面 |
| E06 | 导入仓库扩展，清除 `OMP_ZH_ENABLED`，调用默认 factory | 退出 0，输出 `factory_disabled=returned`；只验证未启用路径正常返回 |
| E07 | 在实际宿主包目录用 `Bun.resolveSync` 和 `import` 探测四个公开子路径 | `config/settings-schema` 无法解析；`config/all-settings`、`config/settings-ui`、`pi-tui/overlays/settings-defs` 成功，分别看到 `orderedSettings`、`createSettingsHost` 和 tab/group 导出 |
| E08 | 当前工作树文件通过 WSL GNU Bash 5.2.21 执行 `bash -n` | install.sh 退出 0；uninstall.sh 退出 2，line 11 `elif` 附近语法错误 |
| E09 | 读取 uninstall.sh 字节；只把 CRLF 归一化为 LF 后，通过同一 Bash 的 stdin 执行 `-n` | 原文件 52 个 CRLF；归一化副本退出 0，原文件未修改。确定是当前检出行尾造成解析失败 |
| E10 | Windows PowerShell 原生 Parser 解析两份 `.ps1` | 两份均 `parserErrors=0`；仅语法检查，不是安装运行验收 |
| E11 | PowerShell ASCII 编码往返，输入中文包路径 | `ASCII preserves Unicode path: False`，结果含问号；证明 `-Encoding ASCII` 无法保留该路径 |
| E12 | 运行实际宿主 `resolveCliArgv()` | `["--cwd", "C:/zhomp-review-project", "read", "./project-marker.txt"]` 被转换为 `["read", "./project-marker.txt"]`；git 同样丢弃前置 cwd。只证明分派行为 |
| E13 | 独立项目哨兵文件与当前 `.cmd` 模板的完整 CLI 探针 | 直接源码 read 在 25 秒超时；修正 cmd 调用引号后的模板探针在 15 秒超时。未得到文件读取/cwd 的端到端结果 |

E07 的宿主目录：`C:/Users/35181/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`。探针禁用了 Bun 自动安装，未把仓库目录的临时包解析结果当成宿主证据。

并行审查曾从仓库目录直接导入新版 registry/UI；该次解析落到 Bun cache，并因 `pi_natives` 缺失失败。它既不是全局宿主启动失败证据，也不是字典覆盖率结果。后来从真实全局包目录执行的 E07 成功导入新版入口。

E13 最初用一种 cmd 参数封装得到 `The syntax of the command is incorrect.`；检查临时 `.cmd` 内容及 CRLF、改用规范的 `/d /s /c` 引号形式后，该错误不再出现而进入超时。因此**不把该错误认定为产品 launcher 的语法缺陷，也不将完整 cwd 行为标记为已复现**。

### 2.2 未执行或未完成

- 没有运行真实安装、升级或卸载；没有改动用户的 `.omp` 与 `.bun` 安装产物。
- 没有打开真实 `zhomp`/`omp` 的 `/settings`；共享模块对象身份、完整显示效果、配置值不变、官方英文隔离尚未完成验收。
- 没有原生 macOS、Linux、Git Bash、PowerShell 5.1 的安装—启动—卸载全矩阵。
- 没有最低支持版本的真实 TUI 验证，也没有安装故障注入与回滚验证。
- launcher 完整 CLI 探针超时；cwd 风险目前来自源码调用链及 E12，不是完整文件读取结果。

不得用 E05 的 `--version`、日志“汉化完成”或零计数日志替代这些验收。

## 3. 高置信度问题与结构性改进

优先级：P0 为已验证的当前目标宿主核心阻断；P1 为支持场景、路径、启动或安装生命周期风险；P2 为需要治理的维护性及发布契约缺口。词典固定数量为 P3，合并到文档治理项，不另起低价值修复。

### R01 · P0 · 当前宿主入口契约失效，旧 schema 不能继续作为必需入口

**来源：HEAD 基线问题；工作区仍保留。** 证据：`extensions/zhomp.ts:83,124`、`package.json:17`、E07。

扩展始终导入 `@oh-my-pi/pi-coding-agent/config/settings-schema` 并使用 `SETTINGS_SCHEMA`。在实际安装的 18.3.2 包目录中，该 spec 无法解析；同一目录中 `config/all-settings`/`config/settings-ui` 可成功导入。

实际消费者为宿主 `src/config/settings-ui.ts:2,4,51-65`：通过 `orderedSettings()` 取得 `setting.ui`，再构建 SettingsHost entries，tab 定义来自 pi-tui。这个事实结合 E07，足以说明当前扩展初始化无法满足实际消费契约；不需要推断该文件在所有上游发布版本中的删除时间。

**修复方向：** 将“取得宿主正在使用的显示元数据共享引用”集中为一个适配入口。以 18.3.2 的 `all-settings`/`settings-ui` 消费链作为修复目标；核实初始化顺序和共享引用，不能仅构造一份新的 SettingsHost 副本后自称汉化成功。安装前验证入口与包版本；不支持的布局在任何写入前明确失败。

**关闭条件：** V01、V02、V10 全部通过。只有模块能 import 不足以关闭，必须证明真实设置界面消费了被修改对象。

### R02 · P1 · 新 pi-tui 依赖与旧版兼容承诺冲突

**来源：工作区新增。** 证据：`extensions/zhomp.ts:80-85,96,108`、`package.json:16-18`。

新增 `Promise.all` 无条件要求 `pi-tui/overlays/settings-defs`，而声明范围仍为 `>=17.2.4`。缺少该模块时，整个初始化在第一次翻译前结束。仅将该 import 改成可选，仍然不能解决 R01 的新版 registry 入口问题。

上游静态佐证：[17.2.4 的 schema](https://raw.githubusercontent.com/can1357/oh-my-pi/v17.2.4/packages/coding-agent/src/config/settings-schema.ts)、[18.0.9 的 schema](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.0.9/packages/coding-agent/src/config/settings-schema.ts)、[18.2.5 的 settings-defs](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.2.5/packages/tui/src/overlays/settings-defs.ts)。这些文件证明存在不同布局，不证明完整版本区间都可工作；注释中的“18.2+”不够精确。

**修复方向：** 默认建议只承诺已完整验收的宿主集合，先完成 18.3.2，再依据最低版本验证确定 peer 范围；这是待实施的产品支持决策，不能在未说明时静默删除旧版支持。若明确保留旧版，则将旧 schema 与新 registry 作为两套明确布局放在唯一适配边界内，主翻译逻辑只遍历统一的 UI 引用。禁止在各字段翻译循环散落版本分支，也禁止吞掉所有 import 错误伪装成旧版。

**关闭条件：** V01 支持矩阵、版本拒绝行为、包元数据及文档完全一致。不能继续用无上界 `>=17.2.4` 代替证据。

### R03 · P1 · 两份 launcher 的 cwd 补偿泄漏了宿主命令细节

**来源：工作区新增 cwd 风险，基线已有模板重复。** 证据：`scripts/install.ps1:42-45`、`scripts/install.sh:53-75`、E12、E13。

Windows 模板先 `pushd` 到宿主目录，再给脚本传 `--cwd <调用目录>`。该参数在 entry 之后，是 **OMP 脚本参数，不是 Bun cwd 参数**。宿主 `src/cli-commands.ts:394-443` 在 read/git 等非 launch 子命令前会删除它；E12 已实测此行为。相关命令随后依赖进程 cwd，例如 `src/cli/git-tui.ts:20-24` 使用 `options.cwd ?? process.cwd()`。

[INFERENCE] 新流程可能把相对文件路径、Git 仓库和相对 `--cwd` 解析到全局包目录。完整 CLI 探针尚未证实最终结果，不能写成已复现的 read 失败。

**修复方向：** 统一一个启动实现，让应用模块初始化和命令路由之前的真实 cwd 等于调用者项目；如果为避免调用项目 Bun 配置而从宿主目录启动，应由明确 bootstrap 在 import 主入口前恢复 cwd。不能依靠 launch 专用参数修补所有子命令。删除 PowerShell 长转义字符串与 Bash heredoc 中重复维护的 `.cmd` 业务逻辑。

**关闭条件：** V03、V04；read/git、相对 cwd、参数、退出码须观察真实结果。

### R04 · P1 · 包定位建立在不可移植工具和未经验证的目录推导上

**来源：HEAD 基线；工作区改善了一部分命令，但未解决布局假设。** 证据：`scripts/install.sh:31-44`、`scripts/install.ps1:20-33`、E04。

- `readlink -f` 不是 macOS 默认 BSD 工具链的可移植接口。这里它嵌套于 `dirname`，**不能据此声称 `set -e` 必定立即中止或回退永远不可达**。并行审查的独立边界探针已观察到外层返回 0、产出 `./install` 的情况。
- 从常见 `~/.bun/bin/bun` 的父目录直接追加 `install/global`，会先得到错误的 `~/.bun/bin/install/global`。
- 全局 bin 与 globalDir 可以独立配置；`bun pm bin -g` 只能作候选信息，不能唯一确定包根。
- Bash 只检查目录存在，PowerShell 会检查 `src/cli.ts`；两平台对损坏安装接受标准不同。
- `bun pm root -g` 在本机实测不受支持，不能作为替代方案。

**修复方向：** 统一计算一次绝对包根；依据所支持 Bun 的实际配置/显式路径和经验证的默认布局生成有限候选，然后核对包身份、源码入口和 R01 的宿主接口。定位错误不得进入目标写入阶段。删除 GNU readlink 依赖，而不是再堆一层吞错分支。

**关闭条件：** V05；原生 macOS 必测，模拟不支持 `-f` 的探针只算附加证据。

### R05 · P1 · 安装根、扩展发现与字典查找没有统一契约

**来源：HEAD 基线。** 证据：`install.sh:12-23`、`uninstall.sh:9-20`、`install.ps1:8-11`、`uninstall.ps1:6-9`、`extensions/zhomp.ts:49-54`。

Bash 支持 `OMP_ZH_HOME → USERPROFILE → HOME`，PowerShell 仅使用 `$HOME`；扩展又独立使用 `os.homedir()` 查字典。单纯补上 Windows 覆盖变量，还不能证明非默认安装根中的扩展会被宿主发现、字典会被加载。

另一个同层边界问题是 PowerShell 把包含用户绝对路径的 launcher 用 ASCII 写出（`install.ps1:44-45`）；E11 证实中文路径变成问号。英文脚本输出要求不能推出用户路径也可以转成 ASCII。PowerShell 文件操作还使用可解释通配符的 `-Path`，应对用户路径采用 `-LiteralPath`。

**修复方向：** 定义一次规范化安装根，把已解析路径明确传到扩展发现/字典运行入口；保持显式 `OMP_ZH_DICT` 优先。对启动器中的 Unicode 路径使用可保真数据传递，避免多层字符串插值。不得重设用户 `HOME`/`USERPROFILE` 来掩盖契约问题。

**关闭条件：** V04、V06；必须包含非默认根真正启动和跨脚本卸载，不能只检查文件写到了临时目录。

### R06 · P1 · 顺序覆盖不能保证升级失败后仍可运行

**来源：HEAD 基线；工作区的启用门控放大后果。** 证据：`install.sh:48-75`、`install.ps1:37-45`、`extensions/zhomp.ts:78`。

扩展、字典、launcher 分别覆盖，中途失败没有恢复流程。尤其新扩展先落地、旧 launcher 尚未被替换时，旧 launcher 没有启用标记，新扩展会直接返回。

**修复方向：** 先验证所有输入，再准备产物与旧文件备份，逐项发布，launcher 最后替换；普通可捕获失败时按逆序恢复已改动文件。固定一份自有产物清单，安装与卸载按同一契约处理。

这些文件跨 `.omp` 与 `.bun`，不存在“一次 rename 原子替换全部文件”的保证。这里要求的是**命令失败返回后的状态一致性**；不把 staging 宣称为跨目录事务，也不凭空承诺掉电/强杀瞬间的 crash atomicity。若后续需要该保证，应另行设计单一可切换 payload，不能在本修复中混淆。

**关闭条件：** V07，首次安装和升级分别故障注入，逐个写入点验证旧状态恢复。

### R07 · P1 · 当前检出的 uninstall.sh 因 CRLF 无法被 WSL Bash 解析

**来源：当前检出状态；不归因于 HEAD 的 shell 逻辑。** 证据：E08、E09、`.gitattributes:1`。

当前 uninstall.sh 含 52 个 CRLF；直接 `bash -n` 在 line 11 失败。仅转换为 LF 后，同一 Bash 检查通过。新增 `.gitattributes` 声明是正确方向，但属性声明不会立即修复已有工作树字节。

**修复方向：** 保留 `*.sh text eol=lf`，将两份 `.sh` 实际检出内容归一化为 LF，并检查提交与打包结果。不能把它泛化成 shell 控制流语法错误。

**关闭条件：** V08；必须直接检查工作树原文件以及解包文件，不接受只检查归一化副本。

### R08 · P2 · 卸载把自有字典删除绑在了目录清理条件上

**来源：HEAD 基线。** 证据：`uninstall.sh:34-44`、`uninstall.ps1:25-35`。

目录同时有 `dict.json` 和用户文件时，两个卸载器都保留自己的字典；再次卸载仍无法清理。正确边界应是“删除已拥有文件，然后仅在目录为空时删目录”。

**结构性简化：** 先按精确清单删除自有文件，再尝试删除空目录。这样能删掉 Bash 的 `ls | wc | tr` 列表计数和两平台的 `remaining == 1` 特例。旁文件、隐藏文件和子目录无需特别分支就会保留。不能把这次简化变成递归删除 `.omp/zh`。

**关闭条件：** V09；包括重复卸载、额外用户文件和无 Bun 情况。原有卸载不依赖 Bun，改进后应保留这一能力。

### R09 · P2 · 字典与宿主形状边界不明确，重复字段逻辑掩盖不变量

**来源：基线已有；工作区增加 warning 后重复进一步增长。** 证据：`extensions/zhomp.ts:28-47,56-74,96-175`。

`JSON.parse` 直接断言为 `Record<string,string>`，顶层 null/数组/标量并不满足契约；混合值实际由 `tr()` 忽略，但解析边界没有说明。宿主数据一面被断言为完整类型，一面又逐层检查未知结构，readonly 数组再转为可写。新增字段需复制“检查、查字典、比较、赋值、计数”整段流程。

**修复方向：** 保留仓库要求的最小类型视图，入口处先校验 JSON 根和宿主支持的形状；集中一个仅处理显示字段白名单的小函数，tab/group 数组仍单独原地处理。不递归翻译任意字符串，不引入完整宿主类型耦合，不需要通用 visitor 框架。约定非法根拒绝且不修改宿主；混合对象中的非字符串/空值沿用忽略语义，并提供明确诊断。

warning 当前计入 description 是日志粒度选择，单独再加计数器收益有限；可在整理字段策略时决定是否细分，不能以该项抢占宿主适配修复。

**关闭条件：** V02；非显示字段、配置 value、数组身份、重复调用结果须保持不变。

### R10 · P2 · 验证只有人工描述，无法为兼容承诺提供回归证据

**来源：HEAD 基线。** 证据：`package.json:19-24` 只有安装/卸载命令；仓库没有可执行验证入口。

本轮已发现 `--version` 成功但必需接口不可导入、打包成功但教程缺失、属性正确但当前脚本仍为 CRLF。这说明命令成功和产品契约成功是不同的验收。

**修复方向：** 建立一个验证入口，行为测试随对应修复一起提交；将平台真实 smoke 与隔离 fixture 分开报告。永久测试保护边界、状态转换和消费者结果，不测源码字符串、转发次数或固定日志措辞。缺少平台/宿主环境记为 SKIP，并让要求完整矩阵的发布检查返回非零。

**关闭条件：** V01–V11 均有可执行入口与明确输出；不能把测试工作全部推迟到修复之后。

### R11 · P2/P3 · 发布包与多份文档的重复事实已经漂移

**来源：包清单和计数为基线问题；新模块/门控说明不同步为工作区问题。** 证据：`package.json:12`、`README.md:11,23-30,78`、`INSTALL.md:76,79,123,162`、`AGENTS.md:11-15,48,58,67-70`、E02、E03。

- P2：发布包不含 INSTALL.md，但 README 将用户导向该相对链接。
- P2：AGENTS 仍把 tab/group 放在旧 schema，INSTALL 仍用 bundle 天然隔离解释英文界面；与工作区的启用标记不一致。
- P2：AGENTS 统一使用 `zhomp.cmd --version`，不适用于 Unix；又要求整个字典目录被删，与保留用户旁文件的要求冲突。
- P3：1878 的计数早已过期；日志“汉化完成”本身也不能证明 UI 命中了正确对象。

**结构性简化：** INSTALL 负责操作流程及支持矩阵；README 保留摘要和链接；AGENTS 保留工程不变量并引用操作流程。删除人工维护的计数，不增加文档生成框架。支持范围、实际入口、启用条件、显示字段和卸载边界随代码同一提交更新。

**关闭条件：** V11；解包后检查链接，不只检查源码仓库。

## 4. 目标结构与必须保留的不变量

建议的三个简化点：

1. **一个宿主适配边界。** 对支持的布局返回实际消费的 UI 对象、tab 元数据和 group 数组引用；18.3.2 走 `orderedSettings()` 消费链，旧 schema 只能是明确支持旧版本时的独立实现。翻译流程不承担版本选择。
2. **一个安装计划和启动实现。** Bun 已是安装前提，可将路径、包检查、产物清单、模板生成和失败恢复收敛到小型安装核心，sh/PowerShell 保留平台入口及语言输出；保留原生卸载能力。若引入 bootstrap 文件，须同时迁移复制清单、发布清单及卸载清单，不能只复制旧的单个 zhomp.ts。
3. **直接的字段白名单与删除流程。** 字段策略消除复制分支；先删自有文件、再删空目录消除计数特例。不要为了“拆模块”把 184 行扩展变成多个薄包装层。

不可改变的行为：

- 不修改官方包的任何文件；官方独立 `omp` 进程在未启用条件下保持英文。
- 只改显示字段；setting id、tab id、option.value、default、enum、校验和回调均保持原值/身份。
- group 数组原地更新，schema UI group 与 tab group 列表一致。
- factory 仍为 async；`OMP_ZH_ENABLED` 只有精确值 `1` 才允许翻译。
- 显式 `OMP_ZH_DICT` 优先，未命中字串保持英文；缺失/损坏字典不妨碍宿主本身运行。
- 安装不改调用者全局环境，卸载只删除本项目拥有的产物，用户配置/会话/旁文件不变。

## 5. 分阶段原子实施步骤

每行代表一个可独立审阅的变更单元；实现、必要行为回归和对应文档在同一提交。只实现而没有对应验收证据不得标记完成。下列新脚本名称是计划接口，不代表当前仓库已有。

### 阶段 A：固定契约并建立可运行的验证入口

| 步骤 | 依赖 | 原子交付与范围 | 严格验收 |
|---|---|---|---|
| A1 支持矩阵 | 无 | 在 INSTALL 固定 Bun/OMP 目标与下界；18.3.2 为本轮修复目标。记录是否保留旧布局，不预先谎称兼容 | 每个声明版本都有具体包版本、布局、验证状态；未验证不得标 PASS；peer 范围与决定一致 |
| A2 验证入口 | A1 | 新增 `scripts/verify.ts` 与 `bun run verify`，按 `--case Vxx` 选择场景；报告环境、结果与证据路径 | PASS/FAIL/SKIP 可区分；失败返回非零；`--require-all` 遇到 SKIP 也非零；不改真实 home |
| A3 路径与产物契约 | A1 | 在 INSTALL 记录 home 优先级、显式字典优先级、各平台产物清单、卸载保留规则 | 当前 Bash 的扩展/字典/两个 launcher 与 PowerShell 的扩展/字典/cmd 分别列清，不强加不需要的另一平台产物；新增 bootstrap 必须列入 |

阶段门槛：支持范围、运行根、产物归属无歧义；验证入口能报告当前已知失败。A2 不依赖后续修复通过。

### 阶段 B：恢复宿主适配与翻译边界

| 步骤 | 依赖 | 原子交付与范围 | 严格验收 |
|---|---|---|---|
| B1 当前宿主适配 | A1、A2 | 在扩展引入单一宿主适配函数，支持 18.3.2 的 all-settings/registry 共享对象；移除该路径上必需的旧 schema import | V01 当前宿主 + V02；真实 host entries 对应字段可见变更，非显示字段不变；V10 至少完成当前宿主 |
| B2 兼容范围闭合 | B1 | 按 A1 决定：保留旧版则在适配边界实现明确旧布局；收窄则同步 peer、安装拒绝与说明 | V01 每个承诺版本通过；缺模块/不支持版本在任何修改前清晰失败；不得用 catch-all 抹去真实错误 |
| B3 字典与字段规则 | B1 | 校验 JSON 根，集中显示字段白名单，删除重复字段块和多余类型断言；保持在现有文件内即可 | V02 的输入/引用/值/幂等断言全过；新增 warning 不再需要再复制整段流程 |
| B4 隔离边界 | B2、B3 | 保留门控，验证普通 omp 与 zhomp 的启用范围；更新 README/INSTALL/AGENTS 的对应契约 | V02 禁用场景及 V10 官方英文隔离通过；继承启用标记的子进程行为也须记录，不能承诺未测的“永远无影响” |

阶段门槛：当前目标版本真实 `/settings` 可用；声明旧版的每一个布局有完整证据。仅导入通过不能完成 B1。

### 阶段 C：统一路径与启动语义

| 步骤 | 依赖 | 原子交付与范围 | 严格验收 |
|---|---|---|---|
| C1 包根定位 | A2、B2 | 收敛两安装器的包定位，删除 readlink -f，验证绝对包身份、cli 和宿主接口 | V05；默认/自定义/损坏候选结果明确；失败零目标写入；不使用 bun pm root -g |
| C2 home 与运行路径 | A3、C1 | 两个平台统一优先级；将安装根的扩展发现及字典位置传至运行期，显式字典变量仍优先 | V06；非默认根能实际显示中文；默认根不变；sh→PS 与 PS→sh 卸载同一根 |
| C3 单一启动语义 | B2、C1 | 收敛 `.cmd` 模板知识，必要时新增小 bootstrap；在宿主初始化/分派前设定真实调用 cwd | V03；read 哨兵、git、相对 --cwd、普通交互逐一验证，不以 --version 代替 |
| C4 编码与参数边界 | C2、C3 | 去除 ASCII 用户路径损失；用户路径用 LiteralPath；按各 shell 规则传参，更新所有新增产物清单 | V04；Unicode、空格、方括号和 shell 元字符、非零退出码均保真；调用者环境/cwd 不变 |

阶段门槛：不同平台使用同一启动契约；有真实消费结果；不允许靠增加随机平台条件维持两套不同语义。

### 阶段 D：安装失败恢复与保守卸载

| 步骤 | 依赖 | 原子交付与范围 | 严格验收 |
|---|---|---|---|
| D1 安装预检与准备 | C1、C2、C4 | 目标写入前校验全部源文件、字典和包；准备完整产物 | V07 预提交故障场景：退出非零，既有文件哈希不变，无自动发现半成品 |
| D2 提交与失败恢复 | D1 | 按固定清单备份/替换，launcher 最后；失败恢复已更改文件，清理自己创建的临时文件 | V07 每个替换点失败、首次/升级、二次安装均验证；备份与临时文件在成功/正常失败后无残留 |
| D3 卸载简化 | A3、C2、C4 | 删除精确自有文件，再删空目录；移除目录计数分支；保留无 Bun 卸载 | V09；dict 加用户文件仍删除 dict；旁文件与目录保留；连续卸载两次无额外变更 |
| D4 行尾闭合 | A2，可与其他切片独立 | `.gitattributes` 与两 `.sh` 实际字节统一为 LF；覆盖打包文件 | V08；工作树直接 bash -n 通过，干净检出和包内文件也无 CRLF |

阶段门槛：命令正常失败后仍为完整旧安装或未安装状态；卸载不删除旁文件；不宣称未实现的跨目录掉电事务。

### 阶段 E：发布与用户文档闭环

| 步骤 | 依赖 | 原子交付与范围 | 严格验收 |
|---|---|---|---|
| E1 发布内容 | A2、最终产物清单 | package.files 加 INSTALL，并纳入需要的安装核心/bootstrap；排除本审查报告及验证临时产物 | V11 的真实 tarball 解包、文件存在和本地链接检查通过 |
| E2 文档去重 | B4、C4、D3 | INSTALL 为操作事实来源；README/AGENTS 引用；删除固定计数、无条件自动兼容、日志即成功等承诺 | 文档命令按平台可执行；支持矩阵与代码一致；仅 README/INSTALL 等现行说明不再声称当前为 1878，本文历史证据不纳入删除 |
| E3 发布门禁 | B–E1、E2 | CI/发布流程调用完整验证矩阵；关键 smoke 有可复查记录 | `bun run verify -- --require-all` 退出 0；任一必需场景 SKIP/FAIL 均阻断；版本提升与证据对应 |

阶段门槛：从打包产物而非源码目录完成安装—设置界面—卸载；官方命令和用户数据保持正常。

## 6. 严格验收场景

以下 `bun run verify -- --case Vxx` 为 A2 需要实现的接口；**当前仓库尚无该命令**。每个场景保存输入、实际输出、退出码、版本/平台、文件快照或 UI 证据。计数不够，必须断言具体值与状态。

| 场景 | 输入/操作 | 必须得到的结果 | 失败条件 |
|---|---|---|---|
| V01 宿主契约 | A1 的每个声明版本；18.3.2 当前布局；缺模块、不支持版本 | 解析到实际已安装包；当前布局使用 registry UI；每个承诺版本真实界面可用；拒绝场景在写入/修改前说明原因 | 自动解析到另一缓存包；旧 schema 仍是新版必需入口；未测版本标兼容；可选失败吞掉必需失败 |
| V02 翻译不变量 | 显示文本白名单、options、runtime options；缺键、null/数组/标量根、语法错、混合值；重复 factory；禁用标记 | label/description/warning/group/options 文本精确匹配字典；配置 value/id/default/enum/函数身份不变；group 数组 identity 不变且名称关联一致；第二次调用无额外变化；禁用值 unset/0/空串无宿主修改 | 任意逻辑键改变；部分 group 脱节；坏根修改宿主；使用副本而真实消费者不变 |
| V03 启动与 cwd | 独立项目放 marker.txt；执行 zhomp read ./marker.txt、git 子命令、普通交互、相对/绝对 --cwd | read 得到项目 marker 的准确内容；git 识别该项目；相对 cwd 以调用目录解析；应用初始化使用正确项目 | 指向全局包；只断言 argv 透传；只运行 --version；超时当通过 |
| V04 路径/参数 | PowerShell 5.1、cmd、Git Bash/POSIX；空格、中文、`[1]`、`$`、反引号、`%`、`!`、括号路径；旁目录和退出 37 的受控子进程 | 路径与 argv 原样到达；退出 37 原样返回；调用进程 cwd/env 不变；旁目录哈希不变；Git Bash 生成 cmd 可被原生 cmd 使用 | ASCII 问号；通配误命中；元字符变命令；caller 状态污染 |
| V05 包发现 | 原生 macOS 无 GNU coreutils、Linux、Git Bash；默认 Bun、独立 globalDir/bin、损坏/多个候选 | 唯一可解释的绝对包选择；包名/版本/cli/接口均匹配；缺依赖非零且零目标写入 | 调 readlink -f/root -g；仅目录存在就成功；选到无关包或相对路径 |
| V06 home 闭环 | OMP_ZH_HOME 与真实 home 不同；变量优先级组合；自定义 OMP_ZH_DICT | 所有平台用同一根；该根扩展实际被发现、字典实际生效；显式字典优先；默认目录无新增 zhomp 产物；跨脚本卸载一致 | 只验证文件复制；运行仍读取真实 home；修改系统 HOME 掩盖错误 |
| V07 安装恢复 | 未安装/已安装两种起点；每个 prepare/replace 写入点注入失败；成功安装两次 | 失败非零，原文件路径集合与哈希恢复；首次失败不留下自动发现扩展；旁文件不变；成功二次结果一致 | 新旧混合；旧 launcher 配新门控扩展；失败仍打印安装成功；成功/失败后遗留本次 staging |
| V08 shell 行尾 | 直接工作树、干净检出、真实解包文件；两份 shell 运行 bash -n | 文件无 `\r\n`；全部退出 0 | 只校验转换副本；属性已设置却未转换现有文件 |
| V09 卸载 | 空目录、仅字典、字典+普通/隐藏文件/子目录、未安装；运行两次；Bun 不可用 | 精确删除清单内自有文件；额外文件逐字节不变；仅空目录删除；第二次无额外修改；原生卸载仍运行 | 有旁文件便残留 dict；递归删除旁文件；误删通配旁目录；依赖 Bun 才能卸载 |
| V10 真实 TUI | 同一已验证宿主：zhomp /settings、官方 omp /settings、卸载后 omp | 已有字典中的 tab/group/设置/描述/选项/warning 可见中文；未知原文保持英文；配置值不变；官方英文；卸载后仍正常 | 只看日志或版本；settings 命令被当模型消息；缓存副本造成假成功 |
| V11 发布文件 | `bun pm pack --ignore-scripts` 得到 tarball并解包；从包内执行支持命令 | INSTALL/README/LICENSE/词典/扩展/全部所需安装及 bootstrap 文件齐全；本地文档链接可达；无临时探针/本审查报告；包内闭环通过 | dry-run 成功就认定完成；缺 INSTALL；引用未打包文件；源码可运行但包不可运行 |

可立即使用的语法及包级检查（这些命令不代替完整矩阵）：

```bash
bash -n scripts/install.sh
bash -n scripts/uninstall.sh
bun pm pack --dry-run --ignore-scripts
git diff --check
```

平台门禁至少包含 Windows PowerShell 5.1/cmd、Git Bash、Linux、原生 macOS。WSL 的 LF/语法证据不得冒充原生 macOS 安装证据。界面 smoke 必须记录宿主版本和实际表面；不要求所有技术名词与单位被翻译。

## 7. 跟踪、依赖与最终完成定义

问题到步骤的闭合映射：

| 问题 | 实施步骤 | 关闭证据 |
|---|---|---|
| R01 当前宿主入口失效 | A1、B1、B3 | V01、V02、V10 |
| R02 旧版与新模块冲突 | A1、B2 | V01 |
| R03 launcher cwd/重复知识 | C3、C4 | V03、V04 |
| R04 包定位与 macOS 工具依赖 | C1 | V05 |
| R05 路径/home/编码边界 | A3、C2、C4 | V04、V06 |
| R06 失败混合安装 | D1、D2 | V07 |
| R07 当前脚本 CRLF | D4 | V08 |
| R08 卸载残留 | D3 | V09 |
| R09 字典与字段边界 | B3 | V02 |
| R10 缺少可执行验证 | A2、各步同行为测试、E3 | V01–V11 |
| R11 发布与文档漂移 | B4、E1、E2 | V11 及支持矩阵人工核对 |

依赖独立的工作可并行，例如 D4 与 B 阶段、E1 的 INSTALL 清单修正与 C 阶段；共享 launcher/产物清单由一个负责人整合。每个原子步骤先完成自己的验收再提交，不需要等所有 P1 消失才允许合入修复提交；**发布**必须等待全部 P0/P1 关闭和完整矩阵通过。

每步关闭记录至少包含：步骤 ID、变更提交、场景 ID、操作系统/Bun/OMP 版本、命令与退出码、预期/实际差异、证据位置、是否有 SKIP。不能只写“已测试”或“看起来正常”。失败步骤回退该原子提交及其安装产物，不动无关工作区修改。

最终完成条件：

- 宿主支持契约与真实消费入口一致；当前 18.3.2 和所有明确保留版本完成 TUI 验收。
- 未启用汉化时官方行为不变；只翻译显示字段，所有逻辑值与引用不变量成立。
- 全平台定位、home、路径编码、argv、cwd、退出码形成相同外部契约。
- 可捕获安装失败恢复旧状态；卸载清理自有产物并保留全部旁文件。
- shell 的工作树/提交/发布行尾一致；包内文档与所有运行文件齐全。
- P0/P1 无未关闭项，P2 按本文步骤完成，发布必需场景无 SKIP；所有声称的结果均有证据。

以上为实施前的审查和验收计划；本轮实际实施状态及证据见下节。历史问题的行号指向审查时快照，不代表重构后的当前位置。

## 8. 本轮实施记录

用户通过 ask 选择仅支持 OMP **18.3.2**。`package.json` 的精确 peer 版本是安装器的真源，写入 `launch.json` 后供启动器和扩展验证；18.3.1/18.3.3 在目标文件写入前拒绝。因收窄支持范围，版本提升为 **2.0.0**，不保留旧 schema 兼容分支。

### 8.1 阶段结果

| 阶段/步骤 | 实际交付 | 本地证据与限制 |
|---|---|---|
| A1–A3 | 精确支持契约、安装根/产物说明、V01–V11 验证入口及 require-all | package、INSTALL 与实际安装检查一致；缺少必需环境时 SKIP 不算 PASS |
| B1–B4 | registry 实例适配、实际解析的 TUI 根、显示字段校验、进程 PID 授权 | V02/V10；真实 loader + 385 个实际设置 entries + SettingsSelector render；中文 PTY 与官方英文 PTY |
| C1–C4 | 两安装器共享 Bun 核心、独立包发现、preload 恢复真实 cwd、Unicode/特殊字符传参 | V01/V03–V06；当前 Windows/PowerShell/cmd/Git Bash 已运行；原生 Linux/macOS 由 CI 分平台执行 |
| D1–D4 | 预检、文件备份/替换/逆序恢复、自有清单卸载、LF shell | 所有首次安装/升级替换失败点、重复安装、两种卸载器重复卸载及旁文件保留通过 |
| E1–E3 | 用户包包含教程和完整 runtime、文档去重、锁文件、类型检查、三平台 CI | V11 实际 tarball 解包/安装/真实宿主版本启动通过；远端 CI 未运行时不视为原生平台已通过 |

新增 `.omp/zh/zhomp.toml` 用作显式 Bun 配置。它曾命名为 `bunfig.toml`，真实打包发现 Bun 会排除该文件，现已完成整套调用/安装/卸载清单迁移。`.cmd` 只写 ASCII 命令语法，通过 `%~dp0` 取得 Unicode 安装目录，不写入损坏的用户路径字面量。

### 8.2 已观察的命令结果

环境：Windows，Bun 1.4.2，真实全局 OMP/pi-tui 18.3.2，PowerShell 5.1，Git Bash。测试安装均使用临时根，未升级或卸载用户真实安装。

| 命令/场景 | 实际结果 |
|---|---|
| `bun install --frozen-lockfile --ignore-scripts` | 退出 0，锁文件一致，无依赖变化 |
| `bun test tests` | 退出 0，10 pass / 0 fail；翻译边界 5 项，安装/发现/恢复 5 项 |
| `bun run typecheck` | 退出 0；严格 TypeScript 检查覆盖 extension/runtime/scripts/tests |
| `bun run verify -- --require-all` | 退出 0，V01–V11 全部 PASS，无 SKIP |
| `bun pm pack --dry-run --ignore-scripts` | 退出 0，15 个用户文件，含 INSTALL、CHANGELOG、runtime/zhomp.toml；不含审查报告、验证夹具和临时日志 |
| 实际 tarball 的 V11 | 解包后文件与本地文档链接完整；包内安装入口执行成功，安装后输出 omp/18.3.2 |
| `git diff --check` | 已跟踪工作区差异通过；未跟踪文档另行检查结构、尾空白和关键内容，不把本命令当成其验证 |
| 工作流 YAML + package.files 文件存在性 | 解析及清单检查通过 |

完整门禁的状态行：

```text
PASS V01 exact 18.3.2; validated real host and TUI
PASS V02 translation boundary regression tests passed
PASS V03 fixture read and launch observed caller cwd and process-bound authorization
PASS V04 Unicode/space path and exit-code forwarding passed
PASS V05 win32: native installer and installed real-host launcher output omp/18.3.2
PASS V06 custom home owns extension, dictionary and launch configuration
PASS V07 all publish failure points, exact version rejection, discovery and reinstall regressions passed
PASS V08 both shell scripts are LF and parse in the available Bash
PASS V09 native uninstallers removed all owned files twice and preserved normal/hidden/nested user files
PASS V10 entries=385, loader=true, rendered=true, label=深色主题
PASS V11 tarball contains every runtime/user document and its install command executes
exit=0
```

上面的状态行省略了机器绝对路径和 V10 的翻译统计，仅保留同次运行的判定与实际结论。另执行过缺少平台场景的 `--require-all` 检查，SKIP 时退出 1，未当作通过。

### 8.3 真实交互与隔离结果

使用原生 PTY 启动真实 CLI，隔离 agent/config 目录，不发送模型请求。在输入框发送 `/settings` 后检查实际终端文本：

| 条件 | 面板实际文本 | 结果 |
|---|---|---|
| 已安装 zhomp 的源码启动器 | `外观`、`主题`、`深色主题` | 通过 |
| 官方 dist/cli.js，显式加载扩展的额外对照 | `Appearance`、`Dark Theme`，无中文翻译 | 通过 |
| 官方 dist/cli.js，不带扩展参数，agent 自动发现目录中有已安装扩展 | `Appearance`、`Dark Theme`，无中文翻译 | 通过 |
| 执行真实卸载后，官方 dist/cli.js，不带扩展参数，目录中无汉化扩展 | `Appearance`、`Dark Theme`，无中文翻译 | 通过 |

四次探针都在找到目标文本后主动终止 PTY；记录为 `found=true, sent=true, cancelled=true, timedOut=false`，并非将子进程被终止后的 exitCode=1 当成正常退出。版本 smoke 和自动门禁的退出码分别独立验证为 0。

宿主渲染探针在导入前设置隔离的 `PI_CODING_AGENT_DIR`，`PI_CONFIG_DIR` 使用相对系统 home 的目录名；settings singleton 在 finally 中重置。临时脚本和日志位于系统临时目录，检查后删除，不纳入提交。

### 8.4 尚不能宣称的结论

- 本机验证不证明原生 macOS/Linux 已通过；对应 GitHub Actions 结果必须分别查看。代码已提供这些平台的安装及验证路径，没有伪造平台结果。
- 不发布 npm 包、不创建 release/tag；本次用户授权范围是实施、Git 提交和推送。
- 本轮按最终集成状态一次提交，保留用户原有字典增补和相关修复，不把中途失败探针写成成功证据。
