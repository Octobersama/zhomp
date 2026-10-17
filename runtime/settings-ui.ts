import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { reportDiagnostic } from "./diagnostics";

type Dictionary = Readonly<Record<string, string>>;

interface EnvNoteTemplates {
	fallback: string;
	override: string;
}

const FALLBACK_TEMPLATE_SOURCE = "Unset, it falls back to ${envName}.";
const OVERRIDE_TEMPLATE_SOURCE = "${envName} overrides this setting while it is set.";
const ENV_NOTE_MARKER = "__zhompSettingsUiEnvNoteTemplates";
const ENV_NOTE_BLOCK_SOURCE = [
	"/** Description suffix telling the panel user that an environment variable is in play. */",
	"function envNote(setting: AnySetting): string {",
	'\tif (!setting.envName || setting.envValue() === undefined) return "";',
	"\treturn setting.envFallback",
	"\t\t? ` Unset, it falls back to $${setting.envName}.`",
	"\t\t: ` $${setting.envName} overrides this setting while it is set.`;",
	"}",
].join("\n");

const TRANSLATED_ENV_NOTE_FUNCTION = [
	"/** Description suffix telling the panel user that an environment variable is in play. */",
	"function envNote(setting: AnySetting): string {",
	'\tif (!setting.envName || setting.envValue() === undefined) return "";',
	"\tconst template = setting.envFallback",
	`\t\t? ${ENV_NOTE_MARKER}.fallback`,
	`\t\t: ${ENV_NOTE_MARKER}.override;`,
	"\treturn ` ${template.replaceAll(\"${envName}\", () => `$${setting.envName}`)}`;",
	"}",
].join("\n");

const translationsByPath = new Map<string, EnvNoteTemplates>();

function escapeRegex(source: string): string {
	let escaped = "";
	for (const character of source) {
		if ("\\^$.*+?()[]{}|".includes(character)) escaped += "\\";
		escaped += character;
	}
	return escaped;
}

function envNoteTemplate(dictionary: Dictionary, source: string): string {
	if (!Object.hasOwn(dictionary, source)) return source;
	const translated = dictionary[source];
	const placeholder = "${envName}";
	const first = translated.indexOf(placeholder);
	if (first === -1 || (first > 0 && translated[first - 1] === "$")) return source;
	if (translated.indexOf(placeholder, first + placeholder.length) !== -1) return source;
	return translated;
}

function getEnvNoteTemplates(dictionary: Dictionary): EnvNoteTemplates | undefined {
	const fallback = envNoteTemplate(dictionary, FALLBACK_TEMPLATE_SOURCE);
	const override = envNoteTemplate(dictionary, OVERRIDE_TEMPLATE_SOURCE);
	if (fallback === FALLBACK_TEMPLATE_SOURCE && override === OVERRIDE_TEMPLATE_SOURCE) return undefined;
	return { fallback, override };
}

function createSettingsUiSource(source: string, templates: EnvNoteTemplates, path: string): string {
	if (source.includes(ENV_NOTE_MARKER)) return source;
	const start = source.indexOf(ENV_NOTE_BLOCK_SOURCE);
	if (start === -1 || source.indexOf(ENV_NOTE_BLOCK_SOURCE, start + ENV_NOTE_BLOCK_SOURCE.length) !== -1) {
		reportDiagnostic(`settings UI source shape unsupported; environment note translation skipped for ${path}`);
		return source;
	}
	const helper = `const ${ENV_NOTE_MARKER}: Readonly<{ fallback: string; override: string }> = Object.freeze(${JSON.stringify(templates)});`;
	const replacement = `${helper}\n\n${TRANSLATED_ENV_NOTE_FUNCTION}`;
	return `${source.slice(0, start)}${replacement}${source.slice(start + ENV_NOTE_BLOCK_SOURCE.length)}`;
}

/** Register a source-scoped patch for the host's two fixed environment-note templates. */
export function registerSettingsUiTranslation(settingsUiPath: string, dictionary: Dictionary): void {
	try {
		if (!isAbsolute(settingsUiPath)) {
			reportDiagnostic("settings UI translation skipped; expected an absolute host module path");
			return;
		}
		const templates = getEnvNoteTemplates(dictionary);
		if (!templates) return;
		const absolute = resolve(settingsUiPath);
		const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
		const alreadyRegistered = translationsByPath.has(key);
		translationsByPath.set(key, templates);
		if (alreadyRegistered) return;

		const filter = new RegExp(`^${escapeRegex(absolute)}$`, process.platform === "win32" ? "i" : "");
		Bun.plugin({
			name: "zhomp-settings-ui-environment-note-translation",
			setup(build) {
				build.onLoad({ filter }, ({ path }) => {
					let source: string;
					try {
						source = readFileSync(path, "utf8");
					} catch (error) {
						reportDiagnostic(`settings UI translation skipped: ${error instanceof Error ? error.message : String(error)}`);
						return undefined;
					}
					const current = translationsByPath.get(key);
					if (!current) return { contents: source, loader: "ts", resolveDir: dirname(path) };
					return { contents: createSettingsUiSource(source, current, path), loader: "ts", resolveDir: dirname(path) };
				});
			},
		});
	} catch (error) {
		reportDiagnostic(`settings UI translation skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}
