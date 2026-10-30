import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "bun:test";
import { MENU_TEXT_KEYS } from "../runtime/menu-catalog";
import type { MenuModule } from "../runtime/menu-catalog";
import { translateMenuSource } from "../runtime/menu-ui";
import { parseDictionaryText } from "./dictionary-validation";
import { makeTempDir, removeTree, writeText } from "./verification-fixtures";

const repoDir = dirname(import.meta.dir);
const dictionary = parseDictionaryText(readFileSync(join(repoDir, "dict", "zh-CN.json"), "utf8"));

describe("menu translation catalogue", () => {
	test("every fixed menu string has a shipped dictionary translation", () => {
		const missing = MENU_TEXT_KEYS.filter(key => {
			const value = dictionary[key];
			return typeof value !== "string" || value.trim().length === 0;
		});
		deepStrictEqual(missing, []);
	});

	test("a late incompatible patch keeps the entire menu in its original language", async () => {
		const root = makeTempDir("zhomp-menu-atomic");
		const source = [
			'const heading = "Settings";',
			'const emptyStates = ["No matching settings"];',
			"export function renderMenu() { return [heading, ...emptyStates]; }",
		].join("\n");
		const module: MenuModule = {
			root: "tui",
			path: "menu.ts",
			patches: [
				{ before: 'const heading = "Settings";', after: 'const heading = __zhompMenuText("Settings");' },
				{ before: '"No matching settings"', after: '__zhompMenuText("No matching settings")' },
			],
		};
		const translations = { Settings: "设置", "No matching settings": "没有匹配的设置" };
		try {
			const supported = translateMenuSource(source, module, translations);
			strictEqual(supported.supported, true);
			const translatedPath = join(root, "translated.ts");
			writeText(translatedPath, supported.source);
			const translated = await import(pathToFileURL(translatedPath).href) as { renderMenu(): string[] };
			deepStrictEqual(translated.renderMenu(), ["设置", "没有匹配的设置"]);

			const variants = [
				{
					name: "missing-late-anchor",
					source: source.replace('"No matching settings"', '"No matches after an upstream change"'),
					module,
					expected: ["Settings", "No matches after an upstream change"],
				},
				{
					name: "duplicate-late-anchor",
					source: source.replace('["No matching settings"]', '["No matching settings", "No matching settings"]'),
					module,
					expected: ["Settings", "No matching settings", "No matching settings"],
				},
				{
					name: "overlapping-late-patch",
					source,
					module: { ...module, patches: [...module.patches, { before: '"Settings"', after: '__zhompMenuText("Settings")' }] },
					expected: ["Settings", "No matching settings"],
				},
			];
			for (const variant of variants) {
				const rejected = translateMenuSource(variant.source, variant.module, translations);
				strictEqual(rejected.supported, false, variant.name);
				const path = join(root, `${variant.name}.ts`);
				writeText(path, rejected.source);
				const consumer = await import(pathToFileURL(path).href) as { renderMenu(): string[] };
				deepStrictEqual(consumer.renderMenu(), variant.expected, `${variant.name} must not leave a translated heading above an untranslated menu`);
			}
		} finally {
			removeTree(root);
		}
	});

	test("source variants translate one complete menu or leave unknown and ambiguous menus intact", async () => {
		const root = makeTempDir("zhomp-menu-variants");
		const source = (body: string) => `const heading = "Settings";\nconst body = ${body};\nexport function renderMenu() { return [heading, body]; }`;
		const legacy = { before: '"No matching settings"', after: '__zhompMenuText("No matching settings")' };
		const current = { before: '"Search sessions…"', after: '__zhompMenuText("Search sessions…")' };
		const module: MenuModule = {
			root: "tui",
			path: "menu.ts",
			patches: [{ before: '"Settings"', after: '__zhompMenuText("Settings")' }],
			variants: [[legacy], [current]],
		};
		const cases = [
			{ name: "legacy", body: '"No matching settings"', module, supported: true, expected: ["设置", "没有匹配的设置"] },
			{ name: "current", body: '"Search sessions…"', module, supported: true, expected: ["设置", "搜索会话…"] },
			{ name: "unknown", body: '"Upstream changed"', module, supported: false, expected: ["Settings", "Upstream changed"] },
			{ name: "ambiguous", body: '"Search sessions…"', module: { ...module, variants: [[current], [current]] }, supported: false, expected: ["Settings", "Search sessions…"] },
			{ name: "incomplete", body: '"Search sessions…"', module: { ...module, variants: [[legacy], [current, { before: '"Missing footer"', after: '"页脚"' }]] }, supported: false, expected: ["Settings", "Search sessions…"] },
			{ name: "overlap", body: '"Search sessions…"', module: { ...module, variants: [[current, module.patches[0]!]] }, supported: false, expected: ["Settings", "Search sessions…"] },
		];
		try {
			for (const candidate of cases) {
				const original = source(candidate.body);
				const result = translateMenuSource(original, candidate.module, {
					Settings: "设置", "No matching settings": "没有匹配的设置", "Search sessions…": "搜索会话…",
				});
				strictEqual(result.supported, candidate.supported, candidate.name);
				if (!candidate.supported) strictEqual(result.source, original, candidate.name);
				const file = join(root, `${candidate.name}.ts`);
				writeText(file, result.source);
				const consumer = await import(pathToFileURL(file).href) as { renderMenu(): string[] };
				deepStrictEqual(consumer.renderMenu(), candidate.expected, candidate.name);
			}
		} finally {
			removeTree(root);
		}
	});
});
