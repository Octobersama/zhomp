import { strictEqual } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MenuModule } from "../runtime/menu-catalog";
import type { LaunchConfig } from "../runtime/host";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
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
	type: "action" | "activate" | "change" | "select" | "toggle";
	key: string;
	act?: string;
	item?: string;
	value?: unknown;
	mods: readonly string[];
}

interface Component {
	render(width: number): readonly string[];
	describe?(context?: NativeContext): unknown;
	handleInput?(data: string): void;
	handleNativeEvent?(event: NativeEvent): void;
	invalidate?(): void;
	dispose?(): void;
	nativeOverlay?: { head?: string };
}

interface UsageReportFixture {
	provider: string;
	fetchedAt: number;
	limits: readonly {
		id: string;
		label: string;
		scope: { provider: string; accountId?: string; tier?: string; windowId?: string };
		amount: { unit: string; used: number; limit: number; usedFraction?: number };
		status?: string;
		window?: { id: string; label: string; durationMs?: number; resetsAt?: number };
	}[];
	metadata?: Record<string, unknown>;
}

interface UsageDashboardOptions {
	reports: readonly UsageReportFixture[];
	unavailableAccounts?: readonly { provider: string; label: string }[];
	renderDetail(width: number, reports: readonly UsageReportFixture[]): string;
	loadActivity(push: (points: readonly { day: string; cost: number; requests: number }[]) => void, signal: AbortSignal): Promise<void>;
	refresh?: () => Promise<readonly UsageReportFixture[] | null>;
	requestRender(): void;
	onClose(): void;
}

interface UsageDashboardApi {
	UsageDashboardComponent: new (options: UsageDashboardOptions) => Component;
}
interface UsageDisplayApi {
	summarizeUsageResetCredits(
		reset: { availableCount: number; redeemableCount?: number; eligible?: boolean },
		nowMs?: number,
	): { bankedCount: number; redeemableCount: number; unavailableReason?: string } | undefined;
}

interface AdvisorOverlayApi {
	AdvisorConfigOverlayComponent: new (
		tui: object,
		deps: {
			getAvailableModels(): readonly unknown[];
			browserSource: { mruOrder: readonly string[] };
			defaultToolNames: ReadonlySet<string>;
			availableToolNames: readonly string[];
			scopedModels: readonly unknown[];
			defaultModelLabel?: string;
		},
		scope: "project" | "user",
		doc: { advisors: readonly Record<string, unknown>[]; instructions?: string; warnings?: readonly string[] },
		callbacks: {
			loadDoc(scope: "project" | "user"): Promise<unknown>;
			save(scope: "project" | "user", doc: unknown): Promise<void>;
			close(): void;
			requestRender(): void;
			notify(message: string): void;
			getAdvisorStats?(): readonly unknown[];
			getUsageReports?(): Promise<null>;
		},
	) => Component;
}

interface JobsJob {
	id: string;
	type: string;
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	startTime: number;
	ownerId: string;
	agentId: string;
}

interface JobsSnapshot {
	running: readonly JobsJob[];
	recent: readonly JobsJob[];
	rootId: string;
}

interface JobsPanelApi {
	JobsSheet: new (source: {
		load(): JobsSnapshot;
		inspect(id: string): { command?: string; cwd?: string; pids: readonly number[]; exitCode?: number; output?: string; artifactId?: string };
		close(): void;
		cancel?(id: string): void;
	}) => Component;
}

interface ReportPanelApi {
	ReportPanel: new (options: {
		title: string;
		head?: unknown;
		body: Component;
		closeKey: string;
		onClose(): void;
	}) => Component;
}

interface PauseScreenApi {
	PauseScreenComponent: new (
		host: {
			ui: {
				showOverlay(component: Component, options?: unknown): unknown;
				setFocus(component: Component): void;
				requestRender(): void;
				terminal: { rows: number };
			};
			showStatus(message: string, options?: { dim?: boolean }): void;
			sessionName?: string;
		},
		options?: { getWorkStatus?(): { unsettledTurns: number; unfinishedJobs: number } },
	) => Component;
}

interface StatsNoticeApi {
	StatsNotice: new (message: string, url: string) => Component;
}

interface StatsDashboardApi {
	parseStatsDashboardArgs(args: string): { port: number; host: string } | { error: string };
}

interface InstalledMenuApi {
	MENU_MODULES: readonly MenuModule[];
}

interface InstalledDashboardMenuApi {
	DASHBOARD_MENU_MODULES: readonly MenuModule[];
	DASHBOARD_MENU_TEXT_KEYS: readonly string[];
}

interface InstalledMenuTextApi {
	translateMenuSource(source: string, module: MenuModule, dictionary: Readonly<Record<string, string>>): { source: string; supported: boolean };
}
interface InstalledTextApi {
	Text: new (text: string, x: number, y: number) => Component;
}


const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");

