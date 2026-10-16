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
	loginRequests: number;
	cancelCalls: number;
}

interface ProviderDiscoveryState {
	optional: boolean;
	status: "idle" | "ok" | "empty" | "cached" | "unavailable" | "unauthenticated";
	fetchedAt?: number;
	error?: string;
}

interface ModelHubRegistry {
	authStorage: { keys: { source(provider: string): unknown } };
	getError(): unknown;
	getAvailable(kind?: string): DisplayModel[];
	getAll(kind?: string): DisplayModel[];
	getDiscoverableProviders(): string[];
	getProviderDiscoveryState(provider: string): ProviderDiscoveryState | undefined;
	find(provider: string, id: string): DisplayModel | undefined;
	refresh(strategy: "online"): Promise<void>;
	refreshProvider(provider: string, strategy: "online", options?: { refreshCommandCredentials?: boolean }): Promise<void>;
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
	onCompactionPointChange?(model: DisplayModel, input: string, confirmed: boolean): undefined;
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

interface NativeActionEvent {
	type: "action";
	key: string;
	act: string;
	mods: readonly string[];
}

interface ModelHubInstance {
	render(width: number): readonly string[];
	handleInput(data: string): void;
	handleNativeEvent?(event: NativeActionEvent): void;
	describe?: (context: NativeContext) => unknown;
	dispose(): void;
}

interface NativeTabItem {
	id: string;
	label: string;
}

interface NativePickerAction {
	id: string;
	label: string;
	keys?: readonly string[];
	end?: boolean;
}

interface NativePickerGroup {
	group: string;
	label: string;
	count: number;
}

interface NativePickerScope {
	id: string;
	label: string;
	group?: string;
	disabled?: string;
	count?: number;
}
function nativePickerScopes(value: unknown): readonly NativePickerScope[] | undefined {
	const scopes = nativePickerProps(value)?.scopes;
	if (!Array.isArray(scopes)) return undefined;
	const parsed: NativePickerScope[] = [];
	for (const scope of scopes) {
		if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return undefined;
		const item = scope as { id?: unknown; label?: unknown; group?: unknown; disabled?: unknown; count?: unknown };
		if (typeof item.id !== "string" || typeof item.label !== "string") return undefined;
		parsed.push({
			id: item.id,
			label: item.label,
			...(typeof item.group === "string" ? { group: item.group } : {}),
			...(typeof item.disabled === "string" ? { disabled: item.disabled } : {}),
			...(typeof item.count === "number" ? { count: item.count } : {}),
		});
	}
	return parsed;
}

function parseNativeTabs(value: unknown, ids: readonly string[]): readonly NativeTabItem[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const parsed: NativeTabItem[] = [];
	for (const item of value) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) break;
		const tab = item as { id?: unknown; label?: unknown };
		if (typeof tab.id !== "string" || typeof tab.label !== "string") break;
		parsed.push({ id: tab.id, label: tab.label });
	}
	if (parsed.length === ids.length && ids.every((id, index) => parsed[index]?.id === id)) return parsed;
	return undefined;
}

function nativeTabs(value: unknown, ids: readonly string[]): readonly NativeTabItem[] | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const tabs = nativeTabs(child, ids);
			if (tabs) return tabs;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as NativeTreeNode;
	if (node.k === "tabs") {
		const tabs = parseNativeTabs(node.p?.items, ids);
		if (tabs) return tabs;
	}
	return nativeTabs(node.c, ids);
}

function nativePickerProps(value: unknown): Record<string, unknown> | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const props = nativePickerProps(child);
			if (props) return props;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as NativeTreeNode;
	if (node.k === "picker") return node.p;
	return nativePickerProps(node.c);
}

function nativePickerTabs(value: unknown, ids: readonly string[]): readonly NativeTabItem[] | undefined {
	return parseNativeTabs(nativePickerProps(value)?.tabs, ids);
}

function nativePickerActions(value: unknown): readonly NativePickerAction[] | undefined {
	const actions = nativePickerProps(value)?.actions;
	if (!Array.isArray(actions)) return undefined;
	const parsed: NativePickerAction[] = [];
	for (const action of actions) {
		if (action === null || typeof action !== "object" || Array.isArray(action)) return undefined;
		const item = action as { id?: unknown; label?: unknown; keys?: unknown; end?: unknown };
		if (typeof item.id !== "string" || typeof item.label !== "string") return undefined;
		const keys = item.keys;
		if (keys !== undefined && (!Array.isArray(keys) || !keys.every(key => typeof key === "string"))) return undefined;
		parsed.push({
			id: item.id,
			label: item.label,
			...(Array.isArray(keys) ? { keys } : {}),
			...(typeof item.end === "boolean" ? { end: item.end } : {}),
		});
	}
	return parsed;
}

function nativePickerGroups(value: unknown): readonly NativePickerGroup[] | undefined {
	const order = nativePickerProps(value)?.order;
	if (!Array.isArray(order)) return undefined;
	const groups: NativePickerGroup[] = [];
	for (const group of order) {
		if (typeof group === "string") continue;
		if (group === null || typeof group !== "object" || Array.isArray(group)) return undefined;
		const item = group as { group?: unknown; label?: unknown; count?: unknown };
		if (typeof item.group !== "string" || typeof item.label !== "string" || typeof item.count !== "number") return undefined;
		groups.push({ group: item.group, label: item.label, count: item.count });
	}
	return groups;
}


interface NativeKeyValueItem {
	key: string;
	value: unknown;
}

function nativePickerColumnHead(value: unknown, id: string): string | undefined {
	const columns = nativePickerProps(value)?.columns;
	if (!Array.isArray(columns)) return undefined;
	for (const column of columns) {
		if (column === null || typeof column !== "object" || Array.isArray(column)) continue;
		const item = column as { id?: unknown; head?: unknown };
		if (item.id === id) return typeof item.head === "string" ? item.head : undefined;
	}
	return undefined;
}

