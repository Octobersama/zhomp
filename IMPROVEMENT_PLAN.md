# zhomp main 全库审查与分阶段改进计划

## 当前执行计划：6cae446 全库审查整改与 Actions 修复

### 授权、基线与不可变约束

- 基线：`main` / `6cae446ef68be582cda9bb963a6f6ced35701849`；开始时工作区干净，远端为 `Octobersama/zhomp`。本节取代下方历史计划的执行状态。
- 用户要求：先写计划并整体复核，再分阶段完成审查项，最后修复仓库实际 GitHub Actions 报错；重大取舍及时询问。
- 本轮允许源码修改及隔离临时目录中的安装、测试和后台终端验收；不改全局 OMP、不在默认用户根部署，不重启或终止已有 omp 实例，不使用抢焦点的桌面自动化。
- 用户已选择：本机严格验收通过后提交并推送 `main`，随后核验该提交的真实 Actions 结果。读取日志不改变远端状态；需要额外凭据、权限、付费 runner 或支持范围变更时再询问，不绕过拒绝。
- 支持范围继续唯一来自 `package.json.peerDependencies`。不通过收窄支持范围、删除失败场景、吞异常或把 SKIP 写成 PASS 来关闭问题。
- 保留精确模块身份、源码形状与出现次数检查、未知源码原文加载、async 扩展和当前 PID 授权；不修改官方包、共享 ModelBrowser、配置逻辑值、角色／模型／provider 身份。

### 审查证据的限定与复核

| 编号 | 事项 | 已有证据与限定 |
|---|---|---|
| R01 | 旧版设置说明验收错误 | 18.3.2 原始源码说明与当前固定期望不同；内存 fixture 已确认正确翻译仍不等于新版期望。尚未执行本轮旧宿主矩阵。 |
| R02 | native 描述与压缩限制能力混淆 | 18.4.12 有 `describe()`，无压缩限制控件；测试不可由前者推断后者。与 R01 分开修复、分开记录结果。 |
| R03 | Model 固定文案目录漂移 | 159 个目录键中 13 个不在字典，12 个有翻译消费、`kinds` 已无消费；纯转换生成的 helper 已确认三个活跃键回退英文，不声称所有平台已渲染复现。 |
| R04 | 设置翻译重复表示 | 校验包装图、可写预检和实际修改重复表达字段；是结构改进，不代表已证明支持宿主发生部分修改。必须完整 prepare 成功后再 apply。 |
| R05 | 诊断所有权分散 | 三套队列和 drain 策略不同。`settings-ui.ts` 的 emit 已带 `[zhomp]`，扩展 reporter 回调再次加前缀；这是源码可达的双前缀路径，不声称已在用户屏幕复现。 |
| R06 | 自有产物清单重复 | 安装、两个卸载入口及验收各自维护清单；V11 漏列 `settings-ui.ts` 是未来漏检风险。当前 `package.files` 整包包含 runtime，不能称当前包缺文件。 |
| R07 | GitHub Actions 实际失败 | 必须取得具体 run／job／step 与报错后定位；不得把 R01／R02 静态结论冒充真实 CI 日志。 |

### 阶段 0：计划复核与执行接口

1. 整体阅读本节，检查每个审查项、非目标、执行归属、失败关闭和验收是否齐全。
2. 沿用已有测试 seam：`translateSettings`、真实 SettingsHost／SettingsSelector、真实 ModelHub ANSI／native、安装／卸载入口及已安装 launcher；只有诊断状态机需要新增独立模块 seam。
3. 先固定共享接口再并行实施。主代理拥有文档、共享诊断模块和扩展诊断接入；设置元数据、Model、设置验收、安装生命周期分别一名写入负责人。同一文件的诊断接入等当前负责人交付后再改。
4. 子代理实施期间不运行构建、lint、测试或格式化；由主代理在对应候选完整后按证据路径统一运行，避免对中间态重复验收。

**进入实施的门槛：** R01–R07 全部有负责人、可执行步骤和可观察关闭条件；计划不要求修改用户环境；没有把重构建议当成已复现故障。复核结果在下方进度记录中注明。

### 阶段 1：修复支持版本的两个独立验收假设（R01、R02）

