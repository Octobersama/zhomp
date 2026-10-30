import type { MenuModule } from "./menu-catalog";

type AgentViewMenuPatch = MenuModule["patches"][number];

function menuText(source: string): string {
	return `__zhompMenuText(${JSON.stringify(source)})`;
}

function templateText(source: string): string {
	return "${" + menuText(source) + "}";
}

function patch(before: string, after: string, count = 1): AgentViewMenuPatch {
	return { before, after, count };
}

const TRANSCRIPT_VIEWER_PATCHES: readonly AgentViewMenuPatch[] = [
	patch(
		'this.#editor ? actionHint("tui.input.submit", "send") : undefined',
		'this.#editor ? actionHint("tui.input.submit", ' + menuText("send") + ") : undefined",
	),
	patch(
		'{ keys: [this.#deps.expandKeys[0] ?? "ctrl+o"], label: "expand" }',
		'{ keys: [this.#deps.expandKeys[0] ?? "ctrl+o"], label: ' + menuText("expand") + " }",
	),
	patch(
		'span("Agent Hub", "accent")',
		'span(' + menuText("Agent Hub") + ', "accent")',
	),
	patch(
		'`Agent Hub ${theme.sep.dot} ${this.#deps.agentId}`',
		'`${' + menuText("Agent Hub") + '} ${theme.sep.dot} ${this.#deps.agentId}`',
	),
	patch("} of ${parentId}", "} ${" + menuText("of") + "} ${parentId}"),
	patch("} of ${ref.parentId}", "} ${" + menuText("of") + "} ${ref.parentId}"),
	patch(":close  ", ":" + templateText("close") + "  "),
	patch(":expand  ", ":" + templateText("expand") + "  "),
	patch('"empty input → "', menuText("empty input →") + ' + " "'),
	patch(":scroll  ", ":" + templateText("scroll") + "  "),
	patch(":top/bottom", ":" + templateText("top/bottom")),
	patch(":send  ", ":" + templateText("send") + "  "),
	patch(
		'return "Transcript lives on the host — not available.";',
		"return " + menuText("Transcript lives on the host — not available.") + ";",
	),
	patch(
		'return this.#hasRemoteData ? "No messages yet." : "Loading transcript from host…";',
		"return this.#hasRemoteData ? " + menuText("No messages yet.") + " : " + menuText("Loading transcript from host…") + ";",
	),
	patch(
		'return "No session file available yet.";',
		"return " + menuText("No session file available yet.") + ";",
	),
	patch(
		'return "No messages yet.";',
		"return " + menuText("No messages yet.") + ";",
		1,
	),
];

const ACTIVITY_PATCHES: readonly AgentViewMenuPatch[] = [
	patch(
		'summary: progress.task ?? progress.description ?? "Agent activity",',
		'summary: progress.task ?? progress.description ?? ' + menuText("Agent activity") + ",",
	),
	patch('title: "Response",', "title: " + menuText("Response") + ","),
];

export const AGENT_VIEW_MENU_MODULES: readonly MenuModule[] = [
	{ root: "tui", path: "src/overlays/agent-transcript-viewer.ts", patches: TRANSCRIPT_VIEWER_PATCHES },
	{ root: "tui", path: "src/overlays/agent-activity.ts", patches: ACTIVITY_PATCHES },
];

export const AGENT_VIEW_MENU_TEXT_KEYS: readonly string[] = [
	"Agent Hub",
	"send",
	"expand",
	"close",
	"empty input →",
	"scroll",
	"top/bottom",
	"No messages yet.",
	"Loading transcript from host…",
	"No session file available yet.",
	"Transcript lives on the host — not available.",
	"Agent activity",
	"of",
	"Response",
];
