import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { DIALOG_MENU_MODULES, DIALOG_MENU_TEXT_KEYS } from "../runtime/menu-dialogs";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface KeybindingManager {
	getKeys(keybinding: string): readonly string[];
}

interface KeybindingRegistryApi {
	getKeybindings(): KeybindingManager;
	setKeybindings(manager: KeybindingManager): void;
}

interface AppKeybindingsApi {
	formatKeyHint(key: string): string;
	KeybindingsManager: { inMemory(): KeybindingManager };
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

type NativeEvent =
	| { type: "select"; key: string; item: string }
	| { type: "action"; key: string; act: string; mods: readonly string[] };

interface SurfaceNode {
	k?: unknown;
	p?: unknown;
	c?: unknown;
	key?: unknown;
}

interface SurfaceProps {
	[key: string]: unknown;
	role?: unknown;
	actions?: unknown;
	label?: unknown;
	title?: unknown;
	noun?: unknown;
	empty?: unknown;
	items?: unknown;
	query?: unknown;
	detail?: unknown;
	text?: unknown;
	subtitle?: unknown;
}

interface AskOption {
	readonly label: string;
	readonly description?: string;
	readonly preview?: string;
}

interface AskQuestion {
	readonly id: string;
	readonly question: string;
	readonly header?: string;
	readonly options: readonly AskOption[];
	readonly multi?: boolean;
	readonly recommended?: number;
}

interface AskPrompt {
	title: string;
	question: string;
}

interface AskResultItem {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	note?: string;
	noteOption?: string;
}

interface AskSubmitResult {
	kind: "submit";
	results: AskResultItem[];
}

interface AskCallbacks {
	onSubmit(result: AskSubmitResult): void;
	onCancel(): void;
	onPrompt(prompt: AskPrompt, prefill?: string): Promise<string | undefined>;
}

interface AskInstance {
	render(width: number): readonly string[];
	keyHints?(): string;
	describe?(context: NativeContext): unknown;
	handleNativeEvent?(event: NativeEvent): void;
	handleInput(data: string): void;
	dispose(): void;
}

interface AskDialogApi {
	AskDialogComponent: new (questions: readonly AskQuestion[], callbacks: AskCallbacks, options?: Record<string, unknown>) => AskInstance;
}
interface HtmlFormInstance extends AskInstance {
	handleNativeEvent?(event: NativeEvent): void;
	data?(): Record<string, unknown>;
	givenAnswers?(): { data: Record<string, unknown>; notes: readonly unknown[] } | undefined;
}

interface HtmlFormDialogApi {
	HtmlFormDialog: new (
		form: unknown,
		callbacks: {
			onSubmit(data: Record<string, unknown>, notes: readonly unknown[]): void;
			onCancel(): void;
		},
	) => HtmlFormInstance;
}

interface HtmlFormParserApi {
	parseHtmlForm(source: string): unknown;
}

interface ApprovalGrant {
	readonly label: string;
	readonly alwaysLabel: string;
}

interface ApprovalOptions {
	readonly fullPrompt?: string;
	readonly grants?: readonly ApprovalGrant[];
	readonly session?: { readonly label: string; onApprove(): void };
	readonly draft?: { hasDraft(): boolean; handleInput(keyData: string): void };
}

interface ApprovalInstance {
	render(width: number): readonly string[];
	describe?(): unknown;
	handleNativeEvent?(event: NativeEvent): void;
	handleInput(data: string): void;
	toggleDetails(): boolean;
	dispose(): void;
}

interface ApprovalDialogApi {
	ApprovalDialogComponent: new (
		prompt: string,
		callbacks: { onApprove(): void; onDeny(): void },
		options?: ApprovalOptions,
	) => ApprovalInstance;
}

interface HookOption {
	readonly label: string;
	readonly description?: string;
}

interface HookInstance {
	render(width: number): readonly string[];
	describe?(context: NativeContext): unknown;
	handleInput(data: string): void;
	dispose(): void;
}

interface HookSelectorApi {
	HookSelectorComponent: new (
		title: string,
		options: readonly HookOption[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		optionsConfig?: { maxVisible?: number },
	) => HookInstance;
}

function collectNodes(value: unknown, output: SurfaceNode[] = []): SurfaceNode[] {
	if (Array.isArray(value)) {
		for (const child of value) collectNodes(child, output);
		return output;
	}
	if (value === null || typeof value !== "object") return output;
	const node: SurfaceNode = {};
	if ("k" in value) node.k = value.k;
	if ("p" in value) node.p = value.p;
	if ("c" in value) node.c = value.c;
	if ("key" in value) node.key = value.key;
	if (typeof node.k === "string") output.push(node);
	if (Array.isArray(node.c)) collectNodes(node.c, output);
	return output;
}

function collectStrings(value: unknown, output: string[] = [], seen = new Set<object>()): string[] {
	if (typeof value === "string") {
		output.push(value);
		return output;
	}
	if (Array.isArray(value)) {
		for (const child of value) collectStrings(child, output, seen);
		return output;
	}
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) return output;
		seen.add(value);
		// Native descriptions are enumerable TSP node objects.
		const entries = Object.entries(value as Record<string, unknown>);
		for (const [, child] of entries) collectStrings(child, output, seen);
	}
	return output;
}

function nativeProps(node: SurfaceNode | undefined): SurfaceProps {
	const source = node?.p;
	if (source === null || typeof source !== "object" || Array.isArray(source)) return {};
	const sourceProps = source as Record<string, unknown>;
	const props: SurfaceProps = {};
	for (const key of ["role", "actions", "label", "title", "noun", "empty", "items", "query", "detail", "text", "subtitle"] as const) {
		if (key in sourceProps) props[key] = sourceProps[key];
	}
	return props;
}

function actionNode(nodes: readonly SurfaceNode[], action: string): SurfaceNode | undefined {
	return nodes.find(node => {
		const props = nativeProps(node);
		const actions = props.actions;
		if (props.role !== "omp.btn" || actions === null || typeof actions !== "object" || Array.isArray(actions)) return false;
		return "click" in actions && actions.click === action;
	});
}

function itemNode(nodes: readonly SurfaceNode[], key: string): SurfaceNode | undefined {
	return nodes.find(node => node.k === "item" && node.key === key);
}


function expect(condition: boolean, message: string, rendered: string): void {
	if (!condition) throw new Error(`${message}; rendered=${JSON.stringify(rendered)}`);
}

function expectValue(actual: unknown, expected: unknown, message: string, rendered: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${message}; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} rendered=${JSON.stringify(rendered)}`);
	}
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const renderWidth = mode === "hostile" ? 1200 : 120;

const injectionState = globalThis as typeof globalThis & { __zhompDialogInjected?: boolean };
injectionState.__zhompDialogInjected = false;
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");

// launch.json selects the installed host; importing the workspace host would test a different installation.
const installDir = dirname(configPath);
const installedHost = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
const hostMajor = Number.parseInt(launch.host.version.split(".")[0] ?? "", 10);
const currentScrollingAsk = hostMajor >= 19;
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
if (!shippedDictionary) throw new Error("The installed dialog probe dictionary is invalid");
let dictionary: Readonly<Record<string, string>> = shippedDictionary;
if (mode === "hostile") {
	const hostileDictionary: Record<string, string> = { ...shippedDictionary };
	for (const key of DIALOG_MENU_TEXT_KEYS) {
		hostileDictionary[key] = `恶意文案(${key})"; globalThis.__zhompDialogInjected = true; // $&`;
	}
	for (const key of ["Submit", "Other…", "Settings", "high", "id"]) {
		hostileDictionary[key] = `恶意数据(${key})`;
	}
	const hostilePath = join(probeRoot, "dialog-menu-hostile.json");
	writeFileSync(hostilePath, JSON.stringify(hostileDictionary));
	process.env.OMP_ZH_DICT = hostilePath;
	dictionary = hostileDictionary;
}

