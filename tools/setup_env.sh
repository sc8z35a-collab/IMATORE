#!/usr/bin/env bash
# Re-create the QA environment after a sandbox reset (idempotent).
#   bash tools/setup_env.sh
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
# swap: the headless SwiftShader harness needs >1GB (sandbox RAM is ~1GB)
if ! grep -q "$(pwd)/.swap" /proc/swaps 2>/dev/null; then
  [ -f .swap ] || { sudo fallocate -l 4G .swap && sudo chmod 600 .swap && sudo /sbin/mkswap .swap >/dev/null; }
  sudo /sbin/swapon .swap || true
  sudo sysctl -q vm.swappiness=100 || true
fi
python3 -c "import playwright" 2>/dev/null || pip install -q playwright >/dev/null 2>&1
[ -d ~/.cache/ms-playwright/chromium_headless_shell-* ] 2>/dev/null || python3 -m playwright install chromium >/dev/null 2>&1
/sbin/ldconfig -p 2>/dev/null | grep -q libatk-1.0 || sudo python3 -m playwright install-deps chromium >/dev/null 2>&1
npx vite build >/dev/null 2>&1
if ! curl -s -o /dev/null localhost:4173/; then
  (setsid nohup python3 -m http.server 4173 -d dist > /tmp/http.log 2>&1 < /dev/null &)
  sleep 1
fi
echo "env ready: $(grep -c . /proc/swaps) swap entries, server $(curl -s -o /dev/null -w '%{http_code}' localhost:4173/)"
