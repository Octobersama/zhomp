import { randomUUID } from "node:crypto";
import {
	chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
	renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export type Env = Record<string, string | undefined>;
export interface HostPackage {
	packageDir: string;
	version: string;
	cliPath: string;
	tuiDir: string;
}
export interface Artifact {
	path: string;
	content: string | Uint8Array;
	mode?: number;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function absolutePath(value: string, base = process.cwd()): string {
	// Git Bash can pass /c/... to a native Windows Bun without path conversion.
	if (process.platform === "win32" && /^\/[a-zA-Z]\//.test(value)) value = `${value[1]}:${value.slice(2)}`;
	if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) value = join(homedir(), value.slice(2));
	return resolve(base, value);
}

export function resolveHome(env: Env = process.env): string {
	return absolutePath(env.OMP_ZH_HOME || (process.platform === "win32" ? env.USERPROFILE : undefined) || env.HOME || homedir());
}

export function supportedVersion(repoDir: string): string {
	const pkg: unknown = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
	const version = record(pkg) && record(pkg.peerDependencies) ? pkg.peerDependencies["@oh-my-pi/pi-coding-agent"] : undefined;
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error("zhomp must declare one exact supported OMP version in package.json.");
	}
	return version;
}

export function validatePackage(input: string, version: string): HostPackage {
	const packageDir = realpathSync(absolutePath(input));
	const pkg: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	if (!record(pkg) || pkg.name !== "@oh-my-pi/pi-coding-agent" || pkg.version !== version) {
		throw new Error(`Expected @oh-my-pi/pi-coding-agent ${version} at ${packageDir}; found ${record(pkg) ? String(pkg.name) + " " + String(pkg.version) : "invalid metadata"}.`);
	}
	for (const file of ["src/cli.ts", "src/cli-commands.ts", "src/config/all-settings.ts", "src/config/settings-ui.ts"]) {
		if (!statSync(join(packageDir, file)).isFile()) throw new Error(`Missing host source: ${file}`);
	}
	// Resolve from the validated host, never from the repository or Bun's cache.
	const defs = realpathSync(Bun.resolveSync("@oh-my-pi/pi-tui/overlays/settings-defs", packageDir));
	let tuiDir = dirname(defs);
	while (!existsSync(join(tuiDir, "package.json"))) {
		const parent = dirname(tuiDir);
		if (parent === tuiDir) throw new Error("Cannot locate the host's pi-tui package.");
		tuiDir = parent;
	}
	const tui: unknown = JSON.parse(readFileSync(join(tuiDir, "package.json"), "utf8"));
	const tuiVersion = record(pkg.dependencies) ? pkg.dependencies["@oh-my-pi/pi-tui"] : undefined;
	if (!record(tui) || tui.name !== "@oh-my-pi/pi-tui" || typeof tui.version !== "string" || typeof tuiVersion !== "string" || !Bun.semver.satisfies(tui.version, tuiVersion)) {
		throw new Error(`The host's pi-tui dependency does not satisfy ${String(tuiVersion)}.`);
	}
	return { packageDir, version, cliPath: join(packageDir, "src", "cli.ts"), tuiDir };
}

export function discoverPackage(version: string, env: Env = process.env): HostPackage {
	if (env.OMP_ZH_PACKAGE_DIR) return validatePackage(absolutePath(env.OMP_ZH_PACKAGE_DIR), version);
	const userHome = absolutePath((process.platform === "win32" ? env.USERPROFILE : undefined) || env.HOME || homedir());
	const packageSuffix = "node_modules/@oh-my-pi/pi-coding-agent";
	if (env.BUN_INSTALL_GLOBAL_DIR) return validatePackage(join(absolutePath(env.BUN_INSTALL_GLOBAL_DIR), packageSuffix), version);

	// Bun's global package-manager settings are independent of zhomp's install root.
	const configs = [join(userHome, ".bunfig.toml")];
	if (env.XDG_CONFIG_HOME) configs.push(join(absolutePath(env.XDG_CONFIG_HOME), ".bunfig.toml"));
	configs.push(join(process.cwd(), "bunfig.toml"));
	let configuredRoot: string | undefined;
	for (const file of configs) {
		if (!existsSync(file)) continue;
		const config: unknown = Bun.TOML.parse(readFileSync(file, "utf8"));
		if (record(config) && record(config.install) && typeof config.install.globalDir === "string") {
			configuredRoot = absolutePath(config.install.globalDir, dirname(file));
		}
	}
	if (configuredRoot) return validatePackage(join(configuredRoot, packageSuffix), version);
	const roots = [
		...(env.BUN_INSTALL ? [join(absolutePath(env.BUN_INSTALL), "install", "global")] : []),
		join(userHome, ".bun", "install", "global"),
		join(dirname(dirname(process.execPath)), "install", "global"),
	];
	const candidates = [...new Set(roots.map(root => join(root, packageSuffix)))];
	const errors: string[] = [];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try { return validatePackage(candidate, version); }
		catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
	}
	throw new Error(errors.length ? errors.join("\n") : `OMP ${version} not found. Run: bun install -g @oh-my-pi/pi-coding-agent@${version}, or set OMP_ZH_PACKAGE_DIR to its package directory.`);
}