process.env.OMP_ZH_CONFIG = configPath;
if (mode === "ordinary") {
	delete process.env.OMP_ZH_ENABLED;
	delete process.env.OMP_ZH_PROCESS_ID;
} else {
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = String(process.pid);
}
// The extension file is also launch-selected and must prepare transforms before dialog modules are imported.
const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
if (typeof extension.preparePreloadDisplayTranslations !== "function") {
	throw new Error("The installed extension has no preparePreloadDisplayTranslations API");
}
await extension.preparePreloadDisplayTranslations(launch, configPath);

const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
const theme = await import(pathToFileURL(themePath).href) as { initThemeSync(preset?: string): void };
theme.initThemeSync("unicode");

const keybindingsPath = Bun.resolveSync("@oh-my-pi/pi-tui/app-keybindings", launch.host.packageDir);
const keybindings = await import(pathToFileURL(keybindingsPath).href) as AppKeybindingsApi;
const enterHint = keybindings.formatKeyHint("enter");

function expectedText(key: string, values: Readonly<Record<string, string | number>> = {}): string {
	const template = mode === "ordinary" ? key : dictionary[key];
	if (typeof template !== "string" || template.length === 0) {
		throw new Error(`Missing required dialog translation key: ${JSON.stringify(key)}`);
	}
	if (mode !== "ordinary" && !/[\u3400-\u9fff]/u.test(template)) {
		throw new Error(`Dialog translation is not Chinese for ${JSON.stringify(key)}: ${JSON.stringify(template)}`);
	}
	return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : placeholder,
	);
}

function expectFixed(actual: string, key: string, rendered: string, values: Readonly<Record<string, string | number>> = {}): void {
	const expected = expectedText(key, values);
	expect(actual.includes(expected), `Expected fixed dialog copy ${JSON.stringify(key)} as ${JSON.stringify(expected)}`, rendered);
}

function expectTemplatePrefix(actual: unknown, key: string, rendered: string): void {
	const template = mode === "ordinary" ? key : dictionary[key];
	if (typeof actual !== "string" || typeof template !== "string") {
		throw new Error(`Expected rendered tooltip template ${JSON.stringify(key)}; rendered=${JSON.stringify(rendered)}`);
	}
	const prefix = template.split("{key}")[0] ?? template;
	expect(actual.startsWith(prefix), `Expected tooltip prefix ${JSON.stringify(prefix)}`, rendered);
}

function expectKeyTooltip(actual: unknown, keyedKey: string, rendered: string): void {
	const baseKey = keyedKey.slice(0, keyedKey.indexOf("  {key}"));
	if (actual === expectedText(baseKey)) return;
	expectTemplatePrefix(actual, keyedKey, rendered);
}

function expectNativeAskTag(nodes: readonly SurfaceNode[], rendered: string): void {
	const tag = nodes.find(node => nativeProps(node).role === "omp.ask.card.tag");
	const expected = mode === "ordinary" ? "ask" : expectedText("Ask");
	expect(collectStrings(tag?.p).includes(expected), `Expected native Ask card tag ${JSON.stringify(expected)}`, rendered);
}

function expectFoldedOther(native: unknown, expected: string, rendered: string): void {
	// The native pill puts the full label in its tooltip when the visible text is clipped.
	const pills = collectNodes(native).map(nativeProps).filter(props => props.role === "omp.ask.pill");
	expect(pills.some(pill => (pill.title ?? pill.text) === expected),
		`Expected full folded Other label ${JSON.stringify(expected)}`, rendered);
}

function nativeContext(picker: boolean): NativeContext {
	return {
		cols: 120,
		reduceMotion: true,
		dark: false,
		supports: kind => picker && kind === "picker",
		feature: () => false,
	};
}

// These resolve from the launch-selected installed package, after the preload has registered its source transforms.
const askPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/ask-dialog", launch.host.packageDir);
const approvalPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/approval-dialog", launch.host.packageDir);
const hookPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/hook-selector", launch.host.packageDir);
const askApi = await import(pathToFileURL(askPath).href) as AskDialogApi;
const approvalApi = await import(pathToFileURL(approvalPath).href) as ApprovalDialogApi;
const hookApi = await import(pathToFileURL(hookPath).href) as HookSelectorApi;

let askResult: AskSubmitResult | undefined;
const askPrompts: AskPrompt[] = [];
let askCancelled = false;
const localizedOtherOptionValue = mode === "translated" ? expectedText("Other…") : "其他…";
const askQuestions: readonly AskQuestion[] = Object.freeze([
	Object.freeze({
		id: "id",
		question: "Submit",
		header: "Settings",
		options: Object.freeze([
			Object.freeze({ label: "Submit", description: "Settings", preview: "Other…" }),
			Object.freeze({ label: "Other…" }),
			Object.freeze({ label: "Settings" }),
			Object.freeze({ label: "high" }),
			Object.freeze({ label: "Other (type your own)" }),
			Object.freeze({ label: localizedOtherOptionValue }),
		]),
		multi: true,
		recommended: 0,
	}),
	Object.freeze({
		id: "high",
		question: "Settings",
		header: "Submit",
		options: Object.freeze([Object.freeze({ label: "Other…" }), Object.freeze({ label: "Settings" })]),
		multi: true,
	}),
]);
const ask = new askApi.AskDialogComponent(askQuestions, {
	onSubmit(result) { askResult = result; },
	onCancel() { askCancelled = true; },
	async onPrompt(prompt) { askPrompts.push(prompt); return "Other…"; }
});
	const askAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
const askNativeAvailable = typeof ask.describe === "function";
const askNativeEventsAvailable = typeof ask.handleNativeEvent === "function";
let askNative: unknown;
if (ask.describe) askNative = ask.describe(nativeContext(false));
const askNodes = collectNodes(askNative);
expectFixed(askAnsi, "Ask", askAnsi);
expectFixed(askAnsi, "Other…", askAnsi);
expectFixed(askAnsi, " (Recommended)", askAnsi);
if (currentScrollingAsk) {
	const askHints = ask.keyHints?.();
	if (!askHints) throw new Error("Current Ask did not expose its composer keyboard hints");
	for (const key of ["toggle", "next", "move", "question", "composer"]) expectFixed(askHints, key, askHints);
} else {
	for (const key of ["toggle", "next", "move", "question", "cancel"]) expectFixed(askAnsi, key, askAnsi);
}
	expect(askAnsi.includes("Submit") && askAnsi.includes("Settings") && askAnsi.includes("Other…") &&
		askAnsi.includes("high") && askAnsi.includes("Other (type your own)") && askAnsi.includes(localizedOtherOptionValue),
		"ANSI ask must preserve caller questions and option values", askAnsi);
