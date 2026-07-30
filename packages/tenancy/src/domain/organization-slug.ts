import { ValidationError } from "@corestack/kernel";

/**
 * Lowercase letters, digits, and single hyphens between segments — E05-T02
 * Section 3. Each `[a-z0-9]+` segment is non-empty by construction, which
 * is what makes leading/trailing/consecutive hyphens impossible without a
 * separate check: `-foo`, `foo-`, and `foo--bar` all fail to match because
 * an empty segment can't satisfy `[a-z0-9]+`.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 50;

/**
 * Value object wrapping an organization's URL-safe slug.
 *
 * Invariants, enforced once at construction (`from`):
 * - length 3–50 characters;
 * - lowercase letters, digits, and hyphens only;
 * - no leading or trailing hyphen;
 * - no consecutive hyphens.
 *
 * Deliberately rejects rather than normalizes: an uppercase or
 * malformed input is a `ValidationError`, not silently lowercased. A
 * caller that wants case-insensitive matching must lowercase before
 * calling `from` — normalizing here would mean this type's string
 * representation could silently disagree with what the caller passed in.
 *
 * Equality is by value; immutable (private field, no setter, frozen
 * instance).
 */
export class OrganizationSlug {
  static readonly MIN_LENGTH = MIN_LENGTH;
  static readonly MAX_LENGTH = MAX_LENGTH;

  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): OrganizationSlug {
    if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
      throw new ValidationError(
        `organization slug must be ${MIN_LENGTH}-${MAX_LENGTH} characters, got ${value.length}`,
        { metadata: { value, length: value.length } },
      );
    }
    if (!SLUG_PATTERN.test(value)) {
      throw new ValidationError(
        `invalid organization slug "${value}" (lowercase letters, digits, and single hyphens only; ` +
          "no leading/trailing/consecutive hyphens)",
        { metadata: { value } },
      );
    }
    return new OrganizationSlug(value);
  }

  get value(): string {
    return this.#value;
  }

  equals(other: OrganizationSlug): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return this.#value;
  }
}
