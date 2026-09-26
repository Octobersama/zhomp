import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const packageDir = process.env.OMP_ZH_PACKAGE_DIR;
const tuiDir = process.env.OMP_ZH_TUI_PACKAGE_DIR;
const root = process.env.PROBE_DIR;
const extensionPath = process.env.PROBE_EXTENSION;
if (!packageDir || !tuiDir || !root || !extensionPath) throw new Error("Missing real-host probe paths");

// All module roots belong to the runtime-selected, validated host installation.
const settingsModule = await import(pathToFileURL(join(packageDir, "src/config/settings.ts")).href);
await settingsModule.Settings.init({ cwd: root, agentDir: root, inMemory: true, readOnly: true });
try {
const ui = await import(pathToFileURL(join(packageDir, "src/config/settings-ui.ts")).href);
const all = await import(pathToFileURL(join(packageDir, "src/config/all-settings.ts")).href);
const defs = await import(pathToFileURL(join(tuiDir, "src/overlays/settings-defs.ts")).href);
const before = ui.createSettingsHost();
ok(before.entries.length > 0, "real settings registry must be populated");
const dark = before.entries.find((entry: { ui?: { label: string } }) => entry.ui?.label === "Dark Theme");
ok(dark, "real host must expose Dark Theme");
const settings = all.orderedSettings();
const logicalBefore = settings.map((setting: { id: string; default: unknown; enumValues: unknown }) => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues }));
const groupArrays: Record<string, string[]> = { ...defs.TAB_GROUPS };
const appearanceGroupsBefore = [...groupArrays.appearance];
const loader = await import(pathToFileURL(join(packageDir, "src/extensibility/extensions/loader.ts")).href);

// The ordinary OMP process must ignore even an inherited enable flag for another PID.
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = "-1";
const disabledLoad = await loader.loadExtensions([extensionPath], root);
deepStrictEqual(disabledLoad.errors, [], "ordinary process extension loading must succeed");
strictEqual(ui.createSettingsHost().entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "Dark Theme");
process.env.OMP_ZH_PROCESS_ID = String(process.pid);
const translatedLoad = await loader.loadExtensions([extensionPath], root);
deepStrictEqual(translatedLoad.errors, [], "real extension loader must bind the installed extension");
strictEqual(translatedLoad.extensions.length, 1);
const after = ui.createSettingsHost();
strictEqual(after.entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "深色主题");
deepStrictEqual(settings.map((setting: { id: string; default: unknown; enumValues: unknown }) => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues })), logicalBefore);
for (const [tab, array] of Object.entries(groupArrays)) strictEqual(defs.TAB_GROUPS[tab], array);
const themeIndex = appearanceGroupsBefore.indexOf("Theme");
if (themeIndex >= 0) strictEqual(defs.TAB_GROUPS.appearance[themeIndex], "主题");
const repeatedLoad = await loader.loadExtensions([extensionPath], root);
deepStrictEqual(repeatedLoad.errors, []);
strictEqual(ui.createSettingsHost().entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "深色主题");

const theme = await import(pathToFileURL(join(tuiDir, "src/theme/theme.ts")).href);
theme.initThemeSync();
const selector = await import(pathToFileURL(join(tuiDir, "src/overlays/settings-selector.ts")).href);
// The appearance tab never touches plugin managers; unexpected plugin access must fail.
const plugins = new Proxy({}, { get() { throw new Error("Unexpected plugin manager access in appearance render"); } });
const component = new selector.SettingsSelectorComponent({ settings: after, plugins, availableThinkingLevels: [], thinkingLevel: undefined, availableThemes: ["dark"], providers: [] }, {
	onChange() { throw new Error("Rendering must not change stored settings"); },
	onCancel() {},
});
const rendered = component.render(160).map((line: string) => Bun.stripANSI(line)).join("\n");
writeFileSync(join(root, "settings-render.txt"), rendered);
ok(rendered.includes("外观"), "real tab bar must contain translated Appearance");
ok(rendered.includes("深色主题"), "real settings list must contain translated Dark Theme");
console.log(JSON.stringify({ entries: after.entries.length, loader: true, rendered: true, label: "深色主题" }));
} finally {
	// ExtensionRuntime owns maps only until bound to a session. This probe never
	// starts a session or registers callbacks; the settings singleton owns timers.
	settingsModule.resetSettingsForTest();
}