if (currentScrollingAsk && (!askNativeAvailable || !askNativeEventsAvailable)) {
	throw new Error("Current Ask must expose its transformed native card and action events");
}
if (askNativeAvailable) {
	const askNativeText = collectStrings(askNative).join("\n");
	if (currentScrollingAsk) {
		const card = askNodes.find(node => nativeProps(node).role === "omp.ask.card");
		expect(card !== undefined, "Current Ask did not render its scrolling ask card", askNativeText);
		expect(!askNodes.some(node => nativeProps(node).role === "omp.ask.questions"),
			"Current Ask regressed to question tabs", askNativeText);
		expectNativeAskTag(askNodes, askNativeText);
		expectFixed(askNativeText, "{answered} of {total} answered", askNativeText, { answered: 0, total: 2 });
		expectFixed(askNativeText, "Answer this question", askNativeText);
		expectFixed(askNativeText, "Cancel without answering", askNativeText);
		expectFixed(askNativeText, "Submit the answers", askNativeText);
	} else {
		expectFixed(askNativeText, "Review", askNativeText);
		expectFixed(askNativeText, "Next question  tab · Previous  shift+tab", askNativeText);
		const nextButton = actionNode(askNodes, "submit");
		if (!nextButton) throw new Error(`Ask native Next action missing; rendered=${JSON.stringify(askNativeText)}`);
		expectFixed(collectStrings(nextButton).join(""), "Next", askNativeText);
	}
	expectFixed(askNativeText, "Recommended", askNativeText);
	const rawSubmitChoice = itemNode(askNodes, "option:0");
	const rawSettingsChoice = itemNode(askNodes, "option:2");
	const callerQuestion = askNodes.find(node => nativeProps(node).role === "omp.ask.question");
	const callerPreview = askNodes.find(node => nativeProps(node).role === "omp.ask.preview");
	if (!rawSubmitChoice || !rawSettingsChoice || !callerQuestion || !callerPreview) {
		throw new Error(`Ask caller content nodes missing; rendered=${JSON.stringify(askNativeText)}`);
	}
	expectValue(collectStrings(nativeProps(rawSubmitChoice).label).join(""), "Submit", "Ask translated caller option label", askNativeText);
	expectValue(collectStrings(nativeProps(rawSettingsChoice).label).join(""), "Settings", "Ask translated caller option label", askNativeText);
	expectValue(collectStrings(nativeProps(rawSubmitChoice).detail).join(""), "Settings", "Ask translated caller option description", askNativeText);
	expectValue(nativeProps(callerQuestion).text, "Submit", "Ask translated caller question", askNativeText);
	expectValue(nativeProps(callerPreview).text, "Other…", "Ask translated caller preview", askNativeText);
	const otherRow = itemNode(askNodes, "other");
	const rawOtherChoice = itemNode(askNodes, "option:1");
	const rawHighChoice = itemNode(askNodes, "option:3");
	const rawCollisionChoice = itemNode(askNodes, "option:4");
	const localizedOtherChoice = itemNode(askNodes, "option:5");
	if (!localizedOtherChoice) throw new Error(`Localized collision option missing; rendered=${JSON.stringify(askNativeText)}`);
	const localizedOtherLabel = collectStrings(nativeProps(localizedOtherChoice).label).join("");
	if (mode === "translated") {
		const fixedOtherLabel = expectedText("Other…");
		expect(localizedOtherLabel.startsWith(fixedOtherLabel) && localizedOtherLabel !== fixedOtherLabel,
			"Ask did not disambiguate a caller option matching the translated custom-answer label", askNativeText);
	} else {
		expectValue(localizedOtherLabel, localizedOtherOptionValue, "Ask translated unrelated caller option content", askNativeText);
	}
	expect(otherRow !== undefined, "Ask native description lost the custom-answer sentinel row", askNativeText);
	expect(rawOtherChoice !== undefined && collectStrings(nativeProps(rawOtherChoice).label).includes("Other…"),
		"Ask native description translated the caller's Other… option", askNativeText);
	expect(rawHighChoice !== undefined && collectStrings(nativeProps(rawHighChoice).label).includes("high"),
		"Ask native description translated the caller's raw high value", askNativeText);
	expect(rawCollisionChoice !== undefined && collectStrings(nativeProps(rawCollisionChoice).label).join("").includes("Other (type your own)"),
		"Ask native collision disambiguation lost the caller's canonical sentinel-like option", askNativeText);
	expectFixed(collectStrings(nativeProps(otherRow).label).join(""), "Other…", askNativeText);
	expectFixed(collectStrings(nativeProps(otherRow).detail).join(""), "Type your own answer", askNativeText);
	const noteButton = actionNode(askNodes, "note");
	expect(noteButton !== undefined, "Ask native Note action ID changed", askNativeText);
	expectFixed(collectStrings(noteButton).join(""), "Note", askNativeText);
	const noteTitle = collectStrings(nativeProps(noteButton).title).join("");
	const noteTitleKeys = [
		"Add a note to the highlighted answer  n",
		"Add a note to the highlighted answer, or to the one just picked  n",
	] as const;
	expect(noteTitleKeys.some(key => noteTitle.includes(expectedText(key))),
		"Ask Note action lost its answer-target hint or n key", askNativeText);
	if (currentScrollingAsk) {
		const cancelButton = actionNode(askNodes, "cancel");
		const submitButton = actionNode(askNodes, "submit");
		expect(cancelButton !== undefined && submitButton !== undefined, "Current Ask native action IDs changed", askNativeText);
		expectFixed(collectStrings(cancelButton).join(""), "Cancel", askNativeText);
		expectFixed(collectStrings(submitButton).join(""), "Submit", askNativeText);
	} else {
		const hideButton = actionNode(askNodes, "hide");
		const skipButton = actionNode(askNodes, "cancel");
		expect(hideButton !== undefined && skipButton !== undefined, "Legacy Ask native action IDs changed", askNativeText);
		expectFixed(collectStrings(hideButton).join(""), "Hide", askNativeText);
		expectFixed(collectStrings(skipButton).join(""), "Skip", askNativeText);
		expectKeyTooltip(nativeProps(hideButton).title, "Hide until you are ready to answer  {key}", askNativeText);
		expectKeyTooltip(nativeProps(skipButton).title, "Skip without answering  {key}", askNativeText);
	}
}

