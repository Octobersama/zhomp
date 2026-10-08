import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Dictionary } from "../extensions/zhomp";

const MODEL_HUB_TEXT_KEYS = [
	"Models",
	"Roles",
	"Roles:",
	"All",
	"Chat",
	"Kinds",
	"kinds",
	"All models",
	"Recent",
	"Model",
	"All available models",
	"Recently used models",
	"Model roles — {key} adds a retry fallback, cleared roles fall back to auto-selection",
	"Model roles — ",
	" adds a retry fallback, cleared roles fall back to auto-selection",
	"No recently used models yet",
	"No matching models in {provider}. Switch to All models to search every provider.",
	"No matching models",
	"No models from {provider} yet",
	"No models available in this scope",
	"New role",
	"New role…",
	"New role name:",
	"New role name ",
	"New fallback…",
	"New fallback chain",
	"New fallback chain…",
	"fallback chain",
	"fallback",
	"Applying model…",
	"Assigning",
	"Adding fallback for",
	"Replacing fallback of",
	"assigns",
	"cancels",
	"picks the model it protects",
	"picks the fallback model",
	"Cleared roles fall back to auto-selection",
	"Not assigned; no available model fits this role.",
	"Name a custom role, then pick the model it runs on.",
	"Pick the model (or provider) a new retry fallback chain protects.",
	"New fallback chain — pick the model it protects",
	"type to search",
	"reorder",
	"save preset",
	"cancel",
	"create + pick model",
	"choose",
	"assign/clear",
	"save scope",
	"thinking level",
	"apply",
	"keep",
	"models",
	"providers",
	"roles",
	"tabs",
	"assign roles",
	"pick fallback",
	"pick the protected model",
	"assign",
	"rows",
	"replace",
	"add another",
	"remove",
	"thinking",
	"add fallback",
	"clear chain",
	"new model/provider fallback chain",
	"pick",
	"clear",
	"cycle",
	"cycle:",
	"{cycle} cycle is empty — press {add} on a role to add it",
	"new",
	"log in",
	"refresh",
	"close",
	"Preset name:",
	"Preset name ",
	"Assign ",
	" to",
	"Thinking for ",
	"Save ",
	"(letters, digits, - and _)",
	"Model fallback chains",
	"Role",
	"Save preset",
	"Preset:",
	"Preset ",
	"custom",
	"preset",
	"Next preset",
	"Create role",
	"Apply",
	"Save to scope",
	"Assign / clear",
	"Keep",
	"Cancel",
	"Refresh provider",
	"Pick fallback",
	"Pick model",
	"Pick protected model",
	"Assign",
	"No model selected",
	"Clear search",
	"Earlier",
	"Later",
	"Leave cycle",
	"Add to cycle",
	"Add fallback",
	"Clear",
	"Thinking",
	"Replace",
	"Add another",
	"Remove",
	"Clear chain",
	"Log in",
	"Assign role",
] as const;

const LEGACY_MARKERS = [
	"#footerHint(): string {",
	"#emptyStateMessage(): string | undefined {",
	"readonly #frame: HubFrame = new HubFrame(\n\t\t\"Models\",",
	"#statusRow(width: number): string {",
	"const RECENT_LIMIT = 15;",
];

const DESCRIBED_MARKERS = [
	"#footerHint(): string {",
	"#footerHints(): (NativeHint | undefined)[] {",
	"nativeSheet(cx: DescribeContext): boolean {",
	"describeHubFrame(\n\t\t\t\"omp.overlay.model-hub\",\n\t\t\t\"Models\",",
	"#describePicker(): NativeNode {",
	"#emptyStateMessage(): string | undefined {",
	"const RECENT_LIMIT = 15;",
];

const DESCRIBED_PRESET_MARKERS = [
	`const presets =\n\t\t\t\t\tthis.#presets().names.length > 0 ? \` · \${formatKeyHints(["ctrl+left", "ctrl+right"])} preset\` : "";`,
	`const switchPreset = this.#presets().names.length > 0 ? \` · \${formatKeyHints(["p", "shift+p"])} preset\` : "";`,
];

type ModelHubShape = "legacy" | "described" | "described-presets";

interface ExactPatch {
	before: string;
	after: string;
	count: number;
}

function countOccurrences(source: string, search: string): number {
	let count = 0;
	let offset = 0;
	while ((offset = source.indexOf(search, offset)) !== -1) {
		count++;
		offset += search.length;
	}
	return count;
}

function applyPatches(source: string, patches: readonly ExactPatch[]): string | undefined {
	const replacements: Array<{ start: number; end: number; value: string }> = [];
	for (const patch of patches) {
		let count = 0;
		let index = 0;
		while ((index = source.indexOf(patch.before, index)) !== -1) {
			replacements.push({ start: index, end: index + patch.before.length, value: patch.after });
			count++;
			index += patch.before.length;
		}
		if (count !== patch.count) return undefined;
	}
	replacements.sort((left, right) => left.start - right.start);
	const output: string[] = [];
	let offset = 0;
	for (const replacement of replacements) {
		if (replacement.start < offset) return undefined;
		output.push(source.slice(offset, replacement.start), replacement.value);
		offset = replacement.end;
	}
	output.push(source.slice(offset));
	return output.join("");
}

