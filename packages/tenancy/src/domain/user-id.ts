import { ValidationError } from "@corestack/kernel";

/**
 * Standard UUID (any RFC 4122 version) — same pattern as `OrganizationId`.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Value object wrapping a user's identity, as seen from `Membership`.
 *
 * **Temporary choice (E05-T04 Section 3):** no `UserId` exists anywhere in
 * `@corestack/kernel` or `@corestack/platform` today — confirmed by search
 * before introducing this type, the same empirical-verification discipline
 * used for E05-T02's event-pattern premise. There is no user-identity
 * module in this repo yet (users/auth is out of scope for the Tenancy
 * epic). This class exists only so `Membership` has *something* typed
 * rather than a bare `string` for `userId`, and is deliberately scoped to
 * `@corestack/tenancy`'s own domain layer — it is **not** exported as a
 * shared identity primitive. If/when a real identity module introduces its
 * own `UserId`, this local type should be deleted and `Membership` updated
 * to import that one instead; this is flagged, not silently assumed to be
 * the permanent home for user identity.
 *
 * Invariant: the wrapped string is a syntactically valid UUID — the same
 * shape constraint as `OrganizationId`/`MembershipId`, since every id in
 * this system is UUID-shaped today. Immutable: private field, no setter,
 * instance frozen. Equality is by value.
 */
export class UserId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): UserId {
    if (!UUID_PATTERN.test(value)) {
      throw new ValidationError(`invalid user id "${value}" (expected a UUID)`, {
        metadata: { value },
      });
    }
    return new UserId(value.toLowerCase());
  }

  get value(): string {
    return this.#value;
  }

  equals(other: UserId): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
