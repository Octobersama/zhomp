import { ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { SETUP_MENU_MODULES, SETUP_MENU_TEXT_KEYS } from "../runtime/menu-setup";
import { translateMenuSource } from "../runtime/menu-ui";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(launch: LaunchConfig, configPath: string): Promise<void>;
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

interface OverlayHandle {
	hide(): void;
}

interface SetupComponent {
	constructor: { name: string };
	render(width: number): readonly string[];
	handleInput(data: string): void;
	describe?(context?: NativeContext): unknown;
	dispose(): void;
}

interface SetupSceneController {
	title: string;
	subtitle?: string;
	render(width: number, maxLines?: number): readonly string[];
	handleInput?(data: string): void;
	describe?(context?: NativeContext): unknown;
	onMount?(): void | Promise<void>;
	dispose?(): void;
}

interface SetupSceneHost {
	ctx: Record<string, unknown>;
	requestRender(): void;
	finish(result: "done" | "skipped"): void;
	setFocus(component: unknown): void;
	restoreFocus(): void;
}

interface SetupScene {
	id: string;
	title: string;
	minVersion: number;
	ansiOnly?: boolean;
	mount(host: SetupSceneHost): SetupSceneController;
}

interface SetupWizardApi {
	ALL_SCENES?: readonly SetupScene[];
	runSetupWizard?: (
		ctx: unknown,
		scenes?: readonly SetupScene[],
		options?: { markComplete?: boolean; playWelcomeIntro?: boolean },
	) => Promise<void>;
}

interface SceneDefinition {
	id: string;
	path: string;
	exportName: string;
	titleKey: string;
	stepKey: string;
	subtitleKey?: string;
}

interface KeybindingApi {
	formatKeyHint(key: string): string;
	editorKey(key: string): string;
	editorKeys(...keys: string[]): string;
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing isolated launch config or probe directory");
const isolatedProbeRoot: string = probeRoot;
mkdirSync(probeRoot, { recursive: true });

// Resolve the host API from the isolated install selected by launch.json, not this workspace's copy.
const installedHost = await import(pathToFileURL(join(dirname(configPath), "host.ts")).href) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
process.env.PI_CODING_AGENT_DIR = probeRoot;
process.env.PI_CONFIG_DIR = join(probeRoot, "config");
process.env.OMP_PROFILE = undefined;
process.env.PI_PROFILE = undefined;

const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const probeTranslations = Object.fromEntries(SETUP_MENU_TEXT_KEYS.map(key => [key, `测试:${key}`]));
const hostileTitle = '注入";globalThis.__zhompSetupInjected=1;//$&';
const dictionary = mode === "ordinary"
	? shippedDictionary
	: { ...shippedDictionary, ...probeTranslations, ...(mode === "hostile" ? { "Choose composer shape": hostileTitle } : {}) };
const dictionaryPath = mode === "ordinary" ? launch.dictPath : join(probeRoot, `setup-${mode}-dictionary.json`);
if (mode !== "ordinary") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompSetupInjected?: number }).__zhompSetupInjected = 0;

// This installed extension is the actual preload entry selected by the launch config.
const installedExtension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
await installedExtension.preparePreloadDisplayTranslations(launch, configPath);

const sourceSupported = new Map<string, boolean>();
for (const module of SETUP_MENU_MODULES) {
	const root = module.root === "tui" ? launch.host.tuiDir : launch.host.packageDir;
	const sourcePath = join(root, ...module.path.split("/"));
	const supported = existsSync(sourcePath) && translateMenuSource(readFileSync(sourcePath, "utf8"), module, dictionary).supported;
	sourceSupported.set(module.path, supported);
}

