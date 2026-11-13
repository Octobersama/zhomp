import type { MenuModule, MenuPatch } from "./menu-catalog";

function patch(before: string, after: string, count = 1): MenuPatch {
	return { before, after, count };
}

function menuText(source: string): string {
	return `__zhompMenuText(${JSON.stringify(source)})`;
}

const CONTEXT_VIEWER_PATCHES: readonly MenuPatch[] = [
	patch(
		'import type { ContextViewCategory, ContextViewData, ContextViewEntry } from "../chrome/context-view-model";',
		'import { contextCategoryDescriptor, type ContextViewCategory, type ContextViewData, type ContextViewEntry } from "../chrome/context-view-model";',
	),
	patch(
		'type ViewState = "overview" | "category" | "entry";',
		`type ViewState = "overview" | "category" | "entry";\n\nfunction categoryDisplayLabel(category: ContextViewCategory, overview = false): string {\n\tif (category.key !== undefined) return safeText(category.label);\n\tconst descriptor = contextCategoryDescriptor(category.id);\n\tconst label = overview ? descriptor.overviewLabel ?? descriptor.label : descriptor.label;\n\treturn safeText(__zhompMenuText(label));\n}`,
	),
	patch('\toverviewLabel,\n', ''),
	patch(
		'this.#modelLabel = safeText(breakdown.model?.name ?? breakdown.model?.id ?? "no model");',
		`this.#modelLabel = safeText(breakdown.model?.name ?? breakdown.model?.id ?? ${menuText("no model")});`,
	),
	patch(
		'? ["Category totals split Used by estimated share; the entries inside may not add up to them."]',
		`? [${menuText("Category totals split Used by estimated share; the entries inside may not add up to them.")}]`,
	),
	patch('readonly #panel = new OverlayPanel("Context");', `readonly #panel = new OverlayPanel(${menuText("Context")});`),
	patch('span("Context", "strong"),', `span(${menuText("Context")}, "strong"),`),
	patch(
		'span(` · ${category ? safeText(category.label) : this.#modelLabel}`, "muted"),',
		'span(` · ${category ? categoryDisplayLabel(category) : this.#modelLabel}`, "muted"),',
	),
	patch(
		'return [`Used ${labels.used}${labels.detail}`, labels.room];',
		'return [__zhompMenuText("Used {used}{detail}", { used: labels.used, detail: labels.detail }), labels.room];',
	),
	patch(
		'this.#state === "overview" ? `Context · ${this.#modelLabel}` : safeText(this.#category!.label);',
		'this.#state === "overview" ? `${__zhompMenuText("Context")} · ${this.#modelLabel}` : categoryDisplayLabel(this.#category!);',
	),
	patch(
		'const movement = this.#state === "overview" ? "select/scroll" : this.#state === "category" ? "select" : "scroll";',
		`const movement = this.#state === "overview" ? ${menuText("select/scroll")} : this.#state === "category" ? ${menuText("select")} : ${menuText("scroll")};`,
	),
	patch('paging && `${paging} page`,', 'paging && `${paging} ${__zhompMenuText("page")}`,') ,
	patch('confirm && `${confirm} open`,', 'confirm && `${confirm} ${__zhompMenuText("open")}`,') ,
	patch(
		'cancel && `${cancel} ${this.#state === "overview" ? "close" : "back"}`,',
		'cancel && `${cancel} ${__zhompMenuText(this.#state === "overview" ? "close" : "back")}`,',
	),
	patch('actionButton("Back", "back")', `actionButton(${menuText("Back")}, "back")`),
	patch('actionButton("Close", "close")', `actionButton(${menuText("Close")}, "close")`),
	patch(
		'label: safeText(overviewLabel(category)),',
		'label: categoryDisplayLabel(category, true),',
	),
];

