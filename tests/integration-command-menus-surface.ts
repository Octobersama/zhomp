import { deepStrictEqual, strictEqual } from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import type { MenuModule } from "../runtime/menu-catalog";
import { COMMAND_MENU_MODULES, COMMAND_MENU_TEXT_KEYS } from "../runtime/menu-command-menus";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(config: LaunchConfig, configPath: string): Promise<void>;
}

interface InstalledMenuCatalogApi {
	MENU_MODULES: readonly MenuModule[];
}

interface InstalledMenuTextApi {
	translateMenuSource(
		source: string,
		module: MenuModule,
		dictionary: Readonly<Record<string, string>>,
	): { source: string; supported: boolean };
}

interface ThemeApi {
	initThemeSync(preset?: string): void;
}

interface SelectorOption {
	label: string;
	displayLabel?: string;
}

type SelectorOptionInput = string | SelectorOption;

interface HookSelectorComponent {
	render(width: number): readonly string[];
	handleInput(data: string): void;
}

interface HookSelectorApi {
	HookSelectorComponent: new (
		title: string,
		options: SelectorOptionInput[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		optionsConfig?: { initialIndex?: number; maxVisible?: number },
	) => HookSelectorComponent;
}

interface SelectorPlan {
	kind: "cancel" | "select";
	index?: number;
	last?: boolean;
	selectLabel?: string;
	search?: string;

}

interface SelectorEvidence {
	title: string;
	options: SelectorOption[];
	initialRendered: string;
	rendered: string;
	selected: string | undefined;
	cancelled: boolean;
}

interface EditorEvidence {
	title: string;
	initialText: string | undefined;
}

interface CommandUi {
	select(title: string, options: SelectorOptionInput[]): Promise<string | undefined>;
	input(title: string, placeholder?: string, options?: unknown): Promise<string | undefined>;
	editor(title: string, initialText?: string, placeholder?: string, options?: unknown): Promise<string | undefined>;
	notify(message: string, level: string): void;
}

interface CommandContext {
	hasUI: boolean;
	cwd: string;
	sessionManager: {
		getBranch(): readonly unknown[];
		getCwd(): string;
		getArtifactsDir?(): string;
		getSessionId?(): string;
		ensureOnDisk?(): Promise<void>;
	};
	ui: CommandUi;
}

interface CommandHarness {
	context: CommandContext;
	selectors: SelectorEvidence[];
	editors: EditorEvidence[];
	inputs: string[];
	notifications: { message: string; level: string }[];

}

interface ReviewChoice {
	label: string;
	kind: string;
}

interface ReviewSelection {
	choice: ReviewChoice;
	cwd: string;
}

interface ReviewCommandApi {
	ReviewCommand: new (api: { cwd: string }) => {
		execute(args: string[], context: CommandContext): Promise<string | undefined>;
	};
	selectReviewChoice(
		context: CommandContext,
		cwd: string,
		options: { includeCustom: boolean },
	): Promise<ReviewChoice | ReviewSelection | undefined>;
	selectReviewChoice(context: CommandContext, options: { includeCustom: boolean }): Promise<ReviewChoice | ReviewSelection | undefined>;
}
interface ReviewTargetApi {
	LOCAL_REVIEW_CHOICES: readonly ReviewChoice[];
}

interface AnnotateCommandApi {
	AnnotateCommand: new (api: { cwd: string }) => {
		execute(args: string[], context: CommandContext): Promise<string | undefined>;
	};
	runAnnotateCommand?(
		api: { cwd: string }, args: string, context: CommandContext,
		dependencies: { showTextReviewOverlay(context: CommandContext, source: { id: string; label: string; text: string }, resumed: { key: string }): Promise<undefined> },
	): Promise<string | undefined>;
}

interface AnnotationSourceChoice {
	label: string;
	kind: string;
}

interface AnnotationSourceApi {
	ANNOTATION_SOURCE_CHOICES: readonly AnnotationSourceChoice[];
	selectAnnotationSourceKind(ui: Pick<CommandUi, "select">): Promise<string | undefined>;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}


function createHarness(
	plans: readonly SelectorPlan[],
	branch: readonly unknown[],
	HookSelector: HookSelectorApi["HookSelectorComponent"],
	cwd: string,
	renderWidth: number,
): CommandHarness {
	const pendingPlans = [...plans];
	const selectors: SelectorEvidence[] = [];
	const editors: EditorEvidence[] = [];
	const inputs: string[] = [];
	const notifications: { message: string; level: string }[] = [];
	const ui: CommandUi = {
		async select(title, options) {
			const plan = pendingPlans.shift();
			assert(plan !== undefined, `Unexpected selector opened: ${title}`);
			let initialIndex = plan.last ? options.length - 1 : plan.index ?? 0;
			if (plan.selectLabel !== undefined) {
				initialIndex = options.findIndex(option => (typeof option === "string" ? option : option.label) === plan.selectLabel);
			}
			assert(initialIndex >= 0, `Selector ${JSON.stringify(title)} did not contain planned option ${JSON.stringify(plan.selectLabel)}`);
			let settled = false;
			let selected: string | undefined;
			let cancelled = false;
			const component = new HookSelector(
				title,
				[...options],
				value => {
					selected = value;
					settled = true;
				},
				() => {
					cancelled = true;
					settled = true;
				},
				{ initialIndex, maxVisible: plan.search === undefined ? 40 : 3 },
			);
			const initialRendered = component.render(renderWidth).join("\n");
			if (plan.search !== undefined) {
				for (const character of plan.search) component.handleInput(character);
			}
			const rendered = component.render(renderWidth).join("\n");
			component.handleInput(plan.kind === "cancel" ? "\u001b" : "\r");
			assert(settled, `The installed selector did not settle for ${JSON.stringify(title)}`);
			selectors.push({
				title,
				options: options.map(option => {
					if (typeof option === "string") return { label: option };
					return {
						label: option.label,
						...(option.displayLabel === undefined ? {} : { displayLabel: option.displayLabel }),
					};
				}),
				initialRendered,
				rendered,
				selected,
				cancelled,
			});
			return selected;
		},
		async input(title) {
			inputs.push(title);
			return undefined;
		},
		async editor(title, initialText) {
			editors.push({ title, initialText });
			return undefined;
		},
		notify(message, level) {
			notifications.push({ message, level });
		},
	};
	return {
		context: {
			hasUI: true,
			cwd,
			sessionManager: { getBranch: () => branch, getCwd: () => cwd },
			ui,
		},
		selectors,
		editors,
		inputs,
		notifications,
	};
}

function assertContains(actual: string, expected: string, where: string): void {
	const plain = Bun.stripANSI(actual);
	assert(plain.includes(expected), `${where} did not contain ${JSON.stringify(expected)}; actual: ${JSON.stringify(plain)}`);
}

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}
const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");

