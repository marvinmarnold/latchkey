#!/usr/bin/env bash
# Deploy latchkey proxy to a fresh Ubuntu VPS via SSH password auth.
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
APP_DIR="/root/latchkey"

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
if [ -d /root/latchkey/.git ]; then
  git -C /root/latchkey fetch --all
else
  # Migrate from old payprompt directory if it exists
  if [ -d /root/payprompt/.git ]; then
    mv /root/payprompt /root/latchkey
    git -C /root/latchkey remote set-url origin https://github.com/marvinmarnold/latchkey.git
    git -C /root/latchkey fetch --all
  else
    git clone https://github.com/marvinmarnold/latchkey.git /root/latchkey
    git -C /root/latchkey fetch --all
  fi
fi

echo "--- install systemd services"
cp /root/latchkey/deploy/latchkey-proxy.service /etc/systemd/system/
cp /root/latchkey/deploy/caddy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable latchkey-proxy caddy
SETUP

BRANCH="${DEPLOY_BRANCH:-main}"
echo "==> Checking out branch: $BRANCH"
$SSH "git -C $APP_DIR checkout $BRANCH && git -C $APP_DIR pull origin $BRANCH && cd $APP_DIR && /root/.bun/bin/bun install --frozen-lockfile"

echo "==> Writing .env"
$SSH "cat > $APP_DIR/packages/proxy/.env" << ENV
PORT=3000
DB_PATH=$APP_DIR/packages/proxy/latchkey.db
NODE_ENV=production
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
BASE_RPC_URL=${BASE_RPC_URL:-https://sepolia.base.org}
BALANCE_CONTRACT_ADDRESS=${BALANCE_CONTRACT_ADDRESS:-}
SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
SOLANA_USDC_MINT=${SOLANA_USDC_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}
ENV

echo "==> Writing Caddy config and Cloudflare token"
$SSH "cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile"
$SSH "printf 'CLOUDFLARE_API_TOKEN=%s\n' '${CLOUDFLARE_API_TOKEN:-}' > /etc/caddy/cloudflare.env && chmod 600 /etc/caddy/cloudflare.env"

echo "==> Setting Cloudflare DNS A record api.latchkey.me → $HOST"
CF_ZONE=$(curl -sf "https://api.cloudflare.com/client/v4/zones?name=latchkey.me" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")

CF_RECORD=$(curl -sf "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records?type=A&name=api.latchkey.me" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-}" | \
  python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')")

if [ -z "$CF_RECORD" ]; then
  curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-}" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"api.latchkey.me\",\"content\":\"$HOST\",\"proxied\":false}" > /dev/null
  echo "    Created"
else
  curl -sf -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records/$CF_RECORD" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-}" \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"$HOST\",\"proxied\":false}" > /dev/null
  echo "    Updated"
fi

echo "==> Starting services"
$SSH "systemctl restart latchkey-proxy caddy"

echo ""
echo "✅ Deployed."
echo "   https://api.latchkey.me/health"
