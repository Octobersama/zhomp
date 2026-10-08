// OMP 中文汉化扩展（非破坏性，可插拔）
//
// 运行时通过启动器传入同目录的安装配置；扩展使用该安装随附的 host 契约
// 重新验证宿主；preload 注册 Model 文案转换，扩展 factory 翻译 settings 元数据。

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HostPackage, LaunchConfig } from "../runtime/host";

type Environment = Readonly<Record<string, string | undefined>>;
type ObjectRecord = Record<string, unknown>;

interface InstalledHostModule {
	readLaunchConfig(configPath: string): LaunchConfig;
}

export type Dictionary = Readonly<Record<string, string>>;

/** The host references consumed by the real settings overlay. */
export interface TranslationHost {
	orderedSettings: () => readonly unknown[];
	tabMetadata: unknown;
	tabGroups: unknown;
}

export interface TranslationCounts {
	tabLabels: number;
	groups: number;
	labels: number;
	descriptions: number;
	warnings: number;
	optionLabels: number;
	optionDescriptions: number;
	readonly total: number;
}

function isRecord(value: unknown): value is ObjectRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: ObjectRecord, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** Parse a dictionary root without accepting null, arrays, scalars, or non-string entries. */
export function parseDictionary(value: unknown): Dictionary | undefined {
	if (!isRecord(value)) return undefined;
	const dictionary: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string" || entry.length === 0) continue;
		Object.defineProperty(dictionary, key, {
			configurable: true,
			enumerable: true,
			value: entry,
			writable: true,
		});
	}
	return dictionary;
}

/** Parse UTF-8 JSON dictionary content; malformed JSON is rejected without throwing. */
export function parseDictionaryText(text: string): Dictionary | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return parseDictionary(value);
	} catch {
		return undefined;
	}
}

function translateText(dictionary: Dictionary, source: string): string {
	if (!hasOwn(dictionary, source)) return source;
	const translated: unknown = dictionary[source];
	return typeof translated === "string" && translated.length > 0 ? translated : source;
}