const installDir = dirname(configPath);
// Dynamic imports must use the absolute install selected by OMP_ZH_CONFIG; static repo imports bypass source transforms and can create duplicate host modules.
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as InstalledHostApi;
const launch = hostApi.readLaunchConfig(configPath);
const menuCatalogApi = await import(pathToFileURL(join(installDir, "menu-catalog.ts")).href) as InstalledMenuCatalogApi;
const menuTextApi = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as InstalledMenuTextApi;
const shippedDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
if (!shippedDictionary) throw new Error("Installed command menu dictionary is invalid");

const hostileDictionary: Record<string, string> = {};
for (const [index, key] of COMMAND_MENU_TEXT_KEYS.entries()) {
	const placeholders = key.match(/\{[a-z]+\}/g) ?? [];
	hostileDictionary[key] = `恶意文案-${index}"; globalThis.zhompCommandMenusInjected = true; //${placeholders.length > 0 ? ` ${placeholders.join(" ")}` : ""}`;
}
const reviewCollision = '恶意文案-碰撞"; globalThis.zhompCommandMenusInjected = true; //';
hostileDictionary["1. Review against a base branch (PR Style)"] = reviewCollision;
hostileDictionary["2. Review uncommitted changes"] = reviewCollision;
const dictionary: Record<string, string> = mode === "hostile" ? { ...shippedDictionary, ...hostileDictionary } : { ...shippedDictionary };
if (mode !== "ordinary") {
	const missing = COMMAND_MENU_TEXT_KEYS.filter(key => !dictionary[key] || dictionary[key] === key);
	if (missing.length > 0) throw new Error(`Command menu dictionary is missing exported keys: ${JSON.stringify(missing)}`);
}

