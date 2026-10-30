import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import type { MenuModule } from "../runtime/menu-catalog";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}

interface MenuCatalogApi {
	MENU_MODULES: readonly MenuModule[];
}

interface AgentViewMenuApi {
	AGENT_VIEW_MENU_MODULES: readonly MenuModule[];
	AGENT_VIEW_MENU_TEXT_KEYS: readonly string[];
}

interface MenuTextApi {
	translateMenuSource(
		source: string,
		module: MenuModule,
		dictionary: Readonly<Record<string, string>>,
	): { source: string; supported: boolean };
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(capability: string): boolean;
	feature(name: string): boolean;
}

interface Component {
	render(width: number): readonly string[];
	describe?(context: NativeContext): unknown;
	dispose?(): void;
}

interface TranscriptViewer extends Component {
	handleInput(data: string): void;
}

interface TranscriptEntry {
	type: "message";
	id: string;
	parentId: null;
	timestamp: string;
	message: { role: "user"; content: string; timestamp: number };
}

interface AgentReference {
	kind: "subagent";
	status: "running" | "idle" | "parked" | "aborted";
	parentId: string;
	sessionFile?: string;
}

interface FakeStats {
	size: number;
	mtimeMs: number;
	dev: number;
	ino: number;
}

interface TranscriptFileSystem {
	openSync(path: string, flags: string): number;
	closeSync(fd: number): void;
	readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number;
	readFileSync(path: string): Buffer;
	statSync(path: string): FakeStats;
}

interface RemoteTranscriptResult {
	text: string;
	newSize: number;
	error?: string;
}

interface ViewerDependencies {
	agentId: string;
	transcript: {
		fs: TranscriptFileSystem;
		parseEntries(text: string): readonly TranscriptEntry[];
	};
	registry: { get(id: string): AgentReference | undefined };
	remote?: {
		readTranscript(id: string, fromByte: number): Promise<RemoteTranscriptResult | null>;
		chat(id: string, text: string): void;
	};
	lifecycle?: () => {
		ensureLive(id: string): Promise<{ prompt(text: string): Promise<void> }>;
	};
	ui: { terminal: { rows: number } };
	cwd: string;
	expandKeys: string[];
	hubKeys: string[];
	requestRender(): void;
	onClose(): void;
	onHubClose(): void;
}

interface TranscriptViewerApi {
	AgentTranscriptViewer: new (dependencies: ViewerDependencies) => TranscriptViewer;
}

interface AgentProgressFixture {
	id: string;
	status?: string;
	task?: string;
	description?: string;
	recentTools?: readonly { endMs: number; tool: string; args?: string }[];
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartMs?: number;
	lastIntent?: string;
	recentOutput?: readonly string[];
}

interface ActivityRow {
	id: string;
	kind: string;
	title: string;
	summary: string;
	status?: string;
	toolName?: string;
}

interface AgentActivityApi {
	activityRowsFromProgress(progress: AgentProgressFixture, lastUpdate?: number): ActivityRow[];
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}

// Hostile strings test literal safety, not narrow-screen wrapping.
const renderWidth = mode === "hostile" ? 800 : 180;
const configPath = process.env.OMP_ZH_CONFIG;
const probeRootEnv = process.env.PROBE_DIR;
if (!configPath || !probeRootEnv) throw new Error("Missing installed launch config or probe directory");
const probeRoot: string = probeRootEnv;

const installDir = dirname(configPath);
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = hostApi.readLaunchConfig(configPath);
const menuApi = await import(pathToFileURL(join(installDir, "menu-catalog.ts")).href) as MenuCatalogApi;
const agentViewMenuApi = await import(pathToFileURL(join(installDir, "menu-agent-views.ts")).href) as AgentViewMenuApi;
const menuTextApi = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as MenuTextApi;
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const hostileDictionary = Object.fromEntries(agentViewMenuApi.AGENT_VIEW_MENU_TEXT_KEYS.map((key, index) => [
	key,
	`恶意文案-${index}"; globalThis.__zhompAgentViewsInjected = true; //`,
]));
const dictionary = mode === "hostile" ? { ...shippedDictionary, ...hostileDictionary } : shippedDictionary;
const dictionaryPath = mode === "hostile" ? join(probeRoot, "agent-views-hostile-dictionary.json") : launch.dictPath;
if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");

