import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { discoverPackage, install, supportedVersion, validatePackage } from "./install-core";
import { makeTempDir, removeTree, runCommand, snapshotTree, createHostFixture, writeText } from "../tests/verification-fixtures";
import type { CommandResult } from "../tests/verification-fixtures";

type Status = "PASS" | "FAIL" | "SKIP";
interface Result { id: string; status: Status; detail: string }
type CaseRun = () => Promise<string>;

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const supported = supportedVersion(repoDir);
const bun = process.execPath;
const requested = process.argv.indexOf("--case");
const selected = requested >= 0 ? process.argv[requested + 1]?.toUpperCase() : undefined;
const requireAll = process.argv.includes("--require-all");

function assertion(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function realHostDir(): string | undefined {
	const explicit = process.env.OMP_ZH_PACKAGE_DIR;
	if (explicit) return resolve(explicit);
	const candidate = join(process.env.USERPROFILE || process.env.HOME || "", ".bun", "install", "global", "node_modules", "@oh-my-pi", "pi-coding-agent");
	return existsSync(candidate) ? candidate : undefined;
}

async function withTemp(name: string, action: (root: string) => Promise<string> | string): Promise<string> {
	const root = makeTempDir(name);
	try { return await action(root); }
	finally { removeTree(root); }
}

async function v01(): Promise<string> {
	assertion(supported === "18.3.2", `expected exact peer 18.3.2, found ${supported}`);
	const host = realHostDir();
	if (!host) throw new Error("SKIP: OMP 18.3.2 is not installed and OMP_ZH_PACKAGE_DIR is unset");
	const validated = validatePackage(host, supported);
	assertion(validated.version === supported, "real host version mismatch");
	const rejection = await runCommand(bun, ["test", "tests/install.test.ts", "--test-name-pattern", "rejects adjacent versions"], { cwd: repoDir });
	assertion(rejection.exitCode === 0, rejection.stderr || rejection.stdout);
	return `exact ${supported}; host=${validated.packageDir}; tui=${validated.tuiDir}`;
}

async function v02(): Promise<string> {
	const result = await runCommand(bun, ["test", "tests/translation.test.ts"], { cwd: repoDir });
	assertion(result.exitCode === 0, result.stderr || result.stdout);
	return "translation boundary regression tests passed";
}

async function installFixture(root: string, homeDir: string): Promise<{ packageDir: string; paths: string[] }> {
	const packageDir = createHostFixture(root, supported);
	const result = install(repoDir, { ...process.env, OMP_ZH_HOME: homeDir, OMP_ZH_PACKAGE_DIR: packageDir, OMP_ZH_INSTALL_SHELL: "bash" });
	return { packageDir, paths: result.paths };
}

async function v03(): Promise<string> {
	return withTemp("zhomp-v03", async root => {
		const home = join(root, "home");
		const project = join(root, "project");
		mkdirSync(project, { recursive: true });
		writeText(join(project, "marker.txt"), "project-cwd-marker\n");
		await installFixture(root, home);
		const launch = join(home, ".omp", "zh", "launch.ts");
		const config = `--config=${join(home, ".omp", "zh", "zhomp.toml")}`;
		const read = await runCommand(bun, ["--no-install", "--no-env-file", config, launch, "read", "./marker.txt"], { cwd: project });
		assertion(read.exitCode === 0 && read.stdout === "project-cwd-marker\n", read.stderr || `wrong read output: ${read.stdout}`);
		const state = await runCommand(bun, ["--no-install", "--no-env-file", config, launch, "launch"], { cwd: project, env: { ...process.env, OMP_ZH_BOOTSTRAP_CWD: "invalid-external-value", OMP_ZH_LAUNCHER_PARENT_PID: "-1" } });
		assertion(state.exitCode === 0, state.stderr);
		const observed: unknown = JSON.parse(state.stdout.trim());
		assertion(observed !== null && typeof observed === "object" && "cwd" in observed && observed.cwd === project, "launcher did not restore project cwd");
		assertion("enabled" in observed && observed.enabled === "1" && "pidMatches" in observed && observed.pidMatches === true, "launcher authorization was not process-bound");
		writeText(join(project, "bunfig.toml"), 'preload = ["./missing-project-preload.ts"]\n');
		const isolated = await runCommand(bun, ["--no-install", "--no-env-file", config, launch, "read", "./marker.txt"], { cwd: project });
		assertion(isolated.exitCode === 0 && isolated.stdout === "project-cwd-marker\n", "project Bun preload leaked into launcher");
		const host = realHostDir();
		if (host) {
			const actualHome = join(root, "real-home");
			install(repoDir, { ...process.env, OMP_ZH_HOME: actualHome, OMP_ZH_PACKAGE_DIR: host, OMP_ZH_INSTALL_SHELL: "bash" });
			const actual = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(actualHome, ".omp", "zh", "zhomp.toml")}`, join(actualHome, ".omp", "zh", "launch.ts"), "read", "./marker.txt"], {
				cwd: project,
				env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), PI_CONFIG_DIR: relative(homedir(), join(root, "config")), OMP_PROFILE: undefined, PI_PROFILE: undefined },
			});
			assertion(actual.exitCode === 0 && actual.stdout.includes("project-cwd-marker"), actual.stderr || actual.stdout);
		}
		return "fixture read and launch observed the caller cwd and process-bound authorization";
	});
}

async function v04(): Promise<string> {
	return withTemp("zhomp 路径 [1]", async root => {
		const home = join(root, "用户 home [1] $ ` % ! (test)");
		await installFixture(root, home);
		const launch = join(home, ".omp", "zh", "launch.ts");
		const config = `--config=${join(home, ".omp", "zh", "zhomp.toml")}`;
		const result = await runCommand(bun, ["--no-install", "--no-env-file", config, launch, "exit", "37"], { cwd: root });
		assertion(result.exitCode === 37, `exit code was ${result.exitCode}: ${result.stderr}`);
		if (process.platform === "win32") {
			const ps = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell";
			const launcher = join(home, ".bun", "bin", "zhomp.cmd");
			const command = `& '${launcher.replaceAll("'", "''")}' --version; exit $LASTEXITCODE`;
			const encoded = Buffer.from(command, "utf16le").toString("base64");
			const cmd = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { cwd: root });
			assertion(cmd.exitCode === 0 && cmd.stdout.includes(`omp/${supported}`), cmd.stderr || cmd.stdout);
			const values = ["inspect", "two words", "中文", "$value", "`literal`", "100%", "bang!", "(paren)", "[bracket]"];
			const inspectCommand = `& '${launcher.replaceAll("'", "''")}' ${values.map(value => `'${value.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
			const argsResult = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(inspectCommand, "utf16le").toString("base64")], { cwd: root });
			assertion(argsResult.exitCode === 0, argsResult.stderr || argsResult.stdout);
			const received = JSON.parse(argsResult.stdout.trim()) as { args: string[] };
			assertion(JSON.stringify(received.args) === JSON.stringify(values), `cmd changed arguments: ${JSON.stringify(received.args)}`);
		}
		return "Unicode/space path and exit-code forwarding passed";
	});
}

