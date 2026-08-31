# cPanel Deploy — rangpurtv.com (ERP/POS)

> Standalone Next.js 16 + PostgreSQL 16+ prod + Redis 7 + BullMQ. Shared zhostbd needs external PG/Redis.

## 0. Pre-req (do once)

1. **External DB:** Create Neon (neon.tech) or Supabase PG 16 → copy `DATABASE_URL` with `?sslmode=require`
2. **External Redis:** Upstash (upstash.com) → copy `REDIS_URL` (rediss://...)
3. **S3:** Cloudflare R2 or S3 bucket for `S3_*` + `BACKUP_S3_BUCKET`
4. **DNS:** rangpurtv.com already → 151.158.44.84 (ok)

## 1. cPanel Terminal — first deploy

```bash
# login: https://host.zhostbd.com:2083/  rangpurt / C201y7Tzls
# Terminal →

cd ~ && git clone https://github.com/DelwarOfficial/erp-pos.git erp-pos
cd erp-pos

# Node 20 — if selector shows 18.20.8, ask zhostbd to enable 20 or use nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20 && nvm use 20
node -v  # must be 20+

# use npm (bun optional)
npm ci

# env — fill external PG/Redis/R2
cp .env.production.example .env
nano .env  # paste DATABASE_URL, REDIS_URL, S3_*, keep generated JWT/APP_ENCRYPTION/BARCODE keys
# generate fresh if needed: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# prisma + migrations
npx prisma generate --schema=prisma/schema.postgres.prisma
npx tsx scripts/run-postgres-migrations.ts
# or: bun run scripts/run-postgres-migrations.ts

# seed (creates admin@erp-platform.local / ChangeMe!2026 + CoA)
psql "$DATABASE_URL" -f scripts/seed-staging.sql
# or: npx tsx scripts/seed.ts

# build
npm run build
ls -lh .next/standalone/server.js  # must exist
```

## 2. cPanel Application Manager

- **Create Application** → Node.js
  - Application root: `~/erp-pos`
  - Application URL: `https://rangpurtv.com` (or `/`)
  - Startup file: `.next/standalone/server.js`
  - Node version: 20
  - Env: `NODE_ENV=production`, plus all `.env` vars (or rely on `.env` file — set `PORT=3000`, `HOSTNAME=0.0.0.0`)
  - Run `npm install` disabled (already done)
- **Save → Restart**
- Check: `curl -I https://rangpurtv.com/login` → 200

If `public_html` still serves old `It works!` → File Manager: remove `public_html` index, ensure App URL is `/` mapped via Passenger. No need to copy `.next/static` manually — standalone includes it.

## 3. Worker (queues)

Shared often kills idle. Try PM2 first:
```bash
npm i -g pm2
pm2 start src/workers/index.ts --name erp-worker --interpreter ./node_modules/.bin/tsx  -- --port 3001
pm2 save && pm2 startup
pm2 logs
```
If killed after minutes → move worker to VPS/Render/Railway with same DATABASE_URL+REDIS_URL.

## 4. Verify

```bash
bash scripts/cpanel-verify.sh
psql "$DATABASE_URL" -c "select count(*) from companies"
# login: https://rangpurtv.com/login  admin@erp-platform.local / ChangeMe!2026 → change immediately
```

## 5. Cron

cPanel → Cron Jobs:
```
0 1 * * * /usr/local/bin/node $HOME/erp-pos/scripts/backup/nightly-backup.sh >> $HOME/erp-backup.log 2>&1
0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_API_TOKEN" https://rangpurtv.com/api/v1/cron/reconciliation >> $HOME/cron.log 2>&1
```

## 6. Update

```bash
cd ~/erp-pos && git pull && npm ci && npx prisma generate --schema=prisma/schema.postgres.prisma && npx tsx scripts/run-postgres-migrations.ts && npm run build
# then Application Manager → Restart
```

## 7. Security

- `chmod 600 .env`, never commit
- Application Manager → SSL → AutoSSL, force HTTPS
- Rotate cPanel password after paste in chat
- `FEATURE_*` flags off until needed

## 8. Troubleshooting

- `argon2` build fail → `npm rebuild argon2` or use Node 20 prebuilt, ensure `python3`/`make` via `ea-nodejs20` selector
- OOM on build (shared 512M) → build locally and `rsync .next/standalone` up, or upgrade to VPS 2GB
- PG `sslmode` error → add `?sslmode=require` to DATABASE_URL
- 503 Passenger → check `~/logs/passenger.log`, `startup file` path, `PORT` env
