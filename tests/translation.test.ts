import { deepStrictEqual, notStrictEqual, strictEqual, throws } from "node:assert";
import { describe, test } from "bun:test";
import {
	isTranslationEnabled,
	parseDictionary,
	parseDictionaryText,
	translateSettings,
	type TranslationHost,
} from "../extensions/zhomp";

type FixtureSetting = {
	id: string;
	value: string;
	default: string;
	enumValues: readonly string[];
	validate: (value: unknown) => boolean;
	ui: {
		tab: string;
		group: string;
		label: string;
		description: string;
		warning?: string;
		options: Array<{ value: string; label: string; description: string }>;
	};
};

function createFixture(): {
	host: TranslationHost;
	setting: FixtureSetting;
	groupList: string[];
	optionList: FixtureSetting["ui"]["options"];
	validate: FixtureSetting["validate"];
} {
	const groupList = ["General"];
	const validate = (value: unknown): boolean => typeof value === "string";
	const optionList = [
		{ value: "dark", label: "Dark", description: "Dark theme" },
		{ value: "light", label: "Light", description: "Light theme" },
	];
	const setting: FixtureSetting = {
		id: "appearance.theme",
		value: "dark",
		default: "dark",
		enumValues: ["dark", "light"],
		validate,
		ui: {
			tab: "appearance",
			group: groupList[0],
			label: "Theme",
			description: "Choose a theme",
			warning: "Preview changes",
			options: optionList,
		},
	};
	const host: TranslationHost = {
		orderedSettings: () => [setting],
		tabMetadata: {
			appearance: { label: "Appearance", icon: "tab.appearance" },
		},
		tabGroups: { appearance: groupList },
	};
	return { host, setting, groupList, optionList, validate };
}

