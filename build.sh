#!/usr/bin/env bash
# Kampung Kaki — install + build locally, then deploy to Vercel.
# Usage:
#   ./build.sh             # build + deploy production to Vercel
#   ./build.sh --no-deploy # build only (no Vercel call)
#   ./build.sh --preview   # build + deploy a Vercel preview (non-prod)
set -e
cd "$(dirname "$0")"

DEPLOY="prod"
for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY="none" ;;
    --preview)   DEPLOY="preview" ;;
    -h|--help)
      echo "usage: ./build.sh [--no-deploy|--preview]"
      exit 0
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "!! node.js not found. Install Node 20+ first (https://nodejs.org)."
  exit 1
fi
echo ">> node: $(node -v)"

echo ">> installing dependencies..."
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo ">> building production bundle..."
npm run build
echo ">> ✓ local build complete (dist/)"

if [ "$DEPLOY" = "none" ]; then
  echo ">> skipping Vercel deploy (--no-deploy)"
  exit 0
fi

echo ""
echo ">> deploying to Vercel ($DEPLOY)..."
echo ">> using: npx vercel"
echo ">> first run will prompt to log in and link this folder to a project."

# Prefer a project token if provided, else interactive login.
VERCEL_ARGS=("--yes")
if [ -n "${VERCEL_TOKEN:-}" ]; then
  VERCEL_ARGS+=("--token" "$VERCEL_TOKEN")
fi
if [ "$DEPLOY" = "prod" ]; then
  VERCEL_ARGS+=("--prod")
fi

# Vercel will run its own build using vercel.json (framework: vite).
# We already built locally so the dev gets fast feedback before the remote build.
npx --yes vercel@latest "${VERCEL_ARGS[@]}"

echo ""
echo ">> ✓ deploy command finished. Check the URL printed above."
