import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Bounded subprocess execution that drains both output streams. */
export function runCommand(
	command: string,
	args: readonly string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<CommandResult> {
	const { promise, resolve, reject } = Promise.withResolvers<CommandResult>();
	const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", chunk => { stdout += String(chunk); });
	child.stderr.on("data", chunk => { stderr += String(chunk); });
	const timeout = setTimeout(() => {
		child.kill();
	}, options.timeout ?? 30000);
	child.on("error", error => { clearTimeout(timeout); reject(error); });
	child.on("close", code => { clearTimeout(timeout); resolve({ exitCode: code ?? 1, stdout, stderr }); });
	return promise;
}

export function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTree(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

export function writeText(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

/** Paths and file bytes are the rollback contract; directory timestamps are ignored. */
export function snapshotTree(root: string): Record<string, string> {
	const result: Record<string, string> = {};
	function visit(dir: string): void {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const file = join(dir, entry.name);
			const key = relative(root, file).replaceAll("\\", "/");
			if (entry.isSymbolicLink()) {
				result[key] = `symlink:${readlinkSync(file)}`;
			} else if (entry.isDirectory()) {
				result[`${key}/`] = "directory";
				visit(file);
			} else if (entry.isFile()) {
				result[key] = createHash("sha256").update(readFileSync(file)).digest("hex");
			}
		}
	}
	visit(root);
	return result;
}

/** Minimal host for process-boundary checks, never counted as real OMP/TUI proof. */
export function createHostFixture(root: string, version: string): string {
	const packageDir = join(root, "node_modules", "@oh-my-pi", "pi-coding-agent");
	writeText(join(packageDir, "package.json"), JSON.stringify({
		name: "@oh-my-pi/pi-coding-agent",
		version,
		type: "module",
		exports: { "./*": "./src/*.ts" },
		dependencies: { "@oh-my-pi/pi-tui": version },
	}));
	writeText(join(packageDir, "src/cli.ts"), `import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "read") {
	process.stdout.write(readFileSync(args[1], "utf8"));
} else if (args[0] === "--version") {
	console.log("omp/${version}");
} else if (args[0] === "exit") {
	process.exit(Number(args[1]));
} else {
	console.log(JSON.stringify({
		cwd: process.cwd(),
		args,
		dict: process.env.OMP_ZH_DICT,
		config: process.env.OMP_ZH_CONFIG,
		enabled: process.env.OMP_ZH_ENABLED,
		pidMatches: process.env.OMP_ZH_PROCESS_ID === String(process.pid),
		packageDir: process.env.OMP_ZH_PACKAGE_DIR,
		tuiPackageDir: process.env.OMP_ZH_TUI_PACKAGE_DIR,
		supportedRange: process.env.OMP_ZH_SUPPORTED_RANGE,
		bootstrapCwd: process.env.OMP_ZH_BOOTSTRAP_CWD,
		launcherParentPid: process.env.OMP_ZH_LAUNCHER_PARENT_PID,
	}));
}
`);
	writeText(join(packageDir, "src/config/all-settings.ts"), "export function orderedSettings(){return [];}");
	writeText(join(packageDir, "src/config/settings-ui.ts"), "export function createSettingsHost(){return {entries:[]};}");
	writeText(join(packageDir, "src/cli-commands.ts"), `export const LAUNCH_FLAG_COMMANDS={launch:true,acp:true};
const commands = { read: true, exit: true, inspect: true, "--version": true };
export function resolveCliArgv(args: string[]) {
	if (Object.hasOwn(commands, args[0]) || args[0] === "launch" || args[0] === "acp") return { argv: args };
	return { argv: ["launch", ...args] };
}
`);
	writeText(join(packageDir, "src/cli/args.ts"), `export function parseArgs(args: string[]) {
	let noExtensions = false;
	for (let i = 0; i < args.length; i++) {
		const token = args[i];
		if (token === "--") break;
		const equals = token.indexOf("=");
		const name = equals < 0 ? token : token.slice(0, equals);
		if (name === "--no-extensions") noExtensions = true;
		else if (name === "--system-prompt" && equals < 0 && i + 1 < args.length) i++;
	}
	return { noExtensions };
}
`);
	const tui = join(root, "node_modules", "@oh-my-pi", "pi-tui");
	writeText(join(tui, "package.json"), JSON.stringify({
		name: "@oh-my-pi/pi-tui",
		version,
		type: "module",
		exports: { "./*": "./src/*.ts" },
	}));
	writeText(join(tui, "src/overlays/settings-defs.ts"), "export const TAB_METADATA={}; export const TAB_GROUPS={};\n");
	writeText(join(tui, "src/overlays/model-hub.ts"), "export class ModelHubComponent {}\n");
	return packageDir;
}
