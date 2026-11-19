# Cron jobs

Scheduled work is triggered from outside the app by calling token-protected
endpoints under `/api/v1/cron/`. These endpoints never use an administrator
login: they accept only `Authorization: Bearer <CRON_API_TOKEN>`, compared in
constant time on the server.

## Risk alert evaluation (daily)

Script: `scripts/cron-evaluate-risk-alerts.sh`
Endpoint: `POST /api/v1/cron/risk-alerts`

### Setup

1. Generate a token once and set it on the server as `CRON_API_TOKEN`
   (at least 32 random characters; see `.env.production.example`):

   ```bash
   openssl rand -base64 32
   ```

2. In the cron environment (not in the script, not in the crontab line), set:
   - `ERP_POS_BASE_URL` — the app's base URL, e.g. `https://erp.example.com`
   - `CRON_API_TOKEN` — the same value as the server's

   For example, an environment file readable only by the cron user
   (`chmod 600`), loaded by the scheduler.

3. Schedule it (09:00 Asia/Dhaka = 03:00 UTC):

   ```cron
   0 3 * * * /opt/erp-pos/scripts/cron-evaluate-risk-alerts.sh >> /var/log/erp-pos/risk-alerts.log 2>&1
   ```

### Behaviour

- Missing `ERP_POS_BASE_URL` or `CRON_API_TOKEN`: the script stops with exit
  code 2 and says which is missing. There is no default for either.
- The token is passed to curl on standard input, so it does not appear in the
  process list, and it is never written to the log.
- HTTP 401: the token does not match the server. HTTP 503: the server has no
  `CRON_API_TOKEN`. Any other non-200: evaluation failed; the server logs the
  cause, the response carries no internals.

### Rotating the token

Set the new value on the server and in the cron environment together; the old
value stops working as soon as the server restarts with the new one.