1. 设置验收从所选宿主原始元数据建立说明基线，保留生产中有限模板优先、exact lookup 其次的顺序：静态说明匹配模板时使用原始来源中捕获的快捷键字面值，不套用新主题；仅动态 getter 按实际主题重新生成快捷键。不存在的新设置不强加给旧宿主；当前宿主已存在的模板路径仍必须被验证，不能全部跳过。
2. 将 Model 通用 ANSI、native tree、native picker 断言与压缩限制场景分开；以明确的宿主能力识别进入该场景，未知形状仍失败关闭，不以 `describe()` 代替压缩能力。
3. 补齐与此直接相关的版本差异断言；不得用 `>=` 行数／仅不抛异常／删除旧版 lane 代替语义验证。

**严格验收：** 独立目录的 18.3.2 真实设置消费者通过旧说明翻译及三个主题下的适用断言；18.4.12 真实 native 渲染通过而不被要求不存在的压缩控件；当前宿主存在压缩限制时仍实际打开输入条并验证中文标签、提示、动作 ID 和输入值。每个版本报告实际能力，不把不存在的 native 能力称为通过。最低版与当前版完整 V01–V11 不得 SKIP。

### 阶段 2：修复 Model 缺译并约束目录完整性（R03）

1. 让明确的固定文案目录成为一个受控来源，运行转换和随包字典完整性门禁共同消费；去掉确实不再使用的 `kinds` 目录项，不做模糊翻译或从整个字典扩大允许范围。
2. 补齐 12 个活跃键，保留 Unicode 标点、必要首尾空格和 placeholder；检查原始 JSON 无重复键。
3. translated 模式的已覆盖固定文案期望不再用英文兜底；用户自定义字典缺键的生产回退继续保留。
4. 在真实消费分支检查缺译对应的 footer、角色说明、新角色预览、assignment 状态等；即时赋值／网络请求不在 smoke 任务中执行。

**严格验收：** 活跃固定文案目录无缺失、空译文或等同原文；删除任一必需翻译能被开发完整性门禁拒绝；真实 ANSI／native 适用分支显示译文；ordinary／禁用扩展仍英文；角色、模型、provider、selector、枚举及动作 ID 不变；未知源码和空自定义字典仍原文加载。不能用命中计数代替消费结果。

### 阶段 3：设置翻译改为 prepare／apply（R04）

1. 在同一次受控遍历中完成宿主形状检查、字段可写性检查和待执行编辑准备；不建立仅用于下一轮遍历的 ValidatedSetting／Ui／Option 包装图。
2. prepare 阶段不修改 tab、group、显示字段、getter 或已有 getter 的字典状态；所有准备成功后才 apply。
3. 删除仅被测试消费的翻译计数、回调和汇总；将计数断言替换为现有消费者可观察的中文值及身份不变量，删除只锁定实现细节的断言。
4. 保留原 getter／setter、枚举性、对象／数组身份、首次未命中后实时命中和重复加载不叠包装。

**严格验收：** 后部字段只读或形状无效时，前部 tab／group／label 和已有 live getter 的字典状态完全不变；未命中→命中→未命中正确；重复加载保持 getter 身份；所有 id、value、default、enum、函数和数组身份保持。真实 SettingsSelector 中分组排序与中文显示一致；不宣称能够回滚任意恶意 Proxy／宿主副作用。

### 阶段 4：统一诊断状态机与生命周期（R05）

1. 新增独立 `runtime/diagnostics.ts`，统一拥有队列、`[zhomp]` 前缀和 reporter 接入／移除；Model、settings 和扩展不再各有一套队列。
2. 固定接口为 `reportDiagnostic(message: string): void`、`setDiagnosticReporter(reporter: ((message: string) => void) | undefined): void`；扩展在 UI 可用后接入宿主通知，shutdown 时解除。诊断模块不依赖翻译模块或宿主类型。
3. 生产者迁移为不负责前缀的消息；队列只在发送成功后移除消息，发送失败保留以供后续接入重试；不添加定时重试或遥测。
4. 删除旧模块 reporter 导出和所有旧调用，新增文件完整进入安装／卸载／打包；安装诊断模块不可用时，preload 的前置错误仍在进入 TUI 前报错。

