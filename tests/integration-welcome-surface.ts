import { ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { WELCOME_MENU_MODULES, WELCOME_MENU_TEXT_KEYS } from "../runtime/menu-welcome";
import type { MenuModule } from "../runtime/menu-catalog";

interface HostPackage {
	packageDir: string;
	tuiDir: string;
	version: string;
}
interface LaunchConfig {
	host: HostPackage;
	dictPath: string;
	extensionPath: string;
}
interface InstalledHostApi {
	readLaunchConfig(path: string): LaunchConfig;
}
interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}
interface InstalledMenuApi {
	translateMenuSource(source: string, module: MenuModule, dictionary: Readonly<Record<string, string>>): { supported: boolean; source: string };
}
interface WelcomeComponentApi {
	tip: string | undefined;
	render(width: number): readonly string[];
	describe?(context: object): unknown;
}

interface WelcomeApi {
	WelcomeComponent?: {
		new (version: string, modelName?: string, providerName?: string): WelcomeComponentApi;
		prototype: { describe?: (context: object) => unknown };
	};
	renderWelcomeTip?: (tip: string, width: number, phase?: number) => string[];
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}
interface NativeStateApi {
	setNativeRendering(on: boolean): void;
}
interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeDir = process.env.PROBE_DIR;
if (!configPath || !probeDir) throw new Error("Missing installed launch config or probe directory");
const installDir = dirname(configPath);

