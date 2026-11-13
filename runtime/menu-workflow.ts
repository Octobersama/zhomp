import type { MenuModule } from "./menu-catalog";

type WorkflowMenuPatch = MenuModule["patches"][number];


function patch(before: string, after: string, count = 1): WorkflowMenuPatch {
	return { before, after, count };
}

const SEANCE_PATCHES: readonly WorkflowMenuPatch[] = [
	patch(
		'\t\tconst choice =\n\t\t\tsource.modelSelectors.length === 0\n\t\t\t\t? "Choose another model"\n\t\t\t\t: await ctx.showHookSelector("Consult this session with", [\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\tlabel: "Use saved model",\n\t\t\t\t\t\t\tdescription: "Use the active role or default model saved with this session",\n\t\t\t\t\t\t},\n\t\t\t\t\t\t{ label: "Choose another model", description: "Select a one-off model for this consultation" },\n\t\t\t\t\t]);',
		'\t\tconst canonicalChoices = ["Use saved model", "Choose another model"];\n\t\tconst translatedChoiceLabels = canonicalChoices.map(choice => __zhompMenuText(choice));\n\t\tconst displayChoiceLabels =\n\t\t\tnew Set(translatedChoiceLabels).size === translatedChoiceLabels.length ? translatedChoiceLabels : canonicalChoices;\n\t\tconst choiceOptions = [\n\t\t\t{\n\t\t\t\tlabel: canonicalChoices[0]!,\n\t\t\t\tdisplayLabel: displayChoiceLabels[0]!,\n\t\t\t\tdescription: __zhompMenuText("Use the active role or default model saved with this session"),\n\t\t\t},\n\t\t\t{\n\t\t\t\tlabel: canonicalChoices[1]!,\n\t\t\t\tdisplayLabel: displayChoiceLabels[1]!,\n\t\t\t\tdescription: __zhompMenuText("Select a one-off model for this consultation"),\n\t\t\t},\n\t\t];\n\t\tconst choice =\n\t\t\tsource.modelSelectors.length === 0\n\t\t\t\t? "Choose another model"\n\t\t\t\t: await ctx.showHookSelector(__zhompMenuText("Consult this session with"), choiceOptions);',
		1,
	),
];

const CLEANSE_PATCHES: readonly WorkflowMenuPatch[] = [
	patch(
		'\t\tconst allOption = `Run all ${checkers.length} discovered checker${checkers.length === 1 ? "" : "s"}`;\n\t\tconst labels = checkers.map(checker => `${checker.label} — ${checker.command}`);\n\t\tconst choice = await this.ctx.showHookSelector("Select what to cleanse", [\n\t\t\tallOption,\n\t\t\t...labels,\n\t\t\tCUSTOM_REQUEST_OPTION,\n\t\t]);\n\t\tif (choice === undefined) return { kind: "cancel" };\n\t\tif (choice === allOption) return { kind: "all" };\n\t\tif (choice === CUSTOM_REQUEST_OPTION) {',
		'\t\tconst allOption = `Run all ${checkers.length} discovered checker${checkers.length === 1 ? "" : "s"}`;\n\t\tconst labels = checkers.map(checker => `${checker.label} — ${checker.command}`);\n\t\tconst allOptionText = __zhompMenuText(\n\t\t\tcheckers.length === 1 ? "Run all {count} discovered checker" : "Run all {count} discovered checkers",\n\t\t\t{ count: checkers.length },\n\t\t);\n\t\tconst customRequestText = __zhompMenuText(CUSTOM_REQUEST_OPTION);\n\t\tconst displayCollision =\n\t\t\tallOptionText === customRequestText || labels.includes(allOptionText) || labels.includes(customRequestText);\n\t\tconst allOptionChoice = {\n\t\t\tlabel: allOption,\n\t\t\tdisplayLabel: displayCollision ? allOption : allOptionText,\n\t\t};\n\t\tconst customRequestChoice = {\n\t\t\tlabel: CUSTOM_REQUEST_OPTION,\n\t\t\tdisplayLabel: displayCollision ? CUSTOM_REQUEST_OPTION : customRequestText,\n\t\t};\n\t\tconst choice = await this.ctx.showHookSelector(__zhompMenuText("Select what to cleanse"), [\n\t\t\tallOptionChoice,\n\t\t\t...labels,\n\t\t\tcustomRequestChoice,\n\t\t]);\n\t\tif (choice === undefined) return { kind: "cancel" };\n\t\tif (choice === allOption) return { kind: "all" };\n\t\tif (choice === CUSTOM_REQUEST_OPTION) {',
		1,
	),
	patch(
		'const answer = await this.ctx.showHookInput("Describe what to detect and fix", \'e.g. "ts errors"\');',
		'const answer = await this.ctx.showHookInput(__zhompMenuText("Describe what to detect and fix"), __zhompMenuText(\'e.g. "ts errors"\'));',
		1,
	),
];