describe("translation boundary", () => {
	test("translates only display fields in place and preserves identities", () => {
		const { host, setting, groupList, optionList, validate } = createFixture();
		const tab = host.tabMetadata as { appearance: { label: string; icon: string } };
		const tabObject = tab.appearance;
		const uiObject = setting.ui;
		const enumValues = setting.enumValues;
		const value = setting.value;
		const defaultValue = setting.default;
		const settingId = setting.id;
		const validator = setting.validate;
		const groups = host.tabGroups as { appearance: string[] };
		const groupArray = groups.appearance;
		const optionObject = optionList[0];
		const secondOptionObject = optionList[1];
		const optionValues = optionList.map(option => option.value);

		const counts = translateSettings(host, {
			Appearance: "外观",
			General: "通用",
			Theme: "主题",
			"Choose a theme": "选择主题",
			"Preview changes": "预览更改",
			Dark: "深色",
			"Dark theme": "深色主题",
			Light: "浅色",
			"Light theme": "浅色主题",
		});

		strictEqual(counts.total, 10);
		strictEqual(tab.appearance, tabObject);
		strictEqual(setting.ui, uiObject);
		strictEqual(setting.enumValues, enumValues);
		strictEqual(setting.value, value);
		strictEqual(setting.default, defaultValue);
		strictEqual(setting.id, settingId);
		strictEqual(setting.validate, validator);
		strictEqual(groupArray, groupList);
		strictEqual(optionList, setting.ui.options);
		strictEqual(optionList[0], optionObject);
		strictEqual(optionList[1], secondOptionObject);
		strictEqual(optionList[0].value, optionValues[0]);
		strictEqual(optionList[1].value, optionValues[1]);
		strictEqual(tab.appearance.label, "外观");
		strictEqual(groupList[0], "通用");
		strictEqual(setting.ui.group, "通用");
		strictEqual(setting.ui.label, "主题");
		strictEqual(setting.ui.description, "选择主题");
		strictEqual(setting.ui.warning, "预览更改");
		strictEqual(optionList[0].label, "深色");
		strictEqual(optionList[0].description, "深色主题");
		strictEqual(validate("still same function"), true);
	});

	test("keeps a shared group name consistent and is idempotent", () => {
		const { host, setting, groupList } = createFixture();
		const dictionary = { General: "通用", Theme: "主题", "Choose a theme": "选择主题" };
		const first = translateSettings(host, dictionary);
		const translatedGroups = host.tabGroups as { appearance: string[] };
		strictEqual(first.groups, 2);
		strictEqual(translatedGroups.appearance, groupList);
		strictEqual(translatedGroups.appearance[0], "通用");
		strictEqual(setting.ui.group, "通用");
		const second = translateSettings(host, dictionary);
		strictEqual(second.total, 0);
		strictEqual(setting.ui.label, "主题");
	});

	test("rejects unknown dictionary roots and ignores non-string entries", () => {
		strictEqual(parseDictionary(null), undefined);
		strictEqual(parseDictionary([]), undefined);
		strictEqual(parseDictionary("text"), undefined);
		strictEqual(parseDictionaryText("{ malformed"), undefined);
		deepStrictEqual(parseDictionary({ Keep: "保留", Empty: "", Null: null, Number: 1 }), { Keep: "保留" });
	});

	test("does not enable translation for an unset, empty, or different process id", () => {
		strictEqual(isTranslationEnabled({}), false);
		strictEqual(isTranslationEnabled({ OMP_ZH_ENABLED: "", OMP_ZH_PROCESS_ID: String(process.pid) }), false);
		strictEqual(isTranslationEnabled({ OMP_ZH_ENABLED: "0", OMP_ZH_PROCESS_ID: String(process.pid) }), false);
		strictEqual(isTranslationEnabled({ OMP_ZH_ENABLED: "1", OMP_ZH_PROCESS_ID: "other-process" }), false);
		strictEqual(isTranslationEnabled({ OMP_ZH_ENABLED: "1", OMP_ZH_PROCESS_ID: String(process.pid) }), true);
	});

	test("validates the complete host before making a partial mutation", () => {
		const { host } = createFixture();
		const tab = host.tabMetadata as { appearance: { label: string; icon: string } };
		const groups = host.tabGroups as { appearance: string[] };
		const beforeTab = tab.appearance.label;
		const beforeGroup = groups.appearance[0];
		tab.appearance.icon = "tab.appearance";
		const invalidHost: TranslationHost = {
			...host,
			tabGroups: { appearance: ["General", 4] },
		};
		let error: unknown;
		try {
			translateSettings(invalidHost, { Appearance: "外观", General: "通用" });
		} catch (caught) {
			error = caught;
		}
		notStrictEqual(error, undefined);
		strictEqual(tab.appearance.label, beforeTab);
		strictEqual(groups.appearance[0], beforeGroup);
	});

	test("keeps dynamic descriptions live and avoids partial translation on a locked field", () => {
		const { host, setting, groupList } = createFixture();
		let shortcut = "Esc";
		Object.defineProperty(setting.ui, "description", {
			configurable: true,
			enumerable: true,
			get() { return `Press ${shortcut} to cancel`; },
		});
		const dict = { Appearance: "外观", General: "通用", "Press Esc to cancel": "按 Esc 取消", "Press Ctrl+C to cancel": "按 Ctrl+C 取消" };
		translateSettings(host, dict);
		strictEqual(setting.ui.description, "按 Esc 取消");
		shortcut = "Ctrl+C";
		strictEqual(setting.ui.description, "按 Ctrl+C 取消");
		strictEqual(translateSettings(host, dict).total, 0);
		const locked = createFixture();
		Object.defineProperty(locked.setting.ui, "description", { value: "Choose a theme", configurable: false, writable: false });
		throws(() => translateSettings(locked.host, { Appearance: "外观", General: "通用", "Choose a theme": "选择主题" }));
		const lockedTab = locked.host.tabMetadata;
		if (!lockedTab || typeof lockedTab !== "object" || !("appearance" in lockedTab)) throw new Error("missing tab metadata");
		const appearance = lockedTab.appearance;
		if (!appearance || typeof appearance !== "object" || !("label" in appearance)) throw new Error("missing tab label");
		strictEqual(appearance.label, "Appearance");
		strictEqual(locked.groupList[0], "General");
		strictEqual(groupList[0], "通用");
	});
	test("keeps a configurable getter live after an initial dictionary miss", () => {
		const { host, setting } = createFixture();
		let description = "Unlisted";
		const getter = (): string => description;
		Object.defineProperty(setting.ui, "description", {
			configurable: true,
			enumerable: true,
			get: getter,
		});
		const dictionary = {
			Appearance: "外观",
			General: "通用",
			"Press Esc to cancel": "按 Esc 取消",
		};

		translateSettings(host, dictionary);
		const installedGetter = Object.getOwnPropertyDescriptor(setting.ui, "description")?.get;
		notStrictEqual(installedGetter, getter);
		strictEqual(setting.ui.description, "Unlisted");

		translateSettings(host, dictionary);
		strictEqual(Object.getOwnPropertyDescriptor(setting.ui, "description")?.get, installedGetter);
		description = "Press Esc to cancel";
		strictEqual(setting.ui.description, "按 Esc 取消");
		description = "Unlisted";
		strictEqual(setting.ui.description, "Unlisted");
	});
});
