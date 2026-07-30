# @corestack/tenancy

## 0.0.1

### Initial scaffold (E05-T01)

- Module scaffold only: package manifest, `createTenancyModule` factory
  (registers a purge subscription, a static health stub, no use cases yet),
  repository ports (`OrganizationRepository`, `MembershipRepository`,
  `InvitationRepository`), tenancy event contracts (types only, no
  publishing), `tenancyConfigSpec`, and a schema-only migration.
- No aggregates, no commands, no persistence, no HTTP interface. See the
  package [README](./README.md#what-is-intentionally-not-implemented) for
  the complete list of what this release deliberately does not include.

### Organization domain model (E05-T02)

- `Organization` aggregate: pure domain model, no persistence/I/O.
  `OrganizationId`/`OrganizationSlug` value objects, `OrganizationStatus`
  (`ACTIVE`/`SUSPENDED`/`DELETED`, `DELETED` terminal), explicit methods
  (`create`/`rename`/`suspend`/`reactivate`/`delete`), domain events
  (`OrganizationCreated`/`Renamed`/`Suspended`/`Reactivated`/`Deleted`)
  collected via `pullDomainEvents()`/`clearDomainEvents()`. Full detail:
  [docs/modules/organization-domain.md](../../docs/modules/organization-domain.md).
- Superseded the E05-T01 placeholder `OrganizationRecord`; updated
  `OrganizationRepository`'s port signatures to return the real
  `Organization` aggregate.
- No `Membership`/`Invitation` aggregates, no commands, no persistence —
  still out of scope.

### `createOrganization` use case (E05-T03)

- The first real application service: coordinates the `Organization`
  aggregate, `OrganizationRepository`, and `UnitOfWork` event publication.
  `CreateOrganizationCommand`/`CreateOrganizationResult` (a DTO, never the
  aggregate), `DuplicateSlugError` (extends `ConflictError`). Whole flow —
  uniqueness check, aggregate creation, persistence, event publication —
  runs inside one `UnitOfWork.run()` call. Depends on the generic kernel
  `UnitOfWork`, not `PostgresUnitOfWork` — no infrastructure coupling.
  15 new tests, in-memory test doubles only. Full detail:
  [docs/modules/create-organization-usecase.md](../../docs/modules/create-organization-usecase.md).
- Added `existsBySlug`/`save` to `OrganizationRepository` (plain `Context`,
  not `OrgScopedContext` — creating an org is necessarily pre-org-scope).
- Fixed `OrganizationCreatedPayload` (E05-T01): dropped the `kind` field,
  which the `Organization` aggregate (E05-T02) has no equivalent of and
  could never actually supply.
- **Not a hard slug-uniqueness guarantee** — `existsBySlug` is best-effort
  until E05-T21 adds a unique index. No `Membership` creation (the
  contract doc's "org + owner membership atomically" isn't built here).
  Not wired into `createTenancyModule`'s `useCases`.