function isSupportedShape(source: string): ModelHubShape | undefined {
	if (source.includes("__zhompModelHub")) return undefined;
	const described = countOccurrences(source, "#footerHints(): (NativeHint | undefined)[] {") === 1;
	if (described) {
		if (!DESCRIBED_MARKERS.every(marker => countOccurrences(source, marker) === 1)) return undefined;
		const presetMarkerCounts = DESCRIBED_PRESET_MARKERS.map(marker => countOccurrences(source, marker));
		if (presetMarkerCounts.every(count => count === 0)) return "described";
		return presetMarkerCounts.every(count => count === 1) ? "described-presets" : undefined;
	}
	if (source.includes("#footerHints()") || source.includes("describeHubFrame(") || source.includes("DescribeContext")) {
		return undefined;
	}
	return LEGACY_MARKERS.every(marker => countOccurrences(source, marker) === 1) ? "legacy" : undefined;
}

function getTextTranslations(dictionary: Dictionary): Record<string, string> {
	const translations: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const key of MODEL_HUB_TEXT_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(dictionary, key)) continue;
		const value: unknown = dictionary[key];
		if (typeof value === "string" && value.length > 0 && value !== key) translations[key] = value;
	}
	return translations;
}

function modelHubHelpers(translations: Record<string, string>): string {
	return `const __zhompModelHubTranslations: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(translations)});\n` +
		`function __zhompModelHubText(source: string, values?: Readonly<Record<string, string>>): string {\n` +
		`\tlet text = Object.prototype.hasOwnProperty.call(__zhompModelHubTranslations, source)\n` +
		`\t\t? __zhompModelHubTranslations[source] ?? source\n` +
		`\t\t: source;\n` +
		`\tif (values) {\n` +
		`\t\tfor (const [key, value] of Object.entries(values)) {\n` +
		`\t\t\ttext = text.replaceAll(\`{\${key}}\`, () => value);\n` +
		`\t\t}\n` +
		`\t}\n` +
		`\treturn text;\n` +
		`}`;
}

function commonPatches(shape: ModelHubShape): ExactPatch[] {
	const described = shape !== "legacy";
	return [
		{
			before: `readonly #frame: HubFrame = new HubFrame(\n\t\t\"Models\",`,
			after: `readonly #frame: HubFrame = new HubFrame(\n\t\t__zhompModelHubText(\"Models\"),`,
			count: 1,
		},
		{
			before: `label: \"Roles\",`,
			after: `label: __zhompModelHubText(\"Roles\"),`,
			count: described ? 2 : 1,
		},
		{
			before: `label: \"All models\",`,
			after: `label: __zhompModelHubText(\"All models\"),`,
			count: described ? 2 : 1,
		},
		{
			before: `theme.fg("dim", "Roles:")`,
			after: `theme.fg("dim", __zhompModelHubText("Roles:"))`,
			count: 1,
		},
		{
			before: `if (entry.kind === \"recent\") return \"  No recently used models yet\";`,
			after: `if (entry.kind === \"recent\") return \`  \${__zhompModelHubText(\"No recently used models yet\")}\`;`,
			count: 1,
		},
		{
			before: `return \`  No matching models in \${entry.label}. Switch to All models to search every provider.\`;`,
			after: `return \`  \${__zhompModelHubText(\"No matching models in {provider}. Switch to All models to search every provider.\", { provider: entry.label })}\`;`,
			count: 1,
		},
		{
			before: `text = \`Recently used models\${scopedSuffix}\`;`,
			after: `text = \`\${__zhompModelHubText(\"Recently used models\")}\${scopedSuffix}\`;`,
			count: 1,
		},
		{
			before: `text = \`All available models\${scopedSuffix}\`;`,
			after: `text = \`\${__zhompModelHubText(\"All available models\")}\${scopedSuffix}\`;`,
			count: 1,
		},
		{
			before: `text = \"Model roles — f adds a retry fallback, cleared roles fall back to auto-selection\";`,
			after: `text = __zhompModelHubText(\"Model roles — {key} adds a retry fallback, cleared roles fall back to auto-selection\", { key: \"f\" });`,
			count: described ? 0 : 1,
		},
		{
			before: `text = \`Model roles — \${formatKeyHint(\"f\")} adds a retry fallback, cleared roles fall back to auto-selection\`;`,
			after: `text = __zhompModelHubText(\"Model roles — {key} adds a retry fallback, cleared roles fall back to auto-selection\", { key: formatKeyHint(\"f\") });`,
			count: described ? 1 : 0,
		},
		{
			before: `const label = rowDef.kind === \"newRole\" ? \"+ New role…\" : \"+ New fallback…\";`,
			after: `const label = rowDef.kind === \"newRole\" ? \`+ \${__zhompModelHubText(\"New role…\")}\` : \`+ \${__zhompModelHubText(\"New fallback…\")}\`;`,
			count: 1,
		},
		{
			before: `this.#browser = new ModelBrowser(settings, {\n\t\t\temptyText: () => this.#emptyStateMessage(),\n\t\t});`,
			after: `this.#browser = new ModelBrowser(settings, {\n\t\t\temptyText: () => this.#emptyStateMessage() ??\n\t\t\t(this.#browser.query.trim() ? __zhompModelHubText("No matching models") : __zhompModelHubText("No models available in this scope")),\n\t\t});`,
			count: 1,
		},
	];
}

