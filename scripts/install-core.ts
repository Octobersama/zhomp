import { randomUUID } from "node:crypto";
import {
	chmodSync, existsSync, lstatSync, mkdirSync, readFileSync,
	renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, posix, resolve } from "node:path";
import { readSupportPolicy, validatePackage } from "../runtime/host";
import type { HostPackage } from "../runtime/host";

export type Env = Record<string, string | undefined>;

export class HostNotFoundError extends Error {
	constructor(range: string) {
		super(`Compatible OMP (${range}) not found. Run: bun install -g @oh-my-pi/pi-coding-agent, or set OMP_ZH_PACKAGE_DIR to its package directory.`);
		this.name = "HostNotFoundError";
	}
}

export interface Artifact {
	path: string;
	content: string | Uint8Array;
	mode?: number;
}

type ManifestKind = "extension" | "dictionary" | "launch" | "copy" | "config" | "launch-json" | "bash-launcher" | "cmd-launcher";
type ManifestPlatform = "all" | "unix-or-bash" | "windows";

interface InstallManifestEntry {
	kind: ManifestKind;
	source: string;
	destination: string;
	platform: ManifestPlatform;
}

function isManifestKind(value: string): value is ManifestKind {
	return value === "extension" || value === "dictionary" || value === "launch" || value === "copy" || value === "config" ||
		value === "launch-json" || value === "bash-launcher" || value === "cmd-launcher";
}

function readInstallManifest(repoDir: string): InstallManifestEntry[] {
	const text = readFileSync(join(repoDir, "install-manifest.tsv"), "utf8");
	if (text.includes("\r")) throw new Error("The install manifest must use LF line endings.");
	const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
	if (lines.length === 0 || lines.some(line => line.length === 0)) throw new Error("The install manifest contains an empty row.");
	const entries = lines.map((line, index): InstallManifestEntry => {
		const columns = line.split("\t");
		const [kind, source, destination, platform] = columns;
		if (columns.length !== 4 || kind === undefined || source === undefined || destination === undefined || platform === undefined ||
			!isManifestKind(kind) || isAbsolute(destination) || destination.includes("\\") ||
			!destination.split("/").every(part => part.length > 0 && part !== "." && part !== "..") ||
			!(platform === "all" || platform === "unix-or-bash" || platform === "windows")) {
			throw new Error(`Invalid install manifest row ${index + 1}.`);
		}
		const generated = kind === "launch-json" || kind === "bash-launcher" || kind === "cmd-launcher";
		if ((generated && source !== "-") || (!generated && (source === "-" || isAbsolute(source) || source.includes("\\") ||
			!source.split("/").every(part => part.length > 0 && part !== "." && part !== "..")))) {
			throw new Error(`Invalid install manifest source on row ${index + 1}.`);
		}
		if ((kind === "bash-launcher" && platform !== "unix-or-bash") || (kind === "cmd-launcher" && platform !== "windows") ||
			(!generated || kind === "launch-json") && platform !== "all") {
			throw new Error(`Invalid install manifest platform on row ${index + 1}.`);
		}
		return { kind, source, destination, platform };
	});
	if (new Set(entries.map(entry => entry.destination)).size !== entries.length) throw new Error("The install manifest contains duplicate destinations.");
	for (const kind of ["extension", "dictionary", "launch", "config", "launch-json", "bash-launcher", "cmd-launcher"] as const) {
		if (entries.filter(entry => entry.kind === kind).length !== 1) throw new Error(`The install manifest must contain exactly one ${kind} entry.`);
	}
	return entries;
}

function selectedManifestEntries(entries: readonly InstallManifestEntry[], env: Env): InstallManifestEntry[] {
	const selected: InstallManifestEntry[] = [];
	for (const entry of entries) {
		if (entry.platform === "all" || (entry.platform === "unix-or-bash" && (process.platform !== "win32" || env.OMP_ZH_INSTALL_SHELL === "bash")) ||
			(entry.platform === "windows" && process.platform === "win32")) selected.push(entry);
	}
	return selected;
}

function requiredManifestEntry(entries: readonly InstallManifestEntry[], kind: ManifestKind): InstallManifestEntry {
	const entry = entries.find(candidate => candidate.kind === kind);
	if (!entry) throw new Error(`The install manifest is missing its ${kind} entry.`);
	return entry;
}

function manifestTarget(homeDir: string, entry: InstallManifestEntry): string {
	return join(homeDir, ...entry.destination.split("/"));
}

