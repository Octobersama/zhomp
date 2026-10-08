import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLaunchConfig } from "./host";

interface CommandRouterModule {
	LAUNCH_FLAG_COMMANDS: Record<string, unknown>;
	resolveCliArgv(args: string[]): unknown;
}

interface CliArgsModule {
	parseArgs(args: string[]): unknown;
}

async function preload(configPath: string, cwd: string): Promise<void> {
	// Keep the host CLI as Bun.main so workers still re-enter its actual entrypoint.
	const config = readLaunchConfig(configPath);
	delete process.env.OMP_ZH_BOOTSTRAP_CWD;
	delete process.env.OMP_ZH_LAUNCHER_PARENT_PID;
	delete process.env.OMP_ZH_PACKAGE_DIR;
	delete process.env.OMP_ZH_TUI_PACKAGE_DIR;
	delete process.env.OMP_ZH_SUPPORTED_RANGE;
	process.chdir(cwd);
	process.env.OMP_ZH_CONFIG = configPath;
	process.env.OMP_ZH_ENABLED = "1";
	process.env.OMP_ZH_PROCESS_ID = String(process.pid);
	process.env.OMP_ZH_DICT ||= config.dictPath;

	// Static imports cannot target the package selected by launch.json at runtime.
	const routerValue: unknown = await import(pathToFileURL(config.host.cliCommandsPath).href);
	if (routerValue === null || typeof routerValue !== "object" || Array.isArray(routerValue) ||
		!("resolveCliArgv" in routerValue) || typeof routerValue.resolveCliArgv !== "function" ||
		!("LAUNCH_FLAG_COMMANDS" in routerValue) || routerValue.LAUNCH_FLAG_COMMANDS === null ||
		typeof routerValue.LAUNCH_FLAG_COMMANDS !== "object" || Array.isArray(routerValue.LAUNCH_FLAG_COMMANDS)) {
		throw new Error("The supported OMP command router is unavailable.");
	}
	const router = routerValue as CommandRouterModule;
	const args = process.argv.slice(2);
	const routedValue: unknown = router.resolveCliArgv(args);
	if (routedValue !== null && typeof routedValue === "object" && !Array.isArray(routedValue) &&
		"argv" in routedValue && Array.isArray(routedValue.argv)) {
		const routedArgs: unknown[] = routedValue.argv;
		if (!routedArgs.every((arg): arg is string => typeof arg === "string")) {
			throw new Error("The OMP command router returned invalid arguments.");
		}
		const command = routedArgs[0];
		if (typeof command === "string" && router.LAUNCH_FLAG_COMMANDS[command] === true) {
			const parserValue: unknown = await import(pathToFileURL(config.host.cliArgsPath).href);
			if (parserValue === null || typeof parserValue !== "object" || Array.isArray(parserValue) ||
				!("parseArgs" in parserValue) || typeof parserValue.parseArgs !== "function") {
				throw new Error("The supported OMP argument parser is unavailable.");
			}
			const parser = parserValue as CliArgsModule;
			const parsed: unknown = parser.parseArgs(routedArgs.slice(1));
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("The OMP argument parser returned an invalid result.");
			}
			const noExtensions = "noExtensions" in parsed ? parsed.noExtensions : undefined;
			if (noExtensions !== undefined && typeof noExtensions !== "boolean") {
				throw new Error("The OMP argument parser returned an invalid extension flag.");
			}
			if (!noExtensions) {
				// The host extension loader eagerly imports ModelHub; register before the CLI starts.
				const extension: unknown = await import(pathToFileURL(config.extensionPath).href);
				if (extension === null || typeof extension !== "object" ||
					!("prepareModelTranslation" in extension) || typeof extension.prepareModelTranslation !== "function") {
					throw new Error("Installed Model translation preload is unavailable; reinstall zhomp.");
				}
				await extension.prepareModelTranslation(config, configPath);
				// Insert before the user's `--` boundary; the host still applies its normal routing.
				process.argv.splice(2, 0, "--extension", config.extensionPath);
			}
		}
	}
}

async function launch(configPath: string): Promise<void> {
	const config = readLaunchConfig(configPath);
	const cwd = process.cwd();
	const env = { ...process.env };
	env.OMP_ZH_CONFIG = configPath;
	env.OMP_ZH_BOOTSTRAP_CWD = cwd;
	env.OMP_ZH_LAUNCHER_PARENT_PID = String(process.pid);
	if (env.OMP_ZH_DICT) env.OMP_ZH_DICT = resolve(cwd, env.OMP_ZH_DICT);
	delete env.OMP_ZH_PROCESS_ID;
	delete env.OMP_ZH_PACKAGE_DIR;
	delete env.OMP_ZH_TUI_PACKAGE_DIR;
	delete env.OMP_ZH_SUPPORTED_RANGE;
	const child = Bun.spawn([
		process.execPath,
		"--no-install",
		"--no-env-file",
		`--config=${join(import.meta.dir, "zhomp.toml")}`,
		"--preload", fileURLToPath(import.meta.url),
		config.host.cliPath,
		// Bun consumes its own leading separator; preserve the caller's separator after it.
		"--",
		...process.argv.slice(2),
	], { cwd: config.host.packageDir, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
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
		await launch(resolve(import.meta.dir, "launch.json"));
	} else if (
		process.env.OMP_ZH_BOOTSTRAP_CWD &&
		process.env.OMP_ZH_LAUNCHER_PARENT_PID === String(process.ppid)
	) {
		const configPath = process.env.OMP_ZH_CONFIG;
		if (!configPath) throw new Error("OMP_ZH_CONFIG is required for zhomp preload.");
		await preload(configPath, process.env.OMP_ZH_BOOTSTRAP_CWD);
	}
} catch (error) {
	console.error(`[zhomp] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
	// A preload failure must prevent the host from starting with half a setup.
	if (!import.meta.main) process.exit(1);
}