function loadDictionary(environment: Environment, defaultPath: string): Dictionary {
	const dictionaryPath = environment.OMP_ZH_DICT || defaultPath;
	if (!existsSync(dictionaryPath)) {
		console.log(`[zhomp] dict.json 不存在: ${dictionaryPath}（跳过汉化）`);
		return {};
	}
	let text: string;
	try {
		text = readFileSync(dictionaryPath, "utf8");
	} catch (error) {
		console.log(`[zhomp] dict.json 读取失败: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		console.log(`[zhomp] dict.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
	const dictionary = parseDictionary(value);
	if (!dictionary) {
		console.log("[zhomp] dict.json 根值非法（需要 JSON 对象，跳过汉化）");
		return {};
	}
	return dictionary;
}

interface LoadedHost extends TranslationHost {
	version: string;
}

function isOrderedSettings(value: unknown): value is () => readonly unknown[] {
	return typeof value === "function";
}

async function loadHost(hostPackage: HostPackage): Promise<LoadedHost> {
	// These absolute module paths are resolved from the host selected by launch config.
	const [allSettingsModule, settingsDefsModule] = await Promise.all([
		import(pathToFileURL(hostPackage.allSettingsPath).href),
		import(pathToFileURL(hostPackage.settingsDefsPath).href),
	]);
	const allSettings = allSettingsModule as ObjectRecord;
	const settingsDefs = settingsDefsModule as ObjectRecord;
	if (!isOrderedSettings(allSettings.orderedSettings)) {
		throw new Error("Host all-settings.orderedSettings is unavailable");
	}
	return {
		orderedSettings: allSettings.orderedSettings,
		tabMetadata: settingsDefs.TAB_METADATA,
		tabGroups: settingsDefs.TAB_GROUPS,
		version: hostPackage.version,
	};
}

interface ValidatedOption {
	object: ObjectRecord;
}

interface ValidatedUi {
	object: ObjectRecord;
	tab: string;
	options: "runtime" | ValidatedOption[] | undefined;
}

interface ValidatedSetting {
	ui: ValidatedUi | undefined;
}

interface ValidatedHost {
	settings: ValidatedSetting[];
	tabMetadata: ObjectRecord;
	tabGroups: Record<string, string[]>;
}

function invalidHost(message: string): never {
	throw new Error(`Unsupported settings host shape: ${message}`);
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return isUnknownArray(value) && value.every(entry => typeof entry === "string");
}

function validateSetting(
	value: unknown,
	metadata: ObjectRecord,
	groups: Record<string, string[]>,
	index: number,
): ValidatedSetting {
	if (!isRecord(value) || typeof value.id !== "string") invalidHost(`setting ${index} has no string id`);
	const rawUi = value.ui;
	if (rawUi === undefined) return { ui: undefined };
	if (!isRecord(rawUi)) invalidHost(`setting ${value.id} has an invalid ui object`);
	const tab = rawUi.tab;
	const label = rawUi.label;
	const description = rawUi.description;
	if (typeof tab !== "string" || typeof label !== "string" || typeof description !== "string") {
		invalidHost(`setting ${value.id} has incomplete ui metadata`);
	}
	if (!hasOwn(metadata, tab)) invalidHost(`setting ${value.id} references an unknown tab`);
	const group = rawUi.group;
	if (group !== undefined && typeof group !== "string") {
		invalidHost(`setting ${value.id} has a non-string group`);
	}
	if (typeof group === "string" && !groups[tab].includes(group)) {
		invalidHost(`setting ${value.id} references an unknown group`);
	}
	const warning = rawUi.warning;
	if (warning !== undefined && typeof warning !== "string") {
		invalidHost(`setting ${value.id} has a non-string warning`);
	}
	const rawOptions = rawUi.options;
	let options: ValidatedUi["options"];
	if (rawOptions === undefined) {
		options = undefined;
	} else if (rawOptions === "runtime") {
		options = "runtime";
	} else {
		if (!isUnknownArray(rawOptions)) invalidHost(`setting ${value.id} has invalid options`);
		const validatedOptions: ValidatedOption[] = [];
		for (const [optionIndex, option] of rawOptions.entries()) {
			if (!isRecord(option) || typeof option.value !== "string" || typeof option.label !== "string") {
				invalidHost(`setting ${value.id} option ${optionIndex} has an invalid shape`);
			}
			if (option.description !== undefined && typeof option.description !== "string") {
				invalidHost(`setting ${value.id} option ${optionIndex} has an invalid description`);
			}
			validatedOptions.push({ object: option });
		}
		options = validatedOptions;
	}
	return { ui: { object: rawUi, tab, options } };
}

/** Validate every object that will be touched before making the first mutation. */
function validateHost(host: TranslationHost): ValidatedHost {
	if (!isRecord(host.tabMetadata)) invalidHost("TAB_METADATA must be an object");
	if (!isRecord(host.tabGroups)) invalidHost("TAB_GROUPS must be an object");
	const metadata = host.tabMetadata;
	const rawGroups = host.tabGroups;
	const metadataKeys = Object.keys(metadata);
	const groupKeys = Object.keys(rawGroups);
	if (metadataKeys.length !== groupKeys.length || metadataKeys.some(key => !hasOwn(rawGroups, key))) {
		invalidHost("TAB_METADATA and TAB_GROUPS must contain the same tabs");
	}
	const tabGroups: Record<string, string[]> = {};
	for (const key of metadataKeys) {
		const tab = metadata[key];
		if (!isRecord(tab) || typeof tab.label !== "string" || typeof tab.icon !== "string") {
			invalidHost(`TAB_METADATA.${key} has an invalid shape`);
		}
		const groups = rawGroups[key];
		if (!isStringArray(groups)) invalidHost(`TAB_GROUPS.${key} must be a string array`);
		tabGroups[key] = groups;
	}
	if (!isOrderedSettings(host.orderedSettings)) invalidHost("orderedSettings must be a function");
	const orderedSettings = host.orderedSettings();
	if (!Array.isArray(orderedSettings)) invalidHost("orderedSettings must return an array");
	const settings = orderedSettings.map((setting, index) => validateSetting(setting, metadata, tabGroups, index));
	return { settings, tabMetadata: metadata, tabGroups };
}

interface LiveGetterTranslation {
	dictionary: Dictionary;
}

const liveGetterTranslations = new WeakMap<() => unknown, LiveGetterTranslation>();

/** Reject unsupported readonly metadata before the first in-place update. */
function assertTranslatable(target: ObjectRecord, key: string, dictionary: Dictionary): void {
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	if (descriptor?.get && descriptor.configurable) return;
	const source = target[key];
	if (typeof source !== "string" || translateText(dictionary, source) === source) return;
	if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
		throw new Error(`Unsupported readonly settings metadata: ${key}`);
	}
}

function increment(target: ObjectRecord, key: string, dictionary: Dictionary, count: () => void): void {
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	if (descriptor?.get) {
		if (!descriptor.configurable) return;
		const existingTranslation = liveGetterTranslations.get(descriptor.get);
		if (existingTranslation) {
			existingTranslation.dictionary = dictionary;
			return;
		}

		const original = descriptor.get;
		const translation = { dictionary };
		const source: unknown = original.call(target);
		const translated = typeof source === "string" ? translateText(dictionary, source) : source;
		const getter = function (this: unknown): unknown {
			const current: unknown = original.call(this);
			return typeof current === "string" ? translateText(translation.dictionary, current) : current;
		};
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: descriptor.enumerable,
			get: getter,
			set: descriptor.set,
		});
		liveGetterTranslations.set(getter, translation);
		if (typeof source === "string" && translated !== source) count();
		return;
	}

	const source = target[key];
	if (typeof source !== "string") return;
	const translated = translateText(dictionary, source);
	if (translated === source) return;
	if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
		throw new Error(`Unsupported readonly settings metadata: ${key}`);
	}
	target[key] = translated;
	count();
}

