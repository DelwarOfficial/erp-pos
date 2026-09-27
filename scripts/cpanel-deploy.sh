#!/usr/bin/env bash
set -euo pipefail
# cpanel-deploy.sh — deploy for rangpurtv.com on a cPanel Node app, MariaDB.
# Run inside cPanel Terminal: bash scripts/cpanel-deploy.sh
# Requires: Node 20+, and DATABASE_URL (mysql://), REDIS_URL, JWT_SECRET in .env.
#
# This script was written for PostgreSQL: it refused anything but a
# postgresql:// URL, generated the PostgreSQL client and ran the legacy
# PostgreSQL migrations. MariaDB is the production database
# (docs/adr/0007-mariadb-production-database.md); it now follows
# docs/runbooks/production-migration.md. Take and verify a backup before step 5
# (docs/runbooks/backup-restore.md): applied migrations cannot be undone.

APP_DIR="$HOME/erp-pos"
REPO="https://github.com/DelwarOfficial/erp-pos.git"
SCHEMA="prisma/mariadb/schema.prisma"

if command -v bun >/dev/null 2>&1; then X="bunx --no-install"; RUN="bun run"; else X="npx --no-install"; RUN="npm run"; fi

echo "== 1/7 Clone / pull =="
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only
else
  git clone "$REPO" "$APP_DIR" && cd "$APP_DIR"
fi
cd "$APP_DIR"

echo "== 2/7 Env check =="
if [ ! -f .env ]; then
  echo "ERROR: .env missing. cp .env.production.example .env && nano .env"
  exit 1
fi
grep -Eq '^DATABASE_URL="?mysql://' .env || { echo "ERROR: DATABASE_URL must be mysql:// (MariaDB)"; exit 1; }
grep -q '^JWT_SECRET=' .env || { echo "ERROR: JWT_SECRET missing"; exit 1; }

echo "== 3/7 Install deps =="
if command -v bun >/dev/null 2>&1; then
  bun install --frozen-lockfile 2>&1 | tail -20
else
  npm ci 2>&1 | tail -20
fi

echo "== 4/7 Prisma validate + generate (MariaDB) =="
$X prisma validate --schema="$SCHEMA"
$X prisma generate --schema="$SCHEMA"

echo "== 5/7 Migrations =="
$X prisma migrate deploy --schema="$SCHEMA"
$X prisma migrate status --schema="$SCHEMA"

echo "== 6/7 Read-only database audit =="
# Server settings, migration checksums and the full schema (constraints,
# triggers) against the repository. Writes nothing.
node scripts/audit-production-db.mjs

echo "== 7/7 Build =="
$RUN build

echo ""
echo "Build done. Next: cPanel Application Manager -> Restart app"
echo "   Startup file: .next/standalone/server.js"
echo "   Then: curl -I https://rangpurtv.com/login"
