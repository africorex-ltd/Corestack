# Guide: Deployment

> **Status: approved structure — content lands with M4** (blueprint E18-T09,
> E17-F17.2). Audience: operators/adopters. Normative sources:
> [Architecture §35–41](../architecture/ARCHITECTURE.md), [Database §18–20](../architecture/DATABASE.md).

## Table of contents & content charter

1. **What you're deploying** — _What belongs:_ the one-truth statement:
   CoreStack is inside _your_ app; you deploy your app + Postgres. The two
   process roles (`web`/`worker`) and when you need the second. The minimum
   viable production: 1 node + managed Postgres — stated without shame.
2. **Environment & configuration** — _Belongs:_ the env checklist generated
   from config schemas, secret-store wiring patterns, the fail-fast boot
   report, what `NODE_ENV=production` changes.
3. **The upgrade contract** — _Belongs:_ migrate-then-deploy order, N/N+1
   compatibility explained for operators, expand-and-contract in practice,
   `corestack migrate --dry-run` and `doctor` as pre-flight. The single most
   operationally important section — written like a checklist.
4. **Platform recipes** — _Belongs:_ verified, minimal recipes per target:
   docker-compose/VPS; Fly.io/Cloud Run class; ECS; Kubernetes (Helm example
   pointer with its "example, not product" caveat); Vercel-class (web role) +
   external worker. Each: build, env, health checks, logs. _Never:_ pretending
   to be each platform's docs.
5. **Postgres in production** — _Belongs:_ managed-PG recommendations,
   pooling (PgBouncer transaction mode) and when it becomes necessary,
   partition maintenance scheduling, RLS role setup verification.
6. **Health, observability, alerts** — _Belongs:_ wiring liveness/readiness,
   OTel exporter setup, the golden-signal alert starter pack (outbox lag,
   queue depth, webhook failure rate, login failures), correlation-id log
   querying.
7. **Scaling ladder** — _Belongs:_ the honest rungs from Architecture §41
   with operator-level "you are here" symptoms and the change each rung
   requires; Redis adapters swap; read-replica routing caveat (authorization
   reads stay primary).
8. **Backup & disaster recovery** — _Belongs:_ PITR setup per provider,
   drilled-restore procedure (`doctor --verify-restore`), outbox/webhook/
   billing post-restore behavior in plain words, the KMS-key warning box.
   Links the full runbook.
9. **Security posture at the edge** — _Belongs:_ TLS, proxy-trust
   configuration, webhook-ingress allowlisting, rate-limit tuning for your
   traffic shape, security headers.
10. **Troubleshooting** — _Belongs:_ boot failures (config report reading),
    migration drift, readiness-flap causes, the doctor catalog excerpt.
