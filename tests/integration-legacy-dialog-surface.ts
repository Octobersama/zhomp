import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { loadLegacySurfaceFixture } from "./legacy-surface-fixture";

interface RenderableComponent {
	render(width: number): readonly string[];
	handleInput(data: string): void;
	dispose(): void;
}

interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	options: { label: string }[];
	multi?: boolean;
	recommended?: number;
}

interface AskResult {
	kind: "submit";
	results: {
		id: string;
		question: string;
		options: string[];
		multi: boolean;
		selectedOptions: string[];
	}[];
}

interface AskDialogModule {
	AskDialogComponent: new (
		questions: AskQuestion[],
		callbacks: {
			onSubmit(result: AskResult): void;
			onCancel(): void;
			onPrompt(title: string, prefill?: string): Promise<string | undefined>;
		},
	) => RenderableComponent;
}

interface HookSelectorModule {
	HookSelectorComponent: {
		new (
			title: string,
			options: string[],
			onSelect: (option: string) => void,
			onCancel: () => void,
		): RenderableComponent;
	};
}

interface LegacyControllerContext {
	ui: {
		terminal: { rows: number };
		setFocus(component: unknown): void;
		requestRender(): void;
	};
	hookSelector?: RenderableComponent;
	editorContainer: {
		clear(): void;
		addChild(component: unknown): void;
	};
	editor: object;
}

interface LegacyControllerModule {
	ExtensionUiController: new (context: LegacyControllerContext) => {
		showHookConfirm(title: string, message: string): Promise<boolean>;
	};
}

function plain(component: RenderableComponent): string {
	return Bun.stripANSI(component.render(120).join("\n"));
}

function expectRendered(rendered: string, expected: readonly string[], surface: string): void {
	for (const value of expected) {
		ok(rendered.includes(value), `${surface} omitted ${JSON.stringify(value)}; rendered=${JSON.stringify(rendered)}`);
	}
}