const LEGACY_STATUS_PATCHES: readonly ExactPatch[] = [
	{
		before: `theme.fg("accent", " New fallback chain — Enter picks the model it protects, Esc cancels")`,
		after: `theme.fg("accent", \` \${__zhompModelHubText("New fallback chain")} — Enter \${__zhompModelHubText("picks the model it protects")}, Esc \${__zhompModelHubText("cancels")}\`)`,
		count: 1,
	},
	{
		before: `\` \${verb} \${theme.bold(label)} — Enter picks the fallback model, Esc cancels\``,
		after: `\` \${__zhompModelHubText(verb)} \${theme.bold(label)} — Enter \${__zhompModelHubText("picks the fallback model")}, Esc \${__zhompModelHubText("cancels")}\``,
		count: 1,
	},
	{
		before: `theme.fg("accent", \` Assigning \${theme.bold(label)} — Enter assigns, Esc cancels\`)`,
		after: `theme.fg("accent", \` \${__zhompModelHubText("Assigning")} \${theme.bold(label)} — Enter \${__zhompModelHubText("assigns")}, Esc \${__zhompModelHubText("cancels")}\`)`,
		count: 1,
	},
	{
		before: `theme.fg("dim", \`\${cycleKey} cycle:\`)`,
		after: `theme.fg("dim", \`\${cycleKey} \${__zhompModelHubText("cycle:")}\`)`,
		count: 1,
	},
	{
		before: `theme.fg("dim", \`  \${cycleKey} cycle is empty — press c on a role to add it\`)`,
		after: `theme.fg("dim", \`  \${__zhompModelHubText("{cycle} cycle is empty — press {add} on a role to add it", { cycle: cycleKey, add: "c" })}\`)`,
		count: 1,
	},
];

const DESCRIBED_STATUS_PATCHES: readonly ExactPatch[] = [
	{
		before: `theme.fg("accent", \` New fallback chain — \${enter} picks the model it protects, \${cancel} cancels\`)`,
		after: `theme.fg("accent", \` \${__zhompModelHubText("New fallback chain")} — \${enter} \${__zhompModelHubText("picks the model it protects")}, \${cancel} \${__zhompModelHubText("cancels")}\`)`,
		count: 1,
	},
	{
		before: `\` \${verb} \${theme.bold(label)} — \${enter} picks the fallback model, \${cancel} cancels\``,
		after: `\` \${__zhompModelHubText(verb)} \${theme.bold(label)} — \${enter} \${__zhompModelHubText("picks the fallback model")}, \${cancel} \${__zhompModelHubText("cancels")}\``,
		count: 1,
	},
	{
		before: `theme.fg("accent", \` Assigning \${theme.bold(label)} — \${enter} assigns, \${cancel} cancels\`)`,
		after: `theme.fg("accent", \` \${__zhompModelHubText("Assigning")} \${theme.bold(label)} — \${enter} \${__zhompModelHubText("assigns")}, \${cancel} \${__zhompModelHubText("cancels")}\`)`,
		count: 1,
	},
	{
		before: `theme.fg("dim", \`\${cycleKey} cycle:\`)`,
		after: `theme.fg("dim", \`\${cycleKey} \${__zhompModelHubText("cycle:")}\`)`,
		count: 1,
	},
	{
		before: `theme.fg("dim", \`  \${cycleKey} cycle is empty — press \${formatKeyHint("c")} on a role to add it\`)`,
		after: `theme.fg("dim", \`  \${__zhompModelHubText("{cycle} cycle is empty — press {add} on a role to add it", { cycle: cycleKey, add: formatKeyHint("c") })}\`)`,
		count: 1,
	},
];

