import { ok, strictEqual } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type * as NodeFs from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface Renderable {
	render(width: number): readonly string[];
}

interface MCPReport {
	title: string;
	body: Renderable;
}

interface MCPControllerApi {
	MCPCommandController: new (context: { showCommandReport(report: MCPReport): void }) => {
		handle(text: string): Promise<void>;
	};
	MCPAuthorizationLinkPrompt: new (url: string, launchUrl?: string) => {
		render(width: number): readonly string[];
		describe(): unknown;
	};
}

interface MCPAddWizardApi {
	MCPAddWizard: new (
		deps: {
			validateServerName(name: string): string | undefined;
			analyzeAuthError(error: Error, serverUrl?: string): { requiresAuth: boolean };
			discoverOAuthEndpoints(
				serverUrl: string,
				authServerUrl?: string,
				resourceMetadataUrl?: string,
				options?: { protectedScopes?: string },
			): Promise<null>;
			fetchResourceMetadataScopes(resourceMetadataUrl: string): Promise<string | undefined>;
		},
		onComplete: (name: string, config: unknown, scope: "user" | "project") => void,
		onCancel: () => void,
	) => {
		render(width: number): readonly string[];
		describe(context: DescribeContext): unknown;
		dispose?(): void;
	};
}

interface ReportPanelInstance {
	nativeOverlay: { head?: unknown };
	render(width: number): readonly string[];
	describe(): unknown;
	dispose(): void;
}

interface ReportPanelApi {
	ReportPanel: new (options: {
		title: string;
		body: Renderable;
		closeKey: string;
		onClose: () => void;
	}) => ReportPanelInstance;
}

interface DescribeContext {
	cols: number;
	dark: boolean;
	reduceMotion: boolean;
	feature(name: string): boolean;
	supports(kind: string): boolean;
}

interface HubRecord {
	id: string;
	displayName: string;
	kind: "main" | "sub" | "advisor";
	parentId?: string;
	status: "running" | "idle" | "parked" | "aborted";
	session: null;
	sessionFile: null;
	createdAt: number;
	lastActivity: number;
}

interface HubRegistry {
	list(): HubRecord[];
	get(id: string): HubRecord | undefined;
	onChange(listener: () => void): () => void;
}

interface HubObservers {
	getSessions(): never[];
	getSession(id: string): undefined;
	onChange(listener: (kind: "main" | "reset" | "lifecycle" | "progress") => void): () => void;
}

interface AgentActivityRow {
	id: string;
	agentId: string;
	timestamp: number;
	kind: "response" | "tool" | "irc" | "lifecycle";
	title: string;
	summary: string;
	status?: "pending" | "success" | "error" | "aborted";
	entryId?: string;
	toolCallId?: string;
	toolName?: string;
	from?: string;
	to?: string;
	replyTo?: string;
	source: "live" | "transcript" | "irc";
}

interface HubActivity {
	setLive(agentId: string, rows: AgentActivityRow[]): void;
	sync(agentId: string, sessionFile: string | null): Promise<void>;
	query(query: {
		agentIds?: ReadonlySet<string>;
		kinds?: ReadonlySet<AgentActivityRow["kind"]>;
		search?: string;
		before?: { timestamp: number; id: string };
		limit?: number;
	}): AgentActivityRow[];
	recent(agentId: string, limit: number): AgentActivityRow[];
}

interface AgentTranscriptSource {
	fs: Pick<typeof NodeFs, "openSync" | "closeSync" | "readSync" | "readFileSync" | "statSync"> & {
		promises?: Pick<typeof NodeFs.promises, "readFile">;
	};
	parseEntries(text: string): never[];
}

interface HubDependencies {
	observers: HubObservers;
	transcript: AgentTranscriptSource;
	loadPersisted(shouldContinue: () => boolean): Promise<void>;
	hubKeys: string[];
	onDone(): void;
	requestRender(): void;
	registry: HubRegistry;
	lifecycle: () => {
		ensureLive(id: string): Promise<{ prompt(text: string, options: { streamingBehavior: "steer" }): Promise<unknown> }>;
		release(id: string, expected: HubRecord, options: { tombstone: true }): Promise<boolean>;
	};
	irc: { unreadCount(id: string): number };
	activity: HubActivity;
	manageActivityLive: false;
	initialSection: "agents" | "activity";
}

interface AgentHubInstance {
	persistedSubagentsReady: Promise<void>;
	render(width: number): readonly string[];
	describe(context: DescribeContext): unknown;
	dispose(): void;
}