**严格验收：** 运行期诊断在 UI 可用前仅排队（引导自身不可恢复错误仍按上一条前置报错）；排队消息在接入后按约定顺序到达且每条仅一个前缀；通知抛错后消息不丢失，重接入不重发已成功消息；shutdown 后不调用旧 context；真实扩展 session_start 消费同一队列。正常启动／补全无原始 `[zhomp]` 输出。新模块不产生新的宿主实例或修改官方文件。

### 阶段 5：集中自有产物清单（R06）

1. 用一个简单声明式源／目标清单表达静态运行文件及生成文件；安装器、Bash／PowerShell 卸载器和包完整性检查共同消费，删除平行的手写文件数组。
2. 清单与读取方式保持 Bash／PowerShell 5.1 原生可用；卸载不依赖 Bun，不要求读取用户凭据，不删除用户旁文件。
3. 同步安装预检、暂存替换、故障恢复、V06／V09／V10／V11、package.files 和安装指南，包含 diagnostics 及 Model 目录等新增模块。

**严格验收：** 从实际解包产物安装到带中文／空格／方括号的临时根，启动并消费汉化模块；Windows 与 Bash 无 Bun 卸载删除所有自有文件，隐藏旁文件和子目录保持；重复卸载安全；注入替换故障恢复原内容；符号链接／悬空链接在发布前拒绝。V11 检查新模块的实际打包与安装，不仅比较常量副本。

### 阶段 6：修复实际 Actions 失败并总验收（R07）

1. 读取 `Octobersama/zhomp` 最近失败的 run／job／step／日志，按具体根因归类；受限时先换可用的只读公开入口，确实需要授权时询问。
   - 已读取真实失败 run：`38967480486`（`6cae446`）；Ubuntu 最低版 job `117197510813`、macOS 最新版 `117197510302`、Windows 最新版 `117197510400`。五个矩阵任务在行为测试失败，Ubuntu latest 通过；不是所有失败都来自 R01／R02。
   - R07a：最低版 Model 源码返回 unsupported；定位有限补丁的旧版形状／出现次数，恢复实际支持，不能改测试为接受跳过。Model 切片负责。
   - R07b：最低版 `/prewalk` 的 `Arm or restart a one-shot model handoff` 缺译；另有 bare `/`、自定义 `/init` 和不存在的 nativeDetail 断言与旧补全接口不符。字典由 Model 切片补齐，主代理负责补全真实消费链适配。
   - R07c：macOS `/var` 与 `/private/var`、Windows `RUNNER~1` 与 `runneradmin` 指向同一目录，但测试作字面路径比较。首次 realpath 修正仅解决 macOS；Actions #4 进一步证明 Bun 仍保留 Windows 8.3 别名。最终测试／验收层使用 bigint `stat.dev`＋`stat.ino` 比较实际文件系统对象，不篡改 launcher 的 cwd；目录别名相同、不同目录必须不同。
   - R07d：Windows slash 首次宿主导入耗时超过默认 5 秒。主代理分离有明确时限的冷初始化和行为断言；不直接放大所有测试 timeout。
   - R07e：macOS 专属 Apple 选项的原名及 `macOS dictionary completions` 被覆盖门禁拒绝。保留专有名词 Apple，补译固定说明；设置切片收窄豁免，Model 切片拥有字典写入。
2. 将失败映射到已修复项或同一交付中的真实跨平台问题；不关闭测试、降低门槛、扩大 timeout 掩盖挂起，亦不凭本机通过声称 Linux／macOS 通过。
3. 对最终候选执行类型检查、完整行为测试、当前版及最低版完整验证，并针对 18.4.12 执行 native 能力消费链；命令不得降级／升级全局宿主。
4. 后台 ConPTY 或等价无焦点终端只启动隔离新进程，使用临时配置且阻断模型请求，实际打开 `/settings`、`/model` 和补全；退出自身测试进程后清理临时资产。
5. 更新 INSTALL／CHANGELOG 和本计划实际结果；远端操作获授权后推送、观察对应 commit 的 Actions 结果。若需要用户权限或 runner 资源，明确剩余门禁、责任人与恢复条件。

**总关闭条件：** R01–R07 每项均有最终源码位置和实际证据；`bun run typecheck`、`bun test tests`、对应版本 `bun run verify -- --require-all` 通过；无 SKIP 冒充 PASS；打包／解包／安装／无 Bun 卸载及回滚通过；真实 surface smoke 有输出证据；Actions 失败的根因被修复并区分本机结果和实际远端结果。没有未迁移调用、占位代码、遗留探针或未说明的关键门禁。

