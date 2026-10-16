import { strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "bun:test";
import { discoverPackage } from "../scripts/install-core";
import { readSupportPolicy } from "../runtime/host";
import { parseDictionaryText } from "./dictionary-validation";
import type { Dictionary } from "./dictionary-validation";

type DisplayField = {
	text: string;
	path: string;
};

type SettingsUiModule = {
	createSettingsHost: () => { entries: ReadonlyArray<{ path: string; ui?: Record<string, unknown> }> };
};

type SettingsDefsModule = {
	SETTING_TABS: readonly string[];
	TAB_METADATA: Record<string, { label: string }>;
	TAB_GROUPS: Record<string, readonly string[]>;
};

const repoDir = dirname(import.meta.dir);
const supportPolicy = readSupportPolicy(repoDir);
const host = discoverPackage(supportPolicy.range);
const dictionary = parseDictionaryText(readFileSync(join(repoDir, "dict", "zh-CN.json"), "utf8"));

const settingsTemplateKeys = [
	"Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until {escape}",
	"Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes {shift}+drag and wheel scroll becomes {shift}+wheel while on",
	"Modal prompt editing. {escape} leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
	"Keep drafts cleared with {ctrlC} in local {upDown} history until exit; disabling affects future clears",
	"What pressing {escape} twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing",
	"Show predicted word completions as inline hints: {tab} accepts with a space, {right} without",
	"After a completed turn, ask the active model to predict your next message and show it as ghost text in the empty composer; {tab} or {right} inserts it without sending. Extra usage: every completed turn sends one more billed request over the whole conversation (counted in /stats)",
	"When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable ({escape}) but also hold subagents, so leave off for unattended runs.",
	"Unset, it falls back to ${envName}.",
	"${envName} overrides this setting while it is set.",
] as const;

function addField(fields: DisplayField[], value: unknown, path: string): void {
	if (typeof value === "string" && value.length > 0) fields.push({ text: value, path });
}

function collectDisplayFields(
	entries: ReadonlyArray<{ path: string; ui?: Record<string, unknown> }>,
	defs: SettingsDefsModule,
): DisplayField[] {
	const fields: DisplayField[] = [];
	for (const entry of entries) {
		const ui = entry.ui;
		if (!ui || typeof ui.tab !== "string" || !defs.SETTING_TABS.includes(ui.tab)) continue;
		for (const key of ["label", "description", "warning", "group"]) {
			addField(fields, ui[key], `${entry.path}.ui.${key}`);
		}
		if (Array.isArray(ui.options)) {
			for (const [index, option] of ui.options.entries()) {
				if (!option || typeof option !== "object") continue;
				const optionRecord = option as Record<string, unknown>;
				for (const key of ["label", "description"]) {
					const value = optionRecord[key];
					addField(fields, value, `${entry.path}.options[${index}].${key}`);
				}
			}
		}
	}
	for (const [tab, metadata] of Object.entries(defs.TAB_METADATA)) {
		addField(fields, metadata.label, `TAB_METADATA.${tab}.label`);
	}
	for (const [tab, groups] of Object.entries(defs.TAB_GROUPS)) {
		for (const [index, group] of groups.entries()) addField(fields, group, `TAB_GROUPS.${tab}[${index}]`);
	}
	return fields;
}

const countUnits = String.raw`(?:(?:[KMG]\s+)?tokens?|items?|lines?|messages?|minutes?|mins?|seconds?|secs?|steps?|tasks?|turns?|requests?|retries?|reminders?|operations?|notes?|hours?|hrs?|days?|KB|MB|GB)`;
const numericOrUnitText = new RegExp(
	String.raw`^~?[-+]?\d+(?:\.\d+)?(?:\s*%|[x×]|[KMG]\s+tokens?|\s+${countUnits}|(?:ms|milliseconds?|s|m|h|d))?$`,
	"i",
);
const preservedTechnicalText: Record<string, true> = {
	"AGENTS.md": true,
	"AI": true,
	"Amazon S3": true,
	"Anthropic": true,
	"APFS": true,
	"api.kimi.com": true,
	"api.moonshot.ai": true,
	"Arbor": true,
	"ASCII": true,
	"Azure Blob Storage": true,
	"Backblaze B2": true,
	"Bash": true,
	"bnb4": true,
	"bore": true,
	"Box": true,
	"Breeze": true,
	"btrfs": true,
	"Catbox": true,
	"Chevereto": true,
	"Cloudflare R2": true,
	"CoreML": true,
	"Cove": true,
	"CPU": true,
	"CUDA": true,
	"DeepSeek": true,
	"DirectML": true,
	"Discord": true,
	"Dropbox": true,
	"Ember": true,
	"Exa": true,
	"Firecrawl": true,
	"Fireworks": true,
	"Flickr": true,
	"fp16": true,
	"fp32": true,
	"FTP / FTPS / SFTP": true,
	"Garage": true,
	"Gemini": true,
	"Gemma": true,
	"Git": true,
	"GitHub": true,
	"GitHub CLI": true,
	"GitHub Gist": true,
	"GLM": true,
	"Glob": true,
	"Google Cloud Storage": true,
	"Google Drive": true,
	"GPU": true,
	"Grep": true,
	"Harmony": true,
	"Hermes": true,
	"IDA Pro": true,
	"IDA Python": true,
	"ImageShack": true,
	"Imgur": true,
	"int8": true,
	"Jina": true,
	"Juniper": true,
	"Kimi": true,
	"Litterbox": true,
	"localhost.run": true,
	"LSP": true,
	"Lynx": true,
	"Maple": true,
	"Metal": true,
	"MiniMax": true,
	"MinIO": true,
	"MLX": true,
	"Mnemopi": true,
	"N-gram": true,
	"Nerd": true,
	"Nerd Font": true,
	"ngrok": true,
	"OneDrive": true,
	"OpenAI": true,
	"Overlayfs": true,
	"ownCloud / Nextcloud": true,
	"Pinggy": true,
	"Plik": true,
	"Pomf": true,
	"pomf": true,
	"Powerline": true,
	"ProjFS": true,
	"q1": true,
	"q1f16": true,
	"q2": true,
	"q2f16": true,
	"q4": true,
	"q4f16": true,
	"q8": true,
	"Qwen3": true,
	"Ratchet": true,
	"Reflink": true,
	"s3": true,
	"Seafile": true,
	"Sharpshooter": true,
	"Shake": true,
	"SmolLM": true,
	"Sol": true,
	"s-ul": true,
	"Spruce": true,
	"Tailscale Funnel": true,
	"Tigris": true,
	"tmpfiles.org": true,
	"Trafilatura": true,
	"TTSR": true,
	"Uguu": true,
	"uint8": true,
	"Unicode": true,
	"Vale": true,
	"vgy.me": true,
	"WASM": true,
	"WebGPU": true,
	"WebNN": true,
	"WebNN CPU": true,
	"WebNN GPU": true,
	"WebNN NPU": true,
	"webdav": true,
	"XML": true,
	"ZFS": true,
	"zrok": true,
	":exacto": true,
	":floor": true,
	":nitro": true,
	":online": true,
	"0x0.st": true,
};

function isSemanticField(field: DisplayField): boolean {
	const text = field.text.trim();
	if (text.length === 0) return false;
	if (numericOrUnitText.test(text)) return false;
	if (Object.hasOwn(preservedTechnicalText, text)) return false;
	return true;
}

function findUncoveredFields(fields: readonly DisplayField[], dictionary: Dictionary): DisplayField[] {
	const semanticFields = new Map<string, DisplayField>();
	for (const field of fields) {
		if (isSemanticField(field) && !semanticFields.has(field.text)) semanticFields.set(field.text, field);
	}
	return [...semanticFields.values()].filter(
		field => !Object.hasOwn(dictionary, field.text) || dictionary[field.text] === field.text,
	);
}

async function readInstalledDisplayFields(): Promise<DisplayField[]> {
	const [settingsUi, defs] = await Promise.all([
		import(pathToFileURL(host.settingsUiPath).href) as Promise<SettingsUiModule>,
		import(pathToFileURL(host.settingsDefsPath).href) as Promise<SettingsDefsModule>,
	]);
	const entries = settingsUi.createSettingsHost().entries;
	strictEqual(entries.length > 0, true, "the real installed host must expose settings entries");
	return collectDisplayFields(entries, defs);
}

describe("real installed settings dictionary coverage", () => {
	test("covers semantic fields emitted by the installed settings UI", async () => {
		const fields = await readInstalledDisplayFields();
		const templateFields = settingsTemplateKeys.map((text, index) => ({ text, path: `settings template ${index}` }));
		const missing = findUncoveredFields([...fields, ...templateFields], dictionary);
		strictEqual(missing.length, 0, `uncovered semantic settings text:\n${missing.map(field => `${field.path}: ${field.text}`).join("\n")}`);
	});

	test("reports removed translations for real display strings", async () => {
		const fields = await readInstalledDisplayFields();
		const translatedDisplayTexts = new Set(
			fields
				.map(field => field.text)
				.filter(text => !/^~?[-+]?\d/.test(text.trim()) && Object.hasOwn(dictionary, text) && dictionary[text] !== text)
		);
		strictEqual(translatedDisplayTexts.size > 0, true, "the real host must expose translated display strings");

		const dictionaryWithoutTranslations = { ...dictionary };
		for (const text of translatedDisplayTexts) delete dictionaryWithoutTranslations[text];
		const missingTexts = new Set(findUncoveredFields(fields, dictionaryWithoutTranslations).map(field => field.text));
		for (const text of translatedDisplayTexts) {
			strictEqual(missingTexts.has(text), true, `coverage did not report the removed display translation: ${text}`);
		}
	});
});
