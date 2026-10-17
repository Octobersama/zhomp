// OMP 中文汉化扩展（非破坏性，可插拔）
//
// 运行时通过启动器传入同目录的安装配置；扩展使用该安装随附的 host 契约
// 重新验证宿主；preload 注册 Model 文案转换，扩展 factory 翻译 settings 并注册 slash autocomplete 显示层。

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

interface InstalledDiagnosticsModule {
	reportDiagnostic(message: string): void;
	setDiagnosticReporter(reporter: ((message: string) => void) | undefined): void;
}

async function loadInstalledDiagnostics(configPath: string): Promise<InstalledDiagnosticsModule> {
	const module: unknown = await import(pathToFileURL(join(dirname(configPath), "diagnostics.ts")).href);
	if (!isRecord(module) || typeof module.reportDiagnostic !== "function" || typeof module.setDiagnosticReporter !== "function") {
		throw new Error("Installed diagnostics module is unavailable; reinstall zhomp");
	}
	return module as unknown as InstalledDiagnosticsModule;
}

interface SettingDescriptionTemplate {
	key: string;
	parts: readonly string[];
	captures: readonly string[];
}

/** Exact initialized description shapes; only their rendered key hints vary. */
const SETTING_DESCRIPTION_TEMPLATES: readonly SettingDescriptionTemplate[] = [
	{
		key: "Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until {escape}",
		parts: ["Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until ", ""],
		captures: ["escape"],
	},
	{
		key: "Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes {shift}+drag and wheel scroll becomes {shift}+wheel while on",
		parts: [
			"Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes ",
			"+drag and wheel scroll becomes ",
			"+wheel while on",
		],
		captures: ["shift", "shift"],
	},
	{
		key: "Modal prompt editing. {escape} leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
		parts: [
			"Modal prompt editing. ",
			" leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
		],
		captures: ["escape"],
	},
	{
		key: "Keep drafts cleared with {ctrlC} in local {upDown} history until exit; disabling affects future clears",
		parts: ["Keep drafts cleared with ", " in local ", " history until exit; disabling affects future clears"],
		captures: ["ctrlC", "upDown"],
	},
	{
		key: "What pressing {escape} twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing",
		parts: ["What pressing ", " twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing"],
		captures: ["escape"],
	},
	{
		key: "Show predicted word completions as inline hints: {tab} accepts with a space, {right} without",
		parts: ["Show predicted word completions as inline hints: ", " accepts with a space, ", " without"],
		captures: ["tab", "right"],
	},
	{
		key: "After a completed turn, ask the active model to predict your next message and show it as ghost text in the empty composer; {tab} or {right} inserts it without sending. Extra usage: every completed turn sends one more billed request over the whole conversation (counted in /stats)",
		parts: [
			"After a completed turn, ask the active model to predict your next message and show it as ghost text in the empty composer; ",
			" or ",
			" inserts it without sending. Extra usage: every completed turn sends one more billed request over the whole conversation (counted in /stats)",
		],
		captures: ["tab", "right"],
	},
	{
		key: "When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable ({escape}) but also hold subagents, so leave off for unattended runs.",
		parts: [
			"When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable (",
			") but also hold subagents, so leave off for unattended runs.",
		],
		captures: ["escape"],
	},
];