### 本轮进度与证据

- [x] 记录 R01–R07、阶段顺序、单一写入归属与严格验收标准。
- [x] 主代理整体复核计划：R01／R02 拆分验收；R03 区分活跃缺译与死键；R05 已复核 emit 和 reporter 回调，仅声明源码可达；R06 限定为清单漂移／未来漏检。确认 prepare-before-apply、无焦点隔离验收和远端授权门槛；修正运行期排队与前置引导报错的表述后进入实施。
- R01 实施复核：发现旧静态 fireworks 文案也合法匹配已有有限模板。修正计划中“模板仅对 getter”的不准确描述，保留生产 template-first 优先级，静态期望捕获源快捷键而非替换为新主题；不为迁就测试改变生产翻译。
- [x] 阶段 1：R01／R02。18.3.2／18.11.3 的真实设置消费者通过；18.4.12 native 覆盖通过且压缩能力明确 unavailable，18.11.3 压缩输入／动作覆盖通过。
- [x] 阶段 2：R03。158 个固定文案目录键随包译文完整；新增 12 个活跃键并删除死目录项。真实 ANSI／native 回退、角色预览和操作状态覆盖通过；assign/clear 在 ANSI strip 中被 strip 内容替代，只对实际 native hints 作该断言，不伪造 ANSI 可见证明。
- [x] 阶段 3：R04。prepare／apply 和全部调用迁移完成；8 个元数据行为用例通过，含后部错误不提前更新 live getter 字典、receiver／setter／身份保留。
- [x] 阶段 4：R05。三套队列合并为同一安装模块，旧 reporter 导出与桥接删除；3 个队列状态用例通过。原双前缀探针先失败、修改后输出单个前缀。
- [x] 阶段 5：R06。单一 TSV 清单、两个无 Bun 卸载入口、V06／V09／V10／V11 迁移完成；临时根回滚、旁文件保护与卸载通过。V11 在两个目标版本上实际消费解包安装的 SettingsHost／ModelHub，移走 `model-text.ts` 后真实消费失败、恢复文件后结束，不以 --version 替代。
- [x] 阶段 6 本机整改：R07a–e 均已修复。远端门禁按授权推送后的实际 run 判定，其结果以交付中的提交／Actions 链接为准，不由本机结果推定。

本轮源码落点：`extensions/zhomp.ts` 的 prepare／apply 与动态诊断接入；`runtime/diagnostics.ts`；`runtime/model-text.ts` 和 `model-ui.ts` 的有限旧形状及 native patch 归属；`install-manifest.tsv`、安装／卸载／验证消费方；两个真实 surface 探针与行为回归。

| 验收对象 | 已观察结果与边界 |
|---|---|
| 最终类型检查 | `bun run typecheck` PASS；Model＋诊断定向测试 7 PASS |
| OMP 18.11.3／18.3.2 行为测试 | 各 38 PASS、0 FAIL；字典完整性、平台路径身份、冷初始化和普通／禁用隔离均保留 |
| OMP 18.11.3／18.3.2 V01–V09 | 两版全部 PASS，安装／参数／回滚／Unicode 路径／无 Bun 卸载均在隔离目录执行 |
| OMP 18.11.3／18.3.2 最终 V10、V11 | 两版定向全部 PASS，无 SKIP；SettingsSelector entries=415／385。Model ordinary／translated／hostile、逻辑身份及配置零写入通过；真实解包消费及缺模块负向控制通过 |
| OMP 18.4.12 V10 | PASS，entries=397；nativeDescribe=covered，compactionCapability=unavailable。修复真实 native 状态 verb patch 被错误绑到预设能力的漏译后定向通过 |
| OMP 18.11.3 后台 ConPTY | 已实际打开中文 settings、model 及英文 `/Generate` 搜索得到中文补全；`--no-extensions` 三个表面均英文。两次 CLI exitStatus=0，原始输出无 `[zhomp]`；双缓冲终端解码并检查实际文本，无桌面抢焦点 |
| 生产环境与平台范围 | 临时安装和过滤凭据的独立 home／agent，launcher 及 host 的隔离 Bun 配置预加载网络阻断；未发送模型消息或修改用户设置。没有部署到默认根，没有重启／终止已有 omp；本机 Windows 不能代替 Linux／macOS 远端门禁 |