const installDir = dirname(configPath);
const evidence: Record<string, unknown> = {};
const unavailable: string[] = [];

function assertContains(actual: string, expected: string, where: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`${where} did not contain ${JSON.stringify(expected)}; actual render/describe: ${JSON.stringify(actual)}`);
	}
}

function assertCanonical(actual: string, value: string, where: string): void {
	assertContains(actual, value, `${where} caller data`);
}

function assertFixed(
	actual: string,
	key: string,
	dictionary: Readonly<Record<string, string>>,
	where: string,
	values: Readonly<Record<string, string | number>> = {},
): void {
	const template = mode === "ordinary" ? key : dictionary[key];
	if (template === undefined || (mode !== "ordinary" && template === key)) {
		throw new Error(`${where} has no translated dictionary value for ${JSON.stringify(key)}; actual render/describe: ${JSON.stringify(actual)}`);
	}
	if (mode !== "ordinary" && !/\p{Script=Han}/u.test(template)) {
		throw new Error(`${where} dictionary text is not meaningful Chinese for ${JSON.stringify(key)}; actual render/describe: ${JSON.stringify(actual)}`);
	}
	const expected = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : placeholder,
	);
	assertContains(actual, expected, where);
}

function containsFixedTemplate(actual: string, key: string, dictionary: Readonly<Record<string, string>>): boolean {
	const template = mode === "ordinary" ? key : dictionary[key];
	if (template === undefined || (mode !== "ordinary" && (template === key || !/\p{Script=Han}/u.test(template)))) {
		return false;
	}
	let offset = 0;
	for (const part of template.split(/\{[A-Za-z_][A-Za-z0-9_]*\}/g)) {
		if (part === "") continue;
		const index = actual.indexOf(part, offset);
		if (index === -1) return false;
		offset = index + part.length;
	}
	return true;
}

function nativeText(component: Component, context?: NativeContext): string | undefined {
	return typeof component.describe === "function" ? JSON.stringify(component.describe(context)) : undefined;
}

function ansi(component: Component, width = 100): string {
	return Bun.stripANSI(component.render(width).join("\n"));
}

// Dynamic imports resolve from launch.json's selected package; workspace imports could probe a different OMP version.
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = hostApi.readLaunchConfig(configPath);
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const dashboardMenuApi = await import(pathToFileURL(join(installDir, "menu-dashboards.ts")).href) as InstalledDashboardMenuApi;
const hostileData = {
	openai: "恶意-provider-id",
	Overview: "恶意概览标签",
	Save: "恶意保存标签",
	"Advisor model": "恶意顾问模型标签",
	Tools: "恶意工具标签",
	"Shared instructions": "恶意共享说明标签",
	Running: "恶意运行标签",
	Close: "恶意关闭标签",
	Output: "恶意输出标签",
	Details: "恶意详情标签",
	Resume: "恶意恢复标签",
	"Probe account [raw]": "恶意-account-label",
	"Probe quota [raw]": "恶意-quota-label",
	"Probe tier [raw]": "恶意-tier-label",
	"Probe window [raw]": "恶意-window-label",
	"Probe Advisor [raw]": "恶意-advisor-name",
	"probe-provider/Probe Model [raw]": "恶意-model-selector",
	"probe-tool [raw]": "恶意-tool-name",
	"Probe instructions [raw]": "恶意-instructions",
	"job:probe-id [raw]": "恶意-job-id",
	"echo Probe command [raw]": "恶意-command",
	"Probe output [raw]": "恶意-output",
	"Probe session [raw]": "恶意-session-name",
	"Probe report title [raw]": "恶意-report-title",
	"Probe report body [raw]": "恶意-report-body",
	"https://probe.example.invalid:3847/path?raw=1": "恶意-url",
	"Background jobs": '恶意菜单标题"; globalThis.__zhompMenuInjected = true; //',
};
const dictionary = mode === "hostile" ? { ...shippedDictionary, ...hostileData } : shippedDictionary;
const dictionaryPath = mode === "hostile" ? join(probeRoot, "additional-menu-hostile-dictionary.json") : launch.dictPath;
if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
process.env.OMP_ZH_CONFIG = configPath;
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompMenuInjected?: boolean }).__zhompMenuInjected = false;

const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
await extension.preparePreloadDisplayTranslations(launch, configPath);
const settingsPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", launch.host.packageDir);
const settingsModule = await import(pathToFileURL(settingsPath).href) as {
	Settings: { init(options: { cwd: string; agentDir: string; inMemory: true; readOnly: true }): Promise<unknown> };
};
await settingsModule.Settings.init({ cwd: probeRoot, agentDir: probeRoot, inMemory: true, readOnly: true });

