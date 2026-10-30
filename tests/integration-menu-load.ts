import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import type { MenuModule } from "../runtime/menu-catalog";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledMenuApi {
	MENU_MODULES: readonly MenuModule[];
}

interface InstalledSourceApi {
	translateMenuSource(source: string, module: MenuModule, dictionary: Readonly<Record<string, string>>): { source: string; supported: boolean };
}

const configPath = process.env.OMP_ZH_CONFIG;
if (!configPath) throw new Error("OMP_ZH_CONFIG must select an installed launch config");
const installDir = dirname(configPath);
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as { readLaunchConfig(path: string): LaunchConfig };
const launch = hostApi.readLaunchConfig(configPath);
const dictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
const catalogue = await import(pathToFileURL(join(installDir, "menu-catalog.ts")).href) as InstalledMenuApi;
const translator = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as InstalledSourceApi;
const roots: Record<MenuModule["root"], string> = { agent: launch.host.packageDir, tui: launch.host.tuiDir };
const supported: string[] = [];
const unsupported: string[] = [];
type AnchorFailure = { before: string; expected: number; actual: number };
const sourceFailures: { module: string; anchors: AnchorFailure[]; variants: AnchorFailure[][] }[] = [];
const absent: string[] = [];
const paths: string[] = [];
const identities = new Set<string>();
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
const syntaxFailures: { module: string; error: string }[] = [];
for (const module of catalogue.MENU_MODULES) {
	const identity = `${module.root}:${module.path}`;
	strictEqual(identities.has(identity), false, `Multiple catalogue owners for ${identity}`);
	identities.add(identity);
	const path = join(roots[module.root], module.path);
	if (!existsSync(path)) {
		absent.push(identity);
		continue;
	}
	paths.push(path);
	const source = readFileSync(path, "utf8");
	const result = translator.translateMenuSource(source, module, dictionary);
	if (result.supported) {
		supported.push(identity);
		try { transpiler.transformSync(result.source); }
		catch (error) { syntaxFailures.push({ module: identity, error: error instanceof AggregateError ? error.errors.map(String).join("\n") : String(error) }); }
	}
	else {
		unsupported.push(identity);
		const failures = (patches: MenuModule["patches"]): AnchorFailure[] => patches.flatMap(patch => {
			const actual = source.split(patch.before).length - 1;
			const expected = patch.count ?? 1;
			return actual === expected ? [] : [{ before: patch.before, expected, actual }];
		});
		sourceFailures.push({ module: identity, anchors: failures(module.patches), variants: (module.variants ?? []).map(failures) });
		strictEqual(result.source, source, `Unsupported source was partially translated: ${identity}`);
	}
}
deepStrictEqual(syntaxFailures, [], "Generated interface modules must compile before any host module is imported");
if (process.env.MENU_CATALOG_REQUIRE_ALL === "1") {
	deepStrictEqual(absent, [], "The current adaptation target must expose every catalogued module");
	deepStrictEqual(unsupported, [], `The current adaptation target must accept every exact menu source shape: ${JSON.stringify(sourceFailures)}`);
}

process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = String(process.pid);
process.env.OMP_ZH_DICT = launch.dictPath;
const diagnosticMessages: string[] = [];
const diagnostics = await import(pathToFileURL(join(installDir, "diagnostics.ts")).href) as {
	setDiagnosticReporter(report: (message: string) => void): void;
};
diagnostics.setDiagnosticReporter(message => { diagnosticMessages.push(message); });
const extension = await import(pathToFileURL(launch.extensionPath).href) as {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
};
await extension.preparePreloadDisplayTranslations(launch, configPath);
const loaded: string[] = [];
for (const path of paths) {
	await import(pathToFileURL(path).href);
	loaded.push(path);
}
deepStrictEqual(diagnosticMessages, [], "Actual installed menu imports must not emit transformation errors");
console.log(JSON.stringify({ component: "MenuCatalogue", hostVersion: launch.host.version, supported, unsupported, absent, loaded: loaded.length, diagnostics: diagnosticMessages }));
