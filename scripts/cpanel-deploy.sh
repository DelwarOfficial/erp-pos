#!/usr/bin/env bash
set -euo pipefail
# cpanel-deploy.sh — one-shot deploy for rangpurtv.com on cPanel Node App
# Run inside cPanel Terminal: bash scripts/cpanel-deploy.sh
# Requires: Node 20+, DATABASE_URL, REDIS_URL in .env

APP_DIR="$HOME/erp-pos"
REPO="https://github.com/DelwarOfficial/erp-pos.git"

echo "== 1/6 Clone / pull =="
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only
else
  git clone "$REPO" "$APP_DIR" && cd "$APP_DIR"
fi
cd "$APP_DIR"

echo "== 2/6 Env check =="
if [ ! -f .env ]; then
  echo "ERROR: .env missing. cp .env.production.example .env && nano .env"
  exit 1
fi
grep -q "postgresql://" .env || { echo "ERROR: DATABASE_URL must be postgresql://"; exit 1; }
grep -q "JWT_SECRET" .env

echo "== 3/6 Install deps =="
if command -v bun >/dev/null 2>&1; then
  bun install --frozen-lockfile 2>&1 | tail -20
else
  npm ci 2>&1 | tail -20
fi

echo "== 4/6 Prisma generate (postgres) =="
if command -v bun >/dev/null 2>&1; then
  bunx prisma generate --schema=prisma/schema.postgres.prisma
else
  npx prisma generate --schema=prisma/schema.postgres.prisma
fi

echo "== 5/6 Migrations =="
if command -v bun >/dev/null 2>&1; then
  bun run scripts/run-postgres-migrations.ts
else
  node --loader tsx scripts/run-postgres-migrations.ts 2>&1 || npx tsx scripts/run-postgres-migrations.ts
fi

echo "== 6/6 Build =="
if command -v bun >/dev/null 2>&1; then
  bun run build
else
  npm run build
fi

echo ""
echo "✅ Build done. Next: cPanel Application Manager -> Restart app"
echo "   Startup file: .next/standalone/server.js"
echo "   Then: curl -I https://rangpurtv.com/login"
