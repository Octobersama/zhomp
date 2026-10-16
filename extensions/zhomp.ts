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


interface SlashCommandDisplayRule {
	name: string;
	description: string;
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

		const rule: SlashCommandDisplayRule = { name, description, subcommands: new Map() };
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

function findSlashDisplayMatch(
	item: ObjectRecord,
	context: SlashAutocompleteContext,
	index: SlashDescriptionIndex,
	blockedNames: ReadonlySet<string>,
): string | undefined {
	const value = readOwnString(item, "value");
	if (value === undefined) return undefined;
	if (context.kind === "command-name") {
		const command = index.commands.get(value);
		if (!command || blockedNames.has(value) || blockedNames.has(command.name)) return undefined;
		return command.description;
	}
	const command = index.commands.get(context.commandName);
	if (!command || blockedNames.has(context.commandName) || blockedNames.has(command.name)) return undefined;
	return command.subcommands.get(value);
}

function translateStaticDisplayText(value: string, source: string, dictionary: Dictionary): string | undefined {
	const translated = translateText(dictionary, source);
	if (translated === source) return undefined;
	let text = value;
	let suffix = "";
	if (text.endsWith(BUNDLED_DESCRIPTION_SUFFIX)) {
		suffix = BUNDLED_DESCRIPTION_SUFFIX;
		text = text.slice(0, -BUNDLED_DESCRIPTION_SUFFIX.length);
	}
	if (text === source) return `${translated}${suffix}`;
	const delimiter = text.lastIndexOf(" - ");
	if (delimiter < 0 || text.slice(delimiter + 3) !== source) return undefined;
	return `${text.slice(0, delimiter + 3)}${translated}${suffix}`;
}

function translateSuggestionItem(
	value: unknown,
	source: string,
	dictionary: Dictionary,
	originalItems: WeakMap<object, ObjectRecord>,
): unknown {
	if (!isRecord(value)) return value;
	const descriptionDescriptor = Object.getOwnPropertyDescriptor(value, "description");
	const nativeDetailDescriptor = Object.getOwnPropertyDescriptor(value, "nativeDetail");
	let translatedDescription: string | undefined;
	let translatedNativeDetail: string | undefined;
	if (descriptionDescriptor && "value" in descriptionDescriptor && typeof descriptionDescriptor.value === "string") {
		translatedDescription = translateStaticDisplayText(descriptionDescriptor.value, source, dictionary);
	}
	if (
		nativeDetailDescriptor &&
		"value" in nativeDetailDescriptor &&
		typeof nativeDetailDescriptor.value === "string"
	) {
		translatedNativeDetail = translateStaticDisplayText(nativeDetailDescriptor.value, source, dictionary);
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
			const source = findSlashDisplayMatch(item, context, index, blockedNames);
			if (source === undefined) continue;
			const translated = translateSuggestionItem(item, source, dictionary, originalItems);
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

function registerSlashAutocomplete(apiValue: unknown, definitions: unknown, dictionary: Dictionary): boolean {
	try {
		const index = createSlashDescriptionIndex(definitions);
		if (!index || !isRecord(apiValue)) return false;
		const on = Reflect.get(apiValue, "on", apiValue);
		if (typeof on !== "function") return false;
		let registered = false;
		const onSessionStart = function (_event: unknown, context: unknown): void {
			try {
				if (!isRecord(context)) return;
				const ui = Reflect.get(context, "ui", context);
				if (!isRecord(ui) || registered) return;
				const addAutocompleteProvider = Reflect.get(ui, "addAutocompleteProvider", ui);
				if (typeof addAutocompleteProvider !== "function") return;
				const factory = function (current: unknown): unknown {
					try {
						const blockedNames = readBlockedSlashCommandNames(apiValue);
						return wrapSlashAutocompleteWithIndex(current, index, dictionary, blockedNames);
					} catch (error) {
						console.log(`[zhomp] slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`);
						return current;
					}
				};
				Reflect.apply(addAutocompleteProvider, ui, [factory]);
				registered = true;
				console.log("[zhomp] slash autocomplete 显示层注册请求已提交");
			} catch (error) {
				console.log(`[zhomp] slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`);
			}
		};
		Reflect.apply(on, apiValue, ["session_start", onSessionStart]);
		return true;
	} catch (error) {
		console.log(`[zhomp] slash autocomplete 显示层跳过: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
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
		const slashHookRegistered = registerSlashAutocomplete(_pi, host.builtinSlashCommandDefs, dictionary);
		console.log(
			`[zhomp] 汉化完成: tab ${counts.tabLabels}, label ${counts.labels}, description ${counts.descriptions}, warning ${counts.warnings}, group ${counts.groups}, option 文本 ${counts.optionLabels + counts.optionDescriptions}, slash autocomplete 显示层 ${slashHookRegistered ? "session_start hook 已注册" : "未注册"}（字典 ${Object.keys(dictionary).length} 条，宿主 ${host.version}）`,
		);
	} catch (error) {
		console.log(`[zhomp] 汉化失败: ${error instanceof Error ? error.message : String(error)}`);
	}
}
