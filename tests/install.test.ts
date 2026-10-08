import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "bun:test";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { renameSync, readFileSync, mkdirSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { discoverPackage, HostNotFoundError, install, publishArtifacts, resolveHome } from "../scripts/install-core";
import { readLaunchConfig, readSupportPolicy, validatePackage } from "../runtime/host";
import { createHostFixture, makeTempDir, removeTree, runCommand, snapshotTree, writeText } from "./verification-fixtures";

const repoDir = dirname(import.meta.dir);
const { range, minimumVersion } = readSupportPolicy(repoDir);

test("installation rejects older hosts but accepts compatible updates", () => {
	const root = makeTempDir("zhomp-version");
	try {
		const oldHost = createHostFixture(join(root, "18.3.1"), "18.3.1");
		const oldHome = join(root, "old-home");
		throws(() => install(repoDir, { OMP_ZH_HOME: oldHome, OMP_ZH_PACKAGE_DIR: oldHost }));
		strictEqual(existsSync(oldHome), false);
		for (const newer of [minimumVersion, "18.4.1"]) {
			const host = createHostFixture(join(root, newer), newer);
			const result = install(repoDir, { OMP_ZH_HOME: join(root, `home-${newer}`), OMP_ZH_PACKAGE_DIR: host });
			strictEqual(result.packageDir, resolve(host));
		}
		const broken = createHostFixture(join(root, "broken"), "18.4.1");
		rmSync(join(broken, "src", "config", "all-settings.ts"));
		throws(() => validatePackage(broken, range));
	} finally { removeTree(root); }
});

test("host package identities reject non-canonical SemVer versions", () => {
	const root = makeTempDir("zhomp-invalid-version");
	try {
		const host = createHostFixture(root, "18.3.2 <19");
		throws(() => validatePackage(host, range));
	} finally { removeTree(root); }
});

test("host settings paths follow the selected package's exported definitions layout", () => {
	const root = makeTempDir("zhomp-host-layout");
	try {
		const packageDir = createHostFixture(root, minimumVersion);
		const tuiDir = join(dirname(packageDir), "pi-tui");
		const previousDefs = join(tuiDir, "src", "overlays", "settings-defs.ts");
		const redirectedDefs = join(tuiDir, "src", "relocated", "custom-settings.ts");
		rmSync(previousDefs);
		writeText(redirectedDefs, "export const TAB_METADATA={}; export const TAB_GROUPS={};\n");
		writeText(join(tuiDir, "package.json"), JSON.stringify({
			name: "@oh-my-pi/pi-tui",
			version: minimumVersion,
			type: "module",
			exports: { "./overlays/settings-defs": "./src/relocated/custom-settings.ts", "./*": "./src/*.ts" },
		}));
		const validated = validatePackage(packageDir, range);
		strictEqual(validated.settingsDefsPath, resolve(redirectedDefs));
		for (const path of [validated.cliPath, validated.allSettingsPath, validated.settingsUiPath, validated.settingsDefsPath, validated.cliCommandsPath, validated.cliArgsPath, validated.modelHubPath]) {
			strictEqual(isAbsolute(path), true, path);
		}
		const extensionPath = join(root, "installed-extension.ts");
		const dictPath = join(root, "installed-dictionary.json");
		const configPath = join(root, "launch.json");
		writeText(configPath, JSON.stringify({ packageDir, supportedRange: range, extensionPath, dictPath }));
		const config = readLaunchConfig(configPath);
		strictEqual(config.host.settingsDefsPath, resolve(redirectedDefs));
	} finally { removeTree(root); }
});

test("explicit and independently configured global directories select the actual package", () => {
	const root = makeTempDir("zhomp-discovery");
	try {
		const host = createHostFixture(root, minimumVersion);
		strictEqual(discoverPackage(range, { OMP_ZH_PACKAGE_DIR: host }).packageDir, resolve(host));
		strictEqual(discoverPackage(range, { BUN_INSTALL_GLOBAL_DIR: root, BUN_INSTALL_BIN: join(root, "unrelated-bin") }).packageDir, resolve(host));
		let explicitError: unknown;
		try {
			discoverPackage(range, { OMP_ZH_PACKAGE_DIR: join(root, "missing"), BUN_INSTALL_GLOBAL_DIR: root });
		} catch (error) {
			explicitError = error;
		}
		strictEqual(explicitError instanceof Error, true);
		strictEqual(explicitError instanceof HostNotFoundError, false);
		const malformedUser = join(root, "malformed-user");
		writeText(join(malformedUser, ".bunfig.toml"), "[install]\nglobalDir = 7\n");
		throws(() => discoverPackage(range, { USERPROFILE: malformedUser, HOME: malformedUser }));
		const user = join(root, "user");
		writeText(join(user, ".bunfig.toml"), `[install]\nglobalDir = ${JSON.stringify(root.replaceAll("\\", "/"))}\nglobalBinDir = ${JSON.stringify(join(root, "elsewhere").replaceAll("\\", "/"))}\n`);
		strictEqual(discoverPackage(range, { USERPROFILE: user, HOME: user }).packageDir, resolve(host));
		const defaultHome = join(root, "default-user");
		const defaultHost = createHostFixture(join(defaultHome, ".bun", "install", "global"), minimumVersion);
		strictEqual(discoverPackage(range, { USERPROFILE: defaultHome, HOME: defaultHome }).packageDir, resolve(defaultHost));
		const customUser = join(root, "custom-user");
		const customGlobal = join(root, "custom-global");
		const configuredHost = createHostFixture(customGlobal, minimumVersion);
		createHostFixture(join(customUser, ".bun", "install", "global"), "18.4.1");
		writeText(join(customUser, ".bunfig.toml"), `[install]\nglobalDir = ${JSON.stringify(customGlobal.replaceAll("\\", "/"))}\nglobalBinDir = ${JSON.stringify(join(customUser, "separate-bin").replaceAll("\\", "/"))}\n`);
		const configuredEnv = { USERPROFILE: customUser, HOME: customUser };
		strictEqual(discoverPackage(range, configuredEnv).packageDir, resolve(configuredHost));
		const installed = install(repoDir, { ...configuredEnv, OMP_ZH_HOME: join(root, "custom-home") });
		strictEqual(installed.packageDir, resolve(configuredHost));
		rmSync(join(host, "src", "cli.ts"));
		throws(() => validatePackage(host, range));
	} finally { removeTree(root); }
});

test("home selection respects explicit override and platform fallback", () => {
	const a = resolve("test-a");
	const b = resolve("test-b");
	const c = resolve("test-c");
	strictEqual(resolveHome({ OMP_ZH_HOME: a, USERPROFILE: b, HOME: c }), a);
	strictEqual(resolveHome({ USERPROFILE: b, HOME: c }), process.platform === "win32" ? b : c);
	strictEqual(resolveHome({ HOME: c }), c);
});

test("every failed publish step restores first-install and upgrade state", () => {
	const root = makeTempDir("zhomp-rollback");
	try {
		for (const upgrade of [false, true]) {
			for (let failAt = 1; failAt <= (upgrade ? 6 : 3); failAt++) {
				const working = join(root, `${upgrade}-${failAt}`);
				mkdirSync(working);
				writeText(join(working, "unrelated"), "user data");
				const paths = [join(working, "ext", "zhomp.ts"), join(working, "data", "dict.json"), join(working, "bin", "zhomp")];
				if (upgrade) paths.forEach((path, index) => writeText(path, `old-${index}`));
				const before = snapshotTree(working);
				const failure = new Error("injected storage failure");
				let calls = 0;
				throws(() => publishArtifacts(paths.map((path, index) => ({ path, content: `new-${index}` })), (from, to) => {
					if (++calls === failAt) throw failure;
					renameSync(from, to);
				}), error => error === failure);
				deepStrictEqual(snapshotTree(working), before, `failed at ${failAt}, upgrade=${upgrade}`);
			}
		}
	} finally { removeTree(root); }
});


test("publish rejects valid and dangling links before changing any target", () => {
	const root = makeTempDir("zhomp-symlink");
	try {
		for (const dangling of [false, true]) {
			const working = join(root, dangling ? "dangling" : "valid");
			mkdirSync(working);
			const first = join(working, "first.txt");
			writeText(first, "preserve this file");
			const target = dangling ? "missing.txt" : "link-target.txt";
			if (!dangling) writeText(join(working, target), "link target");
			const link = join(working, "protected.txt");
			symlinkSync(target, link, "file");
			const before = snapshotTree(working);
			throws(() => publishArtifacts([
				{ path: first, content: "must not publish" },
				{ path: link, content: "must not replace the link" },
			]));
			deepStrictEqual(snapshotTree(working), before, `dangling=${dangling}`);
		}
	} finally { removeTree(root); }
});

// Three native launches each retain runCommand's 30-second subprocess deadline.
test("installed launcher follows host parser semantics and clears inherited runtime markers", async () => {
	const root = makeTempDir("zhomp-launch-args");
	try {
		const packageDir = createHostFixture(root, minimumVersion);
		const home = join(root, "home");
		const project = join(root, "project");
		mkdirSync(project);
		writeText(join(project, "custom-dict.json"), "{}\n");
		install(repoDir, { OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: packageDir });
		const configPath = join(home, ".omp", "zh", "launch.json");
		const extensionPath = join(home, ".omp", "agent", "extensions", "zhomp.ts");
		const launcherPath = join(home, ".bun", "bin", process.platform === "win32" ? "zhomp.cmd" : "zhomp");
		const scenarios = [
			{ args: ["--system-prompt", "--no-extensions"], injectExtension: true },
			{ args: ["--no-extensions=true"], injectExtension: false },
			{ args: ["--", "--no-extensions"], injectExtension: true },
		];
		for (const scenario of scenarios) {
			let command: string;
			let args: string[];
			if (process.platform === "win32") {
				command = join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
				const script = `& '${launcherPath.replaceAll("'", "''")}' ${scenario.args.map(arg => `'${arg.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
				args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
			} else {
				command = "bash";
				args = [launcherPath, ...scenario.args];
			}
			const result = await runCommand(command, args, {
				cwd: project,
				env: {
					...process.env,
					OMP_ZH_CONFIG: join(root, "stale-launch.json"),
					OMP_ZH_ENABLED: "0",
					OMP_ZH_PROCESS_ID: "stale",
					OMP_ZH_PACKAGE_DIR: join(root, "stale-package"),
					OMP_ZH_TUI_PACKAGE_DIR: join(root, "stale-tui"),
					OMP_ZH_SUPPORTED_RANGE: "stale-range",
					OMP_ZH_BOOTSTRAP_CWD: join(root, "stale-cwd"),
					OMP_ZH_LAUNCHER_PARENT_PID: "stale-parent",
					OMP_ZH_DICT: "custom-dict.json",
				},
			});
			strictEqual(result.exitCode, 0, result.stderr || result.stdout);
			const output = JSON.parse(result.stdout) as {
				args: string[];
				cwd: string;
				config: string | undefined;
				enabled: string | undefined;
				pidMatches: boolean;
				dict: string | undefined;
				packageDir: string | undefined;
				tuiPackageDir: string | undefined;
				supportedRange: string | undefined;
				bootstrapCwd: string | undefined;
				launcherParentPid: string | undefined;
			};
			strictEqual(output.cwd, project);
			strictEqual(output.config, configPath);
			strictEqual(output.enabled, "1");
			strictEqual(output.pidMatches, true);
			strictEqual(output.dict, join(project, "custom-dict.json"));
			strictEqual(output.packageDir, undefined);
			strictEqual(output.tuiPackageDir, undefined);
			strictEqual(output.supportedRange, undefined);
			strictEqual(output.bootstrapCwd, undefined);
			strictEqual(output.launcherParentPid, undefined);
			const expectedArgs = scenario.injectExtension ? ["--extension", extensionPath, ...scenario.args] : scenario.args;
			deepStrictEqual(output.args, expectedArgs);
		}
	} finally { removeTree(root); }
}, 120_000);
test("successful reinstall is idempotent and preserves caller files", () => {
	const root = makeTempDir("zhomp-reinstall");
	try {
		const host = createHostFixture(root, minimumVersion);
		const home = join(root, "home [1]");
		const env = { OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: host, OMP_ZH_INSTALL_SHELL: "bash" };
		writeText(join(home, ".omp", "zh", "user.txt"), "keep");
		const first = install(repoDir, env);
		const before = snapshotTree(home);
		const second = install(repoDir, env);
		deepStrictEqual(second.paths, first.paths);
		deepStrictEqual(snapshotTree(home), before);
		strictEqual(readFileSync(join(home, ".omp", "zh", "user.txt"), "utf8"), "keep");
	} finally { removeTree(root); }
});
