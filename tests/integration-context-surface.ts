import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { MENU_MODULES } from "../runtime/menu-catalog";
import { CONTEXT_MENU_MODULES } from "../runtime/menu-context";
import { translateMenuSource } from "../runtime/menu-ui";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface ThemeApi {
	initThemeSync(): void;
}

interface KeybindingHintsApi {
	editorKey(action: string): string;
}

interface ContextViewerInstance {
	render(width: number): readonly string[];
	handleNativeEvent(event: unknown): void;
	describe(context: unknown): unknown;
	readonly nativeOverlay: unknown;
	dispose(): void;
}

interface ContextViewerApi {
	ContextViewer: new (
		data: unknown,
		options: { onClose(): void; requestRender(): void; getRows(): number },
	) => ContextViewerInstance;
}

interface NativeContext {
	cols: number;
	hour12: boolean;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

interface NumberFormatApi {
	formatNumber(value: number): string;
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

function collectStrings(value: unknown, output: string[] = []): string[] {
	if (typeof value === "string") output.push(value);
	else if (Array.isArray(value)) {
		for (const child of value) collectStrings(child, output);
	} else if (value !== null && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			if (key !== "s") collectStrings(child, output);
		}
	}
	return output;
}

function ansiText(viewer: ContextViewerInstance, width: number): string {
	return Bun.stripANSI(viewer.render(width).join("\n"));
}

const mode = process.env.MENU_SURFACE_MODE ?? process.env.MODEL_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE or MODEL_SURFACE_MODE must be ordinary, translated, or hostile");
}

const configPath = process.env.OMP_ZH_CONFIG;
if (!configPath) throw new Error("Missing installed launcher config: OMP_ZH_CONFIG");

// OMP_ZH_CONFIG selects the installed host copy; static imports could bind a different Bun installation.
const installDir = dirname(configPath);
const installedHost = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
// Number formatting follows the selected host copy, just like the ContextViewer implementation.
const numberFormatPath = Bun.resolveSync("@oh-my-pi/pi-utils", launch.host.packageDir);
const { formatNumber } = await import(pathToFileURL(numberFormatPath).href) as NumberFormatApi;
const configBefore = readFileSync(configPath, "utf8");
const dictionaryBefore = readFileSync(launch.dictPath, "utf8");
const shippedDictionary = dictionaryFromFile(launch.dictPath);

function unavailable(reason: string): void {
	console.log(JSON.stringify({
		mode,
		component: "ContextViewer",
		capability: `unavailable@${launch.host.version}`,
		reason,
	}));
}

for (const module of CONTEXT_MENU_MODULES) {
	if (!MENU_MODULES.includes(module)) throw new Error(`Context translation module was not registered: ${module.path}`);
	const root = module.root === "tui" ? launch.host.tuiDir : launch.host.packageDir;
	const sourcePath = join(root, ...module.path.split("/"));
	if (!existsSync(sourcePath)) {
		unavailable(`missing ${module.path}`);
		process.exit(0);
	}
	const source = readFileSync(sourcePath, "utf8");
	if (!translateMenuSource(source, module, shippedDictionary).supported) {
		unavailable(`unsupported source shape: ${module.path}`);
		process.exit(0);
	}
}

const contextViewerPath = join(launch.host.tuiDir, "src", "overlays", "context-viewer.ts");
const contextViewerModule = CONTEXT_MENU_MODULES.find(module => module.path === "src/overlays/context-viewer.ts");
if (!contextViewerModule) throw new Error("ContextViewer module patch is missing");
const originalViewerSource = readFileSync(contextViewerPath, "utf8");
if (!originalViewerSource.includes("export class ContextViewer")) {
	unavailable("ContextViewer export is absent");
	process.exit(0);
}
const translatedViewerSource = translateMenuSource(originalViewerSource, contextViewerModule, shippedDictionary);
if (!translatedViewerSource.supported) throw new Error("ContextViewer preflight changed after capability discovery");
ok(translatedViewerSource.source.includes("getSearchText: item => item.label"), "overview search must keep its canonical row label");
ok(translatedViewerSource.source.includes("getSearchText: entry => entry.label"), "entry search must keep its canonical entry label");

const hostileText = '恶意"; globalThis.__zhompContextInjected = true; // $& ${literal}';
const dictionary = mode === "hostile"
	? { ...shippedDictionary, Context: hostileText, "Assistant Messages": hostileText, "View Content": hostileText }
	: shippedDictionary;
let temporaryDirectory: string | undefined;
let viewer: ContextViewerInstance | undefined;
let fallbackViewer: ContextViewerInstance | undefined;