验证中发现并修正的测试前提：scoped native subtitle 是 `--models scope`，清空角色提示须使用独立 unscoped hub；unscoped hub 合法刷新本地 registry，不能污染 scoped 零刷新计数；ANSI 新回退提示包含按键和分段文案，不能拿 native 裸标题作整句期望。上述调整保留真实可见译文和逻辑身份断言，没有通过改变生产行为迁就测试。

最终集成门禁补充：上述修正完成后，针对最终运行代码重新串行执行两版的完整 `bun test tests` 与 `bun run verify -- --require-all`，18.11.3 和 18.3.2 均为 38 PASS、V01–V11 全部 PASS，退出 0、无 SKIP；不是仅拼接早期分段结果。18.4.12 的最终 native 定向 V10 另有通过证据。

Actions #4（`eda41ea`，run `38986279171`）的 Linux／macOS 四个任务均成功，Windows 两个任务各 37／38 通过，唯一失败仍是 `realpathSync` 未展开 8.3 路径的 cwd 字符串比较。追加修复集中到 `tests/verification-fixtures.ts` 的文件系统身份比较，以及安装测试／verify 调用方，生产代码未改变。本机实际创建长／短路径别名，观察到 realpath 字符串不同但 inode 相同；在真正的 8.3 TEMP／TMP 下运行全部安装测试为 10 PASS、0 FAIL，类型检查通过。新增别名相同／不同目录不同的回归后总行为测试数为 39；这不把 #4 的 Windows 失败改写为成功，远端结果仍须看后续提交的实际 run。

Windows 后续修正的本机验收：真实 8.3 TEMP／TMP 下 V03、V06 通过；`bun run typecheck` 通过；完整 `bun test tests` 为 39 PASS、0 FAIL。运行期翻译代码与已通过两个完整宿主矩阵及 ConPTY smoke 的候选相同，仅测试／验收的文件系统身份比较改变。

下列章节为先前轮次的历史计划与证据，不作为本轮通过证明。

## 历史执行计划：300477b 全库可维护性改进

本节对应 main `300477b` 上的当前工作区，覆盖本轮严格审查的全部 8 项结论。下方原有编号章节保留为历史审查和实施记录；其中的旧版本、旧优先级与“尚未执行”描述不代表本节进度。保留全部既有工作区修改，不提交、不发布、不升级全局 OMP、不安装到默认用户目录。

### 问题、优先级与关闭条件

优先级按影响和证据区分：P1 是已复现的非破坏性安装风险；P2 是已复现的行为缺陷或具体的验收缺口；P3 是数据维护或未来布局兼容风险，不宣称当前支持版已因该风险失效。

| 编号 | 优先级／证据 | 改进项 | 关闭条件 |
|---|---|---|---|
| M01 | P3；当前路径一致，未来风险为静态推导 | 保留宿主实际解析的 settings-defs 路径，统一宿主身份、版本和模块路径契约 | 安装、启动、扩展均使用同一解析实现；导出路径改变但接口不变的宿主夹具仍消费同一模块；真实 OMP 组件验收通过 |
| M02 | P2；真实宿主参数解析已比较 | 启动器按宿主语义识别禁用扩展，不再用字符串 includes 猜测 | 参数值中的 `--no-extensions` 不误禁用，等号形式正确禁用，`--` 后正文不当作选项；实际 launcher 回归通过 |
| M03 | P1；Windows 已复现原链接丢失 | 使用不跟随链接的目标检查，保护悬空符号链接 | 有效及悬空链接在任何发布前被拒绝；原链接、旁文件和目录状态不变；普通文件故障回滚仍通过 |
| M04 | P2；直接调用真实翻译入口已复现 | 动态 getter 首次未命中时也保持后续实时翻译 | 未命中→命中→未命中状态转换正确，重复加载不叠加包装，静态只读字段拒绝时不留下部分翻译 |
| M05 | P3；原始 JSON 检出 11 个重复键、3 个值冲突 | 每键只保留当前最后生效译文，建立原始数据唯一性检查 | 去重前后解析值完全相同；原始键无重复；检查能拒绝包含转义等价键的重复定义 |
| M06 | P2；自定义 globalDir 与默认目录规则存在确定分歧 | 验收与覆盖测试复用安装器的宿主发现规则 | 两个目录同时存在不同宿主时，安装与验收选择相同目标；明确配置错误不得被默认副本掩盖 |
| M07 | P2；非规范 fixture 版本被 Bun 接受已观察 | 从 peer 范围派生规范最低版本，供夹具与 CI 使用 | 不再把 `18.3.2 <19` 当版本；host manifest 必须是规范版本；夹具和 CI 下界无独立硬编码真源 |
| M08 | P2；四条已补译文本被现有过滤器豁免 | 收窄覆盖规则，只明确保留技术文本和数值单位 | 删除 Braille、Pulse、Ultrafast、transfer.sh-compatible endpoint 任一字典键会被覆盖检查发现；技术名称、单位、逻辑值仍保留 |

