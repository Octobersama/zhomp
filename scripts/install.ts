import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { install } from "./install-core";

const chinese = process.argv.includes("--zh");
if (process.argv.includes("--help")) {
	console.log("Usage: bun scripts/install.ts [--zh]\nInstall zhomp for a compatible OMP host (peer range in package.json).\nOMP_ZH_HOME selects the installation root; OMP_ZH_PACKAGE_DIR selects the existing OMP package.");
	process.exit(0);
}
try {
	const result = install(dirname(dirname(fileURLToPath(import.meta.url))));
	console.log(chinese ? "zhomp 安装完成" : "OK: zhomp installed");
	console.log(`OMP: ${result.packageDir}`);
	for (const path of result.paths) console.log(`  ${path}`);
	console.log(chinese ? "请用 zhomp 启动中文设置；官方 omp 保持不变。" : "Run zhomp for Chinese settings. The official omp command is unchanged.");
} catch (error) {
	console.error(`[zhomp] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
