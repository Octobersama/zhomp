import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLegacySurfaceFixture } from "./legacy-surface-fixture";

interface Renderable {
	render(width: number): readonly string[];
}

interface MCPControllerModule {
	MCPCommandController: new (context: unknown) => { handle(text: string): Promise<void> };
}

interface TranscriptModule {
	TranscriptBlock: new (...args: never[]) => Renderable;
}

interface AgentHubInstance extends Renderable {
	persistedSubagentsReady: Promise<void>;
	dispose(): void;
}

interface AgentHubModule {
	AgentHubOverlayComponent: new (dependencies: unknown) => AgentHubInstance;
}

interface SessionObserverModule {
	SessionObserverRegistry: new () => unknown;
}

interface SessionInfoInstance extends Renderable {
	handleInput(data: string): void;
	dispose(): void;
}

interface SessionInfoModule {
	SessionInfoOverlay: new (host: { terminal: { rows: number } }, info: string, onClose: () => void) => SessionInfoInstance;
}

interface AgentsHubInstance extends Renderable {
	dispose(): void;
}

interface AgentsHubModule {
	AgentsHubComponent: {
		create(tui: unknown, dependencies: unknown, callbacks: { onCancel: () => void }): Promise<AgentsHubInstance>;
	};
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function stripTerminalFormatting(value: string): string {
	const ansiSequences = /\x1b\[[0-?]*[ -/]*[@-~]/g;
	return value.replace(ansiSequences, "");
}

function compactRenderedAnsi(rendered: string): string {
	const contentRows: string[] = [];
	for (const row of rendered.split("\n")) {
		const visible = stripTerminalFormatting(row).replace(/[╭╮╰╯─│┬┴├┤┼]/g, "").trim();
		if (visible.length > 0) contentRows.push(row.trimEnd());
	}
	return contentRows.join("\n");
}

function assertContains(surface: string, rendered: string, expected: string): void {
	assert(
		rendered.includes(expected),
		`${surface} must render ${JSON.stringify(expected)}; rendered ${JSON.stringify(rendered)}`,
	);
}

function assertRawValue(
	surface: string,
	rendered: string,
	value: string,
	dictionary: Readonly<Record<string, string>>,
): void {
	assertContains(surface, rendered, value);
	const replacement = dictionary[value];
	if (replacement && replacement !== value) {
		assert(
			!rendered.includes(replacement),
			`${surface} translated dynamic value ${JSON.stringify(value)} to ${JSON.stringify(replacement)}`,
		);
	}
}

const fixture = await loadLegacySurfaceFixture();
const disposers: Array<() => void> = [];
let evidence: Record<string, unknown>;
try {
	const packageJson = JSON.parse(readFileSync(join(fixture.launch.host.packageDir, "package.json"), "utf8")) as {
		version?: string;
	};
	const hostVersion = packageJson.version;
	assert(hostVersion === "18.3.2", `Expected installed legacy host 18.3.2, got ${JSON.stringify(hostVersion)}`);

	const [mcpControllerApi, transcriptApi, agentHubApi, observerApi, sessionInfoApi, agentsHubApi] = await Promise.all([
		fixture.load("@oh-my-pi/pi-coding-agent/modes/controllers/mcp-command-controller"),
		fixture.load("@oh-my-pi/pi-tui/chrome/transcript-container"),
		fixture.load("@oh-my-pi/pi-tui/overlays/agent-hub"),
		fixture.load("@oh-my-pi/pi-tui/overlays/session-observer-registry"),
		fixture.load("@oh-my-pi/pi-tui/overlays/session-info-overlay"),
		fixture.load("@oh-my-pi/pi-tui/overlays/agents-hub"),
	]);
	const { MCPCommandController } = mcpControllerApi as MCPControllerModule;
	const { TranscriptBlock } = transcriptApi as TranscriptModule;
	const { AgentHubOverlayComponent } = agentHubApi as AgentHubModule;
	const { SessionObserverRegistry } = observerApi as SessionObserverModule;
	const { SessionInfoOverlay } = sessionInfoApi as SessionInfoModule;
	const { AgentsHubComponent } = agentsHubApi as AgentsHubModule;

	let presentedOutput: Renderable | undefined;
	let presentedOutputCount = 0;
	const mcpController = new MCPCommandController({
		presentCommandOutput(output: Renderable) {
			presentedOutput = output;
			presentedOutputCount++;
		},
		showError(message: string) {
			throw new Error(`/mcp help unexpectedly reported an error: ${message}`);
		},
	});
	await mcpController.handle("/mcp help");
	assert(presentedOutput instanceof TranscriptBlock, "/mcp help must use the legacy TranscriptBlock UI seam");
	assert(presentedOutputCount === 1, `/mcp help should present one command output block, got ${presentedOutputCount}`);
	const mcpAnsi = presentedOutput.render(240).join("\n");
	const mcpRendered = stripTerminalFormatting(mcpAnsi);
	const mcpTitle = "MCP Server Management";
	const mcpIntroduction = "Manage Model Context Protocol (MCP) servers for external tool integrations.";
	assertContains("legacy /mcp help title", mcpRendered, mcpTitle);
	assertContains("legacy /mcp help body", mcpRendered, mcpIntroduction);
	assertContains("legacy /mcp help command list", mcpRendered, "Commands:");
	assertContains("legacy /mcp help syntax", mcpRendered, "/mcp add <name> [--scope project|user]");
	assertContains("legacy /mcp help final command", mcpRendered, "/mcp help             Show this help message");

	const blockedFileSystem = {
		openSync() {
			throw new Error("Legacy Agent Hub probe must not open files");
		},
		closeSync() {
			throw new Error("Legacy Agent Hub probe must not close file descriptors");
		},
		readSync() {
			throw new Error("Legacy Agent Hub probe must not read files");
		},
		readFileSync() {
			throw new Error("Legacy Agent Hub probe must not read files");
		},
		statSync() {
			throw new Error("Legacy Agent Hub probe must not stat files");
		},
	};
	const transcript = { fs: blockedFileSystem, parseEntries: () => [] };
	const activity = {
		setLive() {},
		async sync() {},
		query() {
			return [];
		},
		recent() {
			return [];
		},
	};
	const emptyRegistry = {
		list() {
			return [];
		},
		get() {
			return undefined;
		},
		onChange() {
			return () => {};
		},
	};
	const rawName = "Agent Hub";
	const rawAgentId = "legacy-management-agent-raw-42";
	const namedRecord = {
		id: rawAgentId,
		displayName: rawName,
		kind: "sub" as const,
		parentId: "Main",
		status: "idle" as const,
		session: null,
		sessionFile: null,
		createdAt: 1_790_000_000_000,
		lastActivity: 1_790_000_000_000,
	};
	const namedRegistry = {
		list() {
			return [namedRecord];
		},
		get(id: string) {
			return id === namedRecord.id ? namedRecord : undefined;
		},
		onChange() {
			return () => {};
		},
	};
	let lifecycleActionCalls = 0;
	function makeAgentHub(initialSection: "agents" | "activity", registry: unknown): AgentHubInstance {
		return new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			transcript,
			async loadPersisted() {},
			hubKeys: [],
			onDone() {},
			requestRender() {},
			registry,
			lifecycle() {
				lifecycleActionCalls++;
				return {
					async ensureLive() {
						throw new Error("Legacy Agent Hub lifecycle actions are blocked in this probe");
					},
					async release() {
						throw new Error("Legacy Agent Hub lifecycle actions are blocked in this probe");
					},
				};
			},
			irc: {
				unreadCount() {
					return 0;
				},
			},
			activity,
			manageActivityLive: false,
			initialSection,
			cwd: fixture.root,
		});
	}

