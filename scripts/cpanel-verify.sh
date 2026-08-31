#!/usr/bin/env bash
set -euo pipefail
# cpanel-verify.sh — post-deploy health checks

echo "== Env =="
grep -E "DATABASE_URL|REDIS_URL|NEXT_PUBLIC_APP_URL|NODE_ENV" .env | sed 's/PASSWORD=[^&]*/PASSWORD=****/'

echo "== DB tables (expect 201) =="
psql "$DATABASE_URL" -c "select count(*) from information_schema.tables where table_schema='public'" 2>&1 | tail -5

echo "== RLS (expect 177) =="
psql "$DATABASE_URL" -c "select count(*) from pg_tables where schemaname='public' and rowsecurity" 2>&1 | tail -5

echo "== App http =="
curl -sk -o /dev/null -w "%{http_code} %{url_effective}\n" https://rangpurtv.com/ || true
curl -sk -o /dev/null -w "%{http_code} %{url_effective}\n" https://rangpurtv.com/login || true
curl -sk https://rangpurtv.com/api/v1/health 2>&1 | head -20 || echo "no /api/v1/health route (expected if not exposed)"

echo "== Build artifacts =="
ls -lh .next/standalone/server.js 2>&1 | awk '{print $9, $5}'
ls -ld public 2>&1 | head -1

echo "== Logs =="
tail -30 ~/logs/node*.log 2>&1 | tail -30 || tail -30 server.log 2>&1 | tail -30 || echo "no log file"