export function expectedInstallationPaths(repoDir: string, env: Env = process.env): string[] {
	const homeDir = resolveHome(env);
	const entries = selectedManifestEntries(readInstallManifest(repoDir), env);
	return entries.map(entry => manifestTarget(homeDir, entry));
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

function lstatIfPresent(path: string): Stats | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

export function discoverPackage(range: string, env: Env = process.env): HostPackage {
	if (env.OMP_ZH_PACKAGE_DIR) return validatePackage(absolutePath(env.OMP_ZH_PACKAGE_DIR), range);
	const userHome = absolutePath((process.platform === "win32" ? env.USERPROFILE : undefined) || env.HOME || homedir());
	const packageSuffix = "node_modules/@oh-my-pi/pi-coding-agent";
	if (env.BUN_INSTALL_GLOBAL_DIR) return validatePackage(join(absolutePath(env.BUN_INSTALL_GLOBAL_DIR), packageSuffix), range);

	// Bun's global package-manager settings are independent of zhomp's install root.
	const configs = [join(userHome, ".bunfig.toml")];
	if (env.XDG_CONFIG_HOME) configs.push(join(absolutePath(env.XDG_CONFIG_HOME), ".bunfig.toml"));
	configs.push(join(process.cwd(), "bunfig.toml"));
	let configuredRoot: string | undefined;
	for (const file of configs) {
		if (!existsSync(file)) continue;
		const config: unknown = Bun.TOML.parse(readFileSync(file, "utf8"));
		if (!record(config)) throw new Error(`Invalid Bun configuration at ${file}.`);
		if (config.install === undefined) continue;
		if (!record(config.install)) throw new Error(`Invalid Bun install configuration at ${file}.`);
		const globalDir = config.install.globalDir;
		if (globalDir === undefined) continue;
		if (typeof globalDir !== "string" || globalDir.length === 0) {
			throw new Error(`Invalid Bun install.globalDir at ${file}; expected a nonempty path.`);
		}
		configuredRoot = absolutePath(globalDir, dirname(file));
	}

	if (configuredRoot) return validatePackage(join(configuredRoot, packageSuffix), range);
	const roots = [
		...(env.BUN_INSTALL ? [join(absolutePath(env.BUN_INSTALL), "install", "global")] : []),
		join(userHome, ".bun", "install", "global"),
		join(dirname(dirname(process.execPath)), "install", "global"),
	];
	const candidates = [...new Set(roots.map(root => join(root, packageSuffix)))];
	const errors: string[] = [];
	for (const candidate of candidates) {
		if (!lstatIfPresent(candidate)) continue;
		try { return validatePackage(candidate, range); }
		catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
	}
	if (errors.length > 0) throw new Error(errors.join("\n"));
	throw new HostNotFoundError(range);
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
			const existing = lstatIfPresent(artifact.path);
			if (existing && !existing.isFile()) throw new Error(`Refusing to replace a non-file: ${artifact.path}`);
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
			const existing = lstatIfPresent(entry.target);
			if (existing && !existing.isFile()) throw new Error(`Refusing to replace a non-file: ${entry.target}`);
			if (existing) {
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

function materializeArtifact(
	entry: InstallManifestEntry,
	manifest: readonly InstallManifestEntry[],
	repoDir: string,
	homeDir: string,
	host: HostPackage,
	range: string,
): Artifact {
	const path = manifestTarget(homeDir, entry);
	switch (entry.kind) {
		case "extension":
		case "launch":
		case "copy":
		case "config":
			return { path, content: readFileSync(join(repoDir, ...entry.source.split("/"))) };
		case "dictionary": {
			const content = readFileSync(join(repoDir, ...entry.source.split("/")));
			const dictionary: unknown = JSON.parse(content.toString("utf8"));
			if (!record(dictionary) || Object.values(dictionary).some(value => typeof value !== "string" || value.length === 0)) {
				throw new Error("The bundled dictionary must contain nonempty string translations.");
			}
			return { path, content };
		}
		case "launch-json": {
			const extensionPath = manifestTarget(homeDir, requiredManifestEntry(manifest, "extension"));
			const dictPath = manifestTarget(homeDir, requiredManifestEntry(manifest, "dictionary"));
			return { path, content: JSON.stringify({ packageDir: host.packageDir, supportedRange: range, extensionPath, dictPath }, null, 2) + "\n" };
		}
		case "bash-launcher": {
			const configEntry = requiredManifestEntry(manifest, "config");
			const launchEntry = requiredManifestEntry(manifest, "launch");
			const configPath = posix.relative(posix.dirname(entry.destination), configEntry.destination);
			const launchPath = posix.relative(posix.dirname(entry.destination), launchEntry.destination);
			return {
				path,
				mode: 0o755,
				content: `#!/usr/bin/env bash\nset -euo pipefail\nlauncher_dir="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"\nexec bun --no-install --no-env-file --config="$launcher_dir/${configPath}" "$launcher_dir/${launchPath}" -- "$@"\n`,
			};
		}
		case "cmd-launcher": {
			// Only ASCII syntax goes in this file; %~dp0 supplies the actual Unicode path.
			const configEntry = requiredManifestEntry(manifest, "config");
			const launchEntry = requiredManifestEntry(manifest, "launch");
			const configPath = posix.relative(posix.dirname(entry.destination), configEntry.destination).replaceAll("/", "\\");
			const launchPath = posix.relative(posix.dirname(entry.destination), launchEntry.destination).replaceAll("/", "\\");
			return {
				path,
				content: `@echo off\r\nsetlocal DisableDelayedExpansion\r\nbun --no-install --no-env-file --config="%~dp0${configPath}" "%~dp0${launchPath}" -- %*\r\nexit /b %ERRORLEVEL%\r\n`,
			};
		}
		default: {
			const unreachable: never = entry.kind;
			throw new Error(`Unsupported install manifest entry: ${unreachable}`);
		}
	}
}

export function install(repoDir: string, env: Env = process.env, replace: typeof renameSync = renameSync): { homeDir: string; packageDir: string; paths: string[] } {
	const range = readSupportPolicy(repoDir).range;
	const homeDir = resolveHome(env);
	const host = discoverPackage(range, env);
	const metadata: unknown = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
	if (!record(metadata) || !record(metadata.engines) || typeof metadata.engines.bun !== "string" || !Bun.semver.satisfies(Bun.version, metadata.engines.bun)) {
		throw new Error("Bun version does not satisfy zhomp's package.json engines.bun.");
	}
	const manifest = readInstallManifest(repoDir);
	const entries = selectedManifestEntries(manifest, env);
	const artifacts = entries.map(entry => materializeArtifact(entry, manifest, repoDir, homeDir, host, range));
	publishArtifacts(artifacts, replace);
	return { homeDir, packageDir: host.packageDir, paths: artifacts.map(artifact => artifact.path) };
}
