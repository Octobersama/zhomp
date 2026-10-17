# zhomp — OMP 中文设置界面

为 [OMP](https://github.com/can1357/oh-my-pi) 提供可卸载的中文设置界面，不修改官方包文件。

- `zhomp`：源码模式启动，翻译 `/settings` 的 tab、分组、名称、描述、警告和选项。
- `/model`：部分汉化标题、基础说明、操作提示和空状态；角色名称及标签（包括 DEFAULT、SMOL 等内建角色和自定义角色）作为专有名词保留原文。模型名、供应商、ID、快捷键和技术参数也保留原文。
- 交互式 `/` 补全：核心命令、静态子命令及附带的 `/init`、`/green`、`/review`、`/annotate`、`/autoresearch` 说明显示中文。只转换显示结果，保留原英文检索/排序、命令值、执行逻辑及 ACP/RPC；动态状态和角色名称保留原文。来源匹配边界见安装指南。
- `omp`：官方命令保持原有行为。
- 只改显示文字，配置项和选项的实际值保持不变。

当前最低兼容版本、安装/升级/卸载命令、自定义目录、字典和验收流程统一见 **[INSTALL.md](INSTALL.md)**。上游设置内部接口变化时会安全跳过并给出诊断，不承诺任意未来版本都无需更新。

| 设置文本 | 中文 |
|---|---|
| Appearance | 外观 |
| Dark Theme | 深色主题 |
| Light Theme | 浅色主题 |

OMP 当前没有通用 i18n 接口。zhomp 在授权扩展加载时仅转换 TUI autocomplete 的已知命令说明输出，不修改官方命令元数据；设置面板仍由扩展翻译 registry UI 对象和 pi-tui 的 tab/group 共享引用。启用标记绑定当前进程，避免普通官方命令和子进程因继承环境而启用汉化。

Model 页面及设置消费者追加的环境变量说明，由 preload 在宿主导入对应模块前注册精确路径的内存文案转换，不改官方文件或共享组件方法；未知源码形状保留英文。旧安装需重新运行安装脚本，部署运行模块、共享诊断队列及 Model 固定文案目录、新版扩展和启动器。安装及无 Bun 卸载共用发布目录中的 `install-manifest.tsv`。

内建及明确覆盖的 OMP 附带斜杠命令说明仅在 TUI autocomplete 显示层转换；canonical 英文 metadata、搜索排序、ACP/RPC 目录及命令执行数据不改写。公开补全项没有完整来源信息，同名且说明精确匹配已知 canonical 文案的自定义、文件或扩展覆写也会跟随翻译；未知命令名或文案保持原文。

开发验证可运行 `bun test tests` 和 `bun run verify`；完整验收要求见安装指南。更新记录见 [CHANGELOG.md](CHANGELOG.md)，许可证为 [MIT](LICENSE)。