const CONTEXT_OVERVIEW_PATCHES: readonly MenuPatch[] = [
	patch(
		'export interface OverviewRow {',
		`const CONTEXT_OVERVIEW_TEXT_KEYS = {
	"system-prompt": "System Prompt",
	"instruction-files": "Instruction Files",
	skills: "Skills",
	"built-in-tools": "Built-in Tools",
	"custom-tools": "Custom Tools",
	"user-messages": "User / Developer Messages",
	"assistant-messages": "Assistant Messages",
	"assistant-thinking": "Assistant Thinking",
	"tool-calls": "Tool Calls",
	"tool-output": "Tool Output",
	buffer: "Auto-Compact Buffer",
	free: "Free Space",
} as const satisfies Readonly<Record<ContextPresentationId, string>>;

export interface OverviewRow {`,
	),
	patch(
		'const label = truncateToWidth(safeLine(row.label), budget);',
		'const label = truncateToWidth(safeLine(row.child ? row.label : __zhompMenuText(row.id === "system-prompt" && row.label === "System Prompt (excluding Skills)" ? row.label : CONTEXT_OVERVIEW_TEXT_KEYS[row.id])), budget);',
	),
	patch(
		'span(safeText(row.label), selected ? `${presentation.color} strong` : undefined),',
		'span(safeText(row.child ? row.label : __zhompMenuText(row.id === "system-prompt" && row.label === "System Prompt (excluding Skills)" ? row.label : CONTEXT_OVERVIEW_TEXT_KEYS[row.id])), selected ? `${presentation.color} strong` : undefined),',
	),
	patch(
		'if (!snap.visionCapable) return ["Snapcompact: inactive (model has no image input)"];',
		`if (!snap.visionCapable) return [${menuText("Snapcompact: inactive (model has no image input)")}];`,
	),
	patch('const lines = ["Snapcompact (estimated wire savings)"];', `const lines = [${menuText("Snapcompact (estimated wire savings)")}];`),
	patch(
		'const frames = `${sp.frames} frame${sp.frames === 1 ? "" : "s"}`;',
		'const frames = __zhompMenuText(sp.frames === 1 ? "{count} frame" : "{count} frames", { count: sp.frames });',
	),
	patch(
		'`  System prompt (${scope}): saves ~${formatNumber(sp.savedTokens)} (${formatNumber(sp.textTokens)} text → ${frames} ≈ ${formatNumber(sp.imageTokens)})`,',
		'`  ${__zhompMenuText("System prompt ({scope}): saves ~{saved} ({text} text → {frames} ≈ {images})", { scope, saved: formatNumber(sp.savedTokens), text: formatNumber(sp.textTokens), frames, images: formatNumber(sp.imageTokens) })}`,',
	),
	patch('"image budget exhausted"', menuText("image budget exhausted")),
	patch('"nothing to image"', menuText("nothing to image")),
	patch('"frames would not save tokens"', menuText("frames would not save tokens")),
	patch(
		'lines.push(`  System prompt (${scope}): stays text (${reason})`);',
		'lines.push(`  ${__zhompMenuText("System prompt ({scope}): stays text ({reason})", { scope, reason })}`);',
	),
	patch(
		'`  Tool results: saves ~${formatNumber(tr.savedTokens)} (${tr.swapped}/${tr.total} imaged, ${formatNumber(tr.textTokens)} text → ${tr.frames} frames ≈ ${formatNumber(tr.imageTokens)})`',
		'`  ${__zhompMenuText("Tool results: saves ~{saved} ({swapped}/{total} imaged, {text} text → {frames} frames ≈ {images})", { saved: formatNumber(tr.savedTokens), swapped: tr.swapped, total: tr.total, text: formatNumber(tr.textTokens), frames: tr.frames, images: formatNumber(tr.imageTokens) })}`',
	),
	patch(
		'`  Tool results: none imaged (${tr.total} in history)`',
		'`  ${__zhompMenuText("Tool results: none imaged ({total} in history)", { total: tr.total })}`',
	),
	patch(
		'`  Next request: ~${formatNumber(Math.max(0, breakdown.usedTokens - snap.savedTokens))} tokens on the wire`,',
		'`  ${__zhompMenuText("Next request: ~{count} tokens on the wire", { count: formatNumber(Math.max(0, breakdown.usedTokens - snap.savedTokens)) })}`,',
	),
	patch(
		'label: `${category.label} · ${formatNumber(category.tokens)} tokens (${percentString(category.tokens, window)})`,',
		'label: __zhompMenuText("{category} · {count} tokens ({percent})", { category: category.label, count: formatNumber(category.tokens), percent: percentString(category.tokens, window) }),',
	),
	patch(
		'label: `Free space · ${formatNumber(breakdown.freeTokens)} tokens (${percentString(breakdown.freeTokens, window)})`,',
		'label: __zhompMenuText("Free space · {count} tokens ({percent})", { count: formatNumber(breakdown.freeTokens), percent: percentString(breakdown.freeTokens, window) }),',
	),
	patch(
		'label: `Autocompact buffer · ${formatNumber(breakdown.autoCompactBufferTokens)} tokens (${percentString(breakdown.autoCompactBufferTokens, window)})`,',
		'label: __zhompMenuText("Autocompact buffer · {count} tokens ({percent})", { count: formatNumber(breakdown.autoCompactBufferTokens), percent: percentString(breakdown.autoCompactBufferTokens, window) }),',
	),
	patch(
		'const room =\n\t\tthresholdTokens === undefined\n\t\t\t? `${formatNumber(freeTokens)} free`\n\t\t\t: usedTokens >= thresholdTokens\n\t\t\t\t? `Past auto-compaction at ${percentString(thresholdTokens, window, 0)}`\n\t\t\t\t: `${formatNumber(thresholdTokens - usedTokens)} left before auto-compaction at ${percentString(thresholdTokens, window, 0)}`;',
		'const room =\n\t\tthresholdTokens === undefined\n\t\t\t? __zhompMenuText("{count} free", { count: formatNumber(freeTokens) })\n\t\t\t: usedTokens >= thresholdTokens\n\t\t\t\t? __zhompMenuText("Past auto-compaction at {percent}", { percent: percentString(thresholdTokens, window, 0) })\n\t\t\t\t: __zhompMenuText("{count} left before auto-compaction at {percent}", { count: formatNumber(thresholdTokens - usedTokens), percent: percentString(thresholdTokens, window, 0) });',
	),
	patch(
		'detail: ` of ${formatNumber(window)} tokens · ${percentString(usedTokens, window, 0)}`,',
		'detail: ` ${__zhompMenuText("of {count} tokens · {percent}", { count: formatNumber(window), percent: percentString(usedTokens, window, 0) })}`,',
	),
	patch(
		'title: `Auto-compaction at ${percentString(thresholdTokens, window, 0)} · ${formatNumber(thresholdTokens)} tokens`,',
		'title: __zhompMenuText("Auto-compaction at {percent} · {count} tokens", { percent: percentString(thresholdTokens, window, 0), count: formatNumber(thresholdTokens) }),',
	),
	patch('aria: "Context usage by category"', `aria: ${menuText("Context usage by category")}`),
];

