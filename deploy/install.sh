#!/usr/bin/env bash
# Installation script pour VPS Hostinger (Ubuntu 24.04 + Docker + Traefik).
# Lance via: curl -fsSL .../install.sh | sudo -E bash
# Variables d'environnement requises:
#   ANTHROPIC_API_KEY, WP_BASE_URL, WP_USER, WP_APP_PASSWORD, VPS_IP
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Nicogugu/managed-agents.git}"
BRANCH="${BRANCH:-claude/bootstrap-project-BsFvC}"
DEST="${DEST:-/opt/managed-agents}"

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: variable $name manquante" >&2
    exit 1
  fi
}

require ANTHROPIC_API_KEY
require WP_BASE_URL
require WP_USER
require WP_APP_PASSWORD
require VPS_IP
# GEMINI_API_KEY est optionnelle (image gen désactivé sans elle)
GEMINI_API_KEY="${GEMINI_API_KEY:-}"

echo "→ Clone $REPO_URL ($BRANCH) dans $DEST"
if [[ -d "$DEST/.git" ]]; then
  git -C "$DEST" fetch origin "$BRANCH"
  git -C "$DEST" checkout "$BRANCH"
  git -C "$DEST" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$DEST"
fi

cd "$DEST/deploy"

# Volume persistant pour les drafts du block editor. Conserve les
# brouillons en cours quand on redéploie (perdus auparavant à chaque
# `docker compose up -d --build`).
echo "→ Préparation du volume /opt/managed-agents/data"
mkdir -p /opt/managed-agents/data/drafts
chmod 700 /opt/managed-agents/data

echo "→ Écriture du .env"
cat > .env <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
WP_BASE_URL=$WP_BASE_URL
WP_USER=$WP_USER
WP_APP_PASSWORD=$WP_APP_PASSWORD
GEMINI_API_KEY=$GEMINI_API_KEY
VPS_IP=$VPS_IP
EOF
chmod 600 .env

echo "→ Build & up via docker compose"
docker compose -f docker-compose.local.yml --env-file .env up -d --build

echo
echo "→ État des services:"
docker compose -f docker-compose.local.yml ps

echo
echo "✓ Déployé. URL: https://agent.${VPS_IP}.nip.io"
echo "   - Front: https://agent.${VPS_IP}.nip.io/"
echo "   - API:   https://agent.${VPS_IP}.nip.io/api/health"
echo
echo "Note: la première requête peut prendre ~30s (Let's Encrypt)."
