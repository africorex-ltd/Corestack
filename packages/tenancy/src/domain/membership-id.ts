import { ValidationError } from "@corestack/kernel";

/**
 * Standard UUID (any RFC 4122 version) — same pattern as `OrganizationId`
 * (E05-T02), not narrowed to v4/v7: a `MembershipId` may be constructed
 * from an id any `IdGenerator` produced.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Value object wrapping a membership row's own identity — distinct from
 * `OrganizationId` (the organization it belongs to) and `UserId` (the user
 * it belongs to). E05-T04 Section 3.
 *
 * Invariant: the wrapped string is a syntactically valid UUID — enforced
 * once, at construction (`from`).
 *
 * Equality is by value (case-insensitively — UUIDs have no case
 * significance); the wrapped value is normalized to lowercase at
 * construction. Immutable: private field, no setter, instance frozen.
 */
export class MembershipId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): MembershipId {
    if (!UUID_PATTERN.test(value)) {
      throw new ValidationError(`invalid membership id "${value}" (expected a UUID)`, {
        metadata: { value },
      });
    }
    return new MembershipId(value.toLowerCase());
  }

  get value(): string {
    return this.#value;
  }

  equals(other: MembershipId): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
