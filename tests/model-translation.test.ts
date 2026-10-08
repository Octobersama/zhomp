import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "bun:test";
import { discoverPackage } from "../scripts/install-core";
import { readSupportPolicy } from "../runtime/host";
import { translateModelHubSource } from "../runtime/model-ui";
import { parseDictionaryText } from "../extensions/zhomp";
import type { Dictionary } from "../extensions/zhomp";
import { makeTempDir, removeTree, runCommand, writeText } from "./verification-fixtures";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const host = discoverPackage(readSupportPolicy(repoDir).range);
const modelHubSource = readFileSync(host.modelHubPath, "utf8");
const dictionary: Dictionary = parseDictionaryText(readFileSync(join(repoDir, "dict", "zh-CN.json"), "utf8")) ?? {};

describe("ModelHub translation fail-closed behavior", () => {
	test("leaves omitted dictionary entries unchanged in the supported source", () => {
		const translated = translateModelHubSource(modelHubSource, {});
		strictEqual(translated.supported, true);
		strictEqual(translated.translated, 0);
		strictEqual(translated.source, modelHubSource);
	});

	test("skips an unknown module shape without changing its source", () => {
		const unknown = "export const unrelated = 'Models';\n";
		const translated = translateModelHubSource(unknown, dictionary);
		strictEqual(translated.supported, false);
		strictEqual(translated.translated, 0);
		strictEqual(translated.source, unknown);
	});

	test("keeps an unrecognized model module usable without intercepting sibling modules", async () => {
		const root = makeTempDir("zhomp-model-shape");
		try {
			const target = join(root, "model-hub.ts");
			const sibling = join(root, "sibling", "model-hub.ts");
			const program = join(root, "probe.ts");
			writeText(target, 'export class ModelHubComponent { render() { return ["Models", "Roles"]; } }');
			writeText(sibling, 'export const label = "Models";');
			writeText(program, `import { registerModelTranslation } from ${JSON.stringify(join(repoDir, "runtime", "model-ui.ts"))};
registerModelTranslation(${JSON.stringify(target)}, { Models: "模型", Roles: "角色" });
const target = await import(${JSON.stringify(target)});
const sibling = await import(${JSON.stringify(sibling)});
console.log(JSON.stringify({ panel: new target.ModelHubComponent().render(), sibling: sibling.label }));
`);
			const result = await runCommand(process.execPath, ["--no-install", "--no-env-file", program]);
			strictEqual(result.exitCode, 0, result.stderr || result.stdout);
			deepStrictEqual(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? ""), { panel: ["Models", "Roles"], sibling: "Models" });
		} finally { removeTree(root); }
	});
});
