import type { MenuModule } from "./menu-catalog";

type SetupMenuPatch = MenuModule["patches"][number];

function menuText(source: string): string {
	return `__zhompMenuText(${JSON.stringify(source)})`;
}

function translatedText(source: string, values: string): string {
	return `__zhompMenuText(${JSON.stringify(source)}, { ${values} })`;
}

function patch(before: string, after: string, count = 1): SetupMenuPatch {
	return { before, after, count };
}

const WIZARD_PATCHES: readonly SetupMenuPatch[] = [
	patch(
		'\treturn `${navKeys} select · ${editorKey("tui.select.confirm")} confirm · ${editorKey("tui.select.cancel")} skip · ${formatKeyHint("ctrl+c")} exit setup`;',
		'\treturn ' + translatedText("{navKeys} select · {confirm} confirm · {skip} skip · {exit} exit setup", 'navKeys, confirm: editorKey("tui.select.confirm"), skip: editorKey("tui.select.cancel"), exit: formatKeyHint("ctrl+c")') + ";",
	),
	patch('const title = active?.title ?? scene?.title ?? "Setup";', `const title = active?.title ?? scene?.title ?? ${menuText("Setup")};`),
	patch('const title = this.#activeScene?.title ?? scene?.title ?? "Setup";', `const title = this.#activeScene?.title ?? scene?.title ?? ${menuText("Setup")};`),
];

const WIZARD_OLD_VARIANT: readonly SetupMenuPatch[] = [
	patch(
		'text([span(`Setup step ${this.#sceneIndex + 1} of ${this.scenes.length}`, "muted")], {',
		'text([span(' + translatedText("Setup step {current} of {total}", 'current: this.#sceneIndex + 1, total: this.scenes.length') + ', "muted")], {',
	),
	patch(
		'centerLine(theme.fg("muted", `Setup step ${this.#sceneIndex + 1} of ${this.scenes.length}`), width),',
		'centerLine(theme.fg("muted", ' + translatedText("Setup step {current} of {total}", 'current: this.#sceneIndex + 1, total: this.scenes.length') + '), width),',
	),
];

const WIZARD_CURRENT_VARIANT: readonly SetupMenuPatch[] = [
	patch(
		'centerLine(theme.fg("muted", `Setup step ${current + 1} of ${steps.length}`), width),',
		'centerLine(theme.fg("muted", ' + translatedText("Setup step {current} of {total}", 'current: current + 1, total: steps.length') + '), width),',
	),
	patch('span("Setup", "muted")', `span(${menuText("Setup")}, "muted")`),
	patch('actionButton("Exit setup", "exit", { keys: "ctrl+c" })', `actionButton(${menuText("Exit setup")}, "exit", { keys: "ctrl+c" })`),
	patch(
		'function stepNode(label: string, position: number, state: StepState): NativeNode {',
		[
			'function setupStepLabel(scene: SetupScene): string {',
			'\tswitch (scene.id) {',
			'\t\tcase "providers":',
			'\t\t\tif (scene.step === "Sign in") return __zhompMenuText("Sign in");',
			'\t\t\tbreak;',
			'\t\tcase "model":',
			'\t\t\tif (scene.step === "Model") return __zhompMenuText("Model");',
			'\t\t\tbreak;',
			'\t\tcase "glyph-mode":',
			'\t\t\tif (scene.step === "Symbols") return __zhompMenuText("Symbols");',
			'\t\t\tbreak;',
			'\t\tcase "composer-shape":',
			'\t\t\tif (scene.step === "Composer") return __zhompMenuText("Composer");',
			'\t\t\tbreak;',
			'\t\tcase "theme":',
			'\t\t\tif (scene.step === "Theme") return __zhompMenuText("Theme");',
			'\t\t\tbreak;',
			'\t}',
			'\treturn scene.step;',
			'}',
			'',
			'function stepNode(label: string, position: number, state: StepState): NativeNode {',
		].join("\n"),
	),
	patch(
		'stepNode(scene.step, position, position < current ? "done" : position === current ? "current" : "next"),',
		'stepNode(setupStepLabel(scene), position, position < current ? "done" : position === current ? "current" : "next"),',
	),
];

const OUTRO_PATCHES: readonly SetupMenuPatch[] = [
	patch('const title = theme.bold(theme.fg("success", `${theme.status.success} Setup saved`));', 'const title = theme.bold(theme.fg("success", `${theme.status.success} ${__zhompMenuText("Setup saved")}`));'),
];

const OUTRO_OLD_VARIANT: readonly SetupMenuPatch[] = [
	patch('const saved = `${theme.status.success} Setup saved`;', 'const saved = `${theme.status.success} ${__zhompMenuText("Setup saved")}`;'),
];

