import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { renameSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { discoverPackage, install, publishArtifacts, resolveHome, supportedVersion, validatePackage } from "../scripts/install-core";
import { createHostFixture, makeTempDir, removeTree, snapshotTree, writeText } from "./verification-fixtures";

const repoDir = dirname(import.meta.dir);
const version = supportedVersion(repoDir);

test("installation rejects adjacent versions before writing any target", () => {
	const root = makeTempDir("zhomp-version");
	try {
		for (const unsupported of ["18.3.1", "18.3.3"]) {
			const host = createHostFixture(join(root, unsupported), unsupported);
			const home = join(root, `home-${unsupported}`);
			throws(() => install(repoDir, { OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: host }), /Expected @oh-my-pi\/pi-coding-agent/);
			strictEqual(existsSync(home), false);
		}
	} finally { removeTree(root); }
});

test("explicit and independently configured global directories select the actual package", () => {
	const root = makeTempDir("zhomp-discovery");
	try {
		const host = createHostFixture(root, version);
		strictEqual(discoverPackage(version, { OMP_ZH_PACKAGE_DIR: host }).packageDir, resolve(host));
		strictEqual(discoverPackage(version, { BUN_INSTALL_GLOBAL_DIR: root, BUN_INSTALL_BIN: join(root, "unrelated-bin") }).packageDir, resolve(host));
		throws(() => discoverPackage(version, { OMP_ZH_PACKAGE_DIR: join(root, "missing"), BUN_INSTALL_GLOBAL_DIR: root }));
		const user = join(root, "user");
		writeText(join(user, ".bunfig.toml"), `[install]\nglobalDir = ${JSON.stringify(root.replaceAll("\\", "/"))}\nglobalBinDir = ${JSON.stringify(join(root, "elsewhere").replaceAll("\\", "/"))}\n`);
		strictEqual(discoverPackage(version, { USERPROFILE: user, HOME: user }).packageDir, resolve(host));
		const defaultHome = join(root, "default-user");
		const defaultHost = createHostFixture(join(defaultHome, ".bun", "install", "global"), version);
		strictEqual(discoverPackage(version, { USERPROFILE: defaultHome, HOME: defaultHome }).packageDir, resolve(defaultHost));
		rmSync(join(host, "src", "cli.ts"));
		throws(() => validatePackage(host, version));
	} finally { removeTree(root); }
});

test("home selection respects explicit override and platform fallback", () => {
	const a = resolve("test-a");
	const b = resolve("test-b");
	const c = resolve("test-c");
	strictEqual(resolveHome({ OMP_ZH_HOME: a, USERPROFILE: b, HOME: c }), a);
	strictEqual(resolveHome({ USERPROFILE: b, HOME: c }), process.platform === "win32" ? b : c);
	strictEqual(resolveHome({ HOME: c }), c);
});

test("every failed publish step restores first-install and upgrade state", () => {
	const root = makeTempDir("zhomp-rollback");
	try {
		for (const upgrade of [false, true]) {
			for (let failAt = 1; failAt <= (upgrade ? 6 : 3); failAt++) {
				const working = join(root, `${upgrade}-${failAt}`);
				mkdirSync(working);
				writeText(join(working, "unrelated"), "user data");
				const paths = [join(working, "ext", "zhomp.ts"), join(working, "data", "dict.json"), join(working, "bin", "zhomp")];
				if (upgrade) paths.forEach((path, index) => writeText(path, `old-${index}`));
				const before = snapshotTree(working);
				let calls = 0;
				throws(() => publishArtifacts(paths.map((path, index) => ({ path, content: `new-${index}` })), (from, to) => {
					if (++calls === failAt) throw new Error("injected storage failure");
					renameSync(from, to);
				}), /injected storage failure/);
				deepStrictEqual(snapshotTree(working), before, `failed at ${failAt}, upgrade=${upgrade}`);
			}
		}
	} finally { removeTree(root); }
});

test("successful reinstall is idempotent and preserves caller files", () => {
	const root = makeTempDir("zhomp-reinstall");
	try {
		const host = createHostFixture(root, version);
		const home = join(root, "home [1]");
		const env = { OMP_ZH_HOME: home, OMP_ZH_PACKAGE_DIR: host, OMP_ZH_INSTALL_SHELL: "bash" };
		writeText(join(home, ".omp", "zh", "user.txt"), "keep");
		const first = install(repoDir, env);
		const before = snapshotTree(home);
		const second = install(repoDir, env);
		deepStrictEqual(second.paths, first.paths);
		deepStrictEqual(snapshotTree(home), before);
		strictEqual(readFileSync(join(home, ".omp", "zh", "user.txt"), "utf8"), "keep");
	} finally { removeTree(root); }
});
