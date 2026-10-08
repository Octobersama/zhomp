import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface HostPackage {
	packageDir: string;
	version: string;
	cliPath: string;
	tuiDir: string;
	allSettingsPath: string;
	settingsUiPath: string;
	settingsDefsPath: string;
	modelHubPath: string;
	cliCommandsPath: string;
	cliArgsPath: string;
}

export interface LaunchConfig {
	host: HostPackage;
	extensionPath: string;
	dictPath: string;
}

interface PackageMetadata {
	name: string;
	version: string;
	dependencies?: { "@oh-my-pi/pi-tui"?: unknown };
	peerDependencies?: { "@oh-my-pi/pi-coding-agent"?: unknown };
}

interface PersistedLaunchConfig {
	packageDir: string;
	supportedRange: string;
	extensionPath: string;
	dictPath: string;
}

const semverSource = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-(?:(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const semverPattern = new RegExp(`^${semverSource}$`);
const peerRangePattern = new RegExp(`^>=(${semverSource}) <(0|[1-9]\\d*)$`);


function isStrictSemver(version: string): boolean {
	return semverPattern.test(version);
}

function parsePeerRange(range: string): { range: string; minimumVersion: string } {
	const match = peerRangePattern.exec(range);
	if (!match) throw new Error("zhomp must declare a bounded OMP peer range with a strict SemVer minimum.");
	return { range, minimumVersion: match[1] };
}

export function readSupportPolicy(repoDir: string): { range: string; minimumVersion: string } {
	const metadata = readPackageMetadata(repoDir);
	const range = metadata.peerDependencies?.["@oh-my-pi/pi-coding-agent"];
	if (typeof range !== "string") throw new Error("zhomp must declare a bounded OMP peer range with a strict SemVer minimum.");
	return parsePeerRange(range);
}

function hasExport(source: string, name: string): boolean {
	return new RegExp(`export\\s+(?:const|function|class|let|var)\\s+${name}\\b`).test(source) ||
		new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(source);
}

function resolveHostModule(packageDir: string, specifier: string, label: string): string {
	try {
		const path = realpathSync(Bun.resolveSync(specifier, packageDir));
		if (!statSync(path).isFile()) throw new Error("not a regular file");
		return path;
	} catch (error) {
		throw new Error(`Missing host source: ${label} (${error instanceof Error ? error.message : String(error)})`);
	}
}

function parsePackageMetadata(value: unknown, location: string): PackageMetadata {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid package metadata at ${location}.`);
	}
	const fields = value as { name?: unknown; version?: unknown; dependencies?: unknown; peerDependencies?: unknown };
	if (typeof fields.name !== "string" || typeof fields.version !== "string") {
		throw new Error(`Invalid package identity at ${location}.`);
	}
	const metadata: PackageMetadata = { name: fields.name, version: fields.version };
	if (fields.dependencies !== undefined) {
		if (fields.dependencies === null || typeof fields.dependencies !== "object" || Array.isArray(fields.dependencies)) {
			throw new Error(`Invalid package dependencies at ${location}.`);
		}
		metadata.dependencies = fields.dependencies as { "@oh-my-pi/pi-tui"?: unknown };
	}
	if (fields.peerDependencies !== undefined) {
		if (fields.peerDependencies === null || typeof fields.peerDependencies !== "object" || Array.isArray(fields.peerDependencies)) {
			throw new Error(`Invalid package peer dependencies at ${location}.`);
		}
		metadata.peerDependencies = fields.peerDependencies as { "@oh-my-pi/pi-coding-agent"?: unknown };
	}
	return metadata;
}

function readPackageMetadata(packageDir: string): PackageMetadata {
	const metadata: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	return parsePackageMetadata(metadata, packageDir);
}

function resolvePackageRoot(modulePath: string, packageName: string): { packageDir: string; metadata: PackageMetadata } {
	for (let current = dirname(modulePath); ; current = dirname(current)) {
		const metadataPath = join(current, "package.json");
		try {
			const metadata: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
			if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata) &&
				"name" in metadata && metadata.name === packageName) {
				return { packageDir: current, metadata: parsePackageMetadata(metadata, metadataPath) };
			}
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		const parent = dirname(current);
		if (parent === current) throw new Error(`Cannot locate ${packageName} for ${modulePath}.`);
	}
}

export function validatePackage(input: string, range: string): HostPackage {
	parsePeerRange(range);
	const packageDir = realpathSync(resolve(input));
	const metadata = readPackageMetadata(packageDir);
	const version = metadata.version;
	if (metadata.name !== "@oh-my-pi/pi-coding-agent" || !isStrictSemver(version)) {
		throw new Error(`Expected @oh-my-pi/pi-coding-agent with a strict SemVer version at ${packageDir}; found ${String(metadata.name)} ${String(version)}.`);
	}
	if (!Bun.semver.satisfies(version, range)) {
		throw new Error(`Expected @oh-my-pi/pi-coding-agent ${range} at ${packageDir}; found ${String(metadata.name)} ${version}.`);
	}

	const cliPath = realpathSync(join(packageDir, "src", "cli.ts"));
	if (!statSync(cliPath).isFile()) throw new Error("Missing host source: src/cli.ts");
	const allSettingsPath = resolveHostModule(packageDir, "@oh-my-pi/pi-coding-agent/config/all-settings", "config/all-settings");
	const settingsUiPath = resolveHostModule(packageDir, "@oh-my-pi/pi-coding-agent/config/settings-ui", "config/settings-ui");
	const cliCommandsPath = resolveHostModule(packageDir, "@oh-my-pi/pi-coding-agent/cli-commands", "cli-commands");
	const cliArgsPath = resolveHostModule(packageDir, "@oh-my-pi/pi-coding-agent/cli/args", "cli/args");
	const settingsDefsPath = resolveHostModule(packageDir, "@oh-my-pi/pi-tui/overlays/settings-defs", "pi-tui/overlays/settings-defs");
	const modelHubPath = resolveHostModule(packageDir, "@oh-my-pi/pi-tui/overlays/model-hub", "pi-tui/overlays/model-hub");

	const requiredExports = [
		[allSettingsPath, ["orderedSettings"]],
		[settingsUiPath, ["createSettingsHost"]],
		[cliCommandsPath, ["resolveCliArgv", "LAUNCH_FLAG_COMMANDS"]],
		[cliArgsPath, ["parseArgs"]],
		[modelHubPath, ["ModelHubComponent"]],
	] as const;
	for (const [path, names] of requiredExports) {
		const source = readFileSync(path, "utf8");
		for (const name of names) {
			if (!hasExport(source, name)) throw new Error(`Missing host capability: ${name}`);
		}
	}

	const { packageDir: tuiDir, metadata: tui } = resolvePackageRoot(settingsDefsPath, "@oh-my-pi/pi-tui");
	const tuiVersion = tui.version;
	const tuiRange = metadata.dependencies?.["@oh-my-pi/pi-tui"];
	if (!isStrictSemver(tuiVersion) || typeof tuiRange !== "string" || !Bun.semver.satisfies(tuiVersion, tuiRange)) {
		throw new Error(`The host's pi-tui dependency does not satisfy ${String(tuiRange)}.`);
	}
	const defsSource = readFileSync(settingsDefsPath, "utf8");
	if (!hasExport(defsSource, "TAB_METADATA") || !hasExport(defsSource, "TAB_GROUPS")) {
		throw new Error("Missing pi-tui settings definitions.");
	}

	return { packageDir, version, cliPath, tuiDir, allSettingsPath, settingsUiPath, settingsDefsPath, modelHubPath, cliCommandsPath, cliArgsPath };
}

function parsePersistedLaunchConfig(value: unknown): PersistedLaunchConfig {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid zhomp launch configuration; reinstall zhomp.");
	}
	const fields = value as { packageDir?: unknown; supportedRange?: unknown; extensionPath?: unknown; dictPath?: unknown };
	const { packageDir, supportedRange, extensionPath, dictPath } = fields;
	if (typeof packageDir !== "string" || packageDir.length === 0) throw new Error("Invalid zhomp launch configuration: packageDir");
	if (typeof supportedRange !== "string" || supportedRange.length === 0) throw new Error("Invalid zhomp launch configuration: supportedRange");
	if (typeof extensionPath !== "string" || extensionPath.length === 0) throw new Error("Invalid zhomp launch configuration: extensionPath");
	if (typeof dictPath !== "string" || dictPath.length === 0) throw new Error("Invalid zhomp launch configuration: dictPath");
	if (!isAbsolute(packageDir) || !isAbsolute(extensionPath) || !isAbsolute(dictPath)) {
		throw new Error("zhomp launch paths must be absolute; reinstall zhomp.");
	}
	return { packageDir, supportedRange, extensionPath, dictPath };
}

export function readLaunchConfig(configPath: string): LaunchConfig {
	if (!isAbsolute(configPath)) throw new Error("zhomp launch configuration path must be absolute; reinstall zhomp.");
	const persisted = parsePersistedLaunchConfig(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
	const host = validatePackage(persisted.packageDir, persisted.supportedRange);
	return { host, extensionPath: persisted.extensionPath, dictPath: persisted.dictPath };
}
