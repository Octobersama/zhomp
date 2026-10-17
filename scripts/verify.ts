import { readFileSync, existsSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { discoverPackage, expectedInstallationPaths, HostNotFoundError, install } from "./install-core";
import { readSupportPolicy } from "../runtime/host";
import type { HostPackage } from "../runtime/host";
import { makeTempDir, removeTree, runCommand, sameFileSystemEntry, snapshotTree, createHostFixture, writeText } from "../tests/verification-fixtures";
import type { Env } from "./install-core";
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

function assertManifestInstalled(repoDir: string, env: Env): void {
	for (const path of expectedInstallationPaths(repoDir, env)) {
		assertion(existsSync(path), `manifest artifact was not installed: ${path}`);
	}
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
		assertion(observed !== null && typeof observed === "object" && "cwd" in observed && typeof observed.cwd === "string" && sameFileSystemEntry(observed.cwd, project), "launcher did not restore project cwd");
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
		assertManifestInstalled(repoDir, { ...process.env, OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: packageDir, OMP_ZH_INSTALL_SHELL: "bash" });
		const config = JSON.parse(readFileSync(join(home, ".omp", "zh", "launch.json"), "utf8")) as Record<string, unknown>;
		const canonicalHomePrefix = `${realpathSync(home)}${sep}`;
		assertion(typeof config.extensionPath === "string" && realpathSync(config.extensionPath).startsWith(canonicalHomePrefix), "extension path escaped custom home");
		assertion(typeof config.dictPath === "string" && realpathSync(config.dictPath).startsWith(canonicalHomePrefix), "dictionary path escaped custom home");
		assertion(typeof config.packageDir === "string" && sameFileSystemEntry(config.packageDir, packageDir), "host package path was not persisted");
		assertion(config.supportedRange === supported, "supported range was not persisted");
		const custom = join(root, "custom-dict.json");
		writeText(custom, '{"Theme":"自定义主题"}');
		const result = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(home, ".omp", "zh", "zhomp.toml")}`, join(home, ".omp", "zh", "launch.ts"), "inspect"], {
			cwd: root,
			env: { ...process.env, OMP_ZH_DICT: "custom-dict.json" },
		});
		assertion(result.exitCode === 0, result.stderr);
		const observed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
		assertion(typeof observed.dict === "string" && sameFileSystemEntry(observed.dict, custom), "explicit relative dictionary did not take precedence");
		return "custom home owns every manifest artifact and resolves its configured paths";
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
	const manifest = readFileSync(join(repoDir, "install-manifest.tsv"));
	assertion(!manifest.includes(Buffer.from("\r")), "install-manifest.tsv must use LF line endings");
	const powershellUninstaller = readFileSync(join(repoDir, "scripts", "uninstall.ps1"));
	assertion(!powershellUninstaller.includes(Buffer.from("\r")), "scripts/uninstall.ps1 must use LF line endings");
	const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
	if (!existsSync(bash) && process.platform === "win32") throw new Error("SKIP: Git Bash is unavailable");
	for (const file of ["scripts/install.sh", "scripts/uninstall.sh"]) {
		const result = await runCommand(bash, ["-n", file], { cwd: repoDir });
		assertion(result.exitCode === 0, result.stderr);
	}
	return "Bash scripts parse, and the manifest and PowerShell uninstaller use LF line endings";
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
				const result = await runCommand(command, args, { env, cwd: root });
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

type ModelSurfaceMode = "ordinary" | "translated" | "hostile";

function installedProbeEnvironment(probeRoot: string, launchConfigPath: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.PI_CODING_AGENT_DIR = probeRoot;
	env.PI_CONFIG_DIR = relative(homedir(), join(probeRoot, "config"));
	env.OMP_PROFILE = undefined;
	env.PI_PROFILE = undefined;
	env.OMP_ZH_DICT = undefined;
	env.PROBE_DIR = probeRoot;
	env.OMP_ZH_CONFIG = launchConfigPath;
	return env;
}

async function verifyInstalledSettingsSurface(host: HostPackage, env: NodeJS.ProcessEnv): Promise<string> {
	const result = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(repoDir, "runtime", "zhomp.toml")}`, join(repoDir, "tests", "integration-surface.ts")], {
		cwd: host.packageDir,
		env,
	});
	assertion(result.exitCode === 0, result.stderr || result.stdout);
	const surface: unknown = JSON.parse(result.stdout.trim());
	assertion(surface !== null && typeof surface === "object" && !Array.isArray(surface), "real settings integration must emit a clean structured surface result");
	assertion(
		"loader" in surface && surface.loader === true &&
		"component" in surface && surface.component === "SettingsSelectorComponent" &&
		"label" in surface && surface.label === "深色主题",
		"real settings selector must surface translated UI text",
	);
	assertion(
		"slash" in surface && surface.slash !== null && typeof surface.slash === "object" && !Array.isArray(surface.slash),
		"real extension lifecycle must surface its slash autocomplete result",
	);
	const slashSurface = surface.slash;
	assertion(
		"registered" in slashSurface && slashSurface.registered === true &&
		"description" in slashSurface && typeof slashSurface.description === "string" && slashSurface.description !== "Open settings menu" &&
		"accepted" in slashSurface && slashSurface.accepted === "/settings " &&
		"errorNotification" in slashSurface && slashSurface.errorNotification === true,
		"real slash UI must translate display text, preserve the selected command, and surface failures via UI notification",
	);
	return JSON.stringify(surface);
}

