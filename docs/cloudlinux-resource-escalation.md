# CloudLinux resource escalation

## Scope

Account: `rangpurt`  
Application: `/home/rangpurt/erp-pos`  
Observed: 2026-08-31

Production remains live on SQLite. No production database, environment file, or
Passenger/Node process was changed during this investigation.

## Evidence

- SSH authentication succeeds and the previously recorded server host key matches.
- Every SSH exec request fails before a command starts with `Unable to exec`.
- Earlier attempts also returned `fork: Resource temporarily unavailable`, `EAGAIN`,
  or `exec request failed on channel 0`.
- Even the audit that uses Bash built-ins and `/proc` cannot start.
- cPanel web authentication succeeds intermittently, but account-level interfaces
  do not provide a safe PID-level process manager.
- No PID has been identified or terminated.
- Live `next-server`, Node, Passenger, and `lsnode` processes were not targeted.

## Required WHM/root action

Inspect this account's current and recent CloudLinux limits:

- NPROC
- entry processes (EP)
- PMEM
- CPU and IO throttling
- process/thread count
- faults recorded for the account

List only processes owned by `rangpurt`, including PID, PPID, state, elapsed time,
start time, and command. Identify abandoned `prisma`, `schema-engine`,
`query-engine`, or migration processes. Preserve live Passenger/Node application
processes.

Terminate only an engine PID confirmed stale by two observations with the same PID
and start time and no active migration owner. Send `TERM` first, re-check, and use
`KILL` only if the same confirmed stale PID ignores `TERM`.

If no stale engine exists, raise or reset the account's exhausted NPROC/EP/PMEM
state enough to allow normal SSH exec and Prisma engine startup.

## Recovery acceptance

Do not resume MariaDB deployment until all conditions hold:

1. Three consecutive SSH exec requests succeed.
2. Three consecutive process-spawn checks succeed without `EAGAIN`.
3. `bunx prisma@6.11.1 --version` succeeds repeatedly.
4. No Prisma/schema engine hangs, crashes, or remains after exit.
5. Production HTTPS and Passenger application remain healthy.

Until then:

```text
RESOURCE STABILITY: BLOCKED
MIGRATE DEPLOY REPEATABILITY: NOT STARTED
READY FOR FINAL DB: NO
READY FOR CUTOVER: NO
ERP LIVE ON MARIADB: NO
```