mkdirSync(probeDir, { recursive: true });
const fixtureRoot = mkdtempSync(join(probeDir, "WelcomeHints-"));
const previousCwd = process.cwd();
try {
	process.chdir(fixtureRoot);
	// The installed host package is selected by launch.json, so its runtime modules cannot be statically imported.
	const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
	const launch = hostApi.readLaunchConfig(configPath);
	const menuApi = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as InstalledMenuApi;
	const catalogPath = join(installDir, "menu-catalog.ts");
	const textPath = join(installDir, "menu-text.ts");
	const installedCatalog = await import(pathToFileURL(catalogPath).href) as { MENU_MODULES: readonly MenuModule[] };
	const installedText = await import(pathToFileURL(textPath).href) as { MENU_TEXT_KEYS: readonly string[] };
	const catalogKeys = new Set(installedText.MENU_TEXT_KEYS);
	for (const key of WELCOME_MENU_TEXT_KEYS) ok(catalogKeys.has(key), `installed menu text catalog must include ${key}`);
	for (const module of WELCOME_MENU_MODULES) {
		strictEqual(installedCatalog.MENU_MODULES.filter(candidate => candidate.root === module.root && candidate.path === module.path).length, 1,
			`installed catalog must register ${module.path} exactly once`);
	}
	const shippedDictionary = JSON.parse(readFileSync(launch.dictPath, "utf8")) as Record<string, string>;
	const customTip = "User supplied text stays canonical: opaque-id-314";
	const hostileNag = '危险 "quote"; globalThis.__zhompWelcomeInjected = true; //';
	const dictionary = mode === "hostile"
		? { ...shippedDictionary, [customTip]: "恶意替换文本", "Please use nerdfont 😭.": hostileNag }
		: shippedDictionary;
	const dictionaryPath = join(fixtureRoot, "welcome-dictionary.json");
	if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
	if (mode !== "ordinary") {
		for (const key of WELCOME_MENU_TEXT_KEYS) {
			ok(typeof dictionary[key] === "string" && dictionary[key] !== key, `installed dictionary must translate ${key}`);
		}
	}
	const welcomeModule = WELCOME_MENU_MODULES[0];
	if (!welcomeModule) throw new Error("Missing welcome module catalog entry");
	const sourceRoot = welcomeModule.root === "tui" ? launch.host.tuiDir : launch.host.packageDir;
	const welcomePath = join(sourceRoot, welcomeModule.path);
	const welcomeSource = readFileSync(welcomePath, "utf8");
	const transformed = menuApi.translateMenuSource(welcomeSource, welcomeModule, dictionary);
	const sourceSupported = transformed.supported;
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
	process.env.OMP_ZH_DICT = mode === "hostile" ? dictionaryPath : launch.dictPath;
	const injected = globalThis as typeof globalThis & { __zhompWelcomeInjected?: boolean };
	injected.__zhompWelcomeInjected = false;
	const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
	await extension.preparePreloadDisplayTranslations(launch, configPath);
	const themePath = join(launch.host.tuiDir, "src", "theme", "theme.ts");
	const theme = await import(pathToFileURL(themePath).href) as ThemeApi;
	theme.initThemeSync("unicode");
	const welcome = await import(pathToFileURL(welcomePath).href) as WelcomeApi;
	if (typeof welcome.WelcomeComponent !== "function" || typeof welcome.renderWelcomeTip !== "function") {
		throw new Error("Installed welcome rendering API is unavailable");
	}
	const WelcomeComponent = welcome.WelcomeComponent;
	const nativeDescribeSupported = typeof WelcomeComponent.prototype.describe === "function";
	const nativeStatePath = join(launch.host.tuiDir, "src", "native", "state.ts");
	const nativeState = nativeDescribeSupported && existsSync(nativeStatePath)
		? await import(pathToFileURL(nativeStatePath).href) as NativeStateApi
		: undefined;
	if (nativeDescribeSupported && !nativeState) throw new Error("WelcomeComponent describes native nodes but pi-tui native state is unavailable");
	const context: NativeContext = { cols: 120, reduceMotion: true, dark: true, supports: () => true, feature: () => true };
	const oldRandom = Math.random;
	const makeWithRoll = (tipRoll: number, nagRoll = 0.5) => {
		const values = [nagRoll, tipRoll];
		let index = 0;
		Math.random = () => values[index++] ?? 0.5;
		try {
			const component = nativeDescribeSupported
				? new WelcomeComponent(launch.host.version)
				: new WelcomeComponent(launch.host.version, "Welcome probe model", "Welcome probe provider");
			void component.tip;
			return component;
		} finally {
			Math.random = oldRandom;
		}
	};
	const expectedTranslation = mode !== "ordinary" && sourceSupported;
	const allowedTextKeys = new Set(WELCOME_MENU_TEXT_KEYS);
	const expectedCopy = (key: string): string => expectedTranslation && allowedTextKeys.has(key) ? dictionary[key] ?? key : key;
	const expectedTip = (line: string): string => expectedCopy(line).replace(/^\[NO-TERN\]\s*/, "");
	const tipLines = readFileSync(join(launch.host.tuiDir, "src", "prompt", "tips.txt"), "utf8")
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0);
	const keybindingIndex = tipLines.findIndex(line => line.includes("default keybindings"));
	const commandIndex = tipLines.findIndex(line => line.includes("/shake"));
	const linkIndex = tipLines.findIndex(line => /\[tern\]\(/.test(line));
	if (keybindingIndex < 0 || commandIndex < 0) throw new Error("Installed welcome tips lack keybinding or command representatives");
	const weightOf = (line: string): number => /\s*\[NEW\]\s*$/.test(line) ? 4 : 1;
	const totalWeight = tipLines.reduce((sum, line) => sum + weightOf(line), 0);
	const rollForIndex = (index: number): number => {
		const before = tipLines.slice(0, index).reduce((sum, line) => sum + weightOf(line), 0);
		return (before + weightOf(tipLines[index] ?? "") / 2) / totalWeight;
	};
	const samples = [
		{ name: "first", index: 0 },
		{ name: "keybinding", index: keybindingIndex },
		{ name: "command", index: commandIndex },
		...(linkIndex >= 0 ? [{ name: "link", index: linkIndex }] : []),
	];
	const renderedTips = samples.map(sample => {
		const source = tipLines[sample.index];
		if (source === undefined) throw new Error(`Missing installed ${sample.name} tip`);
		const component = makeWithRoll(rollForIndex(sample.index));
		return {
			name: sample.name,
			source,
			selected: component.tip,
			ansi: Bun.stripANSI(component.render(120).join("\n")),
			native: component.describe ? JSON.stringify(component.describe(context)) : undefined,
		};
	});
	const firstSample = renderedTips.find(tip => tip.name === "first");
	const keybindingSample = renderedTips.find(tip => tip.name === "keybinding");
	const commandSample = renderedTips.find(tip => tip.name === "command");
	strictEqual(firstSample?.selected, expectedTip(tipLines[0] ?? ""));
	ok(firstSample?.ansi.includes(expectedTip(tipLines[0] ?? "")), "real welcome component must render its first installed tip");
	strictEqual(keybindingSample?.selected, expectedTip(tipLines[keybindingIndex] ?? ""));
	if (keybindingSample?.source.includes("{key:")) {
		ok(!keybindingSample.ansi.includes("{key:"), "the rendered keybinding hint must expand its preserved placeholder");
	} else {
		ok(keybindingSample?.ansi.includes("Ctrl+D"), "legacy keybinding text must remain visible");
	}
	strictEqual(commandSample?.selected, expectedTip(tipLines[commandIndex] ?? ""));
	ok(commandSample?.ansi.includes("/shake"), "welcome output must retain the /shake command");
	const linkSample = renderedTips.find(tip => tip.name === "link");
	if (linkSample) {
		const visibleLinkTip = expectedTip(linkSample.source).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
		strictEqual(linkSample.selected, expectedTip(linkSample.source));
		ok(linkSample.ansi.includes(visibleLinkTip), "ANSI welcome must render the selected Tern link tip");
		if (linkSample.native) ok(linkSample.native.includes("scl.so/tern"), "native welcome description must retain the Tern link");
	}
	const caption = expectedCopy("Tip:");
	const captionAndTip = welcome.renderWelcomeTip(customTip, 100);
	const customRendered = Bun.stripANSI(captionAndTip.join("\n"));
	ok(customRendered.includes(customTip), "arbitrary renderWelcomeTip input must remain visible");
	ok(!customRendered.includes("恶意替换文本"), "an unlisted hostile translation must not replace arbitrary tip input");
	ok(customRendered.includes(caption), "the fixed Tip: caption must follow sourceSupported translation state");
	const nerdfont = makeWithRoll(0.5, 0.05);
	const expectedNag = mode === "hostile" && expectedTranslation
		? hostileNag
		: expectedCopy("Please use nerdfont 😭.");
	strictEqual(nerdfont.tip, expectedNag);
	const nerdfontAnsi = Bun.stripANSI(nerdfont.render(120).join("\n"));
	ok(nerdfontAnsi.includes(expectedNag), "the fixed nerd-font nag must render literally");
	let nerdfontNative: string | undefined;
	if (nerdfont.describe) {
		nerdfontNative = JSON.stringify(nerdfont.describe(context));
		if (mode === "hostile" && expectedTranslation) {
			const serializedNag = JSON.stringify(hostileNag);
			ok(nerdfontNative.includes(serializedNag.slice(1, -1)), "native description must keep hostile display text literal");
		}
	}
	if (mode === "hostile") {
		ok(!injected.__zhompWelcomeInjected, "hostile welcome display text must not execute as code");
		ok(nerdfontAnsi.includes(hostileNag), "ANSI rendering must keep the hostile dictionary value literal");
	}
	let nativeChoice: string | undefined;
	let nativeNode: string | undefined;
	if (nativeDescribeSupported) {
		if (!nativeState) throw new Error("Native rendering state is unavailable");
		nativeState.setNativeRendering(true);
		try {
			const nativeComponent = makeWithRoll(0.995);
			nativeChoice = nativeComponent.tip;
			nativeNode = JSON.stringify(nativeComponent.describe?.(context));
		} finally {
			nativeState.setNativeRendering(false);
		}
		ok(nativeNode?.includes('"omp.welcome.tip-text"') && nativeNode.includes('"omp.welcome"'), "native welcome must preserve keyed IDs");
		ok(!nativeNode?.includes("https://scl.so/tern"), "native TSP rendering must omit the [NO-TERN] tip");
	}
	console.log(JSON.stringify({
		component: "WelcomeHints",
		mode,
		hostVersion: launch.host.version,
		hostSourcesSupported: sourceSupported ? [welcomeModule.path] : [],
		unsupportedModules: sourceSupported ? [] : [welcomeModule.path],
		consumerEvidence: {
			sourceSupported,
			nativeDescribeSupported,
			renderedTips,
			customInput: { source: customTip, rendered: customRendered },
			nerdfontNag: { selected: nerdfont.tip, ansi: nerdfontAnsi, native: nerdfontNative },
			native: { selected: nativeChoice, rendered: nativeNode, keyedIdsPreserved: nativeDescribeSupported },
		},
	}));
} finally {
	process.chdir(previousCwd);
	rmSync(fixtureRoot, { recursive: true, force: true });
}