	const emptyRosterHub = makeAgentHub("agents", emptyRegistry);
	const namedRosterHub = makeAgentHub("agents", namedRegistry);
	const activityHub = makeAgentHub("activity", emptyRegistry);
	disposers.push(() => emptyRosterHub.dispose(), () => namedRosterHub.dispose(), () => activityHub.dispose());
	await Promise.all([
		emptyRosterHub.persistedSubagentsReady,
		namedRosterHub.persistedSubagentsReady,
		activityHub.persistedSubagentsReady,
	]);
	const emptyRosterAnsi = emptyRosterHub.render(120).join("\n");
	const namedRosterAnsi = namedRosterHub.render(120).join("\n");
	const activityAnsi = activityHub.render(120).join("\n");
	const emptyRoster = stripTerminalFormatting(emptyRosterAnsi);
	const namedRoster = stripTerminalFormatting(namedRosterAnsi);
	const activityRendered = stripTerminalFormatting(activityAnsi);
	assertContains("legacy Agent Hub roster title", namedRoster, "Agent Hub");
	assertContains("legacy Agent Hub roster heading", emptyRoster, "Roster");
	assertContains("legacy Agent Hub flat projection", emptyRoster, "Flat");
	assertContains("legacy Agent Hub parent projection", emptyRoster, "By parent");
	assertContains("legacy Agent Hub empty roster", emptyRoster, "No agents in this session");
	assertContains("legacy Agent Hub selected raw id", namedRoster, rawAgentId);
	assert(namedRoster.split(rawName).length - 1 >= 2, "Legacy Agent Hub must retain the raw display name as well as its title");
	assertRawValue("legacy Agent Hub raw display name", namedRoster, rawName, fixture.dictionary);
	assertContains("legacy Agent Hub selected detail heading", namedRoster, "Recent activity");
	assertContains("legacy Agent Hub selected detail empty state", namedRoster, "No response or tool activity yet");
	assertContains("legacy Agent Hub activity title", activityRendered, "Agent Hub");
	assertContains("legacy Agent Hub activity empty state", activityRendered, "No agent activity recorded yet");
	assert(lifecycleActionCalls === 0, `Legacy Agent Hub invoked lifecycle actions ${lifecycleActionCalls} times`);

