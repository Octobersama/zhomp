import { strictEqual } from "node:assert/strict";
import { loadLegacySurfaceFixture, type LegacySurfaceFixture } from "./legacy-surface-fixture";

interface Renderable {
	render(width: number): readonly string[];
	handleInput?(data: string): void;
	dispose?(): void;
}

interface UsageLimitFixture {
	id: string;
	label: string;
	scope: { provider: string; accountId?: string; tier?: string; windowId?: string };
	amount: { unit: string; used: number; limit: number; usedFraction?: number };
	status?: string;
	window?: { id: string; label: string; durationMs?: number; resetsAt?: number; resetLabel?: string };
}

interface UsageReportFixture {
	provider: string;
	fetchedAt: number;
	limits: UsageLimitFixture[];
	metadata?: Record<string, unknown>;
}

function render(component: Renderable, width = 120): string {
	return Bun.stripANSI(component.render(width).join("\n"));
}

function includes(actual: string, expected: string, where: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`${where} did not render ${JSON.stringify(expected)}; actual=${JSON.stringify(actual)}`);
	}
}

function canonical(actual: string, value: string, where: string, fixture: LegacySurfaceFixture): void {
	includes(actual, value, where);
	if (fixture.mode === "hostile") {
		const hostile = fixture.dictionary[value];
		if (hostile && hostile !== value && actual.includes(hostile)) {
			throw new Error(`${where} translated caller data ${JSON.stringify(value)} as ${JSON.stringify(hostile)}; actual=${JSON.stringify(actual)}`);
		}
	}
}

function fixedEnglish(actual: string, caption: string, where: string): void {
	includes(actual, caption, where);
}

