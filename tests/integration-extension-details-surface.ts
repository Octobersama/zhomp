import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import type { MenuModule } from "../runtime/menu-catalog";
import { parseDictionaryText } from "./dictionary-validation";

interface Extension {
	id: string;
	kind: "extension-module" | "skill" | "rule" | "tool" | "mcp" | "prompt" | "instruction" | "context-file" | "hook" | "slash-command";
	name: string;
	displayName: string;
	description: string;
	path: string;
	source: { provider: string; providerName: string; level: "project" };
	state: "active";
	raw: { content: string; frontmatter?: { hide: boolean }; globs?: string[]; type?: string; tool?: string; applyTo?: string };
}
interface List {
	render(width: number): readonly string[];
	setSearchQuery(query: string): void;
	getSelectedExtension(): Extension | null;
	handleInput(input: string): void;
	pickerView?(): { items: readonly { id: string; label: unknown }[]; order: readonly unknown[] };
	describeList?(key: string): unknown;
}
interface Inspector {
	setExtension(extension: Extension | null): void;
	render(width: number): readonly string[];
	describePreview?(): unknown;
}

const configPath = process.env.OMP_ZH_CONFIG;
const root = process.env.PROBE_DIR;
const mode = process.env.MENU_SURFACE_MODE;
if (!configPath || !root) throw new Error("Missing installed config or probe root");
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") throw new Error("Invalid menu mode");
const installed = dirname(configPath);
const hostApi = await import(pathToFileURL(join(installed, "host.ts")).href) as { readLaunchConfig(path: string): LaunchConfig };
const launch = hostApi.readLaunchConfig(configPath);
const dictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const marker = '文案"; globalThis.__zhompExtensionInjected = true; // $&';
if (mode === "hostile") {
	for (const key of ["Select an extension", "Select an extension to view details", "Prompt", "Tip:", "Extension Modules"]) dictionary[key] = marker;
	const path = join(root, "extension-hostile.json");
	writeFileSync(path, JSON.stringify(dictionary));
	process.env.OMP_ZH_DICT = path;
} else process.env.OMP_ZH_DICT = launch.dictPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
(globalThis as typeof globalThis & { __zhompExtensionInjected?: boolean }).__zhompExtensionInjected = false;
const extension = await import(pathToFileURL(launch.extensionPath).href) as {
	preparePreloadDisplayTranslations(config: LaunchConfig, path: string): Promise<void>;
};
await extension.preparePreloadDisplayTranslations(launch, configPath);
const catalog = await import(pathToFileURL(join(installed, "menu-extensions.ts")).href) as { EXTENSION_MENU_MODULES: readonly MenuModule[] };
const translator = await import(pathToFileURL(join(installed, "menu-ui.ts")).href) as {
	translateMenuSource(source: string, module: MenuModule, dictionary: Readonly<Record<string, string>>): { supported: boolean };
};
const supported = new Map(catalog.EXTENSION_MENU_MODULES.map(module => [module.path, translator.translateMenuSource(readFileSync(join(launch.host.tuiDir, module.path), "utf8"), module, dictionary).supported]));
function expected(key: string, file: string): string {
	if (mode === "ordinary" || !supported.get(file)) return key;
	const value = dictionary[key];
	if (!value || value === key) throw new Error(`Missing translation: ${key}`);
	return value;
}
function contains(output: string, value: string, label: string): void {
	ok(output.includes(value), `${label} missing ${JSON.stringify(value)} in ${JSON.stringify(output)}`);
}
function nativeContains(output: unknown, value: string, label: string): void {
	contains(JSON.stringify(output), JSON.stringify(value).slice(1, -1), label);
}
async function hostImport(path: string): Promise<unknown> {
	return import(pathToFileURL(Bun.resolveSync(`@oh-my-pi/pi-tui/${path}`, launch.host.packageDir)).href);
}
const theme = await hostImport("theme/theme") as { initThemeSync(preset: "unicode"): void };
theme.initThemeSync("unicode");
const listApi = await hostImport("overlays/extensions/extension-list") as { ExtensionList: new (extensions: Extension[], callbacks: { onToggle(id: string, enabled: boolean): void }, maxVisible: number) => List };
const inspectorApi = await hostImport("overlays/extensions/inspector-panel") as { InspectorPanel: new () => Inspector };
const stateApi = await hostImport("overlays/extensions/state-manager") as {
	applyFilter(extensions: Extension[], query: string): Extension[];
	buildSidebarTree(extensions: Extension[], providers: readonly { id: string; displayName: string; enabled: boolean }[]): readonly { id: string; label: string; children: readonly { id: string; label: string }[] }[];
};
const rawContent = "Probe content: high provider/id $ARGUMENTS stays raw";
const kinds: Extension["kind"][] = ["extension-module", "skill", "rule", "tool", "mcp", "prompt", "instruction", "context-file", "hook", "slash-command"];
const fixtures = kinds.map((kind, index): Extension => ({
	id: `${kind}:Probe${index}`, kind, name: index === 5 ? "TargetNeedle" : `Probe${index}`, displayName: index === 5 ? "TargetNeedle" : `Probe${index}`,
	description: `Caller description ${kind}`, path: `/probe/${kind}.md`,
	source: { provider: "ProbeProvider", providerName: "Probe Provider", level: "project" }, state: "active",
	raw: { content: rawContent, ...(kind === "skill" ? { frontmatter: { hide: true } } : {}), ...(kind === "hook" ? { type: "tool", tool: "probe_tool" } : {}) },
}));
const before = JSON.stringify(fixtures);
const toggles: { id: string; enabled: boolean }[] = [];
const list = new listApi.ExtensionList(fixtures, { onToggle(id, enabled) { toggles.push({ id, enabled }); } }, 40);
const listFile = "src/overlays/extensions/extension-list.ts";
const listAnsi = Bun.stripANSI(list.render(240).join("\n"));
for (const key of ["Extension Modules", "Skills", "Rules", "Tools", "MCP Servers", "Commands", "Context"]) {
	contains(listAnsi, expected(key, listFile), "extension kind header");
}
if (list.pickerView) nativeContains(list.pickerView(), expected("Extension Modules", listFile), "native group");
list.setSearchQuery("TargetNeedle");
contains(Bun.stripANSI(list.render(240).join("\n")), "TargetNeedle", "English item search");
strictEqual(list.getSelectedExtension()?.id, fixtures[5]?.id);
list.handleInput("\r");
deepStrictEqual(toggles, [{ id: fixtures[5]?.id, enabled: false }], "Translated list must toggle the original extension identity");
list.setSearchQuery("no-such-probe");
contains(Bun.stripANSI(list.render(240).join("\n")), expected("No extensions found for this provider.", listFile), "empty list");
if (list.describeList) nativeContains(list.describeList("probe"), expected("No extensions found for this provider.", listFile), "native empty list");
deepStrictEqual(stateApi.applyFilter(fixtures, "TargetNeedle").map(item => item.id), [fixtures[5]?.id]);
const tree = stateApi.buildSidebarTree(fixtures, [{ id: "ProbeProvider", displayName: "Probe Provider", enabled: true }]);
strictEqual(tree[0]?.id, "ProbeProvider");
strictEqual(tree[0]?.label, "Probe Provider");
contains(JSON.stringify(tree), JSON.stringify(expected("Extension Modules", "src/overlays/extensions/state-manager.ts")).slice(1, -1), "tree kind label");
const panel = new inspectorApi.InspectorPanel();
const panelFile = "src/overlays/extensions/inspector-panel.ts";
contains(Bun.stripANSI(panel.render(240).join("\n")), expected("Select an extension", panelFile), "empty inspector");
if (panel.describePreview) nativeContains(panel.describePreview(), expected("Select an extension to view details", panelFile), "native empty inspector");
const previews: { kind: string; native: boolean }[] = [];
for (const [kind, heading] of [["prompt", "Prompt"], ["context-file", "Preview"], ["instruction", "Instruction"], ["rule", "Rule"], ["skill", "Instruction"], ["slash-command", "Template"]] as const) {
	const fixture = fixtures.find(item => item.kind === kind);
	if (!fixture) throw new Error(`Missing fixture ${kind}`);
	panel.setExtension(fixture);
	const ansi = Bun.stripANSI(panel.render(240).join("\n"));
	for (const value of [fixture.displayName, fixture.description, "Probe Provider", rawContent]) contains(ansi, value, `${kind} caller data`);
	contains(ansi, expected(heading, panelFile), `${kind} heading`);
	contains(ansi, expected("Origin:", panelFile), `${kind} origin caption`);
	if (panel.describePreview) {
		const native = panel.describePreview();
		nativeContains(native, expected(heading, panelFile), `${kind} native heading`);
		nativeContains(native, rawContent, `${kind} native content`);
	}
	previews.push({ kind, native: typeof panel.describePreview === "function" });
}
strictEqual(JSON.stringify(fixtures), before, "Display translation must not mutate original extension data");
strictEqual((globalThis as typeof globalThis & { __zhompExtensionInjected?: boolean }).__zhompExtensionInjected, false);
console.log(JSON.stringify({ component: "ExtensionDetails", mode, hostVersion: launch.host.version, supported: Object.fromEntries(supported), previews, search: "original English item and identity retained", toggles }));
