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
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$script_dir/install-manifest.tsv"
if [[ ! -f "$manifest" ]]; then
	printf '错误：找不到自有文件清单: %s\n' "$manifest" >&2
	exit 1
fi
removed=0

valid_relative_destination() {
	local destination="$1"
	local component
	local -a components
	[[ -n "$destination" && "$destination" != /* && "$destination" != *\\* ]] || return 1
	IFS=/ read -r -a components <<< "$destination"
	for component in "${components[@]}"; do
		[[ -n "$component" && "$component" != "." && "$component" != ".." ]] || return 1
	done
	return 0
}

while IFS= read -r line || [[ -n "$line" ]]; do
	IFS=$'\t' read -r kind source destination platform extra <<< "$line"
	if [[ -z "${kind:-}" || -z "${source:-}" || -z "${destination:-}" || -z "${platform:-}" || -n "${extra:-}" || "$line" == *$'\r'* ]]; then
		printf '错误：自有文件清单行格式无效: %s\n' "$line" >&2
		exit 1
	fi
	if ! valid_relative_destination "$destination"; then
		printf '错误：自有文件清单目标必须是相对路径: %s\n' "$destination" >&2
		exit 1
	fi
	file="$home_dir/$destination"
	if [ -f "$file" ] || [ -L "$file" ]; then
		rm -- "$file"
		printf '已删除: %s\n' "$file"
		removed=1
	elif [ -e "$file" ]; then
		printf '错误：拒绝删除非文件目标: %s\n' "$file" >&2
		exit 1
	fi
done < "$manifest"
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