/** Ignore ANSI SGR only for shape checks; returned captures keep the original bytes. */
function isRenderedKeyFragment(name: string, value: string): boolean {
	const plainText = value.replace(/\x1b\[[0-9;:]*m/g, "");
	if (plainText.length === 0 || plainText.length > 24) return false;
	if (name === "ctrlC") return /^[^\s+]{1,12}[+ ]?C$/.test(plainText);
	if (name === "upDown") return /^[^/\s]{1,12}\/[^/\s]{1,12}$/.test(plainText);
	return !/\s/.test(plainText);
}

function matchDescriptionTemplate(source: string, template: SettingDescriptionTemplate): string[] | undefined {
	const first = template.parts[0];
	if (first === undefined || !source.startsWith(first) || template.parts.length !== template.captures.length + 1) return undefined;
	const captures: string[] = [];
	let offset = first.length;
	for (let index = 0; index < template.captures.length; index++) {
		const suffix = template.parts[index + 1];
		if (suffix === undefined) return undefined;
		let end: number;
		if (suffix === "" && index === template.captures.length - 1) end = source.length;
		else end = source.indexOf(suffix, offset);
		if (end <= offset) return undefined;
		const captured = source.slice(offset, end);
		const name = template.captures[index];
		if (name === undefined || !isRenderedKeyFragment(name, captured)) return undefined;
		for (let previous = 0; previous < index; previous++) {
			if (template.captures[previous] === name && captures[previous] !== captured) return undefined;
		}
		captures.push(captured);
		offset = end + suffix.length;
	}
	return offset === source.length ? captures : undefined;
}

function renderDescriptionTemplate(
	dictionary: Dictionary,
	template: SettingDescriptionTemplate,
	captures: readonly string[],
): string | undefined {
	const translated = dictionary[template.key];
	if (typeof translated !== "string" || translated.length === 0 || translated === template.key) return undefined;
	for (let index = 0; index < template.captures.length; index++) {
		const name = template.captures[index];
		if (name === undefined || template.captures.indexOf(name) !== index) continue;
		let expectedCount = 0;
		for (const captureName of template.captures) {
			if (captureName === name) expectedCount++;
		}
		const placeholder = `{${name}}`;
		let actualCount = 0;
		let offset = 0;
		while ((offset = translated.indexOf(placeholder, offset)) !== -1) {
			actualCount++;
			offset += placeholder.length;
		}
		if (actualCount !== expectedCount) return undefined;
	}
	let result = translated;
	for (let index = 0; index < template.captures.length; index++) {
		const name = template.captures[index];
		const value = captures[index];
		if (name !== undefined && value !== undefined) result = result.replaceAll(`{${name}}`, () => value);
	}
	return result;
}

function translateSettingDescription(dictionary: Dictionary, source: string): string {
	for (const template of SETTING_DESCRIPTION_TEMPLATES) {
		const captures = matchDescriptionTemplate(source, template);
		if (!captures) continue;
		const translated = renderDescriptionTemplate(dictionary, template, captures);
		if (translated !== undefined) return translated;
		break;
	}
	return translateText(dictionary, source);
}

function translateMetadataText(dictionary: Dictionary, key: string, source: string): string {
	if (key === "description") return translateSettingDescription(dictionary, source);
	return translateText(dictionary, source);
}
type DiagnosticReporter = (message: string, context?: unknown) => void;

/** The host references consumed by the real settings overlay. */
export interface TranslationHost {
	orderedSettings: () => readonly unknown[];
	tabMetadata: unknown;
	tabGroups: unknown;
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

function loadDictionary(environment: Environment, defaultPath: string, report: DiagnosticReporter): Dictionary {
	const dictionaryPath = environment.OMP_ZH_DICT || defaultPath;
	if (!existsSync(dictionaryPath)) {
		report(`dict.json 不存在: ${dictionaryPath}（跳过汉化）`);
		return {};
	}
	let text: string;
	try {
		text = readFileSync(dictionaryPath, "utf8");
	} catch (error) {
		report(`dict.json 读取失败: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		report(`dict.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
	const dictionary = parseDictionary(value);
	if (!dictionary) {
		report("dict.json 根值非法（需要 JSON 对象，跳过汉化）");
		return {};
	}
	return dictionary;
}

function registerExtensionEvent(
	apiValue: unknown,
	event: string,
	handler: (event: unknown, context: unknown) => void,
): void {
	if (!isRecord(apiValue)) throw new Error("Extension API is unavailable");
	const on = Reflect.get(apiValue, "on", apiValue);
	if (typeof on !== "function") throw new Error("Extension event registration is unavailable");
	Reflect.apply(on, apiValue, [event, handler]);
}

function notifyUiError(context: unknown, message: string): boolean {
	try {
		if (!isRecord(context) || context.hasUI !== true) return false;
		const ui = Reflect.get(context, "ui", context);
		if (!isRecord(ui)) return false;
		const notify = Reflect.get(ui, "notify", ui);
		if (typeof notify !== "function") return false;
		Reflect.apply(notify, ui, [message, "error"]);
		return true;
	} catch {
		return false;
	}
}

function createUiDiagnosticReporter(apiValue: unknown, diagnostics: InstalledDiagnosticsModule): DiagnosticReporter {
	registerExtensionEvent(apiValue, "session_start", (_event, context) => {
		if (!isRecord(context) || context.hasUI !== true) {
			diagnostics.setDiagnosticReporter(undefined);
			return;
		}
		diagnostics.setDiagnosticReporter(message => {
			if (!notifyUiError(context, message)) throw new Error("Extension UI notification is unavailable");
		});
	});
	registerExtensionEvent(apiValue, "session_shutdown", () => diagnostics.setDiagnosticReporter(undefined));
	return message => diagnostics.reportDiagnostic(message);
}

interface LoadedHost extends TranslationHost {
	version: string;
	readonly builtinSlashCommandDefs: unknown;
}

function isOrderedSettings(value: unknown): value is () => readonly unknown[] {
	return typeof value === "function";
}

async function loadHost(hostPackage: HostPackage): Promise<LoadedHost> {
	// These absolute module paths are resolved from the host selected by launch config.
	const slashCommandsImport = hostPackage.slashCommandsPath
		? import(pathToFileURL(hostPackage.slashCommandsPath).href).catch(() => undefined)
		: Promise.resolve(undefined);
	const [allSettingsModule, settingsDefsModule, slashCommandsModule] = await Promise.all([
		import(pathToFileURL(hostPackage.allSettingsPath).href),
		import(pathToFileURL(hostPackage.settingsDefsPath).href),
		slashCommandsImport,
	]);
	const allSettings = allSettingsModule as ObjectRecord;
	const settingsDefs = settingsDefsModule as ObjectRecord;
	const slashCommands = isRecord(slashCommandsModule) ? slashCommandsModule : {};
	if (!isOrderedSettings(allSettings.orderedSettings)) {
		throw new Error("Host all-settings.orderedSettings is unavailable");
	}
	return {
		orderedSettings: allSettings.orderedSettings,
		tabMetadata: settingsDefs.TAB_METADATA,
		tabGroups: settingsDefs.TAB_GROUPS,
		builtinSlashCommandDefs: slashCommands.BUILTIN_SLASH_COMMAND_DEFS,
		version: hostPackage.version,
	};
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

interface LiveGetterTranslation {
	dictionary: Dictionary;
}

type TranslationChange =
	| { kind: "property"; target: ObjectRecord; key: string; value: string }
	| { kind: "group"; groups: string[]; index: number; value: string }
	| {
			kind: "install-getter";
			target: ObjectRecord;
			key: string;
			enumerable: boolean | undefined;
			setter: PropertyDescriptor["set"];
			getter: (this: unknown) => unknown;
			translation: LiveGetterTranslation;
	  }
	| { kind: "update-getter"; translation: LiveGetterTranslation; dictionary: Dictionary };

const liveGetterTranslations = new WeakMap<() => unknown, LiveGetterTranslation>();


function markPreparedField(preparedFields: WeakMap<object, Set<string>>, target: object, key: string): void {
	let fields = preparedFields.get(target);
	if (!fields) {
		fields = new Set<string>();
		preparedFields.set(target, fields);
	}
	fields.add(key);
}

function prepareMetadataField(
	target: ObjectRecord,
	key: string,
	source: unknown,
	dictionary: Dictionary,
	changes: TranslationChange[],
	preparedFields: WeakMap<object, Set<string>>,
): void {
	if (preparedFields.get(target)?.has(key)) return;
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	if (descriptor?.get) {
		if (!descriptor.configurable) {
			if (typeof source === "string" && translateMetadataText(dictionary, key, source) !== source) {
				throw new Error(`Unsupported readonly settings metadata: ${key}`);
			}
			return;
		}

		const existingTranslation = liveGetterTranslations.get(descriptor.get);
		if (existingTranslation) {
			changes.push({ kind: "update-getter", translation: existingTranslation, dictionary });
		} else {
			const original = descriptor.get;
			const translation = { dictionary };
			const getter = function (this: unknown): unknown {
				const current: unknown = original.call(this);
				return typeof current === "string" ? translateMetadataText(translation.dictionary, key, current) : current;
			};
			changes.push({
				kind: "install-getter",
				target,
				key,
				enumerable: descriptor.enumerable,
				setter: descriptor.set,
				getter,
				translation,
			});
		}
		markPreparedField(preparedFields, target, key);
		return;
	}

	if (typeof source !== "string") return;
	const translated = translateMetadataText(dictionary, key, source);
	if (translated === source) return;
	if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
		throw new Error(`Unsupported readonly settings metadata: ${key}`);
	}
	changes.push({ kind: "property", target, key, value: translated });
	markPreparedField(preparedFields, target, key);
}

function prepareGroup(
	groups: string[],
	index: number,
	dictionary: Dictionary,
	changes: TranslationChange[],
	preparedFields: WeakMap<object, Set<string>>,
): void {
	const key = String(index);
	if (preparedFields.get(groups)?.has(key)) return;
	const source = groups[index];
	const translated = translateText(dictionary, source);
	if (translated === source) return;
	if (!Object.getOwnPropertyDescriptor(groups, key)?.writable) {
		throw new Error("Unsupported readonly settings metadata: TAB_GROUPS");
	}
	changes.push({ kind: "group", groups, index, value: translated });
	markPreparedField(preparedFields, groups, key);
}

function prepareSetting(
	value: unknown,
	metadata: ObjectRecord,
	tabGroups: Readonly<Record<string, string[]>>,
	dictionary: Dictionary,
	changes: TranslationChange[],
	preparedFields: WeakMap<object, Set<string>>,
	index: number,
): void {
	if (!isRecord(value) || typeof value.id !== "string") invalidHost(`setting ${index} has no string id`);
	const rawUi = value.ui;
	if (rawUi === undefined) return;
	if (!isRecord(rawUi)) invalidHost(`setting ${value.id} has an invalid ui object`);
	const tab = rawUi.tab;
	const label = rawUi.label;
	const description = rawUi.description;
	if (typeof tab !== "string" || typeof label !== "string" || typeof description !== "string") {
		invalidHost(`setting ${value.id} has incomplete ui metadata`);
	}
	if (!hasOwn(metadata, tab)) invalidHost(`setting ${value.id} references an unknown tab`);
	const groups = tabGroups[tab];
	if (!groups) invalidHost(`setting ${value.id} references an unknown tab`);
	const group = rawUi.group;
	if (group !== undefined && typeof group !== "string") {
		invalidHost(`setting ${value.id} has a non-string group`);
	}
	if (typeof group === "string" && !groups.includes(group)) {
		invalidHost(`setting ${value.id} references an unknown group`);
	}
	const warning = rawUi.warning;
	if (warning !== undefined && typeof warning !== "string") {
		invalidHost(`setting ${value.id} has a non-string warning`);
	}
	const rawOptions = rawUi.options;
	if (rawOptions !== undefined && rawOptions !== "runtime" && !isUnknownArray(rawOptions)) {
		invalidHost(`setting ${value.id} has invalid options`);
	}

	prepareMetadataField(rawUi, "label", label, dictionary, changes, preparedFields);
	prepareMetadataField(rawUi, "description", description, dictionary, changes, preparedFields);
	prepareMetadataField(rawUi, "warning", warning, dictionary, changes, preparedFields);
	prepareMetadataField(rawUi, "group", group, dictionary, changes, preparedFields);
	if (!Array.isArray(rawOptions)) return;
	for (const [optionIndex, option] of rawOptions.entries()) {
		if (!isRecord(option)) invalidHost(`setting ${value.id} option ${optionIndex} has an invalid shape`);
		const optionValue = option.value;
		const optionLabel = option.label;
		if (typeof optionValue !== "string" || typeof optionLabel !== "string") {
			invalidHost(`setting ${value.id} option ${optionIndex} has an invalid shape`);
		}
		const optionDescription = option.description;
		if (optionDescription !== undefined && typeof optionDescription !== "string") {
			invalidHost(`setting ${value.id} option ${optionIndex} has an invalid description`);
		}
		prepareMetadataField(option, "label", optionLabel, dictionary, changes, preparedFields);
		prepareMetadataField(option, "description", optionDescription, dictionary, changes, preparedFields);
	}
}

/** Prepare every host edit without mutating metadata or existing getter translations. */
function prepareSettingsTranslation(host: TranslationHost, dictionary: Dictionary): TranslationChange[] {
	if (!isRecord(host.tabMetadata)) invalidHost("TAB_METADATA must be an object");
	if (!isRecord(host.tabGroups)) invalidHost("TAB_GROUPS must be an object");
	const metadata = host.tabMetadata;
	const rawGroups = host.tabGroups;
	const metadataKeys = Object.keys(metadata);
	const groupKeys = Object.keys(rawGroups);
	if (metadataKeys.length !== groupKeys.length || metadataKeys.some(key => !hasOwn(rawGroups, key))) {
		invalidHost("TAB_METADATA and TAB_GROUPS must contain the same tabs");
	}

	const changes: TranslationChange[] = [];
	const preparedFields = new WeakMap<object, Set<string>>();
	const tabGroups = Object.create(null) as Record<string, string[]>;
	for (const key of metadataKeys) {
		const tab = metadata[key];
		if (!isRecord(tab)) invalidHost(`TAB_METADATA.${key} has an invalid shape`);
		const label = tab.label;
		const icon = tab.icon;
		if (typeof label !== "string" || typeof icon !== "string") {
			invalidHost(`TAB_METADATA.${key} has an invalid shape`);
		}
		prepareMetadataField(tab, "label", label, dictionary, changes, preparedFields);
		const groups = rawGroups[key];
		if (!isStringArray(groups)) invalidHost(`TAB_GROUPS.${key} must be a string array`);
		Object.defineProperty(tabGroups, key, { value: groups, enumerable: true });
		for (let index = 0; index < groups.length; index++) {
			prepareGroup(groups, index, dictionary, changes, preparedFields);
		}
	}

	const orderedSettings = host.orderedSettings;
	if (!isOrderedSettings(orderedSettings)) invalidHost("orderedSettings must be a function");
	const settings = orderedSettings();
	if (!Array.isArray(settings)) invalidHost("orderedSettings must return an array");
	for (const [index, setting] of settings.entries()) {
		prepareSetting(setting, metadata, tabGroups, dictionary, changes, preparedFields, index);
	}
	return changes;
}

/** Translate the live host metadata in place; this is the public integration boundary. */
export function translateSettings(host: TranslationHost, dictionary: Dictionary): void {
	const changes = prepareSettingsTranslation(host, dictionary);
	for (const change of changes) {
		switch (change.kind) {
			case "property":
				change.target[change.key] = change.value;
				break;
			case "group":
				change.groups[change.index] = change.value;
				break;
			case "install-getter":
				Object.defineProperty(change.target, change.key, {
					configurable: true,
					enumerable: change.enumerable,
					get: change.getter,
					set: change.setter,
				});
				liveGetterTranslations.set(change.getter, change.translation);
				break;
			case "update-getter":
				change.translation.dictionary = change.dictionary;
				break;
		}
	}
}


interface SlashCommandDisplayRule {
	name: string;
	description: string;
	argumentHint?: string;
	subcommands: Map<string, string>;
}

interface SlashDescriptionIndex {
	commands: Map<string, SlashCommandDisplayRule>;
}

type SlashAutocompleteContext = { kind: "command-name" } | { kind: "arguments"; commandName: string };

const BUNDLED_SLASH_COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = {
	init: "Generate AGENTS.md for current codebase",
	green: "Generate a prompt to iterate on CI failures until the branch is green",
	review: "Launch interactive code review",
	annotate: "Annotate a diff or text from a file, prompt, latest reply, or session",
	autoresearch: "Toggle builtin autoresearch mode, or pass off / clear, or a goal message.",
};

const BUNDLED_SLASH_ARGUMENT_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	annotate: {
		"last ": "Annotate the latest assistant reply",
		"session ": "Annotate a message or code block from this session",
		"code-review ": "Annotate local changes or a GitHub pull request",
		"./": "Annotate a file by path",
		'"': "Annotate literal prompt text",
	},
	autoresearch: {
		off: "Leave autoresearch mode",
		clear: "Reset worktree to baseline and close the active session",
	},
};

const BUNDLED_DESCRIPTION_SUFFIX = " (bundled)";

function readOwnString(value: ObjectRecord, key: string): string | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function readOptionalString(value: ObjectRecord, key: string): string | undefined | null {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return null;
	if (descriptor.value === undefined) return undefined;
	return typeof descriptor.value === "string" ? descriptor.value : null;
}

function readDescription(value: ObjectRecord): string | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, "description");
	if (!descriptor) return undefined;
	if ("value" in descriptor) return typeof descriptor.value === "string" ? descriptor.value : undefined;
	if (typeof descriptor.get !== "function") return undefined;
	const description: unknown = Reflect.apply(descriptor.get, value, []);
	return typeof description === "string" ? description : undefined;
}

function readOptionalStringArray(value: ObjectRecord, key: string): string[] | undefined | null {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return null;
	if (descriptor.value === undefined) return undefined;
	if (!isUnknownArray(descriptor.value)) return null;
	const entries: string[] = [];
	for (const entry of descriptor.value) {
		if (typeof entry !== "string") return null;
		entries.push(entry);
	}
	return entries;
}

function readOptionalArray(value: ObjectRecord, key: string): unknown[] | undefined | null {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return null;
	if (descriptor.value === undefined) return undefined;
	return isUnknownArray(descriptor.value) ? descriptor.value : null;
}

function addSlashCommandName(
	commands: Map<string, SlashCommandDisplayRule>,
	name: string,
	rule: SlashCommandDisplayRule,
): boolean {
	const existing = commands.get(name);
	if (existing) return existing === rule;
	commands.set(name, rule);
	return true;
}

function createSlashDescriptionIndex(definitions: unknown): SlashDescriptionIndex | undefined {
	if (!isUnknownArray(definitions)) return undefined;
	const commands = new Map<string, SlashCommandDisplayRule>();
	for (const definition of definitions) {
		if (!isRecord(definition)) return undefined;
		const name = readOwnString(definition, "name");
		const description = readDescription(definition);
		if (!name || description === undefined) return undefined;
		const argumentHint = readOptionalString(definition, "argumentHint");
		if (argumentHint === null) return undefined;

		const rule: SlashCommandDisplayRule = { name, description, subcommands: new Map() };
		if (argumentHint !== undefined) rule.argumentHint = argumentHint;
		const subcommands = readOptionalArray(definition, "subcommands");
		if (subcommands === null) return undefined;
		if (subcommands) {
			for (const subcommand of subcommands) {
				if (!isRecord(subcommand)) return undefined;
				const subcommandName = readOwnString(subcommand, "name");
				const subcommandDescription = readDescription(subcommand);
				if (!subcommandName || subcommandDescription === undefined) return undefined;
				const completionValue = `${subcommandName} `;
				if (rule.subcommands.has(completionValue)) return undefined;
				rule.subcommands.set(completionValue, subcommandDescription);
			}
		}

		if (!addSlashCommandName(commands, name, rule)) return undefined;
		const aliases = readOptionalStringArray(definition, "aliases");
		if (aliases === null) return undefined;
		if (aliases) {
			for (const alias of aliases) {
				if (!alias || !addSlashCommandName(commands, alias, rule)) return undefined;
			}
		}
	}

	const bundledCommands = new Map<string, SlashCommandDisplayRule>();
	for (const [name, description] of Object.entries(BUNDLED_SLASH_COMMAND_DESCRIPTIONS)) {
		if (commands.has(name)) continue;
		const rule: SlashCommandDisplayRule = { name, description, subcommands: new Map() };
		commands.set(name, rule);
		bundledCommands.set(name, rule);
	}
	for (const [commandName, argumentsByValue] of Object.entries(BUNDLED_SLASH_ARGUMENT_DESCRIPTIONS)) {
		const command = bundledCommands.get(commandName);
		if (!command) continue;
		for (const [value, description] of Object.entries(argumentsByValue)) command.subcommands.set(value, description);
	}
	return { commands };
}

function slashContextFromText(text: string): SlashAutocompleteContext | undefined {
	let start = 0;
	while (start < text.length && /\s/.test(text[start] ?? "")) start++;
	if (text[start] !== "/") return undefined;
	const separator = text.indexOf(" ", start + 1);
	if (separator === -1) return { kind: "command-name" };
	const commandName = text.slice(start + 1, separator);
	if (!commandName || commandName.includes("/")) return undefined;
	return { kind: "arguments", commandName };
}

function slashContextFromSuggestionArgs(args: unknown[]): SlashAutocompleteContext | undefined {
	const lines = args[0];
	const cursorLine = args[1];
	const cursorColumn = args[2];
	if (
		!isUnknownArray(lines) ||
		typeof cursorLine !== "number" ||
		!Number.isInteger(cursorLine) ||
		typeof cursorColumn !== "number" ||
		!Number.isInteger(cursorColumn)
	) {
		return undefined;
	}
	const line = lines[cursorLine];
	return typeof line === "string" ? slashContextFromText(line.slice(0, cursorColumn)) : undefined;
}

type SlashDisplayMatch = SlashCommandDisplayRule | string;

function findSlashDisplayMatch(
	item: ObjectRecord,
	context: SlashAutocompleteContext,
	index: SlashDescriptionIndex,
	blockedNames: ReadonlySet<string>,
): SlashDisplayMatch | undefined {
	const value = readOwnString(item, "value");
	if (value === undefined) return undefined;
	if (context.kind === "command-name") {
		const command = index.commands.get(value);
		if (!command || blockedNames.has(value) || blockedNames.has(command.name)) return undefined;
		return command;
	}
	const command = index.commands.get(context.commandName);
	if (!command || blockedNames.has(context.commandName) || blockedNames.has(command.name)) return undefined;
	return command.subcommands.get(value);
}

function translateStaticDisplayText(
	value: string,
	source: string,
	dictionary: Dictionary,
	argumentHint?: string,
): string | undefined {
	const translated = translateText(dictionary, source);
	if (translated === source) return undefined;
	let text = value;
	let suffix = "";
	if (text.endsWith(BUNDLED_DESCRIPTION_SUFFIX)) {
		suffix = BUNDLED_DESCRIPTION_SUFFIX;
		text = text.slice(0, -BUNDLED_DESCRIPTION_SUFFIX.length);
	}
	if (text === source) return `${translated}${suffix}`;
	if (!argumentHint) return undefined;
	// Match the host formatter exactly; other prefixes remain part of the source description.
	const prefix = `${argumentHint} - `;
	if (!text.startsWith(prefix) || text.slice(prefix.length) !== source) return undefined;
	return `${prefix}${translated}${suffix}`;
}

function translateSuggestionItem(
	value: unknown,
	source: string,
	argumentHint: string | undefined,
	dictionary: Dictionary,
	originalItems: WeakMap<object, ObjectRecord>,
): unknown {
	if (!isRecord(value)) return value;
	const descriptionDescriptor = Object.getOwnPropertyDescriptor(value, "description");
	const nativeDetailDescriptor = Object.getOwnPropertyDescriptor(value, "nativeDetail");
	let translatedDescription: string | undefined;
	let translatedNativeDetail: string | undefined;
	if (descriptionDescriptor && "value" in descriptionDescriptor && typeof descriptionDescriptor.value === "string") {
		translatedDescription = translateStaticDisplayText(descriptionDescriptor.value, source, dictionary, argumentHint);
	}
	if (
		nativeDetailDescriptor &&
		"value" in nativeDetailDescriptor &&
		typeof nativeDetailDescriptor.value === "string"
	) {
		translatedNativeDetail = translateStaticDisplayText(nativeDetailDescriptor.value, source, dictionary, argumentHint);
	}
	const descriptionChanged = translatedDescription !== undefined && translatedDescription !== descriptionDescriptor?.value;
	const nativeDetailChanged = translatedNativeDetail !== undefined && translatedNativeDetail !== nativeDetailDescriptor?.value;
	if (!descriptionChanged && !nativeDetailChanged) return value;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (descriptionChanged && descriptionDescriptor && "value" in descriptionDescriptor) {
		descriptors.description = { ...descriptionDescriptor, value: translatedDescription };
	}
	if (nativeDetailChanged && nativeDetailDescriptor && "value" in nativeDetailDescriptor) {
		descriptors.nativeDetail = { ...nativeDetailDescriptor, value: translatedNativeDetail };
	}
	const translated = Object.create(Object.getPrototypeOf(value), descriptors) as ObjectRecord;
	originalItems.set(translated, value);
	return translated;
}

function translateSuggestionResult(
	result: unknown,
	context: SlashAutocompleteContext | undefined,
	index: SlashDescriptionIndex,
	dictionary: Dictionary,
	blockedNames: ReadonlySet<string>,
	originalItems: WeakMap<object, ObjectRecord>,
): unknown {
	if (!context || !isRecord(result)) return result;
	try {
		const itemsDescriptor = Object.getOwnPropertyDescriptor(result, "items");
		if (!itemsDescriptor || !("value" in itemsDescriptor) || !isUnknownArray(itemsDescriptor.value)) return result;
		let translatedItems: unknown[] | undefined;
		for (let itemIndex = 0; itemIndex < itemsDescriptor.value.length; itemIndex++) {
			const item = itemsDescriptor.value[itemIndex];
			if (!isRecord(item)) continue;
			const match = findSlashDisplayMatch(item, context, index, blockedNames);
			if (match === undefined) continue;
			let source: string;
			let argumentHint: string | undefined;
			if (typeof match === "string") {
				source = match;
			} else {
				source = match.description;
				argumentHint = match.argumentHint;
			}
			const translated = translateSuggestionItem(item, source, argumentHint, dictionary, originalItems);
			if (translated === item) continue;
			translatedItems ??= itemsDescriptor.value.slice();
			translatedItems[itemIndex] = translated;
		}
		if (!translatedItems) return result;
		const descriptors = Object.getOwnPropertyDescriptors(result);
		descriptors.items = { ...itemsDescriptor, value: translatedItems };
		return Object.create(Object.getPrototypeOf(result), descriptors) as ObjectRecord;
	} catch {
		return result;
	}
}

function wrapSlashAutocompleteWithIndex(
	current: unknown,
	index: SlashDescriptionIndex,
	dictionary: Dictionary,
	blockedNames: ReadonlySet<string>,
): unknown {
	if (!isRecord(current)) return current;
	let getSuggestionsMethod: unknown;
	let applyCompletionMethod: unknown;
	let syncSlashCompletionMethod: unknown;
	try {
		getSuggestionsMethod = Reflect.get(current, "getSuggestions", current);
		applyCompletionMethod = Reflect.get(current, "applyCompletion", current);
		syncSlashCompletionMethod = Reflect.get(current, "trySyncSlashCompletion", current);
	} catch {
		return current;
	}
	if (typeof getSuggestionsMethod !== "function" || typeof applyCompletionMethod !== "function") return current;
	try {
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (
				descriptor &&
				"value" in descriptor &&
				typeof descriptor.value === "function" &&
				descriptor.configurable === false &&
				descriptor.writable === false
			) {
				return current;
			}
		}
	} catch {
		return current;
	}
	const getSuggestions = getSuggestionsMethod;
	const applyCompletion = applyCompletionMethod;
	const syncSlashCompletion = syncSlashCompletionMethod;

	const originalItems = new WeakMap<object, ObjectRecord>();
	const boundMethods = new WeakMap<Function, Function>();
	const getSuggestionsWrapper = async function (...args: unknown[]): Promise<unknown> {
		const context = slashContextFromSuggestionArgs(args);
		let forwardedArgs = args;
		const onPartial = args[4];
		if (context && typeof onPartial === "function") {
			forwardedArgs = args.slice();
			forwardedArgs[4] = function (partial: unknown): void {
				const translated = translateSuggestionResult(partial, context, index, dictionary, blockedNames, originalItems);
				Reflect.apply(onPartial, undefined, [translated]);
			};
		}
		const result: unknown = await Reflect.apply(getSuggestions, current, forwardedArgs);
		return translateSuggestionResult(result, context, index, dictionary, blockedNames, originalItems);
	};
	const applyCompletionWrapper = function (...args: unknown[]): unknown {
		let forwardedArgs = args;
		const selectedItem = args[3];
		if (typeof selectedItem === "object" && selectedItem !== null) {
			const original = originalItems.get(selectedItem);
			if (original) {
				forwardedArgs = args.slice();
				forwardedArgs[3] = original;
			}
		}
		return Reflect.apply(applyCompletion, current, forwardedArgs);
	};
	const syncSlashCompletionWrapper =
		typeof syncSlashCompletion === "function"
			? function (...args: unknown[]): unknown {
					const text = args[0];
					const context = typeof text === "string" ? slashContextFromText(text) : undefined;
					const result: unknown = Reflect.apply(syncSlashCompletion, current, args);
					return translateSuggestionResult(result, context, index, dictionary, blockedNames, originalItems);
				}
			: undefined;

	return new Proxy(current, {
		get(target, property) {
			if (property === "getSuggestions") return getSuggestionsWrapper;
			if (property === "applyCompletion") return applyCompletionWrapper;
			if (property === "trySyncSlashCompletion" && syncSlashCompletionWrapper) return syncSlashCompletionWrapper;
			const value = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			const bound = boundMethods.get(value);
			if (bound) return bound;
			const boundMethod = value.bind(current);
			boundMethods.set(value, boundMethod);
			return boundMethod;
		},
		set(target, property, value) {
			return Reflect.set(target, property, value, target);
		},
	});
}

