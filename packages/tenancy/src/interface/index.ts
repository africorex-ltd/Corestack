/**
 * Tenancy's HTTP interface (E05-T13) — a thin adaptation layer over the
 * existing application use cases and query services (E05-T02..T12). No
 * controller framework, no middleware abstraction, no DI container
 * (Section 14) — every route is a plain `async` function with one
 * `try`/`catch`, and `tenancyRoutes` is declarative route metadata a real
 * binding (Hono, per `docs/architecture/ARCHITECTURE.md` §10/§45) would
 * register. See `docs/modules/tenancy-http-interface.md` for the full
 * design: route table, validation rules, error mapping, the 404-vs-403
 * rationale, serialization rules, and the future pagination note.
 */
export * from "./http/index.js";
