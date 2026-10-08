#!/usr/bin/env bash
# 删除 zhomp 自有文件；没有 Bun 也可以卸载。
set -euo pipefail
if [ -n "${OMP_ZH_HOME:-}" ]; then
	home_dir="$OMP_ZH_HOME"
elif [ -n "${USERPROFILE:-}" ] && [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
	home_dir="$USERPROFILE"
else
	home_dir=~
	home_dir="${HOME:-$home_dir}"
fi
if command -v cygpath >/dev/null 2>&1; then home_dir="$(cygpath -u "$home_dir")"; fi
if [[ "$home_dir" == '~' || "$home_dir" == '~/'* ]]; then
	default_home=~
	home_dir="$default_home${home_dir:1}"
fi
zh_dir="$home_dir/.omp/zh"
removed=0
for file in \
	"$home_dir/.omp/agent/extensions/zhomp.ts" \
	"$zh_dir/dict.json" \
	"$zh_dir/launch.ts" \
	"$zh_dir/host.ts" \
	"$zh_dir/launch.json" \
	"$zh_dir/model-ui.ts" \
	"$zh_dir/zhomp.toml" \
	"$home_dir/.bun/bin/zhomp" \
	"$home_dir/.bun/bin/zhomp.cmd"; do
	if [ -f "$file" ] || [ -L "$file" ]; then
		rm -- "$file"
		printf '已删除: %s\n' "$file"
		removed=1
	elif [ -e "$file" ]; then
		printf '错误：拒绝删除非文件目标: %s\n' "$file" >&2
		exit 1
	fi
done
if [ -d "$zh_dir" ]; then
	# rmdir only succeeds for an empty directory. Keep user side files untouched.
	if ! rmdir -- "$zh_dir" 2>/dev/null; then
		shopt -s nullglob dotglob
		remaining=("$zh_dir"/*)
		if [ "${#remaining[@]}" -eq 0 ]; then
			printf '错误：无法删除空目录: %s\n' "$zh_dir" >&2
			exit 1
		fi
	fi
fi
if [ "$removed" -eq 1 ]; then
	printf '%s\n' 'zhomp 已卸载；用户配置、会话与其他文件保持不变。'
else
	printf '%s\n' 'zhomp 未安装或已经卸载。'
fi