	const sessionId = "management-probe-session-8f91";
	const sessionPath = "/probe/fixtures/management-session.jsonl";
	const providerName = "Settings";
	const mcpServerName = "Agent Hub";
	const lspServerName = "Settings";
	const sessionReport = [
		`File: ${sessionPath}`,
		`ID: ${sessionId}`,
		"Build: build-digest-7f2a",
		"Running: runtime-build-9.8.7",
		"",
		"Provider",
		`Name: ${providerName}`,
		"Model: probe-model-v7",
		"API: probe-api/raw",
		"Auth: oauth-runtime-state",
		"Endpoint: https://probe.invalid/v1",
		"Source: credential-source-raw",
		"Transport: websocket",
		"",
		"Messages",
		"User: 12",
		"Assistant: 8",
		"Tool Calls: 4",
		"Tool Results: 3",
		"Total: 27",
		"Append-Only: active (setting: auto)",
		"",
		"Tokens",
		"Input: 1,234",
		"Output: 567",
		"Cache Read: 80",
		"Cache Write: 20",
		"Total: 1,901",
		"",
		"Cost",
		"Total: 0.1250",
		"Premium Requests: 2",
		"Credits: 0.75",
		"Committed Credits: 0.25",
		"Committed ACU: 3",
		"",
		"LSP Servers",
		`${lspServerName}: ready (typescript,jsonl)`,
		"",
		"MCP Servers",
		`${mcpServerName}: connected (3 tools)`,
	].join("\n");
	let closeCallbacks = 0;
	const sessionInfo = new SessionInfoOverlay({ terminal: { rows: 80 } }, sessionReport, () => closeCallbacks++);
	disposers.push(() => sessionInfo.dispose());
	const sessionInfoAnsi = sessionInfo.render(180).join("\n");
	const sessionInfoRendered = stripTerminalFormatting(sessionInfoAnsi);
	const sessionTitle = "Session Info";
	const sessionFooter = "↑/↓ scroll · Esc close";
	assertContains("legacy Session Info title", sessionInfoRendered, sessionTitle);
	assertContains("legacy Session Info footer", sessionInfoRendered, sessionFooter);
	assertContains("legacy Session Info raw ID", sessionInfoRendered, sessionId);
	assertContains("legacy Session Info raw path", sessionInfoRendered, sessionPath);
	assertContains("legacy Session Info raw provider value", sessionInfoRendered, providerName);
	assertContains("legacy Session Info MCP server value", sessionInfoRendered, `${mcpServerName}: connected (3 tools)`);
	assertContains("legacy Session Info LSP server value", sessionInfoRendered, `${lspServerName}: ready (typescript,jsonl)`);
	assertRawValue("legacy Session Info provider value", sessionInfoRendered, providerName, fixture.dictionary);
	assertRawValue("legacy Session Info MCP server value", sessionInfoRendered, mcpServerName, fixture.dictionary);
	assertRawValue("legacy Session Info LSP server value", sessionInfoRendered, lspServerName, fixture.dictionary);
	sessionInfo.handleInput("\x1b");
	assert(closeCallbacks === 1, `Session Info Esc should invoke its close callback once, got ${closeCallbacks}`);