mkdirSync(probeRoot, { recursive: true });
const dictionaryPath = mode === "hostile" ? join(probeRoot, "command-menus-hostile-dictionary.json") : launch.dictPath;
if (mode === "hostile") writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
process.env.OMP_ZH_CONFIG = configPath;
process.env.OMP_ZH_DICT = dictionaryPath;
process.env.OMP_ZH_ENABLED = "1";
process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
const globalState = globalThis as typeof globalThis & { zhompCommandMenusInjected?: boolean };
globalState.zhompCommandMenusInjected = false;

const extension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
await extension.preparePreloadDisplayTranslations(launch, configPath);
const themePath = Bun.resolveSync("@oh-my-pi/pi-tui/theme/theme", launch.host.packageDir);
const themeApi = await import(pathToFileURL(themePath).href) as ThemeApi;
themeApi.initThemeSync("unicode");
const hookSelectorPath = Bun.resolveSync("@oh-my-pi/pi-tui/overlays/hook-selector", launch.host.packageDir);
const hookSelectorApi = await import(pathToFileURL(hookSelectorPath).href) as HookSelectorApi;
const renderWidth = mode === "hostile" ? 800 : 240;

const roots: Record<MenuModule["root"], string> = {
	agent: launch.host.packageDir,
	tui: launch.host.tuiDir,
};
const moduleEvidence = COMMAND_MENU_MODULES.map(module => {
	const sourcePath = join(roots[module.root], ...module.path.split("/"));
	if (!existsSync(sourcePath)) throw new Error(`Installed command menu source is missing: ${module.path}@${launch.host.version}`);
	const registered = menuCatalogApi.MENU_MODULES.some(candidate => candidate.root === module.root && candidate.path === module.path);
	if (!registered) throw new Error(`Command menu source is not registered in the installed catalog: ${module.path}`);
	const source = readFileSync(sourcePath, "utf8");
	return { path: module.path, supported: menuTextApi.translateMenuSource(source, module, dictionary).supported };
});
const selectorModulePath = "src/overlays/hook-selector.ts";
const selectorModule = menuCatalogApi.MENU_MODULES.find(candidate => candidate.root === "tui" && candidate.path === selectorModulePath);
assert(selectorModule, `Installed command menu catalog does not register ${selectorModulePath}`);
const selectorSourcePath = join(launch.host.tuiDir, ...selectorModulePath.split("/"));
if (!existsSync(selectorSourcePath)) throw new Error(`Installed HookSelector source is missing: ${selectorModulePath}@${launch.host.version}`);
const selectorSupported = menuTextApi.translateMenuSource(readFileSync(selectorSourcePath, "utf8"), selectorModule, dictionary).supported;
function sourceSupported(path: string): boolean {
	const evidence = moduleEvidence.find(module => module.path === path);
	if (!evidence) throw new Error(`Missing command menu source evidence: ${path}`);
	return evidence.supported;
}

function expectedFixed(key: string, supported: boolean): string {
	if (mode === "ordinary" || !supported) return key;
	const translated = dictionary[key];
	if (!translated || translated === key) throw new Error(`Command menu dictionary is missing ${JSON.stringify(key)}`);
	if (mode === "translated" && !/\p{Script=Han}/u.test(translated)) {
		throw new Error(`Command menu translation is not Chinese for ${JSON.stringify(key)}: ${JSON.stringify(translated)}`);
	}
	return translated;
}

const reviewIndexPath = "src/extensibility/custom-commands/bundled/review/index.ts";
const reviewSupported = sourceSupported(reviewIndexPath);
const annotateSourcePath = "src/extensibility/custom-commands/bundled/annotate/text-source.ts";
const annotateSourceSupported = sourceSupported(annotateSourcePath);
const annotateIndexSupported = sourceSupported("src/extensibility/custom-commands/bundled/annotate/index.ts");
const reviewPath = join(launch.host.packageDir, ...reviewIndexPath.split("/"));
const reviewTargetPath = join(launch.host.packageDir, "src/extensibility/custom-commands/bundled/review/target.ts");
const annotatePath = join(launch.host.packageDir, "src/extensibility/custom-commands/bundled/annotate/index.ts");
const annotationSourceModulePath = join(launch.host.packageDir, ...annotateSourcePath.split("/"));
const reviewApi = await import(pathToFileURL(reviewPath).href) as ReviewCommandApi;
const reviewTargetApi = await import(pathToFileURL(reviewTargetPath).href) as ReviewTargetApi;
const annotateApi = await import(pathToFileURL(annotatePath).href) as AnnotateCommandApi;
const annotationSourceApi = await import(pathToFileURL(annotationSourceModulePath).href) as AnnotationSourceApi;

