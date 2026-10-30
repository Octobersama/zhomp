import type { MenuModule } from "./menu-catalog";

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
	},
];

export const STARTUP_MENU_TEXT_KEYS: readonly string[] = ["What's New"];
