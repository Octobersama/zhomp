#!/usr/bin/env bash
# zhomp 卸载脚本（macOS / Linux / Git Bash）
#
# 卸载 = 删除扩展 + 字典 + `zhomp` 启动命令 → 完全恢复英文
set -euo pipefail

# 解析用户主目录：优先 Windows 的 USERPROFILE，其次 POSIX HOME。
# 显式设置 OMP_ZH_HOME 可覆盖（例如 Git Bash 下 HOME=/root 为虚拟路径时）。
if [ -n "${OMP_ZH_HOME:-}" ]; then
	HOME_DIR="$OMP_ZH_HOME"
elif [ -n "${USERPROFILE:-}" ]; then
	HOME_DIR="$USERPROFILE"
elif [ -n "${HOME:-}" ]; then
	HOME_DIR="$HOME"
else
	HOME_DIR="$(eval echo ~)"
fi
OMP_AGENT_EXT_FILE="$HOME_DIR/.omp/agent/extensions/zhomp.ts"
OMP_ZH_DIR="$HOME_DIR/.omp/zh"
BUN_BIN_DIR="$HOME_DIR/.bun/bin"

removed=0
for f in \
	"$OMP_AGENT_EXT_FILE" \
	"$BUN_BIN_DIR/zhomp" \
	"$BUN_BIN_DIR/zhomp.cmd"; do
	if [ -f "$f" ]; then
		rm -f "$f"
		echo "已删除: $f"
		removed=1
	fi
done

# 字典目录: 仅当只包含 dict.json 时删除整个目录，避免误删用户其他文件
if [ -d "$OMP_ZH_DIR" ]; then
	remaining="$(ls -A "$OMP_ZH_DIR" 2>/dev/null | wc -l | tr -d ' ')"
	if [ "$remaining" = "0" ]; then
		rmdir "$OMP_ZH_DIR"
		echo "已删除空目录: $OMP_ZH_DIR"
	elif [ "$remaining" = "1" ] && [ -f "$OMP_ZH_DIR/dict.json" ]; then
		rm -f "$OMP_ZH_DIR/dict.json"
		rmdir "$OMP_ZH_DIR"
		echo "已删除字典与目录: $OMP_ZH_DIR"
	fi
fi

if [ "$removed" = "1" ]; then
	echo ""
	echo "✅ zhomp 已卸载，界面恢复英文"
else
	echo "zhomp 未安装或已卸载"
fi