if (currentScrollingAsk) {
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:4" });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:5" });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "other" });
	await Promise.resolve();
	await Promise.resolve();
	const customAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
	if (mode === "hostile") {
		// The host caps folded chips independently of the ANSI render width.
		expect(customAnsi.includes("恶意文案(Other: “Ot…"), "Current Ask lost the clipped hostile Other chip", customAnsi);
	} else {
		expectFixed(customAnsi, "Other: “{answer}”", customAnsi, { answer: "Other…" });
	}
	const customNative = ask.describe?.(nativeContext(false));
	expectFoldedOther(customNative, expectedText("Other: “{answer}”", { answer: "Other…" }), collectStrings(customNative).join("\n"));
	ask.handleNativeEvent?.({ type: "action", key: "q0", act: "open:0", mods: [] });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:3" });
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "note", mods: [] });
	await Promise.resolve();
	await Promise.resolve();
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "submit", mods: [] });
	expect(!askResult, "Current Ask submitted before opening its first unanswered question", customAnsi);
	const partialNative = ask.describe ? collectStrings(ask.describe(nativeContext(false))).join("\n") : customAnsi;
	expectFixed(partialNative, "{answered} of {total} answered", partialNative, { answered: 1, total: 2 });
	expect(partialNative.includes("Settings"), "Current Ask did not open the first unanswered question", partialNative);
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "submit", mods: [] });
} else if (askNativeAvailable && askNativeEventsAvailable) {
	ask.handleNativeEvent?.({ type: "select", key: "tabs", item: "submit" });
	const unansweredAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
	const unansweredNative = ask.describe ? ask.describe(nativeContext(false)) : askNative;
	const unansweredText = collectStrings(unansweredNative).join("\n");
	expectFixed(unansweredAnsi, "{count} unanswered questions; {enter} still submits.", unansweredAnsi,
		{ count: 2, enter: enterHint });
	expectFixed(unansweredText, "{count} unanswered", unansweredText, { count: 2 });
	expectFixed(unansweredText, " · Submit still sends {rest}", unansweredText, { rest: expectedText("the questions") });
	expectFixed(unansweredText, "Unanswered", unansweredText);
	ask.handleNativeEvent?.({ type: "select", key: "tabs", item: "0" });
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "hide", mods: [] });
	const hiddenAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
	const hiddenNative = ask.describe ? ask.describe(nativeContext(false)) : askNative;
	const hiddenText = collectStrings(hiddenNative).join("\n");
	expectFixed(hiddenAnsi, "hidden:", hiddenAnsi);
	expectFixed(hiddenAnsi, "show", hiddenAnsi);
	expectFixed(hiddenText, "Question", hiddenText);
	expectFixed(hiddenText, "{count} more", hiddenText, { count: 1 });
	const showButton = actionNode(collectNodes(hiddenNative), "show");
	expect(showButton !== undefined, "Hidden Ask native action ID changed", hiddenText);
	expectFixed(collectStrings(showButton).join(""), "Show", hiddenText);
	expectKeyTooltip(nativeProps(showButton).title, "Show the question  {key}", hiddenText);
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "show", mods: [] });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:4" });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:5" });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "other" });
	await Promise.resolve();
	await Promise.resolve();
	ask.handleNativeEvent?.({ type: "select", key: "tabs", item: "0" });
	ask.handleNativeEvent?.({ type: "select", key: "q0", item: "option:3" });
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "note", mods: [] });
	await Promise.resolve();
	await Promise.resolve();
	ask.handleNativeEvent?.({ type: "select", key: "tabs", item: "1" });
	ask.handleNativeEvent?.({ type: "select", key: "q1", item: "option:0" });
	ask.handleNativeEvent?.({ type: "select", key: "tabs", item: "submit" });
	const reviewAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
	const reviewNative = ask.describe ? ask.describe(nativeContext(false)) : askNative;
	const reviewText = collectStrings(reviewNative).join("\n");
	expectFixed(reviewAnsi, "Review answers", reviewAnsi);
	expectFixed(reviewAnsi, "Other: “{answer}”", reviewAnsi, { answer: "Other…" });
	expectFixed(reviewAnsi, "Note:", reviewAnsi);
	expect(reviewText.includes("Other…"), "Ask review lost the original custom answer", reviewText);
	expectFixed(reviewText, "All answered · Submit sends them", reviewText);
	const submitButton = actionNode(collectNodes(reviewNative), "submit");
	expect(submitButton !== undefined, "Ask native submit action ID changed", reviewText);
	expectFixed(collectStrings(submitButton).join(""), "Submit", reviewText);
	expectFixed(reviewAnsi, "Submit", reviewAnsi);
	expectFixed(collectStrings(nativeProps(submitButton).title).join(""), "Submit answers  enter", reviewText);
	ask.handleNativeEvent?.({ type: "action", key: "actions", act: "submit", mods: [] });
} else {
	for (let index = 0; index < 4; index++) ask.handleInput("\x1b[B");
	ask.handleInput(" ");
	ask.handleInput("\x1b[B");
	ask.handleInput(" ");
	ask.handleInput("\x1b[B");
	ask.handleInput("\r");
	await Promise.resolve();
	await Promise.resolve();
	ask.handleInput("\x1b[Z");
	for (let index = 0; index < 3; index++) ask.handleInput("\x1b[A");
	ask.handleInput(" ");
	ask.handleInput("n");
	await Promise.resolve();
	await Promise.resolve();
	ask.handleInput("\t");
	ask.handleInput(" ");
	ask.handleInput("\t");
	const keyboardReviewAnsi = Bun.stripANSI(ask.render(renderWidth).join("\n"));
	expectFixed(keyboardReviewAnsi, "Review answers", keyboardReviewAnsi);
	expectFixed(keyboardReviewAnsi, "Other: “{answer}”", keyboardReviewAnsi, { answer: "Other…" });
	expectFixed(keyboardReviewAnsi, "Note:", keyboardReviewAnsi);
	ask.handleInput("\r");
}
expect(!askCancelled, "Ask probe unexpectedly cancelled", askAnsi);
if (!askResult) throw new Error(`Ask callback did not receive a submit result; rendered=${JSON.stringify(askAnsi)}`);
expectValue(askResult.kind, "submit", "Ask changed the submit callback kind", askAnsi);
if (askPrompts.length !== 2) throw new Error(`Ask expected custom-answer and note prompts; captured=${askPrompts.length} rendered=${JSON.stringify(askAnsi)}`);
const customPrompt = askPrompts[0];
const notePrompt = askPrompts[1];
if (!customPrompt || !notePrompt) throw new Error(`Ask prompt payloads were incomplete; rendered=${JSON.stringify(askAnsi)}`);
expectValue(customPrompt.title, expectedText("Custom answer"), "Ask changed the custom-answer prompt heading", askAnsi);
expectValue(customPrompt.question, "Submit", "Ask changed the custom-answer prompt question", askAnsi);
expectValue(notePrompt.title, expectedText("Note for {option}", { option: "high" }), "Ask translated or changed the option label in a note prompt", askAnsi);
expectValue(notePrompt.question, "Submit", "Ask changed the note prompt question", askAnsi);
const firstAskResult = askResult.results[0];
const secondAskResult = askResult.results[1];
if (!firstAskResult || !secondAskResult) throw new Error(`Ask callback lost question results; rendered=${JSON.stringify(askAnsi)}`);
	expectValue(firstAskResult.id, "id", "Ask changed the question ID", askAnsi);
	expectValue(firstAskResult.question, "Submit", "Ask changed the caller question", askAnsi);
	expectValue(firstAskResult.options, ["Submit", "Other…", "Settings", "high", "Other (type your own)", localizedOtherOptionValue],
		"Ask changed canonical option values or sentinel collision inputs", askAnsi);
	expectValue(firstAskResult.selectedOptions, ["high", "Other (type your own)", localizedOtherOptionValue], "Ask changed canonical selected option values", askAnsi);