const LEGACY_FOOTER_PATCHES: readonly ExactPatch[] = [
	{
		before: `return \"Enter create + pick model · Esc cancel\";`,
		after: `return \`Enter \${__zhompModelHubText(\"create + pick model\")} · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"←/→ choose · Enter assign/clear · Esc cancel\";`,
		after: `return \`←/→ \${__zhompModelHubText(\"choose\")} · Enter \${__zhompModelHubText(\"assign/clear\")} · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"←/→ save scope · Enter choose · Esc cancel\";`,
		after: `return \`←/→ \${__zhompModelHubText(\"save scope\")} · Enter \${__zhompModelHubText(\"choose\")} · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"←/→ thinking level · Enter apply · Esc keep\";`,
		after: `return \`←/→ \${__zhompModelHubText(\"thinking level\")} · Enter \${__zhompModelHubText(\"apply\")} · Esc \${__zhompModelHubText(\"keep\")}\`;`,
		count: 1,
	},
	{
		before: `return \"Enter/→ models · ↑/↓ providers · type to search · Alt+←/→ kind · Esc cancel\";`,
		after: `return \`Enter/→ \${__zhompModelHubText(\"models\")} · ↑/↓ \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"Enter pick fallback · ↑/↓ models · ← providers · type to search · Alt+←/→ kind · Esc cancel\";`,
		after: `return \`Enter \${__zhompModelHubText(\"pick fallback\")} · ↑/↓ \${__zhompModelHubText(\"models\")} · ← \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"Enter pick the protected model · ↑/↓ models · ← providers · type to search · Alt+←/→ kind · Esc cancel\";`,
		after: `return \`Enter \${__zhompModelHubText(\"pick the protected model\")} · ↑/↓ \${__zhompModelHubText(\"models\")} · ← \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"Enter assign · ↑/↓ models · ← providers · type to search · Alt+←/→ kind · Esc cancel\";`,
		after: `return \`Enter \${__zhompModelHubText(\"assign\")} · ↑/↓ \${__zhompModelHubText(\"models\")} · ← \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind · Esc \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \"↑/↓ providers · Enter/→ roles · Alt+←/→ tabs · Esc close\";`,
		after: `return \`↑/↓ \${__zhompModelHubText(\"providers\")} · Enter/→ \${__zhompModelHubText(\"roles\")} · Alt+←/→ \${__zhompModelHubText(\"tabs\")} · Esc \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `const thinking = editable ? \" · t thinking\" : \"\";`,
		after: `const thinking = editable ? \` · t \${__zhompModelHubText(\"thinking\")}\` : \"\";`,
		count: 1,
	},
	{
		before: `return \`↑/↓ rows · Enter replace · f add another · x remove\${thinking} · [/] reorder · ← providers\`;`,
		after: `return \`↑/↓ \${__zhompModelHubText(\"rows\")} · Enter \${__zhompModelHubText(\"replace\")} · f \${__zhompModelHubText(\"add another\")} · x \${__zhompModelHubText(\"remove\")}\${thinking} · [/] \${__zhompModelHubText(\"reorder\")} · ← \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `return \"↑/↓ rows · Enter/f add fallback · x clear chain · ← providers\";`,
		after: `return \`↑/↓ \${__zhompModelHubText(\"rows\")} · Enter/f \${__zhompModelHubText(\"add fallback\")} · x \${__zhompModelHubText(\"clear chain\")} · ← \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `return \"↑/↓ rows · Enter new model/provider fallback chain · ← providers\";`,
		after: `return \`↑/↓ \${__zhompModelHubText(\"rows\")} · Enter \${__zhompModelHubText(\"new model/provider fallback chain\")} · ← \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `return \"↑/↓ rows · Enter pick · f fallback · x clear · t thinking · c cycle · [/] reorder · n new\";`,
		after: `return \`↑/↓ \${__zhompModelHubText(\"rows\")} · Enter \${__zhompModelHubText(\"pick\")} · f \${__zhompModelHubText(\"fallback\")} · x \${__zhompModelHubText(\"clear\")} · t \${__zhompModelHubText(\"thinking\")} · c \${__zhompModelHubText(\"cycle\")} · [/] \${__zhompModelHubText(\"reorder\")} · n \${__zhompModelHubText(\"new\")}\`;`,
		count: 1,
	},
	{
		before: `return entry.oauth ? \"Enter log in · ↑/↓ providers · Esc close\" : \"↑/↓ providers · Esc close\";`,
		after: `return entry.oauth ? \`Enter \${__zhompModelHubText(\"log in\")} · ↑/↓ \${__zhompModelHubText(\"providers\")} · Esc \${__zhompModelHubText(\"close\")}\` : \`↑/↓ \${__zhompModelHubText(\"providers\")} · Esc \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `const refresh = entry.kind === \"provider\" ? \" · F5 refresh\" : \"\";`,
		after: `const refresh = entry.kind === \"provider\" ? \` · F5 \${__zhompModelHubText(\"refresh\")}\` : \"\";`,
		count: 1,
	},
	{
		before: `return \`Enter/→ models · ↑/↓ providers · type to search · Alt+←/→ kind\${refresh} · Esc close\`;`,
		after: `return \`Enter/→ \${__zhompModelHubText(\"models\")} · ↑/↓ \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind\${refresh} · Esc \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `return \`Enter assign roles · ↑/↓ models · ← providers · type to search · Alt+←/→ kind\${refresh} · Esc close\`;`,
		after: `return \`Enter \${__zhompModelHubText(\"assign\")} \${__zhompModelHubText(\"roles\")} · ↑/↓ \${__zhompModelHubText(\"models\")} · ← \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · Alt+←/→ kind\${refresh} · Esc \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `const label = theme.fg("accent", "New role name:");\n\t\t\tconst inputWidth = Math.max(8, Math.min(32, width - visibleWidth("New role name:") - 24));`,
		after: `const labelText = __zhompModelHubText("New role name:");\n\t\t\tconst label = theme.fg("accent", labelText);\n\t\t\tconst inputWidth = Math.max(8, Math.min(32, width - visibleWidth(labelText) - 24));`,
		count: 1,
	},
	{
		before: `theme.fg("dim", "(letters, digits, - and _)")`,
		after: `theme.fg("dim", __zhompModelHubText("(letters, digits, - and _)"))`,
		count: 1,
	},
];

const DESCRIBED_FOOTER_PATCHES: readonly ExactPatch[] = [
	{
		before: `return \`\${enter} save preset · \${cancel} cancel\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"save preset\")} · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enter} create + pick model · \${cancel} cancel\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"create + pick model\")} · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${leftRight} choose · \${enter} assign/clear · \${cancel} cancel\`;`,
		after: `return \`\${leftRight} \${__zhompModelHubText(\"choose\")} · \${enter} \${__zhompModelHubText(\"assign/clear\")} · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${leftRight} save scope · \${enter} choose · \${cancel} cancel\`;`,
		after: `return \`\${leftRight} \${__zhompModelHubText(\"save scope\")} · \${enter} \${__zhompModelHubText(\"choose\")} · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${leftRight} thinking level · \${enter} apply · \${cancel} keep\`;`,
		after: `return \`\${leftRight} \${__zhompModelHubText(\"thinking level\")} · \${enter} \${__zhompModelHubText(\"apply\")} · \${cancel} \${__zhompModelHubText(\"keep\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enterRight} models · \${upDown} providers · type to search · \${altLeftRight} kind · \${cancel} cancel\`;`,
		after: `return \`\${enterRight} \${__zhompModelHubText(\"models\")} · \${upDown} \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · \${altLeftRight} kind · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `const browse = \`\${upDown} models · \${left} providers · type to search · \${altLeftRight} kind · \${cancel} cancel\`;`,
		after: `const browse = \`\${upDown} \${__zhompModelHubText(\"models\")} · \${left} \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · \${altLeftRight} kind · \${cancel} \${__zhompModelHubText(\"cancel\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enter} pick fallback · \${browse}\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"pick fallback\")} · \${browse}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enter} pick the protected model · \${browse}\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"pick the protected model\")} · \${browse}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enter} assign · \${browse}\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"assign\")} · \${browse}\`;`,
		count: 1,
	},
	{
		before: `const thinking = editable ? \` · \${formatKeyHint(\"t\")} thinking\` : \"\";`,
		after: `const thinking = editable ? \` · \${formatKeyHint(\"t\")} \${__zhompModelHubText(\"thinking\")}\` : \"\";`,
		count: 2,
	},
	{
		before: `return \`\${upDown} rows · \${enter} replace · \${formatKeyHint(\"f\")} add another · \${formatKeyHint(\"x\")} remove\${thinking} · [/] reorder · \${left} providers\`;`,
		after: `return \`\${upDown} \${__zhompModelHubText(\"rows\")} · \${enter} \${__zhompModelHubText(\"replace\")} · \${formatKeyHint(\"f\")} \${__zhompModelHubText(\"add another\")} · \${formatKeyHint(\"x\")} \${__zhompModelHubText(\"remove\")}\${thinking} · [/] \${__zhompModelHubText(\"reorder\")} · \${left} \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${upDown} rows · \${formatKeyHints([\"enter\", \"f\"])} add fallback · \${formatKeyHint(\"x\")} clear chain · \${left} providers\`;`,
		after: `return \`\${upDown} \${__zhompModelHubText(\"rows\")} · \${formatKeyHints([\"enter\", \"f\"])} \${__zhompModelHubText(\"add fallback\")} · \${formatKeyHint(\"x\")} \${__zhompModelHubText(\"clear chain\")} · \${left} \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${upDown} rows · \${enter} new model/provider fallback chain · \${left} providers\`;`,
		after: `return \`\${upDown} \${__zhompModelHubText(\"rows\")} · \${enter} \${__zhompModelHubText(\"new model/provider fallback chain\")} · \${left} \${__zhompModelHubText(\"providers\")}\`;`,
		count: 1,
	},
	{
		before: `? \`\${enter} log in · \${upDown} providers · \${cancel} close\`\n\t\t\t\t: \`\${upDown} providers · \${cancel} close\`;`,
		after: `? \`\${enter} \${__zhompModelHubText(\"log in\")} · \${upDown} \${__zhompModelHubText(\"providers\")} · \${cancel} \${__zhompModelHubText(\"close\")}\`\n\t\t\t\t: \`\${upDown} \${__zhompModelHubText(\"providers\")} · \${cancel} \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `const refresh = entry.kind === \"provider\" ? \` · \${formatKeyHint(\"f5\")} refresh\` : \"\";`,
		after: `const refresh = entry.kind === \"provider\" ? \` · \${formatKeyHint(\"f5\")} \${__zhompModelHubText(\"refresh\")}\` : \"\";`,
		count: 1,
	},
	{
		before: `return \`\${enterRight} models · \${upDown} providers · type to search · \${altLeftRight} kind\${refresh} · \${cancel} close\`;`,
		after: `return \`\${enterRight} \${__zhompModelHubText(\"models\")} · \${upDown} \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · \${altLeftRight} kind\${refresh} · \${cancel} \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${enter} assign roles · \${upDown} models · \${left} providers · type to search · \${altLeftRight} kind\${refresh} · \${cancel} close\`;`,
		after: `return \`\${enter} \${__zhompModelHubText(\"assign\")} \${__zhompModelHubText(\"roles\")} · \${upDown} \${__zhompModelHubText(\"models\")} · \${left} \${__zhompModelHubText(\"providers\")} · \${__zhompModelHubText(\"type to search\")} · \${altLeftRight} kind\${refresh} · \${cancel} \${__zhompModelHubText(\"close\")}\`;`,
		count: 1,
	},
];

