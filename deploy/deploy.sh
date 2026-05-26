#!/usr/bin/env bash
# Deploy payprompt proxy to a fresh Ubuntu VPS via SSH password auth.
# Usage: DEPLOY_PASSWORD=xxx ANTHROPIC_API_KEY=xxx DEEPSEEK_API_KEY=xxx OPENAI_API_KEY=xxx bash deploy/deploy.sh
set -euo pipefail

HOST="151.247.22.152"
DEPLOY_USER="root"
APP_DIR="/root/payprompt"
REPO="https://github.com/marvinmarnold/payprompt.git"

PASS="${DEPLOY_PASSWORD:?DEPLOY_PASSWORD env var required}"

if ! command -v sshpass &>/dev/null; then
  echo "sshpass not found. Install with:"
  echo "  brew install hudochenkov/sshpass/sshpass"
  exit 1
fi

SSH="sshpass -p $PASS ssh -o StrictHostKeyChecking=no $DEPLOY_USER@$HOST"

echo "==> Provisioning $HOST"

$SSH bash -s << 'SETUP'
set -euo pipefail

echo "--- update & upgrade"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

echo "--- install git and curl"
apt-get install -y -qq git curl unzip

echo "--- install Bun"
if [ ! -f "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"

echo "--- clone or pull repo"
if [ -d /root/payprompt/.git ]; then
  git -C /root/payprompt pull
else
  git clone https://github.com/marvinmarnold/payprompt.git /root/payprompt
fi

echo "--- install dependencies"
cd /root/payprompt
"$HOME/.bun/bin/bun" install --frozen-lockfile

echo "--- install systemd service"
cp /root/payprompt/deploy/payprompt-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable payprompt-proxy
SETUP

echo "==> Writing .env"
$SSH "cat > $APP_DIR/packages/proxy/.env" << ENV
PORT=3000
DB_PATH=$APP_DIR/packages/proxy/payprompt.db
NODE_ENV=production
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
ENV

echo "==> Starting service"
$SSH "systemctl restart payprompt-proxy"

echo ""
echo "✅ Deployed. Test:"
echo "   curl http://$HOST:3000/health"