expectValue(firstAskResult.customInput, "Other…", "Ask changed the custom-answer value", askAnsi);
if (currentScrollingAsk) expectValue(firstAskResult.noteOption, "high", "Ask changed the option attached to the note", askAnsi);
expectValue(firstAskResult.note, "Other…", "Ask changed the note value", askAnsi);
expectValue(secondAskResult.id, "high", "Ask changed the second question ID", askAnsi);
expectValue(secondAskResult.question, "Settings", "Ask changed the second caller question", askAnsi);
expectValue(secondAskResult.options, ["Other…", "Settings"], "Ask changed second-question option values", askAnsi);
	expectValue(secondAskResult.selectedOptions, currentScrollingAsk ? [] : ["Other…"], "Ask returned changed or translated partial answers", askAnsi);
if (currentScrollingAsk) {
	// Static workspace imports would bypass the launch-selected, source-transformed TUI package.
	const formDialogPath = Bun.resolveSync("@oh-my-pi/pi-tui/html-form/dialog", launch.host.packageDir);
	const formParserPath = Bun.resolveSync("@oh-my-pi/pi-tui/html-form/parse", launch.host.packageDir);
	const formDialogApi = await import(pathToFileURL(formDialogPath).href) as HtmlFormDialogApi;
	const formParser = await import(pathToFileURL(formParserPath).href) as HtmlFormParserApi;
	const htmlForm = formParser.parseHtmlForm(`<form>
		<input type="hidden" name="token" value="Settings">
		<fieldset>
			<legend>Settings</legend>
			<p>Choose a feature</p>
			<label><input type="checkbox" name="features" value="submit-value" checked required>Submit</label>
			<label><input type="checkbox" name="features" value="settings-value">Settings</label>
			<label><input type="checkbox" name="features" value="high-value">high</label>
			<label><input type="checkbox" name="features" value="id-value">id</label>
			<label><input type="checkbox" name="features" value="other-value">Keep Other…</label>
		</fieldset>
		<fieldset>
			<legend>Response</legend>
			<label for="response">Settings</label>
			<input id="response" name="response" type="text">
		</fieldset>
	</form>`);
	let formResult: Record<string, unknown> | undefined;
	let formNotes: readonly unknown[] | undefined;
	let formCancelled = false;
	const form = new formDialogApi.HtmlFormDialog(htmlForm, {
		onSubmit(data, notes) { formResult = data; formNotes = notes; },
		onCancel() { formCancelled = true; },
	});
	const formAnsi = Bun.stripANSI(form.render(renderWidth).join("\n"));
	const formNative = form.describe?.(nativeContext(false));
	if (!formNative || !form.handleNativeEvent || !form.givenAnswers) {
		throw new Error("Current HTML Ask form must expose its transformed native card and answer API");
	}
	const formNativeText = collectStrings(formNative).join("\n");
	const formNodes = collectNodes(formNative);
	expect(formNodes.some(node => nativeProps(node).role === "omp.ask.card"),
		"Current HTML Ask form did not render the scrolling card", formNativeText);
	const formCancelButton = actionNode(formNodes, "cancel");
	const formSubmitButton = actionNode(formNodes, "submit");
	expect(formCancelButton !== undefined && formSubmitButton !== undefined,
		"Current HTML Ask form native actions changed", formNativeText);
	expectFixed(collectStrings(formCancelButton).join(""), "Cancel", formNativeText);
	expectFixed(collectStrings(formSubmitButton).join(""), "Submit", formNativeText);
	expectFixed(formAnsi, "Ask", formAnsi);
	expectFixed(formAnsi, "Other: ", formAnsi);
	expectFixed(formAnsi, "type your own", formAnsi);
	expectNativeAskTag(formNodes, formNativeText);
	expectFixed(formNativeText, "{answered} of {total} answered", formNativeText, { answered: 1, total: 2 });
	expectFixed(formNativeText, "Other…", formNativeText);
	expectFixed(formNativeText, "type your answer", formNativeText);
	expectFixed(formNativeText, "Answer this question", formNativeText);
	expect(formNativeText.includes("Submit") && formNativeText.includes("Settings") && formNativeText.includes("high") &&
		formNativeText.includes("id") && formNativeText.includes("Keep Other…"),
		"Current HTML Ask form translated caller labels or field content", formNativeText);
	form.handleNativeEvent({ type: "select", key: "f0", item: "other" });
	for (const character of "custom reply") form.handleInput(character);
	const customFormAnsi = Bun.stripANSI(form.render(renderWidth).join("\n"));
	expectFixed(customFormAnsi, "Other: ", customFormAnsi);
	const partialForm = form.givenAnswers();
	if (!partialForm) throw new Error(`Current HTML Ask form lost the partial answer; rendered=${formAnsi}`);
	expectValue(partialForm.data, { features: ["submit-value", "custom reply"] },
		"Current HTML Ask form changed partial field values", formNativeText);
	expectValue(partialForm.notes, [], "Current HTML Ask form changed partial option notes", formNativeText);
	form.handleInput("\t");
	const foldedFormNative = form.describe?.(nativeContext(false));
	if (!foldedFormNative) throw new Error("Current HTML Ask form did not describe its folded state");
	const foldedFormText = collectStrings(foldedFormNative).join("\n");
	expectFixed(foldedFormText, "Show every option", foldedFormText);
	expectFoldedOther(foldedFormNative, `${expectedText("Other: ")}custom reply`, foldedFormText);
	form.handleNativeEvent({ type: "action", key: "actions", act: "submit", mods: [] });
	expect(!formCancelled && formResult !== undefined, "Current HTML Ask form did not submit through its native action", foldedFormText);
	expectValue(formResult, { token: "Settings", features: ["submit-value", "custom reply"], response: "" },
		"Current HTML Ask form changed submitted form fields or hidden values", foldedFormText);
	expectValue(formNotes, [], "Current HTML Ask form changed submitted notes", foldedFormText);
	form.dispose();
	const singleFieldFormsSubmit = readFileSync(formDialogPath, "utf8").includes('const next = this.#sole ? "submit" : "next";');
	if (singleFieldFormsSubmit) {
		const keybindingRegistryPath = Bun.resolveSync("@oh-my-pi/pi-tui/keybindings", launch.host.packageDir);
		// Use HtmlFormDialog's launch-selected registry, not a separate workspace module instance.
		const keybindingRegistry = await import(pathToFileURL(keybindingRegistryPath).href) as KeybindingRegistryApi;
		const noteBindings = keybindings.KeybindingsManager.inMemory();
		const [noteKey] = noteBindings.getKeys("app.ask.note");
		if (!noteKey) throw new Error("In-memory app bindings must expose a form note key");
		const fieldCases = [
			{ kind: "text", html: '<label>Submit<input name="Settings" value="Other…" placeholder="high"></label>', value: "Other…" },
			{ kind: "textarea", html: '<label>Submit<textarea name="Settings" placeholder="high">Other…</textarea></label>', value: "Other…" },
			{ kind: "radio", html: '<label><input type="radio" name="Settings" value="id">Submit</label><label><input type="radio" name="Settings" value="high" checked>Settings</label>', value: "high" },
			{ kind: "checkbox", html: '<label><input type="checkbox" name="Settings" value="Other…">Submit</label>', value: "Other…" },
			{ kind: "select", html: '<label>Submit<select name="Settings"><option value="id">Settings</option><option value="Other…">high</option></select></label>', value: "Other…" },
			{ kind: "other", html: '<label><input type="radio" name="Settings" value="id">Submit</label><label><input type="radio" name="Settings" value="high">Settings</label>', value: "Other…" },
		] as const;
		for (const fieldCase of fieldCases) {
			for (const singleField of [true, false]) {
				const context = `${fieldCase.kind} ${singleField ? "single-field" : "multi-field"} form`;
				const trailingField = singleField ? "" : '<label>Settings<input name="extra" value="id"></label>';
				const parsed = formParser.parseHtmlForm(`<form><input type="hidden" name="token" value="Settings">${fieldCase.html}${trailingField}</form>`);
				let submitted: Record<string, unknown> | undefined;
				let notes: readonly unknown[] | undefined;
				let submissions = 0;
				let cancelled = false;
				const sample = new formDialogApi.HtmlFormDialog(parsed, {
					onSubmit(data, capturedNotes) { submitted = data; notes = capturedNotes; submissions++; },
					onCancel() { cancelled = true; },
				});
				if (fieldCase.kind === "other") {
					if (!sample.handleNativeEvent) throw new Error(`${context} lost its native Other action`);
					sample.handleNativeEvent({ type: "select", key: "f0", item: "other" });
					for (const character of "Other…") sample.handleInput(character);
				}
				const hints = Bun.stripANSI(sample.keyHints?.() ?? "");
				const next = expectedText(singleField ? "submit" : "next");
				let action: string;
				switch (fieldCase.kind) {
					case "other":
						action = `${expectedText("type your own")} · ${enterHint} ${next}`;
						break;
					case "select":
						action = expectedText("{space} open · {left}/{right} change · {enter} {next}", {
							space: keybindings.formatKeyHint("space"), left: keybindings.formatKeyHint("left"),
							right: keybindings.formatKeyHint("right"), enter: enterHint, next,
						});
						break;
					case "checkbox":
						action = expectedText("{space} toggle · {enter} {next}", { space: keybindings.formatKeyHint("space"), enter: enterHint, next });
						break;
					case "radio":
						action = `${enterHint} ${expectedText(singleField ? "submit" : "choose")}`;
						break;
					default:
						action = `${enterHint} ${next}`;
				}
				expect(hints.startsWith(action), `${context} displayed the wrong Enter action`, hints);
				if (fieldCase.kind === "checkbox" || fieldCase.kind === "radio") {
					if (!sample.handleNativeEvent || !sample.describe) throw new Error(`${context} lost its native note actions`);
					// Bare TUI bindings omit app.ask.note; test the note path with the host's in-memory app bindings.
					const previousBindings = keybindingRegistry.getKeybindings();
					try {
						keybindingRegistry.setKeybindings(noteBindings);
						const noteHints = Bun.stripANSI(sample.keyHints?.() ?? "");
						expectFixed(noteHints, " · {key} note", noteHints, { key: keybindings.formatKeyHint(noteKey) });
						const noteButton = actionNode(collectNodes(sample.describe(nativeContext(false))), "note");
						if (!noteButton || typeof noteButton.key !== "string") throw new Error(`${context} lost its Note button identity`);
						sample.handleNativeEvent({ type: "action", key: noteButton.key, act: "note", mods: [] });
						const noteEditor = sample.describe(nativeContext(false));
						const noteEditorText = collectStrings(noteEditor).join("\n");
						expectFixed(noteEditorText, "Keep", noteEditorText);
						expectFixed(noteEditorText, "Save", noteEditorText);
						const keepButton = actionNode(collectNodes(noteEditor), "cancel");
						if (!keepButton || typeof keepButton.key !== "string") throw new Error(`${context} lost its Keep button identity`);
						sample.handleNativeEvent({ type: "action", key: keepButton.key, act: "cancel", mods: [] });
					} finally {
						keybindingRegistry.setKeybindings(previousBindings);
					}
				}
				if (fieldCase.kind === "select") {
					// Type-ahead still searches the original option label, not its translation.
					sample.handleInput("h");
					sample.handleInput(" ");
					const dropdownHints = Bun.stripANSI(sample.keyHints?.() ?? "");
					sample.handleInput("\r");
					expectValue(submissions, 0, `${context} submitted while closing its dropdown`, dropdownHints);
				}
				sample.handleInput("\r");
				if (!singleField) {
					expectValue(submissions, 0, `${context} submitted instead of advancing`, hints);
					const trailingHints = Bun.stripANSI(sample.keyHints?.() ?? "");
					expect(trailingHints.startsWith(`${enterHint} ${expectedText("next")}`),
						`${context} changed the trailing field's Enter action`, trailingHints);
					sample.handleInput("\r");
					expectValue(submissions, 0, `${context} skipped its Submit row`, trailingHints);
					const submitHints = Bun.stripANSI(sample.keyHints?.() ?? "");
					expect(submitHints.startsWith(`${enterHint} ${expectedText("submit")}`),
						`${context} changed the Submit row's action`, submitHints);
					sample.handleInput("\r");
				}
				expectValue(submissions, 1, `${context} did not submit exactly once`, hints);
				expectValue(submitted, { token: "Settings", Settings: fieldCase.value, ...(singleField ? {} : { extra: "id" }) },
					`${context} translated or changed submitted values`, hints);
				expectValue(notes, [], `${context} changed option notes`, hints);
				expect(!cancelled, `${context} unexpectedly cancelled`, hints);
				sample.dispose();
			}
		}
	}
}