process.env.OMP_ZH_CONFIG = configPath;
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompAgentViewsInjected?: boolean }).__zhompAgentViewsInjected = false;

const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
await extension.preparePreloadDisplayTranslations(launch, configPath);

// Initialize the selected pi-tui theme instance before rendering its overlay.
const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
const themeApi = await import(pathToFileURL(themePath).href) as ThemeApi;
themeApi.initThemeSync("unicode");

const roots: Record<MenuModule["root"], string> = {
	agent: launch.host.packageDir,
	tui: launch.host.tuiDir,
};
const sources = agentViewMenuApi.AGENT_VIEW_MENU_MODULES.map(module => {
	const sourcePath = join(roots[module.root], ...module.path.split("/"));
	if (!existsSync(sourcePath)) throw new Error(`Required Agent Hub display module is missing: ${module.path}@${launch.host.version}`);
	const source = readFileSync(sourcePath, "utf8");
	const registered = menuApi.MENU_MODULES.some(candidate => candidate.root === module.root && candidate.path === module.path);
	if (!registered) throw new Error(`Agent Hub display module is absent from the installed menu catalogue: ${module.path}`);
	return { module, source, sourceSupported: menuTextApi.translateMenuSource(source, module, dictionary).supported };
});
const [viewerSource, activitySource] = sources;
if (!viewerSource || !activitySource) throw new Error("Agent Hub view menu modules were not exported");

function expectedFixed(key: string, supported: boolean): string {
	if (mode !== "ordinary" && supported) {
		const translated = dictionary[key];
		if (!translated || translated === key) {
			throw new Error(`Agent Hub view dictionary is missing a translation for ${JSON.stringify(key)}`);
		}
		if (mode === "translated" && !/\p{Script=Han}/u.test(translated)) {
			throw new Error(`Agent Hub view translation is not Chinese for ${JSON.stringify(key)}: ${JSON.stringify(translated)}`);
		}
		return translated;
	}
	return key;
}

function assertContains(actual: string, expected: string, where: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`${where} did not contain ${JSON.stringify(expected)}; actual output: ${JSON.stringify(actual)}`);
	}
}

function assertDoesNotContain(actual: string, unexpected: string, where: string): void {
	if (actual.includes(unexpected)) {
		throw new Error(`${where} unexpectedly contained ${JSON.stringify(unexpected)}; actual output: ${JSON.stringify(actual)}`);
	}
}

function assertFixed(actual: string, key: string, supported: boolean, where: string): void {
	assertContains(actual, expectedFixed(key, supported), where);
}

function assertNativeText(actual: string, expected: string, where: string): void {
	const encoded = JSON.stringify(expected);
	if (encoded === undefined) throw new Error(`${where} could not be encoded as native text`);
	assertContains(actual, encoded.slice(1, -1), where);
}

function assertNativeDoesNotContain(actual: string, unexpected: string, where: string): void {
	const encoded = JSON.stringify(unexpected);
	if (encoded === undefined) throw new Error(`${where} could not be encoded as native text`);
	if (actual.includes(encoded.slice(1, -1))) {
		throw new Error(`${where} unexpectedly contained ${JSON.stringify(unexpected)}; actual output: ${JSON.stringify(actual)}`);
	}
}

function assertNativeFixed(actual: string, key: string, supported: boolean, where: string): void {
	assertNativeText(actual, expectedFixed(key, supported), where);
}

function assertNativeFixedIfAvailable(actual: string | null, key: string, supported: boolean, where: string): void {
	if (actual !== null) assertNativeFixed(actual, key, supported, where);
}