const INPUT_PATCHES: readonly WorkflowMenuPatch[] = [
	patch(
		'\t\tconst WRAPPED_BLOCK = "Attach as a wrapped block";\n\t\tconst LOCAL_FILE = "Attach as local file";\n\t\tconst INLINE = "Paste inline";',
		'\t\tconst WRAPPED_BLOCK = "Attach as a wrapped block";\n\t\tconst LOCAL_FILE = "Attach as local file";\n\t\tconst INLINE = "Paste inline";\n\t\tconst canonicalChoices = [WRAPPED_BLOCK, LOCAL_FILE, INLINE];\n\t\tconst translatedChoiceLabels = canonicalChoices.map(choice => __zhompMenuText(choice));\n\t\tconst displayChoiceLabels =\n\t\t\tnew Set(translatedChoiceLabels).size === translatedChoiceLabels.length ? translatedChoiceLabels : canonicalChoices;',
		1,
	),
	patch(
		'\t\t\tchoice = await this.ctx.showHookSelector(\n\t\t\t\t`Pasted ${lineCount} lines`,\n\t\t\t\t[\n\t\t\t\t\t{ label: WRAPPED_BLOCK, description: "Wrap the text in <attachment> tags, collapsed to a marker" },\n\t\t\t\t\t{ label: LOCAL_FILE, description: "Save the text to a local://paste file" },\n\t\t\t\t\t{ label: INLINE, description: "Collapse the text to an inline paste marker" },\n\t\t\t\t],\n\t\t\t\t{ helpText: `${editorKey("tui.select.cancel")} to paste inline` },\n\t\t\t);',
		'\t\t\tconst pasteChoices = [\n\t\t\t\t{\n\t\t\t\t\tlabel: WRAPPED_BLOCK,\n\t\t\t\t\tdisplayLabel: displayChoiceLabels[0]!,\n\t\t\t\t\tdescription: __zhompMenuText("Wrap the text in <attachment> tags, collapsed to a marker"),\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tlabel: LOCAL_FILE,\n\t\t\t\t\tdisplayLabel: displayChoiceLabels[1]!,\n\t\t\t\t\tdescription: __zhompMenuText("Save the text to a local://paste file"),\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tlabel: INLINE,\n\t\t\t\t\tdisplayLabel: displayChoiceLabels[2]!,\n\t\t\t\t\tdescription: __zhompMenuText("Collapse the text to an inline paste marker"),\n\t\t\t\t},\n\t\t\t];\n\t\t\tchoice = await this.ctx.showHookSelector(\n\t\t\t\t__zhompMenuText("Pasted {count} lines", { count: lineCount }),\n\t\t\t\tpasteChoices,\n\t\t\t\t{ helpText: `${editorKey("tui.select.cancel")} ${__zhompMenuText("to paste inline")}` },\n\t\t\t);',
		1,
	),
];

const SELECTOR_PATCHES: readonly WorkflowMenuPatch[] = [
	patch(
		'\t\t\t\t\t\tconst summaryChoice = await this.ctx.showHookSelector("Summarize branch?", [\n\t\t\t\t\t\t\t"No summary",\n\t\t\t\t\t\t\t"Summarize",\n\t\t\t\t\t\t\t"Summarize with custom prompt",\n\t\t\t\t\t\t]);',
		'\t\t\t\t\t\tconst canonicalSummaryChoices = ["No summary", "Summarize", "Summarize with custom prompt"];\n\t\t\t\t\t\tconst translatedSummaryLabels = canonicalSummaryChoices.map(choice => __zhompMenuText(choice));\n\t\t\t\t\t\tconst displaySummaryLabels =\n\t\t\t\t\t\t\tnew Set(translatedSummaryLabels).size === translatedSummaryLabels.length\n\t\t\t\t\t\t\t\t? translatedSummaryLabels\n\t\t\t\t\t\t\t\t: canonicalSummaryChoices;\n\t\t\t\t\t\tconst summaryOptions = canonicalSummaryChoices.map((label, index) => ({\n\t\t\t\t\t\t\tlabel,\n\t\t\t\t\t\t\tdisplayLabel: displaySummaryLabels[index]!,\n\t\t\t\t\t\t}));\n\t\t\t\t\t\tconst summaryChoice = await this.ctx.showHookSelector(\n\t\t\t\t\t\t\t__zhompMenuText("Summarize branch?"),\n\t\t\t\t\t\t\tsummaryOptions,\n\t\t\t\t\t\t);',
		1,
	),
	patch(
		'customInstructions = await this.ctx.showHookEditor("Custom summarization instructions");',
		'customInstructions = await this.ctx.showHookEditor(__zhompMenuText("Custom summarization instructions"));',
		1,
	),
	patch(
		'\t\tconst confirmed = await this.ctx.showHookConfirm(\n\t\t\t"Delete Session",\n\t\t\t"This will permanently delete the current session.\\nYou will be returned to the session selector.",\n\t\t);',
		'\t\tconst confirmed = await this.ctx.showHookConfirm(\n\t\t\t__zhompMenuText("Delete Session"),\n\t\t\t`${__zhompMenuText("This will permanently delete the current session.")}\\n${__zhompMenuText("You will be returned to the session selector.")}`,\n\t\t);',
		1,
	),
];

