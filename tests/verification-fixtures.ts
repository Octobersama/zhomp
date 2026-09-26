import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	const timer = setTimeout(() => {
		child.kill();
		reject(new Error(`Timed out after ${options.timeout ?? 30000}ms: ${command}\n${stdout}\n${stderr}`));
	}, options.timeout ?? 30000);
	child.on("error", error => { clearTimeout(timer); reject(error); });
	child.on("close", code => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr }); });
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
			if (entry.isDirectory()) {
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
	writeText(join(packageDir, "src/cli.ts"), `import {readFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='read') process.stdout.write(readFileSync(args[1],'utf8'));
else if(args[0]==='--version') console.log('omp/${version}');
else if(args[0]==='exit') process.exit(Number(args[1]));
else console.log(JSON.stringify({cwd:process.cwd(),args,dict:process.env.OMP_ZH_DICT,enabled:process.env.OMP_ZH_ENABLED,pidMatches:process.env.OMP_ZH_PROCESS_ID===String(process.pid)}));
`);
	writeText(join(packageDir, "src/config/all-settings.ts"), "export function orderedSettings(){return [];}\n");
	writeText(join(packageDir, "src/config/settings-ui.ts"), "export function createSettingsHost(){return {entries:[]};}\n");
	writeText(join(packageDir, "src/cli-commands.ts"), "export const LAUNCH_FLAG_COMMANDS={launch:true,acp:true}; export function resolveCliArgv(args){return {argv:args.length?args:['launch']};}\n");
	const tui = join(root, "node_modules", "@oh-my-pi", "pi-tui");
	writeText(join(tui, "package.json"), JSON.stringify({
		name: "@oh-my-pi/pi-tui",
		version,
		type: "module",
		exports: { "./*": "./src/*.ts" },
	}));
	writeText(join(tui, "src/overlays/settings-defs.ts"), "export const TAB_METADATA={}; export const TAB_GROUPS={};\n");
	return packageDir;
}