/** Translate only known static slash descriptions in the TUI autocomplete display layer. */
export function wrapSlashCommandAutocomplete(current: unknown, definitions: unknown, dictionary: Dictionary): unknown {
	if (!isRecord(dictionary)) return current;
	try {
		const index = createSlashDescriptionIndex(definitions);
		return index ? wrapSlashAutocompleteWithIndex(current, index, dictionary, new Set()) : current;
	} catch {
		return current;
	}
}

function readBlockedSlashCommandNames(api: ObjectRecord): Set<string> {
	const getCommands = Reflect.get(api, "getCommands", api);
	if (typeof getCommands !== "function") return new Set();
	const commands: unknown = Reflect.apply(getCommands, api, []);
	if (!isUnknownArray(commands)) throw new Error("Extension getCommands metadata is unavailable");
	const blockedNames = new Set<string>();
	for (const command of commands) {
		if (!isRecord(command)) throw new Error("Extension getCommands metadata is unsupported");
		const name = readOwnString(command, "name");
		const source = readOwnString(command, "source");
		if (!name || (source !== "extension" && source !== "prompt" && source !== "skill")) {
			throw new Error("Extension getCommands metadata is unsupported");
		}
		const locationDescriptor = Object.getOwnPropertyDescriptor(command, "location");
		if (locationDescriptor && !("value" in locationDescriptor)) throw new Error("Extension getCommands metadata is unsupported");
		const location = locationDescriptor && "value" in locationDescriptor ? locationDescriptor.value : undefined;
		if (location !== undefined && typeof location !== "string") throw new Error("Extension getCommands metadata is unsupported");
		// Only prompt metadata identifies user/project/path overrides; bundled prompts and built-in extensions remain eligible.
		if (source === "prompt" && location !== undefined) blockedNames.add(name);
	}
	return blockedNames;
}