const reviewCancel = createHarness([{ kind: "cancel" }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
const reviewCancelResult = await new reviewApi.ReviewCommand({ cwd: probeRoot }).execute([], reviewCancel.context);
strictEqual(reviewCancelResult, undefined, "cancelling /review must not execute a target");
const reviewCancelMenu = reviewCancel.selectors[0];
assert(reviewCancelMenu, "The installed /review command did not display its target selector");
strictEqual(reviewCancelMenu.cancelled, true, "the /review selector cancellation fixture was not consumed");
const expectedReviewTitle = expectedFixed("Review Mode", reviewSupported);
strictEqual(reviewCancelMenu.title, expectedReviewTitle, "the installed /review selector title is incorrect");
assertContains(reviewCancelMenu.rendered, expectedReviewTitle, "rendered /review title");

	const localReviewChoices = reviewTargetApi.LOCAL_REVIEW_CHOICES;
	const modernReviewSelector = reviewApi.selectReviewChoice.length >= 2;
	const reviewKeys = [
		...localReviewChoices.map(choice => choice.label),
		...(modernReviewSelector ? ["4. Review a specific PR/MR", "5. Custom review instructions"] : ["4. Custom review instructions"]),
	];
	const reviewCollisionFallback = mode === "hostile" && reviewSupported;
	const reviewDisplayLabels = mode !== "ordinary" && reviewSupported && !reviewCollisionFallback;
	const reviewLabelsRendered = reviewDisplayLabels && selectorSupported;
	const uncommittedReviewChoice = localReviewChoices.find(choice => choice.kind === "uncommitted");
	assert(uncommittedReviewChoice, "The installed review target module has no uncommitted-change option");
if (reviewSupported) {
	for (const key of reviewKeys) {
		const option = reviewCancelMenu.options.find(candidate => candidate.label === key);
		assert(option, `The supported /review menu is missing canonical option ${JSON.stringify(key)}`);
		strictEqual(option.displayLabel, reviewDisplayLabels ? expectedFixed(key, reviewSupported) : undefined, `The /review display label changed unexpectedly for ${JSON.stringify(key)}`);
		assertContains(reviewCancelMenu.rendered, reviewLabelsRendered ? expectedFixed(key, reviewSupported) : key, `rendered /review option ${key}`);
	}
} else {
	for (const choice of localReviewChoices) {
		assert(reviewCancelMenu.options.some(option => option.label === choice.label), `The unsupported /review source lost ${JSON.stringify(choice.label)}`);
	}
	for (const option of reviewCancelMenu.options) {
		strictEqual(option.displayLabel, undefined, "an unsupported review source must not invent translated selector labels");
		assertContains(reviewCancelMenu.rendered, option.label, `legacy /review option ${option.label}`);
	}
}
if (reviewCollisionFallback) {
	assert(reviewCancelMenu.options.every(option => option.displayLabel === undefined), "colliding /review translations must fall back to canonical labels");
}

const dynamicPullRequestLabel = "Review PR example/repo#42 from conversation";
const dynamicBranch = [{
	type: "message",
	message: { role: "user", content: "Please review https://github.com/example/repo/pull/42" },
}];
const reviewRepoRoot = join(probeRoot, "review-repo");
mkdirSync(reviewRepoRoot, { recursive: true });
const gitInit = Bun.spawnSync(["git", "init", "--quiet"], { cwd: reviewRepoRoot });
assert(gitInit.exitCode === 0, "Could not initialize the isolated review repository fixture");
const reviewSelection = createHarness(
	[{ kind: "select", index: 0, search: "uncommitted changes" }],
	dynamicBranch,
	hookSelectorApi.HookSelectorComponent,
	reviewRepoRoot,
	renderWidth,
);
const selectedReview = modernReviewSelector
	? await reviewApi.selectReviewChoice(reviewSelection.context, reviewRepoRoot, { includeCustom: true })
	: await reviewApi.selectReviewChoice(reviewSelection.context, { includeCustom: true });
assert(selectedReview, "Selecting a /review target did not return a choice");
const selectedReviewChoice = "choice" in selectedReview ? selectedReview.choice : selectedReview;
if ("choice" in selectedReview) strictEqual(selectedReview.cwd, reviewRepoRoot, "the review selection must preserve its isolated checkout");
strictEqual(selectedReviewChoice.kind, "uncommitted", "translated /review option did not map back to its canonical kind");
strictEqual(selectedReviewChoice.label, "2. Review uncommitted changes", "translated /review option changed its canonical label");
const reviewSelectionMenu = reviewSelection.selectors[0];
assert(reviewSelectionMenu, "The /review helper did not display its target selector");
assertContains(reviewSelectionMenu.initialRendered, dynamicPullRequestLabel, "rendered dynamic PR conversation option");
const dynamicPrOption = reviewSelectionMenu.options.find(option => option.label === dynamicPullRequestLabel);
assert(dynamicPrOption, "The dynamic PR conversation row changed");
strictEqual(dynamicPrOption.displayLabel, undefined, "dynamic PR conversation data must not be translated");
strictEqual(reviewSelectionMenu.selected, "2. Review uncommitted changes", "the /review selector did not return its canonical search value");

const customReviewChoiceLabel = modernReviewSelector ? "5. Custom review instructions" : "4. Custom review instructions";
const reviewCustom = createHarness([{ kind: "select", selectLabel: customReviewChoiceLabel }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
const reviewCustomResult = await new reviewApi.ReviewCommand({ cwd: probeRoot }).execute([], reviewCustom.context);
strictEqual(reviewCustomResult, undefined, "cancelling the custom instruction editor must stop /review");
const customEditor = reviewCustom.editors[0];
assert(customEditor, "The installed /review command did not open the custom instruction editor");
strictEqual(customEditor.title, expectedFixed("Enter custom review instructions", reviewSupported), "custom review editor title changed unexpectedly");
strictEqual(customEditor.initialText, "Review the following:\n\n", "custom review editor starter text must remain unchanged");
strictEqual(reviewCustom.notifications.length, 0, "custom review selection must not report a missing-checkout error");

const annotateCancel = createHarness([{ kind: "cancel" }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
const annotateCancelResult = await new annotateApi.AnnotateCommand({ cwd: probeRoot }).execute([], annotateCancel.context);
strictEqual(annotateCancelResult, undefined, "cancelling /annotate must not execute a source");
const annotateCancelMenu = annotateCancel.selectors[0];
assert(annotateCancelMenu, "The installed /annotate command did not display its source selector");
strictEqual(annotateCancelMenu.cancelled, true, "the /annotate selector cancellation fixture was not consumed");
const expectedAnnotateTitle = expectedFixed("Select content to annotate", annotateSourceSupported);
strictEqual(annotateCancelMenu.title, expectedAnnotateTitle, "the installed /annotate selector title is incorrect");
assertContains(annotateCancelMenu.rendered, expectedAnnotateTitle, "rendered /annotate title");
	const annotationKeys = annotationSourceApi.ANNOTATION_SOURCE_CHOICES.map(choice => choice.label);
	const annotationDisplayLabels = mode !== "ordinary" && annotateSourceSupported;
	const annotationLabelsRendered = annotationDisplayLabels && selectorSupported;
	for (const key of annotationKeys) {
		const option = annotateCancelMenu.options.find(candidate => candidate.label === key);
		assert(option, `The /annotate menu is missing canonical option ${JSON.stringify(key)}`);
		strictEqual(option.displayLabel, annotationDisplayLabels ? expectedFixed(key, annotateSourceSupported) : undefined, `The /annotate display label changed unexpectedly for ${JSON.stringify(key)}`);
		assertContains(annotateCancelMenu.rendered, annotationLabelsRendered ? expectedFixed(key, annotateSourceSupported) : key, `rendered /annotate option ${key}`);
	}
	const annotationSearchChoice = annotationSourceApi.ANNOTATION_SOURCE_CHOICES[1];
	assert(annotationSearchChoice, "The installed annotation source module has no second choice");
	const annotationSearch = createHarness(
		[{ kind: "select", index: 0, search: annotationSearchChoice.label }],
		[],
		hookSelectorApi.HookSelectorComponent,
		probeRoot,
		renderWidth,
	);
	const selectedAnnotationKind = await annotationSourceApi.selectAnnotationSourceKind(annotationSearch.context.ui);
	strictEqual(selectedAnnotationKind, annotationSearchChoice.kind, "translated annotation option did not map back to its canonical kind");
	const annotationSearchMenu = annotationSearch.selectors[0];
	assert(annotationSearchMenu, "The annotation helper did not display its source selector");
	strictEqual(annotationSearchMenu.selected, annotationSearchChoice.label, "the annotation selector did not return its canonical English search value");

const annotateFile = createHarness([{ kind: "select", index: 3 }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
const annotateFileResult = await new annotateApi.AnnotateCommand({ cwd: probeRoot }).execute([], annotateFile.context);
strictEqual(annotateFileResult, undefined, "cancelling the file path input must stop /annotate");
strictEqual(annotateFile.inputs[0], expectedFixed("File path to annotate", annotateIndexSupported), "the file annotation prompt title changed unexpectedly");

const annotatePrompt = createHarness([{ kind: "select", index: 4 }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
const annotatePromptResult = await new annotateApi.AnnotateCommand({ cwd: probeRoot }).execute([], annotatePrompt.context);
strictEqual(annotatePromptResult, undefined, "cancelling the text prompt editor must stop /annotate");
const textPromptEditor = annotatePrompt.editors[0];
assert(textPromptEditor, "The installed /annotate command did not open its text prompt editor");
strictEqual(textPromptEditor.title, expectedFixed("Text prompt to annotate", annotateIndexSupported), "the text annotation editor title changed unexpectedly");

// Exercise the actual draft loader and selected-draft lookup, not just the menu caption.
if (annotationSourceApi.ANNOTATION_SOURCE_CHOICES.some(choice => choice.kind === "draft")) {
	assert(annotateApi.runAnnotateCommand, "Draft-capable host must expose the annotation command consumer");
	const artifacts = join(probeRoot, "draft-artifacts");
	const sessionId = "translation-probe";
	const session = { getArtifactsDir: () => artifacts, getSessionId: () => sessionId, ensureOnDisk: async () => { throw new Error("Draft picker must not save a session"); } };
	const draftSource = { kind: "text", source: { id: "probe-source", kind: "prompt", label: "User draft label $&", text: "Original user text — never translate", sessionId } };
	const store = await import(pathToFileURL(join(launch.host.packageDir, "src/extensibility/custom-commands/bundled/annotate/draft-store.ts")).href) as { annotationDraftKey(source: unknown): string };
	const key = store.annotationDraftKey(draftSource);
	const draft = { key, updatedAt: 1, source: draftSource, state: { kind: "text", annotations: [], editor: { text: "Private unfinished note" } } };
	const directory = join(artifacts, "annotation-drafts", sessionId);
	mkdirSync(directory, { recursive: true });
	const file = join(directory, `draft-${key}.json`);
	const bytes = JSON.stringify(draft);
	writeFileSync(file, bytes);
	const draftIndex = annotationSourceApi.ANNOTATION_SOURCE_CHOICES.findIndex(choice => choice.kind === "draft");
	const selected = createHarness([{ kind: "select", index: draftIndex }, { kind: "select", index: 0, search: "User draft label" }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
	selected.context.sessionManager = { ...selected.context.sessionManager, ...session };
	let recovered: { id: string; label: string; text: string } | undefined;
	await annotateApi.runAnnotateCommand({ cwd: probeRoot }, "", selected.context, {
		async showTextReviewOverlay(_context, source, resumed) { strictEqual(resumed.key, key); recovered = source; return undefined; },
	});
	deepStrictEqual(recovered, draftSource.source, "translated draft selection must recover the original source by its canonical label");
	const menu = selected.selectors[1];
	assert(menu, "The draft picker did not open after selecting Saved draft");
	strictEqual(menu.title, expectedFixed("Resume an annotation draft", annotateIndexSupported));
	strictEqual(menu.selected, "1. User draft label $& — 0 note(s) + unfinished note", "selector returns the original labels[] string, never its displayLabel");
	assertContains(menu.rendered, draftSource.source.label, "draft source label");
	assertContains(menu.rendered, expectedFixed("{count} note(s)", annotateIndexSupported).replace("{count}", "0"), "draft note count");
	strictEqual(readFileSync(file, "utf8"), bytes, "selecting a draft must not rewrite its saved text or state");
	const empty = createHarness([{ kind: "select", index: draftIndex }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
	empty.context.sessionManager = { ...empty.context.sessionManager, ...session, getArtifactsDir: () => join(probeRoot, "no-drafts") };
	const notices: string[] = [];
	empty.context.ui.notify = message => { notices.push(message); };
	await new annotateApi.AnnotateCommand({ cwd: probeRoot }).execute([], empty.context);
	deepStrictEqual(notices, [expectedFixed("No saved annotation drafts in this session.", annotateIndexSupported)]);
}

const localPath = join(launch.host.packageDir, "src/modes/local-file-editor.ts");
if (existsSync(localPath)) {
	const localModule = menuCatalogApi.MENU_MODULES.find(module => module.root === "agent" && module.path === "src/modes/local-file-editor.ts");
	assert(localModule, "The current host's local picker must be catalogued");
	const localSupported = menuTextApi.translateMenuSource(readFileSync(localPath, "utf8"), localModule, dictionary).supported;
	const local = await import(pathToFileURL(localPath).href) as { openLocalFileInEditor(context: unknown): Promise<void> };
	const artifacts = join(probeRoot, "local-artifacts");
	const session = { getArtifactsDir: () => artifacts, getSessionId: () => "local-translation-probe" };
	const protocol = await import(pathToFileURL(join(launch.host.packageDir, "src/internal-urls/local-protocol.ts")).href) as { resolveLocalRoot(options: typeof session): string };
	const directory = protocol.resolveLocalRoot(session);
	mkdirSync(directory, { recursive: true });
	const file = join(directory, "User File.md");
	writeFileSync(file, "Original local content");
	const picker = createHarness([{ kind: "cancel" }], [], hookSelectorApi.HookSelectorComponent, probeRoot, renderWidth);
	const statuses: string[] = [];
	const context = {
		sessionManager: session, collabGuest: false,
		showHookSelector: picker.context.ui.select,
		showStatus: (message: string) => { statuses.push(message); },
		showWarning: (message: string) => { throw new Error(message); },
		showError: (message: string) => { throw new Error(message); },
		ui: { stop() { throw new Error("Cancellation must not launch an external editor"); } },
	};
	const savedEditor = process.env.EDITOR;
	const savedVisual = process.env.VISUAL;
	try {
		process.env.EDITOR = "zhomp-probe-must-not-launch";
		delete process.env.VISUAL;
		await local.openLocalFileInEditor(context);
		const menu = picker.selectors[0];
		assert(menu, "The local file picker did not open");
		strictEqual(menu.title, expectedFixed("Open local:// file in external editor", localSupported));
		strictEqual(menu.options[0]?.label, "local://User File.md", "file URL and name remain canonical data");
		assertContains(menu.rendered, "local://User File.md", "local file label");
		strictEqual(readFileSync(file, "utf8"), "Original local content");
		await local.openLocalFileInEditor({ ...context, sessionManager: { ...session, getArtifactsDir: () => join(probeRoot, "empty-local") } });
		deepStrictEqual(statuses, [expectedFixed("No local:// files in this session yet.", localSupported)]);
	} finally {
		if (savedEditor === undefined) delete process.env.EDITOR; else process.env.EDITOR = savedEditor;
		if (savedVisual === undefined) delete process.env.VISUAL; else process.env.VISUAL = savedVisual;
	}
}

assert(globalState.zhompCommandMenusInjected === false, "hostile command menu text executed as JavaScript");
const supported: Record<string, boolean> = {};
for (const evidence of moduleEvidence) supported[evidence.path] = evidence.supported;
supported[`tui:${selectorModulePath}`] = selectorSupported;

console.log(JSON.stringify({
	component: "CommandMenus",
	mode,
	supported,
	modules: [...moduleEvidence, { root: selectorModule.root, path: selectorModule.path, supported: selectorSupported }],
	consumers: {
		review: {
			cancelledMenu: reviewCancelMenu,
			canonicalSelection: { kind: selectedReviewChoice.kind, label: selectedReviewChoice.label },
			dynamicPullRequestLabel,
			customInstructionTitle: customEditor.title,
			customInstructionStarter: customEditor.initialText,
		},
		annotate: {
			cancelledMenu: annotateCancelMenu,
			canonicalSelection: selectedAnnotationKind,
			filePathPrompt: annotateFile.inputs[0],
			textPromptTitle: textPromptEditor.title,
		},
	},
	injectionExecuted: globalState.zhompCommandMenusInjected,
	width: renderWidth,
}));