const DESCRIBED_BASE_FOOTER_PATCHES: readonly ExactPatch[] = [
	{
		before: `return \`\${upDown} providers · \${enterRight} roles · \${altLeftRight} tabs · \${cancel} close\`;`,
		after: `return \`\${upDown} \${__zhompModelHubText("providers")} · \${enterRight} \${__zhompModelHubText("roles")} · \${altLeftRight} \${__zhompModelHubText("tabs")} · \${cancel} \${__zhompModelHubText("close")}\`;`,
		count: 1,
	},
	{
		before: `return \`\${upDown} rows · \${enter} pick · \${formatKeyHint("f")} fallback · \${formatKeyHint("x")} clear\${thinking} · \${formatKeyHint("c")} cycle · [/] reorder · \${formatKeyHint("n")} new\${savePreset}\`;`,
		after: `return \`\${upDown} \${__zhompModelHubText("rows")} · \${enter} \${__zhompModelHubText("pick")} · \${formatKeyHint("f")} \${__zhompModelHubText("fallback")} · \${formatKeyHint("x")} \${__zhompModelHubText("clear")}\${thinking} · \${formatKeyHint("c")} \${__zhompModelHubText("cycle")} · [/] \${__zhompModelHubText("reorder")} · \${formatKeyHint("n")} \${__zhompModelHubText("new")}\${savePreset}\`;`,
		count: 1,
	},
];