const menuApi = await import(pathToFileURL(join(installDir, "menu-catalog.ts")).href) as InstalledMenuApi;
const menuTextApi = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as InstalledMenuTextApi;
const roots: Record<MenuModule["root"], string> = { agent: launch.host.packageDir, tui: launch.host.tuiDir };
const sourceEvidence = dashboardMenuApi.DASHBOARD_MENU_MODULES.map(module => {
	const sourcePath = join(roots[module.root], ...module.path.split("/"));
	if (!existsSync(sourcePath)) {
		unavailable.push(`${module.root}:${module.path}@${launch.host.version}`);
		return { id: `${module.root}:${module.path}`, source: "unavailable", sourceSupported: false, registered: false };
	}
	const source = readFileSync(sourcePath, "utf8");
	const supported = menuTextApi.translateMenuSource(source, module, dictionary).supported;
	const registered = menuApi.MENU_MODULES.some(candidate => candidate.root === module.root && candidate.path === module.path);
	return { id: `${module.root}:${module.path}`, source: "available", sourceSupported: supported, registered };
});
evidence.sourceModules = sourceEvidence;

const missingDashboardKeys = dashboardMenuApi.DASHBOARD_MENU_TEXT_KEYS.filter(key => !dictionary[key]);
evidence.dictionaryKeys = { count: dashboardMenuApi.DASHBOARD_MENU_TEXT_KEYS.length, missing: missingDashboardKeys };
if (mode !== "ordinary" && missingDashboardKeys.length > 0) {
	throw new Error(`dashboard dictionary is missing exported source keys: ${JSON.stringify({ missingDashboardKeys, actual: evidence })}`);
}
const nativeContext: NativeContext = {
	cols: 120,
	reduceMotion: false,
	dark: false,
	supports() { return true; },
	feature() { return false; },
};