function assertCanonical(actual: string, value: string, where: string): void {
	assertContains(actual, value, `${where} caller data`);
}


const nativeContext: NativeContext = {
	cols: 180,
	reduceMotion: false,
	dark: false,
	supports() { return true; },
	feature() { return false; },
};
const fixedKeys = agentViewMenuApi.AGENT_VIEW_MENU_TEXT_KEYS;
if (mode !== "ordinary") {
	const missingKeys = fixedKeys.filter(key => !dictionary[key] || dictionary[key] === key);
	deepStrictEqual(missingKeys, [], "Agent Hub view dictionary must cover all exported fixed chrome keys");
}

const viewerModulePath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/agent-transcript-viewer", launch.host.packageDir);
const viewerApi = await import(pathToFileURL(viewerModulePath).href) as TranscriptViewerApi;
const activityModulePath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/agent-activity", launch.host.packageDir);
const activityApi = await import(pathToFileURL(activityModulePath).href) as AgentActivityApi;

let lifecycleCalls = 0;
let chatCalls = 0;
let closeCalls = 0;
let hubCloseCalls = 0;
let remoteCalls = 0;
const probeMessage: TranscriptEntry = {
	type: "message",
	id: "agent-views-probe-entry",
	parentId: null,
	timestamp: "2026-10-23T00:00:00.000Z",
	message: { role: "user", content: "Agent Hub in transcript [raw] — keep this message", timestamp: 1 },
};

function createViewer(options: {
	status: AgentReference["status"];
	session?: "missing" | "empty" | "message";
	remote?: ViewerDependencies["remote"];
	input?: boolean;
}): TranscriptViewer {
	const agentId = `agent-views-probe-${options.status}`;
	const fileContent = options.session === "message" ? Buffer.from("fixture-entry\n") : Buffer.alloc(0);
	const fs: TranscriptFileSystem = {
		openSync() { return 1; },
		closeSync() {},
		readSync() { return 0; },
		readFileSync() { return fileContent; },
		statSync() {
			return { size: fileContent.byteLength, mtimeMs: 1, dev: 1, ino: 1 };
		},
	};
	return new viewerApi.AgentTranscriptViewer({
		agentId,
		transcript: {
			fs,
			parseEntries: () => options.session === "message" ? [probeMessage] : [],
		},
		registry: {
			get(id) {
				return id === agentId ? {
					kind: "subagent",
					status: options.status,
					parentId: "agent-views-probe-parent",
					...(options.session !== "missing" ? { sessionFile: "agent-views-probe-session" } : {}),
				} : undefined;
			},
		},
		remote: options.remote,
		...(options.input === false ? {} : {
			lifecycle: () => ({
				async ensureLive() {
					lifecycleCalls++;
					throw new Error("The Agent Views probe must not revive an agent");
				},
			}),
		}),
		ui: { terminal: { rows: 50 } },
		cwd: probeRoot,
		expandKeys: ["ctrl+o"],
		hubKeys: [],
		requestRender() {},
		onClose() { closeCalls++; },
		onHubClose() { hubCloseCalls++; },
	});
}