async function verifyInstalledModelSurface(host: HostPackage, env: NodeJS.ProcessEnv, mode: ModelSurfaceMode): Promise<string> {
	const command = ["--no-install", "--no-env-file", `--config=${join(repoDir, "runtime", "zhomp.toml")}`, join(repoDir, "tests", "integration-model-surface.ts")];
	const result = await runCommand(bun, command, {
		cwd: host.packageDir,
		env: { ...env, MODEL_SURFACE_MODE: mode },
		timeout: 120_000,
	});
	assertion(result.exitCode === 0, result.stderr || result.stdout);
	const surface: unknown = JSON.parse(result.stdout.trim());
	assertion(surface !== null && typeof surface === "object" && !Array.isArray(surface), `ModelHub ${mode} must emit a clean structured surface result`);
	assertion(
		"mode" in surface && surface.mode === mode &&
		"component" in surface && surface.component === "ModelHubComponent",
		`ModelHub ${mode} did not surface its real component`,
	);
	assertion(
		"unrelatedConsumer" in surface && surface.unrelatedConsumer === "ModelBrowser remains English",
		`ModelHub ${mode} globally translated the sibling ModelBrowser`,
	);
	assertion("roleTag" in surface && surface.roleTag === "SMOL", "ModelHub must preserve builtin role names in every language mode");
	const title = "title" in surface ? surface.title : undefined;
	if (mode === "ordinary") {
		assertion(title === "Models", "the mismatched-PID process must retain the original ModelHub text");
	} else {
		assertion(typeof title === "string" && title !== "Models", "the real ModelHub title must display the dictionary text");
		assertion("configWrites" in surface && surface.configWrites === 0, "the translated probe must not persist user settings");
		const nativeDescribe = "nativeDescribe" in surface ? surface.nativeDescribe : undefined;
		assertion(
			typeof nativeDescribe === "string" &&
			(nativeDescribe === `covered@${host.version}` || nativeDescribe === `unavailable@${host.version}`),
			`native describe capability evidence is missing for OMP ${host.version}`,
		);
		if (mode === "hostile") {
			assertion(
				typeof title === "string" && title.includes("__zhompModelUiInjected") &&
				"injectionSideEffect" in surface && surface.injectionSideEffect === false,
				"hostile dictionary text must remain literal and side-effect free",
			);
		} else {
			assertion("model" in surface && surface.model === "Models/Roles", "the real ModelHub consumer changed model or selector identities");
		}
	}
	return JSON.stringify(surface);
}

async function verifyInstalledConsumers(host: HostPackage, env: NodeJS.ProcessEnv, modes: readonly ModelSurfaceMode[]): Promise<string> {
	const outputs = [await verifyInstalledSettingsSurface(host, env)];
	for (const mode of modes) outputs.push(await verifyInstalledModelSurface(host, env, mode));
	return outputs.join("\n");
}

async function v10(): Promise<string> {
	const discovered = discoverRealHost();
	return withTemp("zhomp-v10", async root => {
		const home = join(root, "home");
		const installEnv = { ...process.env, OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: discovered.packageDir, OMP_ZH_INSTALL_SHELL: "bash" };
		const installed = install(repoDir, installEnv);
		assertManifestInstalled(repoDir, installEnv);
		assertion(sameFileSystemEntry(installed.packageDir, discovered.packageDir), "real host installation selected a different package");
		const configPath = join(home, ".omp", "zh", "launch.json");
		const env = installedProbeEnvironment(root, configPath);
		return verifyInstalledConsumers(discovered, env, ["ordinary", "translated", "hostile"]);
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
		for (const file of ["README.md", "INSTALL.md", "LICENSE", "CHANGELOG.md", "scripts/install.ts", "scripts/install-core.ts", "scripts/install.ps1", "scripts/install.sh", "scripts/uninstall.ps1", "scripts/uninstall.sh"]) {
			assertion(existsSync(join(packageRoot, file)), `packed file missing: ${file}`);
		}
		assertion(!existsSync(join(packageRoot, "IMPROVEMENT_PLAN.md")), "review report leaked into package");
		const help = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(packageRoot, "runtime", "zhomp.toml")}`, join(packageRoot, "scripts", "install.ts"), "--help"], { cwd: root });
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
		const installEnv = { ...process.env, OMP_ZH_HOME: installedHome, OMP_ZH_PACKAGE_DIR: host.packageDir };
		const actualInstall = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(packageRoot, "runtime", "zhomp.toml")}`, join(packageRoot, "scripts", "install.ts")], {
			cwd: root,
			env: installEnv,
		});
		assertion(actualInstall.exitCode === 0, actualInstall.stderr || actualInstall.stdout);
		assertManifestInstalled(packageRoot, installEnv);
		const configPath = join(installedHome, ".omp", "zh", "launch.json");
		const probeEnv = installedProbeEnvironment(root, configPath);
		await verifyInstalledConsumers(host, probeEnv, ["translated"]);

		const modelTextPath = join(installedHome, ".omp", "zh", "model-text.ts");
		const withheldModelTextPath = join(root, "model-text.ts.withheld");
		renameSync(modelTextPath, withheldModelTextPath);
		try {
			let rejectedWithoutModelText = false;
			try {
				await verifyInstalledModelSurface(host, probeEnv, "translated");
			} catch {
				rejectedWithoutModelText = true;
			}
			assertion(rejectedWithoutModelText, "the real ModelHub consumer passed without its installed text catalogue");
		} finally {
			renameSync(withheldModelTextPath, modelTextPath);
		}

		const version = await runCommand(bun, ["--no-install", "--no-env-file", `--config=${join(installedHome, ".omp", "zh", "zhomp.toml")}`, join(installedHome, ".omp", "zh", "launch.ts"), "--version"], { cwd: root });
		assertion(version.exitCode === 0 && version.stdout.includes(`omp/${host.version}`), version.stderr || version.stdout);
		return "the unpacked installer passed real installed SettingsHost and ModelHub probes; removing model-text.ts made the ModelHub probe fail";
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