const OUTRO_CURRENT_VARIANT: readonly SetupMenuPatch[] = [
	patch('span("You\'re all set", "strong")', `span(${menuText("You're all set")}, "strong")`),
	patch('span("Default model", "muted")', `span(${menuText("Default model")}, "muted")`),
];

const MODEL_PATCHES: readonly SetupMenuPatch[] = [
	patch('subtitle = "Search configured models and save the model used for new sessions.";', `subtitle = ${menuText("Search configured models and save the model used for new sessions.")};`),
	patch(
		'`Type to search. ${formatKeyHint("enter")} saves the highlighted model as your default.`',
		translatedText("Type to search. {enter} saves the highlighted model as your default.", 'enter: formatKeyHint("enter")'),
	),
	patch(
		'`Type to search. ${enter} saves the highlighted model as your default.`',
		translatedText("Type to search. {enter} saves the highlighted model as your default.", "enter"),
	),
];

const MODEL_OLD_VARIANT: readonly SetupMenuPatch[] = [
	patch('title = "Choose your default model";', `title = ${menuText("Choose your default model")};`),
];

const MODEL_CURRENT_VARIANT: readonly SetupMenuPatch[] = [
	patch('const TITLE = "Choose your default model";', `const TITLE = ${menuText("Choose your default model")};`),
	patch('const SHEET_SUBTITLE = "Used by new sessions. Change it with /model.";', `const SHEET_SUBTITLE = ${menuText("Used by new sessions. Change it with /model.")};`),
];

const SIGN_IN_PATCHES: readonly SetupMenuPatch[] = [
	patch(
		'return `Sign in to one or more providers. Press ${editorKey("tui.select.cancel")} when you\'re done.`;',
		'return ' + translatedText("Sign in to one or more providers. Press {cancel} when you're done.", 'cancel: editorKey("tui.select.cancel")') + ";",
	),
];

const SIGN_IN_OLD_VARIANT: readonly SetupMenuPatch[] = [
	patch('readonly title = "Sign in to your providers";', `readonly title = ${menuText("Sign in to your providers")};`),
	patch(
		'"Pick a provider to sign in — you can connect more than one."',
		menuText("Pick a provider to sign in — you can connect more than one."),
		2,
	),
];

const SIGN_IN_CURRENT_VARIANT: readonly SetupMenuPatch[] = [
	patch('const SCENE_TITLE = "Sign in to your providers";', `const SCENE_TITLE = ${menuText("Sign in to your providers")};`),
	patch('const LIST_LEAD = "Pick a provider to sign in — you can connect more than one.";', `const LIST_LEAD = ${menuText("Pick a provider to sign in — you can connect more than one.")};`),
	patch('const SHEET_LEAD = "You can connect more than one.";', `const SHEET_LEAD = ${menuText("You can connect more than one.")};`),
];

const SPLASH_PATCHES: readonly SetupMenuPatch[] = [
	patch(
		'return `press ${formatKeyHint("enter")} to skip`;',
		'return ' + translatedText("press {enter} to skip", 'enter: formatKeyHint("enter")') + ";",
	),
];

const SPLASH_OLD_VARIANT: readonly SetupMenuPatch[] = [
	patch(
		'export function describeSetupSplash(): NativeNode {\n\tconst hint = skipHint();\n\treturn splashMemo.get([hint], () =>',
		'export function describeSetupSplash(): NativeNode {\n\tconst hint = ' + translatedText("press {enter} to skip", 'enter: formatKeyHint("enter")') + ';\n\treturn splashMemo.get([hint], () =>',
	),
];

const SPLASH_CURRENT_VARIANT: readonly SetupMenuPatch[] = [
	patch('span("Press", "muted")', `span(${menuText("Press")}, "muted")`),
	patch('span("to begin", "muted")', `span(${menuText("to begin")}, "muted")`),
];


