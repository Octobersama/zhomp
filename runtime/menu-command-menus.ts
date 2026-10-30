import type { MenuModule } from "./menu-catalog";

type CommandMenuPatch = MenuModule["patches"][number];

function menuText(source: string, values?: string): string {
	const key = JSON.stringify(source);
	return values === undefined ? `__zhompMenuText(${key})` : `__zhompMenuText(${key}, ${values})`;
}

function patch(before: string, after: string, count = 1): CommandMenuPatch {
	return { before, after, count };
}

const REVIEW_COMMAND_PATCHES: readonly CommandMenuPatch[] = [
	patch(
		'const searchEntry = `Search open ${plural}…`;',
		[
			'const searchEntry = `Search open ${plural}…`;',
			`const searchEntryDisplayLabel = ${menuText("Search open {plural}…", "{ plural: __zhompMenuText(plural) }")};`,
		].join("\n"),
	),
	patch(
		'searchPrompt: "Search open pull requests — title, author, or #123",',
		`searchPrompt: ${menuText("Search open pull requests — title, author, or #123")},`,
	),
	patch(
		'searchPrompt: "Search open merge requests — title, description, or !123",',
		`searchPrompt: ${menuText("Search open merge requests — title, description, or !123")},`,
	),
	patch(
		[
			"\t\tconst title =",
			"\t\t\tactiveQuery === undefined",
			'\t\t\t\t? `Open ${plural} in ${repo}`',
			'\t\t\t\t: `Open ${plural} in ${repo} matching "${activeQuery}"`;',
		].join("\n"),
		[
			"\t\tconst title =",
			"\t\t\tactiveQuery === undefined",
			`\t\t\t\t? ${menuText("Open {plural} in {repo}", "{ plural: __zhompMenuText(plural), repo }")}`,
			`\t\t\t\t: ${menuText('Open {plural} in {repo} matching "{query}"', "{ plural: __zhompMenuText(plural), repo, query: activeQuery }")};`,
		].join("\n"),
	),
	patch(
		'\t\tconst selected = await ctx.ui.select(title, [...rows.map(row => row.label), searchEntry]);',
		[
			"\t\tconst displaySearchEntry =",
			"\t\t\tsearchEntryDisplayLabel === searchEntry || rows.some(row => row.label === searchEntryDisplayLabel)",
			"\t\t\t\t? searchEntry",
			"\t\t\t\t: { label: searchEntry, displayLabel: searchEntryDisplayLabel };",
			"\t\tconst selected = await ctx.ui.select(title, [...rows.map(row => row.label), displaySearchEntry]);",
		].join("\n"),
	),
	patch(
		[
			"\tconst selected = await ctx.ui.select(",
			'\t\t"Review Mode",',
			"\t\tchoices.map(choice => choice.label),",
			"\t);",
			"\tconst choice = choices.find(candidate => candidate.label === selected);",
		].join("\n"),
		[
			"\tconst displayChoices = choices.map(choice => ({",
			"\t\tchoice,",
			'\t\tdisplayLabel: choice.kind === "pr" ? choice.label : __zhompMenuText(choice.label),',
			"\t}));",
			"\tconst hasCollision = new Set(displayChoices.map(choice => choice.displayLabel)).size !== displayChoices.length;",
			"\tconst displayOptions = hasCollision",
			"\t\t? choices.map(choice => choice.label)",
			"\t\t: displayChoices.map(({ choice, displayLabel }) =>",
			"\t\t\tdisplayLabel === choice.label ? choice.label : { label: choice.label, displayLabel },",
			"\t\t);",
			"\tconst selected = await ctx.ui.select(",
			`\t\t${menuText("Review Mode")},`,
			"\t\tdisplayOptions,",
			"\t);",
			"\tconst choice = choices.find(candidate => candidate.label === selected);",
		].join("\n"),
	),
	patch(
		'\t\t\t\t"Enter custom review instructions",',
		`\t\t\t\t${menuText("Enter custom review instructions")},`,
	),
];

const REVIEW_TARGET_PATCHES: readonly CommandMenuPatch[] = [
	patch(
		'const baseBranch = await ui.select("Select base branch to compare against", branches);',
		`const baseBranch = await ui.select(${menuText("Select base branch to compare against")}, branches);`,
	),
	patch(
		'const selectedCommit = await ui.select("Select commit to review", commits);',
		`const selectedCommit = await ui.select(${menuText("Select commit to review")}, commits);`,
	),
];