async function v05(): Promise<string> {
	const host = realHostDir();
	if (!host) throw new Error("SKIP: install the supported OMP package for native package-discovery verification");
	const discovered = discoverPackage(supported, { ...process.env, OMP_ZH_PACKAGE_DIR: host });
	return withTemp("zhomp-v05", async root => {
		const discovery = await runCommand(bun, ["test", "tests/install.test.ts", "--test-name-pattern", "configured global"], { cwd: repoDir });
		assertion(discovery.exitCode === 0, discovery.stderr || discovery.stdout);
		const env = { ...process.env, OMP_ZH_HOME: root, OMP_ZH_PACKAGE_DIR: discovered.packageDir };
		const windows = process.platform === "win32";
		const command = windows ? join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "bash";
		const args = windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repoDir, "scripts", "install.ps1")] : [join(repoDir, "scripts", "install.sh")];
		const installed = await runCommand(command, args, { cwd: repoDir, env });
		assertion(installed.exitCode === 0, installed.stderr || installed.stdout);
		const launch = join(root, ".omp", "zh", "launch.ts");
		const result = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(root, ".omp", "zh", "zhomp.toml")}`, launch, "--version"], { cwd: root });
		assertion(result.exitCode === 0 && result.stdout.includes(`omp/${supported}`), result.stderr || result.stdout);
		return `${process.platform}: native installer and installed real-host launcher output omp/${supported}`;
	});
}

async function v06(): Promise<string> {
	return withTemp("zhomp-v06", async root => {
		const home = join(root, "custom-home");
		await installFixture(root, home);
		const config = JSON.parse(readFileSync(join(home, ".omp", "zh", "launch.json"), "utf8")) as Record<string, unknown>;
		assertion(typeof config.extensionPath === "string" && config.extensionPath.startsWith(home), "extension path escaped custom home");
		assertion(typeof config.dictPath === "string" && config.dictPath.startsWith(home), "dictionary path escaped custom home");
		assertion(typeof config.tuiPackageDir === "string", "TUI package path was not persisted");
		const custom = join(root, "custom-dict.json");
		writeText(custom, '{"Theme":"自定义主题"}');
		const result = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(home, ".omp", "zh", "zhomp.toml")}`, join(home, ".omp", "zh", "launch.ts"), "inspect"], {
			cwd: root,
			env: { ...process.env, OMP_ZH_DICT: "custom-dict.json" },
		});
		assertion(result.exitCode === 0, result.stderr);
		const observed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
		assertion(observed.dict === custom, "explicit relative dictionary did not take precedence");
		return "custom home owns extension, dictionary and launch configuration";
	});
}