function fixedAndDynamicViewerOutput(
	component: Component,
	label: string,
	inputHint: "enabled" | "observe" = "enabled",
): { ansi: string; native: string | null; nativeAvailable: boolean } {
	const rendered = Bun.stripANSI(component.render(renderWidth).join("\n"));
	let native: string | null = null;
	if (typeof component.describe === "function") {
		const serialized = JSON.stringify(component.describe(nativeContext));
		if (serialized === undefined) throw new Error(`${label} native describe output could not be serialized`);
		native = serialized;
	}
	assertFixed(rendered, "Agent Hub", viewerSource.sourceSupported, `${label} title`);
	assertFixed(rendered, "expand", viewerSource.sourceSupported, `${label} expand hint`);
	assertFixed(rendered, "close", viewerSource.sourceSupported, `${label} close hint`);
	assertFixed(rendered, "scroll", viewerSource.sourceSupported, `${label} scroll hint`);
	assertFixed(rendered, "top/bottom", viewerSource.sourceSupported, `${label} top/bottom hint`);
	assertFixed(rendered, "of", viewerSource.sourceSupported, `${label} parent relation`);
	assertCanonical(rendered, "agent-views-probe-parent", `${label} parent id`);
	assertCanonical(rendered, "subagent", `${label} agent kind`);
	if (inputHint === "enabled") {
		assertFixed(rendered, "send", viewerSource.sourceSupported, `${label} send hint`);
		assertFixed(rendered, "empty input →", viewerSource.sourceSupported, `${label} empty-input hint`);
	}
	if (native !== null) {
		assertNativeFixed(native, "Agent Hub", viewerSource.sourceSupported, `${label} native title`);
		assertNativeFixed(native, "expand", viewerSource.sourceSupported, `${label} native expand hint`);
		assertNativeFixed(native, "of", viewerSource.sourceSupported, `${label} native parent relation`);
		assertNativeText(native, "agent-views-probe-parent", `${label} native parent id`);
		assertNativeText(native, "subagent", `${label} native agent kind`);
		if (inputHint === "enabled") assertNativeFixed(native, "send", viewerSource.sourceSupported, `${label} native send hint`);
	}
	return { ansi: rendered, native, nativeAvailable: native !== null };
}

function inspectAbortedInput(
	component: TranscriptViewer,
	initial: { ansi: string; native: string | null },
): "enabled" | "read-only" {
	const sendHint = expectedFixed("send", viewerSource.sourceSupported);
	const emptyInputHint = expectedFixed("empty input →", viewerSource.sourceSupported);
	const sendEnabled = initial.ansi.includes(sendHint);
	strictEqual(initial.ansi.includes(emptyInputHint), sendEnabled, "Aborted viewer send and empty-input hints must match editor availability");
	if (initial.native !== null) {
		if (sendEnabled) assertNativeFixed(initial.native, "send", viewerSource.sourceSupported, "aborted native send hint");
		else assertNativeDoesNotContain(initial.native, sendHint, "aborted native readonly hint");
	}
	const draft = "Agent Hub aborted-input probe [raw]";
	component.handleInput(draft);
	const afterInput = Bun.stripANSI(component.render(renderWidth).join("\n"));
	if (sendEnabled) assertContains(afterInput, draft, "aborted viewer input draft");
	else assertDoesNotContain(afterInput, draft, "aborted viewer readonly input");
	return sendEnabled ? "enabled" : "read-only";
}

const viewerResults: Record<string, { ansi: string; native: string | null; nativeAvailable: boolean }> = {};
const viewers: Component[] = [];
const noSession = createViewer({ status: "running", session: "missing" });
viewers.push(noSession);
viewerResults.noSession = fixedAndDynamicViewerOutput(noSession, "No-session transcript viewer");
assertFixed(viewerResults.noSession.ansi, "No session file available yet.", viewerSource.sourceSupported, "no-session placeholder");
assertNativeFixedIfAvailable(viewerResults.noSession.native, "No session file available yet.", viewerSource.sourceSupported, "native no-session placeholder");

const localEmpty = createViewer({ status: "idle", session: "empty" });
viewers.push(localEmpty);
viewerResults.localEmpty = fixedAndDynamicViewerOutput(localEmpty, "Empty local transcript viewer");
assertFixed(viewerResults.localEmpty.ansi, "No messages yet.", viewerSource.sourceSupported, "empty local placeholder");
assertNativeFixedIfAvailable(viewerResults.localEmpty.native, "No messages yet.", viewerSource.sourceSupported, "native empty local placeholder");