const DESCRIBED_PRESET_FOOTER_PATCHES: readonly ExactPatch[] = [
	{
		before: `const presets =\n\t\t\t\t\tthis.#presets().names.length > 0 ? \` · \${formatKeyHints(["ctrl+left", "ctrl+right"])} preset\` : "";\n\t\t\t\treturn \`\${upDown} providers · \${enterRight} roles · \${altLeftRight} tabs\${presets} · \${cancel} close\`;`,
		after: `const presets =\n\t\t\t\t\tthis.#presets().names.length > 0 ? \` · \${formatKeyHints(["ctrl+left", "ctrl+right"])} \${__zhompModelHubText("preset")}\` : "";\n\t\t\t\treturn \`\${upDown} \${__zhompModelHubText("providers")} · \${enterRight} \${__zhompModelHubText("roles")} · \${altLeftRight} \${__zhompModelHubText("tabs")}\${presets} · \${cancel} \${__zhompModelHubText("close")}\`;`,
		count: 1,
	},
	{
		before: `const switchPreset = this.#presets().names.length > 0 ? \` · \${formatKeyHints(["p", "shift+p"])} preset\` : "";\n\t\t\treturn \`\${upDown} rows · \${enter} pick · \${formatKeyHint("f")} fallback · \${formatKeyHint("x")} clear\${thinking} · \${formatKeyHint("c")} cycle · [/] reorder · \${formatKeyHint("n")} new\${savePreset}\${switchPreset}\`;`,
		after: `const switchPreset = this.#presets().names.length > 0 ? \` · \${formatKeyHints(["p", "shift+p"])} \${__zhompModelHubText("preset")}\` : "";\n\t\t\treturn \`\${upDown} \${__zhompModelHubText("rows")} · \${enter} \${__zhompModelHubText("pick")} · \${formatKeyHint("f")} \${__zhompModelHubText("fallback")} · \${formatKeyHint("x")} \${__zhompModelHubText("clear")}\${thinking} · \${formatKeyHint("c")} \${__zhompModelHubText("cycle")} · [/] \${__zhompModelHubText("reorder")} · \${formatKeyHint("n")} \${__zhompModelHubText("new")}\${savePreset}\${switchPreset}\`;`,
		count: 1,
	},
];

