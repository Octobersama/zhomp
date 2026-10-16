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
	preparePreloadDisplayTranslations(launchConfig: LaunchConfig, configPath: string): Promise<void>;
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

interface HostSetting {
	id: string;
	default: unknown;
	enumValues: unknown;
	envName?: string;
	envValue(): unknown;
	ui?: { label?: string; description?: string };
}

interface SettingsSurfaceEntry {
	path: string;
	defaultValue: unknown;
	ui?: { label?: string; description?: string };
}

interface SettingsSurfaceHost {
	entries: readonly SettingsSurfaceEntry[];
	get(path: string): unknown;
}

interface SettingsUiModule {
	createSettingsHost(): SettingsSurfaceHost;
}

interface ThemeModule {
	initThemeSync(preset: "ascii" | "unicode" | "nerd"): void;
}

interface KeyHintModule {
	formatKeyHint(key: string): string;
	formatKeyHints(keys: readonly string[]): string;
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

function renderDictionaryTemplate(dictionary: Record<string, string>, key: string, values: Record<string, string>): string {
	const translated = dictionary[key];
	if (typeof translated !== "string" || translated.length === 0) throw new Error(`Missing settings template translation: ${key}`);
	let result = translated;
	for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, () => value);
	return result;
}

const getterDescriptionTemplateKeys: Record<string, string> = {
	"tui.codexResetFireworks": "Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until {escape}",
	"tui.mouse": "Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes {shift}+drag and wheel scroll becomes {shift}+wheel while on",
	"tui.vimMode": "Modal prompt editing. {escape} leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
	"composer.recallClearedDrafts": "Keep drafts cleared with {ctrlC} in local {upDown} history until exit; disabling affects future clears",
	doubleEscapeAction: "What pressing {escape} twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing",
	"spelling.autocomplete": "Show predicted word completions as inline hints: {tab} accepts with a space, {right} without",
	"composer.predictions": "After a completed turn, ask the active model to predict your next message and show it as ghost text in the empty composer; {tab} or {right} inserts it without sending. Extra usage: every completed turn sends one more billed request over the whole conversation (counted in /stats)",
	"retry.waitForUsageReset": "When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable ({escape}) but also hold subagents, so leave off for unattended runs.",
};

const fallbackEnvNoteTemplate = "Unset, it falls back to ${envName}.";
const overrideEnvNoteTemplate = "${envName} overrides this setting while it is set.";

const configPath = process.env.OMP_ZH_CONFIG;
const root = process.env.PROBE_DIR;
if (!configPath || !root) throw new Error("Missing installed launch config or probe directory");