### 实施设计与职责

1. **宿主契约集中到 `runtime/host.ts`。** 它拥有包身份／规范版本／依赖范围检查、从选定宿主解析真实绝对模块路径、支持范围及最低版本解析、launch 配置读取。安装器保留环境／Bun 配置发现和文件发布职责，不让扩展依赖安装器的写文件逻辑。
2. **跨进程只传安装配置位置。** 启动器设置进程绑定的启用标记和绝对 `OMP_ZH_CONFIG`；扩展从该配置同目录加载安装随附的 host 模块，读取配置并重新校验宿主。替换旧的运行时包目录／TUI 目录／范围环境协议，不保留兼容分支。安装阶段的显式 `OMP_ZH_PACKAGE_DIR` 继续作为用户支持的包选择选项；`OMP_ZH_DICT` 继续优先于默认字典。
3. **真实模块身份贯穿消费链。** `HostPackage` 携带实际 registry、settings UI、settings-defs、CLI router／parser 和 CLI 入口路径；调用者不再次拼接 TUI 内部源码路径。保留安装、启动和翻译各阶段必要检查，而不是只在安装时检查一次。
4. **动态描述按属性种类处理。** 区分 accessor 与数据属性；只为可配置的显示字段 getter 安装一次实时映射，继续保留宿主对象、数组和逻辑字段。预检和应用规则必须一致。
5. **字典仍是单个 UTF-8 JSON。** 去重保留最后生效值，不重译既有条目，不因行数拆文件。开发检查在 JSON 解析丢失重复信息之前拒绝重复键；覆盖规则不再以单词数或整个功能类别判定无需翻译。
6. **生命周期完整迁移。** 新增 host 运行文件同步进入安装产物、两个无 Bun 卸载入口、发布包与验收清单。测试、真实组件探针及文档一起迁移，删除旧导出、旧配置字段与旧运行时环境变量消费方。

### 执行顺序与写入归属

- 先记录本计划，再实施。沿用现有公开测试 seam：`translateSettings`、安装／发布入口、已安装 launcher、真实 SettingsHost／SettingsSelector，不增加生产诊断入口。
- 生命周期切片负责宿主契约、安装与启动、符号链接保护、安装夹具与生命周期回归；翻译切片负责动态 getter、扩展的宿主契约消费和翻译回归；字典／验证切片负责去重、唯一性、覆盖规则及规范版本／CI 的消费迁移。
- 共享 Interface 先约定，独立文件并行；同一文件只有一个写入负责人。主代理负责集成、运行所有测试及 smoke，子代理不运行构建／测试／格式化。
- 已复现的三个行为缺陷不重复探测旧状态；把相同输入转为永久回归，在修复后重跑。新结构保留现有测试的用户可见断言，不新增只测转发、复制、源码拼写或布线的测试。

### 验收路径

| 编号 | 证据 | 负责人与边界 |
|---|---|---|
| A01 | 类型检查与完整行为测试，包括 M02–M08 的针对性回归 | 主代理；必须观察具体值／路径／保留状态，而非只断言不抛异常 |
| A02 | `bun run verify -- --require-all`，覆盖安装、回滚、卸载、打包与真实宿主组件 | 主代理；V10 不是完整 `/settings` 交互，SKIP 不计 PASS |
| A03 | 对已安装的真实 OMP 运行新参数语义、动态描述和新译文的独立 smoke | 主代理；隔离配置和安装目录，不触碰默认用户安装或凭据 |
| A04 | 最低支持版与当前实际版的真实 SettingsHost／Selector 验收 | 主代理；最低版放独立目录，禁止降级全局宿主；跨 OS 结果只认可实际 CI／实机记录 |
| A05 | 按最终内容打包、解包、安装并检查新运行文件可用及卸载完整 | 主代理；不能以 dry-run 或 `--version` 单独替代汉化证据 |

