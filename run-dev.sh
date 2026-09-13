#!/usr/bin/env bash
# run-dev.sh — 一键启动开发服务器
#
# 本项目已去除原生模块（better-sqlite3），缓存改用进程内存、清单改用浏览器 localStorage，
# 因此不再有 Node ABI 版本匹配问题，任意 Node 18/20/22/24 均可直接启动。
#
# 用法：
#   ./run-dev.sh            # 用当前 PATH 里的 node（默认端口 3000）
#   PORT=3900 ./run-dev.sh  # 指定端口
#   CLEAN=1 ./run-dev.sh    # 改动组件后页面没更新时：清 .next 缓存再启动
#   NODE_BIN=/opt/homebrew/bin/node ./run-dev.sh   # 指定某个 node

set -e
cd "$(dirname "$0")"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 找不到 node，请先安装 Node.js 或用 NODE_BIN 指定" >&2
  exit 1
fi
PORT="${PORT:-3000}"

echo "▶ 使用 Node: $NODE_BIN ($("$NODE_BIN" -v))"

if [ "${CLEAN:-0}" = "1" ]; then
  echo "▶ 清除 .next 编译缓存…"
  rm -rf .next
fi

echo "▶ 启动 Next dev（端口 $PORT）…"
PORT="$PORT" "$NODE_BIN" node_modules/next/dist/bin/next dev
