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
`develop`, and on every PR to `main`. It performs 7 stages:

1. **Lint + Type Check** — `bun run lint` and `bunx tsc --noEmit` (with `ignoreBuildErrors: false`)
2. **Unit Tests** — `bun run test` (expects 395 passing tests)
3. **Migration Validation** — Applies all 22 migrations + RLS + functions +
   triggers against a fresh PostgreSQL 16 container; verifies ≥ 200 tables
   and ≥ 170 RLS-enabled tables.
4. **Security Scan** — Hardcoded-secret grep, CSP/HSTS verification, Argon2id
   memory-cost check.
5. **Build** — Next.js standalone build (with `ignoreBuildErrors: false`).
6. **E2E Tests** — Playwright + axe-core accessibility, against a fresh
   Postgres DB with all migrations applied.
7. **Summary** — Aggregate pass/fail across all stages.

To trigger CI manually, visit the Actions tab → "CI" → "Run workflow".

## Exact Commands to Push the CI Workflow

After you have a token with `workflow` scope (see above), run these exact
commands from the project root:

```bash
cd /home/z/my-project

# 1. Update the remote URL with your new token (replace <USERNAME> and <TOKEN>)
git remote set-url origin https://<USERNAME>:<TOKEN>@github.com/DelwarOfficial/erp-pos.git

# 2. Verify the remote URL was updated (token should appear in the URL)
git remote get-url origin

# 3. Stage the CI workflow file
git add .github/workflows/ci.yml

# 4. Commit
git commit -m "Add CI workflow with workflow-scoped token"

# 5. Push
git push origin main
```

If the push succeeds, you'll see:
```
To https://github.com/DelwarOfficial/erp-pos.git
   xxxxxxx..yyyyyyy  main -> main
```

If you still see the "workflow scope" error, the token does not have the
`workflow` scope — regenerate it with the `workflow` checkbox ticked.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Push rejected with "workflow scope" error | Regenerate token with `workflow` scope (see above) |
| Migration validation job fails | Check that `prisma/migrations/0*.sql` files all exist locally; run `ls prisma/migrations/` |
| E2E job fails with "Server did not start" | Increase the `sleep 10` to `sleep 20` in the e2e-tests job |
| Build fails with "TypeScript errors" | Run `bunx tsc --noEmit` locally and fix the listed errors — `ignoreBuildErrors` is now `false` |
| Build fails with OOM | Increase `NODE_OPTIONS=--max-old-space-size=2048` in the CI environment |
