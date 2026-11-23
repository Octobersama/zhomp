import type { MenuModule } from "./menu-catalog";

const LEGACY_PLAN_WARNING = "Plan mode: the `write` tool is provided by an extension and cannot submit plans. Disable it to use plan mode.";
const PLAN_WARNING = "Plan mode: the `write` tool is provided by an extension and stays disabled while planning.";
const WORKTREE_WARNING = '`Kept worktree ${shortenPath(worktree.path)}: its post-checkout hook is still running.`';

export const STARTUP_MENU_MODULES: readonly MenuModule[] = [
	{
		root: "agent",
		path: "src/modes/interactive-mode.ts",
		patches: [
			{
				before: 'new Text("What\'s New", 1, 0)',
				after: 'new Text(__zhompMenuText("What\'s New"), 1, 0)',
				count: 1,
			},
		],
		variants: [
			[
				{ before: JSON.stringify(LEGACY_PLAN_WARNING), after: JSON.stringify(LEGACY_PLAN_WARNING), count: 0 },
				{ before: JSON.stringify(PLAN_WARNING), after: JSON.stringify(PLAN_WARNING), count: 0 },
				{ before: WORKTREE_WARNING, after: WORKTREE_WARNING, count: 0 },
			],
			[
				{ before: JSON.stringify(LEGACY_PLAN_WARNING), after: `__zhompMenuText(${JSON.stringify(LEGACY_PLAN_WARNING)})` },
				{ before: JSON.stringify(PLAN_WARNING), after: JSON.stringify(PLAN_WARNING), count: 0 },
				{ before: WORKTREE_WARNING, after: WORKTREE_WARNING, count: 0 },
			],
			[
				{ before: JSON.stringify(LEGACY_PLAN_WARNING), after: JSON.stringify(LEGACY_PLAN_WARNING), count: 0 },
				{ before: JSON.stringify(PLAN_WARNING), after: `__zhompMenuText(${JSON.stringify(PLAN_WARNING)})` },
				{ before: WORKTREE_WARNING, after: '__zhompMenuText("Kept worktree {path}: its post-checkout hook is still running.", { path: shortenPath(worktree.path) })' },
			],
		],
	},
];

export const STARTUP_MENU_TEXT_KEYS: readonly string[] = [
	"What's New",
	LEGACY_PLAN_WARNING,
	PLAN_WARNING,
	"Kept worktree {path}: its post-checkout hook is still running.",
];