### 当前进度与结果

- [x] 记录 8 项问题、证据等级、实施 Interface 与验收路径。
- [x] M01／M06：共享宿主契约、实际导出路径与统一发现；显式配置错误不降级为缺失宿主。
- [x] M02：复用宿主参数解析；真实安装入口保留值形式、等号形式及用户 `--`。
- [x] M03：有效／悬空链接在发布前拒绝；快照记录链接目标，普通文件回滚保持。
- [x] M04：动态 getter 初始未命中→命中→未命中正确，重复加载复用包装。
- [x] M05：去除 11 个重复定义，2270 个有效键值与去重前完全一致；原始 JSON 检查拒绝转义等价重复键。
- [x] M07：具体 SemVer 校验，夹具和 CI 最低版本由 peer 范围派生。
- [x] M08：明确技术文本及数值单位规则；真实显示词条的删除回归检查通过。
- [x] A01／A02／A04：类型检查及两个真实宿主的行为／完整验证门禁通过。
- [x] A03：隔离终端实际打开 zhomp 与官方 omp 的 `/settings`，分别观察中文和英文；动态转换及全部显示字段覆盖由上述回归与真实组件验证守护。
- [x] A05：最终文档内容的 V11 打包／解包／安装验证通过，真实临时安装卸载成功；临时依赖、探针及失败测试目录已清理。

| 当前证据 | 实际结果 |
|---|---|
| `bun run typecheck` | PASS |
| OMP 18.4.12：`bun test tests` | 21 PASS，0 FAIL |
| OMP 18.4.12：`bun run verify -- --require-all` | V01–V11 全部 PASS；V10 使用已安装产物，entries=397 |
| 隔离 OMP 18.3.2：设置显式包路径后执行同一行为测试及完整验证 | 21 PASS，0 FAIL；V01–V11 全部 PASS；V10 entries=385 |
| 原始字典键对与原有效对象比较 | 2270 个原始键、2270 个唯一键；有效值完全相同 |
| 原生终端 OMP 18.4.12 `/settings` | zhomp 实际显示“外观／主题／深色主题”和中文描述；官方 omp 显式加载同一扩展并继承启用标记、使用错误授权 PID，仍显示 Appearance／Theme／Dark Theme 和英文描述 |
| 最终文档更新后：`bun run verify -- --case V11 --require-all` | PASS；发布包包含 host.ts，解包后的安装器和真实宿主启动成功 |
| CI 矩阵派生命令本机 smoke | 退出 0，输出 `["18.3.2","latest"]`；这不是远端 CI 运行结果 |
| 实施资源清理 | 真实 UI 临时安装的 PowerShell 卸载器退出 0，移除 host.ts 等全部自有文件；最低版依赖、探针和失败测试目录已删除，测试窗口已关闭；截图保留为会话临时证据 |

终端 smoke 使用临时安装、独立 agent/config 目录，以及关闭首次启动向导的临时 startup 配置；未配置模型或进行模型对话。终端抽查不等同于逐条目视觉验收，也不替代不同平台的 CI 结果。

本次终端证据已逐图核对：中文截图 `omp-computer-1597388bc23700fe.png`，英文对照 `omp-computer-15973a8c3af70103.png`（本机会话临时截图，非发布产物）。中文描述为“终端背景较暗时使用的主题”，英文对照为“The theme used when the terminal has a dark background”；不以 AX 容器树代替这些可见文本。

实施中额外定位了参数边界的根因：Bun 会消耗脚本参数开头的首个 `--`。生成的 Bash／cmd 入口和宿主子进程调用现在各自提供 Bun 的分隔符，再原样传递用户参数；原生启动回归通过真实安装入口执行，不通过删改预期值绕过问题。三次原生命令各有单进程期限，复合测试及验证调用方使用相应的整体期限；本机两个版本矩阵串行执行，并行启动造成的测试超时不计为通过。

