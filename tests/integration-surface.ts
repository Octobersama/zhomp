import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import type { LaunchConfig } from "../runtime/host";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface SlashSuggestion {
	value: string;
	label: string;
	description?: string;
	icon?: string;
	iconName?: string;
	nativeDetail?: string;
	state?: string;
	hint?: string;
}

interface TuiBuiltinCommand {
	name: string;
	description?: string;
	aliases?: readonly string[];
	icon?: string;
	iconName?: string;
	argumentHint?: string;
	allowArgs?: boolean;
	subcommands?: readonly { name: string; description: string }[];
	getArgumentCompletions?: (prefix: string) => SlashSuggestion[] | null | Promise<SlashSuggestion[] | null>;
}

interface InternalBuiltinCommand {
	name: string;
	description: string;
	aliases?: readonly string[];
	subcommands?: readonly { name: string; description: string }[];
	handleTui?: unknown;
}

interface HostSlashRegistry {
	BUILTIN_SLASH_COMMAND_DEFS: readonly TuiBuiltinCommand[];
	BUILTIN_SLASH_COMMANDS: readonly TuiBuiltinCommand[];
	BUILTIN_SLASH_COMMANDS_INTERNAL: readonly InternalBuiltinCommand[];
}

interface SlashCompletionResult {
	items: SlashSuggestion[];
	prefix: string;
}

interface CombinedAutocompleteProvider {
	getSuggestions(lines: string[], cursorLine: number, cursorCol: number): Promise<SlashCompletionResult | null>;
	trySyncSlashCompletion(textBeforeCursor: string): SlashCompletionResult | null;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: SlashSuggestion,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
}

interface CombinedAutocompleteApi {
	CombinedAutocompleteProvider: new (commands: TuiBuiltinCommand[], basePath: string) => CombinedAutocompleteProvider;
}

interface InstalledExtensionApi {
	wrapSlashCommandAutocomplete(current: unknown, definitions: unknown, dictionary: unknown): unknown;
	default(api: unknown): Promise<void>;
}

interface HostFileSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
	source: string;
}

interface HostSlashCommandLoader {
	loadSlashCommands(options: {
		cwd: string;
		extensionRoots: {
			explicit: readonly string[];
			mode: "merge" | "explicit-only";
			configured: readonly string[];
			configuredLevel: "user" | "project";
		};
	}): Promise<HostFileSlashCommand[]>;
}

interface HostCustomCommand {
	name: string;
	description: string;
	getArgumentCompletions?: (prefix: string, cwd: string) => SlashSuggestion[] | null | Promise<SlashSuggestion[] | null>;
}

interface HostCustomCommandModule {
	GreenCommand: new (api: { cwd: string }) => HostCustomCommand;
	ReviewCommand: new (api: { cwd: string }) => HostCustomCommand;
	AnnotateCommand: new (api: { cwd: string }) => HostCustomCommand;
}

function isAutocompleteProvider(value: unknown): value is CombinedAutocompleteProvider {
	return (
		typeof value === "object" &&
		value !== null &&
		"getSuggestions" in value &&
		typeof value.getSuggestions === "function" &&
		"trySyncSlashCompletion" in value &&
		typeof value.trySyncSlashCompletion === "function" &&
		"applyCompletion" in value &&
		typeof value.applyCompletion === "function"
	);
}

function requireAutocompleteProvider(value: unknown): CombinedAutocompleteProvider {
	if (!isAutocompleteProvider(value)) throw new Error("Installed slash wrapper returned an invalid autocomplete provider");
	return value;
}

