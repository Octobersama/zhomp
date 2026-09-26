// OMP 中文汉化扩展（非破坏性，可插拔）
//
// 运行时只接受启动器验证过的宿主包：启动器通过环境变量传入绝对 packageDir
// 和支持版本，扩展再从该 packageDir 的真实源码路径导入 all-settings 与相邻的
// pi-tui settings-defs。这样改写的是 settings-ui 后续消费的同一模块对象。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Environment = Readonly<Record<string, string | undefined>>;
type ObjectRecord = Record<string, unknown>;

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

function resolveHome(environment: Environment): string {
	const candidates = [
		environment.OMP_ZH_HOME,
		process.platform === "win32" ? environment.USERPROFILE : undefined,
		environment.HOME,
		homedir(),
	];
	return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0) ?? homedir();
}

function resolveDictionaryPath(environment: Environment): string {
	const explicit = environment.OMP_ZH_DICT;
	return explicit && explicit.length > 0
		? explicit
		: join(resolveHome(environment), ".omp", "zh", "dict.json");
}

function loadDictionary(environment: Environment): Dictionary {
	const dictionaryPath = resolveDictionaryPath(environment);
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

interface PackageMetadata {
	version: string;
	dependencies?: Record<string, unknown>;
}

function readPackageMetadata(packageDir: string): PackageMetadata | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		if (isRecord(value) && typeof value.version === "string" && value.version.length > 0) {
			return { version: value.version, dependencies: isRecord(value.dependencies) ? value.dependencies : undefined };
		}
	} catch {
		// The caller reports the missing package identity with its path.
	}
	return undefined;
}

interface HostPackage {
	packageDir: string;
	tuiPackageDir: string;
	supportedVersion: string;
}

function resolveHostPackage(environment: Environment): HostPackage {
	const packageDirValue = environment.OMP_ZH_PACKAGE_DIR;
	if (!packageDirValue || !isAbsolute(packageDirValue)) {
		throw new Error("OMP_ZH_PACKAGE_DIR must be an absolute validated host package path");
	}
	const tuiPackageDirValue = environment.OMP_ZH_TUI_PACKAGE_DIR;
	if (!tuiPackageDirValue || !isAbsolute(tuiPackageDirValue)) {
		throw new Error("OMP_ZH_TUI_PACKAGE_DIR must be an absolute validated TUI package path");
	}
	const supportedVersion = environment.OMP_ZH_SUPPORTED_VERSION;
	if (!supportedVersion || supportedVersion.length === 0) throw new Error("OMP_ZH_SUPPORTED_VERSION is required");
	const packageDir = resolve(packageDirValue);
	const packageMetadata = readPackageMetadata(packageDir);
	if (!packageMetadata) throw new Error(`Host package identity is unavailable: ${packageDir}`);
	if (packageMetadata.version !== supportedVersion) {
		throw new Error(`Unsupported host version: expected ${supportedVersion}, found ${packageMetadata.version}`);
	}
	const tuiPackageDir = resolve(tuiPackageDirValue);
	const tuiMetadata = readPackageMetadata(tuiPackageDir);
	if (!tuiMetadata) throw new Error(`TUI package identity is unavailable: ${tuiPackageDir}`);
	const tuiRange = packageMetadata.dependencies?.["@oh-my-pi/pi-tui"];
	if (typeof tuiRange !== "string" || !Bun.semver.satisfies(tuiMetadata.version, tuiRange)) {
		throw new Error(`Mismatched TUI version: expected ${String(tuiRange)}, found ${tuiMetadata.version}`);
	}
	return { packageDir, tuiPackageDir, supportedVersion };
}

interface LoadedHost extends TranslationHost {
	supportedVersion: string;
}

function isOrderedSettings(value: unknown): value is () => readonly unknown[] {
	return typeof value === "function";
}

async function loadHost(packageInfo: HostPackage): Promise<LoadedHost> {
	const allSettingsPath = join(packageInfo.packageDir, "src", "config", "all-settings.ts");
	const settingsDefsPath = join(packageInfo.tuiPackageDir, "src", "overlays", "settings-defs.ts");
	if (!existsSync(allSettingsPath)) throw new Error(`Host all-settings source is unavailable: ${allSettingsPath}`);
	if (!existsSync(settingsDefsPath)) throw new Error(`TUI settings definitions are unavailable: ${settingsDefsPath}`);
	const [allSettingsModule, settingsDefsModule] = await Promise.all([
		import(pathToFileURL(allSettingsPath).href),
		import(pathToFileURL(settingsDefsPath).href),
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
		supportedVersion: packageInfo.supportedVersion,
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


function increment(target: ObjectRecord, key: string, dictionary: Dictionary, count: () => void): void {
	const source = target[key];
	if (typeof source !== "string") return;
	const translated = translateText(dictionary, source);
	if (translated === source) return;
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

export default async function (_pi: unknown): Promise<void> {
	if (!isTranslationEnabled()) return;
	try {
		const environment = process.env;
		const packageInfo = resolveHostPackage(environment);
		const dictionary = loadDictionary(environment);
		if (Object.keys(dictionary).length === 0) return;
		const host = await loadHost(packageInfo);
		const counts = translateSettings(host, dictionary);
		console.log(
			`[zhomp] 汉化完成: tab ${counts.tabLabels}, label ${counts.labels}, description ${counts.descriptions}, warning ${counts.warnings}, group ${counts.groups}, option 文本 ${counts.optionLabels + counts.optionDescriptions}（字典 ${Object.keys(dictionary).length} 条，宿主 ${host.supportedVersion}）`,
		);
	} catch (error) {
		console.log(`[zhomp] 汉化失败: ${error instanceof Error ? error.message : String(error)}`);
	}
}