const ANNOTATION_SOURCE_PATCHES: readonly CommandMenuPatch[] = [
	patch(
		[
			"\tconst selected = await ui.select(",
			'\t\t"Select content to annotate",',
			"\t\tANNOTATION_SOURCE_CHOICES.map(choice => choice.label),",
			"\t);",
			"\treturn ANNOTATION_SOURCE_CHOICES.find(choice => choice.label === selected)?.kind;",
		].join("\n"),
		[
			"\tconst displayChoices = ANNOTATION_SOURCE_CHOICES.map(choice => ({",
			"\t\tchoice,",
			"\t\tdisplayLabel: __zhompMenuText(choice.label),",
			"\t}));",
			"\tconst hasCollision = new Set(displayChoices.map(choice => choice.displayLabel)).size !== displayChoices.length;",
			"\tconst displayOptions = hasCollision",
			"\t\t? ANNOTATION_SOURCE_CHOICES.map(choice => choice.label)",
			"\t\t: displayChoices.map(({ choice, displayLabel }) =>",
			"\t\t\tdisplayLabel === choice.label ? choice.label : { label: choice.label, displayLabel },",
			"\t\t);",
			"\tconst selected = await ui.select(",
			`\t\t${menuText("Select content to annotate")},`,
			"\t\tdisplayOptions,",
			"\t);",
			"\treturn ANNOTATION_SOURCE_CHOICES.find(choice => choice.label === selected)?.kind;",
		].join("\n"),
	),
	patch('title: "Select message to annotate",', `title: ${menuText("Select message to annotate")},`),
	patch('actionLabel: "select",', `actionLabel: ${menuText("select")},`),
];

const ANNOTATION_COMMAND_PATCHES: readonly CommandMenuPatch[] = [
	patch('ctx.ui.input("File path to annotate")', `ctx.ui.input(${menuText("File path to annotate")})`),
	patch('ctx.ui.editor("Text prompt to annotate")', `ctx.ui.editor(${menuText("Text prompt to annotate")})`),
];

export const COMMAND_MENU_MODULES: readonly MenuModule[] = [
	{
		root: "agent",
		path: "src/extensibility/custom-commands/bundled/review/index.ts",
		patches: REVIEW_COMMAND_PATCHES,
	},
	{
		root: "agent",
		path: "src/extensibility/custom-commands/bundled/review/target.ts",
		patches: REVIEW_TARGET_PATCHES,
	},
	{
		root: "agent",
		path: "src/extensibility/custom-commands/bundled/annotate/text-source.ts",
		patches: ANNOTATION_SOURCE_PATCHES,
	},
	{
		root: "agent",
		path: "src/extensibility/custom-commands/bundled/annotate/index.ts",
		patches: ANNOTATION_COMMAND_PATCHES,
		variants: [
			[patch('case "draft": {', 'case "draft": {', 0)],
			[
				patch('ctx.ui.notify("No saved annotation drafts in this session.", "info")', `ctx.ui.notify(${menuText("No saved annotation drafts in this session.")}, "info")`),
				patch(
					'ctx.ui.select("Resume an annotation draft", labels)',
					`ctx.ui.select(${menuText("Resume an annotation draft")}, drafts.map(({ source, state }, index) => ({ label: labels[index]!, displayLabel: \`\${index + 1}. \${source.kind === "diff" ? source.target.mode : source.source.label} — \${${menuText("{count} note(s)", "{ count: state.annotations.length }")}}\${state.editor?.text ? ${menuText(" + unfinished note")} : ""}\` })))`,
				),
			],
		],
	},
];

export const COMMAND_MENU_TEXT_KEYS: readonly string[] = [
	"Review Mode",
	"1. Review against a base branch (PR Style)",
	"2. Review uncommitted changes",
	"3. Review a specific commit",
	"4. Review a specific PR/MR",
	"5. Custom review instructions",
	"Enter custom review instructions",
	"Search open {plural}…",
	"pull requests",
	"merge requests",
	"Search open pull requests — title, author, or #123",
	"Search open merge requests — title, description, or !123",
	"Open {plural} in {repo}",
	'Open {plural} in {repo} matching "{query}"',
	"Select base branch to compare against",
	"Select commit to review",
	"Select content to annotate",
	"Code review",
	"Latest assistant reply",
	"Session message or block",
	"File",
	"Text prompt",
	"Select message to annotate",
	"select",
	"File path to annotate",
	"Text prompt to annotate",
	"Saved draft",
	"Resume an annotation draft",
	"No saved annotation drafts in this session.",
	"{count} note(s)",
	" + unfinished note",
];