function assertSameSlashSelection(base: SlashCompletionResult, wrapped: SlashCompletionResult): void {
	strictEqual(wrapped.prefix, base.prefix);
	deepStrictEqual(
		wrapped.items.map(item => ({
			value: item.value,
			label: item.label,
			icon: item.icon,
			iconName: item.iconName,
			state: item.state,
			hint: item.hint,
		})),
		base.items.map(item => ({
			value: item.value,
			label: item.label,
			icon: item.icon,
			iconName: item.iconName,
			state: item.state,
			hint: item.hint,
		})),
	);
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
	ok(host.slashCommandsPath, "real host must expose its builtin slash registry");
	const slashRegistry = (await import(pathToFileURL(host.slashCommandsPath ?? "").href)) as HostSlashRegistry;
	const internalGoal = slashRegistry.BUILTIN_SLASH_COMMANDS_INTERNAL.find(command => command.name === "goal");
	const tuiGoal = slashRegistry.BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "goal");
	ok(internalGoal && tuiGoal, "real registry must expose /goal descriptors");
	const goalDescription = "Toggle goal mode (persistent autonomous objective for this session)";
	const goalSetDescription = "Set or replace the goal";
	const dictionary = JSON.parse(readFileSync(launch.dictPath, "utf8")) as Record<string, string>;
	// The extension entrypoint is selected by launch.json; a source import would bypass the installed surface.
	const installedExtension = (await import(pathToFileURL(extensionPath).href)) as InstalledExtensionApi;

	// The ordinary OMP process must ignore even an inherited enable flag for another PID.
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = "-1";
	const disabledLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(disabledLoad.errors, [], "ordinary process extension loading must succeed");
	strictEqual(ui.createSettingsHost().entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "Dark Theme");
	strictEqual(tuiGoal.description, goalDescription, "a mismatched PID must keep canonical slash descriptions in English");
	process.env.OMP_ZH_PROCESS_ID = String(process.pid);
	const translatedLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(translatedLoad.errors, [], "real extension loader must bind the installed extension");
	strictEqual(translatedLoad.extensions.length, 1);
	const after = ui.createSettingsHost();
	strictEqual(after.entries.find((entry: { path: string }) => entry.path === dark.path)?.ui.label, "深色主题");
	strictEqual(tuiGoal.description, goalDescription, "TUI autocomplete localization must not mutate canonical builtin metadata");
	strictEqual(internalGoal.description, goalDescription, "ACP/RPC canonical builtin metadata remains English");
	strictEqual(tuiGoal.subcommands?.find(command => command.name === "set")?.description, goalSetDescription);
	strictEqual(internalGoal.subcommands?.find(command => command.name === "set")?.description, goalSetDescription);

	const autocompletePath = Bun.resolveSync("@oh-my-pi/pi-tui/autocomplete", host.packageDir);
	const autocomplete = (await import(pathToFileURL(autocompletePath).href)) as CombinedAutocompleteApi;
	const tuiCommands = [...slashRegistry.BUILTIN_SLASH_COMMANDS];
	const baseProvider = new autocomplete.CombinedAutocompleteProvider(tuiCommands, root);
	const translatedProvider = requireAutocompleteProvider(
		installedExtension.wrapSlashCommandAutocomplete(baseProvider, slashRegistry.BUILTIN_SLASH_COMMAND_DEFS, dictionary),
	);
	const baseSettingsRows = await baseProvider.getSuggestions(["/settings"], 0, "/settings".length);
	const settingsRows = await translatedProvider.getSuggestions(["/settings"], 0, "/settings".length);
	if (!baseSettingsRows || !settingsRows) throw new Error("the actual host provider must return /settings rows");
	assertSameSlashSelection(baseSettingsRows, settingsRows);
	const settingsRow = settingsRows.items.find(item => item.value === "settings");
	ok(settingsRow, "real slash autocomplete must retain the /settings selection value");
	strictEqual(settingsRow.description, dictionary["Open settings menu"]);

	const goalInput = "/goal s";
	const baseGoalRows = await baseProvider.getSuggestions([goalInput], 0, goalInput.length);
	const goalRows = await translatedProvider.getSuggestions([goalInput], 0, goalInput.length);
	if (!baseGoalRows || !goalRows) throw new Error("the actual host provider must return /goal argument rows");
	assertSameSlashSelection(baseGoalRows, goalRows);
	const setRow = goalRows.items.find(item => item.value === "set ");
	ok(setRow, "real /goal argument autocomplete must retain the canonical set value and acceptance space");
	strictEqual(setRow.description, dictionary[goalSetDescription]);

	const baseSet = baseProvider.trySyncSlashCompletion("/set");
	const translatedSet = translatedProvider.trySyncSlashCompletion("/set");
	if (!baseSet || !translatedSet) throw new Error("the actual host provider must return synchronous /set candidates");
	assertSameSlashSelection(baseSet, translatedSet);
	strictEqual(translatedSet.items.find(item => item.value === "settings")?.description, dictionary["Open settings menu"]);
	const baseAlias = baseProvider.trySyncSlashCompletion("/models");
	const translatedAlias = translatedProvider.trySyncSlashCompletion("/models");
	if (!baseAlias || !translatedAlias) throw new Error("the actual host provider must retain the /models alias");
	assertSameSlashSelection(baseAlias, translatedAlias);
	strictEqual(translatedAlias.items.find(item => item.value === "models")?.description, dictionary["Switch model for this session"]);

	const slashLoader = (await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/slash-commands", host.packageDir)).href)) as HostSlashCommandLoader;
	const fileCommands = await slashLoader.loadSlashCommands({
		cwd: root,
		extensionRoots: { explicit: [], mode: "explicit-only", configured: [], configuredLevel: "user" },
	});
	const init = fileCommands.find(command => command.name === "init" && command.source === "bundled");
	ok(init, "real host slash loader must expose its bundled /init command");
	const [greenModule, reviewModule, annotateModule] = (await Promise.all([
		import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/ci-green", host.packageDir)).href),
		import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/review", host.packageDir)).href),
		import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/annotate", host.packageDir)).href),
	])) as [HostCustomCommandModule, HostCustomCommandModule, HostCustomCommandModule];
	const fixedCommands: TuiBuiltinCommand[] = [
		...[greenModule.GreenCommand, reviewModule.ReviewCommand, annotateModule.AnnotateCommand].map(Command => {
			const command = new Command({ cwd: root });
			return {
				name: command.name,
				description: `${command.description} (bundled)`,
				iconName: "prompt",
				getArgumentCompletions: command.getArgumentCompletions
					? (prefix: string) => command.getArgumentCompletions?.(prefix, root) ?? null
					: undefined,
			};
		}),
		{ name: init.name, description: init.description, iconName: "prompt", argumentHint: init.argumentHint },
	];
	const fixedBaseProvider = new autocomplete.CombinedAutocompleteProvider([...tuiCommands, ...fixedCommands], root);
	const fixedTranslatedProvider = requireAutocompleteProvider(
		installedExtension.wrapSlashCommandAutocomplete(fixedBaseProvider, slashRegistry.BUILTIN_SLASH_COMMAND_DEFS, dictionary),
	);
	const baseInitRows = await fixedBaseProvider.getSuggestions(["/Generate"], 0, "/Generate".length);
	const initRows = await fixedTranslatedProvider.getSuggestions(["/Generate"], 0, "/Generate".length);
	if (!baseInitRows || !initRows) throw new Error("real /Generate autocomplete must return its bundled /init row");
	assertSameSlashSelection(baseInitRows, initRows);
	strictEqual(baseInitRows.items.find(item => item.value === "init")?.description, "Generate AGENTS.md for current codebase");
	strictEqual(initRows.items.find(item => item.value === "init")?.description, dictionary["Generate AGENTS.md for current codebase"]);
	const annotateInput = "/annotate ";
	const baseAnnotateRows = await fixedBaseProvider.getSuggestions([annotateInput], 0, annotateInput.length);
	const annotateRows = await fixedTranslatedProvider.getSuggestions([annotateInput], 0, annotateInput.length);
	if (!baseAnnotateRows || !annotateRows) throw new Error("real /annotate autocomplete must return argument rows");
	assertSameSlashSelection(baseAnnotateRows, annotateRows);
	strictEqual(annotateRows.items.find(item => item.value === "last ")?.description, dictionary["Annotate the latest assistant reply"]);
	strictEqual(annotateRows.items.find(item => item.value === "session ")?.description, dictionary["Annotate a message or code block from this session"]);

	// Exercise the installed extension's session_start factory with a real source-aware /goal collision.
	let sessionStart: ((event: unknown, context: unknown) => void) | undefined;
	const extensionApi = {
		getCommands() {
			return [{ name: "goal", description: goalDescription, source: "prompt", location: "project" }];
		},
		on(event: string, handler: (event: unknown, context: unknown) => void) {
			if (event === "session_start") sessionStart = handler;
		},
	};
	await installedExtension.default(extensionApi);
	if (!sessionStart) throw new Error("The installed extension did not register its session_start callback");
	let registeredFactory: ((current: unknown) => unknown) | undefined;
	const factoryUi = {
		addAutocompleteProvider(factory: (current: unknown) => unknown) {
			registeredFactory = factory;
		},
	};
	sessionStart({}, { ui: factoryUi });
	if (!registeredFactory) throw new Error("The session_start callback did not register an autocomplete factory");
	const collisionBase = new autocomplete.CombinedAutocompleteProvider(tuiCommands, root);
	const collisionWrapped = requireAutocompleteProvider(registeredFactory(collisionBase));
	const collisionRows = collisionWrapped.trySyncSlashCompletion("/goal");
	ok(collisionRows, "the registered autocomplete factory must preserve the /goal command");
	strictEqual(collisionRows.items.find(item => item.value === "goal")?.description, goalDescription);
	const directRows = translatedProvider.trySyncSlashCompletion("/goal");
	ok(directRows, "the public wrapper must return the /goal row without source exclusions");
	strictEqual(directRows.items.find(item => item.value === "goal")?.description, dictionary[goalDescription]);
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