let approvalApproved = false;
let approvalDenied = false;
let sessionApprovalTaken = false;
const approvalInput: ApprovalOptions = Object.freeze({
	fullPrompt: "Settings\nOther…",
	grants: Object.freeze([Object.freeze({ label: "Other…", alwaysLabel: "Settings" })]),
	session: Object.freeze({ label: "high", onApprove() { sessionApprovalTaken = true; } }),
	draft: Object.freeze({ hasDraft() { return true; }, handleInput() {} }),
});
const approval = new approvalApi.ApprovalDialogComponent("Settings\nSubmit\nOther…", {
	onApprove() { approvalApproved = true; },
	onDeny() { approvalDenied = true; },
}, approvalInput);
	const approvalAnsi = Bun.stripANSI(approval.render(renderWidth).join("\n"));
const approvalNativeAvailable = typeof approval.describe === "function";
const approvalNative = approval.describe ? approval.describe() : undefined;
const approvalNativeText = collectStrings(approvalNative).join("\n");
expect(approvalAnsi.includes("Settings") && approvalAnsi.includes("Submit") && approvalAnsi.includes("Other…") && approvalAnsi.includes("high"),
	"ANSI approval must preserve caller title, details, and grant/session labels", approvalAnsi);
if (approvalNativeAvailable) {
	expect(approvalNativeText.includes("Settings") && approvalNativeText.includes("Submit") && approvalNativeText.includes("Other…") && approvalNativeText.includes("high"),
		"Native approval must preserve caller title, details, and grant/session labels", approvalNativeText);
}
expectFixed(approvalAnsi, "Remember across sessions", approvalAnsi);
expectFixed(approvalAnsi, "Approve Once", approvalAnsi);
expectFixed(approvalAnsi, "Deny and send message", approvalAnsi);
expectFixed(approvalAnsi, "approve", approvalAnsi);
expectFixed(approvalAnsi, "deny", approvalAnsi);
expectFixed(approvalAnsi, "deny and send", approvalAnsi);
expectFixed(approvalAnsi, "details", approvalAnsi);
if (approvalNativeAvailable) {
	const approvalNodes = collectNodes(approvalNative);
	const approvalTitleNode = approvalNodes.find(node => nativeProps(node).role === "omp.approval.title");
	if (!approvalTitleNode) throw new Error(`Approval title node missing; rendered=${JSON.stringify(approvalNativeText)}`);
	expectValue(nativeProps(approvalTitleNode).text, "Settings", "Approval translated caller title", approvalNativeText);
	for (const id of ["remember", "grant0", "once", "session", "deny"]) {
		expect(itemNode(approvalNodes, id) !== undefined, `Approval choice ID changed: ${id}`, approvalNativeText);
	}
	for (const id of ["approve", "deny", "expand"]) {
		expect(actionNode(approvalNodes, id) !== undefined, `Approval action ID changed: ${id}`, approvalNativeText);
	}
	expectFixed(approvalNativeText, "Remember across sessions", approvalNativeText);
	expectFixed(approvalNativeText, "Approve Once", approvalNativeText);
	expectFixed(approvalNativeText, "Deny", approvalNativeText);
	expectFixed(approvalNativeText, "Details", approvalNativeText);
	const grantRow = itemNode(approvalNodes, "grant0");
	const sessionRow = itemNode(approvalNodes, "session");
	if (!grantRow || !sessionRow) throw new Error(`Approval choice rows missing; rendered=${JSON.stringify(approvalNativeText)}`);
	expectValue(collectStrings(nativeProps(grantRow).label).join(""), "Other…", "Approval changed caller grant label", approvalNativeText);
	expectValue(collectStrings(nativeProps(sessionRow).label).join(""), "high", "Approval changed caller session label", approvalNativeText);
	if (approval.handleNativeEvent && approval.describe) {
		// Selecting Remember only changes this component's local checkbox; no approval callback is invoked.
		approval.handleNativeEvent({ type: "select", key: "choices", item: "remember" });
		const rememberedNodes = collectNodes(approval.describe());
		const rememberedGrant = itemNode(rememberedNodes, "grant0");
		if (!rememberedGrant) throw new Error(`Remembered grant row missing; rendered=${JSON.stringify(approvalNativeText)}`);
		expectValue(collectStrings(nativeProps(rememberedGrant).label).join(""), "Settings", "Approval changed the caller's always-label", approvalNativeText);
		approval.handleNativeEvent({ type: "select", key: "choices", item: "remember" });
	}
	const approveButton = actionNode(approvalNodes, "approve");
	const denyButton = actionNode(approvalNodes, "deny");
	const expandButton = actionNode(approvalNodes, "expand");
	if (!approveButton || !denyButton || !expandButton) throw new Error(`Approval action nodes missing; rendered=${JSON.stringify(approvalNativeText)}`);
	expectKeyTooltip(nativeProps(approveButton).title, "Approve this call  {key}", approvalNativeText);
	expectKeyTooltip(nativeProps(denyButton).title, "Deny this call  {key}", approvalNativeText);
	expectTemplatePrefix(nativeProps(expandButton).title, "Show every detail of this call  {key}", approvalNativeText);
}
expect(approval.toggleDetails(), "Approval details did not expand", approvalNativeText);
	const expandedApprovalAnsi = Bun.stripANSI(approval.render(renderWidth).join("\n"));