const DESCRIBED_ONLY_PATCHES: readonly ExactPatch[] = [
	{
		before: `describeHubFrame(\n\t\t\t\"omp.overlay.model-hub\",\n\t\t\t\"Models\",`,
		after: `describeHubFrame(\n\t\t\t\"omp.overlay.model-hub\",\n\t\t\t__zhompModelHubText(\"Models\"),`,
		count: 1,
	},
	{
		before: `title: "Models",`,
		after: `title: __zhompModelHubText("Models"),`,
		count: 1,
	},
	{
		before: `label: \"Recent\",`,
		after: `label: __zhompModelHubText(\"Recent\"),`,
		count: 1,
	},
	{
		before: `head: "Model", format: "text", priority: 2`,
		after: `head: __zhompModelHubText("Model"), format: "text", priority: 2`,
		count: 1,
	},
	{
		before: `this.#emptyStateMessage()?.trim() ??\n\t\t\t\t\t(entry.kind === "provider" ? \`No models from \${entry.label} yet\` : "No models available in this scope"),`,
		after: `this.#emptyStateMessage()?.trim() ??\n\t\t\t\t\t(entry.kind === "provider"\n\t\t\t\t\t\t? __zhompModelHubText("No models from {provider} yet", { provider: entry.label })\n\t\t\t\t\t\t: this.#browser.query.trim()\n\t\t\t\t\t\t\t? __zhompModelHubText("No matching models")\n\t\t\t\t\t\t\t: __zhompModelHubText("No models available in this scope")),`,
		count: 1,
	},
	{
		before: `if (this.#assignmentPending) return \"Applying model…\";`,
		after: `if (this.#assignmentPending) return __zhompModelHubText(\"Applying model…\");`,
		count: 1,
	},
	{
		before: `if (assigning.kind === \"fallbackKey\") return \"New fallback chain — pick the model it protects\";`,
		after: `if (assigning.kind === \"fallbackKey\") return __zhompModelHubText(\"New fallback chain — pick the model it protects\");`,
		count: 1,
	},
	{
		before: `return [span(\`\${verb} \`), span(label, "strong")];`,
		after: `return [span(\`\${__zhompModelHubText(verb)} \`), span(label, "strong")];`,
		count: 1,
	},
	{
		before: `return \"Cleared roles fall back to auto-selection\";`,
		after: `return __zhompModelHubText(\"Cleared roles fall back to auto-selection\");`,
		count: 1,
	},
	{
		before: `items.push({ id, label: \"New role…\", icon: \"plus\", tone: \"muted\" });`,
		after: `items.push({ id, label: __zhompModelHubText(\"New role…\"), icon: \"plus\", tone: \"muted\" });`,
		count: 1,
	},
	{
		before: `items.push({ id, label: \"New fallback chain…\", icon: \"plus\", tone: \"muted\" });`,
		after: `items.push({ id, label: __zhompModelHubText(\"New fallback chain…\"), icon: \"plus\", tone: \"muted\" });`,
		count: 1,
	},
	{
		before: `items.push({ id, label: row.role, mono: true, icon: \"git-branch\", detail: \"fallback chain\" });`,
		after: `items.push({ id, label: row.role, mono: true, icon: \"git-branch\", detail: __zhompModelHubText(\"fallback chain\") });`,
		count: 1,
	},
	{
		before: `detail: \`fallback \${row.chainIndex + 1}\``,
		after: `detail: \`\${__zhompModelHubText(\"fallback\")} \${row.chainIndex + 1}\``,
		count: 1,
	},
	{
		before: `{ k: [span(\"Role\", \"muted\")], v: info.name },`,
		after: `{ k: [span(__zhompModelHubText(\"Role\"), \"muted\")], v: info.name },`,
		count: 1,
	},
	{
		before: `text([span(\"Not assigned; no available model fits this role.\", \"muted\")], { wrap: \"word\" }),`,
		after: `text([span(__zhompModelHubText(\"Not assigned; no available model fits this role.\"), \"muted\")], { wrap: \"word\" }),`,
		count: 1,
	},
	{
		before: `text(\"New role\", { role: \"omp.picker.title\" }),`,
		after: `text(__zhompModelHubText(\"New role\"), { role: \"omp.picker.title\" }),`,
		count: 1,
	},
	{
		before: `text([span(\"Name a custom role, then pick the model it runs on.\", \"muted\")], { wrap: \"word\" }),`,
		after: `text([span(__zhompModelHubText(\"Name a custom role, then pick the model it runs on.\"), \"muted\")], { wrap: \"word\" }),`,
		count: 1,
	},
	{
		before: `text(\"New fallback chain\", { role: \"omp.picker.title\" }),`,
		after: `text(__zhompModelHubText(\"New fallback chain\"), { role: \"omp.picker.title\" }),`,
		count: 1,
	},
	{
		before: `text([span(\"Pick the model (or provider) a new retry fallback chain protects.\", \"muted\")], {`,
		after: `text([span(__zhompModelHubText(\"Pick the model (or provider) a new retry fallback chain protects.\"), \"muted\")], {`,
		count: 1,
	},
	{
		before: `const keys = (label: string, ...ids: KeyName[]): NativeHint => ({ keys: ids, label });`,
		after: `const keys = (label: string, ...ids: KeyName[]): NativeHint => ({ keys: ids, label: __zhompModelHubText(label) });`,
		count: 1,
	},
	{
		before: `const cancel = (label: string) => actionHint(\"tui.select.cancel\", label);`,
		after: `const cancel = (label: string) => actionHint(\"tui.select.cancel\", __zhompModelHubText(label));`,
		count: 1,
	},
	{
		before: `const upDown = (label: string) => actionHint([\"tui.select.up\", \"tui.select.down\"], label);`,
		after: `const upDown = (label: string) => actionHint([\"tui.select.up\", \"tui.select.down\"], __zhompModelHubText(label));`,
		count: 1,
	},
	{
		before: `span(strip.purpose === "preset" ? "Preset name " : "New role name ", "muted"),`,
		after: `span(strip.purpose === "preset" ? __zhompModelHubText("Preset name ") : __zhompModelHubText("New role name "), "muted"),`,
		count: 1,
	},
	{
		before: `const labelText = preset ? "Preset name:" : "New role name:";`,
		after: `const labelText = preset ? __zhompModelHubText("Preset name:") : __zhompModelHubText("New role name:");`,
		count: 1,
	},
	{
		before: `theme.fg("dim", "(letters, digits, - and _)")`,
		after: `theme.fg("dim", __zhompModelHubText("(letters, digits, - and _)"))`,
		count: 1,
	},
	{
		before: `pickerAction(\`roles:\${action}\`, label, key, primary ? { primary: true } : undefined);`,
		after: `pickerAction(\`roles:\${action}\`, __zhompModelHubText(label), key, primary ? { primary: true } : undefined);`,
		count: 1,
	},
	{
		before: `const cancel = (label: string): TspPickerAction => ({ ...CLOSE_ACTION, label });`,
		after: `const cancel = (label: string): TspPickerAction => ({ ...CLOSE_ACTION, label: __zhompModelHubText(label) });`,
		count: 1,
	},
	{
		before: `strip.purpose === "preset" ? "Save preset" : "Create role"`,
		after: `strip.purpose === "preset" ? __zhompModelHubText("Save preset") : __zhompModelHubText("Create role")`,
		count: 1,
	},
	{
		before: `strip.kind === "thinking" ? "Apply" : strip.kind === "scope" ? "Save to scope" : "Assign / clear"`,
		after: `strip.kind === "thinking" ? __zhompModelHubText("Apply") : strip.kind === "scope" ? __zhompModelHubText("Save to scope") : __zhompModelHubText("Assign / clear")`,
		count: 1,
	},
	{
		before: `pickerAction("refresh", "Refresh provider", "f5")`,
		after: `pickerAction("refresh", __zhompModelHubText("Refresh provider"), "f5")`,
		count: 1,
	},
	{
		before: `pickerAction("assign", label, "enter", { primary: true })`,
		after: `pickerAction("assign", __zhompModelHubText(label), "enter", { primary: true })`,
		count: 1,
	},
	{
		before: `pickerAction("login", "Log in", "enter", { primary: true })`,
		after: `pickerAction("login", __zhompModelHubText("Log in"), "enter", { primary: true })`,
		count: 1,
	},
	{
		before: `"Assign role",`,
		after: `__zhompModelHubText("Assign role"),`,
		count: 1,
	},
	{
		before: `disabled: "No model selected"`,
		after: `disabled: __zhompModelHubText("No model selected")`,
		count: 1,
	},
	{
		before: `span(strip.kind === "thinking" ? "Thinking for " : "Save ", "muted"),`,
		after: `span(strip.kind === "thinking" ? __zhompModelHubText("Thinking for ") : __zhompModelHubText("Save "), "muted"),`,
		count: 1,
	},
	{
		before: `span(" to", "muted")`,
		after: `span(__zhompModelHubText(" to"), "muted")`,
		count: 2,
	},
	{
		before: `open("chains", "Model fallback chains")`,
		after: `open("chains", __zhompModelHubText("Model fallback chains"))`,
		count: 1,
	},
		{
			before: `const savePreset = this.#callbacks.onSavePreset ? \` · \${formatKeyHint("s")} save preset\` : "";`,
			after: `const savePreset = this.#callbacks.onSavePreset ? \` · \${formatKeyHint("s")} \${__zhompModelHubText("save preset")}\` : "";`,
			count: 1,
		},
		{
			before: `span("Applying model…", "accent")`,
			after: `span(__zhompModelHubText("Applying model…"), "accent")`,
			count: 1,
		},
		{
			before: `spans = [span("New fallback chain — pick the model it protects", "accent")];`,
			after: `spans = [span(__zhompModelHubText("New fallback chain — pick the model it protects"), "accent")];`,
			count: 1,
		},
		{
			before: `span(\"Model roles — \", \"muted\"),`,
			after: `span(__zhompModelHubText(\"Model roles — \"), \"muted\"),`,
			count: 1,
		},
		{
			before: `span(\" adds a retry fallback, cleared roles fall back to auto-selection\", \"muted\"),`,
			after: `span(__zhompModelHubText(\" adds a retry fallback, cleared roles fall back to auto-selection\"), \"muted\"),`,
			count: 1,
		},
		{
			before: `text([span(\"Roles:\", \"dim\")]),`,
			after: `text([span(__zhompModelHubText(\"Roles:\"), \"dim\")]),`,
			count: 1,
		},
];