interface AgentHubApi {
	AgentHubOverlayComponent: new (deps: HubDependencies) => AgentHubInstance;
}

interface AgentHubMetricProbe {
	cost: number;
	durationMs: number;
	durationKind?: "active" | "span" | "unknown";
	requests: number;
	tools: number;
	tokens: number;
}

interface AgentHubRendererApi {
	modelBadge(ref: unknown, observed: undefined): string | undefined;
	modelBadgeSpans(ref: unknown, observed: undefined): unknown;
	formatMetricDuration(metrics: AgentHubMetricProbe): string | undefined;
	formatMetrics(metrics: AgentHubMetricProbe): string;
	metricsText(metrics: AgentHubMetricProbe): string;
	taskSummary(task: string): string;
}

interface SessionInfoContext {
	tokens: number;
	contextWindow: number;
	percent: number;
}

interface SessionInfoInstance {
	nativeOverlay: { head: string };
	render(width: number): readonly string[];
	describe(context: DescribeContext): unknown;
	dispose(): void;
}

interface SessionInfoApi {
	SessionInfoOverlay: new (
		host: { terminal: { rows: number } },
		info: string,
		onClose: () => void,
		context?: SessionInfoContext,
	) => SessionInfoInstance;
}

interface SessionObserverApi {
	SessionObserverRegistry: new () => HubObservers;
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function plainText(value: string): string {
	return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function collectCopyTargets(value: unknown, targets: { href: string; title: unknown; menu: unknown }[] = []): { href: string; title: unknown; menu: unknown }[] {
	if (Array.isArray(value)) {
		for (const child of value) collectCopyTargets(child, targets);
		return targets;
	}
	if (typeof value !== "object" || value === null) return targets;
	const node = value as Record<string, unknown>;
	const actions = node.actions;
	if (typeof node.href === "string" && typeof actions === "object" && actions !== null && !Array.isArray(actions) &&
		(actions as Record<string, unknown>).click === "copy") {
		targets.push({ href: node.href, title: node.title, menu: (actions as Record<string, unknown>).menu });
	}
	for (const child of Object.values(node)) collectCopyTargets(child, targets);
	return targets;
}

function displayText(surface: string, rendered: string, source: string, suffix = "", ordinaryCaption = source): void {
	let display = mode === "ordinary" ? ordinaryCaption : source;
	if (mode === "translated") {
		const translation = shippedDictionary[source];
		if (translation === undefined) throw new Error(`Installed dictionary is missing fixed display key ${JSON.stringify(source)}`);
		display = translation;
	} else if (mode === "hostile") {
		const translation = hostileTranslations[source] ?? shippedDictionary[source];
		if (translation === undefined) throw new Error(`Installed dictionary is missing fixed display key ${JSON.stringify(source)}`);
		display = translation;
	}
	const expected = `${display}${suffix}`;
	const searchable = rendered.startsWith("{") ? rendered.replaceAll("\\\"", "\"") : rendered;
	ok(searchable.includes(expected), `${surface} expected ${JSON.stringify(expected)}; rendered ${JSON.stringify(rendered)}`);
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = requiredEnv("OMP_ZH_CONFIG");
const probeRoot = requiredEnv("PROBE_DIR");
if (!existsSync(probeRoot)) throw new Error(`Probe directory does not exist: ${probeRoot}`);

const installDir = dirname(configPath);
const installedHost = (await import(pathToFileURL(join(installDir, "host.ts")).href)) as InstalledHostApi;
const launch = installedHost.readLaunchConfig(configPath);
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const hostileText = '恶意文案"; globalThis.__zhompManagementInjected = true; // $&';
const hostileTranslations: Readonly<Record<string, string>> = {
	"MCP Server Management": hostileText,
	"Manage Model Context Protocol (MCP) servers for external tool integrations.": `${hostileText}-intro`,
	"Open authorization URL:": `${hostileText}-open-url`,
	"Click here to authorize": `${hostileText}-authorize`,
	"Copy URL:": `${hostileText}-copy-url-label`,
	"Local shortcut (this machine only):": `${hostileText}-local-only`,
	"Copy URL": `${hostileText}-copy-tooltip`,
	"Alternative if browser did not open:": `${hostileText}-alternative`,
	"OAuth Authorization Required": `${hostileText}-oauth-title`,
	"Preparing browser authorization...": `${hostileText}-preparing`,
	"Attempting to open browser...": `${hostileText}-opening-browser`,
	"Authorization completed in browser.": `${hostileText}-completed`,
	"Agent Hub": `${hostileText}-hub`,
	"Session info": `${hostileText}-native`,
	"Session Info": `${hostileText}-ansi`,
	"fallback →": `${hostileText}-fallback`,
	active: `${hostileText}-active`,
	span: `${hostileText}-span`,
	duration: `${hostileText}-duration`,
	"time —": `${hostileText}-time`,
};
if (mode === "hostile") {
	const dictionary = {
		...shippedDictionary,
		...hostileTranslations,
		"management-probe-session-8f91": "恶意-session-id",
		"/probe/fixtures/management-session.jsonl": "恶意-session-path",
		Settings: "恶意-provider-name",
		"probe-model-v7": "恶意-model-id",
		"ProbeLspServer.Raw": "恶意-lsp-name",
		"ProbeMcpServer.Raw": "恶意-mcp-name",
		"oauth-runtime-state": "恶意-enum-value",
		"typescript,jsonl": "恶意-file-types",
		"/mcp add <name>": "恶意-command-syntax",
		"--scope project|user": "恶意-command-flag",
	};
	writeFileSync(join(probeRoot, "management-hostile-dictionary.json"), JSON.stringify(dictionary), "utf8");
	process.env.OMP_ZH_DICT = join(probeRoot, "management-hostile-dictionary.json");
} else {
	process.env.OMP_ZH_DICT = launch.dictPath;
}
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompManagementInjected?: boolean }).__zhompManagementInjected = false;

const installedExtension = (await import(pathToFileURL(launch.extensionPath).href)) as InstalledExtensionApi;
await installedExtension.preparePreloadDisplayTranslations(launch, configPath);

const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
const theme = (await import(pathToFileURL(themePath).href)) as ThemeApi;
theme.initThemeSync("unicode");

const tuiModulePath = (relativePath: string): string => join(launch.host.tuiDir, "src", ...relativePath.split("/"));
const agentModulePath = (relativePath: string): string => join(launch.host.packageDir, "src", ...relativePath.split("/"));
const mcpControllerPath = agentModulePath("modes/controllers/mcp-command-controller.ts");
const mcpControllerSource = readFileSync(mcpControllerPath, "utf8");
const mcpControllerModule = (await import(
	pathToFileURL(mcpControllerPath).href
)) as MCPControllerApi;
// Load the installed wizard from LaunchConfig; a static import would test the checkout instead.
const mcpWizardModule = (await import(pathToFileURL(tuiModulePath("overlays/mcp-add-wizard.ts")).href)) as MCPAddWizardApi;
const reportPanelModule = (await import(
	pathToFileURL(tuiModulePath("overlays/report-panel.ts")).href
)) as ReportPanelApi;
// Resolve the installed TUI source from LaunchConfig; a static import would target the checkout instead.
const agentHubRendererModule = (await import(
	pathToFileURL(tuiModulePath("overlays/agent-hub-renderer.ts")).href
)) as AgentHubRendererApi;
const agentHubModule = (await import(pathToFileURL(tuiModulePath("overlays/agent-hub.ts")).href)) as AgentHubApi;
const sessionInfoModule = (await import(
	pathToFileURL(tuiModulePath("overlays/session-info-overlay.ts")).href
)) as SessionInfoApi;
const observerModule = (await import(
	pathToFileURL(tuiModulePath("overlays/session-observer-registry.ts")).href
)) as SessionObserverApi;

const authorizationUrl = "https://auth.example.test/authorize?client_id=probe%2Fid&state=opaque%2Btoken";
const localShortcutUrl = "http://127.0.0.1:43123/callback?code=short%2Fpath";
const oauthCaptionKeys = [
	"Open authorization URL:",
	"Click here to authorize",
	"Copy URL:",
	"Local shortcut (this machine only):",
	"Copy URL",
	"Alternative if browser did not open:",
	"OAuth Authorization Required",
	"Preparing browser authorization...",
	"Attempting to open browser...",
	"Authorization completed in browser.",
];
if (mode === "translated") {
	for (const source of oauthCaptionKeys) {
		const translation = shippedDictionary[source];
		if (translation === undefined || translation === source || !/[\u3400-\u9fff]/u.test(translation)) {
			throw new Error(`MCP OAuth label is not translated into Chinese: ${JSON.stringify(source)}`);
		}
	}
}

const authorizationPrompt = new mcpControllerModule.MCPAuthorizationLinkPrompt(authorizationUrl, localShortcutUrl);
const authorizationAnsi = authorizationPrompt.render(240).join("\n");
const authorizationNative = JSON.stringify(authorizationPrompt.describe());
for (const [surface, rendered] of [["ANSI", authorizationAnsi], ["native", authorizationNative]] as const) {
	displayText(`MCP OAuth ${surface} authorization URL caption`, rendered, "Open authorization URL:");
	displayText(`MCP OAuth ${surface} authorize link`, rendered, "Click here to authorize");
	displayText(`MCP OAuth ${surface} copy URL caption`, rendered, "Copy URL:");
	displayText(`MCP OAuth ${surface} local shortcut caption`, rendered, "Local shortcut (this machine only):");
	for (const url of [authorizationUrl, localShortcutUrl]) {
		ok(rendered.includes(url), `MCP OAuth ${surface} changed URL bytes ${JSON.stringify(url)}`);
	}
}
const oauthCopyTargets = collectCopyTargets(authorizationPrompt.describe());
ok(oauthCopyTargets.length === 2, `MCP OAuth expected two URL copy targets; found ${oauthCopyTargets.length}`);
ok(oauthCopyTargets.some(target => target.href === authorizationUrl), "MCP OAuth authorization copy target changed its URL payload");
ok(oauthCopyTargets.some(target => target.href === localShortcutUrl), "MCP OAuth local shortcut copy target changed its URL payload");
ok(authorizationNative.includes('"href":"' + authorizationUrl + '"'), "MCP OAuth authorization link href changed");
ok(authorizationNative.includes('"click":"open"') && authorizationNative.includes('"menu":["open","copy"]'), "MCP OAuth authorization link actions changed");
const tooltipTranslations = mode === "hostile" ? hostileTranslations : shippedDictionary;
const expectedCopyTooltip = mode === "ordinary" ? "Copy URL" : tooltipTranslations["Copy URL"];
ok(oauthCopyTargets.every(target => target.title === expectedCopyTooltip), "MCP OAuth copy tooltip payload changed unexpectedly");
ok(oauthCopyTargets.every(target => JSON.stringify(target.menu) === '["copy","open"]'), "MCP OAuth copy actions changed");

const fallbackSelector = "probe-provider/probe-model-v7";
const fallbackAgent = {
	id: "management-probe-fallback-agent",
	displayName: "Fallback model probe",
	kind: "sub",
	status: "running",
	session: {
		thinkingLevel: undefined,
		model: undefined,
		servingModel: { selector: fallbackSelector, isFallback: true },
	},
	sessionFile: null,
	createdAt: 1,
	lastActivity: 1,
};
const fallbackBadgeAnsi = plainText(agentHubRendererModule.modelBadge(fallbackAgent, undefined) ?? "");
const fallbackBadgeNative = JSON.stringify({ spans: agentHubRendererModule.modelBadgeSpans(fallbackAgent, undefined) });
displayText("Agent Hub fallback marker ANSI", fallbackBadgeAnsi, "fallback →");
displayText("Agent Hub fallback marker native", fallbackBadgeNative, "fallback →");
ok(fallbackBadgeAnsi.includes(fallbackSelector), "Agent Hub fallback badge changed its model selector");
ok(fallbackBadgeNative.includes(fallbackSelector), "Agent Hub native fallback badge changed its model selector");

const userTask = "probe-model-v7: preserve this task text";
strictEqual(agentHubRendererModule.taskSummary(userTask), userTask, "Agent Hub changed dynamic task output");
const metricProbe: AgentHubMetricProbe = { cost: 1.25, durationMs: 0, requests: 3, tools: 4, tokens: 5 };
for (const [durationKind, source] of [["active", "active"], ["span", "span"], ["unknown", "duration"]] as const) {
	const rendered = agentHubRendererModule.formatMetricDuration({ ...metricProbe, durationMs: 5_000, durationKind });
	if (!rendered) throw new Error(`Agent Hub ${source} duration was unexpectedly omitted`);
	displayText(`Agent Hub ${source} duration caption`, rendered, source);
	ok(/^\d/.test(rendered), `Agent Hub ${source} duration lost its measured value`);
}

const missingTimeAnsi = plainText(agentHubRendererModule.formatMetrics(metricProbe));
const missingTimeNative = agentHubRendererModule.metricsText(metricProbe);
displayText("Agent Hub missing-time ANSI caption", missingTimeAnsi, "time —");
displayText("Agent Hub missing-time native caption", missingTimeNative, "time —");
for (const rendered of [missingTimeAnsi, missingTimeNative]) {
	for (const value of ["3 req", "4 tools", "5 tok"]) {
		ok(rendered.includes(value), `Agent Hub metrics changed technical unit/value ${JSON.stringify(value)}; rendered ${JSON.stringify(rendered)}`);
	}
}

const mcpReport = await (async (): Promise<{ title: string; body: string; panel: ReportPanelInstance }> => {
	let captured: MCPReport | undefined;
	const controller = new mcpControllerModule.MCPCommandController({
		showCommandReport(report) {
			captured = report;
		},
	});
	await controller.handle("/mcp help");
	if (!captured) throw new Error("/mcp help did not render a command report");
	const panel = new reportPanelModule.ReportPanel({
		title: captured.title,
		body: captured.body,
		closeKey: "Esc",
		onClose: () => {},
	});
const ansi = plainText(panel.render(240).join("\n"));
const native = JSON.stringify(panel.describe());
ok(native.length > 0, "MCP help report panel must produce a native description");
const body = plainText(captured.body.render(240).join("\n"));
	return { title: plainText(String(panel.nativeOverlay.head ?? captured.title)), body: `${ansi}\n${body}`, panel };
})();

const smitheryHelpDescriptions = [
	{ source: "Search Smithery registry and deploy from picker" },
	{ source: "Login to Smithery and cache API key" },
	{ source: "Remove cached Smithery API key" },
];
const helpDescriptions: readonly { source: string }[] = [
	{ source: "Add a new MCP server (interactive wizard)" },
	{ source: "List all configured MCP servers" },
	{ source: "Remove an MCP server (default: project)" },
	{ source: "Test connection to an MCP server" },
	{ source: "Reauthorize OAuth for an MCP server" },
	{ source: "Remove OAuth auth from an MCP server" },
	{ source: "Enable an MCP server" },
	{ source: "Disable an MCP server" },
	...smitheryHelpDescriptions.filter(item => mcpControllerSource.includes(item.source)),
	{ source: "Reconnect to a specific MCP server" },
	{ source: "Force reload and rediscover MCP runtime tools" },
	{ source: "List available resources from connected servers" },
	{ source: "List available prompts from connected servers" },
	{ source: "Show notification capabilities and subscription state" },
	{ source: "Show this help message" },
];

displayText("MCP help title", mcpReport.title, "MCP Server Management");
displayText("MCP help introduction", mcpReport.body, "Manage Model Context Protocol (MCP) servers for external tool integrations.");
displayText("MCP help command heading", mcpReport.body, "Commands:");
for (const item of helpDescriptions) displayText("MCP help explanation", mcpReport.body, item.source);
const mcpSyntax = [
	"/mcp add              Add a new MCP server (interactive wizard)",
	"/mcp add <name> [--scope project|user] [--url <url> --transport http|sse] [--token <token>] [-- <command...>]",
	"/mcp list             List all configured MCP servers",
	"/mcp remove <name> [--scope project|user]    Remove an MCP server (default: project)",
	"/mcp test <name>      Test connection to an MCP server",
	"/mcp reauth <name>    Reauthorize OAuth for an MCP server",
	"/mcp unauth <name>    Remove OAuth auth from an MCP server",
	"/mcp enable <name>    Enable an MCP server",
	"/mcp disable <name>   Disable an MCP server",
	...(mcpControllerSource.includes("Search Smithery registry and deploy from picker") ? [
		"/mcp smithery-search <keyword> [--scope project|user] [--limit <1-100>] [--semantic]",
		"/mcp smithery-search",
	] : []),
	...(mcpControllerSource.includes("Login to Smithery and cache API key") ? ["/mcp smithery-login   Login to Smithery and cache API key"] : []),
	...(mcpControllerSource.includes("Remove cached Smithery API key") ? ["/mcp smithery-logout  Remove cached Smithery API key"] : []),
	"/mcp reconnect <name> Reconnect to a specific MCP server",
	"/mcp reload           Force reload and rediscover MCP runtime tools",
	"/mcp resources        List available resources from connected servers",
	"/mcp prompts          List available prompts from connected servers",
	"/mcp notifications    Show notification capabilities and subscription state",
	"/mcp help             Show this help message",
];
for (const syntax of mcpSyntax) {
	const expectedSyntax: string = mode === "ordinary" ? syntax : translatedHelpSyntax(syntax, helpDescriptions);
	ok(mcpReport.body.includes(expectedSyntax), `MCP help changed command syntax ${JSON.stringify(syntax)}; rendered ${JSON.stringify(mcpReport.body)}`);
}

const blockedFs: AgentTranscriptSource["fs"] = {
	openSync() {
		throw new Error("Agent Hub probe must not open files");
	},
	closeSync() {
		throw new Error("Agent Hub probe must not close file descriptors");
	},
	readSync() {
		throw new Error("Agent Hub probe must not read files");
	},
	readFileSync() {
		throw new Error("Agent Hub probe must not read files");
	},
	statSync() {
		throw new Error("Agent Hub probe must not stat files");
	},
};
const emptyRegistry: HubRegistry = { list: () => [], get: () => undefined, onChange: () => () => {} };
const selectedAgent: HubRecord = {
	id: "management-probe-agent-42",
	displayName: "Agent Hub",
	kind: "sub",
	parentId: "Main",
	status: "idle",
	session: null,
	sessionFile: null,
	createdAt: 1_790_000_000_000,
	lastActivity: 1_790_000_000_000,
};
const selectedRegistry: HubRegistry = {
	list: () => [selectedAgent],
	get: id => id === selectedAgent.id ? selectedAgent : undefined,
	onChange: () => () => {},
};
const activity: HubActivity = {
	setLive: () => {},
	sync: async () => {},
	query: () => [],
	recent: () => [],
};
let lifecycleCalls = 0;
const makeHub = (
	initialSection: "agents" | "activity",
	registry: HubRegistry = emptyRegistry,
): AgentHubInstance =>
	new agentHubModule.AgentHubOverlayComponent({
		observers: new observerModule.SessionObserverRegistry(),
		transcript: { fs: blockedFs, parseEntries: () => [] },
		loadPersisted: async () => {},
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		lifecycle: () => {
			lifecycleCalls++;
			return {
				ensureLive: async () => {
					throw new Error("Agent Hub lifecycle actions are blocked in this probe");
				},
				release: async () => false,
			};
		},
		irc: { unreadCount: () => 0 },
		activity,
		manageActivityLive: false,
		initialSection,
	});

const nativeContext = (supportsPicker: boolean): DescribeContext => ({
	cols: 120,
	dark: true,
	reduceMotion: true,
	feature: () => false,
	supports: kind => supportsPicker && kind === "picker",
});

const mcpWizard = new mcpWizardModule.MCPAddWizard(
	{
		validateServerName: () => undefined,
		analyzeAuthError: () => ({ requiresAuth: false }),
		discoverOAuthEndpoints: async () => null,
		fetchResourceMetadataScopes: async () => undefined,
	},
	() => {},
	() => {},
);
let mcpWizardAnsi: string;
let mcpWizardNative: string;
try {
	mcpWizardAnsi = plainText(mcpWizard.render(160).join("\n"));
	mcpWizardNative = JSON.stringify(mcpWizard.describe(nativeContext(false)));
} finally {
	mcpWizard.dispose?.();
}
displayText("MCP wizard ANSI step title", mcpWizardAnsi, "Name the server");
displayText("MCP wizard native step title", mcpWizardNative, "Name the server");
for (const phase of ["Name", "Transport", "Connection", "Auth", "Scope", "Review"]) {
	displayText("MCP wizard native progress phase", mcpWizardNative, phase);
}

const rosterHub = makeHub("agents");
const detailHub = makeHub("agents", selectedRegistry);
const activityHub = makeHub("activity");
let hubOutput: {
	rosterAnsi: string;
	rosterNative: string;
	pickerNative: string;
	detailAnsi: string;
	detailNative: string;
	activityAnsi: string;
	activityNative: string;
	activityPicker: string;
};
try {
	await Promise.all([
		rosterHub.persistedSubagentsReady,
		detailHub.persistedSubagentsReady,
		activityHub.persistedSubagentsReady,
	]);
	hubOutput = {
		rosterAnsi: plainText(rosterHub.render(120).join("\n")),
		rosterNative: JSON.stringify(rosterHub.describe(nativeContext(false))),
		pickerNative: JSON.stringify(rosterHub.describe(nativeContext(true))),
		detailAnsi: plainText(detailHub.render(120).join("\n")),
		detailNative: JSON.stringify(detailHub.describe(nativeContext(false))),
		activityAnsi: plainText(activityHub.render(120).join("\n")),
		activityNative: JSON.stringify(activityHub.describe(nativeContext(false))),
		activityPicker: JSON.stringify(activityHub.describe(nativeContext(true))),
	};
} finally {
	rosterHub.dispose();
	detailHub.dispose();
	activityHub.dispose();
}
strictEqual(lifecycleCalls, 0, "empty and selected-agent Agent Hub fixtures must not reach lifecycle actions");
ok(hubOutput.detailAnsi.includes(selectedAgent.displayName), "ANSI Agent Hub must preserve a dynamic display name that collides with its title");
ok(hubOutput.detailNative.includes(selectedAgent.displayName), "native Agent Hub must preserve a dynamic display name that collides with its title");

displayText("Agent Hub ANSI title", hubOutput.rosterAnsi, "Agent Hub");
displayText("Agent Hub native title", hubOutput.rosterNative, "Agent Hub");
displayText("Agent Hub picker title", hubOutput.pickerNative, "Agents");
displayText("Agent Hub roster heading", hubOutput.rosterAnsi, "Roster");
displayText("Agent Hub native roster heading", hubOutput.rosterNative, "Roster");
displayText("Agent Hub flat view", hubOutput.rosterAnsi, "Flat");
displayText("Agent Hub native parent view", hubOutput.rosterNative, "By parent");
displayText("Agent Hub roster empty state", hubOutput.rosterAnsi, "No agents in this session");
displayText("Agent Hub native roster empty state", hubOutput.rosterNative, "No agents in this session");
displayText("Agent Hub detail empty state", hubOutput.rosterNative, "Select an agent to inspect");
displayText("Agent Hub recent activity heading", hubOutput.detailNative, "Recent activity");
displayText("Agent Hub recent activity empty state", hubOutput.detailNative, "No response or tool activity yet");
displayText("Agent Hub ANSI recent activity heading", hubOutput.detailAnsi, "Recent activity");
displayText("Agent Hub ANSI recent activity empty state", hubOutput.detailAnsi, "No response or tool activity yet");
displayText("Agent Hub activity ANSI title", hubOutput.activityAnsi, "Agent Hub");
displayText("Agent Hub activity native title", hubOutput.activityNative, "Agent Hub");
displayText("Agent Hub activity empty state", hubOutput.activityAnsi, "No agent activity recorded yet");
displayText("Agent Hub native activity empty state", hubOutput.activityNative, "No agent activity recorded yet");
displayText("Agent Hub activity picker empty state", hubOutput.activityPicker, "No agent activity recorded yet");
displayText("Agent Hub activity search placeholder", hubOutput.activityPicker, "Search activity…");
for (const label of ["select", "transcript", "follow", "filter", "scope", "search", "close", "revive", "kill"]) {
	const combined = `${hubOutput.rosterAnsi}\n${hubOutput.rosterNative}\n${hubOutput.pickerNative}\n${hubOutput.activityAnsi}\n${hubOutput.activityNative}\n${hubOutput.activityPicker}`;
	displayText("Agent Hub fixed action hint", combined, label);
}

const dim = "\u001b[2m";
const resetForeground = "\u001b[39m";
const bold = "\u001b[1m";
const resetBold = "\u001b[22m";
const keyValue = (key: string, value: string): string => `${dim}${key}:${resetForeground} ${value}`;
const heading = (value: string): string => `${bold}${value}${resetBold}`;
const sessionId = "management-probe-session-8f91";
const sessionPath = "/probe/fixtures/management-session.jsonl";
const provider = "Settings";
const model = "probe-model-v7";
const authState = "oauth-runtime-state";
const lspName = "Settings";
const mcpName = "Agent Hub";
const sessionReport = [
	keyValue("File", sessionPath),
	keyValue("ID", sessionId),
	keyValue("Build", "build-digest-7f2a"),
	keyValue("Running", "runtime-build-9.8.7"),
	"",
	heading("Provider"),
	keyValue("Name", provider),
	keyValue("Model", model),
	keyValue("API", "probe-api/raw"),
	keyValue("Auth", authState),
	keyValue("Endpoint", "https://probe.invalid/v1"),
	keyValue("Source", "credential-source-raw"),
	keyValue("Transport", "websocket"),
	"",
	heading("Messages"),
	keyValue("User", "12"),
	keyValue("Assistant", "8"),
	keyValue("Tool Calls", "4"),
	keyValue("Tool Results", "3"),
	keyValue("Total", "27"),
	keyValue("Append-Only", "active (setting: auto)"),
	"",
	heading("Tokens"),
	keyValue("Input", "1,234"),
	keyValue("Output", "567"),
	keyValue("Cache Read", "80"),
	keyValue("Cache Write", "20"),
	keyValue("Total", "1,901"),
	"",
	heading("Cost"),
	keyValue("Total", "0.1250"),
	keyValue("Premium Requests", "2"),
	keyValue("Credits", "0.75"),
	keyValue("Committed Credits", "0.25"),
	keyValue("Committed ACU", "3"),
	"",
	heading("LSP Servers"),
	keyValue(lspName, "ready (typescript,jsonl)"),
	"",
	heading("MCP Servers"),
	keyValue(mcpName, "connected (3 tools)"),
].join("\n");

const sessionInfo = new sessionInfoModule.SessionInfoOverlay(
	{ terminal: { rows: 80 } },
	sessionReport,
	() => {},
	{ tokens: 1432, contextWindow: 8192, percent: 17.48 },
);
let sessionOutput: { ansi: string; native: string; nativeTitle: string };
try {
	const native = sessionInfo.describe(nativeContext(false));
	sessionOutput = {
		ansi: plainText(sessionInfo.render(120).join("\n")),
		native: JSON.stringify(native),
		nativeTitle: sessionInfo.nativeOverlay.head,
	};
} finally {
	sessionInfo.dispose();
}

displayText("Session Info ANSI title", sessionOutput.ansi, "Session Info");
displayText("Session Info native title", sessionOutput.nativeTitle, "Session info");
displayText("Session Info provider section", sessionOutput.ansi, "Provider");
displayText("Session Info native provider section", sessionOutput.native, "Provider");
displayText("Session Info file field", sessionOutput.ansi, "File", ":");
displayText("Session Info ID field", sessionOutput.ansi, "ID", ":");
displayText("Session Info messages section", sessionOutput.native, "Messages");
displayText("Session Info token section", sessionOutput.native, "Tokens");
displayText("Session Info total label", sessionOutput.native, "Total");
displayText("Session Info LSP section", sessionOutput.native, "LSP Servers", "", "LSP servers");
displayText("Session Info MCP section", sessionOutput.native, "MCP Servers", "", "MCP servers");
displayText("Session Info context label", sessionOutput.native, "Context window");
displayText("Session Info footer scroll label", sessionOutput.ansi, "scroll");
displayText("Session Info footer close label", sessionOutput.ansi, "close");
for (const value of [sessionPath, sessionId, provider, model, authState, lspName, mcpName, "https://probe.invalid/v1"]) {
	ok(sessionOutput.ansi.includes(value), `Session Info ANSI display changed dynamic value ${JSON.stringify(value)}; rendered ${JSON.stringify(sessionOutput.ansi)}`);
	ok(sessionOutput.native.includes(value), `Session Info native display changed dynamic value ${JSON.stringify(value)}; rendered ${JSON.stringify(sessionOutput.native)}`);
}
ok(sessionOutput.native.includes('"key":"id"'), "native Session Info must preserve the canonical ID identity key");
ok(sessionOutput.native.includes('"key":"file"'), "native Session Info must preserve the canonical File identity key");
ok(sessionOutput.native.includes('"role":"omp.info.identity"'), "native Session Info must keep the identity section semantic role");

const injected = (globalThis as typeof globalThis & { __zhompManagementInjected?: boolean }).__zhompManagementInjected;
strictEqual(injected, false, "hostile management-menu dictionary values must remain display data");
if (mode === "hostile") {
	for (const dynamicValue of [sessionPath, sessionId, provider, model, authState, lspName, mcpName]) {
		ok(sessionOutput.native.includes(dynamicValue), `hostile dictionary translated dynamic value ${dynamicValue}`);
	}
}

mcpReport.panel.dispose();
console.log(
	JSON.stringify({
		mode,
		component: "ManagementMenus",
		mcpHelp: { title: mcpReport.title, commandExplanations: helpDescriptions.length, syntaxPreserved: true },
		agentHub: { rosterAndActivityRendered: true, genericNativeAndPickerRendered: true, lifecycleCalls },
		agentHubRenderer: { captionsRendered: true, dynamicModelPreserved: true, reqAndTokUnitsPreserved: true, taskTextPreserved: true },
		sessionInfo: { bothSurfacesRendered: true, dynamicValuesPreserved: true, nativeIdentitySemanticsPreserved: true },
	}),
);

function translatedHelpSyntax(source: string, translations: readonly { source: string }[]): string {
	let result = source;
	for (const entry of translations) {
		const translation = shippedDictionary[entry.source];
		if (translation === undefined) throw new Error(`Installed dictionary is missing fixed MCP help key ${JSON.stringify(entry.source)}`);
		result = result.replace(entry.source, translation);
	}
	return result;
}