const fixture = await loadLegacySurfaceFixture();
try {
	strictEqual(fixture.launch.host.version, "18.3.2", "legacy surface probe must use the installed 18.3.2 host");
	const mode = fixture.mode;
	const tuiText = await fixture.load("@oh-my-pi/pi-tui/components/text") as {
		Text: new (text: string, paddingX?: number, paddingY?: number) => Renderable & { getText?(): string };
	};
	const themeModule = await fixture.load("@oh-my-pi/pi-tui/theme") as {
		theme: {
			fg(color: string, text: string): string;
			bold(text: string): string;
			status: Record<string, string>;
		};
	};
	const theme = themeModule.theme;
	const commandApi = await fixture.load("@oh-my-pi/pi-coding-agent/modes/controllers/command-controller") as {
		CommandController: new (context: unknown) => {
			handleJobsCommand(): Promise<void>;
			handleSessionCommand(): Promise<void>;
		};
		renderUsageReports(
			reports: UsageReportFixture[],
			uiTheme: typeof theme,
			nowMs: number,
			availableWidth: number,
			resolveActiveAccount?: undefined,
			usageModelSelectors?: readonly string[],
		): string;
	};

	const now = Date.now();
	const report: UsageReportFixture = {
		provider: "openai",
		fetchedAt: now - 60_000,
		limits: [{
			id: "quota:legacy-probe-id [raw]",
			label: "Probe quota [raw]",
			scope: { provider: "openai", accountId: "probe-account-id [raw]", tier: "high", windowId: "legacy-window-id [raw]" },
			amount: { unit: "requests", used: 4, limit: 10, usedFraction: 0.4 },
			status: "warning",
			window: { id: "legacy-window-id [raw]", label: "Probe window [raw]", durationMs: 5 * 60 * 60 * 1000 },
		}],
		metadata: { accountId: "probe-account-id [raw]" },
	};
	const usageApi = await fixture.load("@oh-my-pi/pi-tui/overlays/usage-dashboard") as {
		UsageDashboardComponent: new (options: {
			reports: UsageReportFixture[];
			renderDetail(width: number): string;
			loadActivity(push: (points: readonly { day: string; cost: number; requests: number }[]) => void, signal: AbortSignal): Promise<void>;
			requestRender(): void;
			onClose(): void;
		}) => Renderable;
	};
	const usageDisplay = await fixture.load("@oh-my-pi/pi-tui/overlays/usage-display") as {
		formatLimitTitle(limit: UsageLimitFixture): string;
		formatUsageResetWindow(windowId: string): string;
		summarizeUsageResetCredits(
			reset: { availableCount: number; redeemableCount?: number; eligible?: boolean },
			nowMs?: number,
		): { bankedCount: number; redeemableCount: number; unavailableReason?: string } | undefined;
	};
	let activityLoads = 0;
	let usageRenders = 0;
	let usageCloseCalls = 0;
	const usage = new usageApi.UsageDashboardComponent({
		reports: [report],
		renderDetail: width => commandApi.renderUsageReports([report], theme, now, width, undefined, ["openai/probe-model:high"]),
		loadActivity: async (push, _signal) => {
			activityLoads++;
			push([{ day: new Date().toISOString().slice(0, 10), cost: 1, requests: 3 }]);
		},
		requestRender: () => { usageRenders++; },
		onClose: () => { usageCloseCalls++; },
	});
	await Promise.resolve();
	const usageOverview = render(usage);
	const usageHeader = usageOverview.split("\n").slice(0, 3).join("\n");
	fixedEnglish(usageHeader, "Usage", "legacy usage dashboard title");
	fixedEnglish(usageOverview, "Activity", "legacy usage dashboard activity caption");
	fixedEnglish(usageOverview, "requests", "legacy usage dashboard activity unit");
	fixedEnglish(usageOverview, "↵ details · Esc close", "legacy usage dashboard keyboard hint");
	canonical(usageOverview, "Openai", "legacy usage provider display", fixture);
	canonical(usageOverview, "Probe quota [raw] (high)", "legacy usage quota/tier", fixture);
	includes(usageOverview, "60%", "legacy usage quota value");
	strictEqual(report.provider, "openai", "provider ID remains canonical");
	strictEqual(report.limits[0]?.status, "warning", "usage status enum remains canonical");
	strictEqual(report.limits[0]?.window?.id, "legacy-window-id [raw]", "usage window ID remains canonical");
	const baselineUsageRenders = usageRenders;
	usage.handleInput?.("r");
	strictEqual(usageRenders, baselineUsageRenders, "legacy usage has no refresh action to trigger");
	strictEqual(usageCloseCalls, 0, "read-only usage refresh probe did not close the dashboard");
	usage.handleInput?.("\r");
	const usageDetails = render(usage);
	const detailsHeader = usageDetails.split("\n").slice(0, 3).join("\n");
	fixedEnglish(detailsHeader, "Usage · Details", "legacy usage details title");
	fixedEnglish(usageDetails, "Usage", "legacy usage report heading");
	for (const value of ["openai/probe-model:high", "probe-account-id [raw]", "Probe quota [raw] (high)", "Probe window [raw]", "60% free"]) {
		canonical(usageDetails, value, "legacy usage report data", fixture);
	}
	const helperReset = usageDisplay.summarizeUsageResetCredits({ availableCount: 2, redeemableCount: 0, eligible: false }, now);
	if (!helperReset) throw new Error("legacy usage display helper omitted the reset summary");
	const expectedHelperText = mode === "ordinary" ? "not eligible" : fixture.dictionary["not eligible"];
	if (!expectedHelperText) throw new Error("installed dictionary is missing the supported usage-display status text");
	strictEqual(helperReset.bankedCount, 2, "usage-display keeps the underlying banked count");
	strictEqual(helperReset.redeemableCount, 0, "usage-display keeps the underlying eligibility count");
	strictEqual(helperReset.unavailableReason, expectedHelperText, "supported usage-display prose follows its installed dictionary");
	strictEqual(usageDisplay.formatUsageResetWindow("anthropic:7d"), "Claude weekly", "usage window mapping keeps its canonical window label");
	strictEqual(usageDisplay.formatLimitTitle(report.limits[0]!), "Probe quota [raw] (high)", "usage-display preserves caller quota and tier values");
	usage.dispose?.();

	const effortApi = await fixture.load("@oh-my-pi/pi-catalog/effort") as { THINKING_EFFORTS: readonly string[] };
	const thinkingApi = await fixture.load("@oh-my-pi/pi-agent-core/thinking") as {
		ThinkingLevel: { Inherit: string; High: string };
	};
	const high = effortApi.THINKING_EFFORTS.find(value => value === thinkingApi.ThinkingLevel.High);
	if (!high) throw new Error(`installed legacy model catalog does not expose high effort: ${JSON.stringify(effortApi.THINKING_EFFORTS)}`);
	strictEqual(thinkingApi.ThinkingLevel.Inherit, "inherit", "legacy thinking enum keeps inherit value");
	const model = {
		id: "legacy-model-id",
		name: "Legacy Probe Model [raw]",
		provider: "probe-provider",
		api: "openai-completions",
		baseUrl: "https://probe.invalid/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
		thinking: { efforts: effortApi.THINKING_EFFORTS.filter(value => ["low", "medium", "high"].includes(value)) },
	};
	const browserSource = {
		defaultThinkingLevel: thinkingApi.ThinkingLevel.Inherit,
		modelProviderOrder: ["probe-provider"],
		knownRoleIds: ["advisor"],
		mruOrder: ["probe-provider/legacy-model-id"],
		modelPerf: new Map(),
		getModelRole: () => undefined,
		getRoleInfo: (role: string) => ({ name: role, section: "chat", accepts: () => true }),
		defaultRoleChain: () => [],
		resolveRoleValue: () => ({ model: undefined, explicitThinkingLevel: false }),
	};
	const advisorApi = await fixture.load("@oh-my-pi/pi-tui/overlays/advisor-config") as {
		AdvisorConfigOverlayComponent: new (
			tui: object,
			deps: {
				getAvailableModels(): readonly unknown[];
				browserSource: unknown;
				defaultToolNames: ReadonlySet<string>;
				availableToolNames: readonly string[];
				scopedModels: readonly { model: unknown; thinkingLevel?: string }[];
				defaultModelLabel?: string;
			},
			scope: "project" | "user",
			doc: { advisors: Array<Record<string, unknown>>; instructions?: string },
			callbacks: {
				loadDoc(scope: "project" | "user"): Promise<unknown>;
				save(scope: "project" | "user", doc: unknown): Promise<void>;
				close(): void;
				requestRender(): void;
				notify(message: string): void;
				getUsageReports?(): Promise<null>;
			},
		) => Renderable;
	};
	let advisorSaves = 0;
	let advisorLoads = 0;
	let advisorCloses = 0;
	let advisorNotices = 0;
	const advisorCallbacks = {
		loadDoc: async (_scope: "project" | "user") => { advisorLoads++; throw new Error("blocked advisor scope load"); },
		save: async (_scope: "project" | "user", _doc: unknown) => { advisorSaves++; throw new Error("blocked advisor save"); },
		close: () => { advisorCloses++; throw new Error("blocked advisor close"); },
		requestRender: () => {},
		notify: (_message: string) => { advisorNotices++; throw new Error("unexpected advisor notice"); },
		getUsageReports: async () => null,
	};
	const advisorDoc: { advisors: { name: string; tools?: string[]; instructions?: string; model?: string }[]; instructions?: string } = {
		advisors: [{
			name: "Probe Advisor [raw]",
			tools: ["probe-tool [raw]"],
			instructions: "Probe instructions [raw] keep high/inherit unchanged.",
		}],
		instructions: "Shared instructions [raw]",
	};
	const advisor = new advisorApi.AdvisorConfigOverlayComponent({}, {
		getAvailableModels: () => [model],
		browserSource,
		defaultToolNames: new Set(["read", "grep", "glob"]),
		availableToolNames: ["read", "grep", "glob", "probe-tool [raw]"],
		scopedModels: [{ model, thinkingLevel: thinkingApi.ThinkingLevel.Inherit }],
		defaultModelLabel: "probe-provider/legacy-model-id",
	}, "project", advisorDoc, advisorCallbacks);
	await Promise.resolve();
	const advisorList = render(advisor);
	fixedEnglish(advisorList, "Advisor configuration · project", "legacy advisor project scope");
	fixedEnglish(advisorList, "Save & apply", "legacy advisor save caption");
	fixedEnglish(advisorList, "Scope: project", "legacy advisor scope caption");
	canonical(advisorList, "Probe Advisor [raw]", "legacy advisor name", fixture);
	canonical(advisorList, "Probe instructions [raw] keep high/inherit unchanged.", "legacy advisor instructions", fixture);
	advisor.handleInput?.("\r");
	const advisorDetail = render(advisor);
	for (const caption of ["Name", "Enabled", "Model", "Tools", "Instructions"]) fixedEnglish(advisorDetail, caption, "legacy advisor editor field");
	advisor.handleInput?.("\x1b[B");
	advisor.handleInput?.("\x1b[B");
	advisor.handleInput?.("\r");
	const modelPicker = render(advisor);
	canonical(modelPicker, "probe-provider/legacy-model-id", "legacy advisor model selector", fixture);
	canonical(modelPicker, "Legacy Probe Model [raw]", "legacy advisor model name", fixture);
	advisor.handleInput?.("\r");
	const effortPicker = render(advisor);
	fixedEnglish(effortPicker, "(model default thinking)", "legacy advisor inherited thinking option");
	for (const level of ["low", "medium", high]) canonical(effortPicker, level, "legacy advisor thinking enum", fixture);
	for (let step = 0; step < 3; step++) advisor.handleInput?.("\x1b[B");
	advisor.handleInput?.("\r");
	strictEqual(advisorDoc.advisors[0]?.model, `probe-provider/legacy-model-id:${high}`, "legacy advisor persists its actual model:effort selector in memory");
	const selectedAdvisor = render(advisor);
	canonical(selectedAdvisor, `probe-provider/legacy-model-id:${high}`, "legacy advisor selected model value", fixture);
	const inheritedDoc: { advisors: { name: string; model?: string }[] } = { advisors: [{ name: "Probe Inherit Advisor [raw]" }] };
	const inheritedAdvisor = new advisorApi.AdvisorConfigOverlayComponent({}, {
		getAvailableModels: () => [model],
		browserSource,
		defaultToolNames: new Set(["read", "grep", "glob"]),
		availableToolNames: ["read", "grep", "glob"],
		scopedModels: [{ model, thinkingLevel: thinkingApi.ThinkingLevel.Inherit }],
	}, "user", inheritedDoc, advisorCallbacks);
	await Promise.resolve();
	fixedEnglish(render(inheritedAdvisor), "Advisor configuration · user", "legacy advisor user scope");
	inheritedAdvisor.handleInput?.("\r");
	inheritedAdvisor.handleInput?.("\x1b[B");
	inheritedAdvisor.handleInput?.("\x1b[B");
	inheritedAdvisor.handleInput?.("\r");
	inheritedAdvisor.handleInput?.("\r");
	inheritedAdvisor.handleInput?.("\r");
	strictEqual(inheritedDoc.advisors[0]?.model, "probe-provider/legacy-model-id", "legacy default thinking choice leaves the model selector inherited");
	strictEqual(advisorSaves + advisorLoads + advisorCloses + advisorNotices, 0, "legacy advisor probe never saves, switches scope, closes, or notifies");
	advisor.dispose?.();
	inheritedAdvisor.dispose?.();

	let jobsPresentation: unknown;
	const inertJob = Object.freeze({
		id: "job:legacy-probe-id [raw]",
		type: "bash",
		status: "running",
		label: "echo Probe command [raw]",
		startTime: Date.now() - 5_000,
		ownerId: "legacy-root-agent [raw]",
		agentId: "legacy-agent [raw]",
	});
	const jobSnapshot = Object.freeze({ running: Object.freeze([inertJob]), recent: Object.freeze([]) });
	const jobsController = new commandApi.CommandController({
		session: {
			getAsyncJobSnapshot(options: { recentLimit: number }) {
				strictEqual(options.recentLimit, 5, "legacy /jobs uses the host's bounded snapshot");
				return jobSnapshot;
			},
		},
		ui: { terminal: { columns: 100 } },
		presentCommandOutput(content: unknown) { jobsPresentation = content; },
	} as never);
	await jobsController.handleJobsCommand();
	const jobsComponents = Array.isArray(jobsPresentation) ? jobsPresentation : [jobsPresentation];
	if (!jobsComponents.some(component => component instanceof tuiText.Text)) {
		throw new Error(`legacy /jobs did not present the real host Text component: ${JSON.stringify(jobsPresentation)}`);
	}
	const jobsText = jobsComponents.map(component => render(component as Renderable)).join("\n");
	for (const caption of ["Background Jobs", "Running:", "Running Jobs"]) fixedEnglish(jobsText, caption, "legacy /jobs caption");
	for (const value of ["job:legacy-probe-id [raw]", "bash", "running", "echo Probe command [raw]"]) canonical(jobsText, value, "legacy /jobs caller data", fixture);

	const settingsModule = await fixture.load("@oh-my-pi/pi-coding-agent/config/settings") as { settings: unknown };
	let sessionInfo = "";
	let sessionInfoCloses = 0;
	const sessionStats = {
		sessionFile: "Probe session file [raw]",
		sessionId: "session:legacy-probe-id [raw]",
		premiumRequests: 1.25,
		userMessages: 2,
		assistantMessages: 3,
		toolCalls: 4,
		toolResults: 4,
		totalMessages: 9,
		tokens: { input: 123, output: 456, total: 579, cacheRead: 17, cacheWrite: 19 },
		cost: 0.0123,
	};
	const sessionController = new commandApi.CommandController({
		session: { getSessionStats: () => sessionStats, model: undefined },
		settings: settingsModule.settings,
		showSessionInfo(info: string) { sessionInfo = info; },
	} as never);
	await sessionController.handleSessionCommand();
	if (!sessionInfo) throw new Error("legacy /session info did not reach the actual CommandController presentation path");
	const sessionOverlayApi = await fixture.load("@oh-my-pi/pi-tui/overlays/session-info-overlay") as {
		SessionInfoOverlay: new (host: { terminal: { rows: number } }, info: string, onClose: () => void) => Renderable;
	};
	const sessionOverlay = new sessionOverlayApi.SessionInfoOverlay({ terminal: { rows: 32 } }, sessionInfo, () => { sessionInfoCloses++; });
	const sessionReport = render(sessionOverlay);
	fixedEnglish(sessionReport.split("\n").slice(0, 2).join("\n"), "Session Info", "legacy report panel title");
	for (const caption of ["File:", "ID:", "Provider", "No model selected", "Messages", "Tool Calls:", "Tool Results:", "Append-Only:", "Tokens", "Output:", "Premium Requests:"]) {
		fixedEnglish(sessionReport, caption, "legacy session report caption");
	}
	for (const value of ["Probe session file [raw]", "session:legacy-probe-id [raw]", "Output: 456", "Premium Requests: 1.25"]) {
		canonical(sessionReport, value, "legacy session report data", fixture);
	}
	sessionOverlay.handleInput?.("\x1b");
	strictEqual(sessionInfoCloses, 1, "legacy session report closes through its real Escape handler");
	sessionOverlay.dispose?.();

	const pauseApi = await fixture.load("@oh-my-pi/pi-tui/overlays/pause-screen") as {
		runPauseScreen(host: {
			ui: {
				showOverlay(component: Renderable, options?: unknown): { hide(): void };
				setFocus(component: Renderable): void;
				requestRender(): void;
				terminal: { rows: number };
			};
			showStatus(message: string): void;
			sessionName?: string;
		}): Promise<void>;
	};
	let pauseComponent: Renderable | undefined;
	let pauseOverlays = 0;
	let pauseFocus = 0;
	let pauseHides = 0;
	let pauseRenders = 0;
	let resumeMessage = "";
	const pauseTask = pauseApi.runPauseScreen({
		ui: {
			showOverlay(component) {
				pauseOverlays++;
				pauseComponent = component;
				return { hide() { pauseHides++; } };
			},
			setFocus(component) {
				strictEqual(component, pauseComponent, "pause runner focuses its real captured view");
				pauseFocus++;
			},
			requestRender() { pauseRenders++; },
			terminal: { rows: 30 },
		},
		showStatus(message) { resumeMessage = message; },
		sessionName: "Probe session [raw]",
	});
	let pauseScreen = "";
	try {
		if (!pauseComponent) throw new Error("legacy public pause runner did not create its view through showOverlay");
		pauseScreen = render(pauseComponent, 100);
		for (const caption of ["P A U S E D", "Main agent, subagents, and advisor hold at their next step.", "In-flight calls finish; nothing new starts until you resume.", "esc · enter · space — resume"]) {
			fixedEnglish(pauseScreen, caption, "legacy pause screen caption");
		}
		canonical(pauseScreen, "Probe session [raw]", "legacy pause session name", fixture);
	} finally {
		pauseComponent?.handleInput?.("\r");
		await pauseTask;
	}
	strictEqual(pauseOverlays, 1, "legacy pause runner mounted one actual view");
	strictEqual(pauseFocus, 2, "legacy pause runner restores focus after resume");
	strictEqual(pauseHides, 1, "legacy pause runner hides its overlay after resume");
	strictEqual(pauseRenders > 0, true, "legacy pause runner requests a render");
	includes(resumeMessage, "agents are running again", "legacy pause resume status");

	const cli = await fixture.load("@oh-my-pi/pi-utils/cli") as {
		run(options: {
			bin: string;
			version: string;
			argv: string[];
			commands: Array<{ name: string; load(): Promise<unknown> }>;
		}): Promise<void>;
	};
	const statsCommand = await fixture.load("@oh-my-pi/pi-coding-agent/commands/stats") as { default: unknown };
	let statsErrorOutput = "";
	const previousWrite = process.stderr.write;
	const previousExitCode = process.exitCode;
	let statsCliExitCode: number | undefined;
	process.stderr.write = ((chunk: string | Uint8Array) => {
		statsErrorOutput += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	}) as typeof process.stderr.write;
	try {
		await cli.run({
			bin: "omp",
			version: fixture.launch.host.version,
			argv: ["stats", "--port", "not-a-port"],
			commands: [{ name: "stats", load: async () => statsCommand.default }],
		});
		const exitCode = process.exitCode;
		statsCliExitCode = typeof exitCode === "string" ? Number(exitCode) : exitCode ?? undefined;
	} finally {
		process.stderr.write = previousWrite;
		process.exitCode = previousExitCode ?? 0;
	}
	strictEqual(statsCliExitCode, 1, "legacy CLI marks the actual invalid-argument path as a usage error");
	strictEqual(process.exitCode, previousExitCode ?? 0, "legacy parse probe restores the caller process status");
	const statsErrorText = render(new tuiText.Text(statsErrorOutput, 0, 0));
	for (const caption of ["error:", "USAGE", "Run `omp stats --help` for details."]) fixedEnglish(statsErrorText, caption, "legacy stats parse error caption");
	includes(statsErrorText, 'Expected integer for --port, got "not-a-port"', "legacy stats parse error");
	includes(statsErrorText, "omp stats", "legacy stats parse usage");

	const result = {
		mode,
		component: "LegacyAdditionalMenus",
		hostVersion: fixture.launch.host.version,
		surfaces: [
			{ id: "usage-dashboard", overview: usageOverview, details: usageDetails, activityLoads, readOnlyUnknownKey: "r", provider: report.provider, quotaStatus: report.limits[0]?.status, windowId: report.limits[0]?.window?.id },
			{ id: "usage-display", eligibility: helperReset, translatedStatus: expectedHelperText, window: { id: "anthropic:7d", label: usageDisplay.formatUsageResetWindow("anthropic:7d") } },
			{ id: "advisor-config", project: advisorList, detail: advisorDetail, modelPicker, effortPicker, selectedModel: advisorDoc.advisors[0]?.model, inheritedModel: inheritedDoc.advisors[0]?.model, inheritValue: thinkingApi.ThinkingLevel.Inherit, userScope: "user" },
			{ id: "jobs-command", route: "/jobs", text: jobsText, jobId: inertJob.id, command: inertJob.label },
			{ id: "session-report", route: "/session info", text: sessionReport, sessionId: sessionStats.sessionId },
			{ id: "pause-screen", view: pauseScreen, resumed: resumeMessage },
			{ id: "stats-parse-error", output: statsErrorText },
		],
	};
	process.stdout.write(`${JSON.stringify(result)}\n`);
	process.exitCode = previousExitCode ?? 0;
} finally {
	fixture.close();
}
