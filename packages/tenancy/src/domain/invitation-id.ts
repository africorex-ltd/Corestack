import { ValidationError } from "@corestack/kernel";

/**
 * Standard UUID (any RFC 4122 version) — same pattern as `OrganizationId`/
 * `MembershipId`.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Value object wrapping an invitation's own identity — E05-T05 Section 3.
 *
 * Invariant: the wrapped string is a syntactically valid UUID, enforced
 * once at construction (`from`). Equality is by value (case-insensitively
 * — UUIDs have no case significance); normalized to lowercase. Immutable:
 * private field, no setter, instance frozen.
 */
export class InvitationId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): InvitationId {
    if (!UUID_PATTERN.test(value)) {
      throw new ValidationError(`invalid invitation id "${value}" (expected a UUID)`, {
        metadata: { value },
      });
    }
    return new InvitationId(value.toLowerCase());
  }

  get value(): string {
    return this.#value;
  }

  equals(other: InvitationId): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