const fixture = await loadLegacySurfaceFixture();
try {
	equal(fixture.launch.host.version, "18.3.2", "legacy dialog probe must use installed OMP 18.3.2");

	const askApi = await fixture.load("@oh-my-pi/pi-tui/overlays/ask-dialog") as AskDialogModule;
	const hookApi = await fixture.load("@oh-my-pi/pi-tui/overlays/hook-selector") as HookSelectorModule;
	const askOptions = ["Submit", "Other…", "Settings", "high", "Other (type your own)"];
	let askResult: AskResult | undefined;
	let askCancelled = false;
	let askPromptCalls = 0;
	const ask = new askApi.AskDialogComponent([
		{
			id: "id",
			question: "Submit",
			header: "Settings",
			options: askOptions.map(label => ({ label })),
			multi: true,
			recommended: 0,
		},
		{
			id: "high",
			question: "Settings",
			header: "Submit",
			options: [{ label: "Other…" }, { label: "Settings" }],
			multi: true,
		},
	], {
		onSubmit(result) { askResult = result; },
		onCancel() { askCancelled = true; },
		async onPrompt() {
			askPromptCalls++;
			return "Other…";
		},
	});

	let askInitial: string;
	let askSubmitTab: string;
	try {
		askInitial = plain(ask);
		expectRendered(askInitial, ["Ask", "Submit", "Settings", "Other…", "high", "Other (type your own)"], "legacy Ask dialog");
		ok((askInitial.match(/Other \(type your own\)/g)?.length ?? 0) >= 2,
			`legacy Ask dialog lost either the caller sentinel-like choice or its fixed custom-answer row; rendered=${JSON.stringify(askInitial)}`);

		// Select caller-owned values through the component's real keyboard path.
		ask.handleInput("\x1b[B");
		ask.handleInput(" ");
		ask.handleInput("\x1b[B");
		ask.handleInput("\x1b[B");
		ask.handleInput(" ");
		ask.handleInput("\t");
		ask.handleInput(" ");
		ask.handleInput("\t");
		askSubmitTab = plain(ask);
		expectRendered(askSubmitTab, ["Ask", "Submit"], "legacy Ask submit tab");
		ask.handleInput("\r");
	} finally {
		ask.dispose();
	}

	ok(askResult, "legacy Ask did not call onSubmit");
	equal(askCancelled, false, "legacy Ask unexpectedly called onCancel");
	equal(askPromptCalls, 0, "legacy Ask unexpectedly opened a prompt while selecting options");
	deepStrictEqual(
		askResult.results.map(({ id, question, options, multi, selectedOptions }) => ({ id, question, options, multi, selectedOptions })),
		[
			{
				id: "id",
				question: "Submit",
				options: askOptions,
				multi: true,
				selectedOptions: ["Other…", "high"],
			},
			{
				id: "high",
				question: "Settings",
				options: ["Other…", "Settings"],
				multi: true,
				selectedOptions: ["Other…"],
			},
		],
		"legacy Ask changed caller IDs, question strings, option values, or keyboard selections",
	);

	let hookSelection: string | undefined;
	let hookCancelled = false;
	const hookTitle = "Hook choice: Submit\nCaller detail: Settings";
	const hookChoices = ["Submit", "Settings", "high"];
	const hook = new hookApi.HookSelectorComponent(
		hookTitle,
		hookChoices,
		option => { hookSelection = option; },
		() => { hookCancelled = true; },
	);
	let hookAnsi: string;
	try {
		hookAnsi = plain(hook);
		expectRendered(hookAnsi, ["Hook choice: Submit", "Caller detail: Settings", ...hookChoices], "legacy hook selector");
		hook.handleInput("\x1b[B");
		hook.handleInput("\x1b[B");
		hook.handleInput("\r");
	} finally {
		hook.dispose();
	}
	equal(hookSelection, "high", "legacy hook selector did not return the logical selected item");
	equal(hookCancelled, false, "legacy hook selector unexpectedly called onCancel");

	const controllerModule = await fixture.load("./src/modes/controllers/extension-ui-controller.ts") as LegacyControllerModule;
	const controllerContext: LegacyControllerContext = {
		ui: {
			terminal: { rows: 40 },
			setFocus() {},
			requestRender() {},
		},
		editorContainer: {
			clear() {},
			addChild() {},
		},
		editor: {},
	};
	const controller = new controllerModule.ExtensionUiController(controllerContext);
	const confirmTitle = "Legacy confirmation: Settings";
	const confirmMessage = "Review Submit for high";
	const confirmation = controller.showHookConfirm(confirmTitle, confirmMessage);
	const confirmSelector = controllerContext.hookSelector;
	ok(confirmSelector, "legacy showHookConfirm did not present its real hook selector");
	const confirmAnsi = plain(confirmSelector);
	expectRendered(confirmAnsi, [confirmTitle, confirmMessage, "Yes", "No"], "legacy generic confirmation selector");
	// The only confirmation action exercised is No; the isolated UI context has no host-manager callbacks.
	confirmSelector.handleInput("\x1b[B");
	confirmSelector.handleInput("\r");
	const confirmed = await confirmation;
	equal(confirmed, false, "legacy generic confirmation did not resolve the captured No choice as false");

	console.log(JSON.stringify({
		mode: fixture.mode,
		component: "LegacyDialogMenus",
		hostVersion: fixture.launch.host.version,
		surfaces: [
			{
				name: "ask",
				component: "AskDialogComponent",
				fixedChrome: ["Ask", "Other (type your own)", "Submit"],
				callerIds: askResult.results.map(result => result.id),
				selectedOptions: askResult.results.map(result => result.selectedOptions),
			},
			{
				name: "hook-selector",
				component: "HookSelectorComponent",
				title: hookTitle,
				choices: hookChoices,
				selected: hookSelection,
			},
			{
				name: "legacy-generic-confirm",
				component: "ExtensionUiController.showHookConfirm -> HookSelectorComponent",
				title: confirmTitle,
				choices: ["Yes", "No"],
				selected: "No",
				result: confirmed,
			},
		],
		callbackEvidence: {
			ask: { submitted: true, cancelled: askCancelled, promptCalls: askPromptCalls },
			hookSelector: { selected: hookSelection, cancelled: hookCancelled },
			legacyConfirmation: { selected: "No", result: confirmed },
		},
	}));
} finally {
	fixture.close();
}
