#!/usr/bin/env bash
# One-shot deployment script for lnvps.net VPS (Ubuntu 22.04).
# Run from the VPS: bash deploy.sh
set -euo pipefail

echo "==> Installing Bun"
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "==> Installing Caddy"
sudo apt-get update -qq
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -qq
sudo apt-get install -y caddy

echo "==> Cloning or updating repo"
REPO_DIR="$HOME/payprompt"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull
else
  git clone https://github.com/YOUR_ORG/payprompt.git "$REPO_DIR"
fi

echo "==> Installing dependencies"
cd "$REPO_DIR"
bun install

echo "==> Setting up .env"
ENV_FILE="$REPO_DIR/packages/proxy/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/packages/proxy/.env.example" "$ENV_FILE"
  echo ""
  echo "⚠️  Edit $ENV_FILE, then update the DeepSeek API key in SQLite:"
  echo "   bun -e \"import {openDb} from './packages/proxy/src/db.ts'; const db=openDb(); db.run(\\\"UPDATE providers SET api_key='YOUR_KEY' WHERE id='deepseek-v3-01'\\\"); db.close()\""
  echo ""
  echo "Then re-run: bash $0"
  exit 1
fi

echo "==> Installing systemd service"
sudo cp "$REPO_DIR/deploy/payprompt-proxy.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable payprompt-proxy
sudo systemctl restart payprompt-proxy

echo "==> Configuring Caddy"
sudo cp "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo systemctl restart caddy

echo ""
echo "✅  Deployment complete."
echo ""
echo "Test your deployment:"
echo "  curl https://proxy.yourdomain.com/health"
echo ""
echo "Generate a bearer token (run locally):"
echo "  cd packages/proxy && bun -e \"import {encodeBearerToken} from './src/middleware/auth.ts'; console.log(await encodeBearerToken('0xYOUR_PRIVATE_KEY'))\""
echo ""
echo "Test OpenAI format:"
echo "  curl -s https://proxy.yourdomain.com/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Authorization: Bearer <YOUR_TOKEN>' \\"
echo "    -d '{\"model\":\"deepseek-ai/DeepSeek-V3\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one word.\"}]}' | jq ."
echo ""
echo "Test Anthropic format (Claude Code compatible):"
echo "  curl -s https://proxy.yourdomain.com/v1/messages \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'x-api-key: <YOUR_TOKEN>' \\"
echo "    -d '{\"model\":\"deepseek-ai/DeepSeek-V3\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one word.\"}],\"max_tokens\":50}' | jq ."
echo ""
echo "Configure Claude Code:"
echo "  export ANTHROPIC_BASE_URL=https://proxy.yourdomain.com"
echo "  export ANTHROPIC_API_KEY=<YOUR_TOKEN>"