const remoteLoading = createViewer({
	status: "parked",
	remote: {
		readTranscript() {
			remoteCalls++;
			return new Promise(() => {});
		},
		chat() { chatCalls++; },
	},
});
viewers.push(remoteLoading);
viewerResults.remoteLoading = fixedAndDynamicViewerOutput(remoteLoading, "Loading remote transcript viewer");
assertFixed(viewerResults.remoteLoading.ansi, "Loading transcript from host…", viewerSource.sourceSupported, "remote loading placeholder");
assertNativeFixedIfAvailable(viewerResults.remoteLoading.native, "Loading transcript from host…", viewerSource.sourceSupported, "native remote loading placeholder");

const remoteEmpty = createViewer({
	status: "aborted",
	remote: {
		readTranscript() {
			remoteCalls++;
			return Promise.resolve({ text: "", newSize: 0 });
		},
		chat() { chatCalls++; },
	},
});
viewers.push(remoteEmpty);
await Promise.resolve();
viewerResults.remoteEmpty = fixedAndDynamicViewerOutput(remoteEmpty, "Empty remote transcript viewer", "observe");
assertFixed(viewerResults.remoteEmpty.ansi, "No messages yet.", viewerSource.sourceSupported, "empty remote placeholder");
assertNativeFixedIfAvailable(viewerResults.remoteEmpty.native, "No messages yet.", viewerSource.sourceSupported, "native empty remote placeholder");
const abortedInput = inspectAbortedInput(remoteEmpty, viewerResults.remoteEmpty);

const remoteUnavailable = createViewer({
	status: "running",
	remote: {
		readTranscript() {
			remoteCalls++;
			return Promise.resolve(null);
		},
		chat() { chatCalls++; },
	},
});
viewers.push(remoteUnavailable);
await Promise.resolve();
viewerResults.remoteUnavailable = fixedAndDynamicViewerOutput(remoteUnavailable, "Unavailable remote transcript viewer");
assertFixed(viewerResults.remoteUnavailable.ansi, "Transcript lives on the host — not available.", viewerSource.sourceSupported, "remote unavailable placeholder");
assertNativeFixedIfAvailable(viewerResults.remoteUnavailable.native, "Transcript lives on the host — not available.", viewerSource.sourceSupported, "native remote unavailable placeholder");

const remoteErrorMessage = "Agent Hub remote error [raw]";
const remoteError = createViewer({
	status: "running",
	remote: {
		readTranscript() {
			remoteCalls++;
			return Promise.resolve({ text: "", newSize: 0, error: remoteErrorMessage });
		},
		chat() { chatCalls++; },
	},
});
viewers.push(remoteError);
await Promise.resolve();
viewerResults.remoteError = fixedAndDynamicViewerOutput(remoteError, "Remote-error transcript viewer");
assertCanonical(viewerResults.remoteError.ansi, remoteErrorMessage, "remote error message");
if (viewerResults.remoteError.native !== null) {
	assertNativeText(viewerResults.remoteError.native, remoteErrorMessage, "native remote error message");
}

const transcript = createViewer({ status: "idle", session: "message" });
viewers.push(transcript);
viewerResults.transcript = fixedAndDynamicViewerOutput(transcript, "Message transcript viewer");
assertCanonical(viewerResults.transcript.ansi, probeMessage.message.content, "transcript message");

for (const { label, value, result } of [
	{ label: "running status", value: "running", result: viewerResults.noSession },
	{ label: "idle status", value: "idle", result: viewerResults.localEmpty },
	{ label: "parked status", value: "parked", result: viewerResults.remoteLoading },
	{ label: "aborted status", value: "aborted", result: viewerResults.remoteEmpty },
]) {
	assertCanonical(result.ansi, value, label);
	if (result.native !== null) assertNativeText(result.native, value, `${label} native status`);
}

