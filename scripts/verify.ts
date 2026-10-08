import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { discoverPackage, HostNotFoundError, install } from "./install-core";
import { readSupportPolicy } from "../runtime/host";
import type { HostPackage } from "../runtime/host";
import { makeTempDir, removeTree, runCommand, snapshotTree, createHostFixture, writeText } from "../tests/verification-fixtures";
import type { CommandResult } from "../tests/verification-fixtures";

function versionBelow(version: string): string {
	const parts = version.split(".").map(Number);
	assertion(parts.length === 3 && parts.every(Number.isSafeInteger), `cannot derive a prior version from ${version}`);
	const [major, minor, patch] = parts;
	if (patch > 0) return `${major}.${minor}.${patch - 1}`;
	if (minor > 0) return `${major}.${minor - 1}.0`;
	if (major > 0) return `${major - 1}.0.0`;
	throw new Error(`cannot derive a version below ${version}`);
}

function discoverOptionalRealHost(): HostPackage | undefined {
	try {
		return discoverPackage(supported, process.env);
	} catch (error) {
		if (error instanceof HostNotFoundError) return undefined;
		throw error;
	}
}

function discoverRealHost(): HostPackage {
	const host = discoverOptionalRealHost();
	if (!host) throw new Error("SKIP: compatible OMP is not installed and OMP_ZH_PACKAGE_DIR is unset");
	return host;
}

type Status = "PASS" | "FAIL" | "SKIP";
interface Result { id: string; status: Status; detail: string }
type CaseRun = () => Promise<string>;

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const { range: supported, minimumVersion: fixtureVersion } = readSupportPolicy(repoDir);
const bun = process.execPath;
const requested = process.argv.indexOf("--case");
const selected = requested >= 0 ? process.argv[requested + 1]?.toUpperCase() : undefined;
const requireAll = process.argv.includes("--require-all");