function nativeKeyValueItems(value: unknown, requiredKey: string): readonly NativeKeyValueItem[] | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const items = nativeKeyValueItems(child, requiredKey);
			if (items) return items;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as NativeTreeNode;
	const rawItems = node.k === "kv" ? node.p?.items : undefined;
	if (Array.isArray(rawItems)) {
		const parsed: NativeKeyValueItem[] = [];
		for (const rawItem of rawItems) {
			if (rawItem === null || typeof rawItem !== "object" || Array.isArray(rawItem)) return undefined;
			const item = rawItem as { k?: unknown; v?: unknown };
			if (!Array.isArray(item.k)) return undefined;
			let key = "";
			for (const span of item.k) {
				if (span === null || typeof span !== "object" || Array.isArray(span)) return undefined;
				const part = span as { t?: unknown };
				if (typeof part.t !== "string") return undefined;
				key += part.t;
			}
			parsed.push({ key, value: item.v });
		}
		if (parsed.some(item => item.key === requiredKey)) return parsed;
	}
	return nativeKeyValueItems(node.c, requiredKey);
}

function nativeHintsJson(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const hints = nativeHintsJson(child);
			if (hints) return hints;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as NativeTreeNode;
	if (node.k === "row" && node.p?.role === "omp.overlay.hints") return JSON.stringify(value);
	return nativeHintsJson(node.c);
}

function localizedText(
	dictionary: Readonly<Record<string, string>>,
	enabled: boolean,
	key: string,
	values: Readonly<Record<string, string>> = {},
): string {
	let text = enabled ? dictionary[key] ?? key : key;
	for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, () => value);
	return text;
}

interface ProviderRegistryFixture {
	providers: readonly string[];
	authenticatedProviders?: readonly string[];
	availableModels?: readonly DisplayModel[];
	catalogModels?: readonly DisplayModel[];
	lookupModels?: readonly DisplayModel[];
	discoveryStates?: ReadonlyMap<string, ProviderDiscoveryState>;
}

function createProviderRegistry(counters: RegistryCounters, fixture: ProviderRegistryFixture): ModelHubRegistry {
	const authenticated = new Set(fixture.authenticatedProviders ?? []);
	return {
		authStorage: {
			keys: {
				source(provider) {
					return authenticated.has(provider) ? { source: "fixture" } : undefined;
				},
			},
		},
		getError() { return undefined; },
		getAvailable() { return [...(fixture.availableModels ?? [])]; },
		getAll() { return [...(fixture.catalogModels ?? [])]; },
		getDiscoverableProviders() { return [...fixture.providers]; },
		getProviderDiscoveryState(provider) { return fixture.discoveryStates?.get(provider); },
		find(provider, id) {
			return fixture.lookupModels?.find(model => model.provider === provider && model.id === id);
		},
		async refresh() { counters.refreshCalls++; },
		async refreshProvider() { counters.refreshCalls++; },
	};
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
	preparePreloadDisplayTranslations(config: typeof launch, configPath: string): Promise<void>;
};
await installedExtension.preparePreloadDisplayTranslations(launch, configPath);

const settingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", launch.host.packageDir);
const settingsModule = await import(pathToFileURL(settingsPath).href) as SettingsModuleApi;
await settingsModule.Settings.init({ cwd: probeRoot, agentDir: probeRoot, inMemory: true, readOnly: true });
const fixtureHubs: ModelHubInstance[] = [];
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
	const providerMetadataPath = Bun.resolveSync("@oh-my-pi/pi-catalog/compat/providers", launch.host.packageDir);
	const providerMetadata = await import(pathToFileURL(providerMetadataPath).href) as {
		providerEntry(provider: string): { envVars?: readonly string[] } | undefined;
	};
	const oauthPath = Bun.resolveSync("@oh-my-pi/pi-ai/oauth", launch.host.packageDir);
	const oauthModule = await import(pathToFileURL(oauthPath).href) as { getOAuthProviders(): readonly { id: string }[] };
	const oauthProviderId = oauthModule.getOAuthProviders()[0]?.id;
	if (!oauthProviderId) throw new Error("The installed host must expose an OAuth provider fixture");
	const oauthProviderIds = new Set(oauthModule.getOAuthProviders().map(provider => provider.id));
	const environmentProviderId = ["openrouter", "openai", "google", "anthropic"].find(
		provider => !oauthProviderIds.has(provider) && (providerMetadata.providerEntry(provider)?.envVars?.length ?? 0) > 0,
	);
	if (!environmentProviderId) throw new Error("The installed host must expose a non-OAuth API-key provider fixture");
	const environmentVariables = providerMetadata.providerEntry(environmentProviderId)?.envVars ?? [];

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
	function buildDisplayModel(provider: string, id: string, name: string): DisplayModel {
		return catalog.buildModel({
			id,
			name,
			api: "ollama-chat",
			provider,
			baseUrl: "http://display-only.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 1024,
		});
	}
	const model = buildDisplayModel("Models", "Roles", "Thinking");
	const compactionSettings: ModelHubSettings = {
		...settings,
		resolveRoleValue(_value, models) {
			const matchingModel = models.find(candidate => candidate.id === model.id);
			return { model: matchingModel, explicitThinkingLevel: false };
		},
	};
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
	const counters: RegistryCounters = { refreshCalls: 0, configWrites: 0, loginRequests: 0, cancelCalls: 0 };
	// All registry responses are local fixtures; every refresh is an in-memory promise, never a network call.
	const registry = createProviderRegistry(counters, { providers: ["Models"], lookupModels: [model] });
	const assignmentCaptures: { role: string; selector: string; provider: string; modelId: string }[] = [];
	function requestLogin(): void {
		counters.loginRequests++;
	}
	function cancelModelHub(): void {
		counters.cancelCalls++;
	}
	const callbacks: ModelHubCallbacks = {
		// Capture the component's selection only; this fixture callback never persists settings.
		onAssign(model, role, _level, selector) {
			assignmentCaptures.push({ role, selector, provider: model.provider, modelId: model.id });
		},
		onUnassign() { counters.configWrites++; },
		onFallbackChainChange() { counters.configWrites++; },
		onLoginRequest: requestLogin,
		onSavePreset() { counters.configWrites++; },
		onSwitchPreset() { counters.configWrites++; },
		onCycleOrderChange() { counters.configWrites++; },
		onCancel: cancelModelHub,
	};
	const compactionChangeCaptures: { modelId: string; input: string; confirmed: boolean }[] = [];
	const compactionCallbacks: ModelHubCallbacks = {
		...callbacks,
		onCompactionPointChange(model, input, confirmed) {
			compactionChangeCaptures.push({ modelId: model.id, input, confirmed });
			return undefined;
		},
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
	let nativePickerModule: { CLOSE_ACTION: NativePickerAction } | undefined;
	if (nativeAvailable) {
		// Resolve the shared action from ModelHub's installed pi-tui module instance.
		const nativePickerPath = Bun.resolveSync("@oh-my-pi/pi-tui/native/picker", launch.host.packageDir);
		nativePickerModule = await import(pathToFileURL(nativePickerPath).href) as { CLOSE_ACTION: NativePickerAction };
	}
	const title = mode === "ordinary" ? "Models" : mode === "hostile" ? hostileTitle : dictionary.Models;
	if (!title || (mode === "translated" && title === "Models")) throw new Error("The installed dictionary must translate the /model panel title");
	if (mode === "ordinary") strictEqual(title, "Models");
	if (mode === "hostile") {
		strictEqual(title, hostileTitle);
		strictEqual(Reflect.get(globalThis, "__zhompModelUiInjected"), undefined, "hostile dictionary text must not execute module code");
	}

	const allAnsi = Bun.stripANSI(modelHub.render(160).join("\n"));
	function requiredUiLabel(key: string): string {
		const label = localizedText(dictionary, translationEnabled, key);
		if (translationEnabled && label === key) throw new Error(`The installed dictionary must translate ${key}`);
		return label;
	}
	const kindHeading = requiredUiLabel("Kind:");
	const allLabel = requiredUiLabel("All");
	const kindHint = requiredUiLabel("kind");
	const searchPrompt = requiredUiLabel("Search models…");
	const allModelsLabel = requiredUiLabel("All models");
	const modelKindIds = ["all", "chat", "tiny", "image", "tts", "stt", "search", "judge", "embedding", "rerank", "video"];
	const modelKindPickerLabels = [allLabel, "Chat", "Tiny", "Image", "TTS", "STT", "Search", "Judge", "Embedding", "Rerank", "Video"];
	const roleTabIds = ["all", "chat", "kind"];
	const rolePickerTabLabels = [requiredUiLabel("All"), requiredUiLabel("Chat"), requiredUiLabel("Kinds")];
	// Tree/ANSI labels use raw lowercase IDs; the native picker uses title-cased captions.
	const roleTabLabels = translationEnabled ? rolePickerTabLabels : ["all", "chat", "kinds"];
	// Long titles are clipped by HubFrame; hostile text is also exercised in the full-width status.
	ok(allAnsi.includes(title), `${mode} ModelHub dictionary text ${JSON.stringify(title)} missing:\n${allAnsi}`);
	ok(allAnsi.includes("Models"), "the model provider value matching a dictionary key must remain unchanged");
	ok(allAnsi.includes("Roles"), "the model ID matching a dictionary key must remain unchanged");
	ok(allAnsi.includes("Thinking"), "the model name matching a Thinking UI key must remain unchanged");
	ok(allAnsi.includes(kindHeading), "the ANSI ModelHub kind heading must use the fixed UI translation");
	ok(allAnsi.includes(allLabel), "the ANSI all-kind tab must translate its display label");
	ok(allAnsi.includes(allModelsLabel), "the ANSI All models scope must use its translation");
	if (translationEnabled) {
		ok(!allAnsi.includes("Kind:"), "the ANSI ModelHub must not retain the English kind heading");
		ok(!allAnsi.includes("All models"), "the model name must not mask the translated All models scope");
	}
	assertWidth(modelHub.render(160), 160, textUtils.visibleWidth, "normal all-model view");
	assertWidth(modelHub.render(80), 80, textUtils.visibleWidth, "narrow all-model view");
	strictEqual(counters.refreshCalls, 0, "a scoped display-only model must not trigger catalog refresh");

	const allNativeValue = nativeAvailable ? materializeNative(modelHub.describe?.(pickerContext), pickerContext) : undefined;
	const allNativeTreeValue = nativeAvailable ? materializeNative(modelHub.describe?.(treeContext), treeContext) : undefined;
	const allNative = allNativeValue === undefined ? undefined : JSON.stringify(allNativeValue);
	if (allNative) {
		ok(allNative.includes(JSON.stringify(title)), "native picker description must carry the literal panel title");
		ok(allNative.includes("Models/Roles"), "native model selector values must remain unchanged");
		const props = nativePickerProps(allNativeValue);
		strictEqual(props?.placeholder, searchPrompt, "native picker must translate the fixed search prompt");
		const pickerTabs = nativePickerTabs(allNativeValue, modelKindIds);
		if (!pickerTabs) throw new Error("The native model-kind picker tabs are missing");
		deepStrictEqual(pickerTabs.map(tab => tab.id), modelKindIds, "native picker must preserve all model-kind IDs");
		deepStrictEqual(pickerTabs.map(tab => tab.label), modelKindPickerLabels, "native picker must translate only the all-kind display label");
	}
	if (nativeAvailable) {
		if (allNativeTreeValue === undefined) throw new Error("The native ModelHub tree description is missing");
		const treeText = JSON.stringify(allNativeTreeValue);
		if (treeText === undefined) throw new Error("The native ModelHub tree description cannot be serialized");
		ok(treeText.includes(JSON.stringify(kindHeading)), "native tree must translate the fixed ModelHub kind heading");
		if (translationEnabled) ok(!treeText.includes(JSON.stringify("Kind:")), "native tree must not retain the English kind heading");
		const treeTabs = nativeTabs(allNativeTreeValue, modelKindIds);
		if (!treeTabs) throw new Error("The native ModelHub kind tabs are missing");
		deepStrictEqual(treeTabs.map(tab => tab.id), modelKindIds, "native tree must preserve all model-kind IDs");
		deepStrictEqual(treeTabs.map(tab => tab.label), [translationEnabled ? allLabel : "all", ...modelKindIds.slice(1)], "native tree must translate only the all-kind label");
		const hints = nativeHintsJson(allNativeTreeValue);
		if (!hints) throw new Error("The native ModelHub footer hints are missing");
		ok(hints.includes(JSON.stringify(kindHint)), "native kind hint must use the fixed UI translation");
		if (translationEnabled) ok(!hints.includes(JSON.stringify("kind")), "native kind hint must not retain its English label");
	}
	const sharedCloseAction = nativePickerModule?.CLOSE_ACTION;
	const sharedCloseActionSnapshot = sharedCloseAction ? { ...sharedCloseAction, keys: [...(sharedCloseAction.keys ?? [])] } : undefined;
	const closeAction = nativePickerActions(allNativeValue)?.find(action => action.id === "close");
	if (nativeAvailable) {
		if (!closeAction || !sharedCloseAction) throw new Error("The native picker close action is missing");
		strictEqual(closeAction.label, requiredUiLabel("Close"), "ModelHub must translate its cloned close action");
		strictEqual(closeAction.id, sharedCloseAction.id, "translated close action must retain the shared action ID");
		deepStrictEqual(closeAction.keys, sharedCloseAction.keys, "translated close action must retain its shortcut");
		strictEqual(closeAction.end, sharedCloseAction.end, "translated close action must retain its end placement");
		strictEqual(sharedCloseAction.label, "Close", "ModelHub must not mutate the shared picker close action");
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
	for (const label of roleTabLabels) ok(roleAnsi.includes(label), `the ANSI Roles tabs must display ${label}`);
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
		ok(allAnsi.includes(kindHint), "the ANSI kind hint must use the fixed UI translation");
		if (translationEnabled) ok(!allAnsi.includes("kind ·"), "the ANSI kind hint must not retain its English label");
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
		const treeRoleTabs = nativeTabs(movedRoleNative, roleTabIds);
		const pickerRoleTabs = nativePickerTabs(movedRolePicker, roleTabIds);
		if (!treeRoleTabs || !pickerRoleTabs) throw new Error("The native Roles tabs are missing");
		deepStrictEqual(treeRoleTabs.map(tab => tab.id), roleTabIds, "native tree must preserve role-tab IDs");
		deepStrictEqual(treeRoleTabs.map(tab => tab.label), roleTabLabels, "native tree must translate role-tab captions only");
		deepStrictEqual(pickerRoleTabs.map(tab => tab.id), roleTabIds, "native picker must preserve role-tab IDs");
		deepStrictEqual(pickerRoleTabs.map(tab => tab.label), rolePickerTabLabels, "native picker must translate role-tab captions only");
		const roleGroups = nativePickerGroups(movedRolePicker);
		if (!roleGroups) throw new Error("The native Roles picker groups are missing");
		strictEqual(roleGroups.find(group => group.group === "chat")?.label, requiredUiLabel("Chat roles"));
		strictEqual(roleGroups.find(group => group.group === "kind")?.label, requiredUiLabel("Kind roles"));
		if (translationEnabled) {
			ok(!encodedRolePicker.includes(JSON.stringify("Chat roles")), "native group headers must not retain Chat roles");
			ok(!encodedRolePicker.includes(JSON.stringify("Kind roles")), "native group headers must not retain Kind roles");
		}
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
	if (translationEnabled && nativeAvailable) {
		const compactionHub = new modelHubModule.ModelHubComponent(
			fakeTui,
			compactionSettings,
			registry,
			[{ model }],
			compactionCallbacks,
			{ currentSelector: "Models/Roles" },
		);
		compactionHub.handleInput("\x1b[A");
		compactionHub.handleInput("\r");
		const roleAnsi = Bun.stripANSI(compactionHub.render(160).join("\n"));
		const roleNativeTree = JSON.stringify(materializeNative(compactionHub.describe?.(treeContext), treeContext));
		const roleNativePickerValue = materializeNative(compactionHub.describe?.(pickerContext), pickerContext);
		const roleNativePicker = JSON.stringify(roleNativePickerValue);
		const thinkingLabel = requiredUiLabel("Thinking");
		const sourceLabel = requiredUiLabel("Source");
		strictEqual(nativePickerColumnHead(roleNativePickerValue, "thinking"), thinkingLabel, "the role Thinking column head must translate");
		const roleSummary = nativeKeyValueItems(roleNativePickerValue, sourceLabel);
		if (!roleSummary) throw new Error("The native role preview key/value data is missing");
		ok(roleSummary.some(item => item.key === thinkingLabel), "the native role preview must translate the Thinking label");
		strictEqual(roleSummary.find(item => item.key === sourceLabel)?.value, "auto-selected", "the native role source enum value must remain unchanged");
		strictEqual(roleSummary.find(item => item.key === requiredUiLabel("Role"))?.value, "Default", "the native role name must remain unchanged");
		const compactionHint = dictionary["compaction limit"];
		const compactionAction = dictionary["Compaction limit"];
		if (!compactionHint || compactionHint === "compaction limit") throw new Error("The compaction hint dictionary entry is missing");
		if (!compactionAction || compactionAction === "Compaction limit") throw new Error("The compaction action dictionary entry is missing");
		ok(roleAnsi.includes(compactionHint), "the ANSI Roles footer must translate the compaction limit hint");
		ok(roleNativeTree.includes(compactionHint), "the native Roles footer must translate the compaction limit hint");
		ok(roleNativePicker.includes(compactionAction), "the native Roles picker must translate the compaction action");

		compactionHub.handleInput("k");
		const stripAnsi = Bun.stripANSI(compactionHub.render(160).join("\n"));
		const stripNativeTree = JSON.stringify(materializeNative(compactionHub.describe?.(treeContext), treeContext));
		const stripNativePicker = JSON.stringify(materializeNative(compactionHub.describe?.(pickerContext), pickerContext));
		const modelLimit = dictionary["limit:"];
		const pickerLimit = dictionary[" limit "];
		const inputHint = dictionary["400k base · f400k fixed · 80% · empty resets"];
		const footerAction = dictionary["set compaction point"];
		const pickerAction = dictionary["Set compaction point"];
		if (!modelLimit || modelLimit === "limit:") throw new Error("The model compaction label dictionary entry is missing");
		if (!pickerLimit || pickerLimit === " limit ") throw new Error("The native compaction label dictionary entry is missing");
		if (!inputHint || inputHint === "400k base · f400k fixed · 80% · empty resets") throw new Error("The compaction input hint dictionary entry is missing");
		if (!footerAction || footerAction === "set compaction point") throw new Error("The compaction footer action dictionary entry is missing");
		if (!pickerAction || pickerAction === "Set compaction point") throw new Error("The native compaction action dictionary entry is missing");
		ok(stripAnsi.includes(`Roles ${modelLimit}`), "the ANSI compaction label must preserve the model ID and translate only its label");
		ok(stripAnsi.includes(inputHint), "the ANSI compaction input hint must translate");

		// HubFrame replaces the ANSI footer hint with the active strip; native descriptions retain the action hint.
		ok(stripNativeTree.includes(inputHint), "the native tree compaction input hint must translate");
		ok(stripNativeTree.includes(footerAction), "the native tree compaction action must translate");
		ok(stripNativePicker.includes("Roles"), "the native compaction strip must preserve the model ID");
		ok(stripNativePicker.includes(pickerLimit), "the native compaction strip must translate its fixed label");
		ok(stripNativePicker.includes(inputHint), "the native picker compaction input hint must translate");
		ok(stripNativePicker.includes(pickerAction), "the native picker compaction action must translate");
		deepStrictEqual(compactionChangeCaptures, [], "opening the display-only compaction strip must not persist a change");
		compactionHub.dispose();
	}
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

	const cycleSettings: ModelHubSettings = { ...settings, cycleOrder: ["default", "smol"] };
	const cycleHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		cycleSettings,
		registry,
		[{ model }],
		callbacks,
		{ currentSelector: "Models/Roles" },
	);
	fixtureHubs.push(cycleHub);
	cycleHub.handleInput("\x1b[A");
	cycleHub.handleInput("\r");
	const cycleAnsi = Bun.stripANSI(cycleHub.render(160).join("\n"));
	const cyclePickerValue = nativeAvailable ? materializeNative(cycleHub.describe?.(pickerContext), pickerContext) : undefined;
	const cycleTreeValue = nativeAvailable ? materializeNative(cycleHub.describe?.(treeContext), treeContext) : undefined;
	const cyclePickerText = JSON.stringify(cyclePickerValue);
	const cycleLabel = requiredUiLabel("cycle:");
	ok(cycleAnsi.includes(cycleLabel), "the ANSI quick-switch hint must translate its fixed label");
	if (translationEnabled) ok(!cycleAnsi.includes("cycle:"), "the ANSI quick-switch hint must not retain cycle:");
	if (nativeAvailable) {
		const cycleBadge = localizedText(dictionary, translationEnabled, "cycle {count}", { count: "1" });
		const cycleTitle = localizedText(dictionary, translationEnabled, "Stop {count} of the quick-switch cycle", { count: "1" });
		ok(cyclePickerText.includes(cycleBadge), "the native quick-switch cycle badge must translate its count label");
		ok(cyclePickerText.includes(cycleTitle), "the native quick-switch cycle title must translate its fixed wording");
		ok(cyclePickerText.includes("role:default") && cyclePickerText.includes("role:smol"), "cycle badges must preserve role IDs");
		const cycleHints = nativeHintsJson(cycleTreeValue);
		if (!cycleHints) throw new Error("The native Roles cycle hints are missing");
		ok(cycleHints.includes(JSON.stringify(requiredUiLabel("cycle"))), "the native quick-switch hint must translate its fixed label");
	}

	const overflowTui = { terminal: { rows: 8 }, requestRender() {} };
	const overflowHub = new modelHubModule.ModelHubComponent(
		overflowTui,
		settings,
		registry,
		[{ model }],
		callbacks,
		{ currentSelector: "Models/Roles" },
	);
	fixtureHubs.push(overflowHub);
	overflowHub.handleInput("\x1b[A");
	overflowHub.handleInput("\r");
	const overflowAnsi = Bun.stripANSI(overflowHub.render(160).join("\n"));
	const belowCount = /↓[^\d\n]*(\d+)/.exec(overflowAnsi)?.[1];
	if (!belowCount) throw new Error("The constrained Roles view must expose hidden rows below");
	ok(overflowAnsi.includes(`↓ ${localizedText(dictionary, translationEnabled, "{count} more", { count: belowCount })}`), "the role overflow count label must translate while preserving its count");
	for (let step = 0; step < 12; step++) overflowHub.handleInput("\x1b[B");
	const scrolledOverflowAnsi = Bun.stripANSI(overflowHub.render(160).join("\n"));
	const aboveCount = /↑[^\d\n]*(\d+)/.exec(scrolledOverflowAnsi)?.[1];
	const scrolledBelowCount = /↓[^\d\n]*(\d+)/.exec(scrolledOverflowAnsi)?.[1];
	if (!aboveCount || !scrolledBelowCount) throw new Error("Scrolling Roles must expose hidden rows above and below");
	ok(scrolledOverflowAnsi.includes(`↑ ${localizedText(dictionary, translationEnabled, "{count} more", { count: aboveCount })}`), "the hidden-above count must translate and remain intact");
	ok(scrolledOverflowAnsi.includes(`↓ ${localizedText(dictionary, translationEnabled, "{count} more", { count: scrolledBelowCount })}`), "the hidden-below count must translate and remain intact");

	const diagnosticProviderId = "diagnostic-provider";
	const ageStamp = Date.now() + 60_000;
	const ageText = "less than a minute ago";
	const providerStateCases: readonly { state: ProviderDiscoveryState; key: string; values?: Readonly<Record<string, string>> }[] = [
		{ state: { optional: false, status: "idle" }, key: "Provider has not been refreshed yet." },
		{ state: { optional: false, status: "unauthenticated" }, key: "Provider requires authentication before models can be discovered." },
		{ state: { optional: false, status: "empty" }, key: "Discovery succeeded but returned 0 models. Check that /models returns { data: [{ id }] }." },
		{ state: { optional: false, status: "cached", fetchedAt: ageStamp }, key: "Using cached model list from {age}. Live refresh is still pending.", values: { age: ageText } },
		{ state: { optional: false, status: "cached" }, key: "Using cached model list. Live refresh is still pending." },
		{ state: { optional: false, status: "unavailable", fetchedAt: ageStamp }, key: "Provider unavailable. Using cached model list from {age}.", values: { age: ageText } },
		{ state: { optional: false, status: "unavailable" }, key: "Provider unavailable." },
	];
	function assertProviderState(fixture: { state: ProviderDiscoveryState; key: string; values?: Readonly<Record<string, string>> }): void {
		if (translationEnabled) requiredUiLabel(fixture.key);
		const stateRegistry = createProviderRegistry(counters, {
			providers: [diagnosticProviderId],
			authenticatedProviders: [diagnosticProviderId],
			discoveryStates: new Map([[diagnosticProviderId, fixture.state]]),
		});
		const hub = new modelHubModule.ModelHubComponent(
			fakeTui,
			settings,
			stateRegistry,
			[],
			callbacks,
			{ initialProviderId: diagnosticProviderId },
		);
		fixtureHubs.push(hub);
		const values = fixture.values ?? {};
		const expected = localizedText(dictionary, translationEnabled, fixture.key, values);
		const original = localizedText(dictionary, false, fixture.key, values);
		const ansi = Bun.stripANSI(hub.render(160).join("\n"));
		ok(ansi.includes(expected), `the real ANSI provider state must display ${expected}`);
		if (translationEnabled) ok(!ansi.includes(original), `the real ANSI provider state must not leave ${original} in English`);
		if (nativeAvailable) {
			const tree = JSON.stringify(materializeNative(hub.describe?.(treeContext), treeContext));
			const picker = JSON.stringify(materializeNative(hub.describe?.(pickerContext), pickerContext));
			ok(tree.includes(expected), `the native provider state must display ${expected}`);
			ok(picker.includes(expected), `the native picker provider state must display ${expected}`);
			if (translationEnabled) {
				ok(!tree.includes(original), `the native provider state must not leave ${original} in English`);
				ok(!picker.includes(original), `the native picker provider state must not leave ${original} in English`);
			}
		}
	}
	for (const fixture of providerStateCases) assertProviderState(fixture);

	const refreshingRegistry = createProviderRegistry(counters, {
		providers: [diagnosticProviderId],
		authenticatedProviders: [diagnosticProviderId],
		discoveryStates: new Map([[diagnosticProviderId, { optional: false, status: "idle" }]]),
	});
	const refreshingHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		settings,
		refreshingRegistry,
		[],
		callbacks,
		{ initialProviderId: diagnosticProviderId },
	);
	fixtureHubs.push(refreshingHub);
	const refreshingLabel = requiredUiLabel("refreshing model list…");
	const refreshingAnsi = Bun.stripANSI(refreshingHub.render(160).join("\n"));
	ok(refreshingAnsi.includes(`${diagnosticProviderId} · ${refreshingLabel}`), "the provider refresh status must translate its fixed suffix");
	if (nativeAvailable) {
		const refreshingTree = JSON.stringify(materializeNative(refreshingHub.describe?.(treeContext), treeContext));
		const refreshingPicker = JSON.stringify(materializeNative(refreshingHub.describe?.(pickerContext), pickerContext));
		ok(refreshingTree.includes(`${diagnosticProviderId} · ${refreshingLabel}`), "the native provider refresh status must translate its fixed suffix");
		ok(refreshingPicker.includes(`${diagnosticProviderId} · ${refreshingLabel}`), "the native picker refresh subtitle must translate its fixed suffix");
	}

	const endpoint = "https://diagnostic.invalid/models";
	for (const [error, expected] of [
		[`HTTP 404 from ${endpoint}`, `Discovery endpoint ${endpoint} returned 404. Point baseUrl at the host that serves /models (usually .../v1).`],
		["ECONNREFUSED diagnostic.invalid", "Discovery failed: ECONNREFUSED diagnostic.invalid"],
	] as const) {
		const errorRegistry = createProviderRegistry(counters, {
			providers: [diagnosticProviderId],
			authenticatedProviders: [diagnosticProviderId],
			discoveryStates: new Map([[diagnosticProviderId, { optional: false, status: "unavailable", error }]]),
		});
		const errorHub = new modelHubModule.ModelHubComponent(
			fakeTui,
			settings,
			errorRegistry,
			[],
			callbacks,
			{ initialProviderId: diagnosticProviderId },
		);
		fixtureHubs.push(errorHub);
		// This diagnostic exceeds the 160-column content pane; inspect it without UI clipping.
		ok(Bun.stripANSI(errorHub.render(320).join("\n")).includes(expected), "provider endpoint diagnostics must remain unchanged");
		if (nativeAvailable) {
			const tree = JSON.stringify(materializeNative(errorHub.describe?.(treeContext), treeContext));
			const picker = JSON.stringify(materializeNative(errorHub.describe?.(pickerContext), pickerContext));
			ok(tree.includes(expected), "native provider endpoint diagnostics must remain unchanged");
			ok(picker.includes(expected), "native picker endpoint diagnostics must remain unchanged");
		}
	}

	const lockedProviderId = "not configured";
	const lockedModel = buildDisplayModel(lockedProviderId, "refreshing model list…", "Thinking");
	const lockedRegistry = createProviderRegistry(counters, {
		providers: [lockedProviderId],
		catalogModels: [lockedModel],
		discoveryStates: new Map([[lockedProviderId, { optional: false, status: "idle" }]]),
	});
	const lockedHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		settings,
		lockedRegistry,
		[],
		callbacks,
		{ initialProviderId: lockedProviderId },
	);
	fixtureHubs.push(lockedHub);
	const lockedAnsi = Bun.stripANSI(lockedHub.render(160).join("\n"));
	const configuredLabel = requiredUiLabel("not configured");
	const credentialsText = localizedText(dictionary, translationEnabled, "{provider} has no credentials configured", { provider: lockedProviderId });
	const apiKeyText = requiredUiLabel("Add an API key for this provider in config.");
	const signInText = requiredUiLabel("Add an API key in config to sign in");
	const signedOutText = requiredUiLabel("Not signed in");
	const catalogAnsiCount = localizedText(dictionary, translationEnabled, "{count} models in catalog:", { count: "1" });
	const catalogNativeCount = localizedText(dictionary, translationEnabled, "{count} models in catalog", { count: "1" });
	ok(lockedAnsi.includes(`${lockedProviderId} · ${configuredLabel}`), "the locked provider status must translate its generic suffix without changing the provider ID");
	ok(lockedAnsi.includes(credentialsText), "the locked provider credentials line must translate only its generic wording");
	ok(lockedAnsi.includes(apiKeyText), "the API-key setup instruction must translate");
	ok(lockedAnsi.includes(catalogAnsiCount), "the ANSI catalog count must translate while preserving its count and colon");
	ok(lockedAnsi.includes(lockedModel.id), "the locked provider catalog model ID must remain unchanged");
	if (nativeAvailable) {
		const lockedTree = JSON.stringify(materializeNative(lockedHub.describe?.(treeContext), treeContext));
		const lockedPickerValue = materializeNative(lockedHub.describe?.(pickerContext), pickerContext);
		const lockedPicker = JSON.stringify(lockedPickerValue);
		ok(lockedTree.includes(credentialsText) && lockedPicker.includes(credentialsText), "native signed-out provider copy must translate its fixed prose");
		ok(lockedTree.includes(apiKeyText) && lockedPicker.includes(apiKeyText), "native API-key setup copy must translate");
		ok(lockedTree.includes(catalogNativeCount) && lockedPicker.includes(catalogNativeCount), "native catalog counts must translate without changing their counts");
		ok(lockedTree.includes(lockedModel.id) && lockedPicker.includes(lockedModel.id), "native locked catalog model IDs must remain unchanged");
		const lockedScope = nativePickerScopes(lockedPickerValue)?.find(scope => scope.id === `provider:${lockedProviderId}`);
		if (!lockedScope) throw new Error("The locked provider scope is missing from the native picker");
		strictEqual(lockedScope.label, lockedProviderId, "provider names must remain runtime data");
		strictEqual(lockedScope.group, signedOutText, "the signed-out scope group must translate");
		strictEqual(lockedScope.disabled, signInText, "the API-key sign-in action hint must translate");
	}

	const environmentModel = buildDisplayModel(environmentProviderId, "Thinking", "Private Label");
	const environmentRegistry = createProviderRegistry(counters, {
		providers: [environmentProviderId],
		catalogModels: [environmentModel],
		discoveryStates: new Map([[environmentProviderId, { optional: false, status: "idle" }]]),
	});
	const environmentHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		settings,
		environmentRegistry,
		[],
		callbacks,
		{ initialProviderId: environmentProviderId },
	);
	fixtureHubs.push(environmentHub);
	const environmentAnsi = Bun.stripANSI(environmentHub.render(160).join("\n"));
	const environmentValues = environmentVariables.join(" or ");
	const environmentSetupText = localizedText(dictionary, translationEnabled, "Set {envVars} in your environment, or add a key in config.", { envVars: environmentValues });
	const environmentSignInText = localizedText(dictionary, translationEnabled, "Set {envVars} to sign in", { envVars: environmentValues });
	ok(environmentAnsi.includes(environmentSetupText), "the ANSI environment setup instruction must translate without changing variable names");
	for (const name of environmentVariables) ok(environmentAnsi.includes(name), `environment variable ${name} must remain unchanged`);
	if (nativeAvailable) {
		const environmentTree = JSON.stringify(materializeNative(environmentHub.describe?.(treeContext), treeContext));
		const environmentPickerValue = materializeNative(environmentHub.describe?.(pickerContext), pickerContext);
		const environmentPicker = JSON.stringify(environmentPickerValue);
		ok(environmentTree.includes(environmentSetupText) && environmentPicker.includes(environmentSetupText), "native environment setup copy must translate");
		for (const name of environmentVariables) {
			ok(environmentTree.includes(name) && environmentPicker.includes(name), `native environment variable ${name} must remain unchanged`);
		}
		const environmentScope = nativePickerScopes(environmentPickerValue)?.find(scope => scope.id === `provider:${environmentProviderId}`);
		if (!environmentScope) throw new Error("The API-key provider scope is missing from the native picker");
		strictEqual(environmentScope.label, environmentProviderId, "API-key provider IDs must remain unchanged");
		strictEqual(environmentScope.disabled, environmentSignInText, "the environment-variable sign-in hint must translate without changing variable names");
	}

	const oauthModel = buildDisplayModel(oauthProviderId, "Roles", "Private Label");
	const oauthRegistry = createProviderRegistry(counters, {
		providers: [oauthProviderId],
		catalogModels: [oauthModel],
		discoveryStates: new Map([[oauthProviderId, { optional: false, status: "idle" }]]),
	});
	const oauthHub = new modelHubModule.ModelHubComponent(
		fakeTui,
		settings,
		oauthRegistry,
		[],
		callbacks,
		{ initialProviderId: oauthProviderId },
	);
	fixtureHubs.push(oauthHub);
	const oauthAnsi = Bun.stripANSI(oauthHub.render(160).join("\n"));
	const oauthInstructions = requiredUiLabel("Log in with OAuth");
	ok(oauthAnsi.includes(oauthInstructions), "the ANSI OAuth login action must translate");
	if (nativeAvailable) {
		const oauthTree = JSON.stringify(materializeNative(oauthHub.describe?.(treeContext), treeContext));
		const oauthPickerValue = materializeNative(oauthHub.describe?.(pickerContext), pickerContext);
		const oauthPicker = JSON.stringify(oauthPickerValue);
		ok(oauthTree.includes(oauthInstructions), "the native OAuth login action must translate");
		const oauthScope = nativePickerScopes(oauthPickerValue)?.find(scope => scope.id === `provider:${oauthProviderId}`);
		if (!oauthScope) throw new Error("The OAuth provider scope is missing from the native picker");
		strictEqual(oauthScope.label, oauthProviderId, "OAuth provider IDs must remain unchanged");
		strictEqual(oauthScope.group, signedOutText, "the OAuth scope group must translate");
		strictEqual(oauthScope.disabled, requiredUiLabel("Sign in with /login"), "the OAuth sign-in hint must translate");
		const loginAction = nativePickerActions(oauthPickerValue)?.find(action => action.id === "login");
		if (!loginAction) throw new Error("The OAuth login action is missing from the native picker");
		strictEqual(loginAction.label, requiredUiLabel("Log in"), "the native login action label must translate");
		deepStrictEqual(loginAction.keys, ["enter"], "the native login action shortcut must remain unchanged");
		strictEqual(callbacks.onLoginRequest, requestLogin, "ModelHub must preserve the supplied login callback identity");
		if (!oauthHub.handleNativeEvent) throw new Error("The native ModelHub event route is missing");
		oauthHub.handleNativeEvent({ type: "action", key: "login", act: loginAction.id, mods: [] });
		strictEqual(counters.loginRequests, 1, "the native login action must dispatch through the supplied callback");
	}

	if (nativeAvailable) {
		if (!closeAction || !modelHub.handleNativeEvent || !sharedCloseAction || !sharedCloseActionSnapshot) throw new Error("The native ModelHub close route is missing");
		strictEqual(callbacks.onCancel, cancelModelHub, "ModelHub must preserve the supplied cancel callback identity");
		// The previous hub has an assignment strip; its first Close correctly dismisses that strip.
		const closeHub = new modelHubModule.ModelHubComponent(fakeTui, settings, registry, [{ model }], callbacks);
		fixtureHubs.push(closeHub);
		if (!closeHub.handleNativeEvent) throw new Error("The fresh native ModelHub close route is missing");
		closeHub.handleNativeEvent({ type: "action", key: "", act: closeAction.id, mods: [] });
		strictEqual(counters.cancelCalls, 1, "the native close action ID must dispatch through the supplied cancel callback");
		deepStrictEqual(sharedCloseAction, sharedCloseActionSnapshot, "ModelHub must leave the shared picker action unchanged");
	}
	for (const hub of fixtureHubs) hub.dispose();
	fixtureHubs.length = 0;
	const fallbackRegistry = createProviderRegistry(counters, {
		providers: [diagnosticProviderId],
		authenticatedProviders: [diagnosticProviderId],
		discoveryStates: new Map([[diagnosticProviderId, { optional: false, status: "ok" }]]),
	});
	const fallbackHub = new modelHubModule.ModelHubComponent(fakeTui, settings, fallbackRegistry, [], callbacks, { initialProviderId: diagnosticProviderId });
	fixtureHubs.push(fallbackHub);
	if (nativeAvailable) {
		const fallbackPickerValue = materializeNative(fallbackHub.describe?.(pickerContext), pickerContext);
		const fallbackEmptyKey = "No models from {provider} yet";
		requiredUiLabel(fallbackEmptyKey);
		const fallbackEmptyText = localizedText(dictionary, translationEnabled, fallbackEmptyKey, { provider: diagnosticProviderId });
		strictEqual(nativePickerProps(fallbackPickerValue)?.empty, fallbackEmptyText, "the native picker provider-empty fallback must translate without changing the provider ID");
	}
	fallbackHub.dispose();
	fixtureHubs.pop();

	const countProviderId = "not configured";
	const countModel = buildDisplayModel(countProviderId, "Roles", "Thinking");
	const countRefreshStarted = Promise.withResolvers<void>();
	const countRefreshGate = Promise.withResolvers<void>();
	const countRefreshFinished = Promise.withResolvers<void>();
	let countRefreshCompleted = false;
	let countRefreshInFlight = false;
	let countRefreshReleased = false;
	const countTui = {
		terminal: { rows: 48 },
		requestRender() {
			if (!countRefreshInFlight || !countRefreshReleased) return;
			countRefreshCompleted = true;
			countRefreshFinished.resolve();
		},
	};
	const countRegistry: ModelHubRegistry = {
		...createProviderRegistry(counters, {
			providers: [countProviderId],
			authenticatedProviders: [countProviderId],
			availableModels: [countModel],
			catalogModels: [countModel],
		}),
		async refreshProvider() {
			counters.refreshCalls++;
			countRefreshInFlight = true;
			countRefreshStarted.resolve();
			await countRefreshGate.promise;
		},
	};
	const countHub = new modelHubModule.ModelHubComponent(
		countTui,
		settings,
		countRegistry,
		[],
		callbacks,
		{ initialProviderId: countProviderId },
	);
	fixtureHubs.push(countHub);
	const refreshStartTimeout = setTimeout(() => countRefreshStarted.resolve(), 2_000);
	await countRefreshStarted.promise;
	clearTimeout(refreshStartTimeout);
	if (!countRefreshInFlight) throw new Error("The selected provider refresh did not start");
	countRefreshReleased = true;
	countRefreshGate.resolve();
	const refreshFinishTimeout = setTimeout(() => countRefreshFinished.resolve(), 2_000);
	await countRefreshFinished.promise;
	clearTimeout(refreshFinishTimeout);
	if (!countRefreshCompleted) throw new Error("The selected provider refresh did not settle");
	const countStatus = localizedText(dictionary, translationEnabled, "{count} models", { count: "1" });
	const countAnsi = Bun.stripANSI(countHub.render(160).join("\n"));
	ok(countAnsi.includes(`${countProviderId} · ${countStatus}`), "the settled provider count status must translate wording without changing provider or count");
	if (nativeAvailable) {
		const countTree = JSON.stringify(materializeNative(countHub.describe?.(treeContext), treeContext));
		const countPickerValue = materializeNative(countHub.describe?.(pickerContext), pickerContext);
		const countPickerScope = nativePickerScopes(countPickerValue)?.find(scope => scope.id === `provider:${countProviderId}`);
		ok(countTree.includes(`${countProviderId} · ${countStatus}`), "the settled native provider count must translate its wording");
		if (!countPickerScope) throw new Error("The settled provider scope is missing from the native picker");
		strictEqual(countPickerScope.label, countProviderId, "the provider count scope must preserve its ID as data");
		strictEqual(countPickerScope.count, 1, "the native provider scope must preserve its model count");
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
	for (const hub of fixtureHubs) hub.dispose();
	settingsModule.resetSettingsForTest();
}
