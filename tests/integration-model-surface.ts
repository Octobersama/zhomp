import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface RegistryLoadResult {
	errors: unknown[];
	extensions: unknown[];
}

interface InstalledLoaderApi {
	loadExtensions(paths: string[], cwd: string): Promise<RegistryLoadResult>;
}

interface SettingsModuleApi {
	Settings: {
		init(options: { cwd: string; agentDir: string; inMemory: true; readOnly: true }): Promise<unknown>;
	};
	resetSettingsForTest(): void;
}

interface ModelSpec {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

interface DisplayModel extends ModelSpec {
	identity: unknown;
	tokenizer: unknown;
	thinking: unknown;
	[extra: string]: unknown;
}

interface ModelBuilderApi {
	buildModel(spec: ModelSpec): DisplayModel;
}

interface RoleInfo {
	tag?: string;
	name: string;
	color: string;
	section: "chat" | "kind";
	accepts(model: DisplayModel): boolean;
}

interface ModelHubSettings {
	revision: number;
	defaultThinkingLevel: string;
	modelProviderOrder: readonly string[];
	knownRoleIds: readonly string[];
	mruOrder: readonly string[];
	modelPerf: ReadonlyMap<string, unknown>;
	disabledProviders: readonly string[];
	fallbackChains: Record<string, string[]>;
	modelRoleStorage: "global" | "project";
	cycleOrder: readonly string[];
	getModelPresets?(): { names: readonly string[]; active: string | undefined };
	getRoleInfo(role: string): RoleInfo;
	getModelRole(role: string): string | undefined;
	getProjectModelRole(role: string): string | undefined;
	getGlobalModelRole(role: string): string | undefined;
	getModelRoleSource(role: string): "global" | "project" | "default";
	defaultRoleChain(role: string): string[];
	resolveRoleValue(value: string, models: readonly DisplayModel[]): { model?: DisplayModel; explicitThinkingLevel: boolean };
}

interface RegistryCounters {
	refreshCalls: number;
	configWrites: number;
}

interface ModelHubRegistry {
	authStorage: { keys: { source(provider: string): undefined } };
	getError(): undefined;
	getAvailable(kind?: string): DisplayModel[];
	getAll(kind?: string): DisplayModel[];
	getDiscoverableProviders(): string[];
	getProviderDiscoveryState(provider: string): { optional: boolean; status: "empty" } | undefined;
	find(provider: string, id: string): undefined;
	refresh(strategy: "online"): Promise<void>;
	refreshProvider(provider: string, strategy: "online"): Promise<void>;
}

interface ModelHubCallbacks {
	onAssign(model: DisplayModel, role: string, level: unknown, selector: string): void;
	onUnassign(): void;
	onFallbackChainChange(): void;
	onLoginRequest(): void;
	onSavePreset(): void;
	onSwitchPreset?(name: string): void;
	onCycleOrderChange(): void;
	onCancel(): void;
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

interface ModelHubComponentApi {
	new (
		tui: { terminal: { rows: number }; requestRender(): void },
		settings: ModelHubSettings,
		registry: ModelHubRegistry,
		scopedModels: readonly { model: DisplayModel }[],
		callbacks: ModelHubCallbacks,
		options?: { initialProviderId?: string; currentSelector?: string },
	): ModelHubInstance;
}

interface ModelHubInstance {
	render(width: number): readonly string[];
	handleInput(data: string): void;
	describe?: (context: NativeContext) => unknown;
	dispose(): void;
}
interface ModelBrowserApi {
	new (settings: ModelHubSettings): {
		render(width: number): readonly string[];
	};
}

interface NativeTreeNode {
	k?: string;
	p?: Record<string, unknown>;
	c?: readonly unknown[];
}

function assertWidth(lines: readonly string[], width: number, visibleWidth: (text: string) => number, label: string): void {
	for (const [index, line] of lines.entries()) {
		const measured = visibleWidth(Bun.stripANSI(line));
		ok(measured <= width, `${label} line ${index + 1} is ${measured} cells wide at a ${width}-cell terminal`);
	}
}

function materializeNative(value: unknown, context: NativeContext): unknown {
	if (Array.isArray(value)) return value.map(item => materializeNative(item, context));
	if (value === null || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	if (typeof record.describe === "function") {
		return materializeNative((record.describe as (context: NativeContext) => unknown)(context), context);
	}
	const children = record.c;
	return Object.fromEntries(Object.entries(record).map(([key, child]) => [
		key,
		key === "c" && Array.isArray(children) ? children.map(item => materializeNative(item, context)) : child,
	]));
}

function nativeRoleSelection(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const selected = nativeRoleSelection(child);
			if (selected) return selected;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as NativeTreeNode;
	if (node.k === "list" && node.p?.aria === "Roles") {
		return typeof node.p.selected === "string" ? node.p.selected : undefined;
	}
	return nativeRoleSelection(node.c);
}

function dictionaryFromFile(path: string): Record<string, string> {
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Installed dictionary is not an object");
	}
	const dictionary: Record<string, string> = {};
	for (const [key, translation] of Object.entries(value)) {
		if (typeof translation === "string") dictionary[key] = translation;
	}
	return dictionary;
}

const mode = process.env.MODEL_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") throw new Error("MODEL_SURFACE_MODE must be ordinary, translated, or hostile");
const translationEnabled = mode !== "ordinary";
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");

// Installed host/TUI modules are selected from launch.json; static imports would resolve a different Bun package copy.
const installDir = dirname(configPath);
const installedHost = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
const modelUiPath = join(installDir, "model-ui.ts");
if (!existsSync(modelUiPath)) throw new Error(`Installed ModelHub translator is missing: ${modelUiPath}`);
const shippedDictionary = dictionaryFromFile(launch.dictPath);
const hostileTitle = "模型'\"; globalThis.__zhompModelUiInjected = true; // $& $` $' ${notCode} \\";
const dictionary = mode === "hostile"
	? { ...shippedDictionary, Models: hostileTitle, "All available models": hostileTitle }
	: shippedDictionary;
const dictionaryPath = mode === "hostile" ? join(probeRoot, "model-ui-hostile-dictionary.json") : launch.dictPath;
if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = translationEnabled ? String(process.pid) : "-1";

// Match launch.ts: prepare the installed hook before importing any host component barrel.
const installedExtension = await import(pathToFileURL(launch.extensionPath).href) as {
	prepareModelTranslation(config: typeof launch, configPath: string): Promise<void>;
};
await installedExtension.prepareModelTranslation(launch, configPath);

const settingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", launch.host.packageDir);
const settingsModule = await import(pathToFileURL(settingsPath).href) as SettingsModuleApi;
await settingsModule.Settings.init({ cwd: probeRoot, agentDir: probeRoot, inMemory: true, readOnly: true });
try {
	const loaderPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/extensions/loader", launch.host.packageDir);
	const loader = await import(pathToFileURL(loaderPath).href) as InstalledLoaderApi;
	const extensionLoad = await loader.loadExtensions([launch.extensionPath], probeRoot);
	deepStrictEqual(extensionLoad.errors, [], "the installed extension must load without host errors");
	strictEqual(extensionLoad.extensions.length, 1, "the installed extension factory must be invoked");

	const dictionaryModule = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
	const theme = await import(pathToFileURL(dictionaryModule).href) as { initThemeSync(): void };
	theme.initThemeSync();
	const modelHubModule = await import(pathToFileURL(launch.host.modelHubPath).href) as { ModelHubComponent: ModelHubComponentApi };
	const browserPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/model-browser", launch.host.packageDir);
	const browserModule = await import(pathToFileURL(browserPath).href) as { ModelBrowser: ModelBrowserApi };
	const textUtilsPath = Bun.resolveSync("@oh-my-pi/pi-tui/utils", launch.host.packageDir);
	const textUtils = await import(pathToFileURL(textUtilsPath).href) as { visibleWidth(text: string): number };
	const catalogPath = Bun.resolveSync("@oh-my-pi/pi-catalog/build", launch.host.packageDir);
	const catalog = await import(pathToFileURL(catalogPath).href) as ModelBuilderApi;

	const roleDefaults: Readonly<Record<string, readonly [string, string, "chat" | "kind"]>> = {
		default: ["DEFAULT", "Default", "chat"],
		smol: ["SMOL", "Fast", "chat"],
		slow: ["SLOW", "Thinking", "chat"],
		vision: ["VISION", "Vision", "chat"],
		plan: ["PLAN", "Architect", "chat"],
		commit: ["COMMIT", "Commit", "chat"],
		tiny: ["TINY", "Tiny", "chat"],
		memory: ["MEMORY", "Memory", "chat"],
		task: ["TASK", "Subtask", "chat"],
		advisor: ["ADVISOR", "Advisor", "chat"],
		image: ["IMAGE", "Image generation", "kind"],
		web: ["WEB", "Web search", "kind"],
		speech: ["SPEECH", "Speech", "kind"],
		dictation: ["DICTATION", "Dictation", "kind"],
		judge: ["JUDGE", "Judge", "kind"],
	};
	const customRoles: Readonly<Record<string, RoleInfo>> = {
		"my-custom-name": { name: "Default", color: "muted", section: "chat", accepts: () => true },
		"my-custom-tag": { tag: "Roles", name: "Private Label", color: "muted", section: "chat", accepts: () => true },
	};
	const roleInfoById: Record<string, RoleInfo> = {};
	for (const [role, [tag, name, section]] of Object.entries(roleDefaults)) {
		roleInfoById[role] = { tag, name, color: "muted", section, accepts: () => true };
	}
	Object.assign(roleInfoById, customRoles);
	const customRoleSnapshot: Record<string, RoleInfo> = {};
	for (const [role, info] of Object.entries(customRoles)) customRoleSnapshot[role] = { ...info };
	const knownRoleIds = [...Object.keys(roleDefaults), ...Object.keys(customRoles)];
	const presetNames = ["custom"];
	let activePreset: string | undefined = "custom";
	const settings: ModelHubSettings = {
		revision: 0,
		defaultThinkingLevel: "inherit",
		modelProviderOrder: ["Models"],
		knownRoleIds,
		mruOrder: [],
		modelPerf: new Map(),
		disabledProviders: [],
		fallbackChains: {},
		modelRoleStorage: "global",
		cycleOrder: [],
		getModelPresets() { return { names: presetNames, active: activePreset }; },
		getRoleInfo(role) {
			const info = roleInfoById[role];
			if (!info) throw new Error(`Unexpected display role: ${role}`);
			return info;
		},
		getModelRole() { return undefined; },
		getProjectModelRole() { return undefined; },
		getGlobalModelRole() { return undefined; },
		getModelRoleSource() { return "default"; },
		defaultRoleChain() { return []; },
		resolveRoleValue() { return { explicitThinkingLevel: false }; },
	};
	const model = catalog.buildModel({
		id: "Roles",
		name: "All models",
		api: "ollama-chat",
		provider: "Models",
		baseUrl: "http://display-only.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	});
	// This sibling component is deliberately outside the selected onLoad target.
	const standaloneBrowser = new browserModule.ModelBrowser(settings);
	const standaloneEmpty = Bun.stripANSI(standaloneBrowser.render(160).join("\n"));
	const genericEmptyLabel = "No models available in this scope";
	ok(standaloneEmpty.includes(genericEmptyLabel), "the sibling ModelBrowser must retain its own English empty-state copy");
	if (translationEnabled) {
		const modelHubEmptyLabel = dictionary[genericEmptyLabel];
		if (!modelHubEmptyLabel || modelHubEmptyLabel === genericEmptyLabel) throw new Error("The ModelHub empty-state dictionary entry is missing");
		ok(!standaloneEmpty.includes(modelHubEmptyLabel), "translation must not be applied to sibling component output");
	}
	const counters: RegistryCounters = { refreshCalls: 0, configWrites: 0 };
	// All registry responses are isolated display fixtures; the fixture exposes no network or model API.
	const registry: ModelHubRegistry = {
		authStorage: { keys: { source() { return undefined; } } },
		getError() { return undefined; },
		getAvailable() { return []; },
		getAll() { return []; },
		getDiscoverableProviders() { return ["Models"]; },
		getProviderDiscoveryState() { return { optional: false, status: "empty" }; },
		find() { return undefined; },
		async refresh() { counters.refreshCalls++; },
		async refreshProvider() {},
	};
	const assignmentCaptures: { role: string; selector: string; provider: string; modelId: string }[] = [];
	const callbacks: ModelHubCallbacks = {
		// Capture the component's selection only; this fixture callback never persists settings.
		onAssign(model, role, _level, selector) {
			assignmentCaptures.push({ role, selector, provider: model.provider, modelId: model.id });
		},
		onUnassign() { counters.configWrites++; },
		onFallbackChainChange() { counters.configWrites++; },
		onLoginRequest() { counters.configWrites++; },
		onSavePreset() { counters.configWrites++; },
		onSwitchPreset() { counters.configWrites++; },
		onCycleOrderChange() { counters.configWrites++; },
		onCancel() {},
	};
	const fakeTui = { terminal: { rows: 48 }, requestRender() {} };
	const pickerContext: NativeContext = {
		cols: 160,
		reduceMotion: true,
		dark: true,
		supports(kind) { return kind === "picker"; },
		feature() { return false; },
	};
	const treeContext: NativeContext = {
		cols: 160,
		reduceMotion: true,
		dark: true,
		supports() { return false; },
		feature() { return false; },
	};

	const modelHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		settings,
		registry,
		[{ model }],
		callbacks,
		{ currentSelector: "Models/Roles" },
	);
	const nativeAvailable = typeof modelHub.describe === "function";
	const title = mode === "ordinary" ? "Models" : mode === "hostile" ? hostileTitle : dictionary.Models;
	if (!title || (mode === "translated" && title === "Models")) throw new Error("The installed dictionary must translate the /model panel title");
	if (mode === "ordinary") strictEqual(title, "Models");
	if (mode === "hostile") {
		strictEqual(title, hostileTitle);
		strictEqual(Reflect.get(globalThis, "__zhompModelUiInjected"), undefined, "hostile dictionary text must not execute module code");
	}

	const allAnsi = Bun.stripANSI(modelHub.render(160).join("\n"));
	// Long titles are clipped by HubFrame; hostile text is also exercised in the full-width status.
	ok(allAnsi.includes(title), `${mode} ModelHub dictionary text ${JSON.stringify(title)} missing:\n${allAnsi}`);
	ok(allAnsi.includes("Models"), "the model provider value matching a dictionary key must remain unchanged");
	ok(allAnsi.includes("Roles"), "the model ID matching a dictionary key must remain unchanged");
	ok(allAnsi.includes("All models"), "the model name matching a dictionary key must remain unchanged");
	assertWidth(modelHub.render(160), 160, textUtils.visibleWidth, "normal all-model view");
	assertWidth(modelHub.render(80), 80, textUtils.visibleWidth, "narrow all-model view");
	strictEqual(counters.refreshCalls, 0, "a scoped display-only model must not trigger catalog refresh");

	const allNative = nativeAvailable ? JSON.stringify(materializeNative(modelHub.describe?.(pickerContext), pickerContext)) : undefined;
	if (allNative) {
		ok(allNative.includes(JSON.stringify(title)), "native picker description must carry the literal panel title");
		ok(allNative.includes("Models/Roles"), "native model selector values must remain unchanged");
	}

	modelHub.handleInput("\x1b[A");
	modelHub.handleInput("\r");
	const initialRoleNative = nativeAvailable ? materializeNative(modelHub.describe?.(treeContext), treeContext) : undefined;
	const selectedRoleBefore = nativeRoleSelection(initialRoleNative);
	const roleAnsiBeforeDown = Bun.stripANSI(modelHub.render(160).join("\n"));
	modelHub.handleInput("\x1b[B");
	const movedRoleNative = nativeAvailable ? materializeNative(modelHub.describe?.(treeContext), treeContext) : undefined;
	const movedRolePicker = nativeAvailable ? materializeNative(modelHub.describe?.(pickerContext), pickerContext) : undefined;
	const selectedRoleAfter = nativeRoleSelection(movedRoleNative);
	if (nativeAvailable) {
		strictEqual(selectedRoleBefore, "role:default", "Enter should enter Roles at the first built-in role");
		strictEqual(selectedRoleAfter, "role:smol", "Down should move to the next role while preserving its logical ID");
	}

	const roleAnsi = Bun.stripANSI(modelHub.render(160).join("\n"));
	const presetTitle = dictionary["Preset:"];
	const hasPresetUi = roleAnsi.includes("Preset:") || (presetTitle !== undefined && roleAnsi.includes(presetTitle));
	ok(roleAnsi !== roleAnsiBeforeDown, "the Down key must move the visible Roles selection");
	ok(roleAnsi.includes("Default"), "a custom role name matching a dictionary key must stay unchanged");
	ok(roleAnsi.includes("Roles"), "a custom role tag matching a dictionary key must stay unchanged");
	if (hasPresetUi) ok(roleAnsi.includes("custom"), "a custom preset name matching a dictionary key must remain unchanged");
	for (const [role, [tag]] of Object.entries(roleDefaults)) {
		ok(roleAnsi.includes(tag), `the real ANSI Roles view must preserve ${role} as ${tag}`);
	}
	if (translationEnabled) {
		const searchHint = dictionary["type to search"];
		if (!searchHint || searchHint === "type to search") throw new Error("The search operation hint dictionary entry is missing");
		ok(allAnsi.includes(searchHint), "the all-model operation hint must use the shipped translation");
		for (const label of ["pick", "fallback", "clear", "cycle", "reorder", "new"]) {
			const translatedLabel = dictionary[label];
			if (!translatedLabel || translatedLabel === label) throw new Error(`The operation hint dictionary entry is missing: ${label}`);
			ok(roleAnsi.includes(translatedLabel), `the real ANSI Roles footer must translate ${label}`);
		}
		if (hasPresetUi) {
			for (const label of ["Preset:", "preset"]) {
				const translatedLabel = dictionary[label];
				if (!translatedLabel || translatedLabel === label) throw new Error(`The preset UI dictionary entry is missing: ${label}`);
				ok(roleAnsi.includes(translatedLabel), `the real ANSI Roles UI must translate ${label}`);
				ok(!roleAnsi.includes(label), `the real ANSI Roles UI must not leave ${label} in English`);
			}
			const translatedCustom = dictionary.custom;
			if (!translatedCustom || translatedCustom === "custom") throw new Error("The custom preset dictionary entry is missing");
			ok(!roleAnsi.includes(translatedCustom), "the custom preset name must not be translated as a UI label");
		}
	}
	assertWidth(modelHub.render(160), 160, textUtils.visibleWidth, "normal Roles view");
	assertWidth(modelHub.render(80), 80, textUtils.visibleWidth, "narrow Roles view");

	const encodedRoleTree = nativeAvailable ? JSON.stringify(movedRoleNative) : undefined;
	const encodedRolePicker = nativeAvailable ? JSON.stringify(movedRolePicker) : undefined;
	if (encodedRoleTree && encodedRolePicker) {
		for (const role of knownRoleIds) ok(encodedRoleTree.includes(`role:${role}`), `native role ID ${role} must remain unchanged`);
		for (const [role, [tag, name]] of Object.entries(roleDefaults)) {
			ok(encodedRolePicker.includes(JSON.stringify(tag)), `native Roles picker must preserve the ${role} tag ${tag}`);
			ok(encodedRolePicker.includes(JSON.stringify(name)), `native Roles picker must preserve the ${role} name ${name}`);
		}
		if (hasPresetUi) {
			ok(encodedRolePicker.includes(JSON.stringify("custom")), "native ModelHub must preserve a custom preset name matching a dictionary key");
			if (translationEnabled) {
				for (const label of ["Preset ", "preset", "Next preset"]) {
					const translatedLabel = dictionary[label];
					if (!translatedLabel || translatedLabel === label) throw new Error(`The native preset dictionary entry is missing: ${label}`);
					ok(encodedRolePicker.includes(translatedLabel), `the native ModelHub must translate ${label}`);
				}
				const translatedCustom = dictionary.custom;
				if (!translatedCustom || translatedCustom === "custom") throw new Error("The custom preset dictionary entry is missing");
				ok(!encodedRolePicker.includes(translatedCustom), "the native custom preset name must remain unchanged");
			}
		}
		if (translationEnabled) {
			for (const label of ["Pick model", "Add fallback", "Add to cycle", "New role"]) {
				const translatedLabel = dictionary[label];
				if (!translatedLabel || translatedLabel === label) throw new Error(`The native action dictionary entry is missing: ${label}`);
				ok(encodedRolePicker.includes(translatedLabel), `the native Roles picker must translate ${label}`);
			}
		}
	}
	for (const key of Object.keys(customRoles)) {
		deepStrictEqual(roleInfoById[key], customRoleSnapshot[key], `custom role metadata ${key} must remain unchanged`);
	}

	modelHub.handleInput("\r");
	modelHub.handleInput("\r");
	modelHub.handleInput("\r");
	deepStrictEqual(assignmentCaptures, [{ role: "smol", selector: "Models/Roles", provider: "Models", modelId: "Roles" }], "keyboard assignment must preserve role, provider, model, and selector identities");
	if (hasPresetUi) {
		activePreset = undefined;
		const unassignedPresetHub = new modelHubModule.ModelHubComponent(
			fakeTui,
			settings,
			registry,
			[{ model }],
			callbacks,
			{ currentSelector: "Models/Roles" },
		);
		unassignedPresetHub.handleInput("\x1b[A");
		unassignedPresetHub.handleInput("\r");
		const unassignedPresetAnsi = Bun.stripANSI(unassignedPresetHub.render(160).join("\n"));
		const unassignedPresetNative = nativeAvailable
			? JSON.stringify(materializeNative(unassignedPresetHub.describe?.(pickerContext), pickerContext))
			: undefined;
		if (translationEnabled) {
			const translatedCustom = dictionary.custom;
			if (!translatedCustom || translatedCustom === "custom") throw new Error("The custom preset placeholder dictionary entry is missing");
			ok(unassignedPresetAnsi.includes(translatedCustom), "the fixed ANSI custom-preset placeholder must be translated");
			if (unassignedPresetNative) ok(unassignedPresetNative.includes(translatedCustom), "the fixed native custom-preset placeholder must be translated");
		}
		unassignedPresetHub.dispose();
	}

	const emptyHub = new modelHubModule.ModelHubComponent(fakeTui, settings, registry, [], callbacks);
	const { promise: refreshSettled, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, 0);
	await refreshSettled;
	const emptyAnsi = Bun.stripANSI(emptyHub.render(160).join("\n"));
	const expectedEmptyState = translationEnabled ? dictionary[genericEmptyLabel] : genericEmptyLabel;
	if (!expectedEmptyState) throw new Error("The installed dictionary must translate the empty-state label");
	ok(emptyAnsi.includes(expectedEmptyState), `the real ANSI empty state must display ${expectedEmptyState}`);
	assertWidth(emptyHub.render(160), 160, textUtils.visibleWidth, "normal empty view");
	assertWidth(emptyHub.render(80), 80, textUtils.visibleWidth, "narrow empty view");
	if (nativeAvailable) {
		const emptyNativeTree = JSON.stringify(materializeNative(emptyHub.describe?.(treeContext), treeContext));
		const emptyNativePicker = JSON.stringify(materializeNative(emptyHub.describe?.(pickerContext), pickerContext));
		ok(emptyNativeTree.includes(expectedEmptyState), "native component description must expose the empty state");
		ok(emptyNativePicker.includes(expectedEmptyState), "native picker description must expose the empty state");
	}
	ok(counters.refreshCalls > 0, "the empty display fixture should exercise the local registry stub");
	strictEqual(counters.configWrites, 0, "the probe must not persist user configuration");
	const injectionSideEffect = Reflect.get(globalThis, "__zhompModelUiInjected") === true;
	modelHub.dispose();
	emptyHub.dispose();
	console.log(JSON.stringify({
		mode,
		hostVersion: launch.host.version,
		component: "ModelHubComponent",
		unrelatedConsumer: "ModelBrowser remains English",
		title,
		configWrites: counters.configWrites,
		roleTag: "SMOL",
		customRoleName: "Default",
		customRoleTag: "Roles",
		model: "Models/Roles",
		assignment: assignmentCaptures[0],
		emptyState: expectedEmptyState,
		keyboard: { selectedBefore: selectedRoleBefore, selectedAfter: selectedRoleAfter, nativeShortcuts: nativeAvailable },
		nativeDescribe: `${nativeAvailable ? "covered" : "unavailable"}@${launch.host.version}`,
		injectionSideEffect,
		widthCells: [80, 160],
		fixture: "isolated display data; fake registry has no network/model API; read-only settings; configWrites=0",
	}));
} finally {
	settingsModule.resetSettingsForTest();
}
