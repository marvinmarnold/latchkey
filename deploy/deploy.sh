#!/usr/bin/env bash
# Deploy payprompt proxy to a fresh Ubuntu VPS via SSH password auth.
# Usage: bun run deploy  (reads packages/proxy/.env automatically)
set -euo pipefail

# Load .env if not already set via environment
ENV_FILE="$(dirname "$0")/../packages/proxy/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${DEPLOY_HOST:?DEPLOY_HOST env var required}"
DEPLOY_USER="${DEPLOY_USER:?DEPLOY_USER env var required}"
APP_DIR="/root/payprompt"

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

echo "--- install Caddy with Cloudflare DNS plugin"
if [ ! -f /usr/local/bin/caddy ]; then
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com%2Fcaddy-dns%2Fcloudflare" \
    -o /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
fi
mkdir -p /etc/caddy

echo "--- clone or pull repo"
if [ -d /root/payprompt/.git ]; then
  git -C /root/payprompt pull
else
  git clone https://github.com/marvinmarnold/payprompt.git /root/payprompt
fi

echo "--- install dependencies"
cd /root/payprompt
"$HOME/.bun/bin/bun" install --frozen-lockfile

echo "--- install systemd services"
cp /root/payprompt/deploy/payprompt-proxy.service /etc/systemd/system/
cp /root/payprompt/deploy/caddy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable payprompt-proxy caddy
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

echo "==> Writing Caddy config and Cloudflare token"
$SSH "cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile"
$SSH "printf 'CLOUDFLARE_API_TOKEN=%s\n' '${CLOUDFLARE_API_TOKEN:-}' > /etc/caddy/cloudflare.env && chmod 600 /etc/caddy/cloudflare.env"

echo "==> Starting services"
$SSH "systemctl restart payprompt-proxy caddy"

echo ""
echo "✅ Deployed."
echo "   https://api.latchkey.me/health"
