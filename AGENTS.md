# AGENTS.md

zhomp 提供非破坏性、可卸载的 OMP 中文设置界面。安装、升级、支持矩阵、自定义路径、验收和卸载流程统一维护在 [INSTALL.md](INSTALL.md)；修改上述行为时先阅读对应章节并同步它。

## 宿主与模块身份

- 支持范围的唯一程序真源是 `package.json.peerDependencies["@oh-my-pi/pi-coding-agent"]`，当前为下限范围；安装验证宿主包身份与显示接口，启动与翻译验证实际安装版本及对象形状。扩大范围必须验证实际消费链，不能只改文档。
- 宿主 UI 来源是 `config/all-settings.ts` 的 `orderedSettings()` 返回对象；实际 `settings-ui.ts` 在打开面板时读取 `setting.ui`。tab/group 来源是宿主实际解析到的 pi-tui `overlays/settings-defs`。
- 用安装器解析并验证后的绝对包路径动态导入。禁止通过仓库裸包导入得到另一个 Bun cache 模块实例。
- `src/cli.ts` 保留为真正的 Bun 主入口；preload 在宿主初始化前恢复项目 cwd。worker 子进程必须仍能进入官方主入口。
- 扩展 factory 保持 async，并要求 `OMP_ZH_ENABLED` 精确为 `1`、授权 PID 等于当前进程；普通官方命令不因发现扩展或继承其他进程标记而汉化。

## 翻译不变量

- `/settings` 仅修改 `ui.label/description/warning/group`、`options[].label/description`、tab label 和 group 文本。
- 配置 id、tab id、option.value、default、enum 和函数身份保持不变。group 数组就地改写，和 UI group 名称一致。
- 最小接口与入口类型守卫足够；不引入完整宿主类型耦合，不使用 `any` / `as any`，不泛化为递归翻译任意字符串。
- 日志前缀 `[zhomp]`。字典无效时安全跳过，未命中原文保持不变；计数日志不能代替实际界面验证。
- 字典 UTF-8 JSON；保留专有名词、单位、数字、文件名和逻辑键。字典更新需重新安装或更新已安装字典。
- `/model` 仅由 preload 对验证过的 ModelHub 绝对路径做固定基础文案转换；角色数据不参与文案转换，角色名称和标签（包括 DEFAULT、SMOL 等内建值及用户自定义名称）作为专有名词保留原文。模型/provider/selector 逻辑值不变；栏目标题可翻译。未知源码原文加载，不改官方文件、共享 ModelBrowser 或 prototype。验收覆盖中英混合基础 UI 与原文角色，并覆盖 ANSI 和宿主提供的 native 描述。

## 安装生命周期

- sh/PowerShell 安装入口调用同一 Bun 核心；包定位、版本校验、产物准备与失败恢复集中处理。
- home 优先 `OMP_ZH_HOME` → Windows `USERPROFILE` → `HOME` → 系统用户目录。包位置与安装根分开，显式字典变量优先。
- 新增运行文件时，同时更新安装产物、卸载清单和 package.files；不留下旧副本/兼容别名。
- PowerShell 输出使用英文，路径操作使用 `-LiteralPath`；用户路径不能编码为 ASCII 字面量。shell 文件实际字节及 Git 属性均为 LF。
- 先删自有文件，再删空目录；卸载保留用户旁文件且不依赖 Bun。文件替换失败恢复旧文件，不宣称跨目录掉电原子性。

## 验证与提交

按 INSTALL 的验证流程运行行为测试和真实 surface smoke。区分 fixture、真实宿主组件渲染和完整 `/settings` 交互；SKIP 不能写成 PASS。发布门禁需要完整矩阵，不能用 `--version` 代替汉化证明。
- OMP 18.4.1 本机验证覆盖动态 getter 描述；运行时不能假设所有未来版本兼容，必须先通过真实 SettingsHost/SettingsSelector 验收。

修改运行行为后更新 CHANGELOG；支持范围收窄属于不兼容变更。提交前保留用户原有工作区改动，并只提交本次授权范围。远端以实际 Git 配置为准。