const sceneDefinitions: readonly SceneDefinition[] = [
	{
		id: "providers",
		path: "src/setup/scenes/sign-in.ts",
		exportName: "providersSetupScene",
		titleKey: "Sign in to your providers",
		stepKey: "Sign in",
		subtitleKey: "Sign in to one or more providers. Press {cancel} when you're done.",
	},
	{
		id: "model",
		path: "src/setup/scenes/model.ts",
		exportName: "modelSetupScene",
		titleKey: "Choose your default model",
		stepKey: "Model",
		subtitleKey: "Search configured models and save the model used for new sessions.",
	},
	{
		id: "glyph-mode",
		path: "src/setup/scenes/glyph.ts",
		exportName: "glyphSetupScene",
		titleKey: "Choose glyph mode",
		stepKey: "Symbols",
		subtitleKey: "Pick the row that renders cleanly in your terminal.",
	},
	{
		id: "composer-shape",
		path: "src/setup/scenes/composer.ts",
		exportName: "composerSetupScene",
		titleKey: "Choose composer shape",
		stepKey: "Composer",
		subtitleKey: "Pick the prompt and status line layout for your workflow.",
	},
	{
		id: "theme",
		path: "src/setup/scenes/theme.ts",
		exportName: "themeSetupScene",
		titleKey: "Pick a theme",
		stepKey: "Theme",
		subtitleKey: "Move through the list to preview; {confirm} saves the highlighted choice.",
	},
];
const sceneDefinitionsByObject = new Map<SetupScene, SceneDefinition>();
const sceneDefinitionsById = new Map(sceneDefinitions.map(definition => [definition.id, definition]));
const exportedScenes: SetupScene[] = [];
for (const definition of sceneDefinitions) {
	const sourcePath = join(launch.host.tuiDir, ...definition.path.split("/"));
	// Scene modules are resolved from the selected installed pi-tui; host versions may expose different scene sets.
	if (!existsSync(sourcePath)) continue;
	const sceneModule = await import(pathToFileURL(sourcePath).href) as Record<string, unknown>;
	const scene = sceneModule[definition.exportName];
	if (scene === null || typeof scene !== "object") continue;
	sceneDefinitionsByObject.set(scene as SetupScene, definition);
	exportedScenes.push(scene as SetupScene);
}
// The selected host's wizard exports determine whether the modern component path is available.

const wizardPath = join(launch.host.tuiDir, "src/setup/wizard.ts");
const wizardApi = existsSync(wizardPath)
	? await import(pathToFileURL(wizardPath).href) as SetupWizardApi
	: undefined;
const scenes = Array.isArray(wizardApi?.ALL_SCENES) ? [...wizardApi.ALL_SCENES] : exportedScenes;
if (scenes.length === 0) throw new Error(`No real setup scene exports are available in pi-tui ${launch.host.version}`);

const themePath = join(launch.host.tuiDir, "src/theme/theme.ts");
const themeApi = await import(pathToFileURL(themePath).href) as { initThemeSync(symbolPreset?: string): void };
themeApi.initThemeSync("unicode");
// Resolve key hints from the same installed pi-tui as the scene renderers.
const keybindingPath = join(launch.host.tuiDir, "src/app-keybindings.ts");
const chromeKeybindingPath = join(launch.host.tuiDir, "src/chrome/keybinding-hints.ts");
const keybindings = existsSync(keybindingPath) && existsSync(chromeKeybindingPath)
	? {
		...await import(pathToFileURL(keybindingPath).href),
		...await import(pathToFileURL(chromeKeybindingPath).href),
	} as KeybindingApi
	: undefined;
const formatKeyHint = (key: string): string => keybindings?.formatKeyHint(key) ?? key;
const editorKey = (key: string): string => keybindings?.editorKey(key) ?? key;
const editorKeys = (...keys: string[]): string => keybindings?.editorKeys(...keys) ?? keys.join("/");
const nativeContext: NativeContext = {
	cols: 140,
	reduceMotion: false,
	dark: true,
	supports() { return true; },
	feature() { return false; },
};

function localizedText(key: string, path: string, values: Readonly<Record<string, string | number>> = {}): string {
	const translated = mode !== "ordinary" && sourceSupported.get(path) === true &&
		typeof dictionary[key] === "string" && dictionary[key]!.length > 0
		? dictionary[key]!
		: key;
	return translated.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : placeholder,
	);
}

function assertVisible(actual: string, key: string, path: string, label: string, values: Readonly<Record<string, string | number>> = {}): void {
	if (sourceSupported.get(path) !== true) return;
	const expected = localizedText(key, path, values);
	ok(actual.includes(expected), `${label} is missing ${JSON.stringify(expected)}; actual=${JSON.stringify(actual.slice(0, 1600))}`);
}

function assertNativeSetupSplashCopy(actual: string, path: string, label: string): void {
	const sourcePath = join(launch.host.tuiDir, ...path.split("/"));
	const source = readFileSync(sourcePath, "utf8");
	if (source.includes('span("Press", "muted")')) {
		assertVisible(actual, "Press", path, `${label} lead`);
		assertVisible(actual, "to begin", path, `${label} action`);
		ok(actual.includes('"role":"omp.setup.hint"'), `${label} must keep its native hint role`);
		ok(actual.includes('"keys":["enter"]'), `${label} must keep the Enter key enum`);
		return;
	}
	assertVisible(actual, "press {enter} to skip", path, label, { enter: formatKeyHint("enter") });
}

