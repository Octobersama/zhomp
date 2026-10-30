import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MenuModule } from "../runtime/menu-catalog";
import type { LaunchConfig } from "../runtime/host";
import { createPtyReplyWriter } from "./terminal-replies";
import { sameFileSystemEntry } from "./verification-fixtures";

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
function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}
const composerLinePattern = /^╰─(?:\s|$)/;

const configPath = process.env.OMP_ZH_CONFIG;
const root = requireString(process.env.PROBE_DIR, "PROBE_DIR");
if (!configPath || !root) throw new Error("The startup UI probe needs launch config and isolated root");
const installDir = dirname(configPath);
// The launch config selects the installed host, so its module paths must be resolved at runtime.
const hostApi = await import(pathToFileURL(join(installDir, "host.ts")).href) as { readLaunchConfig(path: string): LaunchConfig };
const launch = hostApi.readLaunchConfig(configPath);
const native = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-natives", launch.host.packageDir)).href) as { PtySession: new () => PtySession };
const vterm = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-utils/vterm", launch.host.packageDir)).href) as {
	TerminalQueryResponder?: new () => { feed(chunk: string): string };
	default: { Terminal: new (options: { cols: number; rows: number; scrollback: number; disableStdin: boolean }) => VirtualTerminal };
};
const catalog = await import(pathToFileURL(join(installDir, "menu-startup.ts")).href) as { STARTUP_MENU_MODULES: readonly MenuModule[] };
const translator = await import(pathToFileURL(join(installDir, "menu-ui.ts")).href) as { translateMenuSource(source: string, module: MenuModule, dictionary: Readonly<Record<string, string>>): { supported: boolean } };
const dictionary = JSON.parse(readFileSync(launch.dictPath, "utf8")) as Record<string, string>;
const startupModule = catalog.STARTUP_MENU_MODULES.find(module => module.path === "src/modes/interactive-mode.ts");
assert.ok(startupModule, "startup title catalog entry is required");
const interactiveModePath = join(launch.host.packageDir, startupModule.path);
const sourceSupported = translator.translateMenuSource(readFileSync(interactiveModePath, "utf8"), startupModule, dictionary).supported;
const translatedTitle = requireString(dictionary["What's New"], "startup heading translation");
const changelog = readFileSync(join(launch.host.packageDir, "CHANGELOG.md"), "utf8");
const releases = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]).filter((version): version is string => version !== undefined);
const currentReleaseIndex = releases.indexOf(launch.host.version);
assert.notEqual(currentReleaseIndex, -1, `Installed changelog has no release for host ${launch.host.version}`);
const previousRelease = releases[currentReleaseIndex + 1];
assert.ok(previousRelease, `Installed changelog has no prior release for host ${launch.host.version}`);
const markerPathApi = await import(pathToFileURL(Bun.resolveSync("@oh-my-pi/pi-utils", launch.host.packageDir)).href) as { getLastChangelogVersionPath(agentDir: string): string };
mkdirSync(root, { recursive: true });
const networkBlockLog = join(root, "blocked-network.log");
const networkBlocker = join(root, "block-network.cjs");
writeFileSync(networkBlockLog, "");
writeFileSync(networkBlocker, `const fs = require("node:fs");
const log = ${JSON.stringify(networkBlockLog)};
function blocked(kind, host = "") { fs.appendFileSync(log, JSON.stringify({ kind, host }) + "\\n"); throw new Error("Network access is disabled in the startup UI probe"); }
function hostOf(input) { try { return new URL(typeof input === "object" && input !== null && "url" in input ? String(input.url) : String(input)).host; } catch { return "unknown"; } }
globalThis.fetch = (...args) => { blocked("fetch", hostOf(args[0])); return Promise.reject(new Error("Network access is disabled")); };
const net = require("node:net");
const pipePrefix = String.fromCharCode(92, 92, 46, 92) + "pipe" + String.fromCharCode(92);
function localIpc(args) {
	const first = Array.isArray(args[0]) ? args[0][0] : args[0];
	if (first && typeof first === "object" && first.port !== undefined) return false;
	const path = typeof first === "string" ? first : first && typeof first === "object" ? first.path : undefined;
	if (typeof path !== "string") return false;
	return process.platform === "win32" ? path.startsWith(pipePrefix) : path.startsWith("/") && !path.startsWith("//");
}
const nativeConnect = net.connect;
const nativeCreateConnection = net.createConnection;
const nativeSocketConnect = net.Socket.prototype.connect;
net.connect = (...args) => localIpc(args) ? nativeConnect(...args) : blocked("tcp");
net.createConnection = (...args) => localIpc(args) ? nativeCreateConnection(...args) : blocked("tcp");
net.Socket.prototype.connect = function (...args) { return localIpc(args) ? nativeSocketConnect.apply(this, args) : blocked("tcp"); };
const tls = require("node:tls");
tls.connect = (...args) => blocked("tls");
const nativeSpawn = Bun.spawn;
const guardedSpawn = function (...args) {
	const argv = args[0];
	if (Array.isArray(argv) && argv[0] === process.execPath && !argv.includes(__filename)) {
		args[0] = [argv[0], "--preload", __filename, ...argv.slice(1)];
	}
	return nativeSpawn.apply(this, args);
};
Bun.spawn = guardedSpawn;
if (Bun.spawn !== guardedSpawn) throw new Error("Could not guard the startup child process");
fs.appendFileSync(log, JSON.stringify({ kind: "guard", host: "", entry: Bun.main }) + "\\n");
`);

const baseEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
	if (value !== undefined && !/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTHORIZATION|OPENAI|ANTHROPIC|GEMINI|AWS|AZURE|GOOGLE|OLLAMA|OPENROUTER|MODEL)/i.test(key) && !/^OMP_ZH_/.test(key) && !["PI_CONFIG_DIR", "PI_PROFILE", "OMP_PROFILE"].includes(key)) {
		baseEnv[key] = value;
	}
}

async function captureStartup(official: boolean): Promise<{ official: boolean; translated: boolean; sourceSupported: boolean; title: string; changelog: string; guardedEntryPoints: string[]; blockedNetworkAttempts: { fetch: number; tcp: number; tls: number }; blockedFetchHosts: string[] }> {
	const childRoot = join(root, official ? "official" : "translated");
	const childAgentDir = join(childRoot, "agent");
	const cwd = join(childRoot, "work");
	mkdirSync(childAgentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(childAgentDir, "config.yml"), "startup:\n  setupWizard: false\n  quiet: false\n  changelogMode: summary\n  checkUpdate: false\n");
	writeFileSync(markerPathApi.getLastChangelogVersionPath(childAgentDir), `${previousRelease}\n`);
	const env: Record<string, string> = {
		...baseEnv,
		HOME: childRoot,
		USERPROFILE: childRoot,
		APPDATA: childRoot,
		LOCALAPPDATA: childRoot,
		XDG_CONFIG_HOME: childRoot,
		XDG_DATA_HOME: childRoot,
		XDG_CACHE_HOME: childRoot,
		PI_CODING_AGENT_DIR: childAgentDir,
		TERM: "xterm-256color",
		TERM_PROGRAM: "zhomp-startup-smoke",
		COLORTERM: "truecolor",
	};
	const pty = new native.PtySession();
	const terminal = new vterm.default.Terminal({ cols: 160, rows: 50, scrollback: 200, disableStdin: true });
	let completed = false;
	let running: Promise<PtyResult> | undefined;
	const writeReply = createPtyReplyWriter(reply => { if (running && !completed) pty.write(reply); });
	const queryResponder = vterm.TerminalQueryResponder ? new vterm.TerminalQueryResponder() : undefined;
	// Older hosts expose only the full terminal's response stream.
	const legacyReplies = queryResponder ? undefined : terminal.onData(writeReply);
	const ready = Promise.withResolvers<string>();
	let deadline: NodeJS.Timeout | undefined;
	let lastFrame = "";
	const blockedEventsBefore = readFileSync(networkBlockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { kind: string; host: string });
	const title = sourceSupported && !official ? translatedTitle : "What's New";
	try {
		deadline = setTimeout(() => ready.reject(new Error(`Startup UI did not render its changelog (official=${official}):\n${lastFrame}`)), 30_000);
		const entry = official ? launch.host.cliPath : join(installDir, "launch.ts");
		const args = ["--no-install", "--no-env-file", `--config=${join(installDir, "zhomp.toml")}`, "--preload", networkBlocker, entry];
		if (official) args.push("--no-extensions");
		running = pty.startArgv({ application: process.execPath, args, cwd, env, cols: 160, rows: 50, timeoutMs: 40_000 }, (error, chunk) => {
			if (error) { ready.reject(error); return; }
			const replies = queryResponder?.feed(chunk);
			if (replies) writeReply(replies);
			terminal.write(chunk, () => {
				const buffer = terminal.buffer.active;
				lastFrame = Array.from({ length: 50 }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "").join("\n");
				const hasComposer = lastFrame.split("\n").some(line => composerLinePattern.test(line));
				if (lastFrame.includes(title) && lastFrame.includes(`Updated to v${launch.host.version}`) && hasComposer) ready.resolve(lastFrame);
			});
		}).finally(() => { completed = true; });
		const frame = await Promise.race([ready.promise, running.then(result => { throw new Error(`Startup UI exited before a changelog frame (official=${official}, exitCode=${result.exitCode}, timedOut=${result.timedOut}):\n${lastFrame}`); })]);
		clearTimeout(deadline);
		const translated = title !== "What's New" && frame.includes(title);
		if (official || !sourceSupported) assert.ok(frame.includes("What's New"), `Expected the English startup heading:\n${frame}`);
		else assert.ok(translated, `The installed zhomp startup route missed its heading translation:\n${frame}`);
		assert.ok(frame.includes(`Updated to v${launch.host.version}`), `Startup changelog summary changed or is missing:\n${frame}`);
		await Bun.sleep(1_000);
		const composerLine = lastFrame.split("\n").find(line => composerLinePattern.test(line));
		assert.ok(composerLine, `Startup UI did not expose an input composer (official=${official}):\n${lastFrame}`);
		const composerText = composerLine.slice(composerLine.indexOf("╰─") + 2).replace(/\s+⇧⇥.*$/, "").trim();
		assert.equal(composerText, "", `Startup UI input composer was not empty before control exit (official=${official}):\n${lastFrame}`);
		if (!completed) pty.write("\x04");
		const result = await Promise.race([
			running,
			Bun.sleep(8_000).then(() => { throw new Error(`Startup UI did not shut down after its exit request (official=${official}):\n${lastFrame}`); }),
		]);
		assert.equal(result.exitCode, 0, `Unexpected startup PTY exit (${JSON.stringify(result)}):\n${lastFrame}`);
		assert.equal(result.cancelled, false, `Startup PTY was cancelled:\n${lastFrame}`);
		assert.equal(result.timedOut, false, `Startup PTY timed out:\n${lastFrame}`);
		const blockedEvents = readFileSync(networkBlockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { kind: string; host: string; entry?: string });
		const newBlockedEvents = blockedEvents.slice(blockedEventsBefore.length);
		const guardedEntryPoints = [...new Set(newBlockedEvents.flatMap(event => event.kind === "guard" && typeof event.entry === "string" ? [event.entry] : []))];
		const guarded = (entry: string): boolean => guardedEntryPoints.some(path => sameFileSystemEntry(path, entry));
		assert.ok(guarded(official ? launch.host.cliPath : join(installDir, "launch.ts")), "The startup entry must load its network guard");
		assert.ok(guarded(launch.host.cliPath), "The actual OMP child must load its network guard");
		const blockedNetworkAttempts = {
			fetch: newBlockedEvents.filter(event => event.kind === "fetch").length,
			tcp: newBlockedEvents.filter(event => event.kind === "tcp").length,
			tls: newBlockedEvents.filter(event => event.kind === "tls").length,
		};
		const blockedFetchHosts = [...new Set(newBlockedEvents.filter(event => event.kind === "fetch").map(event => event.host))].sort();
		return { official, translated, sourceSupported, title, changelog: `Updated to v${launch.host.version}`, guardedEntryPoints, blockedNetworkAttempts, blockedFetchHosts };
	} finally {
		clearTimeout(deadline);
		if (running && !completed) {
			pty.kill();
			await running;
		}
		legacyReplies?.dispose();
		terminal.dispose();
	}
}

const variants = [await captureStartup(true), await captureStartup(false)];
assert.equal(variants[0]?.translated, false, "Official omp must retain the English startup heading");
console.log(JSON.stringify({ component: "StartupUI", hostVersion: launch.host.version, previousRelease, official: variants[0], translated: variants[1] }));
