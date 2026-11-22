# Deploy to one Ubuntu VPS

Stack: `docker/docker-compose.prod.yml` (Caddy with automatic HTTPS, web,
worker, MariaDB 11.8, Redis) on Ubuntu 22.04 or 24.04.

This runbook is not deployment authorization. Each numbered step changes the
server and needs the operator's approval.

> **Not yet rehearsed with Docker.** The images, the compose file, Caddy and a
> backup restore have never been run. See [What has been verified](#what-has-been-verified).
> Treat the first deploy as a rehearsal and enter no real business data until
> steps 1–10 pass.

## Before you start

- A VPS with at least 2 vCPU, 8 GB RAM and 80 GB disk is recommended. The
  image build is memory-hungry; on 4 GB add 4 GB of swap.
- A domain whose A record points to the VPS. Add an AAAA record only if IPv6
  reaches the VPS as well.
- A sudo user with key-based SSH, and the provider's web console as a way back
  in if SSH breaks.
- Offsite storage that `rclone` supports, for backups.
- Read access to the repository for the VPS (a read-only deploy key).

In the commands below:

```bash
cd /opt/erp-pos
dc() { docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod "$@"; }
```

Never run `dc config` where its output is recorded: it prints every secret.

## 1. Inspect (read-only)

```bash
lsb_release -ds; nproc; free -h; df -h /; timedatectl
sudo ss -tlnp
sudo ufw status verbose
docker --version; docker compose version
```

Stop if ports 80 or 443 are in use, or other sites or databases live on this
VPS: the plan then needs changing.

## 2. Base system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ufw unattended-upgrades rclone openssl
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw enable
```

If SSH is on a custom port, allow that port before enabling the firewall.
Turn off SSH password login only after a second key-based login has worked,
and keep the first session open while doing it.

Install Docker Engine and the compose plugin from Docker's apt repository
(<https://docs.docker.com/engine/install/ubuntu/>). Membership of the `docker`
group is equivalent to root: give it only to the deploy user.

Docker's published ports bypass UFW. Only Caddy publishes ports (80, 443);
MariaDB, Redis and the app publish none. Keep it that way.

## 3. Code

```bash
sudo install -d -o "$USER" -g "$USER" -m 750 /opt/erp-pos
git clone <repository-url> /opt/erp-pos
cd /opt/erp-pos && git log --oneline -1
```

Deploy a reviewed commit. Do not `chmod` or edit tracked files on the VPS:
`deploy.sh` refuses a dirty checkout.

## 4. Secrets

```bash
bash scripts/deploy/gen-secrets.sh
nano docker/.env.prod   # APP_DOMAIN, ACME_EMAIL, DB_BUFFER_POOL
```

The script prints no secret and never overwrites the file. Put a copy of
`docker/.env.prod` in a password manager, separately from the database
backups. A backup restored without its `APP_ENCRYPTION_KEY` cannot decrypt MFA
seeds or provider credentials.

## 5. First deploy

```bash
bash scripts/deploy/deploy.sh
```

It builds, starts MariaDB and Redis, takes a backup, applies migrations, then
starts web, worker and Caddy. It stops at the first failure.

A web container that exits at once has unsafe configuration; `dc logs web`
names the setting without printing its value. Web reports unhealthy while the
database, Redis or the worker is down, and Caddy does not start until web is
healthy.

## 6. Seed (first install only)

```bash
read -rsp 'Platform admin password: ' PLATFORM_ADMIN_PASSWORD; echo
export PLATFORM_ADMIN_PASSWORD
dc run --rm -e PLATFORM_ADMIN_PASSWORD worker tsx scripts/seed.ts
unset PLATFORM_ADMIN_PASSWORD
```

This creates currencies, permissions, system roles and
`admin@erp-platform.local`. Sign in at `https://<domain>` and enrol MFA
immediately.

## 7. Company

As the platform admin, onboard the company from Onboarding. The owner enrols
MFA, then the platform admin activates the company. In the company, set up
SMS before switching on loyalty: spending points needs a texted code.

## 8. Backups

Configure an rclone remote (an encrypted one, as dumps hold business data),
set `BACKUP_RCLONE_REMOTE` in `docker/.env.prod`, then:

```bash
sudo install -d -o "$USER" -m 700 /var/backups/erp-pos /var/log/erp-pos
bash scripts/deploy/backup.sh
crontab -e
```

Cron line (02:30 Dhaka when the host clock is UTC; adjust if it is not):

```cron
30 20 * * * bash /opt/erp-pos/scripts/deploy/backup.sh >> /var/log/erp-pos/backup.log 2>&1
```

The worker already runs daily reconciliation and risk alerts. The script in
[cron-jobs.md](cron-jobs.md) is not needed on this stack.

## 9. Restore rehearsal

Required before real data. It uses a throwaway container with no network and
never touches the live database:

```bash
F=$(ls -t /var/backups/erp-pos/*.sql.gz | head -1)
sha256sum -c "$F.sha256"
docker run -d --name erp-restore-test --network none -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:11.8
until docker exec erp-restore-test healthcheck.sh --connect --innodb_initialized; do sleep 3; done
gunzip -c "$F" | docker exec -i erp-restore-test mariadb -uroot
docker exec erp-restore-test mariadb -uroot -e 'SELECT COUNT(*) FROM erp_pos._prisma_migrations; SELECT COUNT(*) FROM erp_pos.companies; SELECT COUNT(*) FROM erp_pos.sales;'
docker rm -f -v erp-restore-test
```

Compare the counts with live, and record the date and duration. Wider
reconciliation checks are in [backup-restore.md](backup-restore.md).

## 10. Smoke test

- `https://<domain>/api/v1/health` returns 200 and `"status":"ok"`.
- `sudo ss -tlnp` shows no public 3000, 3306 or 6379.
- Sign in with MFA as owner and as cashier.
- Cash sale, receipt, void.
- Points sale with a code received on a real phone.
- Offline till: take a sale with the network off, reconnect, find it in Sales
  History under that cashier.
- Revoke that till under Access → Users → Tills.
- Reboot the VPS: every service returns and health is 200 again.

Remove or void the test records before opening to staff.

## Later releases

```bash
cd /opt/erp-pos && git pull --ff-only && bash scripts/deploy/deploy.sh
```

## Going back

For an application fault whose migrations were additive, start the previous
images again (each release is tagged with its commit):

```bash
APP_VERSION=<previous-short-commit> dc up -d --no-build web worker
```

Migrations are not undone. A data fault needs a restore into a new database
and an explicit cut-over decision; see
[production-migration.md](production-migration.md#failure-handling). Never
restore over the live database, never run `migrate reset` or `db push`, and
never run `dc down -v` (it deletes the data volumes).

## Not configured by this stack

| Item | Effect until configured |
|---|---|
| S3 storage | Features that store files (uploads, stored documents) do not work; the compose file does not pass `S3_*` yet |
| bKash, Nagad, courier keys | Those integrations do not work; the compose file does not pass these keys yet |
| `SENTRY_DSN` | Server errors appear only in container logs |
| OpenTelemetry collector | Traces and metrics go nowhere |
| Binary-log shipping | Binary logs stay on the VPS; losing it loses everything since the last offsite dump |
| External uptime monitor | Nobody is told when the site is down |

## What has been verified

On a Windows development machine, 2026-11-22:

| Check | Result |
|---|---|
| `npm run build` from an export of only the files git would ship | Passed |
| That artifact with weak, missing or localhost security settings | Exits 1, port closed |
| That artifact with strong settings and no Redis | Runs; health 503; sign-in 503 |
| CSRF check behind forwarded HTTPS host headers | Same-origin passes, cross-site 403 |
| Worker guard (through a test loader, not `tsx`) | Refuses unsafe settings |
| Deploy script order and failure stops (fake `docker`) | Passed |

Not verified: Docker image builds, compose, Caddy and certificates, the worker
under `tsx` with real Redis, the seed, real SMS, backup and restore, and
migrations run as the non-root database user.