function setupOutroNativeTitleKey(path: string): "You're all set" | "Setup saved" {
	const sourcePath = join(launch.host.tuiDir, ...path.split("/"));
	return existsSync(sourcePath) && readFileSync(sourcePath, "utf8").includes('span("You\'re all set", "strong")')
		? "You're all set"
		: "Setup saved";
}

async function assertNativeOutroModelCopy(): Promise<void> {
	const path = "src/setup/scenes/outro.ts";
	if (setupOutroNativeTitleKey(path) !== "You're all set") return;
	const sourcePath = join(launch.host.tuiDir, ...path.split("/"));
	// The launch config selects pi-tui at runtime; importing the workspace copy would test the wrong host version.
	const outroModule = await import(pathToFileURL(sourcePath).href) as {
		describeSetupOutro?(model?: string): unknown;
	};
	if (!outroModule.describeSetupOutro) return;
	const actual = JSON.stringify(outroModule.describeSetupOutro("Probe model name")) ?? "";
	assertVisible(actual, "You're all set", path, "native setup outro title");
	assertVisible(actual, "Default model", path, "native setup default model label");
	ok(actual.includes("Probe model name"), "native setup outro must preserve the model display name");
}

interface Describable { describe?(context?: NativeContext): unknown }

function nativeDescription(component: Describable, useContext = true): unknown {
	function expand(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(expand);
		if (value === null || typeof value !== "object") return value;
		const record = value as Record<string, unknown>;
		if (typeof record.describe === "function" && record.k === undefined) {
			return expand((record.describe as (context?: NativeContext) => unknown).call(value, nativeContext));
		}
		if (Array.isArray(record.c)) return { ...record, c: record.c.map(expand) };
		return record;
	}
	return expand(component.describe?.(useContext ? nativeContext : undefined));
}

function nativeSnapshot(component: Describable, useContext = false): string {
	return JSON.stringify(nativeDescription(component, useContext)) ?? "";
}

function selectedListItems(component: Describable): { ids: string[]; selected: string[] } {
	const ids = new Set<string>();
	const selected = new Set<string>();
	function visit(value: unknown): void {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
			return;
		}
		if (value === null || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (record.k === "item" && typeof record.key === "string") ids.add(record.key);
		if (record.k === "list" && record.p !== null && typeof record.p === "object" && !Array.isArray(record.p)) {
			const item = (record.p as Record<string, unknown>).selected;
			if (typeof item === "string") selected.add(item);
		}
		visit(record.c);
	}
	visit(nativeDescription(component));
	return { ids: [...ids], selected: [...selected] };
}

function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

const callbackEvidence = {
	composerShapes: [] as string[],
	symbolPresets: [] as string[],
	themes: [] as string[],
	configWrites: 0,
	loginCalls: 0,
};
let capturedComponent: SetupComponent | undefined;
let overlayHides = 0;
const modelSource = {
	revision: 0,
	defaultThinkingLevel: "medium",
	modelProviderOrder: [] as string[],
	knownRoleIds: [] as string[],
	mruOrder: [] as string[],
	modelPerf: new Map<string, unknown>(),
	getModelRole() { return undefined; },
	getRoleInfo(role: string) { return { name: role, section: "chat", accepts: () => true }; },
	defaultRoleChain() { return []; },
	resolveRoleValue() { return { model: undefined, explicitThinkingLevel: false }; },
};
const context: Record<string, unknown> = {
	ui: {
		terminal: { rows: 32 },
		showOverlay(component: unknown): OverlayHandle {
			if (component === null || typeof component !== "object" ||
				typeof (component as SetupComponent).render !== "function" ||
				typeof (component as SetupComponent).handleInput !== "function") {
				throw new Error("runSetupWizard did not show its real setup component");
			}
			capturedComponent = component as SetupComponent;
			return { hide() { overlayHides += 1; } };
		},
		setFocus() {},
		requestRender() {},
		invalidate() {},
	},
	statusLine: undefined,
	composerShape: "band",
	symbolPreset: "unicode",
	colorBlindMode: false,
	disabledProviders: [],
	authStorage: { credentials: { has: () => false }, keys: { source: () => undefined } },
	modelSource,
	getModels: () => ({ available: [], all: [], current: undefined }),
	refreshModels: async () => {},
	selectModel: async () => { throw new Error("The read-only setup probe must not select or save a model"); },
	refreshProvider: async () => { callbackEvidence.loginCalls += 1; throw new Error("The setup probe must not contact a provider"); },
	saveComposerShape: async (shape: string) => { callbackEvidence.composerShapes.push(shape); },
	saveSymbolPreset: (preset: string) => { callbackEvidence.symbolPresets.push(preset); },
	saveColorBlindMode: () => {},
	saveTheme: (mode: string, name: string) => { callbackEvidence.themes.push(`${mode}:${name}`); },
	captureBrowserSession: async () => { callbackEvidence.loginCalls += 1; throw new Error("The setup probe must not start a login"); },
	copyToClipboard: async () => { callbackEvidence.loginCalls += 1; throw new Error("The setup probe must not copy login data"); },
	openInBrowser: () => { callbackEvidence.loginCalls += 1; throw new Error("The setup probe must not open a login URL"); },
	markComplete: async () => { callbackEvidence.configWrites += 1; throw new Error("The setup probe must not mark setup complete"); },
	playWelcomeIntro: () => {},
	showError: () => { throw new Error("Unexpected setup error"); },
};