const CONTEXT_FORMAT_PATCHES: readonly MenuPatch[] = [
	patch(
		'if (item.interrupted) return "N/A · Interrupted";',
		`if (item.interrupted) return ${menuText("N/A · Interrupted")};`,
	),
	patch(
		'return `${item.tokens.toLocaleString("en-US")} ${item.tokens === 1 ? "token" : "tokens"}`;',
		'return __zhompMenuText(item.tokens === 1 ? "{count} token" : "{count} tokens", { count: item.tokens.toLocaleString("en-US") });',
	),
	patch(
		'theme.fg("dim", "  … more") +',
		'theme.fg("dim", `  … ${__zhompMenuText("more")}`) +',
	),
	patch(
		'`${confirm} View Content`',
		'`${confirm} ${__zhompMenuText("View Content")}`',
	),
];

export const CONTEXT_MENU_MODULES: readonly MenuModule[] = [
	{ root: "tui", path: "src/overlays/context-viewer.ts", patches: CONTEXT_VIEWER_PATCHES },
	{ root: "tui", path: "src/overlays/context-viewer-overview.ts", patches: CONTEXT_OVERVIEW_PATCHES },
	{ root: "tui", path: "src/overlays/context-viewer-format.ts", patches: CONTEXT_FORMAT_PATCHES },
];

export const CONTEXT_MENU_TEXT_KEYS: readonly string[] = [
	"Context",
	"no model",
	"System Prompt",
	"System Prompt (excluding Skills)",
	"Instruction Files",
	"Skills",
	"Built-in Tools",
	"Custom Tools",
	"User / Developer Messages",
	"Assistant Messages",
	"Assistant Thinking",
	"Tool Calls",
	"Tool Output",
	"Auto-Compact Buffer",
	"Free Space",
	"Category totals split Used by estimated share; the entries inside may not add up to them.",
	"select/scroll",
	"select",
	"scroll",
	"page",
	"open",
	"close",
	"back",
	"Back",
	"Close",
	"Used {used}{detail}",
	"of {count} tokens · {percent}",
	"{count} free",
	"Past auto-compaction at {percent}",
	"{count} left before auto-compaction at {percent}",
	"Context usage by category",
	"Auto-compaction at {percent} · {count} tokens",
	"{category} · {count} tokens ({percent})",
	"Free space · {count} tokens ({percent})",
	"Autocompact buffer · {count} tokens ({percent})",
	"{count} token",
	"{count} tokens",
	"N/A · Interrupted",
	"more",
	"View Content",
	"Snapcompact: inactive (model has no image input)",
	"Snapcompact (estimated wire savings)",
	"{count} frame",
	"{count} frames",
	"System prompt ({scope}): saves ~{saved} ({text} text → {frames} ≈ {images})",
	"image budget exhausted",
	"nothing to image",
	"frames would not save tokens",
	"System prompt ({scope}): stays text ({reason})",
	"Tool results: saves ~{saved} ({swapped}/{total} imaged, {text} text → {frames} frames ≈ {images})",
	"Tool results: none imaged ({total} in history)",
	"Next request: ~{count} tokens on the wire",
];