const COMPOSER_PATCHES: readonly SetupMenuPatch[] = [
	patch('import type { ComposerShape } from "../../overlays/composer-shape-registry";', 'import { BUILTIN_COMPOSER_SHAPES, type ComposerShape } from "../../overlays/composer-shape-registry";'),
	patch('title = "Choose composer shape";', `title = ${menuText("Choose composer shape")};`),
	patch('subtitle = "Pick the prompt and status line layout for your workflow.";', `subtitle = ${menuText("Pick the prompt and status line layout for your workflow.")};`),
	patch(
		'this.#items = choices.map((choice, index) => ({\n\t\t\tvalue: choice.value,\n\t\t\tlabel: `${index + 1}  ${choice.label}`,\n\t\t\tdescription: choice.description,\n\t\t}));',
		'this.#items = choices.map((choice, index) => {\n\t\t\tconst fixedShape = BUILTIN_COMPOSER_SHAPES.find(shape => shape.value === choice.value);\n\t\t\treturn {\n\t\t\t\tvalue: choice.value,\n\t\t\t\tlabel: `${index + 1}  ${fixedShape && choice.label === fixedShape.label && fixedShape.value !== "claude" && fixedShape.value !== "pi" ? __zhompMenuText(fixedShape.label) : choice.label}`,\n\t\t\t\tdescription: fixedShape?.description && choice.description === fixedShape.description ? __zhompMenuText(fixedShape.description) : choice.description,\n\t\t\t};\n\t\t});',
	),
	patch(
		'`Select a layout; live preview updates below. Press ${editorKey("tui.select.confirm")} to confirm.`',
		translatedText("Select a layout; live preview updates below. Press {confirm} to confirm.", 'confirm: editorKey("tui.select.confirm")'),
	),
	patch(
		'`Select a layout; live preview updates below. Press ${confirm} to confirm.`',
		translatedText("Select a layout; live preview updates below. Press {confirm} to confirm.", "confirm"),
	),
	patch('"Preview:"', menuText("Preview:"), 2),
];

const GLYPH_PATCHES: readonly SetupMenuPatch[] = [
	patch('title = "Choose glyph mode";', `title = ${menuText("Choose glyph mode")};`),
	patch('subtitle = "Pick the row that renders cleanly in your terminal.";', `subtitle = ${menuText("Pick the row that renders cleanly in your terminal.")};`),
	patch(
		'"If a row shows boxes, tofu, or misaligned icons, pick another."',
		menuText("If a row shows boxes, tofu, or misaligned icons, pick another."),
		2,
	),
];


const THEME_PATCHES: readonly SetupMenuPatch[] = [
	patch('{ value: "auto", label: "Match terminal", description: "Titanium in dark terminals, Light in light terminals" },', `{ value: "auto", label: ${menuText("Match terminal")}, description: ${menuText("Titanium in dark terminals, Light in light terminals")} },`),
	patch('{ value: "theme:titanium", label: "Titanium", description: "Default dark theme" },', `{ value: "theme:titanium", label: "Titanium", description: ${menuText("Default dark theme")} },`),
	patch('{ value: "theme:light", label: "Light", description: "Default light theme" },', `{ value: "theme:light", label: "Light", description: ${menuText("Default light theme")} },`),
	patch('{ value: "colorblind", label: "Colorblind colors", description: "Adjust red/green contrast" },', `{ value: "colorblind", label: ${menuText("Colorblind colors")}, description: ${menuText("Adjust red/green contrast")} },`),
	patch('{ value: "ansi", label: "ANSI-safe", description: "ASCII glyphs with the dark terminal theme" },', `{ value: "ansi", label: ${menuText("ANSI-safe")}, description: ${menuText("ASCII glyphs with the dark terminal theme")} },`),
	patch('{ value: "browse", label: "Browse all…", description: "Show every built-in and custom theme" },', `{ value: "browse", label: ${menuText("Browse all…")}, description: ${menuText("Show every built-in and custom theme")} },`),
	patch('title = "Pick a theme";', `title = ${menuText("Pick a theme")};`),
	patch(
		'return `Move through the list to preview; ${editorKey("tui.select.confirm")} saves the highlighted choice.`;',
		'return ' + translatedText("Move through the list to preview; {confirm} saves the highlighted choice.", 'confirm: editorKey("tui.select.confirm")') + ";",
	),
	patch(
		'`Theme changes preview live. Nothing is saved until you press ${editorKey("tui.select.confirm")}.`',
		translatedText("Theme changes preview live. Nothing is saved until you press {confirm}.", 'confirm: editorKey("tui.select.confirm")'),
	),
	patch(
		'`Theme changes preview live. Nothing is saved until you press ${confirm}.`',
		translatedText("Theme changes preview live. Nothing is saved until you press {confirm}.", "confirm"),
	),
	patch(
		'`Browsing all themes · ${editorKey("tui.select.cancel")} returns to curated choices`',
		translatedText("Browsing all themes · {cancel} returns to curated choices", 'cancel: editorKey("tui.select.cancel")'),
	),
	patch(
		'`${editorKey("tui.select.cancel")} skips this step`',
		translatedText("{cancel} skips this step", 'cancel: editorKey("tui.select.cancel")'),
	),
	patch('`Browsing all themes · ${cancel} returns to curated choices`', translatedText("Browsing all themes · {cancel} returns to curated choices", "cancel")),
	patch('`${cancel} skips this step`', translatedText("{cancel} skips this step", "cancel")),
	patch('theme.bold("Preview")', `theme.bold(${menuText("Preview")})`),
	patch('span("Preview", "strong")', `span(${menuText("Preview")}, "strong")`),
	patch('theme.fg("muted", "Status line")', `theme.fg("muted", ${menuText("Status line")})`),
	patch('span("Status line", "muted")', `span(${menuText("Status line")}, "muted")`),
	patch('theme.fg("muted", "Editor")', `theme.fg("muted", ${menuText("Editor")})`),
	patch('span("Editor", "muted")', `span(${menuText("Editor")}, "muted")`),
];