上述结果为本机 Windows／PowerShell／cmd／可用 Bash 的证据。Linux/macOS 仍由 CI 矩阵覆盖，本轮不宣称远端 CI 或其他 OS 已通过。默认安装目录及全局 OMP 未改变；最低版仅安装在临时目录。

以下为保留的历史记录。

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

本节保留 2.0.0 实施时的历史决策：当时用户选择了精确支持 OMP 18.3.2。2.1.0 已按用户的新要求改为 `>=18.3.2`；当前安装/启动/扩展均以兼容范围和真实宿主接口校验为准。

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

环境：Windows，Bun 1.4.2，真实全局 OMP/pi-tui 18.4.1，PowerShell 5.1，Git Bash。测试安装使用临时根；本机生产安装的旧版本备份在 `.omp/zh-backups/`。

| 命令/场景 | 实际结果 |
|---|---|
| `bun install --frozen-lockfile --ignore-scripts` | 退出 0，锁文件一致，无依赖变化 |
| `bun test tests` | 退出 0，10 pass / 0 fail；翻译边界 5 项，安装/发现/恢复 5 项 |
| `bun run typecheck` | 退出 0；严格 TypeScript 检查覆盖 extension/runtime/scripts/tests |
| `bun run verify -- --require-all` | 退出 0，V01–V11 全部 PASS，无 SKIP |
| `bun pm pack --dry-run --ignore-scripts` | 退出 0，15 个用户文件，含 INSTALL、CHANGELOG、runtime/zhomp.toml；不含审查报告、验证夹具和临时日志 |
| 实际 tarball 的 V11 | 解包后文件与本地文档链接完整；包内安装入口执行成功，安装后启动当前宿主版本 |
| `git diff --check` | 已跟踪工作区差异通过；未跟踪文档另行检查结构、尾空白和关键内容，不把本命令当成其验证 |
| 工作流 YAML + package.files 文件存在性 | 解析及清单检查通过 |

完整门禁的状态行：

```text
PASS V01 compatible >=18.3.2; host=18.4.1; tui=18.4.1
PASS V02 translation boundary regression tests passed
PASS V03 fixture read and launch observed caller cwd and process-bound authorization
PASS V04 Unicode/space path and exit-code forwarding passed
PASS V05 win32: native installer and installed real-host launcher output omp/18.4.1
PASS V06 custom home owns extension, dictionary and launch configuration
PASS V07 all publish failure points, compatibility rejection, discovery and reinstall regressions passed
PASS V08 both shell scripts are LF and parse in the available Bash
PASS V09 native uninstallers removed all owned files twice and preserved normal/hidden/nested user files
PASS V10 entries=387, loader=true, rendered=true, label=深色主题
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

## 9. 2.1.0 兼容扩展补充

- 用户要求取消单一目标版本限制；`package.json` 现为 `>=18.3.2 <19`，安装器、启动器和扩展以有界 semver 与实际宿主/TUI 依赖接口校验。
- 本机实际宿主由 18.3.2 更新为 18.4.1。静态消费链仍为 `all-settings.orderedSettings()`、`settings-ui.createSettingsHost()` 和 pi-tui `settings-defs`。
- 18.4.1 新增动态 getter 描述。旧实现对 getter 直接赋值会在 `tui.mouse` 等设置处抛出 `Attempted to assign to readonly property`；现改为预检全部显示字段，并为可配置 getter 安装保持动态读取的翻译 getter。不可配置只读字段会在任何修改前安全失败。
- V10 用真实 18.3.2 与 18.4.1 分别验收：最低版 `entries=385`、新版 `entries=387`，两者真实 loader、SettingsHost、SettingsSelector 渲染均 PASS，无汉化失败日志；新版字典 2228 条，动态 getter 描述中文可读。
- 安装能力门在文件存在之外检查 `orderedSettings`、`createSettingsHost`、router 与 TUI tab/group 导出；缺少必需入口的夹具在目标文件写入前拒绝。
- 本机生产已经重装为 `supportedRange >=18.3.2 <19`、OMP 18.4.1。一次用于最低版验证的 Bun 环境变量未传入命令，曾临时将全局 OMP 降到 18.3.2；已立即重新安装 18.4.1，并再次核对 `omp --version` 与 V10。旧安装备份位于 `.omp/zh-backups/`，不属于安装器清单。
