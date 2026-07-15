# GitHub Token Scope for CI Workflow

This document explains how to fix the `workflow` scope rejection error when
pushing changes to `.github/workflows/ci.yml`.

## The Error

When running `git push` to push a commit that touches `.github/workflows/*.yml`,
you may see:

```
! [remote rejected] main -> main (refusing to allow an OAuth App to create
  or update workflow `.github/workflows/ci.yml` without `workflow` scope)
```

GitHub rejects workflow file changes from any token that lacks the `workflow`
scope. This is a deliberate security control.

## Fix — Classic Personal Access Token (recommended)

1. Visit https://github.com/settings/tokens (Sign in if prompted)
2. Click **Generate new token (classic)**
3. Set **Note**: `erp-pos-ci-deploy`
4. Set **Expiration**: 90 days (or your org policy)
5. Select scopes:
   - `repo` (Full control of private repos) — required
   - `workflow` (Update GitHub Action workflows) — **REQUIRED** for CI yml
6. Click **Generate token**
7. Copy the token (starts with `ghp_...`)
8. Update your local remote URL:
   ```bash
   cd /home/z/my-project
   git remote set-url origin https://<USERNAME>:<NEW_TOKEN>@github.com/DelwarOfficial/erp-pos.git
   ```
9. Verify: `git remote get-url origin`
10. Push: `git push origin main`

## Fix — Fine-Grained Personal Access Token

1. Visit https://github.com/settings/personal-access-tokens/new
2. **Token name**: `erp-pos-ci-deploy`
3. **Resource owner**: `DelwarOfficial`
4. **Repository access**: Only select repositories → `erp-pos`
5. **Repository permissions**:
   - **Actions**: Read and write
   - **Contents**: Read and write
   - **Workflows**: Read and write — **REQUIRED**
   - **Metadata**: Read-only (auto-selected)
6. Click **Generate token**
7. Update remote URL the same way as classic token (token starts with `github_pat_...`)

## Verifying Scope

After updating the token, you can verify it has the `workflow` scope:

```bash
# Classic token
curl -sSf -H "Authorization: token <TOKEN>" https://api.github.com/user | grep -i scopes
# Should print: x-oauth-scopes: repo, workflow

# Fine-grained token — check via the user/repos endpoint
curl -sSf -H "Authorization: Bearer <TOKEN>" https://api.github.com/user
```

## What CI Runs

The CI workflow at `.github/workflows/ci.yml` runs on every push to `main` or
`develop`, and on every PR to `main`. It performs 6 stages:

1. **Lint + Type Check** — `bun run lint` and `bunx tsc --noEmit`
2. **Unit Tests** — `bun run test` (expects 395 passing tests)
3. **Migration Validation** — Applies all 20 migrations + RLS + functions +
   triggers against a fresh PostgreSQL 16 container; verifies ≥ 200 tables
   and ≥ 170 RLS-enabled tables.
4. **Security Scan** — Hardcoded-secret grep, CSP/HSTS verification, Argon2id
   memory-cost check.
5. **Build** — Next.js standalone build.
6. **E2E Tests** — Playwright + axe-core accessibility, against a fresh
   Postgres DB with all migrations applied.

To trigger CI manually, visit the Actions tab → "CI" → "Run workflow".

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Push rejected with "workflow scope" error | Regenerate token with `workflow` scope (see above) |
| Migration validation job fails | Check that `prisma/migrations/0*.sql` files all exist locally; run `ls prisma/migrations/` |
| E2E job fails with "Server did not start" | Increase the `sleep 10` to `sleep 20` in the e2e-tests job |
| Build fails with "TypeScript errors" | Run `bunx tsc --noEmit` locally and fix the listed errors |