const usagePath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/usage-dashboard", launch.host.packageDir);
const usageApi = await import(pathToFileURL(usagePath).href) as UsageDashboardApi;
const usageDisplayPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/usage-display", launch.host.packageDir);
const usageDisplayApi = await import(pathToFileURL(usageDisplayPath).href) as UsageDisplayApi;
const usageResetAt = Date.now() + 8 * 24 * 60 * 60 * 1_000;
const report: UsageReportFixture = {
	provider: "openai",
	fetchedAt: Date.now() - 60_000,
	limits: [
		{
			id: "probe-limit-id",
			label: "Probe quota [raw]",
			scope: { provider: "openai", accountId: "Probe account [raw]", tier: "Probe tier [raw]", windowId: "Probe window [raw]" },
			amount: { unit: "requests", used: 4, limit: 10, usedFraction: 0.4 },
			status: "warning",
			window: { id: "probe-window-id", label: "Probe window [raw]", durationMs: 5 * 60 * 60 * 1000, resetsAt: usageResetAt },
		},
	],
	metadata: { email: "Probe account [raw]", accountId: "probe-account-id" },
};
let usageRefreshCalls = 0;
let usageCloseCalls = 0;
const usageOptions: UsageDashboardOptions = {
	reports: [report],
	unavailableAccounts: [{ provider: "openai", label: "Overview" }],
	renderDetail: (_width, reports) => `caller report data: ${reports[0]?.provider ?? ""} · Probe account [raw] · Probe quota [raw] · Probe window [raw]`,

	loadActivity: async push => { push([]); },
	refresh: async () => { usageRefreshCalls++; return [report]; },
	requestRender: () => {},
	onClose: () => { usageCloseCalls++; },
};
const usage = new usageApi.UsageDashboardComponent(usageOptions);
await Promise.resolve();
const usageOverviewAnsi = ansi(usage);
const usageOverviewNative = nativeText(usage, nativeContext);
evidence.usage = { head: usage.nativeOverlay?.head, ansi: usageOverviewAnsi, native: usageOverviewNative };
if (usageOverviewNative === undefined) unavailable.push(`usage-dashboard.describe@${launch.host.version}`);
else {
	assertFixed(usageOverviewNative, "Overview", dictionary, "usage dashboard native overview tabs");
	assertFixed(usageOverviewNative, "Details", dictionary, "usage dashboard native detail tab");
	assertFixed(usageOverviewNative, "Quotas", dictionary, "usage dashboard native quota section");
	assertFixed(usageOverviewNative, "Activity", dictionary, "usage dashboard native activity section");
	assertFixed(usageOverviewNative, "Close", dictionary, "usage dashboard native close action");
	assertCanonical(usageOverviewNative, "openai", "usage provider identity");
	assertCanonical(usageOverviewNative, "Probe quota [raw]", "usage quota label");
	assertCanonical(usageOverviewNative, "Overview", "usage account label matching a translation key");
	assertCanonical(usageOverviewNative, "Probe tier [raw]", "usage tier");
	assertCanonical(usageOverviewNative, "0.4", "usage fraction");
	assertCanonical(usageOverviewNative, "60%", "usage percent");
	assertCanonical(usageOverviewNative, "warning", "usage status value");
	assertContains(usageOverviewNative, "omp.usage.reset", "usage reset row");
	const resetTextKeys = ["resets in {duration}", "resets {time}", "resets {weekday} {time}", "resets {day} {month}"] as const;
	if (!resetTextKeys.some(key => containsFixedTemplate(usageOverviewNative, key, dictionary))) {
		throw new Error(`Usage dashboard lost its reset countdown copy; actual=${JSON.stringify(usageOverviewNative)}`);
	}
	const resetTitleKeys = ["Resets {date} {year}, {time}", "Resets {date} {year}, {time} (in {duration})"] as const;
	if (!resetTitleKeys.some(key => containsFixedTemplate(usageOverviewNative, key, dictionary))) {
		throw new Error(`Usage dashboard lost its reset timestamp title; actual=${JSON.stringify(usageOverviewNative)}`);
	}
	const resetDate = new Date(usageResetAt);
	const resetClockTime = `${String(resetDate.getHours()).padStart(2, "0")}:${String(resetDate.getMinutes()).padStart(2, "0")}`;
	assertCanonical(usageOverviewNative, resetClockTime, "usage reset clock derived from the caller timestamp");
	assertCanonical(usageOverviewNative, String(resetDate.getFullYear()), "usage reset year derived from the caller timestamp");
}
if (usage.nativeOverlay?.head !== undefined) {
	assertFixed(usage.nativeOverlay.head, "Usage", dictionary, "usage dashboard overlay title");
} else unavailable.push(`usage-dashboard.nativeOverlay@${launch.host.version}`);
usage.handleInput?.("\r");
const usageDetailAnsi = ansi(usage);
const usageDetailNative = nativeText(usage, nativeContext);
evidence.usage = { ...(evidence.usage as Record<string, unknown>), detailAnsi: usageDetailAnsi, detailNative: usageDetailNative };
assertCanonical(usageDetailAnsi, "caller report data", "usage dashboard detail");
for (const value of ["openai", "Probe account [raw]", "Probe quota [raw]", "Probe tier [raw]", "Probe window [raw]"]) {
	assertCanonical(`${usageDetailAnsi}\n${usageDetailNative ?? ""}`, value, "usage dashboard detail");
}
assertFixed(usageDetailAnsi, "Usage · Details", dictionary, "usage dashboard detail title");
strictEqual(report.limits[0]?.status, "warning", "usage status enum must remain canonical");
const emptyUsage = new usageApi.UsageDashboardComponent({ ...usageOptions, reports: [] });
await Promise.resolve();
const emptyUsageNative = nativeText(emptyUsage, nativeContext);
evidence.emptyUsage = { ansi: ansi(emptyUsage), native: emptyUsageNative };
if (emptyUsageNative === undefined) unavailable.push(`usage-dashboard.empty-state.describe@${launch.host.version}`);
else {
	assertFixed(emptyUsageNative, "No usage yet", dictionary, "usage dashboard empty-state title");
	assertFixed(emptyUsageNative, "Quotas show here once a signed-in provider reports usage, and the calendar fills in as you work.", dictionary, "usage dashboard empty-state prose");
}
let finishUsageActivityLoad: (() => void) | undefined;
const loadingUsage = new usageApi.UsageDashboardComponent({
	...usageOptions,
	loadActivity: async push => await new Promise<void>(resolve => {
		finishUsageActivityLoad = () => { push([]); resolve(); };
	}),
});
await Promise.resolve();
const loadingUsageAnsi = ansi(loadingUsage);
const loadingUsageNative = nativeText(loadingUsage, nativeContext);
evidence.usageLoading = { ansi: loadingUsageAnsi, native: loadingUsageNative };
if (loadingUsageNative === undefined) unavailable.push(`usage-dashboard.loading.describe@${launch.host.version}`);
else assertFixed(loadingUsageNative, "Loading usage history…", dictionary, "usage dashboard loading prose");
assertFixed(loadingUsageAnsi, "Loading usage history…", dictionary, "usage dashboard loading prose");
if (!finishUsageActivityLoad) throw new Error(`usage dashboard did not request activity data; actual=${JSON.stringify(loadingUsageNative)}`);
finishUsageActivityLoad();
await Promise.resolve();
const resetSummary = usageDisplayApi.summarizeUsageResetCredits({ availableCount: 1, redeemableCount: 0, eligible: false });
const resetText = resetSummary?.unavailableReason ?? "";
evidence.usageDisplay = { unavailableReason: resetText };
assertFixed(resetText, "not eligible", dictionary, "usage display eligibility prose");
usage.dispose?.();
emptyUsage.dispose?.();
loadingUsage.dispose?.();

const advisorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/advisor-config", launch.host.packageDir);
const advisorApi = await import(pathToFileURL(advisorPath).href) as AdvisorOverlayApi;
let advisorSaves = 0;
let advisorCloses = 0;
let advisorLoads = 0;
let advisorNotices = 0;
const advisor = new advisorApi.AdvisorConfigOverlayComponent(
	{},
	{
		getAvailableModels: () => [],
		browserSource: { mruOrder: [] },
		defaultToolNames: new Set(["read", "grep", "glob"]),
		availableToolNames: ["read", "grep", "glob", "probe-tool [raw]"],
		scopedModels: [],
		defaultModelLabel: "probe-provider/Probe Model [raw]",
	},
	"project",
	{
	advisors: [
		{
			name: "Probe Advisor [raw]",
			model: "probe-provider/Probe Model [raw]",
			tools: ["probe-tool [raw]", "Tools"],
			instructions: "Shared instructions",
			reviewMode: "agent-end",
			syncBacklog: "off",
		},
		{
			name: "Save",
			model: "Advisor model",
			tools: ["Tools"],
			instructions: "Probe instructions [raw]",
			reviewMode: "turn",
		},
	],
	instructions: "Probe shared instruction [raw]",
	},
	{
		loadDoc: async () => { advisorLoads++; return { advisors: [] }; },
		save: async () => { advisorSaves++; },
		close: () => { advisorCloses++; },
		requestRender: () => {},
		notify: () => { advisorNotices++; },
		getAdvisorStats: () => [],
		getUsageReports: async () => null,
	},
);
await Promise.resolve();
const advisorAnsi = ansi(advisor);
const advisorNative = nativeText(advisor, { ...nativeContext, supports(kind) { return kind === "prefs"; } });
advisor.handleNativeEvent?.({ type: "action", key: "", act: "page", value: "advisor:1", mods: [] });
const advisorDetailNative = nativeText(advisor, { ...nativeContext, supports(kind) { return kind === "prefs"; } });
evidence.advisor = { ansi: advisorAnsi, native: advisorNative, detailNative: advisorDetailNative };
if (advisorNative === undefined) unavailable.push(`advisor-config.describe@${launch.host.version}`);
else {
	for (const label of ["Enabled", "Model", "Review mode", "Review interval", "Sync backlog", "Tools", "Instructions", "Save & apply", "Add advisor"]) {
		assertFixed(advisorNative, label, dictionary, `advisor native field ${JSON.stringify(label)}`);
	}
	assertFixed(advisorNative, "Save", dictionary, "advisor native save action");
	for (const hint of [
		"An advisor watches the session and leaves notes; set its model, tools and instructions here.",
		"Run this advisor alongside the session.",
		"turn reviews every primary turn; agent-end reviews only final yields.",
		"Review every Nth eligible update; skipped updates join the next review.",
		"None means no tools; read, grep and glob are the default.",
		"Create a new advisor entry, then set its model, tools and instructions.",
		"Write this file and reload the live advisors without a restart.",
	]) assertFixed(advisorNative, hint, dictionary, `advisor native hint ${JSON.stringify(hint)}`);
	const catchUpKey = "Catch-up policy; inherit follows advisor.syncBacklog (currently {mode}).";
	const catchUpHint = (mode === "ordinary" ? catchUpKey : dictionary[catchUpKey])?.replace("{mode}", "off");
	if (!catchUpHint) throw new Error(`advisor catch-up hint translation is missing; actual=${JSON.stringify(advisorNative)}`);
	assertContains(advisorNative, catchUpHint, "advisor catch-up hint");
}
const advisorActual = `${advisorAnsi}\n${advisorNative ?? ""}\n${advisorDetailNative ?? ""}`;
for (const value of ["Probe Advisor [raw]", "probe-provider/Probe Model [raw]", "probe-tool [raw]", "Shared instructions", "Save", "Advisor model", "Tools", "Probe instructions [raw]", "WATCHDOG.yml · project", "agent-end", "turn", "inherit", "off"]) {
	assertCanonical(advisorActual, value, "advisor panel");
}
strictEqual(advisorSaves + advisorCloses + advisorLoads + advisorNotices, 0, `advisor probe triggered callbacks: ${JSON.stringify({ advisorSaves, advisorCloses, advisorLoads, advisorNotices })}; actual=${JSON.stringify(advisorActual)}`);

const jobsPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/jobs-panel", launch.host.packageDir);
const jobsApi = await import(pathToFileURL(jobsPath).href) as JobsPanelApi;
let jobCancelCalls = 0;
let jobCloseCalls = 0;
const job: JobsJob = {
	id: "job:probe-id [raw]",
	type: "bash",
	status: "running",
	label: "echo Probe command [raw]",
	startTime: Date.now() - 2_000,
	ownerId: "root-agent-id",
	agentId: "probe-agent-id",
};
const jobsSource = {
	load: (): JobsSnapshot => ({ running: [job], recent: [], rootId: "root-agent-id" }),
	inspect: (_id: string) => ({ command: "echo Probe command [raw]", cwd: "Probe directory [raw]", pids: [9182], output: "Probe output [raw]", artifactId: "probe-artifact-id" }),
	close: () => { jobCloseCalls++; },
	cancel: (_id: string) => { jobCancelCalls++; },
};
const jobs = new jobsApi.JobsSheet(jobsSource);
const jobsAnsi = ansi(jobs);
const jobsNative = nativeText(jobs, nativeContext);
evidence.jobs = { ansi: jobsAnsi, native: jobsNative };
if (jobs.nativeOverlay?.head !== undefined) assertFixed(jobs.nativeOverlay.head, "Background jobs", dictionary, "jobs panel overlay title");
else unavailable.push(`jobs-panel.nativeOverlay@${launch.host.version}`);
if (jobsNative === undefined) unavailable.push(`jobs-panel.describe@${launch.host.version}`);
else {
	for (const label of ["Running", "Cancel job", "Output", "Close"]) {
		assertFixed(jobsNative, label, dictionary, `jobs panel label ${JSON.stringify(label)}`);
	}
}
for (const value of ["job:probe-id [raw]", "bash", "echo Probe command [raw]", "Probe output [raw]", "probe-artifact-id", "Probe directory [raw]", "probe-agent-id"]) {
	assertCanonical(`${jobsAnsi}\n${jobsNative ?? ""}`, value, "jobs panel");
}
const collidingJob = { ...job, id: "Close", label: "Running" };
const collidingJobs = new jobsApi.JobsSheet({
	...jobsSource,
	load: (): JobsSnapshot => ({ running: [collidingJob], recent: [], rootId: "root-agent-id" }),
	inspect: (_id: string) => ({ command: "Output", cwd: "Close", pids: [9182], output: "Close", artifactId: "Close" }),
});
const collidingJobsAnsi = ansi(collidingJobs);
const collidingJobsNative = nativeText(collidingJobs, nativeContext);
const collidingJobsText = `${collidingJobsAnsi}\n${collidingJobsNative ?? ""}`;
evidence.collidingJobs = { ansi: collidingJobsAnsi, native: collidingJobsNative };
for (const value of ["Running", "Output", "Close"]) assertCanonical(collidingJobsText, value, "jobs caller data matching dictionary keys");
collidingJobs.dispose?.();
const pendingJobs = new jobsApi.JobsSheet({ ...jobsSource, inspect: (_id: string) => ({ pids: [] }) });
const pendingJobsNative = nativeText(pendingJobs, nativeContext);
evidence.pendingJobs = { ansi: ansi(pendingJobs), native: pendingJobsNative };
if (pendingJobsNative === undefined) unavailable.push(`jobs-panel.no-output.describe@${launch.host.version}`);
else assertFixed(pendingJobsNative, "No output yet", dictionary, "running job empty output label");
strictEqual(job.status, "running", "job status enum must remain canonical");
const emptyJobs = new jobsApi.JobsSheet({ ...jobsSource, load: () => ({ running: [], recent: [], rootId: "root-agent-id" }) });
const emptyJobsNative = nativeText(emptyJobs, nativeContext);
evidence.emptyJobs = { ansi: ansi(emptyJobs), native: emptyJobsNative };
if (emptyJobsNative === undefined) unavailable.push(`jobs-panel.empty-state.describe@${launch.host.version}`);
else {
	assertFixed(emptyJobsNative, "No background jobs", dictionary, "jobs empty state title");
	assertFixed(emptyJobsNative, "Commands and subagent tasks started in the background show up here while they run.", dictionary, "jobs empty state prose");
}
strictEqual(jobCancelCalls + jobCloseCalls, 0, `jobs probe invoked a close/cancel callback: ${JSON.stringify({ jobCancelCalls, jobCloseCalls })}; actual=${JSON.stringify(jobsNative)}`);

const reportPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/report-panel", launch.host.packageDir);
const reportApi = await import(pathToFileURL(reportPath).href) as ReportPanelApi;
let reportCloseCalls = 0;
const reportTextPath = join(launch.host.tuiDir, "src/components/text.ts");
const reportTextApi = await import(pathToFileURL(reportTextPath).href) as InstalledTextApi;
const reportBody = new reportTextApi.Text("Probe report body [raw]", 1, 0);
const reportPanel = new reportApi.ReportPanel({
	title: "Probe report title [raw]",
	body: reportBody,
	closeKey: "Esc",
	onClose: () => { reportCloseCalls++; },
});
const reportAnsi = ansi(reportPanel);
const reportNative = nativeText(reportPanel, nativeContext);
evidence.reportPanel = { ansi: reportAnsi, native: reportNative, head: reportPanel.nativeOverlay?.head };
if (reportPanel.nativeOverlay?.head === undefined) unavailable.push(`report-panel.nativeOverlay@${launch.host.version}`);
else assertCanonical(reportPanel.nativeOverlay.head, "Probe report title [raw]", "report panel caller title");
if (reportNative === undefined) unavailable.push(`report-panel.describe@${launch.host.version}`);
else assertFixed(reportNative, "Close", dictionary, "report shell native close action");
assertCanonical(`${reportAnsi}\n${reportNative ?? ""}`, "Probe report title [raw]", "report panel title");
assertCanonical(`${reportAnsi}\n${reportNative ?? ""}`, "Probe report body [raw]", "report body");
const reportCloseHint = mode === "ordinary" ? "Esc to close" : dictionary["{key} to close"]?.replace("{key}", "Esc");
if (reportCloseHint === undefined) throw new Error(`missing report close hint template; actual render/describe: ${JSON.stringify(reportAnsi)}`);
assertContains(reportAnsi, reportCloseHint, "report shell close hint");
assertCanonical(reportAnsi, "Esc", "report shell close key");
strictEqual(reportCloseCalls, 0, `report probe invoked onClose; actual=${JSON.stringify(reportNative)}`);

const pausePath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/pause-screen", launch.host.packageDir);
const pauseApi = await import(pathToFileURL(pausePath).href) as PauseScreenApi;
let pauseOverlayCalls = 0;
let pauseFocusCalls = 0;
let pauseStatusCalls = 0;
const pause = new pauseApi.PauseScreenComponent(
	{
		ui: {
			showOverlay: () => { pauseOverlayCalls++; return {}; },
			setFocus: () => { pauseFocusCalls++; },
			requestRender: () => {},
			terminal: { rows: 30 },
		},
		showStatus: () => { pauseStatusCalls++; },
		sessionName: "Probe session [raw]",
	},
	{ getWorkStatus: () => ({ unsettledTurns: 2, unfinishedJobs: 1 }) },
);
const pauseAnsi = ansi(pause);
const pauseNative = nativeText(pause, nativeContext);
evidence.pause = { ansi: pauseAnsi, native: pauseNative, head: pause.nativeOverlay?.head };
if (pause.nativeOverlay?.head !== undefined) assertFixed(pause.nativeOverlay.head, "Paused", dictionary, "pause screen overlay title");
else unavailable.push(`pause-screen.nativeOverlay@${launch.host.version}`);
assertFixed(pauseAnsi, "P A U S E D", dictionary, "pause ANSI title");
if (pauseNative === undefined) unavailable.push(`pause-screen.describe@${launch.host.version}`);
else {
	for (const [label, where] of [
		["Every agent holds", "pause facts"],
		["Running calls finish", "pause facts"],
		["Queued messages wait", "pause facts"],
		["The repo is yours", "pause facts"],
		["Resume", "pause action"],
	] as const) assertFixed(pauseNative, label, dictionary, where);
	if (pauseNative.includes("omp.pause.settlement-status")) {
		assertFixed(pauseAnsi, "Pausing — waiting for work to settle", dictionary, "pause ANSI settlement status");
		assertFixed(pauseAnsi, "Unsettled turns: {count}", dictionary, "pause ANSI unsettled-turn count", { count: 2 });
		assertFixed(pauseAnsi, "Unfinished jobs: {count}", dictionary, "pause ANSI unfinished-job count", { count: 1 });
		assertFixed(pauseNative, "Pausing — waiting for work to settle", dictionary, "pause native settlement status");
		assertFixed(pauseNative, "Unsettled turns: {count}", dictionary, "pause native unsettled-turn count", { count: 2 });
		assertFixed(pauseNative, "Unfinished jobs: {count}", dictionary, "pause native unfinished-job count", { count: 1 });
	} else {
		assertFixed(pauseNative, "Each agent continues where it stopped.", dictionary, "pause legacy footer");
	}
}
assertCanonical(`${pauseAnsi}\n${pauseNative ?? ""}`, "Probe session [raw]", "pause session name");
strictEqual(pauseOverlayCalls + pauseFocusCalls + pauseStatusCalls, 0, `pause probe started the pause flow; actual=${JSON.stringify(pauseNative)}`);
pause.dispose?.();

