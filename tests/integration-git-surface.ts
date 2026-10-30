import { ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { GIT_MENU_MODULES } from "../runtime/menu-git";
import { translateMenuSource } from "../runtime/menu-ui";
import { parseDictionaryText } from "./dictionary-validation";

interface InstalledHostApi {
	readLaunchConfig(configPath: string): LaunchConfig;
}

interface InstalledExtensionApi {
	preparePreloadDisplayTranslations(launch: LaunchConfig, configPath: string): Promise<void>;
}

type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
type ChangeArea = "unstaged" | "staged" | "commit";

interface ChangedFile {
	path: string;
	origPath?: string;
	kind: ChangeKind;
	area: ChangeArea;
	additions?: number;
	deletions?: number;
}

interface HeadCommit {
	sha: string;
	shortSha: string;
	subject: string;
	body: string;
	authorName: string;
	authorEmail: string;
	authorDate: string;
	parents: readonly string[];
	files: readonly ChangedFile[];
	filesLoaded: boolean;
}

interface DiffStreamResult {
	runs: readonly unknown[];
	hunks: readonly unknown[];
	oldEndsNewline: boolean;
	newEndsNewline: boolean;
}

interface TextContents {
	kind: "text";
	oldText: string;
	newText: string;
	streamResult: DiffStreamResult;
}

type AssetSide =
	| { kind: "empty" }
	| { kind: "binary"; byteLength?: number }
	| { kind: "lfsMissing"; oid: string; byteLength: number };

interface AssetContents {
	kind: "asset";
	old: AssetSide;
	new: AssetSide;
}

type FileContents = TextContents | AssetContents;

interface GitTuiModel {
	cwd: string;
	branch: string | null;
	clean: boolean;
	unstaged: readonly ChangedFile[];
	staged: readonly ChangedFile[];
	headCommit: HeadCommit | null;
	refresh(): Promise<boolean>;
	loadChangeStats(): Promise<boolean>;
	loadHeadFiles(): Promise<boolean>;
	streamContents(file: ChangedFile, onProgress: (update: unknown) => void, signal?: AbortSignal): Promise<FileContents>;
	stage(files?: readonly ChangedFile[]): Promise<void>;
	unstage(files?: readonly ChangedFile[]): Promise<void>;
	discard(files: readonly ChangedFile[]): Promise<void>;
	commit(message: string, options?: { amend?: boolean }): Promise<void>;
	applyPatch(patchText: string, options?: { cached?: boolean; reverse?: boolean }): Promise<void>;
}

interface GitCommitMessage {
	type: string;
	scope?: string | null;
	summary: string;
	body: readonly string[];
}

interface AiStageOutcome {
	matchedFiles: number;
	totalFiles: number;
	stagedHunks: number;
	totalHunks: number;
	wholeFiles: number;
}

interface GitTuiHost {
	model: GitTuiModel;
	createAvatarSource(onReady: () => void): { get(email: string, cwd: string): string | null | undefined };
	aiStage(options: {
		cwd: string;
		instruction: string;
		files: readonly Pick<ChangedFile, "path" | "kind">[];
		signal?: AbortSignal;
		onProgress?: (message: string) => void;
	}): Promise<AiStageOutcome>;
	generateCommitMessage(options: {
		cwd: string;
		stageIfEmpty: boolean;
		signal?: AbortSignal;
		onProgress?: (message: string) => void;
	}): Promise<{ commit: GitCommitMessage; validationError?: string | null; stagedAll: boolean }>;
}

interface NativeContext {
	cols: number;
	reduceMotion: boolean;
	dark: boolean;
	supports(kind: string): boolean;
	feature(name: string): boolean;
}

interface CapturedComponent {
	render(width: number): readonly string[];
	handleInput?(data: string): void;
	describe?(context: NativeContext): unknown;
	handleNativeEvent?(event: unknown): void;
	nativeOverlay?: { role?: string; head?: unknown };
}

interface OverlayHandle {
	hide(): void;
}

interface HeadlessUi {
	terminal: { rows: number };
	imageBudget?: unknown;
	showOverlay(component: CapturedComponent, options?: unknown): OverlayHandle;
	setFocus(component: CapturedComponent | null): void;
	requestRender(): void;
}

interface GitTuiApi {
	showGitOverlay(ui: HeadlessUi, host: GitTuiHost): Promise<void>;
}

interface DiffStream {
	push(side: "Old" | "New", text: string): unknown;
	finishSide(side: "Old" | "New"): unknown;
	finish(context?: number): Promise<DiffStreamResult>;
}

interface NativeDiffApi {
	DiffSide: { Old: "Old"; New: "New" };
	DiffStream: new () => DiffStream;
}


const REQUIRED_TRANSLATIONS: Readonly<Record<string, string>> = {
	File: "文件",
	Split: "分栏",
	Inline: "行内",
	Hunks: "差异块",
	Path: "路径",
	Tree: "目录树",
	"on {branch}": "分支 {branch}",
	"{count} file change(s) on {branch}": "有 {count} 个文件更改，分支为{branch}",
	"{count} file change(s)": "有 {count} 个文件更改",
	"Stage File": "暂存文件",
	"Unstage File": "取消暂存文件",
	"Stage All": "全部暂存",
	"Unstage All": "取消全部暂存",
	"Stage all": "全部暂存",
	"Unstage all": "取消全部暂存",
	Staged: "已暂存",
	Unstaged: "未暂存",
	"Nothing to stage": "没有可暂存的更改",
	"Nothing staged yet": "尚无已暂存的更改",
	"Commit summary": "提交摘要",
	Summary: "摘要",
	Description: "说明",
	Amend: "修订",
	"Amend previous commit": "修订上一条提交",
	"Stage Hunk": "暂存差异块",
	"Unstage Hunk": "取消暂存差异块",
	"Discard Hunk": "丢弃差异块",
	"No changes": "无更改",
	"No commits yet": "尚无提交",
	"Before": "之前",
	"After": "之后",
	"LFS missing": "缺少 LFS",
	"Binary or media file": "二进制或媒体文件",
	"Loading {file}…": "正在加载 {file}…",
	"Streaming file…": "正在读取文件…",
	"Working tree clean — showing committed {sha}": "工作区干净 — 正在显示提交 {sha}",
	"Keyboard shortcuts": "键盘快捷键",
	Move: "移动",

	Stage: "暂存",
	"Quit": "退出",
};

const mode = process.env.MENU_SURFACE_MODE;
if (mode !== "ordinary" && mode !== "translated" && mode !== "hostile") {
	throw new Error("MENU_SURFACE_MODE must be ordinary, translated, or hostile");
}

const configPath = process.env.OMP_ZH_CONFIG;
const probeRoot = process.env.PROBE_DIR;
if (!configPath || !probeRoot) throw new Error("Missing installed launch config or probe directory");


function fixedText(key: string): string {
	if (mode === "ordinary") return key;
	if (mode === "hostile" && key === "File") return '恶";globalThis.__zhompGitInjected=true;//$&';
	if (mode === "hostile" && key === "Summary") return "恶意摘要";
	if (mode === "hostile" && key === "Keyboard shortcuts") return '帮助";globalThis.__zhompGitInjected=true;//$&';
	const translation = REQUIRED_TRANSLATIONS[key];
	if (translation !== undefined) return translation;
	throw new Error(`Missing expected Git UI translation: ${key}`);
}

function assertText(actual: string, key: string, surface: string): void {
	const expected = fixedText(key);
	const escapedExpected = JSON.stringify(expected).slice(1, -1);
	ok(!actual.includes("__zhompMenu"), `${surface} rendered menu helper source`);
	ok(actual.includes(expected) || actual.includes(escapedExpected), `${surface} is missing ${JSON.stringify(expected)}`);
}

function createHost(
	state: Omit<GitTuiModel, "refresh" | "loadChangeStats" | "loadHeadFiles" | "streamContents" | "stage" | "unstage" | "discard" | "commit" | "applyPatch">,
	contents: ReadonlyMap<string, FileContents | Promise<FileContents>>,
	mutationCalls: string[],
): GitTuiHost {
	function blocked(operation: string): never {
		mutationCalls.push(operation);
		throw new Error(`Blocked Git UI mutation: ${operation}`);
	}

	const model: GitTuiModel = {
		...state,
		refresh: async () => false,
		loadChangeStats: async () => false,
		loadHeadFiles: async () => false,
		async streamContents(file) {
			const value = contents.get(file.path);
			if (value === undefined) throw new Error(`Missing read-only fixture content: ${file.path}`);
			return value;
		},
		async stage() { blocked("stage"); },
		async unstage() { blocked("unstage"); },
		async discard() { blocked("discard"); },
		async commit() { blocked("commit"); },
		async applyPatch() { blocked("applyPatch"); },
	};

	return {
		model,
		createAvatarSource() { return { get: () => null }; },
		async aiStage() { return blocked("aiStage"); },
		async generateCommitMessage() { return blocked("generateCommitMessage"); },
	};
}

function captureUi(): { ui: HeadlessUi; overlays: CapturedComponent[]; hideCount(): number } {
	const overlays: CapturedComponent[] = [];
	let hidden = 0;
	const ui: HeadlessUi = {
		terminal: { rows: 42 },
		imageBudget: undefined,
		showOverlay(component) {
			overlays.push(component);
			return { hide() { hidden++; } };
		},
		setFocus() {},
		requestRender() {},
	};
	return { ui, overlays, hideCount: () => hidden };
}

function nativeSnapshot(component: CapturedComponent): string | undefined {
	if (!component.describe) return undefined;
	return JSON.stringify(component.describe({
		cols: 120,
		reduceMotion: false,
		dark: false,
		supports() { return false; },
		feature() { return false; },
	}));
}


async function waitForAnsi(component: CapturedComponent, predicate: (text: string) => boolean, label: string): Promise<string> {
	let lastFrame = "";
	for (let attempt = 0; attempt < 500; attempt++) {
		lastFrame = Bun.stripANSI(component.render(220).join("\n"));
		if (predicate(lastFrame)) return lastFrame;
		await new Promise<void>(resolve => setTimeout(resolve, 10));
	}
	throw new Error(`Git UI did not render ${label}. Last ANSI frame: ${JSON.stringify(lastFrame)}`);
}

async function textContents(native: NativeDiffApi, oldText: string, newText: string): Promise<TextContents> {
	const stream = new native.DiffStream();
	stream.push(native.DiffSide.Old, oldText);
	stream.push(native.DiffSide.New, newText);
	stream.finishSide(native.DiffSide.Old);
	stream.finishSide(native.DiffSide.New);
	return { kind: "text", oldText, newText, streamResult: await stream.finish(3) };
}

function state(
	cwd: string,
	values: {
		branch: string | null;
		clean: boolean;
		unstaged?: readonly ChangedFile[];
		staged?: readonly ChangedFile[];
		headCommit?: HeadCommit | null;
	},
): Omit<GitTuiModel, "refresh" | "loadChangeStats" | "loadHeadFiles" | "streamContents" | "stage" | "unstage" | "discard" | "commit" | "applyPatch"> {
	return {
		cwd,
		branch: values.branch,
		clean: values.clean,
		unstaged: values.unstaged ?? [],
		staged: values.staged ?? [],
		headCommit: values.headCommit ?? null,
	};
}

async function run(): Promise<void> {
	// Launch.json selects these runtime paths; the extension preload must run before target imports.
	const configDir = dirname(configPath!);
	const installedHost = await import(pathToFileURL(join(configDir, "host.ts")).href) as InstalledHostApi;
	const launch = installedHost.readLaunchConfig(configPath!);
	const baseDictionary = parseDictionaryText(readFileSync(launch.dictPath, "utf8"));
	const hostileControl = '恶";globalThis.__zhompGitInjected=true;//$&';
	const hostileHelp = '帮助";globalThis.__zhompGitInjected=true;//$&';
	const dictionary = mode === "hostile"
		? {
				...baseDictionary,
				File: hostileControl,
				"Keyboard shortcuts": hostileHelp,
				Summary: "恶意摘要",
				"src/KeepPath.ts": "恶意路径",
				"src/KeepCommit.ts": "恶意提交路径",
				"const userText = \"KeepDiffContent\";": "恶意差异",
				"const commitText = \"KeepCommitDiff\";": "恶意提交差异",
				"feat: Keep Commit Subject": "恶意提交主题",
				"Keep commit body": "恶意提交正文",
				"Keep Author": "恶意作者",
				"keep-author@example.invalid": "恶意邮箱",
				"01234567": "恶意 SHA",
				"0123456789abcdef0123456789abcdef01234567": "恶意完整哈希",
				abcdef0123456789abcdef0123456789abcdef01: "恶意父哈希",
				modified: "恶意状态",
				M: "恶意状态字母",
				"UTF-8": "恶意编码",
			}
		: baseDictionary;
	const dictionaryPath = mode === "hostile" ? join(probeRoot!, "git-hostile-dictionary.json") : launch.dictPath;
	if (mode === "hostile") {
		mkdirSync(probeRoot!, { recursive: true });
		writeFileSync(dictionaryPath, JSON.stringify(dictionary), "utf8");
	}
	process.env.OMP_ZH_DICT = dictionaryPath;
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = mode === "ordinary" ? "-1" : String(process.pid);
	const injectionMarker = globalThis as typeof globalThis & { __zhompGitInjected?: boolean };
	injectionMarker.__zhompGitInjected = false;

	// Run the installed extension hook before importing the selected TUI source below.
	const installedExtension = await import(pathToFileURL(launch.extensionPath).href) as InstalledExtensionApi;
	await installedExtension.preparePreloadDisplayTranslations(launch, configPath!);

	const gitTuiPath = join(launch.host.tuiDir, "src", "apps", "git", "git-tui.ts");
	if (!existsSync(gitTuiPath)) {
		console.log(JSON.stringify({ mode, component: "GitTui", supported: false, fallback: "Git TUI source unavailable" }));
		return;
	}
	// The Git module path is selected by the installed launch config and must be imported after preload.
	const gitTuiValue: unknown = await import(pathToFileURL(gitTuiPath).href);
	if (gitTuiValue === null || typeof gitTuiValue !== "object" ||
		!("showGitOverlay" in gitTuiValue) || typeof gitTuiValue.showGitOverlay !== "function") {
		console.log(JSON.stringify({ mode, component: "GitTui", supported: false, fallback: "showGitOverlay unavailable" }));
		return;
	}
	const gitTui = gitTuiValue as unknown as GitTuiApi;
	// Dependencies are resolved beside the selected TUI package, not from this workspace's runtime graph.
	const nativePath = join(dirname(launch.host.tuiDir), "pi-natives", "native", "index.js");
	const nativeDiff = await import(pathToFileURL(nativePath).href) as NativeDiffApi;
	const themePath = join(launch.host.tuiDir, "src", "theme", "theme.ts");
	const theme = await import(pathToFileURL(themePath).href) as { initThemeSync(preset?: string): void };
	theme.initThemeSync("unicode");

	const moduleShape = Object.fromEntries(GIT_MENU_MODULES.map(module => {
		const root = module.root === "tui" ? launch.host.tuiDir : launch.host.packageDir;
		const sourcePath = join(root, ...module.path.split("/"));
		const supported = existsSync(sourcePath) && translateMenuSource(readFileSync(sourcePath, "utf8"), module, dictionary).supported;
		return [module.path, supported];
	}));

	const dirtyFile: ChangedFile = {
		path: "src/KeepPath.ts",
		origPath: "src/OldKeepPath.ts",
		kind: "modified",
		area: "unstaged",
		additions: 1,
		deletions: 1,
	};
	const stagedFile: ChangedFile = { path: "docs/StagedPath.md", kind: "added", area: "staged", additions: 2, deletions: 0 };
	const untrackedFile: ChangedFile = { path: "zz-notes/UntrackedPath.md", kind: "untracked", area: "unstaged" };
	const dirtyContents = new Map<string, FileContents>([
		[dirtyFile.path, await textContents(nativeDiff, 'const userText = "old";\n', 'const userText = "KeepDiffContent";\n')],
		[stagedFile.path, await textContents(nativeDiff, "", "KeepStagedContent\n")],
		[untrackedFile.path, await textContents(nativeDiff, "", "KeepUntrackedContent\n")],
	]);
	const mutationCalls: string[] = [];
	const dirtyHost = createHost(state(probeRoot!, {
		branch: "Summary",
		clean: false,
		unstaged: [dirtyFile, untrackedFile],
		staged: [stagedFile],
	}), dirtyContents, mutationCalls);
	const dirtyUi = captureUi();
	const dirtyCompletion = gitTui.showGitOverlay(dirtyUi.ui, dirtyHost);
	const dirtyApp = dirtyUi.overlays[0];
	if (!dirtyApp) throw new Error("showGitOverlay did not mount the Git app component");
	try {
		let dirtyAnsi = await waitForAnsi(dirtyApp, text => text.includes("KeepDiffContent"), "dirty diff content");
		let dirtyNative = nativeSnapshot(dirtyApp);
		assertText(dirtyAnsi, "Stage File", "dirty ANSI header");
		assertText(dirtyAnsi, "Stage All", "dirty ANSI sidebar");
		assertText(dirtyAnsi, "Unstage All", "dirty ANSI sidebar");
		assertText(dirtyAnsi, "Commit summary", "dirty ANSI composer");
		assertText(dirtyAnsi, "Amend previous commit", "dirty ANSI composer");
		assertText(dirtyAnsi, "Description", "dirty ANSI composer");
		ok(dirtyAnsi.includes("Summary"), "branch data equal to a fixed text key must remain raw in ANSI");
		if (mode !== "ordinary") {
			const headerPrefix = fixedText("{count} file change(s) on {branch}").replace("{count}", "3").replace("{branch}", "");
			ok(dirtyAnsi.includes(headerPrefix), "ANSI branch header must translate the location phrase without translating branch content");
		}
		ok(dirtyAnsi.includes("src/KeepPath.ts"), "ANSI view must preserve the current file path");
		ok(dirtyAnsi.includes("KeepDiffContent"), "ANSI diff must preserve user file content");
		ok(dirtyAnsi.includes("M") && dirtyAnsi.includes("?"), "ANSI file status letters must remain raw");
		ok(dirtyAnsi.includes("UTF-8"), "ANSI content-kind encoding must remain raw");
		if (mode === "hostile") {
			const dirtyOutput = `${dirtyAnsi}\n${dirtyNative ?? ""}`;
			for (const text of ["恶意路径", "恶意旧路径", "恶意差异", "恶意状态", "恶意状态字母", "恶意编码"]) {
				ok(!dirtyOutput.includes(text), `dynamic Git data must not use the hostile translation ${text}`);
			}
		}
		if (dirtyNative !== undefined) {
			for (const key of ["File", "Split", "Inline", "Hunks", "Path", "Tree", "Stage all", "Unstage all", "Unstaged", "Staged", "Summary", "Description", "Amend"]) {
				assertText(dirtyNative, key, "dirty native description");
			}
			for (const id of ['"id":"file"', '"id":"split"', '"id":"inline"', '"id":"hunk"']) {
				ok(dirtyNative.includes(id), `native view must preserve ${id}`);
			}
			ok(dirtyNative.includes("Summary"), "branch data equal to a fixed text key must remain raw in native data");
			if (mode !== "ordinary") {
				const branchText = fixedText("on {branch}").replace("{branch}", "Summary");
				ok(dirtyNative.includes(branchText), "native branch node must translate its contextual label and preserve its value");
			}
			ok(dirtyNative.includes("src/KeepPath.ts") && dirtyNative.includes("src/OldKeepPath.ts"), "native view must preserve current and renamed paths");
			ok(dirtyNative.includes("KeepDiffContent"), "native diff must preserve user file content");
			ok(dirtyNative.includes('"modified: src/KeepPath.ts"') && dirtyNative.includes('"M"'), "native status kind and letter must remain raw");
		}

		dirtyApp.handleInput?.("4");
		dirtyAnsi = Bun.stripANSI(dirtyApp.render(220).join("\n"));
		assertText(dirtyAnsi, "Stage Hunk", "ANSI hunk action");
		assertText(dirtyAnsi, "Discard Hunk", "ANSI hunk action");
		dirtyApp.handleInput?.("3");
		dirtyNative = nativeSnapshot(dirtyApp);
		if (dirtyNative !== undefined) ok(dirtyNative.includes('"active":"inline"'), "native navigation must preserve the inline view ID");

		dirtyApp.handleInput?.("?");
		const help = dirtyUi.overlays.find(component => component.nativeOverlay?.role === "omp.overlay.hotkeys");
		if (!help) throw new Error("Git help overlay was not opened by the ? shortcut");
		const helpAnsi = Bun.stripANSI(help.render(140).join("\n"));
		assertText(helpAnsi, "Keyboard shortcuts", "ANSI Git help");
		assertText(helpAnsi, "Move", "ANSI Git help");
		assertText(helpAnsi, "Stage", "ANSI Git help");
		assertText(helpAnsi, "Quit", "ANSI Git help");
		const helpNativeTitle = JSON.stringify(help.nativeOverlay?.head ?? "");
		assertText(helpNativeTitle, "Keyboard shortcuts", "native Git help title");
		const helpNative = nativeSnapshot(help);
		if (helpNative !== undefined) {
			assertText(helpNative, "Move", "native Git help");
			assertText(helpNative, "Quit", "native Git help");
		}
		if (!help.handleInput) throw new Error("Git help component has no keyboard handler");
		help.handleInput("?");
		strictEqual(dirtyUi.hideCount(), 1, "help callback must close its overlay");
	} finally {
		dirtyApp.handleInput?.("q");
		await dirtyCompletion;
	}

	const commitFile: ChangedFile = { path: "src/KeepCommit.ts", kind: "modified", area: "commit", additions: 1, deletions: 0 };
	const commit: HeadCommit = {
		sha: "0123456789abcdef0123456789abcdef01234567",
		shortSha: "01234567",
		subject: "feat: Keep Commit Subject",
		body: "Keep commit body\nSecond body line",
		authorName: "Keep Author",
		authorEmail: "keep-author@example.invalid",
		authorDate: "2025-01-02T03:04:05.000Z",
		parents: ["abcdef0123456789abcdef0123456789abcdef01"],
		files: [commitFile],
		filesLoaded: true,
	};
	const cleanCalls: string[] = [];
	const cleanHost = createHost(state(probeRoot!, { branch: "main/KeepBranch", clean: true, headCommit: commit }),
		new Map([[commitFile.path, await textContents(nativeDiff, 'const commitText = "old";\n', 'const commitText = "KeepCommitDiff";\n')]]), cleanCalls);
	const cleanUi = captureUi();
	const cleanCompletion = gitTui.showGitOverlay(cleanUi.ui, cleanHost);
	const cleanApp = cleanUi.overlays[0];
	if (!cleanApp) throw new Error("showGitOverlay did not mount the clean Git app");
	try {
		const cleanAnsi = await waitForAnsi(cleanApp, text => text.includes("KeepCommitDiff"), "clean commit diff");
		const cleanNative = nativeSnapshot(cleanApp);
		const expectedWorkingTreeStatus = fixedText("Working tree clean — showing committed {sha}").replace("{sha}", commit.shortSha);
		ok(cleanAnsi.includes(expectedWorkingTreeStatus), "clean ANSI sidebar must translate its fixed status and preserve the commit ID");
		for (const value of [commit.subject, "Keep commit body", commit.authorName, commit.authorEmail, commit.shortSha, commit.parents[0]!.slice(0, 8), "src/KeepCommit.ts", "KeepCommitDiff"]) {
			ok(cleanAnsi.includes(value), `clean ANSI view must preserve ${JSON.stringify(value)}`);
		}
		if (cleanNative !== undefined) {
			for (const value of [commit.subject, "Keep commit body", commit.authorName, commit.authorEmail, commit.shortSha, commit.parents[0]!.slice(0, 8), "src/KeepCommit.ts", "KeepCommitDiff"]) {
				ok(cleanNative.includes(value), `clean native view must preserve ${JSON.stringify(value)}`);
			}
		}
		if (mode === "hostile") {
			const cleanOutput = `${cleanAnsi}\n${cleanNative ?? ""}`;
			for (const text of ["恶意提交路径", "恶意提交差异", "恶意提交主题", "恶意提交正文", "恶意作者", "恶意邮箱", "恶意 SHA", "恶意完整哈希", "恶意父哈希"]) {
				ok(!cleanOutput.includes(text), `commit data must not use the hostile translation ${text}`);
			}
		}
	} finally {
		cleanApp.handleInput?.("q");
		await cleanCompletion;
	}

	const emptyCommit: HeadCommit = { ...commit, subject: "Keep empty commit", body: "", files: [] };
	const emptyCalls: string[] = [];
	const emptyHost = createHost(state(probeRoot!, { branch: "main", clean: true, headCommit: emptyCommit }), new Map(), emptyCalls);
	const emptyUi = captureUi();
	const emptyCompletion = gitTui.showGitOverlay(emptyUi.ui, emptyHost);
	const emptyApp = emptyUi.overlays[0];
	if (!emptyApp) throw new Error("showGitOverlay did not mount the empty Git app");
	try {
		const emptyMessage = fixedText("No changes");
		const emptyAnsi = await waitForAnsi(emptyApp, text => text.includes(emptyMessage), "empty diff state");
		assertText(emptyAnsi, "No changes", "ANSI empty diff state");
		const emptyNative = nativeSnapshot(emptyApp);
		if (emptyNative !== undefined) assertText(emptyNative, "No changes", "native empty diff state");
	} finally {
		emptyApp.handleInput?.("q");
		await emptyCompletion;
	}
	const noCommitCalls: string[] = [];
	const noCommitHost = createHost(state(probeRoot!, { branch: "main", clean: true }), new Map(), noCommitCalls);
	const noCommitUi = captureUi();
	const noCommitCompletion = gitTui.showGitOverlay(noCommitUi.ui, noCommitHost);
	const noCommitApp = noCommitUi.overlays[0];
	if (!noCommitApp) throw new Error("showGitOverlay did not mount the no-commit Git app");
	try {
		const noCommitAnsi = await waitForAnsi(noCommitApp, text => text.includes(fixedText("No commits yet")), "no-commit state");
		assertText(noCommitAnsi, "No commits yet", "ANSI no-commit state");
		const noCommitNative = nativeSnapshot(noCommitApp);
		if (noCommitNative !== undefined) assertText(noCommitNative, "No commits yet", "native no-commit state");
	} finally {
		noCommitApp.handleInput?.("q");
		await noCommitCompletion;
	}

	const loadingFile: ChangedFile = { path: "src/KeepLoading.ts", kind: "modified", area: "unstaged" };
	const loadingContent = await textContents(nativeDiff, "", "KeepLoadingContent\n");
	const loadingDeferred = Promise.withResolvers<FileContents>();
	const loadingCalls: string[] = [];
	const loadingHost = createHost(state(probeRoot!, { branch: "loading/KeepBranch", clean: false, unstaged: [loadingFile] }),
		new Map([[loadingFile.path, loadingDeferred.promise]]), loadingCalls);
	const loadingUi = captureUi();
	const loadingCompletion = gitTui.showGitOverlay(loadingUi.ui, loadingHost);
	const loadingApp = loadingUi.overlays[0];
	if (!loadingApp) throw new Error("showGitOverlay did not mount the loading Git app");
	try {
		const loadingAnsi = await waitForAnsi(loadingApp, text => text.includes(fixedText("Streaming file…")), "streaming diff state");
		assertText(loadingAnsi, "Streaming file…", "ANSI streaming state");
		const loadingNative = nativeSnapshot(loadingApp);
		if (loadingNative !== undefined) {
			const message = fixedText("Loading {file}…").replace("{file}", loadingFile.path);
			ok(loadingNative.includes(message), "native loading state must translate its label and preserve the file path");
		}
		loadingDeferred.resolve(loadingContent);
		const loadedAnsi = await waitForAnsi(loadingApp, text => text.includes("KeepLoadingContent"), "loaded diff state");
		ok(loadedAnsi.includes("KeepLoadingContent"), "loading completion must preserve the diff content");
	} finally {
		loadingDeferred.resolve(loadingContent);
		loadingApp.handleInput?.("q");
		await loadingCompletion;
	}

	const assetFile: ChangedFile = { path: "assets/KeepAsset.bin", kind: "modified", area: "unstaged" };
	const asset: AssetContents = {
		kind: "asset",
		old: { kind: "empty" },
		new: { kind: "lfsMissing", oid: "deadbeef0123456789abcdef0123456789abcdef", byteLength: 1234 },
	};
	const assetCalls: string[] = [];
	const assetHost = createHost(state(probeRoot!, { branch: "asset/KeepBranch", clean: false, unstaged: [assetFile] }),
		new Map([[assetFile.path, asset]]), assetCalls);
	const assetUi = captureUi();
	const assetCompletion = gitTui.showGitOverlay(assetUi.ui, assetHost);
	const assetApp = assetUi.overlays[0];
	if (!assetApp) throw new Error("showGitOverlay did not mount the asset Git app");
	try {
		const assetAnsi = await waitForAnsi(assetApp, text => text.includes("deadbeef0123"), "asset preview");
		assertText(assetAnsi, "Before", "ANSI asset preview");
		assertText(assetAnsi, "After", "ANSI asset preview");
		assertText(assetAnsi, "LFS missing", "ANSI asset preview");
		ok(assetAnsi.includes("deadbeef0123"), "ANSI asset preview must preserve its Git LFS object ID");
		const assetNative = nativeSnapshot(assetApp);
		if (assetNative !== undefined) {
			assertText(assetNative, "Binary or media file", "native asset fallback");
			if (mode === "ordinary") {
				ok(assetNative.includes('"k":"before"') && assetNative.includes('"k":"after"'), "ordinary native asset fallback must retain its English labels");
			} else {
				assertText(assetNative, "Before", "native asset fallback");
				assertText(assetNative, "After", "native asset fallback");
			}
			ok(assetNative.includes("deadbeef0123"), "native asset fallback must preserve its Git LFS object ID");
		}
	} finally {
		assetApp.handleInput?.("q");
		await assetCompletion;
	}

	ok(
		mutationCalls.length === 0 && cleanCalls.length === 0 && emptyCalls.length === 0 &&
			noCommitCalls.length === 0 && loadingCalls.length === 0 && assetCalls.length === 0,
		"read-only Git fixture must block every mutation, commit, and AI capability",
	);
	strictEqual(injectionMarker.__zhompGitInjected, false, "hostile display translations must not execute as code");
	console.log(JSON.stringify({
		mode,
		component: "GitTui",
		supported: true,
		nativeAvailable: typeof dirtyApp.describe === "function",
		moduleShape,
		assertions: {
			dirtyAnsiAndNative: true,
			hunkActionsAndNavigation: true,
			helpOpenAndCloseCallback: true,
			cleanCommitAndDiffDataPreserved: true,
			noCommitState: true,
			loadingStateAndDiffContent: true,
			emptyDiffState: true,
			assetFallbackAndObjectIdPreserved: true,
			allGitAndAIWriteCapabilitiesBlocked: true,
			hostileTextWasNotExecuted: mode === "hostile",
		},
	}));
}

await run();