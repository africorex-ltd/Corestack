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
