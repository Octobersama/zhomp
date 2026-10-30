import { ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORKFLOW_MENU_MODULES, WORKFLOW_MENU_TEXT_KEYS } from "../runtime/menu-workflow";
import type { MenuModule } from "../runtime/menu-catalog";

interface HostPackage {
	packageDir: string;
	tuiDir: string;
	version: string;
}

interface LaunchConfig {
	host: HostPackage;
	extensionPath: string;
	dictPath: string;
}

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface InstalledMenuApi {
	translateMenuSource(
		source: string,
		module: MenuModule,
		dictionary: Readonly<Record<string, string>>,
	): { source: string; supported: boolean };
}

interface InstalledMenuCatalogApi {
	MENU_MODULES: readonly MenuModule[];
}

interface InstalledMenuTextApi {
	MENU_TEXT_KEYS: readonly string[];
}

type SettingsInstance = object;

interface SettingsApi {
	Settings: {
		init(options: { cwd: string; agentDir: string; inMemory: true; readOnly: true }): Promise<SettingsInstance>;
	};
	resetSettingsForTest?(): void;
}

interface BranchSummarySettingApi {
	cfgBranchSummaryEnabled: {
		override(settings: SettingsInstance, value: boolean): void;
	};
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}

interface ProjectDirectoryApi {
	setProjectDir(path: string): void;
}

interface SelectorOption {
	label: string;
	displayLabel?: string;
	description?: string;
}

type SelectorOptionInput = string | SelectorOption;

interface NativeEvent {
	type: "activate" | "select";
	key: string;
	item?: string;
	mods: readonly string[];
}

interface MenuComponent {
	render(width: number): readonly string[];
	handleInput(data: string): void;
	handleNativeEvent?(event: NativeEvent): void;
	dispose?(): void;
}

interface HookSelectorOptions {
	helpText?: string;
	maxVisible?: number;
}

interface HookSelectorConstructor {
	new (
		title: string,
		options: SelectorOptionInput[],
		onSelect: (choice: string) => void,
		onCancel: () => void,
		options_?: HookSelectorOptions,
	): MenuComponent;
}

interface HookSelectorModuleApi {
	HookSelectorComponent?: HookSelectorConstructor;
	HookSelector?: HookSelectorConstructor;
}

interface SelectorCall {
	title: string;
	options: SelectorOptionInput[];
	rendered: string;
	choice: string | undefined;
	helpText?: string;
}

interface SelectorDriver {
	calls: SelectorCall[];
	showHookSelector(
		title: string,
		options: SelectorOptionInput[],
		dialogOptions?: { helpText?: string },
	): Promise<string | undefined>;
}

interface UiStub {
	requestRender(): void;
	terminal?: { rows: number };
	getFocused?(): unknown;
	setFocus?(value: unknown): void;
}

interface SeanceContext {
	sessionManager: {
		getCwd(): string;
		getSessionDir(): string;
	};
	session: { effectiveExtensionRoots: undefined };
	editor: { setText(value: string): void };
	showHookSelector: SelectorDriver["showHookSelector"];
	showModelSelector(options: unknown): void;
	showError(message: string): void;
}

interface ConfirmationContext {
	ui: UiStub & { terminal: { rows: number }; setFocus(value: unknown): void };
	hookSelector?: MenuComponent;
	editorContainer: {
		clear(): void;
		addChild(child: unknown): void;
	};
	editor: object;
}

interface ExtensionUiControllerApi {
	ExtensionUiController: new (context: ConfirmationContext) => {
		showHookConfirm(title: string, message: string): Promise<boolean>;
	};
}

interface SeanceCommandApi {
	SEANCE_SLASH_COMMAND: {
		handleTui?(
			command: { name: string; args: string; text: string },
			runtime: { ctx: SeanceContext; draftDetached: true },
		): Promise<void> | void;
	};
}

interface CleanseContext {
	ui: UiStub;
	cleanseContainer: {
		clear(): void;
		addChild(child: unknown): void;
	};
	showHookSelector: SelectorDriver["showHookSelector"];
	showHookInput(title: string, placeholder?: string): Promise<string | undefined>;
	showStatus(message: string): void;
	showError(message: string): void;
}

interface CleanseCommandApi {
	CleanseCommandController: new (ctx: CleanseContext) => {
		start(args: string): Promise<void>;
		hasActiveRun(): boolean;
	};
}

interface InputContext {
	editor: {
		insertTextAttachment(text: string, rendered?: string): void;
	};
	ui: UiStub;
	showHookSelector: SelectorDriver["showHookSelector"];
}

interface InputControllerApi {
	InputController: new (ctx: InputContext) => {
		presentLargePasteMenu(text: string, lineCount: number): Promise<void>;
	};
}

interface TreeEntry {
	id: string;
	type: "message";
	parentId: string | null;
	timestamp: string;
	message: { role: "user" | "assistant"; content: { type: "text"; text: string }[] };
}

interface TreeNode {
	entry: TreeEntry;
	children: TreeNode[];
}

