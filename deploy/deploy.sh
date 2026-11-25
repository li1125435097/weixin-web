#!/usr/bin/env bash
# 经 ssh ali 把 chat-me 部署到 /root/www/chat-me，并写入 nginx 配置。
# 前后端 dist 已存在时不构建。用法：bash deploy/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${SSH_HOST:-ali}"
REMOTE_DIR=/root/www/chat-me
APP_PORT=5000
NGINX_MAP=chat-me-upgrade.conf
NGINX_LOCATION=chat-me.location.conf
REBUILD=false

if [ "$REBUILD" = true ]; then
  echo "== 构建前端 =="
  (
    cd "$ROOT/web"
    # npm ci
    npm run build
  )
else
  echo "== 前端 dist 已存在，跳过构建 =="
fi

if [ "$REBUILD" = true ]; then
  echo "== 构建服务端 =="
  (
    cd "$ROOT/server"
    # npm ci
    npm run build
  )
else
  echo "== 服务端 dist 已存在，跳过构建 =="
fi

STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$STAGE/server" "$STAGE/web"
cp "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$STAGE/server/"
cp -a "$ROOT/server/dist" "$STAGE/server/dist"
cp -a "$ROOT/web/dist" "$STAGE/web/dist"
cp "$ROOT/deploy/nginx/$NGINX_MAP" "$ROOT/deploy/nginx/$NGINX_LOCATION" "$STAGE/"

echo "== 上传到 ${SSH_HOST}:${REMOTE_DIR} =="
tar -C "$STAGE" -czf - . | ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR'"

echo "== 安装依赖、启动服务、重载 nginx =="
ssh -o BatchMode=yes "$SSH_HOST" "REMOTE_DIR='$REMOTE_DIR' APP_PORT='$APP_PORT' NGINX_MAP='$NGINX_MAP' NGINX_LOCATION='$NGINX_LOCATION' bash -s" <<'REMOTE'
set -euo pipefail

install_node() {
  if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
    echo "修复 CA 证书包（/etc/ssl 缺失时 curl 无法访问 HTTPS）"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates
    mkdir -p /etc/ssl/certs
    update-ca-certificates
  fi

  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'Number(process.versions.node.split(".")[0])')"
    if [ "$major" -ge 24 ]; then
      echo "已有 Node $(node -v)"
      return
    fi
    echo "现有 Node $(node -v) 低于 24，安装 Node 24 到 /usr/local"
  else
    echo "未检测到 Node，安装 Node 24 到 /usr/local"
  fi

  local json ver tar tmp
  json="$(curl -fsSL --retry 3 https://npmmirror.com/mirrors/node/index.json || curl -fsSL --retry 3 https://nodejs.org/dist/index.json)"
  ver="$(printf '%s' "$json" | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(next(x["version"] for x in rows if x["version"].startswith("v24.")))')"
  ver="${ver#v}"
  tar="node-v${ver}-linux-x64.tar.xz"
  tmp="$(mktemp)"
  curl -fL --retry 3 -o "$tmp" "https://npmmirror.com/mirrors/node/v${ver}/${tar}" \
    || curl -fL --retry 3 -o "$tmp" "https://nodejs.org/dist/v${ver}/${tar}"
  tar -xJf "$tmp" -C /usr/local --strip-components=1
  rm -f "$tmp"
  hash -r
  echo "已安装 Node $(node -v)"
}

install_node

cd "$REMOTE_DIR/server"
npm ci --omit=dev --registry=https://registry.npmmirror.com
mkdir -p data
chmod 700 data

if [ ! -f .env ]; then
  jwt="$(openssl rand -hex 32)"
  cat > .env <<EOF
NODE_ENV=production
PORT=${APP_PORT}
COOKIE_SECURE=true
DATA_DIR=${REMOTE_DIR}/server/data
WEB_ROOT=${REMOTE_DIR}/web/dist
JWT_SECRET=${jwt}
TURN_SECRET=
TURN_HOST=
ROOM_TTL_SECONDS=7200
EOF
  chmod 600 .env
  echo "已生成 ${REMOTE_DIR}/server/.env"
else
  echo "保留已有 ${REMOTE_DIR}/server/.env"
fi

if systemctl list-unit-files chat-me.service --no-legend 2>/dev/null | grep -q chat-me || [ -f /etc/systemd/system/chat-me.service ]; then
  systemctl disable --now chat-me
  rm -f /etc/systemd/system/chat-me.service
  systemctl daemon-reload
  echo "已移除 systemd 服务 chat-me"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 --registry=https://registry.npmmirror.com
fi

cd "$REMOTE_DIR/server"
if pm2 describe chat-me >/dev/null 2>&1; then
  pm2 restart chat-me --update-env
else
  pm2 start dist/main.js --name chat-me
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null

install -m 644 "$REMOTE_DIR/$NGINX_MAP" "/etc/nginx/conf.d/$NGINX_MAP"
rm -f /etc/nginx/conf.d/chat.toooooools.top.conf
python3 - "$REMOTE_DIR/$NGINX_LOCATION" <<'PY'
import re
import sys
from pathlib import Path
nav = Path("/etc/nginx/conf.d/nav443.conf")
text = nav.read_text()
block = Path(sys.argv[1]).read_text().strip() + "\n"
pattern = re.compile(r"[ \t]*# BEGIN chat-me\n.*?# END chat-me\n", re.S)
if pattern.search(text):
    text = pattern.sub(block, text, count=1)
else:
    needle = "    location / {"
    if needle not in text:
        raise SystemExit("nav443.conf 里没有 location /，无法插入 /chat")
    text = text.replace(needle, block + "\n" + needle, 1)
nav.write_text(text)
PY
nginx -t
systemctl reload nginx

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${APP_PORT}/api/health"
echo
curl -kfsS --resolve www.toooooools.top:443:127.0.0.1 https://www.toooooools.top/chat/api/health
echo
pm2 list
REMOTE

echo "== 完成 =="
echo "目录: ${REMOTE_DIR}"
echo "页面: https://www.toooooools.top/chat/"
echo "nginx: /etc/nginx/conf.d/nav443.conf"