const activityFallbackRows = activityApi.activityRowsFromProgress({ id: "agent-views-fallback" }, 1_000);
const fallbackLifecycle = activityFallbackRows.find(row => row.kind === "lifecycle");
if (!fallbackLifecycle) throw new Error("Agent activity did not produce its lifecycle fallback row");
assertFixed(fallbackLifecycle.summary, "Agent activity", activitySource.sourceSupported, "activity fallback summary");
strictEqual(fallbackLifecycle.title, "running", "Agent activity status fallback must stay a raw state value");

const description = "Probe description [raw]; Agent activity remains caller data";
const descriptionRows = activityApi.activityRowsFromProgress({ id: "agent-views-description", description }, 1_001);
strictEqual(descriptionRows.find(row => row.kind === "lifecycle")?.summary, description, "Agent activity description must remain caller data");

const progressTask = "Probe progress task [raw]; Response remains caller data";
const progressOutput = "Probe response content [raw]";
const progressTool = "probe_tool_name";
const progressRows = activityApi.activityRowsFromProgress({
	id: "agent-views-progress",
	status: "aborted",
	task: progressTask,
	description: "Probe alternate description [raw]",
	recentTools: [{ endMs: 1_010, tool: "probe_recent_tool", args: "raw tool arguments" }],
	currentTool: progressTool,
	currentToolArgs: "current tool arguments [raw]",
	currentToolStartMs: 1_011,
	recentOutput: [progressOutput],
}, 1_012);
const progressLifecycle = progressRows.find(row => row.kind === "lifecycle");
const response = progressRows.find(row => row.kind === "response");
const currentTool = progressRows.find(row => row.toolName === progressTool);
if (!progressLifecycle || !response || !currentTool) throw new Error("Agent progress fixture did not produce expected activity rows");
strictEqual(progressLifecycle.title, "aborted", "Agent progress status must stay raw");
strictEqual(progressLifecycle.status, "aborted", "Agent activity status enum must stay raw");
strictEqual(progressLifecycle.summary, progressTask, "Agent progress task must stay caller data");
strictEqual(response.summary, progressOutput, "Agent progress response must stay caller data");
assertFixed(response.title, "Response", activitySource.sourceSupported, "activity response title");
strictEqual(currentTool.title, progressTool, "Agent tool name must stay caller data");
strictEqual(currentTool.summary, "current tool arguments [raw]", "Agent tool arguments must stay caller data");
strictEqual(progressRows.find(row => row.toolName === "probe_recent_tool")?.title, "probe_recent_tool", "Recent tool names must stay caller data");

for (const viewer of viewers) viewer.dispose?.();
strictEqual(remoteCalls, 4, "Only the isolated in-memory remote transcript fixtures may be read");
deepStrictEqual({ lifecycleCalls, chatCalls, closeCalls, hubCloseCalls }, { lifecycleCalls: 0, chatCalls: 0, closeCalls: 0, hubCloseCalls: 0 }, "The probe must not send messages, revive agents, or invoke host navigation callbacks");
strictEqual((globalThis as typeof globalThis & { __zhompAgentViewsInjected?: boolean }).__zhompAgentViewsInjected, false, "Hostile display text must remain literal rather than executing as code");

console.log(JSON.stringify({
	component: "AgentViews",
	mode,
	renderWidth,
	hostVersion: launch.host.version,
	sources: sources.map(({ module, sourceSupported }) => ({ id: `${module.root}:${module.path}`, sourceSupported })),
	capabilities: {
		viewerNativeDescribe: viewerResults.noSession.nativeAvailable ? "available" : "unavailable",
		viewerNativeCardShell: viewerResults.noSession.nativeAvailable ? "verified" : "unavailable",
	},
	transcriptBody: { ansi: "verified", nativeAssertion: "not-asserted" },
	abortedInput,
	transcript: viewerResults,
	activity: { fallback: fallbackLifecycle, description: descriptionRows.find(row => row.kind === "lifecycle"), progress: progressRows },
	sideEffects: { remoteReads: remoteCalls, lifecycleCalls, chatCalls, closeCalls, hubCloseCalls },
}));