async function v07(): Promise<string> {
	const result = await runCommand(bun, ["test", "tests/install.test.ts"], { cwd: repoDir });
	assertion(result.exitCode === 0, result.stderr || result.stdout);
	return "all publish failure points, exact version rejection, discovery and reinstall regressions passed";
}

async function v08(): Promise<string> {
	for (const file of ["scripts/install.sh", "scripts/uninstall.sh"]) {
		const bytes = readFileSync(join(repoDir, file));
		assertion(!bytes.includes(Buffer.from("\r\n")), `${file} contains CRLF`);
	}
	const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
	if (!existsSync(bash) && process.platform === "win32") throw new Error("SKIP: Git Bash is unavailable");
	for (const file of ["scripts/install.sh", "scripts/uninstall.sh"]) {
		const result = await runCommand(bash, ["-n", file], { cwd: repoDir });
		assertion(result.exitCode === 0, result.stderr);
	}
	return "both shell scripts are LF and parse in the available Bash";
}

async function v09(): Promise<string> {
	return withTemp("zhomp-v09", async root => {
		const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
		const shells = process.platform === "win32" ? ["powershell", "bash"] : ["bash"];
		for (const shell of shells) {
			if (shell === "bash" && process.platform === "win32" && !existsSync(bash)) throw new Error("SKIP: Git Bash unavailable for cross-shell uninstall");
			const home = join(root, `${shell} home [1]`);
			const installed = await installFixture(join(root, shell), home);
			writeText(join(home, ".omp", "zh", "user.txt"), "keep");
			writeText(join(home, ".omp", "zh", ".hidden"), "hidden");
			writeText(join(home, ".omp", "zh", "child", "nested"), "nested");
			const command = shell === "powershell" ? join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : bash;
			const args = shell === "powershell" ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repoDir, "scripts", "uninstall.ps1")] : [join(repoDir, "scripts", "uninstall.sh")];
			const env = { ...process.env, OMP_ZH_HOME: home };
			for (let repeat = 0; repeat < 2; repeat++) {
				const result = await runCommand(command, args, { env });
				assertion(result.exitCode === 0, result.stderr || result.stdout);
				for (const path of installed.paths) assertion(!existsSync(path), `owned file remains: ${path}`);
				assertion(existsSync(join(home, ".omp", "zh")), "uninstall removed the directory containing user files");
				assertion(readFileSync(join(home, ".omp", "zh", "user.txt"), "utf8") === "keep", "side file changed");
				assertion(readFileSync(join(home, ".omp", "zh", ".hidden"), "utf8") === "hidden", "hidden file changed");
				assertion(readFileSync(join(home, ".omp", "zh", "child", "nested"), "utf8") === "nested", "subdirectory changed");
			}
		}
		return "native uninstallers removed all owned files twice and preserved normal/hidden/nested user files";
	});
}