expectFixed(expandedApprovalAnsi, "less", expandedApprovalAnsi);
if (approvalNativeAvailable && approval.describe) {
	const expandedNodes = collectNodes(approval.describe());
	const expandedAction = actionNode(expandedNodes, "expand");
	if (!expandedAction) throw new Error(`Expanded approval action missing; rendered=${JSON.stringify(expandedApprovalAnsi)}`);
	expectTemplatePrefix(nativeProps(expandedAction).title, "Summarize this call  {key}", JSON.stringify(expandedApprovalAnsi));
	expectFixed(collectStrings(expandedAction).join(""), "Less", expandedApprovalAnsi);
}
const simpleApproval = new approvalApi.ApprovalDialogComponent("Settings\nSubmit", {
	onApprove() { approvalApproved = true; },
	onDeny() { approvalDenied = true; },
}, { draft: { hasDraft() { return false; }, handleInput() {} } });
	const simpleApprovalAnsi = Bun.stripANSI(simpleApproval.render(renderWidth).join("\n"));
	expectFixed(simpleApprovalAnsi, "type to deny and steer", simpleApprovalAnsi);
	expectFixed(simpleApprovalAnsi, "choose", simpleApprovalAnsi);
	expectFixed(simpleApprovalAnsi, "select", simpleApprovalAnsi);
expectFixed(simpleApprovalAnsi, "Approve", simpleApprovalAnsi);
	expectFixed(simpleApprovalAnsi, "Deny", simpleApprovalAnsi);
if (simpleApproval.describe) expectFixed(collectStrings(simpleApproval.describe()).join("\n"), "Approve", simpleApprovalAnsi);
if (approval.handleNativeEvent) approval.handleNativeEvent({ type: "action", key: "actions", act: "deny", mods: [] });
else approval.handleInput("\x1b");
expect(approvalDenied && !approvalApproved && !sessionApprovalTaken,
	"Captured approval callback did not preserve Deny without an approval side effect", `${approvalNativeText}\n${expandedApprovalAnsi}`);
approval.dispose();
simpleApproval.dispose();

let hookSelected: string | undefined;
let hookCancelled = false;
const hookOptions: readonly HookOption[] = Object.freeze([
	Object.freeze({ label: "Submit", description: "Settings" }),
	Object.freeze({ label: "Other…" }),
	Object.freeze({ label: "Settings" }),
	Object.freeze({ label: "high" }),
]);
const hook = new hookApi.HookSelectorComponent("Other…\nSettings", hookOptions,
	option => { hookSelected = option; }, () => { hookCancelled = true; }, { maxVisible: 3 });
	const hookAnsi = Bun.stripANSI(hook.render(renderWidth).join("\n"));
const hookNativeAvailable = typeof hook.describe === "function";
const hookPickerNative = hook.describe ? hook.describe(nativeContext(true)) : undefined;
const hookPickerNodes = collectNodes(hookPickerNative);
const pickerNode = hookPickerNodes.find(node => node.k === "picker");
const pickerProps = nativeProps(pickerNode);
expectFixed(hookAnsi, "Type to search", hookAnsi);
expectFixed(hookAnsi, "navigate", hookAnsi);
expectFixed(hookAnsi, "select", hookAnsi);
expectFixed(hookAnsi, "cancel", hookAnsi);
expect(hookAnsi.includes("Other…") && hookAnsi.includes("Settings") && hookAnsi.includes("Submit"),
	"ANSI hook selector changed caller title or option values", hookAnsi);
