# examples/

Documentation-grade deployment assets — **examples, not product**
(Architecture §37–39): maintained to teach, verified in CI where practical,
but not a supported surface.

| Asset                                         | Status                             | Blueprint                      |
| --------------------------------------------- | ---------------------------------- | ------------------------------ |
| [`acme-crm-module/`](acme-crm-module)         | **Live** — real module, real tests | Tenant Isolation Certification |
| [`docker/`](docker)                           | Arrives with M4                    | E17-T11                        |
| [`helm/`](helm)                               | Arrives with M4                    | E17-T15                        |
| [`terraform/`](terraform) (AWS ECS+RDS first) | Arrives with M4                    | E17-T16                        |
| [`monitoring/`](monitoring)                   | Arrives with M4                    | E17-T14, E18-T18               |

`acme-crm-module/` is different from the other rows above: it's a real,
buildable, tested `@corestack/*` workspace package (not
documentation-grade deployment assets) — the canonical golden-path
example every contributor should read before building a tenant-facing
feature. See
[docs/security/how-to-build-a-tenant-safe-feature.md](../docs/security/how-to-build-a-tenant-safe-feature.md).

The local dev stack lives at the repo root:
[`docker-compose.dev.yml`](../docker-compose.dev.yml).
