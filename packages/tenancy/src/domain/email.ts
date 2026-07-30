import { ValidationError } from "@corestack/kernel";

/**
 * Deliberately simple: local-part@domain, each side non-empty and free of
 * whitespace/`@`, domain containing at least one dot. Not a full RFC 5322
 * validator — this is an invitation's destination address, not a mail
 * transport concern (Section 13: no delivery concerns in the domain).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Value object wrapping an invitation's invitee email address.
 *
 * **Temporary choice (E05-T05 Section 3):** no `Email` value object exists
 * anywhere in `@corestack/kernel` or `@corestack/platform` today —
 * confirmed by search before introducing this type, the same discipline
 * used for E05-T04's `UserId`. Scoped to `@corestack/tenancy`'s own
 * domain layer, not exported as a shared primitive. If a shared identity/
 * contact module is ever introduced, this type should be deleted and
 * `Invitation` updated to import that one instead.
 *
 * Invariant: normalized (trimmed, lowercased) then validated against
 * `EMAIL_PATTERN` — unlike `OrganizationSlug` (which *rejects* case
 * variance instead of normalizing it), Section 7 explicitly asks for
 * email to be "valid and normalised", so this type trims and lowercases
 * before validating rather than rejecting on case. Immutable: private
 * field, no setter, instance frozen. Equality is by (normalized) value.
 */
export class Email {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): Email {
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new ValidationError(`invalid email "${value}"`, { metadata: { value } });
    }
    return new Email(normalized);
  }

  get value(): string {
    return this.#value;
  }

  equals(other: Email): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
