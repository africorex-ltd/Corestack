import { ValidationError } from "@corestack/kernel";

/**
 * Standard UUID (any RFC 4122 version) — E05-T02 Section 3. Deliberately
 * does not restrict to v4/v7: an `OrganizationId` may be constructed from
 * an id any `IdGenerator` produced, and the platform's own `UuidGenerator`
 * emits v7.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Value object wrapping an organization's identity.
 *
 * Invariant: the wrapped string is a syntactically valid UUID — enforced
 * once, at construction (`from`), so every other piece of code holding an
 * `OrganizationId` can treat the value as already-valid rather than
 * re-checking it.
 *
 * Equality is by value, not by reference: two `OrganizationId` instances
 * wrapping the same id (case-insensitively — UUIDs have no case
 * significance) are `.equals()`. The wrapped value is normalized to
 * lowercase at construction specifically so this holds without a
 * case-insensitive comparison at every call site.
 *
 * Immutable: the wrapped value is a private field with no setter, and the
 * instance is frozen — there is no way to mutate an `OrganizationId` after
 * construction.
 */
export class OrganizationId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): OrganizationId {
    if (!UUID_PATTERN.test(value)) {
      throw new ValidationError(`invalid organization id "${value}" (expected a UUID)`, {
        metadata: { value },
      });
    }
    return new OrganizationId(value.toLowerCase());
  }

  get value(): string {
    return this.#value;
  }

  equals(other: OrganizationId): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
