#!/usr/bin/env bash
# zhomp 安装入口：路径、版本与文件提交由同一 Bun 核心管理。
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v bun >/dev/null 2>&1; then
	printf '%s\n' '错误：未找到 Bun。请先安装 https://bun.sh' >&2
	exit 1
fi
OMP_ZH_INSTALL_SHELL=bash exec bun --no-install --no-env-file --config="$repo_dir/runtime/zhomp.toml" "$repo_dir/scripts/install.ts" --zh
