import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { HostPackage } from "./host";
import { MENU_MODULES, MENU_TEXT_KEYS } from "./menu-catalog";
import type { MenuModule, MenuPatch } from "./menu-catalog";
import { reportDiagnostic } from "./diagnostics";

type Dictionary = Readonly<Record<string, string>>;

type SourceReplacement = { start: number; end: number; value: string };

function unsupported(source: string): { source: string; supported: false } {
	return { source, supported: false };
}

function placeholderNames(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
		const name = match[1];
		if (name !== undefined) names.add(name);
	}
	return [...names].sort();
}

function menuTranslations(dictionary: Dictionary): Record<string, string> {
	const translations = Object.create(null) as Record<string, string>;
	for (const key of MENU_TEXT_KEYS) {
		if (!Object.hasOwn(dictionary, key)) continue;
		const value = dictionary[key];
		if (typeof value !== "string" || value.length === 0) continue;
		const placeholders = placeholderNames(key);
		if (placeholders.length > 0) {
			const translatedPlaceholders = placeholderNames(value);
			if (placeholders.length !== translatedPlaceholders.length ||
				!placeholders.every((name, index) => name === translatedPlaceholders[index])) continue;
		}
		translations[key] = value;
	}
	return translations;
}

function safeJson(value: unknown): string {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error("menu translations could not be encoded");
	return encoded.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function helperSource(translations: Readonly<Record<string, string>>): string {
	return [
		`const __zhompMenuTranslations = Object.freeze(Object.fromEntries(${safeJson(Object.entries(translations))}));`,
		"function __zhompMenuText(key: string, values?: Readonly<Record<string, string | number>>): string {",
		"\tconst text = Object.hasOwn(__zhompMenuTranslations, key) ? __zhompMenuTranslations[key] : key;",
		"\tif (values === undefined) return text;",
		"\treturn text.replace(/\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g, (placeholder, name) => {",
		"\t\treturn Object.hasOwn(values, name) ? String(values[name]) : placeholder;",
		"\t});",
		"}",
	].join("\n");
}

function collectReplacements(source: string, patches: readonly MenuPatch[]): SourceReplacement[] | undefined {
	const replacements: SourceReplacement[] = [];
	for (const patch of patches) {
		const expected = patch.count ?? 1;
		if (typeof patch.before !== "string" || patch.before.length === 0 || typeof patch.after !== "string" ||
			!Number.isSafeInteger(expected) || expected < 0) return undefined;
		let count = 0;
		let offset = 0;
		while ((offset = source.indexOf(patch.before, offset)) !== -1) {
			replacements.push({ start: offset, end: offset + patch.before.length, value: patch.after });
			count++;
			offset += patch.before.length;
		}
		if (count !== expected) return undefined;
	}
	return replacements;
}

/** Apply one menu's exact catalog patches atomically; unmatched source is returned untouched. */
export function translateMenuSource(
	source: string,
	module: MenuModule,
	dictionary: Dictionary,
): { source: string; supported: boolean } {
	try {
		const replacements = collectReplacements(source, module.patches);
		if (!replacements) return unsupported(source);
		if (module.variants) {
			let selected: SourceReplacement[] | undefined;
			for (const variant of module.variants) {
				const candidate = collectReplacements(source, variant);
				if (!candidate) continue;
				if (selected) return unsupported(source);
				selected = candidate;
			}
			if (!selected) return unsupported(source);
			replacements.push(...selected);
		}

		replacements.sort((left, right) => left.start - right.start);
		const output: string[] = [];
		let offset = 0;
		for (const replacement of replacements) {
			if (replacement.start < offset) return unsupported(source);
			output.push(source.slice(offset, replacement.start), replacement.value);
			offset = replacement.end;
		}
		output.push(source.slice(offset));
		const translatedSource = output.join("");
		if (replacements.length === 0) return { source: translatedSource, supported: true };

		const helper = helperSource(menuTranslations(dictionary));
		const prefix = source.startsWith("\uFEFF") ? "\uFEFF" : "";
		const body = translatedSource.slice(prefix.length);
		return { source: `${prefix}${helper}\n\n${body}`, supported: true };
	} catch {
		return unsupported(source);
	}
}

function modulePathKey(path: string): string {
	const absolute = resolve(path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function isWithinRoot(root: string, target: string): boolean {
	const path = relative(root, target);
	return path.length > 0 && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
}

function isRelativeModulePath(path: string): boolean {
	return path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
		path.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}


interface RegisteredMenuModule {
	module: MenuModule;
	dictionary: Dictionary;
}

const registeredModules = new Map<string, RegisteredMenuModule>();

function registerModule(path: string, module: MenuModule, dictionary: Dictionary): void {
	const key = modulePathKey(path);
	const registration = registeredModules.get(key);
	if (registration) {
		registration.module = module;
		registration.dictionary = dictionary;
		return;
	}

	const source = readFileSync(path, "utf8");
	if (!translateMenuSource(source, module, dictionary).supported) return;
	const filter = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, process.platform === "win32" ? "i" : "");
	Bun.plugin({
		name: `zhomp-menu-translation-${registeredModules.size + 1}`,
		setup(build) {
			build.onLoad({ filter }, ({ path: loadedPath }) => {
				let source: string;
				try {
					source = readFileSync(loadedPath, "utf8");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
						reportDiagnostic(`menu source could not be read: ${error instanceof Error ? error.message : String(error)}`);
					}
					return undefined;
				}
				const loadedRegistration = registeredModules.get(modulePathKey(loadedPath));
				if (!loadedRegistration) return { contents: source, loader: "ts", resolveDir: dirname(loadedPath) };
				const result = translateMenuSource(source, loadedRegistration.module, loadedRegistration.dictionary);
				if (!result.supported) reportDiagnostic(`menu source shape unsupported; translation skipped for ${loadedPath}`);
				return { contents: result.source, loader: "ts", resolveDir: dirname(loadedPath) };
			});
		},
	});
	registeredModules.set(key, { module, dictionary });
}

/** Register exact-path, source-scoped menu transforms for the selected host. */
export function registerMenuTranslations(
	host: Pick<HostPackage, "packageDir" | "tuiDir" | "modelHubPath" | "settingsUiPath">,
	dictionary: Dictionary,
): void {
	try {
		const roots = {
			agent: realpathSync(host.packageDir),
			tui: realpathSync(host.tuiDir),
		};
		const protectedPaths = new Set([modulePathKey(host.modelHubPath), modulePathKey(host.settingsUiPath)]);
		const hasTranslations = Object.keys(menuTranslations(dictionary)).length > 0;
		for (const module of MENU_MODULES) {
			try {
				if (!isRelativeModulePath(module.path)) {
					reportDiagnostic(`menu translation skipped: invalid package-relative path ${module.path}`);
					continue;
				}
				const root = roots[module.root];
				const target = realpathSync(resolve(root, ...module.path.split("/")));
				if (!isWithinRoot(root, target) || !statSync(target).isFile()) {
					reportDiagnostic(`menu translation skipped: module is outside its selected package root or is not a file (${module.path})`);
					continue;
				}
				const key = modulePathKey(target);
				if (protectedPaths.has(key)) {
					reportDiagnostic(`menu translation skipped: ${module.path} is owned by another display transform`);
					continue;
				}
				if (registeredModules.has(key) || hasTranslations) registerModule(target, module, dictionary);
			} catch (error) {
				if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
					reportDiagnostic(`menu translation skipped for ${module.path}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
	} catch (error) {
		reportDiagnostic(`menu translation registration failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
