// OMP 中文汉化扩展（非破坏性，可插拔）
//
// 原理：
//   在扩展加载阶段（早于设置面板首次打开与 cachedDefs 构建），改写
//   settings-schema 的 label/description/group/options 字符串。
//   要求以源码模式启动 omp（`bun <pkg>/src/cli.ts`，由安装脚本生成的
//   `omp-zh` 命令负责），此时扩展与主程序共享同一磁盘模块实例；
//   若以官方 bundle（dist/cli.js）启动则 schema 被内联，扩展无法触及，
//   汉化不生效（但也不报错、不影响功能，界面保持英文）。
//
// 可插拔：
//   - 安装：scripts/install.{sh,ps1} 复制本文件到 ~/.omp/agent/extensions/
//     并生成 `omp-zh` 启动命令 → 用 `omp-zh` 启动即汉化
//   - 卸载：scripts/uninstall.{sh,ps1} 删除扩展与启动命令 → 恢复英文
//   - 官方 omp 命令不受影响，始终英文
//
// 兼容性：
//   - 不修改任何官方文件，官方更新后自动适配（未命中的英文保持原样）
//   - 只翻译显示文本（label/description/group/options.label/options.description），
//     绝不翻译 value（value 是程序逻辑键）
//
// 字典：
//   默认 `~/.omp/zh/dict.json`（en -> zh 映射），可用环境变量
//   `OMP_ZH_DICT` 指向其他路径。

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

// settings-schema 内部结构的最小视图（避免依赖完整类型，且与官方模块实例共享）
interface UiOption {
	value: string;
	label: string;
	description?: string;
}
interface UiMeta {
	tab?: string;
	group?: string;
	label?: string;
	description?: string;
	options?: UiOption[] | "runtime";
	[key: string]: unknown;
}
interface SchemaDef {
	type: string;
	ui?: UiMeta;
	[key: string]: unknown;
}

/** 字典路径：优先 `OMP_ZH_DICT` 环境变量，默认 `~/.omp/zh/dict.json`。 */
function resolveDictPath(): string {
	const fromEnv = process.env.OMP_ZH_DICT;
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	return join(homedir(), ".omp", "zh", "dict.json");
}

function loadDict(): Record<string, string> {
	const dictPath = resolveDictPath();
	if (!existsSync(dictPath)) {
		console.log(`[omp-zh] dict.json 不存在: ${dictPath}（跳过汉化）`);
		return {};
	}
	try {
		return JSON.parse(readFileSync(dictPath, "utf8")) as Record<string, string>;
	} catch (err) {
		console.log("[omp-zh] dict.json 解析失败:", err instanceof Error ? err.message : String(err));
		return {};
	}
}

/** 用字典翻译字符串；未命中返回原值。 */
function tr(dict: Record<string, string>, s: string): string {
	const hit = dict[s];
	return typeof hit === "string" && hit.length > 0 ? hit : s;
}

export default async function (pi: unknown): Promise<void> {
	try {
		// 动态 import：与主程序共享同一模块实例（Bun 模块缓存按路径共享）
		const schemaModule = await import("@oh-my-pi/pi-coding-agent/config/settings-schema");
		const dict = loadDict();
		const keyCount = Object.keys(dict).length;
		if (keyCount === 0) return;

		let trLabel = 0;
		let trDesc = 0;
		let trGroup = 0;
		let trOpt = 0;

		// 1) Tab 元数据 label
		const tabMeta: Record<string, { label: string; icon: string }> = schemaModule.TAB_METADATA;
		for (const tab of Object.values(tabMeta)) {
			if (typeof tab.label === "string") {
				const zh = tr(dict, tab.label);
				if (zh !== tab.label) {
					tab.label = zh;
					trLabel++;
				}
			}
		}

		// 2) Tab 分组名（TAB_GROUPS）
		const tabGroups: Record<string, readonly string[]> = schemaModule.TAB_GROUPS;
		for (const key of Object.keys(tabGroups)) {
			const groups = tabGroups[key];
			if (Array.isArray(groups)) {
				// 就地改写（保持引用不变，避免其他模块持有旧数组）
				for (let i = 0; i < groups.length; i++) {
					const zh = tr(dict, groups[i] as string);
					if (zh !== groups[i]) {
						(groups as string[])[i] = zh;
						trGroup++;
					}
				}
			}
		}

		// 3) 每个设置的 ui 块：label/description/group/options
		const schema: Record<string, SchemaDef> = schemaModule.SETTINGS_SCHEMA;
		for (const def of Object.values(schema)) {
			if (!def || typeof def !== "object" || !def.ui || typeof def.ui !== "object") continue;
			const ui = def.ui;
			if (typeof ui.label === "string") {
				const zh = tr(dict, ui.label);
				if (zh !== ui.label) {
					ui.label = zh;
					trLabel++;
				}
			}
			if (typeof ui.description === "string") {
				const zh = tr(dict, ui.description);
				if (zh !== ui.description) {
					ui.description = zh;
					trDesc++;
				}
			}
			if (typeof ui.group === "string") {
				const zh = tr(dict, ui.group);
				if (zh !== ui.group) {
					ui.group = zh;
					trGroup++;
				}
			}
			if (Array.isArray(ui.options)) {
				for (const opt of ui.options) {
					if (!opt || typeof opt !== "object") continue;
					const o = opt as UiOption;
					if (typeof o.label === "string") {
						const zh = tr(dict, o.label);
						if (zh !== o.label) {
							o.label = zh;
							trOpt++;
						}
					}
					if (typeof o.description === "string") {
						const zh = tr(dict, o.description);
						if (zh !== o.description) {
							o.description = zh;
							trOpt++;
						}
					}
				}
			}
		}

		console.log(
			`[omp-zh] 汉化完成: label ${trLabel}, description ${trDesc}, group ${trGroup}, option 文本 ${trOpt}（字典 ${keyCount} 条）`,
		);
	} catch (err) {
		console.log("[omp-zh] 汉化失败:", err instanceof Error ? err.message : String(err));
	}
}