/** Publish one owned file set. A replace failure restores its exact previous state. */
export function publishArtifacts(artifacts: readonly Artifact[], replace: typeof renameSync = renameSync): void {
	if (new Set(artifacts.map(item => resolve(item.path))).size !== artifacts.length) throw new Error("Duplicate installation target.");
	const createdDirs: string[] = [];
	const staged: { target: string; temp: string; backup: string; backedUp: boolean; committed: boolean }[] = [];
	const transaction = randomUUID();
	let committed = false;
	let restored = true;
	try {
		// Check every target before creating directories or publishing discoverable files.
		for (const artifact of artifacts) {
			if (!isAbsolute(artifact.path)) throw new Error(`Install target is not absolute: ${artifact.path}`);
			if (existsSync(artifact.path) && !lstatSync(artifact.path).isFile()) {
				throw new Error(`Refusing to replace a non-file: ${artifact.path}`);
			}
		}
		for (const artifact of artifacts) {
			const missing: string[] = [];
			for (let dir = dirname(artifact.path); !existsSync(dir); dir = dirname(dir)) {
				if (dir === parse(dir).root) throw new Error(`Missing filesystem root: ${dir}`);
				missing.push(dir);
			}
			for (const dir of missing.reverse()) { mkdirSync(dir); createdDirs.push(dir); }
			const entry = { target: artifact.path, temp: `${artifact.path}.${transaction}.tmp`, backup: `${artifact.path}.${transaction}.bak`, backedUp: false, committed: false };
			staged.push(entry);
			writeFileSync(entry.temp, artifact.content, { flag: "wx" });
			if (artifact.mode !== undefined) chmodSync(entry.temp, artifact.mode);
		}
		for (const entry of staged) {
			if (existsSync(entry.target)) {
				replace(entry.target, entry.backup);
				entry.backedUp = true;
			}
			replace(entry.temp, entry.target);
			entry.committed = true;
		}
		committed = true;
	} catch (error) {
		const recoveryErrors: string[] = [];
		for (const entry of [...staged].reverse()) {
			try {
				if (entry.committed) unlinkSync(entry.target);
				if (entry.backedUp) renameSync(entry.backup, entry.target);
			} catch (recoveryError) { restored = false; recoveryErrors.push(`${entry.backup}: ${String(recoveryError)}`); }
		}
		if (recoveryErrors.length) throw new AggregateError([error, ...recoveryErrors], "Installation failed; preserve the listed backups for recovery.");
		throw error;
	} finally {
		for (const entry of staged) {
			if (existsSync(entry.temp)) unlinkSync(entry.temp);
			if (committed && existsSync(entry.backup)) unlinkSync(entry.backup);
		}
		if (!committed && restored) {
			for (const dir of createdDirs.reverse()) rmdirSync(dir);
		}
	}
}

export function install(repoDir: string, env: Env = process.env, replace: typeof renameSync = renameSync): { homeDir: string; packageDir: string; paths: string[] } {
	const version = supportedVersion(repoDir);
	const homeDir = resolveHome(env);
	const host = discoverPackage(version, env);
	const metadata: unknown = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
	if (!record(metadata) || !record(metadata.engines) || typeof metadata.engines.bun !== "string" || !Bun.semver.satisfies(Bun.version, metadata.engines.bun)) {
		throw new Error("Bun version does not satisfy zhomp's package.json engines.bun.");
	}
	const extensionPath = join(homeDir, ".omp", "agent", "extensions", "zhomp.ts");
	const zhDir = join(homeDir, ".omp", "zh");
	const dictPath = join(zhDir, "dict.json");
	const dictContent = readFileSync(join(repoDir, "dict", "zh-CN.json"));
	const dictionary: unknown = JSON.parse(dictContent.toString("utf8"));
	if (!record(dictionary) || Object.values(dictionary).some(value => typeof value !== "string" || value.length === 0)) {
		throw new Error("The bundled dictionary must contain nonempty string translations.");
	}
	const artifacts: Artifact[] = [
		{ path: extensionPath, content: readFileSync(join(repoDir, "extensions", "zhomp.ts")) },
		{ path: dictPath, content: dictContent },
		{ path: join(zhDir, "launch.ts"), content: readFileSync(join(repoDir, "runtime", "launch.ts")) },
		{ path: join(zhDir, "zhomp.toml"), content: readFileSync(join(repoDir, "runtime", "zhomp.toml")) },
		{ path: join(zhDir, "launch.json"), content: JSON.stringify({ packageDir: host.packageDir, tuiPackageDir: host.tuiDir, supportedVersion: version, extensionPath, dictPath }, null, 2) + "\n" },
	];
	const binDir = join(homeDir, ".bun", "bin");
	if (process.platform !== "win32" || env.OMP_ZH_INSTALL_SHELL === "bash") {
		artifacts.push({ path: join(binDir, "zhomp"), mode: 0o755, content: '#!/usr/bin/env bash\nset -euo pipefail\nlauncher_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"\nexec bun --no-install --no-env-file --config="$launcher_dir/../../.omp/zh/zhomp.toml" "$launcher_dir/../../.omp/zh/launch.ts" "$@"\n' });
	}
	if (process.platform === "win32") {
		// Only ASCII syntax goes into this file. %~dp0 supplies the actual Unicode path.
		artifacts.push({ path: join(binDir, "zhomp.cmd"), content: '@echo off\r\nsetlocal DisableDelayedExpansion\r\nbun --no-install --no-env-file --config="%~dp0..\\..\\.omp\\zh\\zhomp.toml" "%~dp0..\\..\\.omp\\zh\\launch.ts" %*\r\nexit /b %ERRORLEVEL%\r\n' });
	}
	publishArtifacts(artifacts, replace);
	return { homeDir, packageDir: host.packageDir, paths: artifacts.map(artifact => artifact.path) };
}
