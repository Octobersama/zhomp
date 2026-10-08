import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import type { LaunchConfig } from "../runtime/host";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

const configPath = process.env.OMP_ZH_CONFIG;
const root = process.env.PROBE_DIR;
if (!configPath || !root) throw new Error("Missing installed launch config or probe directory");

// These modules must resolve from the host selected by the installed launch.json, not the repository copy.
const installedHostPath = join(dirname(configPath), "host.ts");
const installedHost = await import(pathToFileURL(installedHostPath).href) as InstalledHostApi;
const launch: LaunchConfig = installedHost.readLaunchConfig(configPath);
const { host, extensionPath } = launch;
const settingsModule = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", host.packageDir)).href);
try {
	await settingsModule.Settings.init({ cwd: root, agentDir: root, inMemory: true, readOnly: true });
	const ui = await import(pathToFileURL(host.settingsUiPath).href);
	const all = await import(pathToFileURL(host.allSettingsPath).href);
	const defs = await import(pathToFileURL(host.settingsDefsPath).href);
	const before = ui.createSettingsHost();
	ok(before.entries.length > 0, "real settings registry must be populated");
	const dark = before.entries.find((entry: { ui?: { label: string } }) => entry.ui?.label === "Dark Theme");
	const dynamic = before.entries.find((entry: { path: string }) => entry.path === "tui.codexResetFireworks");
	ok(dynamic && typeof dynamic.ui?.description === "string", "real host must expose dynamic settings descriptions");
	ok(dark, "real host must expose Dark Theme");
	const settings = all.orderedSettings();
	const logicalBefore = settings.map((setting: { id: string; default: unknown; enumValues: unknown }) => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues }));
	const groupArrays: Record<string, string[]> = { ...defs.TAB_GROUPS };
	const appearanceGroupsBefore = [...groupArrays.appearance];
	const loader = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/extensions/loader", host.packageDir)).href);

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
	const translatedDynamic = after.entries.find((entry: { path: string }) => entry.path === dynamic.path);
	ok(translatedDynamic && typeof translatedDynamic.ui.description === "string", "dynamic description must remain readable");
	ok(!translatedDynamic.ui.description.startsWith("Celebrate unscheduled"), "dynamic getter output was not translated");
	deepStrictEqual(settings.map((setting: { id: string; default: unknown; enumValues: unknown }) => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues })), logicalBefore);
	for (const [tab, array] of Object.entries(groupArrays)) strictEqual(defs.TAB_GROUPS[tab], array);
	const themeIndex = appearanceGroupsBefore.indexOf("Theme");
	if (themeIndex >= 0) strictEqual(defs.TAB_GROUPS.appearance[themeIndex], "主题");
	const repeatedLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(repeatedLoad.errors, []);
	strictEqual(ui.createSettingsHost().entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "深色主题");

	const theme = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", host.packageDir)).href);
	theme.initThemeSync();
	const selector = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-tui/overlays/settings-selector", host.packageDir)).href);
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
	console.log(JSON.stringify({ entries: after.entries.length, loader: true, component: "SettingsSelectorComponent", label: "深色主题" }));
} finally {
	settingsModule.resetSettingsForTest();
}