export const SETUP_MENU_MODULES: readonly MenuModule[] = [
	{ root: "tui", path: "src/setup/wizard-overlay.ts", patches: WIZARD_PATCHES, variants: [WIZARD_OLD_VARIANT, WIZARD_CURRENT_VARIANT] },
	{ root: "tui", path: "src/setup/scenes/splash.ts", patches: SPLASH_PATCHES, variants: [SPLASH_OLD_VARIANT, SPLASH_CURRENT_VARIANT] },
	{ root: "tui", path: "src/setup/scenes/outro.ts", patches: OUTRO_PATCHES, variants: [OUTRO_OLD_VARIANT, OUTRO_CURRENT_VARIANT] },
	{ root: "tui", path: "src/setup/scenes/composer.ts", patches: COMPOSER_PATCHES },
	{ root: "tui", path: "src/setup/scenes/glyph.ts", patches: GLYPH_PATCHES },
	{ root: "tui", path: "src/setup/scenes/model.ts", patches: MODEL_PATCHES, variants: [MODEL_OLD_VARIANT, MODEL_CURRENT_VARIANT] },
	{ root: "tui", path: "src/setup/scenes/sign-in.ts", patches: SIGN_IN_PATCHES, variants: [SIGN_IN_OLD_VARIANT, SIGN_IN_CURRENT_VARIANT] },
	{ root: "tui", path: "src/setup/scenes/theme.ts", patches: THEME_PATCHES },
];
export const SETUP_MENU_TEXT_KEYS: readonly string[] = [
	"{navKeys} select · {confirm} confirm · {skip} skip · {exit} exit setup",
	"Setup",
	"Setup step {current} of {total}",
	"press {enter} to skip",
	"Press",
	"to begin",
	"Setup saved",
	"Choose composer shape",
	"Pick the prompt and status line layout for your workflow.",
	"Status Band (Default)",
	"Flush soft-capped status band above a curved prompt, no frame",
	"Rounded Box",
	"Status line embedded in top border, compact 2-line prompt",
	"Full-width horizontal rules above and below, status line at bottom",
	"Framed horizontal rules with status line at bottom",
	"Borderless",
	"Clean prompt glyph with status line at bottom, no box borders",
	"Top Rule Dock",
	"Single top rule with status docked onto it and below",
	"Compact Field",
	"Filled one-row field with accent end caps",
	"Accent Rail",
	"Filled one-row field anchored by a single accent rail",
	"Select a layout; live preview updates below. Press {confirm} to confirm.",
	"Preview:",
	"Choose glyph mode",
	"Pick the row that renders cleanly in your terminal.",
	"If a row shows boxes, tofu, or misaligned icons, pick another.",
	"Choose your default model",
	"Search configured models and save the model used for new sessions.",
	"Type to search. {enter} saves the highlighted model as your default.",
	"Sign in to your providers",
	"Sign in to one or more providers. Press {cancel} when you're done.",
	"Pick a provider to sign in — you can connect more than one.",
	"Pick a theme",
	"Move through the list to preview; {confirm} saves the highlighted choice.",
	"Match terminal",
	"Colorblind colors",
	"ANSI-safe",
	"Browse all…",
	"Titanium in dark terminals, Light in light terminals",
	"Default dark theme",
	"Default light theme",
	"Adjust red/green contrast",
	"ASCII glyphs with the dark terminal theme",
	"Show every built-in and custom theme",
	"Theme changes preview live. Nothing is saved until you press {confirm}.",
	"Browsing all themes · {cancel} returns to curated choices",
	"{cancel} skips this step",
	"Preview",
	"Status line",
	"Editor",
	"Exit setup",
	"Sign in",
	"Model",
	"Symbols",
	"Composer",
	"Theme",
	"You're all set",
	"Default model",
	"Used by new sessions. Change it with /model.",
	"You can connect more than one.",
];
