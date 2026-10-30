import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { parseDictionaryText } from "./dictionary-validation";
import { MENU_MODULES } from "../runtime/menu-catalog";
import { translateMenuSource } from "../runtime/menu-ui";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface SettingsApi {
	init(options: { cwd: string; agentDir: string; inMemory: true; readOnly: true }): Promise<void>;
}

interface SettingsModuleApi {
	Settings: SettingsApi;
	resetSettingsForTest(): void;
}

interface OrderedSetting {
	id: string;
	default?: unknown;
	ui?: { options?: unknown };
}

interface OrderedSettingsApi {
	orderedSettings(): readonly OrderedSetting[];
}

interface ExtensionLoaderApi {
	loadExtensions(paths: string[], cwd: string): Promise<{ errors: readonly unknown[]; extensions: readonly unknown[] }>;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

interface NativeEvent {
	type: "action" | "activate" | "select";
	key: string;
	act?: string;
	item?: string;
	mods: readonly string[];
}

interface MenuInstance {
	render(width: number): readonly string[];
	handleInput(data: string): void;
	describe?(context: NativeContext): unknown;
	handleNativeEvent?(event: NativeEvent): void;
}

interface ModelRecord {
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl: string;
	reasoning: boolean;
	input: readonly string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

interface ModelBuilderApi {
	buildModel(spec: ModelRecord): ModelRecord;
}

interface ModelPickerApi {
	ModelPickerComponent: new (
		tui: unknown,
		settings: unknown,
		registry: unknown,
		scopedModels: readonly unknown[],
		callbacks: unknown,
		options?: unknown,
	) => MenuInstance;
}

interface ThinkingMenuInstance extends Omit<MenuInstance, "handleInput"> {
	handleInput?(data: string): void;
	getSelectList?(): Pick<MenuInstance, "handleInput">;
}

interface ThinkingSelectorApi {
	ThinkingSelectorComponent: new (
		currentLevel: string | undefined,
		availableLevels: string[],
		onSelect: (level: string) => void,
		onCancel: () => void,
	) => ThinkingMenuInstance;
}

interface SessionFixture {
	path: string;
	id: string;
	cwd: string;
	title: string;
	modified: Date;
	created: Date;
	size: number;
	firstMessage: string;
	allMessagesText: string;
}

interface SessionSelectorApi {
	SessionSelectorComponent: new (
		sessions: SessionFixture[],
		onSelect: (session: SessionFixture) => void,
		onCancel: () => void,
		onExit: () => void,
		options?: unknown,
	) => MenuInstance & { dispose(): void };
}

interface TreeSelectorApi {
	TreeSelectorComponent: new (
		tree: unknown[],
		currentLeafId: string | null,
		terminalHeight: number,
		onSelect: (entryId: string, options: { summarize: boolean }) => void,
		onCancel: () => void,
	) => MenuInstance & { getTreeList(): { dispose(): void } };
}

interface OAuthProvider {
	id: string;
	name: string;
	available: boolean;
}

interface OAuthRegistryApi {
	getOAuthProviders(): readonly OAuthProvider[];
}

interface OAuthSelectorApi {
	OAuthSelectorComponent: new (
		mode: "login" | "logout",
		authStorage: { credentials: { has(providerId: string): boolean }; keys: { source(providerId: string): unknown } },
		onSelect: (providerId: string) => void,
		onCancel: () => void,
		options?: { sheet: { title: string; subtitle: string; role: string; size: "md"; leave: { id: string; label: string } } },
	) => MenuInstance & { stopValidation(): void };
}

interface SessionAccount {
	position: number;
	credentialId: number;
	accountId: string;
	email: string;
	active: boolean;
	label: string;
}

interface SessionAccountSelectorApi {
	SessionAccountSelectorComponent: new (
		providerName: string,
		accounts: readonly SessionAccount[],
		onSelect: (account: SessionAccount) => void,
		onCancel: () => void,
	) => MenuInstance;
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}

function findPickerProps(value: unknown): Record<string, unknown> | undefined {
	if (Array.isArray(value)) {
		for (const child of value) {
			const found = findPickerProps(child);
			if (found) return found;
		}
		return undefined;
	}
	if (value === null || typeof value !== "object") return undefined;
	const node = value as { k?: unknown; p?: unknown; c?: unknown };
	if (node.k === "picker" && node.p !== null && typeof node.p === "object" && !Array.isArray(node.p)) {
		return node.p as Record<string, unknown>;
	}
	return findPickerProps(node.c);
}

function optionsFor(setting: OrderedSetting): Record<string, unknown>[] {
	const options = setting.ui?.options;
	if (!Array.isArray(options)) throw new Error(`Missing setting options: ${setting.id}`);
	const parsed: Record<string, unknown>[] = [];
	for (const option of options) {
		if (option === null || typeof option !== "object" || Array.isArray(option)) {
			throw new Error(`Invalid setting option metadata: ${setting.id}`);
		}
		parsed.push(option as Record<string, unknown>);
	}
	return parsed;
}

function settingById(settings: readonly OrderedSetting[], id: string): OrderedSetting {
	const setting = settings.find(candidate => candidate.id === id);
	if (!setting) throw new Error(`Missing installed setting: ${id}`);
	return setting;
}

function menuSourceSupported(host: LaunchConfig["host"], dictionary: Readonly<Record<string, string>>, path: string): boolean {
	const module = MENU_MODULES.find(candidate => candidate.root === "tui" && candidate.path === path);
	if (!module) throw new Error(`Missing menu source adapter: ${path}`);
	const root = module.root === "tui" ? host.tuiDir : host.packageDir;
	const sourcePath = join(root, ...module.path.split("/"));
	if (!existsSync(sourcePath)) return false;
	return translateMenuSource(readFileSync(sourcePath, "utf8"), module, dictionary).supported;
}

function nativePickerProps(menu: Pick<MenuInstance, "describe">, context: NativeContext): Record<string, unknown> | undefined {
	if (typeof menu.describe !== "function") return undefined;
	return findPickerProps(menu.describe(context));
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");

const installDir = dirname(configPath);
// Absolute imports must resolve from the package selected by launch.json, not this workspace's node_modules.
const installedHost = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
// Keep provider metadata from launch.json's selected pi-ai package; it remains data, never translation input.
const oauthRegistryPath = Bun.resolveSync("@oh-my-pi/pi-ai/oauth", launch.host.packageDir);
const oauthRegistry = await import(pathToFileURL(oauthRegistryPath).href) as OAuthRegistryApi;
const oauthProviders = oauthRegistry.getOAuthProviders();
const oauthProviderIndex = oauthProviders.findIndex(provider => provider.available);
const oauthProvider = oauthProviders[oauthProviderIndex];
if (!oauthProvider) throw new Error("The installed host must expose an OAuth provider fixture");
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const hostileStatus = '会话选择"; globalThis.__zhompMenuInjected = true; // $&';
const hostileFooter = '方向键 {upDown} · {enter} 选择模型 · 输入搜索 · {close} "; globalThis.__zhompMenuInjected = true; // $&';
const footerKey = "{upDown} models · {enter} select model · type to search · {close}";
const statusKey = "Selection only — does not change the session model";
const dictionary = mode === "hostile"
	? {
		...shippedDictionary,
		[statusKey]: hostileStatus,
		[footerKey]: hostileFooter,
		High: "恶意文案-HIGH",
		[oauthProvider.id]: "恶意-provider-id",
		[oauthProvider.name]: "恶意-provider-name",
		"Probe session label": "恶意-session-title",
		"User tree title": "恶意-tree-label",
		"Probe account label": "恶意-account-label",
		high: "恶意-high",
		xhigh: "恶意-xhigh",
		default: "恶意-default",
		id: "恶意-id",
		provider: "恶意-provider",
		role: "恶意-role",
	}
	: shippedDictionary;
const dictionaryPath = mode === "hostile" ? join(probeRoot, "menu-hostile-dictionary.json") : launch.dictPath;
if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompMenuInjected?: boolean }).__zhompMenuInjected = false;

const installedExtension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
await installedExtension.preparePreloadDisplayTranslations(launch, configPath);
const settingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", launch.host.packageDir);
const settingsModule = await import(pathToFileURL(settingsPath).href) as SettingsModuleApi;
const allSettingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/all-settings", launch.host.packageDir);
const allSettingsModule = await import(pathToFileURL(allSettingsPath).href) as OrderedSettingsApi;
await settingsModule.Settings.init({ cwd: probeRoot, agentDir: probeRoot, inMemory: true, readOnly: true });

try {
	const orderedSettings = allSettingsModule.orderedSettings();
	const thinkingSetting = settingById(orderedSettings, "defaultThinkingLevel");
	const maxEffortSetting = orderedSettings.find(setting => setting.id === "providers.autoThinkingMaxEffort");
	const textVerbositySetting = settingById(orderedSettings, "textVerbosity");
	const rawHigh = optionsFor(thinkingSetting).find(option => option.value === "high");
	const rawXhigh = maxEffortSetting ? optionsFor(maxEffortSetting).find(option => option.value === "xhigh") : undefined;
	const humanHigh = optionsFor(textVerbositySetting).find(option => option.value === "high");
	if (!rawHigh || !humanHigh) throw new Error("The installed settings metadata must expose the high effort option");
	if (maxEffortSetting && !rawXhigh) throw new Error("The provider maximum setting is missing its xhigh option");
	const rawHighDescription = rawHigh.description;
	if (typeof rawHighDescription !== "string") throw new Error("The high effort option must expose its source description");
	const rawXhighDescription: string | undefined = typeof rawXhigh?.description === "string" ? rawXhigh.description : undefined;
	if (rawXhigh && rawXhighDescription === undefined) throw new Error("The xhigh option must expose its source description");
	if (mode !== "ordinary") {
		const loaderPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/extensions/loader", launch.host.packageDir);
		const loader = await import(pathToFileURL(loaderPath).href) as ExtensionLoaderApi;
		const loaded = await loader.loadExtensions([launch.extensionPath], probeRoot);
		deepStrictEqual(loaded.errors, [], "the authorized installed extension must initialize without host errors");
		strictEqual(loaded.extensions.length, 1);
	}

	const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
	const theme = await import(pathToFileURL(themePath).href) as ThemeApi;
	theme.initThemeSync("unicode");
	const modelBuilderPath = Bun.resolveSync("@oh-my-pi/pi-catalog/build", launch.host.packageDir);
	const modelBuilder = await import(pathToFileURL(modelBuilderPath).href) as ModelBuilderApi;
	const model = modelBuilder.buildModel({
		id: "id",
		name: "role",
		api: "ollama-chat",
		provider: "provider",
		baseUrl: "http://menu-probe.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	});
	const modelSettings = {
		defaultThinkingLevel: "high",
		modelProviderOrder: [model.provider],
		knownRoleIds: [],
		mruOrder: [],
		modelPerf: new Map(),
		getRoleInfo(role: string) { return { name: role, color: "muted", section: "chat" as const, accepts: () => true }; },
		getModelRole() { return undefined; },
		defaultRoleChain() { return []; },
		resolveRoleValue() { return { explicitThinkingLevel: false }; },
	};
	const modelRegistry = {
		getError() { return undefined; },
		getAvailable() { return [model]; },
		getAll() { return [model]; },
		refresh() { return Promise.resolve(); },
		refreshIfStale() { return Promise.resolve(false); },
	};
	const selector = `${model.provider}/${model.id}`;
	const selections: { model: ModelRecord; selector: string }[] = [];
	const modelPickerPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/model-picker", launch.host.packageDir);
	const modelPickerModule = await import(pathToFileURL(modelPickerPath).href) as ModelPickerApi;
	const modelPickerSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/model-picker.ts");
	const modelPickerCatalogModule = MENU_MODULES.find(module => module.root === "tui" && module.path === "src/overlays/model-picker.ts");
	if (!modelPickerCatalogModule) throw new Error("The model-picker menu source adapter is missing");
	const selectOnlyPatch = modelPickerCatalogModule.patches.find(patch => patch.before.includes("selectionOnly ?"));
	if (!selectOnlyPatch) throw new Error("The model-picker source adapter is missing its select-only marker");
	const modelPickerSource = readFileSync(join(launch.host.tuiDir, ...modelPickerCatalogModule.path.split("/")), "utf8");
	const selectionOnlyAvailable = modelPickerSource.includes(selectOnlyPatch.before);
	const modelPicker = new modelPickerModule.ModelPickerComponent(
		{ terminal: { rows: 32 }, requestRender() { throw new Error("Unexpected menu rerender"); } },
		modelSettings,
		modelRegistry,
		[{ model }],
		{
			onPick(selectedModel: ModelRecord, selectedSelector: string) { selections.push({ model: selectedModel, selector: selectedSelector }); },
			onCancel() { throw new Error("Unexpected picker cancellation"); },
		},
		{
			currentSelector: selector,
			...(selectionOnlyAvailable ? { selectOnly: true } : {}),
		},
	);
	const pickerAnsi = Bun.stripANSI(modelPicker.render(120).join("\n"));
	const pickerContext: NativeContext = {
		cols: 120,
		reduceMotion: false,
		dark: false,
		supports(kind) { return kind === "picker"; },
		feature() { return false; },
	};
	const pickerProps = nativePickerProps(modelPicker, pickerContext);
	const modelNativeTitleKey = selectionOnlyAvailable ? "Select model" : "Switch model";
	const expectedModelTitle = mode !== "ordinary" && modelPickerSupported ? dictionary[modelNativeTitleKey] : modelNativeTitleKey;
	if (pickerProps) {
		strictEqual(pickerProps.title, expectedModelTitle, "native model-picking chrome must follow source capability and authorization");
		strictEqual(pickerProps.selected, selector, "native picker selection must keep its model selector ID");
		const nativeActions = pickerProps.actions;
		if (!Array.isArray(nativeActions)) throw new Error("The native model picker did not expose actions");
		let selectAction: Record<string, unknown> | undefined;
		for (const action of nativeActions) {
			if (action !== null && typeof action === "object" && !Array.isArray(action)) {
				const candidate = action as Record<string, unknown>;
				if (candidate.id === "use") selectAction = candidate;
			}
		}
		if (!selectAction) throw new Error("The native model picker did not expose its select action");
		strictEqual(selectAction.label, expectedModelTitle);
	}
	const modelAnsiTitleKey = selectionOnlyAvailable ? "Select Model" : "Switch Model";
	const ansiModelTitleCandidates = [
		...(mode !== "ordinary" && modelPickerSupported ? [dictionary[modelAnsiTitleKey]] : []),
		modelAnsiTitleKey,
		"Switch Task Model",
	];
	const ansiModelTitle = ansiModelTitleCandidates.find(title => pickerAnsi.includes(title));
	if (!ansiModelTitle) throw new Error("The installed model picker rendered no recognized fixed heading");
	const modelPickerTitle = typeof pickerProps?.title === "string" ? pickerProps.title : ansiModelTitle;
	ok(pickerAnsi.includes(selector), "ANSI picker rows must retain the original provider/model selector");
	const pickerStatusKey = selectionOnlyAvailable ? statusKey : "Session-only switch — role models stay unchanged";
	const statusExpected = mode !== "ordinary" && modelPickerSupported ? dictionary[pickerStatusKey] : pickerStatusKey;
	ok(pickerAnsi.includes(statusExpected), `ANSI picker missed expected ${JSON.stringify(statusExpected)}; actual rendered ANSI: ${JSON.stringify(pickerAnsi)}`);
	const hostileTemplateLiteral = mode === "hostile" && modelPickerSupported && selectionOnlyAvailable &&
		pickerAnsi.includes("方向键") && pickerAnsi.includes("globalThis.__zhompMenuInjected = true; // $&");
	if (mode === "hostile") {
		strictEqual((globalThis as typeof globalThis & { __zhompMenuInjected?: boolean }).__zhompMenuInjected, false, "hostile fixed menu copy must not execute as code");
		ok(pickerAnsi.includes(model.provider) && pickerAnsi.includes(model.id) && pickerAnsi.includes(model.name), "hostile translations must not rewrite model, provider, or display data");
		if (modelPickerSupported) ok(hostileTemplateLiteral, "placeholder-bearing dictionary text must render literally with its dynamic keys");
	}
	for (const character of "provider") modelPicker.handleInput(character);
	const searchedPickerAnsi = Bun.stripANSI(modelPicker.render(120).join("\n"));
	ok(searchedPickerAnsi.includes("provider"), "ANSI search input must preserve the user's literal provider query");
	const searchedPickerProps = nativePickerProps(modelPicker, pickerContext);
	if (pickerProps && !searchedPickerProps) throw new Error("The installed picker lost its native description while searching");
	if (searchedPickerProps) strictEqual(searchedPickerProps.query, "provider", "typed search text must remain literal despite a hostile dictionary entry");
	modelPicker.handleInput("\r");
	strictEqual(selections.length, 1, "Enter must activate the selected real model row");
	strictEqual(selections[0]?.model, model, "keyboard selection must pass through the original model object");
	strictEqual(selections[0]?.selector, selector, "keyboard selection must preserve the selector callback payload");
	let nativeModelSelection = false;
	if (pickerProps && typeof modelPicker.handleNativeEvent === "function") {
		modelPicker.handleNativeEvent({ type: "action", key: "", act: "use", mods: [] });
		nativeModelSelection = true;
		strictEqual(selections.length, 2, "the native select action must activate the selected real model row");
		strictEqual(selections[1]?.selector, selector, "native selection must preserve the selector callback payload");
	}

	const sessionFixture: SessionFixture = {
		path: join(probeRoot, "menu-session.jsonl"),
		id: "probe-session-id",
		cwd: probeRoot,
		title: "Probe session label",
		modified: new Date(Date.now() - 120_000),
		created: new Date(Date.now() - 300_000),
		size: 128,
		firstMessage: "Probe session prompt",
		allMessagesText: "Probe session prompt\nProbe session response",
	};
	let selectedSession: SessionFixture | undefined;
	const sessionSelectorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/session-selector", launch.host.packageDir);
	const sessionSelectorModule = await import(pathToFileURL(sessionSelectorPath).href) as SessionSelectorApi;
	const sessionSelectorSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/session-selector.ts");
	const sessionSource = readFileSync(sessionSelectorPath, "utf8");
	const hasSessionActions = sessionSource.includes('#showRenameDialog(session: T)');
	const pinRequests: { session: SessionFixture; pinned: boolean }[] = [];
	let renameRequests = 0;
	const sessionSelector = new sessionSelectorModule.SessionSelectorComponent(
		[sessionFixture],
		session => { selectedSession = session; },
		() => { throw new Error("Unexpected session-picker cancellation"); },
		() => { throw new Error("Unexpected session-picker exit"); },
		{
			showCwd: false, scopeLabel: false,
			onRename: async (_session: SessionFixture, title: string) => { renameRequests++; return title; },
			onSetPinned: async (session: SessionFixture, pinned: boolean) => { pinRequests.push({ session, pinned }); },
		},
	);
	let sessionTitleVisible = false;
	let sessionNameVisible = false;
	const sessionTitleExpected = mode !== "ordinary" && sessionSelectorSupported ? dictionary["Resume Session"] : "Resume Session";
	let sessionNativeAvailable = false;
	try {
		const sessionAnsi = Bun.stripANSI(sessionSelector.render(120).join("\n"));
		sessionTitleVisible = sessionAnsi.includes(sessionTitleExpected);
		sessionNameVisible = sessionAnsi.includes(sessionFixture.title);
		ok(sessionTitleVisible, "the real session selector must render translated text or its English fallback");
		ok(sessionNameVisible, "the real session selector must preserve its user-provided session title");
		const sessionProps = nativePickerProps(sessionSelector, pickerContext);
		sessionNativeAvailable = sessionProps !== undefined;
		if (sessionProps && typeof sessionSelector.handleNativeEvent === "function") {
			const sessionActions = sessionProps.actions;
			if (!Array.isArray(sessionActions)) throw new Error("The native session picker did not expose actions");
			let resumeLabel: string | undefined;
			for (const action of sessionActions) {
				if (action !== null && typeof action === "object" && !Array.isArray(action)) {
					const candidate = action as Record<string, unknown>;
					if (candidate.id === "resume" && typeof candidate.label === "string") resumeLabel = candidate.label;
				}
			}
			strictEqual(resumeLabel, mode !== "ordinary" && sessionSelectorSupported ? dictionary.Resume : "Resume", "native session action label must follow source capability");
			if (hasSessionActions) {
				const label = (key: string) => mode !== "ordinary" && sessionSelectorSupported ? dictionary[key] : key;
				const actionLabel = (id: string) => sessionActions.find(action => action !== null && typeof action === "object" && "id" in action && action.id === id);
				const rename = actionLabel("rename");
				const pin = actionLabel("pin");
				ok(rename && typeof rename === "object" && "label" in rename && rename.label === label("Rename"));
				ok(pin && typeof pin === "object" && "label" in pin && pin.label === label("Pin"));
				ok(sessionAnsi.includes(label("rename")), "ANSI rename hint follows the selected dictionary");
				const bindingApi = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-tui/keybindings", launch.host.packageDir)).href) as { getKeybindings(): { getKeys(action: string): readonly string[] } };
				if (bindingApi.getKeybindings().getKeys("app.session.pin").length > 0) {
					ok(sessionAnsi.includes(label("pin")), "a bound ANSI pin hint follows the selected dictionary");
				}
				sessionSelector.handleNativeEvent({ type: "action", key: "", act: "rename", mods: [] });
				const renameAnsi = Bun.stripANSI(sessionSelector.render(180).join("\n"));
				ok(renameAnsi.includes(label("Rename Session")) && renameAnsi.includes(sessionFixture.title), "rename form translates its shell, not the existing title");
				sessionSelector.handleInput("\x1b");
				strictEqual(renameRequests, 0, "cancelling rename must not call its persistence callback");
				sessionSelector.handleNativeEvent({ type: "action", key: "", act: "pin", mods: [] });
				deepStrictEqual(pinRequests, [{ session: sessionFixture, pinned: true }], "translated Pin passes the original session and boolean");
				await Promise.resolve();
				const pinnedProps = nativePickerProps(sessionSelector, pickerContext);
				ok(pinnedProps && Array.isArray(pinnedProps.actions));
				const unpin = pinnedProps.actions.find(action => action !== null && typeof action === "object" && "id" in action && action.id === "pin");
				ok(unpin && typeof unpin === "object" && "label" in unpin && unpin.label === label("Unpin"), "canonical pin state drives translated Unpin");
			}
			if (typeof sessionProps.selected !== "string") throw new Error("The native session picker did not select its fixture row");
			sessionSelector.handleNativeEvent({ type: "select", key: "", item: sessionProps.selected, mods: [] });
			sessionSelector.handleNativeEvent({ type: "action", key: "", act: "resume", mods: [] });
		} else {
			sessionSelector.handleInput("\r");
		}
		strictEqual(selectedSession, sessionFixture, "session selection must return the original record");
	} finally {
		sessionSelector.dispose();
	}

	const treeFixture = [{
		entry: {
			id: "probe-tree-entry",
			parentId: null,
			type: "message",
			timestamp: "2026-01-03T12:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "User tree title" }] },
		},
		children: [],
		label: "User tree title",
	}];
	let selectedTreeEntry: string | undefined;
	const treeSelectorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/tree-selector", launch.host.packageDir);
	const treeSelectorModule = await import(pathToFileURL(treeSelectorPath).href) as TreeSelectorApi;
	const treeSelectorSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/tree-selector.ts");
	const treeSelector = new treeSelectorModule.TreeSelectorComponent(
		treeFixture,
		null,
		32,
		(entryId, _options) => { selectedTreeEntry = entryId; },
		() => { throw new Error("Unexpected tree-picker cancellation"); },
	);
	const treeAnsi = Bun.stripANSI(treeSelector.render(120).join("\n"));
	const treeProps = nativePickerProps(treeSelector, pickerContext);
	const treeNativeAvailable = treeProps !== undefined;
	const treeTitleExpected = mode !== "ordinary" && treeSelectorSupported ? dictionary["Session tree"] : "Session tree";
	if (treeProps) strictEqual(treeProps.title, treeTitleExpected, "native tree title must follow source capability and authorization");
	const treeAnsiTitleExpected = mode !== "ordinary" && treeSelectorSupported ? dictionary["Session Tree"] : "Session Tree";
	ok(treeAnsi.includes(treeAnsiTitleExpected), "the real session tree must render translated text or its English fallback");
	ok(treeAnsi.includes("User tree title"), `the real session tree must preserve its user-authored message/label; actual ANSI: ${JSON.stringify(treeAnsi)}`);
	const treeSearchHint = mode !== "ordinary" && treeSelectorSupported ? dictionary["Type to search"] : "Type to search";
	let treeSearchHintVisible: boolean;
	if (treeProps && typeof treeProps.placeholder === "string") {
		const treeSearchPlaceholder = mode !== "ordinary" && treeSelectorSupported ? dictionary["Search entries…"] : "Search entries…";
		strictEqual(treeProps.placeholder, treeSearchPlaceholder, "native tree search placeholder must follow source capability");
		treeSearchHintVisible = true;
	} else {
		const treeWideAnsi = Bun.stripANSI(treeSelector.render(320).join("\n"));
		treeSearchHintVisible = treeWideAnsi.includes(treeSearchHint);
		ok(treeSearchHintVisible, `tree search hint mismatch; expected ${JSON.stringify(treeSearchHint)}, actual wide ANSI: ${JSON.stringify(treeWideAnsi)}`);
	}
	if (treeProps && typeof treeSelector.handleNativeEvent === "function") {
		const treeActions = treeProps.actions;
		if (!Array.isArray(treeActions)) throw new Error("The native tree picker did not expose actions");
		let treeSwitchLabel: string | undefined;
		for (const action of treeActions) {
			if (action !== null && typeof action === "object" && !Array.isArray(action)) {
				const candidate = action as Record<string, unknown>;
				if (candidate.id === "switch" && typeof candidate.label === "string") treeSwitchLabel = candidate.label;
			}
		}
		strictEqual(treeSwitchLabel, mode !== "ordinary" && treeSelectorSupported ? dictionary.Switch : "Switch", "native tree action label must follow source capability");
		treeSelector.handleNativeEvent({ type: "activate", key: "picker", item: "probe-tree-entry", mods: [] });
	} else {
		treeSelector.handleInput("\r");
	}
	strictEqual(selectedTreeEntry, "probe-tree-entry", "tree activation must preserve the entry ID");
	treeSelector.getTreeList().dispose();

	let selectedProviderId: string | undefined;
	const oauthSelectorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/oauth-selector", launch.host.packageDir);
	const oauthSelectorModule = await import(pathToFileURL(oauthSelectorPath).href) as OAuthSelectorApi;
	const oauthSelectorSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/oauth-selector.ts");
	const oauthSelector = new oauthSelectorModule.OAuthSelectorComponent(
		"login",
		{
			credentials: { has() { return false; } },
			keys: { source() { return undefined; } },
		},
		providerId => { selectedProviderId = providerId; },
		() => { throw new Error("Unexpected OAuth-picker cancellation"); },
	);
	const oauthAnsi = Bun.stripANSI(oauthSelector.render(120).join("\n"));
	const oauthProps = nativePickerProps(oauthSelector, pickerContext);
	const oauthNativeAvailable = oauthProps !== undefined;
	const oauthAnsiTitle = mode !== "ordinary" && oauthSelectorSupported
		? dictionary["Select provider to login"]
		: "Select provider to login";
	ok(oauthAnsi.includes(oauthAnsiTitle), "the real OAuth selector must render translated text or its English fallback");
	ok(oauthAnsi.includes(oauthProvider.name), "the real OAuth selector must preserve provider display data");
	if (oauthProps && typeof oauthSelector.handleNativeEvent === "function") {
		const expectedTitle = mode !== "ordinary" && oauthSelectorSupported ? dictionary["Sign in"] : "Sign in";
		strictEqual(oauthProps.title, expectedTitle, "native OAuth title must follow source capability and authorization");
		const oauthActions = oauthProps.actions;
		if (!Array.isArray(oauthActions)) throw new Error("The native OAuth picker did not expose actions");
		const oauthAction = oauthActions.find(action => action !== null && typeof action === "object" && !Array.isArray(action) && "id" in action && action.id === "confirm");
		if (oauthAction === undefined || oauthAction === null || typeof oauthAction !== "object" || Array.isArray(oauthAction)) {
			throw new Error("The native OAuth picker lost its confirm action");
		}
		const oauthActionRecord = oauthAction as Record<string, unknown>;
		strictEqual(oauthActionRecord.label, expectedTitle, "native OAuth action label must follow source capability");
		const oauthItems = oauthProps.items;
		if (!Array.isArray(oauthItems)) throw new Error("The native OAuth picker did not expose providers");
		let oauthItem: Record<string, unknown> | undefined;
		for (const item of oauthItems) {
			if (item !== null && typeof item === "object" && !Array.isArray(item)) {
				const candidate = item as Record<string, unknown>;
				if (candidate.id === oauthProvider.id) oauthItem = candidate;
			}
		}
		if (!oauthItem) throw new Error("The native OAuth picker lost its provider ID");
		strictEqual(oauthItem.label, oauthProvider.name, "hostile translations must not rewrite provider labels");
		oauthSelector.handleNativeEvent({ type: "select", key: "picker", item: oauthProvider.id, mods: [] });
		oauthSelector.handleNativeEvent({ type: "action", key: "picker", act: "confirm", mods: [] });
	} else {
		for (let index = 0; index < oauthProviderIndex; index++) oauthSelector.handleInput("\x1b[B");
		oauthSelector.handleInput("\r");
	}
	strictEqual(selectedProviderId, oauthProvider.id, "provider selection must return the original provider ID");
	oauthSelector.stopValidation();
	if (readFileSync(oauthSelectorPath, "utf8").includes("sheet?: OAuthSelectorSheet")) {
		const sheet = { title: "Sign in", subtitle: "Pick a provider", role: "probe.custom", size: "md" as const, leave: { id: "leave", label: "Close" } };
		const custom = new oauthSelectorModule.OAuthSelectorComponent("login", {
			credentials: { has() { return false; } }, keys: { source() { return undefined; } },
		}, () => { throw new Error("Custom sheet must not authenticate"); }, () => {}, { sheet });
		try {
			const props = nativePickerProps(custom, pickerContext);
			ok(props);
			strictEqual(props.title, sheet.title, "caller-provided sheet title is not translation input");
			strictEqual(props.subtitle, sheet.subtitle, "caller-provided sheet subtitle is not translation input");
		} finally { custom.stopValidation(); }
	}

	const accountFixture: SessionAccount = {
		position: 0,
		credentialId: 1729,
		accountId: "probe-account-id",
		email: "probe@example.invalid",
		active: true,
		label: "Probe account label",
	};
	let selectedAccount: SessionAccount | undefined;
	const accountSelectorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/session-account-selector", launch.host.packageDir);
	const accountSelectorModule = await import(pathToFileURL(accountSelectorPath).href) as SessionAccountSelectorApi;
	const accountSelectorSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/session-account-selector.ts");
	const accountSelector = new accountSelectorModule.SessionAccountSelectorComponent(
		"provider",
		[accountFixture],
		account => { selectedAccount = account; },
		() => { throw new Error("Unexpected session-account-picker cancellation"); },
	);
	const accountAnsi = Bun.stripANSI(accountSelector.render(120).join("\n"));
	const accountProps = nativePickerProps(accountSelector, pickerContext);
	const accountNativeAvailable = accountProps !== undefined;
	const accountAnsiTitle = mode !== "ordinary" && accountSelectorSupported
		? dictionary["Select a {provider} account for this session"].replace("{provider}", () => "provider")
		: "Select a provider account for this session";
	ok(accountAnsi.includes(accountAnsiTitle), "the real account selector must render translated text or its English fallback");
	ok(accountAnsi.includes(accountFixture.label), "the real session-account selector must preserve its user label");
	let accountItem: Record<string, unknown> | undefined;
	const accountTitleExpected = mode !== "ordinary" && accountSelectorSupported
		? dictionary["{provider} account"].replace("{provider}", () => "provider")
		: "provider account";
	const accountTitle = typeof accountProps?.title === "string" ? accountProps.title : accountAnsiTitle;
	if (accountProps) {
		strictEqual(accountTitle, accountTitleExpected, "native account title must follow source capability and authorization");
		const accountItems = accountProps.items;
		if (!Array.isArray(accountItems)) throw new Error("The native account picker did not expose account rows");
		for (const item of accountItems) {
			if (item !== null && typeof item === "object" && !Array.isArray(item)) {
				const candidate = item as Record<string, unknown>;
				if (candidate.id === String(accountFixture.credentialId)) accountItem = candidate;
			}
		}
		if (!accountItem) throw new Error("The native account picker lost its credential ID");
		strictEqual(accountItem.label, accountFixture.label, "the session-account picker must preserve its user label");
	}
	if (accountProps && typeof accountSelector.handleNativeEvent === "function") {
		const accountActions = accountProps.actions;
		if (!Array.isArray(accountActions)) throw new Error("The native account picker did not expose actions");
		const pinAction = accountActions.find(action => action !== null && typeof action === "object" && !Array.isArray(action) && "id" in action && action.id === "confirm");
		if (pinAction === undefined || pinAction === null || typeof pinAction !== "object" || Array.isArray(pinAction)) {
			throw new Error("The native account picker lost its pin action");
		}
		const pinActionRecord = pinAction as Record<string, unknown>;
		strictEqual(pinActionRecord.label, mode !== "ordinary" && accountSelectorSupported ? dictionary.Pin : "Pin", "native account action label must follow source capability");
		accountSelector.handleNativeEvent({ type: "action", key: "picker", act: "confirm", mods: [] });
	} else {
		accountSelector.handleInput("\r");
	}
	strictEqual(selectedAccount, accountFixture, "account selection must return the original account record");
	let selectedThinking: string | undefined;
	const thinkingPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/thinking-selector", launch.host.packageDir);
	const thinkingModule = await import(pathToFileURL(thinkingPath).href) as ThinkingSelectorApi;
	const thinkingSupported = menuSourceSupported(launch.host, dictionary, "src/overlays/thinking-selector.ts");
	const thinking = new thinkingModule.ThinkingSelectorComponent(
		"low",
		["low", "high"],
		level => { selectedThinking = level; },
		() => { throw new Error("Unexpected thinking-selector cancellation"); },
	);
	const thinkingAnsi = Bun.stripANSI(thinking.render(100).join("\n"));
	const thinkingNative = nativePickerProps(thinking, pickerContext);
	const thinkingNativeAvailable = thinkingNative !== undefined;
	const thinkingTitleExpected = mode !== "ordinary" && thinkingSupported ? dictionary["Thinking level"] : "Thinking level";
	const thinkingAnsiTitle = mode !== "ordinary" && thinkingSupported ? dictionary["Thinking Level"] : "Thinking Level";
	ok(thinkingAnsi.includes(thinkingAnsiTitle), "ANSI thinking selector must render translated text or its English fallback");
	if (thinkingNative && typeof thinking.handleNativeEvent === "function") {
		strictEqual(thinkingNative.title, thinkingTitleExpected, "native thinking title must follow source capability and authorization");
		const thinkingItems = thinkingNative.items;
		if (!Array.isArray(thinkingItems)) throw new Error("The native thinking selector did not expose its value rows");
		let highItem: Record<string, unknown> | undefined;
		for (const item of thinkingItems) {
			if (item !== null && typeof item === "object" && !Array.isArray(item)) {
				const candidate = item as Record<string, unknown>;
				if (candidate.id === "high") highItem = candidate;
			}
		}
		if (!highItem) throw new Error("The native thinking selector did not expose the high effort value");
		strictEqual(highItem.label, "high", "thinking effort labels are raw values and must remain high");
		thinking.handleNativeEvent({ type: "activate", key: "picker", item: "high", mods: [] });
	} else {
		const input = typeof thinking.handleInput === "function" ? thinking : thinking.getSelectList?.();
		if (!input?.handleInput) throw new Error("The installed thinking selector exposes no keyboard input owner");
		input.handleInput("\x1b[B");
		input.handleInput("\r");
	}
	strictEqual(selectedThinking, "high", "thinking selection must preserve the high value");

	strictEqual(thinkingSetting.default, "high", "the default thinking enum value must remain high");
	if (maxEffortSetting) strictEqual(maxEffortSetting.default, "xhigh", "the provider maximum enum value must remain xhigh");
	strictEqual(rawHigh.label, "high", "a hostile dictionary must not translate the raw high option label");
	if (rawXhigh) strictEqual(rawXhigh.label, "xhigh", "a hostile dictionary must not translate the raw xhigh option label");
	strictEqual(humanHigh.label, mode === "ordinary" ? "High" : dictionary.High, "a distinct human-readable High label must remain translatable");
	const expectedHighDescription = mode === "ordinary"
		? rawHighDescription
		: dictionary[rawHighDescription] ?? rawHighDescription;
	strictEqual(rawHigh.description, expectedHighDescription, "the high effort description must match its captured source text and dictionary entry");
	if (mode !== "ordinary") {
		ok(typeof rawHigh.description === "string" && /[\u3400-\u9fff]/u.test(rawHigh.description), "high's human-readable option description must still translate");
	}
	if (rawXhigh && rawXhighDescription !== undefined) {
		const expectedXhighDescription = mode === "ordinary"
			? rawXhighDescription
			: dictionary[rawXhighDescription] ?? rawXhighDescription;
		strictEqual(rawXhigh.description, expectedXhighDescription, "the xhigh option description must match its captured source text and dictionary entry");
		if (mode !== "ordinary") {
			ok(typeof rawXhigh.description === "string" && /[\u3400-\u9fff]/u.test(rawXhigh.description), "xhigh's human-readable option description must still translate");
		}
	}
	const surface = {
		mode,
		families: ["model-picker", "thinking-selector", "settings-enum-options", "session-selector", "tree-selector", "oauth-selector", "session-account-selector"],
		picker: {
			title: modelPickerTitle,
			ansiTitle: ansiModelTitle,
			status: statusExpected,
			selector,
			searchQuery: searchedPickerProps?.query ?? null,
			searchQueryVisible: searchedPickerAnsi.includes("provider"),
			ansiHasUserLabel: pickerAnsi.includes(model.name),
			nativeAvailable: pickerProps !== undefined,
			nativeActionAvailable: pickerProps !== undefined && typeof modelPicker.handleNativeEvent === "function",
			nativeSelection: nativeModelSelection,
			nativeHasSelector: pickerProps !== undefined && pickerProps.selected === selector,
			sourceSupported: modelPickerSupported,
			selectionOnlyAvailable,
			hostileTemplateLiteral,
		},
		thinking: {
			title: typeof thinkingNative?.title === "string" ? thinkingNative.title : thinkingAnsiTitle,
			selected: selectedThinking,
			highLabel: rawHigh.label,
			xhighLabel: rawXhigh?.label ?? null,
			nativeAvailable: thinkingNativeAvailable,
			nativeActionAvailable: thinkingNative !== undefined && typeof thinking.handleNativeEvent === "function",
			sourceSupported: thinkingSupported,
		},
		settings: {
			defaultLevel: thinkingSetting.default,
			maxEffort: maxEffortSetting?.default ?? null,
			maxEffortAvailable: maxEffortSetting !== undefined,
			xhighLabel: rawXhigh?.label ?? null,
			humanHighLabel: humanHigh.label,
		},
		session: {
			title: sessionTitleExpected,
			titleVisible: sessionTitleVisible,
			nameVisible: sessionNameVisible,
			selectedId: selectedSession?.id,
			selectedName: selectedSession?.title,
			nativeAvailable: sessionNativeAvailable,
			nativeActionAvailable: sessionNativeAvailable && typeof sessionSelector.handleNativeEvent === "function",
			sourceSupported: sessionSelectorSupported,
		},
		tree: {
			title: typeof treeProps?.title === "string" ? treeProps.title : treeAnsiTitleExpected,
			selectedId: selectedTreeEntry,
			userLabelVisible: treeAnsi.includes("User tree title"),
			searchHintVisible: treeSearchHintVisible,
			nativeAvailable: treeNativeAvailable,
			nativeActionAvailable: treeNativeAvailable && typeof treeSelector.handleNativeEvent === "function",
			sourceSupported: treeSelectorSupported,
		},
		oauth: {
			title: typeof oauthProps?.title === "string" ? oauthProps.title : oauthAnsiTitle,
			providerId: selectedProviderId,
			providerName: oauthProvider.name,
			nativeAvailable: oauthNativeAvailable,
			nativeActionAvailable: oauthNativeAvailable && typeof oauthSelector.handleNativeEvent === "function",
			sourceSupported: oauthSelectorSupported,
		},
		account: {
			title: accountTitle,
			credentialId: selectedAccount?.credentialId,
			label: accountItem?.label ?? accountFixture.label,
			nativeAvailable: accountNativeAvailable,
			nativeActionAvailable: accountNativeAvailable && typeof accountSelector.handleNativeEvent === "function",
			sourceSupported: accountSelectorSupported,
		},
	};
	console.log(JSON.stringify(surface));
} finally {
	settingsModule.resetSettingsForTest();
}