	const agentConfigureName = "Settings";
	const configuredAgent = {
		name: agentConfigureName,
		description: "Raw in-memory agent configuration fixture",
		systemPrompt: "Never write this fixture to disk.",
		source: "bundled" as const,
		disabled: false,
	};
	const inertBrowserSource = {
		defaultThinkingLevel: "high",
		modelProviderOrder: [],
		knownRoleIds: [],
		mruOrder: [],
		modelPerf: new Map(),
		getModelRole() {
			return undefined;
		},
		getRoleInfo() {
			throw new Error("Legacy /agents configure probe must not resolve model roles");
		},
		defaultRoleChain() {
			return [];
		},
		resolveRoleValue() {
			return { model: undefined, explicitThinkingLevel: false };
		},
	};
	const tui = {
		terminal: { rows: 40, columns: 120 },
		requestRender() {},
		requestComponentRender() {},
	};
	let agentConfigureCancelCalls = 0;
	const agentsHub = await AgentsHubComponent.create(
		tui,
		{
			browserSource: inertBrowserSource,
			async loadAgents() {
				return [configuredAgent];
			},
			getAvailableModels() {
				return [];
			},
			effectiveModelPatterns() {
				return [];
			},
			resolvePatterns() {
				return undefined;
			},
			effectivePrewalkPattern() {
				return undefined;
			},
			effectiveAdvisorPattern() {
				return undefined;
			},
			setDisabledAgents() {
				throw new Error("Legacy /agents configure probe must not mutate settings");
			},
			setOverrides() {
				throw new Error("Legacy /agents configure probe must not mutate settings");
			},
			async generateAgent() {
				throw new Error("Legacy /agents configure probe must not call a model");
			},
			async saveAgent() {
				throw new Error("Legacy /agents configure probe must not write agent files");
			},
		},
		{
			onCancel() {
				agentConfigureCancelCalls++;
			},
		},
	);
	disposers.push(() => agentsHub.dispose());
	const agentsConfigureAnsi = agentsHub.render(120).join("\n");
	const agentsConfigureRendered = stripTerminalFormatting(agentsConfigureAnsi);
	assertContains("legacy /agents configure hub title", agentsConfigureRendered, "Agents");
	assertContains("legacy /agents configure raw agent name", agentsConfigureRendered, agentConfigureName);
	assertRawValue("legacy /agents configure raw agent name", agentsConfigureRendered, agentConfigureName, fixture.dictionary);
	assert(agentConfigureCancelCalls === 0, "Rendering the legacy /agents configure hub must not cancel it");

	let hostileDictionaryValues: Record<string, string> | null = null;
	if (fixture.mode === "hostile") {
		hostileDictionaryValues = {
			Settings: fixture.dictionary.Settings,
			"Agent Hub": fixture.dictionary["Agent Hub"],
			high: fixture.dictionary.high,
			id: fixture.dictionary.id,
		};
		assert(hostileDictionaryValues.Settings === "恶意设置值", "Hostile Settings dictionary text must remain data");
		assert(hostileDictionaryValues["Agent Hub"] === "恶意代理标题", "Hostile Agent Hub dictionary text must remain data");
		assert(hostileDictionaryValues.high === "恶意high值", "Hostile high dictionary text must remain data");
		assert(hostileDictionaryValues.id === "恶意ID值", "Hostile id dictionary text must remain data");
	}

	evidence = {
		mode: fixture.mode,
		component: "LegacyManagementMenus",
		hostVersion,
		surfaces: [
			{
				name: "mcpHelp",
				controller: "MCPCommandController.handle('/mcp help')",
				title: mcpTitle,
				body: mcpIntroduction,
				commandListRendered: mcpRendered.includes("Commands:"),
				legacyPresentation: "TranscriptBlock rendered at 240 columns",
				presentedOutputCount,
				rendered: compactRenderedAnsi(mcpAnsi),
			},
			{
				name: "agentHubRoster",
				title: "Agent Hub",
				emptyState: "No agents in this session",
				rendered: compactRenderedAnsi(emptyRosterAnsi),
			},
			{
				name: "agentHubNamedRecord",
				title: "Agent Hub",
				rawName,
				rawId: rawAgentId,
				rendered: compactRenderedAnsi(namedRosterAnsi),
			},
			{
				name: "agentHubActivity",
				title: "Agent Hub",
				emptyState: "No agent activity recorded yet",
				rendered: compactRenderedAnsi(activityAnsi),
			},
			{
				name: "sessionInfo",
				title: sessionTitle,
				footer: sessionFooter,
				values: { id: sessionId, path: sessionPath, provider: providerName, mcpServer: mcpServerName, lspServer: lspServerName },
				keyboardInput: "Escape",
				closeCallbacks,
				rendered: compactRenderedAnsi(sessionInfoAnsi),
			},
			{
				name: "agentsConfigureHub",
				viewFactory: "AgentsHubComponent.create",
				commandSurface: "/agents configure",
				title: "Agents",
				rawAgentName: agentConfigureName,
				rendered: compactRenderedAnsi(agentsConfigureAnsi),
			},
		],
		guards: { lifecycleActionCalls, hostileNamesRemainDictionaryData: hostileDictionaryValues },
	};
} finally {
	for (const dispose of disposers.reverse()) dispose();
	fixture.close();
}

console.log(JSON.stringify(evidence));
