import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LaunchConfig } from "../runtime/host";
import { runCommand } from "./verification-fixtures";
import { createPtyReplyWriter } from "./terminal-replies";

interface PtyResult { exitCode?: number; cancelled: boolean; timedOut: boolean }
interface PtySession {
	startArgv(options: { application: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number; timeoutMs: number }, onChunk: (error: Error | null, chunk: string) => void): Promise<PtyResult>;
	write(data: string): void;
	kill(): void;
}
interface TerminalBuffer {
	viewportY: number;
	getLine(row: number): { translateToString(trim: boolean): string } | undefined;
}
interface VirtualTerminal {
	buffer: { active: TerminalBuffer };
	write(data: string, committed: () => void): void;
	onData(listener: (data: string) => void): { dispose(): void };
	dispose(): void;
}
const configPath = process.env.OMP_ZH_CONFIG;
const root = process.env.PROBE_DIR;
if (!configPath || !root) throw new Error("The installed Git CLI probe needs launch config and isolated root");
const probeRoot: string = root;
const installDir = dirname(configPath);
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as { readLaunchConfig(path: string): LaunchConfig };
const launch = hostApi.readLaunchConfig(configPath);
const native = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-natives", launch.host.packageDir)).href) as { PtySession: new () => PtySession };
const vterm = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-utils/vterm", launch.host.packageDir)).href) as {
	TerminalQueryResponder?: new () => { feed(chunk: string): string };
	default: { Terminal: new (options: { cols: number; rows: number; scrollback: number; disableStdin: boolean }) => VirtualTerminal };
};
const catalogue = await import(pathToFileURL(join(installDir, "menu-catalog.ts")).href) as { MENU_MODULES: readonly import("../runtime/menu-catalog").MenuModule[] };
const translator = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as { translateMenuSource(source: string, module: import("../runtime/menu-catalog").MenuModule, dictionary: Readonly<Record<string, string>>): { supported: boolean } };
const dictionary = JSON.parse(readFileSync(launch.dictPath, "utf8")) as Record<string, string>;
const gitUi = catalogue.MENU_MODULES.find(module => module.root === "tui" && module.path === "src/apps/git/git-tui.ts");
const sourceSupported = gitUi !== undefined && translator.translateMenuSource(readFileSync(join(launch.host.tuiDir, gitUi.path), "utf8"), gitUi, dictionary).supported;
const translatedBadge = dictionary.Untracked;
assert.ok(typeof translatedBadge === "string" && translatedBadge.length > 0, "The shipped Git dictionary must cover Untracked");
const emptyConfig = join(root, "empty.gitconfig");
writeFileSync(emptyConfig, "");
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
	if (value !== undefined && !/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTHORIZATION)/i.test(key) && !/^OMP_ZH_/.test(key)) env[key] = value;
}
Object.assign(env, { TERM: "xterm-256color", TERM_PROGRAM: "zhomp-smoke", COLORTERM: "truecolor", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig });

async function captureGit(official: boolean): Promise<{ official: boolean; translated: boolean; exitCode: number | undefined; sourceSupported: boolean }> {
	const fixture = join(probeRoot, official ? "official-repo" : "translated-repo");
	mkdirSync(fixture, { recursive: true });
	const initialized = await runCommand("git", ["init", "-q", "--initial-branch=fixture-branch"], { cwd: fixture, env });
	assert.equal(initialized.exitCode, 0, initialized.stderr);
	writeFileSync(join(fixture, "fixture.txt"), "Settings high provider/id\n");
	const pty = new native.PtySession();
	const terminal = new vterm.default.Terminal({ cols: 160, rows: 50, scrollback: 200, disableStdin: true });
	let completed = false;
	let running: Promise<PtyResult> | undefined;
	const writeReply = createPtyReplyWriter(data => { if (running && !completed) pty.write(data); });
	const queryResponder = vterm.TerminalQueryResponder ? new vterm.TerminalQueryResponder() : undefined;
	const replies = queryResponder ? undefined : terminal.onData(writeReply);
	const ready = Promise.withResolvers<string>();
	let deadline: NodeJS.Timeout | undefined;
	let lastFrame = "";
	try {
		deadline = setTimeout(() => ready.reject(new Error(`Git CLI did not render its read-only fixture:\n${lastFrame}`)), 35_000);
		const entry = official ? launch.host.cliPath : join(installDir, "launch.ts");
		running = pty.startArgv({ application: process.execPath, args: ["--no-install", "--no-env-file", `--config=${join(installDir, "zhomp.toml")}`, entry, "git", "-C", fixture], cwd: fixture, env, cols: 160, rows: 50, timeoutMs: 50_000 }, (error, chunk) => {
			if (error) { ready.reject(error); return; }
			const reply = queryResponder?.feed(chunk);
			if (reply) writeReply(reply);
			terminal.write(chunk, () => {
				const buffer = terminal.buffer.active;
				lastFrame = Array.from({ length: 50 }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "").join("\n");
				if (lastFrame.includes("fixture.txt") && lastFrame.includes("fixture-branch") && lastFrame.includes("Settings high provider/id") &&
					(lastFrame.includes("Untracked") || lastFrame.includes(translatedBadge))) ready.resolve(lastFrame);
			});
		}).finally(() => { completed = true; });
		const frame = await Promise.race([ready.promise, running.then(result => { throw new Error(`Git CLI exited before a frame (${result.exitCode}):\n${lastFrame}`); })]);
		clearTimeout(deadline);
		// The fixture is an untracked file, so assert its own badge rather than an unrelated section heading.
		const translated = frame.includes(translatedBadge);
		const expectedBadge = official || !sourceSupported ? "Untracked" : translatedBadge;
		assert.ok(frame.includes(expectedBadge), `Git CLI missed its expected ${JSON.stringify(expectedBadge)} badge:\n${frame}`);
		assert.equal(official && translated, false, "Official omp git must retain English copy");
		pty.write("q");
		const result = await running;
		assert.equal(result.exitCode, 0, JSON.stringify(result));
		assert.equal(result.cancelled, false);
		assert.equal(result.timedOut, false);
		const status = await runCommand("git", ["status", "--porcelain"], { cwd: fixture, env });
		assert.equal(status.stdout.trim(), "?? fixture.txt", "Read-only Git UI navigation changed the index or working tree");
		return { official, translated, exitCode: result.exitCode, sourceSupported };
	} finally {
		clearTimeout(deadline);
		if (running && !completed) {
			pty.write("\x03");
			await Promise.race([running, Bun.sleep(1500)]);
			if (!completed) pty.kill();
			await running;
		}
		replies?.dispose();
		terminal.dispose();
	}
}
console.log(JSON.stringify({ component: "GitCLI", hostVersion: launch.host.version, variants: [await captureGit(true), await captureGit(false)] }));