function assertion(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function withTemp(name: string, action: (root: string) => Promise<string> | string): Promise<string> {
	const root = makeTempDir(name);
	try { return await action(root); }
	finally { removeTree(root); }
}

async function v01(): Promise<string> {
	const host = discoverRealHost();
	const olderRoot = makeTempDir("zhomp-v01-old");
	try {
		const olderHost = createHostFixture(olderRoot, versionBelow(fixtureVersion));
		const olderHome = join(olderRoot, "home");
		let rejected = false;
		try { install(repoDir, { ...process.env, OMP_ZH_HOME: olderHome, OMP_ZH_PACKAGE_DIR: olderHost }); } catch { rejected = true; }
		assertion(rejected && !existsSync(olderHome), "host below the compatibility range was not rejected before writes");
	} finally { removeTree(olderRoot); }
	return `compatible ${supported}; host=${host.version} at ${host.packageDir}; tui=${host.tuiDir}`;
}

async function v02(): Promise<string> {
	const result = await runCommand(bun, ["test", "tests/translation.test.ts"], { cwd: repoDir });
	assertion(result.exitCode === 0, result.stderr || result.stdout);
	return "translation boundary regression tests passed";
}

async function installFixture(root: string, homeDir: string): Promise<{ packageDir: string; paths: string[] }> {
	const packageDir = createHostFixture(root, fixtureVersion);
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
		const host = discoverOptionalRealHost();
		if (host) {
			const actualHome = join(root, "real-home");
			install(repoDir, { ...process.env, OMP_ZH_HOME: actualHome, OMP_ZH_PACKAGE_DIR: host.packageDir, OMP_ZH_INSTALL_SHELL: "bash" });
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
			assertion(cmd.exitCode === 0 && cmd.stdout.includes(`omp/${fixtureVersion}`), cmd.stderr || cmd.stdout);
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
	const discovered = discoverRealHost();
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
		assertion(result.exitCode === 0 && result.stdout.includes(`omp/${discovered.version}`), result.stderr || result.stdout);
		return `${process.platform}: native installer and installed real-host launcher output omp/${discovered.version}`;
	});
}
async function v06(): Promise<string> {
	return withTemp("zhomp-v06", async root => {
		const home = join(root, "custom-home");
		const { packageDir } = await installFixture(root, home);
		const config = JSON.parse(readFileSync(join(home, ".omp", "zh", "launch.json"), "utf8")) as Record<string, unknown>;
		assertion(existsSync(join(home, ".omp", "zh", "host.ts")), "host.ts was not installed");
		assertion(typeof config.extensionPath === "string" && config.extensionPath.startsWith(home), "extension path escaped custom home");
		assertion(typeof config.dictPath === "string" && config.dictPath.startsWith(home), "dictionary path escaped custom home");
		assertion(config.packageDir === packageDir, "host package path was not persisted");
		assertion(config.supportedRange === supported, "supported range was not persisted");
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
	const result = await runCommand(bun, ["test", "tests/install.test.ts"], { cwd: repoDir, timeout: 150_000 });
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
			const installedHost = join(home, ".omp", "zh", "host.ts");
			assertion(installed.paths.includes(installedHost), "host.ts is missing from the uninstall manifest");
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
	const discovered = discoverRealHost();
	return withTemp("zhomp-v10", async root => {
		const home = join(root, "home");
		const installed = install(repoDir, { ...process.env, OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: discovered.packageDir, OMP_ZH_INSTALL_SHELL: "bash" });
		assertion(installed.packageDir === discovered.packageDir, "real host installation selected a different package");
		const installDir = join(home, ".omp", "zh");
		assertion(existsSync(join(installDir, "model-ui.ts")), "installed model-ui.ts is missing");
		const configPath = join(installDir, "launch.json");
		const command = ["--no-install", "--no-env-file", `--config=${join(repoDir, "runtime", "zhomp.toml")}`, join(repoDir, "tests", "integration-model-surface.ts")];
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: root,
			PI_CONFIG_DIR: relative(homedir(), join(root, "config")),
			OMP_PROFILE: undefined,
			PI_PROFILE: undefined,
			PROBE_DIR: root,
			OMP_ZH_CONFIG: configPath,
		};
		const settingsSurface = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(repoDir, "runtime", "zhomp.toml")}`, join(repoDir, "tests", "integration-surface.ts")], {
			cwd: discovered.packageDir,
			env,
		});
		assertion(settingsSurface.exitCode === 0, settingsSurface.stderr || settingsSurface.stdout);
		assertion(!settingsSurface.stdout.includes("[zhomp] 汉化失败"), settingsSurface.stdout);
		assertion(settingsSurface.stdout.includes("[zhomp] 汉化完成") && settingsSurface.stdout.includes('"loader":true') && settingsSurface.stdout.includes('"component":"SettingsSelectorComponent"'), "real settings loader did not confirm the translated SettingsSelector component");
		const outputs: string[] = [];
		outputs.push(settingsSurface.stdout.trim());
		for (const mode of ["ordinary", "translated", "hostile"] as const) {
			const result = await runCommand(bun, command, {
				cwd: discovered.packageDir,
				env: { ...env, MODEL_SURFACE_MODE: mode },
				timeout: 120_000,
			});
			assertion(result.exitCode === 0, result.stderr || result.stdout);
			assertion(!result.stdout.includes("[zhomp] 汉化失败"), result.stdout);
			assertion(result.stdout.includes(`"mode":"${mode}"`) && result.stdout.includes('"component":"ModelHubComponent"'), `V10 ${mode} process did not confirm the real ModelHub component`);
			assertion(result.stdout.includes('"unrelatedConsumer":"ModelBrowser remains English"'), `V10 ${mode} process globally translated the sibling ModelBrowser`);
			assertion(result.stdout.includes('"roleTag":"SMOL"'), "ModelHub must preserve builtin role names in every language mode");
			if (mode === "ordinary") {
				assertion(result.stdout.includes('"title":"Models"') && result.stdout.includes('"roleTag":"SMOL"'), "the mismatched-PID process must retain the original ModelHub text");
			} else {
				assertion(result.stdout.includes("[zhomp] 汉化完成"), result.stdout);
				assertion(result.stdout.includes('"configWrites":0'), "the translated probe must not persist user settings");
				assertion(result.stdout.includes(`"nativeDescribe":"covered@${discovered.version}"`) || result.stdout.includes(`"nativeDescribe":"unavailable@${discovered.version}"`), `native describe capability evidence is missing for OMP ${discovered.version}`);
				if (mode === "hostile") {
					assertion(result.stdout.includes("__zhompModelUiInjected") && result.stdout.includes('"injectionSideEffect":false'), "hostile dictionary text was not displayed literally or caused code execution");
				} else {
					assertion(result.stdout.includes('"model":"Models/Roles"'), "the real ModelHub consumer changed model or selector identities");
				}
			}
			outputs.push(result.stdout.trim());
		}
		return outputs.join("\n");
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
		for (const file of ["README.md", "INSTALL.md", "LICENSE", "CHANGELOG.md", "runtime/host.ts", "runtime/launch.ts", "runtime/model-ui.ts", "runtime/zhomp.toml", "scripts/install.ts", "scripts/install-core.ts", "scripts/install.ps1", "scripts/install.sh", "scripts/uninstall.ps1", "scripts/uninstall.sh", "extensions/zhomp.ts", "dict/zh-CN.json"]) {
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
		const host = discoverRealHost();
		const installedHome = join(root, "installed");
		const actualInstall = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(packageRoot, "runtime", "zhomp.toml")}`, join(packageRoot, "scripts", "install.ts")], {
			cwd: packageRoot, env: { ...process.env, OMP_ZH_HOME: installedHome, OMP_ZH_PACKAGE_DIR: host.packageDir },
		});
		assertion(actualInstall.exitCode === 0, actualInstall.stderr || actualInstall.stdout);
		assertion(existsSync(join(installedHome, ".omp", "zh", "host.ts")), "installed host.ts is missing");
		assertion(existsSync(join(installedHome, ".omp", "zh", "model-ui.ts")), "installed model-ui.ts is missing");
		assertion(existsSync(join(installedHome, ".omp", "zh", "launch.json")), "installed launch.json is missing");
		const version = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(installedHome, ".omp", "zh", "zhomp.toml")}`, join(installedHome, ".omp", "zh", "launch.ts"), "--version"], { cwd: root });
		assertion(version.exitCode === 0 && version.stdout.includes(`omp/${host.version}`), version.stderr || version.stdout);
		return "tarball includes model-ui.ts and the unpacked installer publishes and launches the complete runtime";
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
