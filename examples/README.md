# examples/

Documentation-grade deployment assets — **examples, not product**
(Architecture §37–39): maintained to teach, verified in CI where practical,
but not a supported surface.

| Asset                                         | Status          | Blueprint        |
| --------------------------------------------- | --------------- | ---------------- |
| [`docker/`](docker)                           | Arrives with M4 | E17-T11          |
| [`helm/`](helm)                               | Arrives with M4 | E17-T15          |
| [`terraform/`](terraform) (AWS ECS+RDS first) | Arrives with M4 | E17-T16          |
| [`monitoring/`](monitoring)                   | Arrives with M4 | E17-T14, E18-T18 |

The local dev stack lives at the repo root:
[`docker-compose.dev.yml`](../docker-compose.dev.yml).