if (hookNativeAvailable) {
	expect(pickerNode !== undefined, "Native hook selector did not expose its picker", JSON.stringify(hookPickerNative));
	expectValue(pickerProps.noun, expectedText("options"), "Native hook picker noun was not translated", JSON.stringify(pickerProps));
	expectValue(pickerProps.empty, expectedText("No matching options"), "Native hook empty state was not translated", JSON.stringify(pickerProps));
	expectValue(pickerProps.title, "Other…", "Hook selector translated caller title", JSON.stringify(pickerProps));
	expectValue(pickerProps.subtitle, "Settings", "Hook selector translated caller title detail", JSON.stringify(pickerProps));
	const pickerItems = Array.isArray(pickerProps.items) ? pickerProps.items : [];
	const pickerLabels = collectStrings(pickerItems).join("\n");
	expect(pickerLabels.includes("Submit") && pickerLabels.includes("Other…") && pickerLabels.includes("Settings") && pickerLabels.includes("high"),
		"Native hook picker translated caller option values", pickerLabels);
	const submitItem = pickerItems.find(item => item !== null && typeof item === "object" && !Array.isArray(item) &&
		"label" in item && item.label === "Submit");
	if (!submitItem || typeof submitItem !== "object" || Array.isArray(submitItem) || !("detail" in submitItem)) {
		throw new Error(`Hook picker lost the caller's Submit option detail; rendered=${JSON.stringify(pickerLabels)}`);
	}
	expectValue(submitItem.detail, "Settings", "Hook picker translated the caller's option detail", pickerLabels);
	const actions = Array.isArray(pickerProps.actions) ? pickerProps.actions : [];
	for (const id of ["confirm", "close"]) {
		expect(actions.some(action => action !== null && typeof action === "object" && !Array.isArray(action) &&
			"id" in action && action.id === id), `Hook native action ID changed: ${id}`, JSON.stringify(pickerProps));
	}
	const confirmAction = actions.find(action => action !== null && typeof action === "object" && !Array.isArray(action) &&
		"id" in action && action.id === "confirm");
	const closeAction = actions.find(action => action !== null && typeof action === "object" && !Array.isArray(action) &&
		"id" in action && action.id === "close");
	if (!confirmAction || !closeAction) throw new Error(`Hook picker actions missing; rendered=${JSON.stringify(pickerProps)}`);
	expectFixed(collectStrings(confirmAction).join(""), "Select", JSON.stringify(pickerProps));
	expectFixed(collectStrings(closeAction).join(""), "Close", JSON.stringify(pickerProps));
	const cardNative = hook.describe ? hook.describe(nativeContext(false)) : undefined;
	const cardText = collectStrings(cardNative).join("\n");
	expectFixed(cardText, "navigate", cardText);
	expectFixed(cardText, "select", cardText);
	expectFixed(cardText, "cancel", cardText);
	expectFixed(cardText, "No matching options", cardText);
}
let emptyHookSelected = false;
let emptyHookCancelled = false;
const emptyHook = new hookApi.HookSelectorComponent("Settings", Object.freeze([]),
	() => { emptyHookSelected = true; }, () => { emptyHookCancelled = true; }, { maxVisible: 3 });
	const emptyHookAnsi = Bun.stripANSI(emptyHook.render(renderWidth).join("\n"));
expectFixed(emptyHookAnsi, "No matching options", emptyHookAnsi);
expect(emptyHookAnsi.includes("Settings"), "Empty hook selector changed its caller title", emptyHookAnsi);
if (emptyHook.describe) {
	const emptyPicker = collectNodes(emptyHook.describe(nativeContext(true))).find(node => node.k === "picker");
	expectValue(nativeProps(emptyPicker).empty, expectedText("No matching options"), "Empty native hook state was not translated", JSON.stringify(emptyPicker));
	expectValue(nativeProps(emptyPicker).title, "Settings", "Empty hook picker translated its caller title", JSON.stringify(emptyPicker));
}
expect(!emptyHookSelected && !emptyHookCancelled, "Empty hook probe invoked a callback", emptyHookAnsi);
emptyHook.dispose();
for (const character of "high") hook.handleInput(character);
	const searchedHookAnsi = Bun.stripANSI(hook.render(renderWidth).join("\n"));
expectFixed(searchedHookAnsi, "Search:", searchedHookAnsi);
expect(searchedHookAnsi.includes("high"), "Hook search rewrote the user query", searchedHookAnsi);
const searchedNative = hook.describe ? hook.describe(nativeContext(true)) : undefined;
const searchedPickerNode = collectNodes(searchedNative).find(node => node.k === "picker");
if (searchedPickerNode) expectValue(nativeProps(searchedPickerNode).query, "high", "Native hook query was translated", JSON.stringify(searchedPickerNode));
	if (hook.describe) {
		const searchedCard = hook.describe(nativeContext(false));
		const searchedCardText = collectStrings(searchedCard).join("\n");
		expectFixed(searchedCardText, "Search:", searchedCardText);
		expect(searchedCardText.includes("high"), "Native hook search card changed its caller query", searchedCardText);
	}
expect(hookSelected === undefined && !hookCancelled, "Hook probe invoked a selection or cancellation callback", hookAnsi);
hook.dispose();
expect(injectionState.__zhompDialogInjected === false, "Hostile dictionary text executed as JavaScript", `${askAnsi}\n${approvalAnsi}\n${hookAnsi}`);

console.log(JSON.stringify({
	mode,
	component: "DialogMenus",
	modules: DIALOG_MENU_MODULES.map(module => `${module.root}:${module.path}`),
	ask: {
		title: mode === "ordinary" ? "Ask" : expectedText("Ask"),
		selected: firstAskResult.selectedOptions,
		questionIds: askResult.results.map(result => result.id),
		optionValuesPreserved: true,
		native: askNativeAvailable ? "described" : "native describe unavailable; ANSI renderer and keyboard path exercised",
		nativeEvents: askNativeEventsAvailable ? "exercised" : "unavailable; keyboard path exercised",
	},
	approval: {
		native: approvalNativeAvailable ? "described" : "native describe unavailable; ANSI renderer exercised",
		denyPath: approval.handleNativeEvent ? "captured native deny action" : "captured Escape keyboard action",
		choiceIds: ["remember", "grant0", "once", "session", "deny"],
		actionIds: ["approve", "deny", "expand"],
		denyCallbackCaptured: approvalDenied,
		approveCallbackInvoked: approvalApproved,
		sessionCallbackInvoked: sessionApprovalTaken,
	},

	hook: {
		native: hookNativeAvailable ? "picker and card descriptions exercised" : "native describe unavailable; ANSI renderer and keyboard path exercised",
		selected: hookSelected ?? null,
	},
	fixedCopyTranslated: mode !== "ordinary",
	callerTextPreserved: true,
	hostileTextLiteral: mode !== "hostile" || injectionState.__zhompDialogInjected === false,
}));
