import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "bun:test";
import { discoverPackage } from "../scripts/install-core";
import { readSupportPolicy } from "../runtime/host";
import { wrapSlashCommandAutocomplete } from "../extensions/zhomp";
import type { Dictionary } from "../extensions/zhomp";

interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
	icon?: string;
	iconName?: string;
	nativeDetail?: string;
	state?: string;
	hint?: string;
}

type Awaitable<T> = T | Promise<T>;

interface SlashCommand {
	name: string;
	description?: string;
	aliases?: readonly string[];
	icon?: string;
	iconName?: string;
	argumentHint?: string;
	allowArgs?: boolean;
	subcommands?: readonly { name: string; description: string; usage?: string }[];
	getArgumentCompletions?: (argumentPrefix: string) => Awaitable<AutocompleteItem[] | null>;
	getAutocompleteDescription?: () => string | undefined;
	getInlineHint?: (argumentText: string) => string | null;
}

interface SlashDescription {
	name: string;
	description?: string;
	argumentHint?: string;
	subcommands?: readonly SlashDescription[];
	aliases?: readonly string[];
}

interface CompletionResult {
	items: AutocompleteItem[];
	prefix: string;
}

interface AppliedCompletion {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
	onApplied?: () => void;
}

interface AutocompleteProvider {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		signal?: AbortSignal,
		onPartial?: (suggestions: CompletionResult) => void,
	): Promise<CompletionResult | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): AppliedCompletion;
	getInlineHint?(lines: string[], cursorLine: number, cursorCol: number): string | null;
	trySyncSlashCompletion(textBeforeCursor: string): CompletionResult | null;
	trySyncInlineReplace?(textBeforeCursor: string): { replaceLen: number; insert: string } | null;
	getForceFileSuggestions?(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		signal?: AbortSignal,
	): Promise<CompletionResult | null>;
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

interface HostSlashRegistry {
	BUILTIN_SLASH_COMMAND_DEFS: readonly SlashDescription[];
	BUILTIN_SLASH_COMMANDS: readonly SlashCommand[];
	buildTuiBuiltinSlashCommands(runtime: ModelRuntimeFixture): readonly SlashCommand[];
}

interface HostAutocompleteApi {
	CombinedAutocompleteProvider: new (commands: SlashCommand[], basePath: string) => AutocompleteProvider;
}