interface SelectorContext {
	editor: { onEscape?: () => void };
	editorContainer: {
		children: unknown[];
		clear(): void;
		addChild(child: unknown): void;
	};
	ui: UiStub & { getFocused(): unknown; setFocus(value: unknown): void };
	sessionManager: {
		getTree(): TreeNode[];
		getLeafId(): string;
		getEntry(id: string): TreeEntry | undefined;
		getSessionName(): string;
		getSessionFile(): string | undefined;
	};
	session: {
		navigateTree(
			entryId: string,
			options: { summarize: boolean; customInstructions?: string; allowAskReopen?: boolean },
		): Promise<{ cancelled?: boolean }>;
	};
	showHookSelector: SelectorDriver["showHookSelector"];
	showHookConfirm(title: string, message: string): Promise<boolean>;
	showHookEditor(title: string): Promise<string | undefined>;
	showStatus(message: string): void;
	showError(message: string): void;
}

interface SelectorControllerApi {
	SelectorController: new (ctx: SelectorContext) => {
		showTreeSelector(): void;
		handleSessionDeleteCommand(): Promise<void>;
	};
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	const { promise, resolve } = Promise.withResolvers<T>();
	return { promise, resolve };
}

function readDictionary(path: string): Record<string, string> {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The installed dictionary must be a string map");
	}
	const values = parsed as Record<string, unknown>;
	const dictionary = Object.create(null) as Record<string, string>;
	for (const key of Object.keys(values)) {
		const value = values[key];
		if (typeof value !== "string") throw new Error(`Invalid dictionary value for ${key}`);
		dictionary[key] = value;
	}
	return dictionary;
}

function formatText(key: string, dictionary: Readonly<Record<string, string>>, values: Readonly<Record<string, string | number>> = {}): string {
	const template = dictionary[key] ?? key;
	return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
		return Object.hasOwn(values, name) ? String(values[name]) : placeholder;
	});
}

function moduleFile(host: HostPackage, module: MenuModule): string {
	const root = module.root === "tui" ? host.tuiDir : host.packageDir;
	return join(root, ...module.path.split("/"));
}

function menuModuleKey(module: Pick<MenuModule, "root" | "path">): string {
	return `${module.root}:${module.path}`;
}

function optionLabel(option: SelectorOptionInput): string {
	return typeof option === "string" ? option : option.label;
}

function optionDisplayLabel(option: SelectorOptionInput, displayAdapterActive: boolean): string {
	return typeof option === "string" || !displayAdapterActive ? optionLabel(option) : option.displayLabel ?? option.label;
}


function consumeHookSelector(
	HookSelector: HookSelectorConstructor,
	title: string,
	options: SelectorOptionInput[],
	selectedIndex: number | undefined,
	displayAdapterActive: boolean,
	helpText?: string,
): SelectorCall {
	let choice: string | undefined;
	let settled = false;
	const selector = new HookSelector(
		title,
		options,
		value => {
			choice = value;
			settled = true;
		},
		() => {
			settled = true;
		},
		{ helpText, maxVisible: 16 },
	);
	const rendered = Bun.stripANSI(selector.render(240).join("\n"));
	for (const option of options) {
		const label = optionDisplayLabel(option, displayAdapterActive);
		ok(rendered.includes(label), `the real hook selector must render ${JSON.stringify(label)} at width 240`);
	}
	if (selectedIndex === undefined) {
		selector.handleInput("\u001b");
	} else if (selector.handleNativeEvent) {
		selector.handleNativeEvent({ type: "select", key: "list", item: String(selectedIndex), mods: [] });
	} else {
		for (let index = 0; index < selectedIndex; index++) selector.handleInput("\u001b[B");
		selector.handleInput("\r");
	}
	selector.dispose?.();
	if (!settled) throw new Error("The real hook selector did not settle its selection or cancellation");
	return { title, options, rendered, choice, helpText };
}

function createSelectorDriver(
	HookSelector: HookSelectorConstructor,
	displayAdapterActive: boolean,
	selectIndex: (title: string, options: SelectorOptionInput[]) => number | undefined,
): SelectorDriver {
	const calls: SelectorCall[] = [];
	return {
		calls,
		async showHookSelector(title, options, dialogOptions) {
			const result = consumeHookSelector(
				HookSelector,
				title,
				options,
				selectIndex(title, options),
				displayAdapterActive,
				dialogOptions?.helpText,
			);
			calls.push(result);
			return result.choice;
		},
	};
}

function visibleOptionDisplay(
	call: SelectorCall,
	canonicalLabel: string,
	displayAdapterActive: boolean,
): string {
	const option = call.options.find(item => optionLabel(item) === canonicalLabel);
	if (option === undefined) throw new Error(`Missing canonical selector option ${canonicalLabel}`);
	return optionDisplayLabel(option, displayAdapterActive);
}

async function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
	const { promise: timeout, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000);
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeDir = process.env.PROBE_DIR;
if (!configPath || !probeDir) throw new Error("Missing installed launch config or probe directory");

mkdirSync(probeDir, { recursive: true });
const fixtureRoot = mkdtempSync(join(probeDir, "WorkflowMenus-"));
const previousCwd = process.cwd();
let settingsApi: SettingsApi | undefined;