function makeCounts(): Omit<TranslationCounts, "total"> & { total: number } {
	return {
		tabLabels: 0,
		groups: 0,
		labels: 0,
		descriptions: 0,
		warnings: 0,
		optionLabels: 0,
		optionDescriptions: 0,
		total: 0,
	};
}

/** Translate the live host metadata in place; this is the public integration boundary. */
export function translateSettings(host: TranslationHost, dictionary: Dictionary): TranslationCounts {
	const validated = validateHost(host);
	const counts = makeCounts();
	// Validate every field first so a future readonly UI shape cannot leave
	// translated tab/group names paired with untranslated setting metadata.
	for (const tab of Object.values(validated.tabMetadata)) {
		if (isRecord(tab)) assertTranslatable(tab, "label", dictionary);
	}
	for (const groups of Object.values(validated.tabGroups)) {
		for (let index = 0; index < groups.length; index++) {
			if (translateText(dictionary, groups[index]) !== groups[index] && !Object.getOwnPropertyDescriptor(groups, String(index))?.writable) {
				throw new Error("Unsupported readonly settings metadata: TAB_GROUPS");
			}
		}
	}
	for (const setting of validated.settings) {
		const ui = setting.ui;
		if (!ui) continue;
		for (const field of ["label", "description", "warning", "group"]) assertTranslatable(ui.object, field, dictionary);
		if (Array.isArray(ui.options)) {
			for (const option of ui.options) {
				assertTranslatable(option.object, "label", dictionary);
				assertTranslatable(option.object, "description", dictionary);
			}
		}
	}
	for (const key of Object.keys(validated.tabMetadata)) {
		const tab = validated.tabMetadata[key];
		if (!isRecord(tab)) invalidHost(`TAB_METADATA.${key} became invalid during translation`);
		increment(tab, "label", dictionary, () => counts.tabLabels++);
	}
	for (const groups of Object.values(validated.tabGroups)) {
		for (let index = 0; index < groups.length; index++) {
			const source = groups[index];
			const translated = translateText(dictionary, source);
			if (translated !== source) {
				groups[index] = translated;
				counts.groups++;
			}
		}
	}
	for (const setting of validated.settings) {
		const ui = setting.ui;
		if (!ui) continue;
		increment(ui.object, "label", dictionary, () => counts.labels++);
		increment(ui.object, "description", dictionary, () => counts.descriptions++);
		increment(ui.object, "warning", dictionary, () => counts.warnings++);
		increment(ui.object, "group", dictionary, () => counts.groups++);
		if (Array.isArray(ui.options)) {
			for (const option of ui.options) {
				increment(option.object, "label", dictionary, () => counts.optionLabels++);
				increment(option.object, "description", dictionary, () => counts.optionDescriptions++);
			}
		}
	}
	counts.total =
		counts.tabLabels +
		counts.groups +
		counts.labels +
		counts.descriptions +
		counts.warnings +
		counts.optionLabels +
		counts.optionDescriptions;
	return counts;
}