interface ModelRuntimeFixture {
	ctx: {
		session: {
			model: { provider: string; id: string } | null;
		};
	};
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

interface BundledCommand {
	name: string;
	description: string;
	getArgumentCompletions?: (
		argumentPrefix: string,
		cwd: string,
	) => Awaitable<AutocompleteItem[] | null>;
}

interface BundledCommandModule {
	GreenCommand: new (api: { cwd: string }) => BundledCommand;
	ReviewCommand: new (api: { cwd: string }) => BundledCommand;
	AnnotateCommand: new (api: { cwd: string }) => BundledCommand;
}

interface RegisteredExtensionCommand {
	description?: string;
	getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
}

interface AutoresearchExtensionModule {
	createAutoresearchExtension(api: unknown): void;
}

const repoDir = dirname(import.meta.dir);
const host = discoverPackage(readSupportPolicy(repoDir).range);
const dictionary = JSON.parse(readFileSync(join(repoDir, "dict", "zh-CN.json"), "utf8")) as Dictionary;
const dynamicBuiltinDescriptionNames: Record<string, true> = { loop: true, switch: true, effort: true };

// Resolve modules from the detected installed host; a static import would bind the test runner to a different package copy.
function hostModule(specifier: string): string {
	return pathToFileURL(Bun.resolveSync(specifier, host.packageDir)).href;
}

function isAutocompleteProvider(value: unknown): value is AutocompleteProvider {
	return (
		typeof value === "object" &&
		value !== null &&
		"getSuggestions" in value &&
		typeof value.getSuggestions === "function" &&
		"applyCompletion" in value &&
		typeof value.applyCompletion === "function" &&
		"trySyncSlashCompletion" in value &&
		typeof value.trySyncSlashCompletion === "function"
	);
}

function requireAutocompleteProvider(value: unknown): AutocompleteProvider {
	if (!isAutocompleteProvider(value)) {
		throw new Error("The slash wrapper must return a usable autocomplete provider");
	}
	return value;
}


function wrapProvider(
	provider: AutocompleteProvider,
	definitions: readonly SlashDescription[],
): AutocompleteProvider {
	return requireAutocompleteProvider(wrapSlashCommandAutocomplete(provider, definitions, dictionary));
}

function collectStaticDescriptions(
	command: SlashDescription,
	path: string,
	output: Array<{ path: string; text: string }>,
	skipDynamicRootDescription: boolean,
): void {
	const description = command.description;
	if (typeof description === "string" && !skipDynamicRootDescription) {
		output.push({ path: `${path}.description`, text: description });
	}
	for (const [index, child] of (command.subcommands ?? []).entries()) {
		collectStaticDescriptions(child, `${path}.subcommands[${index}]`, output, false);
	}
}

function resultOrThrow(result: CompletionResult | null, source: string): CompletionResult {
	if (result === null) throw new Error(`The real autocomplete provider did not return ${source}`);
	return result;
}

function rowOrThrow(result: CompletionResult, value: string, source: string): AutocompleteItem {
	const row = result.items.find(item => item.value === value);
	if (!row) throw new Error(`The real autocomplete provider omitted ${source} (${value})`);
	return row;
}

function assertSameSelection(base: CompletionResult, wrapped: CompletionResult): void {
	strictEqual(wrapped.prefix, base.prefix, "display translation must preserve the host prefix");
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
		"display translation must preserve values, aliases, metadata, and ordering",
	);
}

async function loadHostAutocomplete(): Promise<{
	registry: HostSlashRegistry;
	autocomplete: HostAutocompleteApi;
}> {
	if (!host.slashCommandsPath) throw new Error("The selected OMP host does not expose its builtin slash registry");
	// Resolve the actual selected host registry and TUI class instead of local copies.
	const [registry, autocomplete] = await Promise.all([
		import(pathToFileURL(host.slashCommandsPath).href),
		import(hostModule("@oh-my-pi/pi-tui/autocomplete")),
	]);
	return {
		registry: registry as HostSlashRegistry,
		autocomplete: autocomplete as HostAutocompleteApi,
	};
}

function mapBundledCommand(command: BundledCommand, cwd: string): SlashCommand {
	const complete = command.getArgumentCompletions?.bind(command);
	return {
		name: command.name,
		description: `${command.description} (bundled)`,
		iconName: "prompt",
		...(complete && { getArgumentCompletions: (prefix: string) => complete(prefix, cwd) }),
	};
}

async function loadAutoresearchCommand(): Promise<SlashCommand> {
	const module = (await import(hostModule("@oh-my-pi/pi-coding-agent/autoresearch"))) as AutoresearchExtensionModule;
	const registrations = new Map<string, RegisteredExtensionCommand>();
	const api = new Proxy<Record<string, unknown>>(
		{},
		{
			get(_target, property) {
				if (property === "registerCommand") {
					return (name: string, command: RegisteredExtensionCommand): void => {
						registrations.set(name, command);
					};
				}
				return () => undefined;
			},
		},
	);
	// The public factory only registers metadata here; no command or event handler runs.
	module.createAutoresearchExtension(api);
	const command = registrations.get("autoresearch");
	if (!command) throw new Error("The real autoresearch extension did not register /autoresearch");
	return {
		name: "autoresearch",
		description: command.description ?? "(hook command)",
		iconName: "extension",
		getArgumentCompletions: command.getArgumentCompletions,
	};
}

