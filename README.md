# zhomp — OMP 中文设置界面

为 [OMP](https://github.com/can1357/oh-my-pi) 提供可卸载的中文设置界面，不修改官方包文件。

- `zhomp`：源码模式启动，翻译 `/settings` 的 tab、分组、名称、描述、警告和选项。
- `omp`：官方命令保持原有行为。
- 只改显示文字，配置项和选项的实际值保持不变。

当前支持范围、安装/升级/卸载命令、自定义目录、字典和验收流程统一见 **[INSTALL.md](INSTALL.md)**。不支持的 OMP 版本会明确拒绝，不宣称任意官方更新后自动兼容。

| 设置文本 | 中文 |
|---|---|
| Appearance | 外观 |
| Dark Theme | 深色主题 |
| Light Theme | 浅色主题 |

OMP 当前没有通用 i18n 接口。zhomp 通过启动器指定的真实宿主包，在扩展加载时改写 registry 的 UI 对象和 pi-tui 的 tab/group 共享引用；设置面板随后消费这些对象。启用标记绑定当前进程，避免普通官方命令和子进程因继承环境而启用汉化。

开发验证可运行 `bun test tests` 和 `bun run verify`；完整验收要求见安装指南。更新记录见 [CHANGELOG.md](CHANGELOG.md)，许可证为 [MIT](LICENSE)。