const CONFIRMATION_VARIANTS: readonly (readonly WorkflowMenuPatch[])[] = [
	[
		patch(
			'const result = await this.showHookSelector(`${title}\\n${message}`, ["Yes", "No"], dialogOptions);',
			'const canonicalChoices = ["Yes", "No"];\n\t\tconst translatedChoiceLabels = canonicalChoices.map(choice => __zhompMenuText(choice));\n\t\tconst displayChoiceLabels =\n\t\t\tnew Set(translatedChoiceLabels).size === translatedChoiceLabels.length ? translatedChoiceLabels : canonicalChoices;\n\t\tconst choiceOptions = canonicalChoices.map((label, index) => ({\n\t\t\tlabel,\n\t\t\tdisplayLabel: displayChoiceLabels[index]!,\n\t\t}));\n\t\tconst result = await this.showHookSelector(`${title}\\n${message}`, choiceOptions, dialogOptions);',
			1,
		),
	],
	[
		patch(
			'const result = await this.showHookSelector(`${title}\\n${message}`, ["Yes", "No"], dialogOptions, {\n\t\t\tkind: "permission",\n\t\t});',
			'const canonicalChoices = ["Yes", "No"];\n\t\tconst translatedChoiceLabels = canonicalChoices.map(choice => __zhompMenuText(choice));\n\t\tconst displayChoiceLabels =\n\t\t\tnew Set(translatedChoiceLabels).size === translatedChoiceLabels.length ? translatedChoiceLabels : canonicalChoices;\n\t\tconst choiceOptions = canonicalChoices.map((label, index) => ({\n\t\t\tlabel,\n\t\t\tdisplayLabel: displayChoiceLabels[index]!,\n\t\t}));\n\t\tconst result = await this.showHookSelector(`${title}\\n${message}`, choiceOptions, dialogOptions, {\n\t\t\tkind: "permission",\n\t\t});',
			1,
		),
	],
];

export const WORKFLOW_MENU_MODULES: readonly MenuModule[] = [
	{ root: "agent", path: "src/slash-commands/seance.ts", patches: SEANCE_PATCHES },
	{ root: "agent", path: "src/modes/controllers/cleanse-command-controller.ts", patches: CLEANSE_PATCHES },
	{ root: "agent", path: "src/modes/controllers/input-controller.ts", patches: INPUT_PATCHES },
	{ root: "agent", path: "src/modes/controllers/extension-ui-controller.ts", patches: [], variants: CONFIRMATION_VARIANTS },
	{ root: "agent", path: "src/modes/controllers/selector-controller.ts", patches: SELECTOR_PATCHES },
];

export const WORKFLOW_MENU_TEXT_KEYS: readonly string[] = [
	"Consult this session with",
	"Use saved model",
	"Use the active role or default model saved with this session",
	"Choose another model",
	"Select a one-off model for this consultation",
	"Select what to cleanse",
	"Run all {count} discovered checker",
	"Run all {count} discovered checkers",
	"Describe what to fix…",
	"Describe what to detect and fix",
	'e.g. "ts errors"',
	"Pasted {count} lines",
	"Attach as a wrapped block",
	"Attach as local file",
	"Paste inline",
	"Wrap the text in <attachment> tags, collapsed to a marker",
	"Save the text to a local://paste file",
	"Collapse the text to an inline paste marker",
	"to paste inline",
	"Summarize branch?",
	"No summary",
	"Summarize",
	"Summarize with custom prompt",
	"Custom summarization instructions",
	"Delete Session",
	"This will permanently delete the current session.",
	"You will be returned to the session selector.",
	"Yes",
	"No",
];
