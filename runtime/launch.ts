import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface LaunchConfig {
	packageDir: string;
	tuiPackageDir: string;
	supportedVersion: string;
	extensionPath: string;
	dictPath: string;
}

function loadConfig(): LaunchConfig {
	const value: unknown = JSON.parse(readFileSync(join(import.meta.dir, "launch.json"), "utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid zhomp launch configuration; reinstall zhomp.");
	const fields = value as Record<string, unknown>;
	for (const key of ["packageDir", "tuiPackageDir", "supportedVersion", "extensionPath", "dictPath"] as const) {
		if (typeof fields[key] !== "string" || fields[key].length === 0) {
			throw new Error(`Invalid zhomp launch configuration: ${key}`);
		}
	}
	const config = value as LaunchConfig;
	if (![config.packageDir, config.tuiPackageDir, config.extensionPath, config.dictPath].every(isAbsolute)) {
		throw new Error("zhomp launch paths must be absolute; reinstall zhomp.");
	}
	const pkg: unknown = JSON.parse(readFileSync(join(config.packageDir, "package.json"), "utf8"));
	if (!pkg || typeof pkg !== "object" || !("name" in pkg) || pkg.name !== "@oh-my-pi/pi-coding-agent" ||
		!("version" in pkg) || pkg.version !== config.supportedVersion) {
		throw new Error(`zhomp requires OMP ${config.supportedVersion}; the installed package changed. Reinstall the supported version.`);
	}
	return config;
}

async function preload(config: LaunchConfig, cwd: string): Promise<void> {
	// This runs before cli.ts evaluates its imports. Keep cli.ts as Bun.main so
	// OMP worker processes still re-enter the actual host entrypoint.
	delete process.env.OMP_ZH_BOOTSTRAP_CWD;
	delete process.env.OMP_ZH_LAUNCHER_PARENT_PID;
	process.chdir(cwd);
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = String(process.pid);
	process.env.OMP_ZH_PACKAGE_DIR = config.packageDir;
	process.env.OMP_ZH_TUI_PACKAGE_DIR = config.tuiPackageDir;
	process.env.OMP_ZH_SUPPORTED_VERSION = config.supportedVersion;
	process.env.OMP_ZH_DICT ||= config.dictPath;

	// The host installation path is selected at runtime; a static import could
	// load another Bun cache copy instead of this installation's command router.
	const router = await import(pathToFileURL(join(config.packageDir, "src", "cli-commands.ts")).href);
	if (typeof router.resolveCliArgv !== "function" || !router.LAUNCH_FLAG_COMMANDS) {
		throw new Error("The supported OMP command router is unavailable.");
	}
	const args = process.argv.slice(2);
	const separator = args.indexOf("--");
	const options = separator < 0 ? args : args.slice(0, separator);
	const routed: unknown = router.resolveCliArgv(args);
	if (routed && typeof routed === "object" && "argv" in routed && Array.isArray(routed.argv) &&
		typeof routed.argv[0] === "string" && router.LAUNCH_FLAG_COMMANDS[routed.argv[0]] === true &&
		!options.includes("--no-extensions")) {
		// Put it before the command, never after a user's `--` separator. OMP
		// resolves/deduplicates this path with its normal extension discovery.
		process.argv.splice(2, 0, "--extension", config.extensionPath);
	}
}

async function launch(config: LaunchConfig): Promise<void> {
	const cwd = process.cwd();
	const env = { ...process.env };
	env.OMP_ZH_BOOTSTRAP_CWD = cwd;
	env.OMP_ZH_LAUNCHER_PARENT_PID = String(process.pid);
	if (env.OMP_ZH_DICT) env.OMP_ZH_DICT = resolve(cwd, env.OMP_ZH_DICT);
	delete env.OMP_ZH_PROCESS_ID;
	const child = Bun.spawn([
		process.execPath,
		"--no-install",
		"--no-env-file",
		`--config=${join(import.meta.dir, "zhomp.toml")}`,
		"--preload", fileURLToPath(import.meta.url),
		join(config.packageDir, "src", "cli.ts"),
		...process.argv.slice(2),
	], { cwd: config.packageDir, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	const interrupt = () => child.kill("SIGINT");
	const terminate = () => child.kill("SIGTERM");
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	try {
		process.exitCode = await child.exited;
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
	}
}

try {
	if (import.meta.main) {
		await launch(loadConfig());
	} else if (
		process.env.OMP_ZH_BOOTSTRAP_CWD &&
		process.env.OMP_ZH_LAUNCHER_PARENT_PID === String(process.ppid)
	) {
		await preload(loadConfig(), process.env.OMP_ZH_BOOTSTRAP_CWD);
	}
} catch (error) {
	console.error(`[zhomp] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
	// A preload failure must prevent the host from starting with half a setup.
	if (!import.meta.main) process.exit(1);
}
