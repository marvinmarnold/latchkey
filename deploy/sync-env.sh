#!/usr/bin/env bash
# Write the production .env to the server.
# Usage: bash deploy/sync-env.sh
# Reads from packages/proxy/.env (same as deploy.sh).
set -euo pipefail

ENV_FILE="$(dirname "$0")/../packages/proxy/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${DEPLOY_HOST:?DEPLOY_HOST required}"
APP_DIR="/root/latchkey"

ssh -i ~/.ssh/id_ed25519 root@"$HOST" "cat > $APP_DIR/packages/proxy/.env" << ENV
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

echo "✅ .env synced to $HOST"
