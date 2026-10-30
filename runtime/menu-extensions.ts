import type { MenuModule, MenuPatch } from "./menu-catalog";

function text(key: string, values?: string): string {
	return `__zhompMenuText(${JSON.stringify(key)}${values ? `, ${values}` : ""})`;
}

function literal(key: string, count = 1): MenuPatch {
	return { before: JSON.stringify(key), after: text(key), count };
}

const LIST_PATCHES: readonly MenuPatch[] = [
	// Keep the original kind labels in menu state and search text; localize only rendering.
	{ before: 'label: entry.label, count: entry.count', after: 'label: __zhompMenuText(entry.label), count: entry.count' },
	{ before: 'span(entry.label, "muted strong")', after: 'span(__zhompMenuText(entry.label), "muted strong")' },
	{ before: '`${item.icon} ${item.label} ${countBadge}`', after: '`${item.icon} ${__zhompMenuText(item.label)} ${countBadge}`' },
	{ before: 'facts: { kind: this.#getKindLabel(ext.kind) }', after: 'facts: { kind: __zhompMenuText(this.#getKindLabel(ext.kind)) }' },
	{ before: 'theme.fg("muted", "Search: ")', after: `theme.fg("muted", ${text("Search:")} + " ")` },
	literal("type to filter"),
	{ before: 'theme.fg("muted", "  No extensions found for this provider.")', after: `theme.fg("muted", "  " + ${text("No extensions found for this provider.")})` },
	literal("No extensions found for this provider."),
	{ before: '`Enable ${sanitizeDisplayLine(entry.providerName)}`', after: text("Enable {provider}", "{ provider: sanitizeDisplayLine(entry.providerName) }") },
	{ before: '`Enable ${item.providerName}`', after: text("Enable {provider}", "{ provider: item.providerName }") },
	literal("Master Switch"),
	{ before: 'theme.fg("warning", "(Master Switch)")', after: `theme.fg("warning", "(" + ${text("Master Switch")} + ")")` },
	{ before: '`Load ~/ ${sanitizeDisplayLine(entry.providerName)} config`', after: text("Load ~/ {provider} config", "{ provider: sanitizeDisplayLine(entry.providerName) }") },
	{ before: '`Load ~/ ${item.providerName} config`', after: text("Load ~/ {provider} config", "{ provider: item.providerName }") },
	literal("opt-in; project config always loads"),
	{ before: 'theme.fg("muted", "(opt-in; project config always loads)")', after: `theme.fg("muted", "(" + ${text("opt-in; project config always loads")} + ")")` },
	literal("Provider disabled", 4),
];

