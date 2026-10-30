import { deepStrictEqual } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { parseDictionaryText } from "./dictionary-validation";

export interface LegacySurfaceFixture {
	launch: LaunchConfig;
	root: string;
	mode: "ordinary" | "translated" | "hostile";
	dictionary: Readonly<Record<string, string>>;
	load(specifier: string): Promise<unknown>;
	close(): void;
}

export async function loadLegacySurfaceFixture(): Promise<LegacySurfaceFixture> {
	const configPath = process.env.OMP_ZH_CONFIG;
	const root = process.env.PROBE_DIR;
	const mode = process.env.MENU_SURFACE_MODE;
	if (!configPath || !root || (mode !== "ordinary" && mode !== "translated" && mode !== "hostile")) {
		throw new Error("Legacy surface probe needs an installed launch config, isolated root and language mode");
	}
	const installDir = dirname(configPath);
	const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as { readLaunchConfig(path: string): LaunchConfig };
	const launch = hostApi.readLaunchConfig(configPath);
	const original = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
	const dictionary = mode === "hostile" ? { ...original, Settings: "恶意设置值", "Agent Hub": "恶意代理标题", high: "恶意high值", id: "恶意ID值" } : original;
	const dictPath = mode === "hostile" ? join(root, "legacy-hostile-dictionary.json") : launch.dictPath;
	if (mode === "hostile") writeFileSync(dictPath, JSON.stringify(dictionary));
	process.env.OMP_ZH_CONFIG = configPath;
	process.env.OMP_ZH_DICT = dictPath;
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
	const extension = await import(pathToFileURL(launch.extensionPath).href) as { preparePreloadDisplayTranslations(config: LaunchConfig, path: string): Promise<void> };
	await extension.preparePreloadDisplayTranslations(launch, configPath);
	const load = async (specifier: string): Promise<unknown> => import(pathToFileURL(Bun.resolveSync(specifier, launch.host.packageDir)).href);
	const settings = await load("@oh-my-pi/pi-coding-agent/config/settings") as {
		Settings: { init(options: { cwd: string; agentDir: string; inMemory: true; readOnly: true }): Promise<unknown> };
		resetSettingsForTest(): void;
	};
	await settings.Settings.init({ cwd: root, agentDir: root, inMemory: true, readOnly: true });
	const theme = await load("@oh-my-pi/pi-tui/theme/theme") as { initThemeSync(preset: string): void };
	theme.initThemeSync("unicode");
	if (mode !== "ordinary") {
		const loader = await load("@oh-my-pi/pi-coding-agent/extensibility/extensions/loader") as {
			loadExtensions(paths: string[], cwd: string): Promise<{ errors: readonly unknown[]; extensions: readonly unknown[] }>;
		};
		const loaded = await loader.loadExtensions([launch.extensionPath], root);
		deepStrictEqual(loaded.errors, [], "The installed legacy extension must bind before its UI is exercised");
	}
	return { launch, root, mode, dictionary, load, close() { settings.resetSettingsForTest(); } };
}