let projectDirectoryApi: ProjectDirectoryApi | undefined;
try {
	process.chdir(fixtureRoot);
	const installDir = dirname(configPath);
	const installedHostPath = join(installDir, "host.ts");
	const installedHost = await import(pathToFileURL(installedHostPath).href) as InstalledHostApi;
	const launch = installedHost.readLaunchConfig(configPath);
	const shippedDictionary = readDictionary(launch.dictPath);
	const hostileDictionaryPath = join(fixtureRoot, "workflow-hostile-dictionary.json");
	const hostileCopy = (name: string): string => `恶意${name}"; globalThis.__zhompWorkflowInjected = true; // $&`;
	const dictionary = { ...shippedDictionary };
	if (mode === "hostile") {
		Object.assign(dictionary, {
			"Consult this session with": hostileCopy("咨询标题"),
			"Choose another model": hostileCopy("选择模型"),
			"Describe what to fix…": hostileCopy("自定义修复"),
			"Pasted {count} lines": `恶意粘贴 {count} 行"; globalThis.__zhompWorkflowInjected = true; // $&`,
			"Attach as a wrapped block": hostileCopy("粘贴选项"),
			"Wrap the text in <attachment> tags, collapsed to a marker": `${hostileCopy("附件说明")} <attachment>`,
			"Summarize branch?": hostileCopy("分支标题"),
			"No summary": hostileCopy("重复分支选项"),
			Summarize: hostileCopy("重复分支选项"),
			"Summarize with custom prompt": hostileCopy("自定义摘要"),
			"Delete Session": hostileCopy("删除标题"),
			Yes: hostileCopy("确认选项"),
			No: hostileCopy("确认选项"),
		});
		writeFileSync(hostileDictionaryPath, JSON.stringify(dictionary), "utf8");
	}
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
	process.env.OMP_ZH_DICT = mode === "hostile" ? hostileDictionaryPath : launch.dictPath;
	(globalThis as typeof globalThis & { __zhompWorkflowInjected?: boolean }).__zhompWorkflowInjected = false;

	const installedMenuPath = join(installDir, "menu-ui.ts");
	const installedCatalogPath = join(installDir, "menu-catalog.ts");
	const installedTextPath = join(installDir, "menu-text.ts");
	const installedMenu = await import(pathToFileURL(installedMenuPath).href) as InstalledMenuApi;
	const installedCatalog = await import(pathToFileURL(installedCatalogPath).href) as InstalledMenuCatalogApi;
	const installedText = await import(pathToFileURL(installedTextPath).href) as InstalledMenuTextApi;
	const catalogModules = installedCatalog.MENU_MODULES;
	const catalogTextKeys = new Set(installedText.MENU_TEXT_KEYS);
	for (const key of WORKFLOW_MENU_TEXT_KEYS) {
		ok(catalogTextKeys.has(key), `the installed menu text catalog must include ${key}`);
		if (mode !== "ordinary") {
			ok(typeof dictionary[key] === "string" && dictionary[key] !== key, `the installed dictionary must translate ${key}`);
		}
	}
	for (const module of WORKFLOW_MENU_MODULES) {
		strictEqual(
			catalogModules.filter(candidate => menuModuleKey(candidate) === menuModuleKey(module)).length,
			1,
			`the installed catalog must register ${menuModuleKey(module)} exactly once`,
		);
	}
	const genericSelectorMatches = catalogModules.filter(
		module => module.root === "tui" && module.path === "src/overlays/hook-selector.ts",
	);
	strictEqual(genericSelectorMatches.length, 1, "HookSelector must have exactly one canonical catalog owner");
	const genericSelectorModule = genericSelectorMatches[0];
	if (!genericSelectorModule) throw new Error("Missing installed HookSelector catalog entry");

	const supportedModules = new Set<string>();
	const unsupportedModules: string[] = [];
	const sourceRepresentatives: Readonly<Record<string, string>> = {
		"src/slash-commands/seance.ts": "Consult this session with",
		"src/modes/controllers/cleanse-command-controller.ts": "Select what to cleanse",
		"src/modes/controllers/input-controller.ts": "Pasted {count} lines",
		"src/modes/controllers/selector-controller.ts": "Summarize branch?",
		"src/modes/controllers/extension-ui-controller.ts": "Yes",
	};
	for (const module of [...WORKFLOW_MENU_MODULES, genericSelectorModule]) {
		const sourcePath = moduleFile(launch.host, module);
		if (!existsSync(sourcePath)) {
			unsupportedModules.push(module.path);
			continue;
		}
		const canonicalSourcePath = realpathSync(sourcePath);
		const source = readFileSync(canonicalSourcePath, "utf8");
		const transformed = installedMenu.translateMenuSource(source, module, dictionary);
		if (!transformed.supported) {
			unsupportedModules.push(module.path);
			continue;
		}
		supportedModules.add(module.path);
		const representative = sourceRepresentatives[module.path];
		if (mode !== "ordinary" && representative) {
			const expectedPair = JSON.stringify([representative, dictionary[representative]]);
			ok(
				transformed.source.includes(expectedPair),
				`the installed translator must include the workflow text pair for ${module.path}`,
			);
		}
	}
	if (unsupportedModules.length > 0 && launch.host.version !== "18.3.2") {
		throw new Error(`Unsupported workflow source on ${launch.host.version}: ${unsupportedModules.join(", ")}`);
	}
	const oldHostFallback = launch.host.version === "18.3.2" && unsupportedModules.length > 0;
	const genericDisplayAdapterActive = mode !== "ordinary" && supportedModules.has("src/overlays/hook-selector.ts");

	const installedExtension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
	await installedExtension.preparePreloadDisplayTranslations(launch, configPath);
	const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
	const theme = await import(pathToFileURL(themePath).href) as ThemeApi;
	theme.initThemeSync("unicode");

	const hookSelectorPath = realpathSync(moduleFile(launch.host, genericSelectorModule));
	const hookSelectorModule = await import(pathToFileURL(hookSelectorPath).href) as HookSelectorModuleApi;
	const HookSelector = hookSelectorModule.HookSelectorComponent ?? hookSelectorModule.HookSelector;
	if (!HookSelector) throw new Error("The installed host exposes no generic HookSelector component");

	const searchOptions: SelectorOptionInput[] = [
		{ label: "Canonical English search token", displayLabel: "固定显示选项" },
		...Array.from({ length: 6 }, (_unused, index) => `Noise ${index + 1}`),
	];
	let searchChoice: string | undefined;
	const searchSelector = new HookSelector(
		"Workflow selector search smoke",
		searchOptions,
		choice => { searchChoice = choice; },
		() => { throw new Error("The generic selector search smoke unexpectedly cancelled"); },
		{ maxVisible: 3 },
	);
	searchSelector.render(240);
	for (const character of "Canonical English search token") searchSelector.handleInput(character);
	const searchedRender = Bun.stripANSI(searchSelector.render(240).join("\n"));
	const expectedSearchLabel = genericDisplayAdapterActive ? "固定显示选项" : "Canonical English search token";
	ok(searchedRender.includes(expectedSearchLabel), "the real generic selector must render its scoped display label");
	if (searchSelector.handleNativeEvent) {
		searchSelector.handleNativeEvent({ type: "select", key: "list", item: "0", mods: [] });
	} else {
		searchSelector.handleInput("\r");
	}
	searchSelector.dispose?.();
	strictEqual(searchChoice, "Canonical English search token", "HookSelector search and result values must retain the canonical English label");

	if (oldHostFallback) {
		ok(
			searchSelector !== undefined,
			"the supported old host fallback must still exercise the installed generic selector interface",
		);
		console.log(JSON.stringify({
			component: "WorkflowMenus",
			mode,
			hostVersion: launch.host.version,
			fallback: { reason: "older workflow source shape", unsupportedModules, genericSelectorSmoke: true },
			consumerEvidence: { genericSelector: { canonicalSearch: searchChoice, renderedLabel: expectedSearchLabel } },
		}));
	} else {
		const settingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", launch.host.packageDir);
		settingsApi = await import(pathToFileURL(settingsPath).href) as SettingsApi;
		const settings = await settingsApi.Settings.init({ cwd: fixtureRoot, agentDir: fixtureRoot, inMemory: true, readOnly: true });
		const contextSettingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/session/context-settings", launch.host.packageDir);
		const contextSettings = await import(pathToFileURL(contextSettingsPath).href) as BranchSummarySettingApi;
		contextSettings.cfgBranchSummaryEnabled.override(settings, true);

		const translatedFor = (path: string): boolean => mode !== "ordinary" && supportedModules.has(path);
		const expectedCopy = (key: string, path: string, values: Readonly<Record<string, string | number>> = {}): string => {
			return formatText(key, translatedFor(path) ? dictionary : {}, values);
		};
		const displayCopy = (key: string, path: string, translated: string, fallback: string): string => {
			return translatedFor(path) && genericDisplayAdapterActive ? translated : fallback;
		};

		const seancePath = realpathSync(join(launch.host.packageDir, "src", "slash-commands", "seance.ts"));
		const seanceModule = await import(pathToFileURL(seancePath).href) as SeanceCommandApi;
		if (typeof seanceModule.SEANCE_SLASH_COMMAND.handleTui !== "function") {
			throw new Error("The installed seance command has no TUI handler");
		}
		const seanceDriver = createSelectorDriver(HookSelector, genericDisplayAdapterActive, (_title, options) => {
			strictEqual(_title, expectedCopy("Consult this session with", "src/slash-commands/seance.ts"));
			strictEqual(options.length, 2);
			return 1;
		});
		const seanceSessionPath = join(fixtureRoot, "workflow-seance.jsonl");
		const timestamp = new Date().toISOString();
		const seanceFixture = [
			{ type: "session", version: 3, id: "workflow-seance", timestamp, cwd: fixtureRoot },
			{
				type: "model_change",
				id: "workflow-model-change",
				parentId: null,
				timestamp,
				model: "probe-provider/probe-model",
				role: "default",
			},
		].map(entry => JSON.stringify(entry)).join("\n") + "\n";
		writeFileSync(seanceSessionPath, seanceFixture, "utf8");
		const showModelSelectorCalls: unknown[] = [];
		const seanceErrors: string[] = [];
		const seanceContext: SeanceContext = {
			sessionManager: { getCwd: () => fixtureRoot, getSessionDir: () => fixtureRoot },
			session: { effectiveExtensionRoots: undefined },
			editor: { setText: () => {} },
			showHookSelector: seanceDriver.showHookSelector,
			showModelSelector: options => { showModelSelectorCalls.push(options); },
			showError: message => { seanceErrors.push(message); },
		};
		await seanceModule.SEANCE_SLASH_COMMAND.handleTui(
			{ name: "seance", args: "workflow-seance.jsonl", text: "/seance workflow-seance.jsonl" },
			{ ctx: seanceContext, draftDetached: true },
		);
		strictEqual(seanceDriver.calls.length, 1, "seance must render its saved-model selector for the controlled session fixture");
		const seanceCall = seanceDriver.calls[0];
		if (!seanceCall) throw new Error("Missing seance selector evidence");
		strictEqual(optionLabel(seanceCall.options[0]!), "Use saved model");
		strictEqual(optionLabel(seanceCall.options[1]!), "Choose another model");
		const seanceLabels = ["Use saved model", "Choose another model"];
		const seanceDisplays = seanceLabels.map(label => expectedCopy(label, "src/slash-commands/seance.ts"));
		const seanceCollision = new Set(seanceDisplays).size !== seanceDisplays.length;
		for (let index = 0; index < seanceLabels.length; index++) {
			const label = seanceLabels[index]!;
			const expected = displayCopy(
				label,
				"src/slash-commands/seance.ts",
				seanceCollision ? label : seanceDisplays[index]!,
				label,
			);
			strictEqual(visibleOptionDisplay(seanceCall, label, genericDisplayAdapterActive), expected);
		}
		strictEqual(seanceCall.choice, "Choose another model", "the selector must return the canonical choice value");
		strictEqual(showModelSelectorCalls.length, 1, "choosing another model must open only the one-off picker");
		strictEqual(seanceErrors.length, 0, "seance must accept the isolated session fixture without error");

		const dependencyBin = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", ".bin");
		const checkerSearchPath = [dependencyBin, process.env.PATH ?? ""].filter(Boolean).join(delimiter);
		process.env.PATH = checkerSearchPath;
		Bun.env.PATH = checkerSearchPath;
		const tsconfigPath = join(fixtureRoot, "tsconfig.json");
		writeFileSync(tsconfigPath, "{}\n", "utf8");
		const sourcePath = join(fixtureRoot, "workflow-probe.ts");
		writeFileSync(sourcePath, "export const workflowProbe = true;\n", "utf8");
		const projectDirectoryPath = Bun.resolveSync("@oh-my-pi/pi-utils", launch.host.packageDir);
		projectDirectoryApi = await import(pathToFileURL(projectDirectoryPath).href) as ProjectDirectoryApi;
		projectDirectoryApi.setProjectDir(fixtureRoot);
		const cleanseModulePath = realpathSync(join(launch.host.packageDir, "src", "modes", "controllers", "cleanse-command-controller.ts"));
		const cleanseModule = await import(pathToFileURL(cleanseModulePath).href) as CleanseCommandApi;
		const cleanseDriver = createSelectorDriver(HookSelector, genericDisplayAdapterActive, (_title, options) => {
			strictEqual(_title, expectedCopy("Select what to cleanse", "src/modes/controllers/cleanse-command-controller.ts"));
			return options.length - 1;
		});
		const cleanseInputs: { title: string; placeholder: string | undefined }[] = [];
		const cleanseErrors: string[] = [];
		let cleanseRenders = 0;
		let cleanseChildren = 0;
		const cleanseContext: CleanseContext = {
			ui: { requestRender: () => { cleanseRenders++; } },
			cleanseContainer: {
				clear() { cleanseChildren = 0; },
				addChild() { cleanseChildren++; },
			},
			showHookSelector: cleanseDriver.showHookSelector,
			async showHookInput(title, placeholder) {
				cleanseInputs.push({ title, placeholder });
				return undefined;
			},
			showStatus: () => {},
			showError: message => { cleanseErrors.push(message); },
		};
		const cleanseController = new cleanseModule.CleanseCommandController(cleanseContext);
		await cleanseController.start("");
		strictEqual(cleanseDriver.calls.length, 1, "cleanse must display its checker target selector before running any checker");
		const cleanseCall = cleanseDriver.calls[0];
		if (!cleanseCall) throw new Error("Missing cleanse selector evidence");
		const allChoice = cleanseCall.options.find(option => optionLabel(option).startsWith("Run all "));
		if (!allChoice) throw new Error("The real cleanse checker selector did not expose its run-all option");
		const runAllLabel = optionLabel(allChoice);
		const runAllMatch = /^Run all (\d+) discovered checker(?:s)?$/.exec(runAllLabel);
		if (!runAllMatch) throw new Error(`Invalid canonical cleanse run-all option: ${runAllLabel}`);
		const checkerCount = Number(runAllMatch[1]);
		const runAllKey = checkerCount === 1 ? "Run all {count} discovered checker" : "Run all {count} discovered checkers";
		const expectedRunAll = expectedCopy(runAllKey, "src/modes/controllers/cleanse-command-controller.ts", { count: checkerCount });
		strictEqual(
			visibleOptionDisplay(cleanseCall, runAllLabel, genericDisplayAdapterActive),
			displayCopy(runAllLabel, "src/modes/controllers/cleanse-command-controller.ts", expectedRunAll, runAllLabel),
			"the run-all display template must preserve its checker count",
		);
		if (genericDisplayAdapterActive && translatedFor("src/modes/controllers/cleanse-command-controller.ts")) {
			if (typeof allChoice === "string") throw new Error("Translated run-all labels must retain a separate canonical choice value");
			strictEqual(allChoice.displayLabel, expectedRunAll);
		} else {
			strictEqual(typeof allChoice, "string", "ordinary mode must preserve the host's original run-all string option");
		}
		const checkerLabels = cleanseCall.options.filter((option): option is string => typeof option === "string");
		ok(checkerLabels.some(label => label.includes("tsc")), "the real cleanse discovery path must expose the controlled TypeScript checker");
		const customChoice = cleanseCall.options.at(-1);
		if (!customChoice) throw new Error("The real cleanse checker selector did not expose its custom request option");
		const customLabel = optionLabel(customChoice);
		strictEqual(customLabel, "Describe what to fix…");
		strictEqual(
			visibleOptionDisplay(cleanseCall, customLabel, genericDisplayAdapterActive),
			displayCopy(
				customLabel,
				"src/modes/controllers/cleanse-command-controller.ts",
				expectedCopy(customLabel, "src/modes/controllers/cleanse-command-controller.ts"),
				customLabel,
			),
		);
		if (genericDisplayAdapterActive && translatedFor("src/modes/controllers/cleanse-command-controller.ts")) {
			if (typeof customChoice === "string") throw new Error("Translated custom request labels must retain a separate canonical choice value");
			strictEqual(customChoice.displayLabel, expectedCopy(customLabel, "src/modes/controllers/cleanse-command-controller.ts"));
		} else {
			strictEqual(typeof customChoice, "string", "ordinary mode must preserve the host's original custom request option");
		}
		strictEqual(cleanseCall.choice, "Describe what to fix…", "the generic selector must return the canonical cleanse choice");
		strictEqual(cleanseInputs.length, 1, "the custom cleanse choice must open its request field");
		strictEqual(cleanseInputs[0]?.title, expectedCopy("Describe what to detect and fix", "src/modes/controllers/cleanse-command-controller.ts"));
		strictEqual(cleanseInputs[0]?.placeholder, expectedCopy('e.g. "ts errors"', "src/modes/controllers/cleanse-command-controller.ts"));
		strictEqual(cleanseController.hasActiveRun(), false, "cancelling the custom request must settle the cleanse run");
		strictEqual(cleanseChildren, 0, "a cancelled cleanse must remove its temporary panel");
		strictEqual(cleanseErrors.length, 0);
		ok(cleanseRenders > 0, "the real cleanse panel must use the controlled UI render seam");
		strictEqual(readFileSync(tsconfigPath, "utf8"), "{}\n", "cancelled cleanse discovery must not change fixture files");

		const inputModulePath = realpathSync(join(launch.host.packageDir, "src", "modes", "controllers", "input-controller.ts"));
		const inputModule = await import(pathToFileURL(inputModulePath).href) as InputControllerApi;
		const pasteDriver = createSelectorDriver(HookSelector, genericDisplayAdapterActive, (_title, options) => {
			strictEqual(_title, expectedCopy("Pasted {count} lines", "src/modes/controllers/input-controller.ts", { count: 3 }));
			return 0;
		});
		const pasteText = 'first line\nsecond line\nuser says "; globalThis.__zhompWorkflowInjected = true; // $&';
		const attachments: { text: string; rendered?: string }[] = [];
		let pasteRenders = 0;
		const inputController = new inputModule.InputController({
			editor: {
				insertTextAttachment(text, rendered) { attachments.push({ text, rendered }); },
			},
			ui: { requestRender: () => { pasteRenders++; } },
			showHookSelector: pasteDriver.showHookSelector,
		});
		await inputController.presentLargePasteMenu(pasteText, 3);
		strictEqual(pasteDriver.calls.length, 1);
		const pasteCall = pasteDriver.calls[0];
		if (!pasteCall) throw new Error("Missing large-paste selector evidence");
		const wrappedChoice = pasteCall.options[0];
		if (!wrappedChoice || typeof wrappedChoice === "string") throw new Error("The wrapped-paste option must remain a canonical selector object");
		strictEqual(wrappedChoice.label, "Attach as a wrapped block");
		strictEqual(
			visibleOptionDisplay(pasteCall, wrappedChoice.label, genericDisplayAdapterActive),
			displayCopy(
				wrappedChoice.label,
				"src/modes/controllers/input-controller.ts",
				expectedCopy(wrappedChoice.label, "src/modes/controllers/input-controller.ts"),
				wrappedChoice.label,
			),
		);
		strictEqual(pasteCall.choice, "Attach as a wrapped block", "the paste selector must return the canonical choice");
		ok(pasteCall.helpText?.endsWith(expectedCopy("to paste inline", "src/modes/controllers/input-controller.ts")));
		strictEqual(attachments.length, 1, "the selected safe wrapped-block action must attach only in memory");
		strictEqual(attachments[0]?.text, pasteText, "the paste payload must remain byte-for-byte user content");
		ok(attachments[0]?.rendered?.includes(pasteText), "the attachment wrapper must preserve the user payload");
		strictEqual(pasteRenders, 1);

		const selectorModulePath = realpathSync(join(launch.host.packageDir, "src", "modes", "controllers", "selector-controller.ts"));
		const selectorModule = await import(pathToFileURL(selectorModulePath).href) as SelectorControllerApi;
		const rootEntry: TreeEntry = {
			id: "workflow-root",
			type: "message",
			parentId: null,
			timestamp,
			message: { role: "user", content: [{ type: "text", text: "Workflow probe user turn" }] },
		};
		const leafEntry: TreeEntry = {
			id: "workflow-leaf",
			type: "message",
			parentId: rootEntry.id,
			timestamp,
			message: { role: "assistant", content: [{ type: "text", text: "Workflow probe assistant turn" }] },
		};
		const tree: TreeNode[] = [{ entry: rootEntry, children: [{ entry: leafEntry, children: [] }] }];
		const branchDriver = createSelectorDriver(HookSelector, genericDisplayAdapterActive, (title, options) => {
			strictEqual(title, expectedCopy("Summarize branch?", "src/modes/controllers/selector-controller.ts"));
			strictEqual(options.length, 3);
			return 0;
		});
		const navigateCalled = deferred<{ entryId: string; summarize: boolean }>();
		const branchFinished = deferred<void>();
		const editor = { onEscape: undefined as (() => void) | undefined };
		const editorChildren: unknown[] = [editor];
		let treeComponent: MenuComponent | undefined;
		const branchStatuses: string[] = [];
		const branchContext: SelectorContext = {
			editor,
			editorContainer: {
				children: editorChildren,
				clear() { editorChildren.splice(0); },
				addChild(child) {
					editorChildren.push(child);
					if (child !== editor && typeof child === "object" && child !== null && "render" in child && "handleInput" in child) {
						treeComponent = child as MenuComponent;
					}
				},
			},
			ui: {
				terminal: { rows: 40 },
				requestRender() {},
				getFocused: () => editor,
				setFocus() {},
			},
			sessionManager: {
				getTree: () => tree,
				getLeafId: () => leafEntry.id,
				getEntry: id => id === rootEntry.id ? rootEntry : id === leafEntry.id ? leafEntry : undefined,
				getSessionName: () => "Workflow probe session",
				getSessionFile: () => undefined,
			},
			session: {
				async navigateTree(entryId, options) {
					navigateCalled.resolve({ entryId, summarize: options.summarize });
					return { cancelled: true };
				},
			},
			showHookSelector: branchDriver.showHookSelector,
			async showHookConfirm() { throw new Error("Unexpected confirmation while probing branch summary"); },
			async showHookEditor() { throw new Error("Unexpected custom summary editor"); },
			showStatus(message) {
				branchStatuses.push(message);
				if (message === "Navigation cancelled") branchFinished.resolve();
			},
			showError: message => { throw new Error(`Unexpected selector error: ${message}`); },
		};
		const selectorController = new selectorModule.SelectorController(branchContext);
		selectorController.showTreeSelector();
		if (!treeComponent) throw new Error("The real session tree selector was not mounted");
		ok(Bun.stripANSI(treeComponent.render(240).join("\n")).includes("Workflow probe user turn"));
		treeComponent.handleInput("\u001b[A");
		treeComponent.handleInput("\r");
		const navigation = await waitFor(navigateCalled.promise, "cancelled branch navigation");
		const branchCall = branchDriver.calls[0];
		if (!branchCall) throw new Error("Missing branch-summary selector evidence");
		const summaryLabels = ["No summary", "Summarize", "Summarize with custom prompt"];
		const summaryTranslations = summaryLabels.map(label => expectedCopy(label, "src/modes/controllers/selector-controller.ts"));
		const summaryCollision = new Set(summaryTranslations).size !== summaryTranslations.length;
		for (let index = 0; index < summaryLabels.length; index++) {
			const label = summaryLabels[index]!;
			strictEqual(optionLabel(branchCall.options[index]!), label, "branch selector values must remain canonical");
			const expected = displayCopy(
				label,
				"src/modes/controllers/selector-controller.ts",
				summaryCollision ? label : summaryTranslations[index]!,
				label,
			);
			strictEqual(visibleOptionDisplay(branchCall, label, genericDisplayAdapterActive), expected);
		}
		strictEqual(branchCall.choice, "No summary", "the generic selector must return the canonical no-summary value");
		strictEqual(navigation.entryId, rootEntry.id);
		strictEqual(navigation.summarize, false, "the safe no-summary choice must not invoke branch summarization");
		await waitFor(branchFinished.promise, "branch navigation cancellation");
		ok(branchStatuses.includes("Navigation cancelled"));

		const deleteSessionPath = join(fixtureRoot, "workflow-delete-probe.jsonl");
		const deleteSessionContents = "controlled temporary session fixture\n";
		writeFileSync(deleteSessionPath, deleteSessionContents, "utf8");
		const deleteDriver = createSelectorDriver(HookSelector, genericDisplayAdapterActive, (_title, options) => {
			strictEqual(options.length, 2);
			return 1;
		});
		const deleteStatuses: string[] = [];
		const deleteContext: SelectorContext = {
			...branchContext,
			editorContainer: {
				children: [],
				clear() {},
				addChild() {},
			},
			sessionManager: {
				getTree: () => [],
				getLeafId: () => leafEntry.id,
				getEntry: () => undefined,
				getSessionName: () => "Workflow probe session",
				getSessionFile: () => deleteSessionPath,
			},
			showHookSelector: deleteDriver.showHookSelector,
			async showHookConfirm(title, message) {
				const answer = await deleteDriver.showHookSelector(`${title}\n${message}`, ["Yes", "No"]);
				return answer === "Yes";
			},
			showStatus(message) { deleteStatuses.push(message); },
		};
		const deleteController = new selectorModule.SelectorController(deleteContext);
		await deleteController.handleSessionDeleteCommand();
		strictEqual(deleteDriver.calls.length, 1);
		const deleteCall = deleteDriver.calls[0];
		if (!deleteCall) throw new Error("Missing delete confirmation evidence");
		const expectedDeleteTitle = expectedCopy("Delete Session", "src/modes/controllers/selector-controller.ts");
		const expectedDeleteMessage = [
			expectedCopy("This will permanently delete the current session.", "src/modes/controllers/selector-controller.ts"),
			expectedCopy("You will be returned to the session selector.", "src/modes/controllers/selector-controller.ts"),
		].join("\n");
		strictEqual(deleteCall.title, `${expectedDeleteTitle}\n${expectedDeleteMessage}`);
		strictEqual(deleteCall.choice, "No", "the confirm selector must return its canonical safe choice");
		strictEqual(readFileSync(deleteSessionPath, "utf8"), deleteSessionContents, "declining deletion must leave the session fixture untouched");
		ok(deleteStatuses.includes("Delete cancelled"));

		const confirmationPath = realpathSync(join(launch.host.packageDir, "src", "modes", "controllers", "extension-ui-controller.ts"));
		const confirmationModule = await import(pathToFileURL(confirmationPath).href) as ExtensionUiControllerApi;
		const confirmationContext: ConfirmationContext = {
			ui: {
				terminal: { rows: 40 },
				requestRender() {},
				setFocus() {},
			},
			editor: {},
		editorContainer: { clear() {}, addChild() {} },
		};
		const extensionUiController = new confirmationModule.ExtensionUiController(confirmationContext);
		const confirmTitle = "Select what to cleanse";
		const confirmMessage = "Delete Session";
		const confirmation = extensionUiController.showHookConfirm(confirmTitle, confirmMessage);
		const confirmationSelector = confirmationContext.hookSelector;
		if (!confirmationSelector) throw new Error("The real ExtensionUiController did not present its generic confirmation selector");
		const confirmationAnsi = Bun.stripANSI(confirmationSelector.render(240).join("\n"));
		const confirmLabels = ["Yes", "No"];
		const confirmTranslations = confirmLabels.map(label => expectedCopy(label, "src/modes/controllers/extension-ui-controller.ts"));
		const confirmCollision = new Set(confirmTranslations).size !== confirmTranslations.length;
		const confirmUsesDisplayLabels =
			genericDisplayAdapterActive && translatedFor("src/modes/controllers/extension-ui-controller.ts");
		const expectedConfirmLabels = confirmUsesDisplayLabels && !confirmCollision ? confirmTranslations : confirmLabels;
		for (const label of expectedConfirmLabels) ok(confirmationAnsi.includes(label), `the real confirmation selector omitted ${JSON.stringify(label)}`);
		ok(confirmationAnsi.includes(confirmTitle), "showHookConfirm must preserve its caller-supplied title");
		ok(confirmationAnsi.includes(confirmMessage), "showHookConfirm must preserve its caller-supplied message");
		if (confirmUsesDisplayLabels) {
			if (confirmCollision) {
				ok(!confirmTranslations.some(label => confirmationAnsi.includes(label)), "colliding confirmation translations must fall back to canonical labels");
			} else {
				for (const label of confirmLabels) ok(!confirmationAnsi.includes(label), "translated confirmation labels must replace only their displayed choices");
			}
		}
		confirmationSelector.handleInput("\u001b[B");
		confirmationSelector.handleInput("\r");
		const confirmed = await confirmation;
		strictEqual(confirmed, false, "selecting canonical No must resolve showHookConfirm as false");

		strictEqual(
			(globalThis as typeof globalThis & { __zhompWorkflowInjected?: boolean }).__zhompWorkflowInjected,
			false,
			"hostile display text must remain inert data",
		);
		console.log(JSON.stringify({
			component: "WorkflowMenus",
			mode,
			hostVersion: launch.host.version,
			hostSourcesSupported: [...supportedModules],
			genericDisplayAdapterActive,
			consumerEvidence: {
				seance: { renderedTitle: seanceCall.title, canonicalChoice: seanceCall.choice, oneOffPickerOpened: showModelSelectorCalls.length === 1 },
				confirmation: {
					title: confirmTitle,
					message: confirmMessage,
					labels: expectedConfirmLabels,
					confirmed,
				},
				paste: { renderedTitle: pasteCall.title, canonicalChoice: pasteCall.choice, userTextPreserved: attachments[0]?.text === pasteText, helpText: pasteCall.helpText },
				branch: { renderedTitle: branchCall.title, canonicalChoice: branchCall.choice, summarize: navigation.summarize },
				delete: { renderedTitle: deleteCall.title, canonicalChoice: deleteCall.choice, fixturePreserved: readFileSync(deleteSessionPath, "utf8") === deleteSessionContents },
				genericSelector: { canonicalSearch: searchChoice, renderedLabel: expectedSearchLabel },
			},
			hostileRenderWidth: mode === "hostile" ? 240 : undefined,
		}));
	}
} finally {
	settingsApi?.resetSettingsForTest?.();
	if (projectDirectoryApi) projectDirectoryApi.setProjectDir(previousCwd);
	else process.chdir(previousCwd);
	rmSync(fixtureRoot, { recursive: true, force: true });
}
