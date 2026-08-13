#!/usr/bin/env bash
# zhomp 安装脚本（macOS / Linux / Git Bash）
#
# 安装 = 复制扩展 + 字典 + 生成 `zhomp` 启动命令（源码模式）
# 卸载 = scripts/uninstall.sh
set -euo pipefail

# ── 路径解析 ──────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
OMP_AGENT_EXT_DIR="$HOME_DIR/.omp/agent/extensions"
OMP_ZH_DIR="$HOME_DIR/.omp/zh"
BUN_BIN_DIR="$HOME_DIR/.bun/bin"

# ── 依赖检查 ──────────────────────────────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
	echo "错误: 未找到 bun。请先安装: https://bun.sh" >&2
	exit 1
fi

PKG_DIR="$(dirname "$(readlink -f "$(command -v bun)")")/install/global/node_modules/@oh-my-pi/pi-coding-agent"
if [ ! -d "$PKG_DIR" ]; then
	# 备选: 通过 bun pm 定位全局包
	PKG_DIR="$(bun pm ls -g 2>/dev/null | grep -o '@oh-my-pi/pi-coding-agent@[^ ]*' | head -1 || true)"
	# 尝试常见路径
	for cand in \
		"$HOME_DIR/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent" \
		"$(bun pm root -g 2>/dev/null)/@oh-my-pi/pi-coding-agent"; do
		if [ -d "$cand" ]; then PKG_DIR="$cand"; break; fi
	done
fi
if [ ! -d "$PKG_DIR" ]; then
	echo "错误: 未找到 @oh-my-pi/pi-coding-agent 全局包。请先: bun install -g @oh-my-pi/pi-coding-agent" >&2
	exit 1
fi
echo "检测到 omp 包: $PKG_DIR"

# ── 安装 ──────────────────────────────────────────────────────────────────
mkdir -p "$OMP_AGENT_EXT_DIR" "$OMP_ZH_DIR" "$BUN_BIN_DIR"
cp "$REPO_DIR/extensions/zhomp.ts" "$OMP_AGENT_EXT_DIR/zhomp.ts"
cp "$REPO_DIR/dict/zh-CN.json" "$OMP_ZH_DIR/dict.json"

# 生成 zhomp 启动命令（源码模式，与官方 omp 互不干扰）
cat > "$BUN_BIN_DIR/zhomp" <<EOF
#!/usr/bin/env bash
# zhomp: 源码模式启动 omp，使汉化扩展与主程序共享模块实例
exec bun "$PKG_DIR/src/cli.ts" "\$@"
EOF
chmod +x "$BUN_BIN_DIR/zhomp"

# 生成 Windows cmd 版本（Git Bash 环境下仍可生成，供 PowerShell/cmd 使用）
cat > "$BUN_BIN_DIR/zhomp.cmd" <<EOF
@echo off
rem zhomp: run omp from src so the zh extension shares module instances.
bun "$PKG_DIR/src/cli.ts" %*
EOF

echo ""
echo "✅ zhomp 安装完成"
echo "  扩展: $OMP_AGENT_EXT_DIR/zhomp.ts"
echo "  字典: $OMP_ZH_DIR/dict.json"
echo "  启动: $BUN_BIN_DIR/zhomp"
echo ""
echo "使用:"
echo "  zhomp           # 中文界面（源码模式）"
echo "  omp             # 官方原版（英文，不受影响）"
echo "卸载:"
echo "  bash $REPO_DIR/scripts/uninstall.sh"