const DESCRIBED_PRESET_UI_PATCHES: readonly ExactPatch[] = [
	{
		before: `theme.fg("dim", "Preset:")`,
		after: `theme.fg("dim", __zhompModelHubText("Preset:"))`,
		count: 1,
	},
	{
		before: `theme.fg("muted", "custom")`,
		after: `theme.fg("muted", __zhompModelHubText("custom"))`,
		count: 1,
	},
	{
		before: `span("Preset ", "muted")`,
		after: `span(__zhompModelHubText("Preset "), "muted")`,
		count: 1,
	},
	{
		before: `span(presets.active, "strong") : span("custom", "muted")`,
		after: `span(presets.active, "strong") : span(__zhompModelHubText("custom"), "muted")`,
		count: 1,
	},
	{
		before: `" · Cleared roles fall back to auto-selection"`,
		after: `\` · \${__zhompModelHubText("Cleared roles fall back to auto-selection")}\``,
		count: 1,
	},
	{
		before: `spans = [span(\`\${verb} \`, "accent"), span(label, "accent strong")];`,
		after: `spans = [span(__zhompModelHubText(verb) + " ", "accent"), span(label, "accent strong")];`,
		count: 1,
	},
];

function patchesFor(shape: ModelHubShape): ExactPatch[] {
	const common = commonPatches(shape);
	if (shape !== "legacy") {
		const presetFooterPatches = shape === "described-presets"
			? DESCRIBED_PRESET_FOOTER_PATCHES
			: DESCRIBED_BASE_FOOTER_PATCHES;
		return [
			...common,
			...DESCRIBED_STATUS_PATCHES,
			...DESCRIBED_FOOTER_PATCHES,
			...presetFooterPatches,
			...DESCRIBED_ONLY_PATCHES,
			...(shape === "described-presets" ? DESCRIBED_PRESET_UI_PATCHES : []),
		];
	}
	return [...common, ...LEGACY_STATUS_PATCHES, ...LEGACY_FOOTER_PATCHES];
}


export function translateModelHubSource(
	source: string,
	dictionary: Dictionary,
): { source: string; translated: number; supported: boolean } {
	try {
		const shape = isSupportedShape(source);
		if (!shape) return { source, translated: 0, supported: false };
		const translatedSource = applyPatches(source, patchesFor(shape));
		if (translatedSource === undefined) return { source, translated: 0, supported: false };
		const translations = getTextTranslations(dictionary);
		const translated = Object.keys(translations).length;
		if (translated === 0) return { source, translated: 0, supported: true };
		return { source: `${modelHubHelpers(translations)}\n\n${translatedSource}`, translated, supported: true };
	} catch {
		return { source, translated: 0, supported: false };
	}
}

const translationsByPath = new Map<string, Dictionary>();

function modulePathKey(path: string): string {
	const absolute = resolve(path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function diagnostic(message: string): void {
	console.log(`[zhomp] ${message}`);
}

export function registerModelTranslation(modelHubPath: string, dictionary: Dictionary): void {
	try {
		if (!isAbsolute(modelHubPath)) {
			diagnostic("model hub translation skipped: expected an absolute module path");
			return;
		}
		const key = modulePathKey(modelHubPath);
		const alreadyRegistered = translationsByPath.has(key);
		translationsByPath.set(key, dictionary);
		if (alreadyRegistered) return;
		const filter = new RegExp(`^${resolve(modelHubPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, process.platform === "win32" ? "i" : "");
		Bun.plugin({
			name: "zhomp-model-hub-translation",
			setup(build) {
				build.onLoad({ filter }, ({ path }) => {
					const source = readFileSync(path, "utf8");
					const result = translateModelHubSource(source, translationsByPath.get(key) ?? {});
					if (!result.supported) diagnostic(`model hub source shape unsupported; skipped ${path}`);
					// Bun's synchronous onLoad requires a result, including unchanged/unsupported source.
					return { contents: result.source, loader: "ts", resolveDir: dirname(path) };
				});
			},
		});
	} catch (error) {
		diagnostic(`model hub translation registration failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
