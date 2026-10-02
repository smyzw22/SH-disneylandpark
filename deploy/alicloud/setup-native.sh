#!/bin/sh
set -eu

# Reproducible Ubuntu 24.04 deployment for a small Alibaba Cloud instance.
# Run as root after cloning this repository to /opt/sh-disney.

APP_DIR=${APP_DIR:-/opt/sh-disney}
DATA_DIR=${DATA_DIR:-/var/lib/sh-disney}
APP_USER=${APP_USER:-admin}
PIP_INDEX_URL=${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git python3 python3-venv python3-pip build-essential libgomp1 nginx

# Ubuntu 24.04 currently ships Node 18, while this project uses node:sqlite.
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

cd "$APP_DIR/server"
npm config set registry "$NPM_REGISTRY"
npm ci --omit=dev

cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -i "$PIP_INDEX_URL"
.venv/bin/pip install -r requirements.txt -r requirements-ml.txt -i "$PIP_INDEX_URL"

install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$DATA_DIR"

install -m 0644 deploy/alicloud/sh-disney.service /etc/systemd/system/sh-disney.service
install -m 0644 deploy/alicloud/nginx.conf /etc/nginx/sites-available/sh-disney
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/sh-disney /etc/nginx/sites-enabled/sh-disney

nginx -t
systemctl daemon-reload
systemctl enable --now sh-disney
systemctl enable nginx
systemctl restart nginx

curl --retry 18 --retry-delay 5 --retry-connrefused -fsS http://127.0.0.1/health