const sourceCapabilities = Object.fromEntries(sourceSupported);
const allSourcesSupported = SETUP_MENU_MODULES.every(module => sourceSupported.get(module.path) === true);
const modernWizardAvailable = Array.isArray(wizardApi?.ALL_SCENES) &&
	typeof wizardApi?.runSetupWizard === "function" && allSourcesSupported;
let wizardEvidence: Record<string, string> | undefined;
let splashEvidence: Record<string, string> | undefined;
let outroEvidence: Record<string, string> | undefined;

if (modernWizardAvailable) {
	const run = wizardApi!.runSetupWizard!;
	const running = run(context, undefined, { markComplete: false, playWelcomeIntro: false });
	const component = capturedComponent;
	if (!component) throw new Error("runSetupWizard did not expose its SetupWizardComponent");
	strictEqual(component.constructor.name, "SetupWizardComponent", "the real setup component must be exercised");
	const splashAnsi = Bun.stripANSI(component.render(140).join("\n"));
	const splashNative = nativeSnapshot(component);
	assertVisible(splashAnsi, "press {enter} to skip", "src/setup/scenes/splash.ts", "ANSI setup splash", { enter: formatKeyHint("enter") });
	assertNativeSetupSplashCopy(splashNative, "src/setup/scenes/splash.ts", "native setup splash");
	component.handleInput("\r");
	await delay(450);
	const firstSceneAnsi = Bun.stripANSI(component.render(140).join("\n"));
	const firstSceneNative = nativeSnapshot(component, true);
	const footerPath = "src/setup/wizard-overlay.ts";
	const footer = localizedText("{navKeys} select · {confirm} confirm · {skip} skip · {exit} exit setup", footerPath, {
		navKeys: editorKeys("tui.select.up", "tui.select.down"),
		confirm: editorKey("tui.select.confirm"),
		skip: editorKey("tui.select.cancel"),
		exit: formatKeyHint("ctrl+c"),
	});
	assertVisible(firstSceneAnsi, "Setup step {current} of {total}", footerPath, "ANSI setup step counter", { current: 1, total: scenes.length });
	ok(firstSceneAnsi.includes(footer), "ANSI setup footer is missing its translated or English navigation labels");
	const firstScene = scenes[0];
	const firstDefinition = firstScene ? sceneDefinitionsByObject.get(firstScene) ?? sceneDefinitionsById.get(firstScene.id) : undefined;
	const hasNativeSetupStepper = firstSceneNative.includes('"omp.setup.steps"');
	if (hasNativeSetupStepper) {
		assertVisible(firstSceneNative, "Setup", footerPath, "native setup brand");
		assertVisible(firstSceneNative, "Exit setup", footerPath, "native setup exit action");
		for (const scene of scenes) {
			if (scene.ansiOnly) continue;
			const definition = sceneDefinitionsByObject.get(scene) ?? sceneDefinitionsById.get(scene.id);
			if (definition) assertVisible(firstSceneNative, definition.stepKey, footerPath, `${scene.id} native setup step label`);
		}
	} else {
		assertVisible(firstSceneNative, "Setup step {current} of {total}", footerPath, "native setup step counter", { current: 1, total: scenes.length });
	}
	if (firstDefinition) {
		assertVisible(firstSceneAnsi, firstDefinition.titleKey, firstDefinition.path, "ANSI first setup scene title");
		if (firstDefinition.subtitleKey) {
			const values: Record<string, string | number> = {};
			if (firstDefinition.id === "providers") values.cancel = editorKey("tui.select.cancel");
			assertVisible(firstSceneAnsi, firstDefinition.subtitleKey, firstDefinition.path, "ANSI first setup scene subtitle", values);
			if (hasNativeSetupStepper && firstDefinition.id === "providers") {
				assertVisible(firstSceneNative, "You can connect more than one.", firstDefinition.path, "native provider setup sheet subtitle");
			} else {
				assertVisible(firstSceneNative, firstDefinition.subtitleKey, firstDefinition.path, "native first setup scene subtitle", values);
			}
		}
	}
	wizardEvidence = { ansi: firstSceneAnsi.slice(0, 2200), native: firstSceneNative.slice(0, 2200) };
	component.handleInput("\x03");
	const outroAnsi = Bun.stripANSI(component.render(140).join("\n"));
	const outroNative = nativeSnapshot(component, true);
	assertVisible(outroAnsi, "Setup saved", "src/setup/scenes/outro.ts", "ANSI setup confirmation");
	assertVisible(outroNative, setupOutroNativeTitleKey("src/setup/scenes/outro.ts"), "src/setup/scenes/outro.ts", "native setup confirmation");
	ok(outroAnsi.includes("Handing off to the normal CLI…"), "setup progress copy must remain unchanged");
	outroEvidence = { ansi: outroAnsi.slice(0, 1400), native: outroNative.slice(0, 1400) };
	component.handleInput("\r");
	await running;
	strictEqual(overlayHides, 1, "runSetupWizard must release its real overlay");
	splashEvidence = { ansi: splashAnsi.slice(0, 1200), native: splashNative.slice(0, 1200) };
} else {
	const splashPath = join(launch.host.tuiDir, "src/setup/scenes/splash.ts");
	const outroPath = join(launch.host.tuiDir, "src/setup/scenes/outro.ts");
	if (existsSync(splashPath)) {
		const splashModule = await import(pathToFileURL(splashPath).href) as {
			renderSetupSplash(width: number, height: number, elapsedMs: number): string[];
			describeSetupSplash?(): unknown;
		};
		const ansi = Bun.stripANSI(splashModule.renderSetupSplash(140, 32, 0).join("\n"));
		const native = splashModule.describeSetupSplash
			? JSON.stringify(splashModule.describeSetupSplash()) ?? `unavailable@${launch.host.version}`
			: `unavailable@${launch.host.version}`;
		assertVisible(ansi, "press {enter} to skip", "src/setup/scenes/splash.ts", "fallback setup splash", { enter: formatKeyHint("enter") });
		assertNativeSetupSplashCopy(native, "src/setup/scenes/splash.ts", "fallback native setup splash");
		splashEvidence = { ansi: ansi.slice(0, 1200), native: native.slice(0, 1200) };
	}
	if (existsSync(outroPath)) {
		const outroModule = await import(pathToFileURL(outroPath).href) as {
			renderSetupOutro(width: number, height: number, elapsedMs: number): string[];
			describeSetupOutro?(): unknown;
		};
		const ansi = Bun.stripANSI(outroModule.renderSetupOutro(140, 32, 0).join("\n"));
		const native = outroModule.describeSetupOutro
			? JSON.stringify(outroModule.describeSetupOutro()) ?? `unavailable@${launch.host.version}`
			: `unavailable@${launch.host.version}`;
		assertVisible(ansi, "Setup saved", "src/setup/scenes/outro.ts", "fallback setup confirmation");
		assertVisible(native, setupOutroNativeTitleKey("src/setup/scenes/outro.ts"), "src/setup/scenes/outro.ts", "fallback native setup confirmation");
		outroEvidence = { ansi: ansi.slice(0, 1400), native: native.slice(0, 1400) };
	}
}
await assertNativeOutroModelCopy();