function registerSlashAutocomplete(
	apiValue: unknown,
	definitions: unknown,
	dictionary: Dictionary,
	report: DiagnosticReporter,
): void {
	try {
		const index = createSlashDescriptionIndex(definitions);
		if (!index || !isRecord(apiValue)) return;
		const extensionApi = apiValue;
		let registered = false;
		const onSessionStart = function (_event: unknown, context: unknown): void {
			try {
				if (!isRecord(context) || context.hasUI !== true) return;
				const ui = Reflect.get(context, "ui", context);
				if (!isRecord(ui) || registered) return;
				const addAutocompleteProvider = Reflect.get(ui, "addAutocompleteProvider", ui);
				if (typeof addAutocompleteProvider !== "function") {
					report("slash autocomplete 显示层跳过: UI provider registration is unavailable", context);
					return;
				}
				const factory = function (current: unknown): unknown {
					try {
						const blockedNames = readBlockedSlashCommandNames(extensionApi);
						return wrapSlashAutocompleteWithIndex(current, index, dictionary, blockedNames);
					} catch (error) {
						report(`slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`);
						return current;
					}
				};
				Reflect.apply(addAutocompleteProvider, ui, [factory]);
				registered = true;
			} catch (error) {
				report(`slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`, context);
			}
		};
		registerExtensionEvent(apiValue, "session_start", onSessionStart);
	} catch (error) {
		report(`slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Gate translation to the launcher process; inherited child processes fail closed. */
export function isTranslationEnabled(environment: Environment = process.env): boolean {
	return environment.OMP_ZH_ENABLED === "1" && environment.OMP_ZH_PROCESS_ID === String(process.pid);
}

/** Register display transforms before the host CLI imports their consumers. */
export async function preparePreloadDisplayTranslations(launchConfig: LaunchConfig, configPath: string): Promise<void> {
	if (!isTranslationEnabled()) return;
	const diagnostics = await loadInstalledDiagnostics(configPath);
	try {
		const dictionary = loadDictionary(process.env, launchConfig.dictPath, diagnostics.reportDiagnostic);
		if (Object.keys(dictionary).length === 0) return;
		const settingsUiPath = join(dirname(configPath), "settings-ui.ts");
		const settingsUi: unknown = await import(pathToFileURL(settingsUiPath).href);
		if (!isRecord(settingsUi) || typeof settingsUi.registerSettingsUiTranslation !== "function") {
			throw new Error("Installed settings UI translation module is unavailable; reinstall zhomp");
		}
		const modelUiPath = join(dirname(configPath), "model-ui.ts");
		const modelUi: unknown = await import(pathToFileURL(modelUiPath).href);
		if (!isRecord(modelUi) || typeof modelUi.registerModelTranslation !== "function") {
			throw new Error("Installed Model translation module is unavailable; reinstall zhomp");
		}
		modelUi.registerModelTranslation(launchConfig.host.modelHubPath, dictionary);
		settingsUi.registerSettingsUiTranslation(launchConfig.host.settingsUiPath, dictionary);
	} catch (error) {
		diagnostics.reportDiagnostic(`汉化预加载跳过: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export default async function (_pi: unknown): Promise<void> {
	if (!isTranslationEnabled()) return;
	const environment = process.env;
	const configPath = environment.OMP_ZH_CONFIG;
	if (!configPath || !isAbsolute(configPath)) {
		throw new Error("OMP_ZH_CONFIG must be an absolute launch config path");
	}
	const diagnostics = await loadInstalledDiagnostics(configPath);
	const report = createUiDiagnosticReporter(_pi, diagnostics);
	try {
		// The installed host module is selected at runtime by the launcher's config path.
		const hostModulePath = join(dirname(configPath), "host.ts");
		const hostModule = await import(pathToFileURL(hostModulePath).href) as InstalledHostModule;
		const launchConfig = hostModule.readLaunchConfig(configPath);
		const dictionary = loadDictionary(environment, launchConfig.dictPath, report);
		if (Object.keys(dictionary).length === 0) return;
		const host = await loadHost(launchConfig.host);
		translateSettings(host, dictionary);
		registerSlashAutocomplete(_pi, host.builtinSlashCommandDefs, dictionary, report);
	} catch (error) {
		report(`汉化失败: ${error instanceof Error ? error.message : String(error)}`);
	}
}