async function v10(): Promise<string> {
	const host = realHostDir();
	if (!host) throw new Error("SKIP: real OMP 18.3.2 host is unavailable");
	const validated = validatePackage(host, supported);
	return withTemp("zhomp-v10", async root => {
		const result = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(repoDir, "runtime", "zhomp.toml")}`, join(repoDir, "tests", "integration-surface.ts")], {
			cwd: validated.packageDir,
			env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_CONFIG_DIR: relative(homedir(), join(root, "config")), OMP_PROFILE: undefined, PI_PROFILE: undefined, PROBE_DIR: root, PROBE_EXTENSION: join(repoDir, "extensions", "zhomp.ts"), OMP_ZH_PACKAGE_DIR: validated.packageDir, OMP_ZH_TUI_PACKAGE_DIR: validated.tuiDir, OMP_ZH_SUPPORTED_VERSION: supported, OMP_ZH_DICT: join(repoDir, "dict", "zh-CN.json") },
		});
		assertion(result.exitCode === 0, result.stderr || result.stdout);
		return result.stdout.trim();
	});
}

async function v11(): Promise<string> {
	return withTemp("zhomp-v11", async root => {
		const packed = await runCommand(bun, ["pm", "pack", "--ignore-scripts", "--destination", root], { cwd: repoDir });
		assertion(packed.exitCode === 0, packed.stderr || packed.stdout);
		const archive = join(root, `zhomp-${JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")).version}.tgz`);
		assertion(existsSync(archive), `package archive missing: ${archive}`);
		const extract = join(root, "extract");
		mkdirSync(extract);
		const tar = await runCommand("tar", ["-xzf", archive, "-C", extract]);
		assertion(tar.exitCode === 0, tar.stderr);
		const packageRoot = join(extract, "package");
		for (const file of ["README.md", "INSTALL.md", "LICENSE", "CHANGELOG.md", "runtime/launch.ts", "runtime/zhomp.toml", "scripts/install.ts", "scripts/install-core.ts", "scripts/install.ps1", "scripts/install.sh", "scripts/uninstall.ps1", "scripts/uninstall.sh", "extensions/zhomp.ts", "dict/zh-CN.json"]) {
			assertion(existsSync(join(packageRoot, file)), `packed file missing: ${file}`);
		}
		assertion(!existsSync(join(packageRoot, "IMPROVEMENT_PLAN.md")), "review report leaked into package");
		const help = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(packageRoot, "runtime", "zhomp.toml")}`, join(packageRoot, "scripts", "install.ts"), "--help"], { cwd: packageRoot });
		assertion(help.exitCode === 0 && help.stdout.includes("Usage:"), help.stderr || help.stdout);
		for (const document of ["README.md", "INSTALL.md"]) {
			const text = readFileSync(join(packageRoot, document), "utf8");
			for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
				const target = match[1];
				if (!target.includes(":") && !target.startsWith("#")) assertion(existsSync(join(packageRoot, target.split("#")[0])), `broken packed link: ${target}`);
			}
		}
		const host = realHostDir();
		if (!host) throw new Error("SKIP: real host unavailable for tarball installation");
		const installedHome = join(root, "installed");
		const actualInstall = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(packageRoot, "runtime", "zhomp.toml")}`, join(packageRoot, "scripts", "install.ts")], {
			cwd: packageRoot, env: { ...process.env, OMP_ZH_HOME: installedHome, OMP_ZH_PACKAGE_DIR: host },
		});
		assertion(actualInstall.exitCode === 0, actualInstall.stderr || actualInstall.stdout);
		const version = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(installedHome, ".omp", "zh", "zhomp.toml")}`, join(installedHome, ".omp", "zh", "launch.ts"), "--version"], { cwd: root });
		assertion(version.exitCode === 0 && version.stdout.includes(`omp/${supported}`), version.stderr || version.stdout);
		return "tarball contains every runtime/user document and its install command executes";
	});
}

const cases: Record<string, CaseRun> = { V01: v01, V02: v02, V03: v03, V04: v04, V05: v05, V06: v06, V07: v07, V08: v08, V09: v09, V10: v10, V11: v11 };
const ids = selected ? [selected] : Object.keys(cases);
if (selected && !cases[selected]) {
	console.error(`Unknown verification case: ${selected}`);
	process.exit(2);
}
const results: Result[] = [];
for (const id of ids) {
	try { results.push({ id, status: "PASS", detail: await cases[id]() }); }
	catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		results.push({ id, status: detail.startsWith("SKIP: ") ? "SKIP" : "FAIL", detail: detail.replace(/^SKIP: /, "") });
	}
}
for (const result of results) console.log(`${result.status} ${result.id} ${result.detail}`);
const failed = results.some(result => result.status === "FAIL" || (requireAll && result.status === "SKIP"));
if (failed) process.exitCode = 1;