const statsNoticePath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/stats-notice", launch.host.packageDir);
const statsNoticeApi = await import(pathToFileURL(statsNoticePath).href) as StatsNoticeApi;
const statsDashboardPath = Bun.resolveSync("@oh-my-pi/pi-coding-agent/slash-commands/helpers/stats-dashboard", launch.host.packageDir);
const statsDashboardApi = await import(pathToFileURL(statsDashboardPath).href) as StatsDashboardApi;
const statsUsageKey = "Usage: /stats [--port <port>] [--host <host>]";
const statsUsageText = mode === "ordinary" ? statsUsageKey : dictionary[statsUsageKey];
if (!statsUsageText) throw new Error(`stats helper usage translation is unavailable; actual source evidence: ${JSON.stringify(sourceEvidence)}`);
const statsErrorCases: readonly { args: string; key: string; values: Readonly<Record<string, string>>; callerValues: readonly string[] }[] = [
	{ args: "--port", key: "Missing port. {usage}", values: { usage: statsUsageText }, callerValues: [] },
	{ args: "--host", key: "Missing host. {usage}", values: { usage: statsUsageText }, callerValues: [] },
	{ args: "--port abc", key: "Invalid port: {value}", values: { value: "abc" }, callerValues: ["abc"] },
	{ args: "--port 65536", key: "Invalid port: {value}", values: { value: "65536" }, callerValues: ["65536"] },
	{ args: "--mystery", key: "Unknown option: {option}. {usage}", values: { option: "--mystery", usage: statsUsageText }, callerValues: ["--mystery"] },
];
const statsErrors: Record<string, string> = {};
for (const errorCase of statsErrorCases) {
	const parsed = statsDashboardApi.parseStatsDashboardArgs(errorCase.args);
	if (!("error" in parsed)) throw new Error(`stats helper fixture did not produce an error for ${errorCase.args}: ${JSON.stringify(parsed)}`);
	const template = mode === "ordinary" ? errorCase.key : dictionary[errorCase.key];
	if (!template) throw new Error(`stats helper translation is unavailable for ${errorCase.key}; actual=${JSON.stringify(parsed.error)}`);
	const expected = Object.entries(errorCase.values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), template);
	assertContains(parsed.error, expected, `stats dashboard helper ${errorCase.args}`);
	for (const value of errorCase.callerValues) assertCanonical(parsed.error, value, `stats helper option ${errorCase.args}`);
	statsErrors[errorCase.args] = parsed.error;
}
const statsParse = statsDashboardApi.parseStatsDashboardArgs("--port");
if (!("error" in statsParse)) throw new Error(`stats notice fixture did not produce a parse error: ${JSON.stringify(statsParse)}`);
const parsedStatsOptions = statsDashboardApi.parseStatsDashboardArgs("--port 2847 --host probe.local");
if ("error" in parsedStatsOptions) throw new Error(`stats valid option fixture was rejected: ${parsedStatsOptions.error}`);
strictEqual(parsedStatsOptions.port, 2847, "stats port option stays numeric");
strictEqual(parsedStatsOptions.host, "probe.local", "stats host option stays caller data");
evidence.statsDashboard = { usage: statsUsageText, errors: statsErrors, options: parsedStatsOptions };
const statsUrl = "https://probe.example.invalid:3847/path?raw=1";
const statsNotice = new statsNoticeApi.StatsNotice(statsParse.error, statsUrl);
const statsNoticeAnsi = ansi(statsNotice);
const statsNoticeNative = nativeText(statsNotice, nativeContext);
evidence.statsNotice = { ansi: statsNoticeAnsi, native: statsNoticeNative, helperMessage: statsParse.error };
if (statsNoticeNative === undefined) unavailable.push(`stats-notice.describe@${launch.host.version}`);
else assertFixed(statsNoticeNative, "Open dashboard ↗", dictionary, "stats notice open action");
assertCanonical(`${statsNoticeAnsi}\n${statsNoticeNative ?? ""}`, statsUrl, "stats notice URL");
assertCanonical(`${statsNoticeAnsi}\n${statsNoticeNative ?? ""}`, statsParse.error, "stats notice caller message");

const allSourceSupported = sourceEvidence.every(entry => entry.source === "unavailable" || entry.sourceSupported);
if (!allSourceSupported) throw new Error(`dashboard source adapters are unsupported: ${JSON.stringify({ sourceEvidence, actual: evidence })}`);
if (mode === "hostile" && (globalThis as typeof globalThis & { __zhompMenuInjected?: boolean }).__zhompMenuInjected) {
	throw new Error(`hostile translated menu text executed code; actual=${JSON.stringify(evidence)}`);
}
strictEqual(usageRefreshCalls + usageCloseCalls + advisorSaves + advisorCloses + advisorLoads + advisorNotices + jobCancelCalls + jobCloseCalls + reportCloseCalls + pauseOverlayCalls + pauseFocusCalls + pauseStatusCalls, 0,
	`probe invoked a mutating or external callback: ${JSON.stringify({ usageRefreshCalls, usageCloseCalls, advisorSaves, advisorCloses, advisorLoads, advisorNotices, jobCancelCalls, jobCloseCalls, reportCloseCalls, pauseOverlayCalls, pauseFocusCalls, pauseStatusCalls })}; actual=${JSON.stringify(evidence)}`);

const result = {
	mode,
	component: "AdditionalMenus",
	hostVersion: launch.host.version,
	modules: sourceEvidence,
	capabilities: { unavailable },
	surfaces: evidence,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (unavailable.length > 0 && mode !== "ordinary") process.exitCode = 1;