/** Gate translation to the launcher process; inherited child processes fail closed. */
export function isTranslationEnabled(environment: Environment = process.env): boolean {
	return environment.OMP_ZH_ENABLED === "1" && environment.OMP_ZH_PROCESS_ID === String(process.pid);
}

/** Register before the host extension loader imports its component barrel. */
export async function prepareModelTranslation(launchConfig: LaunchConfig, configPath: string): Promise<void> {
	if (!isTranslationEnabled()) return;
	try {
		const dictionary = loadDictionary(process.env, launchConfig.dictPath);
		if (Object.keys(dictionary).length === 0) return;
		const modelUiPath = join(dirname(configPath), "model-ui.ts");
		const modelUi: unknown = await import(pathToFileURL(modelUiPath).href);
		if (!isRecord(modelUi) || typeof modelUi.registerModelTranslation !== "function") {
			throw new Error("Installed Model translation module is unavailable; reinstall zhomp");
		}
		modelUi.registerModelTranslation(launchConfig.host.modelHubPath, dictionary);
	} catch (error) {
		console.log(`[zhomp] Model 汉化跳过: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export default async function (_pi: unknown): Promise<void> {
	if (!isTranslationEnabled()) return;
	try {
		const environment = process.env;
		const configPath = environment.OMP_ZH_CONFIG;
		if (!configPath || !isAbsolute(configPath)) {
			throw new Error("OMP_ZH_CONFIG must be an absolute launch config path");
		}
		// The installed host module is selected at runtime by the launcher's config path.
		const hostModulePath = join(dirname(configPath), "host.ts");
		const hostModule = await import(pathToFileURL(hostModulePath).href) as InstalledHostModule;
		const launchConfig = hostModule.readLaunchConfig(configPath);
		const dictionary = loadDictionary(environment, launchConfig.dictPath);
		if (Object.keys(dictionary).length === 0) return;
		const host = await loadHost(launchConfig.host);
		const counts = translateSettings(host, dictionary);
		console.log(
			`[zhomp] 汉化完成: tab ${counts.tabLabels}, label ${counts.labels}, description ${counts.descriptions}, warning ${counts.warnings}, group ${counts.groups}, option 文本 ${counts.optionLabels + counts.optionDescriptions}（字典 ${Object.keys(dictionary).length} 条，宿主 ${host.version}）`,
		);
	} catch (error) {
		console.log(`[zhomp] 汉化失败: ${error instanceof Error ? error.message : String(error)}`);
	}
}