// The public host loader parses bundled Markdown into FileSlashCommand records; it does not execute handlers.
async function loadFixedHostCommands(): Promise<SlashCommand[]> {
	const [slashLoader, customModules, autoresearchCommand] = await Promise.all([
		import(hostModule("@oh-my-pi/pi-coding-agent/extensibility/slash-commands")),
		Promise.all([
			import(hostModule("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/ci-green")),
			import(hostModule("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/review")),
			import(hostModule("@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/annotate")),
		]),
		loadAutoresearchCommand(),
	]);
	const fileCommands = await (slashLoader as HostSlashCommandLoader).loadSlashCommands({
		cwd: repoDir,
		extensionRoots: { explicit: [], mode: "explicit-only", configured: [], configuredLevel: "user" },
	});
	const init = fileCommands.find(command => command.name === "init" && command.source === "bundled");
	if (!init) throw new Error("The real host slash loader did not expose its bundled /init command");

	const api = { cwd: repoDir };
	const green = new (customModules[0] as BundledCommandModule).GreenCommand(api);
	const review = new (customModules[1] as BundledCommandModule).ReviewCommand(api);
	const annotate = new (customModules[2] as BundledCommandModule).AnnotateCommand(api);
	const initCommand: SlashCommand = {
		name: init.name,
		description: init.description,
		iconName: "prompt",
		argumentHint: init.argumentHint,
	};
	return [
		autoresearchCommand,
		mapBundledCommand(green, repoDir),
		mapBundledCommand(review, repoDir),
		mapBundledCommand(annotate, repoDir),
		initCommand,
	];
}