const INSPECTOR_PATCHES: readonly MenuPatch[] = [
	literal("Select an extension"), literal("to view details"), literal("Select an extension to view details"),
	literal("User", 2), literal("Project", 2), literal("Native", 2),
	literal("Status"), literal("Origin"), literal("Path"), literal("Origin:"),
	literal("(empty)"), literal("(no arguments)", 2),
	literal("(no apply conditions)"), literal("Visibility"), literal("accepts $ARGUMENTS", 2),
	literal("Command", 4), literal("Health"), literal("Server"), literal("Website"),
	// Translate section text at the renderer, retaining canonical headings in native stable keys.
	{ before: 'span(head, "muted")', after: 'span(__zhompMenuText(head), "muted")' },
	{ before: 'new Section({\n\t\t\t\ttitle,', after: 'new Section({\n\t\t\t\ttitle: __zhompMenuText(title),' },
	literal("Args", 2), literal("Env vars", 2),
	{ before: '"  omitted from the system-prompt skill list"', after: '"  " + ' + text("omitted from the system-prompt skill list") },
	{ before: '`${theme.fg("warning", "hidden")}    omitted from the system-prompt skill list`', after: '`${theme.fg("warning", "hidden")}    ${' + text("omitted from the system-prompt skill list") + '}`' },
	{ before: 'theme.fg("dim", "  (empty)")', after: `theme.fg("dim", "  " + ${text("(empty)")})` },
	{ before: 'theme.fg("dim", "  (no apply conditions)")', after: `theme.fg("dim", "  " + ${text("(no apply conditions)")})` },
	{ before: '`via ${sanitizeDisplayLine(ext.source.providerName)} (${levelLabel})`', after: text("via {provider} ({level})", "{ provider: sanitizeDisplayLine(ext.source.providerName), level: levelLabel }") },
	{ before: '`via ${sanitizeDisplayText(ext.source.providerName)} (${levelLabel})`', after: text("via {provider} ({level})", "{ provider: sanitizeDisplayText(ext.source.providerName), level: levelLabel }") },
	{ before: '`${snap.envCount} defined`', after: text("{count} defined", "{ count: snap.envCount }"), count: 2 },
	{ before: '`… ${hidden} more ${noun} (${expandKeyHint()} to expand)`', after: text("… {count} more {noun} ({key} to expand)", "{ count: hidden, noun, key: expandKeyHint() }") },
	{ before: '`  … ${hidden} more (${expandKeyHint()} to expand)`', after: '"  " + ' + text("… {count} more ({key} to expand)", "{ count: hidden, key: expandKeyHint() }"), count: 3 },
	{ before: '`  … ${wrapped.length - MCP_INLINE_DESC_LINES} more (${expandKeyHint()} to expand)`', after: '"  " + ' + text("… {count} more ({key} to expand)", "{ count: wrapped.length - MCP_INLINE_DESC_LINES, key: expandKeyHint() }") },
	{ before: '`${indent}… ${hidden} more (${expandKeyHint()} to expand)`', after: 'indent + ' + text("… {count} more ({key} to expand)", "{ count: hidden, key: expandKeyHint() }") },
	{ before: '`  … ${wrapped.length - shownBudget} more (${expandKeyHint()} to expand)`', after: '"  " + ' + text("… {count} more ({key} to expand)", "{ count: wrapped.length - shownBudget, key: expandKeyHint() }") },
	{ before: '`${params.length} args (${expandKeyHint()} to expand)`', after: text("{count} args ({key} to expand)", "{ count: params.length, key: expandKeyHint() }") },
	{ before: '`${params.length} args`', after: text("{count} args", "{ count: params.length }"), count: 2 },
	{ before: '`  … args (${expandKeyHint()} to expand)`', after: '"  " + ' + text("… args ({key} to expand)", "{ key: expandKeyHint() }"), count: 2 },
];

const KIND_LABELS = [
	"Extension Modules", "Skills", "Rules", "Tools", "MCP Servers", "Prompts", "Instructions",
	"Context Files", "Hooks", "Slash Commands",
];

export const EXTENSION_MENU_MODULES: readonly MenuModule[] = [
	{ root: "tui", path: "src/overlays/extensions/extension-list.ts", patches: LIST_PATCHES },
	{ root: "tui", path: "src/overlays/extensions/inspector-panel.ts", patches: INSPECTOR_PATCHES },
	{ root: "tui", path: "src/overlays/extensions/state-manager.ts", patches: KIND_LABELS.map(key => ({ before: `return ${JSON.stringify(key)};`, after: `return ${text(key)};` })) },
];

export const EXTENSION_MENU_TEXT_KEYS: readonly string[] = [
	...KIND_LABELS, "Commands", "Context", "Search:", "type to filter", "No extensions found for this provider.",
	"Enable {provider}", "Master Switch", "Load ~/ {provider} config", "opt-in; project config always loads", "Provider disabled",
	"Select an extension", "to view details", "Select an extension to view details", "User", "Project", "Native",
	"Status", "Origin", "Path", "Origin:", "(empty)", "(no arguments)", "Arguments", "Applies", "(no apply conditions)",
	"Rule", "Visibility", "Instruction", "accepts $ARGUMENTS", "Invocation", "Template", "Hook", "Prompt", "Preview", "Trigger",
	"Command", "Health", "Server", "Website", "Resources", "Args", "Env vars", "omitted from the system-prompt skill list",
	"via {provider} ({level})", "{count} defined", "… {count} more {noun} ({key} to expand)", "… {count} more ({key} to expand)",
	"{count} args ({key} to expand)", "… args ({key} to expand)", "{count} args",
];