try {
	let dictionaryPath = launch.dictPath;
	if (mode === "hostile") {
		temporaryDirectory = mkdtempSync(join(tmpdir(), "zhomp-context-surface-"));
		dictionaryPath = join(temporaryDirectory, "dictionary.json");
		writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
	}
	process.env.OMP_ZH_DICT = dictionaryPath;
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);

	// Import the selected extension and TUI only after the launcher path is known and transforms are prepared.
	const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
	await extension.preparePreloadDisplayTranslations(launch, configPath);

	const themePath = join(launch.host.tuiDir, "src", "theme", "theme.ts");
	const theme = await import(pathToFileURL(themePath).href) as ThemeApi;
	theme.initThemeSync();
	const keybindingHintsPath = join(launch.host.tuiDir, "src", "chrome", "keybinding-hints.ts");
	const keybindingHints = await import(pathToFileURL(keybindingHintsPath).href) as KeybindingHintsApi;
	const viewerModule = await import(pathToFileURL(contextViewerPath).href) as ContextViewerApi;
	if (typeof viewerModule.ContextViewer !== "function") throw new Error("Preflighted ContextViewer module did not export its component");

	const assistantEntry = {
		id: "assistant-entry-raw",
		label: "Assistant Messages",
		text: "context body line one\ncontext body line two\ncontext body line three\nRAW_CONTEXT_BODY: globalThis.__zhompContextBodyInjected = true;",
		tokens: 41,
		info: "raw metadata Assistant Messages",
		path: "/probe/source-keep.ts",
		callId: "raw-call-001",
	};
	const secondEntry = {
		id: "assistant-entry-second",
		label: "canonical-second-entry",
		text: "second entry body",
		tokens: 7,
	};
	const childEntry = {
		id: "dynamic-child-entry",
		label: "Assistant Messages",
		text: "dynamic child body stays raw",
		tokens: 9,
	};
	const systemPromptEntry = {
		id: "system-prompt-entry",
		label: "system prompt source label",
		text: "system prompt body stays raw",
		tokens: 17,
	};
	const categories = [
		{ id: "system-prompt", label: "System Prompt", tokens: 1_000, entries: [systemPromptEntry] },
		{ id: "skills", label: "Skills", tokens: 500, entries: [] },
		{ id: "built-in-tools", label: "Built-in Tools", tokens: 1_000, entries: [] },
		{ id: "custom-tools", label: "Custom Tools", tokens: 500, entries: [] },
		{ id: "user-messages", label: "User / Developer Messages", tokens: 1_000, entries: [] },
		{
			id: "assistant-messages",
			label: "Assistant Messages",
			tokens: 1_000,
			entries: [assistantEntry, secondEntry],
			children: [{ id: "assistant-messages", key: "dynamic-child", label: "Assistant Messages", tokens: 250, entries: [childEntry] }],
		},
		{ id: "assistant-thinking", label: "Assistant Thinking", tokens: 500, entries: [] },
		{ id: "tool-calls", label: "Tool Calls", tokens: 300, entries: [] },
		{ id: "tool-output", label: "Tool Output", tokens: 400, entries: [] },
	] as const;
	const breakdown = {
		model: { id: "fixture-model-id", name: "Context" },
		contextWindow: 10_000,
		categories: [],
		usedTokens: 6_200,
		autoCompactBufferTokens: 800,
		freeTokens: 3_000,
		thresholdTokens: 8_000,
		snapcompact: {
			visionCapable: true,
			systemPrompt: { applied: false, reason: "budget", textTokens: 120, frames: 1, imageTokens: 40, savedTokens: 0, scope: "agents-md" },
			toolResults: { total: 2, swapped: 1, textTokens: 100, frames: 1, imageTokens: 10, savedTokens: 90 },
			savedTokens: 90,
		},
	};
	const data = { breakdown, categories };
	const dataBefore = JSON.stringify(data);
	const categoryIdsBefore = categories.map(category => category.id);
	const entryIdentityBefore = [assistantEntry, secondEntry, childEntry, systemPromptEntry].map(entry => ({
		id: entry.id,
		label: entry.label,
		text: entry.text,
		path: "path" in entry ? entry.path : undefined,
		callId: "callId" in entry ? entry.callId : undefined,
		tokens: entry.tokens,
	}));
	let terminalRows = 30;
	viewer = new viewerModule.ContextViewer(data, {
		onClose: () => undefined,
		requestRender: () => undefined,
		getRows: () => terminalRows,
	});

	const nativeContext: NativeContext = {
		cols: 220,
		hour12: false,
		reduceMotion: true,
		dark: true,
		supports: kind => kind === "meter",
		feature: () => false,
	};
	const localized = (key: string): string => dictionary[key] ?? key;
	const expectedContext = mode === "ordinary" ? "Context" : localized("Context");
	const expectedAssistantCategory = mode === "ordinary" ? "Assistant Messages" : localized("Assistant Messages");
	const overviewAnsi = ansiText(viewer, 220);
	const overviewNative = collectStrings(viewer.describe(nativeContext)).join("\n");
	const overviewHead = collectStrings(viewer.nativeOverlay).join("");
	ok(overviewHead.includes(`${expectedContext} · Context`), `native context/model title must translate only the fixed title; got ${JSON.stringify(overviewHead)}`);
	for (const key of [
		"System Prompt (excluding Skills)", "Skills", "Built-in Tools", "Custom Tools", "User / Developer Messages",
		"Assistant Messages", "Assistant Thinking", "Tool Calls", "Tool Output", "Auto-Compact Buffer", "Free Space",
	]) {
		const expected: string = mode === "ordinary" ? key : localized(key);
		ok(overviewAnsi.includes(expected) || overviewNative.includes(expected), `overview label missing in ${mode}: ${key}`);
	}
	ok(overviewAnsi.includes(formatNumber(6_200)) && overviewNative.includes(formatNumber(10_000)), `token values must remain numeric and unchanged: ANSI ${JSON.stringify(overviewAnsi)} native ${JSON.stringify(overviewNative)}`);
	ok(overviewAnsi.includes("62%") || overviewNative.includes("62%"), "usage percentages must remain unchanged");
	ok(overviewAnsi.includes(mode === "ordinary" ? "Category totals split Used" : localized("Category totals split Used by estimated share; the entries inside may not add up to them.")), "attribution explanation must use its fixed translation");
	ok(overviewAnsi.includes(mode === "ordinary" ? "Snapcompact" : localized("Snapcompact (estimated wire savings)")), "Snapcompact diagnostics must render in the overview");
	ok(overviewNative.includes(mode === "ordinary" ? "Context usage by category" : localized("Context usage by category")), "native meter description must use its fixed translation");

	const editorUp = keybindingHints.editorKey("tui.select.up");
	const editorDown = keybindingHints.editorKey("tui.select.down");
	const editorConfirm = keybindingHints.editorKey("tui.select.confirm");
	for (const hint of [editorUp, editorDown, editorConfirm].filter(Boolean)) {
		ok(overviewAnsi.includes(hint), `generated key hint bytes changed: ${hint}`);
	}
	if (mode === "hostile") {
		ok(overviewAnsi.includes(hostileText) && overviewNative.includes(hostileText), "hostile fixed-label translation must stay literal in both renderers");
		strictEqual(Reflect.get(globalThis, "__zhompContextInjected"), undefined, "hostile dictionary text must not execute");
	}

	const fallbackData = { ...data, breakdown: { ...breakdown, model: undefined } };
	fallbackViewer = new viewerModule.ContextViewer(fallbackData, {
		onClose: () => undefined,
		requestRender: () => undefined,
		getRows: () => 30,
	});
	const fallbackAnsi = ansiText(fallbackViewer, 220);
	const expectedFallback = mode === "ordinary" ? "no model" : localized("no model");
	ok(fallbackAnsi.includes(`${expectedContext} · ${expectedFallback}`), "missing-model fallback must be translated without translating model names");

	viewer.handleNativeEvent({ type: "select", item: "assistant-messages" });
	viewer.handleNativeEvent({ type: "activate", item: "assistant-messages" });
	terminalRows = 8;
	const categoryAnsi = ansiText(viewer, 220);
	const categoryNative = collectStrings(viewer.describe(nativeContext)).join("\n");
	const categoryHead = collectStrings(viewer.nativeOverlay).join("");
	ok(categoryAnsi.includes(expectedAssistantCategory), "ANSI category title must translate its fixed label");
	ok(categoryHead.includes(expectedAssistantCategory), "native category title must translate its fixed label");
	ok(categoryAnsi.includes(mode === "ordinary" ? "more" : localized("more")), "category preview must translate the more suffix");
	ok(categoryAnsi.includes(mode === "ordinary" ? "View Content" : localized("View Content")), "category preview must translate View Content");
	ok(categoryNative.includes("assistant-entry-raw"), "native category entry key must preserve its source ID");
	ok(categoryNative.includes("Assistant Messages"), "entry label must remain canonical English through the real category consumer");

	viewer.handleNativeEvent({ type: "action", act: "select-entry", key: "entries/content/list/assistant-entry-raw" });
	viewer.handleNativeEvent({ type: "action", act: "open-entry", key: "entries/content/list/assistant-entry-raw" });
	terminalRows = 40;
	const entryAnsi = ansiText(viewer, 220);
	const entryNative = collectStrings(viewer.describe(nativeContext)).join("\n");
	const entryHead = collectStrings(viewer.nativeOverlay).join("");
	ok(entryAnsi.includes("RAW_CONTEXT_BODY: globalThis.__zhompContextBodyInjected = true;"), "ANSI entry must preserve its raw body");
	ok(entryNative.includes("RAW_CONTEXT_BODY: globalThis.__zhompContextBodyInjected = true;"), "native entry must preserve its raw body");
	ok(entryAnsi.includes("raw metadata Assistant Messages") && entryNative.includes("raw metadata Assistant Messages"), "entry info must remain raw");
	ok(entryAnsi.includes("/probe/source-keep.ts") && entryNative.includes("/probe/source-keep.ts"), "entry path must remain raw");
	ok(entryAnsi.includes("raw-call-001") && entryNative.includes("raw-call-001"), "entry call id must remain raw");
	ok(entryAnsi.includes("Assistant Messages") && entryNative.includes("Assistant Messages"), "entry label must not be translated as a category label");
	ok(entryAnsi.includes("41") && entryNative.includes("41"), "entry token value must remain unchanged");
	ok(entryHead.includes(expectedAssistantCategory), "native entry header must retain its translated category title");
	strictEqual(Reflect.get(globalThis, "__zhompContextBodyInjected"), undefined, "raw body content must not execute");

	viewer.handleNativeEvent({ type: "action", act: "back" });
	viewer.handleNativeEvent({ type: "action", act: "back" });
	viewer.handleNativeEvent({ type: "select", item: "dynamic-child" });
	viewer.handleNativeEvent({ type: "activate", item: "dynamic-child" });
	const childAnsi = ansiText(viewer, 220);
	const childNativeHead = collectStrings(viewer.nativeOverlay).join("");
	ok(childAnsi.includes("Assistant Messages"), "dynamic child labels stay canonical English");
	ok(childNativeHead.includes("Assistant Messages"), "native dynamic child title must not use category translation");
	if (mode === "hostile") ok(!childAnsi.includes(hostileText), "dynamic child labels must not use hostile category translation");
	ok(childAnsi.includes("dynamic child body stays raw"), "dynamic child entry must render through ANSI");

	viewer.handleNativeEvent({ type: "action", act: "back" });
	viewer.handleNativeEvent({ type: "action", act: "back" });
	viewer.handleNativeEvent({ type: "select", item: "system-prompt" });
	viewer.handleNativeEvent({ type: "activate", item: "system-prompt" });
	const systemPromptAnsi = ansiText(viewer, 220);
	const systemPromptNativeHead = collectStrings(viewer.nativeOverlay).join("");
	const expectedSystemPrompt = mode === "ordinary" ? "System Prompt" : localized("System Prompt");
	ok(systemPromptAnsi.includes(expectedSystemPrompt), "ANSI category title must translate System Prompt");
	ok(systemPromptNativeHead.includes(expectedSystemPrompt), "native category title must translate System Prompt");

	strictEqual(JSON.stringify(data), dataBefore, "ContextViewer must not mutate context data, IDs, labels, or body content");
	deepStrictEqual(categories.map(category => category.id), categoryIdsBefore, "category order and IDs must remain canonical");
	deepStrictEqual(
		[assistantEntry, secondEntry, childEntry, systemPromptEntry].map(entry => ({
			id: entry.id,
			label: entry.label,
			text: entry.text,
			path: "path" in entry ? entry.path : undefined,
			callId: "callId" in entry ? entry.callId : undefined,
			tokens: entry.tokens,
		})),
		entryIdentityBefore,
		"entry labels, IDs, raw body, metadata, and token values must remain canonical",
	);
	strictEqual(readFileSync(configPath, "utf8"), configBefore, "the installed launcher config must remain unchanged");
	strictEqual(readFileSync(launch.dictPath, "utf8"), dictionaryBefore, "the installed dictionary must remain unchanged");
	strictEqual(Reflect.get(globalThis, "__zhompContextInjected"), undefined, "dictionary text must remain inert");
	console.log(JSON.stringify({
		mode,
		component: "ContextViewer",
		capability: `covered@${launch.host.version}`,
		nativeAvailable: true,
		ansiStates: ["overview", "category", "entry"],
		nativeStates: ["overview", "category", "entry"],
		canonicalCategoryIds: categoryIdsBefore,
		canonicalEntryId: assistantEntry.id,
		canonicalSearchLabels: { category: "Assistant Messages", entry: assistantEntry.label },
		configWrites: 0,
		injectionSideEffect: false,
	}));
} finally {
	viewer?.dispose();
	fallbackViewer?.dispose();
	if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