describe("builtin slash description translation", () => {
	test("covers every static description read from the selected host registry", async () => {
		const { registry } = await loadHostAutocomplete();
		const fields: Array<{ path: string; text: string }> = [];
		for (const command of registry.BUILTIN_SLASH_COMMAND_DEFS) {
			collectStaticDescriptions(command, `/${command.name}`, fields, Object.hasOwn(dynamicBuiltinDescriptionNames, command.name));
		}
		const missing = fields.filter(({ text }) => !Object.hasOwn(dictionary, text) || dictionary[text] === text);
		strictEqual(
			missing.length,
			0,
			`uncovered static builtin slash descriptions from the selected host:\n${missing.map(field => `${field.path}: ${field.text}`).join("\n")}`,
		);
	});

	test("real builtin command-name output translates every static registry description", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		const provider = new autocomplete.CombinedAutocompleteProvider([...registry.BUILTIN_SLASH_COMMANDS], repoDir);
		const wrapped = wrapProvider(provider, registry.BUILTIN_SLASH_COMMAND_DEFS);
		const base = resultOrThrow(provider.trySyncSlashCompletion("/"), "the builtin command list");
		const translated = resultOrThrow(wrapped.trySyncSlashCompletion("/"), "the wrapped builtin command list");
		assertSameSelection(base, translated);
		for (const baseRow of base.items) {
			const definition = registry.BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === baseRow.value);
			if (!definition) throw new Error(`The selected host registry omitted ${baseRow.value}`);
			const canonicalDescription = definition.description;
			if (typeof canonicalDescription !== "string") throw new Error(`/${definition.name} has no static builtin description`);
			if (Object.hasOwn(dynamicBuiltinDescriptionNames, definition.name)) continue;
			strictEqual(baseRow.description, canonicalDescription, `the real /${definition.name} item keeps its host description`);
			strictEqual(
				rowOrThrow(translated, baseRow.value, `/${definition.name} translated item`).description,
				dictionary[canonicalDescription],
				`the real /${definition.name} item displays its dictionary translation`,
			);
		}
	});

	test("real synchronous slash completion keeps canonical selection behavior and translates display text", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		class ObservedProvider extends autocomplete.CombinedAutocompleteProvider {
			lastItems: AutocompleteItem[] | undefined;
			appliedItem: AutocompleteItem | undefined;

			override trySyncSlashCompletion(textBeforeCursor: string): CompletionResult | null {
				const result = super.trySyncSlashCompletion(textBeforeCursor);
				this.lastItems = result?.items;
				return result;
			}

			override applyCompletion(
				lines: string[],
				cursorLine: number,
				cursorCol: number,
				item: AutocompleteItem,
				prefix: string,
			): AppliedCompletion {
				this.appliedItem = item;
				return super.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
		}
		const definitions = registry.BUILTIN_SLASH_COMMAND_DEFS;
		const settingsDescription = "Open settings menu";
		const provider = new ObservedProvider([...registry.BUILTIN_SLASH_COMMANDS], repoDir);
		const wrapped = wrapProvider(provider, definitions);

		const baseSet = resultOrThrow(provider.trySyncSlashCompletion("/set"), "/set candidates");
		const translatedSet = resultOrThrow(wrapped.trySyncSlashCompletion("/set"), "wrapped /set candidates");
		assertSameSelection(baseSet, translatedSet);
		strictEqual(rowOrThrow(translatedSet, "settings", "/settings").description, dictionary[settingsDescription]);
		const originalItem = provider.lastItems?.find(item => item.value === "settings");
		if (!originalItem) throw new Error("The host provider did not retain its original /settings autocomplete item");

		const baseAlias = resultOrThrow(provider.trySyncSlashCompletion("/models"), "/models alias");
		const translatedAlias = resultOrThrow(wrapped.trySyncSlashCompletion("/models"), "wrapped /models alias");
		assertSameSelection(baseAlias, translatedAlias);
		const aliasRow = rowOrThrow(translatedAlias, "models", "/models alias");
		strictEqual(aliasRow.label, "models");
		strictEqual(aliasRow.description, dictionary["Switch model for this session"]);

		const setItem = rowOrThrow(translatedSet, "settings", "/settings keyboard selection");
		const applied = wrapped.applyCompletion(["/set"], 0, "/set".length, setItem, translatedSet.prefix);
		strictEqual(provider.appliedItem, originalItem, "accepting a translated row must pass the original host item to applyCompletion");
		deepStrictEqual(applied.lines, ["/settings "], "keyboard acceptance must apply the original command value");
	});

	test("real asynchronous argument completion preserves value order and translates /goal set", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		const provider = new autocomplete.CombinedAutocompleteProvider([...registry.BUILTIN_SLASH_COMMANDS], repoDir);
		const wrapped = wrapProvider(provider, registry.BUILTIN_SLASH_COMMAND_DEFS);
		const input = "/goal s";
		const base = resultOrThrow(await provider.getSuggestions([input], 0, input.length), "/goal s");
		const translated = resultOrThrow(await wrapped.getSuggestions([input], 0, input.length), "wrapped /goal s");
		assertSameSelection(base, translated);
		strictEqual(rowOrThrow(translated, "set ", "/goal set argument").description, dictionary["Set or replace the goal"]);
	});

	test("real host fixed commands translate their parsed and registered descriptions", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		const fixedCommands = await loadFixedHostCommands();
		const provider = new autocomplete.CombinedAutocompleteProvider(
			[...registry.BUILTIN_SLASH_COMMANDS, ...fixedCommands],
			repoDir,
		);
		const wrapped = wrapProvider(provider, registry.BUILTIN_SLASH_COMMAND_DEFS);
		const descriptions = [
			{ input: "/Generate", value: "init", key: "Generate AGENTS.md for current codebase", suffix: "" },
			{
				input: "/gre",
				value: "green",
				key: "Generate a prompt to iterate on CI failures until the branch is green",
				suffix: " (bundled)",
			},
			{ input: "/rev", value: "review", key: "Launch interactive code review", suffix: " (bundled)" },
			{
				input: "/anno",
				value: "annotate",
				key: "Annotate a diff or text from a file, prompt, latest reply, or session",
				suffix: " (bundled)",
			},
			{
				input: "/autore",
				value: "autoresearch",
				key: "Toggle builtin autoresearch mode, or pass off / clear, or a goal message.",
				suffix: "",
			},
		] as const;

		for (const { input, value, key, suffix } of descriptions) {
			const base = resultOrThrow(await provider.getSuggestions([input], 0, input.length), `host command ${value}`);
			const translated = resultOrThrow(await wrapped.getSuggestions([input], 0, input.length), `wrapped host command ${value}`);
			assertSameSelection(base, translated);
			const baseRow = rowOrThrow(base, value, `host command ${value}`);
			const translatedRow = rowOrThrow(translated, value, `translated host command ${value}`);
			strictEqual(baseRow.description, `${key}${suffix}`, `the selected host source supplies ${value}'s canonical English description`);
			strictEqual(translatedRow.description, `${dictionary[key]}${suffix}`, `only the display description changes for ${value}`);
		}

		const annotateInput = "/annotate ";
		const baseAnnotateArgs = resultOrThrow(
			await provider.getSuggestions([annotateInput], 0, annotateInput.length),
			"real /annotate argument completions",
		);
		const translatedAnnotateArgs = resultOrThrow(
			await wrapped.getSuggestions([annotateInput], 0, annotateInput.length),
			"wrapped /annotate argument completions",
		);
		assertSameSelection(baseAnnotateArgs, translatedAnnotateArgs);
		for (const [value, key] of [
			["last ", "Annotate the latest assistant reply"],
			["session ", "Annotate a message or code block from this session"],
			["code-review ", "Annotate local changes or a GitHub pull request"],
			["./", "Annotate a file by path"],
			['"', "Annotate literal prompt text"],
		] as const) {
			strictEqual(rowOrThrow(translatedAnnotateArgs, value, `/annotate ${value}`).description, dictionary[key]);
		}

		for (const [prefix, value, key] of [
			["o", "off", "Leave autoresearch mode"],
			["c", "clear", "Reset worktree to baseline and close the active session"],
		] as const) {
			const input = `/autoresearch ${prefix}`;
			const base = resultOrThrow(await provider.getSuggestions([input], 0, input.length), `/autoresearch ${prefix}`);
			const translated = resultOrThrow(await wrapped.getSuggestions([input], 0, input.length), `wrapped /autoresearch ${prefix}`);
			assertSameSelection(base, translated);
			strictEqual(rowOrThrow(translated, value, `/autoresearch ${value}`).description, dictionary[key]);
		}
	});

	test("preserves unknown command wording and translates only the host argument-hint format", async () => {
		const { autocomplete } = await loadHostAutocomplete();
		const canonical = "Generate AGENTS.md for current codebase";
		const argumentHint = "<path>";
		const definitions: SlashDescription[] = [{ name: "init", description: canonical, argumentHint }];
		const unknownDescription = `Custom workflow - ${canonical}`;
		const unknownProvider = new autocomplete.CombinedAutocompleteProvider(
			[{ name: "init", description: unknownDescription }],
			repoDir,
		);
		const unknownWrapped = wrapProvider(unknownProvider, definitions);
		const baseUnknown = resultOrThrow(unknownProvider.trySyncSlashCompletion("/"), "custom /init description");
		const translatedUnknown = resultOrThrow(unknownWrapped.trySyncSlashCompletion("/"), "wrapped custom /init description");
		assertSameSelection(baseUnknown, translatedUnknown);
		strictEqual(rowOrThrow(translatedUnknown, "init", "custom /init").description, unknownDescription);

		const hintedProvider = new autocomplete.CombinedAutocompleteProvider(
			[{ name: "init", description: canonical, argumentHint }],
			repoDir,
		);
		const hintedWrapped = wrapProvider(hintedProvider, definitions);
		const baseHinted = resultOrThrow(hintedProvider.trySyncSlashCompletion("/"), "host argument-hint /init");
		const translatedHinted = resultOrThrow(hintedWrapped.trySyncSlashCompletion("/"), "wrapped host argument-hint /init");
		assertSameSelection(baseHinted, translatedHinted);
		strictEqual(rowOrThrow(baseHinted, "init", "host argument-hint /init").description, `${argumentHint} - ${canonical}`);
		strictEqual(
			rowOrThrow(translatedHinted, "init", "translated host argument-hint /init").description,
			`${argumentHint} - ${dictionary[canonical]}`,
		);
	});

	test("native static detail translates while a real model-state callback stays intact", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		// The real /model callback reads only ctx.session.model; this fixture never invokes a handler.
		const runtime: ModelRuntimeFixture = {
			ctx: { session: { model: { provider: "test-provider", id: "test-model" } } },
		};
		const model = registry.buildTuiBuiltinSlashCommands(runtime).find(command => command.name === "model");
		const modelDefinition = registry.BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "model");
		if (!model || !modelDefinition) throw new Error("The host did not expose its real /model command");
		strictEqual(modelDefinition.description, "Switch model for this session", "the canonical registry description remains English");
		const provider = new autocomplete.CombinedAutocompleteProvider([model], repoDir);
		const wrapped = wrapProvider(provider, registry.BUILTIN_SLASH_COMMAND_DEFS);
		const input = "/model";
		const base = resultOrThrow(await provider.getSuggestions([input], 0, input.length), "live /model state");
		const translated = resultOrThrow(await wrapped.getSuggestions([input], 0, input.length), "wrapped live /model state");
		assertSameSelection(base, translated);
		const baseRow = rowOrThrow(base, "model", "/model live state");
		const translatedRow = rowOrThrow(translated, "model", "wrapped /model live state");
		strictEqual(baseRow.description, "Model: test-provider/test-model");
		strictEqual(translatedRow.description, baseRow.description, "dynamic provider/id text remains canonical");
		strictEqual(translatedRow.nativeDetail, dictionary["Switch model for this session"]);
		strictEqual(translatedRow.state, "test-provider/test-model");
		strictEqual(modelDefinition.description, "Switch model for this session", "wrapping the live item leaves the canonical model description intact");
	});

	test("leaves a frozen host method provider usable without breaking autocomplete", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		const provider = new autocomplete.CombinedAutocompleteProvider([...registry.BUILTIN_SLASH_COMMANDS], repoDir);
		Object.defineProperty(provider, "getSuggestions", {
			value: provider.getSuggestions,
			writable: false,
			configurable: false,
		});
		const input = "/settings";
		const baseRows = resultOrThrow(await provider.getSuggestions([input], 0, input.length), "base frozen /settings");
		const wrapped = requireAutocompleteProvider(wrapSlashCommandAutocomplete(provider, registry.BUILTIN_SLASH_COMMAND_DEFS, dictionary));
		const rows = resultOrThrow(await wrapped.getSuggestions([input], 0, input.length), "wrapped frozen /settings");
		assertSameSelection(baseRows, rows);
		strictEqual(rowOrThrow(rows, "settings", "frozen /settings").description, "Open settings menu");
	});

	test("an already-cancelled host request stays cancelled through the wrapper", async () => {
		const { registry, autocomplete } = await loadHostAutocomplete();
		const provider = new autocomplete.CombinedAutocompleteProvider([...registry.BUILTIN_SLASH_COMMANDS], repoDir);
		const wrapped = wrapProvider(provider, registry.BUILTIN_SLASH_COMMAND_DEFS);
		const controller = new AbortController();
		controller.abort();
		const partials: CompletionResult[] = [];
		const result = await wrapped.getSuggestions(["/goal s"], 0, "/goal s".length, controller.signal, suggestions => partials.push(suggestions));
		strictEqual(result, null);
		deepStrictEqual(partials, []);
	});
});