const callbacksHost: SetupSceneHost = {
	ctx: context,
	requestRender() {},
	finish() {},
	setFocus() {},
	restoreFocus() {},
};
const sceneEvidence: Record<string, unknown>[] = [];
const selectionEvidence: Record<string, { ids: string[]; selected: string[] }> = {};
let customComposerEvidence: Record<string, string> | undefined;
let themeBrowseEvidence: Record<string, string> | undefined;
const choiceIds: Readonly<Record<string, { all: readonly string[]; second: string }>> = {
	"composer-shape": { all: ["band", "box", "claude", "pi", "borderless", "rule", "field", "rail"], second: "box" },
	"glyph-mode": { all: ["nerd", "unicode", "ascii"], second: "unicode" },
	theme: { all: ["auto", "theme:titanium", "theme:light", "colorblind", "ansi", "browse"], second: "theme:titanium" },
};

async function probeCustomComposerLabel(): Promise<Record<string, string> | undefined> {
	const module = SETUP_MENU_MODULES.find(candidate => candidate.path === "src/setup/scenes/composer.ts");
	if (!module || sourceSupported.get(module.path) !== true) return undefined;
	const sourcePath = join(launch.host.tuiDir, ...module.path.split("/"));
	const translated = translateMenuSource(readFileSync(sourcePath, "utf8"), module, dictionary);
	if (!translated.supported) throw new Error("The real composer setup scene lost its supported source shape");
	const injectedChoice = translated.source.replace(
		"const choices = getComposerShapeOptions();",
		'const choices = getComposerShapeOptions().map(choice => choice.value === "box" ? { ...choice, label: "Probe custom box label", description: "Probe custom box description" } : choice);',
	);
	if (injectedChoice === translated.source) throw new Error("The composer fixture could not inject its same-ID custom label");
	const withAbsoluteImports = injectedChoice.replace(
		/(from\s+)(["'])(\.{1,2}\/[^"']+)\2/g,
		(match: string, prefix: string | undefined, _quote: string | undefined, specifier: string | undefined) => {
			if (prefix === undefined || specifier === undefined) return match;
			const path = resolve(dirname(sourcePath), specifier);
			const absolutePath = extname(path) ? path : `${path}.ts`;
			return `${prefix}"${pathToFileURL(absolutePath).href}"`;
		},
	);
	const targetPath = join(isolatedProbeRoot, `setup-custom-composer-${mode}.ts`);
	mkdirSync(dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, withAbsoluteImports, "utf8");
	// This temporary module imports source files from the selected host; its isolated path supplies the custom-label fixture.
	const customModule = await import(pathToFileURL(targetPath).href) as { composerSetupScene: SetupScene };
	const controller = customModule.composerSetupScene.mount(callbacksHost);
	controller.handleInput?.("2");
	const ansi = Bun.stripANSI(controller.render(140, 40).join("\n"));
	const native = nativeSnapshot(controller, true);
	const actual = `${ansi}\n${native}`;
	ok(actual.includes("Probe custom box label"), "custom same-ID composer labels must remain user-provided");
	ok(actual.includes("Probe custom box description"), "custom same-ID composer descriptions must remain user-provided");
	ok(!actual.includes(localizedText("Rounded Box", module.path)), "custom composer labels must not be replaced by a built-in translation");
	const selection = selectedListItems(controller);
	ok(selection.ids.includes("box") && selection.selected.includes("box"), "custom composer labels must preserve the original value ID");
	controller.dispose?.();
	return { ansi: ansi.slice(0, 1400), native: native.slice(0, 1400) };
}

async function probeCustomSetupStepLabel(): Promise<void> {
	const path = "src/setup/wizard-overlay.ts";
	if (sourceSupported.get(path) !== true) return;
	const sourcePath = join(launch.host.tuiDir, ...path.split("/"));
	if (!readFileSync(sourcePath, "utf8").includes('role: "omp.setup.steps"')) return;
	const builtInScene = scenes.find(scene => scene.id === "providers");
	if (!builtInScene) throw new Error("The setup probe needs the built-in providers scene");
	const customStep = "Probe custom sign-in step";
	const customScene = { ...builtInScene, step: customStep };
	// The selected host version is runtime-resolved; a workspace import would exercise the wrong setup component.
	const overlayModule = await import(pathToFileURL(sourcePath).href) as {
		SetupWizardComponent: new (ctx: unknown, scenes: readonly SetupScene[]) => SetupComponent;
	};
	const component = new overlayModule.SetupWizardComponent(context, [customScene]);
	try {
		component.handleInput("\r");
		const native = nativeSnapshot(component, true);
		ok(native.includes(customStep), "custom same-ID setup step labels must remain caller-provided");
	} finally {
		component.dispose();
	}
}

for (const scene of scenes) {
	const definition = sceneDefinitionsByObject.get(scene) ?? sceneDefinitionsById.get(scene.id);
	const controller = scene.mount(callbacksHost);
	await controller.onMount?.();
	const expectedChoices = choiceIds[scene.id];
	if (expectedChoices) controller.handleInput?.("2");
	const ansi = Bun.stripANSI(controller.render(140, 40).join("\n"));
	const nativeAvailable = typeof controller.describe === "function";
	const native = nativeAvailable ? nativeSnapshot(controller, true) : `unavailable@${launch.host.version}`;
	const renderedSelection = expectedChoices && nativeAvailable ? selectedListItems(controller) : undefined;
	const sourcePath = definition?.path;
	const actual = `${controller.title}\n${controller.subtitle ?? ""}\n${ansi}\n${native}`;
	if (definition && sourcePath) {
		assertVisible(actual, definition.titleKey, sourcePath, `${scene.id} title`);
		if (definition.subtitleKey) {
			const values: Record<string, string | number> = {};
			if (definition.id === "providers") values.cancel = editorKey("tui.select.cancel");
			else if (definition.id === "model") values.enter = formatKeyHint("enter");
			else if (definition.id === "composer-shape" || definition.id === "theme") values.confirm = editorKey("tui.select.confirm");
			assertVisible(actual, definition.subtitleKey, sourcePath, `${scene.id} subtitle`, values);
		}
	}
	if (definition?.id === "providers") {
		assertVisible(actual, "Pick a provider to sign in — you can connect more than one.", definition.path, "provider sign-in help");
	}
	if (definition?.id === "model") {
		assertVisible(actual, "Type to search. {enter} saves the highlighted model as your default.", definition.path, "model setup search help", { enter: formatKeyHint("enter") });
	}
	if (definition?.id === "glyph-mode") {
		for (const value of ["Nerd Font", "Unicode", "ASCII"]) ok(ansi.includes(value), `glyph technical label ${value} must remain unchanged`);
		assertVisible(actual, "If a row shows boxes, tofu, or misaligned icons, pick another.", definition.path, "glyph setup explanation");
	}
	if (definition?.id === "composer-shape") {
		const keys = [
			"Status Band (Default)",
			"Flush soft-capped status band above a curved prompt, no frame",
			"Rounded Box",
			"Status line embedded in top border, compact 2-line prompt",
			"Full-width horizontal rules above and below, status line at bottom",
			"Framed horizontal rules with status line at bottom",
			"Borderless",
			"Clean prompt glyph with status line at bottom, no box borders",
			"Top Rule Dock",
			"Single top rule with status docked onto it and below",
			"Compact Field",
			"Filled one-row field with accent end caps",
			"Accent Rail",
			"Filled one-row field anchored by a single accent rail",
			"Select a layout; live preview updates below. Press {confirm} to confirm.",
			"Preview:",
		];
		for (const key of keys) {
			const values: Record<string, string | number> = {};
			if (key.includes("{confirm}")) values.confirm = editorKey("tui.select.confirm");
			assertVisible(actual, key, definition.path, "composer setup fixed copy", values);
		}
		ok(ansi.includes("Claude Code") && ansi.includes("Pi"), "composer product labels must remain unchanged");
		customComposerEvidence = await probeCustomComposerLabel();
	}
	if (definition?.id === "theme") {
		const keys = [
			"Pick a theme",
			"Match terminal",
			"Titanium in dark terminals, Light in light terminals",
			"Default dark theme",
			"Default light theme",
			"Colorblind colors",
			"Adjust red/green contrast",
			"ANSI-safe",
			"ASCII glyphs with the dark terminal theme",
			"Browse all…",
			"Show every built-in and custom theme",
			"Theme changes preview live. Nothing is saved until you press {confirm}.",
			"{cancel} skips this step",
			"Preview",
			"Status line",
			"Editor",
		];
		for (const key of keys) {
			const values: Record<string, string | number> = {};
			if (key.includes("{confirm}")) values.confirm = editorKey("tui.select.confirm");
			else if (key.includes("{cancel}")) values.cancel = editorKey("tui.select.cancel");
			assertVisible(actual, key, definition.path, "theme setup fixed copy", values);
		}
		for (const value of ["Titanium", "Light", "success", "warning", "error", "accent"]) {
			ok(ansi.includes(value), `theme name/token ${value} must remain unchanged`);
		}
		controller.handleInput?.("6");
		controller.handleInput?.("\r");
		const browseKey = "Browsing all themes · {cancel} returns to curated choices";
		const expectedBrowseCopy = localizedText(browseKey, definition.path, { cancel: editorKey("tui.select.cancel") });
		let browseAnsi = "";
		let browseNative = "";
		for (let attempt = 0; attempt < 100; attempt++) {
			await delay(20);
			browseAnsi = Bun.stripANSI(controller.render(140, 40).join("\n"));
			browseNative = nativeSnapshot(controller, true);
			if (`${browseAnsi}\n${browseNative}`.includes(expectedBrowseCopy)) break;
		}
		assertVisible(`${browseAnsi}\n${browseNative}`, browseKey, definition.path, "browse-all theme mode copy", { cancel: editorKey("tui.select.cancel") });
		themeBrowseEvidence = { ansi: browseAnsi.slice(0, 1400), native: browseNative.slice(0, 1400) };
	}
	if (definition?.id === "model") {
		const keys = [
			"Choose your default model",
			"Search configured models and save the model used for new sessions.",
			"Type to search. {enter} saves the highlighted model as your default.",
			"Used by new sessions. Change it with /model.",
		];
		for (const key of keys) {
			const values: Record<string, string | number> = {};
			if (key.includes("{enter}")) values.enter = formatKeyHint("enter");
			assertVisible(actual, key, definition.path, "model setup fixed copy", values);
		}
	}
	if (definition?.id === "providers") {
		const keys = [
			"Sign in to your providers",
			"Sign in to one or more providers. Press {cancel} when you're done.",
			"Pick a provider to sign in — you can connect more than one.",
			"You can connect more than one.",
		];
		for (const key of keys) {
			const values: Record<string, string | number> = {};
			if (key.includes("{cancel}")) values.cancel = editorKey("tui.select.cancel");
			assertVisible(actual, key, definition.path, "provider setup fixed copy", values);
		}
	}
	if (expectedChoices && renderedSelection) {
		for (const id of expectedChoices.all) ok(renderedSelection.ids.includes(id), `${scene.id} option must retain its ${id} value ID`);
		ok(renderedSelection.selected.includes(expectedChoices.second), `${scene.id} highlighted option must retain its ${expectedChoices.second} value ID`);
		selectionEvidence[scene.id] = renderedSelection;
	}
	sceneEvidence.push({
		id: scene.id,
		title: controller.title,
		subtitle: controller.subtitle ?? "",
		ansi: ansi.slice(0, 2600),
		native: native.slice(0, 2600),
		nativeAvailable,
		sourceSupported: sourcePath ? sourceSupported.get(sourcePath) === true : false,
	});
	controller.dispose?.();
}

await probeCustomSetupStepLabel();
if (mode === "hostile") {
	const composerPath = "src/setup/scenes/composer.ts";
	if (sourceSupported.get(composerPath)) {
		const composerEvidence = sceneEvidence.find(surface => surface.id === "composer-shape");
		const visible = `${String(composerEvidence?.title ?? "")}\n${String(composerEvidence?.ansi ?? "")}`;
		ok(visible.includes(hostileTitle), "hostile setup title must remain a literal rendered string");
	}
	strictEqual((globalThis as typeof globalThis & { __zhompSetupInjected?: number }).__zhompSetupInjected, 0, "hostile setup copy must not execute as code");
}

strictEqual(callbackEvidence.configWrites, 0, "the setup probe must not commit setup state");
strictEqual(callbackEvidence.loginCalls, 0, "the setup probe must not perform login, network, or clipboard actions");
strictEqual(callbackEvidence.composerShapes.length, 0, "the setup probe must not persist composer preferences");
strictEqual(callbackEvidence.symbolPresets.length, 0, "the setup probe must not persist glyph preferences");
strictEqual(callbackEvidence.themes.length, 0, "the setup probe must not persist theme preferences");
const themeAdapter = SETUP_MENU_MODULES.find(module => module.path === "src/setup/scenes/theme.ts");
if (themeAdapter) {
	const themePatchText = themeAdapter.patches.map(patch => patch.after).join("\n");
	for (const id of ["auto", "theme:titanium", "theme:light", "colorblind", "ansi", "browse"]) {
		ok(themePatchText.includes(`value: "${id}"`), `theme menu patch must preserve option value ${id}`);
	}
}

console.log(JSON.stringify({
	component: "SetupWizard",
	mode,
	hostVersion: launch.host.version,
	renderPath: modernWizardAvailable ? "runSetupWizard" : "scene-export-fallback",
	wizardExports: {
		allScenes: Array.isArray(wizardApi?.ALL_SCENES),
		runSetupWizard: typeof wizardApi?.runSetupWizard === "function",
		count: scenes.length,
	},
	sourceCapabilities,
	splash: splashEvidence ?? null,
	wizard: wizardEvidence ?? null,
	scenes: sceneEvidence,
	customComposer: customComposerEvidence ?? null,
	outro: outroEvidence ?? null,
	themeBrowse: themeBrowseEvidence ?? null,
	selectedIds: selectionEvidence,
	readOnly: {
		configWrites: callbackEvidence.configWrites,
		loginCalls: callbackEvidence.loginCalls,
		preferenceSaves: callbackEvidence.composerShapes.length + callbackEvidence.symbolPresets.length + callbackEvidence.themes.length,
	},
}));