// These modules must resolve from the host selected by the installed launch.json, not the repository copy.
const installedHostPath = join(dirname(configPath), "host.ts");
const installedHost = await import(pathToFileURL(installedHostPath).href) as InstalledHostApi;
const launch: LaunchConfig = installedHost.readLaunchConfig(configPath);
const { host, extensionPath } = launch;
// Match launch.ts: register source hooks before any selected-host module can cache settings-ui.
const installedExtension = (await import(pathToFileURL(extensionPath).href)) as InstalledExtensionApi;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = String(process.pid);
await installedExtension.preparePreloadDisplayTranslations(launch, configPath);
const settingsModule = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-coding-agent/config/settings", host.packageDir)).href);
try {
	const all = await import(pathToFileURL(host.allSettingsPath).href);
	const settings = all.orderedSettings() as HostSetting[];
	for (const setting of settings) {
		if (typeof setting.envName === "string") delete process.env[setting.envName];
	}
	const overrideEnvName = "PI_NO_THINKING_LOOP_GUARD";
	const overrideEnvValue = "1";
	const fallbackEnvName = "SEARXNG_ENDPOINT";
	const fallbackEnvValue = "https://searxng-fixture.invalid";
	process.env[overrideEnvName] = overrideEnvValue;
	process.env[fallbackEnvName] = fallbackEnvValue;
	await settingsModule.Settings.init({ cwd: root, agentDir: root, inMemory: true, readOnly: true });
	const defs = await import(pathToFileURL(host.settingsDefsPath).href);
	const theme = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", host.packageDir)).href) as ThemeModule;
	const keyHints = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-tui/key-hint-format", host.packageDir)).href) as KeyHintModule;
	theme.initThemeSync("unicode");
	const dark = settings.find(setting => setting.ui?.label === "Dark Theme");
	const dynamic = settings.find(setting => setting.id === "tui.codexResetFireworks");
	if (!dark || !dynamic || typeof dynamic.ui?.description !== "string") throw new Error("real settings registry is missing expected metadata");
	const rawDynamicDescription = dynamic.ui.description;
	const loopGuard = settings.find(setting => setting.id === "model.loopGuard.enabled");
	const searchEndpoint = settings.find(setting => setting.id === "searxng.endpoint");
	if (!loopGuard || !searchEndpoint || typeof loopGuard.ui?.description !== "string" || typeof searchEndpoint.ui?.description !== "string") {
		throw new Error("real settings registry is missing the harmless environment fixtures");
	}
	const loopGuardSourceDescription = loopGuard.ui.description;
	const searchEndpointSourceDescription = searchEndpoint.ui.description;
	const logicalBefore = settings.map(setting => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues }));
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

	// The factory must ignore another PID even after this process's authorized preload registration.
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = "-1";
	const disabledLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(disabledLoad.errors, [], "ordinary process extension loading must succeed");
	strictEqual(dark.ui?.label, "Dark Theme");
	strictEqual(dynamic.ui?.description, rawDynamicDescription);
	strictEqual(tuiGoal.description, goalDescription, "a mismatched PID must keep canonical slash descriptions in English");
	process.env.OMP_ZH_PROCESS_ID = String(process.pid);
	const translatedLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(translatedLoad.errors, [], "real extension loader must bind the installed extension");
	strictEqual(translatedLoad.extensions.length, 1);
	const ui = await import(pathToFileURL(host.settingsUiPath).href) as SettingsUiModule;
	const expectedOverrideDescription = `${dictionary[loopGuardSourceDescription] ?? loopGuardSourceDescription} ${renderDictionaryTemplate(dictionary, overrideEnvNoteTemplate, { envName: overrideEnvName })}`;
	const expectedFallbackDescription = `${dictionary[searchEndpointSourceDescription] ?? searchEndpointSourceDescription} ${renderDictionaryTemplate(dictionary, fallbackEnvNoteTemplate, { envName: fallbackEnvName })}`;
	let after: SettingsSurfaceHost | undefined;
	for (const preset of ["ascii", "unicode", "nerd"] as const) {
		theme.initThemeSync(preset);
		const descriptionCaptures = {
			escape: keyHints.formatKeyHint("escape"),
			shift: keyHints.formatKeyHint("shift"),
			ctrlC: keyHints.formatKeyHint("ctrl+c"),
			upDown: keyHints.formatKeyHints(["up", "down"]),
			tab: keyHints.formatKeyHint("tab"),
			right: keyHints.formatKeyHint("right"),
		};
		const surface = ui.createSettingsHost();
		ok(surface.entries.length > 0, "the real initialized settings host must produce entries");
		for (const [path, templateKey] of Object.entries(getterDescriptionTemplateKeys)) {
			const entry = surface.entries.find(candidate => candidate.path === path);
			if (!entry || typeof entry.ui?.description !== "string") throw new Error(`Missing real settings description: ${path}`);
			strictEqual(entry.ui.description, renderDictionaryTemplate(dictionary, templateKey, descriptionCaptures), `${preset} ${path} description`);
		}
		const overrideEntry: SettingsSurfaceEntry | undefined = surface.entries.find(entry => entry.path === loopGuard.id);
		const fallbackEntry: SettingsSurfaceEntry | undefined = surface.entries.find(entry => entry.path === searchEndpoint.id);
		strictEqual(overrideEntry?.ui?.description, expectedOverrideDescription, `${preset} override env note`);
		strictEqual(fallbackEntry?.ui?.description, expectedFallbackDescription, `${preset} fallback env note`);
		ok(overrideEntry?.ui?.description?.includes(`$${overrideEnvName}`), `${preset} override env name must keep its dollar prefix`);
		ok(fallbackEntry?.ui?.description?.includes(`$${fallbackEnvName}`), `${preset} fallback env name must keep its dollar prefix`);
		if (preset === "unicode") after = surface;
	}
	if (!after) throw new Error("Unicode settings surface was not captured");
	strictEqual(after.entries.find(entry => entry.path === dark.id)?.ui?.label, "深色主题");
	strictEqual(tuiGoal.description, goalDescription, "TUI autocomplete localization must not mutate canonical builtin metadata");
	strictEqual(internalGoal.description, goalDescription, "ACP/RPC canonical builtin metadata remains English");
	strictEqual(tuiGoal.subcommands?.find(command => command.name === "set")?.description, goalSetDescription);
	strictEqual(internalGoal.subcommands?.find(command => command.name === "set")?.description, goalSetDescription);
	strictEqual(loopGuard.envName, overrideEnvName);
	strictEqual(searchEndpoint.envName, fallbackEnvName);
	strictEqual(loopGuard.envValue(), false);
	strictEqual(searchEndpoint.envValue(), fallbackEnvValue);
	strictEqual(after.get(loopGuard.id), loopGuard.default, "the env override must not change the settings layer value");
	strictEqual(after.get(searchEndpoint.id), searchEndpoint.default, "the env fallback must not change the settings layer value");
	strictEqual(process.env[overrideEnvName], overrideEnvValue);
	strictEqual(process.env[fallbackEnvName], fallbackEnvValue);

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

	// Drive the installed extension's session-start provider factory into the real host autocomplete provider.
	const sessionStartHandlers: Array<(event: unknown, context: unknown) => void> = [];
	const sessionShutdownHandlers: Array<(event: unknown, context: unknown) => void> = [];
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	let commandMetadata: unknown = [{ name: "goal", description: goalDescription, source: "prompt", location: "project" }];
	const extensionApi = {
		getCommands() {
			return commandMetadata;
		},
		on(event: string, handler: (event: unknown, context: unknown) => void) {
			if (event === "session_start") sessionStartHandlers.push(handler);
			if (event === "session_shutdown") sessionShutdownHandlers.push(handler);
		},
	};
	await installedExtension.default(extensionApi);
	if (sessionStartHandlers.length < 2) throw new Error("The installed extension did not register its diagnostic and slash session_start callbacks");
	let registeredFactory: ((current: unknown) => unknown) | undefined;
	const factoryUi = {
		addAutocompleteProvider(factory: (current: unknown) => unknown) {
			registeredFactory = factory;
		},
		notify(message: string, type?: "info" | "warning" | "error") {
			notifications.push({ message, type });
		},
	};
	const uiContext = { hasUI: true, ui: factoryUi };
	for (const handler of sessionStartHandlers) handler({}, uiContext);
	if (!registeredFactory) throw new Error("The session_start callback did not register an autocomplete factory");
	strictEqual(notifications.length, 0, "normal startup and lazy registration should not notify about success");
	const registeredBase = new autocomplete.CombinedAutocompleteProvider(tuiCommands, root);
	const registeredWrapped = requireAutocompleteProvider(registeredFactory(registeredBase));
	const baseRegisteredSet = registeredBase.trySyncSlashCompletion("/set");
	const registeredSet = registeredWrapped.trySyncSlashCompletion("/set");
	if (!baseRegisteredSet || !registeredSet) throw new Error("The installed lazy provider must surface /settings candidates");
	assertSameSlashSelection(baseRegisteredSet, registeredSet);
	const registeredSettings = registeredSet.items.find(item => item.value === "settings");
	ok(registeredSettings, "the installed lazy provider must retain the /settings selection");
	strictEqual(registeredSettings.description, dictionary["Open settings menu"]);
	const appliedSettings = registeredWrapped.applyCompletion(
		["/set"],
		0,
		"/set".length,
		registeredSettings,
		registeredSet.prefix,
	);
	deepStrictEqual(appliedSettings.lines, ["/settings "], "the translated display row must keep the host selection identity");
	const collisionRows = registeredWrapped.trySyncSlashCompletion("/goal");
	ok(collisionRows, "the registered autocomplete factory must preserve the /goal command");
	strictEqual(collisionRows.items.find(item => item.value === "goal")?.description, goalDescription);
	const directRows = translatedProvider.trySyncSlashCompletion("/goal");
	ok(directRows, "the public wrapper must return the /goal row without source exclusions");
	strictEqual(directRows.items.find(item => item.value === "goal")?.description, dictionary[goalDescription]);
	commandMetadata = null;
	strictEqual(registeredFactory(registeredBase), registeredBase, "a failed host metadata lookup must leave the provider usable");
	strictEqual(notifications.length, 1, "a provider-factory validation failure must reach the host notification surface");
	strictEqual(notifications[0]?.type, "error");
	ok(notifications[0]?.message.includes("Extension getCommands metadata is unavailable"));
	for (const handler of sessionShutdownHandlers) handler({}, uiContext);
	const translatedDynamic = after.entries.find(entry => entry.path === dynamic.id);
	if (!translatedDynamic || typeof translatedDynamic.ui?.description !== "string") throw new Error("dynamic description must remain readable");
	ok(!translatedDynamic.ui.description.startsWith("Celebrate unscheduled"), "dynamic getter output was not translated");
	deepStrictEqual(settings.map(setting => ({ id: setting.id, default: setting.default, enumValues: setting.enumValues })), logicalBefore);
	for (const [tab, array] of Object.entries(groupArrays)) strictEqual(defs.TAB_GROUPS[tab], array);
	const themeIndex = appearanceGroupsBefore.indexOf("Theme");
	if (themeIndex >= 0) strictEqual(defs.TAB_GROUPS.appearance[themeIndex], "主题");
	const repeatedLoad = await loader.loadExtensions([extensionPath], root);
	deepStrictEqual(repeatedLoad.errors, []);
	strictEqual(ui.createSettingsHost().entries.find(entry => entry.path === dark.id)?.ui?.label, "深色主题");
	theme.initThemeSync("unicode");

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
	console.log(JSON.stringify({
		entries: after.entries.length,
		loader: true,
		component: "SettingsSelectorComponent",
		label: "深色主题",
		slash: {
			registered: true,
			description: registeredSettings.description,
			accepted: appliedSettings.lines[0],
			errorNotification: notifications[0]?.type === "error",
		},
	}));
} finally {
	settingsModule.resetSettingsForTest();
}
